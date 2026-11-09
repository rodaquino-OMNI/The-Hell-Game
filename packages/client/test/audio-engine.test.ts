// Motor de áudio (A-1 do V5; GDD v0.3 §11): grafo de barramentos, volume padrão do YAML, persistência e desbloqueio,
// com AudioContext e storage falsos (Node não tem Web Audio).
import { describe, expect, it, vi } from "vitest";
import { loadBalanceFile } from "@thehell/shared/node";
import { BUSES, createEngine, STORAGE_KEY, type VolumeStorage } from "../src/audio/engine.ts";

const bal = loadBalanceFile(new URL("../../../data/balance.yaml", import.meta.url).pathname);
const cfg = bal.audio;

class FakeNode {
  out: unknown[] = [];
  connect(n: unknown) { this.out.push(n); return n; }
}
class FakeGain extends FakeNode {
  ramps: [number, number, number][] = [];
  gain = { value: 1, setTargetAtTime: (v: number, t: number, tc: number) => { this.ramps.push([v, t, tc]); this.gain.value = v; } };
}
class FakeCtx {
  state: AudioContextState = "suspended";
  currentTime = 5;
  destination = new FakeNode();
  gains: FakeGain[] = [];
  resume = vi.fn(async () => { this.state = "running"; });
  createGain() { const g = new FakeGain(); this.gains.push(g); return g; }
}
const fakeFactory = () => {
  const made: FakeCtx[] = [];
  return { made, createContext: () => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; } };
};
const memStorage = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } } satisfies VolumeStorage & { m: Map<string, string> };
};

describe("grafo de barramentos", () => {
  it("4 barramentos (music, sfx, voice, ui) ligados ao master, e o master ao destino", () => {
    const f = fakeFactory();
    const e = createEngine({ createContext: f.createContext, storage: null, cfg });
    expect(f.made.length).toBe(0); // nada é criado sem pedir
    const ctx = e.ensure() as unknown as FakeCtx;
    expect(f.made.length).toBe(1);
    expect(e.ensure()).toBe(ctx as unknown as AudioContext); // singleton dentro do motor
    const master = ctx.gains[0];
    expect(master.out).toEqual([ctx.destination]);
    expect(BUSES).toEqual(["music", "sfx", "voice", "ui"]);
    for (const b of BUSES) {
      const n = e.busInput(b) as unknown as FakeGain;
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
    for (const b of BUSES) expect((e.busInput(b) as unknown as FakeGain).gain.value).toBe(cfg.buses[b]);
    // os padrões do YAML não estão fora da faixa 0–1
    for (const v of Object.values(cfg.buses)) expect(v >= 0 && v <= 1).toBe(true);
  });
});

describe("setBusVolume", () => {
  it("limita a [0, 1], aplica com rampa de audio.volume_ramp_tc e ignora valor não finito", () => {
    const e = createEngine({ createContext: fakeFactory().createContext, storage: null, cfg });
    const ctx = e.ensure() as unknown as FakeCtx;
    expect(e.setBusVolume("music", 1.7)).toBe(1);
    expect(e.setBusVolume("sfx", -3)).toBe(0);
    expect(e.setBusVolume("voice", 0.25)).toBe(0.25);
    expect(e.setBusVolume("master", 0.5)).toBe(0.5);
    expect(e.setBusVolume("ui", Number.NaN)).toBe(cfg.buses.ui);
    expect(e.getBusVolume("music")).toBe(1);
    expect(e.getBusVolume("sfx")).toBe(0);
    expect((e.busInput("voice") as unknown as FakeGain).ramps).toEqual([[0.25, ctx.currentTime, cfg.volume_ramp_tc]]);
    expect(ctx.gains[0].ramps).toEqual([[0.5, ctx.currentTime, cfg.volume_ramp_tc]]);
  });

  it("grava no storage e um motor novo lê de volta; antes do contexto o valor vale como ganho inicial", () => {
    const s = memStorage();
    const a = createEngine({ createContext: fakeFactory().createContext, storage: s, cfg });
    a.setBusVolume("music", 0.3); a.setBusVolume("ui", 0.6);
    expect(JSON.parse(s.m.get(STORAGE_KEY)!)).toMatchObject({ music: 0.3, ui: 0.6 });
    const b = createEngine({ createContext: fakeFactory().createContext, storage: s, cfg });
    expect(b.getBusVolume("music")).toBe(0.3);
    expect(b.getBusVolume("ui")).toBe(0.6);
    expect(b.getBusVolume("sfx")).toBe(cfg.buses.sfx);
    expect((b.busInput("music") as unknown as FakeGain).gain.value).toBe(0.3);
  });

  it("storage que lança exceção não quebra (leitura, escrita e acesso)", () => {
    const bad: VolumeStorage = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceeded"); } };
    const e = createEngine({ createContext: fakeFactory().createContext, storage: bad, cfg });
    expect(e.volumes()).toEqual(cfg.buses);
    expect(() => e.setBusVolume("sfx", 0.4)).not.toThrow();
    expect(e.getBusVolume("sfx")).toBe(0.4);
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

describe("desbloqueio no gesto", () => {
  it("pointerdown cria o contexto e chama resume(); os ouvintes saem quando ele fica running", async () => {
    const f = fakeFactory();
    const e = createEngine({ createContext: f.createContext, storage: null, cfg });
    const t = new EventTarget();
    e.installUnlock(t);
    e.installUnlock(t); // instalar de novo não duplica
    expect(e.state()).toBe("none");
    t.dispatchEvent(new Event("pointerdown"));
    await vi.waitFor(() => expect(e.state()).toBe("running"));
    expect(f.made.length).toBe(1);
    expect(f.made[0].resume).toHaveBeenCalledTimes(1);
    t.dispatchEvent(new Event("keydown"));
    t.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    expect(f.made[0].resume).toHaveBeenCalledTimes(1);
  });

  it("keydown também desbloqueia; resume recusado mantém o ouvinte para o próximo gesto", async () => {
    const f = fakeFactory();
    const e = createEngine({ createContext: f.createContext, storage: null, cfg });
    const t = new EventTarget();
    e.installUnlock(t);
    e.ensure();
    const ctx = f.made[0];
    ctx.resume.mockImplementationOnce(async () => { throw new Error("NotAllowedError"); });
    t.dispatchEvent(new Event("keydown"));
    await vi.waitFor(() => expect(ctx.resume).toHaveBeenCalledTimes(1));
    expect(e.state()).toBe("suspended");
    t.dispatchEvent(new Event("keydown"));
    await vi.waitFor(() => expect(e.state()).toBe("running"));
    expect(ctx.resume).toHaveBeenCalledTimes(2);
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
