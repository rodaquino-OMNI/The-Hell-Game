#!/usr/bin/env node
// Capturas do marco de arte A2 (Art Bible §5.1 e §5.2; plano-fases-1-2 §8) a partir dos .glb finais:
//  - cada personagem em preto chapado e em cor, de frente, de lado e de costas, na resolução interna 384×216
//    (preset medium), ampliado por escala inteira (nearest) para ver;
//  - elenco lado a lado (preto e cor), as 7 skins no Mecânico e o elenco em cor sob emulação de deuteranopia e
//    protanopia (Chrome DevTools Protocol, Emulation.setEmulatedVisionDeficiency);
//  - no jogo com material PS1 (deviceScaleFactor 2): feixe em cada estado, caçador com olhos acesos no preparo e
//    aliado preso com cadeado;
//  - proxy objetivo de distinção das silhuetas: IoU (interseção ÷ união) entre as máscaras pretas de cada par, por
//    vista, de perto e na distância de jogo. É só um proxy: o portão é o teste humano da Art Bible §5.1.
// Uso: node tools/art/a2-capturas.mjs <pasta de saída> [url]   (sem url, sobe packages/server/dist/server.mjs)
// Pré-requisito: pnpm build. Determinístico: semente fixa, relógio parado, sem Math.random na render.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { encodePng } from "../visual/png.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../../", import.meta.url));
const out = process.argv[2];
if (!out) { console.error("uso: node tools/art/a2-capturas.mjs <pasta de saída> [url]"); process.exit(2); }
mkdirSync(out, { recursive: true });
const balance = JSON.parse(readFileSync(join(root, "packages/shared/generated/balance.json"), "utf8"));
const sheet = JSON.parse(readFileSync(join(root, "data/art/personagens.json"), "utf8"));
const IDS = sheet.personagens.map(p => p.id);
const SKINS = Object.keys(sheet.skins.lista);
const map = JSON.parse(readFileSync(join(root, "packages/shared/generated/maps.json"), "utf8")).patio;
const PRESET = "medium";
const [IW, IH] = balance.render.presets[PRESET].internal;
/** ampliação inteira das capturas na resolução interna */
const ZOOM = 4;
const SEED = 1234;
const VIEWS = [["frente", 0], ["lado", Math.PI / 2], ["costas", Math.PI]];
// enquadramentos (ferramenta, não regra de jogo): "perto" cabe 2,9 m de altura no quadro (todos na mesma escala);
// "jogo" usa o campo de visão da câmera do jogo (prototype_extras.camera.fov) a 8 m
const FRAME = {
  perto: { fov: 20, dist: 8.22, camHeight: 1.35, lookHeight: 1.35, spacing: 0 },
  elenco: { fov: 20, dist: 16, camHeight: 1.4, lookHeight: 1.3, spacing: 1.55 },
  jogo: { fov: balance.prototype_extras.camera.fov, dist: 8, camHeight: 1.6, lookHeight: 1.2, spacing: 0 },
};
const BG = { preto: "ui.text", cor: "world.fog", luz: "world.fog" };

let url = process.argv[3], server;
if (!url) {
  // porta própria (A2_PORT), longe das usadas por smoke (18080) e compare (18082)
  const port = process.env.A2_PORT ?? "18731";
  url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [join(root, "packages/server/dist/server.mjs")], { env: { ...process.env, PORT: port }, stdio: ["ignore", "ignore", "inherit"] });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(url + "/healthz")).ok) break; } catch { /* subindo */ } await sleep(100); }
}

/** amplia RGBA por `k` (vizinho mais próximo) */
function zoom(img, k) {
  const w = img.width * k, h = img.height * k, rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(img.rgba.subarray(((y / k | 0) * img.width + (x / k | 0)) * 4, ((y / k | 0) * img.width + (x / k | 0)) * 4 + 4), (y * w + x) * 4);
  return { width: w, height: h, rgba };
}
const save = (name, img, k = ZOOM) => { const z = zoom(img, k); writeFileSync(join(out, name), encodePng(z.width, z.height, z.rgba)); return join(out, name); };
/** máscara da silhueta: pixel escuro (luminância < 64) sobre o fundo claro */
const mask = img => { const m = new Uint8Array(img.width * img.height); for (let i = 0; i < m.length; i++) m[i] = 0.299 * img.rgba[i * 4] + 0.587 * img.rgba[i * 4 + 1] + 0.114 * img.rgba[i * 4 + 2] < 64 ? 1 : 0; return m; };
const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += a[k] & b[k]; u += a[k] | b[k]; } return u ? i / u : 0; };

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const files = [];
const errors = [];
const masks = { perto: {}, jogo: {} };
try {
  // ---------- retratos na resolução interna ----------
  const page = await browser.newPage({ viewport: { width: IW, height: IH }, deviceScaleFactor: 1 });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.clock.install({ time: 0 });
  await page.goto(`${url}/?seed=${SEED}&preset=${PRESET}`, { waitUntil: "load" });
  await page.clock.pauseAt(1000);
  await page.click("#go");
  await page.evaluate(() => window.__thehellCharactersReady?.());
  const shoot = async o => {
    const r = await page.evaluate(o => window.__thehellRender.portrait(o), o);
    return { width: r.width, height: r.height, rgba: new Uint8Array(Buffer.from(r.rgba, "base64")) };
  };
  for (const id of IDS) for (const [view, yaw] of VIEWS) {
    for (const mode of ["preto", "cor"]) {
      const img = await shoot({ ids: [id], mode, yaw, bg: BG[mode], ...FRAME.perto });
      files.push(save(`${id}-${view}-${mode}.png`, img));
      if (mode === "preto") (masks.perto[view] ??= {})[id] = mask(img);
    }
    const far = await shoot({ ids: [id], mode: "preto", yaw, bg: BG.preto, ...FRAME.jogo });
    (masks.jogo[view] ??= {})[id] = mask(far);
    if (view === "frente") files.push(save(`${id}-${view}-preto-distancia-jogo.png`, far));
  }
  for (const [view, yaw] of VIEWS.slice(0, 2)) for (const mode of ["preto", "cor", "luz"]) {
    const img = await shoot({ ids: IDS, mode, yaw, bg: BG[mode], ...FRAME.elenco });
    files.push(save(`elenco-${view}-${mode}.png`, img));
  }
  for (const skin of SKINS) {
    const img = await shoot({ ids: ["mecanico"], mode: "cor", yaw: 0, bg: BG.cor, skin, ...FRAME.perto });
    files.push(save(`skin-mecanico-${skin}.png`, img));
  }
  const tele = await shoot({ ids: ["espectro"], mode: "cor", yaw: 0, bg: BG.cor, telegraph: true, ...FRAME.perto });
  files.push(save("espectro-frente-cor-preparo.png", tele));
  await page.close();

  // ---------- daltonismo (emulação do Chrome sobre a imagem do elenco em cor) ----------
  const cvd = await browser.newPage({ viewport: { width: IW * ZOOM / 2, height: IH * ZOOM / 2 }, deviceScaleFactor: 2 });
  const b64 = readFileSync(join(out, "elenco-frente-cor.png")).toString("base64");
  await cvd.setContent(`<body style="margin:0;background:#000"><img src="data:image/png;base64,${b64}" style="width:100%;image-rendering:pixelated;display:block"></body>`);
  const cdp = await cvd.context().newCDPSession(cvd);
  for (const type of ["deuteranopia", "protanopia", "tritanopia"]) {
    await cdp.send("Emulation.setEmulatedVisionDeficiency", { type });
    const p = join(out, `elenco-frente-cor-${type}.png`);
    await cvd.screenshot({ path: p });
    files.push(p);
  }
  await cdp.send("Emulation.setEmulatedVisionDeficiency", { type: "none" });
  await cvd.close();

  // ---------- no jogo, material PS1, deviceScaleFactor 2 ----------
  const game = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  game.on("pageerror", e => errors.push(e.message));
  await game.clock.install({ time: 0 });
  await game.goto(`${url}/?seed=${SEED}`, { waitUntil: "load" });
  await game.clock.pauseAt(1000);
  await game.click("#go");
  await game.evaluate(() => window.__thehellCharactersReady?.());
  /** prepara o estado (função serializada que recebe G) e desenha com a câmera atrás do jogador olhando o alvo */
  // pixels do canvas do jogo (resolução interna × escala inteira do deviceScaleFactor 2), lidos no mesmo quadro
  const scene = async (name, setup, target, pitch = 0.12) => {
    const r = await game.evaluate(([setup, target, pitch]) => {
      const G = window.__thehell();
      new Function("G", setup)(G);
      const P = G.survivors[0];
      const yaw = Math.atan2(-(target[0] - P.x), -(target[1] - P.z));
      P.a = yaw;
      const c = window.__thehellRender.capture({ yaw, pitch, thirdPerson: true });
      return { ...c, states: window.__thehellRender.states() };
    }, [setup, target, pitch]);
    files.push(save(`jogo-${name}.png`, { width: r.width, height: r.height, rgba: new Uint8Array(Buffer.from(r.rgba, "base64")) }, 1));
    console.log(`jogo-${name}: olhos acesos ${r.states.telegraph}, cadeados ${JSON.stringify(r.states.locks)}`);
  };
  const gens = await game.evaluate(() => window.__thehell().gens.map(g => ({ x: g.x, z: g.z, bonus: g.bonus })));
  const req = gens.findIndex(g => !g.bonus), bon = gens.findIndex(g => g.bonus);
  /** coloca o jogador a `d` m do gerador i (do lado do centro do mapa), mais o caçador longe */
  const near = (i, d) => `const g = G.gens[${i}], P = G.survivors[0], L = Math.hypot(g.x, g.z) || 1;
    P.x = g.x - g.x / L * ${d}; P.z = g.z - g.z / L * ${d}; G.hunter.x = 1000; G.hunter.z = 1000;`;
  const states = [
    ["feixe-pendente-aceso", `G.gens[${req}].n = 0; G.gens[${req}].done = false; G.t = 0.25;`, req],
    ["feixe-pendente-apagado", `G.gens[${req}].n = 0; G.gens[${req}].done = false; G.t = 0.75;`, req],
    ["feixe-progresso", `G.gens[${req}].n = 2; G.gens[${req}].done = false; G.t = 0.25;`, req],
    ["feixe-pronto", `G.gens[${req}].n = 5; G.gens[${req}].done = true; G.t = 0.25;`, req],
    ["feixe-bonus", `G.gens[${bon}].n = 0; G.gens[${bon}].done = false; G.t = 0.4;`, bon],
  ];
  // vista um pouco para cima: o feixe inteiro (14 m) e o losango do bônus no quadro
  for (const [name, setup, i] of states) await scene(name, near(i, 12) + setup, [gens[i].x, gens[i].z], 0.45);
  // feixes de longe: todos os estados ao mesmo tempo, vistos do centro do mapa
  await scene("feixes-de-longe", `const P = G.survivors[0]; P.x = 4.75; P.z = 26; G.hunter.x = 1000; G.t = 0.25;
    G.gens.forEach((g, k) => { g.done = k % 3 === 2; g.n = k % 3 === 1 ? 2 : g.done ? 5 : 0; });`, [0, -10]);
  // caçador em preparo de golpe (olhos acesos) e sem preparo, a 5 m de frente para o jogador
  const hunt = on => `const P = G.survivors[0]; P.x = 4.75; P.z = 26; G.survivors.slice(1).forEach((s, k) => { s.x = -20 - 2 * k; s.z = 26; });
    const H = G.hunter; H.x = 4.75; H.z = 21; H.a = Math.atan2(-(P.x - H.x), -(P.z - H.z));
    H.windup = ${on ? "{ kind: 'melee', t: 0.3, total: 0.45 }" : "null"}; G.t = 3;`;
  await scene("cacador-preparo-olhos-acesos", hunt(true), [4.75, 21], 0.3);
  await scene("cacador-sem-preparo", hunt(false), [4.75, 21], 0.3);
  // aliado preso na gaiola com o cadeado
  await scene("aliado-preso-cadeado", `const c = [${map.cage[0]}, ${map.cage[1]}]; const A = G.survivors[1]; A.st = "cage"; A.x = c[0]; A.z = c[1];
    const P = G.survivors[0]; P.x = c[0] + 7; P.z = c[1] + 7; G.hunter.x = 1000;`, map.cage);
  await game.close();
} finally {
  await browser.close();
  server?.kill();
}

// ---------- proxy de silhueta: IoU entre pares ----------
const report = [];
for (const dist of ["perto", "jogo"]) for (const [view] of VIEWS) {
  const m = masks[dist][view];
  for (let i = 0; i < IDS.length; i++) for (let j = i + 1; j < IDS.length; j++) report.push({ dist, view, a: IDS[i], b: IDS[j], iou: +iou(m[IDS[i]], m[IDS[j]]).toFixed(3) });
}
writeFileSync(join(out, "silhuetas-iou.json"), JSON.stringify(report, null, 1));
const byPair = new Map();
for (const r of report) { const k = `${r.a} × ${r.b}`; (byPair.get(k) ?? byPair.set(k, {}).get(k))[`${r.dist}/${r.view}`] = r.iou; }
console.table(Object.fromEntries(byPair));
for (const f of files) console.log(f);
if (errors.length) { console.error("erros no console:", errors.join(" | ")); process.exit(1); }
