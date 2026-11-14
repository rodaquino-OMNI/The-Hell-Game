#!/usr/bin/env node
// e2e da tela do Treino (V6; GDD-v0.3 §12.3; D-34): entra no Treino pelo menu só com o teclado, conclui "mover" de
// verdade (tecla de andar; barra = min(1, progress/goal)), conclui "gerador" com a tecla de interagir (check, sem
// barra), pula "quebra-cabeça" com dois apertos de P no mesmo quadro (uma etapa só), pula "resgate" pelo gamepad
// (botão `ui.controls.gamepad.buttons.tutorial_skip`, navigator.getGamepads simulado) e "habilidade" pelo botão
// "Pular etapa" (Tab + Enter), e chega à tela `tutorial_end` (não à tela de resultados) com feita/pulada por etapa.
// Depois: "Jogar partida" começa a partida normal na mesma página; num 2º Treino, tudo pulado e "Voltar ao menu".
// Abre com `?debug=1` e usa `window.__thehell` (D-33) para ler o estado e pôr o jogador perto do gerador-alvo, e
// `window.__thehellTutorial.hold` para segurar o aviso de etapa terminada na tela durante a conferência, e
// `window.__thehellView` para virar a câmera para o campo aberto (a mesma direção do jogador simulado em
// packages/sim/test/tutorial.test.ts).
// Uso: node tools/ui/v6-e2e.mjs [--shots dir] [url]   (pnpm build antes; sem url sobe o servidor compilado)
//   --shots  grava v6-barra.png, v6-check.png, v6-pulada.png e v6-fim.png (1280×720, deviceScaleFactor 2)
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { SEED } from "../lib/capture-page.mjs";
import { startServer } from "../lib/server.mjs";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }

const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const shotsIdx = args.indexOf("--shots");
const shotsDir = shotsIdx >= 0 ? args[shotsIdx + 1] : undefined;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
let url = args.find((a, i) => a.startsWith("http") && i !== shotsIdx + 1);
const balance = JSON.parse(readFileSync(join(root, "packages/shared/generated/balance.json"), "utf8"));
const T = JSON.parse(readFileSync(join(root, "packages/client/src/i18n/locales/pt-BR.json"), "utf8"));
const steps = balance.tutorial.steps;
const ui = balance.ui.tutorial;
/** espera máxima por uma condição (ms reais; a máquina carregada anda devagar) */
const WAIT = 20000;

let server;
if (!url) ({ url, child: server } = await startServer());

const failures = [];
const report = [];
const fail = (m) => { failures.push(m); console.error("FALHA:", m); };
const check = (ok, m) => { if (!ok) fail(m); };

try {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ locale: "pt-BR", viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  const game = (fn, arg) => page.evaluate(fn, arg);
  const tut = () => game(() => { const g = window.__thehell?.(); return g?.tutorial ? { ...g.tutorial, over: g.over, t: g.t } : null; });
  const waitFor = async (fn, what) => {
    const t0 = Date.now();
    for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > WAIT) { fail(`tempo esgotado esperando ${what}`); return null; } await sleep(30); }
  };
  const shot = async (name) => { if (shotsDir) await page.screenshot({ path: join(shotsDir, name) }); };
  const panel = () => page.evaluate(() => {
    const $ = (id) => document.getElementById(id);
    return {
      hidden: $("tut").hidden, header: $("tuth").textContent, name: $("tutt").textContent, outcome: $("tuto").textContent, mark: $("tutk").dataset.mark,
      markText: $("tutk").textContent, bar: !$("tutb").hidden, now: Number($("tutb").getAttribute("aria-valuenow")), width: $("tutb").firstElementChild.style.width,
      live: $("tutl").textContent, skip: $("tuts").textContent, marker: !$("tmk").hidden, edge: $("tmk").dataset.edge, anim: getComputedStyle($("tmk")).animationName,
    };
  });
  const full = `${url}/?debug=1&seed=${SEED}&lang=pt-BR`;

  // ---------- menu: Treino só pelo teclado ----------
  await page.goto(full, { waitUntil: "load" });
  check((await page.textContent("#tr")) === T["menu.tutorial"], `menu sem o botão "${T["menu.tutorial"]}"`);
  await page.focus("body");
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) { await page.keyboard.press("Tab"); reached = await page.evaluate(() => document.activeElement?.id === "tr"); }
  check(reached, "Tab não chegou ao botão Treino");
  await page.keyboard.press("Enter");
  const s0 = await waitFor(async () => { const s = await tut(); return s && s.t > 0.3 ? s : null; }, "o Treino começar");
  if (!s0) throw new Error("Treino não começou");
  check(s0.step === steps[0] && s0.index === 0, `primeira etapa ${s0.step}`);
  let p = await panel();
  check(!p.hidden && p.header === T["tut.header"].replace("{n}", "1").replace("{total}", String(steps.length)), `cabeçalho do painel: ${p.header}`);
  check(p.name === T["tut.step.move"] && p.bar && p.mark === "", `etapa mover: nome ${p.name}, barra ${p.bar}, marca "${p.mark}"`);
  check(p.live.includes(T["tut.step.move"]), `aria-live sem a primeira etapa: ${p.live}`);
  check((await page.getAttribute("#tutl", "aria-live")) === "polite", "anúncio da etapa sem aria-live polite");
  check(p.skip.includes("P") && p.skip.includes("Select"), `botão de pular sem a tecla e o botão do gamepad: ${p.skip}`);
  check(!p.marker, "marcador visível na etapa mover (sem alvo)");

  // ---------- mover: de verdade, barra = min(1, progress/goal) ----------
  await game(() => { window.__thehellView.yaw = Math.PI / 2; });
  await page.keyboard.down("KeyW");
  await waitFor(async () => ((await tut())?.progress ?? 0) >= balance.tutorial.move.distance * 0.45, "meio caminho de mover");
  await page.keyboard.up("KeyW");
  await sleep(150);
  const mid = await tut();
  p = await panel();
  const want = Math.round(Math.min(1, mid.progress / mid.goal) * 100);
  check(mid.step === "move" && Math.abs(p.now - want) <= 1 && p.width === `${p.now}%`, `barra ${p.now}% (largura ${p.width}), esperado ${want}% (progress ${mid.progress.toFixed(2)} / goal ${mid.goal})`);
  check(p.now > 0 && p.now < 100, `barra no meio esperada, veio ${p.now}%`);
  await shot("v6-barra.png");
  report.push(`mover: barra ${p.now}% com progress ${mid.progress.toFixed(2)}/${mid.goal} m`);
  await page.keyboard.down("KeyW");
  await waitFor(async () => ((await tut())?.index ?? 0) >= 1, "mover concluir");
  await page.keyboard.up("KeyW");
  p = await panel();
  check(p.name === T["tut.step.move"] && p.outcome === T["tut.done"] && p.bar && p.now === 100, `aviso de mover: ${JSON.stringify(p)}`);
  check(p.live.includes(T["tut.done"]) && p.live.includes(T["tut.step.generator"]), `aria-live da troca: ${p.live}`);

  // ---------- gerador: binário, sem barra; check quando chega o evento ----------
  await waitFor(async () => (await panel()).name === T["tut.step.generator"], "o painel passar ao gerador");
  p = await panel();
  check(!p.bar && p.mark === "empty" && p.outcome === "", `gerador em andamento: barra ${p.bar}, marca ${p.mark}`);
  check(p.marker, "sem marcador do gerador-alvo");
  // o jogador vai para perto do gerador-alvo (a navegação até lá é do jogador; o que se testa aqui é a tela)
  await game((r) => { const g = window.__thehell(), P = g.survivors[0], T = g.tutorial.target; P.x = T.x + r; P.z = T.z; }, balance.prototype_extras.interact_range.generator * 0.8);
  await sleep(100);
  // o aviso fica parado na tela para a conferência e a captura (gancho de depuração; a máquina lenta passaria de done_s)
  await game(() => window.__thehellTutorial.hold(true));
  await page.keyboard.press("KeyE");
  await waitFor(async () => ((await tut())?.index ?? 0) >= 2, "gerador concluir");
  p = await panel();
  check(p.name === T["tut.step.generator"] && p.mark === "check" && p.markText === "✓" && p.outcome === T["tut.done"] && !p.bar, `check do gerador: ${JSON.stringify(p)}`);
  await shot("v6-check.png");
  await game(() => window.__thehellTutorial.hold(false));
  // marcador na borda: alvo atrás da câmera
  await game(() => { window.__thehellView.yaw += Math.PI; });
  await sleep(150);
  const edge = await panel();
  check(edge.marker, "marcador sumiu com o alvo fora da vista");
  report.push(`gerador: check ✓ e "concluída"; marcador edge=${edge.edge} com o alvo atrás; animação com reduced-motion: ${edge.anim}`);
  check(edge.anim === "none", `marcador pulsando com prefers-reduced-motion: ${edge.anim}`);

  // ---------- quebra-cabeça: dois apertos de P em seguida pulam uma etapa só ----------
  const before = (await tut()).index;
  await game(() => window.__thehellTutorial.hold(true));
  // dois apertos no mesmo quadro (o mesmo evento de teclado do navegador, despachado duas vezes na mesma tarefa): o
  // Playwright espera cada tecla ser tratada, e com o quadro lento do swiftshader dois `press` seguidos caem em quadros
  // a mais de skip_debounce_s um do outro, o que mediria outra coisa
  await page.evaluate(() => { for (let i = 0; i < 2; i++) window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyP", key: "p", bubbles: true })); });
  await sleep(ui.skip_debounce_s * 1000 * 0.5);
  let s = await tut();
  check(s.index === before + 1, `dois P seguidos: etapa ${before} → ${s.index} (esperado +1)`);
  p = await panel();
  check(p.name === T["tut.step.puzzle"] && p.outcome === T["tut.skipped"] && p.mark === "skipped", `aviso de quebra-cabeça pulado: ${JSON.stringify(p)}`);
  check(p.live.includes(T["tut.skipped"]), `aria-live sem "etapa pulada": ${p.live}`);
  await shot("v6-pulada.png");
  await game(() => window.__thehellTutorial.hold(false));
  await sleep(ui.skip_debounce_s * 1000);

  // ---------- resgate: gamepad ----------
  check(s.step === "rescue", `etapa esperada resgate, veio ${s.step}`);
  await page.evaluate(() => {
    const pad = { connected: true, mapping: "standard", id: "simulado", index: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    window.__pad = pad;
    navigator.getGamepads = () => [pad];
    window.dispatchEvent(new Event("gamepadconnected"));
  });
  const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
  const btn = balance.ui.controls.gamepad.buttons.tutorial_skip;
  await frames();
  await game(() => window.__thehellTutorial.hold(true));
  await page.evaluate((b) => { window.__pad.buttons[b] = { pressed: true, value: 1 }; }, btn); await frames();
  await page.evaluate((b) => { window.__pad.buttons[b] = { pressed: false, value: 0 }; }, btn); await frames();
  s = await waitFor(async () => { const x = await tut(); return x.index >= 4 ? x : null; }, "o gamepad pular o resgate");
  const caged = await game(() => window.__thehell().survivors.filter(x => x.st === "cage").length);
  check(caged === 0, `aliado ainda preso depois de pular o resgate (${caged})`);
  p = await panel();
  check(p.name === T["tut.step.rescue"] && p.outcome === T["tut.skipped"], `aviso do resgate pulado: ${p.name} ${p.outcome}`);
  await game(() => window.__thehellTutorial.hold(false));
  await sleep(ui.skip_debounce_s * 1000);

  // ---------- habilidade: botão "Pular etapa" pelo teclado ----------
  let onBtn = false;
  for (let i = 0; i < 30 && !onBtn; i++) { await page.keyboard.press("Tab"); onBtn = await page.evaluate(() => document.activeElement?.id === "tuts"); }
  check(onBtn, "Tab não chegou ao botão Pular etapa");
  const size = await page.$eval("#tuts", b => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  check(size.w >= 24 && size.h >= 24, `botão Pular etapa menor que 24 px: ${JSON.stringify(size)}`);
  await page.keyboard.press("Enter");

  // ---------- tela tutorial_end (depois do aviso da última etapa) ----------
  await page.waitForSelector("#tend", { state: "visible", timeout: WAIT });
  check(!(await page.isVisible("#end")), "a tela de resultados da partida apareceu no fim do Treino");
  check(!(await page.isVisible("#hud")), "HUD visível na tela de fim do Treino");
  const end = await page.evaluate(() => ({
    title: document.getElementById("tet").textContent, sub: document.getElementById("tes").textContent, focus: document.activeElement?.id,
    rows: [...document.querySelectorAll("#tel li")].map(li => [li.dataset.outcome, li.textContent]),
    buttons: [...document.querySelectorAll("#tend button")].map(b => b.textContent),
  }));
  check(end.title === T["tutend.title"], `título do fim: ${end.title}`);
  check(end.focus === "tplay", `foco no fim: ${end.focus}`);
  check(end.rows.map(r => r[0]).join() === "done,done,skipped,skipped,skipped", `lista do fim: ${JSON.stringify(end.rows)}`);
  check(end.rows[0][1].includes(T["tutend.item_done"]) && end.rows[2][1].includes(T["tutend.item_skipped"]), `rótulos feita/pulada: ${JSON.stringify(end.rows)}`);
  check(end.buttons.join() === [T["tutend.play"], T["tutend.menu"]].join(), `botões do fim: ${end.buttons}`);
  const tutEnd = await game(() => window.__thehell().over);
  check(tutEnd === true, "partida do Treino não acabou");
  await shot("v6-fim.png");
  report.push(`fim: ${end.rows.map(r => r[0]).join(", ")}; "${end.sub}"`);

  // ---------- "Jogar partida": partida normal na mesma página ----------
  await page.keyboard.press("Enter");
  const normal = await waitFor(async () => { const g = await game(() => { const x = window.__thehell(); return { tut: !!x.tutorial, t: x.t, over: x.over }; }); return !g.tut && g.t > 0.5 ? g : null; }, "a partida normal começar");
  check(!!normal && !normal.over, "partida normal não começou depois de Jogar partida");
  check(!(await page.isVisible("#tend")) && !(await page.isVisible("#tut")) && (await page.isVisible("#top")), "tela do Treino ainda visível na partida normal");
  report.push(`Jogar partida: partida normal em t=${normal?.t.toFixed(2)} s, sem painel do Treino`);

  // ---------- 2º Treino: tudo pulado com P, "Voltar ao menu" ----------
  await page.goto(full, { waitUntil: "load" });
  await page.click("#tr");
  await waitFor(async () => { const x = await tut(); return x && x.t > 0.3 ? x : null; }, "o 2º Treino começar");
  for (let i = 0; i < steps.length; i++) {
    await page.keyboard.press("KeyP");
    await waitFor(async () => ((await tut())?.index ?? -1) >= i + 1, `P pular a etapa ${i + 1}`);
    await sleep(ui.skip_debounce_s * 1000 + 50);
  }
  await page.waitForSelector("#tend", { state: "visible", timeout: WAIT });
  const rows2 = await page.$$eval("#tel li", ls => ls.map(l => l.dataset.outcome));
  check(rows2.every(r => r === "skipped") && rows2.length === steps.length, `2º Treino: ${rows2}`);
  await page.keyboard.press("Tab");
  check((await page.evaluate(() => document.activeElement?.id)) === "tmenu", "Tab não foi para Voltar ao menu");
  await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.keyboard.press("Enter")]);
  check(await page.isVisible("#menu"), "Voltar ao menu não mostrou o menu");
  report.push(`2º Treino: ${rows2.length} etapas puladas com P, Voltar ao menu ok`);

  if (errors.length) fail(`erros no console: ${errors.join(" | ")}`);
  await browser.close();
} catch (e) {
  fail(String(e?.stack ?? e));
} finally { server?.kill(); }

console.log(report.map(r => "  " + r).join("\n"));
if (failures.length) { console.error(`v6-e2e: ${failures.length} falha(s)`); process.exit(1); }
console.log("v6-e2e ok: Treino pelo menu, barra, check, pular (P, gamepad, botão), tutorial_end, Jogar partida e Voltar ao menu");
