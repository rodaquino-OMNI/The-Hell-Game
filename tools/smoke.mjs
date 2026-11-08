#!/usr/bin/env node
// Teste de fumaça ponta a ponta: sobe o servidor compilado, abre o jogo no Chromium, inicia uma partida,
// anda 3 s para a frente (W) e 1,5 s de simulação para o lado (A), confere o deslocamento, o estado, erros de console
// e /healthz. Grava uma captura.
// Uso: node tools/smoke.mjs [saida.png] [url]   (sem url, sobe packages/server/dist/server.mjs na porta 18080)
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }

const { parse } = require("yaml");

// Deslocamento mínimo esperado: velocidade de caminhada × tempo simulado × TOLERANCIA, limitado pela distância livre
// até a primeira parede no caminho (o jogador nasce a 4,05 m da parede [0, 20, 6, 3] do pátio e para em z = 21,95).
// Números de jogo vêm de data/balance.yaml (survivor.walk, survivor.radius) e de data/maps/patio.json (walls).
const balance = parse(readFileSync(new URL("../data/balance.yaml", import.meta.url), "utf8"));
const walls = JSON.parse(readFileSync(new URL("../data/maps/patio.json", import.meta.url), "utf8")).walls;
const { walk, radius } = balance.survivor;
/** folga do teste (não é número de jogo): latência entre o tecla-abaixo/acima e o passo que a lê, medida em tempo simulado */
const TOLERANCIA = 0.75;
/** erro de ponto flutuante aceito ao comparar com a posição de contato na parede */
const EPS = 1e-6;
/** tempo simulado mínimo da fase de passo lateral (s); limite em tempo real para máquinas carregadas */
const LATERAL_SIM = 1.5, LATERAL_REAL_MS = 8000;

/** distância livre andando de (x, z) na direção do eixo (dx, dz) ∈ {±1, 0} até encostar (raio incluso) numa parede */
function freeRun(x, z, dx, dz) {
  let free = Infinity;
  for (const [wx, wz, ww, wd] of walls) {
    const hx = ww / 2 + radius, hz = wd / 2 + radius;
    if (dx === 0 && Math.abs(x - wx) < hx) { const d = dz < 0 ? z - (wz + hz) : (wz - hz) - z; if (d >= -EPS) free = Math.min(free, Math.max(0, d)); }
    if (dz === 0 && Math.abs(z - wz) < hz) { const d = dx < 0 ? x - (wx + hx) : (wx - hx) - x; if (d >= -EPS) free = Math.min(free, Math.max(0, d)); }
  }
  return free;
}

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
  const read = () => page.evaluate(() => { const g = window.__thehell(); const p = g.survivors[0]; return { t: g.t, x: p.x, z: p.z, gens: g.gens.length, hunter: g.hunter.hp, over: g.over }; });
  /** confere que o jogador andou ao menos walk × Δt × TOLERANCIA (ou até a parede) na direção (dx, dz), sem atravessá-la */
  const moved = (fase, a, b, dx, dz) => {
    const free = freeRun(a.x, a.z, dx, dz), need = Math.min(walk * (b.t - a.t) * TOLERANCIA, free);
    const along = (b.x - a.x) * dx + (b.z - a.z) * dz, across = Math.abs((b.x - a.x) * dz) + Math.abs((b.z - a.z) * dx);
    const info = JSON.stringify({ de: a, para: b, andou: along, minimo: need, livre: free });
    if (!(along >= need - EPS)) fail(`o jogador não andou o esperado (${fase}): ` + info);
    if (!(along <= free + EPS)) fail(`o jogador atravessou a parede (${fase}): ` + info);
    if (!(across < EPS)) fail(`o jogador saiu da direção pedida (${fase}): ` + info);
    return along;
  };
  const s0 = await read();
  await page.keyboard.down("KeyW"); await page.waitForTimeout(3000); await page.keyboard.up("KeyW");
  const s = await read();
  if (!(s.t > 2)) fail("a simulação não avançou: " + JSON.stringify(s));
  // yaw 0 (main.ts: init) olha para −z (perception.ts: yaw a olha para (−sen a, −cos a)); A anda para −x
  const frente = moved("W", s0, s, 0, -1);
  await page.keyboard.down("KeyA");
  const fim = Date.now() + LATERAL_REAL_MS;
  let s2 = await read();
  while (s2.t - s.t < LATERAL_SIM && Date.now() < fim) { await page.waitForTimeout(100); s2 = await read(); }
  await page.keyboard.up("KeyA");
  s2 = await read();
  if (!(s2.t - s.t >= LATERAL_SIM)) fail("a simulação não avançou na fase lateral: " + JSON.stringify(s2));
  const lado = moved("A", s, s2, -1, 0);
  if (s.gens !== 7) fail("esperava 4 geradores + 3 bônus");
  const top = await page.textContent("#top");
  if (!top.includes("Geradores 0/4")) fail("HUD sem contador de geradores: " + top);
  await page.screenshot({ path: shot });
  await browser.close();
  if (errors.length) fail("erros no console: " + errors.join(" | "));
  console.log("smoke ok", JSON.stringify({ version: health.version, ...s2, frente, lado }), "→", shot);
} finally { server?.kill(); }
