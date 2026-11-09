// Tipos de tools/visual/cost-stats.mjs (usado por packages/client/test/cost-stats.test.ts)
export type CiMode = "warn" | "fail";
export interface CostCheck { pairs: number; frames: number; warmup: number; bootstrap_resamples: number; ci: number; seed: number; ci_runner_margin: number; ci_mode: CiMode; main_delta: number }
export type Verdict = "fail" | "warn" | "pass";
export interface CostResult { ratios: number[]; median: number; lo: number; hi: number; budget: number; fail: number; verdict: Verdict }
export function mulberry32(seed: number): () => number;
export function abbaOrder(i: number): ["A", "B"] | ["B", "A"];
export function median(v: number[]): number;
export function bootstrapCi(values: number[], o: { resamples: number; ci: number; seed: number }): { median: number; lo: number; hi: number };
export function costThresholds(factor: number, margin: number): { budget: number; fail: number };
export function judgeCost(ci: { median: number; lo: number }, factor: number, margin: number): Verdict;
export function costVerdict(a: number[], b: number[], cfg: CostCheck, factor: number): CostResult;
/** D-48: `mode` vem de render.cost_check.ci_mode; string para o teste do modo inválido */
export function costOutcome(c: CostResult, mode: CiMode | string, ctx: { view: string; baseMs: number; ciLevel: number }):
  { failing: boolean; warning: string | null };
export function ghaWarning(title: string, msg: string): string;
/** issue #59 (D-49): comparação com o build de main no mesmo job */
export type Build = "pr" | "main";
export function crossOrder(i: number): [Build, "A" | "B"][];
export function judgeVsMain(ci: { median: number; lo: number }, delta: number): Verdict;
export interface VsMainResult { diffs: number[]; median: number; lo: number; hi: number; delta: number; prMedian: number; mainMedian: number; verdict: Verdict }
export function costVsMain(pr: { a: number[]; b: number[] }, main: { a: number[]; b: number[] }, cfg: CostCheck): VsMainResult;
export function vsMainOutcome(rel: VsMainResult, abs: CostResult, mode: CiMode | string,
  ctx: { view: string; baseMs: number; mainBaseMs: number; ciLevel: number }): { failing: boolean; warnings: string[] };
/** complemento de D-49: desfecho do portão; sem build de main utilizável (`reason`) só avisa, nunca reprova */
export const COST_TITLE: string;
export type CostGateInput = { rel: VsMainResult; abs: CostResult } | { reason: string; abs?: CostResult; rel?: undefined };
export function costGateOutcome(cmp: CostGateInput, mode: CiMode | string,
  ctx: { view: string; baseMs: number; mainBaseMs: number; ciLevel: number }): { failing: boolean; warnings: string[] };
