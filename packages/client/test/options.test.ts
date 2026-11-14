// V8 (F2-08, GDD v0.3 §12.2 e §12.4): persistência das opções, remapeamento, alternar vs segurar, gamepad
// (navigator.getGamepads simulado), quebra-cabeça acessível, fov/balanço, troca de tokens do modo daltônico,
// feixe pendente com "reduzir flicker" e as pendências do R7 (plural de 0 e seletores ICU sem protótipo).
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeConfig, puzzleZoneWidth, type GameState } from "@thehell/sim";
import { balance, map, px } from "../src/data.ts";
import { actionsOf, bindable, defaultBindings, holdOrToggle, parseBindings, rebind } from "../src/bindings.ts";
import { axis, browserPads, button, createEdges, createRepeater, firstPad, navDirection, padSticks, type PadLike } from "../src/gamepad.ts";
import { format, parse } from "../src/i18n/icu.ts";
import { t, setLocale } from "../src/i18n/index.ts";
import { installMuteKey } from "../src/audio/mute.ts";
import { getControls, isMuteKey, keyDown, keyUp, muteMessage, padFrame, padIdle, readInput, resetInput, setControls, view } from "../src/input.ts";
import { getColorMode, PALETTE, setColorMode, tok } from "../src/look.ts";
import { bobScale, cameraFov, setFov, setReduceCameraBob } from "../src/render/motion.ts";
import { beamLevel } from "../src/render/states.ts";
import { defaultOptions, loadOptions, OPTIONS_KEY, parseOptions, saveOptions } from "../src/ui/settings.ts";

const ctl = balance.ui.controls, gp = ctl.gamepad;

/** armazenamento em memória com o mesmo contrato do localStorage */
function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
}

/** controle "standard" com eixos e botões apertados */
function fakePad(o: { axes?: number[]; down?: number[]; values?: Record<number, number>; mapping?: string; connected?: boolean } = {}): PadLike {
  const axes = o.axes ?? [0, 0, 0, 0];
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: !!o.down?.includes(i), value: o.values?.[i] ?? (o.down?.includes(i) ? 1 : 0) }));
  return { connected: o.connected ?? true, mapping: o.mapping ?? "standard", axes, buttons };
}

describe("persistência das opções (localStorage)", () => {
  it("sem nada salvo, JSON quebrado ou armazenamento que lança: padrão de data/balance.yaml", () => {
    const d = defaultOptions();
    expect(d.ps1.snap).toBe(balance.render.ps1.snap);
    expect(d.layerA.grain).toBe(balance.render.layer_a.grain);
    expect(d.hunterOutline).toBe(balance.render.hunter_outline.intensity);
    expect(d.fontSize).toBe(balance.ui.options.font_default);
    expect(d.keys).toEqual(defaultBindings());
    expect(loadOptions(memStorage())).toEqual(d);
    expect(loadOptions(memStorage({ [OPTIONS_KEY]: "{quebrado" }))).toEqual(d);
    expect(loadOptions({ getItem: () => { throw new Error("SecurityError"); }, setItem: () => {} })).toEqual(d);
    expect(loadOptions(null)).toEqual(d);
    expect(parseOptions([1, 2])).toEqual(d);
  });

  it("cada campo inválido cai no padrão; os válidos continuam", () => {
    const d = defaultOptions();
    const o = parseOptions({
      ps1: { snap: 2, affine: 0.3, dither: "x" }, layerA: { grain: -1, bloom: 0.1 }, reduceFlicker: "sim", reduceCameraBob: true, hunterOutline: 1.5,
      fov: balance.ui.fov.max + 1, fontSize: "gigante", colorMode: "roxo", toggleRun: true, toggleInteract: 1, puzzleAccessible: true,
      sensitivity: ctl.sensitivity.max * 10, invertY: true, keys: { forward: ["KeyI"], back: "KeyK", run: ["Escape"] },
    });
    expect(o.ps1).toEqual({ ...d.ps1, affine: 0.3 });
    expect(o.layerA).toEqual({ ...d.layerA, bloom: 0.1 });
    expect(o.reduceFlicker).toBe(d.reduceFlicker);
    expect(o.reduceCameraBob).toBe(true);
    expect(o.hunterOutline).toBe(d.hunterOutline);
    expect(parseOptions({ hunterOutline: 0 }).hunterOutline).toBe(0); // 0 desliga o contorno
    expect(o.fov).toBe(d.fov);
    expect(o.fontSize).toBe(d.fontSize);
    expect(o.colorMode).toBe("normal");
    expect(o.toggleRun).toBe(true);
    expect(o.toggleInteract).toBe(d.toggleInteract);
    expect(o.puzzleAccessible).toBe(true);
    expect(o.sensitivity).toBe(d.sensitivity);
    expect(o.invertY).toBe(true);
    expect(o.keys.forward).toEqual(["KeyI"]);
    expect(o.keys.back).toEqual(d.keys.back);
    expect(o.keys.run).toEqual(d.keys.run); // Esc é reservada
  });

  it("chaves herdadas do protótipo não contam como opção salva", () => {
    const raw = Object.create({ reduceFlicker: true, fontSize: "xlarge" });
    expect(parseOptions(raw).reduceFlicker).toBe(false);
  });

  it("gravar e ler devolve as mesmas opções; armazenamento recusado não quebra", () => {
    const s = memStorage();
    const o = { ...defaultOptions(), fov: balance.ui.fov.min, colorMode: "tritanopia" as const, fontSize: "xlarge" as const, reduceFlicker: true };
    expect(saveOptions(o, s)).toBe(true);
    expect(loadOptions(s)).toEqual(o);
    expect(saveOptions(o, { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } })).toBe(false);
    expect(saveOptions(o, null)).toBe(false);
  });
});

describe("remapeamento de teclas", () => {
  it("o padrão é o de ui.controls.keyboard (controles do protótipo)", () => {
    const b = defaultBindings();
    expect(b.forward).toEqual(["KeyW"]);
    expect(b.run).toEqual(["ShiftLeft", "ShiftRight"]);
    expect(b.interact).toEqual(["KeyE"]);
    expect(actionsOf(b, "Digit3")).toEqual(["ping_3"]);
    // cópia nova: mexer numa não muda o padrão
    b.forward.push("KeyZ");
    expect(defaultBindings().forward).toEqual(["KeyW"]);
  });

  it("atribuir uma tecla em uso tira a tecla da outra ação e avisa quem perdeu", () => {
    const r = rebind(defaultBindings(), "forward", "KeyE");
    expect(r.bindings.forward).toEqual(["KeyE"]);
    expect(r.bindings.interact).toEqual([]);
    expect(r.displaced).toEqual(["interact"]);
    const r2 = rebind(r.bindings, "interact", "KeyF");
    expect(r2.displaced).toEqual([]);
    expect(actionsOf(r2.bindings, "KeyF")).toEqual(["interact"]);
  });

  it("Esc e Tab não viram atalho (fechar diálogo e navegar sem armadilha de teclado)", () => {
    expect(bindable("Escape")).toBe(false);
    expect(bindable("Tab")).toBe(false);
    expect(bindable("KeyQ")).toBe(true);
    const b = defaultBindings();
    expect(rebind(b, "ability", "Tab").bindings).toBe(b);
  });

  it("tecla repetida em duas ações salvas fica só na primeira", () => {
    const b = parseBindings({ forward: ["KeyQ"] });
    expect(b.forward).toEqual(["KeyQ"]);
    expect(b.ability).toEqual([]);
  });
});

describe("alternar em vez de segurar", () => {
  afterEach(() => { setControls({ toggleRun: ctl.toggle_run, toggleInteract: ctl.toggle_interact }); resetInput(); padIdle(); });
  const G = { puzzle: null, over: false } as unknown as GameState;

  it("regra: segurar segue a tecla; alternar inverte a cada aperto", () => {
    expect(holdOrToggle(false, false, true, true)).toBe(true);
    expect(holdOrToggle(false, true, false, false)).toBe(false);
    expect(holdOrToggle(true, false, true, true)).toBe(true);
    expect(holdOrToggle(true, true, false, false)).toBe(true); // soltar não muda
    expect(holdOrToggle(true, true, true, true)).toBe(false);
  });

  it("segurar (padrão): correr só enquanto o botão está apertado", () => {
    const edges = createEdges(gp.trigger_threshold);
    const press = fakePad({ down: [gp.buttons.run] }), free = fakePad();
    padFrame(G, press, edges.update(press), 0);
    expect(readInput(G, 0).run).toBe(true);
    padFrame(G, free, edges.update(free), 0);
    expect(readInput(G, 0).run).toBe(false);
  });

  it("alternar: o 1º aperto liga correr e interagir, soltar mantém, o 2º desliga", () => {
    setControls({ toggleRun: true, toggleInteract: true });
    const edges = createEdges(gp.trigger_threshold);
    const both = fakePad({ down: [gp.buttons.run, gp.buttons.interact] }), free = fakePad();
    padFrame(G, both, edges.update(both), 0);
    let i = readInput(G, 0);
    expect(i.run).toBe(true);
    expect(i.interactHeld).toBe(true);
    expect(i.interact).toBe(true);
    padFrame(G, free, edges.update(free), 0);
    i = readInput(G, 0);
    expect(i.run && i.interactHeld).toBe(true);
    expect(i.interact).toBe(false);
    padFrame(G, both, edges.update(both), 0);
    i = readInput(G, 0);
    expect(i.run || i.interactHeld).toBe(false);
  });
});

describe("gamepad (navigator.getGamepads simulado)", () => {
  afterEach(() => { vi.unstubAllGlobals(); padIdle(); resetInput(); });

  it("lê navigator.getGamepads e prefere o controle de layout standard", () => {
    const other = fakePad({ mapping: "" }), std = fakePad();
    vi.stubGlobal("navigator", { getGamepads: () => [null, other, std] });
    expect(firstPad(browserPads())).toBe(std);
    vi.stubGlobal("navigator", { getGamepads: () => [fakePad({ connected: false })] });
    expect(firstPad(browserPads())).toBeNull();
    vi.stubGlobal("navigator", {});
    expect(browserPads()).toEqual([]);
  });

  it("zona morta e escala do analógico; movimento no círculo unitário", () => {
    const dz = gp.deadzone;
    const p = fakePad({ axes: [dz / 2, -1, 1, 0] });
    expect(axis(p, 0, dz)).toBe(0);
    expect(axis(p, 1, dz)).toBe(-1);
    const s = padSticks(fakePad({ axes: [1, -1, 0, 0] }), gp);
    expect(Math.hypot(s.forward, s.strafe)).toBeCloseTo(1);
    expect(s.forward).toBeGreaterThan(0); // eixo y negativo = frente
  });

  it("gatilho analógico conta a partir de trigger_threshold; bordas só no aperto", () => {
    const rt = gp.buttons.attack;
    expect(button(fakePad({ values: { [rt]: gp.trigger_threshold } }), rt, gp.trigger_threshold)).toBe(true);
    expect(button(fakePad({ values: { [rt]: gp.trigger_threshold / 2 } }), rt, gp.trigger_threshold)).toBe(false);
    const e = createEdges(gp.trigger_threshold), p = fakePad({ down: [0] });
    expect([...e.update(p)]).toEqual([0]);
    expect([...e.update(p)]).toEqual([]);
    e.update(fakePad());
    expect([...e.update(p)]).toEqual([0]);
  });

  it("mapeamento padrão em partida: analógicos, ataque, habilidade, câmera e pings", () => {
    const G = { puzzle: null, over: false } as unknown as GameState;
    const e = createEdges(gp.trigger_threshold);
    const third = view.thirdPerson, yaw = view.yaw;
    const p = fakePad({ axes: [0, -1, 1, 0], down: [gp.buttons.attack, gp.buttons.ability, gp.buttons.camera, gp.buttons.ping_2] });
    const ping = padFrame(G, p, e.update(p), 0.1);
    const i = readInput(G, 0);
    expect(i.forward).toBe(1);
    expect(i.attack && i.ability).toBe(true);
    expect(view.thirdPerson).toBe(!third);
    expect(view.yaw).toBeCloseTo(yaw - gp.look_speed * getControls().sensitivity * 0.1);
    expect(ping).toBe(1);
    view.thirdPerson = third;
  });

  it("no quebra-cabeça: A confirma o timing, B sai, direcional dá as setas", () => {
    const e = createEdges(gp.trigger_threshold);
    const timing = { puzzle: { kind: "timing" }, over: false } as unknown as GameState;
    let p = fakePad({ down: [gp.buttons.interact] });
    padFrame(timing, p, e.update(p), 0);
    const i = readInput(timing, 0);
    expect(i.puzzleSpace).toBe(true);
    expect(i.interact).toBe(false);
    e.update(fakePad());
    p = fakePad({ down: [gp.buttons.puzzle_exit] });
    padFrame(timing, p, e.update(p), 0);
    expect(readInput(timing, 0).puzzleExit).toBe(true);
    const seq = { puzzle: { kind: "sequence" }, over: false } as unknown as GameState;
    e.update(fakePad());
    p = fakePad({ down: [gp.menu.left] });
    padFrame(seq, p, e.update(p), 0);
    expect(readInput(seq, 0).puzzleArrow).toBe("left");
  });

  it("menus: direção pelo direcional ou analógico e repetição ao segurar", () => {
    expect(navDirection(fakePad({ down: [gp.menu.down] }), gp)).toBe("down");
    expect(navDirection(fakePad({ axes: [0.9, 0.1, 0, 0] }), gp)).toBe("right");
    expect(navDirection(fakePad({ axes: [0.1, 0.1, 0, 0] }), gp)).toBeNull();
    const r = createRepeater(gp.menu_repeat), { delay, interval } = gp.menu_repeat;
    expect(r.step("down", 0)).toBe("down");
    expect(r.step("down", delay / 2)).toBeNull();
    expect(r.step("down", delay)).toBe("down");
    expect(r.step("down", delay + interval / 2)).toBeNull();
    expect(r.step("down", delay + interval)).toBe("down");
    expect(r.step(null, delay + 2 * interval)).toBeNull();
    expect(r.step("up", delay + 3 * interval)).toBe("up");
  });

  it("sensibilidade e inverter eixo Y valem para o controle", () => {
    const G = { puzzle: null, over: false } as unknown as GameState;
    const e = createEdges(gp.trigger_threshold);
    view.pitch = 0;
    setControls({ invertY: true, sensitivity: 2 });
    const p = fakePad({ axes: [0, 0, 0, 1] });
    padFrame(G, p, e.update(p), 0.1);
    expect(view.pitch).toBeCloseTo(gp.look_speed * 2 * 0.1);
    setControls({ invertY: ctl.invert_y, sensitivity: ctl.sensitivity.default });
    view.pitch = 0;
  });
});

describe("quebra-cabeça acessível (puzzles.accessible)", () => {
  // a regra (zona × dificuldade × zone_mult, limitada à barra) mora só no simulador (`puzzleZoneWidth`, testada em
  // packages/sim/test/puzzles-acessiveis.test.ts); aqui o cliente não refaz a conta: o painel mostra a do sim
  it("zona do timing e do Mecânico vem do sim, maior que a normal e sem passar da barra; o balance não muda", () => {
    const on = makeConfig(balance, map, { ruleset: "v1", difficulty: "normal", accessiblePuzzles: true });
    const off = makeConfig(balance, map, { ruleset: "v1", difficulty: "normal" });
    for (const mech of [false, true]) {
      expect(puzzleZoneWidth(on, mech)).toBeGreaterThan(puzzleZoneWidth(off, mech));
      expect(puzzleZoneWidth(on, mech)).toBeLessThanOrEqual(1);
    }
    expect(on.balance).toBe(balance);
    expect(balance.puzzles.timing.zone).toBe(0.25); // o original não muda (GDD-v0.2 §2.3)
  });
  it("sem tempo: no timing, A/D e as setas de olhar viram o eixo lateral que move o marcador", () => {
    const untimed = { puzzle: { kind: "timing", untimed: true }, over: false } as unknown as GameState;
    const timed = { puzzle: { kind: "timing" }, over: false } as unknown as GameState;
    const look = balance.ui.controls.keyboard.look_right[0], right = balance.ui.controls.keyboard.right[0];
    keyDown(untimed, look, false);
    expect(readInput(untimed, 0).strafe).toBe(1);
    expect(readInput(timed, 0).strafe).toBe(0);
    keyUp(look);
    keyDown(untimed, right, false);
    expect(readInput(untimed, 0).strafe).toBe(1);
    keyUp(right);
    expect(readInput(untimed, 0).strafe).toBe(0);
  });
});

describe("câmera: fov e balanço", () => {
  afterEach(() => { setFov(null); setReduceCameraBob(false); });
  it("sem escolha, fov do protótipo; escolha limitada a ui.fov", () => {
    expect(cameraFov()).toBe(px.camera.fov);
    setFov(balance.ui.fov.max + 50);
    expect(cameraFov()).toBe(balance.ui.fov.max);
    setFov(balance.ui.fov.min - 50);
    expect(cameraFov()).toBe(balance.ui.fov.min);
    setFov(Number.NaN);
    expect(cameraFov()).toBe(px.camera.fov);
  });
  it("reduzir balanço multiplica por ui.options.reduced_bob (0 = zera)", () => {
    expect(bobScale()).toBe(1);
    setReduceCameraBob(true);
    expect(bobScale()).toBe(balance.ui.options.reduced_bob);
    expect(balance.ui.options.reduced_bob).toBe(0);
  });
});

describe("modo daltônico: troca de tokens", () => {
  const protanopia = PALETTE.modos_daltonico.protanopia.tokens;
  afterEach(() => { setColorMode("normal"); PALETTE.modos_daltonico.protanopia.tokens = protanopia; });
  /** paletas aprovadas na issue #57, opção (a) (GDD v0.3 §12.4; data/art/palette.json `modos_daltonico`) */
  const APPROVED = { protanopia: {}, deuteranopia: { "class.batedor": 0xffff94 }, tritanopia: { "gen.bonus": 0xc542ff } } as const;
  it("as 3 entradas existem; só os tokens aprovados na issue #57 mudam, os demais ficam como na paleta normal", () => {
    for (const m of ["protanopia", "deuteranopia", "tritanopia"] as const) {
      setColorMode(m);
      expect(getColorMode()).toBe(m);
      const swaps: Record<string, number> = APPROVED[m];
      expect(Object.keys(PALETTE.modos_daltonico[m].tokens).sort()).toEqual(Object.keys(swaps).sort());
      for (const k of Object.keys(PALETTE.tokens)) {
        setColorMode("normal"); const n = tok(k); setColorMode(m);
        expect(tok(k)).toBe(swaps[k] ?? n);
      }
    }
  });
  it("token sobreposto muda de cor só no modo; os demais ficam", () => {
    const normal = tok("gen.pendente"), other = tok("gen.pronto");
    PALETTE.modos_daltonico.protanopia.tokens = { "gen.pendente": [31, 31, 0] };
    setColorMode("protanopia");
    expect(tok("gen.pendente")).toBe(0xffff00);
    expect(tok("gen.pronto")).toBe(other);
    setColorMode("normal");
    expect(tok("gen.pendente")).toBe(normal);
    setColorMode("inexistente" as never);
    expect(getColorMode()).toBe("normal");
  });
});

describe("feixe pendente com reduzir flicker", () => {
  const st = balance.render.states, period = 1 / st.pending_hz;
  it("normal apaga; reduzido alterna aceso e pending_reduced_level; pronto continua aceso", () => {
    const off = (st.pending_duty + 0.5 * (1 - st.pending_duty)) * period, on = 0.5 * st.pending_duty * period;
    expect(beamLevel("pendente", off, false)).toBe(0);
    expect(beamLevel("pendente", off, true)).toBe(st.pending_reduced_level);
    expect(beamLevel("pendente", on, true)).toBe(1);
    for (let i = 0; i < 20; i++) expect(beamLevel("pronto", i * 0.137, true)).toBe(1);
  });
});

describe("pendências do R7", () => {
  afterEach(() => setLocale("pt-BR"));
  it("pt-BR: 0 moeda vira \"0 moedas\" (Intl dá \"one\" para 0 em português)", () => {
    setLocale("pt-BR");
    expect(t("end.stats", { time: 12, coins: 0 })).toBe("Tempo: 12 s · +0 moedas");
    expect(t("end.stats", { time: 12, coins: 1 })).toBe("Tempo: 12 s · +1 moeda");
  });
  it("ICU: seletores com nome de propriedade de Object.prototype", () => {
    const ast = parse("{k, select, constructor {C} toString {T} other {O}}");
    expect(format(ast, { k: "constructor" }, "pt-BR")).toBe("C");
    expect(format(ast, { k: "toString" }, "pt-BR")).toBe("T");
    expect(format(ast, { k: "hasOwnProperty" }, "pt-BR")).toBe("O");
    expect(format(parse("{n, plural, other {#}}"), { n: 2 }, "pt-BR")).toBe("2");
  });
});

describe("mudo remapeável (ação mute, D-41)", () => {
  afterEach(() => setControls({ keys: defaultBindings() }));
  it("padrão M; depois de remapear, só a nova tecla alterna o mudo", () => {
    expect(defaultBindings().mute).toEqual(["KeyM"]);
    let muted = false, calls = 0;
    const toggle = { muted: () => muted, toggle: () => (muted = !muted) };
    const target = new EventTarget();
    installMuteKey(target, () => { calls++; }, toggle, isMuteKey);
    const key = (code: string) => target.dispatchEvent(Object.assign(new Event("keydown"), { code, repeat: false }));
    key("KeyM");
    expect([muted, calls]).toEqual([true, 1]);
    setControls({ keys: rebind(defaultBindings(), "mute", "KeyN").bindings });
    key("KeyM");
    expect(calls).toBe(1);
    key("KeyN");
    expect([muted, calls]).toEqual([false, 2]);
  });
  it("o aviso do mudo mostra a tecla atual da ação (padrão M; remapeada, a nova)", () => {
    setLocale("pt-BR");
    expect(muteMessage(true)).toBe("Som mudo (M para ligar)");
    setControls({ keys: rebind(defaultBindings(), "mute", "KeyN").bindings });
    expect(muteMessage(true)).toBe("Som mudo (N para ligar)");
    expect(muteMessage(false)).toBe("Som ligado (N para mudo)");
    setLocale("en");
    setControls({ keys: rebind(defaultBindings(), "mute", "Digit0").bindings });
    expect(muteMessage(true)).toBe("Sound muted (0 to unmute)");
    setLocale("pt-BR");
  });
});
