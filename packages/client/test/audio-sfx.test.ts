// Catálogo de efeitos sintetizados (A-5 do V5; GDD-v0.3 §11, GDD-v0.2 §11; síntese PS1 pura, decisão do Rodrigo
// de 09/11/2026): schema, cada receita monta nós válidos num AudioContext falso que aplica as regras da Web Audio,
// voz pelo espacial do A-4 (kind, barramento, espacial ou não), intensidade, no-op sem contexto e a fachada SOUNDS.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BalanceSchema, type GameMap } from "@thehell/shared";
import { loadBalanceFile } from "@thehell/shared/node";
import { SOUNDS, SOUND_NAMES } from "../src/audio/beeps.ts";
import { DIRECTOR_SFX } from "../src/audio/director.ts";
import { createEngine } from "../src/audio/engine.ts";
import { buildSfx, createSfx, recipeDuration } from "../src/audio/sfx.ts";
import { createSpatial } from "../src/audio/spatial.ts";
import { FakeBufferSource, FakeContext, FakeGain, FakeOsc, FakeScheduled } from "../src/audio/testing/fake-webaudio.ts";
import { createVoiceManager } from "../src/audio/voices.ts";

const bal = loadBalanceFile(new URL("../../../data/balance.yaml", import.meta.url).pathname);
const raw = JSON.parse(readFileSync(new URL("../../shared/generated/balance.json", import.meta.url), "utf8"));
const patio = JSON.parse(readFileSync(new URL("../../../data/maps/patio.json", import.meta.url), "utf8")) as GameMap;
const A = bal.audio;
const names = Object.keys(A.sfx);

function rig(max = A.max_voices) {
  const ctx = new FakeContext();
  const engine = createEngine({ createContext: () => ctx as unknown as AudioContext, storage: null, cfg: A });
  engine.ensure();
  const voices = createVoiceManager({ max, priorities: A.voice_priority, now: () => ctx.currentTime });
  const spatial = createSpatial({ engine, map: patio, cfg: A, voices });
  const sfx = createSfx({ context: () => ctx as unknown as BaseAudioContext, spatial, cfg: A });
  return { ctx, engine, voices, spatial, sfx };
}
const clone = () => JSON.parse(JSON.stringify(raw));

describe("audio/sfx: catálogo em dados (A-5)", () => {
  it("o catálogo passa no schema e tem os efeitos mínimos do A-5 (o que o diretor e audioEvents tocam)", () => {
    expect(() => BalanceSchema.parse(raw)).not.toThrow();
    for (const n of [...DIRECTOR_SFX, ...SOUND_NAMES]) expect(names, n).toContain(n);
    for (const n of names) expect(A.voice_priority, `${n}.kind`).toHaveProperty(A.sfx[n].kind);
    expect(A.director_enabled).toBe(false); // D-32: desligado até a ligação em main.ts e os stems do A-3
  });

  it("o schema recusa receita mal formada e kind fora de voice_priority", () => {
    const bad = (f: (b: ReturnType<typeof clone>) => void) => { const b = clone(); f(b); return BalanceSchema.safeParse(b).success; };
    expect(bad(b => { delete b.audio.sfx.hit.recipe[0].freq; })).toBe(false);                 // osc sem freq
    expect(bad(b => { b.audio.sfx.hit.kind = "grito"; })).toBe(false);                         // kind desconhecido
    expect(bad(b => { b.audio.sfx.hit.recipe[0].wave = "pulse"; })).toBe(false);               // onda inválida
    expect(bad(b => { b.audio.sfx.hit.recipe = []; })).toBe(false);                            // sem camada
    expect(bad(b => { b.audio.sfx.hit.recipe[1].freq = 100; })).toBe(false);                   // ruído com freq
    expect(bad(b => { delete b.audio.sfx.cage.recipe[1].gap; })).toBe(false); // repeat sem gap
    expect(bad(b => { b.audio.sfx.hit.recipe[0].gain = 2; })).toBe(false);                     // ganho > 1
    expect(bad(b => { b.audio.director_enabled = "sim"; })).toBe(false);
  });

  it("os 4 telegraphs têm assinaturas distintas (tipo das camadas, onda, repetições)", () => {
    const sig = (n: string) => JSON.stringify(A.sfx[n].recipe.map(l => [l.type, l.wave ?? l.filter, l.repeat ?? 1]));
    const sigs = ["melee", "dash", "projectile", "trap"].map(k => sig(`telegraph_${k}`));
    expect(new Set(sigs).size).toBe(4);
    for (const k of ["melee", "dash", "projectile", "trap"]) {
      const e = A.sfx[`telegraph_${k}`];
      expect(e.kind).toBe("telegraph");
      expect(e.spatial).toBe(true);
    }
  });
});

describe("audio/sfx: síntese no contexto falso (A-5)", () => {
  it.each(names)("%s: monta e agenda os nós sem erro, em intensidade 0, ½ e 1, e devolve a vaga no fim", name => {
    const e = A.sfx[name];
    for (const intensity of [0, 0.5, 1]) {
      const { ctx, engine, voices, sfx } = rig();
      ctx.currentTime = 2;
      const v = sfx.play(name, { pos: { x: 3, z: 4 }, intensity })!;
      expect(v).not.toBeNull();
      expect(v.voice.kind).toBe(e.kind);
      expect(v.bus).toBe(e.bus);
      expect(v.panner === null).toBe(!e.spatial); // espacial → panner HRTF; senão direto no barramento (pos null)
      expect(engine.plays()[e.bus]).toBe(1);
      const want = e.recipe.reduce((n, l) => n + (l.repeat ?? 1), 0);
      const srcs = ctx.created.filter((n): n is FakeScheduled => n instanceof FakeScheduled);
      expect(srcs.length).toBe(want);
      expect(srcs.filter(s => s instanceof FakeOsc).length).toBe(e.recipe.filter(l => l.type === "osc").reduce((n, l) => n + (l.repeat ?? 1), 0));
      expect(srcs.filter(s => s instanceof FakeBufferSource).length).toBe(want - srcs.filter(s => s instanceof FakeOsc).length);
      for (const s of srcs) {
        expect(s.startAt).toBeGreaterThanOrEqual(2);
        expect(s.stopAt!).toBeGreaterThan(s.startAt!);
        expect(s.stopAt!).toBeLessThanOrEqual(2 + recipeDuration(e) + 1e-9);
      }
      // envelope de cada camada termina no piso (sem estalo) e nunca passa de 1
      for (const g of ctx.created.filter((n): n is FakeGain => n instanceof FakeGain)) {
        if (!g.gain.calls.length) continue;
        expect(g.gain.calls.at(-1)).toEqual(["exp", A.sfx_floor_gain, expect.any(Number)]);
        expect(Math.max(...g.gain.calls.map(c => c[1]))).toBeLessThanOrEqual(1);
      }
      expect(voices.count).toBe(1);
      ctx.advance(2 + recipeDuration(e));
      expect(voices.count).toBe(0);
    }
  });

  it("sem AudioContext é no-op e não cria contexto", () => {
    let made = 0;
    const engine = createEngine({ createContext: () => { made++; return null; }, storage: null, cfg: A });
    const sfx = createSfx({ context: () => engine.context, spatial: createSpatial({ engine, map: patio, cfg: A }), cfg: A });
    expect(sfx.play("hit")).toBeNull();
    expect(sfx.play("telegraph_dash", { pos: { x: 0, z: 0 } })).toBeNull();
    expect(made).toBe(0);
  });

  it("nome fora do catálogo lança erro (digitação errada não toca calada)", () => {
    expect(() => rig().sfx.play("grito")).toThrow(/audio\.sfx/);
  });

  it("efeito espacial sem pos toca não espacial; efeito não espacial ignora pos", () => {
    const { sfx } = rig();
    expect(sfx.play("rescue")!.panner).toBeNull();
    expect(sfx.play("rescue", { pos: { x: 1, z: 1 } })!.pos).toMatchObject({ x: 1, z: 1 });
    expect(sfx.play("step_walk", { pos: { x: 1, z: 1 } })!.pos).toBeNull();
  });

  it("intensidade: mod.pitch e mod.gain (zumbido 2× mais agudo e mais alto com progresso cheio)", () => {
    const ctx = new FakeContext(), e = A.sfx.generator_hum;
    const lo = buildSfx(ctx as unknown as BaseAudioContext, e, 0, 0, A), hi = buildSfx(ctx as unknown as BaseAudioContext, e, 0, 1, A);
    const f = (b: typeof lo) => (b.sources[0].node as unknown as FakeOsc).frequency.calls[0][1];
    expect(f(hi) / f(lo)).toBeCloseTo(e.mod!.pitch![1] / e.mod!.pitch![0], 9);
    const peak = (b: typeof lo) => Math.max(...b.nodes.filter((n): n is AudioNode & FakeGain => n instanceof FakeGain).flatMap(g => g.gain.calls.map(c => c[1])));
    expect(peak(hi)).toBeGreaterThan(peak(lo));
  });

  it("voz de efeito roubada para as fontes; o telegraph (prioridade máxima) toma a vaga de um passo", () => {
    const { ctx, sfx } = rig(1);
    const step = sfx.play("step_walk")!;
    const srcs = ctx.created.filter((n): n is FakeScheduled => n instanceof FakeScheduled);
    const tel = sfx.play("telegraph_melee", { pos: { x: 0, z: 5 } });
    expect(tel).not.toBeNull();
    expect(step.voice.active).toBe(false);
    expect(srcs.every(s => s.stopAt !== null)).toBe(true);
    expect(sfx.play("step_walk")).toBeNull(); // passo não derruba telegraph
  });

  it("o ruído é determinístico (mesma semente, mesmo buffer) e fica em [−1, 1)", () => {
    const a = buildSfx(new FakeContext() as unknown as BaseAudioContext, A.sfx.step_walk, 0, 1, A);
    const b = buildSfx(new FakeContext() as unknown as BaseAudioContext, A.sfx.step_walk, 0, 1, A);
    const da = (a.sources[0].node as unknown as FakeBufferSource).buffer!.getChannelData(0);
    const db = (b.sources[0].node as unknown as FakeBufferSource).buffer!.getChannelData(0);
    expect(da.length).toBe(Math.round(A.noise_seconds * 48000));
    expect(Array.from(da.slice(0, 64))).toEqual(Array.from(db.slice(0, 64)));
    expect(Math.min(...da.slice(0, 4096))).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...da.slice(0, 4096))).toBeLessThan(1);
  });
});

describe("audio/beeps: fachada da fase 0 sobre o catálogo (A-5)", () => {
  it("SOUNDS = 1ª camada do catálogo, com os valores do protótipo", () => {
    expect(SOUNDS).toEqual({ puzzle_ok: [660, 0.1, 0.2], puzzle_fail: [120, 0.25, 0.3], hit: [90, 0.2, 0.4], stun: [200, 0.15, 0.3], bolt: [300, 0.12, 0.3] });
  });
  it("o batimento do catálogo é o duplo bipe do HUD (55 Hz e, 0,16 s depois, 48 Hz)", () => {
    const [a, b] = A.sfx.heartbeat.recipe;
    expect([a.freq, a.decay, a.gain, b.freq, b.delay, b.decay, b.gain]).toEqual([55, 0.12, 0.35, 48, 0.16, 0.12, 0.25]);
  });
});
