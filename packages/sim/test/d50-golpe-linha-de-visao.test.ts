// D-50 (docs/plano-construcao.md §7; supervisão por delegação do Rodrigo, 09/11/2026): no ruleset v1 o golpe corpo a
// corpo do caçador exige linha de visão entre atacante e alvo, com a mesma função da percepção (`lineOfSight`,
// perception.ts). Cenário: pilar leste do mapa v1 (`maps.v1.short_loop_pillars`, caixa 1 × 1 m em (10, 0)), caçador
// a oeste e sobrevivente ao norte, em lados opostos da quina, a ~1,45 m entre centros (< hunter.melee.range = 1,8 m).
// Controle: a mesma distância e o mesmo deslocamento num ponto aberto do mapa. O protótipo não muda (parity.test.ts).
import { describe, expect, it } from "vitest";
import { createGame, makeConfig, newHunterAi, step, think, NO_INPUT, type GameState, type Hunter, type SimConfig } from "../src/index.ts";
import { lineOfSight } from "../src/perception.ts";
import { percept, seen } from "./ai-helpers.ts";
import { balance as b, map, SPOT } from "./helpers.ts";

const PILLARS = { short_loop_pillars: true } as const;
const basic = makeConfig(b, map, { ruleset: "v1", mapFlags: PILLARS, hunterBrain: "basic", botBrain: "prototype" });
const utility = makeConfig(b, map, { ruleset: "v1", mapFlags: PILLARS, hunterBrain: "utility", botBrain: "prototype" });

// deslocamento caçador → alvo: 1,01 m em x e 1,04 m em z (≈ 1,45 m)
const OFF = { x: 1.01, z: 1.04 };
// atrás da quina noroeste do pilar (9,5; 0,5): caçador encostado na face oeste, alvo encostado na face norte
const CORNER = { x: 8.99, z: -0.08 };
const OPEN = { x: SPOT.x, z: SPOT.z };

/** partida v1 com bots fora, alvo revelado (posição conhecida mesmo sem visão) e só o golpe disponível */
function scene(c: SimConfig, at: { x: number; z: number }): GameState {
  const g = createGame(c, "Curandeiro", 43);
  for (const s of g.survivors) if (s.bot) s.st = "dead";
  g.reveal = 1e9;
  const H = g.hunter, P = g.survivors[0];
  H.x = at.x; H.z = at.z; H.a = Math.atan2(-OFF.x, -OFF.z); // olhando para o alvo
  H.atk = 0; H.dash = 1e9; H.projectile = 1e9; H.trap = 1e9;
  P.x = at.x + OFF.x; P.z = at.z + OFF.z; P.a = 0; P.revealed = 1e9;
  return g;
}
const gap = (g: GameState) => Math.hypot(g.survivors[0].x - g.hunter.x, g.survivors[0].z - g.hunter.z);
const sight = (c: SimConfig, g: GameState) => lineOfSight(c.map, g.hunter, g.survivors[0]);

describe("D-50: golpe do caçador exige linha de visão (ruleset v1)", () => {
  it("o cenário: mesma distância (~1,45 m < alcance), sem visão pela quina e com visão no aberto", () => {
    const blocked = scene(basic, CORNER), open = scene(basic, OPEN);
    expect(gap(blocked)).toBeCloseTo(1.45, 2);
    expect(gap(open)).toBeCloseTo(gap(blocked), 10);
    expect(gap(blocked)).toBeLessThan(b.hunter.melee.range);
    expect(sight(basic, blocked)).toBe(false);
    expect(sight(basic, open)).toBe(true);
    // o pilar é o que bloqueia: sem ele (flag desligada) a mesma posição tem visão
    const off = makeConfig(b, map, { ruleset: "v1", mapFlags: { short_loop_pillars: false } });
    expect(lineOfSight(off.map, blocked.hunter, blocked.survivors[0])).toBe(true);
  });

  describe("caçador basic (R1, game.ts)", () => {
    it("não prepara o golpe através da quina; prepara com visão livre", () => {
      const blocked = scene(basic, CORNER), open = scene(basic, OPEN);
      step(basic, blocked, NO_INPUT); step(basic, open, NO_INPUT);
      expect(blocked.hunter.target).toBe(blocked.survivors[0].id); // o alvo está percebido (revelado)
      expect(blocked.hunter.windup).toBeNull();
      expect(open.hunter.windup).toMatchObject({ kind: "melee" });
    });
    it("golpe que sai no fim do preparo: sem visão NÃO atinge (recarga gasta); com visão atinge", () => {
      for (const [at, hits] of [[CORNER, false], [OPEN, true]] as const) {
        const g = scene(basic, at), P = g.survivors[0];
        g.hunter.windup = { kind: "melee", t: 1 / 240, total: b.hunter.telegraph_min };
        step(basic, g, NO_INPUT);
        expect(sight(basic, g)).toBe(hits); // ainda em lados opostos da quina depois do passo
        expect(P.hp).toBe(hits ? 100 - b.hunter.melee.damage : 100);
        expect(g.hunter.atk).toBeGreaterThan(0);
      }
    });
  });

  describe("caçador utility (R3, ai/hunter.ts)", () => {
    const H0 = (at: { x: number; z: number }) => ({ x: at.x, z: at.z, a: 0, atk: 0, dash: 1e9, projectile: 1e9, trap: 1e9, dashing: 0, windup: null }) as unknown as Hunter;
    it("a decisão não passa a Atacar através da quina (segue em Perseguir); com visão livre, Atacar", () => {
      for (const [at, attacks] of [[CORNER, false], [OPEN, true]] as const) {
        const H = H0(at), ai = newHunterAi();
        const s = seen(0, at.x + OFF.x, at.z + OFF.z, { visible: false });
        for (let k = 0; k <= 6; k++) think(utility, H, ai, percept([s], { t: k / b.ai.decision_hz, self: { x: at.x, z: at.z, a: 0 } }), { seed: 1 });
        expect(ai.target).toBe(0);
        expect(ai.mode).toBe(attacks ? "attack" : "chase");
        expect(H.windup?.kind ?? null).toBe(attacks ? "melee" : null);
      }
    });
    it("golpe que sai no fim do preparo: sem visão NÃO atinge; com visão atinge", () => {
      for (const [at, hits] of [[CORNER, false], [OPEN, true]] as const) {
        const g = scene(utility, at), P = g.survivors[0], ai = g.hunter.ai!;
        ai.mode = "attack"; ai.target = P.id; ai.perceiveIn = 1; ai.decideIn = 1; // decisão congelada neste passo
        g.hunter.windup = { kind: "melee", t: 1 / 240, total: b.hunter.telegraph_min };
        step(utility, g, NO_INPUT);
        expect(P.hp).toBe(hits ? 100 - b.hunter.melee.damage : 100);
        expect(ai.mode).toBe(hits ? "recoil" : "chase");
        expect(g.hunter.atk).toBeGreaterThan(0);
      }
    });
  });

  it("protótipo: sem efeito (o golpe do protótipo não confere linha de visão; paridade)", () => {
    const proto = makeConfig(b, map, { ruleset: "prototype" });
    // o protótipo usa o mapa de topo (sem pilares); a regra fica fora do caminho dele por construção
    expect(proto.v1).toBe(false);
    expect(proto.map).toBe(map);
  });
});
