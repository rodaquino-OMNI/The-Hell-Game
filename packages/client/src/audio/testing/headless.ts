// Partidas headless para as provas do áudio (A-5): telegraph antes do efeito (packages/client/test/audio-telegraph.test.ts)
// e fração de tempo por estado musical (tools/audio/music-states.ts, D-26). Mesma montagem de
// packages/sim/src/headless.ts `playHeadless` (usada por tools/sim/run.ts): createGame com a classe da semente, o
// sobrevivente 0 vira bot, passo fixo STEP até o fim ou um passo depois de match.hard_time_limit.
// Não é importado pelo jogo.
import { CLASSES, NO_INPUT, createGame, step, STEP, type GameState, type SimConfig, type Vec, type Windup } from "@thehell/sim";

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

// ---------- medição do telegraph (prova 1 do A-5; D-36) ----------

/** personagem visto, como o HUD: o jogador 0 em jogo (livre ou preso) ou, no modo espectador, o 1º aliado em jogo
 *  (hud/spectator.ts `isSpectating` e `spectatorTarget`, sem a troca manual de aliado) */
export function viewedCharacter(g: GameState): Vec {
  const inPlay = (s: GameState["survivors"][number]) => s.st === "ok" || s.st === "cage";
  const P = g.survivors[0];
  return inPlay(P) ? P : g.survivors.find(s => s.id !== 0 && inPlay(s)) ?? P;
}

/** início de preparo visto no estado: nulo → presente, outro kind, ou recomeçado (t maior) */
export interface Onset { kind: AbilityKind; seed: number; t: number; audible: boolean; played: boolean }
export interface TelegraphSample { kind: AbilityKind; seed: number; tEffect: number; onset: Onset | null }
export interface KindStats {
  /** efeitos medidos */
  n: number;
  /** efeitos cujo preparo começou dentro do raio audível (estes exigem telegraph) */
  audible: number;
  /** efeitos sem preparo do mesmo tipo antes, ou com preparo audível sem telegraph */
  missing: number;
  /** antecedência informativa (s) entre o início do preparo e o efeito; a garantia é da Frente R (D-36) */
  minLead: number;
  maxLead: number;
}
export interface TelegraphReport {
  onsets: Onset[];
  /** passos em que o telegraph tocado não bate com o preparo (falta, sobra, kind errado ou fora de um início) */
  mismatches: string[];
  samples: TelegraphSample[];
  byKind: Record<AbilityKind, KindStats>;
  /** efeitos pedidos pelo diretor (nome → vezes) */
  plays: Record<string, number>;
  /** telegraph pedido que não ganhou voz (null de quem toca) */
  refused: number;
}

export const ABILITY_KINDS: readonly AbilityKind[] = ["melee", "dash", "projectile", "trap"];

export interface DirectorLike {
  update(g: GameState, id: number, dt: number, at?: Vec): void;
  events(e: GameState["events"], id?: number): void;
}
export type RecordingPlay = (name: string, opts?: unknown) => unknown;
/** `now` = g.t do passo (o teste avança o relógio do contexto falso com ele) */
export type TimedPlay = (name: string, opts: unknown, now: number) => unknown;

const TELEGRAPH = "telegraph_";

/**
 * Roda as partidas passando cada passo ao diretor feito por `makeDirector(play)`, com o personagem visto
 * (`viewedCharacter`). Em cada passo compara o que o diretor tocou de telegraph com o início de preparo visto no
 * estado: início dentro de `audibleRadius` do personagem visto ⇒ exatamente um `telegraph_<kind>` naquele passo;
 * fora do raio (D-37) ou sem início ⇒ nenhum. Cada efeito de habilidade detectado casa com o último início do mesmo
 * tipo ainda não usado.
 */
export function measureTelegraph(
  cfg: SimConfig, seeds: readonly number[], audibleRadius: number,
  makeDirector: (play: RecordingPlay) => DirectorLike, play: TimedPlay,
): TelegraphReport {
  const onsets: Onset[] = [], mismatches: string[] = [], samples: TelegraphSample[] = [], plays: Record<string, number> = {};
  let refused = 0;
  for (const seed of seeds) {
    let now = 0;
    let stepTel: string[] = [];
    const last: Partial<Record<AbilityKind, Onset>> = {};
    const dir = makeDirector((name, opts) => {
      plays[name] = (plays[name] ?? 0) + 1;
      const v = play(name, opts, now);
      if (name.startsWith(TELEGRAPH)) { stepTel.push(name); if (!v) refused++; }
      return v;
    });
    let detect: ((g: GameState) => AbilityKind[]) | null = null;
    let pw: { kind: AbilityKind; t: number } | null = null;
    runMatch(cfg, seed, (g, dt, ev) => {
      now = g.t;
      stepTel = [];
      const at = viewedCharacter(g);
      dir.update(g, 0, dt, { x: at.x, z: at.z });
      dir.events(ev, 0);
      const w = g.hunter.windup;
      const fresh = !g.over && !!w && (!pw || w.kind !== pw.kind || w.t > pw.t);
      pw = w ? { kind: w.kind, t: w.t } : null;
      let onset: Onset | null = null;
      if (fresh) {
        const audible = Math.hypot(at.x - g.hunter.x, at.z - g.hunter.z) <= audibleRadius;
        onset = { kind: w!.kind, seed, t: g.t, audible, played: stepTel.includes(TELEGRAPH + w!.kind) };
        onsets.push(onset);
        last[w!.kind] = onset;
      }
      const want = onset?.audible ? [TELEGRAPH + onset.kind] : [];
      if (stepTel.length !== want.length || stepTel.some((n, i) => n !== want[i])) {
        mismatches.push(`semente ${seed} t=${g.t.toFixed(4)}: tocou [${stepTel}] e o preparo pedia [${want}]`);
      }
      for (const kind of detect!(g)) {
        samples.push({ kind, seed, tEffect: g.t, onset: last[kind] ?? null });
        delete last[kind]; // cada preparo vale para um efeito só
      }
    }, g => { detect = createEffectDetector(g); pw = null; });
  }
  const byKind = Object.fromEntries(ABILITY_KINDS.map(k => {
    const s = samples.filter(x => x.kind === k), leads = s.flatMap(x => (x.onset ? [x.tEffect - x.onset.t] : []));
    return [k, {
      n: s.length, audible: s.filter(x => x.onset?.audible).length,
      missing: s.filter(x => !x.onset || (x.onset.audible && !x.onset.played)).length,
      minLead: Math.min(...leads), maxLead: Math.max(...leads),
    }];
  })) as TelegraphReport["byKind"];
  return { onsets, mismatches, samples, byKind, plays, refused };
}
