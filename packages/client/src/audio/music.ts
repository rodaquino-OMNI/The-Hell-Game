// Música adaptativa em camadas (item A-2 do V5; GDD-v0.3 §11 e GDD-v0.2 §11): 5 stems em loop, iniciados no mesmo
// instante; a troca de camada começa no início do compasso seguinte e faz crossfade linear de
// `audio.music.crossfade_bars` compassos; ducking de `audio.ducking_db` no ganho mestre da música.
// O agendamento é puro (nextBarTime + createMusicPlanner) e testável com relógio simulado; createMusic só traduz o
// plano em chamadas de AudioParam. Valores: data/balance.yaml `audio.music.*` e `audio.ducking_db`.
import type { Balance } from "@thehell/shared";
import type { GameState } from "@thehell/sim";
import { balance } from "../data.ts";
import { getBusInput, getEngine } from "./engine.ts";
import { musicStateFor, type MusicState } from "./musicState.ts";

export type MusicCfg = Pick<Balance["audio"], "music" | "ducking_db" | "compose">;

/** duração de um compasso em segundos: beats_per_bar × 60 / bpm (60 = segundos por minuto) */
export const barLength = (m: Pick<MusicCfg["music"], "bpm" | "beats_per_bar">) => (m.beats_per_bar * 60) / m.bpm;

/**
 * Início do próximo compasso estritamente depois de `now`, contando compassos a partir de `startTime`. Antes do
 * início, o próprio `startTime`. Sempre devolve `startTime + k × barLen` com k inteiro (o limite exato).
 */
export function nextBarTime(now: number, startTime: number, barLen: number): number {
  if (now < startTime) return startTime;
  let k = Math.floor((now - startTime) / barLen) + 1;
  // correção de ponto flutuante: o limite devolvido tem de ser > now e o anterior ≤ now
  while (startTime + (k - 1) * barLen > now) k--;
  while (startTime + k * barLen <= now) k++;
  return startTime + k * barLen;
}

/** decibéis para ganho linear (amplitude: 20·log10) */
export const dbToGain = (db: number) => 10 ** (db / 20);

/** ponto de automação de um AudioParam: "set" = setValueAtTime, "ramp" = linearRampToValueAtTime */
export interface AutomationPoint { kind: "set" | "ramp"; t: number; v: number }
/** troca agendada: estado, início (limite de compasso), fim do crossfade e automação de cada stem a partir de `now` */
export interface MusicPlan {
  state: MusicState;
  now: number;
  at: number;
  end: number;
  /** a troca pendente anterior (ainda não iniciada) foi cancelada por esta */
  cancelled: MusicState | null;
  points: Record<string, AutomationPoint[]>;
}

/** trecho linear do ganho de um stem: v0 em t0 até v1 em t1, constante fora */
interface Segment { t0: number; v0: number; t1: number; v1: number }
const valueOf = (s: Segment, t: number) => {
  if (t <= s.t0) return s.v0;
  if (t >= s.t1) return s.v1;
  return s.v0 + ((s.v1 - s.v0) * (t - s.t0)) / (s.t1 - s.t0);
};

export interface PlannerOpts {
  stems: readonly string[];
  startTime: number;
  barLen: number;
  crossfadeBars: number;
  layerGain: number;
  initial: MusicState;
}

export interface MusicPlanner {
  readonly startTime: number;
  readonly barLen: number;
  /** pede o estado `s` no instante `now`; null se nada muda (estado repetido) */
  request(s: MusicState, now: number): MusicPlan | null;
  /** estado já iniciado em `now` (a troca pendente conta a partir do seu limite de compasso) */
  stateAt(now: number): MusicState;
  /** troca agendada e ainda não iniciada em `now` */
  pending(now: number): MusicPlan | null;
  /** ganho previsto de um stem no instante t (considera a troca pendente) */
  gainAt(stem: string, t: number): number;
}

/**
 * Planejador puro. Cada stem tem um trecho linear "firmado" (a última troca já iniciada) e, no máximo, uma troca
 * pendente. Pedido novo antes do limite da pendente a cancela e volta ao trecho firmado; depois do limite, a pendente
 * vira firmada. A automação reemitida a cada pedido reproduz o trecho firmado entre `now` e o novo limite (inclusive
 * um crossfade em andamento), para o AudioParam poder ser limpo com cancelScheduledValues(now) sem salto.
 */
export function createMusicPlanner(o: PlannerOpts): MusicPlanner {
  const fade = o.crossfadeBars * o.barLen;
  const target = (stem: string, s: MusicState) => (stem === s ? o.layerGain : 0);
  let seg: Record<string, Segment> = {};
  for (const st of o.stems) { const v = target(st, o.initial); seg[st] = { t0: o.startTime, v0: v, t1: o.startTime, v1: v }; }
  let current: MusicState = o.initial;
  let pend: { plan: MusicPlan; seg: Record<string, Segment> } | null = null;

  /** firma a pendente se o seu limite já passou */
  const settle = (now: number) => {
    if (pend && now >= pend.plan.at) { current = pend.plan.state; seg = pend.seg; pend = null; }
  };

  return {
    startTime: o.startTime,
    barLen: o.barLen,
    request(s, now) {
      settle(now);
      if (pend ? pend.plan.state === s : current === s) return null;
      const cancelled = pend ? pend.plan.state : null;
      pend = null;
      // sem stem para o estado: mantém o que toca (o YAML pode ter só 3 a 5 stems, GDD-v0.2 §11)
      if (!o.stems.includes(s)) return cancelled === null ? null : makeRevert(now, cancelled);
      const at = nextBarTime(now, o.startTime, o.barLen), end = at + fade;
      const next: Record<string, Segment> = {};
      const points: Record<string, AutomationPoint[]> = {};
      for (const st of o.stems) {
        const cur = seg[st], vNow = valueOf(cur, now), vAt = valueOf(cur, at);
        const p: AutomationPoint[] = [{ kind: "set", t: now, v: vNow }];
        // quebra do trecho firmado entre now e o limite (fim de um crossfade com crossfade_bars fracionário)
        if (cur.t1 > now && cur.t1 < at) p.push({ kind: "ramp", t: cur.t1, v: cur.v1 });
        p.push({ kind: "ramp", t: at, v: vAt });
        const v1 = target(st, s);
        p.push(fade > 0 ? { kind: "ramp", t: end, v: v1 } : { kind: "set", t: at, v: v1 });
        points[st] = p;
        next[st] = { t0: at, v0: vAt, t1: end, v1 };
      }
      const plan: MusicPlan = { state: s, now, at, end, cancelled, points };
      pend = { plan, seg: next };
      return plan;
    },
    stateAt(now) { return pend && now >= pend.plan.at ? pend.plan.state : current; },
    pending(now) { return pend && now < pend.plan.at ? pend.plan : null; },
    gainAt(stem, t) {
      const s = pend && t >= pend.plan.at ? pend.seg[stem] : seg[stem];
      return s ? valueOf(s, t) : 0;
    },
  };

  /** cancelamento sem troca nova (estado pedido sem stem): devolve a automação do trecho firmado */
  function makeRevert(now: number, cancelled: MusicState): MusicPlan {
    const points: Record<string, AutomationPoint[]> = {};
    for (const st of o.stems) {
      const cur = seg[st], p: AutomationPoint[] = [{ kind: "set", t: now, v: valueOf(cur, now) }];
      if (cur.t1 > now) p.push({ kind: "ramp", t: cur.t1, v: cur.v1 });
      points[st] = p;
    }
    return { state: current, now, at: now, end: now, cancelled, points };
  }
}

/** trecho do buffer decodificado que é o loop (segundos) e como foi achado */
export interface LoopRegion {
  /** "exact": o decodificador respeitou o cabeçalho LAME (buffer = loop); "lead": buffer com o atraso do MP3 e a
   *  pré-rolagem do A-3 no começo, loop recortado com loopStart/loopEnd; "unknown": comprimento inesperado */
  kind: "exact" | "lead" | "unknown";
  loopStart: number;
  loopEnd: number;
}

/**
 * Onde está o loop num buffer de `length` amostras a `sampleRate` Hz. O Chromium descarta o atraso e o padding gravados
 * no cabeçalho LAME e devolve exatamente loop_bars compassos (tools/audio/check-loop.mjs). Um decodificador que ignore
 * o cabeçalho devolve antes do loop o atraso do MP3 (audio.compose.mp3_lead) e a pré-rolagem do A-3
 * (audio.compose.gapless_preroll), amostras à taxa audio.compose.sample_rate; o loop começa depois deles.
 * LACUNA (F5-05): Safari (WebKit) e Firefox não verificados; este é o caminho de proteção.
 */
export function loopRegion(length: number, sampleRate: number, cfg: Pick<MusicCfg, "music" | "compose">): LoopRegion {
  const loopSec = cfg.compose.loop_bars * barLength(cfg.music);
  const expected = Math.round(loopSec * sampleRate);
  if (length === expected) return { kind: "exact", loopStart: 0, loopEnd: loopSec };
  const lead = (cfg.compose.mp3_lead + cfg.compose.gapless_preroll) / cfg.compose.sample_rate;
  if (length >= Math.round((lead + loopSec) * sampleRate)) return { kind: "lead", loopStart: lead, loopEnd: lead + loopSec };
  return { kind: "unknown", loopStart: 0, loopEnd: length / sampleRate };
}

/** subconjunto do fetch que o carregamento usa */
export type FetchLike = (url: string) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface MusicDeps {
  ctx: BaseAudioContext;
  out: AudioNode;
  cfg?: MusicCfg;
  /** relógio em segundos; padrão: ctx.currentTime */
  clock?: () => number;
  fetch?: FetchLike;
  /** aviso de comprimento inesperado (uma vez por instância); padrão: console.warn */
  warn?: (msg: string) => void;
}

export interface Music {
  /** busca e decodifica `audio/music/<stem>.mp3` e inicia os stems juntos; false (sem exceção) se falhar */
  loadStems(baseUrl: string): Promise<boolean>;
  /** agenda a troca para o início do próximo compasso (estado repetido não reagenda) */
  setState(s: MusicState): MusicPlan | null;
  /** estado pedido por último */
  readonly state: MusicState;
  /** música tocando (stems carregados e iniciados) */
  readonly playing: boolean;
  /** ducking de `audio.ducking_db` ligado (sem prazo) ou desligado */
  duck(on: boolean): void;
  /** ducking por `s` segundos a partir de agora (estende um ducking por prazo em curso) */
  duckFor(s: number): void;
  readonly planner: MusicPlanner | null;
  /** nó de ganho mestre da música (onde o ducking atua) */
  readonly master: GainNode;
}

/** caminho do stem relativo à base (contrato com o A-3) */
export const stemUrl = (baseUrl: string, stem: string) => `${baseUrl.replace(/\/?$/, "/")}audio/music/${stem}.mp3`;

export function createMusic(deps: MusicDeps): Music {
  const { ctx, out } = deps;
  const cfg = deps.cfg ?? balance.audio;
  const m = cfg.music;
  const clock = deps.clock ?? (() => ctx.currentTime);
  const doFetch: FetchLike | undefined = deps.fetch ?? (typeof fetch === "function" ? (u => fetch(u)) : undefined);
  const master = ctx.createGain();
  master.connect(out);
  const gains: Record<string, GainNode> = {};
  let planner: MusicPlanner | null = null;
  let desired: MusicState = "ambient";
  let ducked = false;
  let duckUntil = -Infinity;
  const duckGain = dbToGain(cfg.ducking_db);
  const warn = deps.warn ?? ((msg: string) => console.warn(msg));
  let warned = false;

  const apply = (plan: MusicPlan) => {
    for (const st of Object.keys(plan.points)) {
      const p = gains[st]?.gain;
      if (!p) continue;
      p.cancelScheduledValues(plan.now);
      for (const a of plan.points[st]) {
        if (a.kind === "set") p.setValueAtTime(a.v, a.t); else p.linearRampToValueAtTime(a.v, a.t);
      }
    }
  };

  const applyDuck = (now: number) => {
    const g = master.gain;
    g.cancelScheduledValues(now);
    if (ducked || duckUntil > now) {
      g.setTargetAtTime(duckGain, now, m.duck_attack);
      if (!ducked) g.setTargetAtTime(1, duckUntil, m.duck_release);
    } else g.setTargetAtTime(1, now, m.duck_release);
  };

  async function loadStems(baseUrl: string): Promise<boolean> {
    if (planner) return true;
    try {
      if (!doFetch) return false;
      const buffers = await Promise.all(m.stems.map(async st => {
        const r = await doFetch(stemUrl(baseUrl, st));
        if (!r.ok) throw new Error(`HTTP ${st}`);
        return ctx.decodeAudioData(await r.arrayBuffer());
      }));
      const startTime = clock() + m.start_lead;
      const p = createMusicPlanner({
        stems: m.stems, startTime, barLen: barLength(m), crossfadeBars: m.crossfade_bars, layerGain: m.layer_gain, initial: desired,
      });
      m.stems.forEach((st, i) => {
        const g = ctx.createGain();
        g.gain.value = p.gainAt(st, startTime);
        g.connect(master);
        const src = ctx.createBufferSource();
        const buf = buffers[i];
        src.buffer = buf;
        src.loop = true;
        src.connect(g);
        // proteção contra decodificador que ignora o cabeçalho LAME (ver loopRegion)
        const region = typeof buf?.length === "number" && typeof buf?.sampleRate === "number" ? loopRegion(buf.length, buf.sampleRate, cfg) : null;
        if (region?.kind === "lead") {
          src.loopStart = region.loopStart;
          src.loopEnd = region.loopEnd;
          src.start(startTime, region.loopStart);
        } else {
          if (region?.kind === "unknown" && !warned) {
            warned = true;
            warn(`música: ${st}.mp3 decodificado com ${buf.length} amostras a ${buf.sampleRate} Hz, fora do esperado; o loop pode estalar ou sair do compasso`);
          }
          src.start(startTime);
        }
        gains[st] = g;
      });
      planner = p;
      return true;
    } catch {
      // rede ou decodificação falhou: música desligada, em silêncio
      return false;
    }
  }

  return {
    loadStems,
    setState(s) {
      desired = s;
      if (!planner) return null;
      const plan = planner.request(s, clock());
      if (plan) apply(plan);
      return plan;
    },
    get state() { return desired; },
    get playing() { return planner !== null; },
    duck(on) {
      ducked = on;
      if (!on) duckUntil = -Infinity;
      applyDuck(clock());
    },
    duckFor(s) {
      const now = clock();
      duckUntil = Math.max(duckUntil, now + s);
      applyDuck(now);
    },
    get planner() { return planner; },
    master,
  };
}

// ---------- alto nível: o laço do jogo chama updateMusic(state, playerId) a cada quadro ----------

export interface MusicDirectorDeps {
  /** contexto já existente (não cria: o AudioContext nasce no gesto, A-1) */
  context: () => BaseAudioContext | null;
  out: () => AudioNode | null;
  baseUrl: string;
  cfg?: Balance["audio"];
  make?: (d: MusicDeps) => Music;
}

export interface MusicDirector {
  update(state: GameState, playerId: number): MusicState;
  readonly music: Music | null;
}

export function createMusicDirector(d: MusicDirectorDeps): MusicDirector {
  const cfg = d.cfg ?? balance.audio;
  const make = d.make ?? createMusic;
  let music: Music | null = null;
  let last: MusicState | null = null;
  return {
    update(state, playerId) {
      const s = musicStateFor(state, playerId, cfg.music);
      if (!music) {
        const ctx = d.context();
        const out = ctx ? d.out() : null;
        if (ctx && out) {
          music = make({ ctx, out, cfg });
          void music.loadStems(d.baseUrl);
          last = null;
        }
      }
      if (music && s !== last) { music.setState(s); last = s; }
      return s;
    },
    get music() { return music; },
  };
}

let director: MusicDirector | null = null;
/** singleton com o motor do A-1 e a base do Vite; barato por quadro (só chama setState quando o estado muda) */
export function updateMusic(state: GameState, playerId: number): MusicState {
  director ??= createMusicDirector({
    context: () => getEngine().context,
    out: () => getBusInput("music"),
    baseUrl: import.meta.env.BASE_URL,
  });
  return director.update(state, playerId);
}

/** ducking da música do singleton por `s` segundos (A-5: eventos críticos); no-op antes de a música existir */
export function duckMusic(s: number) {
  director?.music?.duckFor(s);
}
