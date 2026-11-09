#!/usr/bin/env node
// Capturas de referência do material PS1 (GDD-v0.3 §10.1, aceite A-01; plano-fases-1-2 §5 V1 e §9) e das camadas
// visuais A, B e C por preset (GDD-v0.3 §10.2; plano-fases-1-2 §5 V4).
// Sobe o servidor compilado, abre o jogo no Chromium (SwiftShader) com `?seed=` fixo e relógio parado
// (page.clock: a simulação não avança), e captura os pixels da tela na resolução interna (escala 1):
//   medium-todos (todos os efeitos em 1), medium-zero (todos em 0), um por efeito (snap, affine, gouraud, dither),
//   low-todos e high-todos (presets de resolução interna). As cenas do V1 rodam com as camadas desligadas (material
//   isolado); as do V4 ligam as camadas: por preset (low-A, medium-AB, high-ABC), por camada (medium-A, medium-B,
//   high-C) e dano (aberração), com e sem "reduzir flicker"; D-18: medium-cacador-fora (caçador fora do cone).
// Compara cada captura com tools/visual/ref/<nome>.png por diferença por pixel com tolerância e verifica:
//   - com tudo em 0 duas capturas seguidas com a câmera parada são idênticas e não há padrão Bayer;
//   - o dither ligado produz o padrão Bayer; cada efeito sozinho muda a imagem em relação a tudo em 0;
//   - renderer.info (draw calls e triângulos) dentro de render.budgets em cada preset com as camadas dele;
//   - camada A com intensidades em 0 = camadas desligadas (pixel a pixel); cada efeito da camada A muda a imagem;
//   - com "reduzir flicker": dano não muda a imagem (sem aberração) e o grão não oscila no tempo;
//   - custo: medium com A+B ≤ render.layer_cost_factor × medium sem camadas (tempo síncrono por quadro, 1280×720),
//     na vista das capturas e com o caçador no cone da lanterna;
//   - legibilidade depois da camada A: olhos no preparo e feixe ≥ render.legibility.min_contrast; o corpo do caçador
//     (com o contorno de D-18, render.hunter_outline) ≥ render.legibility.min_contrast fora e dentro do cone da
//     lanterna, e fora do cone mantém render.legibility.body_keep do contraste que tem sem a camada A, com e sem o
//     contorno (D-38).
// Uso: node tools/visual/compare.mjs [--update] [--out dir] [--shots dir] [url]
//   --update  regrava as referências (revisar as imagens antes de commitar)
//   --out     onde gravar as capturas atuais e os mapas de diferença (padrão: <tmp>/thehell-visual)
//   --shots   grava também v1-ligado.png, v1-desligado.png e v4-patio-<preset>.png em 1280×720 com deviceScaleFactor 2
//             (revisão humana; marco A3)
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng } from "./png.mjs";
import { startServer } from "../lib/server.mjs";

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
/**
 * cena de prova de legibilidade (V4): vista para o noroeste a partir do spawn, com o caçador a `distance` m e `angle`°
 * à esquerda da vista (fora do cone da lanterna), contra o muro; `diff` = soma das diferenças RGB que marca um pixel
 * do objeto
 */
const LEG = { view: { yaw: 0.52, pitch: -0.1, thirdPerson: true }, distance: 8, angle: 40, diff: 12 };
/** a mesma cena com o caçador dentro do cone da lanterna (D-18): `angle`° à esquerda da vista */
const LEG_IN = { ...LEG, angle: 8 };
/** tolerância: diferença máxima por canal considerada igual e fração máxima de pixels fora dela */
const TOL = { channel: 2, fraction: 0.001 };
const ALL = (v) => ({ snap: v, affine: v, gouraud: v, dither: v });
const only = (e) => ({ ...ALL(0), [e]: 1 });
/** camadas visuais (GDD-v0.3 §10.2): NONE isola o material PS1 (cenas do V1); null = as do preset */
const NONE = { A: false, B: false, C: false };
const LAYER_A = ["grain", "vignette", "scanlines", "aberration", "bloom", "lut"];
const A_ALL = (v) => Object.fromEntries(LAYER_A.map(e => [e, v]));
const SCENES = [
  { name: "medium-todos", preset: "medium", ps1: ALL(1), layers: NONE },
  { name: "medium-zero", preset: "medium", ps1: ALL(0), layers: NONE },
  { name: "medium-snap", preset: "medium", ps1: only("snap"), layers: NONE },
  { name: "medium-affine", preset: "medium", ps1: only("affine"), layers: NONE },
  { name: "medium-gouraud", preset: "medium", ps1: only("gouraud"), layers: NONE },
  { name: "medium-dither", preset: "medium", ps1: only("dither"), layers: NONE },
  { name: "low-todos", preset: "low", ps1: ALL(1), layers: NONE },
  { name: "high-todos", preset: "high", ps1: ALL(1), layers: NONE },
  // V4: cada preset com as camadas dele (render.presets.<p>.layers)
  { name: "low-A", preset: "low", ps1: ALL(1), layers: null },
  { name: "medium-AB", preset: "medium", ps1: ALL(1), layers: null },
  { name: "high-ABC", preset: "high", ps1: ALL(1), layers: null },
  // V4: cada camada sozinha
  { name: "medium-A", preset: "medium", ps1: ALL(1), layers: { ...NONE, A: true } },
  { name: "medium-B", preset: "medium", ps1: ALL(1), layers: { ...NONE, B: true } },
  { name: "high-C", preset: "high", ps1: ALL(1), layers: { ...NONE, C: true } },
  // V4: aberração cromática no pulso de dano, sem e com "reduzir flicker"
  { name: "medium-dano", preset: "medium", ps1: ALL(1), layers: null, damage: 1 },
  { name: "medium-dano-reduzir", preset: "medium", ps1: ALL(1), layers: null, damage: 1, reduceFlicker: true },
  // D-18: caçador fora do cone da lanterna (cena de prova de legibilidade), com o contorno
  { name: "medium-cacador-fora", preset: "medium", ps1: ALL(1), layers: null, leg: LEG },
];

let server;
// porta livre (PORT=0) e /healthz só do processo filho deste script (tools/lib/server.mjs)
if (!url) ({ url, child: server } = await startServer());
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
/** processos de GPU do Chromium lançado por este script (Linux: /proc), para medir o custo em tempo de CPU */
function gpuProcesses() {
  const ppid = (p) => { try { return Number(readFileSync(`/proc/${p}/stat`, "utf8").split(") ")[1].split(" ")[1]); } catch { return 0; } };
  const mine = (p) => { for (let q = Number(p), i = 0; q > 1 && i < 16; q = ppid(q), i++) if (q === process.pid) return true; return false; };
  try {
    return readdirSync("/proc").filter(d => /^\d+$/.test(d)).filter(d => {
      try { return readFileSync(`/proc/${d}/cmdline`, "utf8").includes("--type=gpu-process") && mine(d); } catch { return false; }
    });
  } catch { return []; }
}
/** tempo de CPU (usuário + sistema, em ms) somado dos processos dados; tiques de 10 ms (USER_HZ = 100) */
function cpuMs(pids) {
  let ticks = 0;
  for (const p of pids) {
    try { const f = readFileSync(`/proc/${p}/stat`, "utf8").split(") ")[1].split(" "); ticks += Number(f[11]) + Number(f[12]); } catch { /* saiu */ }
  }
  return ticks * 10;
}
/** limiar da força Bayer: sem dither fica perto de 0; com dither de 5 bits passa bem disso */
const BAYER_MIN = 3;
/** intensidades padrão da camada A (data/balance.yaml render.layer_a) */
const layerADefaults = Object.fromEntries(LAYER_A.map(e => [e, balance.render.layer_a[e]]));
/** intensidade padrão do contorno do caçador (D-18; data/balance.yaml render.hunter_outline) */
const outlineDefault = balance.render.hunter_outline.intensity;

async function openGame(browser, preset, viewport) {
  const [w, h] = balance.render.presets[preset].internal;
  const page = await browser.newPage({ viewport: viewport ?? { width: w, height: h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.clock.install({ time: 0 });
  await page.goto(`${url}/?debug=1&seed=${SEED}&preset=${preset}`, { waitUntil: "load" });
  await page.clock.pauseAt(1000);
  await page.click("#go");
  // personagens (V2) carregam de .glb de forma assíncrona: espera todos entrarem na cena antes de capturar
  await page.evaluate(() => window.__thehellCharactersReady?.());
  return { page, errors };
}

/**
 * captura com as intensidades PS1 dadas; `o.layers` (null = as do preset), `o.layerA` (intensidades da camada A,
 * padrão as de render.layer_a), `o.reduceFlicker`, `o.damage` (pulso de dano) e `o.time` (relógio dos efeitos)
 */
async function capture(page, ps1, o = {}) {
  const r = await page.evaluate(([ps1, view, o, layerA0, outline0]) => {
    const h = window.__thehellRender;
    h.setPs1(ps1);
    h.setPreset(h.info().preset);
    if (o.layers) h.setLayers(o.layers);
    h.setLayerA({ ...layerA0, ...(o.layerA ?? {}) });
    h.setReduceFlicker(o.reduceFlicker ?? false);
    h.setHunterOutline(o.outline ?? outline0);
    h.setOverrides({ damage: o.damage ?? 0, time: o.time ?? null });
    // o.leg: caçador na posição da cena de prova (a de volta depois da captura) e vista da cena
    const H = window.__thehell().hunter, P = window.__thehell().survivors[0], saved = [H.x, H.z, H.a];
    if (o.leg) {
      const a = o.leg.view.yaw + o.leg.angle * Math.PI / 180;
      H.x = P.x - Math.sin(a) * o.leg.distance; H.z = P.z - Math.cos(a) * o.leg.distance;
      H.a = Math.atan2(P.x - H.x, P.z - H.z);
    }
    const c = h.capture(o.leg ? o.leg.view : view);
    [H.x, H.z, H.a] = saved;
    return { ...c, info: h.info(), t: window.__thehell().t };
  }, [ps1, VIEW, o, layerADefaults, outlineDefault]);
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
    const img = await capture(pages[s.preset].page, s.ps1, s);
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
    console.log(`${ok ? "ok   " : "FALHA"} ${s.name.padEnd(20)} dif. máx ${String(d.max).padStart(3)}  pixels fora da tolerância ${d.count} (${(d.fraction * 100).toFixed(3)}%)`);
    if (!ok) fail(`${s.name}: difere da referência (${d.count} pixels, ${(d.fraction * 100).toFixed(3)}% > ${TOL.fraction * 100}%)`);
  }

  // com tudo em 0: câmera parada não treme (duas capturas idênticas) e não há dither
  const med = pages.medium.page;
  const z1 = await capture(med, ALL(0), { layers: NONE }), z2 = await capture(med, ALL(0), { layers: NONE });
  const dz = diff(z1, z2);
  if (dz.max !== 0) fail(`tudo em 0: duas capturas seguidas diferem (dif. máx ${dz.max})`);
  const t1 = await capture(med, ALL(1), { layers: NONE }), t2 = await capture(med, ALL(1), { layers: NONE });
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

  // ---------- V4: camadas visuais (GDD-v0.3 §10.2) ----------
  // com as camadas A+B+C a câmera parada também não treme
  const hi = pages.high.page;
  const h1 = await capture(hi, ALL(1)), h2 = await capture(hi, ALL(1));
  if (diff(h1, h2).max !== 0) fail("high com as camadas A+B+C: duas capturas seguidas com a câmera parada diferem");
  // camada A com intensidades em 0 é idêntica às camadas desligadas (o passe final copia o alvo)
  const a0 = await capture(med, ALL(1), { layers: { ...NONE, A: true }, layerA: A_ALL(0), damage: 1 });
  const dA0 = diff(a0, shots["medium-todos"]);
  console.log(`camada A em 0 × camadas desligadas: dif. máx ${dA0.max}`);
  if (dA0.max !== 0) fail(`camada A com intensidades em 0 muda a imagem (dif. máx ${dA0.max})`);
  // cada efeito da camada A sozinho muda a imagem (aberração com pulso de dano)
  for (const e of LAYER_A) {
    const img = await capture(med, ALL(1), { layers: { ...NONE, A: true }, layerA: { ...A_ALL(0), [e]: 1 }, damage: 1 });
    const d = diff(img, a0);
    console.log(`camada A: ${e.padEnd(10)} muda ${(d.fraction * 100).toFixed(2)}% dos pixels`);
    if (d.fraction < 0.001) fail(`camada A: ${e} quase não muda a imagem (${(d.fraction * 100).toFixed(3)}%)`);
  }
  // cada camada muda a imagem em relação às camadas desligadas do mesmo preset
  for (const [name, base] of [["medium-A", "medium-todos"], ["medium-B", "medium-todos"], ["high-C", "high-todos"], ["medium-AB", "medium-A"]]) {
    const d = diff(shots[name], shots[base]);
    console.log(`${name.padEnd(10)} × ${base.padEnd(13)} muda ${(d.fraction * 100).toFixed(2)}% dos pixels`);
    if (d.fraction < 0.005) fail(`${name} quase não difere de ${base} (${(d.fraction * 100).toFixed(3)}%)`);
  }
  // aberração: o dano muda a imagem; com "reduzir flicker" não muda nada
  const dDano = diff(shots["medium-dano"], shots["medium-AB"]);
  const calmo = await capture(med, ALL(1), { reduceFlicker: true, damage: 0 });
  const dRed = diff(shots["medium-dano-reduzir"], calmo);
  console.log(`aberração no dano: muda ${(dDano.fraction * 100).toFixed(2)}% dos pixels; com reduzir flicker dif. máx ${dRed.max}`);
  if (dDano.fraction < 0.005) fail("o pulso de dano quase não muda a imagem (aberração)");
  if (dRed.max !== 0) fail(`com reduzir flicker o dano ainda muda a imagem (dif. máx ${dRed.max})`);
  // grão no tempo: oscila sem a opção; com "reduzir flicker" fica parado (nenhuma oscilação)
  const g0 = await capture(med, ALL(1), { time: 0 }), g1 = await capture(med, ALL(1), { time: 1 });
  const r0 = await capture(med, ALL(1), { time: 0, reduceFlicker: true }), r1 = await capture(med, ALL(1), { time: 1, reduceFlicker: true });
  const dg = diff(g0, g1), dr = diff(r0, r1);
  console.log(`grão em 1 s: muda ${(dg.fraction * 100).toFixed(2)}% dos pixels; com reduzir flicker dif. máx ${dr.max}`);
  if (dg.fraction < 0.005) fail("o grão não anima com o relógio");
  if (dr.max !== 0) fail(`com reduzir flicker a imagem oscila no tempo (dif. máx ${dr.max})`);

  // renderer.info por preset, com as camadas do preset e todos os efeitos ligados (GDD-v0.3 §10.6)
  const b = balance.render.budgets;
  const info = shots["medium-todos"].info;
  console.log(`renderer.info (medium, todos, sem camadas): ${info.calls} draw calls, ${info.triangles} triângulos (orçamento ${b.draw_calls} / ${b.triangles})`);
  if (info.calls > b.draw_calls || info.triangles > b.triangles) fail("renderer.info acima do orçamento");
  for (const name of ["low-A", "medium-AB", "high-ABC"]) {
    const info = shots[name].info;
    console.log(`renderer.info (${name}): ${info.calls} draw calls, ${info.triangles} triângulos (orçamento ${b.draw_calls} / ${b.triangles})`);
    if (info.calls > b.draw_calls || info.triangles > b.triangles) fail(`renderer.info acima do orçamento em ${name}`);
  }

  // custo das camadas (render.layer_cost_factor): preset médio, 1280×720 (escala 3), custo síncrono por quadro
  // (hook bench: readPixels de 1 pixel a cada quadro) com A+B e sem camadas, em pares; vale a mediana das razões.
  // Mede o tempo de CPU do processo de GPU do Chromium (o SwiftShader rasteriza na CPU): bem menos sensível à carga
  // da máquina que o relógio de parede, que fica como reserva fora do Linux.
  // V7 (revisões do V4 e do cajado: o teto fica perto do pior valor medido): 21 pares de 32 quadros, mínimo, máximo e
  // p90 no log, e duas vistas: a das capturas e o caçador dentro do cone da lanterna (pior caso: ele entra no passe de
  // sombra), na vista da prova de legibilidade com o caçador a LEG.distance m bem à frente. Sem repetir na falha
  {
    const cost = await openGame(browser, "medium", { width: 1280, height: 720 });
    const NONE_L = { A: false, B: false, C: false };
    const AB = { A: true, B: true, C: false };
    const FRAMES = 32, ROUNDS = 21;
    const gpu = gpuProcesses();
    const clock = gpu.length ? () => cpuMs(gpu) : () => performance.now();
    const run = async (layers, view) => {
      await cost.page.evaluate(([l, view, a]) => { const h = window.__thehellRender; h.setLayers(l); h.setLayerA(a); h.bench(view, 2); }, [layers, view, layerADefaults]);
      const t0 = clock();
      await cost.page.evaluate(([view, n]) => window.__thehellRender.bench(view, n), [view, FRAMES]);
      return (clock() - t0) / FRAMES;
    };
    const sorted = (v) => [...v].sort((x, y) => x - y);
    const med = (v) => sorted(v)[v.length >> 1], p90 = (v) => sorted(v)[Math.ceil(0.9 * v.length) - 1], k = balance.render.layer_cost_factor;
    const VIEWS = [{ name: "capturas", view: VIEW }, { name: "caçador no cone", view: LEG.view, cone: true }];
    for (const v of VIEWS) {
      if (v.cone) {
        await cost.page.evaluate(([LEG]) => {
          const G = window.__thehell(), P = G.survivors[0], H = G.hunter, a = LEG.view.yaw;
          H.x = P.x - Math.sin(a) * LEG.distance; H.z = P.z - Math.cos(a) * LEG.distance;
          H.a = Math.atan2(P.x - H.x, P.z - H.z);
        }, [LEG]);
      }
      // rodadas pareadas (sem camadas, A+B): a razão de cada par cancela a variação lenta de carga; vale a mediana
      const none = [], ab = [], ratio = [];
      for (let r = 0; r < ROUNDS; r++) { none.push(await run(NONE_L, v.view)); ab.push(await run(AB, v.view)); ratio.push(ab[r] / none[r]); }
      const rs = sorted(ratio);
      console.log(`custo (medium, 1280×720, vista ${v.name}, ${gpu.length ? "CPU do processo de GPU" : "relógio de parede"}, ${ROUNDS} pares de ${FRAMES} quadros): sem camadas ${med(none).toFixed(1)} ms, A+B ${med(ab).toFixed(1)} ms por quadro (medianas); razão pareada mediana ${med(ratio).toFixed(2)}× (mín ${rs[0].toFixed(2)}×, p90 ${p90(ratio).toFixed(2)}×, máx ${rs[rs.length - 1].toFixed(2)}×; teto ${k}× na mediana)`);
      if (med(ratio) > k) fail(`camadas A+B custam ${med(ratio).toFixed(2)}× o preset sem camadas na vista ${v.name} (teto ${k}×)`);
    }
    await cost.page.close();
  }

  // legibilidade depois da camada A (Art Bible §5.3; revisão do V4), preset médio com as camadas dele.
  // Cena de prova: o caçador a LEG.distance m da vista LEG.view, fora do cone da lanterna (LEG.angle), contra o muro.
  //  - olhos no preparo (telegraph do V3) e feixe de gerador: contraste WCAG ≥ render.legibility.min_contrast
  //    contra o mesmo pixel sem o objeto;
  //  - corpo do caçador fora do cone, sem o contorno (intensidade 0, V8) e com ele: a camada A não pode tirar mais que
  //    render.legibility.body_keep do contraste que ele tem sem ela. D-38: body_keep 0,89; a Art Bible §5.3 (3:1) tem
  //    precedência sobre esta métrica interna (as scanlines, ≈ 0,8 em luminância linear, e o tom de sombra da LUT tiram
  //    ≈ 10% de todo corpo claro; nenhum ponto potência × amount dá 3:1 e 0,9 juntos, ver render.hunter_outline);
  //  - corpo do caçador com o contorno (D-18, render.hunter_outline): ≥ render.legibility.min_contrast fora do cone
  //    (LEG) e dentro dele (LEG_IN), com a camada A ligada; o contraste sem o contorno vai no relatório (antes/depois).
  //    Dentro do cone a fração conservada não é cobrada (≈ 0,86 já sem o contorno: a lanterna clareia o corpo)
  //  - máscara do corpo: pixels em que o caçador desenhado chapado (opção `flat` do gancho: ui.text, sem luz, névoa
  //    nem bloom) difere do fundo sem ele. Conta a silhueta inteira (cabeça oval, farrapos de hunter.farrapos) mesmo
  //    onde a cor some no muro; antes contava só os pixels já visíveis sem o contorno
  {
    const lg = balance.render.legibility;
    const probe = async (o) => {
      const r = await med.evaluate(([LEG, o, a0, outline0]) => {
        const h = window.__thehellRender, G = window.__thehell(), P = G.survivors[0], H = G.hunter;
        h.setPreset(h.info().preset);
        h.setLayerA(o.layerA ?? a0);
        h.setHunterOutline(o.outline ?? outline0);
        h.setOverrides({ damage: 0, time: null });
        const a = LEG.view.yaw + LEG.angle * Math.PI / 180;
        H.x = P.x - Math.sin(a) * LEG.distance; H.z = P.z - Math.cos(a) * LEG.distance;
        H.a = Math.atan2(P.x - H.x, P.z - H.z);
        H.windup = o.windup ? { kind: "melee", t: 0, total: 0.4 } : null;
        return h.capture(LEG.view, { hidden: o.hidden ?? [], flat: o.flat ?? [] });
      }, [o.leg ?? LEG, o, layerADefaults, outlineDefault]);
      return { width: r.width, height: r.height, rgba: new Uint8Array(Buffer.from(r.rgba, "base64")) };
    };
    const lum = (p, i) => { const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(p[i]) + 0.7152 * f(p[i + 1]) + 0.0722 * f(p[i + 2]); };
    /** contraste WCAG entre a média de luminância de `fg` e de `bg` nos pixels em que `a` e `b` diferem */
    const contrast = (a, b, fg, bg) => {
      let n = 0, lf = 0, lb = 0;
      for (let i = 0; i < a.rgba.length; i += 4) {
        const d = Math.abs(a.rgba[i] - b.rgba[i]) + Math.abs(a.rgba[i + 1] - b.rgba[i + 1]) + Math.abs(a.rgba[i + 2] - b.rgba[i + 2]);
        if (d > LEG.diff) { n++; lf += lum(fg.rgba, i); lb += lum(bg.rgba, i); }
      }
      if (!n) return { n, cr: 0, lf: 0, lb: 0 };
      lf /= n; lb /= n;
      return { n, cr: (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05), lf, lb };
    };
    const A0 = A_ALL(0);
    const bg = await probe({ hidden: ["hunter"] }), bgOff = await probe({ hidden: ["hunter"], layerA: A0 });
    const flat = await probe({ flat: ["hunter"] }), flatOff = await probe({ flat: ["hunter"], layerA: A0 });
    const bare = await probe({ outline: 0 }), bareOff = await probe({ layerA: A0, outline: 0 });
    const cb = contrast(flat, bg, bare, bg), cb0 = contrast(flatOff, bgOff, bareOff, bgOff);
    // D-18: o corpo com o contorno, fora e dentro do cone, na mesma máscara chapada
    const body = await probe({}), bodyOff = await probe({ layerA: A0 });
    const cbRim = contrast(flat, bg, body, bg), cbRim0 = contrast(flatOff, bgOff, bodyOff, bgOff);
    const bgIn = await probe({ leg: LEG_IN, hidden: ["hunter"] }), flatIn = await probe({ leg: LEG_IN, flat: ["hunter"] });
    const bareIn = await probe({ leg: LEG_IN, outline: 0 }), bodyIn = await probe({ leg: LEG_IN });
    const ci = contrast(flatIn, bgIn, bodyIn, bgIn), ciBare = contrast(flatIn, bgIn, bareIn, bgIn);
    const fmt = (c) => `${c.cr.toFixed(2)}:1 (Y ${c.lf.toFixed(4)} × fundo ${c.lb.toFixed(4)}, ${c.n} px)`;
    console.log(`legibilidade D-18 (contorno ${outlineDefault}): fora do cone ${fmt(cbRim)} (sem camada A ${cbRim0.cr.toFixed(2)}:1, conserva ${(cbRim.cr / cbRim0.cr).toFixed(3)}), sem contorno ${fmt(cb)}; dentro do cone ${fmt(ci)}, sem contorno ${fmt(ciBare)}`);
    if (!ci.n) fail("legibilidade: caçador fora da cena de prova dentro do cone");
    if (cbRim.cr < lg.body_keep * cbRim0.cr) fail(`legibilidade: a camada A tira contraste do caçador com o contorno (${cbRim.cr.toFixed(2)} < ${lg.body_keep} × ${cbRim0.cr.toFixed(2)}; D-38)`);
    if (cbRim.cr < lg.min_contrast) fail(`legibilidade: corpo do caçador fora do cone com contraste ${cbRim.cr.toFixed(2)}:1 < ${lg.min_contrast}:1 (D-18)`);
    if (ci.cr < lg.min_contrast) fail(`legibilidade: corpo do caçador dentro do cone com contraste ${ci.cr.toFixed(2)}:1 < ${lg.min_contrast}:1 (D-18)`);
    // olhos e feixe: os pixels do objeto vêm de capturas sem bloom (o halo não entra na média); a luminância, das
    // capturas com a camada A completa
    const noBloom = { ...layerADefaults, bloom: 0 };
    const hot = await probe({ windup: true });
    const ce = contrast(await probe({ windup: true, layerA: noBloom }), await probe({ layerA: noBloom }), hot, bg);
    let beam = { n: 0, cr: 0 }, beamId = -1;
    for (let i = 0; i < 7; i++) {
      const hid = ["hunter", "beam" + i];
      const c = contrast(await probe({ hidden: ["hunter"], layerA: noBloom }), await probe({ hidden: hid, layerA: noBloom }), bg, await probe({ hidden: hid }));
      if (c.n > beam.n) { beam = c; beamId = i; }
    }
    console.log(`legibilidade: corpo do caçador sem contorno ${cb.cr.toFixed(2)}:1 (sem camada A ${cb0.cr.toFixed(2)}:1, ${cb.n} px); olhos no preparo ${ce.cr.toFixed(2)}:1 (${ce.n} px); feixe ${beamId} ${beam.cr.toFixed(2)}:1 (${beam.n} px); mínimo ${lg.min_contrast}:1, corpo ≥ ${lg.body_keep} do contraste sem a camada A`);
    if (!cb.n || !ce.n || !beam.n) fail("legibilidade: caçador, olhos ou feixe fora da cena de prova");
    if (ce.cr < lg.min_contrast) fail(`legibilidade: olhos no preparo com contraste ${ce.cr.toFixed(2)}:1 < ${lg.min_contrast}:1`);
    if (beam.cr < lg.min_contrast) fail(`legibilidade: feixe com contraste ${beam.cr.toFixed(2)}:1 < ${lg.min_contrast}:1`);
    if (cb.cr < lg.body_keep * cb0.cr) fail(`legibilidade: a camada A tira contraste do caçador sem o contorno (${cb.cr.toFixed(2)} < ${lg.body_keep} × ${cb0.cr.toFixed(2)})`);
  }

  for (const { errors } of Object.values(pages)) if (errors.length) fail("erros no console: " + errors.join(" | "));

  if (shotsDir) {
    mkdirSync(shotsDir, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
    await page.goto(`${url}/?debug=1&seed=${SEED}`, { waitUntil: "load" });
    await page.click("#go");
    await page.waitForTimeout(1500);
    for (const [name, v] of [["ligado", 1], ["desligado", 0]]) {
      await page.evaluate((v) => {
        window.__thehellRender.setLayers({ A: false, B: false, C: false });
        window.__thehellRender.setPs1({ snap: v, affine: v, gouraud: v, dither: v });
      }, v);
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(shotsDir, `v1-${name}.png`) });
    }
    await page.close();
    // V4 (marco A3): o Pátio em cada preset, com as camadas do preset, na vista das capturas e com o relógio parado
    for (const preset of Object.keys(balance.render.presets)) {
      const p = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
      await p.clock.install({ time: 0 });
      await p.goto(`${url}/?debug=1&seed=${SEED}&preset=${preset}`, { waitUntil: "load" });
      await p.clock.pauseAt(1000);
      await p.click("#go");
      await p.evaluate(() => window.__thehellCharactersReady?.());
      for (const [suffix, damage] of [["", 0], ["-dano", 1]]) {
        if (damage && preset !== "medium") continue;
        await p.evaluate(([view, damage]) => { window.__thehellRender.setOverrides({ damage }); window.__thehellRender.capture(view); }, [VIEW, damage]);
        await p.screenshot({ path: join(shotsDir, `v4-patio-${preset}${suffix}.png`) });
      }
      await p.close();
    }
    console.log("capturas para revisão →", shotsDir);
  }
  await browser.close();
} finally { server?.kill(); }

if (failures.length) { console.error(`compare: ${failures.length} falha(s); capturas e diferenças em ${outDir}`); process.exit(1); }
console.log(update ? "referências atualizadas em tools/visual/ref" : `compare ok (${SCENES.length} cenas) → ${outDir}`);
