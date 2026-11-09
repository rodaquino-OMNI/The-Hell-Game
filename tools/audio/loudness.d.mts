// Tipos de tools/audio/loudness.mjs (usado por packages/client/test/audio-loudness.test.ts)
export const AUDIO_EXTENSIONS: string[];
export const REQUIRED_COLUMNS: string[];
export interface LoudnessCfg { loudness_lufs: number; loudness_tolerance: number; true_peak_dbtp: number; music_dir: string }
export interface LoudnessRow {
  file: string; kind: "música" | "efeito" | "desconhecido"; I: number; TP: number; bytes: number; ok: boolean; reasons: string[];
}
export function listFiles(publicDir: string, sub?: string): string[];
export function parseCsv(text: string): { header: string[]; rows: Record<string, string>[] };
export function checkCredits(p: { files: string[]; csv: string; licenses: string[] }): { failures: string[]; checked: number };
export function judgeLoudness(file: string, m: { I: number; TP: number }, cfg: LoudnessCfg): { kind: "música" | "efeito"; ok: boolean; reasons: string[] };
export function runLoudness(p: { publicDir: string; cfg: LoudnessCfg; measure?: (abs: string) => { I: number; TP: number } }): LoudnessRow[];
export function formatTable(rows: LoudnessRow[]): string;
export function loadCfg(balancePath: string): { cfg: LoudnessCfg; licenses: string[] };
