// R8 passo 1 (D-46; GDD-v0.3 §8.2, §8.4, §9.1): quebra de loop com projétil/dash contando as voltas também com o
// alvo atrás do obstáculo (lembrado), dash ao reencontrar alvo ferido perto, patrulha ponderada pelo progresso e a
// variante "jogador iniciante" do simulador (cérebro por vaga).
import { describe, expect, it } from "vitest";
import {
  botBrainOf, choosePatrol, createGame, loopAt, makeConfig, newHunterAi, playHeadless, step, think, trackLoopMemory, NO_INPUT,
  type Difficulty, type Hunter, type SeenSurvivor,
} from "../src/index.ts";
import { aiCfg, b, map, normal, percept, seen } from "./ai-helpers.ts";

const hunter = (o: Partial<Hunter> = {}) => ({ atk: 1e9, dash: 1e9, projectile: 1e9, trap: 1e9, dashing: 0, windup: null, ...o }) as Hunter;

/** rota do loop "centro" (quadrado ±5 m), 1 m por ponto, 40 pontos por volta */
function route(laps: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const corners = [[-5, -5], [5, -5], [5, 5], [-5, 5]];
  for (let l = 0; l < laps; l++) for (let c = 0; c < 4; c++) {
    const [ax, az] = corners[c], [bx, bz] = corners[(c + 1) % 4];
    for (let k = 0; k < 10; k++) out.push({ x: ax + ((bx - ax) * k) / 10, z: az + ((bz - az) * k) / 10 });
  }
  return out;
}

/**
 * Alvo corre `laps` voltas no loop central, uma decisão por metro (0,1 s); o caçador o segue pela rota `lag` metros
 * atrás. Na metade de cada volta o alvo some atrás do obstáculo (fora do Percept, só lembrado).
 */
function loopChase(d: Difficulty, laps: number, lag = 8) {
  const c = aiCfg(d), ai = newHunterAi(), H = hunter({ projectile: 0, dash: 0 });
  const r = route(laps + 1);
  let first = -1;
  for (let k = lag; k < r.length; k++) {
    if (H.windup) break;
    const hidden = k % 40 >= 20;
    const self = { ...r[k - lag], a: 0 };
    think(c, H, ai, percept(hidden ? [] : [seen(0, r[k].x, r[k].z)], { t: k / b.ai.decision_hz, self }), { seed: 1 });
    if (H.windup && first < 0) first = k - lag;
  }
  return { first, H, ai };
}

describe("voltas no loop com o alvo atrás do obstáculo (§8.4)", () => {
  it("a contagem continua com o caçador enquanto a memória do alvo vale; memória vencida ou de outro alvo zera", () => {
    const ai = newHunterAi();
    ai.loop = { id: "centro", target: 0, acc: 0, last: Math.atan2(-5, 0), src: "target" };
    ai.memory = { id: 0, x: 0, z: -5, until: 10, vx: 0, vz: 0, ax: 0, az: 0 };
    trackLoopMemory(normal, ai, { x: 5, z: 0 }, 1); // fonte nova: só fixa o ângulo de partida
    expect(ai.loop!.acc).toBe(0);
    expect(ai.loop!.src).toBe("self");
    trackLoopMemory(normal, ai, { x: 0, z: 5 }, 2);
    expect(ai.loop!.acc).toBeCloseTo(Math.PI / 2, 10);
    trackLoopMemory(normal, ai, { x: 0, z: 5 }, 10); // memória vencida
    expect(ai.loop).toBeNull();
    ai.loop = { id: "centro", target: 1, acc: 3, last: 0, src: "target" };
    trackLoopMemory(normal, ai, { x: 5, z: 0 }, 2); // memória é de outro alvo
    expect(ai.loop).toBeNull();
    ai.loop = { id: "sumiu", target: 0, acc: 3, last: 0, src: "target" };
    trackLoopMemory(normal, ai, { x: 5, z: 0 }, 2); // loop fora do mapa
    expect(ai.loop).toBeNull();
  });
  it("Normal (partial) quebra o loop depois de 2 voltas mesmo com o alvo sumindo meia volta; telegraph ≥ telegraph_min", () => {
    const r = loopChase("normal", 3);
    expect(r.first).toBeGreaterThanOrEqual(b.ai.loop_partial_laps_before_break * 40 - 1);
    expect(r.first).toBeLessThan((b.ai.loop_partial_laps_before_break + 1) * 40);
    expect(["projectile", "dash"]).toContain(r.H.windup!.kind);
    expect(r.H.windup!.t).toBeGreaterThanOrEqual(b.hunter.telegraph_min);
  });
  it("Fácil (none) nunca quebra; Difícil (full) quebra na primeira volta", () => {
    expect(loopChase("easy", 3).first).toBe(-1);
    const hard = loopChase("hard", 1);
    expect(hard.first).toBeGreaterThanOrEqual(0);
    expect(hard.first).toBeLessThan(20);
  });
  it("sem percepção do alvo (só lembrado) não dispara projétil nem dash", () => {
    const c = aiCfg("hard"), ai = newHunterAi(), H = hunter();
    for (const t of [0, c.aiLevel.reaction]) think(c, H, ai, percept([seen(0, 5, 0)], { t, self: { x: 0, z: -12, a: 0 } }), { seed: 1 });
    expect(ai.mode).toBe("chase");
    H.projectile = 0; H.dash = 0;
    for (let k = 1; k < 40; k++) think(c, H, ai, percept([], { t: k / 10, self: { x: 0, z: -12, a: 0 } }), { seed: 1 });
    expect(ai.mode).toBe("chase"); // segue pela memória (12 s no Difícil)
    expect(H.windup).toBeNull();
    expect(H.projectile).toBe(0);
    expect(H.dash).toBe(0);
  });
});

describe("dash ao reencontrar alvo ferido perto (ai.dash_reacquire_dist)", () => {
  // corredor aberto a oeste do mapa: caçador em (−8, 16), alvo ao norte, com linha de visão e fora de loop
  const self = { x: -8, z: 16, a: 0 };
  function reacquire(o: { hp: number; d: number; hidden?: boolean; difficulty?: Difficulty }) {
    const c = aiCfg(o.difficulty ?? "normal"), ai = newHunterAi(), H = hunter({ projectile: 0, dash: 0 });
    const s: SeenSurvivor = seen(0, self.x, self.z + o.d, { hp: o.hp });
    expect(loopAt(c, s)).toBeNull();
    // perseguia o alvo e o perdeu de vista (memória valendo)
    ai.mode = "chase"; ai.memory = { id: 0, x: s.x, z: s.z, until: 20, vx: 0, vz: 0, ax: s.x, az: s.z };
    const lvl = c.aiLevel.reaction;
    if (!o.hidden) { ai.noticed = [{ id: 0, at: 0 }]; ai.target = 0; ai.seenTarget = 0; } // visto sem interrupção
    else {
      think(c, H, ai, percept([s], { t: 10, self }), { seed: 1 }); // reaparece: ainda no tempo de reação
      expect(H.windup).toBeNull();
    }
    think(c, H, ai, percept([s], { t: 10 + lvl, self }), { seed: 1 });
    return H.windup?.kind ?? null;
  }
  it("dado: 6 m ≈ percurso do dash + alcance do golpe, dentro da faixa de uso do dash", () => {
    const h = b.hunter, reach = h.dash.speed * h.dash.duration + h.melee.range;
    expect(b.ai.dash_reacquire_dist).toBe(6);
    expect(Math.abs(b.ai.dash_reacquire_dist - reach)).toBeLessThan(0.5);
    expect(b.ai.dash_reacquire_dist).toBeGreaterThan(h.dash.min);
    expect(b.ai.dash_reacquire_dist).toBeLessThanOrEqual(h.dash.max);
  });
  it("reencontro de alvo ferido a < 6 m: dash antes do projétil, com telegraph", () => {
    expect(reacquire({ hp: b.survivor.wounded_hp - 1, d: 5.5, hidden: true })).toBe("dash");
    expect(reacquire({ hp: b.survivor.wounded_hp - 1, d: 5.5, hidden: true, difficulty: "easy" })).toBe("dash"); // fora de loop vale em todas
  });
  it("alvo inteiro, longe (≥ 6 m) ou visto sem interrupção: o projétil vem primeiro (como antes)", () => {
    expect(reacquire({ hp: b.survivor.wounded_hp, d: 5.5, hidden: true })).toBe("projectile");
    expect(reacquire({ hp: b.survivor.wounded_hp - 1, d: 7, hidden: true })).toBe("projectile");
    expect(reacquire({ hp: b.survivor.wounded_hp - 1, d: 5.5, hidden: false })).toBe("projectile");
  });
  it("abaixo da faixa de uso do dash (hunter.dash.min) não há dash de reencontro", () => {
    expect(reacquire({ hp: b.survivor.wounded_hp - 1, d: b.hunter.dash.min - 0.5, hidden: true })).toBeNull();
  });
});

describe("patrulha ponderada pelo progresso (§8.2)", () => {
  const gens = (p: number[], done: boolean[] = []) => p.map((progress, i) => ({ x: [-22, 22, -22, 22][i], z: [-22, -22, 22, 22][i], progress, done: !!done[i], bonus: false }));
  it("frequência de cada gerador ∝ progresso (4.000 sorteios com o PRNG da partida, ±4σ)", () => {
    const w = [0.2, 0.4, 0.8, 0.6], total = w.reduce((s, x) => s + x, 0), n = 4000;
    const p = percept([], { gens: gens(w) }), rng = { seed: 123 }, counts = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) counts[choosePatrol(normal, rng, p, -1).gen]++;
    w.forEach((x, i) => {
      const q = x / total, sigma = Math.sqrt(n * q * (1 - q));
      expect(Math.abs(counts[i] - n * q)).toBeLessThan(4 * sigma);
    });
  });
  it("mesma semente → mesma sequência de destinos", () => {
    const p = percept([], { gens: gens([0.2, 0.4, 0.8, 0.6]) });
    const seq = (seed: number) => { const r = { seed }; return Array.from({ length: 50 }, () => choosePatrol(normal, r, p, -1).gen); };
    expect(seq(5)).toEqual(seq(5));
  });
  it("gerador de destino concluído no caminho ou início da pressão final: escolhe outro destino", () => {
    const H = hunter(), ai = newHunterAi();
    think(normal, H, ai, percept([], { gens: gens([0, 0, 0.6, 0]) }), { seed: 1 });
    expect(ai.patrol!.gen).toBe(2);
    think(normal, H, ai, percept([], { t: 10.1, gens: gens([0.2, 0, 1, 0], [false, false, true, false]) }), { seed: 1 });
    expect(ai.patrol!.gen).toBe(0);
    const keep = ai.patrol;
    think(normal, H, ai, percept([], { t: 10.2, gens: gens([0.2, 0, 1, 0.8], [false, false, true, false]) }), { seed: 1 });
    expect(ai.patrol).toBe(keep); // progresso mudou, destino válido: segue
    think(normal, H, ai, percept([], { t: 10.3, gens: gens([1, 1, 1, 1], [true, true, true, true]), finalPressure: true }), { seed: 1 });
    expect(ai.patrol!.gen).toBe(-1); // portão
  });
});

describe("variante \"jogador iniciante\" (cérebro por vaga, só no simulador)", () => {
  const novice = makeConfig(b, map, { ruleset: "v1", hunterBrain: "utility", botBrain: "competent", botBrainBySlot: { 0: "prototype" } });
  it("botBrainOf: a vaga sobreposta usa o cérebro dela; as outras, o padrão; o protótipo ignora", () => {
    expect([0, 1, 2].map(i => botBrainOf(novice, i))).toEqual(["prototype", "competent", "competent"]);
    expect(makeConfig(b, map).botBrainBySlot).toEqual({});
    const proto = makeConfig(b, map, { ruleset: "prototype", botBrainBySlot: { 0: "competent" } });
    expect(botBrainOf(proto, 0)).toBe("prototype");
    const allProto = makeConfig(b, map, { ruleset: "v1", hunterBrain: "basic", botBrain: "prototype", botBrainBySlot: { 1: "competent" } });
    expect(allProto.grid).not.toBeNull(); // um bot competente já pede a grade
  });
  it("na partida: s0 joga com o bot do protótipo (sem estado de IA), os outros com o competente", () => {
    const g = createGame(novice, "Atacador", 7);
    g.survivors[0].bot = true;
    for (let i = 0; i < 120; i++) step(novice, g, NO_INPUT);
    expect(g.survivors[0].ai).toBeUndefined();
    expect(g.survivors.slice(1).every(s => s.ai)).toBe(true);
  });
  it("determinística e diferente da partida padrão", () => {
    const a = playHeadless(novice, 3), again = playHeadless(novice, 3);
    expect(again).toEqual(a);
    const dflt = playHeadless(makeConfig(b, map, { ruleset: "v1", hunterBrain: "utility", botBrain: "competent" }), 3);
    expect(dflt).not.toEqual(a);
  });
});
