// Custo das camadas na CI (D-44 b, opção a da margem do runner; docs/plano-construcao.md §7): lógica pura de
// tools/visual/cost-stats.mjs com os valores de data/balance.yaml (render.cost_check, render.layer_cost_factor).
// Falha só com o limite inferior do IC acima de layer_cost_factor × (1 + ci_runner_margin); aviso com a mediana acima
// de layer_cost_factor. Casos: passa, aviso (runner lento como o do PR #53), falha certa, regressão deliberada (B 2×
// mais caro) e medidas quebradas (erro, nunca "pass").
import { describe, expect, it } from "vitest";
import { loadBalanceFile } from "@thehell/shared/node";
import {
  abbaOrder, bootstrapCi, costOutcome, costThresholds, costVerdict, costVsMain, crossOrder, ghaWarning, judgeCost, judgeVsMain, median,
  vsMainOutcome, costGateOutcome, costInfo, COST_TITLE, judgeDual, p1, d2, x2,
} from "../../../tools/visual/cost-stats.mjs";

const balance = loadBalanceFile(new URL("../../../data/balance.yaml", import.meta.url).pathname);
const CC = balance.render.cost_check;
const K = balance.render.layer_cost_factor;
const M = CC.ci_runner_margin;

/**
 * 21 razões com a dispersão real da CI do PR #53 (mín 1,22, mediana 1,30, p90 1,34, máx 1,42; desvio ≈ 0,04),
 * fora de ordem como sairiam dos pares
 */
const REAL = [1.30, 1.27, 1.33, 1.22, 1.31, 1.29, 1.42, 1.26, 1.32, 1.30, 1.28, 1.34, 1.25, 1.31, 1.29, 1.33, 1.24, 1.30, 1.38, 1.28, 1.32];

/** pares (ms/quadro) de um runner de ~65 ms com as razões REAL deslocadas para a mediana `center` */
function pairs(center: number) {
  const shift = center - median(REAL);
  const a = REAL.map((_, i) => 65 + (i % 5) - 2);
  return { a, b: a.map((x, i) => x * (REAL[i] + shift)) };
}

describe("cost-stats (D-44 b)", () => {
  it("dados: render.cost_check, teto de hardware 1,4× intocado e teto da CI 1,4 × 1,07", () => {
    expect(CC).toEqual({ pairs: 21, frames: 32, warmup: 2, bootstrap_resamples: 2000, ci: 0.95, seed: 44, ci_runner_margin: 0.07, ci_mode: "fail", main_rel_delta: 0.05, main_ratio_delta: 0.05, warmup_rounds: 1 });
    expect(K).toBe(1.4);
    const t = costThresholds(K, M);
    expect(t.budget).toBe(1.4);
    expect(t.fail).toBeCloseTo(1.498, 9);
  });

  it("fixture: a dispersão é a da CI do #53", () => {
    const s = [...REAL].sort((x, y) => x - y);
    expect(REAL).toHaveLength(CC.pairs);
    expect([s[0], median(REAL), s[Math.ceil(0.9 * s.length) - 1], s[s.length - 1]]).toEqual([1.22, 1.30, 1.34, 1.42]);
  });

  it("ordem ABBA intercalada", () => {
    expect([0, 1, 2, 3].flatMap(i => abbaOrder(i)).join("")).toBe("ABBAABBA");
  });

  it("mediana com n ímpar e par", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("bootstrap determinístico: mesma semente, mesmo IC; o IC contém a mediana", () => {
    const o = { resamples: CC.bootstrap_resamples, ci: CC.ci, seed: CC.seed };
    const c1 = bootstrapCi(REAL, o), c2 = bootstrapCi(REAL, o);
    expect(c1).toEqual(c2);
    expect(c1.lo).toBeLessThanOrEqual(c1.median);
    expect(c1.hi).toBeGreaterThanOrEqual(c1.median);
    expect(c1.hi - c1.lo).toBeGreaterThan(0);
  });

  it("decisão: falha só com o limite inferior acima do teto da CI; aviso com a mediana acima do orçamento", () => {
    expect(judgeCost({ median: 1.55, lo: 1.51 }, K, M)).toBe("fail");
    expect(judgeCost({ median: 1.5, lo: 1.45 }, K, M)).toBe("warn");
    expect(judgeCost({ median: 1.43, lo: 1.41 }, K, M)).toBe("warn");
    expect(judgeCost({ median: 1.4, lo: 1.3 }, K, M)).toBe("pass");
    expect(judgeCost({ median: 1.3, lo: 1.2 }, K, M)).toBe("pass");
  });

  it("passa: a CI do #53 com a dispersão real (mediana 1,30×)", () => {
    const { a, b } = pairs(1.3);
    const c = costVerdict(a, b, CC, K);
    expect(c.median).toBeCloseTo(1.3, 9);
    expect(c.verdict).toBe("pass");
  });

  it("aviso: runner lento com mediana 1,43× e a dispersão real (o IC fica acima de 1,4× mas abaixo do teto da CI)", () => {
    const { a, b } = pairs(1.43);
    const c = costVerdict(a, b, CC, K);
    expect(c.median).toBeGreaterThan(K);
    expect(c.lo).toBeGreaterThan(K); // sem a margem do runner seria falha
    expect(c.lo).toBeLessThanOrEqual(c.fail);
    expect(c.verdict).toBe("warn");
  });

  it("falha certa: limite inferior ≥ 1,5× com a dispersão real", () => {
    const { a, b } = pairs(1.56);
    const c = costVerdict(a, b, CC, K);
    expect(c.lo).toBeGreaterThanOrEqual(1.5);
    expect(c.verdict).toBe("fail");
  });

  it("regressão deliberada: a camada B 2× mais cara faz o runner que passava falhar", () => {
    const { a, b } = pairs(1.3);
    expect(costVerdict(a, b, CC, K).verdict).toBe("pass");
    const c = costVerdict(a, b.map(x => x * 2), CC, K);
    expect(c.median).toBeCloseTo(2.6, 9);
    expect(c.verdict).toBe("fail");
  });

  describe("ci_mode (D-48)", () => {
    const ctx = { view: "capturas", baseMs: 36.3, ciLevel: CC.ci };
    /** o caso medido no PR #68 (job 128986770134): mediana 1,52×, IC [1,52, 1,53] */
    const pr68 = () => {
      const a = REAL.map(() => 36.3);
      const c = costVerdict(a, a.map((x, i) => x * (1.52 + (i % 3) * 0.005)), CC, K);
      expect(c.verdict).toBe("fail");
      return c;
    };

    it("resultado de falha com ci_mode warn: não reprova e produz o aviso (razão, IC, base, tetos)", () => {
      const out = costOutcome(pr68(), "warn", ctx);
      expect(out.failing).toBe(false);
      expect(out.warning).toMatch(/razão mediana 1\.52×/);
      expect(out.warning).toMatch(/IC 95% \[1\.52×, 1\.53×\]/);
      expect(out.warning).toMatch(/base 36\.3 ms\/quadro/);
      expect(out.warning).toMatch(/> 1\.40×/);
      expect(out.warning).toMatch(/> 1\.50×/);
      expect(out.warning).toMatch(/D-48/);
    });

    it("resultado de falha com ci_mode fail: reprova (comportamento de D-44)", () => {
      expect(costOutcome(pr68(), "fail", ctx)).toEqual({ failing: true, warning: null });
    });

    it("aviso simples (mediana > 1,4×) produz o aviso nos dois modos; pass não produz nada", () => {
      const w = costVerdict(pairs(1.43).a, pairs(1.43).b, CC, K);
      expect(w.verdict).toBe("warn");
      for (const mode of ["warn", "fail"]) {
        const out = costOutcome(w, mode, ctx);
        expect(out.failing).toBe(false);
        expect(out.warning).toMatch(/mediana acima do orçamento 1\.40×/);
      }
      const p = costVerdict(pairs(1.3).a, pairs(1.3).b, CC, K);
      expect(costOutcome(p, "warn", ctx)).toEqual({ failing: false, warning: null });
      expect(costOutcome(p, "fail", ctx)).toEqual({ failing: false, warning: null });
    });

    it("ci_mode inválido é erro", () => {
      expect(() => costOutcome(pr68(), "off", ctx)).toThrow(/ci_mode inválido/);
    });

    it("anotação do GitHub Actions: uma linha, com escape de % e quebra de linha", () => {
      expect(ghaWarning("Custo das camadas (D-48)", "a 50%\nb")).toBe("::warning title=Custo das camadas (D-48)::a 50%25%0Ab");
      expect(ghaWarning("x: y, z", "m")).toBe("::warning title=x%3A y%2C z::m");
    });
  });

  it("medidas quebradas são erro, nunca pass", () => {
    const { a, b } = pairs(1.3);
    expect(() => costVerdict([1, 2], [1], CC, K)).toThrow();
    expect(() => costVerdict([], [], CC, K)).toThrow();
    for (const bad of [0, -3, NaN, Infinity]) {
      expect(() => costVerdict(a.map((x, i) => (i === 4 ? bad : x)), b, CC, K)).toThrow(/tempo inválido/);
      expect(() => costVerdict(a, b.map((x, i) => (i === 7 ? bad : x)), CC, K)).toThrow(/tempo inválido/);
    }
    expect(() => costVerdict(a.map(() => NaN), b.map(() => NaN), CC, K)).toThrow();
    expect(() => judgeCost({ median: NaN, lo: NaN }, K, M)).toThrow();
    expect(() => judgeCost({ median: 1.3, lo: NaN }, K, M)).toThrow();
  });
});

// issue #59 (D-49) com o critério duplo de D-51: PR e build de main medidos no mesmo job; reprova só se os DOIS
// limites inferiores dos IC passarem: rel_AB = PR_AB / main_AB − 1 (ms/quadro com A+B, pareado por rodada) acima de
// render.cost_check.main_rel_delta E Δrazão = razão do PR − razão de main acima de main_ratio_delta. O build de main
// usa as razões REAL em outra ordem (ruído independente do PR, o caso pessimista: na CI o ruído da mesma rodada é em
// parte comum aos dois builds)
describe("cost-stats: comparação com main no mesmo job (D-49, critério duplo de D-51)", () => {
  const D = CC.main_rel_delta, DR = CC.main_ratio_delta;
  /** rodadas de um build no runner de base `baseMs` com as razões REAL deslocadas para `center`, giradas `rot` */
  function build(center: number, baseMs: number, rot = 0) {
    const shift = center - median(REAL);
    const r = REAL.map((_, i) => REAL[(i + rot) % REAL.length] + shift);
    const a = r.map((_, i) => baseMs + (i % 5) - 2);
    return { a, b: a.map((x, i) => x * r[i]) };
  }
  /** o mesmo build com o ms/quadro sem camadas × `fa` e com A+B × `fb` */
  const scale = (g: { a: number[]; b: number[] }, fa: number, fb: number) => ({ a: g.a.map(x => x * fa), b: g.b.map(x => x * fb) });
  /** o mesmo build com a base (sem camadas) `f` vezes mais lenta; as camadas custam os mesmos ms por cima */
  const slowBase = (g: { a: number[]; b: number[] }, f: number) => ({ a: g.a.map(x => x * f), b: g.b.map((x, i) => x + g.a[i] * (f - 1)) });
  const RUNNERS = [[1.3, 36.3], [1.3, 65], [1.43, 65], [1.52, 36.3]] as const;
  const ctx = { view: "capturas", ciLevel: CC.ci };

  it("ordem cruzada: rodada par PR→main com ABBA, ímpar invertida; em duas rodadas cada medida tem a mesma posição média", () => {
    expect(crossOrder(0)).toEqual([["pr", "A"], ["pr", "B"], ["main", "A"], ["main", "B"]]);
    expect(crossOrder(1)).toEqual([["main", "B"], ["main", "A"], ["pr", "B"], ["pr", "A"]]);
    expect(crossOrder(2)).toEqual(crossOrder(0));
    const pos: Record<string, number> = {};
    for (const i of [0, 1]) crossOrder(i).forEach(([g, l], p) => { pos[g + l] = (pos[g + l] ?? 0) + p; });
    expect(pos).toEqual({ prA: 3, prB: 3, mainA: 3, mainB: 3 });
  });

  it("dados: limites estritamente positivos (+5% e +0,05) e uma rodada de aquecimento descartada", () => {
    expect([D, DR, CC.warmup_rounds]).toEqual([0.05, 0.05, 1]);
  });

  it("decisão dupla: falha só com os DOIS limites inferiores acima; aviso com qualquer mediana acima", () => {
    const rel = (median: number, lo: number) => ({ median, lo });
    expect(judgeDual(rel(0.12, 0.06), D, rel(0.12, 0.06), DR)).toBe("fail");
    expect(judgeDual(rel(0.12, 0.06), D, rel(0.04, 0.0), DR)).toBe("warn"); // só rel_AB: viés do quadro inteiro
    expect(judgeDual(rel(0.12, 0.06), D, rel(-0.01, -0.03), DR)).toBe("warn");
    expect(judgeDual(rel(0.0, -0.02), D, rel(0.3, 0.25), DR)).toBe("warn"); // só Δrazão: otimização da base
    expect(judgeDual(rel(0.04, 0.0), D, rel(0.04, 0.0), DR)).toBe("pass");
    expect(judgeDual(rel(-0.3, -0.4), D, rel(-0.3, -0.4), DR)).toBe("pass");
    // na borda (lo = limite) não reprova
    expect(judgeDual(rel(0.1, D), D, rel(0.1, 0.06), DR)).toBe("warn");
    for (const [r, d, q, dq] of [[rel(NaN, 0), D, rel(0, 0), DR], [rel(0, 0), D, rel(0, NaN), DR], [rel(0, 0), 0, rel(0, 0), DR], [rel(0, 0), D, rel(0, 0), -0.01]] as const) {
      expect(() => judgeDual(r, d, q, dq)).toThrow(/valor inválido/);
    }
    // judgeVsMain (uma medida) segue igual
    expect(judgeVsMain({ median: 0.12, lo: 0.06 }, D)).toBe("fail");
    expect(judgeVsMain({ median: 0.08, lo: 0.05 }, D)).toBe("warn");
    expect(judgeVsMain({ median: 0.05, lo: 0.01 }, D)).toBe("pass");
    expect(() => judgeVsMain({ median: 0, lo: 0 }, -0.01)).toThrow(/valor inválido/);
  });

  it("as medidas: rel_AB e rel_A por rodada, Δrazão pareada por rodada", () => {
    const pr = build(1.3, 65), main = build(1.3, 65, 7);
    const rel = costVsMain(pr, main, CC);
    expect(rel.rels).toEqual(pr.b.map((x, i) => x / main.b[i] - 1));
    expect(rel.median).toBeCloseTo(median(rel.rels), 12);
    expect(rel.base.rels).toEqual(pr.a.map((x, i) => x / main.a[i] - 1));
    expect(rel.delta).toBe(D);
    expect(rel.ratio.delta).toBe(DR);
    expect(rel.prAbMs).toBeCloseTo(median(pr.b), 12);
    expect(rel.mainAbMs).toBeCloseTo(median(main.b), 12);
    expect(rel.ratio.diffs).toEqual(pr.a.map((x, i) => pr.b[i] / x - main.b[i] / main.a[i]));
    expect(rel.ratio.prMedian).toBeCloseTo(1.3, 9);
  });

  it("mesmo código nos dois builds passa sem aviso em qualquer runner (o do PR #68 reprovaria no teto absoluto)", () => {
    for (const [center, baseMs] of RUNNERS) {
      for (const rot of [3, 7, 10]) {
        const r = costVsMain(build(center, baseMs), build(center, baseMs, rot), CC);
        expect(r.lo).toBeGreaterThanOrEqual(-0.04);
        expect(r.hi).toBeLessThanOrEqual(0.04);
        expect(r.verdict).toBe("pass");
      }
    }
    const pr = build(1.52, 36.3);
    expect(costVerdict(pr.a, pr.b, CC, K).verdict).toBe("fail");
    expect(costVsMain(pr, build(1.52, 36.3, 7), CC).verdict).toBe("pass");
  });

  it("otimização da base (sem camadas mais rápido no PR, A+B igual) passa, no máximo com aviso, embora a razão suba", () => {
    for (const [center, baseMs] of RUNNERS) {
      const same = build(center, baseMs), main = build(center, baseMs, 7);
      for (const [fa, fb] of [[0.8, 1], [0.7, 0.95], [0.8, 0.9]]) {
        const rel = costVsMain(scale(same, fa, fb), main, CC);
        expect(rel.ratio.lo).toBeGreaterThan(DR); // pela regra de D-49 reprovaria
        expect(rel.lo).toBeLessThanOrEqual(D);
        expect(rel.verdict).toBe("warn");
        const out = costGateOutcome({ rel }, "fail", ctx);
        expect(out.failing).toBe(false);
        expect(out.warnings[0]).toMatch(/mediana acima do limite em Δrazão, sem os dois limites inferiores acima: aviso, não reprova/);
      }
    }
  });

  it("regressão das camadas: +10% em A+B com a base igual reprova em qualquer runner; +2% passa", () => {
    for (const [center, baseMs] of RUNNERS) {
      const main = build(center, baseMs, 7), same = build(center, baseMs);
      const r10 = costVsMain(scale(same, 1, 1.1), main, CC);
      expect(r10.lo).toBeGreaterThan(D);
      expect(r10.ratio.lo).toBeGreaterThan(DR);
      expect(r10.verdict).toBe("fail");
      expect(costGateOutcome({ rel: r10 }, "fail", ctx).failing).toBe(true);
      const r2 = costVsMain(scale(same, 1, 1.02), main, CC);
      expect(r2.verdict).toBe("pass");
      expect(costGateOutcome({ rel: r2 }, "fail", ctx)).toEqual({ failing: false, warnings: [] });
    }
    // a camada B 2× mais cara no PR: falha
    const main = build(1.3, 65, 7), pr = build(1.3, 65);
    const rel = costVsMain({ a: pr.a, b: pr.b.map(x => x * 2) }, main, CC);
    expect(rel.median).toBeGreaterThan(0.9);
    expect(rel.verdict).toBe("fail");
  });

  it("viés de quadro inteiro de +6% no PR (sem camadas e A+B × 1,06) passa, no máximo com aviso; −5,7% (run do PR #80) passa", () => {
    for (const [center, baseMs] of RUNNERS) {
      const main = build(center, baseMs, 7), same = build(center, baseMs);
      const up = costVsMain(scale(same, 1.06, 1.06), main, CC);
      expect(up.median).toBeGreaterThan(D); // rel_AB sozinho avisaria (ou reprovaria com o IC acima)
      expect(Math.abs(up.ratio.median)).toBeLessThan(0.02);
      expect(up.verdict).toBe("warn");
      expect(costGateOutcome({ rel: up }, "fail", ctx).failing).toBe(false);
      // o viés grande (+10% no quadro inteiro) também não reprova: o IC de rel_AB passa, o de Δrazão não
      const big = costVsMain(scale(same, 1.1, 1.1), main, CC);
      expect(big.lo).toBeGreaterThan(D);
      expect(big.verdict).toBe("warn");
      const down = costVsMain(scale(same, 0.943, 0.943), main, CC);
      expect(down.verdict).toBe("pass");
      expect(down.base.median).toBeLessThan(-0.04); // rel_A no log aponta o viés
    }
  });

  it("lentidão só da base (sem camadas mais lento, camadas com o mesmo custo em ms) passa este portão (aceito: perf:budget e smoke cobrem)", () => {
    for (const [center, baseMs] of RUNNERS) {
      const main = build(center, baseMs, 7), same = build(center, baseMs);
      for (const f of [1.1, 1.2, 1.5]) {
        const rel = costVsMain(slowBase(same, f), main, CC);
        expect(rel.ratio.median).toBeLessThan(0); // a razão cai
        expect(rel.verdict).not.toBe("fail");
        expect(costGateOutcome({ rel }, "fail", ctx).failing).toBe(false);
      }
    }
  });

  it("main mais caro que o PR (otimização das camadas) passa", () => {
    expect(costVsMain(build(1.3, 36.3), build(1.45, 36.3, 7), CC).verdict).toBe("pass");
  });

  it("desfecho: falha reprova com ci_mode fail e só avisa com warn, com as duas medidas; o teto de D-44 nunca vira aviso", () => {
    const main = build(1.52, 36.1, 7), pr = scale(build(1.52, 36.3), 1, 1.1);
    const rel = costVsMain(pr, main, CC), abs = costVerdict(pr.a, pr.b, CC, K);
    expect(rel.verdict).toBe("fail");
    expect(abs.verdict).toBe("fail");
    expect(vsMainOutcome(rel, "fail", ctx)).toEqual({ failing: true, warnings: [] });
    const w = vsMainOutcome(rel, "warn", ctx);
    expect(w.failing).toBe(false);
    expect(w.warnings).toHaveLength(1);
    expect(w.warnings[0]).toMatch(/rel_AB \(A\+B \d+\.\d ms\/quadro no PR × \d+\.\d em main\) mediana \+\d+\.\d%, IC 95% \[\+\d+\.\d%, \+\d+\.\d%\], limite \+5\.0%; Δrazão \(PR 1\.\d\d× × main 1\.52×\) mediana \+0\.\d\d, IC 95% \[\+0\.\d\d, \+0\.\d\d\], limite \+0\.05/);
    expect(w.warnings[0]).toMatch(/ci_mode warn não reprova/);
    const same = build(1.52, 36.3), okRel = costVsMain(same, main, CC), okAbs = costVerdict(same.a, same.b, CC, K);
    expect(okAbs.verdict).toBe("fail");
    expect(costGateOutcome({ rel: okRel, abs: okAbs }, "fail", ctx)).toEqual({ failing: false, warnings: [] });
    expect(() => vsMainOutcome(rel, "off", ctx)).toThrow(/ci_mode inválido/);
  });

  it("linha do log e do resumo: sempre rel_AB e Δrazão com mediana e IC, o desfecho, rel_A e o teto de D-44 informativos", () => {
    const main = build(1.3, 65, 7), pr = scale(build(1.3, 65), 0.8, 1);
    const rel = costVsMain(pr, main, CC), abs = costVerdict(pr.a, pr.b, CC, K);
    const line = costInfo(rel, abs, ctx);
    expect(line).toMatch(/^vista capturas: rel_AB \(A\+B \d+\.\d ms\/quadro no PR × \d+\.\d em main\) mediana [+−]\d+\.\d%, IC 95% \[.*\], limite \+5\.0%; Δrazão \(PR 1\.6\d× × main 1\.30×\) mediana \+0\.\d\d, IC 95% \[\+0\.\d\d, \+0\.\d\d\], limite \+0\.05 → warn \(IC 95%, D-51/);
    expect(line).toMatch(/informativo: sem camadas 52\.\d × 65\.\d ms\/quadro, rel_A −2\d\.\d%/);
    expect(line).toMatch(/orçamento 1\.40× e o teto 1\.50× de D-44 → fail \(não reprova\)/);
    // formatos exportados (compare.mjs os reaproveita)
    expect([p1(0.05), p1(-0.057), d2(0.05), d2(-0.01), x2(1.3)]).toEqual(["+5.0%", "−5.7%", "+0.05", "−0.01", "1.30×"]);
  });

  it("medidas quebradas são erro, nunca pass", () => {
    const pr = build(1.3, 36.3), main = build(1.3, 36.1, 7);
    expect(() => costVsMain({ a: pr.a, b: pr.b.slice(1) }, main, CC)).toThrow(/rodadas incompletas/);
    expect(() => costVsMain(pr, { a: [], b: [] }, CC)).toThrow(/rodadas incompletas/);
    expect(() => costVsMain({ a: [], b: [] }, { a: [], b: [] }, CC)).toThrow(/rodadas incompletas/);
    for (const bad of [0, -3, NaN, Infinity]) {
      expect(() => costVsMain(pr, { a: main.a.map((x, i) => (i === 4 ? bad : x)), b: main.b }, CC)).toThrow(/tempo inválido/);
      expect(() => costVsMain({ a: pr.a, b: pr.b.map((x, i) => (i === 9 ? bad : x)) }, main, CC)).toThrow(/tempo inválido/);
    }
    expect(() => costVsMain(pr, main, { ...CC, main_rel_delta: NaN })).toThrow(/valor inválido/);
    expect(() => costVsMain(pr, main, { ...CC, main_ratio_delta: 0 })).toThrow(/valor inválido/);
  });
});

describe("cost-stats: desfecho sem build de main (complemento de D-49)", () => {
  /** rodadas com as razões REAL deslocadas para `center` (como build() acima), base `baseMs`, giradas `rot` */
  function build(center: number, baseMs: number, rot = 0) {
    const shift = center - median(REAL);
    const r = REAL.map((_, i) => REAL[(i + rot) % REAL.length] + shift);
    const a = r.map((_, i) => baseMs + (i % 5) - 2);
    return { a, b: a.map((x, i) => x * r[i]) };
  }
  const ctx = { view: "capturas", ciLevel: CC.ci };

  it("sem build de main: só aviso, nunca falha, mesmo com a razão do PR muito acima do teto absoluto de D-44", () => {
    expect(CC.ci_mode).toBe("fail");
    const pr = build(2.5, 36.3), abs = costVerdict(pr.a, pr.b, CC, K);
    expect(abs.verdict).toBe("fail");
    expect(abs.lo).toBeGreaterThan(abs.fail * 1.5);
    for (const reason of [
      'passo "Build de main para o custo das camadas" terminou em failure',
      "main sem o gancho de custo (__thehellRender.bench/setLayers/setLayerA)",
      "build de main falhou no meio da medida (vista capturas, rodada 3): Target page, context or browser has been closed",
    ]) {
      for (const cmp of [{ reason }, { reason, abs }]) {
        for (const mode of ["fail", "warn"]) {
          const out = costGateOutcome(cmp, mode, ctx);
          expect(out.failing).toBe(false);
          expect(out.warnings).toEqual([`sem build de main, comparação não feita (${reason})`]);
        }
      }
    }
    expect(COST_TITLE).toBe("Custo das camadas (D-49)");
    expect(ghaWarning(COST_TITLE, costGateOutcome({ reason: "x" }, "fail", ctx).warnings[0]))
      .toBe("::warning title=Custo das camadas (D-49)::sem build de main, comparação não feita (x)");
  });

  it("com build de main: regressão do PR reprova (ci_mode fail); mesmo código passa mesmo acima do teto absoluto", () => {
    const main = build(1.52, 36.1, 7);
    const bad = build(1.72, 36.3); // A+B ≈ 13% acima de main
    const f = costGateOutcome({ rel: costVsMain(bad, main, CC), abs: costVerdict(bad.a, bad.b, CC, K) }, "fail", ctx);
    expect(f.failing).toBe(true);
    const same = build(1.52, 36.3), abs = costVerdict(same.a, same.b, CC, K);
    expect(abs.verdict).toBe("fail");
    const ok = costGateOutcome({ rel: costVsMain(same, main, CC), abs }, "fail", ctx);
    expect(ok).toEqual({ failing: false, warnings: [] }); // D-51: o teto de D-44 é só informativo (costInfo)
    // a camada B 2× mais cara no PR também reprova
    const pr = build(1.3, 65), m = build(1.3, 65, 7), b2 = { a: pr.a, b: pr.b.map(x => x * 2) };
    expect(costGateOutcome({ rel: costVsMain(b2, m, CC), abs: costVerdict(b2.a, b2.b, CC, K) }, "fail", ctx).failing).toBe(true);
  });

  it("sem comparação e sem motivo, ou ci_mode inválido, é erro (nunca pass silencioso)", () => {
    for (const cmp of [undefined, null, {}, { reason: "" }, { reason: "  " }, { abs: undefined }]) {
      expect(() => costGateOutcome(cmp as never, "fail", ctx)).toThrow(/sem comparação com main e sem motivo/);
    }
    expect(() => costGateOutcome({ reason: "x" }, "off", ctx)).toThrow(/ci_mode inválido/);
  });
});
