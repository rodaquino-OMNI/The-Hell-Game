#!/usr/bin/env node
// Capturas do contorno do caçador para o marco A3 (D-18 em docs/plano-construcao.md §7; Art Bible §5.3):
//  - Pátio em low, medium e high, com as camadas do preset, o caçador fora do cone da lanterna e dentro dele, antes
//    (render.hunter_outline em 0) e depois (intensidade padrão) do contorno: 4 por preset;
//  - o mesmo no mockup `?retro=1` (1ª pessoa), fora do cone, antes e depois;
//  - montagens por preset (recorte em volta do caçador: fora antes | fora depois | dentro antes | dentro depois) e do
//    modo retro (antes | depois).
// A cena é a de prova de legibilidade de tools/visual/compare.mjs (LEG e LEG_IN): vista para o noroeste a partir do
// spawn, caçador a 8 m e 40° (fora) ou 8° (dentro) à esquerda da vista, de frente para o jogador.
// Chromium do Playwright com SwiftShader, 1280×720 com deviceScaleFactor 2, semente fixa e relógio parado.
// Uso: node tools/art/a3-capturas.mjs <pasta de saída> [url] [--forma potência,amount --sufixo nome] [--presets a,b]
//   (sem url, sobe packages/server/dist/server.mjs). --forma troca só nesta captura a forma do contorno (o padrão é
//   render.hunter_outline) para comparar opções de arte; --sufixo entra no nome dos arquivos do "depois"
//   (ex.: --forma 1,1.05 --sufixo fraco → a3-contorno-medium-fraco.png, patio-medium-fora-do-cone-fraco.png)
// Pré-requisito: pnpm build.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { decodePng, encodePng } from "../visual/png.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../../", import.meta.url));
const argv = process.argv.slice(2);
const flagArg = (n) => { const i = argv.indexOf(n); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const formaArg = flagArg("--forma"), suffix = flagArg("--sufixo"), presetsArg = flagArg("--presets");
const forma = formaArg ? (([power, amount]) => ({ power, amount }))(formaArg.split(",").map(Number)) : null;
if (forma && (!(forma.power > 0) || !(forma.amount > 0) || !suffix)) { console.error("--forma potência,amount exige números > 0 e --sufixo"); process.exit(2); }
const out = argv[0];
if (!out) { console.error("uso: node tools/art/a3-capturas.mjs <pasta de saída> [url]"); process.exit(2); }
mkdirSync(out, { recursive: true });
const balance = JSON.parse(readFileSync(join(root, "packages/shared/generated/balance.json"), "utf8"));
const SEED = 1234;
/** cena de prova (a mesma de tools/visual/compare.mjs): vista, distância e ângulo do caçador fora e dentro do cone */
const VIEW = { yaw: 0.52, pitch: -0.1 };
const DISTANCE = 8, OUT = 40, IN = 8;
/** recorte das montagens em px de tela (deviceScaleFactor 2), centrado no caçador */
const CROP = [420, 640];
const outline = balance.render.hunter_outline.intensity;

let url = argv[1], server;
if (!url) {
  const port = process.env.A3_PORT ?? "18734";
  url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [join(root, "packages/server/dist/server.mjs")], { env: { ...process.env, PORT: port }, stdio: ["ignore", "ignore", "inherit"] });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(url + "/healthz")).ok) break; } catch { /* subindo */ } await sleep(100); }
}

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const errors = [], files = [];

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, locale: "pt-BR" });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.clock.install({ time: 0 });
  // ganchos de depuração só com ?debug=1 (D-33)
  await page.goto(`${url}/?debug=1&seed=${SEED}&${query}`, { waitUntil: "load" });
  await page.clock.pauseAt(1000);
  await page.click("#go");
  await page.evaluate(() => window.__thehellCharactersReady?.());
  await page.evaluate((f) => window.__thehellRender.setHunterOutlineShape(f), forma);
  return page;
}

/** põe o caçador a `angle`° da vista, desenha com o contorno em `rim` (e o caçador escondido se `hidden`) e captura */
async function shot(page, name, { angle, rim, thirdPerson, hidden = false }) {
  await page.evaluate(([view, d, angle, rim, third, hidden]) => {
    const h = window.__thehellRender, G = window.__thehell(), P = G.survivors[0], H = G.hunter;
    h.setHunterOutline(rim);
    const a = view.yaw + angle * Math.PI / 180;
    H.x = P.x - Math.sin(a) * d; H.z = P.z - Math.cos(a) * d;
    H.a = Math.atan2(P.x - H.x, P.z - H.z);
    H.windup = null;
    h.capture({ ...view, thirdPerson: third }, { hidden: hidden ? ["hunter"] : [] });
  }, [VIEW, DISTANCE, angle, rim, thirdPerson, hidden]);
  const p = join(out, name);
  // SwiftShader numa máquina carregada passa do padrão de 30 s
  await page.screenshot({ path: p, timeout: 180000 });
  if (!hidden) files.push(p);
  return decodePng(readFileSync(p));
}

/** centro da caixa dos pixels em que `a` e `b` diferem (o caçador) */
function center(a, b) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const i = (y * a.width + x) * 4;
    if (Math.abs(a.rgba[i] - b.rgba[i]) + Math.abs(a.rgba[i + 1] - b.rgba[i + 1]) + Math.abs(a.rgba[i + 2] - b.rgba[i + 2]) > 24) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? [a.width >> 1, a.height >> 1] : [(x0 + x1) >> 1, (y0 + y1) >> 1];
}

/** montagem: recortes CROP centrados em `c[i]`, numa linha com 8 px de separação preta */
function montage(name, imgs, centers) {
  const [cw, ch] = CROP, gap = 8, w = imgs.length * cw + (imgs.length - 1) * gap, rgba = new Uint8Array(w * ch * 4);
  imgs.forEach((img, k) => {
    const x0 = Math.max(0, Math.min(img.width - cw, centers[k][0] - (cw >> 1))), y0 = Math.max(0, Math.min(img.height - ch, centers[k][1] - (ch >> 1)));
    for (let y = 0; y < ch; y++) rgba.set(img.rgba.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + cw) * 4), (y * w + k * (cw + gap)) * 4);
  });
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  const p = join(out, name);
  writeFileSync(p, encodePng(w, ch, rgba));
  files.push(p);
}

try {
  for (const preset of presetsArg ? presetsArg.split(",") : Object.keys(balance.render.presets)) {
    const page = await open(`preset=${preset}`);
    const imgs = [], centers = [];
    for (const [pos, angle] of [["fora", OUT], ["dentro", IN]]) {
      const bg = await shot(page, `.fundo-${preset}-${pos}.png`, { angle, rim: 0, thirdPerson: true, hidden: true });
      for (const [when, rim] of [["antes", 0], [suffix ?? "depois", outline]]) {
        const img = await shot(page, `patio-${preset}-${pos}-do-cone-${when}.png`, { angle, rim, thirdPerson: true });
        imgs.push(img); centers.push(center(img, bg));
      }
    }
    // o mesmo recorte para antes e depois (centro do caçador sem o contorno)
    montage(`a3-contorno-${preset}${suffix ? "-" + suffix : ""}.png`, imgs, [centers[0], centers[0], centers[2], centers[2]]);
    await page.close();
  }
  // mockup Retro FPS (D-13 a D-15): 1ª pessoa, caçador fora do cone
  const page = await open("retro=1");
  const bg = await shot(page, ".fundo-retro.png", { angle: OUT, rim: 0, thirdPerson: false, hidden: true });
  const before = await shot(page, "retro-fora-do-cone-antes.png", { angle: OUT, rim: 0, thirdPerson: false });
  const after = await shot(page, `retro-fora-do-cone-${suffix ?? "depois"}.png`, { angle: OUT, rim: outline, thirdPerson: false });
  const c = center(before, bg);
  montage(`a3-contorno-retro${suffix ? "-" + suffix : ""}.png`, [before, after], [c, c]);
  await page.close();
} finally {
  await browser.close();
  server?.kill();
}
for (const f of files) console.log(f);
if (errors.length) { console.error("erros no console:", errors.join(" | ")); process.exit(1); }
