// Custo das camadas na CI (D-44 b, opção a da margem do runner; docs/plano-construcao.md §7): lógica pura de
// tools/visual/cost-stats.mjs com os valores de data/balance.yaml (render.cost_check, render.layer_cost_factor).
// Falha só com o limite inferior do IC acima de layer_cost_factor × (1 + ci_runner_margin); aviso com a mediana acima
// de layer_cost_factor. Casos: passa, aviso (runner lento como o do PR #53), falha certa, regressão deliberada (B 2×
// mais caro) e medidas quebradas (erro, nunca "pass").
import { describe, expect, it } from "vitest";
import { loadBalanceFile } from "@thehell/shared/node";
import {
  abbaOrder, bootstrapCi, costOutcome, costThresholds, costVerdict, costVsMain, crossOrder, ghaWarning, judgeCost, judgeVsMain, median,
  vsMainOutcome,
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
    expect(CC).toEqual({ pairs: 21, frames: 32, warmup: 2, bootstrap_resamples: 2000, ci: 0.95, seed: 44, ci_runner_margin: 0.07, ci_mode: "fail", main_delta: 0.05 });
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

// issue #59 (D-49): PR e build de main medidos no mesmo job; reprova só se o limite inferior do IC de (razão do PR −
// razão de main) passar de render.cost_check.main_delta. O build de main usa as razões REAL em outra ordem (ruído
// independente do PR, o caso pessimista: na CI o ruído da mesma rodada é em parte comum aos dois builds)
describe("cost-stats: comparação com main no mesmo job (issue #59, D-49)", () => {
  const D = CC.main_delta;
  /** rodadas de um build no runner de base `baseMs` com as razões REAL deslocadas para `center`, giradas `rot` */
  function build(center: number, baseMs: number, rot = 0) {
    const shift = center - median(REAL);
    const r = REAL.map((_, i) => REAL[(i + rot) % REAL.length] + shift);
    const a = r.map((_, i) => baseMs + (i % 5) - 2);
    return { a, b: a.map((x, i) => x * r[i]) };
  }
  const ctx = { view: "capturas", baseMs: 36.3, mainBaseMs: 36.1, ciLevel: CC.ci };

  it("ordem cruzada: rodada par PR→main com ABBA, ímpar invertida; em duas rodadas cada medida tem a mesma posição média", () => {
    expect(crossOrder(0)).toEqual([["pr", "A"], ["pr", "B"], ["main", "A"], ["main", "B"]]);
    expect(crossOrder(1)).toEqual([["main", "B"], ["main", "A"], ["pr", "B"], ["pr", "A"]]);
    expect(crossOrder(2)).toEqual(crossOrder(0));
    const pos: Record<string, number> = {};
    for (const i of [0, 1]) crossOrder(i).forEach(([g, l], p) => { pos[g + l] = (pos[g + l] ?? 0) + p; });
    expect(pos).toEqual({ prA: 3, prB: 3, mainA: 3, mainB: 3 });
  });

  it("decisão: falha só com o limite inferior acima de main_delta; aviso com a mediana acima", () => {
    expect(D).toBe(0.05);
    expect(judgeVsMain({ median: 0.12, lo: 0.06 }, D)).toBe("fail");
    expect(judgeVsMain({ median: 0.08, lo: 0.05 }, D)).toBe("warn");
    expect(judgeVsMain({ median: 0.05, lo: 0.01 }, D)).toBe("pass");
    expect(judgeVsMain({ median: -0.3, lo: -0.4 }, D)).toBe("pass");
    expect(() => judgeVsMain({ median: NaN, lo: 0 }, D)).toThrow(/valor inválido/);
    expect(() => judgeVsMain({ median: 0, lo: 0 }, -0.01)).toThrow(/valor inválido/);
  });

  it("o runner do PR #68 (1,52×, base 36,3 ms) com o mesmo código nos dois builds passa; o portão absoluto reprovaria", () => {
    const pr = build(1.52, 36.3), main = build(1.52, 36.1, 7);
    const abs = costVerdict(pr.a, pr.b, CC, K);
    expect(abs.verdict).toBe("fail");
    const rel = costVsMain(pr, main, CC);
    expect(rel.prMedian).toBeCloseTo(1.52, 9);
    expect(rel.mainMedian).toBeCloseTo(1.52, 9);
    expect(rel.lo).toBeLessThan(0);
    expect(rel.hi).toBeLessThanOrEqual(D);
    expect(rel.verdict).toBe("pass");
    // e com o ruído girado de outros modos o IC da diferença fica em [−0,04, +0,05] (data/balance.yaml)
    for (const rot of [3, 7, 10]) {
      const r = costVsMain(build(1.3, 65), build(1.3, 65, rot), CC);
      expect(r.lo).toBeGreaterThanOrEqual(-0.04 - 1e-9);
      expect(r.hi).toBeLessThanOrEqual(0.05 + 1e-9);
      expect(r.verdict).toBe("pass");
    }
  });

  it("regressão deliberada: +0,10 na razão do PR reprova em qualquer runner; +0,02 passa", () => {
    for (const [center, baseMs] of [[1.3, 36.3], [1.43, 65], [1.52, 36.3]]) {
      const main = build(center, baseMs, 7);
      expect(costVsMain(build(center + 0.1, baseMs), main, CC).verdict).toBe("fail");
      expect(costVsMain(build(center + 0.02, baseMs), main, CC).verdict).toBe("pass");
    }
    // a camada B 2× mais cara no PR: falha
    const main = build(1.3, 65, 7), pr = build(1.3, 65);
    const rel = costVsMain({ a: pr.a, b: pr.b.map(x => x * 2) }, main, CC);
    expect(rel.median).toBeGreaterThan(1);
    expect(rel.verdict).toBe("fail");
  });

  it("main mais caro que o PR (otimização) passa", () => {
    expect(costVsMain(build(1.3, 36.3), build(1.45, 36.3, 7), CC).verdict).toBe("pass");
  });

  it("desfecho: falha da comparação reprova com ci_mode fail e só avisa com warn", () => {
    const pr = build(1.62, 36.3), main = build(1.52, 36.1, 7);
    const rel = costVsMain(pr, main, CC), abs = costVerdict(pr.a, pr.b, CC, K);
    expect(rel.verdict).toBe("fail");
    const f = vsMainOutcome(rel, abs, "fail", ctx);
    expect(f.failing).toBe(true);
    // o teto absoluto passado é anotado, nunca reprova sozinho
    expect(f.warnings).toHaveLength(1);
    expect(f.warnings[0]).toMatch(/razão absoluta do PR 1\.62×.*base 36\.3 ms\/quadro sem camadas \(main 36\.1\).*só aviso/);
    const w = vsMainOutcome(rel, abs, "warn", ctx);
    expect(w.failing).toBe(false);
    expect(w.warnings[0]).toMatch(/PR 1\.62× × main 1\.52× no mesmo job, diferença mediana \+0\.09, IC 95% \[\+0\.07, \+0\.14\]/);
    expect(w.warnings[0]).toMatch(/ci_mode warn não reprova/);
  });

  it("desfecho: teto absoluto passado com a comparação ok é só aviso; tudo ok não produz nada", () => {
    const pr = build(1.52, 36.3), main = build(1.52, 36.1, 7);
    const rel = costVsMain(pr, main, CC), abs = costVerdict(pr.a, pr.b, CC, K);
    expect(abs.verdict).toBe("fail");
    const out = vsMainOutcome(rel, abs, "fail", ctx);
    expect(out.failing).toBe(false);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/teto da CI 1\.50×: só aviso, o portão é a comparação com main \(issue #59\)/);
    const ok = build(1.3, 36.3), okMain = build(1.3, 36.1, 7);
    expect(vsMainOutcome(costVsMain(ok, okMain, CC), costVerdict(ok.a, ok.b, CC, K), "fail", ctx)).toEqual({ failing: false, warnings: [] });
    expect(() => vsMainOutcome(rel, abs, "off", ctx)).toThrow(/ci_mode inválido/);
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
  });
});
