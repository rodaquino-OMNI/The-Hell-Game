// Porta de regressão do simulador (GDD-v0.3 C-15, decisão D-05 a): compara as métricas de cada grupo com a linha de
// base versionada (data/sim/baseline.json) e reprova se alguma PIORAR mais que a tolerância de `sim.regression`
// (data/balance.yaml). As bandas do GDD-v0.2 §7.6 só definem a DIREÇÃO de "piora" das métricas `worse: band`
// (afastar-se da banda); elas não reprovam sozinhas até o beta (D-05). Exceção: `floor` é um PISO ABSOLUTO de aceite
// que reprova independente da linha de base (chase_median ≥ 15 s, GDD-v0.3 §8.5; marco MJ-B), só nos grupos das
// dificuldades de `floor_groups` (o aceite do §8.5 é contra o caçador Normal) e quando a amostra do grupo atual tiver
// ≥ min_samples. Lógica pura, testada em packages/sim/test/sim-regression.test.ts.
import { METRIC_BOUNDS, type GroupMetrics, type MetricName } from "./metrics.ts";

/** regra de uma métrica (`sim.regression.<métrica>` em data/balance.yaml) */
interface RuleBase {
  /** piora máxima absoluta num grupo de uma dificuldade; null = "a medir" (ruído ainda não medível, não compara) */
  max_worsening: number | null;
  /** piora máxima absoluta no agregado "mapa/all" (amostra maior, ruído menor); sem isto vale `max_worsening` */
  pooled_max_worsening?: number | null;
  /** abaixo desta amostra (partidas; chase_median: episódios) a métrica não é comparada */
  min_samples?: number;
}
export type Rule = RuleBase & (
  | { worse: "higher" }
  /**
   * floor: piso absoluto (valor abaixo dele reprova com amostra ≥ min_samples, mesmo sem base ou com tolerância a
   * medir), só nos grupos "mapa/<dificuldade>" com a dificuldade em `floor_groups` (o agregado "mapa/all" não entra)
   */
  | { worse: "lower"; floor?: number; floor_groups?: readonly string[] }
  | { worse: "band"; band: readonly [number, number] }
);
export type Rules = Partial<Record<MetricName, Rule>>;

export type Status = "igual" | "melhora" | "piora tolerada" | "PIORA" | "ABAIXO DO PISO" | "ausente" | "sem base" | "amostra pequena" | "a medir";
/** status que reprovam a porta */
export const FAILING: readonly Status[] = ["PIORA", "ABAIXO DO PISO", "ausente"];

export interface Comparison {
  group: string;
  metric: MetricName;
  before: number | null;
  after: number | null;
  /** quanto piorou na direção da regra (negativo = melhorou); null quando não comparável */
  worsening: number | null;
  tolerance: number | null;
  status: Status;
  /**
   * porta saturada: com a base e a tolerância, a piora do lado de perto não cabe no limite físico da métrica
   * (base ± tolerância passa de 0 ou de 1), então só uma troca de lado da banda (ou nada) reprovaria
   */
  saturated: boolean;
  /** piso absoluto da regra (null = sem piso) */
  floor: number | null;
  /** o piso vigiou este grupo (amostra atual ≥ min_samples) */
  floorActive: boolean;
}

/** linha de base: metadados de geração + métricas por grupo ("mapa/dificuldade") */
export interface Baseline {
  meta: Record<string, unknown>;
  groups: Record<string, Partial<GroupMetrics>>;
}

// Folga de ponto flutuante para a borda da tolerância (técnica, não é número de jogo): piora == tolerância passa.
const EPS = 1e-9;

/** distância de `x` até a banda [lo, hi] (0 dentro dela) */
export function bandDistance(x: number, [lo, hi]: readonly [number, number]): number {
  return Math.max(lo - x, 0, x - hi);
}

/**
 * piora de `before` para `after` na direção da regra (positivo = piorou). Banda: aumento da distância até ela; se o
 * valor passou para o OUTRO lado da banda, a piora é a distância nova inteira (0 → 100% numa banda de 45–55% é
 * piora de 45 p.p., não 0).
 */
export function worsening(rule: Rule, before: number, after: number): number {
  switch (rule.worse) {
    case "higher": return after - before;
    case "lower": return before - after;
    case "band": {
      const [lo, hi] = rule.band;
      if ((before < lo && after > hi) || (before > hi && after < lo)) return bandDistance(after, rule.band);
      return bandDistance(after, rule.band) - bandDistance(before, rule.band);
    }
  }
}

/** a porta está saturada do lado de perto? (ver `Comparison.saturated`) */
export function saturated(metric: MetricName, rule: Rule, before: number, tol: number): boolean {
  const [min, max] = METRIC_BOUNDS[metric];
  const down = before - tol <= min, up = before + tol >= max;
  switch (rule.worse) {
    case "higher": return up;
    case "lower": return down;
    case "band": return before < rule.band[0] ? down : before > rule.band[1] ? up : down && up;
  }
}

/** tamanho da amostra de uma métrica no grupo (chase_median: episódios de perseguição; as outras: partidas) */
function samples(metric: MetricName, m: Partial<GroupMetrics>): number {
  return (metric === "chase_median" ? m.chase_count : m.matches) ?? 0;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** sufixo do grupo agregado de todas as dificuldades de um mapa (tools/sim/run.ts) */
export const POOLED = "/all";

/** piso absoluto da regra no grupo (só `worse: lower`, só nas dificuldades de `floor_groups`); null = sem piso */
export function floorOf(rule: Rule, group: string): number | null {
  if (rule.worse !== "lower" || rule.floor === undefined) return null;
  const difficulty = group.slice(group.lastIndexOf("/") + 1);
  return rule.floor_groups?.includes(difficulty) ? rule.floor : null;
}

/** tolerância da regra para o grupo */
export function toleranceFor(group: string, rule: Rule): number | null {
  return group.endsWith(POOLED) ? (rule.pooled_max_worsening !== undefined ? rule.pooled_max_worsening : rule.max_worsening) : rule.max_worsening;
}

/** compara uma métrica de um grupo */
export function compareMetric(group: string, metric: MetricName, rule: Rule, base: Partial<GroupMetrics> | undefined, cur: Partial<GroupMetrics> | undefined): Comparison {
  const b = base?.[metric], c = cur?.[metric], tol = toleranceFor(group, rule);
  const min = rule.min_samples ?? 1, floor = floorOf(rule, group);
  const floorActive = floor !== null && !!cur && isNum(c) && samples(metric, cur) >= min;
  const row = (status: Status, worse: number | null = null): Comparison => ({
    group, metric, before: isNum(b) ? b : null, after: isNum(c) ? c : null, worsening: worse, tolerance: tol, status,
    saturated: isNum(b) && tol !== null && saturated(metric, rule, b, tol), floor, floorActive,
  });
  // piso absoluto: reprova pelo valor atual, com ou sem linha de base (grupo novo também)
  const belowFloor = floorActive && (c as number) < floor! - EPS;
  if (!base || b === undefined) return row(belowFloor ? "ABAIXO DO PISO" : "sem base");
  // métrica (ou grupo) que existia na linha de base e sumiu do resultado atual: quebra de instrumentação, reprova
  if (!cur || c === undefined || (c !== null && !isNum(c))) return row("ausente");
  if (belowFloor) return row("ABAIXO DO PISO", isNum(b) ? worsening(rule, b, c as number) : null);
  if (b === null || c === null || samples(metric, base) < min || samples(metric, cur) < min) return row(b === null && c !== null ? "sem base" : "amostra pequena");
  if (!isNum(b)) return row("sem base");
  if (tol === null) return row("a medir");
  const w = worsening(rule, b, c);
  if (w > tol + EPS) return row("PIORA", w);
  if (w > EPS) return row("piora tolerada", w);
  if (w < -EPS) return row("melhora", w);
  return row("igual", w);
}

/** compara todos os grupos da linha de base (e os novos do resultado atual) com as regras */
export function compare(baseline: Baseline, current: Record<string, Partial<GroupMetrics>>, rules: Rules): { rows: Comparison[]; failed: boolean } {
  const groups = [...new Set([...Object.keys(baseline.groups), ...Object.keys(current)])].sort();
  const rows: Comparison[] = [];
  for (const g of groups) {
    for (const [metric, rule] of Object.entries(rules) as [MetricName, Rule][]) rows.push(compareMetric(g, metric, rule, baseline.groups[g], current[g]));
  }
  return { rows, failed: rows.some(r => FAILING.includes(r.status)) };
}

const seconds = (m: MetricName) => m.startsWith("duration") || m === "chase_median";
const fraction = (m: MetricName) => METRIC_BOUNDS[m][1] === 1;
const fmt = (v: number | null, metric: MetricName) =>
  v === null ? "—" : seconds(metric) ? `${v.toFixed(1)} s` : fraction(metric) ? `${(100 * v).toFixed(1)}%` : v.toFixed(2);
const fmtDelta = (v: number | null, metric: MetricName) =>
  v === null ? "—" : seconds(metric) ? `${v.toFixed(1)} s` : fraction(metric) ? `${(100 * v).toFixed(1)} p.p.` : v.toFixed(2);

/** linha que efetivamente vigia (comparada e sem saturação, ou com o piso absoluto ativo) */
const active = (r: Comparison) => r.floorActive || (!r.saturated && !["amostra pequena", "sem base", "a medir"].includes(r.status));

/** métricas sem nenhum grupo que vigie de fato (todas saturadas, com amostra pequena ou a medir) */
export function inactiveMetrics(rows: readonly Comparison[]): MetricName[] {
  const all = [...new Set(rows.map(r => r.metric))];
  return all.filter(m => !rows.some(r => r.metric === m && active(r)));
}

/** tabela Markdown "antes/depois" da comparação */
export function comparisonMarkdown(rows: readonly Comparison[]): string {
  const lines = ["| grupo | métrica | antes | depois | piora | tolerância | status | saturada |", "| --- | --- | --- | --- | --- | --- | --- | --- |"];
  for (const r of rows) {
    const tol = (r.tolerance === null ? "a medir" : fmtDelta(r.tolerance, r.metric)) + (r.floor === null ? "" : ` (piso ${fmt(r.floor, r.metric)})`);
    lines.push(`| ${r.group} | ${r.metric} | ${fmt(r.before, r.metric)} | ${fmt(r.after, r.metric)} | ${fmtDelta(r.worsening, r.metric)} | ${tol} | ${r.status} | ${r.saturated ? "sim" : "—"} |`);
  }
  const off = inactiveMetrics(rows);
  if (off.length) lines.push("", `Porta inativa (todos os grupos saturados, com amostra pequena ou a medir): ${off.join(", ")}.`);
  return lines.join("\n");
}

/** campos de `keys` em que o lote atual difere do da linha de base (texto "campo: base ≠ atual"); vazio = mesmo lote */
export function metaMismatch(base: Record<string, unknown>, cur: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.filter(k => JSON.stringify(base[k]) !== JSON.stringify(cur[k])).map(k => `${k}: ${JSON.stringify(base[k])} ≠ ${JSON.stringify(cur[k])}`);
}
