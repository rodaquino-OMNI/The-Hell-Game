// D-34: modo tutorial da simulação (Treino do GDD-v0.3 §12.3) dirigido por `tutorial` em data/balance.yaml.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createGame, makeConfig, NO_INPUT, step, TUTORIAL_STEPS, type ClassName, type GameEvent, type GameState, type PlayerInput,
  type SimConfig, type TutorialStepName,
} from "../src/index.ts";
import { gridFromMap, type GridNav } from "../src/nav/index.ts";
import { balance, cfg as protoCfg, map } from "./helpers.ts";

const prod: SimConfig = makeConfig(balance, map); // padrão dos dados (v1)
const tb = balance.tutorial;
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
// o jogador simulado contorna paredes pela grade A* de reserva (o mesmo mapa nos dois rulesets: paredes do topo)
const grids = new Map<SimConfig, GridNav>();
const gridOf = (c: SimConfig) => grids.get(c) ?? grids.set(c, gridFromMap(c.map, c.balance, c.balance.survivor.radius)).get(c)!;

const routes = new WeakMap<GameState, { x: number; z: number; at: number; path: (readonly [number, number])[] }>();

/** jogador simulado: anda até o alvo da etapa e faz a ação dela; devolve a entrada do quadro */
function playerInput(c: SimConfig, g: GameState, frame: number): PlayerInput {
  const t = g.tutorial!, P = g.survivors[0], b = c.balance;
  const toward = (x: number, z: number): PlayerInput => {
    // caminho recalculado a cada segundo ou quando o destino muda; segue o primeiro ponto a mais de 0,3 m
    let r = routes.get(g);
    if (!r || r.x !== x || r.z !== z || frame - r.at >= 60) routes.set(g, r = { x, z, at: frame, path: gridOf(c).findPath([P.x, P.z], [x, z]) });
    while (r.path.length && Math.hypot(r.path[0][0] - P.x, r.path[0][1] - P.z) <= 0.3) r.path.shift();
    const w = r.path[0] ?? [x, z];
    return { ...NO_INPUT, forward: 1, yaw: Math.atan2(-(w[0] - P.x), -(w[1] - P.z)) };
  };
  switch (t.step) {
    case "move": return { ...NO_INPUT, forward: 1, yaw: Math.PI / 2 }; // para oeste (−x): campo aberto a partir do nascimento no Pátio
    case "generator": {
      const T = t.target!;
      if (dist(P, T) > b.prototype_extras.interact_range.generator * 0.8) return toward(T.x, T.z);
      return { ...NO_INPUT, interact: !g.puzzle && frame % 2 === 0 };
    }
    case "puzzle": {
      const z = g.puzzle;
      if (!z) { const T = t.target!; return dist(P, T) > b.prototype_extras.interact_range.generator * 0.8 ? toward(T.x, T.z) : { ...NO_INPUT, interact: frame % 2 === 0 }; }
      if (z.kind === "timing") return { ...NO_INPUT, puzzleSpace: Math.abs(z.t - z.zoneCenter) < z.zoneWidth / 4 };
      return { ...NO_INPUT, puzzleArrow: frame % 2 === 0 ? z.seq[z.i] : undefined };
    }
    case "rescue": {
      const T = t.target!;
      if (g.puzzle) return { ...NO_INPUT, puzzleExit: true };
      if (dist(P, T) > b.cage.rescue_range * 0.8) return toward(T.x, T.z);
      return { ...NO_INPUT, interactHeld: true };
    }
    case "ability": {
      const T = t.target;
      if (T && dist(P, T) > b.classes.mechanic.turbo.range * 0.8) return toward(T.x, T.z);
      return { ...NO_INPUT, ability: frame % 2 === 0 };
    }
    default: return NO_INPUT;
  }
}

interface Trace { g: GameState; events: GameEvent[]; done: { step: TutorialStepName; t: number }[] }

/** roda o tutorial inteiro com o jogador simulado, conferindo `g.tutorial` a cada quadro */
function playTutorial(c: SimConfig, cls: ClassName, seed: number, maxFrames = 60 * 120): Trace {
  const g = createGame(c, cls, seed, { mode: "tutorial" });
  const events: GameEvent[] = [], done: Trace["done"] = [];
  for (let i = 0; i < maxFrames && !g.over; i++) {
    const before = g.tutorial!.index;
    step(c, g, playerInput(c, g, i));
    const fresh = g.events.splice(0);
    events.push(...fresh);
    const steps = fresh.filter(e => e.type === "tutorial_step");
    expect(steps.length).toBe(g.tutorial!.index - before); // um evento por etapa concluída, nem mais nem menos
    for (const e of steps) if (e.type === "tutorial_step") done.push({ step: e.step, t: g.t });
  }
  return { g, events, done };
}

describe("modo tutorial (D-34, GDD-v0.3 §12.3)", () => {
  it("dados: as 5 etapas do GDD na ordem, caçador parado", () => {
    expect(tb.steps).toEqual([...TUTORIAL_STEPS]);
    expect(tb.steps).toEqual(["move", "generator", "puzzle", "rescue", "ability"]);
    expect(tb.hunter).toBe("idle");
  });

  it("criação: equipe do treino, aliado preso, primeira etapa sem alvo", () => {
    const g = createGame(prod, "Mecânico", 7, { mode: "tutorial" });
    expect(g.survivors).toHaveLength(tb.team_size);
    expect(g.survivors[1].st).toBe("cage");
    expect(g.tutorial).toEqual({ step: "move", index: 0, target: null, progress: 0 });
    // modo normal: nada muda (sem a chave `tutorial`, mesma equipe de sempre)
    const n = createGame(prod, "Mecânico", 7);
    expect("tutorial" in n).toBe(false);
    expect(n.survivors).toHaveLength(3);
    expect(createGame(prod, "Mecânico", 7, { mode: "normal" })).toEqual(n);
  });

  it("percorre as 5 etapas com entrada simulada; eventos e g.tutorial em cada etapa", () => {
    const c = prod, g = createGame(c, "Mecânico", 3, { mode: "tutorial" });
    const H0 = { x: g.hunter.x, z: g.hunter.z, hp: g.hunter.hp };
    const seen: TutorialStepName[] = [];
    let ended: GameEvent | null = null, frames = 0;
    for (let i = 0; i < 60 * 120 && !g.over; i++, frames++) {
      const t = g.tutorial!;
      const cur = t.step!, target = t.target;
      if (seen[seen.length - 1] !== cur) {
        seen.push(cur);
        // alvo de cada etapa
        expect(t.index).toBe(seen.length - 1);
        expect(t.progress).toBe(0);
        if (cur === "move") expect(t.target).toBeNull();
        if (cur === "generator" || cur === "puzzle" || cur === "ability") {
          expect(t.target?.kind).toBe("generator");
          const gen = g.gens[t.target!.id];
          expect([gen.x, gen.z, gen.bonus]).toEqual([t.target!.x, t.target!.z, false]);
        }
        if (cur === "rescue") {
          expect(t.target).toMatchObject({ kind: "cage", id: 1 });
          expect(g.survivors[1].st).toBe("cage");
        }
      }
      // fora da etapa de resgate, segurar a interação junto da gaiola não solta o aliado
      const input = t.index < tb.steps.indexOf("rescue") && i % 7 === 0 ? { ...playerInput(c, g, i), interactHeld: true } : playerInput(c, g, i);
      step(c, g, input);
      if (t.index < tb.steps.indexOf("rescue")) expect(g.survivors[1].st).toBe("cage");
      for (const e of g.events.splice(0)) {
        if (e.type === "tutorial_step") {
          expect(e).toEqual({ type: "tutorial_step", step: cur, index: seen.length - 1, done: true });
          if (cur === "puzzle") expect(g.gens[target!.id].n).toBeGreaterThanOrEqual(tb.puzzle.count);
        }
        if (e.type === "tutorial_end") ended = e;
        expect(e.type).not.toBe("end"); // o tutorial não usa o fim de partida normal
      }
      // caçador passivo: parado, sem atacar
      expect([g.hunter.x, g.hunter.z, g.hunter.hp >= 0]).toEqual([H0.x, H0.z, true]);
      expect(g.projectiles).toHaveLength(0);
      expect(g.traps).toHaveLength(0);
      expect(g.survivors[0].hp).toBe(balance.survivor.hp);
    }
    expect(seen).toEqual(tb.steps);
    expect(g.over).toBe(true);
    expect(g.tutorial).toEqual({ step: null, index: tb.steps.length, target: null, progress: 0 });
    expect(ended).toEqual({ type: "tutorial_end", time: Math.floor(g.t) });
    expect(frames).toBeLessThan(60 * 120);
    // depois do fim a partida não anda
    const t = g.t; step(c, g, NO_INPUT); expect(g.t).toBe(t);
  });

  it("conclui com as 3 classes nos dois rulesets", () => {
    for (const c of [prod, protoCfg]) for (const cls of ["Curandeiro", "Mecânico", "Atacador"] as const) {
      const r = playTutorial(c, cls, 11);
      expect(r.g.over).toBe(true);
      expect(r.done.map(d => d.step)).toEqual(tb.steps);
      expect(r.events.filter(e => e.type === "tutorial_end")).toHaveLength(1);
    }
  });

  it("etapa mover: progresso em metros até `tutorial.move.distance`", () => {
    const g = createGame(prod, "Curandeiro", 5, { mode: "tutorial" });
    for (let i = 0; i < 30; i++) step(prod, g, { ...NO_INPUT, forward: 1, yaw: Math.PI / 2 });
    expect(g.tutorial!.step).toBe("move");
    expect(g.tutorial!.progress).toBeCloseTo(30 / 60 * balance.survivor.walk, 6);
  });

  it("resgate só na etapa rescue: segurar a interação na gaiola antes dela não solta o aliado", () => {
    const g = createGame(prod, "Curandeiro", 4, { mode: "tutorial" });
    const P = g.survivors[0], A = g.survivors[1];
    P.x = A.x + 1; P.z = A.z;
    for (let i = 0; i < balance.cage.rescue_time * 2 * 60; i++) step(prod, g, { ...NO_INPUT, interactHeld: true });
    expect(A.st).toBe("cage");
    expect(P.rescue).toBe(0);
    g.tutorial!.step = "rescue"; // mesma posição, agora na etapa: solta
    for (let i = 0; i < balance.cage.rescue_time * 60 + 2; i++) step(prod, g, { ...NO_INPUT, interactHeld: true });
    expect(A.st).toBe("ok");
  });

  it("sem fim por tempo: a gaiola não mata e o limite duro não encerra", () => {
    const g = createGame(prod, "Atacador", 9, { mode: "tutorial" });
    const n = Math.ceil(Math.max(prod.cageTime, balance.match.hard_time_limit) * 60) + 60;
    for (let i = 0; i < n; i++) step(prod, g, NO_INPUT);
    expect(g.over).toBe(false);
    expect(g.survivors[1].st).toBe("cage");
    expect(g.tutorial!.step).toBe("move");
    expect(g.events.some(e => e.type === "end")).toBe(false);
  });
});

describe("determinismo do modo tutorial", () => {
  const hash = (c: SimConfig, seed: number) => {
    const r = playTutorial(c, "Mecânico", seed);
    return createHash("sha256").update(JSON.stringify([r.g, r.events])).digest("hex");
  };
  it("mesma semente → mesmo hash em 100 execuções (v1 e protótipo)", () => {
    for (const c of [prod, protoCfg]) {
      const ref = hash(c, 42);
      for (let i = 0; i < 100; i++) expect(hash(c, 42)).toBe(ref);
    }
  });
  it("semente diferente → partida diferente", () => {
    expect(hash(prod, 42)).not.toBe(hash(prod, 43));
  });
});
