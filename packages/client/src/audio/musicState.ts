// Estado musical (item A-2 do V5; GDD-v0.3 §11 e GDD-v0.2 §11): qual dos 5 stems toca para um jogador. Função pura
// sobre o GameState, para o laço do cliente e, na fase 3, para o servidor (que mandará o sinal de perseguição).
// Prioridade (docs/handoff/plano-audio-v5.md §1): pressão final > perseguição > resgate > tensão > ambiente.
import type { Balance } from "@thehell/shared";
import type { GameState, HunterMode } from "@thehell/sim";

export const MUSIC_STATES = ["ambient", "tension", "chase", "final_pressure", "rescue"] as const;
export type MusicState = (typeof MUSIC_STATES)[number];
export type MusicStateCfg = Pick<Balance["audio"]["music"], "tension_radius">;

/**
 * Modos da IA do R3 que contam como perseguição: Perseguir e Atacar (o golpe é parte da perseguição; o sim usa a
 * velocidade de perseguição nos dois, packages/sim/src/ai/hunter.ts L350).
 */
const CHASE_MODES: readonly HunterMode[] = ["chase", "attack"];

/**
 * Pressão final: o portão começou a contagem ou já abriu. Fonte: GDD-v0.2 §3.1 item 3 ("todos os geradores prontos;
 * o portão abre") e o próprio sim, que marca `Percept.finalPressure = g.gateStarted` (packages/sim/src/ai/percept.ts
 * L37) e aplica o ×1,2 da pressão final com `gateStarted` (packages/sim/src/game.ts L320).
 */
export const isFinalPressure = (g: GameState) => g.gateStarted || g.gateOpen;

/**
 * Perseguição: o caçador tem este jogador como alvo (`hunter.target`, exposto ao cliente; types.ts) e está
 * perseguindo. Com a IA do R3 (`hunter.ai`), o modo tem de ser `chase` ou `attack`; com o caçador básico (protótipo e
 * R1, sem `ai`), ter alvo já é perseguir (game.ts L320 e L384: velocidade de perseguição sempre que há alvo).
 * GDD-v0.3 §11: "perseguição quando o servidor marca o jogador como alvo em perseguição".
 */
export function isChased(g: GameState, playerId: number): boolean {
  const h = g.hunter;
  if (h.target !== playerId) return false;
  return h.ai ? CHASE_MODES.includes(h.ai.mode) : true;
}

/**
 * Resgate: algum sobrevivente está preso na gaiola (`st === "cage"`), o que inclui o próprio jogador esperando
 * resgate e cobre o jogador resgatando (só se resgata quem está preso, game.ts L492). LACUNA: o GDD (v0.2 §11, v0.3
 * §11) só lista o stem "resgate", sem dizer quando toca. Proposta: tocar enquanto houver alguém preso, porque é a
 * janela em que o time decide resgatar (GDD-v0.2 §3.2 e §4.3); decisão do Rodrigo pendente.
 */
export const anyCaged = (g: GameState) => g.survivors.some(s => s.st === "cage");

/** Tensão: caçador a menos de `audio.music.tension_radius` do jogador (GDD-v0.3 §11: "< 25 m"; distância no plano xz) */
export function hunterNear(g: GameState, playerId: number, cfg: MusicStateCfg): boolean {
  const p = g.survivors.find(s => s.id === playerId);
  if (!p) return false;
  return Math.hypot(g.hunter.x - p.x, g.hunter.z - p.z) < cfg.tension_radius;
}

/** estado musical do jogador `playerId`; pura (só lê o estado) */
export function musicStateFor(state: GameState, playerId: number, cfg: MusicStateCfg): MusicState {
  if (isFinalPressure(state)) return "final_pressure";
  if (isChased(state, playerId)) return "chase";
  if (anyCaged(state)) return "rescue";
  if (hunterNear(state, playerId, cfg)) return "tension";
  return "ambient";
}
