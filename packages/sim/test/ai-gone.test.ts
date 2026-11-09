// Revisão do PR #86 (correção do §8.3 com a D-35): alvo lembrado que sai do jogo sem passar pelo golpe corpo a corpo
// (projétil, fuga pelo portão, morte) não segura a histerese nem a memória; o caçador escolhe outro alvo na hora. O
// estado público de cada sobrevivente chega ao caçador em `Percept.gone` (preso, morto ou fora). A armadilha não
// captura no v1 (só deixa lento, `step` em game.ts), então não é um caminho de saída.
import { describe, expect, it } from "vitest";
import { createGame, makeConfig, step, NO_INPUT, STEP, type GameState } from "../src/index.ts";
import { balance as b, map } from "./helpers.ts";

const cfg = makeConfig(b, map, { ruleset: "v1", hunterBrain: "utility", botBrain: "competent", difficulty: "normal" });
const DECISION = 1 / b.ai.decision_hz;

/**
 * Caçador em (−8, 16) olhando para +z; A (vaga 0, parado) a 5 m e B (vaga 1, parado: sem cérebro de bot) a ~8,2 m,
 * os dois à vista. Só a perseguição: golpe, investida, projétil e armadilha do caçador desligados. B nunca supera o
 * placar de A mais a margem (0,15), então só vira alvo quando A sai do jogo.
 */
function scene(): GameState {
  const g = createGame(cfg, "Curandeiro", 43);
  g.reveal = 1e9;
  const H = g.hunter, [A, B, ...rest] = g.survivors;
  for (const s of rest) s.st = "dead";
  B.bot = false;
  H.x = -8; H.z = 16; H.a = Math.PI;
  H.atk = 1e9; H.dash = 1e9; H.projectile = 1e9; H.trap = 1e9;
  A.x = -8; A.z = 21; B.x = -6; B.z = 24;
  H.ai!.patrol = { x: -8, z: 29, gen: -1 }; // patrulha na direção dos dois (não vira de costas antes de notá-los)
  return g;
}
function play(g: GameState, seconds: number) {
  for (let i = 0; i < Math.round(seconds / STEP) && !g.over; i++) { step(cfg, g, NO_INPUT); g.events.length = 0; }
}
/** persegue A por 1 s; o alvo e a memória são A */
function chasingA(): GameState {
  const g = scene();
  play(g, 1);
  expect(g.hunter.ai!.mode).toBe("chase");
  expect(g.hunter.ai!.target).toBe(0);
  return g;
}

describe("alvo que sai do jogo sem o golpe: troca na hora, sem esperar a memória (revisão do PR #86)", () => {
  it("projétil: A preso por projétil (knockDown sem ai.captured) → B vira o alvo na decisão seguinte", () => {
    const g = chasingA(), A = g.survivors[0];
    A.hp = 1;
    g.projectiles.push({ id: g.nextId++, x: A.x, z: A.z, vx: 0, vz: 0, t: 1 });
    play(g, STEP);
    expect(A.st).toBe("cage");
    expect(g.hunter.ai!.captured).toBe(false);
    play(g, 2 * DECISION);
    expect(g.hunter.ai!.target).toBe(1);
    expect(g.hunter.ai!.memory?.id).toBe(1);
  });
  it("fuga: A sai pelo portão aberto (st out) → B vira o alvo na decisão seguinte", () => {
    const g = chasingA(), A = g.survivors[0];
    g.gateStarted = true; g.gateOpen = true;
    A.x = g.arena.gate.x; A.z = g.arena.gate.z;
    play(g, STEP);
    expect(A.st).toBe("out");
    play(g, 2 * DECISION);
    expect(g.hunter.ai!.target).toBe(1);
    expect(g.hunter.ai!.memory?.id).toBe(1);
  });
  it("morte: A morto fora do golpe (st dead) → B vira o alvo na decisão seguinte; A perde o estado da D-52", () => {
    const g = chasingA();
    expect(g.hunter.ai!.protection.map(x => x.id)).toContain(0);
    g.survivors[0].st = "dead";
    play(g, 2 * DECISION);
    expect(g.hunter.ai!.target).toBe(1);
    expect(g.hunter.ai!.protection.map(x => x.id)).not.toContain(0);
  });
});
