// Material PS1 (GDD-v0.3 §10.1): um único shader para cenário e personagens, com intensidade de 0 a 1 por efeito.
//  - snap: posição arredondada em espaço de tela numa grade de 1/snap_grid da largura (células quadradas);
//  - affine: UV interpolado sem correção de perspectiva (truque uv·w / w), misturado ao correto pela intensidade;
//  - gouraud: iluminação calculada por vértice (C-12), misturada à iluminação por fragmento (aparência da fase 0);
//  - névoa: a mesma do three.js (`THREE.Fog`, chunk fog_fragment), para preservar a aparência atual.
// Com todas as intensidades em 0, o resultado reproduz o MeshLambertMaterial com flatShading / MeshBasicMaterial.
// O dither Bayer 4×4 e a quantização de cor ficam no passe final (present.ts).
import * as THREE from "three";
import { balance } from "../data.ts";

export type Ps1Effect = "snap" | "affine" | "gouraud" | "dither";
export type Ps1Intensity = Record<Ps1Effect, number>;
export const PS1_EFFECTS: readonly Ps1Effect[] = ["snap", "affine", "gouraud", "dither"];

const cfg = balance.render.ps1;

/** uniformes compartilhados por todos os materiais PS1 (mesmo objeto: mudar aqui muda todos) */
export const ps1Uniforms = {
  uSnap: { value: cfg.snap },
  uSnapGrid: { value: cfg.snap_grid },
  uAffine: { value: cfg.affine },
  uGouraud: { value: cfg.gouraud },
  /** resolução interna do preset atual (largura, altura) */
  uRes: { value: new THREE.Vector2(...balance.render.presets[balance.render.default_preset].internal) },
};
/** intensidade do dither (lida pelo passe final) */
export const ditherUniform = { value: cfg.dither };

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** intensidades atuais de cada efeito (0 a 1) */
export function getPs1(): Ps1Intensity {
  return { snap: ps1Uniforms.uSnap.value, affine: ps1Uniforms.uAffine.value, gouraud: ps1Uniforms.uGouraud.value, dither: ditherUniform.value };
}

/** setter para o menu de opções (V8): ajusta uma ou mais intensidades; valores fora de 0..1 são limitados */
export function setPs1(p: Partial<Ps1Intensity>) {
  if (p.snap !== undefined) ps1Uniforms.uSnap.value = clamp01(p.snap);
  if (p.affine !== undefined) ps1Uniforms.uAffine.value = clamp01(p.affine);
  if (p.gouraud !== undefined) ps1Uniforms.uGouraud.value = clamp01(p.gouraud);
  if (p.dither !== undefined) ditherUniform.value = clamp01(p.dither);
}

/**
 * Parâmetro de URL de depuração `?ps1=`: `0` ou `1` (todos os efeitos) ou lista `snap:0,dither:0.5`.
 * Sem o parâmetro, valem as intensidades de data/balance.yaml.
 */
export function parsePs1Param(raw: string | null): Partial<Ps1Intensity> {
  if (raw === null || raw === "") return {};
  const out: Partial<Ps1Intensity> = {};
  if (!raw.includes(":")) {
    const v = Number(raw);
    if (Number.isFinite(v)) for (const e of PS1_EFFECTS) out[e] = v;
    return out;
  }
  for (const part of raw.split(",")) {
    const [k, v] = part.split(":");
    if ((PS1_EFFECTS as readonly string[]).includes(k) && Number.isFinite(Number(v))) out[k as Ps1Effect] = Number(v);
  }
  return out;
}

const SHARED_GLSL = /* glsl */ `
uniform vec3 diffuse;
uniform float opacity;
uniform float uSnap;
uniform float uSnapGrid;
uniform float uAffine;
uniform float uGouraud;
uniform vec2 uRes;
uniform vec2 uRepeat;
varying vec2 vUvP;     // UV com correção de perspectiva
varying vec3 vUvA;     // (uv·w, w): dividido no fragmento dá UV afim
varying vec3 vViewPosition;
#ifdef PS1_LIT
varying vec3 vLight;   // irradiância por vértice (Gouraud)
#endif
`;

const LIGHT_GLSL = /* glsl */ `
#ifdef PS1_LIT
// mesma soma do Lambert do three.js: ambiente + luzes pontuais com dotNL e atenuação por distância
vec3 ps1Irradiance( const in vec3 geometryPosition, const in vec3 n ) {
  vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
  #if NUM_POINT_LIGHTS > 0
  IncidentLight directLight;
  for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
    getPointLightInfo( pointLights[ i ], geometryPosition, directLight );
    irradiance += saturate( dot( n, directLight.direction ) ) * directLight.color;
  }
  #endif
  return irradiance;
}
#endif
`;

const VERTEX = /* glsl */ `
#include <common>
#ifdef PS1_LIT
#include <lights_pars_begin>
#endif
#include <fog_pars_vertex>
${SHARED_GLSL}
${LIGHT_GLSL}
void main() {
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  vViewPosition = - mvPosition.xyz;
  vec4 clip = projectionMatrix * mvPosition;
  // vertex snapping em espaço de tela: grade de uSnapGrid células na largura, células quadradas
  if ( clip.w > 0.0 ) {
    vec2 grid = vec2( uSnapGrid, uSnapGrid * uRes.y / uRes.x ) * 0.5;
    vec2 ndc = clip.xy / clip.w;
    vec2 snapped = floor( ndc * grid + 0.5 ) / grid;
    clip.xy = mix( ndc, snapped, uSnap ) * clip.w;
  }
  gl_Position = clip;
  vec2 uvT = uv * uRepeat;
  vUvP = uvT;
  vUvA = vec3( uvT * clip.w, clip.w );
#ifdef PS1_LIT
  vec3 n = normalize( normalMatrix * normal );
  vLight = ps1Irradiance( mvPosition.xyz, n );
#endif
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#ifdef PS1_LIT
#include <lights_pars_begin>
#endif
#include <fog_pars_fragment>
${SHARED_GLSL}
${LIGHT_GLSL}
#ifdef PS1_MAP
uniform sampler2D tMap;
#endif
void main() {
  vec4 diffuseColor = vec4( diffuse, opacity );
#ifdef PS1_MAP
  vec2 uvMap = mix( vUvP, vUvA.xy / vUvA.z, uAffine );
  diffuseColor *= texture2D( tMap, uvMap );
#endif
  vec3 outgoing = diffuseColor.rgb;
#ifdef PS1_LIT
  // normal da face (flatShading do three.js) para a iluminação por fragmento
  vec3 fdx = dFdx( vViewPosition );
  vec3 fdy = dFdy( vViewPosition );
  vec3 faceNormal = normalize( cross( fdx, fdy ) );
  vec3 perFragment = ps1Irradiance( - vViewPosition, faceNormal );
  outgoing = mix( perFragment, vLight, uGouraud ) * BRDF_Lambert( diffuseColor.rgb );
#endif
  gl_FragColor = vec4( outgoing, diffuseColor.a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export interface Ps1MaterialParams {
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture;
  /** iluminado (Lambert/Gouraud) ou chapado (como MeshBasicMaterial) */
  lit?: boolean;
  fog?: boolean;
  wireframe?: boolean;
}

/** material PS1: substitui MeshLambertMaterial (lit) e MeshBasicMaterial (chapado) em todo o cenário */
export class Ps1Material extends THREE.ShaderMaterial {
  readonly isPs1Material = true;
  constructor(p: Ps1MaterialParams = {}) {
    const lit = p.lit ?? true;
    super({
      uniforms: {
        ...THREE.UniformsUtils.merge([THREE.UniformsLib.common, THREE.UniformsLib.fog, lit ? THREE.UniformsLib.lights : {}]),
        ...ps1Uniforms,
        diffuse: { value: new THREE.Color(p.color ?? 0xffffff) },
        opacity: { value: 1 },
        tMap: { value: p.map ?? null },
        uRepeat: { value: p.map ? p.map.repeat.clone() : new THREE.Vector2(1, 1) },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      defines: { ...(lit ? { PS1_LIT: "" } : {}), ...(p.map ? { PS1_MAP: "" } : {}) },
      lights: lit,
      fog: p.fog ?? true,
      wireframe: p.wireframe ?? false,
    });
  }
  /** cor base (mesma API do MeshBasicMaterial/MeshLambertMaterial: `material.color.set(...)`) */
  get color(): THREE.Color { return this.uniforms.diffuse.value as THREE.Color; }
}
