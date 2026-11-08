// Etapa de apresentação (GDD-v0.3 §10.1 item 4 e §10.2): a cena é desenhada num alvo na resolução interna do
// preset; um quad final leva o alvo à tela com escala inteira (filtro nearest), aplicando dither Bayer 4×4 e
// quantização para `render.ps1.color_bits` por canal com intensidade `render.ps1.dither`.
// Com intensidade 0 o passe final copia o alvo sem alteração. Ponto de entrada da camada A de pós (V4).
import * as THREE from "three";
import { balance } from "../data.ts";
import { ditherUniform, ps1Uniforms } from "./ps1.ts";

export type PresetName = keyof typeof balance.render.presets;

const POST_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

const POST_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uDither;
uniform float uBits;
varying vec2 vUv;
// matriz de Bayer 4×4 (limiares 0..15)
const float BAYER[16] = float[16]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );
void main() {
  vec4 c = texture2D( tDiffuse, vUv );
  ivec2 p = ivec2( floor( vUv * uRes ) );          // pixel da resolução interna
  float threshold = ( BAYER[ ( p.y & 3 ) * 4 + ( p.x & 3 ) ] + 0.5 ) / 16.0;
  float levels = exp2( uBits ) - 1.0;
  vec3 q = clamp( floor( c.rgb * levels + threshold ) / levels, 0.0, 1.0 );
  gl_FragColor = vec4( mix( c.rgb, q, uDither ), 1.0 );
}
`;

export interface Presenter {
  /** alvo de render na resolução interna */
  target: THREE.WebGLRenderTarget;
  preset: PresetName;
  /** escala inteira atual (pixels de tela por pixel interno) */
  scale: number;
  setPreset(name: PresetName): void;
  /** desenha a cena no alvo e o alvo na tela */
  present(scene: THREE.Scene, camera: THREE.Camera): void;
}

/** cria o alvo em baixa resolução e o passe final; `canvas` recebe tamanho e estilo com escala inteira */
export function createPresenter(R: THREE.WebGLRenderer, canvas: HTMLCanvasElement, preset: PresetName): Presenter {
  const target = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  const post = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: target.texture }, uRes: ps1Uniforms.uRes, uDither: ditherUniform, uBits: { value: balance.render.ps1.color_bits } },
    vertexShader: POST_VERTEX,
    fragmentShader: POST_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post);
  quad.frustumCulled = false;
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let lastKey = "";

  const self: Presenter = {
    target, preset, scale: 1,
    setPreset(name) {
      const [w, h] = balance.render.presets[name].internal;
      self.preset = name;
      target.setSize(w, h);
      ps1Uniforms.uRes.value.set(w, h);
      lastKey = "";
    },
    present(scene, camera) {
      fit();
      R.setRenderTarget(target);
      R.render(scene, camera);
      R.setRenderTarget(null);
      R.render(quadScene, quadCam);
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
