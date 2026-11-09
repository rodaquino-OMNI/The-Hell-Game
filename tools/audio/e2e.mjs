#!/usr/bin/env node
// e2e do motor de áudio (item A-1 do V5, GDD v0.3 §11). Lê o gancho só-leitura window.__thehellAudio
// (packages/client/src/audio/engine.ts) e confere:
//  1. antes do clique o AudioContext não existe (state "none"): prova a criação preguiçosa. Não dá para provar o
//     bloqueio de autoplay aqui: no Chromium headless do Playwright um contexto criado sem gesto já nasce "running",
//     mesmo com --autoplay-policy=user-gesture-required (a flag fica, para quando o navegador a respeitar);
//  2. depois do clique que inicia a partida, state === "running";
//  3. o barramento sfx toca de verdade: um GameEvent de som ({type: "sound", name}, packages/sim/src/types.ts) entra
//     na fila da partida (window.__thehell().events, esvaziada por drainEvents a cada quadro) e main.ts o toca com
//     beep() pelo barramento sfx; o contador plays.sfx do gancho tem de subir;
//  4. zero erros de console e pageerror.
// Molde: tools/smoke.mjs. Uso: node tools/audio/e2e.mjs [url]   (sem url, sobe packages/server/dist/server.mjs numa porta livre)
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }

/** porta efêmera livre escolhida pelo sistema (nunca a 18080 do smoke): um servidor velho esquecido numa porta fixa
 *  responderia /healthz no lugar do servidor recém-compilado */
const freePort = () => new Promise((ok, ko) => { const s = createServer(); s.once("error", ko); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(String(port))); }); });
/** esperas máximas (ms): servidor subir, contexto ficar "running" e o bipe passar pelo laço de quadros; folga para máquina carregada */
const SERVER_WAIT_MS = 5000, RUNNING_WAIT_MS = 5000, BEEP_WAIT_MS = 5000;
/** som injetado: um dos nomes de GameEvent "sound" (packages/sim/src/types.ts), tocado por SOUNDS em beeps.ts */
const SOUND = "puzzle_ok";

let browser, server;
const fail = async (m) => { console.error("FALHA:", m); await browser?.close().catch(() => {}); server?.kill(); process.exit(1); };
let url = process.argv[2];
if (!url) {
  const PORT = await freePort();
  url = "http://127.0.0.1:" + PORT;
  server = spawn(process.execPath, ["packages/server/dist/server.mjs"], { env: { ...process.env, PORT }, stdio: "inherit" });
  let up = false;
  for (const end = Date.now() + SERVER_WAIT_MS; Date.now() < end;) {
    // servidor que saiu (porta ocupada por outro processo, build ausente): não testar contra quem já estava na porta
    if (server.exitCode !== null) await fail(`o servidor saiu com código ${server.exitCode} (porta ${PORT} ocupada?)`);
    try { if ((await fetch(url + "/healthz")).ok) { up = true; break; } } catch { /* subindo */ }
    await sleep(100);
  }
  if (!up) await fail("o servidor não respondeu /healthz a tempo");
}
try {
  const health = await (await fetch(url + "/healthz")).json();
  if (!health.ok) await fail("/healthz sem ok");
  browser = await chromium.launch({ args: ["--autoplay-policy=user-gesture-required", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, locale: "pt-BR" });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url, { waitUntil: "load" });
  const read = () => page.evaluate(() => typeof window.__thehellAudio === "function" ? window.__thehellAudio() : null);
  const before = await read();
  if (!before) await fail("gancho window.__thehellAudio ausente");
  if (before.state !== "none") await fail("o AudioContext existia antes do clique (devia ser preguiçoso): " + JSON.stringify(before));
  if (before.plays?.sfx !== 0) await fail("bipe tocado antes do clique: " + JSON.stringify(before));
  for (const b of ["master", "music", "sfx", "voice", "ui"]) {
    const v = before.buses?.[b];
    if (!(typeof v === "number" && v >= 0 && v <= 1)) await fail(`volume do barramento ${b} inválido: ` + JSON.stringify(before));
  }
  // mesmo botão que o smoke usa para iniciar a partida
  await page.click("#go");
  let after = await read();
  for (const end = Date.now() + RUNNING_WAIT_MS; after?.state !== "running" && Date.now() < end;) { await page.waitForTimeout(50); after = await read(); }
  if (after?.state !== "running") await fail("o AudioContext não ficou running depois do clique: " + JSON.stringify(after));
  // bipe pelo caminho real: evento de som na fila da partida → main.ts → beep() → barramento sfx
  const base = after.plays.sfx;
  const queued = await page.evaluate(name => { const g = window.__thehell?.(); if (!g || !Array.isArray(g.events)) return false; g.events.push({ type: "sound", name }); return true; }, SOUND);
  if (!queued) await fail("partida sem fila de eventos (window.__thehell().events)");
  let played = await read();
  for (const end = Date.now() + BEEP_WAIT_MS; !(played.plays.sfx > base) && Date.now() < end;) { await page.waitForTimeout(50); played = await read(); }
  if (!(played.plays.sfx > base)) await fail("o bipe não passou pelo barramento sfx: " + JSON.stringify(played));
  await browser.close();
  browser = undefined;
  if (errors.length) await fail("erros no console: " + errors.join(" | "));
  console.log("audio e2e ok", JSON.stringify({ version: health.version, antes: before.state, depois: played.state, plays: played.plays, buses: played.buses }));
} catch (e) {
  await fail(e?.stack ?? String(e));
} finally { server?.kill(); }
