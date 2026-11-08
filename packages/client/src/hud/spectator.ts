// Espectador (GDD-v0.3 §3.3 item 4; GDD-v0.2 §3.2): no v1 a partida continua depois que o jogador morre (ou escapa);
// a câmera passa a seguir um aliado ainda em jogo e o jogador pode trocar de aliado. No protótipo a partida acaba
// na hora, então este modo nunca aparece (comportamento da fase 0 preservado).
import type { GameState, Survivor } from "@thehell/sim";

let target = -1;

const inPlay = (s: Survivor) => s.st === "ok" || s.st === "cage";

/** o jogador local está fora de jogo e a partida continua */
export const isSpectating = (G: GameState) => !G.over && !inPlay(G.survivors[0]);

/** aliado seguido: o atual se ainda está em jogo, senão o primeiro em jogo (null se não há nenhum) */
export function spectatorTarget(G: GameState): Survivor | null {
  const cur = G.survivors.find(s => s.id === target && s.id !== 0 && inPlay(s));
  if (cur) return cur;
  const next = G.survivors.find(s => s.id !== 0 && inPlay(s)) ?? null;
  target = next ? next.id : -1;
  return next;
}

/** passa para o próximo aliado em jogo (em ordem de id, circular) */
export function nextSpectatorTarget(G: GameState): Survivor | null {
  const allies = G.survivors.filter(s => s.id !== 0 && inPlay(s));
  if (!allies.length) { target = -1; return null; }
  const i = allies.findIndex(s => s.id === target);
  target = allies[(i + 1) % allies.length].id;
  return allies[(i + 1) % allies.length];
}

export function resetSpectator() { target = -1; }
