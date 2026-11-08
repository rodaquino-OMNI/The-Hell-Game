#!/usr/bin/env node
// Capturas de referência do material PS1 (GDD-v0.3 §10.1, aceite A-01; plano-fases-1-2 §5 V1 e §9).
// Sobe o servidor compilado, abre o jogo no Chromium (SwiftShader) com `?seed=` fixo e relógio parado
// (page.clock: a simulação não avança), e captura os pixels da tela na resolução interna (escala 1):
//   medium-todos (todos os efeitos em 1), medium-zero (todos em 0), um por efeito (snap, affine, gouraud, dither),
//   low-todos e high-todos (presets de resolução interna).
// Compara cada captura com tools/visual/ref/<nome>.png por diferença por pixel com tolerância e verifica:
//   - com tudo em 0 duas capturas seguidas com a câmera parada são idênticas e não há padrão Bayer;
//   - o dither ligado produz o padrão Bayer; cada efeito sozinho muda a imagem em relação a tudo em 0;
//   - renderer.info (draw calls e triângulos) dentro de render.budgets no preset médio.
// Uso: node tools/visual/compare.mjs [--update] [--out dir] [--shots dir] [url]
//   --update  regrava as referências (revisar as imagens antes de commitar)
//   --out     onde gravar as capturas atuais e os mapas de diferença (padrão: <tmp>/thehell-visual)
//   --shots   grava também v1-ligado.png e v1-desligado.png em 1280×720 com deviceScaleFactor 2 (para revisão humana)
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { decodePng, encodePng } from "./png.mjs";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }

const root = fileURLToPath(new URL("../../", import.meta.url));
const refDir = join(root, "tools/visual/ref");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const update = flag("--update");
const outDir = opt("--out") ?? join(tmpdir(), "thehell-visual");
const shotsDir = opt("--shots");
let url = args.find((a, i) => a.startsWith("http") && !["--out", "--shots"].includes(args[i - 1]));
const balance = JSON.parse(readFileSync(join(root, "packages/shared/generated/balance.json"), "utf8"));

/** semente fixa das capturas (partida e texturas procedurais) */
const SEED = 1234;
/** vista das capturas: 3ª pessoa, olhando a jaula, um muro próximo, dois aliados e três feixes */
const VIEW = { yaw: -0.9, pitch: -0.1, thirdPerson: true };
/** tolerância: diferença máxima por canal considerada igual e fração máxima de pixels fora dela */
const TOL = { channel: 2, fraction: 0.001 };
const ALL = (v) => ({ snap: v, affine: v, gouraud: v, dither: v });
const only = (e) => ({ ...ALL(0), [e]: 1 });
const SCENES = [
  { name: "medium-todos", preset: "medium", ps1: ALL(1) },
  { name: "medium-zero", preset: "medium", ps1: ALL(0) },
  { name: "medium-snap", preset: "medium", ps1: only("snap") },
  { name: "medium-affine", preset: "medium", ps1: only("affine") },
  { name: "medium-gouraud", preset: "medium", ps1: only("gouraud") },
  { name: "medium-dither", preset: "medium", ps1: only("dither") },
  { name: "low-todos", preset: "low", ps1: ALL(1) },
  { name: "high-todos", preset: "high", ps1: ALL(1) },
];

let server;
if (!url) {
  url = "http://127.0.0.1:18082";
  server = spawn(process.execPath, [join(root, "packages/server/dist/server.mjs")], { env: { ...process.env, PORT: "18082" }, stdio: ["ignore", "ignore", "inherit"] });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(url + "/healthz")).ok) break; } catch { /* subindo */ } await sleep(100); }
}
const failures = [];
const fail = (m) => { failures.push(m); console.error("FALHA:", m); };

/** diferença por pixel: { max, count (pixels com algum canal acima da tolerância), fraction, diffRgba } */
function diff(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { max: 255, count: a.width * a.height, fraction: 1, sizeMismatch: true };
  let max = 0, count = 0;
  const d = new Uint8Array(a.rgba.length);
  for (let i = 0; i < a.rgba.length; i += 4) {
    let m = 0;
    for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a.rgba[i + c] - b.rgba[i + c]));
    max = Math.max(max, m);
    if (m > TOL.channel) { count++; d[i] = 255; } else d[i] = d[i + 1] = d[i + 2] = m * 40;
    d[i + 3] = 255;
  }
  return { max, count, fraction: count / (a.width * a.height), diffRgba: d };
}

/**
 * força do padrão Bayer 4×4: média, por fase (x mod 4, y mod 4), do resíduo de luminância em relação à média dos
 * 4 vizinhos; devolve a amplitude entre fases (0 em imagem sem dither ordenado).
 */
function bayerStrength(img) {
  const { width: w, height: h, rgba } = img;
  const L = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  const sum = new Float64Array(16), n = new Float64Array(16);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const r = L[i] - (L[i - 1] + L[i + 1] + L[i - w] + L[i + w]) / 4;
    const k = (y & 3) * 4 + (x & 3);
    sum[k] += r; n[k]++;
  }
  const means = [...sum].map((s, k) => s / n[k]);
  return Math.max(...means) - Math.min(...means);
}
/** limiar da força Bayer: sem dither fica perto de 0; com dither de 5 bits passa bem disso */
const BAYER_MIN = 3;

async function openGame(browser, preset) {
  const [w, h] = balance.render.presets[preset].internal;
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.clock.install({ time: 0 });
  await page.goto(`${url}/?seed=${SEED}&preset=${preset}`, { waitUntil: "load" });
  await page.clock.pauseAt(1000);
  await page.click("#go");
  return { page, errors };
}

async function capture(page, ps1) {
  const r = await page.evaluate(([ps1, view]) => {
    const h = window.__thehellRender;
    h.setPs1(ps1);
    const c = h.capture(view);
    return { ...c, info: h.info(), t: window.__thehell().t };
  }, [ps1, VIEW]);
  return { width: r.width, height: r.height, rgba: new Uint8Array(Buffer.from(r.rgba, "base64")), info: r.info, t: r.t };
}

try {
  mkdirSync(outDir, { recursive: true });
  if (update) mkdirSync(refDir, { recursive: true });
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const pages = {};
  const shots = {};
  for (const s of SCENES) {
    pages[s.preset] ??= await openGame(browser, s.preset);
    const img = await capture(pages[s.preset].page, s.ps1);
    shots[s.name] = img;
    const [w, h] = balance.render.presets[s.preset].internal;
    if (img.width !== w || img.height !== h) fail(`${s.name}: captura ${img.width}×${img.height}, esperado ${w}×${h} (escala 1)`);
    if (img.t !== 0) fail(`${s.name}: a simulação avançou (t=${img.t}); o relógio deveria estar parado`);
    writeFileSync(join(outDir, s.name + ".png"), encodePng(img.width, img.height, img.rgba));
    const refPath = join(refDir, s.name + ".png");
    if (update) { writeFileSync(refPath, encodePng(img.width, img.height, img.rgba)); console.log(`ref atualizada: ${s.name}`); continue; }
    if (!existsSync(refPath)) { fail(`${s.name}: referência ausente (${refPath}); rode com --update e revise`); continue; }
    const d = diff(img, decodePng(readFileSync(refPath)));
    if (d.diffRgba) writeFileSync(join(outDir, s.name + ".diff.png"), encodePng(img.width, img.height, d.diffRgba));
    const ok = !d.sizeMismatch && d.fraction <= TOL.fraction;
    console.log(`${ok ? "ok   " : "FALHA"} ${s.name.padEnd(15)} dif. máx ${String(d.max).padStart(3)}  pixels fora da tolerância ${d.count} (${(d.fraction * 100).toFixed(3)}%)`);
    if (!ok) fail(`${s.name}: difere da referência (${d.count} pixels, ${(d.fraction * 100).toFixed(3)}% > ${TOL.fraction * 100}%)`);
  }

  // com tudo em 0: câmera parada não treme (duas capturas idênticas) e não há dither
  const med = pages.medium.page;
  const z1 = await capture(med, ALL(0)), z2 = await capture(med, ALL(0));
  const dz = diff(z1, z2);
  if (dz.max !== 0) fail(`tudo em 0: duas capturas seguidas diferem (dif. máx ${dz.max})`);
  const t1 = await capture(med, ALL(1)), t2 = await capture(med, ALL(1));
  if (diff(t1, t2).max !== 0) fail("todos em 1: duas capturas seguidas com a câmera parada diferem");
  const bz = bayerStrength(shots["medium-zero"]), bd = bayerStrength(shots["medium-dither"]), bt = bayerStrength(shots["medium-todos"]);
  console.log(`padrão Bayer (amplitude entre fases): zero ${bz.toFixed(3)}, só dither ${bd.toFixed(3)}, todos ${bt.toFixed(3)} (limiar ${BAYER_MIN})`);
  if (bz >= BAYER_MIN) fail(`tudo em 0 tem padrão Bayer (${bz.toFixed(3)})`);
  if (bd < BAYER_MIN) fail(`dither ligado sem padrão Bayer (${bd.toFixed(3)})`);
  console.log(`tudo em 0: duas capturas seguidas idênticas (dif. máx ${dz.max})`);

  // cada efeito sozinho muda a imagem
  for (const e of ["snap", "affine", "gouraud", "dither"]) {
    const d = diff(shots["medium-" + e], shots["medium-zero"]);
    console.log(`efeito ${e.padEnd(8)} muda ${(d.fraction * 100).toFixed(2)}% dos pixels em relação a tudo em 0`);
    if (d.fraction < 0.005) fail(`efeito ${e} quase não muda a imagem (${(d.fraction * 100).toFixed(3)}%)`);
  }

  // renderer.info no preset médio, todos os efeitos ligados (GDD-v0.3 §10.6)
  const info = shots["medium-todos"].info, b = balance.render.budgets;
  console.log(`renderer.info (medium, todos): ${info.calls} draw calls, ${info.triangles} triângulos (orçamento ${b.draw_calls} / ${b.triangles})`);
  if (info.calls > b.draw_calls || info.triangles > b.triangles) fail("renderer.info acima do orçamento");

  for (const { errors } of Object.values(pages)) if (errors.length) fail("erros no console: " + errors.join(" | "));

  if (shotsDir) {
    mkdirSync(shotsDir, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
    await page.goto(`${url}/?seed=${SEED}`, { waitUntil: "load" });
    await page.click("#go");
    await page.waitForTimeout(1500);
    for (const [name, v] of [["ligado", 1], ["desligado", 0]]) {
      await page.evaluate((v) => window.__thehellRender.setPs1({ snap: v, affine: v, gouraud: v, dither: v }), v);
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(shotsDir, `v1-${name}.png`) });
    }
    console.log("capturas para revisão →", shotsDir);
  }
  await browser.close();
} finally { server?.kill(); }

if (failures.length) { console.error(`compare: ${failures.length} falha(s); capturas e diferenças em ${outDir}`); process.exit(1); }
console.log(update ? "referências atualizadas em tools/visual/ref" : `compare ok (${SCENES.length} cenas) → ${outDir}`);
