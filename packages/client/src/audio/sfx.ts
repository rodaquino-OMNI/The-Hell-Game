// Efeitos sonoros sintetizados (item A-5 do V5; GDD-v0.3 §11 e GDD-v0.2 §11). Síntese PS1 pura (decisão do Rodrigo,
// 09/11/2026): cada efeito do catálogo `audio.sfx` (data/balance.yaml) é montado em tempo de execução com osciladores,
// ruído branco, filtros e envelopes; zero arquivos, zero licença. A voz entra pelo áudio espacial do A-4
// (`getSpatial().play(kind, source, { bus, pos })`), que aplica o limite de vozes por prioridade, HRTF e oclusão.
// Por efeito: camadas (osc|noise) → [BiquadFilter] → GainNode do envelope → mixer → spatial.play.
// Sem AudioContext (antes do primeiro gesto ou sem Web Audio) tudo é no-op: playSfx não cria o contexto.
// Valores: data/balance.yaml `audio.sfx`, `audio.sfx_floor_gain`, `audio.noise_seconds`, `audio.noise_seed`.
import type { Balance } from "@thehell/shared";
import { nextRandom } from "@thehell/sim";
import { balance } from "../data.ts";
import { getEngine } from "./engine.ts";
import { getSpatial, type PlayOpts, type SourcePos, type SpatialVoice } from "./spatial.ts";

export type SfxCfg = Pick<Balance["audio"], "sfx" | "sfx_floor_gain" | "noise_seconds" | "noise_seed">;
export type SfxEntry = Balance["audio"]["sfx"][string];
export type SfxLayer = SfxEntry["recipe"][number];

export interface SfxOpts {
  /** posição da fonte (x/z do jogo). Ignorada em efeito `spatial: false`; ausente em efeito espacial = não espacial */
  pos?: SourcePos | null;
  /** 0–1 (padrão 1): interpola `mod.gain` e `mod.pitch` do efeito */
  intensity?: number;
}

/** o pedaço do espacial que os efeitos usam */
export interface SfxSpatial { play(kind: string, source: AudioNode, opts: PlayOpts): SpatialVoice | null }

export interface SfxDeps {
  /** contexto atual, sem criar (padrão: o do motor do A-1) */
  context?: () => BaseAudioContext | null;
  spatial?: SfxSpatial;
  cfg?: SfxCfg;
}

export interface SfxPlayer {
  /** toca o efeito `name`; null sem contexto ou sem vaga de voz. Nome fora do catálogo lança erro */
  play(name: string, opts?: SfxOpts): SpatialVoice | null;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (r: readonly [number, number] | undefined, k: number) => (r ? r[0] + (r[1] - r[0]) * k : 1);
function quiet(f: () => unknown) { try { f(); } catch { /* nó já parado ou contexto fechado */ } }

/** fim (s, a partir do início do efeito) de uma camada: atraso + repetições + ataque + decaimento */
export const layerEnd = (l: SfxLayer) => (l.delay ?? 0) + ((l.repeat ?? 1) - 1) * (l.gap ?? 0) + l.attack + l.decay;
/** duração total da receita (s) */
export const recipeDuration = (e: SfxEntry) => Math.max(...e.recipe.map(layerEnd));

/** ruído branco determinístico (mulberry32 de packages/sim/src/rng.ts com `audio.noise_seed`), um buffer por contexto */
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
export function noiseBuffer(ctx: BaseAudioContext, cfg: Pick<SfxCfg, "noise_seconds" | "noise_seed">): AudioBuffer {
  const hit = noiseCache.get(ctx);
  if (hit) return hit;
  const n = Math.max(1, Math.round(cfg.noise_seconds * ctx.sampleRate));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0), rng = { seed: cfg.noise_seed };
  for (let i = 0; i < n; i++) data[i] = nextRandom(rng) * 2 - 1; // [0, 1) → [−1, 1)
  noiseCache.set(ctx, buf);
  return buf;
}

export interface BuiltSfx {
  /** soma das camadas: é a `source` entregue ao espacial */
  out: GainNode;
  /** fontes com o início e o fim agendados (relógio do contexto) */
  sources: { node: AudioScheduledSourceNode; start: number; stop: number }[];
  nodes: AudioNode[];
  /** instante (relógio do contexto) em que a última camada para */
  end: number;
}

/**
 * Monta o grafo da receita a partir de `t0` (relógio do contexto) sem iniciar as fontes (`start` fica para depois
 * de a voz ganhar vaga). Pura em relação ao estado do módulo: só cria nós no contexto recebido.
 */
export function buildSfx(ctx: BaseAudioContext, e: SfxEntry, t0: number, intensity: number, cfg: SfxCfg): BuiltSfx {
  const k = clamp01(intensity), gainMul = lerp(e.mod?.gain, k), pitch = lerp(e.mod?.pitch, k);
  const floor = cfg.sfx_floor_gain, nyquist = ctx.sampleRate / 2;
  const hz = (f: number) => Math.min(f * pitch, nyquist);
  const out = ctx.createGain();
  const sources: BuiltSfx["sources"] = [], nodes: AudioNode[] = [out];
  let end = t0;
  for (const l of e.recipe) {
    for (let r = 0; r < (l.repeat ?? 1); r++) {
      const t = t0 + (l.delay ?? 0) + r * (l.gap ?? 0), peakAt = t + l.attack, stop = peakAt + l.decay;
      end = Math.max(end, stop);
      let src: AudioScheduledSourceNode;
      if (l.type === "osc") {
        const o = ctx.createOscillator();
        o.type = l.wave!;
        o.frequency.setValueAtTime(hz(l.freq!), t);
        if (l.freq_end !== undefined) o.frequency.exponentialRampToValueAtTime(hz(l.freq_end), stop);
        src = o;
      } else {
        const b = ctx.createBufferSource();
        b.buffer = noiseBuffer(ctx, cfg);
        b.loop = true;
        src = b;
      }
      let head: AudioNode = src;
      if (l.filter) {
        const f = ctx.createBiquadFilter();
        f.type = l.filter;
        f.frequency.setValueAtTime(hz(l.filter_freq!), t);
        if (l.filter_end !== undefined) f.frequency.exponentialRampToValueAtTime(hz(l.filter_end), stop);
        if (l.q !== undefined) f.Q.value = l.q;
        src.connect(f);
        head = f;
        nodes.push(f);
      }
      const g = ctx.createGain(), peak = Math.max(floor, l.gain * gainMul);
      if (l.attack > 0) {
        g.gain.setValueAtTime(floor, t);
        g.gain.linearRampToValueAtTime(peak, peakAt);
      } else g.gain.setValueAtTime(peak, t);
      g.gain.exponentialRampToValueAtTime(floor, stop);
      head.connect(g);
      g.connect(out);
      nodes.push(src, g);
      sources.push({ node: src, start: t, stop });
    }
  }
  return { out, sources, nodes, end };
}

export function createSfx(deps: SfxDeps = {}): SfxPlayer {
  const cfg = deps.cfg ?? balance.audio;
  const context = deps.context ?? (() => getEngine().context);
  const spatial = (): SfxSpatial => deps.spatial ?? getSpatial();
  return {
    play(name, opts = {}) {
      const e = Object.prototype.hasOwnProperty.call(cfg.sfx, name) ? cfg.sfx[name] : undefined;
      if (!e) throw new Error(`efeito desconhecido: "${name}" (audio.sfx)`);
      const ctx = context();
      if (!ctx) return null;
      let built: BuiltSfx;
      try { built = buildSfx(ctx, e, ctx.currentTime, opts.intensity ?? 1, cfg); } catch { return null; }
      const { out, sources, nodes } = built;
      const teardown = () => { for (const n of nodes) quiet(() => n.disconnect()); };
      const stopAll = () => { for (const s of sources) quiet(() => s.node.stop()); teardown(); };
      const pos = e.spatial && opts.pos ? { ...opts.pos } : null;
      let sv: SpatialVoice | null = null;
      try {
        sv = spatial().play(e.kind, out, { bus: e.bus, pos, onSteal: stopAll });
      } catch { sv = null; }
      if (!sv) { teardown(); return null; }
      // a última fonte a parar devolve a vaga e solta o grafo
      const last = sources.reduce((a, s) => (s.stop > a.stop ? s : a));
      last.node.addEventListener?.("ended", () => { sv?.release(); teardown(); });
      for (const s of sources) quiet(() => { s.node.start(s.start); s.node.stop(s.stop); });
      return sv;
    },
  };
}

let player: SfxPlayer | null = null;
/** toca um efeito do catálogo pelo motor (A-1) e espacial (A-4) reais; sem contexto = no-op (null) */
export function playSfx(name: string, opts?: SfxOpts): SpatialVoice | null {
  return (player ??= createSfx()).play(name, opts);
}
