// Prova de que o WASM do recast-navigation funciona no navegador depois do build do Vite (item R2).
// Monta um bundle mínimo com packages/sim/src/nav/recast.ts, abre no Chromium (Playwright), gera o navmesh
// do Pátio e compara os bytes com os gerados em Node por `pnpm data` (packages/shared/generated/navmesh).
// Uso: pnpm data && pnpm maps:browser-check
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const vite = await import(createRequire(root + "packages/client/package.json").resolve("vite"));
const { chromium } = await import("playwright");

const fnv = bytes => { let h = 0x811c9dc5; for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0; return h.toString(16); };
const nodeBin = readFileSync(root + "packages/shared/generated/navmesh/patio.bin");

const dir = mkdtempSync(join(tmpdir(), "recast-browser-"));
writeFileSync(join(dir, "index.html"), `<!doctype html><script type="module" src="./main.js"></script>`);
writeFileSync(join(dir, "main.js"), `
import { initRecast, navParams, RecastNav } from ${JSON.stringify(root + "packages/sim/src/nav/recast.ts")};
import balance from ${JSON.stringify(root + "packages/shared/generated/balance.json")};
import maps from ${JSON.stringify(root + "packages/shared/generated/maps.json")};
const fnv = ${fnv.toString()};
try {
  await initRecast();
  const nav = RecastNav.build(maps.patio, navParams(balance));
  const path = nav.findPath([-3, 26], [-22, -22]);
  window.__result = { ok: path.length > 1, points: path.length, bytes: nav.toBytes().length, hash: fnv(nav.toBytes()) };
} catch (e) { window.__result = { ok: false, error: String(e) }; }
`);
let server, browser, code = 1;
try {
  await vite.build({ root: dir, base: "./", logLevel: "error", build: { outDir: join(dir, "dist"), emptyOutDir: true }, server: { fs: { allow: [root, dir] } } });
  const dist = join(dir, "dist");
  const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" };
  server = createServer((req, res) => {
    try {
      const f = join(dist, req.url === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0]));
      if (!f.startsWith(dist)) throw new Error("fora do dist");
      res.writeHead(200, { "content-type": types[extname(f)] ?? "application/octet-stream" }).end(readFileSync(f));
    } catch { res.writeHead(404).end(); }
  }).listen(0);
  const port = server.address().port;
  const size = readdirSync(join(dist, "assets")).reduce((s, f) => s + statSync(join(dist, "assets", f)).size, 0);
  browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", e => console.error("erro na página:", e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => window.__result, null, { timeout: 30000 });
  const r = await page.evaluate(() => window.__result);
  const same = r.hash === fnv(nodeBin) && r.bytes === nodeBin.length;
  console.log(`navegador: ${JSON.stringify(r)}; Node: ${nodeBin.length} bytes, hash ${fnv(nodeBin)}; bundle de teste ${(size / 1024).toFixed(0)} KiB`);
  code = r.ok && same ? 0 : 1;
  console.log(code ? "FALHOU: WASM do recast no navegador" : "ok: WASM do recast funciona no navegador e gera o mesmo navmesh que em Node");
} finally {
  await browser?.close();
  server?.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
