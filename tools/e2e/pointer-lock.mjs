#!/usr/bin/env node
// E2E do salto de câmera ao adquirir o pointer lock: o Chromium pode emitir, ao travar o ponteiro pelo clique em
// "#go", um mousemove com movementX espúrio (≈ clientX do cursor) que girava a câmera ≈ 1,4 rad
// (packages/client/src/pointer-filter.ts; limite em data/balance.yaml `client.mouse_max_delta`). Inicia a partida com
// um clique real do mouse em "#go" (page.mouse.click no centro do botão), várias vezes (a corrida é intermitente), e confere que o yaw do
// sobrevivente (`__thehell().survivors[0].a`, que é o yaw da câmera de cada passo) continua 0 depois do início.
// Fase 3 (determinística; o clique real sozinho não pega a regressão: no headless o par espúrio pode chegar com
// locked=false e o ± se anula dentro de um passo): na última página, solta e retoma o lock e, no pointerlockchange,
// despacha mousemove sintéticos lendo `view.yaw` logo depois de cada um (`__thehellInput`, ?debug=1). Cada defesa do
// pointer-filter.ts é isolada: (a) o primeiro do lock, com |dx| ABAIXO de client.mouse_max_delta (só o descarte do 1º
// evento o segura), não gira; (b) um posterior acima do limite (só o limite o segura) não gira; (c) um pequeno gira.
// O Chromium entrega um mousemove real (0, 0, locked) ao adquirir o lock, antes do pointerlockchange; ele consumiria o
// descarte do 1º evento sem girar nada e (a) passaria mesmo sem a defesa. Por isso, durante a fase 3, um ouvinte de
// captura em window retém os mousemove reais (isTrusted): o input.ts só vê os sintéticos.
// Uso: node tools/e2e/pointer-lock.mjs [url]   (sem url, sobe packages/server/dist/server.mjs numa porta livre: tools/lib/server.mjs)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { startServer } from "../lib/server.mjs";

const require = createRequire(import.meta.url);
const { parse } = require("yaml");
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }

/** parâmetros do teste (não são números de jogo): partidas iniciadas, espera após o clique, folga de ponto flutuante */
const STARTS = 5, SETTLE_MS = 1000, EPS = 1e-6;
/** tempo simulado mínimo (s) depois do clique para a leitura valer */
const MIN_T = 0.2;
/** fase 2: o mouse anda NUDGE px depois do lock. NUDGE_MAX (rad) separa o giro legítimo disso (centésimos de rad com a
 * sensibilidade atual do protótipo, 0,0025 rad/px) do salto do bug (≈ 1,4 rad) com folga dos dois lados */
const NUDGE = 2, NUDGE_MAX = 0.1;
/** fase 3: limite do filtro (D-47) lido do YAML; os deslocamentos sintéticos derivam dele: (a) FIRST_DX abaixo do
 * limite (2/3 dele, −200 px com 300), (b) OUTLIER_DX acima (o dobro), (c) SMALL_DX pequeno como em um giro real */
const MAX_DELTA = parse(readFileSync(new URL("../../data/balance.yaml", import.meta.url), "utf8")).client.mouse_max_delta;
if (!(MAX_DELTA > 0)) throw new Error("client.mouse_max_delta ausente em data/balance.yaml");
const FIRST_DX = -Math.round(MAX_DELTA * 2 / 3), OUTLIER_DX = -2 * MAX_DELTA, SMALL_DX = -5;
if (!(Math.abs(FIRST_DX) < MAX_DELTA && Math.abs(SMALL_DX) < MAX_DELTA)) throw new Error("fase 3: deslocamentos fora da faixa");

let url = process.argv[2], server;
// porta livre (PORT=0) e /healthz só do processo filho deste script (tools/lib/server.mjs)
if (!url) ({ url, child: server } = await startServer());
const fail = (m) => { console.error("FALHA:", m); server?.kill(); process.exit(1); };
try {
  const debugUrl = new URL(url); debugUrl.searchParams.set("debug", "1");
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const errors = [];
  const results = [];
  /** página nova a cada início (um contexto WebGL por vez; reaproveitar a aba derruba o SwiftShader sob carga) */
  let page;
  /** yaw do sobrevivente: leitura a cada quadro do maior |a| (um salto que volta não escapa) e eventos do mouse */
  const install = () => page.evaluate(() => {
    const w = window;
    w.__pl = { max: 0, moves: [] };
    addEventListener("mousemove", e => w.__pl.moves.push([e.movementX, e.movementY, !!document.pointerLockElement]), true);
    const tick = () => { const g = w.__thehell?.(); if (g) w.__pl.max = Math.max(w.__pl.max, Math.abs(g.survivors[0].a)); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const read = () => page.evaluate(() => { const g = window.__thehell?.(); return g ? { a: g.survivors[0].a, max: window.__pl.max, t: g.t, locked: !!document.pointerLockElement, moves: window.__pl.moves } : null; });
  const settle = async (minT) => {
    await page.waitForTimeout(SETTLE_MS);
    let r = await read();
    for (let k = 0; k < 30 && !(r?.t > minT); k++) { await page.waitForTimeout(500); r = await read(); }
    return r;
  };
  for (let i = 0; i < STARTS; i++) {
    await page?.close();
    page = await browser.newPage({ viewport: { width: 1280, height: 720 }, locale: "pt-BR" });
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(debugUrl.href, { waitUntil: "load" });
    await install();
    const box = await page.locator("#go").boundingBox();
    // clique real do mouse no centro de #go (page.mouse.click: mesmo caminho de entrada do page.click, sem esperar
    // navegação; o start() ocupa a thread principal e o page.click estourava o tempo esperando-a sob carga)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    // fase 1: só o clique; a partida precisa ter rodado passos depois do lock (o yaw de cada passo vem da câmera)
    const r = await settle(MIN_T);
    if (!(r?.t > MIN_T)) fail(`início ${i + 1}/${STARTS}: a partida não avançou: ` + JSON.stringify(r));
    if (!(r.max < EPS)) fail(`início ${i + 1}/${STARTS}: a câmera girou só com o clique em #go: ` + JSON.stringify(r));
    // fase 2: o jogador encosta no mouse (NUDGE px); o Chromium ainda pode entregar o salto espúrio agora
    await page.mouse.move(box.x + box.width / 2 + NUDGE, box.y + box.height / 2);
    const r2 = await settle(r.t + MIN_T);
    if (!(r2.max < NUDGE_MAX)) fail(`início ${i + 1}/${STARTS}: a câmera saltou ao mexer ${NUDGE} px no mouse: ` + JSON.stringify(r2));
    results.push({ fase1: r.max, fase2: r2.max, locked: r2.locked, moves: r2.moves });
  }
  // fase 3: eventos sintéticos no próprio pointerlockchange; leitura do yaw por evento
  const det = await page.evaluate(async ([firstDx, outlierDx, smallDx]) => {
    const c = document.getElementById("c");
    // retém os mousemove reais (a captura em window roda antes de qualquer ouvinte do jogo); conta os retidos com lock
    let held = 0;
    const hold = e => { if (!e.isTrusted) return; if (document.pointerLockElement) held++; e.stopImmediatePropagation(); };
    addEventListener("mousemove", hold, true);
    if (document.pointerLockElement) {
      const off = new Promise(r => document.addEventListener("pointerlockchange", r, { once: true }));
      document.exitPointerLock();
      await off;
    }
    const yaw = () => window.__thehellInput().yaw;
    const fire = (dx) => { const y0 = yaw(); document.dispatchEvent(new MouseEvent("mousemove", { movementX: dx, movementY: 0, bubbles: true })); return yaw() - y0; };
    const on = new Promise(r => document.addEventListener("pointerlockchange", () => {
      // o ouvinte do input.ts (registrado no início) já rodou: a sessão de lock nova começou
      r({ locked: !!document.pointerLockElement, first: fire(firstDx), outlier: fire(outlierDx), small: fire(smallDx), heldLocked: held });
      removeEventListener("mousemove", hold, true);
    }, { once: true }));
    // o evaluate do Playwright conta como gesto do usuário (requestPointerLock exige ativação)
    await c.requestPointerLock();
    return on;
  }, [FIRST_DX, OUTLIER_DX, SMALL_DX]);
  console.log("fase 3 (sintética):", JSON.stringify({ maxDelta: MAX_DELTA, dx: [FIRST_DX, OUTLIER_DX, SMALL_DX], ...det }));
  if (!det.locked) fail("fase 3: o pointer lock não foi retomado: " + JSON.stringify(det));
  if (!(Math.abs(det.first) < EPS)) fail(`fase 3 (a): o primeiro mousemove do lock (${FIRST_DX} px, abaixo de client.mouse_max_delta = ${MAX_DELTA}) girou a câmera ${det.first} rad: o descarte do 1º evento falhou`);
  if (!(Math.abs(det.outlier) < EPS)) fail(`fase 3 (b): o mousemove acima de client.mouse_max_delta = ${MAX_DELTA} (${OUTLIER_DX} px) girou a câmera ${det.outlier} rad: o limite falhou`);
  if (!(Math.abs(det.small) > EPS && Math.abs(det.small) < NUDGE_MAX)) fail(`fase 3 (c): o mousemove pequeno (${SMALL_DX} px) devia girar pouco a câmera: ${det.small} rad`);
  await browser.close();
  if (errors.length) fail("erros na página: " + errors.join(" | "));
  console.log("pointer-lock ok", JSON.stringify(results));
} finally { server?.kill(); }
