// Laço do cliente (GDD-v0.3 §13.3): passo fixo de 1/60 s em tempo real, com tetos de `client` (data/balance.yaml).
import { STEP } from "@thehell/sim";
import { describe, expect, it } from "vitest";
import { balance } from "../src/data.ts";
import { advanceClock } from "../src/loop.ts";

const lim = balance.client;
/** roda quadros de `frame` s por `seconds` s de relógio real e devolve o tempo de simulação avançado */
function simulate(frame: number, seconds: number) {
  const clock = { acc: 0 };
  let steps = 0;
  for (let t = 0; t < seconds - 1e-9; t += frame) steps += advanceClock(clock, frame, STEP, lim).steps;
  return steps * STEP;
}

describe("laço do cliente", () => {
  it("quadro lento de 70 ms avança 70 ms de simulação (sem câmera lenta abaixo de 20 fps)", () => {
    const clock = { acc: 0 };
    const r = advanceClock(clock, 0.07, STEP, lim);
    expect(r.dt).toBeCloseTo(0.07);
    expect(r.steps * STEP + clock.acc).toBeCloseTo(0.07, 9);
    // em 3 s de relógio a 70 ms por quadro, a simulação acompanha o tempo real (resto < 1 passo)
    expect(simulate(0.07, 3)).toBeGreaterThan(3 - 0.07 - STEP);
  });

  it("a 60, 30 e 11 fps a simulação corre em tempo real", () => {
    for (const fps of [60, 30, 11]) expect(Math.abs(simulate(1 / fps, 6) - 6)).toBeLessThan(STEP + 1e-9);
  });

  it("quadro de 2 s é limitado pelo teto (max_frame_dt e max_steps_per_frame)", () => {
    const clock = { acc: 0 };
    const r = advanceClock(clock, 2, STEP, lim);
    expect(r.dt).toBe(lim.max_frame_dt);
    expect(r.steps).toBeLessThanOrEqual(lim.max_steps_per_frame);
    expect(r.steps * STEP).toBeCloseTo(Math.min(lim.max_frame_dt, lim.max_steps_per_frame * STEP), 6);
    // o excesso não vira atraso acumulado: o quadro seguinte, normal, roda só o próprio tempo
    expect(advanceClock(clock, 1 / 60, STEP, lim).steps).toBeLessThanOrEqual(2);
  });

  it("teto de passos descarta o excesso mesmo com max_frame_dt maior", () => {
    const clock = { acc: 0 };
    const r = advanceClock(clock, 1, STEP, { max_frame_dt: 1, max_steps_per_frame: 5 });
    expect(r.steps).toBe(5);
    expect(clock.acc).toBeLessThan(STEP);
  });

  it("tempo negativo ou inválido não avança", () => {
    const clock = { acc: 0 };
    expect(advanceClock(clock, -1, STEP, lim).steps).toBe(0);
    expect(advanceClock(clock, NaN, STEP, lim).steps).toBe(0);
    expect(clock.acc).toBe(0);
  });
});
