// Ambiente do Pátio, camadas B e C do GDD-v0.3 §10.2 (itens no GDD-v0.2 §10.2).
//  B (Médio e Alto): lanterna do jogador (SpotLight com cone e sombra de render.shadow_map px, filtro nearest:
//    sombra pixelada) e luz assada nos vértices do cenário (oclusão perto dos muros e poça de luz das lâmpadas dos
//    geradores), no atributo `ps1Bake` lido pelo Ps1Material.
//  C (só Alto): névoa volumétrica barata (billboards) e partículas de poeira. Decals (pegadas, riscos) e reflexos
//    falsos em poças: LACUNA (o mapa não tem posições de poça e as pegadas dependem do estado "ferido", [Proposta]).
// Números em data/balance.yaml `render.layer_b` e `render.layer_c`; cores por token de data/art/palette.json.
import * as THREE from "three";
import { insideWall } from "@thehell/sim";
import { balance, cfg } from "../data.ts";
import { paletteColor } from "./layers.ts";

const rc = balance.render;
const lb = rc.layer_b;
const lc = rc.layer_c;

// ---------- camada B: lanterna ----------

/** lanterna do jogador: cone e sombra; fica desligada (invisível) fora da camada B */
export function createLantern(): THREE.SpotLight {
  const l = lb.lantern;
  const s = new THREE.SpotLight(paletteColor(l.color), l.intensity * Math.PI, l.distance, THREE.MathUtils.degToRad(l.angle_deg), l.penumbra, l.decay);
  s.castShadow = true;
  s.shadow.mapSize.set(rc.shadow_map, rc.shadow_map);
  s.shadow.bias = l.shadow_bias;
  // sem deslocamento pela normal: o Ps1Material calcula a coordenada da sombra sem ele (ps1.ts, D-44 a)
  s.shadow.normalBias = 0;
  s.shadow.camera.near = rc.camera.near;
  s.shadow.camera.far = l.distance;
  s.visible = false;
  return s;
}

const fwd = new THREE.Vector3();
/**
 * põe a lanterna na mão do jogador (altura `lantern.height`, `forward` à frente e `side` à direita), apontada para
 * onde a câmera olha. O deslocamento lateral separa a luz do olho: sem ele a sombra fica escondida atrás do objeto.
 */
export function aimLantern(s: THREE.SpotLight, cam: THREE.Camera, x: number, z: number) {
  cam.updateMatrixWorld();
  cam.getWorldDirection(fwd);
  const flat = Math.hypot(fwd.x, fwd.z) || 1;
  const fx = fwd.x / flat, fz = fwd.z / flat, { forward, side } = lb.lantern;
  // direita da câmera no plano = (−fz, fx)
  s.position.set(x + fx * forward - fz * side, lb.lantern.height, z + fz * forward + fx * side);
  s.target.position.copy(s.position).add(fwd);
  s.target.updateMatrixWorld();
}

// ---------- camada B: luz assada ----------

/** atributo `ps1Bake` neutro (luz 0, oclusão 1) para a geometria nascer compatível com o material `baked` */
export function neutralBake(g: THREE.BufferGeometry) {
  const n = g.getAttribute("position").count;
  const a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) a[i * 4 + 3] = 1;
  g.setAttribute("ps1Bake", new THREE.BufferAttribute(a, 4));
}

/** distância no plano XZ de (x, z) até a caixa de muro mais próxima do mapa efetivo (`cfg.map`, com as pilastras do v1) */
export function wallDistance(x: number, z: number): number {
  let best = Infinity;
  for (const [wx, wz, ww, wd] of cfg.map.walls) {
    const dx = Math.max(0, Math.abs(x - wx) - ww / 2), dz = Math.max(0, Math.abs(z - wz) - wd / 2);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

/**
 * assa nos vértices de `meshes` (chão e muros): oclusão (chão perto do muro, base da parede) e a luz das lâmpadas
 * em `lamps` (x, z), com queda quadrática até `bake.light_radius` e o cosseno da normal.
 */
export function bakeVertexLight(meshes: THREE.Mesh[], lamps: readonly { x: number; z: number }[], tint?: { color: string; intensity: number }) {
  const b = lb.bake;
  // `tint`: cor e intensidade da luz assada do preset industrial (mockup Retro FPS, D-15); sem ele, `layer_b.bake`
  const color = paletteColor(tint?.color ?? b.light_color).multiplyScalar(tint?.intensity ?? b.light_intensity);
  const p = new THREE.Vector3(), n = new THREE.Vector3(), v = new THREE.Vector3();
  const ao = (d: number) => b.ao_min + (1 - b.ao_min) * THREE.MathUtils.smoothstep(d, 0, b.ao_radius);
  for (const m of meshes) {
    m.updateMatrixWorld();
    const g = m.geometry, pos = g.getAttribute("position"), nor = g.getAttribute("normal");
    const nm = new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
    const attr = g.getAttribute("ps1Bake") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      // chão: oclusão pela distância ao muro; topo do muro: livre; parede: pela altura acima do chão
      const occ = n.y > 0.5 ? (p.y < 0.01 ? ao(wallDistance(p.x, p.z)) : 1) : ao(p.y);
      let r = 0, gg = 0, bb = 0;
      for (const l of lamps) {
        v.set(l.x - p.x, b.light_height - p.y, l.z - p.z);
        const d = v.length();
        if (d >= b.light_radius || d === 0) continue;
        const k = (1 - d / b.light_radius) ** 2 * Math.max(0, n.dot(v.divideScalar(d)));
        r += color.r * k; gg += color.g * k; bb += color.b * k;
      }
      attr.setXYZW(i, r, gg, bb, occ);
    }
    attr.needsUpdate = true;
  }
}

// ---------- camada C: névoa em billboards e poeira ----------

/** mistura que preserva o alfa do alvo (máscara de emissivo da camada A) */
function keepAlphaBlending(m: THREE.ShaderMaterial) {
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
}

const FOG_VERTEX = /* glsl */ `
attribute vec3 aFog;   // tamanho, fase, opacidade relativa
uniform float uTime, uDrift, uDriftSpeed, uNearFade;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec3 c = ( instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  // deriva lenta em X e Z; os fatores 0,7 e 1,3 só descorrelacionam os dois eixos
  c.x += sin( uTime * uDriftSpeed + aFog.y ) * uDrift;
  c.z += cos( uTime * uDriftSpeed * 0.7 + aFog.y * 1.3 ) * uDrift;
  vec4 mv = viewMatrix * vec4( c, 1.0 );
  mv.xy += position.xy * aFog.x;  // de frente para a câmera
  vUv = uv;
  vAlpha = aFog.z * smoothstep( 0.0, uNearFade, - mv.z );
  gl_Position = projectionMatrix * mv;
}
`;
const FOG_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
varying float vAlpha;
void main() {
  float r = length( vUv - 0.5 ) * 2.0;
  float a = uOpacity * vAlpha * ( 1.0 - r ) * ( 1.0 - r );
  if ( r >= 1.0 || a <= 0.0 ) discard;
  gl_FragColor = vec4( uColor, a );
}
`;
const DUST_VERTEX = /* glsl */ `
attribute float aPhase;
uniform float uTime, uBox, uFall, uSway, uSize;
uniform vec3 uCam;
uniform vec3 uLanternPos, uLanternDir;
uniform float uLanternCos, uLanternOn;
varying float vLit;
varying float vDist;
void main() {
  // caixa de uBox m que acompanha a câmera; cada grão cai devagar e balança, com volta pelo módulo
  vec3 p = position * uBox + vec3( sin( uTime + aPhase ) * uSway, - uFall * uTime, cos( uTime + aPhase ) * uSway );
  p = mod( p - uCam + 0.5 * uBox, uBox ) + uCam - 0.5 * uBox;
  vec3 l = p - uLanternPos;
  vLit = uLanternOn * smoothstep( uLanternCos, mix( uLanternCos, 1.0, 0.5 ), dot( normalize( l ), uLanternDir ) );
  vec4 mv = viewMatrix * vec4( p, 1.0 );
  vDist = - mv.z;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize;
}
`;
const DUST_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uAmbient, uFogNear, uFogFar;
varying float vLit;
varying float vDist;
void main() {
  float a = uOpacity * mix( uAmbient, 1.0, vLit ) * ( 1.0 - smoothstep( uFogNear, uFogFar, vDist ) ) * step( 0.3, vDist );
  if ( a <= 0.0 ) discard;
  gl_FragColor = vec4( uColor, a );
}
`;

export interface Ambience {
  group: THREE.Group;
  /** relógio (tempo da simulação), câmera e lanterna do quadro */
  update(t: number, cam: THREE.Camera, lantern: THREE.SpotLight): void;
}

/** camada C: billboards de névoa espalhados no pátio (fora dos muros) e poeira em volta da câmera */
export function createAmbience(rand: () => number): Ambience {
  const group = new THREE.Group();
  group.name = "camada-c";
  const fb = lc.fog_billboards;
  const [w, d] = cfg.map.size;
  const lerp = (r: readonly number[], u: number) => r[0] + (r[1] - r[0]) * u;

  const fogMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uDrift: { value: fb.drift }, uDriftSpeed: { value: fb.drift_speed }, uNearFade: { value: fb.near_fade },
      uColor: { value: paletteColor(fb.color) }, uOpacity: { value: fb.opacity },
    },
    vertexShader: FOG_VERTEX, fragmentShader: FOG_FRAGMENT,
  });
  keepAlphaBlending(fogMat);
  const plane = new THREE.PlaneGeometry(1, 1);
  const fogAttr = new Float32Array(fb.count * 3);
  const fog = new THREE.InstancedMesh(plane, fogMat, fb.count);
  const mtx = new THREE.Matrix4();
  let placed = 0;
  for (let i = 0; placed < fb.count && i < fb.count * 20; i++) {
    const x = (rand() - 0.5) * w, z = (rand() - 0.5) * d;
    if (insideWall(cfg, x, z)) continue;
    fog.setMatrixAt(placed, mtx.makeTranslation(x, lerp(fb.height, rand()), z));
    fogAttr.set([lerp(fb.size, rand()), rand() * Math.PI * 2, 0.5 + 0.5 * rand()], placed * 3);
    placed++;
  }
  fog.count = placed;
  plane.setAttribute("aFog", new THREE.InstancedBufferAttribute(fogAttr, 3));
  fog.frustumCulled = false;
  fog.renderOrder = 2;
  group.add(fog);

  const du = lc.dust;
  const pos = new Float32Array(du.count * 3), phase = new Float32Array(du.count);
  for (let i = 0; i < du.count; i++) { pos.set([rand(), rand(), rand()], i * 3); phase[i] = rand() * Math.PI * 2; }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  dustGeo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  const dustMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uBox: { value: du.box }, uFall: { value: du.fall }, uSway: { value: du.sway }, uSize: { value: du.size_px },
      uCam: { value: new THREE.Vector3() }, uLanternPos: { value: new THREE.Vector3() }, uLanternDir: { value: new THREE.Vector3(0, 0, -1) },
      uLanternCos: { value: 1 }, uLanternOn: { value: 0 },
      uColor: { value: paletteColor(du.color) }, uOpacity: { value: du.opacity }, uAmbient: { value: du.ambient },
      uFogNear: { value: rc.fog.near }, uFogFar: { value: rc.fog.far },
    },
    vertexShader: DUST_VERTEX, fragmentShader: DUST_FRAGMENT,
  });
  keepAlphaBlending(dustMat);
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  dust.renderOrder = 3;
  group.add(dust);

  const dir = new THREE.Vector3();
  return {
    group,
    update(t, cam, lantern) {
      fogMat.uniforms.uTime.value = t;
      const u = dustMat.uniforms;
      u.uTime.value = t;
      cam.getWorldPosition(u.uCam.value);
      u.uLanternOn.value = lantern.visible ? 1 : 0;
      u.uLanternPos.value.copy(lantern.position);
      u.uLanternDir.value.copy(dir.subVectors(lantern.target.position, lantern.position).normalize());
      u.uLanternCos.value = Math.cos(lantern.angle);
    },
  };
}

const sphere = new THREE.Sphere(), center = new THREE.Vector3();
/**
 * personagens projetam a sombra da lanterna só quando a esfera que os envolve (`layer_b.caster_radius`, centrada
 * a essa altura) cruza o frustum da sombra. Os muros o three.js já recorta; os personagens têm
 * frustumCulled = false (pose T, runtime.ts) e sem este recorte entram todos no passe de sombra
 */
export function cullShadowCasters(s: THREE.SpotLight, roots: readonly THREE.Object3D[]) {
  s.shadow.updateMatrices(s);
  const fr = s.shadow.getFrustum();
  for (const r of roots) {
    r.getWorldPosition(center);
    center.y += lb.caster_radius;
    sphere.set(center, lb.caster_radius);
    const on = r.visible && fr.intersectsSphere(sphere);
    r.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = on; });
  }
}
