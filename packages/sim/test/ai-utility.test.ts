// R3 — escolha de alvo por utilidade (GDD-v0.3 §8.3; fórmula do GDD-v0.2 §8.3 e Apêndice C).
// Aceite: 10 cenários fixos escolhem o alvo esperado; troca não alterna de alvo mais de 1 vez por segundo.
// Cenários na dificuldade Normal (raio de detecção 11 m), caçador na origem.
import { describe, expect, it } from "vitest";
import { chooseTarget, CLASSES, createGame, makeConfig, newHunterAi, NO_INPUT, STEP, step, think, utilityScore, utilityTerms, type SeenSurvivor } from "../src/index.ts";
import { b, map, normal, percept, seen } from "./ai-helpers.ts";
import { withMapFlags } from "./helpers.ts";

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
    expect(b.ai.protected_hold).toBe(1); // D-52 (LACUNA): 1 s = o aceite do §8.3
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

// Correção do aceite do §8.3 com a D-35 (alvo lembrado segura a histerese) e D-52 (histerese do "protegido").
describe("aceite §8.3 com alvo lembrado (D-35) e protegido com histerese (D-52)", () => {
  const hz = b.ai.decision_hz;
  /** roda `think` numa linha do tempo de leituras; devolve as trocas de alvo perseguido (visto ou lembrado) */
  function run(frames: (t: number) => SeenSurvivor[], secs: number) {
    const ai = newHunterAi(), H = { atk: 1e9, dash: 1e9, projectile: 1e9, trap: 1e9, dashing: 0, windup: null } as never;
    const pursued: { t: number; id: number }[] = [];
    let last = -1;
    for (let k = 0; k <= secs * hz; k++) {
      const t = k / hz;
      think(normal, H, ai, percept(frames(t), { t }), { seed: 1 });
      const now = ai.target >= 0 ? ai.target : ai.memory && ai.memory.until > t ? ai.memory.id : -1;
      if (now >= 0 && now !== last) { pursued.push({ t, id: now }); last = now; }
    }
    return { ai, pursued };
  }
  /** no máximo 1 troca por segundo e nenhuma volta ao alvo anterior em menos de 1 s */
  function expectAcceptance(pursued: { t: number; id: number }[]) {
    for (let i = 2; i < pursued.length; i++) expect(pursued[i].t - pursued[i - 1].t).toBeGreaterThanOrEqual(1 - 1e-9);
    for (let i = 2; i < pursued.length; i++) if (pursued[i].id === pursued[i - 2].id) expect(pursued[i].t - pursued[i - 1].t).toBeGreaterThanOrEqual(1 - 1e-9);
  }

  it("alvo sai do cone e outro aparece: segue o lembrado e não troca (antes trocava e voltava em < 1 s)", () => {
    // A a 3 m (0,255 + isolado 0,15 = 0,405) até 2 s; some de 2 a 2,6 s (atrás do pilar) e volta. B aparece a 4 m em
    // 2 s (0,223 + 0,15 = 0,373): sem a correção virava o alvo assim que passasse o tempo de reação e perdia para A
    // na volta. Diferença menor que a margem: o caçador segue A pela memória.
    const A = seen(0, 3, 0), B = seen(1, -4, 0);
    const { ai, pursued } = run(t => (t < 2 || t >= 2.6 ? [A] : []).concat(t >= 2 ? [B] : []), 4);
    expect(pursued.map(x => x.id)).toEqual([0]);
    expect(ai.target).toBe(0);
    expect(ai.mode).toBe("chase");
    expectAcceptance(pursued);
  });
  it("alvo lembrado cede a quem supera o último placar dele pela margem", () => {
    // B ferido a 2 m (0,286 + 0,20 + 0,15 = 0,636) contra o último placar de A (0,405): troca uma vez, sem voltar
    const A = seen(0, 3, 0), B = seen(1, -2, 0, { hp: 20 });
    const { pursued } = run(t => (t < 2 || t >= 2.6 ? [A] : []).concat(t >= 2 ? [B] : []), 4);
    expect(pursued.map(x => x.id)).toEqual([0, 1]);
    expectAcceptance(pursued);
  });
  it("Atacador passa 0,5 s ao lado do alvo: o protegido não liga e o caçador não troca", () => {
    // A a 3 m é o alvo; B a 5 m do outro lado; Atacador C encosta em A (2 m) de 3 s a 3,5 s e se afasta para longe
    const A = seen(0, 3, 0), B = seen(1, -5, 0), far = seen(2, 0, 9, { cls: "Atacador" }), near = seen(2, 3, 2, { cls: "Atacador" });
    const { pursued } = run(t => [A, B, t >= 3 && t < 3.5 ? near : far], 6);
    expect(pursued.map(x => x.id)).toEqual([0]);
    expectAcceptance(pursued);
  });
  it("Atacador fica ao lado do alvo: troca 1 vez depois de ai.protected_hold e não volta em menos de 1 s", () => {
    // C ao lado de A de 3 s a 5 s: o protegido liga em 4 s (−0,25 > margem) e o caçador troca para B; C sai em 5 s e
    // o protegido só desliga em 6 s
    const A = seen(0, 3, 0), B = seen(1, -3.5, 0), far = seen(2, 0, 9, { cls: "Atacador" }), near = seen(2, 3, 2, { cls: "Atacador" });
    const { pursued } = run(t => [A, B, t >= 3 && t < 5 ? near : far], 8);
    expect(pursued[0].id).toBe(0);
    expect(pursued[1]).toEqual({ id: 1, t: expect.closeTo(3 + b.ai.protected_hold, 6) });
    expectAcceptance(pursued);
  });
  it("partidas reais do Difícil com pilares (5 sementes): nenhuma volta ao alvo anterior em menos de 1 s", () => {
    const c0 = makeConfig(withMapFlags(b, { fifth_generator: true, short_loop_pillars: true, side_exit: true }), map, { ruleset: "v1", hunterBrain: "utility", botBrain: "competent", difficulty: "hard" });
    let switches = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const ev: { t: number; target: number; from: number }[] = [];
      const c = { ...c0, traceTarget: (e: { t: number; target: number; from: number }) => { ev.push(e); } };
      const g = createGame(c, CLASSES[seed % CLASSES.length], seed);
      g.survivors[0].bot = true;
      for (let i = 0; i < Math.ceil(b.match.hard_time_limit / STEP) && !g.over; i++) { step(c, g, NO_INPUT); g.events.length = 0; }
      switches += ev.length;
      for (let i = 1; i < ev.length; i++) {
        if (ev[i].target === ev[i - 1].from) expect(ev[i].t - ev[i - 1].t, `semente ${seed}`).toBeGreaterThanOrEqual(1 - 1e-9);
      }
    }
    expect(switches).toBeGreaterThan(0); // o gancho dispara (o teste não passa por vazio)
  }, 60_000);
});
