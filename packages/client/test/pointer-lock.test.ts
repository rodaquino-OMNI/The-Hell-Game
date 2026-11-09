// Salto de câmera ao adquirir o pointer lock: o Chromium pode emitir um mousemove com movementX espúrio (≈ clientX do
// cursor) perto do lock, com ou sem lock (antes do pointerlockchange). input.ts ignora o salto sem lock com o pedido
// pendente, descarta o primeiro movimento não nulo com lock de cada pedido/sessão de lock e ignora eventos acima de
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
const doc = {
  pointerLockElement: null as object | null,
  listeners: {} as Record<string, Listener[]>,
  addEventListener(t: string, f: Listener) { (doc.listeners[t] ??= []).push(f); },
};
const emit = (t: string) => { for (const f of doc.listeners[t] ?? []) f(); };
const g = globalThis as Record<string, unknown>;
for (const k of ["onkeydown", "onkeyup", "onmousemove", "onmousedown", "onmouseup", "onblur"]) g[k] = null;
g.document = doc;

const input = await import("../src/input.ts");
const game = { over: false } as unknown as GameState;
const move = (movementX: number, movementY = 0) => (g.onmousemove as (e: Partial<MouseEvent>) => void)({ movementX, movementY });
const lock = (on: boolean) => { doc.pointerLockElement = on ? {} : null; emit("pointerlockchange"); };
/** lockPointer com um canvas falso: o pedido fica pendente até lock() ou emit("pointerlockerror") */
const request = () => input.lockPointer({ requestPointerLock: () => undefined } as unknown as HTMLCanvasElement);

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

describe("filtro: movimento nulo e pedido de lock pendente", () => {
  it("o evento nulo do Chromium ao travar não consome o descarte: zero, −200 com lock, −5 → só −5 gira", () => {
    const f = pointerFilter(MAX);
    f.lockChange(true);
    expect(f.accept(true, 0, 0)).toBe(true); // nulo: aceito (não gira) e não consome
    expect(f.accept(true, -200, 0)).toBe(false); // salto abaixo do limite: descartado
    expect(f.accept(true, -5, 0)).toBe(true);
  });

  it("ordem medida: pedido, −200 sem lock (ignorado), 0 com lock, lock, −200 com lock (descartado), −5 → só −5 gira", () => {
    const f = pointerFilter(MAX);
    f.requested();
    expect(f.accept(false, -200, -62)).toBe(false); // salto sem lock: ignorado
    expect(f.accept(true, 0, 0)).toBe(true);
    f.lockChange(true);
    expect(f.accept(true, -200, -62)).toBe(false); // primeiro não nulo COM lock: descartado
    expect(f.accept(true, -5, 0)).toBe(true);
    expect(f.accept(true, -5, 0)).toBe(true);
  });

  it("salto sem lock com o pedido pendente não é aplicado e não consome o descarte do lock", () => {
    const f = pointerFilter(MAX);
    f.requested();
    expect(f.accept(false, 185, 264)).toBe(false);
    expect(f.accept(false, -185, -264)).toBe(false);
    f.lockChange(true);
    // par com lock abaixo do limite (reproduzido pelo qa): o primeiro é descartado
    expect(f.accept(true, 185, 264)).toBe(false);
    expect(f.accept(true, -5, 0)).toBe(true);
  });

  it("par espúrio com lock abaixo do limite (+185,+264 / −185,−264, qa): as duas metades são descartadas", () => {
    const f = pointerFilter(MAX);
    f.requested();
    expect(f.accept(false, -185, -264)).toBe(false);
    f.lockChange(true);
    expect(f.accept(true, 0, 0)).toBe(true);
    expect(f.accept(true, 185, 264)).toBe(false);
    expect(f.accept(true, 0, 0)).toBe(true); // nulo no meio não desfaz a espera do par
    expect(f.accept(true, -185, -264)).toBe(false);
    expect(f.accept(true, -5, 0)).toBe(true);
    expect(f.accept(true, 5, 0)).toBe(true); // o negativo só é descartado logo depois do descarte, uma vez
  });

  it("o evento depois do descarte que não é o negativo exato gira normalmente", () => {
    const f = pointerFilter(MAX);
    f.lockChange(true);
    expect(f.accept(true, 185, 264)).toBe(false);
    expect(f.accept(true, -185, -263)).toBe(true);
    expect(f.accept(true, 185, 263)).toBe(true);
    // a espera do par vale só para o evento não nulo seguinte: depois dele, o negativo exato gira
    expect(f.accept(true, -185, -264)).toBe(true);
  });

  it("sem pedido pendente, mousemove sem lock não é descartado (arrastar)", () => {
    const f = pointerFilter(MAX);
    expect(f.accept(false, -200, 0)).toBe(true);
  });

  it("soltar e readquirir o lock volta a descartar o primeiro não nulo; pointerlockerror encerra o pedido", () => {
    const f = pointerFilter(MAX);
    f.requested(); f.lockChange(true);
    expect(f.accept(true, -200, 0)).toBe(false);
    expect(f.accept(true, -5, 0)).toBe(true);
    f.lockChange(false);
    expect(f.accept(false, -5, 0)).toBe(true); // solto e sem pedido: arrastar gira
    f.requested();
    expect(f.accept(false, -150, 0)).toBe(false); // pendente: ignorado
    f.lockChange(true);
    expect(f.accept(true, -150, 0)).toBe(false); // relock: o primeiro com lock volta a ser descartado
    expect(f.accept(true, -5, 0)).toBe(true);
    f.lockChange(false);
    f.requested(); f.lockError();
    expect(f.accept(false, -150, 0)).toBe(true); // pedido falhou: volta ao arrastar normal
  });

  it("pedir de novo com o ponteiro já travado não descarta um movimento legítimo", () => {
    const f = pointerFilter(MAX);
    f.requested(); f.lockChange(true);
    expect(f.accept(true, -200, 0)).toBe(false);
    f.requested();
    expect(f.accept(true, -5, 0)).toBe(true);
  });

  it("navegador sem salto (Firefox): o primeiro movimento real é descartado uma vez só (custo aceito)", () => {
    const f = pointerFilter(MAX);
    f.requested(); f.lockChange(true);
    expect(f.accept(true, 3, 1)).toBe(false);
    expect(f.accept(true, 3, 1)).toBe(true);
    expect(f.accept(true, 3, 1)).toBe(true);
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

  it("ordem medida no jogo: pedido, −200 sem lock, 0 com lock, pointerlockchange, −200 com lock, −5 → só −5 gira", () => {
    request();
    move(-200, -62);
    doc.pointerLockElement = {};
    move(0);
    emit("pointerlockchange");
    move(-200, -62);
    expect(input.view.yaw).toBe(0);
    expect(input.view.pitch).toBe(0);
    move(-5);
    expect(input.view.yaw).toBeCloseTo(5 * rate, 12);
  });

  it("com o pedido pendente, salto sem lock não gira nem arrastando e não gasta o descarte do lock", () => {
    (g.onmousedown as () => void)(); // arrasto ativo: sem o filtro, o salto sem lock giraria
    request();
    move(-200, -62);
    (g.onmouseup as () => void)();
    expect(input.view.yaw).toBe(0);
    expect(input.view.pitch).toBe(0);
    lock(true);
    move(-185, -264);
    expect(input.view.yaw).toBe(0);
    move(-5);
    expect(input.view.yaw).toBeCloseTo(5 * rate, 12);
  });

  it("par espúrio com lock do qa (185,264 e o negativo) não deixa a câmera girada", () => {
    request();
    move(-185, -264);
    lock(true);
    move(185, 264);
    move(-185, -264);
    expect(input.view.yaw).toBe(0);
    expect(input.view.pitch).toBe(0);
    move(-5);
    expect(input.view.yaw).toBeCloseTo(5 * rate, 12);
  });

  it("requestPointerLock que lança na hora não deixa o pedido pendente: arrastar gira", () => {
    input.lockPointer({ requestPointerLock: () => { throw new Error("sem suporte"); } } as unknown as HTMLCanvasElement);
    (g.onmousedown as () => void)();
    move(-5);
    (g.onmouseup as () => void)();
    expect(input.view.yaw).toBeCloseTo(5 * rate, 12);
  });

  it("evento nulo com lock não consome o descarte: 0, −200, −5 → só −5 gira", () => {
    request(); lock(true);
    move(0);
    move(-200);
    expect(input.view.yaw).toBe(0);
    move(-5);
    expect(input.view.yaw).toBeCloseTo(5 * rate, 12);
  });

  it("pointerlockerror encerra o pedido: arrastar volta a girar", () => {
    request(); emit("pointerlockerror");
    (g.onmousedown as () => void)();
    move(-5);
    (g.onmouseup as () => void)();
    expect(input.view.yaw).toBeCloseTo(5 * rate, 12);
  });

  it("cada novo lock descarta de novo a primeira leitura", () => {
    lock(true); move(0); lock(false);
    lock(true);
    move(-(MAX - 1));
    expect(input.view.yaw).toBe(0);
  });
});
