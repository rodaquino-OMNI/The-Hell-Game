#!/usr/bin/env node
// e2e do motor de áudio (item A-1 do V5, GDD v0.3 §11): com a política de autoplay que exige gesto, o AudioContext
// não está "running" antes do clique e fica "running" depois do clique que inicia a partida; zero erros no console.
// Lê o gancho só-leitura window.__thehellAudio (packages/client/src/audio/engine.ts). Molde: tools/smoke.mjs.
// Uso: node tools/audio/e2e.mjs [url]   (sem url, sobe packages/server/dist/server.mjs na porta 18081)
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }

/** porta própria (o smoke usa 18080), para os dois poderem rodar na mesma máquina */
const PORT = "18081";
/** espera máxima (ms) pelo servidor e pela transição para "running" após o clique; folga para máquina carregada */
const SERVER_WAIT_MS = 5000, RUNNING_WAIT_MS = 5000;

let url = process.argv[2], server;
if (!url) {
  url = "http://127.0.0.1:" + PORT;
  server = spawn(process.execPath, ["packages/server/dist/server.mjs"], { env: { ...process.env, PORT }, stdio: "inherit" });
  for (const end = Date.now() + SERVER_WAIT_MS; Date.now() < end;) { try { if ((await fetch(url + "/healthz")).ok) break; } catch { /* subindo */ } await sleep(100); }
}
let browser;
const fail = async (m) => { console.error("FALHA:", m); await browser?.close().catch(() => {}); server?.kill(); process.exit(1); };
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
  if (before.state === "running") await fail("o AudioContext já estava running antes do clique: " + JSON.stringify(before));
  for (const b of ["master", "music", "sfx", "voice", "ui"]) {
    const v = before.buses?.[b];
    if (!(typeof v === "number" && v >= 0 && v <= 1)) await fail(`volume do barramento ${b} inválido: ` + JSON.stringify(before));
  }
  // mesmo botão que o smoke usa para iniciar a partida
  await page.click("#go");
  let after = await read();
  for (const end = Date.now() + RUNNING_WAIT_MS; after?.state !== "running" && Date.now() < end;) { await page.waitForTimeout(50); after = await read(); }
  if (after?.state !== "running") await fail("o AudioContext não ficou running depois do clique: " + JSON.stringify(after));
  // a partida rodou de fato (bipes e batimento passam pelo barramento sfx sem erro)
  await page.waitForTimeout(500);
  await browser.close();
  browser = undefined;
  if (errors.length) await fail("erros no console: " + errors.join(" | "));
  console.log("audio e2e ok", JSON.stringify({ version: health.version, antes: before.state, depois: after.state, buses: after.buses }));
} catch (e) {
  await fail(e?.stack ?? String(e));
} finally { server?.kill(); }
