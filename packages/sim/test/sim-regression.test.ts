// Porta de regressão do simulador (item R5; GDD-v0.3 C-15, D-05 a): lógica pura de tools/sim/regression.ts e
// tools/sim/metrics.ts. As ferramentas ficam fora do projeto TypeScript de packages/sim, por isso o import é dinâmico
// (mesmo padrão de packages/client/test/atlas-glb.test.ts) com os tipos mínimos declarados aqui.
import { describe, expect, it } from "vitest";
import { loadBalanceFile } from "../../shared/src/node.ts";
import { chaseEpisodes, makeConfig, playHeadless } from "../src/index.ts";
import { aiCfg, b, map } from "./ai-helpers.ts";

type Rule = { worse: "higher" | "lower" | "band"; band?: [number, number]; max_worsening: number | null; pooled_max_worsening?: number | null; min_samples?: number };
type Metrics = Record<string, unknown>;
interface Comparison { group: string; metric: string; before: number | null; after: number | null; worsening: number | null; tolerance: number | null; status: string; saturated: boolean }
interface RegressionModule {
  bandDistance(x: number, band: [number, number]): number;
  worsening(rule: Rule, before: number, after: number): number;
  toleranceFor(group: string, rule: Rule): number | null;
  saturated(metric: string, rule: Rule, before: number, tol: number): boolean;
  inactiveMetrics(rows: Comparison[]): string[];
  metaMismatch(base: Record<string, unknown>, cur: Record<string, unknown>, keys: string[]): string[];
  compareMetric(group: string, metric: string, rule: Rule, base: Metrics | undefined, cur: Metrics | undefined): Comparison;
  compare(baseline: { meta: object; groups: Record<string, Metrics> }, current: Record<string, Metrics>, rules: Record<string, Rule>): { rows: Comparison[]; failed: boolean };
  comparisonMarkdown(rows: Comparison[]): string;
}
interface Row {
  seed: number; time: number; team: string | null; reason: string | null; escaped: number; captures: number; transitions: Record<string, number>;
  replans: number; layout: string; chases: number[]; survivors: { cls: string; st: string; captures: number }[];
  stuck: boolean; stuckWorst: number; dither: number; failAt: null; error?: string;
}
interface MetricsModule {
  median(xs: number[]): number | null;
  groupMetrics(rows: Row[], short: number, isValid: (a: string, b: string) => boolean): Record<string, unknown> & { chase_median: number | null };
  hardFailures(m: Record<string, unknown>): string[];
}
const root = new URL("../../../", import.meta.url);
const R = (await import(new URL("tools/sim/regression.ts", root).href)) as RegressionModule;
const M = (await import(new URL("tools/sim/metrics.ts", root).href)) as MetricsModule;

const higher: Rule = { worse: "higher", max_worsening: 0.1 };
const lower: Rule = { worse: "lower", max_worsening: 5, min_samples: 3 };
const band: Rule = { worse: "band", band: [0.45, 0.55], max_worsening: 0.05, pooled_max_worsening: 0.02 };
const g = (m: Metrics) => ({ matches: 50, chase_count: 10, ...m });

describe("direção de piora", () => {
  it("higher: subir piora, descer melhora", () => {
    expect(R.worsening(higher, 0.2, 0.3)).toBeCloseTo(0.1);
    expect(R.worsening(higher, 0.3, 0.2)).toBeCloseTo(-0.1);
  });
  it("lower: descer piora", () => {
    expect(R.worsening(lower, 20, 12)).toBe(8);
    expect(R.worsening(lower, 12, 20)).toBe(-8);
  });
  it("band: afastar-se da banda piora, de qualquer lado; andar dentro dela é neutro", () => {
    expect(R.bandDistance(0.5, [0.45, 0.55])).toBe(0);
    expect(R.bandDistance(0.3, [0.45, 0.55])).toBeCloseTo(0.15);
    expect(R.bandDistance(0.7, [0.45, 0.55])).toBeCloseTo(0.15);
    expect(R.worsening(band, 0, 0.1)).toBeCloseTo(-0.1); // de 0% para 10%: aproxima da banda
    expect(R.worsening(band, 0.5, 0.8)).toBeCloseTo(0.25); // passa da banda por cima
    expect(R.worsening(band, 0.46, 0.54)).toBe(0);
  });
  it("band: passar para o outro lado da banda conta a distância nova inteira", () => {
    expect(R.worsening(band, 0.3, 0.7)).toBeCloseTo(0.15); // mesma distância, mas do outro lado
    expect(R.worsening(band, 0, 1)).toBeCloseTo(0.45); // caçador invencível
    expect(R.worsening(band, 0.7, 0.3)).toBeCloseTo(0.15);
    expect(R.worsening(band, 0.3, 0.56)).toBeCloseTo(0.01);
    expect(R.compareMetric("p/normal", "hunter_win", band, g({ hunter_win: 0 }), g({ hunter_win: 1 })).status).toBe("PIORA");
    expect(R.compareMetric("p/normal", "hunter_win", band, g({ hunter_win: 0.3 }), g({ hunter_win: 0.7 })).status).toBe("PIORA");
    expect(R.compareMetric("p/normal", "hunter_win", band, g({ hunter_win: 0.3 }), g({ hunter_win: 0.56 })).status).toBe("piora tolerada");
  });
});

describe("comparação de uma métrica", () => {
  it("piora além da tolerância reprova; melhora e igual passam", () => {
    expect(R.compareMetric("p/normal", "short_match_rate", higher, g({ short_match_rate: 0.5 }), g({ short_match_rate: 0.7 })).status).toBe("PIORA");
    expect(R.compareMetric("p/normal", "short_match_rate", higher, g({ short_match_rate: 0.5 }), g({ short_match_rate: 0.1 })).status).toBe("melhora");
    expect(R.compareMetric("p/normal", "short_match_rate", higher, g({ short_match_rate: 0.5 }), g({ short_match_rate: 0.5 })).status).toBe("igual");
  });
  it("borda: piora exatamente igual à tolerância passa (também com erro de ponto flutuante); um pouco acima reprova", () => {
    // em ponto flutuante, 0,3 − 0,2 = 0,09999999999999998 e 0,4 − 0,3 = 0,10000000000000003 (> 0,1)
    expect(R.compareMetric("p/normal", "short_match_rate", higher, g({ short_match_rate: 0.2 }), g({ short_match_rate: 0.3 })).status).toBe("piora tolerada");
    expect(R.compareMetric("p/normal", "short_match_rate", higher, g({ short_match_rate: 0.3 }), g({ short_match_rate: 0.4 })).status).toBe("piora tolerada");
    expect(R.compareMetric("p/normal", "short_match_rate", higher, g({ short_match_rate: 0.6 }), g({ short_match_rate: 0.7001 })).status).toBe("PIORA");
    expect(R.compareMetric("p/normal", "chase_median", lower, g({ chase_median: 20 }), g({ chase_median: 15 })).status).toBe("piora tolerada");
    expect(R.compareMetric("p/normal", "chase_median", lower, g({ chase_median: 20 }), g({ chase_median: 14.99 })).status).toBe("PIORA");
  });
  it("o agregado mapa/all usa pooled_max_worsening; sem ele, max_worsening", () => {
    expect(R.toleranceFor("p/all", band)).toBe(0.02);
    expect(R.toleranceFor("p/hard", band)).toBe(0.05);
    expect(R.toleranceFor("p/all", higher)).toBe(0.1);
    // pooled_max_worsening: null = "a medir" no agregado; não herda o valor por dificuldade
    expect(R.toleranceFor("p/all", { ...higher, max_worsening: 0.1, pooled_max_worsening: null })).toBeNull();
    // piora de 0,03: tolerada numa dificuldade, reprovada no agregado
    expect(R.compareMetric("p/hard", "hunter_win", band, g({ hunter_win: 0.5 }), g({ hunter_win: 0.58 })).status).toBe("piora tolerada");
    expect(R.compareMetric("p/all", "hunter_win", band, g({ hunter_win: 0.5 }), g({ hunter_win: 0.58 })).status).toBe("PIORA");
  });
  it("métrica ou grupo ausente no resultado atual reprova; ausente na linha de base é 'sem base'", () => {
    expect(R.compareMetric("p/normal", "hunter_win", band, g({ hunter_win: 0 }), g({})).status).toBe("ausente");
    expect(R.compareMetric("p/normal", "hunter_win", band, g({ hunter_win: 0 }), undefined).status).toBe("ausente");
    expect(R.compareMetric("p/normal", "hunter_win", band, g({ hunter_win: 0 }), g({ hunter_win: Number.NaN })).status).toBe("ausente");
    expect(R.compareMetric("p/normal", "hunter_win", band, g({ hunter_win: 0 }), g({ hunter_win: "0" })).status).toBe("ausente");
    expect(R.compareMetric("p/normal", "hunter_win", band, g({}), g({ hunter_win: 0.9 })).status).toBe("sem base");
    expect(R.compareMetric("p/novo", "hunter_win", band, undefined, g({ hunter_win: 0.9 })).status).toBe("sem base");
  });
  it("amostra pequena (min_samples) ou mediana nula não é comparada nem reprova", () => {
    expect(R.compareMetric("p/normal", "chase_median", lower, g({ chase_median: 30, chase_count: 2 }), g({ chase_median: 1 })).status).toBe("amostra pequena");
    expect(R.compareMetric("p/normal", "chase_median", lower, g({ chase_median: 30 }), g({ chase_median: 1, chase_count: 2 })).status).toBe("amostra pequena");
    expect(R.compareMetric("p/normal", "chase_median", lower, g({ chase_median: 30 }), g({ chase_median: null, chase_count: 0 })).status).toBe("amostra pequena");
    expect(R.compareMetric("p/normal", "chase_median", lower, g({ chase_median: null, chase_count: 0 }), g({ chase_median: null, chase_count: 0 })).status).toBe("amostra pequena");
    expect(R.compareMetric("p/normal", "chase_median", lower, g({ chase_median: null, chase_count: 0 }), g({ chase_median: 20 })).status).toBe("sem base");
    // exatamente min_samples já compara
    expect(R.compareMetric("p/normal", "chase_median", lower, g({ chase_median: 30, chase_count: 3 }), g({ chase_median: 1, chase_count: 3 })).status).toBe("PIORA");
  });
});

describe("saturação, tolerância a medir e lote da linha de base", () => {
  it("saturada quando base ± tolerância passa do limite físico do lado da piora", () => {
    expect(R.saturated("short_match_rate", higher, 0.9, 0.1)).toBe(true); // 0,9 + 0,1 ≥ 1
    expect(R.saturated("short_match_rate", higher, 0.85, 0.1)).toBe(false);
    expect(R.saturated("chases_per_match", lower, 0.03, 5)).toBe(true); // 0,03 − 5 ≤ 0
    expect(R.saturated("duration_mean", higher, 100, 1e6)).toBe(false); // sem teto
    expect(R.saturated("hunter_win", band, 0.01, 0.02)).toBe(true); // abaixo da banda: lado de perto é o 0
    expect(R.saturated("hunter_win", band, 0.99, 0.02)).toBe(true); // acima: lado de perto é o 1
    expect(R.saturated("hunter_win", band, 0.5, 0.02)).toBe(false); // dentro: precisa saturar dos dois lados
    const row = R.compareMetric("p/normal", "short_match_rate", higher, g({ short_match_rate: 0.95 }), g({ short_match_rate: 0.95 }));
    expect(row.saturated).toBe(true);
    expect(R.comparisonMarkdown([row])).toContain("| igual | sim |");
  });
  it("porta inativa: métrica sem nenhum grupo comparado e não saturado", () => {
    const rules = { short_match_rate: higher, chase_median: lower, duration_mean: { worse: "higher", max_worsening: 10 } as Rule };
    const base = { meta: {}, groups: { "p/easy": g({ short_match_rate: 0.95, chase_median: 20, chase_count: 1, duration_mean: 80 }) } };
    const rows = R.compare(base, { "p/easy": g({ short_match_rate: 0.95, chase_median: 20, chase_count: 1, duration_mean: 80 }) }, rules).rows;
    expect(R.inactiveMetrics(rows)).toEqual(["short_match_rate", "chase_median"]);
    expect(R.comparisonMarkdown(rows)).toContain("Porta inativa (todos os grupos saturados, com amostra pequena ou a medir): short_match_rate, chase_median.");
  });
  it("tolerância null = a medir: não compara nem reprova; o agregado pode ter a sua", () => {
    const r: Rule = { worse: "lower", max_worsening: null, pooled_max_worsening: 30 };
    expect(R.compareMetric("p/hard", "chase_median", r, g({ chase_median: 50 }), g({ chase_median: 1 })).status).toBe("a medir");
    expect(R.compareMetric("p/all", "chase_median", r, g({ chase_median: 50 }), g({ chase_median: 1 })).status).toBe("PIORA");
    expect(R.comparisonMarkdown([R.compareMetric("p/hard", "chase_median", r, g({ chase_median: 50 }), g({ chase_median: 1 }))])).toContain("| a medir | a medir |");
  });
  it("lote diferente da linha de base é apontado campo a campo", () => {
    const base = { nav: "grid", maps: ["patio"], seeds: "1..50", matches_per_group: 50 };
    expect(R.metaMismatch(base, { ...base }, ["nav", "maps", "seeds", "matches_per_group"])).toEqual([]);
    expect(R.metaMismatch(base, { ...base, nav: "recast", matches_per_group: 10 }, ["nav", "maps", "seeds", "matches_per_group"]))
      .toEqual(['nav: "grid" ≠ "recast"', "matches_per_group: 50 ≠ 10"]);
    expect(R.metaMismatch(base, { ...base, maps: ["patio", "floresta"] }, ["maps"])).toHaveLength(1);
  });
});

describe("comparação completa", () => {
  const rules = { hunter_win: band, short_match_rate: higher };
  const base = { meta: {}, groups: { "p/easy": g({ hunter_win: 0.5, short_match_rate: 0.1 }), "p/all": g({ hunter_win: 0.5, short_match_rate: 0.1 }) } };
  it("passa quando nada piora além da tolerância e lista grupos novos sem reprovar", () => {
    const r = R.compare(base, { "p/easy": g({ hunter_win: 0.52, short_match_rate: 0.15 }), "p/all": g({ hunter_win: 0.5, short_match_rate: 0.1 }), "q/easy": g({ hunter_win: 0, short_match_rate: 1 }) }, rules);
    expect(r.failed).toBe(false);
    expect(r.rows.filter(x => x.group === "q/easy").map(x => x.status)).toEqual(["sem base", "sem base"]);
  });
  it("reprova com uma só métrica pior além da tolerância", () => {
    const r = R.compare(base, { "p/easy": g({ hunter_win: 0.5, short_match_rate: 0.25 }), "p/all": g({ hunter_win: 0.5, short_match_rate: 0.1 }) }, rules);
    expect(r.failed).toBe(true);
    expect(r.rows.filter(x => x.status === "PIORA").map(x => `${x.group}:${x.metric}`)).toEqual(["p/easy:short_match_rate"]);
  });
  it("reprova se um grupo da linha de base sumiu", () => {
    const r = R.compare(base, { "p/easy": g({ hunter_win: 0.5, short_match_rate: 0.1 }) }, rules);
    expect(r.failed).toBe(true);
    expect(r.rows.filter(x => x.status === "ausente").map(x => x.group)).toEqual(["p/all", "p/all"]);
  });
  it("tabela Markdown traz antes, depois, piora, tolerância e status", () => {
    const md = R.comparisonMarkdown(R.compare(base, { "p/easy": g({ hunter_win: 0.4, short_match_rate: 0.1 }), "p/all": g({ hunter_win: 0.5, short_match_rate: 0.1 }) }, rules).rows);
    expect(md).toContain("| p/easy | hunter_win | 50.0% | 40.0% | 5.0 p.p. | 5.0 p.p. | piora tolerada | — |");
  });
});

describe("métricas por grupo", () => {
  const row = (o: Partial<Row>): Row => ({
    seed: 1, time: 100, team: "survivors", reason: "hunter_down", escaped: 0, captures: 0, transitions: {}, replans: 0, layout: "",
    chases: [], survivors: [{ cls: "A", st: "ok", captures: 0 }, { cls: "B", st: "out", captures: 0 }], stuck: false, stuckWorst: 0, dither: 0, failAt: null, ...o,
  });
  const valid = (a: string, b: string) => a === "patrol" && b === "chase";
  it("mediana com número par e ímpar de valores e vazia", () => {
    expect(M.median([3, 1, 2])).toBe(2);
    expect(M.median([4, 1, 3, 2])).toBe(2.5);
    expect(M.median([])).toBeNull();
  });
  it("agrega vitória, fuga por sobrevivente, duração, partidas curtas, perseguição e classes", () => {
    const m = M.groupMetrics([
      row({ time: 100, team: "hunter", captures: 2, chases: [10, 30], transitions: { "patrol>chase": 1 } }),
      row({ time: 200, chases: [20] }),
      row({ time: 400, error: "boom" }),
    ], 180, valid);
    expect(m).toMatchObject({
      matches: 3, errors: 1, hunter_win: 0.5, survivor_escape: 0.5, duration_mean: 150, duration_median: 150, captures_per_match: 1,
      short_match_rate: 0.5, chase_median: 20, chase_count: 3, class_use: { A: 0.5, B: 0.5 }, class_escape: { A: 0, B: 1 }, first_class: { A: 1 },
      invalid_transitions: [], stuck: 0, unfinished: 0,
    });
    expect(M.hardFailures(m)).toEqual(["1 exceção(ões)"]);
  });
  it("duração exatamente no limite de partida curta não conta como curta", () => {
    expect(M.groupMetrics([row({ time: 180 })], 180, valid).short_match_rate).toBe(0);
  });
  it("trava, partida sem fim e transição fora do grafo são falhas duras", () => {
    const m = M.groupMetrics([row({ stuck: true }), row({ reason: null, team: null }), row({ transitions: { "cage>chase": 1 } })], 180, valid);
    expect(M.hardFailures(m)).toEqual(["1 trava(s) T-03", "1 partida(s) sem fim", "transições fora do grafo do §8.2: cage>chase"]);
  });
});

describe("dados", () => {
  it("sim.regression em data/balance.yaml só usa métricas conhecidas, e a linha de base cobre os grupos do check", async () => {
    const b = loadBalanceFile(new URL("data/balance.yaml", root).pathname);
    const { METRICS } = (await import(new URL("tools/sim/metrics.ts", root).href)) as { METRICS: string[] };
    for (const k of Object.keys(b.sim.regression)) expect(METRICS).toContain(k);
    const { readFileSync } = await import("node:fs");
    const base = JSON.parse(readFileSync(new URL("data/sim/baseline.json", root), "utf8")) as { meta: { matches_per_group: number }; groups: Record<string, Metrics> };
    expect(base.meta.matches_per_group).toBe(b.sim.check.matches_per_group);
    for (const d of b.sim.check.difficulties) expect(Object.keys(base.groups).some(k => k.endsWith(`/${d}`))).toBe(true);
  });
});

describe("episódios de perseguição (chaseEpisodes)", () => {
  const T = (...xs: [number, string, string][]) => xs.map(([t, from, to]) => ({ t, from, to }));
  it("chase→attack→recoil→chase→…→captura é um episódio, medido da entrada em chase até o golpe que derrubou", () => {
    expect(chaseEpisodes(T(
      [10, "patrol", "chase"], [12, "chase", "attack"], [12.5, "attack", "recoil"], [13.1, "recoil", "chase"],
      [15, "chase", "attack"], [16, "attack", "chase"], [17, "chase", "attack"], [18, "attack", "recoil"], [18.6, "recoil", "cage"],
    ))).toEqual([8]);
  });
  it("trecho que volta a patrulhar ou investigar não conta; o próximo começa na nova entrada em chase", () => {
    expect(chaseEpisodes(T(
      [1, "patrol", "chase"], [3, "chase", "attack"], [3.5, "attack", "recoil"], [4.1, "recoil", "chase"], [9, "chase", "investigate"],
      [20, "investigate", "chase"], [26, "chase", "attack"], [27, "attack", "recoil"], [27.6, "recoil", "cage"], [30, "cage", "patrol"],
      [40, "patrol", "chase"], [45, "chase", "patrol"],
    ))).toEqual([7]);
  });
  it("sem transições, ou só patrulha e investigação, não há episódio", () => {
    expect(chaseEpisodes([])).toEqual([]);
    expect(chaseEpisodes(T([1, "patrol", "investigate"], [5, "investigate", "patrol"]))).toEqual([]);
  });
});

describe("perseguição e sobreviventes no resultado headless", () => {
  it("utility: cada episódio que termina em captura tem duração positiva e há no máximo um por recoil→cage", () => {
    const c = aiCfg("nightmare");
    let found = 0;
    for (let seed = 1; seed <= 50 && !found; seed++) {
      const r = playHeadless(c, seed);
      expect(r.survivors).toHaveLength(3);
      expect(r.survivors.reduce((n, s) => n + s.captures, 0)).toBe(r.captures);
      expect(r.chases.length).toBeLessThanOrEqual(r.transitions["recoil>cage"] ?? 0);
      for (const t of r.chases) { expect(t).toBeGreaterThan(0); expect(t).toBeLessThanOrEqual(r.time); }
      found = r.chases.length;
    }
    expect(found).toBeGreaterThan(0);
  });
  it("cérebro basic: sem transições, sem episódios de perseguição", () => {
    const r = playHeadless(makeConfig(b, map, { ruleset: "v1", hunterBrain: "basic", difficulty: "normal" }), 1);
    expect(r.chases).toEqual([]);
    expect(r.transitions).toEqual({});
  });
});
