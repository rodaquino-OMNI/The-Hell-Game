// T-02: a mesma semente e a mesma sequência de entradas geram o mesmo estado final em 100 execuções.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGame, makeConfig, nextRandom, step, NO_INPUT, type PlayerInput, type SimConfig } from "../src/index.ts";
import { balance, cfg, map } from "./helpers.ts";

// padrão de produção desde o marco MJ-B: o que data/balance.yaml diz (v1 + caçador utility + bots competent)
const prod: SimConfig = makeConfig(balance, map);
// 101 partidas de 30 s com a IA do caçador e dos bots; o limite é de execução do teste (CI de 2 núcleos com
// cobertura), não regra de jogo
const PROD_TIMEOUT_MS = 60_000;

function scriptedInput(i: number): PlayerInput {
  // roteiro fixo: anda, corre, gira, interage e usa habilidade em momentos definidos
  return { ...NO_INPUT, forward: i % 240 < 180 ? 1 : 0, strafe: i % 400 < 100 ? 1 : 0, run: i % 600 < 120, yaw: (i / 600) * Math.PI,
    interact: i % 300 === 0, interactHeld: false, ability: i % 500 === 0, attack: i % 350 === 0, puzzleSpace: i % 45 === 0 };
}

function playHash(seed: number, frames: number, c: SimConfig = cfg) {
  const g = createGame(c, "Mecânico", seed);
  for (let i = 0; i < frames && !g.over; i++) step(c, g, scriptedInput(i));
  return createHash("sha256").update(JSON.stringify(g)).digest("hex");
}

describe("determinismo", () => {
  it("mesma semente → mesmo hash em 100 execuções", () => {
    const ref = playHash(42, 60 * 60);
    for (let i = 0; i < 100; i++) expect(playHash(42, 60 * 60)).toBe(ref);
  });
  it("semente diferente → partida diferente", () => {
    expect(playHash(42, 60 * 60)).not.toBe(playHash(43, 60 * 60));
  });
  it("padrão de produção (MJ-B: v1, utility, competent): mesma semente → mesmo hash em 100 execuções", () => {
    expect([prod.v1, prod.brain, prod.botBrain]).toEqual([true, "utility", "competent"]);
    const ref = playHash(42, 30 * 60, prod);
    for (let i = 0; i < 100; i++) expect(playHash(42, 30 * 60, prod)).toBe(ref);
    expect(playHash(43, 30 * 60, prod)).not.toBe(ref);
  }, PROD_TIMEOUT_MS);
  it("mulberry32 é reproduzível e fica em [0, 1)", () => {
    const a = { seed: 7 }, c = { seed: 7 };
    for (let i = 0; i < 1000; i++) { const x = nextRandom(a); expect(x).toBe(nextRandom(c)); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });
});
