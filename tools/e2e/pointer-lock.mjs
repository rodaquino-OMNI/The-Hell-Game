#!/usr/bin/env node
// E2E do salto de câmera ao adquirir o pointer lock: o Chromium pode emitir, ao travar o ponteiro pelo clique em
// "#go", um mousemove com movementX espúrio (≈ clientX do cursor) que girava a câmera ≈ 1,4 rad
// (packages/client/src/pointer-filter.ts; limite em data/balance.yaml `client.mouse_max_delta`). Inicia a partida com
// um clique real do mouse em "#go" (page.mouse.click no centro do botão), várias vezes (a corrida é intermitente), e confere que o yaw do
// sobrevivente (`__thehell().survivors[0].a`, que é o yaw da câmera de cada passo) continua 0 depois do início.
// Uso: node tools/e2e/pointer-lock.mjs [url]   (sem url, sobe packages/server/dist/server.mjs numa porta livre: tools/lib/server.mjs)
import { createRequire } from "node:module";
import { startServer } from "../lib/server.mjs";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }

/** parâmetros do teste (não são números de jogo): partidas iniciadas, espera após o clique, folga de ponto flutuante */
const STARTS = 5, SETTLE_MS = 1000, EPS = 1e-6;
/** tempo simulado mínimo (s) depois do clique para a leitura valer */
const MIN_T = 0.2;
/** fase 2: o mouse anda NUDGE px depois do lock. NUDGE_MAX (rad) separa o giro legítimo disso (centésimos de rad com a
 * sensibilidade atual do protótipo, 0,0025 rad/px) do salto do bug (≈ 1,4 rad) com folga dos dois lados */
const NUDGE = 2, NUDGE_MAX = 0.1;

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
  await browser.close();
  if (errors.length) fail("erros na página: " + errors.join(" | "));
  console.log("pointer-lock ok", JSON.stringify(results));
} finally { server?.kill(); }
