// Stems de música (item A-3 do V5; GDD-v0.3 §11, C-13): os 5 MP3 gerados por tools/audio/compose.ts existem, têm o
// mesmo comprimento em número inteiro de compassos, loudness −16 LUFS ±1 com pico real ≤ −1 dBTP (ffmpeg ebur128) e
// fecham o loop sem degrau. Usa ffmpeg/ffprobe do sistema. Sem o binário: na CI (process.env.CI) o teste FALHA
// (o passo "Áudio: ffmpeg (stems A-3 e loudness A-7)" do ci.yml instala); fora da CI o bloco é pulado com aviso.
//
// Comprimento: o exato vem da DECODIFICAÇÃO (ffmpeg respeita o atraso e o padding do cabeçalho Xing/LAME, como o
// Chromium, conferido em tools/audio/check-loop.mjs). A duração que o ffprobe informa é quadros × 1152 amostras e inclui
// atraso + padding (mais de 1 quadro aqui, porque o compose.ts codifica pré e pós-rolagem e as marca como padding);
// por isso o ffprobe só confere formato (taxa, canais, bitrate) e que os 5 arquivos informam a mesma duração.
//
// Junção do loop: critério LOCAL de tools/audio/junction.mjs (o mesmo do check-loop no Chromium): degrau e 2ª diferença
// na junção ≤ audio.compose.junction_factor × o maior degrau / a maior 2ª diferença em ±junction_window amostras.
// Teste negativo: um estalo sintético de 0,02 (degrau que decai em 100 ms), nos dois sentidos, em cada canal de cada
// stem, tem de reprovar.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadBalanceFile } from "@thehell/shared/node";
import { circular, junctionOk, junctionStats } from "../../../tools/audio/junction.mjs";
import { hasBinaries, measureLoudness } from "../../../tools/audio/ebur128.mjs";

const root = new URL("../../../", import.meta.url).pathname;
const bal = loadBalanceFile(root + "data/balance.yaml");
const { music, compose } = bal.audio;
const dir = root + "packages/client/public/audio/music/";
const file = (stem: string) => `${dir}${stem}.mp3`;
const SR = compose.sample_rate;
const BAR = (music.beats_per_bar * 60) / music.bpm;
const EXPECTED = Math.round(compose.loop_bars * BAR * SR);
/** estalo sintético do teste negativo: amplitude do degrau e duração (amostras) do decaimento linear até 0 */
const CLICK = 0.02, CLICK_DECAY = Math.round(0.1 * SR);
/** folga do teste: tempo de ffmpeg por arquivo em máquina carregada (ms) */
const TIMEOUT = 120_000;

const hasFfmpeg = hasBinaries(["ffmpeg", "ffprobe"]);
const inCI = !!process.env.CI;
if (!hasFfmpeg && !inCI) console.warn("audio-stems: ffmpeg/ffprobe ausente no PATH; testes de loudness e loop PULADOS (fora da CI)");

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

function probe(path: string) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels,bit_rate,duration", "-of", "json", path], { encoding: "utf8" });
  return JSON.parse(r.stdout).streams[0] as { codec_name: string; sample_rate: string; channels: number; bit_rate: string; duration: string };
}

const judge = (x: Float32Array) => junctionOk(junctionStats(circular(x), compose.junction_window), compose.junction_factor);
/** cópia com um degrau de `amp` na junção (soma em x[0] e decai linearmente até 0 em CLICK_DECAY amostras) */
const withClick = (x: Float32Array, amp: number) => {
  const y = x.slice();
  for (let i = 0; i < CLICK_DECAY; i++) y[i] += amp * (1 - i / CLICK_DECAY);
  return y;
};

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

  it.runIf(!hasFfmpeg && inCI)("na CI o ffmpeg/ffprobe é obrigatório", () => {
    expect.fail("ffmpeg/ffprobe ausente no PATH com CI definido: os testes de loudness e loop dos stems não podem ser pulados (instale com apt-get install ffmpeg)");
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
        const { I, TP } = measureLoudness(file(s));
        expect(Math.abs(I - bal.audio.loudness_lufs), `${s}: ${I} LUFS`).toBeLessThanOrEqual(bal.audio.loudness_tolerance);
        expect(TP, `${s}: ${TP} dBTP`).toBeLessThanOrEqual(bal.audio.true_peak_dbtp);
      }
    }, TIMEOUT);

    it("loop sem estalo: junção dentro do degrau e da curvatura locais (junction_window, junction_factor)", () => {
      for (const s of music.stems) {
        get(s).forEach((x, c) => {
          const j = judge(x);
          expect(j.stepRatio, `${s} canal ${c}: degrau`).toBeLessThanOrEqual(compose.junction_factor);
          expect(j.curvRatio, `${s} canal ${c}: 2ª diferença`).toBeLessThanOrEqual(compose.junction_factor);
        });
      }
    }, TIMEOUT);

    it("teste negativo: estalo sintético de 0,02 na junção reprova (nos dois sentidos, em todo canal de todo stem)", () => {
      for (const s of music.stems) {
        get(s).forEach((x, c) => {
          for (const sign of [1, -1]) expect(judge(withClick(x, sign * CLICK)).ok, `${s} canal ${c}, estalo ${sign * CLICK}`).toBe(false);
        });
      }
    }, TIMEOUT);
  });
});
