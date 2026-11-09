// Partida headless (ruleset v1, todos os sobreviventes controlados pelos bots atuais) com a medição de trava do
// critério T-03 (GDD-v0.3 §8.6, `ai.stuck_fail_after`). Base do simulador (tools/sim/run.ts; o R5 completa).
import { CLASSES, NO_INPUT, type EndReason, type GameState, type Team } from "./types.ts";
import { createGame, step, STEP } from "./game.ts";
import type { AiTrace, SimConfig } from "./config.ts";

export interface StuckMeter {
  /** tempo seguido (s) com deslocamento abaixo do mínimo e caminho válido */
  run: number;
  /** maior sequência observada (s) */
  worst: number;
  /** instante e posição em que a trava passou de `ai.stuck_fail_after` (null = sem trava) */
  failAt: { t: number; x: number; z: number; mode: string } | null;
  win: { t: number; x: number; z: number; ex: number; ez: number; path: number };
  /** informativo: maior tempo seguido em vaivém (andou ≥ esperado escalar, mas deslocamento líquido < mínimo) */
  dither: number;
  ditherRun: number;
}

export function newStuckMeter(g: GameState): StuckMeter {
  return { run: 0, worst: 0, failAt: null, win: { t: 0, x: g.hunter.x, z: g.hunter.z, ex: 0, ez: 0, path: 0 }, dither: 0, ditherRun: 0 };
}

/**
 * Mede a trava (T-03) a partir do estado depois de cada passo. Janela de `ai.anti_stuck.window`; numa janela,
 * "esperado" é o deslocamento que a IA tentou fazer (soma vetorial de `ai.step`, velocidade pretendida × dt, antes
 * da colisão) enquanto havia caminho válido, e "deslocamento" é a distância líquida real entre o início e o fim da
 * janela. Janelas abaixo de `min_progress_ratio` se somam; qualquer outra zera a soma. Trava = soma acima de
 * `ai.stuck_fail_after`. Informativo (`dither`): mesma conta com o esperado escalar (comprimento andado), que
 * também pega meia-volta de propósito (vasculha, fim de patrulha).
 */
export function measureStuck(cfg: SimConfig, g: GameState, m: StuckMeter, dt: number) {
  const ai = g.hunter.ai, a = cfg.balance.ai;
  if (!ai) return;
  if (ai.pathOk) { m.win.ex += ai.step.x; m.win.ez += ai.step.z; m.win.path += ai.speed * dt; }
  m.win.t += dt;
  if (m.win.t + 1e-9 < a.anti_stuck.window) return;
  const r = a.anti_stuck.min_progress_ratio;
  const moved = Math.hypot(g.hunter.x - m.win.x, g.hunter.z - m.win.z), expected = Math.hypot(m.win.ex, m.win.ez);
  // só avalia janelas em que a IA pretendia avançar (esperado líquido ≥ fração mínima do comprimento pretendido)
  if (expected > 0 && expected >= r * m.win.path && moved < r * expected) {
    m.run += m.win.t;
    m.worst = Math.max(m.worst, m.run);
    if (m.run > a.stuck_fail_after && !m.failAt) m.failAt = { t: g.t, x: g.hunter.x, z: g.hunter.z, mode: ai.mode };
  } else m.run = 0;
  if (m.win.path > 0 && moved < r * m.win.path) { m.ditherRun += m.win.t; m.dither = Math.max(m.dither, m.ditherRun); }
  else m.ditherRun = 0;
  m.win = { t: 0, x: g.hunter.x, z: g.hunter.z, ex: 0, ez: 0, path: 0 };
}

export interface HeadlessResult {
  seed: number;
  /** duração (s) */
  time: number;
  team: Team | null;
  reason: EndReason | null;
  escaped: number;
  captures: number;
  stuck: StuckMeter;
  /** transições de estado do caçador "de>para" → contagem */
  transitions: Record<string, number>;
  replans: number;
  layout: string;
  /**
   * duração (s) de cada episódio contínuo do caçador em `chase`/`attack`/`recoil` que terminou com o alvo derrubado
   * (preso ou morto pelo golpe/projétil; GDD-v0.3 §8.5, aceite da mediana ≥ 15 s). Vazio sem a IA do caçador.
   */
  chases: number[];
  /**
   * informativo (R4): o mesmo, mas o episódio continua enquanto o caçador investiga a última posição lembrada do
   * mesmo alvo (`investigate` com `ai.memory` do alvo ainda válida): perder o alvo de vista por instantes num loop
   * não encerra a perseguição; trocar de alvo abre outro episódio
   */
  chasesMemory: number[];
}

const CHASE_MODES: readonly string[] = ["chase", "attack", "recoil"];

export interface ChaseMeter { memory: boolean; from: number; target: number; done: number[] }
export const newChaseMeter = (memory: boolean): ChaseMeter => ({ memory, from: -1, target: -1, done: [] });

/** atualiza o medidor depois de um passo; `downed` = algum sobrevivente livre foi preso ou morto neste passo */
export function measureChase(g: GameState, m: ChaseMeter, downed: boolean) {
  const ai = g.hunter.ai;
  if (!ai) return;
  let on = CHASE_MODES.includes(ai.mode);
  if (!on && m.memory && m.from >= 0 && ai.mode === "investigate" && ai.memory && ai.memory.id === m.target && ai.memory.until > g.t) on = true;
  if (on && m.from < 0) { m.from = g.t - STEP; m.target = ai.target; }
  // com memória o episódio é de um alvo: trocar de alvo abre outro episódio
  if (on && m.memory && ai.target >= 0 && ai.target !== m.target) m.from = g.t - STEP;
  if (on && ai.target >= 0) m.target = ai.target;
  // o golpe que prende pode levar a cage no mesmo passo: conta se o episódio estava aberto
  if (m.from >= 0 && downed) { m.done.push(g.t - m.from); m.from = on ? g.t : -1; return; }
  if (!on) m.from = -1;
}

/**
 * Joga uma partida inteira sem jogador humano: o sobrevivente 0 também vira bot. Para no fim da partida ou, por
 * segurança, um passo depois do limite duro. `cfg` deve ser v1; o gancho `trace` da config é substituído durante a
 * partida para contar as transições.
 */
export function playHeadless(cfg: SimConfig, seed: number): HeadlessResult {
  const transitions: Record<string, number> = {};
  const trace = (e: AiTrace) => { const k = `${e.from}>${e.to}`; transitions[k] = (transitions[k] ?? 0) + 1; };
  const c: SimConfig = { ...cfg, trace };
  const g = createGame(c, CLASSES[seed % CLASSES.length], seed);
  g.survivors[0].bot = true;
  const meter = newStuckMeter(g);
  const limit = Math.ceil((cfg.balance.match.hard_time_limit + 1) / STEP);
  let end: Extract<GameState["events"][number], { type: "end" }> | null = null;
  const strict = newChaseMeter(false), memory = newChaseMeter(true);
  for (let i = 0; i < limit && !g.over; i++) {
    const before = g.survivors.map(s => s.st);
    step(c, g, NO_INPUT);
    const downed = g.survivors.some((s, k) => before[k] === "ok" && (s.st === "cage" || s.st === "dead"));
    measureChase(g, strict, downed); measureChase(g, memory, downed);
    measureStuck(c, g, meter, STEP);
    for (const e of g.events) if (e.type === "end") end = e;
    g.events.length = 0;
  }
  return {
    seed, time: g.t, team: end?.team ?? null, reason: end?.reason ?? null,
    escaped: g.survivors.filter(s => s.st === "out").length,
    captures: g.survivors.reduce((n, s) => n + s.captures, 0),
    stuck: meter, transitions, replans: g.hunter.ai?.replans ?? 0,
    layout: `g${g.arena.layout.generators}c${g.arena.layout.cage}e${g.arena.layout.exit}`,
    chases: strict.done, chasesMemory: memory.done,
  };
}
