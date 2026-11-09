// Métricas de balanceamento do simulador por grupo (mapa × dificuldade), GDD-v0.2 §7.6 e GDD-v0.3 C-15 / D-16.
// Lógica pura (sem E/S): recebe as partidas já jogadas e devolve números agregados. Usada por tools/sim/run.ts.
import type { HeadlessResult } from "../../packages/sim/src/index.ts";

/** partida do simulador como run.ts a registra (exceção vira linha com `error`) */
export interface MatchRow extends Omit<HeadlessResult, "stuck"> {
  stuck: boolean;
  stuckWorst: number;
  dither: number;
  failAt: HeadlessResult["stuck"]["failAt"];
  error?: string;
}

/** métricas que a porta de regressão sabe comparar (seção `sim.regression` de data/balance.yaml) */
export const METRICS = [
  "hunter_win", "survivor_escape", "duration_mean", "duration_median", "captures_per_match", "short_match_rate", "chase_median",
] as const;
export type MetricName = (typeof METRICS)[number];

export interface GroupMetrics {
  matches: number;
  // ---- falhas duras (T-03 e grafo do §8.2): qualquer valor > 0 reprova ----
  errors: number;
  stuck: number;
  /** partidas que chegaram ao limite de passos sem evento de fim */
  unfinished: number;
  invalid_transitions: string[];
  // ---- §7.6 (com D-16: a meta é hunter_win; survivor_escape só é medida) ----
  /** vitória do caçador por partida (0..1) */
  hunter_win: number;
  /** taxa de fuga por sobrevivente: escapados / vagas de sobrevivente (0..1) */
  survivor_escape: number;
  duration_mean: number;
  duration_median: number;
  captures_per_match: number;
  /** partidas encerradas antes de `sim.short_match_seconds` (0..1) */
  short_match_rate: number;
  /** mediana (s) dos episódios de perseguição que terminaram em captura; null sem episódios (só com hunter_brain utility) */
  chase_median: number | null;
  chase_count: number;
  /** fração das vagas de sobrevivente por classe (com bots: a distribuição sorteada) */
  class_use: Record<string, number>;
  /** taxa de fuga por classe (informativo) */
  class_escape: Record<string, number>;
  /** classe do sobrevivente 0 (sorteada pela semente), fração das partidas */
  first_class: Record<string, number>;
  end_reasons: Record<string, number>;
}

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const share = (counts: Record<string, number>, total: number) =>
  Object.fromEntries(Object.entries(counts).sort().map(([k, v]) => [k, total ? v / total : 0]));

/**
 * Agrega as partidas de um grupo. `isValid(from, to)` diz se a transição está no grafo do §8.2.
 * Partidas com exceção só contam em `errors` (as outras métricas usam as partidas sem exceção).
 */
export function groupMetrics(rows: readonly MatchRow[], shortMatchSeconds: number, isValid: (from: string, to: string) => boolean): GroupMetrics {
  const ok = rows.filter(r => !r.error), n = ok.length;
  const mean = (f: (r: MatchRow) => number) => (n ? ok.reduce((s, r) => s + f(r), 0) / n : 0);
  const trans = new Set<string>();
  for (const r of ok) for (const k of Object.keys(r.transitions)) trans.add(k);
  const invalid = [...trans].filter(k => { const [a, b] = k.split(">"); return !isValid(a, b); }).sort();
  const reasons: Record<string, number> = {}, slots: Record<string, number> = {}, out: Record<string, number> = {}, first: Record<string, number> = {};
  let seats = 0, escaped = 0;
  for (const r of ok) {
    const k = r.reason ?? "sem_fim";
    reasons[k] = (reasons[k] ?? 0) + 1;
    if (r.survivors[0]) first[r.survivors[0].cls] = (first[r.survivors[0].cls] ?? 0) + 1;
    for (const s of r.survivors) {
      seats++; slots[s.cls] = (slots[s.cls] ?? 0) + 1;
      if (s.st === "out") { escaped++; out[s.cls] = (out[s.cls] ?? 0) + 1; }
    }
  }
  const chases = ok.flatMap(r => r.chases);
  return {
    matches: rows.length,
    errors: rows.length - n,
    stuck: ok.filter(r => r.stuck).length,
    unfinished: ok.filter(r => r.reason === null).length,
    invalid_transitions: invalid,
    hunter_win: mean(r => (r.team === "hunter" ? 1 : 0)),
    survivor_escape: seats ? escaped / seats : 0,
    duration_mean: mean(r => r.time),
    duration_median: median(ok.map(r => r.time)) ?? 0,
    captures_per_match: mean(r => r.captures),
    short_match_rate: mean(r => (r.time < shortMatchSeconds ? 1 : 0)),
    chase_median: median(chases),
    chase_count: chases.length,
    class_use: share(slots, seats),
    class_escape: Object.fromEntries(Object.keys(slots).sort().map(c => [c, (out[c] ?? 0) / slots[c]])),
    first_class: share(first, n),
    end_reasons: Object.fromEntries(Object.entries(reasons).sort()),
  };
}

/** falhas duras de um grupo (texto para o relatório); vazio = nenhuma */
export function hardFailures(m: GroupMetrics): string[] {
  const f: string[] = [];
  if (m.errors) f.push(`${m.errors} exceção(ões)`);
  if (m.stuck) f.push(`${m.stuck} trava(s) T-03`);
  if (m.unfinished) f.push(`${m.unfinished} partida(s) sem fim`);
  if (m.invalid_transitions.length) f.push(`transições fora do grafo do §8.2: ${m.invalid_transitions.join(", ")}`);
  return f;
}
