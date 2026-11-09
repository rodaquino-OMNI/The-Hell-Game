#!/usr/bin/env node
// Capturas do marco R7-mapas no render (D-23 pilares e D-25 saída lateral; GDD-v0.2 §9.1, GDD-v0.3 §9.3):
//  - portão lateral oeste visto de dentro do Pátio (3ª e 1ª pessoa, de frente e em diagonal: parede e giro);
//  - pilares de loop curto perto de (−10, 0) e (10, 0).
// As flags `maps.v1.short_loop_pillars` e `maps.v1.side_exit` ficam desligadas nos dados; aqui são ligadas só nesta
// página pelo parâmetro de depuração `?map_flags=` (aceito só com `?debug=1`, packages/client/src/data.ts), com
// `?ruleset=v1`. A semente escolhe o layout (GDD-v0.3 §9.3): SEED sorteia a saída 1, a substituída pela lateral; o
// script confere `arena.exitX` antes de capturar.
// Chromium do Playwright com SwiftShader, 1280×720 com deviceScaleFactor 2, relógio parado, preset medium.
// Uso: node tools/art/r7-capturas.mjs <pasta de saída> [url]   (sem url, sobe packages/server/dist/server.mjs)
// Pré-requisito: pnpm build.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("../../", import.meta.url));
const out = process.argv[2];
if (!out) { console.error("uso: node tools/art/r7-capturas.mjs <pasta de saída> [url]"); process.exit(2); }
mkdirSync(out, { recursive: true });
/** semente cuja partida v1 com as flags sorteia a saída lateral (layout exit 1; conferido abaixo) */
const SEED = 1234;
const QUERY = `debug=1&ruleset=v1&map_flags=short_loop_pillars,side_exit&seed=${SEED}&preset=medium`;
const W = Math.PI / 2;
/** cenas: posição do jogador (x, z) e vista (yaw: 0 = norte, π/2 = oeste, π = sul) */
const SHOTS = [
  { name: "r7-portao-oeste-3p.png", at: [-20, -10], view: { yaw: W, pitch: -0.05, thirdPerson: true } },
  { name: "r7-portao-oeste-1p.png", at: [-21, -10], view: { yaw: W, pitch: -0.05, thirdPerson: false } },
  { name: "r7-portao-oeste-diagonal.png", at: [-18, -3], view: { yaw: 0.96, pitch: -0.1, thirdPerson: true } },
  { name: "r7-pilar-oeste.png", at: [-10, 7], view: { yaw: 0, pitch: -0.15, thirdPerson: true } },
  { name: "r7-pilar-leste.png", at: [10, -7], view: { yaw: Math.PI, pitch: -0.15, thirdPerson: true } },
];

let url = process.argv[3], server;
if (!url) {
  const port = process.env.R7_PORT ?? "18736";
  url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [join(root, "packages/server/dist/server.mjs")], { env: { ...process.env, PORT: port }, stdio: ["ignore", "ignore", "inherit"] });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(url + "/healthz")).ok) break; } catch { /* subindo */ } await sleep(100); }
}

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const errors = [], files = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, locale: "pt-BR" });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.clock.install({ time: 0 });
  await page.goto(`${url}/?${QUERY}`, { waitUntil: "load" });
  await page.clock.pauseAt(1000);
  await page.click("#go");
  await page.evaluate(() => window.__thehellCharactersReady?.());
  const arena = await page.evaluate(() => window.__thehell().arena);
  if (arena.exitX === undefined || arena.gateFacing.x !== -1) throw new Error(`semente ${SEED} não sorteou a saída lateral oeste: ${JSON.stringify(arena)}`);
  console.log("arena:", JSON.stringify({ gate: arena.gate, exitX: arena.exitX, gateFacing: arena.gateFacing, walls: arena.walls?.length }));
  for (const s of SHOTS) {
    await page.evaluate(([s]) => {
      const h = window.__thehellRender, G = window.__thehell(), P = G.survivors[0];
      P.x = s.at[0]; P.z = s.at[1];
      // caçador longe das vistas (canto sudeste), parado
      G.hunter.x = 26; G.hunter.z = 26; G.hunter.windup = null;
      h.capture(s.view);
    }, [s]);
    const p = join(out, s.name);
    await page.screenshot({ path: p, timeout: 180000 });
    files.push(p);
  }
  await page.close();
} finally {
  await browser.close();
  server?.kill();
}
for (const f of files) console.log(f);
if (errors.length) { console.error("erros no console:", errors.join(" | ")); process.exit(1); }
