#!/usr/bin/env node
// Capturas de referência do material PS1 (GDD-v0.3 §10.1, aceite A-01; plano-fases-1-2 §5 V1 e §9) e das camadas
// visuais A, B e C por preset (GDD-v0.3 §10.2; plano-fases-1-2 §5 V4).
// Sobe o servidor compilado, abre o jogo no Chromium (SwiftShader) com `?seed=` fixo e relógio parado
// (page.clock: a simulação não avança), e captura os pixels da tela na resolução interna (escala 1):
//   medium-todos (todos os efeitos em 1), medium-zero (todos em 0), um por efeito (snap, affine, gouraud, dither),
//   low-todos e high-todos (presets de resolução interna). As cenas do V1 rodam com as camadas desligadas (material
//   isolado); as do V4 ligam as camadas: por preset (low-A, medium-AB, high-ABC), por camada (medium-A, medium-B,
//   high-C) e dano (aberração), com e sem "reduzir flicker"; D-18: medium-cacador-fora (caçador fora do cone).
//   V9 (modo Retro FPS, ?debug=1&retro=1; D-13, D-15): medium-retro-1p (ferramenta no canto, Pátio industrial),
//   medium-retro-batedor (luneta, A2b 2c) e medium-retro-3p (Pátio industrial em 3ª pessoa), com o caçador escondido
//   na captura (o contorno dele no modo é da issue #48, fora desta cena).
// Compara cada captura com tools/visual/ref/<nome>.png por diferença por pixel com tolerância e verifica:
//   - com tudo em 0 duas capturas seguidas com a câmera parada são idênticas e não há padrão Bayer;
//   - o dither ligado produz o padrão Bayer; cada efeito sozinho muda a imagem em relação a tudo em 0;
//   - renderer.info (draw calls e triângulos) dentro de render.budgets em cada preset com as camadas dele;
//   - camada A com intensidades em 0 = camadas desligadas (pixel a pixel); cada efeito da camada A muda a imagem;
//   - com "reduzir flicker": dano não muda a imagem (sem aberração) e o grão não oscila no tempo;
//   - custo: medium com A+B / medium sem camadas (tempo síncrono por quadro, 1280×720), na vista das capturas e com o
//     caçador no cone da lanterna; D-44: pares ABBA, IC por bootstrap (render.cost_check), falha só se o limite inferior
//     do IC passar de render.layer_cost_factor × (1 + ci_runner_margin), aviso se a mediana passar de layer_cost_factor;
//     D-48: com render.cost_check.ci_mode "warn" a falha de custo vira aviso (anotação ::warning e resumo do job);
//     issue #59 (D-49): com --baseline (build de main), PR e main medidos em rodadas intercaladas no mesmo navegador;
//     D-51 (critério duplo): falha só se os limites inferiores dos IC de rel_AB (PR_AB / main_AB − 1, ms/quadro com
//     A+B) e de Δrazão (razão do PR − razão de main), pareados por rodada, passarem de render.cost_check.main_rel_delta
//     E main_ratio_delta; o teto de D-44 fica só no log e no resumo do job; sem build de main utilizável (ou com exceção do lado de main no meio da
//     medida) a comparação não é feita: só aviso "sem build de main, comparação não feita" (complemento de D-49);
//   - legibilidade depois da camada A: olhos no preparo e feixe ≥ render.legibility.min_contrast; o corpo do caçador
//     (com o contorno de D-18, render.hunter_outline) ≥ render.legibility.min_contrast fora e dentro do cone da
//     lanterna, e fora do cone mantém render.legibility.body_keep do contraste que tem sem a camada A, com e sem o
//     contorno (D-38).
// Uso: node tools/visual/compare.mjs [--update] [--out dir] [--shots dir] [--baseline dir] [url]
//   --baseline raiz de um checkout de main com `pnpm data` e o build do cliente (a CI usa um git worktree da base do
//             PR, ou do main anterior ao push; ver .github/workflows/ci.yml). COST_MAIN_BUILD = desfecho do passo
//             que fez esse build (steps.<id>.outcome); diferente de success = sem build de main utilizável
//   --update  regrava as referências (revisar as imagens antes de commitar)
//   --out     onde gravar as capturas atuais e os mapas de diferença (padrão: <tmp>/thehell-visual)
//   --shots   grava também v1-ligado.png, v1-desligado.png e v4-patio-<preset>.png em 1280×720 com deviceScaleFactor 2
//             (revisão humana; marco A3)
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus, loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng } from "./png.mjs";
import { startServer } from "../lib/server.mjs";
import { LEG, LEG_IN, RULES, SEED, gotoPaused } from "../lib/capture-page.mjs";
import { COST_TITLE, costGateOutcome, costInfo, costVerdict, costVsMain, checkSamples, d2, ghaWarning, median, p1, roundPlan, runRounds, x2 } from "./cost-stats.mjs";

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
const baselineDir = opt("--baseline");
let url = args.find((a, i) => a.startsWith("http") && !["--out", "--shots", "--baseline"].includes(args[i - 1]));
const balance = JSON.parse(readFileSync(join(root, "packages/shared/generated/balance.json"), "utf8"));

// SEED, RULES (protótipo, layout 0), LEG e LEG_IN: tools/lib/capture-page.mjs, comuns com tools/art/*-capturas.mjs
/** vista das capturas: 3ª pessoa, olhando a jaula, um muro próximo, dois aliados e três feixes */
const VIEW = { yaw: -0.9, pitch: -0.1, thirdPerson: true };
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
  // V9: modo Retro FPS (página própria com ?retro=1), mesma vista em 1ª pessoa; o caçador fica fora da captura
  { name: "medium-retro-1p", preset: "medium", ps1: ALL(1), layers: null, query: "retro=1", view: { ...VIEW, thirdPerson: false }, hidden: ["hunter"] },
  { name: "medium-retro-batedor", preset: "medium", ps1: ALL(1), layers: null, query: "retro=1&retro_class=batedor", view: { ...VIEW, thirdPerson: false }, hidden: ["hunter"] },
  { name: "medium-retro-3p", preset: "medium", ps1: ALL(1), layers: null, query: "retro=1", hidden: ["hunter"] },
];
/** cenas do V9 (modo Retro FPS) */
const RETRO_SCENES = SCENES.filter(s => s.query?.includes("retro=1")).map(s => s.name);

let server, baseServer;
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

/** abre o jogo no preset; `query` = parâmetros extras (V9: `retro=1`, com o ?debug=1 que já vai sempre) */
async function openGame(browser, preset, viewport, at = url, query = "") {
  const [w, h] = balance.render.presets[preset].internal;
  const page = await browser.newPage({ viewport: viewport ?? { width: w, height: h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  // relógio parado, instalado e pausado ANTES de navegar (tools/lib/capture-page.mjs); as capturas seguem idênticas às
  // referências
  await gotoPaused(page, `${at}/?debug=1&seed=${SEED}&preset=${preset}&${RULES}${query ? "&" + query : ""}`);
  await page.click("#go");
  // personagens (V2) carregam de .glb de forma assíncrona: espera todos entrarem na cena antes de capturar
  await page.evaluate(() => window.__thehellCharactersReady?.());
  return { page, errors };
}

/**
 * issue #59 (D-49): abre o build de main (--baseline <raiz de um checkout de main com `pnpm data` e o build do
 * cliente feitos) para medir o custo das camadas no mesmo job. O servidor deste PR serve o cliente de main
 * (PUBLIC_DIR); as intensidades da camada A vêm do balance.json de main (cada build com os próprios padrões).
 * Devolve { page, errors, layerA } ou { reason } quando não dá para comparar (sem --baseline, build ausente, main
 * sem o gancho de custo, servidor de main não subiu): aí a comparação não é feita, só aviso (costGateOutcome)
 */
async function openBaseline(browser) {
  if (!baselineDir) return { reason: "sem --baseline (build de main), rodada local" };
  const step = process.env.COST_MAIN_BUILD;
  if (step && step !== "success") return { reason: `passo "Build de main para o custo das camadas" terminou em ${step}` };
  const pub = join(baselineDir, "packages/client/dist"), bal = join(baselineDir, "packages/shared/generated/balance.json");
  if (!existsSync(join(pub, "index.html")) || !existsSync(bal)) return { reason: `build de main ausente em ${baselineDir} (falta ${existsSync(bal) ? pub + "/index.html" : bal})` };
  const la = JSON.parse(readFileSync(bal, "utf8")).render?.layer_a;
  if (!la || !LAYER_A.every(e => Number.isFinite(la[e]))) return { reason: "main sem render.layer_a com os efeitos de hoje" };
  try {
    baseServer = await startServer({ env: { PUBLIC_DIR: pub } });
    const g = await openGame(browser, "medium", { width: 1280, height: 720 }, baseServer.url);
    const hooks = await g.page.evaluate(() => ["setLayers", "setLayerA", "bench"].every(f => typeof window.__thehellRender?.[f] === "function") && typeof window.__thehell === "function");
    if (!hooks) { await g.page.close(); return { reason: "main sem o gancho de custo (__thehellRender.bench/setLayers/setLayerA)" }; }
    return { ...g, layerA: Object.fromEntries(LAYER_A.map(e => [e, la[e]])) };
  } catch (e) {
    return { reason: `build de main não abriu (${e.message.split("\n")[0]})` };
  }
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
    // o.view: vista própria da cena (V9: 1ª pessoa); o.hidden: malhas fora da captura (V9: o caçador)
    const c = h.capture(o.leg ? o.leg.view : (o.view ?? view), o.hidden ? { hidden: o.hidden } : undefined);
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
    // uma página por preset (e por `query`: o modo Retro FPS monta o Pátio industrial ao abrir a partida)
    const key = s.query ? `${s.preset}?${s.query}` : s.preset;
    pages[key] ??= await openGame(browser, s.preset, undefined, url, s.query);
    const img = await capture(pages[key].page, s.ps1, s);
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
  for (const name of ["low-A", "medium-AB", "high-ABC", ...RETRO_SCENES]) {
    const info = shots[name].info;
    console.log(`renderer.info (${name}): ${info.calls} draw calls, ${info.triangles} triângulos (orçamento ${b.draw_calls} / ${b.triangles})`);
    if (info.calls > b.draw_calls || info.triangles > b.triangles) fail(`renderer.info acima do orçamento em ${name}`);
  }
  // V9: o modo muda a imagem (Pátio industrial em 3ª pessoa × o Pátio de sempre); a ferramenta entra no quadro em
  // 1ª pessoa (a única diferença entre as páginas do Batedor e da classe padrão do menu é a ferramenta na mão)
  const dInd = diff(shots["medium-retro-3p"], shots["medium-AB"]);
  const dLun = diff(shots["medium-retro-batedor"], shots["medium-retro-1p"]);
  console.log(`modo Retro FPS: Pátio industrial muda ${(dInd.fraction * 100).toFixed(2)}% dos pixels; luneta × ferramenta padrão ${(dLun.fraction * 100).toFixed(2)}%`);
  if (dInd.fraction < 0.05) fail(`modo Retro FPS: o Pátio industrial quase não muda a imagem (${(dInd.fraction * 100).toFixed(3)}%)`);
  if (dLun.fraction < 0.005) fail(`modo Retro FPS: a luneta do Batedor quase não muda a imagem em relação à ferramenta padrão (${(dLun.fraction * 100).toFixed(3)}%)`);

  // custo das camadas (render.layer_cost_factor): preset médio, 1280×720 (escala 3), custo síncrono por quadro
  // (hook bench: readPixels de 1 pixel a cada quadro) sem camadas (A) e com A+B (B).
  // Mede o tempo de CPU do processo de GPU do Chromium (o SwiftShader rasteriza na CPU): bem menos sensível à carga
  // da máquina que o relógio de parede, que fica como reserva fora do Linux.
  // V7: duas vistas, a das capturas e o caçador dentro do cone da lanterna (pior caso: ele entra no passe de sombra),
  // na vista da prova de legibilidade com o caçador a LEG.distance m bem à frente.
  // D-44 (b) (render.cost_check; tools/visual/cost-stats.mjs): sem GPU a razão depende do tipo de runner, então aqui
  // é proxy de regressão: cost_check.warmup quadros descartados a cada troca de camadas, mediana das razões pareadas
  // com IC por bootstrap determinístico.
  // D-49 (issue #59): PR e build de main (--baseline) em rodadas intercaladas (crossOrder) no mesmo navegador, com
  // cost_check.warmup_rounds rodadas descartadas antes. D-51 (critério duplo): reprova só se os dois limites inferiores
  // passarem, o do IC de rel_AB (PR_AB / main_AB − 1, ms/quadro com A+B) acima de cost_check.main_rel_delta E o do IC
  // de Δrazão (razão do PR − razão de main) acima de cost_check.main_ratio_delta (ci_mode fail); o log e o resumo
  // trazem sempre as duas medidas por vista; o teto absoluto de D-44 fica só no log e no resumo. Complemento de D-49 (supervisão
  // por delegação do Rodrigo, 09/11/2026): sem build de main utilizável, ou com exceção no meio da medida do lado de
  // main, a comparação não é feita e fica só o aviso "sem build de main, comparação não feita" (costGateOutcome),
  // sem medir o PR sozinho; exceção do lado do PR segue reprovando. O log traz a máquina (CPU, núcleos, carga) e o
  // ms/quadro sem camadas para comparar runs entre runners. Sem repetir na falha
  {
    const CC = balance.render.cost_check, k = balance.render.layer_cost_factor;
    const cost = await openGame(browser, "medium", { width: 1280, height: 720 });
    const base = await openBaseline(browser);
    const LAYERS = { A: { A: false, B: false, C: false }, B: { A: true, B: true, C: false } };
    const gpu = gpuProcesses();
    const clock = gpu.length ? () => cpuMs(gpu) : () => performance.now();
    const run = async (g, layers, view) => {
      await g.page.evaluate(([l, view, a, w]) => { const h = window.__thehellRender; h.setLayers(l); h.setLayerA(a); h.bench(view, w); }, [layers, view, g.layerA, CC.warmup]);
      const t0 = clock();
      await g.page.evaluate(([view, n]) => window.__thehellRender.bench(view, n), [view, CC.frames]);
      return (clock() - t0) / CC.frames;
    };
    const games = { pr: { ...cost, layerA: layerADefaults }, ...(base.page ? { main: base } : {}) };
    const cpu = cpus();
    const machine = `${cpu[0]?.model ?? "?"}, ${cpu.length} núcleos, carga ${loadavg().map(x => x.toFixed(1)).join("/")}`;
    const summary = (m) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${m}\n`); };
    // desfecho do portão (costGateOutcome): anotação, resumo do job e log de cada aviso; reprova só com `failing`
    const gate = (cmp, ctx) => {
      const out = costGateOutcome(cmp, CC.ci_mode, ctx);
      for (const w of out.warnings) {
        console.log(ghaWarning(COST_TITLE, w));
        summary(`**${COST_TITLE}**: ${w}`);
        console.warn(`AVISO: custo das camadas: ${w}. Máquina: ${machine}`);
      }
      return out;
    };
    const message = (e) => String(e?.message ?? e).split("\n")[0];
    const VIEWS = [{ name: "capturas", view: VIEW }, { name: "caçador no cone", view: LEG.view, cone: true }];
    const tCost = performance.now();
    if (!games.main) gate({ reason: base.reason });
    else {
      console.log(`custo: máquina ${machine}; ${gpu.length ? "CPU do processo de GPU" : "relógio de parede"}; ${CC.pairs} rodadas PR × main (crossOrder) de ${CC.frames} quadros (${CC.warmup} de aquecimento descartados), IC ${Math.round(CC.ci * 100)}% por bootstrap (${CC.bootstrap_resamples} reamostragens, semente ${CC.seed})`);
      console.log(`custo: build de main em ${baselineDir} (issue #59, D-51): ${CC.warmup_rounds} rodada(s) de aquecimento descartada(s); reprova só se o limite inferior do IC de rel_AB (A+B do PR ÷ A+B de main − 1) > ${p1(CC.main_rel_delta)} (render.cost_check.main_rel_delta) E o de Δrazão (razão do PR − razão de main) > ${d2(CC.main_ratio_delta)} (main_ratio_delta); o teto de D-44 é só informativo`);
      // exceção do lado de main (página, gancho ou medida inválida): interrompe a comparação e só avisa
      let mainError = null;
      const onMain = async (f, what) => {
        try { return await f(); } catch (e) { mainError = `${what}: ${message(e)}`; return undefined; }
      };
      for (const v of VIEWS) {
        if (v.cone) {
          const place = (g) => g.page.evaluate(([LEG]) => {
            const G = window.__thehell(), P = G.survivors[0], H = G.hunter, a = LEG.view.yaw;
            H.x = P.x - Math.sin(a) * LEG.distance; H.z = P.z - Math.cos(a) * LEG.distance;
            H.a = Math.atan2(P.x - H.x, P.z - H.z);
          }, [LEG]);
          await place(games.pr);
          await onMain(() => place(games.main), `build de main falhou ao posicionar o caçador (vista ${v.name})`);
          if (mainError) break;
        }
        // D-51 (investigação do viés): cost_check.warmup_rounds rodadas medidas e descartadas nos dois builds (a aba do
        // PR abre antes e o PR já desenhou as capturas neste navegador), depois pairs rodadas guardadas, com a ordem
        // PR/main alternando (roundPlan: rodada guardada 0 com o PR primeiro)
        const { ms } = await runRounds(roundPlan(CC.warmup_rounds, CC.pairs), (g, l, r) => g === "pr"
          ? run(games.pr, LAYERS[l], v.view)
          : onMain(() => run(games.main, LAYERS[l], v.view), `build de main falhou no meio da medida (vista ${v.name}, ${r === null ? "aquecimento" : `rodada ${r}`})`),
        () => mainError !== null);
        if (mainError) break;
        // lado do PR: contagem errada ou tempo inválido lança e reprova (fora de onMain)
        checkSamples(ms.pr, CC.pairs, "PR");
        const c = costVerdict(ms.pr.A, ms.pr.B, CC, k), rs = [...c.ratios].sort((x, y) => x - y);
        console.log(`custo (medium, 1280×720, vista ${v.name}): sem camadas ${median(ms.pr.A).toFixed(1)} ms/quadro (base do runner), A+B ${median(ms.pr.B).toFixed(1)} ms/quadro (medianas); razão pareada mediana ${x2(c.median)}, IC ${Math.round(CC.ci * 100)}% [${x2(c.lo)}, ${x2(c.hi)}] (mín ${x2(rs[0])}, máx ${x2(rs[rs.length - 1])}); orçamento ${x2(c.budget)}, teto da CI ${x2(c.fail)} (${k}× × (1 + ${CC.ci_runner_margin})) → ${c.verdict} (informativo, D-51)`);
        // só as amostras de main são conferidas como "lado de main" (aviso); costVsMain roda fora de onMain, então um
        // bug do próprio PR nessa conta (ou cost_check inválido) reprova em vez de virar aviso
        await onMain(async () => checkSamples(ms.main, CC.pairs, "main"), `medida de main inválida (vista ${v.name})`);
        if (mainError) break;
        const rel = costVsMain({ a: ms.pr.A, b: ms.pr.B }, { a: ms.main.A, b: ms.main.B }, CC);
        const ctx = { view: v.name, ciLevel: CC.ci };
        console.log(`custo × main (${costInfo(rel, c, ctx)}) → ${rel.verdict === "pass" ? "ok" : rel.verdict === "warn" ? "AVISO" : "FALHA"}`);
        summary(`**Custo das camadas** (D-51): ${costInfo(rel, c, ctx)}. Máquina: ${machine}`);
        const out = gate({ rel, abs: c }, ctx);
        if (out.failing) fail(`camadas A+B no PR custam ${rel.prAbMs.toFixed(1)} ms/quadro na vista ${v.name}, contra ${rel.mainAbMs.toFixed(1)} em main no mesmo job; os dois limites inferiores dos IC passam dos limites, rel_AB ${p1(rel.lo)} > render.cost_check.main_rel_delta (${p1(rel.delta)}) e Δrazão ${d2(rel.ratio.lo)} > main_ratio_delta (${d2(rel.ratio.delta)}): regressão das camadas (D-51)`);
      }
      if (mainError) gate({ reason: mainError });
    }
    console.log(`custo: ${games.main ? `medidas em ${((performance.now() - tCost) / 1000).toFixed(0)} s (PR e main)` : "medida não feita (sem build de main)"}; carga ${loadavg().map(x => x.toFixed(1)).join("/")}`);
    if (base.errors?.length) console.warn(`AVISO: erros no console do build de main (não reprovam este PR): ${base.errors.join(" | ")}`);
    await cost.page.close();
    if (base.page) await base.page.close().catch(() => {});
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
    await page.goto(`${url}/?debug=1&seed=${SEED}&${RULES}`, { waitUntil: "load" });
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
      await gotoPaused(p, `${url}/?debug=1&seed=${SEED}&preset=${preset}&${RULES}`);
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
} finally { server?.kill(); baseServer?.stop(); }

if (failures.length) { console.error(`compare: ${failures.length} falha(s); capturas e diferenças em ${outDir}`); process.exit(1); }
console.log(update ? "referências atualizadas em tools/visual/ref" : `compare ok (${SCENES.length} cenas) → ${outDir}`);
