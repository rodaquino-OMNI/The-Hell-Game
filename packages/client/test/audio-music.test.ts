// Música em camadas (A-2 do V5; GDD-v0.3 §11): troca no limite de compasso, crossfade de crossfade_bars, troca
// repetida e substituída, ducking de audio.ducking_db; relógio simulado com PRNG de semente e contexto falso.
import { describe, expect, it } from "vitest";
import { loadBalanceFile, loadMapFile } from "@thehell/shared/node";
import { createGame, makeConfig, nextRandom } from "@thehell/sim";
import {
  barLength, createMusic, createMusicDirector, createMusicPlanner, dbToGain, nextBarTime, stemUrl,
  type FetchLike, type Music, type MusicDeps, type MusicPlan,
} from "../src/audio/music.ts";
import { MUSIC_STATES, type MusicState } from "../src/audio/musicState.ts";

const root = new URL("../../../", import.meta.url).pathname;
const bal = loadBalanceFile(root + "data/balance.yaml");
const cfg = bal.audio;
const m = cfg.music;
const BAR = barLength(m);
const FADE = m.crossfade_bars * BAR;
const TOL = 1e-9;

/** fração de compasso de t contada a partir de start: 0 (± tolerância) num limite */
const offBar = (t: number, start: number) => { const k = (t - start) / BAR; return Math.abs(k - Math.round(k)); };

// ---------- AudioParam falso que avalia a automação (set, rampa linear, alvo exponencial, cancelamento) ----------
type Ev = { kind: "set" | "ramp"; t: number; v: number } | { kind: "target"; t: number; v: number; tc: number };
class FakeParam {
  events: Ev[] = [];
  calls: unknown[][] = [];
  constructor(public value = 1) {}
  private add(e: Ev) { this.events.push(e); this.events.sort((a, b) => a.t - b.t); }
  setValueAtTime(v: number, t: number) { this.calls.push(["set", v, t]); this.add({ kind: "set", t, v }); }
  linearRampToValueAtTime(v: number, t: number) { this.calls.push(["ramp", v, t]); this.add({ kind: "ramp", t, v }); }
  setTargetAtTime(v: number, t: number, tc: number) { this.calls.push(["target", v, t, tc]); this.add({ kind: "target", t, v, tc }); }
  cancelScheduledValues(t: number) { this.calls.push(["cancel", t]); this.events = this.events.filter(e => e.t < t); }
  /** valor no instante t (semântica do Web Audio para set e rampa linear) */
  at(t: number): number {
    let pv = this.value, pt = 0;
    for (const e of this.events) {
      if (e.t > t) {
        if (e.kind === "ramp") return pv + ((e.v - pv) * (t - pt)) / (e.t - pt);
        break;
      }
      if (e.kind === "target") throw new Error("alvo não avaliado neste teste");
      pv = e.v; pt = e.t;
    }
    return pv;
  }
}
class FakeNode { out: unknown[] = []; connect(n: unknown) { this.out.push(n); return n; } }
class FakeGain extends FakeNode { gain = new FakeParam(1); }
class FakeSource extends FakeNode { buffer: unknown = null; loop = false; started: number[] = []; start(t: number) { this.started.push(t); } }
class FakeCtx {
  currentTime = 3.7;
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  decodeFails = false;
  createGain() { const g = new FakeGain(); this.gains.push(g); return g; }
  createBufferSource() { const s = new FakeSource(); this.sources.push(s); return s; }
  decodeAudioData(b: ArrayBuffer) { return this.decodeFails ? Promise.reject(new Error("EncodingError")) : Promise.resolve({ decoded: b }); }
}
const okFetch = (urls: string[] = []): FetchLike => async u => { urls.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
function setup(fetch: FetchLike = okFetch()) {
  const ctx = new FakeCtx();
  const out = new FakeNode();
  const music = createMusic({ ctx: ctx as unknown as BaseAudioContext, out: out as unknown as AudioNode, cfg, fetch });
  return { ctx, out, music };
}
const stemGain = (ctx: FakeCtx, stem: string) => ctx.gains[1 + m.stems.indexOf(stem as MusicState)].gain;

describe("dados de andamento (decisão do Rodrigo, 09/11/2026)", () => {
  it("compasso = beats_per_bar × 60 / bpm, do YAML", () => {
    expect(m.bpm).toBe(90);
    expect(m.beats_per_bar).toBe(4);
    expect(BAR).toBeCloseTo(8 / 3, 12);
    expect(m.stems).toEqual([...MUSIC_STATES]);
  });
});

describe("nextBarTime (relógio simulado, PRNG com semente)", () => {
  it("1.000 instantes aleatórios: o resultado é o primeiro limite de compasso estritamente depois de now", () => {
    const rng = { seed: 20261109 };
    for (let i = 0; i < 1000; i++) {
      const start = nextRandom(rng) * 50;
      const now = start + nextRandom(rng) * 400;
      const t = nextBarTime(now, start, BAR);
      expect(t).toBeGreaterThan(now);
      expect(t - BAR).toBeLessThanOrEqual(now);
      expect(offBar(t, start)).toBeLessThan(TOL);
    }
    // exatamente no limite: vai para o seguinte; antes do início: o próprio início
    expect(nextBarTime(10 + 3 * BAR, 10, BAR)).toBeCloseTo(10 + 4 * BAR, 12);
    expect(nextBarTime(4, 10, BAR)).toBe(10);
  });
});

describe("planejador: trocas em sequência com relógio simulado", () => {
  it("toda troca cai num limite de compasso, o crossfade dura crossfade_bars, e a automação só muda a partir do limite", () => {
    const rng = { seed: 777 };
    const start = 1.234;
    const p = createMusicPlanner({ stems: m.stems, startTime: start, barLen: BAR, crossfadeBars: m.crossfade_bars, layerGain: m.layer_gain, initial: "ambient" });
    const params: Record<string, FakeParam> = {};
    for (const st of m.stems) params[st] = new FakeParam(p.gainAt(st, start));
    let now = start + nextRandom(rng) * BAR, plans = 0, cancels = 0, repeats = 0;
    let prev: MusicPlan | null = null;
    for (let i = 0; i < 400; i++) {
      now += nextRandom(rng) * 2 * BAR * (nextRandom(rng) < 0.3 ? 0.05 : 1); // às vezes, pedidos dentro do mesmo compasso
      const s = MUSIC_STATES[Math.floor(nextRandom(rng) * MUSIC_STATES.length)];
      const pendingBefore = p.pending(now);
      const expectNull = pendingBefore ? pendingBefore.state === s : p.stateAt(now) === s;
      const old = Object.fromEntries(m.stems.map(st => [st, [0, 0.25, 0.5, 0.75, 1].map(f => params[st].at(now + f * (nextBarTime(now, start, BAR) - now)))]));
      const plan = p.request(s, now);
      if (expectNull) { expect(plan).toBeNull(); repeats++; continue; }
      expect(plan).not.toBeNull();
      const pl = plan!;
      plans++;
      expect(pl.at).toBeGreaterThan(now);
      expect(pl.at - BAR).toBeLessThanOrEqual(now);
      expect(offBar(pl.at, start)).toBeLessThan(TOL);
      expect(pl.end - pl.at).toBeCloseTo(FADE, 9);
      expect(offBar(pl.end, start)).toBeLessThan(1e-6);
      if (pendingBefore) {
        cancels++;
        expect(pl.cancelled).toBe(pendingBefore.state);
        expect(pl.at).toBeCloseTo(pendingBefore.at, 12); // a substituta cai no mesmo limite
      } else expect(pl.cancelled).toBeNull();
      // aplica como o createMusic: limpa a partir de now e reemite
      for (const st of m.stems) {
        const fp = params[st];
        fp.cancelScheduledValues(now);
        for (const a of pl.points[st]) if (a.kind === "set") fp.setValueAtTime(a.v, a.t); else fp.linearRampToValueAtTime(a.v, a.t);
        // de now até o limite, nada muda em relação à automação anterior (troca só no compasso, sem salto)
        [0, 0.25, 0.5, 0.75, 1].forEach((f, j) => expect(fp.at(now + f * (pl.at - now))).toBeCloseTo(old[st][j], 9));
        // o AudioParam falso e o planejador concordam até o fim do crossfade
        for (const f of [0, 0.5, 1]) expect(fp.at(pl.at + f * FADE)).toBeCloseTo(p.gainAt(st, pl.at + f * FADE), 9);
        // no fim do crossfade: só o stem do estado novo soa
        expect(fp.at(pl.end)).toBeCloseTo(st === s ? m.layer_gain : 0, 9);
      }
      prev = pl;
    }
    expect(prev).not.toBeNull();
    // o roteiro aleatório passou pelos três casos
    expect(plans).toBeGreaterThan(100);
    expect(cancels).toBeGreaterThan(5);
    expect(repeats).toBeGreaterThan(5);
  });

  it("crossfade linear: na metade, cada stem está na metade; estado repetido não reagenda; substituída cancela", () => {
    const start = 0;
    const p = createMusicPlanner({ stems: m.stems, startTime: start, barLen: BAR, crossfadeBars: m.crossfade_bars, layerGain: m.layer_gain, initial: "ambient" });
    expect(p.request("ambient", 0.5)).toBeNull();
    const a = p.request("tension", 0.5)!;
    expect(a.at).toBeCloseTo(BAR, 12);
    expect(p.request("tension", 0.9)).toBeNull(); // pendente igual
    expect(p.gainAt("tension", a.at + FADE / 2)).toBeCloseTo(m.layer_gain / 2, 12);
    expect(p.gainAt("ambient", a.at + FADE / 2)).toBeCloseTo(m.layer_gain / 2, 12);
    const b = p.request("chase", 1.0)!; // antes do limite: cancela "tension"
    expect(b.cancelled).toBe("tension");
    expect(p.pending(1.0)?.state).toBe("chase");
    expect(p.gainAt("tension", b.end)).toBe(0);
    expect(p.gainAt("chase", b.end)).toBe(m.layer_gain);
    expect(p.stateAt(b.at)).toBe("chase");
    expect(p.request("chase", b.at + 0.1)).toBeNull(); // já em curso
    // pedido durante o crossfade em curso: o novo limite é o próximo compasso, e o crossfade atual segue linear até ele
    const c = p.request("ambient", b.at + 0.1)!;
    expect(c.cancelled).toBeNull();
    expect(c.at).toBeCloseTo(b.at + BAR, 12);
  });

  it("estado sem stem (YAML com menos de 5): mantém o que toca e cancela a pendente", () => {
    const stems = ["ambient", "tension", "chase"] as const;
    const p = createMusicPlanner({ stems, startTime: 0, barLen: BAR, crossfadeBars: 1, layerGain: 1, initial: "ambient" });
    expect(p.request("rescue", 0.1)).toBeNull();
    p.request("tension", 0.2);
    const r = p.request("rescue", 0.3)!;
    expect(r.cancelled).toBe("tension");
    expect(p.pending(0.3)).toBeNull();
    expect(p.gainAt("ambient", 10)).toBe(1);
  });
});

describe("createMusic com contexto falso", () => {
  it("5 stems em loop, um source e um ganho por stem, todos iniciados no mesmo instante; URLs do contrato com o A-3", async () => {
    const urls: string[] = [];
    const { ctx, out, music } = setup(okFetch(urls));
    expect(music.setState("tension")).toBeNull(); // antes de carregar: só guarda
    expect(await music.loadStems("/base")).toBe(true);
    expect(music.playing).toBe(true);
    expect(urls).toEqual(m.stems.map(s => `/base/audio/music/${s}.mp3`));
    expect(stemUrl("/", "chase")).toBe("/audio/music/chase.mp3");
    const master = ctx.gains[0];
    expect(master.out).toEqual([out]);
    expect(ctx.sources.length).toBe(m.stems.length);
    const t0 = ctx.currentTime + m.start_lead;
    ctx.sources.forEach((s, i) => {
      expect(s.loop).toBe(true);
      expect(s.started).toEqual([t0]);
      expect(s.out).toEqual([ctx.gains[1 + i]]);
      expect(ctx.gains[1 + i].out).toEqual([master]);
      // o estado pedido antes do carregamento é o inicial
      expect(ctx.gains[1 + i].gain.value).toBe(m.stems[i] === "tension" ? m.layer_gain : 0);
    });
    expect(music.planner!.startTime).toBe(t0);
  });

  it("setState agenda nos AudioParams no limite de compasso; repetido não toca nos parâmetros", async () => {
    const { ctx, music } = setup();
    await music.loadStems("/");
    const t0 = music.planner!.startTime;
    ctx.currentTime = t0 + 2.5 * BAR;
    const plan = music.setState("chase")!;
    expect(offBar(plan.at, t0)).toBeLessThan(TOL);
    const g = stemGain(ctx, "chase");
    expect(g.calls[0]).toEqual(["cancel", ctx.currentTime]);
    expect(g.at(plan.at)).toBe(0);
    expect(g.at(plan.end)).toBe(m.layer_gain);
    expect(stemGain(ctx, "ambient").at(plan.end)).toBe(0);
    const n = g.calls.length;
    ctx.currentTime += 0.1;
    expect(music.setState("chase")).toBeNull();
    expect(g.calls.length).toBe(n);
  });

  it("falha de rede, HTTP de erro ou decodificação: música desligada, sem exceção", async () => {
    const bad: FetchLike[] = [
      async () => { throw new TypeError("Failed to fetch"); },
      async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) }),
    ];
    for (const f of bad) {
      const { ctx, music } = setup(f);
      await expect(music.loadStems("/")).resolves.toBe(false);
      expect(music.playing).toBe(false);
      expect(ctx.sources.length).toBe(0);
      expect(() => music.setState("chase")).not.toThrow();
      expect(() => music.duck(true)).not.toThrow();
    }
    const { ctx, music } = setup();
    ctx.decodeFails = true;
    await expect(music.loadStems("/")).resolves.toBe(false);
    expect(music.playing).toBe(false);
  });

  it("ducking: audio.ducking_db no ganho mestre, com ataque e soltura do YAML; duckFor solta no prazo", () => {
    const { ctx, music } = setup();
    const g = ctx.gains[0].gain;
    const duck = dbToGain(cfg.ducking_db);
    expect(duck).toBeCloseTo(10 ** (-8 / 20), 12);
    const now = ctx.currentTime;
    music.duck(true);
    expect(g.calls).toEqual([["cancel", now], ["target", duck, now, m.duck_attack]]);
    g.calls = [];
    music.duck(false);
    expect(g.calls).toEqual([["cancel", now], ["target", 1, now, m.duck_release]]);
    g.calls = [];
    music.duckFor(2);
    expect(g.calls).toEqual([["cancel", now], ["target", duck, now, m.duck_attack], ["target", 1, now + 2, m.duck_release]]);
    g.calls = [];
    ctx.currentTime = now + 1;
    music.duckFor(0.5); // prazo menor que o restante: mantém o mais longo
    expect(g.calls.at(-1)).toEqual(["target", 1, now + 2, m.duck_release]);
  });
});

describe("createMusicDirector (updateMusic)", () => {
  const map = loadMapFile(root + "data/maps/patio.json");
  const sim = makeConfig(bal, map, { ruleset: "v1", hunterBrain: "basic" });

  it("sem contexto não cria nada; com contexto cria uma vez e só chama setState quando o estado muda", () => {
    let ctx: FakeCtx | null = null;
    const made: Music[] = [];
    const calls: MusicState[] = [];
    const d = createMusicDirector({
      context: () => ctx as unknown as BaseAudioContext | null,
      out: () => new FakeNode() as unknown as AudioNode,
      baseUrl: "/",
      cfg,
      make: (deps: MusicDeps) => {
        const mu = createMusic({ ...deps, fetch: okFetch() });
        const set = mu.setState.bind(mu);
        mu.setState = s => { calls.push(s); return set(s); };
        made.push(mu);
        return mu;
      },
    });
    const g = createGame(sim, "Curandeiro", 3);
    g.hunter.x = g.survivors[0].x + 3 * m.tension_radius; g.hunter.target = -1;
    expect(d.update(g, 0)).toBe("ambient");
    expect(d.music).toBeNull();
    ctx = new FakeCtx();
    for (let i = 0; i < 100; i++) d.update(g, 0);
    expect(made.length).toBe(1);
    expect(calls).toEqual(["ambient"]);
    g.hunter.target = 0;
    for (let i = 0; i < 50; i++) d.update(g, 0);
    g.gateStarted = true;
    for (let i = 0; i < 50; i++) d.update(g, 0);
    expect(calls).toEqual(["ambient", "chase", "final_pressure"]);
  });
});
