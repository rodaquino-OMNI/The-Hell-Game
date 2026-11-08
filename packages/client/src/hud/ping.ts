// Pings (GDD v0.3 §12.1; GDD-v0.2 §12.1): 4 tipos (`ui.ping_types`), recarga `ui.ping_cooldown` por jogador e
// visíveis por `ui.ping_lifetime`. Lógica pura, com o relógio da simulação (G.t). Cada jogador tem no máximo um
// ping ativo: o novo substitui o anterior.
// No single-player atual o ping aparece só para o jogador; os bots ainda não reagem (a reação com atraso
// `ai.bots.ping_reaction` é do item R4).

export interface PingUi { ping_types: readonly string[]; ping_cooldown: number; ping_lifetime: number }
export interface Ping { type: string; from: number; x: number; z: number; t: number }
export interface PingState { last: Map<number, number>; active: Ping[] }

export const newPingState = (): PingState => ({ last: new Map(), active: [] });

/** segundos até o jogador `from` poder pingar de novo (0 = pronto) */
export function pingRemaining(s: PingState, from: number, now: number, ui: PingUi): number {
  const last = s.last.get(from);
  return last === undefined ? 0 : Math.max(0, last + ui.ping_cooldown - now);
}

/** tenta registrar o ping; devolve false se o tipo não existe ou se a recarga não acabou */
export function tryPing(s: PingState, now: number, ui: PingUi, ping: Omit<Ping, "t">): boolean {
  if (!ui.ping_types.includes(ping.type)) return false;
  if (pingRemaining(s, ping.from, now, ui) > 0) return false;
  s.last.set(ping.from, now);
  s.active = s.active.filter(p => p.from !== ping.from);
  s.active.push({ ...ping, t: now });
  return true;
}

/** remove os pings vencidos */
export function prunePings(s: PingState, now: number, ui: PingUi) {
  s.active = s.active.filter(p => now - p.t < ui.ping_lifetime);
}
