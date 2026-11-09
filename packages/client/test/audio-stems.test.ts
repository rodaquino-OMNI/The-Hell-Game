// Stems de música (item A-3 do V5; GDD-v0.3 §11, C-13): os 5 MP3 gerados por tools/audio/compose.ts existem, têm o
// mesmo comprimento em número inteiro de compassos, loudness −16 LUFS ±1 com pico real ≤ −1 dBTP (ffmpeg ebur128) e
// fecham o loop sem degrau. Usa ffmpeg/ffprobe do sistema; sem o binário o bloco é pulado com aviso.
//
// Comprimento: o exato vem da DECODIFICAÇÃO (ffmpeg respeita o atraso e o padding do cabeçalho Xing/LAME, como o
// Chromium, conferido em tools/audio/check-loop.mjs). A duração que o ffprobe informa é quadros × 1152 amostras e inclui
// atraso + padding (mais de 1 quadro aqui, porque o compose.ts codifica pré e pós-rolagem e as marca como padding);
// por isso o ffprobe só confere formato (taxa, canais, bitrate) e que os 5 arquivos informam a mesma duração.
//
// Junção do loop: para cada canal, o degrau |x[0] − x[N−1]| não pode passar do percentil 99,9 dos degraus internos
// |x[i+1] − x[i]|, nem a 2ª diferença na junção passar do percentil 99,9 das internas (|x[i+1] − 2x[i] + x[i−1]|).
// O percentil 99,9 é o "maior degrau interno típico": ignora o 0,1 % de transientes mais fortes (ataques de
// percussão), e um estalo de loop é um degrau isolado muitas vezes acima dele.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadBalanceFile } from "@thehell/shared/node";

const root = new URL("../../../", import.meta.url).pathname;
const bal = loadBalanceFile(root + "data/balance.yaml");
const { music, compose } = bal.audio;
const dir = root + "packages/client/public/audio/music/";
const file = (stem: string) => `${dir}${stem}.mp3`;
const SR = compose.sample_rate;
const BAR = (music.beats_per_bar * 60) / music.bpm;
const EXPECTED = Math.round(compose.loop_bars * BAR * SR);
/** percentil dos degraus internos usado como limiar da junção (ver cabeçalho) */
const QUANTILE = 0.999;
/** folga do teste: tempo de ffmpeg por arquivo em máquina carregada (ms) */
const TIMEOUT = 120_000;

const hasFfmpeg = ["ffmpeg", "ffprobe"].every(b => spawnSync(b, ["-version"]).status === 0);
if (!hasFfmpeg) console.warn("audio-stems: ffmpeg/ffprobe ausente no PATH; testes de loudness e loop PULADOS");

/** PCM float 32 estéreo decodificado pelo ffmpeg (com o descarte gapless do cabeçalho LAME) */
function decode(path: string): Float32Array[] {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", String(SR), "-"], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  const all = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4);
  const n = all.length / 2;
  const ch = [new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) { ch[0][i] = all[2 * i]; ch[1][i] = all[2 * i + 1]; }
  return ch;
}

function ebur128(path: string): { I: number; TP: number } {
  const r = spawnSync("ffmpeg", ["-nostats", "-hide_banner", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
  const s = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
  return {
    I: Number(/I:\s+(-?[\d.]+)\s+LUFS/.exec(s)?.[1]),
    TP: Number(/True peak:\s+Peak:\s+(-?[\d.]+)\s+dBFS/.exec(s)?.[1]),
  };
}

function probe(path: string) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels,bit_rate,duration", "-of", "json", path], { encoding: "utf8" });
  return JSON.parse(r.stdout).streams[0] as { codec_name: string; sample_rate: string; channels: number; bit_rate: string; duration: string };
}

const quantile = (a: Float32Array, p: number) => { const s = Float32Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

/** degrau e 2ª diferença na junção (N−1 → 0) e os percentis internos correspondentes */
function junction(x: Float32Array) {
  const n = x.length;
  const d1 = new Float32Array(n - 1), d2 = new Float32Array(n - 2);
  for (let i = 0; i < n - 1; i++) d1[i] = Math.abs(x[i + 1] - x[i]);
  for (let i = 1; i < n - 1; i++) d2[i - 1] = Math.abs(x[i + 1] - 2 * x[i] + x[i - 1]);
  return {
    step: Math.abs(x[0] - x[n - 1]), stepRef: quantile(d1, QUANTILE),
    curv: Math.max(Math.abs(x[1] - 2 * x[0] + x[n - 1]), Math.abs(x[0] - 2 * x[n - 1] + x[n - 2])), curvRef: quantile(d2, QUANTILE),
  };
}

describe("stems de música (A-3)", () => {
  it("os 5 stems do YAML existem e estão no creditos.csv", () => {
    expect(music.stems.length).toBe(5);
    const csv = readFileSync(root + "packages/client/public/media/creditos.csv", "utf8").split("\n");
    for (const s of music.stems) {
      expect(existsSync(file(s)), file(s)).toBe(true);
      expect(csv.some(l => l.startsWith(`audio/music/${s}.mp3,`)), `crédito de ${s}`).toBe(true);
    }
  });

  it("o loop tem número inteiro de amostras e de compassos", () => {
    expect(EXPECTED).toBe(compose.loop_bars * BAR * SR);
    expect(Number.isInteger(compose.loop_bars)).toBe(true);
  });

  describe.skipIf(!hasFfmpeg)("com ffmpeg", () => {
    const pcm = new Map<string, Float32Array[]>();
    const get = (s: string) => { if (!pcm.has(s)) pcm.set(s, decode(file(s))); return pcm.get(s)!; };

    it("formato: MP3 estéreo na taxa e bitrate do YAML; o ffprobe informa a mesma duração nos 5", () => {
      const durs = music.stems.map(s => {
        const p = probe(file(s));
        expect(p.codec_name).toBe("mp3");
        expect(Number(p.sample_rate)).toBe(SR);
        expect(p.channels).toBe(2);
        expect(Number(p.bit_rate)).toBe(compose.bitrate_kbps * 1000);
        return p.duration;
      });
      expect(new Set(durs).size).toBe(1);
    }, TIMEOUT);

    it("decodificados, os 5 têm exatamente loop_bars compassos a bpm (mesmo comprimento)", () => {
      for (const s of music.stems) {
        const [l, r] = get(s);
        expect(l.length, s).toBe(EXPECTED);
        expect(r.length, s).toBe(EXPECTED);
        const bars = l.length / SR / BAR;
        expect(Math.abs(bars - Math.round(bars)), s).toBeLessThan(1e-9);
        expect(Math.round(bars)).toBe(compose.loop_bars);
      }
    }, TIMEOUT);

    it("loudness −16 LUFS ±1 e pico real ≤ −1 dBTP (ebur128)", () => {
      for (const s of music.stems) {
        const { I, TP } = ebur128(file(s));
        expect(Math.abs(I - bal.audio.loudness_lufs), `${s}: ${I} LUFS`).toBeLessThanOrEqual(bal.audio.loudness_tolerance);
        expect(TP, `${s}: ${TP} dBTP`).toBeLessThanOrEqual(bal.audio.true_peak_dbtp);
      }
    }, TIMEOUT);

    it("loop sem estalo: junção dentro do degrau e da curvatura internos típicos (p99,9)", () => {
      for (const s of music.stems) {
        get(s).forEach((x, c) => {
          const j = junction(x);
          expect(j.step, `${s} canal ${c}: degrau`).toBeLessThanOrEqual(j.stepRef);
          expect(j.curv, `${s} canal ${c}: 2ª diferença`).toBeLessThanOrEqual(j.curvRef);
        });
      }
    }, TIMEOUT);
  });
});
