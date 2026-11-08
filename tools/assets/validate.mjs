#!/usr/bin/env node
// Validação dos modelos (GDD v0.3 §10.3 e §9.4; Art Bible §7). Para cada .glb em packages/client/public/models/:
//  1. Khronos glTF-Validator (npm gltf-validator): zero erros;
//  2. triângulos do personagem montado (corpo-base + peças, tudo no .glb) dentro de render.models
//     (survivor_tris ou hunter_tris, conforme extras.thehell.tipo), lido de data/balance.yaml;
//  3. exatamente os 9 clipes da Art Bible §7, amostrados a render.anim_fps com interpolação STEP;
//  4. atlas PNG de render.models.atlas × render.models.atlas com filtro nearest;
//  5. linha do arquivo em packages/client/public/media/creditos.csv (licença registrada);
//  6. manifesto personagens.json coerente com os arquivos;
//  7. ficha data/art/personagens.json (V3): todo personagem da ficha tem .glb com o mesmo tipo e altura, e o
//     sobrevivente com o acessório de skin (uma caixa, 12 triângulos) continua dentro do orçamento;
//  8. variantes de arte (ficha `variantes`, A2-ajuste): o .glb leva a variante padrão da ficha e TODAS as variantes
//     (manifesto `variantes`, medidas pelo bake) cabem no orçamento, com o acessório de skin.
// Uso: node tools/assets/validate.mjs   (sai com código 1 em qualquer falha)
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import validator from "gltf-validator";

const root = fileURLToPath(new URL("../../", import.meta.url));
const modelsDir = root + "packages/client/public/models/";
// nomes dos clipes: Art Bible §7 / GDD v0.3 §10.3 (A-02)
const CLIPS = ["idle", "andar", "correr", "interagir", "ferido", "preso", "golpe", "dash", "atordoado"];
const NEAREST = 9728;

const balance = parse(readFileSync(root + "data/balance.yaml", "utf8"));
const models = balance?.render?.models, fps = balance?.render?.anim_fps;
if (!models?.survivor_tris || !models?.hunter_tris || !models?.atlas || !fps) {
  console.error("FALHA: data/balance.yaml sem render.models.{survivor_tris, hunter_tris, atlas} ou render.anim_fps");
  process.exit(1);
}
const budget = { sobrevivente: models.survivor_tris, cacador: models.hunter_tris };

/** linhas do creditos.csv (primeira coluna = arquivo, relativo a public/) */
function credits() {
  const lines = readFileSync(root + "packages/client/public/media/creditos.csv", "utf8").split(/\r?\n/).filter(Boolean);
  const head = lines.shift().split(",");
  if (head[0] !== "arquivo" || !head.includes("licenca")) throw new Error("creditos.csv sem cabeçalho arquivo,...,licenca,...");
  return new Set(lines.map(l => l.split(",")[0]));
}

function readGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("não é glb");
  const jl = buf.readUInt32LE(12);
  return { json: JSON.parse(buf.subarray(20, 20 + jl).toString("utf8")), bin: buf.subarray(28 + jl, 28 + jl + buf.readUInt32LE(20 + jl)) };
}

function readTimes({ json, bin }, index) {
  const a = json.accessors[index], bv = json.bufferViews[a.bufferView];
  const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return Array.from({ length: a.count }, (_, i) => bin.readFloatLE(off + i * 4));
}

const failures = [];
const fail = (file, msg) => failures.push(`${file}: ${msg}`);
const credited = credits();
const files = readdirSync(modelsDir).filter(f => f.endsWith(".glb")).sort();
if (!files.length) fail("models/", "nenhum .glb encontrado");
const manifest = JSON.parse(readFileSync(modelsDir + "personagens.json", "utf8"));
const sheet = JSON.parse(readFileSync(root + "data/art/personagens.json", "utf8"));
/** triângulos do acessório de skin: uma caixa (geometry.ts `box`, 12 triângulos) se alguma skin tiver acessório */
const SKIN_BOX_TRIS = 12;
const skinTris = Object.values(sheet.skins?.lista ?? {}).some(s => s.acessorio) ? SKIN_BOX_TRIS : 0;
const rows = [];

for (const f of files) {
  const buf = readFileSync(modelsDir + f);
  const report = await validator.validateBytes(new Uint8Array(buf), { uri: f, maxIssues: 0 });
  const { numErrors, numWarnings, numInfos, messages } = report.issues;
  for (const m of messages.filter(m => m.severity <= 1)) console.log(`  ${f} ${m.severity === 0 ? "ERRO" : "aviso"} ${m.code} ${m.pointer ?? ""} ${m.message}`);
  if (numErrors) fail(f, `${numErrors} erro(s) no glTF-Validator`);

  const g = readGlb(buf), J = g.json;
  const tipo = J.extras?.thehell?.tipo;
  if (!budget[tipo]) { fail(f, `extras.thehell.tipo inválido: ${tipo}`); continue; }
  let tris = 0;
  for (const m of J.meshes ?? []) for (const p of m.primitives) {
    if ((p.mode ?? 4) !== 4) { fail(f, "primitiva que não é TRIANGLES"); continue; }
    tris += (p.indices != null ? J.accessors[p.indices].count : J.accessors[p.attributes.POSITION].count) / 3;
  }
  const [lo, hi] = budget[tipo];
  if (tris < lo || tris > hi) fail(f, `${tris} triângulos fora de ${lo}–${hi} (render.models)`);
  const spec = sheet.personagens.find(p => p.id === J.extras?.thehell?.id);
  if (!spec) fail(f, `personagem '${J.extras?.thehell?.id}' fora de data/art/personagens.json`);
  else if (spec.tipo !== tipo || Math.abs(spec.altura - J.extras.thehell.altura) > 1e-6) fail(f, "tipo ou altura diferente da ficha data/art/personagens.json (rode tools/assets/build-characters.ts)");
  if (tipo === "sobrevivente" && tris + skinTris > hi) fail(f, `${tris} + ${skinTris} do acessório de skin passa de ${hi} (render.models)`);

  const names = (J.animations ?? []).map(a => a.name);
  const missing = CLIPS.filter(c => !names.includes(c)), extra = names.filter(n => !CLIPS.includes(n));
  if (missing.length || extra.length) fail(f, `clipes: faltam [${missing}] sobram [${extra}]`);
  for (const a of J.animations ?? []) {
    if (a.samplers.some(s => s.interpolation !== "STEP")) fail(f, `clipe ${a.name}: interpolação diferente de STEP`);
    const t = readTimes(g, a.samplers[0].input);
    if (t.some((v, i) => Math.abs(v - i / fps) > 1e-4)) fail(f, `clipe ${a.name}: chaves fora da grade de ${fps} FPS`);
  }

  for (const s of J.samplers ?? []) if (s.magFilter !== NEAREST || s.minFilter !== NEAREST) fail(f, "textura sem filtro nearest");
  for (const im of J.images ?? []) {
    const bv = J.bufferViews[im.bufferView], png = g.bin.subarray(bv.byteOffset ?? 0);
    const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
    if (im.mimeType !== "image/png" || w !== models.atlas || h !== models.atlas) fail(f, `atlas ${w}×${h} (esperado ${models.atlas}×${models.atlas} PNG)`);
  }

  if (!credited.has("models/" + f)) fail(f, "sem linha em packages/client/public/media/creditos.csv");
  const man = manifest.personagens.find(p => p.arquivo === "models/" + f);
  if (!man) fail(f, "fora do manifesto personagens.json");
  else if (man.triangulos !== tris || man.tipo !== tipo) fail(f, "manifesto personagens.json desatualizado (rode tools/assets/build-characters.ts)");
  if (spec?.variantes) {
    const v = J.extras?.thehell?.variante;
    if (v !== spec.variantes.padrao) fail(f, `variante assada '${v}' diferente da padrão da ficha '${spec.variantes.padrao}' (rode tools/assets/build-characters.ts)`);
    const listed = (man?.variantes ?? []).map(x => x.id).sort(), want = Object.keys(spec.variantes.lista).sort();
    if (listed.join() !== want.join()) fail(f, `manifesto com variantes [${listed}] diferentes da ficha [${want}] (rode tools/assets/build-characters.ts)`);
    for (const x of man?.variantes ?? []) {
      const n = x.triangulos + (tipo === "sobrevivente" ? skinTris : 0);
      if (x.id === v && x.triangulos !== tris) fail(f, `variante ${x.id}: manifesto diz ${x.triangulos} triângulos, o .glb tem ${tris}`);
      if (x.triangulos < lo || n > hi) fail(f, `variante ${x.id}: ${x.triangulos} (+${tipo === "sobrevivente" ? skinTris : 0} da skin) fora de ${lo}–${hi} (render.models)`);
      rows.push({ arquivo: `${f} [${x.id}${x.id === v ? ", padrão" : ""}]`, tipo, triangulos: x.triangulos, "+skin": tipo === "sobrevivente" ? skinTris : 0, orcamento: `${lo}–${hi}` });
    }
  }
  const derived = (J.animations ?? []).filter(a => a.extras?.derivado).map(a => a.name);
  rows.push({ arquivo: f, tipo, triangulos: tris, "+skin": tipo === "sobrevivente" ? skinTris : 0, orcamento: `${lo}–${hi}`, clipes: names.length, derivados: derived.join(" ") || "-", erros: numErrors, avisos: numWarnings, infos: numInfos, KB: Math.round(buf.length / 1024) });
}
for (const p of manifest.personagens) {
  if (!files.includes(p.arquivo.replace(/^models\//, ""))) fail(p.arquivo, "no manifesto mas sem arquivo");
  if (p.tipo === "sobrevivente" && !p.acessorio) fail(p.arquivo, "manifesto sem ponto de acessório de skin (rode tools/assets/build-characters.ts)");
}
for (const c of sheet.personagens) if (!files.includes(c.id + ".glb")) fail(c.id, "personagem da ficha data/art/personagens.json sem .glb");

console.table(rows);
if (failures.length) { for (const m of failures) console.error("FALHA:", m); process.exit(1); }
console.log(`assets ok: ${files.length} modelo(s), glTF-Validator ${validator.version()} sem erros, orçamento e clipes dentro de data/balance.yaml (render)`);
