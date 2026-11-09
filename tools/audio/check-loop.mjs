#!/usr/bin/env node
// Verificação no Chromium dos stems de música (item A-3 do V5; GDD-v0.3 §11): cada MP3 de
// packages/client/public/audio/music é decodificado com decodeAudioData (o mesmo caminho do A-2, music.ts) e:
// 1. o comprimento em amostras tem de ser exatamente loop_bars × beats_per_bar × 60 / bpm × taxa (gapless: o Chromium
//    tem de respeitar o atraso do encoder e o padding gravados no cabeçalho Xing/LAME, editados pelo compose.ts), num
//    contexto na taxa do arquivo (audio.compose.sample_rate);
// 2. a junção do loop (última amostra → primeira) passa no critério local de tools/audio/junction.mjs (o mesmo do
//    teste packages/client/test/audio-stems.test.ts): degrau e 2ª diferença ≤ audio.compose.junction_factor × o maior
//    degrau / a maior 2ª diferença em ±audio.compose.junction_window amostras; e, como controle, a mesma junção com um
//    estalo sintético de 0,02 (nos dois sentidos) tem de reprovar.
// Contextos testados:
// a. OfflineAudioContext na taxa do arquivo (audio.compose.sample_rate): reprova se falhar;
// b. como o jogo cria (packages/client/src/audio/engine.ts, createAudioContext): AudioContext REAL com
//    { sampleRate: audio.compose.sample_rate }, num dispositivo cuja taxa nativa é medida e impressa (o Chromium
//    headless desta máquina abre a 44,1 kHz). Reprova se a taxa forçada não for respeitada ou se falhar;
// c. AVISO (não reprova): contexto a 44,1 kHz (OfflineAudioContext a 44100 e o AudioContext padrão do dispositivo,
//    sem opção). decodeAudioData reamostra para a taxa do contexto e o reamostrador do Chromium trata o buffer como
//    finito (1 amostra a menos e borda sem continuidade): é o estalo que o caso b evita.
// Valores de data/balance.yaml (audio.music.*, audio.compose.*). Uso: node tools/audio/check-loop.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fromNeighborhood, junctionOk, junctionStats, neighborhood } from "./junction.mjs";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }
const { parse } = require("yaml");

const bal = parse(readFileSync(new URL("../../data/balance.yaml", import.meta.url), "utf8"));
const { music, compose } = bal.audio;
const RATE = compose.sample_rate;
/** casos: [rótulo, tipo do contexto, taxa pedida, reprova?] (ver cabeçalho) */
const CASES = [
  ["offline", "offline", RATE, true],
  ["jogo", "game", RATE, true],
  ["offline", "offline", 44100, false],
  ["dispositivo", "device", null, false],
];
const WIN = compose.junction_window, FACTOR = compose.junction_factor;
/** estalo sintético de controle (igual ao do teste): degrau de 0,02 que decai linearmente em 100 ms */
const CLICK = 0.02;
const withClick = (head, amp, rate) => { const m = Math.round(0.1 * rate); return head.map((v, i) => v + (i < m ? amp * (1 - i / m) : 0)); };
const loopSec = (compose.loop_bars * music.beats_per_bar * 60) / music.bpm;
const dir = new URL("../../packages/client/public/audio/music/", import.meta.url);

const browser = await chromium.launch();
let failed = false;
try {
  const page = await browser.newPage();
  const deviceRate = await page.evaluate(async () => { const c = new AudioContext(); const r = c.sampleRate; await c.close(); return r; });
  console.log(`taxa nativa do dispositivo (new AudioContext() sem opção): ${deviceRate} Hz; stems a ${RATE} Hz`);
  for (const stem of music.stems) {
    const b64 = readFileSync(new URL(`${stem}.mp3`, dir)).toString("base64");
    for (const [label, kind, rate, strict] of CASES) {
      const r = await page.evaluate(async ([b64, kind, rate, nb]) => {
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        // "game" = o mesmo construtor de createAudioContext (engine.ts): AudioContext real com a taxa dos stems
        const ctx = kind === "offline" ? new OfflineAudioContext(2, 1, rate) : kind === "game" ? new AudioContext({ sampleRate: rate }) : new AudioContext();
        const buf = await ctx.decodeAudioData(u8.buffer);
        const ctxRate = ctx.sampleRate;
        if (kind !== "offline") await ctx.close();
        const ch = [];
        for (let c = 0; c < buf.numberOfChannels; c++) {
          const x = buf.getChannelData(c);
          ch.push({ tail: Array.from(x.subarray(x.length - nb)), head: Array.from(x.subarray(0, nb)) });
        }
        return { ctxRate, length: buf.length, sampleRate: buf.sampleRate, channels: buf.numberOfChannels, ch };
      }, [b64, kind, rate, neighborhood(WIN)]);
      const expected = Math.round(loopSec * r.ctxRate);
      const okRate = rate === null || r.ctxRate === rate;
      const okLen = r.length === expected && r.channels === 2 && r.sampleRate === r.ctxRate;
      const js = r.ch.map(c => {
        const j = junctionOk(junctionStats(fromNeighborhood(c.tail, c.head), WIN), FACTOR);
        const clicks = [CLICK, -CLICK].map(a => junctionOk(junctionStats(fromNeighborhood(c.tail, withClick(c.head, a, r.ctxRate)), WIN), FACTOR).ok);
        return { ...j, last: c.tail[c.tail.length - 1], first: c.head[0], clickCaught: clicks.every(ok => !ok) };
      });
      const okJ = js.every(j => j.ok);
      const okCtl = js.every(j => j.clickCaught);
      const ok = okRate && okLen && okJ;
      if (!ok && strict) failed = true;
      if (!okCtl && strict) failed = true;
      const f = (v) => v.toExponential(2), g = (v) => v.toFixed(2);
      const desc = kind === "game" ? `jogo: AudioContext({ sampleRate: ${rate} }) em dispositivo de ${deviceRate} Hz → contexto ${r.ctxRate} Hz`
        : kind === "device" ? `dispositivo: new AudioContext() → ${r.ctxRate} Hz` : `${label} ${r.ctxRate} Hz`;
      console.log(`${ok ? "ok   " : strict ? "FALHA" : "AVISO"} ${stem.padEnd(15)} ${desc}: ${r.length} amostras (esperado ${expected}), ${r.channels} canais`);
      js.forEach((j, i) => console.log(`        canal ${i}: última ${f(j.last)} → primeira ${f(j.first)}; degrau/máx local ${g(j.stepRatio)}, 2ª dif./máx local ${g(j.curvRatio)} (limite ${FACTOR}); estalo de ±${CLICK} ${j.clickCaught ? "reprovado" : "NÃO DETECTADO"}`));
    }
  }
} finally {
  await browser.close();
}
if (failed) { console.error("FALHA: comprimento ou junção do loop fora do limite"); process.exit(1); }
console.log(`ok: a ${RATE} Hz (offline e como o jogo cria o contexto) todos os stems decodificam com o comprimento exato e fecham o loop sem degrau`);
