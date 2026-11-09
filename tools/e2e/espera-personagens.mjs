#!/usr/bin/env node
// e2e da D-45 (docs/plano-construcao.md §7): a partida só começa com os personagens carregados.
//  1. espectro.glb segurado DELAY_MS (route do Playwright): depois do clique em "Começar" (teclado, foco no botão) o
//     botão fica em carregando (aria-busy, aria-disabled, foco mantido, aviso no #gost) e a simulação não anda
//     (G.t = 0) enquanto o caçador não tem o modelo; quando o .glb chega a partida começa sozinha e, em todo quadro
//     com G.t > 0, o caçador já é o modelo do .glb. No primeiro quadro do primeiro preparo (hunter.windup) os olhos
//     estão acesos; com o diretor de áudio ligado e o caçador dentro de audio.director.hunter_audible_radius (D-37)
//     do personagem visto, o telegraph_<kind> TEM de tocar no mesmo quadro (mesmo G.t) do visual; além do raio a
//     ausência é aceita e registrada.
//  2. espectro.glb com falha (route.abort): a partida começa com o modelo de reserva, cujos olhos também acendem no
//     primeiro quadro do primeiro preparo.
// Leitura por quadro: requestAnimationFrame registrado antes do laço do jogo lê o estado deixado pelo quadro anterior
// (simulação e sincronização das malhas do mesmo quadro). Ganchos só com ?debug=1 (D-33). Regras v1 (`?ruleset=v1`):
// só nelas o caçador tem preparo (hunter.windup, packages/sim/src/game.ts updateHunterV1), como em tools/audio/e2e-director.mjs.
// Uso: node tools/e2e/espera-personagens.mjs [url]   (sem url, sobe packages/server/dist/server.mjs numa porta livre)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { startServer } from "../lib/server.mjs";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }

/** atraso do .glb do caçador (pedido da supervisão: 6 s, acima da janela de ~1 s vista no staging) */
const DELAY_MS = 6000;
/** espera máxima do primeiro preparo depois do início (ms de relógio real): o SwiftShader na CPU desenha poucos quadros
 *  por segundo e o laço limita o quadro a client.max_frame_dt, então a partida anda mais devagar que o relógio */
const WINDUP_WAIT_MS = 240000;
/** preset e tela pequenos: menos rasterização na CPU (a prova é de ordem de eventos, não de imagem) */
const PRESET = "low", VIEWPORT = { width: 640, height: 360 };
/** semente com o primeiro preparo cedo nas regras v1 (projétil em G.t ≈ 9,7 s, caçador a ≈ 23 m do jogador parado:
 *  dentro de audio.director.hunter_audible_radius, então o telegraph sonoro também é conferido); varredura headless de
 *  createGame + step com o jogador parado, sementes 1 a 3000: `pnpm exec tsx tools/e2e/seed-scan.ts` */
const SEED = 40;
const HUNTER_GLB = /\/models\/espectro\.glb(\?|$)/;

/** raio audível do caçador (D-37), medido do personagem visto: dentro dele o telegraph sonoro é obrigatório */
const balance = JSON.parse(readFileSync(new URL("../../packages/shared/generated/balance.json", import.meta.url), "utf8"));
const AUDIBLE = balance.audio.director.hunter_audible_radius;

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
      // distância do caçador ao personagem visto (o jogador, vivo no início: main.ts draw, cameraTarget nulo)
      const P = G.survivors[0], dist = Math.hypot(P.x - G.hunter.x, P.z - G.hunter.z);
      window.__e2eFrames.push({ t: G.t, form: st.hunter, windup: w ? w.kind : null, eyes: st.telegraph, dist, perf: performance.now() });
    }
    const f = window.__e2eFrames, first = f.findIndex(x => x.windup);
    if (first < 0 || f.length - first < 60) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function scenario(browser, name, route) {
  const page = await browser.newPage({ viewport: VIEWPORT, locale: "pt-BR" });
  page.on("pageerror", e => fail(`${name}: pageerror ${e.message}`));
  // teto ui.start_wait_s atingido: com o .glb atrasado só DELAY_MS, é máquina lenta demais para esta prova
  page.on("console", m => { if (m.type() === "warning" && m.text().includes("ui.start_wait_s")) (page.__timeouts ??= []).push(m.text()); });
  await page.route(HUNTER_GLB, route);
  await page.goto(`${url}/?debug=1&ruleset=v1&seed=${SEED}&preset=${PRESET}`, { waitUntil: "load" });
  await page.evaluate(installRecorder);
  await page.focus("#go");
  const tClick = Date.now();
  await page.keyboard.press("Enter");
  return { page, tClick };
}

/** primeiro preparo: olhos acesos no primeiro quadro; telegraph sonoro (se tocou) no mesmo G.t */
async function checkWindup(page, name, form) {
  const t0 = Date.now();
  // só um resumo a cada leitura (a lista inteira sai no fim): não pesar no laço da página
  while (Date.now() - t0 < WINDUP_WAIT_MS) {
    const { n, i } = await page.evaluate(() => ({ n: window.__e2eFrames.length, i: window.__e2eFrames.findIndex(x => x.windup) }));
    if (i >= 0 && n - i >= 60) break;
    await sleep(500);
  }
  const frames = await page.evaluate(() => window.__e2eFrames);
  const i = frames.findIndex(x => x.windup);
  const last = frames[frames.length - 1];
  if (i < 0) { fail(`${name}: nenhum preparo do caçador em ${WINDUP_WAIT_MS / 1000} s (${frames.length} quadros gravados, último G.t = ${last?.t}, caçador ${last?.form})`); return; }
  const f = frames[i];
  console.log(`${name}: primeiro preparo (${f.windup}) em G.t = ${f.t.toFixed(3)} s; caçador ${f.form}, olhos ${f.eyes ? "acesos" : "APAGADOS"}`);
  if (f.form !== form) fail(`${name}: no primeiro quadro do preparo o caçador é '${f.form}', esperado '${form}'`);
  if (!f.eyes) fail(`${name}: olhos apagados no primeiro quadro do preparo (telegraph sem visual)`);
  const off = frames.slice(i).filter(x => x.windup && !x.eyes);
  if (off.length) fail(`${name}: ${off.length} quadro(s) com preparo e olhos apagados`);
  const plays = await page.evaluate(() => window.__thehellAudioDirector?.().plays ?? null);
  if (!plays) { console.log(`${name}: diretor de áudio desligado; só o visual conferido`); return; }
  // som do telegraph do primeiro preparo: mesmo G.t do primeiro quadro com o preparo e o kind dele
  const tele = plays.find(p => p.name === `telegraph_${f.windup}` && Math.abs(p.gameT - f.t) < 1e-9);
  if (f.dist > AUDIBLE) {
    // D-37: além do raio o telegraph não toca; ausência aceita só aqui
    console.log(`${name}: caçador a ${f.dist.toFixed(1)} m > ${AUDIBLE} m (audio.director.hunter_audible_radius, D-37): telegraph sonoro ${tele ? "tocou" : "não tocou (esperado)"}`);
    return;
  }
  if (!tele) {
    const other = plays.filter(p => p.name.startsWith("telegraph_")).map(p => `${p.name}@${p.gameT.toFixed(3)}`).join(", ") || "nenhum";
    fail(`${name}: caçador a ${f.dist.toFixed(1)} m ≤ ${AUDIBLE} m e sem telegraph_${f.windup} em G.t = ${f.t.toFixed(3)} s (telegraphs tocados: ${other})`);
    return;
  }
  console.log(`${name}: ${tele.name} tocado em G.t = ${tele.gameT.toFixed(3)} s, no quadro do visual (caçador a ${f.dist.toFixed(1)} m ≤ ${AUDIBLE} m)`);
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
    // menu travado na espera: loja, opções, classe, dificuldade e idioma não respondem (clique do mouse, Enter e o
    // .click() da navegação por gamepad); segundo Enter no #go não monta outra partida; o mouse não gira a câmera
    const before = await page.evaluate(() => {
      window.__g0 = window.__thehell();
      const pressed = sel => [...document.querySelectorAll(sel)].map(b => b.getAttribute("aria-pressed")).join();
      return { cls: pressed("#cls button"), dif: pressed("#dif button"), lang: pressed("#langs button"), canvas: document.querySelectorAll("canvas").length };
    });
    await page.keyboard.press("Enter");
    const locked = await page.evaluate(() => {
      for (const sel of ["#sh", "#op", "#cls button:last-child", "#dif button:last-child", "#langs button:last-child"]) document.querySelector(sel)?.click();
      const y0 = window.__thehellInput().yaw;
      document.dispatchEvent(new MouseEvent("mousemove", { movementX: 50, movementY: 0, bubbles: true }));
      const pressed = sel => [...document.querySelectorAll(sel)].map(b => b.getAttribute("aria-pressed")).join();
      const others = [...document.querySelectorAll("#menu button, #menu select, #menu input")].filter(e => e.id !== "go");
      return {
        shop: getComputedStyle(document.getElementById("shop")).display, opts: document.getElementById("opts").hidden,
        cls: pressed("#cls button"), dif: pressed("#dif button"), lang: pressed("#langs button"),
        sameGame: window.__thehell() === window.__g0, canvas: document.querySelectorAll("canvas").length,
        focus: document.activeElement?.id ?? null, yaw: window.__thehellInput().yaw - y0,
        inert: others.every(e => e.inert && e.getAttribute("aria-disabled") === "true"),
      };
    });
    console.log(`${name}: menu na espera: ${JSON.stringify(locked)}`);
    if (locked.shop !== "none") fail(`${name}: a loja abriu durante a espera`);
    if (!locked.opts) fail(`${name}: as opções abriram durante a espera`);
    if (locked.cls !== before.cls || locked.dif !== before.dif || locked.lang !== before.lang) fail(`${name}: classe, dificuldade ou idioma mudou durante a espera: ${JSON.stringify({ before, locked })}`);
    if (!locked.sameGame || locked.canvas !== before.canvas) fail(`${name}: o segundo Enter no #go montou outra partida`);
    if (locked.focus !== "go") fail(`${name}: o foco saiu do #go (${locked.focus})`);
    if (locked.yaw !== 0) fail(`${name}: o mouse girou a câmera durante a espera (${locked.yaw} rad)`);
    if (!locked.inert) fail(`${name}: controles do menu sem inert/aria-disabled durante a espera`);
    // clique real do mouse sobre a loja (por último: tira o foco do #go)
    const box = await page.locator("#sh").boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    if (await page.evaluate(() => getComputedStyle(document.getElementById("shop")).display) !== "none") fail(`${name}: o clique do mouse abriu a loja durante a espera`);
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
