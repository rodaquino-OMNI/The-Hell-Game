// Gera os personagens (.glb) a partir do pacote CC0 Quaternius Universal Animation Library [Standard]
// e da ficha data/art/personagens.json, expandida por packages/client/src/assets/characters.ts (Art Bible §3, §7; GDD v0.3 §10.3).
// Saída: packages/client/public/models/<id>.glb e personagens.json (manifesto lido pelo cliente e pelo validador).
// Personagem com `variantes` na ficha: o .glb leva a variante `padrao`; as outras são assadas só para medir os
// triângulos (manifesto `variantes`, conferido pelo validador). Escolher outra = trocar `padrao` e rodar de novo.
//
// Uso: pnpm exec tsx tools/assets/build-characters.ts <pasta com UAL1_Standard.glb e UAL1_Standard_RM.glb>
// A pasta de origem é a "Unreal-Godot/" do zip baixado de https://quaternius.itch.io/universal-animation-library
// (não versionada: 7,6 MB por arquivo). Conferência do zip usado: docs/art/personagens-clipes.md.
import { crc32, deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadBalanceFile, loadPaletteFile, loadSheetFile } from "../../packages/shared/src/node.ts";
import { checkArt } from "../../packages/shared/src/index.ts";
import { expandVariants } from "../../packages/client/src/assets/characters.ts";
import { atlasPixels, bakeCharacter, type SourceGlb } from "../../packages/client/src/render/characters/bake.ts";
import { readRenderModels } from "../../packages/client/src/render/characters/budget.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const srcDir = process.argv[2];
if (!srcDir) { console.error("uso: tsx tools/assets/build-characters.ts <pasta Unreal-Godot do UAL>"); process.exit(2); }

function readGlb(file: string): SourceGlb {
  const b = readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: não é glb`);
  const jl = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jl).toString("utf8"));
  const bl = b.readUInt32LE(20 + jl);
  return { json, bin: new Uint8Array(b.buffer, b.byteOffset + 28 + jl, bl) };
}

/** PNG RGBA 8 bits sem entrelaçamento */
function png(px: Uint8Array, w: number, h: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(px.buffer, px.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
}

/** velocidade de deslocamento de cada clipe: translação de `root` entre a primeira e a última chave, na versão _RM */
function nativeSpeeds(rm: SourceGlb): Record<string, number> {
  const J = rm.json, rootIdx = J.nodes.findIndex((n: { name: string }) => n.name === "root");
  const dv = new DataView(rm.bin.buffer, rm.bin.byteOffset);
  const f32 = (acc: number, i: number) => { const a = J.accessors[acc], bv = J.bufferViews[a.bufferView]; return dv.getFloat32((bv.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * 4, true); };
  const out: Record<string, number> = {};
  for (const a of J.animations) {
    const ch = a.channels.find((c: { target: { node: number; path: string } }) => c.target.node === rootIdx && c.target.path === "translation");
    if (!ch) continue;
    const s = a.samplers[ch.sampler], n = J.accessors[s.input].count, dur = f32(s.input, n - 1);
    const dx = f32(s.output, (n - 1) * 3) - f32(s.output, 0), dz = f32(s.output, (n - 1) * 3 + 2) - f32(s.output, 2);
    out[a.name] = dur > 0 ? Math.hypot(dx, dz) / dur : 0;
  }
  return out;
}

const balance = loadBalanceFile(root + "data/balance.yaml");
const models = readRenderModels(balance.render);
const palette = loadPaletteFile(root + "data/art/palette.json");
const sheet = loadSheetFile(root + "data/art/personagens.json");
const artErrors = checkArt(palette, sheet, Object.keys(balance.skins));
if (artErrors.length) { for (const e of artErrors) console.error("ERRO (arte):", e); process.exit(1); }
/** por personagem, a variante padrão primeiro (vai para o .glb) e as outras (só medidas: orçamento no manifesto) */
const VARIANTS = expandVariants(sheet);
const source = readGlb(srcDir + "/UAL1_Standard.glb");
const speeds = nativeSpeeds(readGlb(srcDir + "/UAL1_Standard_RM.glb"));
const atlasPng = png(atlasPixels(palette, models.atlas), models.atlas, models.atlas);

const outDir = root + "packages/client/public/models/";
mkdirSync(outDir, { recursive: true });
const manifest = { $comment: "Gerado por tools/assets/build-characters.ts — não editar à mão.", anim_fps: models.animFps, personagens: [] as object[] };
let fail = false;
for (const [spec, ...others] of VARIANTS) {
  const out = bakeCharacter({ spec, source, palette, animFps: models.animFps, atlasSize: models.atlas, atlasPng, nativeSpeed: speeds });
  const [lo, hi] = spec.tipo === "cacador" ? models.hunterTris : models.survivorTris;
  const inBudget = (n: number) => n >= lo && n <= hi;
  const variantes = [{ id: spec.variante, triangulos: out.triangles }, ...others.map(v => ({ id: v.variante, triangulos: bakeCharacter({ spec: v, source, palette, animFps: models.animFps, atlasSize: models.atlas, atlasPng, nativeSpeed: speeds }).triangles }))];
  const ok = variantes.every(v => inBudget(v.triangulos));
  if (!ok) fail = true;
  writeFileSync(outDir + spec.id + ".glb", out.glb);
  manifest.personagens.push({
    id: spec.id, nome: spec.nome, arquivo: `models/${spec.id}.glb`, tipo: spec.tipo, altura: spec.altura, triangulos: out.triangles, ossos: out.joints,
    ...(spec.variante ? { variante: spec.variante, variantes } : {}),
    ...(out.acessorio ? { acessorio: out.acessorio } : {}), clipes: out.clips,
  });
  const extra = spec.variante ? ` [variante ${variantes.map(v => `${v.id}${v.id === spec.variante ? "*" : ""} ${v.triangulos}`).join(", ")}]` : "";
  console.log(`${ok ? "ok   " : "FORA "} ${spec.id.padEnd(11)} ${String(out.triangles).padStart(5)} triângulos (${lo}–${hi}), ${out.joints} ossos, ${out.clips.length} clipes, ${(out.glb.byteLength / 1024).toFixed(0)} KB${extra}`);
}
writeFileSync(outDir + "personagens.json", JSON.stringify(manifest, null, 1) + "\n");
if (fail) { console.error("FALHA: personagem fora do orçamento de render.models"); process.exit(1); }
