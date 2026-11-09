// Relatório da partida para playtest (R8, "relatório humano"): mede as partidas do dono do projeto no staging contra os
// bots competentes. A pergunta principal é o tempo por quebra-cabeça (meta `generator.puzzle_time_target.full`,
// GDD-v0.2 §6.2 L141: 12–18 s com equipe cheia; o bot conserta em `survivor.bot.puzzle_time`, GDD-v0.2 §2.3).
//
// Coleta passiva: `createGame(cfg, cls, seed, { report: true })` guarda em `g.report` um acumulador (dado puro,
// serializável) que `step` alimenta no fim de cada passo com o estado e os eventos que já existem. Nada aqui muda a
// partida: sem `report` o estado é o de sempre (hashes de referência, paridade e linha de base intactos) e, com ele,
// o resto do estado sai idêntico (packages/sim/test/report.test.ts). `matchReport(g)` monta o JSON final.
//
// Perseguições: a mesma definição de `chaseEpisodes` (headless.ts), com os ganchos `trace`/`traceTarget` da config
// encadeados por `step` só durante o passo. Diferença: `chaseEpisodes` guarda só os episódios que terminam em captura
// (duração até o golpe que derrubou); aqui ficam todos, com o alvo e o motivo do fim (`capture`, `lost` = voltou a
// patrulhar/investigar, `switch` = trocou de alvo, `open` = em curso no fim da partida). Os episódios `capture` do
// time inteiro têm exatamente as durações de `chaseEpisodes`. Só existe com `ai.hunter_brain: utility`.
import type { AiTrace, SimConfig } from "./config.ts";
import type { ClassName, EndReason, GameEvent, GameMode, GameState, Individual, Outcome, Score, SurvivorState, Team, Vec } from "./types.ts";

/** versão do formato do relatório (sobe quando um campo muda de sentido ou sai) */
export const REPORT_VERSION = 1;

const CHASE_MODES: readonly string[] = ["chase", "attack", "recoil"];
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);

export type PuzzleResult = "ok" | "fail" | "abandoned";
/**
 * Tentativa de quebra-cabeça. Humano: abertura do painel até acerto, erro ou fechamento (`abandoned`: saiu, foi
 * preso, o gerador acabou por outro ou a partida terminou). Bot: primeiro passo de trabalho até o resultado do
 * sorteio (`ai.bots.puzzle_fail_rate`); `abandoned` = trocou de gerador.
 */
export interface PuzzleRecord {
  who: number;
  gen: number;
  /** "timing" | "sequence" no humano; "bot" no bot (o bot não joga o painel) */
  kind: "timing" | "sequence" | "bot";
  start: number;
  end: number;
  /** tempo ativo (s): painel aberto (humano) ou trabalho acumulado (bot); `end − start` inclui pausas do bot */
  time: number;
  result: PuzzleResult;
}

export type ChaseEnd = "capture" | "lost" | "switch" | "open";
export interface ChaseRecord {
  /** sobrevivente perseguido (−1 = não identificado) */
  target: number;
  start: number;
  /** fim; na captura, o golpe que derrubou (como `chaseEpisodes`) */
  end: number;
  ended: ChaseEnd;
}

interface GenLog {
  start: number | null;
  end: number | null;
  /** progresso por quebra-cabeça acertado e por Turbo, falhas e tempo ativo: [humano (vaga 0), bots] */
  puzzles: [number, number];
  turbo: [number, number];
  fails: [number, number];
  time: [number, number];
}

interface SurvivorLog {
  hits: number;
  damage: number;
  heals: number;
  healed: number;
  captures: number[];
  /** instantes de morte (captura final ou fim do tempo na gaiola) */
  deaths: number[];
  /** resgatado: instante e quem resgatou (−1 = desconhecido, ruleset do protótipo) */
  rescued: { t: number; by: number }[];
  /** resgatou um aliado: instante e quem */
  rescues: { t: number; ally: number }[];
  escapedAt: number | null;
}

/** acumulador da partida (dado puro em `g.report`; entra no hash só das partidas que o pedem) */
export interface MatchLog {
  version: typeof REPORT_VERSION;
  meta: {
    /** semente da criação (`g.seed` é o estado do PRNG e muda durante a partida) */
    seed: number;
    map: string; mode: GameMode; ruleset: "v1" | "prototype"; difficulty: SimConfig["difficulty"];
    hunterBrain: SimConfig["brain"]; botBrain: SimConfig["botBrain"]; botBrainBySlot: Record<number, SimConfig["botBrain"]>;
    /** flags de mapa efetivas (`maps.v1`); null no protótipo */
    mapFlags: SimConfig["balance"]["maps"]["v1"] | null;
    layout: string;
    /** largura efetiva da zona de acerto do quebra-cabeça de timing (opção acessível muda) */
    puzzleZone: number;
  };
  prev: { st: SurvivorState; hp: number; work: number }[];
  prevGens: { n: number; done: boolean }[];
  open: ({ gen: number; kind: PuzzleRecord["kind"]; start: number; time: number }) | null;
  /** tentativa de bot em curso, por vaga */
  work: ({ gen: number; start: number; time: number } | null)[];
  puzzles: PuzzleRecord[];
  gens: GenLog[];
  survivors: SurvivorLog[];
  chase: { target: number; start: number; lastHit: number } | null;
  chases: ChaseRecord[];
  end: Extract<GameEvent, { type: "end" }> | null;
}

/** acumulador vazio; chamado por `createGame` com `report: true` */
export function newMatchLog(cfg: SimConfig, g: GameState, mode: GameMode): MatchLog {
  const L = g.arena.layout;
  return {
    version: REPORT_VERSION,
    meta: {
      seed: g.seed, map: cfg.map.id, mode, ruleset: cfg.v1 ? "v1" : "prototype", difficulty: cfg.difficulty, hunterBrain: cfg.brain, botBrain: cfg.botBrain,
      botBrainBySlot: { ...cfg.botBrainBySlot }, mapFlags: cfg.v1 ? { ...cfg.balance.maps.v1 } : null,
      layout: `g${L.generators}c${L.cage}e${L.exit}`, puzzleZone: cfg.balance.puzzles.timing.zone * cfg.zoneMult,
    },
    prev: g.survivors.map(s => ({ st: s.st, hp: s.hp, work: s.work })),
    prevGens: g.gens.map(x => ({ n: x.n, done: x.done })),
    open: null,
    work: g.survivors.map(() => null),
    puzzles: [],
    gens: g.gens.map(() => ({ start: null, end: null, puzzles: [0, 0], turbo: [0, 0], fails: [0, 0], time: [0, 0] })),
    survivors: g.survivors.map(() => ({ hits: 0, damage: 0, heals: 0, healed: 0, captures: [], deaths: [], rescued: [], rescues: [], escapedAt: null })),
    chase: null, chases: [], end: null,
  };
}

/** alvo perseguido agora pela IA do caçador (visto ou lembrado), −1 sem IA ou sem alvo */
function pursued(g: GameState): number {
  const ai = g.hunter.ai;
  if (!ai) return -1;
  return ai.target >= 0 ? ai.target : ai.memory?.id ?? -1;
}

function closeChase(log: MatchLog, end: number, ended: ChaseEnd, target?: number) {
  const c = log.chase!;
  log.chases.push({ target: c.target >= 0 ? c.target : target ?? -1, start: c.start, end, ended });
  log.chase = null;
}

/**
 * Config do passo com os ganchos do relatório encadeados aos que já existiam (só observam: `cfg.trace` e
 * `cfg.traceTarget` continuam sendo chamados). Usada por `step` quando `g.report` existe.
 */
export function reportConfig(cfg: SimConfig, g: GameState, log: MatchLog): SimConfig {
  const trace = (e: AiTrace) => {
    cfg.trace?.(e);
    const from = CHASE_MODES.includes(e.from), to = CHASE_MODES.includes(e.to);
    if (!from && to) log.chase = { target: pursued(g), start: e.t, lastHit: -1 };
    if (!log.chase) return;
    if (e.from === "attack" && e.to === "recoil") log.chase.lastHit = e.t;
    if (from && !to) {
      const capture = e.to === "cage";
      closeChase(log, capture && log.chase.lastHit >= 0 ? log.chase.lastHit : e.t, capture ? "capture" : "lost", pursued(g));
    }
  };
  const traceTarget = (e: { t: number; target: number; from: number }) => {
    cfg.traceTarget?.(e);
    if (!log.chase) return;
    closeChase(log, e.t, "switch", e.from);
    log.chase = { target: e.target, start: e.t, lastHit: -1 };
  };
  return { ...cfg, trace, traceTarget };
}

const nearestGen = (g: GameState, p: Vec, filter: (i: number) => boolean = () => true) => {
  let best = -1, d = Infinity;
  g.gens.forEach((x, i) => { const k = dist(x, p); if (filter(i) && k < d) { d = k; best = i; } });
  return best;
};

/**
 * Passo do acumulador: depois do passo da partida, com os eventos que ele emitiu (`events`) e o passo `dt`. Lê o
 * estado e os eventos; não escreve nada fora de `log`.
 */
export function observeStep(cfg: SimConfig, g: GameState, log: MatchLog, events: readonly GameEvent[], dt: number) {
  const t = g.t;
  const credits = new Map<number, number>(); // créditos de quebra-cabeça (acerto ou Turbo) por vaga neste passo
  const successes = new Map<number, number>();
  const failAt: Vec[] = [];
  let rescueBy = -1, soundOk = false, soundFail = false;
  for (const e of events) {
    if (e.type === "points" && (e.event === "puzzle" || e.event === "bonus_puzzle")) credits.set(e.who, (credits.get(e.who) ?? 0) + 1);
    else if (e.type === "points" && e.event === "rescue") rescueBy = e.who;
    else if (e.type === "noise" && e.kind === "puzzle_fail") failAt.push(e);
    else if (e.type === "sound" && e.name === "puzzle_ok") soundOk = true;
    else if (e.type === "sound" && e.name === "puzzle_fail") soundFail = true;
    else if (e.type === "end") log.end = { ...e, ...(e.score ? { score: { ...e.score } } : {}) };
  }
  const side = (who: number) => (who === 0 ? 0 : 1);
  const touch = (i: number, at: number) => { const x = log.gens[i]; if (x.start === null || at < x.start) x.start = at; };
  const record = (r: PuzzleRecord) => {
    log.puzzles.push(r);
    const x = log.gens[r.gen];
    if (r.result === "ok") { x.puzzles[side(r.who)]++; successes.set(r.who, (successes.get(r.who) ?? 0) + 1); }
    if (r.result === "fail") x.fails[side(r.who)]++;
  };

  // quebra-cabeça do jogador humano (painel em g.puzzle; só a vaga 0 não é bot)
  const P = g.survivors[0];
  if (!P.bot) {
    const o = log.open;
    if (o) { o.time += dt; log.gens[o.gen].time[0] += dt; }
    const result: PuzzleResult | null = soundOk ? "ok" : soundFail ? "fail" : null;
    const z = g.puzzle;
    if (o && (result || !z || z.gen !== o.gen)) {
      record({ who: 0, gen: o.gen, kind: o.kind, start: o.start, end: t, time: o.time, result: result ?? "abandoned" });
      log.open = null;
    }
    if (z && !log.open) { log.open = { gen: z.gen, kind: z.kind, start: t, time: 0 }; touch(z.gen, t); }
  }

  // bots (inclusive a vaga 0 quando vira bot, no simulador): tentativa = trabalho acumulado em `s.work`
  g.survivors.forEach((s, i) => {
    if (!s.bot) return;
    const prev = log.prev[i].work, w = log.work[i];
    const gen = s.ai && s.ai.gen >= 0 ? s.ai.gen : nearestGen(g, s);
    if (w && s.work < prev) {
      const at = g.gens[w.gen];
      const failed = failAt.some(p => p.x === at.x && p.z === at.z);
      const ok = !failed && ((credits.get(s.id) ?? 0) > (successes.get(s.id) ?? 0) || !cfg.v1);
      const result: PuzzleResult = failed ? "fail" : ok ? "ok" : "abandoned";
      // o passo do resultado também acumulou trabalho antes de zerar
      const extra = result === "abandoned" ? 0 : dt;
      w.time += extra; log.gens[w.gen].time[side(s.id)] += extra;
      record({ who: s.id, gen: w.gen, kind: "bot", start: w.start, end: t, time: w.time, result });
      log.work[i] = null;
    } else if (w && s.work > prev) { w.time += s.work - prev; log.gens[w.gen].time[side(s.id)] += s.work - prev; }
    if (!log.work[i] && s.work > 0 && gen >= 0) {
      log.work[i] = { gen, start: t - s.work, time: s.work };
      log.gens[gen].time[side(s.id)] += s.work;
      touch(gen, t - s.work);
    }
  });

  // Turbo do Mecânico (crédito de quebra-cabeça sem acerto no mesmo passo): o gerador obrigatório mais próximo
  for (const [who, n] of credits) {
    const extra = n - (successes.get(who) ?? 0);
    if (extra <= 0) continue;
    const i = nearestGen(g, g.survivors[who], k => !g.gens[k].bonus);
    log.gens[i].turbo[side(who)] += extra;
    touch(i, t);
  }

  g.gens.forEach((x, i) => {
    if (x.done && !log.prevGens[i].done) { log.gens[i].end = t; touch(i, t); }
    log.prevGens[i] = { n: x.n, done: x.done };
  });

  // vida, captura, resgate, morte e fuga de cada sobrevivente
  g.survivors.forEach((s, i) => {
    const p = log.prev[i], L = log.survivors[i];
    if (p.st === "ok" && s.hp < p.hp) { L.hits++; L.damage += p.hp - Math.max(0, s.hp); }
    if (p.st === "ok" && s.st === "ok" && s.hp > p.hp) { L.heals++; L.healed += s.hp - p.hp; }
    if (p.st === "ok" && (s.st === "cage" || s.st === "dead")) L.captures.push(t);
    if (p.st !== "dead" && s.st === "dead") L.deaths.push(t);
    if (p.st === "cage" && s.st === "ok") {
      L.rescued.push({ t, by: rescueBy });
      if (rescueBy >= 0) log.survivors[rescueBy].rescues.push({ t, ally: s.id });
    }
    if (p.st !== "out" && s.st === "out") L.escapedAt = t;
    log.prev[i] = { st: s.st, hp: s.hp, work: s.work };
  });

  if (log.chase && log.chase.target < 0) log.chase.target = pursued(g);
}

// ---------- relatório ----------

const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface GeneratorReport {
  gen: number;
  bonus: boolean;
  /** primeiro trabalho (quebra-cabeça aberto, trabalho de bot ou Turbo) e conclusão; null se não houve */
  start: number | null;
  end: number | null;
  /** end − start (só nos concluídos) */
  duration: number | null;
  human: { puzzles: number; turbo: number; fails: number; time: number };
  bots: { puzzles: number; turbo: number; fails: number; time: number };
}

export interface MatchReport {
  version: typeof REPORT_VERSION;
  seed: number;
  map: string;
  mode: GameMode;
  ruleset: "v1" | "prototype";
  difficulty: SimConfig["difficulty"];
  hunterBrain: SimConfig["brain"];
  botBrain: SimConfig["botBrain"];
  botBrainBySlot: Record<number, SimConfig["botBrain"]>;
  mapFlags: MatchLog["meta"]["mapFlags"];
  layout: string;
  puzzleZone: number;
  /** duração total (s, com fração) e se a partida terminou */
  duration: number;
  over: boolean;
  /** motivo do fim e resultado (v1); no protótipo só `outcome`/`win` */
  end: {
    reason: EndReason | null; team: Team | null; individual: Individual | null; outcome: Outcome; win: boolean;
    coins: number; winCoins: boolean | null;
  } | null;
  score: { points: number; categories: Score; hunterPoints: number };
  /** jogador da vaga 0 (o humano; no simulador, o bot que ocupa a vaga) */
  human: {
    slot: 0; cls: ClassName; bot: boolean; state: SurvivorState;
    puzzles: PuzzleRecord[];
    /** informativo: mediana do tempo ativo por TENTATIVA terminada (acerto ou erro); a meta usa `puzzleSolveMedian` */
    puzzleMedian: number | null;
    /**
     * quebra-cabeças resolvidos (métrica da meta `generator.puzzle_time_target`, GDD-v0.2 §6.2): do início da
     * primeira tentativa errada desde o último acerto no mesmo gerador até o acerto; `time` = tempo ativo do acerto
     * mais o das tentativas erradas anteriores (as abandonadas não somam nem reiniciam)
     */
    puzzleSolves: PuzzleSolve[];
    /** mediana de `puzzleSolves[].time`: o "tempo por quebra-cabeça resolvido" */
    puzzleSolveMedian: number | null;
    chases: (ChaseRecord & { duration: number })[];
    hits: number; damage: number; heals: number; healed: number;
    captures: number[]; deaths: number[];
    rescued: { t: number; by: number }[];
    rescues: { t: number; ally: number }[];
    escapedAt: number | null;
  };
  team: {
    generators: GeneratorReport[];
    /** `botMedian`: por tentativa terminada (como `puzzleMedian`); `botSolveMedian`: por resolvido (como `puzzleSolveMedian`) */
    puzzles: { human: number; bots: number; botMedian: number | null; botSolveMedian: number | null };
    /** tentativas de quebra-cabeça dos bots (vagas 1+) */
    botPuzzles: PuzzleRecord[];
    chases: { total: number; capture: number; onHuman: number; captureDurations: number[] };
    captures: number; deaths: number; rescues: number; escaped: number;
    survivors: { id: number; cls: ClassName; bot: boolean; state: SurvivorState; captures: number; rescues: number; hits: number }[];
  };
}

export interface PuzzleSolve { who: number; gen: number; start: number; end: number; time: number; fails: number }

/** quebra-cabeças resolvidos a partir das tentativas em ordem (ver `puzzleSolves` no relatório) */
export function puzzleSolves(records: readonly PuzzleRecord[]): PuzzleSolve[] {
  const out: PuzzleSolve[] = [];
  const pending = new Map<string, { start: number; time: number; fails: number }>();
  for (const r of records) {
    const k = `${r.who}:${r.gen}`, p = pending.get(k);
    if (r.result === "fail") {
      if (p) { p.time += r.time; p.fails++; } else pending.set(k, { start: r.start, time: r.time, fails: 1 });
    } else if (r.result === "ok") {
      out.push({ who: r.who, gen: r.gen, start: p ? p.start : r.start, end: r.end, time: r.time + (p?.time ?? 0), fails: p?.fails ?? 0 });
      pending.delete(k);
    }
  }
  return out;
}

/** relatório da partida (JSON serializável); exige `createGame(..., { report: true })` */
export function matchReport(g: GameState): MatchReport {
  const log = g.report;
  if (!log) throw new Error("partida sem relatório: crie com createGame(cfg, cls, seed, { report: true })");
  const m = log.meta, t = g.t, P = g.survivors[0], H = log.survivors[0];
  const finished = (r: PuzzleRecord) => r.result !== "abandoned";
  const puzzles = [...log.puzzles];
  if (log.open) puzzles.push({ who: 0, gen: log.open.gen, kind: log.open.kind, start: log.open.start, end: t, time: log.open.time, result: "abandoned" });
  const chases = [...log.chases];
  if (log.chase) chases.push({ target: log.chase.target, start: log.chase.start, end: t, ended: "open" });
  const withDur = (c: ChaseRecord) => ({ ...c, duration: c.end - c.start });
  const mine = puzzles.filter(r => r.who === 0);
  const theirs = puzzles.filter(r => r.who !== 0);
  const e = log.end;
  const pair = (x: GenLog, k: 0 | 1) => ({ puzzles: x.puzzles[k], turbo: x.turbo[k], fails: x.fails[k], time: x.time[k] });
  return {
    version: REPORT_VERSION, seed: m.seed, map: m.map, mode: m.mode, ruleset: m.ruleset, difficulty: m.difficulty, hunterBrain: m.hunterBrain,
    botBrain: m.botBrain, botBrainBySlot: m.botBrainBySlot, mapFlags: m.mapFlags, layout: m.layout, puzzleZone: m.puzzleZone,
    duration: t, over: g.over,
    end: e ? {
      reason: e.reason ?? null, team: e.team ?? null, individual: e.individual ?? null, outcome: e.outcome, win: e.win, coins: e.coins,
      winCoins: e.winCoins ?? null,
    } : null,
    score: { points: g.points, categories: { ...P.score }, hunterPoints: g.hunterPoints },
    human: {
      slot: 0, cls: P.cls, bot: P.bot, state: P.st, puzzles: mine, puzzleMedian: median(mine.filter(finished).map(r => r.time)),
      puzzleSolves: puzzleSolves(mine), puzzleSolveMedian: median(puzzleSolves(mine).map(x => x.time)),
      chases: chases.filter(c => c.target === 0).map(withDur),
      hits: H.hits, damage: H.damage, heals: H.heals, healed: H.healed, captures: [...H.captures], deaths: [...H.deaths],
      rescued: H.rescued.map(r => ({ ...r })), rescues: H.rescues.map(r => ({ ...r })), escapedAt: H.escapedAt,
    },
    team: {
      generators: log.gens.map((x, i) => ({
        gen: i, bonus: g.gens[i].bonus, start: x.start, end: x.end, duration: x.start !== null && x.end !== null ? x.end - x.start : null,
        human: pair(x, 0), bots: pair(x, 1),
      })),
      puzzles: { human: mine.filter(r => r.result === "ok").length, bots: theirs.filter(r => r.result === "ok").length, botMedian: median(theirs.filter(finished).map(r => r.time)),
        botSolveMedian: median(puzzleSolves(theirs).map(x => x.time)),
      },
      botPuzzles: theirs,
      chases: {
        total: chases.length, capture: chases.filter(c => c.ended === "capture").length, onHuman: chases.filter(c => c.target === 0).length,
        captureDurations: chases.filter(c => c.ended === "capture").map(c => c.end - c.start),
      },
      captures: log.survivors.reduce((n, s) => n + s.captures.length, 0),
      deaths: log.survivors.reduce((n, s) => n + s.deaths.length, 0),
      rescues: log.survivors.reduce((n, s) => n + s.rescued.length, 0),
      escaped: g.survivors.filter(s => s.st === "out").length,
      survivors: g.survivors.map((s, i) => ({
        id: s.id, cls: s.cls, bot: s.bot, state: s.st, captures: log.survivors[i].captures.length, rescues: log.survivors[i].rescues.length, hits: log.survivors[i].hits,
      })),
    },
  };
}
