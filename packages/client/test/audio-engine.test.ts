// Motor de áudio (A-1 do V5; GDD v0.3 §11): grafo de barramentos, volume padrão do YAML, persistência com atraso,
// desbloqueio e retomada, e os bipes da fase 0 pelo barramento sfx; AudioContext e storage falsos (Node não tem Web Audio).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadBalanceFile } from "@thehell/shared/node";
import { BUSES, createEngine, GESTURES, STORAGE_KEY, useEngine, type VolumeName, type VolumeStorage } from "../src/audio/engine.ts";
import { beep, initAudio, SOUNDS } from "../src/audio/beeps.ts";

const bal = loadBalanceFile(new URL("../../../data/balance.yaml", import.meta.url).pathname);
const cfg = bal.audio;
const delayMs = cfg.volume_persist_delay * 1000;

class FakeNode {
  out: unknown[] = [];
  connect(n: unknown) { this.out.push(n); return n; }
}
class FakeParam {
  value = 1;
  calls: [string, ...number[]][] = [];
  cancelScheduledValues(t: number) { this.calls.push(["cancel", t]); }
  setValueAtTime(v: number, t: number) { this.calls.push(["set", v, t]); this.value = v; }
  setTargetAtTime(v: number, t: number, tc: number) { this.calls.push(["target", v, t, tc]); this.value = v; }
  exponentialRampToValueAtTime(v: number, t: number) { this.calls.push(["exp", v, t]); }
}
class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeOsc extends FakeNode {
  frequency = new FakeParam();
  started = 0; stopped = 0;
  start() { this.started++; }
  stop() { this.stopped++; }
}
class FakeCtx extends EventTarget {
  state: string = "suspended";
  currentTime = 5;
  destination = new FakeNode();
  gains: FakeGain[] = [];
  oscs: FakeOsc[] = [];
  failGainAt = -1;
  resume = vi.fn(async () => { this.setState("running"); });
  close = vi.fn(async () => { this.state = "closed"; });
  setState(s: string) { this.state = s; this.dispatchEvent(new Event("statechange")); }
  createGain() {
    if (this.gains.length === this.failGainAt) throw new Error("falha ao montar o grafo");
    const g = new FakeGain(); this.gains.push(g); return g;
  }
  createOscillator() { const o = new FakeOsc(); this.oscs.push(o); return o; }
}
const fakeFactory = () => {
  const made: FakeCtx[] = [];
  return { made, createContext: () => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; } };
};
const memStorage = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  const setItem = vi.fn((k: string, v: string) => { m.set(k, v); });
  return { m, setItem, getItem: (k: string) => m.get(k) ?? null } satisfies VolumeStorage & { m: Map<string, string> };
};
const asFake = (n: unknown) => n as FakeGain;
/** gesto "real": em Node isTrusted fica no protótipo de Event, então dá para marcar a instância (no navegador não) */
const gesture = (type: string) => Object.defineProperty(new Event(type), "isTrusted", { value: true });

describe("grafo de barramentos", () => {
  it("4 barramentos (music, sfx, voice, ui) ligados ao master, e o master ao destino", () => {
    const f = fakeFactory();
    const e = createEngine({ createContext: f.createContext, storage: null, cfg });
    expect(f.made.length).toBe(0); // nada é criado sem pedir
    const ctx = e.ensure() as unknown as FakeCtx;
    expect(f.made.length).toBe(1);
    expect(e.ensure()).toBe(ctx as unknown as AudioContext);
    const master = ctx.gains[0];
    expect(master.out).toEqual([ctx.destination]);
    expect(BUSES).toEqual(["music", "sfx", "voice", "ui"]);
    for (const b of BUSES) {
      const n = asFake(e.busInput(b));
      expect(n).toBeInstanceOf(FakeGain);
      expect(n.out).toEqual([master]);
    }
    expect(new Set(BUSES.map(b => e.busInput(b))).size).toBe(4);
    expect(ctx.gains.length).toBe(5);
  });

  it("volume padrão vem de audio.buses do YAML e é o ganho inicial dos nós", () => {
    const e = createEngine({ createContext: fakeFactory().createContext, storage: memStorage(), cfg });
    expect(e.volumes()).toEqual(cfg.buses);
    const ctx = e.ensure() as unknown as FakeCtx;
    expect(ctx.gains[0].gain.value).toBe(cfg.buses.master);
    for (const b of BUSES) expect(asFake(e.busInput(b)).gain.value).toBe(cfg.buses[b]);
    for (const v of Object.values(cfg.buses)) expect(v >= 0 && v <= 1).toBe(true);
  });

  it("falha na criação ou na montagem do grafo fecha o contexto parcial e permite nova tentativa", async () => {
    let n = 0;
    const made: FakeCtx[] = [];
    const createContext = () => {
      n++;
      if (n === 1) throw new Error("NotSupportedError");
      const c = new FakeCtx();
      if (n === 2) c.failGainAt = 2; // lança no meio do grafo
      made.push(c);
      return c as unknown as AudioContext;
    };
    const e = createEngine({ createContext, storage: null, cfg });
    expect(e.ensure()).toBeNull();
    expect(e.ensure()).toBeNull();
    expect(made[0].close).toHaveBeenCalledTimes(1);
    expect(e.busInput("sfx")).not.toBeNull(); // 3ª tentativa
    expect(e.context).toBe(made[1] as unknown as AudioContext);
    // close() que rejeita também não quebra
    const bad = new FakeCtx(); bad.failGainAt = 0; bad.close.mockImplementationOnce(async () => { throw new Error("x"); });
    const e2 = createEngine({ createContext: () => bad as unknown as AudioContext, storage: null, cfg });
    expect(e2.ensure()).toBeNull();
    await Promise.resolve();
    expect(bad.close).toHaveBeenCalledTimes(1);
  });
});

describe("setBusVolume", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("limita a [0, 1] e aplica cancel + set do valor atual + setTargetAtTime(audio.volume_ramp_tc)", () => {
    const e = createEngine({ createContext: fakeFactory().createContext, storage: null, cfg });
    const ctx = e.ensure() as unknown as FakeCtx;
    expect(e.setBusVolume("music", 1.7)).toBe(1);
    expect(e.setBusVolume("sfx", -3)).toBe(0);
    expect(e.setBusVolume("ui", Number.NaN)).toBe(cfg.buses.ui);
    const voice = asFake(e.busInput("voice")).gain;
    voice.value = 0.8; // valor no meio de uma rampa anterior
    expect(e.setBusVolume("voice", 0.25)).toBe(0.25);
    const t = ctx.currentTime;
    expect(voice.calls).toEqual([["cancel", t], ["set", 0.8, t], ["target", 0.25, t, cfg.volume_ramp_tc]]);
    expect(e.setBusVolume("master", 0.5)).toBe(0.5);
    expect(ctx.gains[0].gain.calls.at(-1)).toEqual(["target", 0.5, t, cfg.volume_ramp_tc]);
    expect(e.getBusVolume("music")).toBe(1);
    expect(e.getBusVolume("sfx")).toBe(0);
  });

  it("nome inválido em runtime: ignora, devolve NaN e não grava", () => {
    const s = memStorage();
    const e = createEngine({ createContext: fakeFactory().createContext, storage: s, cfg });
    const before = e.volumes();
    expect(e.setBusVolume("trilha" as VolumeName, 0.5)).toBeNaN();
    expect(e.getBusVolume("trilha" as VolumeName)).toBeNaN();
    expect(e.busInput("trilha" as never)).toBeNull();
    expect(e.volumes()).toEqual(before);
    vi.advanceTimersByTime(delayMs * 2);
    expect(s.setItem).not.toHaveBeenCalled();
  });

  it("grava com atraso de audio.volume_persist_delay (uma gravação por rajada) e um motor novo lê de volta", () => {
    const s = memStorage();
    const a = createEngine({ createContext: fakeFactory().createContext, storage: s, cfg });
    a.setBusVolume("music", 0.9); a.setBusVolume("music", 0.3); a.setBusVolume("ui", 0.6);
    expect(a.getBusVolume("music")).toBe(0.3); // memória atualiza na hora
    expect(s.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(delayMs - 1);
    expect(s.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(s.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(s.m.get(STORAGE_KEY)!)).toMatchObject({ music: 0.3, ui: 0.6 });
    const b = createEngine({ createContext: fakeFactory().createContext, storage: s, cfg });
    expect(b.getBusVolume("music")).toBe(0.3);
    expect(b.getBusVolume("ui")).toBe(0.6);
    expect(b.getBusVolume("sfx")).toBe(cfg.buses.sfx);
    expect(asFake(b.busInput("music")).gain.value).toBe(0.3);
  });

  it("flushVolumes() grava na hora e cancela a gravação agendada; sem pendência não grava", () => {
    const s = memStorage();
    const e = createEngine({ createContext: () => null, storage: s, cfg });
    e.flushVolumes();
    expect(s.setItem).not.toHaveBeenCalled();
    e.setBusVolume("sfx", 0.4);
    e.flushVolumes();
    expect(s.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(s.m.get(STORAGE_KEY)!).sfx).toBe(0.4);
    vi.advanceTimersByTime(delayMs * 2);
    expect(s.setItem).toHaveBeenCalledTimes(1);
  });

  it("storage que lança exceção não quebra (leitura, escrita agendada e flush)", () => {
    const bad: VolumeStorage = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceeded"); } };
    const e = createEngine({ createContext: fakeFactory().createContext, storage: bad, cfg });
    expect(e.volumes()).toEqual(cfg.buses);
    expect(() => e.setBusVolume("sfx", 0.4)).not.toThrow();
    expect(() => vi.advanceTimersByTime(delayMs)).not.toThrow();
    e.setBusVolume("sfx", 0.5);
    expect(() => e.flushVolumes()).not.toThrow();
    expect(e.getBusVolume("sfx")).toBe(0.5);
  });

  it("JSON corrompido ou com tipos errados cai no padrão do YAML (chave a chave, com limite de faixa)", () => {
    expect(createEngine({ storage: memStorage({ [STORAGE_KEY]: "{não é json" }), cfg, createContext: () => null }).volumes()).toEqual(cfg.buses);
    expect(createEngine({ storage: memStorage({ [STORAGE_KEY]: "42" }), cfg, createContext: () => null }).volumes()).toEqual(cfg.buses);
    const mixed = createEngine({ storage: memStorage({ [STORAGE_KEY]: JSON.stringify({ music: "alto", sfx: 9, voice: null, ui: 0.2 }) }), cfg, createContext: () => null });
    expect(mixed.volumes()).toEqual({ ...cfg.buses, sfx: 1, ui: 0.2 });
  });
});

describe("sem Web Audio", () => {
  it("fábrica que devolve null ou lança: tudo vira no-op, sem exceção", async () => {
    for (const createContext of [() => null, () => { throw new Error("sem AudioContext"); }]) {
      const e = createEngine({ createContext, storage: null, cfg });
      expect(e.ensure()).toBeNull();
      expect(e.busInput("sfx")).toBeNull();
      expect(e.state()).toBe("none");
      await expect(e.unlock()).resolves.toBeUndefined();
      expect(e.setBusVolume("music", 0.5)).toBe(0.5);
    }
  });

  it("o padrão (sem fábrica injetada) em Node não tem AudioContext e não lança", () => {
    expect(typeof (globalThis as { AudioContext?: unknown }).AudioContext).toBe("undefined");
    const e = createEngine({ storage: null, cfg });
    expect(e.ensure()).toBeNull();
    expect(e.state()).toBe("none");
  });
});

describe("desbloqueio no gesto e retomada", () => {
  it("ouve pointerdown, pointerup, touchend, click e keydown", () => {
    expect([...GESTURES].sort()).toEqual(["click", "keydown", "pointerdown", "pointerup", "touchend"]);
  });

  it.each(GESTURES)("%s cria o contexto e chama resume(); os ouvintes saem quando ele fica running", async ev => {
    const f = fakeFactory();
    const e = createEngine({ createContext: f.createContext, storage: null, cfg });
    const t = new EventTarget();
    e.installUnlock(t);
    e.installUnlock(t); // instalar de novo não duplica
    expect(e.state()).toBe("none");
    t.dispatchEvent(gesture(ev));
    await vi.waitFor(() => expect(e.state()).toBe("running"));
    expect(f.made.length).toBe(1);
    expect(f.made[0].resume).toHaveBeenCalledTimes(1);
    for (const g of GESTURES) t.dispatchEvent(gesture(g));
    await Promise.resolve();
    expect(f.made[0].resume).toHaveBeenCalledTimes(1);
  });

  it("evento sintético (isTrusted false, como o .click() do menu) não cria nem retoma o contexto", async () => {
    const f = fakeFactory();
    const e = createEngine({ createContext: f.createContext, storage: null, cfg });
    const t = new EventTarget();
    e.installUnlock(t);
    for (const g of GESTURES) t.dispatchEvent(new Event(g));
    await Promise.resolve();
    expect(f.made.length).toBe(0);
    expect(e.state()).toBe("none");
    t.dispatchEvent(gesture("click"));
    await vi.waitFor(() => expect(e.state()).toBe("running"));
  });

  it("resume recusado mantém os ouvintes para o próximo gesto", async () => {
    const f = fakeFactory();
    const e = createEngine({ createContext: f.createContext, storage: null, cfg });
    const t = new EventTarget();
    e.installUnlock(t);
    e.ensure();
    const ctx = f.made[0];
    ctx.resume.mockImplementationOnce(async () => { throw new Error("NotAllowedError"); });
    t.dispatchEvent(gesture("keydown"));
    await vi.waitFor(() => expect(ctx.resume).toHaveBeenCalledTimes(1));
    expect(e.state()).toBe("suspended");
    t.dispatchEvent(gesture("click"));
    await vi.waitFor(() => expect(e.state()).toBe("running"));
    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it.each(["suspended", "interrupted"])("contexto %s depois de rodar: tenta resume() e reinstala os ouvintes de gesto", async s => {
    const f = fakeFactory();
    const e = createEngine({ createContext: f.createContext, storage: null, cfg });
    const t = new EventTarget();
    e.installUnlock(t);
    t.dispatchEvent(gesture("pointerup"));
    await vi.waitFor(() => expect(e.state()).toBe("running"));
    const ctx = f.made[0];
    // a tentativa imediata é recusada (sem gesto); o gesto seguinte retoma
    ctx.resume.mockImplementationOnce(async () => { throw new Error("NotAllowedError"); });
    ctx.setState(s);
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(e.state()).toBe(s);
    t.dispatchEvent(gesture("touchend"));
    await vi.waitFor(() => expect(e.state()).toBe("running"));
    expect(ctx.resume).toHaveBeenCalledTimes(3);
    // de novo running: ouvintes saíram
    t.dispatchEvent(gesture("keydown"));
    await Promise.resolve();
    expect(ctx.resume).toHaveBeenCalledTimes(3);
  });

  it("suspensão antes de ter rodado não chama resume() sozinho (espera o gesto)", () => {
    const f = fakeFactory();
    const e = createEngine({ createContext: f.createContext, storage: null, cfg });
    e.ensure();
    f.made[0].setState("suspended");
    expect(f.made[0].resume).not.toHaveBeenCalled();
  });

  it("unlock() direto (initAudio no start da partida) cria e resume", async () => {
    const f = fakeFactory();
    const e = createEngine({ createContext: f.createContext, storage: null, cfg });
    await e.unlock();
    expect(e.state()).toBe("running");
    await e.unlock();
    expect(f.made[0].resume).toHaveBeenCalledTimes(1); // já running: não chama de novo
  });
});

describe("bipes da fase 0 (beeps.ts) pelo barramento sfx", () => {
  afterEach(() => { useEngine(null); });

  it("beep() antes de existir contexto é silencioso e não cria contexto", () => {
    const f = fakeFactory();
    const e = createEngine({ createContext: f.createContext, storage: null, cfg });
    useEngine(e);
    expect(() => beep(...SOUNDS.hit)).not.toThrow();
    expect(f.made.length).toBe(0);
    expect(e.plays().sfx).toBe(0);
  });

  it("depois de initAudio(), o bipe liga o oscilador num ganho conectado ao busInput('sfx')", async () => {
    const f = fakeFactory();
    const e = createEngine({ createContext: f.createContext, storage: null, cfg });
    useEngine(e);
    initAudio();
    await vi.waitFor(() => expect(e.state()).toBe("running"));
    beep(...SOUNDS.puzzle_ok);
    const ctx = f.made[0];
    expect(ctx.oscs.length).toBe(1);
    const osc = ctx.oscs[0];
    const env = osc.out[0] as FakeGain;
    expect(env).toBeInstanceOf(FakeGain);
    expect(env.out).toEqual([e.busInput("sfx")]);
    expect(osc.started).toBe(1);
    expect(osc.stopped).toBe(1);
    expect(e.plays()).toEqual({ music: 0, sfx: 1, voice: 0, ui: 0 });
  });

  it("sem Web Audio, initAudio() e beep() não lançam", () => {
    useEngine(createEngine({ createContext: () => null, storage: null, cfg }));
    expect(() => { initAudio(); beep(...SOUNDS.bolt); }).not.toThrow();
  });
});
