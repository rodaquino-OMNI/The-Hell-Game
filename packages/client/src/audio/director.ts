// Diretor de áudio (item A-5 do V5; GDD-v0.3 §11 e GDD-v0.2 §11 e §4.1). Lê o GameState a cada quadro e os
// GameEvent já drenados por main.ts, e decide o que tocar pelo catálogo de efeitos (sfx.ts):
//   - telegraph: `hunter.windup` passa de nulo a presente (ou troca de kind, ou recomeça) ⇒ efeito `telegraph_<kind>`
//     no mesmo passo, na posição do caçador, seguindo-o enquanto o preparo dura (GDD-v0.3 §11 "começa junto com o
//     telegraph visual"; docs/handoff/plano-audio-v5.md §3). A armadilha nasce na posição do caçador no fim do
//     preparo (ai/hunter.ts `release`) e o sim não expõe esse ponto antes, então o som sai do caçador. Preparo que
//     some sem o efeito do mesmo tipo (atordoamento, projétil sem mira) corta o som com `audio.sfx_cancel_ramp`.
//     A garantia ≥ hunter.telegraph_min é teste da simulação (D-36, docs/plano-construcao.md §7);
//   - corte por distância (D-37): sons posicionais do caçador (passos e telegraph) só tocam até
//     `audio.director.hunter_audible_radius` do personagem visto, para não virarem bússola (GDD-v0.3 §11, "sem
//     enviar a posição do caçador");
//   - contínuos: passos do caçador (cadência = velocidade / stride), passos do jogador (pos null; corrida quando a
//     stamina cai, que é exatamente quando o sim drena: game.ts `step`), respiração abaixo do limiar de stamina,
//     batimento (raio e intervalo de prototype_extras.heartbeat, a mesma fórmula e a mesma condição do HUD: jogador em
//     jogo, livre ou preso; hud/hud.ts e hud/spectator.ts `isSpectating`), zumbido dos geradores com progresso perto
//     do personagem visto (o mesmo ponto da oclusão, spatial.ts `updateSpatial(at)`);
//   - transições: gerador concluído, prisão (ok → cage) e resgate (cage → ok);
//   - eventos: os 5 GameEvent "sound" e o bipe de pontos (`points` com `who` = jogador local);
//   - música: updateMusic do A-2 a cada quadro e ducking (duckFor) em golpe no jogador e prisão.
// LACUNA (paridade da fase 0): `hit`, `stun` e `bolt` chegam como GameEvent "sound" sem posição nem id
// (packages/sim/src/types.ts), então tocam sem posição também quando o golpe/raio é de um bot longe, como no
// protótipo. Pedido possível à Frente R (sessoes.md §2): `sound` com posição ou id do envolvido. Só anotado.
// O áudio só lê o estado (plano-audio-v5.md §3). Flag `audio.director_enabled` (D-32): com false nada acontece.
// Valores: data/balance.yaml `audio.director`, `audio.sfx`, `prototype_extras.heartbeat`, `survivor.stamina`,
// `generator.puzzles_per_generator`.
import type { Balance } from "@thehell/shared";
import type { GameEvent, GameState, Vec, Windup } from "@thehell/sim";
import { balance } from "../data.ts";
import { duckMusic, updateMusic } from "./music.ts";
import { playSfx, type SfxOpts } from "./sfx.ts";

/** o que o diretor recebe de quem toca: a voz pode ser seguida (setPosition) e cortada (cancel) */
export type SfxHandle = { setPosition?(p: Vec): void; cancel?(): void } | null;
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
  /** um quadro: `dt` = tempo de quadro (s); `at` = personagem visto (padrão: o próprio jogador) */
  update(state: GameState, playerId: number, dt: number, at?: Vec): void;
  /** eventos do quadro, já drenados por main.ts (não toca na fila do estado). `playerId` (padrão: o do último
   *  update) decide de quem é o bipe de pontos; sem nenhum, o bipe não toca */
  events(events: readonly GameEvent[], playerId?: number): void;
}

/** nome do efeito de telegraph de cada preparo (catálogo `audio.sfx`) */
export const telegraphSfx = (k: Windup["kind"]) => `telegraph_${k}`;
/** efeitos que o diretor toca (o teste confere que todos existem no catálogo) */
export const DIRECTOR_SFX = [
  "telegraph_melee", "telegraph_dash", "telegraph_projectile", "telegraph_trap", "step_hunter", "step_walk", "step_run",
  "breath", "heartbeat", "generator_hum", "generator_done", "cage", "rescue", "points",
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
  /** sinais de efeito de habilidade (ver `effectHappened`) */
  dashing: number;
  atk: number;
  traps: Set<number>;
  projectiles: Set<number>;
}

function snap(g: GameState): Snap {
  const w = g.hunter.windup;
  return {
    t: g.t,
    windup: w ? { kind: w.kind, t: w.t } : null,
    hunter: at(g.hunter),
    surv: new Map(g.survivors.map(s => [s.id, { st: s.st, x: s.x, z: s.z, stamina: s.stamina }])),
    done: g.gens.map(x => x.done),
    dashing: g.hunter.dashing, atk: g.hunter.atk,
    traps: new Set(g.traps.map(t => t.id)), projectiles: new Set(g.projectiles.map(p => p.id)),
  };
}

/**
 * O preparo `kind` soltou o efeito entre `p` e `g`? Pelo estado do sim (não há evento de habilidade): dash =
 * `dashing` sobe de ≤ 0; golpe = a recarga `atk` sobe (sai e gasta a recarga, acertando ou não); armadilha e
 * projétil = id novo na lista (game.ts `updateHunterV1`; ai/hunter.ts `release`).
 */
export function effectHappened(kind: Windup["kind"], p: Pick<Snap, "dashing" | "atk" | "traps" | "projectiles">, g: GameState): boolean {
  if (kind === "dash") return g.hunter.dashing > 0 && p.dashing <= 0;
  if (kind === "melee") return g.hunter.atk > p.atk;
  if (kind === "trap") return g.traps.some(t => !p.traps.has(t.id));
  return g.projectiles.some(x => !p.projectiles.has(x.id));
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
  let lastPlayer: number | undefined;

  const reset = () => { prev = null; telegraph = null; hunterAcc = 0; playerAcc = 0; heartT = 0; breathT = 0; humT = []; };
  const safePlay = (name: string, opts?: SfxOpts): SfxHandle => { try { return play(name, opts) || null; } catch { return null; } };
  const cancelTelegraph = () => { try { telegraph?.cancel?.(); } catch { /* voz já solta */ } telegraph = null; };

  function update(g: GameState, playerId: number, dt: number, viewed?: Vec) {
    if (!enabled) return;
    lastPlayer = playerId;
    music.update(g, playerId);
    if (prev && g.t < prev.t) reset(); // partida nova (o laço troca o estado; o relógio volta a 0)
    if (g.over) { prev = snap(g); telegraph = null; return; }
    const p0 = prev, H = g.hunter;
    const P = g.survivors.find(s => s.id === playerId);
    const ear: Vec | null = viewed ?? P ?? null;
    const audible = ear !== null && dist(ear, H) <= d.hunter_audible_radius;

    // telegraph: preparo novo (nulo → presente, outro tipo, ou recomeçado com t maior)
    const w = H.windup, pw = p0?.windup ?? null;
    const fresh = !!w && (!pw || w.kind !== pw.kind || w.t > pw.t);
    // o preparo anterior acabou (sumiu ou foi trocado) sem o seu efeito: corta o som
    if (pw && (!w || fresh) && p0 && !effectHappened(pw.kind, p0, g)) cancelTelegraph();
    if (fresh) telegraph = audible ? safePlay(telegraphSfx(w!.kind), { pos: at(H) }) : null;
    if (w) telegraph?.setPosition?.(at(H));
    else telegraph = null;

    // passos do caçador: um a cada hunter_stride metros andados, só dentro do raio audível
    if (p0) {
      const m = dist(p0.hunter, H);
      if (m <= d.teleport_dist) {
        hunterAcc += m;
        if (hunterAcc >= d.hunter_stride) {
          hunterAcc %= d.hunter_stride;
          if (audible) safePlay("step_hunter", { pos: at(H) });
        }
      }
    }

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
    } else breathT = 0;
    // batimento: mesma fórmula e condição do HUD (hud/hud.ts: toca fora do modo espectador, isto é, com o jogador
    // livre ou preso; hud/spectator.ts `inPlay`); distância a partir do próprio jogador, como lá
    if (P && (P.st === "ok" || P.st === "cage") && dist(P, H) < hb.radius) {
      const dh = dist(P, H);
      heartT -= dt;
      if (heartT <= 0) {
        safePlay("heartbeat", { pos: null, intensity: 1 - dh / hb.radius });
        heartT = hb.base_interval + (dh / hb.radius) * hb.range_interval;
      }
    } else heartT = 0;

    // geradores: zumbido pelo progresso (perto do personagem visto) e conclusão
    g.gens.forEach((x, i) => {
      if (p0 && !p0.done[i] && x.done) safePlay("generator_done", { pos: at(x) });
      if (ear && !x.done && x.n > 0 && dist(ear, x) < d.hum.radius) {
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

  function events(list: readonly GameEvent[], playerId: number | undefined = lastPlayer) {
    if (!enabled) return;
    for (const e of list) {
      if (e.type === "sound") safePlay(e.name, { pos: null });
      // "flash" só sai no golpe recebido pelo jogador (game.ts `hit`: `if (!s.bot) emit flash`): evento crítico
      else if (e.type === "flash") music.duckFor(d.duck_time);
      // pontos (só no v1; `who` = id do sobrevivente, −1 = caçador; packages/sim/src/types.ts): bipe só do local
      else if (e.type === "points" && playerId !== undefined && e.who === playerId) safePlay("points", { pos: null });
    }
  }

  return { enabled, update, events };
}

/** o diretor está ligado (`audio.director_enabled`)? main.ts/hud usam para não tocar os bipes antigos em dobro */
export const directorEnabled = () => balance.audio.director_enabled;

let director: AudioDirector | null = null;
/** um quadro do áudio (singleton; no-op com `audio.director_enabled: false`); `at` = personagem visto */
export function updateAudio(state: GameState, playerId: number, dt: number, at?: Vec) {
  if (!directorEnabled()) return;
  (director ??= createAudioDirector()).update(state, playerId, dt, at);
}
/** eventos do quadro já drenados por main.ts (singleton; no-op com a flag false; não drena a fila) */
export function audioEvents(events: readonly GameEvent[], playerId?: number) {
  if (!directorEnabled()) return;
  (director ??= createAudioDirector()).events(events, playerId);
}
