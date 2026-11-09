// Parâmetros de URL de depuração da render e PRNG com semente do cliente.
//  ?seed=N        semente da partida e das texturas procedurais (capturas de referência reproduzíveis)
//  ?preset=low|medium|high   preset de resolução interna (padrão: render.default_preset)
//  ?ps1=0 | ?ps1=snap:0,dither:0.5   intensidades PS1 (padrão: render.ps1)
//  ?retro=1       (só com ?debug=1, D-33) modo "Retro FPS" (V9; D-13, D-14, D-15) sem passar pelo menu: 1ª pessoa com
//                 a ferramenta na mão, barra de estado fina e Pátio industrial. O caminho do jogador é a opção do menu
//                 (Opções > Visual PS1; render/retro/mode.ts). Sem o parâmetro nada muda.
//  ?retro_class=curandeiro|mecanico|atacador|protetor|batedor   (só com ?debug=1) ferramenta e classe mostradas no
//                 modo (Protetor e Batedor ainda não existem na simulação, fase 4: só a vista muda)
//  ?stress=1      cena de pior caso dos orçamentos de render (V7, GDD-v0.3 §10.6; render/stress.ts): 6 personagens
//                 das 5 classes, mapa inteiro visível, camadas do preset. A simulação fica parada; combina com
//                 ?preset e ?retro=1
//  ?debug=1       ganchos globais `window.__thehell*` das ferramentas de teste (src/debug-hooks.ts, D-33); sem ele não existem
// Sem `?seed`, a partida e as texturas continuam aleatórias como na fase 0.
import { nextRandom } from "@thehell/sim";
import { balance } from "../data.ts";
import { debugEnabled } from "../debug-hooks.ts";
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

export const RETRO_CLASSES = ["curandeiro", "mecanico", "atacador", "protetor", "batedor"] as const;
export type RetroClass = (typeof RETRO_CLASSES)[number];

/**
 * parâmetros de depuração do modo Retro FPS na query dada: `?retro=1` e `?retro_class=` só valem com `?debug=1`
 * (D-33: o jogador liga o modo pelo menu). Exportada para o teste (packages/client/test/retro-mode.test.ts).
 */
export function parseRetroParams(search: string): { retro: boolean; cls: RetroClass | undefined } {
  if (!debugEnabled(search)) return { retro: false, cls: undefined };
  const q = new URLSearchParams(search), raw = q.get("retro_class");
  return { retro: q.get("retro") === "1", cls: (RETRO_CLASSES as readonly string[]).includes(raw ?? "") ? (raw as RetroClass) : undefined };
}
const retroParams = parseRetroParams(typeof location === "undefined" ? "" : location.search);
/** modo "Retro FPS" ligado pela URL de depuração (`?debug=1&retro=1`); o estado efetivo é `retroMode()` (retro/mode.ts) */
export const urlRetro: boolean = retroParams.retro;
/** classe da vista do modo pedida na URL de depuração, ou indefinida (= classe da partida) */
export const urlRetroClass: RetroClass | undefined = retroParams.cls;

/** cena de pior caso dos orçamentos de render (`?stress=1`; V7) */
export const urlStress: boolean = params.get("stress") === "1";
