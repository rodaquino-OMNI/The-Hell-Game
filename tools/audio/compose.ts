// Composição procedural dos 5 stems de música (item A-3 do V5; GDD-v0.3 §11; docs/handoff/plano-audio-v5.md §2 e §4).
// 1. abre o Chromium (Playwright) e renderiza cada stem com OfflineAudioContext (tools/audio/synth.browser.js),
//    estéreo, na taxa audio.compose.sample_rate, já com a cauda somada no início (loop sem estalo);
// 2. masteriza em Node: ganho para audio.loudness_lufs integrado e, se preciso, limitador circular (respeita a junção
//    do loop) para o pico real ficar ≤ audio.true_peak_dbtp − audio.compose.true_peak_margin_db; medição com
//    ffmpeg `ebur128=peak=true`;
// 3. grava o WAV (float 32) em diretório temporário, imprime o sha256 (prova de determinismo) e converte para MP3
//    (libmp3lame, audio.compose.bitrate_kbps) em packages/client/public/audio/music/<stem>.mp3, com pré/pós-rolagem
//    do próprio loop marcadas como atraso/padding no cabeçalho LAME (ver PRE/POST): a decodificação devolve exatamente
//    o loop e a junção sai sem estalo (conferido no Chromium por tools/audio/check-loop.mjs).
// A loudness é ajustada no MP3 decodificado (o arquivo entregue), não no WAV: o MP3 mede ~0,4 LU abaixo do WAV.
// Uso: pnpm exec tsx tools/audio/compose.ts [--wav-dir DIR] [--out DIR] [--preview ARQ.mp3] [--no-mp3]
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBalanceFile } from "../../packages/shared/src/node.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");

const root = fileURLToPath(new URL("../../", import.meta.url));
const bal = loadBalanceFile(root + "data/balance.yaml");
const { music, compose } = bal.audio;
const target = bal.audio.loudness_lufs;
const ceiling = bal.audio.true_peak_dbtp - compose.true_peak_margin_db;

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const wavDir = arg("--wav-dir", join(tmpdir(), "thehell-compose"))!;
const outDir = arg("--out", root + "packages/client/public/audio/music")!;
const preview = arg("--preview");
const writeMp3 = !process.argv.includes("--no-mp3");
mkdirSync(wavDir, { recursive: true });
if (writeMp3) mkdirSync(outDir, { recursive: true });

const sr = compose.sample_rate;
const barSec = (music.beats_per_bar * 60) / music.bpm;
const loopSamples = Math.round(barSec * compose.loop_bars * sr);

// ---------- WAV e medição ----------
/** WAV IEEE float 32 bits, estéreo intercalado (cabeçalho fixo: mesmo PCM → mesmos bytes) */
function wavBytes(ch: Float32Array[]): Buffer {
  const n = ch[0].length, nc = ch.length, data = n * nc * 4;
  const b = Buffer.alloc(44 + data);
  b.write("RIFF", 0); b.writeUInt32LE(36 + data, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(nc, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * nc * 4, 28); b.writeUInt16LE(nc * 4, 32); b.writeUInt16LE(32, 34);
  b.write("data", 36); b.writeUInt32LE(data, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) { b.writeFloatLE(ch[c][i], o); o += 4; }
  return b;
}

interface Loudness { I: number; TP: number }
/** loudness integrado (LUFS) e pico real (dBTP) pelo filtro ebur128 do ffmpeg (o resumo sai em stderr) */
function measure(file: string): Loudness {
  const r = spawnSync("ffmpeg", ["-nostats", "-hide_banner", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("ffmpeg ebur128 falhou: " + r.stderr);
  const err = r.stderr;
  const summary = err.slice(err.lastIndexOf("Summary:"));
  const I = Number(/I:\s+(-?[\d.]+|-inf)\s+LUFS/.exec(summary)?.[1]);
  const TP = Number(/True peak:\s+Peak:\s+(-?[\d.]+|-inf)\s+dBFS/.exec(summary)?.[1]);
  if (!Number.isFinite(I) || !Number.isFinite(TP)) throw new Error("resumo do ebur128 ilegível:\n" + summary);
  return { I, TP };
}

// ---------- masterização ----------
/**
 * Limitador de pico circular (o sinal é um loop: a janela e a recuperação dão a volta na junção, então o ganho em
 * x[N−1] e em x[0] é contínuo). Ganho pedido por amostra = min(1, teto/|x|); mínimo em ±W (antecipação), média
 * móvel em ±W/2 (a média de valores ≤ ganho do pico continua ≤, sem degrau) e recuperação exponencial.
 */
function limit(ch: Float32Array[], ceilLin: number): Float32Array[] {
  const n = ch[0].length;
  const W = Math.round(0.004 * sr), H = W >> 1;
  const rel = Math.exp(-1 / (0.12 * sr));
  const req = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let a = 0;
    for (const c of ch) a = Math.max(a, Math.abs(c[i]));
    req[i] = a > ceilLin ? ceilLin / a : 1;
  }
  // mínimo móvel circular em [i−W, i+W] (deque monotônico sobre o sinal duplicado)
  const m = new Float64Array(n);
  {
    const idx: number[] = [];
    let head = 0;
    for (let j = -2 * W; j < n + W; j++) {
      const v = req[((j % n) + n) % n];
      while (idx.length > head && req[((idx[idx.length - 1] % n) + n) % n] >= v) idx.pop();
      idx.push(j);
      const i = j - W;
      if (i >= 0) {
        while (idx[head] < i - W) head++;
        m[i] = req[((idx[head] % n) + n) % n];
      }
    }
  }
  // média móvel circular em [i−H, i+H]
  const avg = new Float64Array(n);
  let s = 0;
  for (let j = -H; j <= H; j++) s += m[((j % n) + n) % n];
  for (let i = 0; i < n; i++) {
    avg[i] = s / (2 * H + 1);
    s += m[(i + H + 1) % n] - m[((i - H) % n + n) % n];
  }
  // recuperação: desce na hora (já suavizado), sobe com constante de tempo; duas voltas para o estado fechar no loop
  const g = new Float64Array(n);
  let st = 1;
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) { st = avg[i] < st ? avg[i] : avg[i] + (st - avg[i]) * rel; g[i] = st; }
  return ch.map(c => { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = c[i] * g[i]; return o; });
}

const scale = (ch: Float32Array[], k: number) => ch.map(c => c.map(v => v * k));


/** ganho (dB) + limitador opcional com teto em dBFS de amostra */
const apply = (raw: Float32Array[], gainDb: number, limDb: number | null) => {
  const pcm = scale(raw, 10 ** (gainDb / 20));
  return limDb === null ? pcm : limit(pcm, 10 ** (limDb / 20));
};

// ---------- MP3 sem lacuna e sem estalo na junção ----------
/**
 * Pré e pós-rolagem (amostras) codificadas fora do loop. O MP3 começa e termina com o encoder vindo de / indo para
 * silêncio (atraso do LAME e padding com zeros), e o primeiro e o último quadro reconstroem mal a junção. Então o
 * MP3 recebe [últimas PRE amostras do loop | loop | primeiras POST amostras do loop] e o cabeçalho LAME é editado para
 * o decodificador descartar essas amostras a mais (atraso += PRE, padding += POST): o que sai é exatamente o loop,
 * codificado com contexto contínuo dos dois lados. 2 quadros de 1152 amostras cobrem a sobreposição do banco de
 * filtros híbrido (polifásico 512 + MDCT de 2 grânulos); o campo do cabeçalho tem 12 bits (atraso e padding ≤ 4095).
 */
const PRE = 2 * 1152, POST = 2 * 1152;
const LAME_FIELD_MAX = 4095;

/** CRC-16/ARC (polinômio 0xA001 refletido, início 0): o "CRC-16 of Info Tag" do cabeçalho LAME */
const crc16 = (b: Uint8Array) => {
  let c = 0;
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1; }
  return c;
};
/** soma `addStart`/`addEnd` ao atraso/padding do cabeçalho Xing/LAME (Info) e recalcula o CRC da tag */
function patchLameTag(file: string, addStart: number, addEnd: number): { start: number; end: number } {
  const b = readFileSync(file);
  let f = 0;
  if (b.toString("latin1", 0, 3) === "ID3") f = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]);
  if (b[f] !== 0xff || (b[f + 1] & 0xe0) !== 0xe0) throw new Error(`${file}: quadro MP3 não encontrado após o ID3`);
  const head = b.toString("latin1", f, f + 64);
  const xi = Math.max(head.indexOf("Info"), head.indexOf("Xing"));
  if (xi < 0) throw new Error(`${file}: sem cabeçalho Xing/Info`);
  const x = f + xi, flags = b.readUInt32BE(x + 4);
  let lame = x + 8;
  if (flags & 1) lame += 4; if (flags & 2) lame += 4; if (flags & 4) lame += 100; if (flags & 8) lame += 4;
  const crcAt = lame + 34;
  if (crc16(b.subarray(f, crcAt)) !== b.readUInt16BE(crcAt)) throw new Error(`${file}: CRC da tag LAME não confere antes da edição`);
  const v = b.readUIntBE(lame + 21, 3);
  const start = (v >> 12) + addStart, end = (v & 0xfff) + addEnd;
  if (start > LAME_FIELD_MAX || end > LAME_FIELD_MAX) throw new Error(`${file}: atraso/padding ${start}/${end} não cabe em 12 bits`);
  b.writeUIntBE((start << 12) | end, lame + 21, 3);
  b.writeUInt16BE(crc16(b.subarray(f, crcAt)), crcAt);
  writeFileSync(file, b);
  return { start, end };
}

const encodeLoopMp3 = (name: string, pcm: Float32Array[], mp3: string) => {
  const n = pcm[0].length;
  const ext = pcm.map(c => { const o = new Float32Array(PRE + n + POST); o.set(c.subarray(n - PRE), 0); o.set(c, PRE); o.set(c.subarray(0, POST), PRE + n); return o; });
  const w = join(wavDir, `${name}.ext.wav`);
  writeFileSync(w, wavBytes(ext));
  encodeMp3(w, mp3);
  return patchLameTag(mp3, PRE, POST);
};

/**
 * Masteriza para o MP3 entregue: ajusta ganho (e limitador, se o pico real passar do teto) até o MP3 decodificado
 * medir audio.loudness_lufs (±0,05, a resolução do ebur128) com pico real ≤ audio.true_peak_dbtp e o WAV ≤ teto com
 * folga (audio.compose.true_peak_margin_db).
 */
function masterAndEncode(name: string, raw: Float32Array[], mp3: string) {
  let gainDb = 0, limDb: number | null = null;
  const tmp = join(wavDir, `${name}.wav`);
  for (let it = 0; it < 16; it++) {
    const pcm = apply(raw, gainDb, limDb);
    const wav = wavBytes(pcm);
    writeFileSync(tmp, wav);
    const w = measure(tmp);
    const okTPw = w.TP <= ceiling;
    let m: Loudness | null = null, pads = null;
    if (okTPw && writeMp3) { pads = encodeLoopMp3(name, pcm, mp3); m = measure(mp3); }
    const ref = m ?? w;
    const okI = Math.abs(ref.I - target) <= 0.05;
    const okTP = okTPw && (!m || m.TP <= bal.audio.true_peak_dbtp);
    if (okI && okTP) return { pcm, wav, w, m, pads, gainDb, limDb };
    if (!okTP) limDb = (limDb ?? ceiling) - Math.max(0.1, (m && m.TP > bal.audio.true_peak_dbtp ? m.TP - bal.audio.true_peak_dbtp : w.TP - ceiling));
    if (!okI) gainDb += target - ref.I;
  }
  throw new Error(`${name}: masterização não convergiu`);
}

// ---------- render no Chromium ----------
interface Rendered { name: string; length: number; channels: string[]; renderedPeak: number; tailEndPeak: number; tailAt: number; latestEvent: number }
const fromB64 = (s: string) => { const b = Buffer.from(s, "base64"); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const ffmpeg = (args: string[]) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);
/** MP3 sem metadados variáveis (bitexact): mesmo WAV → mesmo MP3 */
function encodeMp3(wav: string, mp3: string) {
  ffmpeg(["-i", wav, "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", "-c:a", "libmp3lame", "-b:a", `${compose.bitrate_kbps}k`, "-ar", String(sr), mp3]);
}

const browser = await chromium.launch();
const mastered: Record<string, Float32Array[]> = {};
let totalBytes = 0;
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: readFileSync(new URL("./synth.browser.js", import.meta.url), "utf8") });
  const opts = { sampleRate: sr, bpm: music.bpm, beatsPerBar: music.beats_per_bar, loopBars: compose.loop_bars, tailBars: compose.tail_bars, seed: compose.seed, key: music.key };
  console.log("stem            amostras  s       WAV LUFS/dBTP   MP3 LUFS/dBTP   bytes   ganho dB  limitador  cauda");
  const shas: string[] = [];
  for (const name of music.stems) {
    const r = await page.evaluate(([n, o]) => (globalThis as unknown as { renderStem: (n: string, o: unknown) => Promise<unknown> }).renderStem(n as string, o), [name, opts] as const) as Rendered;
    if (r.length !== loopSamples) throw new Error(`${name}: ${r.length} amostras, esperado ${loopSamples}`);
    // o que sobra no fim da cauda seria cortado do wrap: tem de estar abaixo de −60 dB do pico
    if (r.tailEndPeak > r.renderedPeak * 1e-3) throw new Error(`${name}: cauda não decaiu (${r.tailEndPeak} em ${r.tailAt} s vs pico ${r.renderedPeak})`);
    const raw = r.channels.map(fromB64);
    const mp3 = join(outDir, `${name}.mp3`);
    const m = masterAndEncode(name, raw, mp3);
    mastered[name] = m.pcm;
    const bytes = writeMp3 ? statSync(mp3).size : 0;
    totalBytes += bytes;
    const tailDb = 20 * Math.log10(r.tailEndPeak / r.renderedPeak || 1e-12);
    console.log(`${name.padEnd(15)} ${loopSamples}  ${(loopSamples / sr).toFixed(3)}  ${m.w.I.toFixed(1)} / ${m.w.TP.toFixed(1)}     ` +
      `${m.m ? `${m.m.I.toFixed(1)} / ${m.m.TP.toFixed(1)}` : "—"}     ${bytes}  ${m.gainDb.toFixed(2)}     ${m.limDb === null ? "não" : m.limDb.toFixed(2) + " dBFS"}  ${tailDb.toFixed(0)} dB` +
      (m.pads ? `  (LAME atraso/padding ${m.pads.start}/${m.pads.end})` : ""));
    shas.push(`  sha256 ${name}.wav ${sha(m.wav)}  (PCM bruto ${sha(wavBytes(raw))})`);
  }
  console.log(shas.join("\n"));
} finally {
  await browser.close();
}
if (writeMp3) console.log(`total MP3: ${totalBytes} B`);

// prévia (fora do repositório): ambient → tension → chase, trocando no limite de compasso com crossfade linear de
// crossfade_bars, como o A-2 faz no jogo (os stems estão em sincronia: a posição no loop é a mesma)
if (preview) {
  const bar = barSec * sr, fade = music.crossfade_bars * bar;
  // [stem, compasso em que entra (crossfade começa), compasso em que sai (crossfade começa)]
  const plan: [string, number, number][] = [["ambient", -Infinity, 2], ["tension", 2, 4], ["chase", 4, Infinity]];
  const total = Math.round(7.5 * bar);
  const out = [new Float32Array(total), new Float32Array(total)];
  for (const [name, inBar, outBar] of plan) {
    for (let i = 0; i < total; i++) {
      const up = Math.min(1, Math.max(0, (i - inBar * bar) / fade));
      const down = Math.min(1, Math.max(0, 1 - (i - outBar * bar) / fade));
      const g = Math.min(up, down);
      if (g > 0) for (let c = 0; c < 2; c++) out[c][i] += mastered[name][c][i % loopSamples] * g;
    }
  }
  const pw = join(wavDir, "previa.wav");
  writeFileSync(pw, wavBytes(out));
  ffmpeg(["-i", pw, "-c:a", "libmp3lame", "-b:a", `${compose.bitrate_kbps}k`, preview]);
  console.log(`prévia: ${preview} (${(total / sr).toFixed(1)} s)`);
}
