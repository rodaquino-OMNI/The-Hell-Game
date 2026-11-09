// Pontuação por evento (item R6; GDD-v0.2 §7.1–§7.3, GDD-v0.3 D-04). Valores, categorias e chaves liga/desliga vêm de
// `points.*` em data/balance.yaml. Os eventos novos (resgate, cura, bloqueio/parafuso, atordoar, perseguição, armadilha,
// escapar e os do caçador) só existem no ruleset v1; no protótipo só pontuam os quebra-cabeças do jogador (paridade).
import type { SimConfig } from "./config.ts";
import {
  SCORE_CATEGORIES, type GameState, type HunterPointEvent, type Score, type ScoreTrack, type Survivor, type SurvivorPointEvent,
  type Vec,
} from "./types.ts";

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);

export const newScore = (): Score => Object.fromEntries(SCORE_CATEGORIES.map(c => [c, 0])) as Score;
export const newScoreTrack = (): ScoreTrack => ({ chase: null, revealHit: [] });
export const scoreTotal = (s: Score) => SCORE_CATEGORIES.reduce((n, c) => n + s[c], 0);

/** valor × multiplicador da dificuldade (§7.3), arredondado por `points.rounding` (LACUNA §7.1 × §7.3): sempre inteiro */
export function scaledPoints(cfg: SimConfig, value: number): number {
  const v = value * cfg.pointsMult;
  return cfg.balance.points.rounding === "floor" ? Math.floor(v) : Math.round(v);
}

/** credita `ev` a `s` (categoria do evento); o jogador (id 0) também soma em `g.points`. Devolve o valor (0 se desligado). */
export function credit(cfg: SimConfig, g: GameState, s: Survivor, ev: SurvivorPointEvent): number {
  const e = cfg.balance.points.events[ev];
  if (!e.enabled) return 0;
  const value = scaledPoints(cfg, e.value);
  s.score[e.category] += value;
  if (s.id === 0) g.points += value;
  if (cfg.v1) g.events.push({ type: "points", who: s.id, event: ev, value, category: e.category });
  return value;
}

/** credita `ev` ao caçador (só no v1) */
export function creditHunter(cfg: SimConfig, g: GameState, ev: HunterPointEvent): number {
  const e = cfg.balance.points.hunter_events[ev];
  if (!cfg.v1 || !e.enabled) return 0;
  const value = scaledPoints(cfg, e.value);
  g.hunterPoints += value;
  g.events.push({ type: "points", who: -1, event: ev, value, category: "hunter" });
  return value;
}

/** cura do Curandeiro: pontua por aliado (não o próprio) cuja vida efetivamente curada ≥ `heal.min_effective` (§7.1) */
export function onHeal(cfg: SimConfig, g: GameState, healer: Survivor, ally: Survivor, healed: number) {
  if (cfg.v1 && ally.id !== healer.id && healed >= cfg.balance.points.events.heal.min_effective) credit(cfg, g, healer, "heal");
}

/**
 * Golpe ou projétil do caçador que causou dano (`by` = origem). Golpe (+15) só corpo a corpo; revelação eficaz no
 * primeiro acerto em sobrevivente revelado em cada revelação; evitar resgate quando o atingido resgatava um preso
 * (progresso de resgate > 0 com um preso no alcance de `cage.rescue_range`). LACUNA §7.1: o GDD não define
 * "revelação eficaz" nem "evitar resgate"; estas são as leituras conservadoras.
 */
export function onHunterHit(cfg: SimConfig, g: GameState, s: Survivor, by: "melee" | "projectile" | undefined) {
  if (!cfg.v1) return;
  if (by === "melee") creditHunter(cfg, g, "hit");
  if (s.revealed > 0 && !g.scoreTrack.revealHit.includes(s.id)) { g.scoreTrack.revealHit.push(s.id); creditHunter(cfg, g, "reveal"); }
  const rescuing = s.rescue > 0 && g.survivors.some(a => a.st === "cage" && dist(a, s) < cfg.balance.cage.rescue_range);
  if (rescuing) creditHunter(cfg, g, "deny_rescue");
}

/** captura (antes de ir à gaiola ou morrer): +captura; perseguição longa se a perseguição em curso passou de `min_time` */
export function onCapture(cfg: SimConfig, g: GameState, s: Survivor) {
  if (!cfg.v1) return;
  creditHunter(cfg, g, "capture");
  const c = g.scoreTrack.chase;
  if (c && c.target === s.id) {
    if (g.t - c.since > cfg.balance.points.hunter_events.long_chase.min_time) creditHunter(cfg, g, "long_chase");
    g.scoreTrack.chase = null; // capturado: a perseguição acabou sem fuga
  }
}

/**
 * Alvo perseguido agora (−1 = nenhum). IA utility (`ai.hunter_brain: utility`, GDD-v0.3 §8.2): modos `chase` e
 * `attack`, e `recoil` como continuação (o recuo pós-golpe sem captura volta a `chase`); o alvo é `ai.target` ou, sem
 * ele, o da memória. Cérebro `basic`: critério equivalente — o caçador tem o sobrevivente como alvo (`hunter.target`)
 * ou, depois de perdê-lo de vista, ainda vai à última posição vista (`alertTime` > 0, memória de §8.1).
 */
export function chasedTarget(g: GameState): number {
  const H = g.hunter, ai = H.ai;
  if (ai) return ai.mode === "chase" || ai.mode === "attack" || ai.mode === "recoil" ? (ai.target >= 0 ? ai.target : ai.memory?.id ?? -1) : -1;
  if (H.target >= 0) return H.target;
  const c = g.scoreTrack.chase;
  return c && H.alertTime > 0 ? c.target : -1;
}

/**
 * Passo do rastreio (v1, depois do caçador e dos projéteis): fecha a perseguição quando o alvo muda; se durou mais que
 * `chase_escape.min_time` e o alvo não foi capturado (segue livre ou escapou), credita `chase_escape` a ele.
 * Também libera a revelação eficaz quando a revelação do sobrevivente acaba.
 */
export function trackScore(cfg: SimConfig, g: GameState) {
  const tr = g.scoreTrack;
  tr.revealHit = tr.revealHit.filter(id => g.survivors[id].revealed > 0);
  const id = chasedTarget(g), c = tr.chase;
  if (c && c.target !== id) {
    const s = g.survivors[c.target];
    if ((s.st === "ok" || s.st === "out") && g.t - c.since > cfg.balance.points.events.chase_escape.min_time) credit(cfg, g, s, "chase_escape");
    tr.chase = null;
  }
  if (id >= 0 && !tr.chase) tr.chase = { target: id, since: g.t };
}

/**
 * quem leva o bônus de vitória (`economy.win_coins_to`): `alive` = todos os vivos do time vencedor (decisão do Rodrigo
 * 09/11/2026, pergunta 1 da sessão Visual; diverge da leitura literal do GDD v0.3 §3.3 item 1); `escaped` = só quem escapou
 */
export function winsCoins(cfg: SimConfig, teamWon: boolean, individual: "escaped" | "dead" | "not_escaped"): boolean {
  if (!teamWon) return false;
  return cfg.balance.economy.win_coins_to === "escaped" ? individual === "escaped" : individual !== "dead";
}

/** moedas = base + vitória × win_coins + pontos × points_to_coins (GDD-v0.2 §7.2, GDD-v0.3 D-04) */
export function coinsFor(cfg: SimConfig, win: boolean, points: number): number {
  const e = cfg.balance.economy;
  return Math.round(e.base_coins + (win ? e.win_coins : 0) + points * e.points_to_coins);
}
