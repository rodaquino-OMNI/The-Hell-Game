#!/usr/bin/env node
// pnpm a11y — acessibilidade dos menus e do fluxo de telas (GDD v0.3 §12.4, aceite U-01; plano-fases-1-2 §9, item R7).
// Sobe o servidor compilado (pnpm build antes) e, no Chromium do Playwright, para cada idioma de `ui.locales`:
//   - roda o axe-core (regras WCAG 2.0/2.1/2.2 A e AA) no menu inicial, na loja, no HUD, na tela de espectador e
//     nas telas de fim (protótipo e v1); falha com qualquer violação;
//   - mede o contraste de todo texto visível contra o fundo efetivo e exige ≥ `ui.min_contrast`;
//   - menu de opções (V8): axe, só teclado (cada opção muda o estado efetivo: getReduceFlicker, bobScale, fov, getPs1,
//     getLayerA, getBusVolume, escala da fonte, modo daltônico, controles), Esc na captura de tecla, persistência ao
//     recarregar e navegação só por gamepad (navigator.getGamepads simulado);
//   - percorre o fluxo só por teclado: Tab até a loja, Enter abre, Esc fecha e o foco volta; Tab até COMEÇAR, Enter
//     inicia a partida; na tela de fim o foco vai para "Jogar de novo";
//   - confere o HUD: seta de ameaça com setor 0–7 quando o caçador está dentro de `ui.threat_radius`, ping com
//     recarga `ui.ping_cooldown` e retratos com o estado de cada aliado;
//   - confere a tela de fim do v1 (`end.team`, `end.reason`, `end.individual`) e o modo espectador.
// Uso: node tools/a11y/axe.mjs [--shots dir] [url]
//   --shots  grava capturas do HUD e das telas em pt-BR (1280×720, deviceScaleFactor 2) com o prefixo r7-
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { startServer } from "../lib/server.mjs";

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
// porta livre (PORT=0) e /healthz só do processo filho deste script (tools/lib/server.mjs)
if (!url) ({ url, child: server } = await startServer());

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

/**
 * espera a partida começar (`t` > 0,5 s de simulação). Sem prazo fixo: falha só se a partida não for criada em
 * STALL_MS ou se o relógio da simulação ficar parado por STALL_MS (máquina carregada anda devagar, mas anda); o
 * critério (t > 0,5) é o mesmo. Registra o `t` atingido e o tempo real gasto.
 */
const STALL_MS = 15000, MIN_T = 0.5;
async function waitStarted(page, name) {
  const t0 = Date.now();
  let lastT = -1, lastMove = Date.now(), t = null;
  for (;;) {
    t = await page.evaluate(() => window.__thehell?.()?.t ?? null);
    if (t !== null && t > MIN_T) break;
    if (t !== lastT) { lastT = t; lastMove = Date.now(); }
    if (Date.now() - lastMove > STALL_MS) {
      fail(`${name}: partida parada em t=${t === null ? "(não criada)" : t.toFixed(3)} s por ${STALL_MS / 1000} s (${((Date.now() - t0) / 1000).toFixed(1)} s no total)`);
      return false;
    }
    await sleep(50);
  }
  report.push(`${name}: partida começou (t=${t.toFixed(2)} s de simulação em ${((Date.now() - t0) / 1000).toFixed(1)} s reais)`);
  return true;
}

/** Tab até o elemento `id` ficar com o foco (até 80 passos: o menu de opções tem ~50 controles) */
async function tabTo(page, id) {
  for (let i = 0; i < 80; i++) {
    if (await page.evaluate((x) => document.activeElement?.id === x, id)) return true;
    await page.keyboard.press("Tab");
  }
  fail(`teclado: Tab não chegou em #${id}`);
  return false;
}

const optState = (page) => page.evaluate(() => window.__thehellOptions());
const audioVol = (page, bus) => page.evaluate((b) => window.__thehellAudio().buses[b], bus);
const active = (page) => page.evaluate(() => document.activeElement?.id);

/** Tab até `id` e uma tecla; devolve se chegou */
async function tabPress(page, id, key) { if (!(await tabTo(page, id))) return false; await page.keyboard.press(key); return true; }

/** menu de opções só pelo teclado: cada opção muda o estado efetivo do módulo dono; recarregar mantém */
async function optionsFlow(page, locale, T, pt) {
  const n = `${locale}/opcoes`, ob = balance.ui.options, fov0 = balance.prototype_extras.camera.fov;
  await page.focus("body");
  if (!(await tabPress(page, "op", "Enter"))) return;
  if (!(await page.isVisible("#opts"))) { fail(`${n}: Enter não abriu as opções`); return; }
  if ((await active(page)) !== "optt") fail(`${n}: foco não foi para o título das opções`);
  if ((await page.textContent("#optt")) !== T["opt.title"]) fail(`${n}: título sem tradução`);
  await axe(page, n);
  if (pt) await shot(page, "opcoes");
  const before = await optState(page);
  let changed = 0;
  const check = (ok, msg) => { if (ok) changed++; else fail(`${n}: ${msg}`); };
  if (await tabPress(page, "o-ps1-snap", "Home")) { const o = await optState(page); check(o.ps1.snap === 0, `tremor de vértice ${o.ps1.snap} depois de Home`); }
  if (await tabPress(page, "o-la-grain", "ArrowLeft")) {
    const o = await optState(page), want = balance.render.layer_a.grain - ob.intensity_step;
    check(Math.abs(o.layerA.grain - want) < 1e-9, `grão ${o.layerA.grain}, esperado ${want}`);
  }
  if (await tabPress(page, "o-flicker", "Space")) { const o = await optState(page); check(o.reduceFlicker && o.options.reduceFlicker, `reduzir flicker não ligou getReduceFlicker() (${o.reduceFlicker})`); }
  if (await tabPress(page, "o-bob", "Space")) { const o = await optState(page); check(o.bobScale === ob.reduced_bob, `reduzir balanço deu bobScale ${o.bobScale}`); }
  if (await tabPress(page, "o-fov", "ArrowRight")) { const o = await optState(page); check(o.fov === fov0 + ob.fov_step, `fov ${o.fov} depois de → (esperado ${fov0 + ob.fov_step})`); }
  if (await tabPress(page, "o-vol-music", "Home")) { const v = await audioVol(page, "music"); check(v === 0, `volume da música ${v} depois de Home`); }
  if (await tabTo(page, "o-font-normal")) {
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const o = await optState(page);
    check(o.options.fontSize === "xlarge" && Number(o.uiScale) === ob.font_scales.xlarge, `fonte ${o.options.fontSize} escala ${o.uiScale}`);
    await axe(page, `${n}-fonte-${ob.font_scales.xlarge}`);
    if (pt) await shot(page, "opcoes-fonte-grande");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
  }
  if (await tabTo(page, "o-color-normal")) { await page.keyboard.press("ArrowRight"); check((await optState(page)).colorMode === "protanopia", "modo daltônico não mudou"); }
  for (const [id, key] of [["o-invy", "invertY"], ["o-trun", "toggleRun"], ["o-tint", "toggleInteract"], ["o-puz", "puzzleAccessible"]]) {
    if (await tabPress(page, id, "Space")) { const o = await optState(page); check(o.options[key] === !before.options[key], `${id} não mudou ${key}`); }
  }
  const c = await optState(page);
  if (!c.controls.toggleRun || !c.controls.toggleInteract || !c.controls.invertY) fail(`${n}: controles não chegaram a input.ts: ${JSON.stringify(c.controls)}`);
  // remapeamento: Enter no botão, nova tecla; o foco fica no botão; Esc na captura cancela sem fechar o diálogo
  if (await tabPress(page, "kb-forward", "Enter")) {
    await page.keyboard.press("KeyI");
    check((await optState(page)).options.keys.forward.join() === "KeyI", "remapeamento de Andar para frente não gravou KeyI");
    if ((await active(page)) !== "kb-forward") fail(`${n}: foco saiu do botão remapeado`);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    if (!(await page.isVisible("#opts"))) fail(`${n}: Esc na captura de tecla fechou o diálogo`);
    if ((await optState(page)).options.keys.forward.join() !== "KeyI") fail(`${n}: Esc na captura mudou a tecla`);
  }
  await axe(page, `${n}-alterado`);
  if (pt) await shot(page, "opcoes-alterado");
  await page.keyboard.press("Escape");
  if (await page.isVisible("#opts")) fail(`${n}: Esc não fechou as opções`);
  if ((await active(page)) !== "op") fail(`${n}: foco não voltou ao botão Opções`);
  // persistência: recarregar mantém tudo
  await page.reload({ waitUntil: "load" });
  const r = await optState(page);
  const okPersist = r.reduceFlicker && r.bobScale === ob.reduced_bob && r.fov === fov0 + ob.fov_step && r.ps1.snap === 0 && r.options.fontSize === "normal" &&
    r.colorMode === "protanopia" && r.options.puzzleAccessible && r.controls.toggleRun && r.options.keys.forward.join() === "KeyI" && (await audioVol(page, "music")) === 0;
  if (!okPersist) fail(`${n}: opções não persistiram depois de recarregar: ${JSON.stringify(r)}`);
  else report.push(`${n}: ${changed} opções mudadas só pelo teclado, conferidas no estado efetivo e depois de recarregar`);
  await gamepadFlow(page, n);
  // volta ao padrão para o resto do fluxo (partida e HUD com os valores de data/balance.yaml)
  await page.evaluate(() => { localStorage.removeItem("thehell.options"); localStorage.removeItem("thehell.audio.volumes"); });
  await page.reload({ waitUntil: "load" });
}

/** só pelo gamepad (navigator.getGamepads simulado): direcional até Opções, A abre, A liga uma opção, ← no slider, B fecha */
async function gamepadFlow(page, n) {
  const m = balance.ui.controls.gamepad.menu;
  await page.evaluate(() => {
    const pad = { connected: true, mapping: "standard", id: "simulado", index: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    window.__pad = pad;
    navigator.getGamepads = () => [pad];
    // o jogo só começa a ler o controle no gamepadconnected (ui/padnav.ts); o evento real exige um controle físico
    window.dispatchEvent(new Event("gamepadconnected"));
    document.activeElement?.blur();
  });
  const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
  const press = async (i) => {
    await page.evaluate((b) => { window.__pad.buttons[b] = { pressed: true, value: 1 }; }, i); await frames();
    await page.evaluate((b) => { window.__pad.buttons[b] = { pressed: false, value: 0 }; }, i); await frames();
  };
  const goTo = async (id, max) => { for (let k = 0; k < max && (await active(page)) !== id; k++) await press(m.down); return (await active(page)) === id; };
  if (!(await goTo("op", 40))) { fail(`${n}/gamepad: direcional não chegou ao botão Opções`); return; }
  await press(m.confirm);
  if (!(await page.isVisible("#opts"))) { fail(`${n}/gamepad: A não abriu as opções`); return; }
  const flick = (await optState(page)).reduceFlicker;
  if (!(await goTo("o-flicker", 60))) { fail(`${n}/gamepad: direcional não chegou em reduzir flicker`); return; }
  await press(m.confirm);
  if ((await optState(page)).reduceFlicker === flick) fail(`${n}/gamepad: A no checkbox não mudou reduzir flicker`);
  if (!(await goTo("o-fov", 10))) { fail(`${n}/gamepad: direcional não chegou no fov`); return; }
  const f = (await optState(page)).fov;
  await press(m.left);
  if ((await optState(page)).fov !== f - balance.ui.options.fov_step) fail(`${n}/gamepad: ← no slider de fov não desceu um passo`);
  await press(m.back);
  if (await page.isVisible("#opts")) fail(`${n}/gamepad: B não fechou as opções`);
  else if ((await active(page)) !== "op") fail(`${n}/gamepad: foco não voltou ao botão Opções`);
  else report.push(`${n}/gamepad: abriu, mudou 2 opções e fechou só pelo controle`);
}

/** faixa de legendas (V8b; GDD-v0.3 §12.4): o caçador à direita gera "passos" com seta no setor 2 e ×2 na fusão; a
 *  legenda mais longa dos catálogos cabe na tela sem estourar nos 3 tamanhos de fonte (ui.options.font_scales).
 *  Emissão e leitura do DOM no mesmo evaluate (o barramento avisa de forma síncrona): com a máquina carregada, o
 *  relógio da partida pode vencer a legenda entre duas chamadas do Playwright */
async function captionsCheck(page, locale, T) {
  const n = `${locale}/legendas`, ac = balance.audio.captions;
  const longest = Object.entries(T).filter(([k]) => k.startsWith("caption.") && !k.startsWith("caption.sound_")).map(([, v]) => v).sort((a, b) => b.length - a.length)[0];
  // tempo na tela no máximo da lista durante a conferência (volta ao padrão no fim)
  await game(page, (s) => window.__thehellCaptions.duration(s), Math.max(...ac.durations));
  const r = await page.evaluate(([scales, txt]) => {
    const p = window.__thehell().survivors[0], c = window.__thehellCaptions;
    const ok = [c.emit("step_hunter", { x: p.x + 6, z: p.z }), c.emit("step_hunter", { x: p.x + 6, z: p.z }), c.emit("rescue")].every(Boolean);
    const cap = document.getElementById("cap");
    const items = [...cap.querySelectorAll("li")].map(li => ({ text: li.textContent, rot: li.querySelector(".ca")?.getAttribute("style") ?? "", danger: li.classList.contains("hz") }));
    const wrap = {};
    for (const [size, sc] of Object.entries(scales)) {
      document.documentElement.style.setProperty("--ui-scale", String(sc));
      const ct = cap.querySelector("li .ct");
      if (ct) ct.firstChild.textContent = txt;
      const b = cap.getBoundingClientRect();
      const over = [...cap.querySelectorAll("li")].some(li => { const q = li.getBoundingClientRect(); return li.scrollWidth > li.clientWidth + 1 || q.left < 0 || q.right > innerWidth; });
      wrap[size] = { over: over || b.left < 0 || b.right > innerWidth || b.top < 0, width: Math.round(b.width) };
    }
    return { ok, live: cap.getAttribute("aria-live"), items, wrap };
  }, [balance.ui.options.font_scales, longest]);
  if (!r.ok) { fail(`${n}: o barramento recusou a legenda (legendas desligadas?)`); return; }
  if (r.live !== "off") fail(`${n}: aria-live "${r.live}" durante a partida (esperado off)`);
  const steps = r.items.find(i => i.text.includes(T["caption.hunter_steps"]));
  const right = (2 * 360) / balance.ui.threat_sectors;
  if (!steps || !steps.rot.includes(`rotate(${right}deg)`) || !steps.text.includes("×2") || !steps.danger) fail(`${n}: passos do caçador sem seta à direita, ×2 ou borda de perigo: ${JSON.stringify(r.items)}`);
  if (!r.items.some(i => i.text.includes(T["caption.rescue"]) && !i.rot)) fail(`${n}: resgate sem a legenda sem direção: ${JSON.stringify(r.items)}`);
  for (const [size, w] of Object.entries(r.wrap)) if (w.over) fail(`${n}: legenda de ${longest.length} caracteres estoura com a fonte ${size}: ${JSON.stringify(w)}`);
  // sem sobreposição: faixa × painel de espectador × dica (longa, quebrando linha) × barra de estado × pings (com e
  // sem pings ativos), nos 3 tamanhos de fonte, a 1280×720 e a 800×600 (painel, dica e feed só durante a medida)
  const hintText = Object.entries(T).filter(([k]) => k.startsWith("hud.hint.")).map(([, v]) => v).sort((x, y) => y.length - x.length)[0].repeat(3);
  const vp0 = page.viewportSize();
  let pairs = 0;
  for (const vp of [vp0, { width: 800, height: 600 }]) {
    await page.setViewportSize(vp);
    const o = await page.evaluate(async ([scales, hint, pingText]) => {
      const p = window.__thehell().survivors[0], c = window.__thehellCaptions;
      const spec = document.getElementById("spec"), hintEl = document.getElementById("hint"), pf = document.getElementById("pf");
      const saved = { spec: spec.hidden, hint: hintEl.hidden, text: hintEl.textContent, pf: pf.innerHTML };
      const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const box = id => { const e = document.getElementById(id); if (!e || e.hidden || !e.checkVisibility()) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
      const out = [];
      // com e sem dica e espectador; com e sem pings ativos no painel (o feed é preenchido só durante a medida)
      for (const withExtras of [true, false]) for (const withPings of [false, true]) for (const [size, sc] of Object.entries(scales)) {
        spec.hidden = !withExtras; hintEl.hidden = !withExtras; hintEl.textContent = withExtras ? hint : saved.text;
        pf.innerHTML = withPings ? Array.from({ length: 4 }, () => `<li>${pingText}</li>`).join("") : "";
        document.documentElement.style.setProperty("--ui-scale", String(sc));
        await frames();
        c.emit("step_hunter", { x: p.x + 6, z: p.z }); c.emit("telegraph_trap", { x: p.x - 4, z: p.z }); c.emit("rescue");
        await frames();
        const cap = box("cap");
        for (const id of ["spec", "hint", "sb", "pings"]) {
          const b = box(id);
          if (!cap || !b) continue;
          const hit = cap.left < b.right && b.left < cap.right && cap.top < b.bottom && b.top < cap.bottom;
          out.push({ size, id, withExtras, withPings, hit, cap, other: b });
        }
        if (cap && (cap.top < 0 || cap.left < 0 || cap.right > innerWidth)) out.push({ size, id: "tela", hit: true, cap });
      }
      spec.hidden = saved.spec; hintEl.hidden = saved.hint; hintEl.textContent = saved.text; pf.innerHTML = saved.pf;
      return out;
    }, [balance.ui.options.font_scales, hintText, T["ping.feed"].replace(/\{[^}]*\}/g, "Aaaaaaaa")]);
    pairs += o.length;
    for (const x of o) if (x.hit) fail(`${n}: legendas sobrepõem #${x.id} a ${vp.width}×${vp.height}, fonte ${x.size}: ${JSON.stringify(x)}`);
  }
  await page.setViewportSize(vp0);
  if (!pairs) fail(`${n}: conferência de sobreposição não mediu nada (faixa ausente?)`);
  // axe com a fonte maior e as legendas na tela (renovadas na hora)
  await game(page, () => { const p = window.__thehell().survivors[0]; window.__thehellCaptions.emit("step_hunter", { x: p.x + 6, z: p.z }); window.__thehellCaptions.emit("rescue"); });
  await axe(page, `${n}-fonte-${balance.ui.options.font_scales.xlarge}`);
  await page.evaluate((sc) => document.documentElement.style.setProperty("--ui-scale", String(sc)), balance.ui.options.font_scales[balance.ui.options.font_default]);
  await game(page, (s) => window.__thehellCaptions.duration(s), ac.durations[ac.default_duration_index]);
  report.push(`${n}: sem sobreposição com espectador/dica/barra/pings (${pairs} pares medidos em 2 telas, 3 fontes, com e sem dica e pings); seta no setor, ×N, aria-live off na partida, "${longest}" (${longest.length} caracteres) sem estourar nos ${Object.keys(r.wrap).length} tamanhos`);
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

    // ---------- menu de opções (V8): só teclado, axe, cada opção muda o estado, persistência, gamepad ----------
    await optionsFlow(page, locale, T, pt);

    // ---------- partida (protótipo): começar pelo teclado, HUD, fim ----------
    if (await tabTo(page, "go")) await page.keyboard.press("Enter");
    // sem partida não há HUD para conferir: a falha já foi registrada (com o t atingido); segue para o próximo idioma
    if (!(await waitStarted(page, `${locale}/partida`))) { await ctx.close(); continue; }
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
    // legendas de som (V8b): faixa visível com seta, ×N na fusão, aria-live off na partida, axe e quebra de linha
    await captionsCheck(page, locale, T);
    await axe(page, `${locale}/hud`);
    await shot(page, pt ? "hud" : `hud-${locale}`);

    await game(page, () => { window.__thehell().hunter.hp = 0; });
    await page.waitForSelector("#end", { state: "visible", timeout: STALL_MS });
    const et = await page.textContent("#et");
    if (et !== T["end.hunter_down.title"]) fail(`${locale}: fim do protótipo com título "${et}"`);
    if ((await page.getAttribute("#cap", "aria-live")) !== "polite") fail(`${locale}: legendas sem aria-live polite fora da partida`);
    if ((await page.evaluate(() => document.activeElement?.id)) !== "again") fail(`${locale}: foco não foi para "Jogar de novo"`);
    await axe(page, `${locale}/fim-prototipo`);
    if (pt) await shot(page, "fim-prototipo");

    // ---------- v1: espectador e fim com end.team / end.reason / end.individual ----------
    await page.goto(`${url}/?debug=1&seed=${SEED}&ruleset=v1`, { waitUntil: "load" });
    await page.click("#go");
    if (!(await waitStarted(page, `${locale}/partida-v1`))) { await ctx.close(); continue; }
    await game(page, () => { const g = window.__thehell(); g.survivors[0].st = "dead"; g.survivors[0].hp = 0; });
    await page.waitForSelector("#spec", { state: "visible", timeout: STALL_MS });
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
    await page.waitForSelector("#end", { state: "visible", timeout: STALL_MS });
    const v1Title = await page.textContent("#et"), v1Sub = await page.textContent("#es");
    const expectTitle = T["end.v1.title"].match(/dead \{([^}]*)\}/)[1];
    if (v1Title !== expectTitle) fail(`${locale}: fim v1 (morto, limite de tempo) com título "${v1Title}", esperado "${expectTitle}"`);
    if (!v1Sub.includes(String(balance.match.hard_time_limit))) fail(`${locale}: fim v1 sem o motivo do limite de tempo: ${v1Sub}`);
    await axe(page, `${locale}/fim-v1`);
    if (pt) await shot(page, "fim-v1");

    // v1, limite de tempo com o jogador vivo: "não escapou" (não "morreu", erro do END_TEXT antigo)
    await page.goto(`${url}/?debug=1&seed=${SEED}&ruleset=v1`, { waitUntil: "load" });
    await page.click("#go");
    if (!(await waitStarted(page, `${locale}/partida-v1`))) { await ctx.close(); continue; }
    await game(page, (lim) => { window.__thehell().t = lim; }, balance.match.hard_time_limit);
    await page.waitForSelector("#end", { state: "visible", timeout: STALL_MS });
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
