// Estado musical (item A-2 do V5; GDD-v0.3 §11 e GDD-v0.2 §11): qual dos 5 stems toca para um jogador. Função pura
// sobre o GameState, para o laço do cliente e, na fase 3, para o servidor (que mandará o sinal de perseguição).
// Prioridade (docs/handoff/plano-audio-v5.md §1): pressão final > perseguição > resgate > tensão > ambiente.
// No Treino (modo tutorial), estado fixo `audio.music.tutorial_state`.
import type { Balance } from "@thehell/shared";
import type { GameState, HunterMode } from "@thehell/sim";

export const MUSIC_STATES = ["ambient", "tension", "chase", "final_pressure", "rescue"] as const;
export type MusicState = (typeof MUSIC_STATES)[number];
export type MusicStateCfg = Pick<Balance["audio"]["music"], "tension_radius" | "tutorial_state">;

/**
 * Modos da IA do R3 que contam como perseguição: Perseguir, Atacar e Recuo. O golpe é parte da perseguição (o sim usa
 * a velocidade de perseguição em chase e attack, packages/sim/src/ai/hunter.ts L350), e o recuo de 0,6 s depois de um
 * golpe sem captura volta a Perseguir (HUNTER_TRANSITIONS, ai/hunter.ts L24–L25; L328–L331). Com captura, o alvo
 * já está na gaiola e deixa de estar "em jogo" (ver `inPlay`).
 */
const CHASE_MODES: readonly HunterMode[] = ["chase", "attack", "recoil"];

/**
 * Pressão final: o portão começou a contagem ou já abriu. Fonte: GDD-v0.2 §3.1 item 3 ("todos os geradores prontos;
 * o portão abre") e o próprio sim, que marca `Percept.finalPressure = g.gateStarted` (packages/sim/src/ai/percept.ts
 * L37) e aplica o ×1,2 da pressão final com `gateStarted` (packages/sim/src/game.ts L320).
 */
export const isFinalPressure = (g: GameState) => g.gateStarted || g.gateOpen;

/**
 * Sobrevivente `playerId` existe e está em jogo (`st === "ok"`). Perseguição e tensão só valem para ele.
 * - O caçador básico não reatribui `hunter.target` quando ninguém está livre (game.ts L302 no protótipo e L345 no
 *   v1 retornam antes), então o alvo pode ficar velho e apontar para alguém preso ou morto.
 * - Jogador fora de jogo (preso, morto ou escapado): sem tensão nem perseguição para ele; pressão final continua
 *   valendo para todos e resgate também (aliado ou ele próprio preso). D-27, docs/plano-construcao.md §7 (o
 *   GDD-v0.3 §11 não trata o caso).
 */
export const inPlay = (g: GameState, playerId: number) => g.survivors.some(s => s.id === playerId && s.st === "ok");

/**
 * Perseguição: o jogador está em jogo, o caçador o tem como alvo (`hunter.target`, exposto ao cliente; types.ts) e
 * está perseguindo. Com a IA do R3 (`hunter.ai`), o modo tem de estar em `CHASE_MODES`; com o caçador básico
 * (protótipo e R1, sem `ai`), ter alvo já é perseguir (game.ts L320 e L384: velocidade de perseguição sempre que há
 * alvo). GDD-v0.3 §11: "perseguição quando o servidor marca o jogador como alvo em perseguição".
 */
export function isChased(g: GameState, playerId: number): boolean {
  const h = g.hunter;
  if (h.target !== playerId || !inPlay(g, playerId)) return false;
  return h.ai ? CHASE_MODES.includes(h.ai.mode) : true;
}

/**
 * Resgate: algum sobrevivente está preso na gaiola (`st === "cage"`), o que inclui o próprio jogador esperando
 * resgate e cobre o jogador resgatando (só se resgata quem está preso, game.ts L492). O GDD (v0.2 §11, v0.3
 * §11) só lista o stem "resgate", sem dizer quando toca; D-26 (docs/plano-construcao.md §7): toca enquanto houver
 * alguém preso, porque é a janela em que o time decide resgatar (GDD-v0.2 §3.2 e §4.3).
 */
export const anyCaged = (g: GameState) => g.survivors.some(s => s.st === "cage");

/** Tensão: jogador em jogo e caçador a menos de `audio.music.tension_radius` do jogador (GDD-v0.3 §11: "< 25 m"; distância no plano xz) */
export function hunterNear(g: GameState, playerId: number, cfg: MusicStateCfg): boolean {
  const p = g.survivors.find(s => s.id === playerId);
  if (!p || p.st !== "ok") return false; // fora de jogo: sem tensão (ver `inPlay`)
  return Math.hypot(g.hunter.x - p.x, g.hunter.z - p.z) < cfg.tension_radius;
}

/** estado musical do jogador `playerId`; pura (só lê o estado) */
export function musicStateFor(state: GameState, playerId: number, cfg: MusicStateCfg): MusicState {
  // Treino (V6, D-34): estado fixo `audio.music.tutorial_state` (ambiente) do começo ao fim; o aliado nasce preso e as
  // regras abaixo dariam `rescue` desde o 1º segundo. Só a música muda: telegraph, efeitos e legendas seguem iguais
  if (state.tutorial) return cfg.tutorial_state;
  if (isFinalPressure(state)) return "final_pressure";
  if (isChased(state, playerId)) return "chase";
  if (anyCaged(state)) return "rescue";
  if (hunterNear(state, playerId, cfg)) return "tension";
  return "ambient";
}
