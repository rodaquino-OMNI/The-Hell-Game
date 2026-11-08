// Parâmetros de URL de depuração da render e PRNG com semente do cliente.
//  ?seed=N        semente da partida e das texturas procedurais (capturas de referência reproduzíveis)
//  ?preset=low|medium|high   preset de resolução interna (padrão: render.default_preset)
//  ?ps1=0 | ?ps1=snap:0,dither:0.5   intensidades PS1 (padrão: render.ps1)
//  ?retro=1       MOCKUP do modo "Retro FPS" (D-13, D-14, D-15; marco A2b): 1ª pessoa com a ferramenta na mão,
//                 barra de estado inferior e Pátio industrial. Sem o parâmetro nada muda.
//  ?retro_class=curandeiro|mecanico|atacador|protetor|batedor   ferramenta e classe mostradas no mockup (Protetor
//                 e Batedor ainda não existem na simulação, fase 4: só a vista muda)
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

/** mockup do modo "Retro FPS" ligado (`?retro=1`; D-13, D-14) */
export const urlRetro: boolean = params.get("retro") === "1";

export const RETRO_CLASSES = ["curandeiro", "mecanico", "atacador", "protetor", "batedor"] as const;
export type RetroClass = (typeof RETRO_CLASSES)[number];
const retroClassRaw = params.get("retro_class");
/** classe da vista do mockup pedida na URL, ou indefinida (= classe da partida) */
export const urlRetroClass: RetroClass | undefined = (RETRO_CLASSES as readonly string[]).includes(retroClassRaw ?? "") ? (retroClassRaw as RetroClass) : undefined;
