// Custo das camadas na CI (D-44 b; docs/plano-construcao.md §7): lógica pura de tools/visual/cost-stats.mjs com os
// valores de data/balance.yaml (render.cost_check, render.layer_cost_factor). Casos: regressão certa (falha), só a
// mediana acima do teto (aviso), dentro do teto (passa), e a regressão deliberada (B 2× mais caro) falha.
import { describe, expect, it } from "vitest";
import { loadBalanceFile } from "@thehell/shared/node";
import { abbaOrder, bootstrapCi, costVerdict, judgeCost, median, mulberry32 } from "../../../tools/visual/cost-stats.mjs";

const balance = loadBalanceFile(new URL("../../../data/balance.yaml", import.meta.url).pathname);
const CC = balance.render.cost_check;
const K = balance.render.layer_cost_factor;

/** ms/quadro sem camadas de um runner lento da CI (~65 ms) e razões com ruído determinístico em torno de `center` */
function pairs(center: number, spread: number, seed = 7) {
  const r = mulberry32(seed), a: number[] = [], b: number[] = [];
  for (let i = 0; i < CC.pairs; i++) {
    const base = 65 * (1 + 0.1 * (r() - 0.5));
    a.push(base);
    b.push(base * (center + spread * (r() - 0.5)));
  }
  return { a, b };
}

describe("cost-stats (D-44 b)", () => {
  it("dados: pares, quadros, aquecimento, reamostragens, IC e semente vêm de render.cost_check; teto 1,4× intocado", () => {
    expect(CC).toEqual({ pairs: 21, frames: 32, warmup: 2, bootstrap_resamples: 2000, ci: 0.95, seed: 44 });
    expect(K).toBe(1.4);
  });

  it("ordem ABBA intercalada", () => {
    expect([0, 1, 2, 3].flatMap(i => abbaOrder(i)).join("")).toBe("ABBAABBA");
  });

  it("mediana com n ímpar e par", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("bootstrap determinístico: mesma semente, mesmo IC; o IC contém a mediana", () => {
    const { a, b } = pairs(1.3, 0.2);
    const ratios = a.map((x, i) => b[i] / x);
    const o = { resamples: CC.bootstrap_resamples, ci: CC.ci, seed: CC.seed };
    const c1 = bootstrapCi(ratios, o), c2 = bootstrapCi(ratios, o);
    expect(c1).toEqual(c2);
    expect(c1.lo).toBeLessThanOrEqual(c1.median);
    expect(c1.hi).toBeGreaterThanOrEqual(c1.median);
    expect(c1.hi - c1.lo).toBeGreaterThan(0);
  });

  it("decisão: falha só com o limite inferior acima do teto; aviso se só a mediana passar", () => {
    expect(judgeCost({ median: 1.5, lo: 1.41 }, K)).toBe("fail");
    expect(judgeCost({ median: 1.43, lo: 1.38 }, K)).toBe("warn");
    expect(judgeCost({ median: 1.4, lo: 1.3 }, K)).toBe("pass");
    expect(judgeCost({ median: 1.3, lo: 1.2 }, K)).toBe("pass");
  });

  it("passa: runner rápido da CI (razão ~1,30×)", () => {
    const { a, b } = pairs(1.3, 0.1);
    const c = costVerdict(a, b, CC, K);
    expect(c.hi).toBeLessThan(K);
    expect(c.verdict).toBe("pass");
  });

  it("aviso: runner lento da CI como o do PR #53 (mediana ~1,43×, ruído largo), sem falha", () => {
    const { a, b } = pairs(1.43, 0.35);
    const c = costVerdict(a, b, CC, K);
    expect(c.median).toBeGreaterThan(K);
    expect(c.lo).toBeLessThanOrEqual(K);
    expect(c.verdict).toBe("warn");
  });

  it("falha: regressão certa (razão ~1,6× com ruído pequeno)", () => {
    const { a, b } = pairs(1.6, 0.1);
    const c = costVerdict(a, b, CC, K);
    expect(c.lo).toBeGreaterThan(K);
    expect(c.verdict).toBe("fail");
  });

  it("regressão deliberada: a camada B 2× mais cara faz um runner que passava falhar", () => {
    const { a, b } = pairs(1.3, 0.1);
    expect(costVerdict(a, b, CC, K).verdict).toBe("pass");
    const c = costVerdict(a, b.map(x => x * 2), CC, K);
    expect(c.median).toBeGreaterThan(2 * 1.2);
    expect(c.verdict).toBe("fail");
  });

  it("pares incompletos são erro", () => {
    expect(() => costVerdict([1, 2], [1], CC, K)).toThrow();
  });
});
