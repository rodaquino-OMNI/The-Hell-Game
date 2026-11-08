// Material PS1 (GDD-v0.3 §10.1): um único shader para cenário e personagens, com intensidade de 0 a 1 por efeito.
//  - snap: posição arredondada em espaço de tela numa grade de 1/snap_grid da largura (células quadradas);
//  - affine: UV interpolado sem correção de perspectiva (truque uv·w / w), misturado ao correto pela intensidade;
//  - gouraud: iluminação calculada por vértice (C-12), misturada à iluminação por fragmento (aparência da fase 0);
//  - névoa: a mesma do three.js (`THREE.Fog`, chunk fog_fragment), para preservar a aparência atual.
// Com todas as intensidades em 0, o resultado reproduz o MeshLambertMaterial com flatShading / MeshBasicMaterial.
// O dither Bayer 4×4 e a quantização de cor ficam no passe final (present.ts).
// Camada B (GDD-v0.3 §10.2): lanterna (SpotLight) com sombra lida do shadow map e luz assada por vértice (ps1Bake).
// Camada A: o alfa do alvo leva a máscara de emissivo (0 = emissivo) para o bloom do passe final.
// Skinning: chunks do three.js no vértice (inertes sem USE_SKINNING), para os personagens do V2.
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
  /** camada B (GDD-v0.3 §10.2): 1 aplica a luz assada nos vértices (atributo ps1Bake), 0 a ignora */
  uBake: { value: 0 },
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
uniform float uBake;
uniform float uEmissive;
uniform vec2 uRes;
uniform vec2 uRepeat;
varying vec2 vUvP;     // UV com correção de perspectiva
varying vec3 vUvA;     // (uv·w, w): dividido no fragmento dá UV afim
varying vec3 vViewPosition;
#ifdef PS1_LIT
varying vec3 vLight;   // irradiância por vértice (Gouraud): ambiente (com oclusão assada), luz assada e luzes pontuais
varying float vBakeAo;    // oclusão assada (camada B), interpolada para o caminho por fragmento
varying vec3 vBakeLight;  // luz assada (camada B)
#if NUM_SPOT_LIGHTS > 0
varying vec3 vSpot;    // lanterna por vértice, sem sombra (a sombra entra por fragmento)
#endif
#endif
`;

const LIGHT_GLSL = /* glsl */ `
#ifdef PS1_LIT
// mesma soma do Lambert do three.js: ambiente + luzes pontuais com dotNL e atenuação por distância.
// Camada B (GDD-v0.3 §10.2): a oclusão assada (ao) multiplica o ambiente e a luz assada (bake) soma; com uBake = 0
// as duas são neutras e o resultado é o do V1.
vec3 ps1Irradiance( const in vec3 geometryPosition, const in vec3 n, const in float ao, const in vec3 bake ) {
  vec3 irradiance = getAmbientLightIrradiance( ambientLightColor ) * mix( 1.0, ao, uBake ) + bake * uBake;
  #if NUM_POINT_LIGHTS > 0
  IncidentLight directLight;
  for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
    getPointLightInfo( pointLights[ i ], geometryPosition, directLight );
    irradiance += saturate( dot( n, directLight.direction ) ) * directLight.color;
  }
  #endif
  return irradiance;
}
#if NUM_SPOT_LIGHTS > 0
// lanterna do jogador (camada B): cone e atenuação do SpotLight do three.js
vec3 ps1Spot( const in vec3 geometryPosition, const in vec3 n ) {
  IncidentLight spot;
  getSpotLightInfo( spotLights[ 0 ], geometryPosition, spot );
  return saturate( dot( n, spot.direction ) ) * spot.color;
}
#endif
#endif
`;

const VERTEX = /* glsl */ `
#include <common>
#ifdef PS1_LIT
#include <lights_pars_begin>
#include <shadowmap_pars_vertex>
#endif
#include <skinning_pars_vertex>
#include <fog_pars_vertex>
${SHARED_GLSL}
${LIGHT_GLSL}
#ifdef PS1_BAKE
attribute vec4 ps1Bake;  // rgb = luz assada, a = oclusão (camada B)
#endif
void main() {
  // skinning do three.js (personagens do V2); sem USE_SKINNING os chunks não fazem nada
  vec3 transformed = vec3( position );
  vec3 objectNormal = vec3( normal );
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
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
  vec3 transformedNormal = normalMatrix * objectNormal;
  vec3 n = normalize( transformedNormal );
  #ifdef PS1_BAKE
  vBakeAo = ps1Bake.a;
  vBakeLight = ps1Bake.rgb;
  #else
  vBakeAo = 1.0;
  vBakeLight = vec3( 0.0 );
  #endif
  vLight = ps1Irradiance( mvPosition.xyz, n, vBakeAo, vBakeLight );
  #if NUM_SPOT_LIGHTS > 0
  vSpot = ps1Spot( mvPosition.xyz, n );
  #endif
  // coordenadas da sombra da lanterna (chunk do three.js)
  vec4 worldPosition = modelMatrix * vec4( transformed, 1.0 );
  #include <shadowmap_vertex>
#endif
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <packing>
#ifdef PS1_LIT
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
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
  vec3 perVertex = vLight;
  #if NUM_SPOT_LIGHTS > 0
  // sombra da lanterna: shadow map de render.shadow_map px, filtro nearest (pixelado), por fragmento
  float shadow = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
  if ( receiveShadow ) shadow = getShadow( spotShadowMap[ 0 ], spotLightShadows[ 0 ].shadowMapSize, spotLightShadows[ 0 ].shadowIntensity, spotLightShadows[ 0 ].shadowBias, spotLightShadows[ 0 ].shadowRadius, vSpotLightCoord[ 0 ] );
  #endif
  perVertex += vSpot * shadow;
  #endif
  // caminho por fragmento só quando entra na mistura: com uGouraud = 1 (padrão) mix devolve perVertex exato e o
  // laço de luzes por fragmento não roda (uniforme: o desvio é o mesmo para todos os fragmentos)
  vec3 perFragment = perVertex;
  if ( uGouraud < 1.0 ) {
    perFragment = ps1Irradiance( - vViewPosition, faceNormal, vBakeAo, vBakeLight );
    #if NUM_SPOT_LIGHTS > 0
    perFragment += ps1Spot( - vViewPosition, faceNormal ) * shadow;
    #endif
  }
  outgoing = mix( perFragment, perVertex, uGouraud ) * BRDF_Lambert( diffuseColor.rgb );
#endif
  // alfa = máscara de emissivo para o bloom da camada A (0 = emissivo); o passe final escreve alfa 1 na tela
  gl_FragColor = vec4( outgoing, 1.0 - uEmissive );
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
  /**
   * emissivo (olhos, lanterna, feixes, lâmpadas): entra no bloom da camada A. Padrão: chapado e sem névoa
   * (a convenção dos emissivos do V1 e do V2)
   */
  emissive?: boolean;
  /** geometria com o atributo `ps1Bake` (luz assada da camada B: rgb = luz, a = oclusão) */
  baked?: boolean;
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
        uEmissive: { value: (p.emissive ?? (!lit && p.fog === false)) ? 1 : 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      defines: { ...(lit ? { PS1_LIT: "" } : {}), ...(p.map ? { PS1_MAP: "" } : {}), ...(lit && p.baked ? { PS1_BAKE: "" } : {}) },
      lights: lit,
      fog: p.fog ?? true,
      wireframe: p.wireframe ?? false,
    });
  }
  /** cor base (mesma API do MeshBasicMaterial/MeshLambertMaterial: `material.color.set(...)`) */
  get color(): THREE.Color { return this.uniforms.diffuse.value as THREE.Color; }
}
