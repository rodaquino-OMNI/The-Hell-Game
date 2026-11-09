// Tipos de tools/visual/cost-stats.mjs (usado por packages/client/test/cost-stats.test.ts)
export interface CostCheck { pairs: number; frames: number; warmup: number; bootstrap_resamples: number; ci: number; seed: number }
export type Verdict = "fail" | "warn" | "pass";
export function mulberry32(seed: number): () => number;
export function abbaOrder(i: number): ["A", "B"] | ["B", "A"];
export function median(v: number[]): number;
export function bootstrapCi(values: number[], o: { resamples: number; ci: number; seed: number }): { median: number; lo: number; hi: number };
export function judgeCost(ci: { median: number; lo: number }, factor: number): Verdict;
export function costVerdict(a: number[], b: number[], cfg: CostCheck, factor: number):
  { ratios: number[]; median: number; lo: number; hi: number; verdict: Verdict };
