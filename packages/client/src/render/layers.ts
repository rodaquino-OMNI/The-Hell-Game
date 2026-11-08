// Camadas visuais do GDD-v0.3 §10.2 (itens no GDD-v0.2 §10.2): qual camada está ativa por preset e o estado da
// camada A (pós no passe final de present.ts), com intensidade de 0 a 1 por efeito (menu de acessibilidade, V8)
// e a opção "reduzir flicker" (GDD-v0.3 §10.2 e §12.4: zera a aberração e atenua e congela o grão).
// Números em data/balance.yaml `render.layer_a`, `render.reduce_flicker`; cores por token de data/art/palette.json.
import * as THREE from "three";
import palette from "../../../../data/art/palette.json";
import { balance } from "../data.ts";
import type { PresetName } from "./present.ts";

export type Layer = "A" | "B" | "C";
export type LayerSet = Record<Layer, boolean>;
export type LayerAEffect = "grain" | "vignette" | "scanlines" | "aberration" | "bloom" | "lut";
export type LayerAIntensity = Record<LayerAEffect, number>;
export const LAYER_A_EFFECTS: readonly LayerAEffect[] = ["grain", "vignette", "scanlines", "aberration", "bloom", "lut"];

const la = balance.render.layer_a;
const rf = balance.render.reduce_flicker;
const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** cor linear de um token da paleta (rgb5 de 0 a 31, como no PS1; ColorManagement está desligado) */
export function paletteColor(token: string): THREE.Color {
  const t = (palette.tokens as Record<string, { rgb5: number[] } | undefined>)[token];
  if (!t) throw new Error(`token '${token}' fora de data/art/palette.json`);
  const [r, g, b] = t.rgb5.map(v => Math.round((v * 255) / 31) / 255);
  return new THREE.Color(r, g, b);
}

/** camadas ativas de um preset (`render.presets.<p>.layers`) */
export const presetLayers = (p: PresetName): LayerSet => {
  const l = balance.render.presets[p].layers as readonly string[];
  return { A: l.includes("A"), B: l.includes("B"), C: l.includes("C") };
};

interface LayerState {
  layers: LayerSet;
  /** intensidades escolhidas pelo jogador (0..1), antes da opção "reduzir flicker" */
  a: LayerAIntensity;
  reduceFlicker: boolean;
  /** pulso de dano forçado (capturas) ou null (vem do jogo) */
  damageOverride: number | null;
  /** relógio dos efeitos forçado (capturas) ou null (relógio da simulação) */
  timeOverride: number | null;
  /** semente do grão */
  seed: number;
}

const state: LayerState = {
  layers: presetLayers(balance.render.default_preset),
  a: { grain: la.grain, vignette: la.vignette, scanlines: la.scanlines, aberration: la.aberration, bloom: la.bloom, lut: la.lut },
  reduceFlicker: false,
  damageOverride: null,
  timeOverride: null,
  seed: 0,
};

/**
 * uniformes do passe final (present.ts). As intensidades efetivas já levam em conta a camada A ligada e a opção
 * "reduzir flicker"; com tudo em 0 o passe final copia o alvo sem alteração.
 */
export const postUniforms = {
  uGrain: { value: 0 },
  uGrainAmount: { value: la.grain_amount },
  uGrainFrame: { value: 0 },
  uGrainSeed: { value: 0 },
  uVignette: { value: 0 },
  uVignetteRadius: { value: new THREE.Vector2(...la.vignette_radius) },
  uVignetteAmount: { value: la.vignette_amount },
  uScanlines: { value: 0 },
  uScanlineAmount: { value: la.scanline_amount },
  /** aberração efetiva = intensidade × pulso de dano */
  uAberration: { value: 0 },
  uAberrationPx: { value: la.aberration_px },
  uBloom: { value: 0 },
  uBloomAmount: { value: la.bloom_amount },
  uLut: { value: 0 },
  tLut: { value: null as THREE.Data3DTexture | null },
  uLutSize: { value: la.lut_size },
};
/** pulso de dano atual (0..1), atualizado por `tickLayers` */
let damagePulse = 0;

function apply() {
  const on = state.layers.A ? 1 : 0, a = state.a, r = state.reduceFlicker;
  postUniforms.uGrain.value = on * a.grain * (r ? rf.grain : 1);
  postUniforms.uVignette.value = on * a.vignette;
  postUniforms.uScanlines.value = on * a.scanlines;
  postUniforms.uAberration.value = on * a.aberration * (r ? rf.aberration : 1) * damagePulse;
  postUniforms.uBloom.value = on * a.bloom;
  postUniforms.uLut.value = on * a.lut;
}

export const getLayers = (): LayerSet => ({ ...state.layers });
/** liga ou desliga camadas (o preset define o padrão; `setPreset` volta a ele) */
export function setLayers(l: Partial<LayerSet>) {
  state.layers = { ...state.layers, ...l };
  apply();
  for (const f of listeners) f(state.layers);
}
const listeners: ((l: LayerSet) => void)[] = [];
/** avisa quando as camadas mudam (camadas B e C ligam luz, sombra e malhas) */
export function onLayersChange(f: (l: LayerSet) => void) { listeners.push(f); }

export const getLayerA = (): LayerAIntensity => ({ ...state.a });
/** setter para o menu de opções (V8): intensidades da camada A; valores fora de 0..1 são limitados */
export function setLayerA(p: Partial<LayerAIntensity>) {
  for (const e of LAYER_A_EFFECTS) if (p[e] !== undefined) state.a[e] = clamp01(p[e]);
  apply();
}

export const getReduceFlicker = () => state.reduceFlicker;
/** opção de acessibilidade "reduzir flicker" (V8): zera a aberração e atenua e congela o grão */
export function setReduceFlicker(on: boolean) {
  state.reduceFlicker = on;
  apply();
}

/** semente do grão: fixa com `?seed=` (capturas determinísticas) */
export function setGrainSeed(seed: number) { state.seed = seed | 0; postUniforms.uGrainSeed.value = (seed >>> 0) % 65536; }

/** força o pulso de dano (0..1) e/ou o relógio dos efeitos; null devolve ao jogo (capturas de referência) */
export function setOverrides(o: { damage?: number | null; time?: number | null }) {
  if (o.damage !== undefined) state.damageOverride = o.damage === null ? null : clamp01(o.damage);
  if (o.time !== undefined) state.timeOverride = o.time;
}

/** relógio dos efeitos animados (grão, camada C): o da simulação, salvo override */
export const fxTime = (simT: number) => state.timeOverride ?? simT;

/**
 * atualiza o que depende do tempo, uma vez por quadro: quadro do grão (parado com "reduzir flicker") e o pulso de
 * aberração (`hitT` = instante do último dano no relógio da simulação, ou null).
 */
export function tickLayers(simT: number, hitT: number | null) {
  const t = fxTime(simT);
  postUniforms.uGrainFrame.value = state.reduceFlicker ? 0 : Math.floor(t * la.grain_fps);
  damagePulse = state.damageOverride ?? (hitT === null ? 0 : clamp01(1 - (simT - hitT) / la.aberration_time));
  apply();
}

/**
 * LUT 3D fria (GDD-v0.2 §10.2), gerada dos parâmetros `render.layer_a.lut_*`: saturação, ganho por canal e croma do
 * token `lut_tint` puxado nas sombras. Devolve RGBA8 de n³ (índice r + g·n + b·n²).
 */
export function buildColdLut(n: number, p: { tint: THREE.Color; tintAmount: number; pivot: number; gain: readonly number[]; saturation: number }): Uint8Array {
  const out = new Uint8Array(n * n * n * 4);
  // croma do token (sem a luminância), normalizado para o maior canal valer 1: `tintAmount` é o deslocamento máximo
  const tl = 0.299 * p.tint.r + 0.587 * p.tint.g + 0.114 * p.tint.b;
  const raw = [p.tint.r - tl, p.tint.g - tl, p.tint.b - tl];
  const m = Math.max(...raw.map(Math.abs));
  const chroma = raw.map(v => (m > 0 ? v / m : 0));
  const sat = (v: number) => Math.min(1, Math.max(0, v));
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const c = [r / (n - 1), g / (n - 1), b / (n - 1)];
    const L = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const shadow = 1 - Math.min(1, L / p.pivot);
    const i = (r + g * n + b * n * n) * 4;
    for (let k = 0; k < 3; k++) {
      const s = L + (c[k] - L) * p.saturation;
      out[i + k] = Math.round(sat(s * p.gain[k] + chroma[k] * shadow * p.tintAmount) * 255);
    }
    out[i + 3] = 255;
  }
  return out;
}

/** textura da LUT fria (filtro linear: interpolação trilinear no passe final) */
export function coldLutTexture(): THREE.Data3DTexture {
  const n = la.lut_size;
  const tex = new THREE.Data3DTexture(buildColdLut(n, {
    tint: paletteColor(la.lut_tint), tintAmount: la.lut_tint_amount, pivot: la.lut_shadow_pivot, gain: la.lut_gain, saturation: la.lut_saturation,
  }), n, n, n);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

apply();
