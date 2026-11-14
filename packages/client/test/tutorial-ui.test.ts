// V6: tela do Treino (GDD-v0.3 §12.3; D-34). Barra só em "mover" e "quebra-cabeça", check nas etapas binárias pelo
// evento, "etapa pulada" com `skipped: true`, "pular etapa" uma vez por acionamento e marcador do alvo na borda.
import { describe, expect, it } from "vitest";
import { createGame, drainEvents, makeConfig, NO_INPUT, skipTutorialStep, step, type GameEvent, type TutorialState } from "@thehell/sim";
import { balance, map } from "../src/data.ts";
import {
  barFraction, createSkipGate, isBarStep, markerPlacement, newTrack, panelView, stepOutcome, tickTrack, trackEvents,
} from "../src/hud/tutorial-logic.ts";
import { endRows } from "../src/ui/tutorial-end.ts";

const cfg = makeConfig(balance, map);
const tb = balance.tutorial, ui = balance.ui.tutorial;
const st = (p: Partial<TutorialState>): TutorialState => ({ step: "move", index: 0, target: null, progress: 0, goal: tb.move.distance, ...p });

describe("barra de progresso do Treino", () => {
  it("move e puzzle: min(1, progress/goal)", () => {
    expect(barFraction(st({ progress: tb.move.distance / 2 }))).toBeCloseTo(0.5);
    expect(barFraction(st({ progress: tb.move.distance * 3 }))).toBe(1);
    expect(barFraction(st({ step: "puzzle", index: 2, progress: 0, goal: tb.puzzle.count }))).toBe(0);
    expect(barFraction(st({ step: "puzzle", index: 2, progress: tb.puzzle.count, goal: tb.puzzle.count }))).toBe(1);
  });
  it("sem barra nas binárias, no fim (step null, goal 0) e fora do Treino", () => {
    for (const s of ["generator", "rescue", "ability"] as const) {
      expect(isBarStep(s)).toBe(false);
      expect(barFraction(st({ step: s, goal: 1 }))).toBeNull();
    }
    expect(barFraction(st({ step: null, index: tb.steps.length, goal: 0 }))).toBeNull();
    expect(barFraction(undefined)).toBeNull();
  });
  it("painel: binária em andamento mostra o quadro vazio do check, não a barra", () => {
    const v = panelView(st({ step: "rescue", index: 3, goal: 1 }), null)!;
    expect(v.bar).toBeNull();
    expect(v.mark).toBe("empty");
    expect(panelView(st({ progress: 1 }), null)!.mark).toBeNull();
    expect(panelView(st({ step: null, index: 5, goal: 0 }), null)).toBeNull();
  });
});

describe("evento tutorial_step → check / etapa pulada", () => {
  const ev = (step: "move" | "generator" | "puzzle" | "rescue" | "ability", index: number, skipped = false): GameEvent =>
    ({ type: "tutorial_step", step, index, done: true, ...(skipped ? { skipped: true as const } : {}) });

  it("stepOutcome: done sem skipped, skipped com skipped:true, null para outros eventos", () => {
    expect(stepOutcome(ev("generator", 1))).toEqual({ step: "generator", index: 1, outcome: "done" });
    expect(stepOutcome(ev("generator", 1, true))?.outcome).toBe("skipped");
    expect(stepOutcome({ type: "tutorial_end", time: 3 })).toBeNull();
  });
  it("binária concluída: check (sem barra); pulada: marca de pulada; com barra concluída: barra cheia", () => {
    const tr = newTrack(), goal = (s: string) => (s === "move" ? tb.move.distance : s === "puzzle" ? tb.puzzle.count : 1);
    const next = st({ step: "puzzle", index: 2, goal: tb.puzzle.count });
    trackEvents(tr, [ev("generator", 1)], goal, ui.done_s);
    let v = panelView(next, tr.notice)!;
    expect(v).toMatchObject({ step: "generator", outcome: "done", mark: "check", bar: null });
    trackEvents(tr, [ev("puzzle", 2, true)], goal, ui.done_s);
    v = panelView(next, tr.notice)!;
    expect(v).toMatchObject({ step: "puzzle", outcome: "skipped", mark: "skipped", bar: null });
    trackEvents(tr, [ev("move", 0)], goal, ui.done_s);
    v = panelView(next, tr.notice)!;
    expect(v).toMatchObject({ step: "move", outcome: "done", mark: null, bar: 1, progress: { done: tb.move.distance, goal: tb.move.distance } });
    expect([...tr.outcomes.entries()].map(([i, o]) => [i, o.outcome])).toEqual([[1, "done"], [2, "skipped"], [0, "done"]]);
  });
  it("o aviso dura ui.tutorial.done_s e depois o painel volta à etapa atual", () => {
    const tr = newTrack();
    trackEvents(tr, [ev("generator", 1)], () => 1, ui.done_s);
    tickTrack(tr, ui.done_s / 2);
    expect(tr.notice).not.toBeNull();
    tickTrack(tr, ui.done_s);
    expect(tr.notice).toBeNull();
    expect(panelView(st({ step: "puzzle", index: 2, goal: 1 }), tr.notice)!.outcome).toBeNull();
  });
  it("lista do fim: etapas de tutorial.steps na ordem com feita/pulada", () => {
    const tr = newTrack();
    trackEvents(tr, [ev("move", 0), ev("generator", 1, true), ev("puzzle", 2), ev("rescue", 3, true), ev("ability", 4)], () => 1, ui.done_s);
    expect(endRows(tb.steps, tr.outcomes)).toEqual([
      { step: "move", outcome: "done" }, { step: "generator", outcome: "skipped" }, { step: "puzzle", outcome: "done" },
      { step: "rescue", outcome: "skipped" }, { step: "ability", outcome: "done" },
    ]);
  });
});

describe("pular etapa: uma vez por acionamento", () => {
  it("vários pedidos no mesmo quadro viram um; dentro de skip_debounce_s do acionamento são descartados", () => {
    const g = createSkipGate(ui.skip_debounce_s), d = ui.skip_debounce_s;
    expect(g.request(10)).toBe(true);
    expect(g.request(10)).toBe(false); // segundo aperto no mesmo instante
    expect(g.take()).toBe(true);
    expect(g.take()).toBe(false); // mesmo quadro de novo: nada pendente
    // quadro lento: o 2º aperto, logo depois do 1º, chega no quadro seguinte e ainda é descartado
    expect(g.request(10 + d / 10)).toBe(false);
    expect(g.take()).toBe(false);
    expect(g.request(10 + d)).toBe(true);
    expect(g.take()).toBe(true);
    g.request(100); g.reset();
    expect(g.take()).toBe(false);
  });
  it("com intervalo 0: dois pedidos no mesmo quadro ainda pulam uma vez só", () => {
    const g = createSkipGate(0);
    g.request(1); g.request(1);
    expect(g.take()).toBe(true);
    expect(g.take()).toBe(false);
  });
  it("com o sim: dois pedidos no mesmo quadro pulam uma etapa só, e o evento sai com skipped:true", () => {
    const G = createGame(cfg, "Curandeiro", 7, { mode: "tutorial" });
    const gate = createSkipGate(ui.skip_debounce_s);
    let now = 0;
    gate.request(now); gate.request(now);
    // o laço do cliente: no máximo um skip por quadro, antes do passo (main.ts)
    const frame = () => { if (G.tutorial && !G.over && gate.take()) skipTutorialStep(cfg, G); step(cfg, G, NO_INPUT); now += 1 / 60; return drainEvents(G); };
    const ev = frame();
    expect(G.tutorial!.index).toBe(1);
    const tr = newTrack();
    trackEvents(tr, ev, () => 1, ui.done_s);
    expect(tr.outcomes.get(0)).toEqual({ step: "move", outcome: "skipped" });
    // pula o resto (um por intervalo) até tutorial_end
    const all: GameEvent[] = [];
    for (let i = 0; i < 60 * 10 && !G.over; i++) { gate.request(now); all.push(...frame()); }
    trackEvents(tr, all, () => 1, ui.done_s);
    expect(all.filter(e => e.type === "tutorial_end")).toHaveLength(1);
    expect(endRows(tb.steps, tr.outcomes).every(r => r.outcome === "skipped")).toBe(true);
  });
});

describe("marcador do alvo", () => {
  const W = 1280, H = 720, M = 40;
  it("na tela: no ponto projetado (object-fit: cover com a proporção da imagem)", () => {
    const p = markerPlacement({ nx: 0, ny: 0, behind: false }, 16 / 9, W, H, M);
    expect(p).toEqual({ x: W / 2, y: H / 2, edge: false, angle: 180 });
    // imagem 4:3 cobrindo 16:9: a altura sobra e é cortada; ny = 0,5 fica acima do meio por 0,25 da altura da imagem
    const q = markerPlacement({ nx: 0, ny: 0.5, behind: false }, 4 / 3, W, H, M);
    expect(q.y).toBeCloseTo(H / 2 - (W / (4 / 3)) / 4);
  });
  it("fora da vista: seta na borda apontando para o alvo; atrás da câmera, direção invertida", () => {
    const r = markerPlacement({ nx: 3, ny: 0, behind: false }, 16 / 9, W, H, M);
    expect(r).toMatchObject({ edge: true, x: W - M, y: H / 2 });
    expect(r.angle).toBeCloseTo(90);
    const b = markerPlacement({ nx: 0.2, ny: 0, behind: true }, 16 / 9, W, H, M);
    expect(b.edge).toBe(true);
    expect(b.x).toBe(M);
    expect(b.angle).toBeCloseTo(-90);
  });
});
