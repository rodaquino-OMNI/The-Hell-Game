// Partida headless (ruleset v1, todos os sobreviventes controlados pelos bots atuais) com a medição de trava do
// critério T-03 (GDD-v0.3 §8.6, `ai.stuck_fail_after`). Base do simulador (tools/sim/run.ts, métricas do R5).
import { CLASSES, NO_INPUT, type ClassName, type EndReason, type GameState, type HunterMode, type SurvivorState, type Team } from "./types.ts";
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
   * Episódios de perseguição que terminaram em captura (métrica do R4/R5, GDD-v0.3 §8.5): duração (s) de cada
   * trecho contínuo com o caçador em `chase`/`attack`/`recoil` (§8.2) encerrado pela passagem a `cage` (alvo
   * derrubado: preso ou morto na 2ª captura). Trechos que voltam a patrulhar ou investigar não entram. Só existe
   * com `hunter_brain: utility`; com o cérebro `basic` fica vazio.
   */
  chases: number[];
  /** estado final de cada sobrevivente (classe sorteada, uso de classe do GDD-v0.2 §7.6) */
  survivors: { cls: ClassName; st: SurvivorState; captures: number }[];
}

/** modos do caçador que contam como perseguição (GDD-v0.3 §8.2) */
const CHASE_MODES: readonly HunterMode[] = ["chase", "attack", "recoil"];

/**
 * Joga uma partida inteira sem jogador humano: o sobrevivente 0 também vira bot. Para no fim da partida ou, por
 * segurança, um passo depois do limite duro. `cfg` deve ser v1; o gancho `trace` da config é substituído durante a
 * partida para contar as transições.
 */
export function playHeadless(cfg: SimConfig, seed: number): HeadlessResult {
  const transitions: Record<string, number> = {};
  const chases: number[] = [];
  let chaseStart = -1;
  const trace = (e: AiTrace) => {
    const k = `${e.from}>${e.to}`; transitions[k] = (transitions[k] ?? 0) + 1;
    const from = CHASE_MODES.includes(e.from as HunterMode), to = CHASE_MODES.includes(e.to as HunterMode);
    if (!from && to) chaseStart = e.t;
    else if (from && !to) {
      if (e.to === "cage" && chaseStart >= 0) chases.push(e.t - chaseStart);
      chaseStart = -1;
    }
  };
  const c: SimConfig = { ...cfg, trace };
  const g = createGame(c, CLASSES[seed % CLASSES.length], seed);
  g.survivors[0].bot = true;
  const meter = newStuckMeter(g);
  const limit = Math.ceil((cfg.balance.match.hard_time_limit + 1) / STEP);
  let end: Extract<GameState["events"][number], { type: "end" }> | null = null;
  for (let i = 0; i < limit && !g.over; i++) {
    step(c, g, NO_INPUT);
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
    chases, survivors: g.survivors.map(s => ({ cls: s.cls, st: s.st, captures: s.captures })),
  };
}
