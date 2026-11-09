// Taxa do AudioContext (A-3 sobre o motor do A-1; GDD-v0.3 §11): o contexto real nasce na taxa dos stems
// (audio.compose.sample_rate), para o decodeAudioData não reamostrar o loop (estalo a 44,1 kHz, tools/audio/check-loop.mjs).
// Fábricas falsas: a opção é passada; se o construtor recusar a opção, cai para o sem opção e depois para o webkit.
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBalanceFile } from "@thehell/shared/node";
import { createAudioContext } from "../src/audio/engine.ts";

const bal = loadBalanceFile(new URL("../../../data/balance.yaml", import.meta.url).pathname);
const RATE = bal.audio.compose.sample_rate;

type Opts = AudioContextOptions | undefined;
/** construtor falso que registra as opções; `rejectOpts` lança se receber opção, `rejectAll` lança sempre */
function fakeCtor(name: string, calls: [string, Opts][], mode: "ok" | "rejectOpts" | "rejectAll" = "ok") {
  return class {
    tag = name;
    sampleRate: number;
    constructor(opts?: AudioContextOptions) {
      calls.push([name, opts]);
      if (mode === "rejectAll" || (mode === "rejectOpts" && opts)) throw new TypeError("não suportado");
      this.sampleRate = opts?.sampleRate ?? 44100;
    }
  } as unknown as new (opts?: AudioContextOptions) => AudioContext;
}
const tagOf = (c: AudioContext | null) => (c as unknown as { tag: string } | null)?.tag;

describe("createAudioContext (taxa dos stems)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("passa sampleRate = audio.compose.sample_rate ao construtor", () => {
    const calls: [string, Opts][] = [];
    const c = createAudioContext(RATE, { AudioContext: fakeCtor("std", calls) });
    expect(calls).toEqual([["std", { sampleRate: RATE }]]);
    expect(c?.sampleRate).toBe(RATE);
  });

  it("construtor que recusa a opção: cai para new AudioContext() sem opção", () => {
    const calls: [string, Opts][] = [];
    const c = createAudioContext(RATE, { AudioContext: fakeCtor("std", calls, "rejectOpts") });
    expect(calls).toEqual([["std", { sampleRate: RATE }], ["std", undefined]]);
    expect(tagOf(c)).toBe("std");
  });

  it("só webkitAudioContext: usa-o com a opção", () => {
    const calls: [string, Opts][] = [];
    const c = createAudioContext(RATE, { webkitAudioContext: fakeCtor("webkit", calls) });
    expect(calls).toEqual([["webkit", { sampleRate: RATE }]]);
    expect(tagOf(c)).toBe("webkit");
  });

  it("AudioContext lança sempre: cai para webkitAudioContext (com opção e, se recusar, sem)", () => {
    const calls: [string, Opts][] = [];
    const c = createAudioContext(RATE, { AudioContext: fakeCtor("std", calls, "rejectAll"), webkitAudioContext: fakeCtor("webkit", calls, "rejectOpts") });
    expect(calls).toEqual([["std", { sampleRate: RATE }], ["std", undefined], ["webkit", { sampleRate: RATE }], ["webkit", undefined]]);
    expect(tagOf(c)).toBe("webkit");
  });

  it("sem Web Audio (ou tudo lança): null, sem exceção", () => {
    expect(createAudioContext(RATE, {})).toBeNull();
    const calls: [string, Opts][] = [];
    expect(createAudioContext(RATE, { AudioContext: fakeCtor("std", calls, "rejectAll") })).toBeNull();
  });

  it("sem o 2º argumento lê globalThis.AudioContext", () => {
    const calls: [string, Opts][] = [];
    vi.stubGlobal("AudioContext", fakeCtor("global", calls));
    expect(tagOf(createAudioContext(RATE))).toBe("global");
    expect(calls).toEqual([["global", { sampleRate: RATE }]]);
  });
});
