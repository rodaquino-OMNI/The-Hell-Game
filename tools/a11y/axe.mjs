#!/usr/bin/env node
// pnpm a11y — acessibilidade dos menus e do fluxo de telas (GDD v0.3 §12.4, aceite U-01; plano-fases-1-2 §9, item R7).
// Sobe o servidor compilado (pnpm build antes) e, no Chromium do Playwright, para cada idioma de `ui.locales`:
//   - roda o axe-core (regras WCAG 2.0/2.1/2.2 A e AA) no menu inicial, na loja, no HUD, na tela de espectador e
//     nas telas de fim (protótipo e v1); falha com qualquer violação;
//   - mede o contraste de todo texto visível contra o fundo efetivo e exige ≥ `ui.min_contrast`;
//   - percorre o fluxo só por teclado: Tab até a loja, Enter abre, Esc fecha e o foco volta; Tab até COMEÇAR, Enter
//     inicia a partida; na tela de fim o foco vai para "Jogar de novo";
//   - confere o HUD: seta de ameaça com setor 0–7 quando o caçador está dentro de `ui.threat_radius`, ping com
//     recarga `ui.ping_cooldown` e retratos com o estado de cada aliado;
//   - confere a tela de fim do v1 (`end.team`, `end.reason`, `end.individual`) e o modo espectador.
// Uso: node tools/a11y/axe.mjs [--shots dir] [url]
//   --shots  grava capturas do HUD e das telas em pt-BR (1280×720, deviceScaleFactor 2) com o prefixo r7-
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const shotsDir = opt("--shots");
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
let url = args.find((a, i) => a.startsWith("http") && args[i - 1] !== "--shots");
const balance = JSON.parse(readFileSync(join(root, "packages/shared/generated/balance.json"), "utf8"));
const palette = JSON.parse(readFileSync(join(root, "data/art/palette.json"), "utf8"));
const catalogs = Object.fromEntries(balance.ui.locales.map(l => [l, JSON.parse(readFileSync(join(root, `packages/client/src/i18n/locales/${l}.json`), "utf8"))]));
const uiBg = palette.tokens["ui.bg"].rgb5.map(v => Math.round((v * 255) / 31));
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SEED = 1234;

let server;
if (!url) {
  url = "http://127.0.0.1:18083";
  server = spawn(process.execPath, ["packages/server/dist/server.mjs"], { cwd: root, env: { ...process.env, PORT: "18083" }, stdio: "inherit" });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(url + "/healthz")).ok) break; } catch { /* subindo */ } await sleep(100); }
}

const failures = [];
const fail = (m) => { failures.push(m); console.error("FALHA:", m); };
const report = [];

async function axe(page, name) {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ content: axeSource });
  const r = await page.evaluate(async (tags) => {
    const res = await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
    return res.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map(n => n.target.join(" ")).slice(0, 5) }));
  }, TAGS);
  for (const v of r) fail(`${name}: axe ${v.id} (${v.impact}) — ${v.help} em ${v.nodes.join(", ")}`);
  const contrast = await page.evaluate(checkContrast, { min: balance.ui.min_contrast, bg: uiBg });
  for (const c of contrast.bad) fail(`${name}: contraste ${c.ratio.toFixed(2)} < ${balance.ui.min_contrast} em "${c.text}" (${c.fg} sobre ${c.bg})`);
  report.push(`${name}: axe ${r.length} violação(ões); contraste: ${contrast.checked} textos, mínimo ${contrast.minRatio.toFixed(2)}`);
}

/** roda na página: contraste WCAG de cada texto visível contra o fundo efetivo (ancestral com fundo, sobre ui.bg) */
function checkContrast({ min, bg }) {
  const parse = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { rgb: m.slice(0, 3), a: m.length > 3 ? m[3] : 1 }; };
  const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const blend = (top, a, under) => top.map((v, i) => v * a + under[i] * (1 - a));
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let out = bg;
    for (const l of layers.reverse()) out = blend(l.rgb, l.a, out);
    return out;
  };
  const bad = []; let checked = 0, minRatio = Infinity;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement, txt = n.textContent.trim();
    if (!txt || !/\p{L}|\d/u.test(txt) || !el) continue;
    if (el.closest("[hidden],[inert],button:disabled,.sr,[aria-hidden=true]") || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const st = getComputedStyle(el), fg = parse(st.color), back = bgOf(el);
    const color = blend(fg.rgb, fg.a * Number(st.opacity), back);
    const [l1, l2] = [lum(color), lum(back)].sort((a, b) => b - a);
    const ratio = (l1 + 0.05) / (l2 + 0.05);
    checked++; minRatio = Math.min(minRatio, ratio);
    if (ratio < min) bad.push({ text: txt.slice(0, 40), ratio, fg: st.color, bg: `rgb(${back.map(Math.round)})` });
  }
  return { bad, checked, minRatio };
}

const shot = async (page, name) => { if (shotsDir) await page.screenshot({ path: join(shotsDir, `r7-${name}.png`) }); };
const game = (page, fn, arg) => page.evaluate(fn, arg);

/** Tab até o elemento `id` ficar com o foco (até 40 passos) */
async function tabTo(page, id) {
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate((x) => document.activeElement?.id === x, id)) return true;
    await page.keyboard.press("Tab");
  }
  fail(`teclado: Tab não chegou em #${id}`);
  return false;
}

try {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  for (const locale of balance.ui.locales) {
    const T = catalogs[locale];
    const pt = locale === balance.ui.locales[0];
    const ctx = await browser.newContext({ locale, viewport: { width: 1280, height: 720 }, deviceScaleFactor: shotsDir && pt ? 2 : 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

    // ---------- menu inicial ----------
    await page.goto(`${url}/?debug=1&seed=${SEED}`, { waitUntil: "load" });
    const lang = await page.evaluate(() => document.documentElement.lang);
    if (lang !== locale) fail(`${locale}: idioma detectado ${lang}`);
    const start = await page.textContent("#go");
    if (!start.includes(T["menu.start"])) fail(`${locale}: botão COMEÇAR sem a tradução: ${start}`);
    await axe(page, `${locale}/menu`);
    await shot(page, pt ? "menu" : `menu-${locale}`);

    // ---------- loja, só teclado ----------
    await page.focus("body");
    if (await tabTo(page, "sh")) {
      await page.keyboard.press("Enter");
      if (!(await page.isVisible("#shop"))) fail(`${locale}: Enter não abriu a loja`);
      if ((await page.evaluate(() => document.activeElement?.id)) !== "shopt") fail(`${locale}: foco não foi para o título da loja`);
      await axe(page, `${locale}/loja`);
      if (pt) await shot(page, "loja");
      await page.keyboard.press("Escape");
      if (await page.isVisible("#shop")) fail(`${locale}: Esc não fechou a loja`);
      if ((await page.evaluate(() => document.activeElement?.id)) !== "sh") fail(`${locale}: foco não voltou ao botão da loja`);
    }

    // ---------- partida (protótipo): começar pelo teclado, HUD, fim ----------
    if (await tabTo(page, "go")) await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__thehell?.()?.t > 0.5, null, { timeout: 15000 });
    const top = await page.textContent("#top");
    const gens = await game(page, () => window.__thehell().gens.filter(g => !g.bonus).length);
    const objectives = T["hud.objectives"].split("{")[0].trim();
    if (!top.includes(objectives)) fail(`${locale}: HUD sem objetivos traduzidos: ${top}`);
    if (!top.includes(`0/${gens}`)) fail(`${locale}: HUD sem contador de geradores 0/${gens}: ${top}`);

    // seta de ameaça: caçador a 3/4 do raio, à direita da câmera (yaw 0: direita = +x) → setor 2 de 8
    const r = balance.ui.threat_radius;
    await game(page, (d) => { const g = window.__thehell(), p = g.survivors[0]; g.hunter.x = p.x + d; g.hunter.z = p.z; g.hunter.stun = 30; }, r * 0.75);
    await page.waitForTimeout(150);
    const sector = await page.getAttribute("#threat", "data-sector");
    const threatVisible = await page.isVisible("#threat");
    if (!threatVisible || sector !== String(balance.ui.threat_sectors / 4)) fail(`${locale}: seta de ameaça visível=${threatVisible} setor=${sector} (esperado ${balance.ui.threat_sectors / 4})`);
    const label = await page.getAttribute("#threat", "aria-label");
    if (!label?.includes(T["dir.right"])) fail(`${locale}: rótulo da seta sem a direção: ${label}`);
    // caçador fora do raio → sem seta
    await game(page, (d) => { const g = window.__thehell(), p = g.survivors[0]; g.hunter.x = p.x + d; }, r * 1.5);
    await page.waitForTimeout(150);
    if (await page.isVisible("#threat")) fail(`${locale}: seta de ameaça visível fora de ui.threat_radius`);
    await game(page, (d) => { const g = window.__thehell(), p = g.survivors[0]; g.hunter.x = p.x - d * 0.7; g.hunter.z = p.z + d * 0.7; }, r * 0.6);

    // pings: o 1º entra, o 2º dentro da recarga é recusado
    await page.keyboard.press("Digit1");
    await page.keyboard.press("Digit3");
    await page.waitForTimeout(100);
    const feed = await page.$$eval("#pf li", els => els.map(e => e.textContent));
    if (feed.length !== 1 || !feed[0].includes(T["ping.generator_here"])) fail(`${locale}: ping esperado "${T["ping.generator_here"]}", feed=${JSON.stringify(feed)}`);
    const pcd = await page.textContent("#pcd");
    if (pcd === T["ping.ready"]) fail(`${locale}: recarga do ping não aparece: ${pcd}`);

    // retratos: um aliado preso e um ferido
    await game(page, (w) => { const g = window.__thehell(); g.survivors[1].st = "cage"; g.survivors[1].cage = 40; g.survivors[2].hp = w - 5; }, balance.survivor.wounded_hp);
    await page.waitForTimeout(150);
    const states = await page.$$eval("#tm li", els => els.map(e => e.className));
    if (!states[1]?.includes("caged") || !states[2]?.includes("wounded")) fail(`${locale}: retratos sem preso/ferido: ${JSON.stringify(states)}`);
    await axe(page, `${locale}/hud`);
    await shot(page, pt ? "hud" : `hud-${locale}`);

    await game(page, () => { window.__thehell().hunter.hp = 0; });
    await page.waitForSelector("#end", { state: "visible", timeout: 5000 });
    const et = await page.textContent("#et");
    if (et !== T["end.hunter_down.title"]) fail(`${locale}: fim do protótipo com título "${et}"`);
    if ((await page.evaluate(() => document.activeElement?.id)) !== "again") fail(`${locale}: foco não foi para "Jogar de novo"`);
    await axe(page, `${locale}/fim-prototipo`);
    if (pt) await shot(page, "fim-prototipo");

    // ---------- v1: espectador e fim com end.team / end.reason / end.individual ----------
    await page.goto(`${url}/?debug=1&seed=${SEED}&ruleset=v1`, { waitUntil: "load" });
    await page.click("#go");
    await page.waitForFunction(() => window.__thehell?.()?.t > 0.5, null, { timeout: 15000 });
    await game(page, () => { const g = window.__thehell(); g.survivors[0].st = "dead"; g.survivors[0].hp = 0; });
    await page.waitForSelector("#spec", { state: "visible", timeout: 5000 });
    const spt = await page.textContent("#spt");
    if (spt !== T["spec.dead"]) fail(`${locale}: espectador com título "${spt}"`);
    const before = await page.textContent("#spw");
    await page.keyboard.press("Space");
    await page.waitForTimeout(100);
    const after = await page.textContent("#spw");
    if (before === after) fail(`${locale}: Espaço não trocou o aliado seguido (${before})`);
    if (await page.isVisible("#me")) fail(`${locale}: painel do jogador visível no modo espectador`);
    await axe(page, `${locale}/espectador`);
    if (pt) await shot(page, "espectador");
    await game(page, (lim) => { window.__thehell().t = lim; }, balance.match.hard_time_limit);
    await page.waitForSelector("#end", { state: "visible", timeout: 5000 });
    const v1Title = await page.textContent("#et"), v1Sub = await page.textContent("#es");
    const expectTitle = T["end.v1.title"].match(/dead \{([^}]*)\}/)[1];
    if (v1Title !== expectTitle) fail(`${locale}: fim v1 (morto, limite de tempo) com título "${v1Title}", esperado "${expectTitle}"`);
    if (!v1Sub.includes(String(balance.match.hard_time_limit))) fail(`${locale}: fim v1 sem o motivo do limite de tempo: ${v1Sub}`);
    await axe(page, `${locale}/fim-v1`);
    if (pt) await shot(page, "fim-v1");

    // v1, limite de tempo com o jogador vivo: "não escapou" (não "morreu", erro do END_TEXT antigo)
    await page.goto(`${url}/?debug=1&seed=${SEED}&ruleset=v1`, { waitUntil: "load" });
    await page.click("#go");
    await page.waitForFunction(() => window.__thehell?.()?.t > 0.5, null, { timeout: 15000 });
    await game(page, (lim) => { window.__thehell().t = lim; }, balance.match.hard_time_limit);
    await page.waitForSelector("#end", { state: "visible", timeout: 5000 });
    const notEscaped = T["end.v1.title"].match(/other \{([^}]*)\}/)[1];
    const t2 = await page.textContent("#et");
    if (t2 !== notEscaped) fail(`${locale}: fim v1 no limite com o jogador vivo: "${t2}", esperado "${notEscaped}"`);

    if (errors.length) fail(`${locale}: erros no console: ${errors.join(" | ")}`);
    await ctx.close();
  }
  await browser.close();
} finally { server?.kill(); }

console.log(report.map(r => "  " + r).join("\n"));
if (failures.length) { console.error(`a11y: ${failures.length} falha(s)`); process.exit(1); }
console.log(`a11y ok: ${report.length} telas sem violações (WCAG 2.2 A/AA no axe-core) e contraste ≥ ${balance.ui.min_contrast}`);
