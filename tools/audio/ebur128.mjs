// Medição de loudness com o filtro `ebur128=peak=true` do ffmpeg (EBU R 128 / ITU-R BS.1770; GDD-v0.3 §11: música a
// audio.loudness_lufs ± audio.loudness_tolerance, pico real ≤ audio.true_peak_dbtp). Um só lugar para a medição, usado
// por tools/audio/compose.ts (masterização, A-3), tools/audio/loudness.mjs (CI, A-7) e
// packages/client/test/audio-stems.test.ts. O resumo do filtro sai em stderr, depois de "Summary:".
import { spawnSync } from "node:child_process";

/**
 * true se todos os binários (padrão: só `ffmpeg`) respondem a `-version` no PATH
 * @param {string[]} [names]
 */
export function hasBinaries(names = ["ffmpeg"]) {
  return names.every(b => spawnSync(b, ["-version"]).status === 0);
}

/**
 * Loudness integrado (LUFS) e pico real (dBTP) de um arquivo. Silêncio total dá −Infinity no I e/ou no TP (o ffmpeg
 * imprime "-inf"); quem chama decide se isso é erro.
 * @param {string} file
 * @returns {{ I: number, TP: number }}
 */
export function measureLoudness(file) {
  const r = spawnSync("ffmpeg", ["-nostats", "-hide_banner", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`ffmpeg ebur128 falhou em ${file}: ${r.stderr}`);
  const err = r.stderr;
  const summary = err.slice(err.lastIndexOf("Summary:"));
  /** @param {string | undefined} s */
  const num = s => (s === "-inf" ? -Infinity : Number(s));
  const I = num(/I:\s+(-?[\d.]+|-inf)\s+LUFS/.exec(summary)?.[1]);
  const TP = num(/True peak:\s+Peak:\s+(-?[\d.]+|-inf)\s+dBFS/.exec(summary)?.[1]);
  if (Number.isNaN(I) || Number.isNaN(TP)) throw new Error(`resumo do ebur128 ilegível em ${file}:\n${summary}`);
  return { I, TP };
}
