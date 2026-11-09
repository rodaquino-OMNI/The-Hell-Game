// Partidas headless para as provas do áudio (A-5): telegraph antes do efeito (packages/client/test/audio-telegraph.test.ts)
// e fração de tempo por estado musical (tools/audio/music-states.ts, D-26). Mesma montagem de
// packages/sim/src/headless.ts `playHeadless` (usada por tools/sim/run.ts): createGame com a classe da semente, o
// sobrevivente 0 vira bot, passo fixo STEP até o fim ou um passo depois de match.hard_time_limit.
// Não é importado pelo jogo.
import { CLASSES, NO_INPUT, createGame, step, STEP, type GameState, type SimConfig, type Windup } from "@thehell/sim";

/** joga uma partida inteira: `onStart(g)` antes do 1º passo e `onStep(g, dt, eventos)` depois de cada passo (a fila
 *  do estado é drenada aqui, como main.ts faz com drainEvents) */
export function runMatch(
  cfg: SimConfig, seed: number,
  onStep: (g: GameState, dt: number, events: GameState["events"]) => void, onStart?: (g: GameState) => void,
): GameState {
  const g = createGame(cfg, CLASSES[seed % CLASSES.length], seed);
  g.survivors[0].bot = true;
  onStart?.(g);
  const limit = Math.ceil((cfg.balance.match.hard_time_limit + 1) / STEP);
  for (let i = 0; i < limit && !g.over; i++) {
    step(cfg, g, NO_INPUT);
    const ev = g.events;
    g.events = [];
    onStep(g, STEP, ev);
  }
  return g;
}

export type AbilityKind = Windup["kind"];
interface EffectSnap { dashing: number; atk: number; traps: Set<number>; projectiles: Set<number> }
const effectSnap = (g: GameState): EffectSnap => ({
  dashing: g.hunter.dashing, atk: g.hunter.atk,
  traps: new Set(g.traps.map(t => t.id)), projectiles: new Set(g.projectiles.map(p => p.id)),
});

/**
 * Detector de efeito de habilidade pelo estado do sim (o sim não emite evento de habilidade):
 *  - dash: `hunter.dashing` passa de ≤ 0 a > 0 (game.ts L393, ai/hunter.ts L374);
 *  - golpe: `hunter.atk` (recarga) sobe — o golpe sai e gasta a recarga, acertando ou não (game.ts L394–L395, ai/hunter.ts L384);
 *  - armadilha: id novo em `traps` (game.ts L329/L366, ai/hunter.ts L375);
 *  - projétil: id novo em `projectiles` (game.ts L327/L370, ai/hunter.ts L380).
 */
export function createEffectDetector(g0: GameState) {
  let prev = effectSnap(g0);
  return (g: GameState): AbilityKind[] => {
    const cur = effectSnap(g), out: AbilityKind[] = [];
    if (cur.dashing > 0 && prev.dashing <= 0) out.push("dash");
    if (cur.atk > prev.atk) out.push("melee");
    for (const id of cur.traps) if (!prev.traps.has(id)) out.push("trap");
    for (const id of cur.projectiles) if (!prev.projectiles.has(id)) out.push("projectile");
    prev = cur;
    return out;
  };
}

// ---------- medição do telegraph (prova 1 do A-5) ----------

export interface TelegraphSample { kind: AbilityKind; seed: number; tEffect: number; tTelegraph: number | null; lead: number | null }
export interface KindStats { n: number; min: number; max: number; missing: number }
export interface TelegraphReport {
  samples: TelegraphSample[];
  /** por tipo: efeitos medidos, menor e maior antecedência (s), efeitos sem telegraph do mesmo tipo antes */
  byKind: Record<AbilityKind, KindStats>;
  /** efeitos pedidos pelo diretor (nome → vezes) */
  plays: Record<string, number>;
  /** telegraph pedido que não ganhou voz (null do espacial) */
  refused: number;
}

export const ABILITY_KINDS: readonly AbilityKind[] = ["melee", "dash", "projectile", "trap"];

export interface DirectorLike {
  update(g: GameState, id: number, dt: number): void;
  events(e: GameState["events"]): void;
}
export type RecordingPlay = (name: string, opts?: unknown) => unknown;
/** `now` = g.t do quadro (o teste avança o relógio do contexto falso com ele) */
export type TimedPlay = (name: string, opts: unknown, now: number) => unknown;

/**
 * Roda as partidas passando cada quadro ao diretor feito por `makeDirector(play)`. `play` é envolvido para registrar
 * o instante (`g.t` do quadro) de cada efeito pedido; cada efeito de habilidade detectado no estado casa com o último
 * telegraph do mesmo tipo ainda não usado.
 */
export function measureTelegraph(
  cfg: SimConfig, seeds: readonly number[], makeDirector: (play: RecordingPlay) => DirectorLike, play: TimedPlay,
): TelegraphReport {
  const samples: TelegraphSample[] = [], plays: Record<string, number> = {};
  let refused = 0;
  for (const seed of seeds) {
    let now = 0;
    const last: Partial<Record<AbilityKind, number>> = {};
    const dir = makeDirector((name, opts) => {
      plays[name] = (plays[name] ?? 0) + 1;
      const v = play(name, opts, now);
      if (name.startsWith("telegraph_")) {
        last[name.slice("telegraph_".length) as AbilityKind] = now;
        if (!v) refused++;
      }
      return v;
    });
    let detect: ((g: GameState) => AbilityKind[]) | null = null;
    runMatch(cfg, seed, (g, dt, ev) => {
      now = g.t;
      dir.update(g, 0, dt);
      dir.events(ev);
      for (const kind of detect!(g)) {
        const tt = last[kind] ?? null;
        samples.push({ kind, seed, tEffect: g.t, tTelegraph: tt, lead: tt === null ? null : g.t - tt });
        delete last[kind]; // cada telegraph vale para um efeito só
      }
    }, g => { detect = createEffectDetector(g); });
  }
  const byKind = Object.fromEntries(ABILITY_KINDS.map(k => {
    const s = samples.filter(x => x.kind === k), leads = s.flatMap(x => (x.lead === null ? [] : [x.lead]));
    return [k, { n: s.length, min: Math.min(...leads), max: Math.max(...leads), missing: s.length - leads.length }];
  })) as TelegraphReport["byKind"];
  return { samples, byKind, plays, refused };
}
