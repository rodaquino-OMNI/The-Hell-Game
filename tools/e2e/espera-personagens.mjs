#!/usr/bin/env node
// e2e da D-45 (docs/plano-construcao.md §7): a partida só começa com os personagens carregados.
//  1. espectro.glb segurado DELAY_MS (route do Playwright): depois do clique em "Começar" (teclado, foco no botão) o
//     botão fica em carregando (aria-busy, aria-disabled, foco mantido, aviso no #gost) e a simulação não anda
//     (G.t = 0) enquanto o caçador não tem o modelo; quando o .glb chega a partida começa sozinha e, em todo quadro
//     com G.t > 0, o caçador já é o modelo do .glb. No primeiro quadro do primeiro preparo (hunter.windup) os olhos
//     estão acesos; se o diretor de áudio tocou o telegraph_<kind>, foi no mesmo quadro (mesmo G.t) do visual.
//  2. espectro.glb com falha (route.abort): a partida começa com o modelo de reserva, cujos olhos também acendem no
//     primeiro quadro do primeiro preparo.
// Leitura por quadro: requestAnimationFrame registrado antes do laço do jogo lê o estado deixado pelo quadro anterior
// (simulação e sincronização das malhas do mesmo quadro). Ganchos só com ?debug=1 (D-33).
// Uso: node tools/e2e/espera-personagens.mjs [url]   (sem url, sobe packages/server/dist/server.mjs numa porta livre)
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { startServer } from "../lib/server.mjs";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }

/** atraso do .glb do caçador (pedido da supervisão: 6 s, acima da janela de ~1 s vista no staging) */
const DELAY_MS = 6000;
/** espera máxima do primeiro preparo depois do início (s de relógio real; folga para máquina carregada) */
const WINDUP_WAIT_MS = 90000;
const SEED = 1234;
const HUNTER_GLB = /\/models\/espectro\.glb(\?|$)/;

const failures = [];
const fail = (m) => { failures.push(m); console.error("FALHA:", m); };
let url = process.argv[2], server;
if (!url) ({ url, child: server } = await startServer());

/** grava, a cada quadro, tempo da simulação, forma do caçador, preparo e olhos; para no primeiro preparo + 1 s */
function installRecorder() {
  window.__e2eFrames = [];
  const tick = () => {
    const G = window.__thehell?.();
    let st = null;
    try { st = window.__thehellRender.states(); } catch { /* partida não iniciada */ }
    if (G && st) {
      const w = G.hunter.windup;
      window.__e2eFrames.push({ t: G.t, form: st.hunter, windup: w ? w.kind : null, eyes: st.telegraph, perf: performance.now() });
    }
    const f = window.__e2eFrames, first = f.findIndex(x => x.windup);
    if (first < 0 || f.length - first < 60) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function scenario(browser, name, route) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, locale: "pt-BR" });
  page.on("pageerror", e => fail(`${name}: pageerror ${e.message}`));
  // teto ui.start_wait_s atingido: com o .glb atrasado só DELAY_MS, é máquina lenta demais para esta prova
  page.on("console", m => { if (m.type() === "warning" && m.text().includes("ui.start_wait_s")) (page.__timeouts ??= []).push(m.text()); });
  await page.route(HUNTER_GLB, route);
  await page.goto(`${url}/?debug=1&seed=${SEED}`, { waitUntil: "load" });
  await page.evaluate(installRecorder);
  await page.focus("#go");
  const tClick = Date.now();
  await page.keyboard.press("Enter");
  return { page, tClick };
}

/** primeiro preparo: olhos acesos no primeiro quadro; telegraph sonoro (se tocou) no mesmo G.t */
async function checkWindup(page, name, form) {
  const t0 = Date.now();
  let frames = [];
  while (Date.now() - t0 < WINDUP_WAIT_MS) {
    frames = await page.evaluate(() => window.__e2eFrames);
    const i = frames.findIndex(x => x.windup);
    if (i >= 0 && frames.length - i >= 60) break;
    await sleep(250);
  }
  const i = frames.findIndex(x => x.windup);
  if (i < 0) { fail(`${name}: nenhum preparo do caçador em ${WINDUP_WAIT_MS / 1000} s`); return; }
  const f = frames[i];
  console.log(`${name}: primeiro preparo (${f.windup}) em G.t = ${f.t.toFixed(3)} s; caçador ${f.form}, olhos ${f.eyes ? "acesos" : "APAGADOS"}`);
  if (f.form !== form) fail(`${name}: no primeiro quadro do preparo o caçador é '${f.form}', esperado '${form}'`);
  if (!f.eyes) fail(`${name}: olhos apagados no primeiro quadro do preparo (telegraph sem visual)`);
  const off = frames.slice(i).filter(x => x.windup && !x.eyes);
  if (off.length) fail(`${name}: ${off.length} quadro(s) com preparo e olhos apagados`);
  const plays = await page.evaluate(() => window.__thehellAudioDirector?.().plays ?? null);
  const tele = plays?.find(p => p.name.startsWith("telegraph_"));
  if (!plays) console.log(`${name}: diretor de áudio desligado; só o visual conferido`);
  else if (!tele) console.log(`${name}: telegraph sonoro não tocou no primeiro preparo (caçador além de audio.director.hunter_audible_radius, D-37)`);
  else {
    const same = frames.find(x => Math.abs(x.t - tele.gameT) < 1e-9);
    console.log(`${name}: ${tele.name} tocado em G.t = ${tele.gameT.toFixed(3)} s`);
    if (!same) fail(`${name}: sem quadro gravado em G.t = ${tele.gameT} (som do telegraph)`);
    else if (!same.eyes || same.form !== form) fail(`${name}: no quadro do som (${tele.name}) os olhos estavam ${same.eyes ? "acesos" : "apagados"} e o caçador '${same.form}'`);
  }
}

try {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });

  // 1. .glb do caçador atrasado
  {
    const name = "glb atrasado";
    let released = 0;
    const { page, tClick } = await scenario(browser, name, async route => { await sleep(DELAY_MS); released = Date.now(); await route.continue(); });
    await sleep(1000);
    const st = await page.evaluate(() => {
      const go = document.getElementById("go");
      return {
        busy: go.getAttribute("aria-busy"), disabled: go.getAttribute("aria-disabled"), focus: document.activeElement === go,
        status: document.getElementById("gost").textContent, label: document.getElementById("gol").textContent,
        menu: getComputedStyle(document.getElementById("menu")).display, t: window.__thehell?.()?.t ?? null,
      };
    });
    console.log(`${name}: 1 s depois do clique: ${JSON.stringify(st)}`);
    if (st.busy !== "true" || st.disabled !== "true") fail(`${name}: botão sem aria-busy/aria-disabled durante a espera`);
    if (!st.focus) fail(`${name}: o foco saiu do botão durante a espera`);
    if (!st.status) fail(`${name}: aviso #gost vazio durante a espera`);
    if (st.menu === "none") fail(`${name}: menu escondido antes dos personagens`);
    if (st.t !== 0) fail(`${name}: a simulação andou antes do modelo (G.t = ${st.t})`);
    // a partida começa sozinha quando o .glb chega
    await page.waitForFunction(() => getComputedStyle(document.getElementById("menu")).display === "none", null, { timeout: DELAY_MS + 30000 });
    const tStart = Date.now();
    console.log(`${name}: .glb liberado ${((released - tClick) / 1000).toFixed(2)} s depois do clique; partida começou ${((tStart - tClick) / 1000).toFixed(2)} s depois do clique`);
    if (!released || tStart < released) fail(`${name}: a partida começou antes do .glb do caçador`);
    const after = await page.evaluate(() => ({ busy: document.getElementById("go").getAttribute("aria-busy"), status: document.getElementById("gost").textContent }));
    if (after.busy !== "false" || after.status) fail(`${name}: estado de carregando ficou depois do início: ${JSON.stringify(after)}`);
    await checkWindup(page, name, "modelo");
    if (page.__timeouts?.length) fail(`${name}: o teto ui.start_wait_s venceu antes do .glb atrasado ${DELAY_MS / 1000} s (máquina lenta?): ${page.__timeouts[0]}`);
    const frames = await page.evaluate(() => window.__e2eFrames);
    const early = frames.filter(x => x.t > 0 && x.form !== "modelo");
    if (early.length) fail(`${name}: ${early.length} quadro(s) com a simulação andando sem o modelo do caçador`);
    await page.close();
  }

  // 2. .glb do caçador com falha: modelo de reserva com telegraph
  {
    const name = "glb com falha";
    const { page } = await scenario(browser, name, route => route.abort("failed"));
    await page.waitForFunction(() => getComputedStyle(document.getElementById("menu")).display === "none", null, { timeout: 30000 });
    await checkWindup(page, name, "reserva");
    await page.close();
  }
  await browser.close();
} catch (e) {
  fail(`erro: ${e?.stack ?? e}`);
} finally {
  server?.kill();
}
if (failures.length) { console.error(`e2e espera-personagens: ${failures.length} falha(s)`); process.exit(1); }
console.log("e2e espera-personagens ok");
