// Custo das camadas na CI (D-44 b, opção a da margem do runner; docs/plano-construcao.md §7): lógica pura de
// tools/visual/cost-stats.mjs com os valores de data/balance.yaml (render.cost_check, render.layer_cost_factor).
// Falha só com o limite inferior do IC acima de layer_cost_factor × (1 + ci_runner_margin); aviso com a mediana acima
// de layer_cost_factor. Casos: passa, aviso (runner lento como o do PR #53), falha certa, regressão deliberada (B 2×
// mais caro) e medidas quebradas (erro, nunca "pass").
import { describe, expect, it } from "vitest";
import { loadBalanceFile } from "@thehell/shared/node";
import { abbaOrder, bootstrapCi, costOutcome, costThresholds, costVerdict, ghaWarning, judgeCost, median } from "../../../tools/visual/cost-stats.mjs";

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
    expect(CC).toEqual({ pairs: 21, frames: 32, warmup: 2, bootstrap_resamples: 2000, ci: 0.95, seed: 44, ci_runner_margin: 0.07, ci_mode: "warn" });
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
