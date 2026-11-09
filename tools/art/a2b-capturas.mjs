#!/usr/bin/env node
// Capturas do mini marco de arte A2b (D-13, D-14, D-15 em docs/plano-construcao.md §7; V9 em
// docs/handoff/plano-fases-1-2.md §5): MOCKUP do modo "Retro FPS" com `?retro=1`.
//  - uma vista em 1ª pessoa por classe (5), com a ferramenta na mão e a barra de estado;
//  - Pátio industrial em 3ª e em 1ª pessoa (preset médio);
//  - comparação lado a lado: Pátio atual × Pátio industrial (mesma semente e mesma vista);
//  - barra de estado isolada em pt-BR;
//  - custo de render (renderer.info) da vista em 1ª pessoa com e sem o modo.
// Chromium do Playwright com SwiftShader, 1280×720 com deviceScaleFactor 2, semente fixa e relógio controlado.
// Uso: node tools/art/a2b-capturas.mjs <pasta de saída> [url]   (sem url, sobe packages/server/dist/server.mjs)
// Pré-requisito: pnpm build.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { decodePng, encodePng } from "../visual/png.mjs";
import { startServer } from "../lib/server.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const out = process.argv[2];
if (!out) { console.error("uso: node tools/art/a2b-capturas.mjs <pasta de saída> [url]"); process.exit(2); }
mkdirSync(out, { recursive: true });
const SEED = 1234;
/** classe da ficha → botão do menu (ordem de CLASSES no sim) e classe da partida; Protetor e Batedor (fase 4) só mudam a vista */
const CLASSES = [
  ["curandeiro", 0], ["mecanico", 1], ["atacador", 2], ["protetor", 2], ["batedor", 0],
];
/**
 * vista das capturas (ferramenta, não regra de jogo): jogador em `at`, olhando para `look` (quina do bloco central do
 * Pátio, com muro ao lado e luminárias à vista); data/maps/patio
 */
const SPOT = { at: [-10.5, 9.5], look: [-1, 1], pitch: 0.04 };

let url = process.argv[3], server;
// porta livre (PORT=0) e /healthz só do processo filho deste script (tools/lib/server.mjs)
if (!url) ({ url, child: server } = await startServer());

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const errors = [], files = [], info = {};

/** abre o jogo com `query`, escolhe a classe do menu e põe o jogador na vista; devolve a página */
async function open(query, button) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, locale: "pt-BR" });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.clock.install({ time: 0 });
  await page.goto(`${url}/?debug=1&seed=${SEED}&${query}`, { waitUntil: "load" });
  await page.clock.pauseAt(1000);
  await page.locator("#cls button").nth(button).click();
  await page.click("#go");
  await page.evaluate(() => window.__thehellCharactersReady?.());
  return page;
}

/** põe o jogador na vista, o caçador e os aliados longe, e desenha alguns quadros */
async function frame(page, thirdPerson) {
  await page.evaluate(([spot, third]) => {
    const G = window.__thehell(), P = G.survivors[0];
    [P.x, P.z] = spot.at;
    G.hunter.x = 1000; G.hunter.z = 1000;
    G.survivors.slice(1).forEach((s, k) => { s.x = 26; s.z = -26 + 2 * k; });
    G.gens.forEach((g, k) => { g.n = k % 3; });
    const yaw = Math.atan2(-(spot.look[0] - P.x), -(spot.look[1] - P.z));
    P.a = yaw;
    const v = window.__thehellView ?? null;
    if (v) Object.assign(v, { yaw, pitch: spot.pitch, thirdPerson: third });
    window.__a2bView = { yaw, pitch: spot.pitch, thirdPerson: third };
  }, [SPOT, thirdPerson]);
  await page.clock.runFor(200);
  // a captura usa a mesma vista (sem ?retro a vista do input não está exposta: desenha pelo gancho de render)
  await page.evaluate(() => { window.__thehellRender.capture(window.__a2bView); });
}

const shot = async (page, name, locator) => {
  const p = join(out, name);
  await (locator ? page.locator(locator).screenshot({ path: p }) : page.screenshot({ path: p }));
  files.push(p);
  return p;
};

try {
  for (const [cls, button] of CLASSES) {
    const page = await open(`retro=1&retro_class=${cls}`, button);
    await frame(page, false);
    await shot(page, `1p-${cls}.png`);
    info[`1p-${cls}`] = await page.evaluate(() => window.__thehellRender.info());
    if (cls === "curandeiro") await shot(page, "barra-de-estado-pt-BR.png", "#sb");
    if (cls === "mecanico") {
      await frame(page, true);
      await shot(page, "patio-industrial-3p.png");
      info["industrial-3p"] = await page.evaluate(() => window.__thehellRender.info());
      await frame(page, false);
      await shot(page, "patio-industrial-1p.png");
    }
    await page.close();
  }
  // Pátio atual (sem ?retro) na mesma vista, para a comparação e o custo de referência
  const page = await open("", 1);
  await frame(page, true);
  await shot(page, "patio-atual-3p.png");
  info["atual-3p"] = await page.evaluate(() => window.__thehellRender.info());
  await frame(page, false);
  info["atual-1p"] = await page.evaluate(() => window.__thehellRender.info());
  await page.close();

  // lado a lado: atual × industrial (3ª pessoa), com faixa separadora
  const a = decodePng(readFileSync(join(out, "patio-atual-3p.png"))), b = decodePng(readFileSync(join(out, "patio-industrial-3p.png")));
  const gap = 16, w = a.width + gap + b.width, h = Math.max(a.height, b.height), rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    if (y < a.height) rgba.set(a.rgba.subarray(y * a.width * 4, (y + 1) * a.width * 4), y * w * 4);
    if (y < b.height) rgba.set(b.rgba.subarray(y * b.width * 4, (y + 1) * b.width * 4), (y * w + a.width + gap) * 4);
    for (let x = a.width; x < a.width + gap; x++) rgba.set([0, 0, 0, 255], (y * w + x) * 4);
  }
  const cmp = join(out, "comparacao-patio-atual-x-industrial.png");
  writeFileSync(cmp, encodePng(w, h, rgba));
  files.push(cmp);
} finally {
  await browser.close();
  server?.kill();
}
writeFileSync(join(out, "renderer-info.json"), JSON.stringify(info, null, 1));
console.table(Object.fromEntries(Object.entries(info).map(([k, v]) => [k, { calls: v.calls, triangles: v.triangles, preset: v.preset }])));
for (const f of files) console.log(f);
if (errors.length) { console.error("erros no console:", errors.join(" | ")); process.exit(1); }
