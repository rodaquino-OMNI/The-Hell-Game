// R3 — percepção do caçador (GDD-v0.3 §8.1; GDD-v0.2 §8.4): snapshot filtrado a 10 Hz, visão (cone + linha de visão),
// revelação, audição, memória e tempo de reação por dificuldade. A IA só lê o Percept: não vê através de parede.
import { describe, expect, it } from "vitest";
import { createGame, perceive, step, NO_INPUT, type Difficulty } from "../src/index.ts";
import { chaseMemoryGoal } from "../src/ai/hunter.ts";
import { aiCfg, aiGame, b, normal, play } from "./ai-helpers.ts";
const dist = (a: { x: number; z: number }, c: { x: number; z: number }) => Math.hypot(a.x - c.x, a.z - c.z);

describe("frequência (ai.perception_hz, ai.decision_hz)", () => {
  it("lê e decide a 10 Hz: a leitura só muda a cada 1/perception_hz", () => {
    const g = aiGame();
    const ai = g.hunter.ai!;
    step(normal, g, NO_INPUT);
    const first = ai.percept!;
    expect(first.t).toBeCloseTo(1 / 60, 10);
    const frames = Math.round(60 / b.ai.perception_hz);
    for (let i = 1; i < frames; i++) { step(normal, g, NO_INPUT); expect(ai.percept).toBe(first); }
    step(normal, g, NO_INPUT);
    expect(ai.percept).not.toBe(first);
    expect(ai.percept!.t).toBeCloseTo(first.t + 1 / b.ai.perception_hz, 10);
  });
});

describe("snapshot filtrado (perceive)", () => {
  it("cenários fixos: à frente no raio entra; fora do cone, além do raio e atrás de parede não entram", () => {
    const g = aiGame(normal, { x: -8, z: 16 }, Math.PI); // olha para +z
    const P = g.survivors[0];
    const at = (x: number, z: number) => { P.x = x; P.z = z; return perceive(normal, g, null).survivors.map(s => s.id); };
    expect(at(-8, 26)).toEqual([0]); // 10 m à frente
    expect(at(-8 + 5, 20)).toEqual([]); // 51° do eixo: fora do cone de 90°
    expect(at(-8, 27.5)).toEqual([]); // 11,5 m: além do raio Normal (11 m)
    g.hunter.x = 0; g.hunter.z = -4.6; P.x = 0; P.z = 4.6; // bloco central entre os dois
    expect(perceive(normal, g, null).survivors).toEqual([]);
  });
  it("revelado entra mesmo atrás de parede, marcado como não visível; preso e morto não entram", () => {
    const g = aiGame(normal, { x: 0, z: -4.6 }, Math.PI);
    const P = g.survivors[0]; P.x = 0; P.z = 4.6; P.revealed = 2;
    expect(perceive(normal, g, null).survivors).toMatchObject([{ id: 0, visible: false }]);
    P.st = "cage";
    expect(perceive(normal, g, null).survivors).toEqual([]);
  });
  it("contato (soma dos raios) conta como visto mesmo nas costas", () => {
    const g = aiGame(normal, { x: -8, z: 16 }, 0);
    const P = g.survivors[0]; P.x = -8; P.z = 16 + b.hunter.radius + b.survivor.radius - 0.05;
    expect(perceive(normal, g, null).survivors).toMatchObject([{ id: 0, visible: true }]);
  });
  it("velocidade estimada entre duas leituras; geradores, portão e pressão final são públicos; ruído é copiado", () => {
    const g = aiGame();
    const P = g.survivors[0]; P.x = -8; P.z = 24;
    const p0 = perceive(normal, g, null);
    expect(p0.survivors[0]).toMatchObject({ vx: 0, vz: 0, antiTunnel: false, hp: 100, cls: "Curandeiro" });
    g.t += 0.1; P.x += 0.3; P.z -= 0.4;
    const p1 = perceive(normal, g, p0);
    expect(p1.survivors[0].vx).toBeCloseTo(3, 6);
    expect(p1.survivors[0].vz).toBeCloseTo(-4, 6);
    g.gens[0].n = 2; g.gens[1].done = true; g.gateStarted = true;
    g.hunter.ai!.heard = { x: 1, z: 2, at: 0.5, dur: 8 };
    const p2 = perceive(normal, g, p1);
    expect(p2.gens[0].progress).toBeCloseTo(2 / b.generator.puzzles_per_generator, 10);
    expect(p2.gens[1].done).toBe(true);
    expect(p2.finalPressure).toBe(true);
    expect(p2.gate).toEqual(g.arena.gate);
    expect(p2.heard).toEqual({ x: 1, z: 2, at: 0.5, dur: 8 });
    expect(p2.heard).not.toBe(g.hunter.ai!.heard); // cópia: a decisão não altera o estado por referência
  });
});

describe("na partida: a IA não vê através de parede", () => {
  it("alvo atrás do bloco central nunca vira alvo; revelado vira alvo depois do tempo de reação", () => {
    const g = aiGame(normal, { x: 0, z: -4.6 }, Math.PI);
    const P = g.survivors[0]; P.x = 0; P.z = 4.6;
    g.hunter.ai!.patrol = { x: 0, z: -10, gen: -1 }; // patrulha para longe (norte)
    play(normal, g, 1);
    expect(g.hunter.target).toBe(-1);
    expect(g.hunter.ai!.mode).toBe("patrol");
    P.revealed = 5;
    play(normal, g, b.ai.by_difficulty.normal.reaction + 0.25);
    expect(g.hunter.target).toBe(0);
    expect(g.hunter.ai!.mode).toBe("chase");
  });
});

describe("tempo de reação por dificuldade (GDD-v0.2 §8.4: 0,6 / 0,4 / 0,25 / 0,15 s)", () => {
  for (const d of ["easy", "normal", "hard", "nightmare"] as Difficulty[]) {
    it(`${d}: só persegue depois de ai.by_difficulty.${d}.reaction`, () => {
      const c = aiCfg(d), reaction = b.ai.by_difficulty[d].reaction;
      const g = aiGame(c, { x: -8, z: 16 }, Math.PI);
      const P = g.survivors[0]; P.x = -8; P.z = 22;
      g.hunter.ai!.patrol = { x: -8, z: 29, gen: -1 }; // anda na direção do alvo (continua olhando para ele)
      let first = -1;
      for (let i = 0; i < 120 && first < 0; i++) { step(c, g, NO_INPUT); if (g.hunter.target === 0) first = g.t; }
      const seenAt = 1 / 60; // primeira leitura
      expect(first - seenAt).toBeGreaterThanOrEqual(reaction - 1e-9);
      expect(first - seenAt).toBeLessThanOrEqual(reaction + 1 / b.ai.decision_hz + 1e-9);
    });
  }
});

describe("memória da última posição (ai.by_difficulty.*.memory) e audição (ai.hearing_investigate_time)", () => {
  it("Difícil (D-35): ao perder a linha de visão segue em Perseguir pela memória (12 s), depois investiga e patrulha", () => {
    const hard = aiCfg("hard"), mem = b.ai.by_difficulty.hard.memory;
    expect(mem).not.toBe(b.ai.hearing_investigate_time);
    const g = aiGame(hard, { x: -8, z: 16 }, Math.PI);
    const P = g.survivors[0]; P.x = -8; P.z = 23;
    g.hunter.ai!.patrol = { x: -8, z: 29, gen: -1 };
    play(hard, g, 0.5);
    expect(g.hunter.ai!.mode).toBe("chase");
    const last = { x: P.x, z: P.z }, tLast = g.hunter.ai!.percept!.t;
    P.x = 25; P.z = -25; // some de vista
    play(hard, g, 0.25);
    const ai = g.hunter.ai!;
    expect(ai.mode).toBe("chase");
    expect(ai.target).toBe(-1);
    expect(ai.memory).toMatchObject({ id: P.id, until: tLast + mem });
    expect(dist(ai.memory!, last)).toBeLessThanOrEqual(b.ai.chase_projection + 1e-9); // última posição ou projeção da fuga
    play(hard, g, mem - 0.5);
    expect(ai.mode).toBe("chase");
    play(hard, g, 0.6);
    expect(ai.mode).toBe("investigate");
    expect(ai.investigate).toMatchObject({ x: ai.memory!.x, z: ai.memory!.z });
    expect(g.hunter.alert).toEqual({ x: ai.memory!.x, z: ai.memory!.z });
    play(hard, g, b.ai.hearing_investigate_time + 0.2);
    expect(ai.mode).toBe("patrol");
  });
  it("D-35: perseguindo pela memória, ao chegar à última posição projeta a fuga (ai.chase_projection)", () => {
    const rng = { seed: 5 };
    const m = { id: 0, x: -8, z: 22, until: 100, vx: 0, vz: 4, ax: -8, az: 22 };
    chaseMemoryGoal(normal, rng, { x: -8, z: 16 }, m); // ainda longe: nada muda
    expect(m).toMatchObject({ x: -8, z: 22 });
    chaseMemoryGoal(normal, rng, { x: -8, z: 21 }, m); // chegou: projeta 6 m na direção da última velocidade
    expect(m.x).toBeCloseTo(-8, 0);
    expect(m.z).toBeCloseTo(22 + b.ai.chase_projection, 0);
    expect(m).toMatchObject({ ax: m.x, az: m.z });
  });
  it("D-35 (revisão M2): sem projeção possível (alvo parado ou parede à frente) vasculha em volta, não fica parado", () => {
    const rng = { seed: 5 };
    const still = { id: 0, x: -8, z: 22, until: 100, vx: 0, vz: 0, ax: -8, az: 22 };
    chaseMemoryGoal(normal, rng, { x: -8, z: 22 }, still);
    expect(dist(still, { x: -8, z: 22 })).toBeGreaterThan(b.ai.patrol_reach); // próximo ponto de vasculha
    expect(dist(still, { x: still.ax, z: still.az })).toBeLessThanOrEqual(b.ai.search_radius + b.nav.fallback_grid);
    const wall = { id: 0, x: -8, z: 29.4, until: 100, vx: 0, vz: 4, ax: -8, az: 29.4 };
    chaseMemoryGoal(normal, rng, { x: -8, z: 29 }, wall); // parede à frente: a projeção acaba e vira vasculha
    expect(wall.vz).toBe(0);
    expect(wall.z).toBeLessThan(29.4);
    expect(dist(wall, { x: -8, z: 29.4 })).toBeLessThanOrEqual(b.ai.search_radius + b.nav.fallback_grid);
    // na partida: o caçador que persegue pela memória um alvo parado atrás da parede segue andando até ela expirar
    const g = aiGame(aiCfg("hard"), { x: -8, z: 16 }, Math.PI), P = g.survivors[0];
    P.x = -8; P.z = 23; g.hunter.ai!.patrol = { x: -8, z: 29, gen: -1 };
    play(aiCfg("hard"), g, 0.5);
    P.x = 25; P.z = -25;
    const path: number[] = [];
    for (let i = 0; i < 60 * (b.ai.by_difficulty.hard.memory - 1) && g.hunter.ai!.mode === "chase"; i++) {
      const x = g.hunter.x, z = g.hunter.z; play(aiCfg("hard"), g, 1 / 60); path.push(Math.hypot(g.hunter.x - x, g.hunter.z - z));
    }
    const lastSecond = path.slice(-60).reduce((a, c) => a + c, 0);
    expect(lastSecond).toBeGreaterThan(1); // andou no último segundo da perseguição pela memória
  });
  it("ruído no raio vira investigação depois do tempo de reação; fora do raio, nada", () => {
    const g = aiGame(normal, { x: -8, z: 16.5 }, 0); // de costas para o jogador
    const P = g.survivors[0]; P.x = -8; P.z = 26; // 9,5 m: dentro do raio de corrida (10 m)
    g.hunter.ai!.patrol = { x: -8, z: 5, gen: -1 };
    const spot = { x: P.x, z: P.z }; // o ruído sai da posição antes do passo
    step(normal, g, { ...NO_INPUT, strafe: 1, run: true });
    expect(g.hunter.ai!.heard).toMatchObject(spot);
    play(normal, g, 0.2);
    expect(g.hunter.ai!.mode).toBe("patrol"); // ainda reagindo (0,4 s)
    play(normal, g, 0.4);
    expect(g.hunter.ai!.mode).toBe("investigate");
    expect(g.hunter.ai!.investigate).toMatchObject(spot);
    expect(g.hunter.ai!.heard).toBeNull();
    const far = aiGame(normal, { x: -8, z: 15.5 }, 0); // 10,5 m
    far.survivors[0].x = -8; far.survivors[0].z = 26; far.hunter.ai!.patrol = { x: -8, z: 5, gen: -1 };
    step(normal, far, { ...NO_INPUT, strafe: 1, run: true });
    play(normal, far, 1);
    expect(far.hunter.ai!.heard).toBeNull();
    expect(far.hunter.ai!.mode).toBe("patrol");
  });
  it("revelação de gerador concluído: global (padrão, D-21) chega como ruído; local não alcança o caçador longe", () => {
    const run = (global: boolean) => {
      const c = aiCfg("normal", {});
      const cfg = { ...c, balance: { ...c.balance, generator: { ...c.balance.generator, completed_reveal_global: global } } };
      const g = createGame(cfg, "Mecânico", 43);
      for (const s of g.survivors) if (s.bot) s.st = "dead";
      g.hunter.x = 25; g.hunter.z = 25; g.hunter.stun = 1e9;
      const P = g.survivors[0]; P.x = -22; P.z = -19.5; g.gens[0].n = b.generator.puzzles_per_generator - 1;
      step(cfg, g, { ...NO_INPUT, ability: true });
      expect(g.gens[0].done).toBe(true);
      return g.hunter.ai!.heard;
    };
    expect(b.generator.completed_reveal_global).toBe(true);
    expect(run(true)).toMatchObject({ x: -22, z: -22, dur: b.generator.completed_reveal });
    expect(run(false)).toBeNull();
  });
});
