// Proteção do loop no music.ts (A-3 sobre o A-2; GDD-v0.3 §11, C-13): se o decodificador ignorar o cabeçalho LAME
// (Safari/Firefox não verificados, LACUNA F5-05), o buffer vem com o atraso do MP3 e a pré-rolagem no começo; o loop é
// recortado com loopStart/loopEnd a partir de audio.compose.mp3_lead + gapless_preroll. Comprimento sem explicação:
// um console.warn por instância. Contexto falso.
import { describe, expect, it } from "vitest";
import { loadBalanceFile } from "@thehell/shared/node";
import { barLength, createMusic, loopRegion, type FetchLike } from "../src/audio/music.ts";

const bal = loadBalanceFile(new URL("../../../data/balance.yaml", import.meta.url).pathname);
const cfg = bal.audio;
const c = cfg.compose;
const LOOP = c.loop_bars * barLength(cfg.music);
const LEAD = (c.mp3_lead + c.gapless_preroll) / c.sample_rate;

class FakeParam { value = 1; setValueAtTime() {} linearRampToValueAtTime() {} setTargetAtTime() {} cancelScheduledValues() {} }
class FakeNode { connect(n: unknown) { return n; } }
class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeSource extends FakeNode {
  buffer: unknown = null; loop = false; loopStart = 0; loopEnd = 0;
  starts: [number, number | undefined][] = [];
  start(t: number, offset?: number) { this.starts.push([t, offset]); }
}
class FakeCtx {
  currentTime = 1;
  sources: FakeSource[] = [];
  constructor(private buf: { length: number; sampleRate: number }) {}
  createGain() { return new FakeGain(); }
  createBufferSource() { const s = new FakeSource(); this.sources.push(s); return s; }
  decodeAudioData() { return Promise.resolve(this.buf); }
}
const okFetch: FetchLike = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

async function load(length: number, sampleRate: number) {
  const ctx = new FakeCtx({ length, sampleRate });
  const warns: string[] = [];
  const m = createMusic({ ctx: ctx as unknown as BaseAudioContext, out: new FakeNode() as unknown as AudioNode, cfg, fetch: okFetch, warn: w => warns.push(w) });
  expect(await m.loadStems("/")).toBe(true);
  return { ctx, warns };
}

describe("loopRegion", () => {
  it("comprimento exato (cabeçalho LAME respeitado): o buffer inteiro, a 48 e a 44,1 kHz", () => {
    expect(loopRegion(Math.round(LOOP * c.sample_rate), c.sample_rate, cfg)).toEqual({ kind: "exact", loopStart: 0, loopEnd: LOOP });
    expect(loopRegion(Math.round(LOOP * 44100), 44100, cfg).kind).toBe("exact");
  });
  it("buffer com atraso + pré-rolagem: loop começa em (mp3_lead + gapless_preroll) / sample_rate", () => {
    const n = Math.round((LEAD + LOOP) * c.sample_rate) + c.gapless_postroll + 1152;
    const r = loopRegion(n, c.sample_rate, cfg);
    expect(r.kind).toBe("lead");
    expect(r.loopStart).toBeCloseTo(LEAD, 12);
    expect(r.loopEnd - r.loopStart).toBeCloseTo(LOOP, 12);
    // a outra taxa (reamostrado): o mesmo trecho em segundos
    expect(loopRegion(Math.round((LEAD + LOOP) * 44100) + 2000, 44100, cfg)).toEqual(r);
  });
  it("comprimento inexplicável (menor que o loop, ou entre o loop e loop + atraso): unknown", () => {
    expect(loopRegion(1000, c.sample_rate, cfg).kind).toBe("unknown");
    expect(loopRegion(Math.round(LOOP * c.sample_rate) + 10, c.sample_rate, cfg).kind).toBe("unknown");
  });
});

describe("createMusic com contexto falso", () => {
  it("exato: loop = buffer inteiro, start sem deslocamento, sem aviso", async () => {
    const { ctx, warns } = await load(Math.round(LOOP * c.sample_rate), c.sample_rate);
    expect(ctx.sources).toHaveLength(cfg.music.stems.length);
    for (const s of ctx.sources) { expect(s.loop).toBe(true); expect(s.loopStart).toBe(0); expect(s.loopEnd).toBe(0); expect(s.starts[0][1]).toBeUndefined(); }
    expect(warns).toEqual([]);
  });
  it("decodificador que ignora o cabeçalho: loopStart/loopEnd no trecho certo e start a partir de loopStart", async () => {
    const { ctx, warns } = await load(Math.round((LEAD + LOOP) * c.sample_rate) + 4000, c.sample_rate);
    const t0 = ctx.sources[0].starts[0][0];
    for (const s of ctx.sources) {
      expect(s.loopStart).toBeCloseTo(LEAD, 12);
      expect(s.loopEnd).toBeCloseTo(LEAD + LOOP, 12);
      expect(s.starts).toEqual([[t0, s.loopStart]]);
    }
    expect(warns).toEqual([]);
  });
  it("comprimento inesperado: toca o buffer como veio e avisa uma vez só (5 stems)", async () => {
    const { ctx, warns } = await load(12345, c.sample_rate);
    expect(ctx.sources).toHaveLength(5);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("12345");
  });
});
