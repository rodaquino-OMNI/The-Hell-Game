#!/usr/bin/env node
// Loudness e créditos dos arquivos de áudio (item A-7 do V5; docs/handoff/plano-audio-v5.md §4; GDD-v0.3 §11, linha
// "Mixagem": "Script com ffmpeg `ebur128` em todos os arquivos de música, na CI").
//
//   node tools/audio/loudness.mjs            mede todo arquivo de packages/client/public/audio/** com ffmpeg
//                                            `ebur128=peak=true` (tools/audio/ebur128.mjs) e imprime a tabela
//                                            arquivo | LUFS integrado | pico real (dBTP) | tamanho | tipo | resultado.
//       música (audio.loudness_check.music_dir/**): reprova fora de audio.loudness_lufs ± audio.loudness_tolerance ou
//       com pico real acima de audio.true_peak_dbtp;
//       efeito (o resto de public/audio): LACUNA, o GDD não define meta de LUFS para efeitos; só o pico real vale.
//       Sem ffmpeg: com CI definido reprova; fora da CI avisa e sai com 0.
//   node tools/audio/loudness.mjs --credits  confere packages/client/public/media/creditos.csv: todo arquivo de
//                                            public/audio/** tem uma linha (coluna `arquivo` = caminho relativo a
//                                            public/), toda linha `audio/...` aponta para um arquivo existente (sem
//                                            crédito órfão), sem linha repetida, colunas preenchidas e licença na
//                                            lista aberta audio.loudness_check.licenses (data/balance.yaml).
// Código de saída ≠ 0 em qualquer reprovação. Valores: data/balance.yaml, seção audio.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hasBinaries, measureLoudness } from "./ebur128.mjs";

const require = createRequire(import.meta.url);

/** extensões tratadas como áudio (formatos que o ffmpeg e os navegadores leem); outra extensão em public/audio reprova */
export const AUDIO_EXTENSIONS = [".mp3", ".ogg", ".opus", ".wav", ".flac", ".m4a", ".aac", ".webm"];
/** colunas do creditos.csv que toda linha de áudio precisa preencher (cabeçalho do arquivo) */
export const REQUIRED_COLUMNS = ["arquivo", "autor", "fonte_url", "licenca", "licenca_url", "data_conferencia"];

/**
 * Arquivos sob `publicDir/sub`, como caminhos relativos a `publicDir` com "/", em ordem; ignora arquivos ocultos.
 * @param {string} publicDir
 * @param {string} [sub]
 * @returns {string[]}
 */
export function listFiles(publicDir, sub = "audio") {
  /** @type {string[]} */
  const out = [];
  /** @param {string} rel */
  const walk = rel => {
    const abs = join(publicDir, rel);
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk(sub);
  return out.sort();
}

/**
 * CSV (RFC 4180: aspas duplas, "" escapado, vírgula e quebra de linha dentro de aspas) em registros pelo cabeçalho.
 * @param {string} text
 * @returns {{ header: string[], rows: Record<string, string>[] }}
 */
export function parseCsv(text) {
  /** @type {string[][]} */
  const lines = [];
  /** @type {string[]} */
  let row = [];
  let field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(f => f !== "")) lines.push(row);
      row = [];
    } else field += c;
  }
  if (quoted) throw new Error("CSV com aspas sem fechar");
  row.push(field);
  if (row.some(f => f !== "")) lines.push(row);
  const header = lines.shift() ?? [];
  const rows = lines.map(l => Object.fromEntries(header.map((h, i) => [h, l[i] ?? ""])));
  return { header, rows };
}

/**
 * Créditos dos arquivos de áudio. `files`: caminhos relativos a public/ (ex.: audio/music/chase.mp3); `csv`: texto do
 * creditos.csv. Só linhas cuja coluna `arquivo` começa com "audio/" são conferidas (models/** é da sessão Visual).
 * @param {{ files: string[], csv: string, licenses: string[] }} p
 * @returns {{ failures: string[], checked: number }}
 */
export function checkCredits({ files, csv, licenses }) {
  /** @type {string[]} */
  const failures = [];
  const { header, rows } = parseCsv(csv);
  const missingCols = REQUIRED_COLUMNS.filter(c => !header.includes(c));
  if (missingCols.length) return { failures: [`creditos.csv sem as colunas: ${missingCols.join(", ")}`], checked: 0 };
  const audioRows = rows.filter(r => r.arquivo.startsWith("audio/"));
  /** @type {Map<string, number>} */
  const count = new Map();
  for (const r of audioRows) count.set(r.arquivo, (count.get(r.arquivo) ?? 0) + 1);
  const fileSet = new Set(files);
  for (const f of files) if (!count.has(f)) failures.push(`${f}: sem crédito em creditos.csv (coluna arquivo = caminho relativo a public/)`);
  for (const [a, n] of count) {
    if (!fileSet.has(a)) failures.push(`${a}: crédito órfão (linha em creditos.csv sem arquivo em public/)`);
    if (n > 1) failures.push(`${a}: ${n} linhas em creditos.csv (esperada 1)`);
  }
  for (const r of audioRows) {
    const empty = REQUIRED_COLUMNS.filter(c => r[c].trim() === "");
    if (empty.length) failures.push(`${r.arquivo}: colunas vazias em creditos.csv: ${empty.join(", ")}`);
    if (r.licenca.trim() !== "" && !licenses.includes(r.licenca)) {
      failures.push(`${r.arquivo}: licença "${r.licenca}" fora da lista aberta audio.loudness_check.licenses (${licenses.join(", ")})`);
    }
    if (r.data_conferencia.trim() !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(r.data_conferencia)) {
      failures.push(`${r.arquivo}: data_conferencia "${r.data_conferencia}" fora do formato AAAA-MM-DD`);
    }
  }
  return { failures, checked: files.length };
}

/**
 * @typedef {{ loudness_lufs: number, loudness_tolerance: number, true_peak_dbtp: number, music_dir: string }} LoudnessCfg
 * @typedef {{ file: string, kind: "música" | "efeito" | "desconhecido", I: number, TP: number, bytes: number, ok: boolean, reasons: string[] }} LoudnessRow
 */

/**
 * Julga uma medição. Música: LUFS na faixa e pico real ≤ teto. Efeito: só o pico real (LACUNA: sem meta de LUFS no GDD).
 * @param {string} file caminho relativo a public/
 * @param {{ I: number, TP: number }} m
 * @param {LoudnessCfg} cfg
 * @returns {{ kind: "música" | "efeito", ok: boolean, reasons: string[] }}
 */
export function judgeLoudness(file, m, cfg) {
  const kind = file.startsWith(cfg.music_dir.replace(/\/?$/, "/")) ? "música" : "efeito";
  /** @type {string[]} */
  const reasons = [];
  if (kind === "música" && !(Math.abs(m.I - cfg.loudness_lufs) <= cfg.loudness_tolerance)) {
    reasons.push(`LUFS ${m.I} fora de ${cfg.loudness_lufs} ± ${cfg.loudness_tolerance}`);
  }
  if (!(m.TP <= cfg.true_peak_dbtp)) reasons.push(`pico real ${m.TP} dBTP acima de ${cfg.true_peak_dbtp}`);
  return { kind, ok: reasons.length === 0, reasons };
}

/**
 * Mede e julga todos os arquivos de `publicDir/audio/**`.
 * @param {{ publicDir: string, cfg: LoudnessCfg, measure?: (abs: string) => { I: number, TP: number } }} p
 * @returns {LoudnessRow[]}
 */
export function runLoudness({ publicDir, cfg, measure = measureLoudness }) {
  return listFiles(publicDir).map(file => {
    const abs = join(publicDir, file);
    const bytes = statSync(abs).size;
    if (!AUDIO_EXTENSIONS.includes(extname(file).toLowerCase())) {
      return { file, kind: /** @type {const} */ ("desconhecido"), I: NaN, TP: NaN, bytes, ok: false, reasons: [`extensão fora de ${AUDIO_EXTENSIONS.join(" ")}`] };
    }
    const m = measure(abs);
    return { file, ...m, bytes, ...judgeLoudness(file, m, cfg) };
  });
}

/** @param {LoudnessRow[]} rows */
export function formatTable(rows) {
  const head = ["arquivo", "LUFS I", "pico real (dBTP)", "tamanho (KiB)", "tipo", "resultado"];
  const fmt = (/** @type {number} */ x) => (Number.isNaN(x) ? "—" : x === -Infinity ? "-inf" : x.toFixed(1));
  const body = rows.map(r => [r.file, fmt(r.I), fmt(r.TP), (r.bytes / 1024).toFixed(1), r.kind, r.ok ? "ok" : "REPROVADO"]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map(b => b[i].length)));
  const line = (/** @type {string[]} */ c) => "| " + c.map((x, i) => (i === 0 || i >= 4 ? x.padEnd(w[i]) : x.padStart(w[i]))).join(" | ") + " |";
  return [line(head), "|" + w.map((n, i) => (i === 0 || i >= 4 ? "-".repeat(n + 2) : "-".repeat(n + 1) + ":")).join("|") + "|", ...body.map(line)].join("\n");
}

/**
 * Configuração a partir de data/balance.yaml (seção audio); confere tipos básicos (o schema completo é o AudioSchema).
 * @param {string} balancePath
 * @returns {{ cfg: LoudnessCfg, licenses: string[] }}
 */
export function loadCfg(balancePath) {
  const { parse } = require("yaml");
  const a = parse(readFileSync(balancePath, "utf8"))?.audio;
  const lc = a?.loudness_check;
  const nums = [a?.loudness_lufs, a?.loudness_tolerance, a?.true_peak_dbtp];
  if (!nums.every(n => typeof n === "number") || typeof lc?.music_dir !== "string" || !Array.isArray(lc?.licenses)) {
    throw new Error(`${balancePath}: faltam audio.loudness_lufs, loudness_tolerance, true_peak_dbtp ou loudness_check.{music_dir, licenses}`);
  }
  return {
    cfg: { loudness_lufs: a.loudness_lufs, loudness_tolerance: a.loudness_tolerance, true_peak_dbtp: a.true_peak_dbtp, music_dir: lc.music_dir },
    licenses: /** @type {string[]} */ (lc.licenses),
  };
}

/** @param {string[]} argv */
function main(argv) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const publicDir = join(root, "packages/client/public");
  const csvPath = join(publicDir, "media/creditos.csv");
  const { cfg, licenses } = loadCfg(join(root, "data/balance.yaml"));

  if (argv.includes("--credits")) {
    const files = listFiles(publicDir);
    const { failures } = checkCredits({ files, csv: readFileSync(csvPath, "utf8"), licenses });
    for (const f of failures) console.error("FALHA: " + f);
    if (failures.length) { process.exitCode = 1; return; }
    console.log(`créditos ok: ${files.length} arquivo(s) de public/audio com linha em media/creditos.csv, sem crédito órfão, licenças em {${licenses.join(", ")}}`);
    return;
  }

  if (!hasBinaries(["ffmpeg"])) {
    if (process.env.CI) {
      console.error("FALHA: ffmpeg ausente no PATH com CI definido (o passo \"Áudio: ffmpeg (stems A-3 e loudness A-7)\" do ci.yml instala com apt-get)");
      process.exitCode = 1;
    } else console.warn("AVISO: ffmpeg ausente no PATH; medição de loudness PULADA (fora da CI). Instale com apt-get install ffmpeg.");
    return;
  }
  const rows = runLoudness({ publicDir, cfg });
  console.log(`música (${cfg.music_dir}/**): ${cfg.loudness_lufs} LUFS ± ${cfg.loudness_tolerance}, pico real ≤ ${cfg.true_peak_dbtp} dBTP; ` +
    `efeitos: só pico real (LACUNA: o GDD-v0.3 §11 não define meta de LUFS para efeitos)`);
  console.log(rows.length ? formatTable(rows) : "nenhum arquivo em public/audio");
  const bad = rows.filter(r => !r.ok);
  for (const r of bad) console.error(`FALHA: ${r.file}: ${r.reasons.join("; ")}`);
  if (bad.length) process.exitCode = 1;
  else console.log(`loudness ok: ${rows.length} arquivo(s)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2));
