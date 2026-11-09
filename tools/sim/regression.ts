// Porta de regressão do simulador (GDD-v0.3 C-15, decisão D-05 a): compara as métricas de cada grupo com a linha de
// base versionada (data/sim/baseline.json) e reprova se alguma PIORAR mais que a tolerância de `sim.regression`
// (data/balance.yaml). As bandas do GDD-v0.2 §7.6 só definem a DIREÇÃO de "piora" das métricas `worse: band`
// (afastar-se da banda); elas não reprovam sozinhas até o beta (D-05). Lógica pura, testada em
// packages/sim/test/sim-regression.test.ts.
import type { GroupMetrics, MetricName } from "./metrics.ts";

/** regra de uma métrica (`sim.regression.<métrica>` em data/balance.yaml) */
interface RuleBase {
  /** piora máxima absoluta num grupo de uma dificuldade */
  max_worsening: number;
  /** piora máxima absoluta no agregado "mapa/all" (amostra maior, ruído menor); sem isto vale `max_worsening` */
  pooled_max_worsening?: number;
  /** abaixo desta amostra (partidas; chase_median: episódios) a métrica não é comparada */
  min_samples?: number;
}
export type Rule = RuleBase & ({ worse: "higher" | "lower" } | { worse: "band"; band: readonly [number, number] });
export type Rules = Partial<Record<MetricName, Rule>>;

export type Status = "igual" | "melhora" | "piora tolerada" | "PIORA" | "ausente" | "sem base" | "amostra pequena";
/** status que reprovam a porta */
export const FAILING: readonly Status[] = ["PIORA", "ausente"];

export interface Comparison {
  group: string;
  metric: MetricName;
  before: number | null;
  after: number | null;
  /** quanto piorou na direção da regra (negativo = melhorou); null quando não comparável */
  worsening: number | null;
  tolerance: number;
  status: Status;
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

/** piora de `before` para `after` na direção da regra (positivo = piorou) */
export function worsening(rule: Rule, before: number, after: number): number {
  switch (rule.worse) {
    case "higher": return after - before;
    case "lower": return before - after;
    case "band": return bandDistance(after, rule.band) - bandDistance(before, rule.band);
  }
}

/** tamanho da amostra de uma métrica no grupo (chase_median: episódios de perseguição; as outras: partidas) */
function samples(metric: MetricName, m: Partial<GroupMetrics>): number {
  return (metric === "chase_median" ? m.chase_count : m.matches) ?? 0;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** sufixo do grupo agregado de todas as dificuldades de um mapa (tools/sim/run.ts) */
export const POOLED = "/all";

/** tolerância da regra para o grupo */
export function toleranceFor(group: string, rule: Rule): number {
  return group.endsWith(POOLED) ? rule.pooled_max_worsening ?? rule.max_worsening : rule.max_worsening;
}

/** compara uma métrica de um grupo */
export function compareMetric(group: string, metric: MetricName, rule: Rule, base: Partial<GroupMetrics> | undefined, cur: Partial<GroupMetrics> | undefined): Comparison {
  const b = base?.[metric], c = cur?.[metric], tol = toleranceFor(group, rule);
  const row = (status: Status, worse: number | null = null): Comparison => ({
    group, metric, before: isNum(b) ? b : null, after: isNum(c) ? c : null, worsening: worse, tolerance: tol, status,
  });
  if (!base || b === undefined) return row("sem base");
  // métrica (ou grupo) que existia na linha de base e sumiu do resultado atual: quebra de instrumentação, reprova
  if (!cur || c === undefined || (c !== null && !isNum(c))) return row("ausente");
  const min = rule.min_samples ?? 1;
  if (b === null || c === null || samples(metric, base) < min || samples(metric, cur) < min) return row(b === null && c !== null ? "sem base" : "amostra pequena");
  if (!isNum(b)) return row("sem base");
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

const fmt = (v: number | null, metric: MetricName) =>
  v === null ? "—" : metric.startsWith("duration") || metric === "chase_median" ? `${v.toFixed(1)} s` : metric === "captures_per_match" ? v.toFixed(2) : `${(100 * v).toFixed(1)}%`;
const fmtDelta = (v: number | null, metric: MetricName) =>
  v === null ? "—" : metric.startsWith("duration") || metric === "chase_median" ? `${v.toFixed(1)} s` : metric === "captures_per_match" ? v.toFixed(2) : `${(100 * v).toFixed(1)} p.p.`;

/** tabela Markdown "antes/depois" da comparação */
export function comparisonMarkdown(rows: readonly Comparison[]): string {
  const lines = ["| grupo | métrica | antes | depois | piora | tolerância | status |", "| --- | --- | --- | --- | --- | --- | --- |"];
  for (const r of rows) {
    lines.push(`| ${r.group} | ${r.metric} | ${fmt(r.before, r.metric)} | ${fmt(r.after, r.metric)} | ${fmtDelta(r.worsening, r.metric)} | ${fmtDelta(r.tolerance, r.metric)} | ${r.status} |`);
  }
  return lines.join("\n");
}
