#!/usr/bin/env node
// Teste de fumaça ponta a ponta: sobe o servidor compilado, abre o jogo no Chromium, inicia uma partida,
// anda 3 s, abre um gerador e confere estado, erros de console e /healthz. Grava uma captura.
// Uso: node tools/smoke.mjs [saida.png] [url]   (sem url, sobe packages/server/dist/server.mjs na porta 18080)
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }

const shot = process.argv[2] ?? "/tmp/thehell-smoke.png";
let url = process.argv[3], server;
if (!url) {
  url = "http://127.0.0.1:18080";
  server = spawn(process.execPath, ["packages/server/dist/server.mjs"], { env: { ...process.env, PORT: "18080" }, stdio: "inherit" });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(url + "/healthz")).ok) break; } catch { /* subindo */ } await sleep(100); }
}
const fail = (m) => { console.error("FALHA:", m); server?.kill(); process.exit(1); };
try {
  const health = await (await fetch(url + "/healthz")).json();
  if (!health.ok) fail("/healthz sem ok");
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  // idioma do navegador fixo em pt-BR: o HUD sai no idioma detectado (GDD v0.3 §12.5) e o texto conferido é o pt-BR
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, locale: "pt-BR" });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url, { waitUntil: "load" });
  await page.click("#go");
  await page.keyboard.down("KeyW"); await page.waitForTimeout(3000); await page.keyboard.up("KeyW");
  const s = await page.evaluate(() => { const g = window.__thehell(); return { t: g.t, z: g.survivors[0].z, gens: g.gens.length, hunter: g.hunter.hp, over: g.over }; });
  if (!(s.t > 2)) fail("a simulação não avançou: " + JSON.stringify(s));
  if (!(s.z < 25)) fail("o jogador não andou: " + JSON.stringify(s));
  if (s.gens !== 7) fail("esperava 4 geradores + 3 bônus");
  const top = await page.textContent("#top");
  if (!top.includes("Geradores 0/4")) fail("HUD sem contador de geradores: " + top);
  await page.screenshot({ path: shot });
  await browser.close();
  if (errors.length) fail("erros no console: " + errors.join(" | "));
  console.log("smoke ok", JSON.stringify({ version: health.version, ...s }), "→", shot);
} finally { server?.kill(); }
