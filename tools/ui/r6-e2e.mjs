#!/usr/bin/env node
// e2e das telas do R6 (GDD v0.2 §7.1–7.3): escolha de dificuldade no menu só pelo teclado, persistência depois de
// recarregar, dificuldade aplicada à partida (vida do caçador do v1) e tela de fim com as 4 categorias, o total e as
// moedas. Abre com `?debug=1&ruleset=v1` e usa o gancho somente-leitura já existente `window.__thehell` (D-33) para
// encurtar a partida (caçador a 0 de vida depois de alguns segundos de jogo dos bots).
// Uso: node tools/ui/r6-e2e.mjs [--shots dir] [url]   (pnpm build antes; sem url sobe o servidor compilado na 18086)
// Issue #66: Pesadelo com a cor de perigo, ícone por categoria, total grande, contagem de 0 ao valor congelada no
// meio pelo gancho `window.__thehellResults` (Enter pula sem recarregar; o foco já está em "Jogar de novo") e
// valores na hora com "reduzir balanço de câmera".
// Relatório de playtest (ui/report.ts, só com ?debug=1): "Copiar relatório" e "Baixar .json" na tela de fim (ordem do
// Tab, alvos, aria-live, falha da área de transferência, nome e conteúdo do arquivo) sem pular a contagem (reportCheck).
//   --shots  grava r6-dificuldade.png, r6-fim-contando.png, r6-fim-relatorio.png e r6-fim.png (1280×720, deviceScaleFactor 2)
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
const palette = JSON.parse(readFileSync(join(root, "data/art/palette.json"), "utf8"));
/** fração em que a contagem é congelada para a captura e a conferência "no meio" */
const MID = 0.5;
/** dificuldade escolhida no teste: a 3ª da tabela (Difícil), diferente do padrão dos dados */
const PICK = Object.keys(balance.difficulty_table)[2];
/** tempo de jogo (s de simulação) antes de encerrar a partida pelo gancho */
const PLAY_S = 4;

/**
 * relatório de playtest (ui/report.ts; só com ?debug=1): "Copiar relatório" e "Baixar .json" depois de "Jogar de novo"
 * na ordem do Tab, alvos ≥ 24 px (WCAG 2.2 2.5.8), aviso em aria-live polite, falha da área de transferência com o
 * download ainda disponível, nome do arquivo e conteúdo (JSON de matchReport). Roda com a contagem congelada: ativar
 * os botões (Enter, clique) e Esc neles não pulam a contagem nem recarregam a página. Volta o foco a "Jogar de novo"
 */
async function reportCheck(page, game) {
  const counting = async () => (await game(() => window.__thehellResults.state()))?.counting === true;
  await page.evaluate(() => { window.__rptNoReload = true; });
  const order = await page.$$eval("#end button", bs => bs.map(b => b.id));
  check(order.join() === "again,rptc,rptd", `tela de fim: botões fora da ordem esperada: ${order}`);
  check((await page.textContent("#rptc")) === T["report.copy"] && (await page.textContent("#rptd")) === T["report.download"], "relatório: rótulos fora do catálogo");
  check((await page.getAttribute("#rpts", "aria-live")) === "polite", "relatório: aviso sem aria-live polite");
  for (const id of ["rptc", "rptd"]) {
    const r = await page.$eval(`#${id}`, b => { const x = b.getBoundingClientRect(); return { w: x.width, h: x.height }; });
    check(r.w >= 24 && r.h >= 24, `relatório: #${id} menor que 24 px: ${JSON.stringify(r)}`);
  }
  await page.keyboard.press("Tab");
  check((await page.evaluate(() => document.activeElement?.id)) === "rptc", "Tab de Jogar de novo não foi para Copiar relatório");
  // copiar: Enter no botão; o JSON na área de transferência é o relatório desta partida
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.getElementById("rpts")?.textContent, null, { timeout: 5000 });
  check((await page.textContent("#rpts")) === T["report.copied"], `relatório: aviso "${await page.textContent("#rpts")}"`);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  let rep = null;
  try { rep = JSON.parse(clip); } catch { fail(`relatório copiado não é JSON: ${clip.slice(0, 80)}`); }
  check(rep?.seed === SEED && rep?.difficulty === PICK && rep?.over === true, `relatório copiado sem seed/dificuldade/fim: ${JSON.stringify({ seed: rep?.seed, difficulty: rep?.difficulty, over: rep?.over })}`);
  check(await counting(), "Enter em Copiar relatório pulou a contagem");
  // Esc no botão não quebra a tela
  await page.keyboard.press("Escape");
  check(await page.isVisible("#end") && (await counting()), "Esc em Copiar relatório fechou a tela ou pulou a contagem");
  // área de transferência negada: mensagem de erro, download continua
  await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new DOMException("negado", "NotAllowedError")) } }); });
  await page.keyboard.press("Enter");
  await page.waitForFunction((m) => document.getElementById("rpts")?.textContent === m, T["report.copy_failed"], { timeout: 5000 }).catch(async () => fail(`relatório: sem aviso de falha (veio "${await page.textContent("#rpts")}")`));
  check(await counting(), "Enter em Copiar relatório (falha) pulou a contagem");
  await page.keyboard.press("Tab");
  check((await page.evaluate(() => document.activeElement?.id)) === "rptd", "Tab não foi para Baixar .json");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 5000 }), page.keyboard.press("Enter")]);
  const name = dl.suggestedFilename();
  check(new RegExp(`^the-hell-${SEED}-${PICK}-\\d{8}-\\d{4}\\.json$`).test(name), `nome do arquivo: ${name}`);
  const path = await dl.path();
  const saved = JSON.parse(readFileSync(path, "utf8"));
  check(saved.seed === SEED && saved.difficulty === PICK && JSON.stringify(saved) === JSON.stringify(rep), "arquivo baixado diferente do relatório copiado");
  check(await counting(), "Enter em Baixar .json pulou a contagem");
  // clique (mouse) também não pula
  await Promise.all([page.waitForEvent("download", { timeout: 5000 }), page.click("#rptd")]);
  check(await counting(), "clique em Baixar .json pulou a contagem");
  check(await page.evaluate(() => window.__rptNoReload === true), "botões do relatório recarregaram a página");
  if (shotsDir) await page.screenshot({ path: join(shotsDir, "r6-fim-relatorio.png") });
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  check((await page.evaluate(() => document.activeElement?.id)) === "again", "Shift+Tab não voltou para Jogar de novo");
}

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
  // área de transferência liberada (o relatório copiado é conferido; a falha é simulada depois)
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
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
  // issue #66 resposta 5b: Pesadelo com a cor de perigo (token ui.danger) e o rótulo mantido (a cor não é a única pista)
  const danger = "rgb(" + palette.tokens["ui.danger"].rgb5.map(v => Math.round((v * 255) / 31)).join(", ") + ")";
  const nm = await page.$eval('#dif button[data-d="nightmare"]', b => ({ color: getComputedStyle(b).color, text: b.textContent }));
  check(nm.color === danger && nm.text === T["difficulty.nightmare"], `Pesadelo sem a cor ui.danger (${danger}) ou sem o rótulo: ${JSON.stringify(nm)}`);
  const others = await page.$$eval('#dif button:not([data-d="nightmare"])', bs => bs.map(b => getComputedStyle(b).color));
  check(!others.includes(danger), `outro nível com a cor de perigo: ${others}`);
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
  // pontos garantidos em todas as categorias (a contagem no meio fica visível na captura); a contagem da próxima tela
  // de fim fica congelada no meio (gancho de depuração): a captura não depende da velocidade da máquina
  await game(() => { const sc = window.__thehell().survivors[0].score; for (const k of Object.keys(sc)) sc[k] += 40 + 20 * Object.keys(sc).indexOf(k); });
  await game((p) => window.__thehellResults.hold(p), MID);
  await game(() => { window.__thehell().hunter.hp = 0; });
  await page.waitForSelector("#end", { state: "visible", timeout: 5000 });

  // ---------- tela de fim ----------
  const fmt = (v) => new Intl.NumberFormat("pt-BR").format(v);
  const score = await game(() => window.__thehell().survivors[0].score);
  const readRows = () => page.$$eval("#rs tbody tr", trs => trs.map(tr => ({
    cat: tr.dataset.cat, label: tr.querySelector("th").textContent, icon: tr.querySelector("th .rsi")?.getAttribute("aria-hidden"),
    svg: !!tr.querySelector("th .rsi svg"), shown: tr.querySelector("td .rsv").textContent, shownHidden: tr.querySelector("td .rsv").getAttribute("aria-hidden"),
    sr: tr.querySelector("td .sr").textContent,
  })));
  const cats = ["objectives", "altruism", "survival", "boldness"];
  const total = cats.reduce((s, c) => s + score[c], 0);
  // no meio da contagem: o foco já está em "Jogar de novo"; o número visível vai de 0 ao final; o leitor lê o final
  check((await page.evaluate(() => document.activeElement?.id)) === "again", "contagem: foco não foi direto para Jogar de novo");
  const st = await game(() => window.__thehellResults.state());
  check(st?.counting === true && Math.abs(st.fraction - MID) < 1e-9, `contagem não está congelada em ${MID}: ${JSON.stringify(st)}`);
  let rows = await readRows();
  for (const r of rows) {
    const want = fmt(Math.round(score[r.cat] * MID));
    check(r.shown === want && r.shownHidden === "true", `contagem ${r.cat}: visível "${r.shown}" (aria-hidden ${r.shownHidden}), esperado "${want}"`);
    check(r.sr === fmt(score[r.cat]), `contagem ${r.cat}: texto do leitor "${r.sr}" ≠ final ${score[r.cat]}`);
  }
  check((await page.textContent("#rstot .rsv")) === fmt(Math.round(total * MID)), "contagem: total visível fora da fração");
  if (shotsDir) await page.screenshot({ path: join(shotsDir, "r6-fim-contando.png") });
  await reportCheck(page, game);
  // Enter em "Jogar de novo" durante a contagem só pula para os finais (não recarrega a página)
  await page.evaluate(() => { window.__r6NoReload = true; });
  await page.keyboard.press("Enter");
  check(await page.evaluate(() => window.__r6NoReload === true), "Enter na contagem recarregou a página em vez de pular");
  check((await game(() => window.__thehellResults.state()))?.counting === false, "Enter não pulou a contagem");
  check((await page.evaluate(() => document.activeElement?.id)) === "again", "foco saiu de Jogar de novo depois de pular");
  rows = await readRows();
  check(rows.map(r => r.cat).join() === cats.join(), `categorias: ${JSON.stringify(rows)}`);
  for (const r of rows) {
    check(r.label === T[`score.${r.cat}`], `rótulo ${r.cat}: "${r.label}" (o ícone não pode somar texto ao nome)`);
    check(r.icon === "true" && r.svg, `ícone de ${r.cat} ausente ou sem aria-hidden`);
    check(r.shown === fmt(score[r.cat]) && r.sr === fmt(score[r.cat]), `${r.cat}: ${r.shown}/${r.sr} ≠ ${score[r.cat]}`);
  }
  check((await page.textContent("#rstot .rsv")) === fmt(total) && (await page.textContent("#rstot .sr")) === fmt(total), "total diferente da soma");
  // total grande e destacado (resposta 1c): fonte maior que a das categorias e cor de destaque (ui.accent)
  const accent = "rgb(" + palette.tokens["ui.accent"].rgb5.map(v => Math.round((v * 255) / 31)).join(", ") + ")";
  const big = await page.evaluate(() => ({ tot: parseFloat(getComputedStyle(document.querySelector("#rstot")).fontSize), cat: parseFloat(getComputedStyle(document.querySelector("#rs tbody td")).fontSize), color: getComputedStyle(document.querySelector("#rstot")).color }));
  check(big.tot >= 2 * big.cat && big.color === accent, `total não está grande e destacado: ${JSON.stringify(big)}`);
  const coins = await page.textContent("#rsc");
  check(coins.includes(new Intl.NumberFormat("pt-BR").format(balance.economy.win_coins)), `vitória sem o bônus de vitória na linha de moedas: "${coins}"`);
  check((await page.textContent("#rsteam"))?.includes(T["score.team"].match(/survivors \{([^}]*)\}/)[1]), "resultado da equipe ausente");
  check(await page.isVisible("#rsind"), "resultado individual ausente");
  // moedas numa linha (resposta 4a)
  const coinLines = await page.$eval("#rsc", p => Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)));
  check(coinLines === 1, `moedas em ${coinLines} linhas`);
  check((await page.evaluate(() => document.activeElement?.id)) === "again", "foco não foi para Jogar de novo");
  if (shotsDir) await page.screenshot({ path: join(shotsDir, "r6-fim.png") });
  // depois da contagem, Enter em "Jogar de novo" volta a funcionar (recarrega)
  await Promise.all([page.waitForEvent("load", { timeout: 10000 }), page.keyboard.press("Enter")]);
  check(await page.evaluate(() => window.__r6NoReload === undefined), "Enter depois da contagem não acionou Jogar de novo");

  // ---------- reduzir movimento: "reduzir balanço de câmera" ligado → valores finais na hora ----------
  await page.evaluate(() => localStorage.setItem("thehell.options", JSON.stringify({ reduceCameraBob: true })));
  await page.reload({ waitUntil: "load" });
  check((await game(() => window.__thehellOptions().bobScale)) === balance.ui.options.reduced_bob, "opção reduzir balanço de câmera não ligou");
  await page.click("#go");
  await page.waitForFunction(() => window.__thehell?.()?.t > 0.5, null, { timeout: 15000 });
  await game(() => { const sc = window.__thehell().survivors[0].score; for (const k of Object.keys(sc)) sc[k] += 50; });
  await game(() => { window.__thehell().hunter.hp = 0; });
  await page.waitForSelector("#end", { state: "visible", timeout: 5000 });
  const rm = await page.evaluate(() => ({ st: window.__thehellResults.state(), shown: [...document.querySelectorAll("#rs .rsv")].map(e => e.textContent), sr: [...document.querySelectorAll("#rs .sr")].map(e => e.textContent), focus: document.activeElement?.id }));
  check(rm.st?.counting === false && rm.shown.join() === rm.sr.join() && rm.focus === "again", `reduzir movimento: contagem não foi instantânea: ${JSON.stringify(rm)}`);
  await page.evaluate(() => localStorage.removeItem("thehell.options"));

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
console.log("r6-e2e ok: dificuldade (teclado, gamepad, persistência, aplicada, Pesadelo com ui.danger) e tela de fim com as 4 categorias (ícones, contagem, pular com Enter, reduzir movimento)");
