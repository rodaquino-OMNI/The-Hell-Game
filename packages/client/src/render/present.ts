// Etapa de apresentação (GDD-v0.3 §10.1 item 4 e §10.2): a cena é desenhada num alvo na resolução interna do
// preset; um passe de pós, também na resolução interna, aplica a camada A e depois o dither Bayer 4×4 e a
// quantização para `render.ps1.color_bits` por canal com intensidade `render.ps1.dither`; um quad final leva o
// resultado à tela com escala inteira (filtro nearest) e as scanlines.
// Camada A (GDD-v0.3 §10.2, itens do GDD-v0.2 §10.2), na ordem: aberração cromática (pulso de dano), bloom só nos
// emissivos (máscara no alfa do alvo; passe próprio em meia resolução interna), LUT fria (textura 3D), vinheta e grão, ANTES da quantização (o dither
// absorve o grão). As scanlines ficam no quad final: com escala ≥ 2 escurecem a última linha de tela de cada linha
// interna (o vão entre linhas de um CRT é menor que um pixel interno); com escala 1, linhas internas alternadas.
// O pós na resolução interna custa o mesmo em qualquer janela (SwiftShader e GPU integrada).
// Com as intensidades em 0 os dois passes copiam o alvo sem alteração.
import * as THREE from "three";
import { balance } from "../data.ts";
import { coldLutTexture, postUniforms } from "./layers.ts";
import { ditherUniform, ps1Uniforms } from "./ps1.ts";

export type PresetName = keyof typeof balance.render.presets;

const POST_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

/** bloom em meia resolução interna (o brilho é suave: 1/4 dos fragmentos do passe de pós) */
const BLOOM_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uRes;
varying vec2 vUv;
// brilho dos emissivos: média ponderada da cor dos pixels com alfa 0 em 13 amostras (centro e dois anéis de 6,
// a meio raio e no raio BLOOM_R, em pixels internos), peso caindo com a distância. 13 amostras em vez do disco
// cheio: o custo cabe no SwiftShader da CI e em GPU integrada
vec3 bloom() {
  vec4 c0 = texture2D( tDiffuse, vUv );
  vec3 sum = c0.rgb * ( 1.0 - c0.a );
  float wsum = 1.0;
  for ( int ring = 1; ring <= 2; ring ++ ) {
    float r = float( BLOOM_R ) * float( ring ) * 0.5;
    float w = 1.0 - r / ( float( BLOOM_R ) + 1.0 );
    for ( int k = 0; k < 6; k ++ ) {
      // anéis girados meio passo um do outro (ângulos de 60° em 60°)
      float a = ( float( k ) + 0.5 * float( ring - 1 ) ) * 1.04719755;
      vec4 c = texture2D( tDiffuse, vUv + vec2( cos( a ), sin( a ) ) * r / uRes );
      sum += c.rgb * ( 1.0 - c.a ) * w;
      wsum += w;
    }
  }
  return sum / wsum;
}
void main() { gl_FragColor = vec4( bloom(), 1.0 ); }
`;

const POST_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform highp sampler3D tLut;
uniform vec2 uRes;
uniform float uDither;
uniform float uBits;
uniform float uGrain, uGrainAmount, uGrainFrame, uGrainSeed;
uniform float uVignette, uVignetteAmount;
uniform vec2 uVignetteRadius;
uniform float uAberration, uAberrationPx;
uniform float uBloom, uBloomAmount;
uniform float uLut, uLutSize;
varying vec2 vUv;
// matriz de Bayer 4×4 (limiares 0..15)
const float BAYER[16] = float[16]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );
// hash inteiro pcg3d (Jarzynski e Olano, 2020): ruído do grão por pixel interno, quadro e semente
uvec3 pcg3d( uvec3 v ) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
void main() {
  vec4 c = texture2D( tDiffuse, vUv );
  ivec2 p = ivec2( floor( vUv * uRes ) );          // pixel da resolução interna
  // aberração cromática: R e B deslocados para fora e para dentro, proporcional à distância ao centro (canto = 1)
  if ( uAberration > 0.0 ) {
    vec2 off = ( vUv - 0.5 ) * 1.41421356 * uAberration * uAberrationPx / uRes;
    c.r = texture2D( tDiffuse, vUv + off ).r;
    c.b = texture2D( tDiffuse, vUv - off ).b;
  }
  if ( uBloom > 0.0 ) c.rgb += texture2D( tBloom, vUv ).rgb * uBloom * uBloomAmount;
  if ( uLut > 0.0 ) {
    vec3 l = texture( tLut, clamp( c.rgb, 0.0, 1.0 ) * ( ( uLutSize - 1.0 ) / uLutSize ) + 0.5 / uLutSize ).rgb;
    c.rgb = mix( c.rgb, l, uLut );
  }
  if ( uVignette > 0.0 ) {
    vec2 a = vec2( uRes.x / uRes.y, 1.0 );
    float r = length( ( vUv - 0.5 ) * a ) / length( 0.5 * a );
    c.rgb *= 1.0 - uVignette * uVignetteAmount * smoothstep( uVignetteRadius.x, uVignetteRadius.y, r );
  }
  if ( uGrain > 0.0 ) {
    uvec3 h = pcg3d( uvec3( uint( p.x ), uint( p.y ), uint( uGrainFrame ) * 65536u + uint( uGrainSeed ) ) );
    float n = float( h.x & 65535u ) / 65535.0 - 0.5;
    c.rgb += 2.0 * n * uGrain * uGrainAmount;
  }
  float threshold = ( BAYER[ ( p.y & 3 ) * 4 + ( p.x & 3 ) ] + 0.5 ) / 16.0;
  float levels = exp2( uBits ) - 1.0;
  vec3 q = clamp( floor( c.rgb * levels + threshold ) / levels, 0.0, 1.0 );
  gl_FragColor = vec4( mix( c.rgb, q, uDither ), 1.0 );
}
`;

/** quad final: escala inteira (nearest) e scanlines leves */
const BLIT_FRAGMENT = /* glsl */ `
uniform sampler2D tPost;
uniform float uScale;
uniform float uScanlines, uScanlineAmount;
varying vec2 vUv;
void main() {
  vec4 c = texture2D( tPost, vUv );
  if ( uScanlines > 0.0 ) {
    float ys = floor( gl_FragCoord.y );
    float dark = uScale >= 2.0 ? ( mod( ys, uScale ) < 0.5 ? 1.0 : 0.0 ) : mod( ys, 2.0 );
    c.rgb *= 1.0 - uScanlines * uScanlineAmount * dark;
  }
  gl_FragColor = vec4( c.rgb, 1.0 );
}
`;

export interface Presenter {
  /** alvo de render na resolução interna */
  target: THREE.WebGLRenderTarget;
  preset: PresetName;
  /** escala inteira atual (pixels de tela por pixel interno) */
  scale: number;
  setPreset(name: PresetName): void;
  /** desenha a cena no alvo, aplica o pós na resolução interna e leva o resultado à tela */
  present(scene: THREE.Scene, camera: THREE.Camera): void;
}

const quadMaterial = (uniforms: Record<string, THREE.IUniform>, fragmentShader: string, defines: Record<string, unknown> = {}) =>
  new THREE.ShaderMaterial({ uniforms, defines, vertexShader: POST_VERTEX, fragmentShader, depthTest: false, depthWrite: false });

/** cria os alvos em baixa resolução e os passes de pós; `canvas` recebe tamanho e estilo com escala inteira */
export function createPresenter(R: THREE.WebGLRenderer, canvas: HTMLCanvasElement, preset: PresetName): Presenter {
  const nearest = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
  const target = new THREE.WebGLRenderTarget(1, 1, { ...nearest, depthBuffer: true });
  const postTarget = new THREE.WebGLRenderTarget(1, 1, { ...nearest, depthBuffer: false });
  const bloomTarget = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  postUniforms.tLut.value ??= coldLutTexture();
  const scaleUniform = { value: 1 };
  const { uScanlines, uScanlineAmount, ...postOnly } = postUniforms;
  const post = quadMaterial(
    { tDiffuse: { value: target.texture }, tBloom: { value: bloomTarget.texture }, uRes: ps1Uniforms.uRes, uDither: ditherUniform, uBits: { value: balance.render.ps1.color_bits }, ...postOnly },
    POST_FRAGMENT,
  );
  const bloomMat = quadMaterial({ tDiffuse: { value: target.texture }, uRes: ps1Uniforms.uRes }, BLOOM_FRAGMENT, { BLOOM_R: balance.render.layer_a.bloom_radius_px });
  const blit = quadMaterial({ tPost: { value: postTarget.texture }, uScale: scaleUniform, uScanlines, uScanlineAmount }, BLIT_FRAGMENT);
  const geo = new THREE.PlaneGeometry(2, 2);
  const scene = (m: THREE.Material) => {
    const s = new THREE.Scene(), q = new THREE.Mesh(geo, m);
    q.frustumCulled = false; s.add(q);
    return s;
  };
  const postScene = scene(post), blitScene = scene(blit), bloomScene = scene(bloomMat);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let lastKey = "";

  const self: Presenter = {
    target, preset, scale: 1,
    setPreset(name) {
      const [w, h] = balance.render.presets[name].internal;
      self.preset = name;
      target.setSize(w, h);
      postTarget.setSize(w, h);
      bloomTarget.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
      ps1Uniforms.uRes.value.set(w, h);
      lastKey = "";
    },
    present(s, camera) {
      fit();
      R.setRenderTarget(target);
      R.render(s, camera);
      if (postUniforms.uBloom.value > 0) { R.setRenderTarget(bloomTarget); R.render(bloomScene, quadCam); }
      R.setRenderTarget(postTarget);
      R.render(postScene, quadCam);
      R.setRenderTarget(null);
      R.render(blitScene, quadCam);
    },
  };

  /** maior escala inteira que cabe na janela (sem cortar a imagem); o canvas fica centrado */
  function fit() {
    const [w, h] = balance.render.presets[self.preset].internal;
    const dpr = window.devicePixelRatio || 1;
    const vw = window.innerWidth, vh = window.innerHeight;
    const key = `${self.preset}:${vw}x${vh}@${dpr}`;
    if (key === lastKey) return;
    lastKey = key;
    const k = Math.max(1, Math.floor(Math.min((vw * dpr) / w, (vh * dpr) / h)));
    self.scale = k;
    scaleUniform.value = k;
    R.setSize(w * k, h * k, false);
    const cw = (w * k) / dpr, ch = (h * k) / dpr;
    Object.assign(canvas.style, {
      inset: "auto", width: `${cw}px`, height: `${ch}px`,
      left: `${Math.floor((vw - cw) / 2)}px`, top: `${Math.floor((vh - ch) / 2)}px`,
    });
  }

  self.setPreset(preset);
  return self;
}
