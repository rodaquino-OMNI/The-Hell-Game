#!/usr/bin/env node
// e2e das telas do R6 (GDD v0.2 §7.1–7.3): escolha de dificuldade no menu só pelo teclado, persistência depois de
// recarregar, dificuldade aplicada à partida (vida do caçador do v1) e tela de fim com as 4 categorias, o total e as
// moedas. Abre com `?debug=1&ruleset=v1` e usa o gancho somente-leitura já existente `window.__thehell` (D-33) para
// encurtar a partida (caçador a 0 de vida depois de alguns segundos de jogo dos bots).
// Uso: node tools/ui/r6-e2e.mjs [--shots dir] [url]   (pnpm build antes; sem url sobe o servidor compilado na 18086)
//   --shots  grava r6-dificuldade.png e r6-fim.png (1280×720, deviceScaleFactor 2)
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { RULES, SEED } from "../lib/capture-page.mjs";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }

const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const shotsIdx = args.indexOf("--shots");
const shotsDir = shotsIdx >= 0 ? args[shotsIdx + 1] : undefined;
let url = args.find((a, i) => a.startsWith("http") && i !== shotsIdx + 1);
const balance = JSON.parse(readFileSync(join(root, "packages/shared/generated/balance.json"), "utf8"));
const T = JSON.parse(readFileSync(join(root, "packages/client/src/i18n/locales/pt-BR.json"), "utf8"));
/** dificuldade escolhida no teste: a 3ª da tabela (Difícil), diferente do padrão dos dados */
const PICK = Object.keys(balance.difficulty_table)[2];
/** tempo de jogo (s de simulação) antes de encerrar a partida pelo gancho */
const PLAY_S = 4;

let server;
if (!url) {
  url = "http://127.0.0.1:18086";
  server = spawn(process.execPath, ["packages/server/dist/server.mjs"], { cwd: root, env: { ...process.env, PORT: "18086" }, stdio: "inherit" });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(url + "/healthz")).ok) break; } catch { /* subindo */ } await sleep(100); }
}

const failures = [];
const fail = (m) => { failures.push(m); console.error("FALHA:", m); };
const check = (ok, m) => { if (!ok) fail(m); };

try {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ locale: "pt-BR", viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  const game = (fn, arg) => page.evaluate(fn, arg);
  const full = `${url}/?debug=1&seed=${SEED}&ruleset=v1&lang=pt-BR`;

  // ---------- menu: dificuldade só pelo teclado ----------
  await page.goto(full, { waitUntil: "load" });
  await page.evaluate(() => localStorage.removeItem("thehell.difficulty"));
  await page.reload({ waitUntil: "load" });
  const pressed = () => page.$$eval("#dif button", bs => bs.map(b => [b.dataset.d, b.getAttribute("aria-pressed"), b.textContent]));
  let bs = await pressed();
  check(bs.length === Object.keys(balance.difficulty_table).length, `seletor com ${bs.length} níveis`);
  check(bs.find(b => b[1] === "true")?.[0] === balance.difficulty, `padrão marcado: ${JSON.stringify(bs)}`);
  check(bs.map(b => b[2]).join() === ["easy", "normal", "hard", "nightmare"].map(d => T[`difficulty.${d}`]).join(), `nomes: ${bs.map(b => b[2])}`);
  // só pelo gamepad (navigator.getGamepads simulado, como em tools/a11y/axe.mjs): direcional até o último nível, A marca
  const LAST = Object.keys(balance.difficulty_table).at(-1);
  const m = balance.ui.controls.gamepad.menu;
  await page.evaluate(() => {
    const pad = { connected: true, mapping: "standard", id: "simulado", index: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    window.__pad = pad;
    navigator.getGamepads = () => [pad];
    window.dispatchEvent(new Event("gamepadconnected"));
    document.activeElement?.blur();
  });
  const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
  const press = async (i) => {
    await page.evaluate((b) => { window.__pad.buttons[b] = { pressed: true, value: 1 }; }, i); await frames();
    await page.evaluate((b) => { window.__pad.buttons[b] = { pressed: false, value: 0 }; }, i); await frames();
  };
  const onLevel = (d) => page.evaluate((x) => document.activeElement?.dataset?.d === x, d);
  for (let k = 0; k < 40 && !(await onLevel(LAST)); k++) await press(m.down);
  check(await onLevel(LAST), `gamepad: direcional não chegou no botão ${LAST}`);
  await press(m.confirm);
  bs = await pressed();
  check(bs.find(b => b[1] === "true")?.[0] === LAST, `gamepad: A não marcou ${LAST}: ${JSON.stringify(bs)}`);

  await page.focus("body");
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    reached = await page.evaluate((d) => document.activeElement?.dataset?.d === d, PICK);
    if (!reached) await page.keyboard.press("Tab");
  }
  check(reached, `Tab não chegou no botão ${PICK}`);
  await page.keyboard.press("Enter");
  bs = await pressed();
  check(bs.find(b => b[1] === "true")?.[0] === PICK, `Enter não marcou ${PICK}: ${JSON.stringify(bs)}`);
  const mult = balance.difficulty_table[PICK].points_mult;
  const difm = await page.textContent("#difm");
  check(difm.includes(new Intl.NumberFormat("pt-BR").format(mult)), `multiplicador ${mult} ausente: "${difm}"`);
  const goal = await page.textContent("#goal");
  check(goal.includes(`(${balance.difficulty_table[PICK].gate} s)`), `objetivo sem o portão de ${PICK} (${balance.difficulty_table[PICK].gate} s): "${goal}"`);
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  check(outline !== "none", "foco sem contorno visível no seletor");
  if (shotsDir) await page.screenshot({ path: join(shotsDir, "r6-dificuldade.png") });

  // persistência
  await page.reload({ waitUntil: "load" });
  bs = await pressed();
  check(bs.find(b => b[1] === "true")?.[0] === PICK, `escolha não persistiu: ${JSON.stringify(bs)}`);

  // ---------- partida com a dificuldade escolhida ----------
  await page.click("#go");
  await page.waitForFunction(() => window.__thehell?.()?.t > 0.5, null, { timeout: 15000 });
  const n = await game(() => window.__thehell().survivors.length);
  const hp = await game(() => window.__thehell().hunter.maxHp);
  const expectHp = balance.difficulty_table[PICK].hunter_hp * balance.hunter_hp_scale[String(n)];
  check(hp === expectHp, `vida do caçador ${hp}, esperado ${expectHp} (${PICK})`);
  await page.waitForFunction((s) => window.__thehell().t > s, PLAY_S, { timeout: 60000 });
  await game(() => { window.__thehell().hunter.hp = 0; });
  await page.waitForSelector("#end", { state: "visible", timeout: 5000 });

  // ---------- tela de fim ----------
  const score = await game(() => window.__thehell().survivors[0].score);
  const rows = await page.$$eval("#rs tbody tr", trs => trs.map(tr => [tr.dataset.cat, tr.querySelector("th").textContent, tr.querySelector("td").textContent]));
  const cats = ["objectives", "altruism", "survival", "boldness"];
  check(rows.map(r => r[0]).join() === cats.join(), `categorias: ${JSON.stringify(rows)}`);
  for (const [cat, label, value] of rows) {
    check(label === T[`score.${cat}`], `rótulo ${cat}: "${label}"`);
    check(value === new Intl.NumberFormat("pt-BR").format(score[cat]), `${cat}: ${value} ≠ ${score[cat]}`);
  }
  const total = cats.reduce((s, c) => s + score[c], 0);
  check((await page.textContent("#rstot")) === new Intl.NumberFormat("pt-BR").format(total), "total diferente da soma");
  const coins = await page.textContent("#rsc");
  check(coins.includes(new Intl.NumberFormat("pt-BR").format(balance.economy.win_coins)), `vitória sem o bônus de vitória na linha de moedas: "${coins}"`);
  check((await page.textContent("#rsteam"))?.includes(T["score.team"].match(/survivors \{([^}]*)\}/)[1]), "resultado da equipe ausente");
  check(await page.isVisible("#rsind"), "resultado individual ausente");
  check((await page.evaluate(() => document.activeElement?.id)) === "again", "foco não foi para Jogar de novo");
  if (shotsDir) await page.screenshot({ path: join(shotsDir, "r6-fim.png") });

  // ---------- protótipo: sem score, sem resumo ----------
  await page.goto(`${url}/?debug=1&seed=${SEED}&${RULES}&lang=pt-BR`, { waitUntil: "load" });
  const protoNote = await page.textContent("#difm");
  check(protoNote === T["difficulty.prototype_note"], `protótipo: nota deveria ser só o aviso, veio "${protoNote}"`);
  check((await page.textContent("#goal")).includes(`(${balance.generator.gate_time} s)`), "protótipo: objetivo sem generator.gate_time");
  await page.click("#go");
  await page.waitForFunction(() => window.__thehell?.()?.t > 0.5, null, { timeout: 15000 });
  await game(() => { window.__thehell().hunter.hp = 0; });
  await page.waitForSelector("#end", { state: "visible", timeout: 5000 });
  check(!(await page.$("#rs")), "protótipo com resumo de pontos");
  check((await page.textContent("#est")).length > 0, "protótipo sem moedas");

  if (errors.length) fail(`erros no console: ${errors.join(" | ")}`);
  await browser.close();
} finally { server?.kill(); }

if (failures.length) { console.error(`r6-e2e: ${failures.length} falha(s)`); process.exit(1); }
console.log("r6-e2e ok: dificuldade (teclado, persistência, aplicada) e tela de fim com as 4 categorias");
