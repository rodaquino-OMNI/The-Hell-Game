// Parâmetros de URL de depuração da render e PRNG com semente do cliente.
//  ?seed=N        semente da partida e das texturas procedurais (capturas de referência reproduzíveis)
//  ?preset=low|medium|high   preset de resolução interna (padrão: render.default_preset)
//  ?ps1=0 | ?ps1=snap:0,dither:0.5   intensidades PS1 (padrão: render.ps1)
// Sem `?seed`, a partida e as texturas continuam aleatórias como na fase 0.
import { nextRandom } from "@thehell/sim";
import { balance } from "../data.ts";
import type { PresetName } from "./present.ts";
import { parsePs1Param, type Ps1Intensity } from "./ps1.ts";

const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);

const seedRaw = params.get("seed");
/** semente fixa vinda da URL, ou indefinida */
export const urlSeed: number | undefined = seedRaw !== null && /^-?\d+$/.test(seedRaw) ? Number(seedRaw) | 0 : undefined;

const presetRaw = params.get("preset");
/** preset pedido na URL, ou o padrão de data/balance.yaml */
export const urlPreset: PresetName = presetRaw !== null && presetRaw in balance.render.presets ? (presetRaw as PresetName) : balance.render.default_preset;

/** intensidades PS1 pedidas na URL (vazio sem o parâmetro) */
export const urlPs1: Partial<Ps1Intensity> = parsePs1Param(params.get("ps1"));

/**
 * Gerador de números em [0, 1): com `?seed`, PRNG mulberry32 do sim (rng.ts) com semente derivada de `salt`
 * (fluxos independentes entre si e da partida); sem semente, `Math.random` (comportamento da fase 0).
 */
export function clientRandom(salt: number): () => number {
  if (urlSeed === undefined) return Math.random;
  const state = { seed: (urlSeed ^ Math.imul(salt, 0x9e3779b1)) | 0 };
  return () => nextRandom(state);
}
