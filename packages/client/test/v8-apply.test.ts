// V8: as opções chegam onde o efeito acontece (revisão do qa do PR #53): balanço da ferramenta (retro/viewmodel.ts),
// feixe pendente com "reduzir flicker" (states.ts syncGenVisual), atlas dos personagens no modo daltônico
// (characters/runtime.ts atlasPaints), e a entrada do teclado (keyDown): preventDefault, quebra-cabeça e teclas
// seguras para remapear.
import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import type { GameState, Generator } from "@thehell/sim";
import { balance } from "../src/data.ts";
import { bindable, defaultBindings, parseBindings, rebind } from "../src/bindings.ts";
import { keyDown, keyUp, padIdle, readInput, resetInput, setControls } from "../src/input.ts";
import { PALETTE, setColorMode, tok } from "../src/look.ts";
import { atlasCell } from "../src/render/characters/atlas.ts";
import { atlasPaints } from "../src/render/characters/runtime.ts";
import { setReduceFlicker } from "../src/render/layers.ts";
import { setReduceCameraBob } from "../src/render/motion.ts";
import { createViewmodel } from "../src/render/retro/viewmodel.ts";
import { createGenVisual, syncGenVisual } from "../src/render/states.ts";

describe("balanço da ferramenta (viewmodel) com reduzir balanço de câmera", () => {
  afterEach(() => setReduceCameraBob(false));
  /** anda a correr por alguns passos e devolve o deslocamento da ferramenta */
  const swing = () => {
    const vm = createViewmodel("curandeiro", 16 / 9);
    const tool = vm.scene.children.find(o => o.name.startsWith("ferramenta"))!;
    const run = balance.survivor.run, dt = 1 / 60;
    let max = 0;
    for (let i = 0; i <= 120; i++) { vm.update(i * dt * run, 0, i * dt, true); max = Math.max(max, tool.position.length()); }
    return max;
  };
  it("balança ao correr e fica parada com a opção (render.retro.bob × ui.options.reduced_bob)", () => {
    expect(swing()).toBeGreaterThan(0);
    setReduceCameraBob(true);
    expect(balance.ui.options.reduced_bob).toBe(0);
    expect(swing()).toBe(0);
  });
});

describe("feixe pendente com reduzir flicker (syncGenVisual)", () => {
  afterEach(() => setReduceFlicker(false));
  const st = balance.render.states;
  const off = (st.pending_duty + 0.5 * (1 - st.pending_duty)) / st.pending_hz;
  const g = { done: false, bonus: false, n: 0 } as unknown as Generator;
  it("normal: apaga na fase escura; reduzido: fica aceso com pending_reduced_level do brilho", () => {
    const v = createGenVisual(new THREE.Scene(), 0, 0);
    syncGenVisual(v, g, off);
    expect(v.beam.visible).toBe(false);
    setReduceFlicker(true);
    syncGenVisual(v, g, off);
    expect(v.beam.visible && v.lamp.visible).toBe(true);
    const want = new THREE.Color(tok("gen.pendente")).multiplyScalar(st.pending_reduced_level);
    const got = (v.beam.material as unknown as { color: THREE.Color }).color;
    expect(got.r).toBeCloseTo(want.r);
    expect(got.g).toBeCloseTo(want.g);
    syncGenVisual(v, g, 0);
    expect((v.beam.material as unknown as { color: THREE.Color }).color.getHex()).toBe(tok("gen.pendente"));
  });
});

describe("atlas dos personagens no modo daltônico (atlasPaints)", () => {
  const tritanopia = PALETTE.modos_daltonico.tritanopia.tokens;
  afterEach(() => { setColorMode("normal"); PALETTE.modos_daltonico.tritanopia.tokens = tritanopia; });
  const size = balance.render.models.atlas;
  it("modo normal sem skin: nada a repintar; com sobreposição: o bloco do token na cor do modo", () => {
    expect(atlasPaints({ trocas: {} }, size)).toEqual([]);
    PALETTE.modos_daltonico.tritanopia.tokens = { "char.calca": [31, 0, 0] };
    setColorMode("tritanopia");
    const p = atlasPaints({ trocas: {} }, size);
    expect(p).toEqual([{ ...atlasCell(PALETTE, size, "char.calca"), rgb: [255, 0, 0] }]);
  });
  it("troca de skin usa a cor de destino com o modo aplicado", () => {
    PALETTE.modos_daltonico.tritanopia.tokens = { "skin.abo.a": [0, 31, 0] };
    setColorMode("tritanopia");
    const p = atlasPaints({ trocas: { "char.calca": "skin.abo.a" } }, size);
    expect(p.at(-1)).toEqual({ ...atlasCell(PALETTE, size, "char.calca"), rgb: [0, 255, 0] });
  });
});

describe("teclado na partida (keyDown)", () => {
  afterEach(() => { setControls({ keys: defaultBindings() }); resetInput(); padIdle(); });
  const game = (puzzle: unknown = null, over = false) => ({ puzzle, over }) as unknown as GameState;

  it("preventDefault em Espaço/setas e em toda tecla com ação durante a partida; não nas outras", () => {
    expect(keyDown(game(), "KeyQ", false)).toBe(true);
    expect(keyDown(game(), "Space", false)).toBe(true);
    expect(keyDown(game(), "KeyP", false)).toBe(false);
    expect(keyDown(game(null, true), "KeyQ", false)).toBe(false); // partida acabou: a tecla volta ao navegador
  });

  it("teclas do navegador não podem ser atribuídas (F5 recarregaria a partida)", () => {
    for (const c of ["F5", "F11", "F12", "F1", "Tab", "Escape", "AltLeft", "MetaLeft", "ContextMenu", "Slash", "Quote", "PageDown"]) expect(bindable(c)).toBe(false);
    for (const c of ["KeyF", "Digit7", "ArrowUp", "Space", "ShiftRight", "ControlLeft", "Numpad4", "Comma"]) expect(bindable(c)).toBe(true);
  });

  it("no quebra-cabeça de sequência a seta vence, mesmo ligada a interagir (que sairia)", () => {
    setControls({ keys: rebind(defaultBindings(), "interact", "ArrowLeft").bindings });
    const G = game({ kind: "sequence" });
    keyDown(G, "ArrowLeft", false);
    const i = readInput(G, 0);
    expect(i.puzzleArrow).toBe("left");
    expect(i.puzzleExit).toBeFalsy();
    keyUp("ArrowLeft");
    keyDown(G, "KeyX", false);
    expect(readInput(G, 0).puzzleExit).toBe(true);
  });

  it("no timing a tecla de confirmar confirma antes de qualquer saída", () => {
    setControls({ keys: rebind(defaultBindings(), "puzzle_confirm", "KeyE").bindings });
    const G = game({ kind: "timing" });
    keyDown(G, "KeyE", false);
    const i = readInput(G, 0);
    expect(i.puzzleSpace).toBe(true);
    expect(i.puzzleExit).toBeFalsy();
  });

  it("remapear para tecla com papel fixo no quebra-cabeça avisa", () => {
    expect(rebind(defaultBindings(), "ability", "KeyX").puzzle).toBe("exit");
    expect(rebind(defaultBindings(), "interact", "Backspace").puzzle).toBeNull();
    expect(rebind(defaultBindings(), "camera", "ArrowUp").puzzle).toBe("arrow");
    expect(rebind(defaultBindings(), "forward", "ArrowUp").puzzle).toBeNull();
    expect(rebind(defaultBindings(), "ability", "KeyF").puzzle).toBeNull();
  });
});

describe("mapeamento salvo vence o padrão", () => {
  it("forward inválido + ping_1 salvo em W: o ping fica com W e forward volta ao padrão sem ele", () => {
    const b = parseBindings({ forward: "quebrado", ping_1: ["KeyW"] });
    expect(b.ping_1).toEqual(["KeyW"]);
    expect(b.forward).toEqual([]);
    expect(b.back).toEqual(defaultBindings().back);
  });
});
