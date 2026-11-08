#!/usr/bin/env node
// Monta capturas lado a lado numa só PNG (registro de marcos de arte: variantes para o aprovador comparar).
// Cada entrada é reduzida por `--de k` (vizinho mais próximo: desfaz a ampliação inteira das capturas do
// a2-capturas.mjs), cortada numa faixa central de `--largura` px (0 = inteira), opcionalmente deslocada por
// `--dx` px, e todas são postas numa linha com 2 px de separação e ampliadas por `--zoom` (nearest).
// Uso: node tools/art/lado-a-lado.mjs <saida.png> [--de 4] [--largura 0] [--dx 0] [--zoom 1] <a.png> <b.png> ...
import { readFileSync, writeFileSync } from "node:fs";
import { decodePng, encodePng } from "../visual/png.mjs";

const args = process.argv.slice(2);
const out = args.shift();
const opt = { de: 1, largura: 0, dx: 0, zoom: 1 };
const files = [];
while (args.length) {
  const a = args.shift();
  if (a.startsWith("--")) opt[a.slice(2)] = Number(args.shift());
  else files.push(a);
}
if (!out || !files.length) { console.error("uso: node tools/art/lado-a-lado.mjs <saida.png> [--de k] [--largura w] [--dx d] [--zoom z] <png>..."); process.exit(2); }

const GAP = 2, SEP = [255, 255, 255, 255];
const parts = files.map(f => {
  const img = decodePng(readFileSync(f));
  const w = Math.floor(img.width / opt.de), h = Math.floor(img.height / opt.de);
  const cw = opt.largura > 0 ? Math.min(opt.largura, w) : w, x0 = Math.max(0, Math.min(w - cw, ((w - cw) >> 1) + opt.dx));
  const rgba = new Uint8Array(cw * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < cw; x++) {
    const s = ((y * opt.de) * img.width + (x0 + x) * opt.de) * 4;
    rgba.set(img.rgba.subarray(s, s + 4), (y * cw + x) * 4);
  }
  return { width: cw, height: h, rgba };
});
const H = Math.max(...parts.map(p => p.height)), W = parts.reduce((n, p) => n + p.width, 0) + GAP * (parts.length - 1);
const z = opt.zoom, OW = W * z, OH = H * z, o = new Uint8Array(OW * OH * 4);
for (let i = 0; i < o.length; i += 4) o.set(SEP, i);
let ox = 0;
for (const p of parts) {
  for (let y = 0; y < p.height * z; y++) for (let x = 0; x < p.width * z; x++) {
    const s = (((y / z) | 0) * p.width + ((x / z) | 0)) * 4;
    o.set(p.rgba.subarray(s, s + 4), (y * OW + ox * z + x) * 4);
  }
  ox += p.width + GAP;
}
writeFileSync(out, encodePng(OW, OH, o));
console.log(`${out}: ${OW}×${OH}, ${files.length} painéis`);
