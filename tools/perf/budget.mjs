#!/usr/bin/env node
// Orçamentos de desempenho (GDD-v0.3 §10.6; plano-fases-1-2 §5 V7 e §9). Limiares de data/balance.yaml
// `render.budgets`; rede limitada de `render.stress.network_mbps`.
//  1. Render: abre a cena de pior caso (`?stress=1`, packages/client/src/render/stress.ts: 6 personagens das 5 classes,
//     mapa inteiro, camadas do preset) em cada preset, sem e com `?retro=1`, desenha todas as vistas da cena (de cima
//     e a varredura em 3ª e 1ª pessoa) e lê `renderer.info` de cada quadro (autoReset = false: soma do passe de
//     sombra, da cena e dos passes finais). FALHA se o máximo passar de `draw_calls` ou de `triangles`.
//  2. Download inicial: navegador limpo e rede limitada (CDP Network.emulateNetworkConditions); soma os bytes
//     transferidos (Network.loadingFinished.encodedDataLength) da navegação até o jogo ficar jogável (clique em
//     "Jogar", personagens carregados e um quadro desenhado). FALHA se passar de `initial_download_mb` (MB = 10⁶ bytes).
//     Por mapa: tudo o que a partida no Pátio baixa até a rede ficar ociosa, contra `map_download_mb`.
//  3. Tempo até jogar: da navegação até "Jogar" clicável (JS pronto) e até o primeiro quadro da partida, com a rede
//     limitada. FALHA se o tempo de transferência dos bytes do item 2 na rede limitada passar de `time_to_play_s`
//     (condição controlada: não depende da máquina). O tempo de relógio só é reportado; com --strict-time também
//     falha. Na CI ele não é confiável: o SwiftShader compila os shaders e rasteriza na CPU de um runner
//     compartilhado, e o primeiro quadro mede a CPU do runner, não a GPU do jogador (o FPS em GPU real é a medição
//     manual do docs/runbook.md, seção Desempenho).
// Relatório budget.json e budget.md em --out (a CI publica como artefato na falha).
// Uso: node tools/perf/budget.mjs [--out dir] [--strict-time] [url]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../lib/server.mjs";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }

const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const outDir = opt("--out") ?? join(tmpdir(), "thehell-perf");
const strictTime = args.includes("--strict-time");
let url = args.find((a, i) => a.startsWith("http") && args[i - 1] !== "--out");
const balance = JSON.parse(readFileSync(join(root, "packages/shared/generated/balance.json"), "utf8"));
const B = balance.render.budgets, ST = balance.render.stress;
/** semente fixa (mesma das capturas de referência) */
const SEED = 1234;
/** saída de 1280×720, a resolução em que o GDD-v0.3 §10.6 mede o FPS (C-10: escala inteira da resolução interna) */
const VIEWPORT = { width: 1280, height: 720 };
const MB = 1e6;
const LAUNCH = { args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] };

const failures = [];
const fail = (m) => { failures.push(m); console.error("FALHA:", m); };
const report = { date: new Date().toISOString(), budgets: B, render: [], download: null, failures };

let server;
// porta livre (PORT=0) e /healthz só do processo filho deste script (tools/lib/server.mjs)
if (!url) ({ url, child: server } = await startServer());

/** cena de pior caso num preset: máximo de draw calls e de triângulos entre todas as vistas */
async function renderBudget(browser, preset, retro) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  // relógio parado: a cena só desenha quando o hook pede (um quadro por vista)
  await page.clock.install({ time: 0 });
  await page.goto(`${url}/?seed=${SEED}&preset=${preset}&stress=1${retro ? "&retro=1" : ""}`, { waitUntil: "load" });
  await page.clock.pauseAt(1000);
  await page.click("#go");
  const r = await page.evaluate(async (preset) => {
    await window.__thehellCharactersReady();
    const h = window.__thehellRender;
    h.setPreset(preset);
    const first = h.stress(0);
    if (!first) return null;
    const views = [];
    for (let i = 0; i < first.views; i++) { const { calls, triangles } = h.stress(i); views.push({ calls, triangles }); }
    const info = h.info();
    return { views, layers: info.layers, internal: info.internal, scale: info.scale };
  }, preset);
  await page.close();
  if (!r) { fail(`${preset}${retro ? " retro" : ""}: a cena de pior caso não subiu (?stress=1)`); return; }
  if (errors.length) fail(`${preset}${retro ? " retro" : ""}: erros no console: ${errors.join(" | ")}`);
  const calls = Math.max(...r.views.map(v => v.calls)), triangles = Math.max(...r.views.map(v => v.triangles));
  const worst = { calls: r.views.findIndex(v => v.calls === calls), triangles: r.views.findIndex(v => v.triangles === triangles) };
  const layers = Object.entries(r.layers).filter(([, on]) => on).map(([k]) => k).join("") || "-";
  const row = { preset, retro, layers, internal: r.internal, scale: r.scale, views: r.views.length, calls, triangles, worst };
  report.render.push(row);
  const name = `${preset}${retro ? " + retro" : ""}`.padEnd(14);
  console.log(`render ${name} camadas ${layers.padEnd(3)} ${r.internal.join("×")} ×${r.scale}: ${calls} draw calls (vista ${worst.calls}), ${triangles} triângulos (vista ${worst.triangles}) em ${r.views.length} vistas; orçamento ${B.draw_calls} / ${B.triangles}`);
  if (calls > B.draw_calls) fail(`${name.trim()}: ${calls} draw calls > ${B.draw_calls} (render.budgets.draw_calls)`);
  if (triangles > B.triangles) fail(`${name.trim()}: ${triangles} triângulos > ${B.triangles} (render.budgets.triangles)`);
  const expect = balance.render.presets[preset].layers.join("");
  if (layers !== expect) fail(`${name.trim()}: camadas ${layers}, esperado ${expect} (render.presets.${preset}.layers)`);
}

/** download inicial e tempo até jogar: navegador limpo, rede limitada, jogo no preset padrão */
async function downloadBudget(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const bps = (ST.network_mbps * 1e6) / 8;
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: bps, uploadThroughput: bps });
  const urls = new Map(), files = new Map();
  let bytes = 0;
  cdp.on("Network.requestWillBeSent", e => urls.set(e.requestId, e.request.url));
  cdp.on("Network.loadingFinished", e => {
    bytes += e.encodedDataLength;
    const u = (urls.get(e.requestId) ?? "?").replace(url, "");
    files.set(u, (files.get(u) ?? 0) + e.encodedDataLength);
  });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const t0 = performance.now();
  await page.goto(`${url}/?seed=${SEED}`, { waitUntil: "commit" });
  // "Jogar" clicável: botão visível e o módulo do jogo já rodou (menu ligado; gancho de render instalado)
  await page.waitForSelector("#go", { state: "visible" });
  await page.waitForFunction(() => typeof window.__thehellRender === "object");
  const tGo = (performance.now() - t0) / 1000;
  await page.click("#go");
  // jogável: personagens carregados e um quadro da partida desenhado
  await page.evaluate(async () => {
    await window.__thehellCharactersReady();
    const frame = () => new Promise(r => requestAnimationFrame(r));
    for (;;) { await frame(); try { if (window.__thehellRender.info().calls > 0) return; } catch { /* partida subindo */ } }
  });
  const tPlay = (performance.now() - t0) / 1000;
  const initial = bytes, initialFiles = new Map(files);
  // por mapa: tudo o que a partida no Pátio baixa até a rede ficar ociosa
  await page.waitForLoadState("networkidle");
  const mapBytes = bytes;
  await context.close();
  if (errors.length) fail(`download: erros na página: ${errors.join(" | ")}`);
  const transfer = (initial * 8) / (ST.network_mbps * 1e6);
  report.download = {
    network_mbps: ST.network_mbps, initial_bytes: initial, initial_mb: initial / MB, map_bytes: mapBytes, map_mb: mapBytes / MB,
    transfer_s: transfer, time_to_go_s: tGo, time_to_play_s: tPlay, strict_time: strictTime,
    files: [...initialFiles].sort((a, b) => b[1] - a[1]).map(([file, b]) => ({ file, bytes: b })),
  };
  console.log(`download inicial: ${(initial / MB).toFixed(2)} MB (${initialFiles.size} arquivos; orçamento ${B.initial_download_mb} MB); partida no Pátio até a rede ociosa: ${(mapBytes / MB).toFixed(2)} MB (orçamento ${B.map_download_mb} MB)`);
  for (const [f, b] of [...initialFiles].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${(b / MB).toFixed(3).padStart(7)} MB  ${f}`);
  console.log(`tempo até jogar (rede de ${ST.network_mbps} Mbit/s): transferência ${transfer.toFixed(2)} s (orçamento ${B.time_to_play_s} s); relógio: "Jogar" clicável em ${tGo.toFixed(2)} s, primeiro quadro da partida em ${tPlay.toFixed(2)} s (${strictTime ? "verificado: --strict-time" : "só reportado: SwiftShader na CPU"})`);
  if (initial / MB > B.initial_download_mb) fail(`download inicial ${(initial / MB).toFixed(2)} MB > ${B.initial_download_mb} MB (render.budgets.initial_download_mb)`);
  if (mapBytes / MB > B.map_download_mb) fail(`download da partida no Pátio ${(mapBytes / MB).toFixed(2)} MB > ${B.map_download_mb} MB (render.budgets.map_download_mb)`);
  if (transfer > B.time_to_play_s) fail(`transferência do download inicial a ${ST.network_mbps} Mbit/s: ${transfer.toFixed(2)} s > ${B.time_to_play_s} s (render.budgets.time_to_play_s)`);
  if (strictTime && tPlay > B.time_to_play_s) fail(`tempo até jogar ${tPlay.toFixed(2)} s > ${B.time_to_play_s} s (render.budgets.time_to_play_s)`);
}

function markdown() {
  const d = report.download;
  const lines = [
    `# Orçamentos de desempenho (${report.date})`, "",
    "Fonte: `tools/perf/budget.mjs`; limiares em `data/balance.yaml` `render.budgets` (GDD-v0.3 §10.6).", "",
    `| Preset | Retro | Camadas | Interna × escala | Vistas | Draw calls (≤ ${B.draw_calls}) | Triângulos (≤ ${B.triangles}) |`,
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...report.render.map(r => `| ${r.preset} | ${r.retro ? "sim" : "não"} | ${r.layers} | ${r.internal.join("×")} × ${r.scale} | ${r.views} | ${r.calls} | ${r.triangles} |`),
    "",
  ];
  if (d) lines.push(
    `| Medida | Valor | Orçamento |`, "| --- | --- | --- |",
    `| Download inicial | ${d.initial_mb.toFixed(2)} MB | ${B.initial_download_mb} MB |`,
    `| Partida no Pátio (rede ociosa) | ${d.map_mb.toFixed(2)} MB | ${B.map_download_mb} MB |`,
    `| Transferência a ${d.network_mbps} Mbit/s | ${d.transfer_s.toFixed(2)} s | ${B.time_to_play_s} s |`,
    `| "Jogar" clicável (relógio) | ${d.time_to_go_s.toFixed(2)} s | só reportado |`,
    `| Primeiro quadro da partida (relógio) | ${d.time_to_play_s.toFixed(2)} s | ${d.strict_time ? `${B.time_to_play_s} s` : "só reportado (SwiftShader)"} |`, "");
  lines.push(failures.length ? `## Falhas\n\n${failures.map(f => `- ${f}`).join("\n")}\n` : "Sem falhas.\n");
  return lines.join("\n");
}

try {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch(LAUNCH);
  for (const preset of Object.keys(balance.render.presets)) for (const retro of [false, true]) await renderBudget(browser, preset, retro);
  await downloadBudget(browser);
  await browser.close();
} catch (e) {
  fail(`erro: ${e?.stack ?? e}`);
} finally {
  server?.kill();
  writeFileSync(join(outDir, "budget.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, "budget.md"), markdown());
}

if (failures.length) { console.error(`perf:budget: ${failures.length} falha(s); relatório em ${outDir}`); process.exit(1); }
console.log(`perf:budget ok → ${join(outDir, "budget.md")}`);
