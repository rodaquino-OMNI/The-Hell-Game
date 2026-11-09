// Salto de câmera ao adquirir o pointer lock: o Chromium pode emitir um mousemove com movementX espúrio (≈ clientX do
// cursor) no momento do lock. input.ts descarta a primeira leitura de cada lock e ignora eventos acima de
// `client.mouse_max_delta` (data/balance.yaml); filtro em src/pointer-filter.ts.
import type { GameState } from "@thehell/sim";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { balance } from "../src/data.ts";
import { pointerFilter } from "../src/pointer-filter.ts";

const MAX = balance.client.mouse_max_delta;
/** sensibilidade atual do mouse (rad/px), lida do próprio input.ts pela razão giro/movimento de um evento aceito */
let rate = 0;

// ambiente mínimo de navegador para input.ts (o vitest roda em Node): ouvintes globais e document.pointerLockElement
type Listener = () => void;
const doc = { pointerLockElement: null as object | null, listeners: [] as Listener[], addEventListener(_t: string, f: Listener) { doc.listeners.push(f); } };
const g = globalThis as Record<string, unknown>;
for (const k of ["onkeydown", "onkeyup", "onmousemove", "onmousedown", "onmouseup", "onblur"]) g[k] = null;
g.document = doc;

const input = await import("../src/input.ts");
const game = { over: false } as unknown as GameState;
const move = (movementX: number, movementY = 0) => (g.onmousemove as (e: Partial<MouseEvent>) => void)({ movementX, movementY });
const lock = (on: boolean) => { doc.pointerLockElement = on ? {} : null; for (const f of doc.listeners) f(); };

describe("filtro do pointer lock (pointer-filter.ts)", () => {
  it("descarta a primeira leitura de cada lock, aceita as seguintes e ignora valores acima do limite", () => {
    const f = pointerFilter(MAX);
    f.lockChange(true);
    expect(f.accept(true, -568, 0)).toBe(false);
    expect(f.accept(true, 5, -3)).toBe(true);
    expect(f.accept(true, MAX + 1, 0)).toBe(false);
    expect(f.accept(true, 0, -(MAX + 1))).toBe(false);
    expect(f.accept(true, MAX, -MAX)).toBe(true);
    // soltar e readquirir o lock: a primeira leitura volta a ser descartada
    f.lockChange(false);
    f.lockChange(true);
    expect(f.accept(true, 4, 0)).toBe(false);
    expect(f.accept(true, 4, 0)).toBe(true);
  });

  it("o mousemove que chega antes do pointerlockchange também é o descartado (uma vez só)", () => {
    const f = pointerFilter(MAX);
    expect(f.accept(true, -568, 0)).toBe(false);
    f.lockChange(true);
    expect(f.accept(true, 3, 0)).toBe(true);
  });

  it("sem lock (arrastar) nada é descartado além dos valores acima do limite", () => {
    const f = pointerFilter(MAX);
    expect(f.accept(false, 7, 2)).toBe(true);
    expect(f.accept(false, -(MAX + 1), 0)).toBe(false);
  });
});

describe("input.ts: pointerlockchange + mousemove", () => {
  beforeAll(() => {
    input.setupInput(() => game);
    // mede a sensibilidade em vigor sem repetir o número: um evento aceito depois do primeiro do lock
    lock(true); move(1); input.view.yaw = 0; move(-10); rate = input.view.yaw / 10; lock(false);
    expect(rate).toBeGreaterThan(0);
  });
  beforeEach(() => { input.view.yaw = 0; input.view.pitch = 0; lock(false); });

  it("o salto espúrio ao adquirir o lock não gira a câmera; os movimentos seguintes giram", () => {
    lock(true);
    move(-568);
    expect(input.view.yaw).toBe(0);
    move(-20, 0);
    expect(input.view.yaw).toBeCloseTo(20 * rate, 12);
  });

  it("evento isolado acima de client.mouse_max_delta é ignorado no meio do lock", () => {
    lock(true);
    move(0);
    move(-(MAX + 1));
    expect(input.view.yaw).toBe(0);
    move(0, MAX + 50);
    expect(input.view.pitch).toBe(0);
    move(-MAX);
    expect(input.view.yaw).toBeCloseTo(MAX * rate, 12);
  });

  it("cada novo lock descarta de novo a primeira leitura", () => {
    lock(true); move(0); lock(false);
    lock(true);
    move(-(MAX - 1));
    expect(input.view.yaw).toBe(0);
  });
});
