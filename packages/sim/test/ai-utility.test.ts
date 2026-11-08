// R3 — escolha de alvo por utilidade (GDD-v0.3 §8.3; fórmula do GDD-v0.2 §8.3 e Apêndice C).
// Aceite: 10 cenários fixos escolhem o alvo esperado; troca não alterna de alvo mais de 1 vez por segundo.
// Cenários na dificuldade Normal (raio de detecção 11 m), caçador na origem.
import { describe, expect, it } from "vitest";
import { chooseTarget, newHunterAi, think, utilityScore, utilityTerms, type SeenSurvivor } from "../src/index.ts";
import { b, normal, percept, seen } from "./ai-helpers.ts";

const w = b.ai.target_weights, R = normal.detectRadius;
const pick = (all: SeenSurvivor[], current = -1, o = {}) => chooseTarget(normal, percept(all, o), all, current)!;
/** gerador público na posição dada e progresso (0..1) */
const gen = (x: number, z: number, progress: number, done = false) => ({ x, z, progress, done, bonus: false });

describe("dados do §8.3", () => {
  it("pesos, margem e raios vêm de ai.* (0,35 / 0,25 / 0,20 / 0,15 / −0,25; 0,15; 8 m; 4 m; vida < 40)", () => {
    expect(w).toEqual({ proximity: 0.35, generator_progress: 0.25, injured: 0.2, isolated: 0.15, protected: -0.25 });
    expect(b.ai.target_switch_margin).toBe(0.15);
    expect(b.ai.isolated_radius).toBe(8);
    expect(b.ai.protected_radius).toBe(4);
    expect(b.survivor.wounded_hp).toBe(40);
  });
  it("termos conforme as definições do §8.3", () => {
    const a = seen(0, 0, 5.5, { hp: 39 }), c = seen(1, 0, 8.5, { cls: "Atacador" });
    const t = utilityTerms(normal, percept([a, c], { gens: [gen(1, 5.5, 0.6)] }), a);
    expect(t).toEqual({ proximity: 1 - 5.5 / R, progress: 0.6, injured: 1, isolated: 0, protected: 1 });
    expect(utilityScore(normal, t)).toBeCloseTo(0.35 * (1 - 5.5 / R) + 0.25 * 0.6 + 0.2 - 0.25, 12);
  });
});

describe("10 cenários fixos de utilidade", () => {
  it("1. ferido mais longe vence saudável mais perto (A a 3 m, B ferido a 6 m)", () => {
    const A = seen(0, 0, 3), B = seen(1, 12, 0, { hp: 30 });
    // A: 0,35·(1 − 3/11) + 0,15 = 0,405; B: 0,35·0 (12 m, além do raio) + 0,20 + 0,15 = 0,35 → A.
    // Com B a 6 m (a 6,7 m de A: nenhum isolado): A 0,255; B 0,35·(1 − 6/11) + 0,20 = 0,359 → B
    expect(utilityScore(normal, utilityTerms(normal, percept([A, B]), A))).toBeCloseTo(0.405, 3);
    expect(pick([A, B]).id).toBe(0);
    expect(pick([A, seen(1, 6, 0, { hp: 30 })]).id).toBe(1);
  });
  it("2. o mais próximo vence quando o resto é igual", () => {
    expect(pick([seen(0, 0, 7), seen(1, 2, 0)]).id).toBe(1);
  });
  it("3. protegido é penalizado: perto de um Atacador perde para outro sozinho à mesma distância", () => {
    const A = seen(0, 5, 0), atk = seen(2, 5, 2, { cls: "Atacador" }), B = seen(1, -5, 0);
    expect(chooseTarget(normal, percept([A, atk, B]), [A, B], -1)!.id).toBe(1);
    expect(utilityTerms(normal, percept([A, atk, B]), A).protected).toBe(1);
  });
  it("4. protegido só por Atacador: perto de Curandeiro não é protegido (mas deixa de ser isolado)", () => {
    const A = seen(0, 5, 0), ally = seen(2, 5, 2, { cls: "Curandeiro" });
    const t = utilityTerms(normal, percept([A, ally]), A);
    expect(t.protected).toBe(0);
    expect(t.isolated).toBe(0);
  });
  it("5. isolado é bonificado: sozinho a 5 m vence acompanhado a 4 m", () => {
    const A = seen(0, 4, 0), friend = seen(2, 4, 7), B = seen(1, -5, 0);
    expect(chooseTarget(normal, percept([A, friend, B]), [A, B], -1)!.id).toBe(1);
  });
  it("6. gerador mais avançado: quem trabalha no gerador a 80% vence quem trabalha no de 20%", () => {
    const A = seen(0, 6, 0), B = seen(1, -6, 0);
    const p = percept([A, B], { gens: [gen(7, 0, 0.8), gen(-7, 0, 0.2)] });
    expect(chooseTarget(normal, p, [A, B], -1)!.id).toBe(0);
    const q = percept([A, B], { gens: [gen(7, 0, 0.2), gen(-7, 0, 0.8)] });
    expect(chooseTarget(normal, q, [A, B], -1)!.id).toBe(1);
  });
  it("7. gerador concluído ou longe (além do alcance de interação) não conta como trabalho", () => {
    const A = seen(0, 6, 0);
    expect(utilityTerms(normal, percept([A], { gens: [gen(7, 0, 1, true)] }), A).progress).toBe(0);
    const far = b.prototype_extras.interact_range.generator + 0.1;
    expect(utilityTerms(normal, percept([A], { gens: [gen(6 + far, 0, 0.8)] }), A).progress).toBe(0);
  });
  it("8. histerese: diferença menor que 0,15 não troca o alvo atual", () => {
    // A a 3 m é o atual (0,35·(1 − 3/11) = 0,255; os dois a 3,4 m um do outro, nenhum isolado);
    // B a 1,5 m (0,35·(1 − 1,5/11) = 0,302): +0,048 < 0,15 → fica A
    const A = seen(0, 3, 0), B = seen(1, 0, 1.5);
    expect(pick([A, B]).id).toBe(1);
    expect(pick([A, B], 0)).toEqual({ id: 0, score: expect.closeTo(0.35 * (1 - 3 / R), 10) });
  });
  it("9. histerese: diferença maior que 0,15 troca", () => {
    // A a 3 m (0,255) é o atual; B ferido a 1,5 m (0,302 + 0,20 = 0,502): +0,248 > 0,15 → troca para B
    const A = seen(0, 3, 0), B = seen(1, 0, 1.5, { hp: 20 });
    expect(pick([A, B], 0).id).toBe(1);
  });
  it("10. alvo atual que deixou de ser candidato não segura a histerese; empate fica com o menor id", () => {
    const A = seen(0, 3, 0), B = seen(1, 0, 3);
    expect(pick([A, B], 5).id).toBe(0); // atual (5) fora dos candidatos
    expect(pick([B, A]).id).toBe(0); // empate exato → menor id, independente da ordem
  });
  it("vida exatamente 40 não é ferido (abaixo de 40); proximidade limitada a [0, 1]", () => {
    expect(utilityTerms(normal, percept([seen(0, 1, 0, { hp: 40 })]), seen(0, 1, 0, { hp: 40 })).injured).toBe(0);
    const far = seen(0, 30, 0), on = seen(1, 0, 0);
    expect(utilityTerms(normal, percept([far]), far).proximity).toBe(0);
    expect(utilityTerms(normal, percept([on]), on).proximity).toBe(1);
    expect(chooseTarget(normal, percept([]), [], -1)).toBeNull();
  });
});

describe("troca de alvo não alterna mais de 1 vez por segundo (aceite §8.3)", () => {
  it("dois alvos com placares que se cruzam a cada decisão: no máximo 1 troca por segundo", () => {
    const ai = newHunterAi(), H = { atk: 1e9, dash: 1e9, projectile: 1e9, trap: 1e9, dashing: 0, windup: null } as never;
    let switches = 0, last = -1;
    const hz = b.ai.decision_hz, secs = 10;
    for (let k = 0; k < secs * hz; k++) {
      // os dois oscilam ±0,5 m em volta de 4 m, em fase oposta: placar alterna com diferença ≈ 0,03
      const d = 0.5 * (k % 2 ? 1 : -1);
      const p = percept([seen(0, 4 + d, 0), seen(1, -(4 - d), 0)], { t: k / hz });
      think(normal, H, ai, p, { seed: 1 });
      if (ai.target !== last && last !== -1) switches++;
      last = ai.target;
    }
    expect(last).not.toBe(-1);
    expect(switches).toBeLessThanOrEqual(secs);
    expect(switches).toBe(0);
  });
});
