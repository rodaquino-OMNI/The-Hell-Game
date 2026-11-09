#!/usr/bin/env node
// Teste de fumaça ponta a ponta: sobe o servidor compilado, abre o jogo no Chromium, inicia uma partida,
// anda 1,5 s de simulação para a frente (W) e 1,5 s para o lado (A), confere o deslocamento, o estado, erros de console
// e /healthz. Grava uma captura. Partida com semente fixa (SEED), iniciada pelo teclado; a câmera tem de ficar em yaw 0.
// Também confere o portão dos ganchos de depuração (D-33): sem `?debug=1` nenhum `window.__thehell*` existe; com ele,
// os quatro ganchos das ferramentas existem.
// Uso: node tools/smoke.mjs [saida.png] [url]   (sem url, sobe packages/server/dist/server.mjs na porta 18080)
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }

const { parse } = require("yaml");

// Deslocamento esperado: velocidade de caminhada × tempo simulado em que a tecla ficou de fato apertada, limitado pela
// distância livre até a primeira parede no caminho (o jogador nasce a 4,05 m da parede [0, 20, 6, 3] do pátio e para
// em z = 21,95). O tempo e a posição são lidos dentro da página nos próprios eventos keydown/keyup: entre eles nenhum
// passo roda (o laço é um só), então todo passo de `step` entre os dois eventos leu a tecla apertada e o deslocamento
// tem de bater com walk × Δt (ou com a parede) a menos de EPS, em qualquer carga da máquina.
// Números de jogo vêm de data/balance.yaml (survivor.walk, survivor.radius) e de data/maps/patio.json (walls).
const balance = parse(readFileSync(new URL("../data/balance.yaml", import.meta.url), "utf8"));
const walls = JSON.parse(readFileSync(new URL("../data/maps/patio.json", import.meta.url), "utf8")).walls;
const { walk, radius } = balance.survivor;
/** erro de ponto flutuante aceito ao comparar o deslocamento com walk × Δt e com a posição de contato na parede (m) */
const EPS = 1e-6;
/**
 * tempo simulado mínimo com a tecla apertada em cada fase (s; parâmetros do teste, não números de jogo): em W, 1,5 s
 * a 4 m/s passa dos 4,05 m livres e prova o contato com a parede; em A, o deslocamento livre prova a velocidade.
 * HOLD_REAL_MS é o limite em tempo real para máquinas carregadas: quadro acima de client.max_frame_dt descarta o
 * excesso (packages/client/src/loop.ts), então sob carga a simulação corre bem mais devagar que o relógio (medido:
 * 1 s simulado em 20 s reais com carga ~16). Só prova que a simulação anda; a conferência de movimento é exata.
 */
const HOLD_SIM = 1.5, HOLD_REAL_MS = 60000;
/** ganchos globais que as ferramentas usam (packages/client/src/debug-hooks.ts); __thehellView só existe com ?retro=1 */
const DEBUG_HOOKS = ["__thehell", "__thehellRender", "__thehellCharactersReady", "__thehellAudio"];
/**
 * semente fixa da partida (`?seed=`, packages/client/src/render/options.ts → createGame em main.ts): combinação de
 * geradores, gaiola e saída, caçador e bots iguais em toda execução. Parâmetro do teste, não número de jogo.
 */
const SEED = 1;
/** a mesma URL com `?debug=1` (D-33) */
const withDebug = (u) => { const x = new URL(u); x.searchParams.set("debug", "1"); return x.href; };
/** com `?debug=1` e a semente fixa */
const withDebugSeed = (u) => { const x = new URL(withDebug(u)); x.searchParams.set("seed", String(SEED)); return x.href; };

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
  // queda do renderizador (p.ex. morto por falta de memória na máquina): falha com causa explícita, sem repetir
  page.on("crash", () => fail("o processo da página do Chromium caiu (falta de memória na máquina?)"));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  const hooks = () => page.evaluate(() => Object.keys(window).filter(k => k.startsWith("__thehell")).sort());
  await page.goto(url, { waitUntil: "load" });
  const off = await hooks();
  if (off.length) fail("ganchos de depuração expostos sem ?debug=1: " + off.join(", "));
  await page.goto(withDebugSeed(url), { waitUntil: "load" });
  const on = await hooks();
  const missing = DEBUG_HOOKS.filter(k => !on.includes(k));
  if (missing.length) fail("ganchos de depuração ausentes com ?debug=1: " + missing.join(", "));
  // inicia pelo teclado (foco + Enter, ativa o botão como o clique): o clique do mouse faz o Chromium emitir um
  // mousemove com movementX = −clientX do botão (−568 px); se o pointer lock já estiver ativo, input.ts o lê como
  // giro de câmera (yaw −= movementX × 0,0025 = 1,42 rad) e W passa a andar quase em −x. A fumaça não testa o mouse.
  await page.focus("#go");
  await page.keyboard.press("Enter");
  const read = () => page.evaluate(() => { const g = window.__thehell(); const p = g.survivors[0]; return { t: g.t, x: p.x, z: p.z, yaw: p.a, slow: p.slow, st: p.st, gens: g.gens.length, hunter: g.hunter.hp, over: g.over }; });
  // estado da partida no instante de cada keydown/keyup (fase de captura, antes do onkeydown do jogo; nenhum passo
  // roda durante o despacho do evento, então a ordem entre os dois ouvintes não muda o estado lido)
  await page.evaluate(() => {
    const log = window.__smokeKeys = [];
    const rec = e => { if (e.repeat) return; const g = window.__thehell(), p = g.survivors[0]; log.push({ code: e.code, type: e.type, t: g.t, x: p.x, z: p.z, yaw: p.a, slow: p.slow, st: p.st }); };
    addEventListener("keydown", rec, true); addEventListener("keyup", rec, true);
  });
  /** aperta `code`, espera HOLD_SIM s de simulação desde o keydown (até HOLD_REAL_MS), solta; devolve os dois registros */
  const hold = async (code) => {
    await page.keyboard.down(code);
    const fim = Date.now() + HOLD_REAL_MS;
    const held = () => page.evaluate(c => { const d = window.__smokeKeys.findLast(k => k.code === c && k.type === "keydown"); return d ? window.__thehell().t - d.t : 0; }, code);
    while ((await held()) < HOLD_SIM && Date.now() < fim) await page.waitForTimeout(50);
    await page.keyboard.up(code);
    const k = await page.evaluate(c => window.__smokeKeys.filter(k => k.code === c), code);
    const a = k.findLast(x => x.type === "keydown"), b = k.findLast(x => x.type === "keyup");
    if (!a || !b) fail(`eventos de ${code} não chegaram à página: ` + JSON.stringify(k));
    if (!(b.t - a.t >= HOLD_SIM)) fail(`a simulação não avançou com ${code} apertada (${HOLD_SIM} s em ${HOLD_REAL_MS} ms): ` + JSON.stringify({ de: a, para: b }));
    return [a, b];
  };
  /** a câmera não pode ter girado: sem mouse nem setas, o yaw continua 0 (main.ts: init) */
  const yawZero = (fase, s) => { if (s.yaw !== 0) fail(`a câmera girou sem entrada (${fase}): ` + JSON.stringify(s)); };
  /**
   * confere que, entre o keydown (a) e o keyup (b), o jogador andou exatamente min(walk × Δt, distância livre até a
   * parede) na direção (dx, dz), a menos de EPS: nem menos (velocidade quebrada, entrada perdida), nem mais (atravessou
   * a parede, velocidade acima de survivor.walk), nem de lado
   */
  const moved = (fase, a, b, dx, dz) => {
    const free = freeRun(a.x, a.z, dx, dz), expected = Math.min(walk * (b.t - a.t), free);
    const along = (b.x - a.x) * dx + (b.z - a.z) * dz, across = Math.abs((b.x - a.x) * dz) + Math.abs((b.z - a.z) * dx);
    const info = JSON.stringify({ de: a, para: b, andou: along, esperado: expected, livre: free });
    if (a.st !== "ok" || b.st !== "ok" || a.slow > 0 || b.slow > 0) fail(`o jogador não estava livre e sem lentidão (${fase}): ` + info);
    if (!(along >= expected - EPS)) fail(`o jogador não andou o esperado (${fase}): ` + info);
    if (!(along <= free + EPS)) fail(`o jogador atravessou a parede (${fase}): ` + info);
    if (!(along <= expected + EPS)) fail(`o jogador andou mais rápido que survivor.walk (${fase}): ` + info);
    if (!(across < EPS)) fail(`o jogador saiu da direção pedida (${fase}): ` + info);
    return along;
  };
  // partida iniciada e rodando (ao menos um passo, sem fim de jogo) antes de apertar qualquer tecla de movimento
  await page.waitForFunction(() => { const g = window.__thehell(); return !!g && g.t > 0 && !g.over; }, null, { timeout: HOLD_REAL_MS });
  const s0 = await read();
  yawZero("início", s0);
  // yaw 0 (main.ts: init) olha para −z (perception.ts: yaw a olha para (−sen a, −cos a)); A anda para −x
  const [w0, w1] = await hold("KeyW");
  yawZero("W", w0); yawZero("W", w1);
  const frente = moved("W", w0, w1, 0, -1);
  const s = await read();
  const [a0, a1] = await hold("KeyA");
  yawZero("A", a0); yawZero("A", a1);
  const lado = moved("A", a0, a1, -1, 0);
  const s2 = await read();
  if (s.gens !== 7) fail("esperava 4 geradores + 3 bônus");
  const top = await page.textContent("#top");
  if (!top.includes("Geradores 0/4")) fail("HUD sem contador de geradores: " + top);
  await page.screenshot({ path: shot });
  await browser.close();
  if (errors.length) fail("erros no console: " + errors.join(" | "));
  console.log("smoke ok", JSON.stringify({ version: health.version, ...s2, frente, lado, ganchos: on }), "→", shot);
} finally { server?.kill(); }
