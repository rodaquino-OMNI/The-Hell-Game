#!/usr/bin/env node
// Capturas do modo "Retro FPS" construído (V9; D-13, D-14, D-15 em docs/plano-construcao.md §7), depois das respostas
// do filho ao mockup A2b (issue #27: 1b ferramenta menor e no canto, 2c luneta do Batedor, 3b barra fina, 4a Pátio
// industrial). O modo liga pela OPÇÃO DO MENU (localStorage `thehell.options`, como o jogador), não por ?retro=1;
// Protetor e Batedor (fase 4, fora da simulação) só mudam a vista, com ?debug=1&retro_class=.
//  - v9-1p-<classe>.png: 1ª pessoa de cada classe com a ferramenta no canto e a barra fina;
//  - v9-luneta-batedor.png: recorte do canto inferior direito da vista do Batedor (a luneta);
//  - v9-barra-fina-<fonte>.png: faixa de baixo nos 3 tamanhos de fonte, com legendas acima da barra;
//  - v9-patio-industrial-1p.png e -3p.png: o Pátio industrial;
//  - v9-opcoes.png: o menu de opções com a opção "Modo Retro FPS".
// Chromium do Playwright com SwiftShader, 1280×720 com deviceScaleFactor 2, semente fixa e relógio controlado.
// Uso: node tools/art/v9-capturas.mjs <pasta de saída> [url]   (sem url, sobe packages/server/dist/server.mjs)
// Pré-requisito: pnpm build.
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../lib/server.mjs";
import { RULES, SEED, gotoPaused } from "../lib/capture-page.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../../", import.meta.url));
const balance = JSON.parse(readFileSync(join(root, "packages/shared/generated/balance.json"), "utf8"));
const out = process.argv[2];
if (!out) { console.error("uso: node tools/art/v9-capturas.mjs <pasta de saída> [url]"); process.exit(2); }
mkdirSync(out, { recursive: true });
/** classe da ficha → botão do menu (ordem de CLASSES no sim); Protetor e Batedor (fase 4) só mudam a vista */
const CLASSES = [["curandeiro", 0], ["mecanico", 1], ["atacador", 2], ["protetor", 2], ["batedor", 0]];
/** vista das capturas (a mesma do A2b, tools/art/a2b-capturas.mjs): quina do bloco central do Pátio */
const SPOT = { at: [-10.5, 9.5], look: [-1, 1], pitch: 0.04 };
const W = 1280, H = 720;

let url = process.argv[3], server;
if (!url) ({ url, child: server } = await startServer());
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const errors = [], files = [], info = {};

/** abre o jogo com a opção do modo ligada (e `fontSize`), escolhe a classe e começa; devolve a página */
async function open(query, button, fontSize = "normal") {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2, locale: "pt-BR" });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.addInitScript((fs) => localStorage.setItem("thehell.options", JSON.stringify({ retroFps: true, fontSize: fs })), fontSize);
  await gotoPaused(page, `${url}/?debug=1&seed=${SEED}&${RULES}${query ? "&" + query : ""}`);
  await page.locator("#cls button").nth(button).click();
  await page.click("#go");
  await page.evaluate(() => window.__thehellCharactersReady?.());
  if (!(await page.evaluate(() => window.__thehellOptions().retro))) errors.push(`${query}: a opção não ligou o modo`);
  return page;
}

/** põe o jogador na vista, caçador e aliados longe, e desenha a vista pela câmera do jogo */
async function frame(page, thirdPerson) {
  await page.evaluate(([spot, third]) => {
    const G = window.__thehell(), P = G.survivors[0];
    [P.x, P.z] = spot.at;
    G.hunter.x = 1000; G.hunter.z = 1000;
    G.survivors.slice(1).forEach((s, k) => { s.x = 26; s.z = -26 + 2 * k; });
    G.gens.forEach((g, k) => { g.n = k % 3; });
    const yaw = Math.atan2(-(spot.look[0] - P.x), -(spot.look[1] - P.z));
    P.a = yaw;
    Object.assign(window.__thehellView, { yaw, pitch: spot.pitch, thirdPerson: third });
  }, [SPOT, thirdPerson]);
  await page.clock.runFor(200);
  await page.evaluate(() => { window.__thehellRender.capture({ ...window.__thehellView }); });
}

const shot = async (page, name, clip) => {
  const p = join(out, name);
  // máquina carregada: o SwiftShader pode levar mais que os 30 s padrão do Playwright
  await page.screenshot({ path: p, timeout: 180000, ...(clip ? { clip } : {}) });
  files.push(p);
};

try {
  for (const [cls, button] of CLASSES) {
    const page = await open(["protetor", "batedor"].includes(cls) ? `retro_class=${cls}` : "", button);
    await frame(page, false);
    await shot(page, `v9-1p-${cls}.png`);
    info[`1p-${cls}`] = await page.evaluate(() => window.__thehellRender.info());
    if (cls === "batedor") await shot(page, "v9-luneta-batedor.png", { x: W / 2, y: H / 2, width: W / 2, height: H / 2 });
    if (cls === "mecanico") {
      await frame(page, true);
      await shot(page, "v9-patio-industrial-3p.png");
      info["industrial-3p"] = await page.evaluate(() => window.__thehellRender.info());
      await frame(page, false);
      await shot(page, "v9-patio-industrial-1p.png");
    }
    await page.close();
  }
  // barra fina nos 3 tamanhos de fonte, com duas legendas acima (faixa de baixo da tela)
  for (const fs of Object.keys(balance.ui.options.font_scales)) {
    const page = await open("", 0, fs);
    await frame(page, false);
    await page.evaluate(() => { const p = window.__thehell().survivors[0]; window.__thehellCaptions.emit("step_hunter", { x: p.x + 6, z: p.z }); window.__thehellCaptions.emit("rescue"); });
    await page.clock.runFor(100);
    const top = await page.evaluate(() => Math.min(document.getElementById("cap").getBoundingClientRect().top, document.getElementById("sb").getBoundingClientRect().top));
    const y = Math.max(0, Math.floor(top) - 12);
    await shot(page, `v9-barra-fina-${fs}.png`, { x: 0, y, width: W, height: H - y });
    await page.close();
  }
  // menu de opções com a opção do modo
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2, locale: "pt-BR" });
  await page.goto(`${url}/?debug=1&seed=${SEED}`, { waitUntil: "load" });
  await page.click("#op");
  await page.check("#o-retro");
  await page.locator("#os-video").scrollIntoViewIfNeeded();
  const p = join(out, "v9-opcoes.png");
  await page.locator("#os-video").screenshot({ path: p });
  files.push(p);
  await page.close();
} finally {
  await browser.close();
  server?.kill();
}
console.table(Object.fromEntries(Object.entries(info).map(([k, v]) => [k, { calls: v.calls, triangles: v.triangles, preset: v.preset }])));
for (const f of files) console.log(f);
if (errors.length) { console.error("erros no console:", errors.join(" | ")); process.exit(1); }
