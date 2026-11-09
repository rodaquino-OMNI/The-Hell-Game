// Diretor de áudio (item A-5 do V5; GDD-v0.3 §11 e GDD-v0.2 §11 e §4.1). Lê o GameState a cada quadro e os
// GameEvent já drenados por main.ts, e decide o que tocar pelo catálogo de efeitos (sfx.ts):
//   - telegraph: `hunter.windup` passa de nulo a presente (ou troca de preparo) ⇒ efeito `telegraph_<kind>` no mesmo
//     quadro, na posição do caçador, seguindo-o enquanto o preparo dura (GDD-v0.3 §11 "começa junto com o telegraph
//     visual"; docs/handoff/plano-audio-v5.md §3);
//   - contínuos: passos do caçador (espaciais, cadência = velocidade / stride), passos do jogador (pos null; corrida
//     quando a stamina cai, que é exatamente quando o sim drena: game.ts `step`), respiração abaixo do limiar de
//     stamina, batimento (raio e intervalo de prototype_extras.heartbeat, a mesma fórmula do HUD), zumbido dos
//     geradores com progresso;
//   - transições: gerador concluído, prisão (ok → cage) e resgate (cage → ok);
//   - música: updateMusic do A-2 a cada quadro e ducking (duckFor) em golpe no jogador e prisão.
// O áudio só lê o estado (plano-audio-v5.md §3). Flag `audio.director_enabled` (D-32): com false nada acontece.
// Valores: data/balance.yaml `audio.director`, `audio.sfx`, `prototype_extras.heartbeat`, `survivor.stamina`,
// `generator.puzzles_per_generator`.
import type { Balance } from "@thehell/shared";
import type { GameEvent, GameState, Vec, Windup } from "@thehell/sim";
import { balance } from "../data.ts";
import { duckMusic, updateMusic } from "./music.ts";
import { playSfx, type SfxOpts } from "./sfx.ts";

/** o que o diretor recebe de quem toca: um efeito do catálogo; o retorno pode ser seguido (setPosition) */
export type SfxHandle = { setPosition?(p: Vec): void } | null;
export type PlayFn = (name: string, opts?: SfxOpts) => SfxHandle | void;
export interface DirectorMusic {
  update(state: GameState, playerId: number): unknown;
  duckFor(s: number): void;
}
export type DirectorCfg = Pick<Balance, "audio" | "prototype_extras" | "survivor" | "generator">;

export interface DirectorDeps {
  play?: PlayFn;
  music?: DirectorMusic;
  cfg?: DirectorCfg;
  /** padrão: cfg.audio.director_enabled */
  enabled?: boolean;
}

export interface AudioDirector {
  readonly enabled: boolean;
  /** um quadro: `dt` = tempo de quadro (s) */
  update(state: GameState, playerId: number, dt: number): void;
  /** eventos do quadro, já drenados por main.ts (não toca na fila do estado) */
  events(events: readonly GameEvent[]): void;
}

/** nome do efeito de telegraph de cada preparo (catálogo `audio.sfx`) */
export const telegraphSfx = (k: Windup["kind"]) => `telegraph_${k}`;
/** efeitos que o diretor toca (o teste confere que todos existem no catálogo) */
export const DIRECTOR_SFX = [
  "telegraph_melee", "telegraph_dash", "telegraph_projectile", "telegraph_trap", "step_hunter", "step_walk", "step_run",
  "breath", "heartbeat", "generator_hum", "generator_done", "cage", "rescue",
] as const;

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);
const at = (p: Vec): Vec => ({ x: p.x, z: p.z });

interface Snap {
  t: number;
  windup: { kind: Windup["kind"]; t: number } | null;
  hunter: Vec;
  /** por id: estado, posição e stamina */
  surv: Map<number, { st: string; x: number; z: number; stamina: number }>;
  done: boolean[];
}

function snap(g: GameState): Snap {
  const w = g.hunter.windup;
  return {
    t: g.t,
    windup: w ? { kind: w.kind, t: w.t } : null,
    hunter: at(g.hunter),
    surv: new Map(g.survivors.map(s => [s.id, { st: s.st, x: s.x, z: s.z, stamina: s.stamina }])),
    done: g.gens.map(x => x.done),
  };
}

export function createAudioDirector(deps: DirectorDeps = {}): AudioDirector {
  const cfg = deps.cfg ?? balance;
  const enabled = deps.enabled ?? cfg.audio.director_enabled;
  const play: PlayFn = deps.play ?? playSfx;
  const music: DirectorMusic = deps.music ?? { update: updateMusic, duckFor: duckMusic };
  const d = cfg.audio.director, hb = cfg.prototype_extras.heartbeat;
  let prev: Snap | null = null;
  let telegraph: SfxHandle = null;
  let hunterAcc = 0, playerAcc = 0, heartT = 0, breathT = 0;
  let humT: number[] = [];

  const reset = () => { prev = null; telegraph = null; hunterAcc = 0; playerAcc = 0; heartT = 0; breathT = 0; humT = []; };
  const safePlay = (name: string, opts?: SfxOpts): SfxHandle => { try { return play(name, opts) || null; } catch { return null; } };

  function update(g: GameState, playerId: number, dt: number) {
    if (!enabled) return;
    music.update(g, playerId);
    if (prev && g.t < prev.t) reset(); // partida nova (o laço troca o estado; o relógio volta a 0)
    if (g.over) { prev = snap(g); telegraph = null; return; }
    const p0 = prev, H = g.hunter;

    // telegraph: preparo novo (nulo → presente, outro tipo, ou recomeçado com t maior)
    const w = H.windup, pw = p0?.windup ?? null;
    if (w && (!pw || w.kind !== pw.kind || w.t > pw.t)) telegraph = safePlay(telegraphSfx(w.kind), { pos: at(H) });
    if (w) telegraph?.setPosition?.(at(H));
    else telegraph = null;

    // passos do caçador: um a cada hunter_stride metros andados
    if (p0) {
      const m = dist(p0.hunter, H);
      if (m <= d.teleport_dist) {
        hunterAcc += m;
        if (hunterAcc >= d.hunter_stride) { hunterAcc %= d.hunter_stride; safePlay("step_hunter", { pos: at(H) }); }
      }
    }

    const P = g.survivors.find(s => s.id === playerId);
    const pp = P && p0 ? p0.surv.get(P.id) : undefined;
    if (P && P.st === "ok") {
      // passos do jogador: corrida = stamina caindo fora do quebra-cabeça (game.ts step: só a corrida drena)
      if (pp && pp.st === "ok") {
        const m = Math.hypot(P.x - pp.x, P.z - pp.z);
        if (m <= d.teleport_dist && m > 0) {
          const run = P.stamina < pp.stamina;
          const stride = run ? d.run_stride : d.walk_stride;
          playerAcc += m;
          if (playerAcc >= stride) { playerAcc %= stride; safePlay(run ? "step_run" : "step_walk", { pos: null }); }
        }
      }
      // respiração abaixo do limiar de stamina
      const limit = d.breath.stamina_below * cfg.survivor.stamina.max;
      if (P.stamina < limit) {
        const k = 1 - P.stamina / limit;
        breathT -= dt;
        if (breathT <= 0) {
          safePlay("breath", { pos: null, intensity: k });
          breathT = d.breath.period[0] + (d.breath.period[1] - d.breath.period[0]) * k;
        }
      } else breathT = 0;
      // batimento: mesma fórmula do HUD (hud/hud.ts; prototype_extras.heartbeat, P-03)
      const dh = dist(P, H);
      if (dh < hb.radius) {
        heartT -= dt;
        if (heartT <= 0) {
          safePlay("heartbeat", { pos: null, intensity: 1 - dh / hb.radius });
          heartT = hb.base_interval + (dh / hb.radius) * hb.range_interval;
        }
      } else heartT = 0;
    } else { breathT = 0; heartT = 0; }

    // geradores: zumbido pelo progresso e conclusão
    const listener: Vec | null = P ?? null;
    g.gens.forEach((x, i) => {
      if (p0 && !p0.done[i] && x.done) safePlay("generator_done", { pos: at(x) });
      if (listener && !x.done && x.n > 0 && dist(listener, x) < d.hum.radius) {
        humT[i] = (humT[i] ?? 0) - dt;
        if (humT[i] <= 0) {
          safePlay("generator_hum", { pos: at(x), intensity: x.n / cfg.generator.puzzles_per_generator });
          humT[i] = d.hum.period;
        }
      } else humT[i] = 0;
    });

    // prisão e resgate
    if (p0) {
      for (const s of g.survivors) {
        const was = p0.surv.get(s.id)?.st;
        if (was === "ok" && s.st === "cage") { safePlay("cage", { pos: at(s) }); music.duckFor(d.duck_time); }
        else if (was === "cage" && s.st === "ok") safePlay("rescue", { pos: at(s) });
      }
    }
    prev = snap(g);
  }

  function events(list: readonly GameEvent[]) {
    if (!enabled) return;
    for (const e of list) {
      if (e.type === "sound") safePlay(e.name, { pos: null });
      // "flash" só sai no golpe recebido pelo jogador (game.ts `hit`: `if (!s.bot) emit flash`): evento crítico
      else if (e.type === "flash") music.duckFor(d.duck_time);
    }
  }

  return { enabled, update, events };
}

/** o diretor está ligado (`audio.director_enabled`)? main.ts/hud usam para não tocar os bipes antigos em dobro */
export const directorEnabled = () => balance.audio.director_enabled;

let director: AudioDirector | null = null;
/** um quadro do áudio (singleton; no-op com `audio.director_enabled: false`) */
export function updateAudio(state: GameState, playerId: number, dt: number) {
  if (!directorEnabled()) return;
  (director ??= createAudioDirector()).update(state, playerId, dt);
}
/** eventos do quadro já drenados por main.ts (singleton; no-op com a flag false; não drena a fila) */
export function audioEvents(events: readonly GameEvent[]) {
  if (!directorEnabled()) return;
  (director ??= createAudioDirector()).events(events);
}
