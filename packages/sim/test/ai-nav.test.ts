// R3 — navegação do caçador (GDD-v0.3 §8.6): caminho pela grade A* (`nav.fallback_grid`) ou navmesh injetado,
// anti-travamento (`ai.anti_stuck`) e critério de trava T-03 (`ai.stuck_fail_after`) medido em partidas headless.
import { describe, expect, it } from "vitest";
import {
  HUNTER_TRANSITIONS, insideWall, measureStuck, newStuckMeter, playHeadless, step, NO_INPUT, type Difficulty, type GameState,
  type HunterMode, type SimConfig,
} from "../src/index.ts";
import { gridFromMap, type NavQuery, type P2 } from "../src/nav/index.ts";
import { initRecast, navParams, RecastNav } from "../src/nav/recast.ts";
import { aiCfg, aiGame, b, map, normal } from "./ai-helpers.ts";

/** caçador ao norte do bloco central investigando um ponto ao sul (o caminho reto atravessa o bloco) */
function across(c: SimConfig): GameState {
  const g = aiGame(c, { x: 0, z: -6.5 }, 0);
  const ai = g.hunter.ai!;
  ai.mode = "investigate";
  ai.investigate = { x: 0, z: 6.5, until: 1e9, spot: { x: 0, z: 6.5 } };
  return g;
}
function runMeter(c: SimConfig, g: GameState, seconds: number, each?: () => void) {
  const m = newStuckMeter(g);
  for (let i = 0; i < seconds * 60; i++) { step(c, g, NO_INPUT); measureStuck(c, g, m, 1 / 60); each?.(); }
  return m;
}

describe("grade: ponto navegável mais próximo (achado da revisão do R2)", () => {
  it("nearestFree: dentro de parede, fora do mapa e num ponto livre", () => {
    const grid = gridFromMap(map, b);
    const a = grid.nearestFree([0, 0])!; // centro do bloco central (8 × 8)
    expect(grid.isClear(a[0], a[1])).toBe(true);
    expect(Math.max(Math.abs(a[0]), Math.abs(a[1]))).toBeGreaterThanOrEqual(4 + b.nav.agent_radius);
    const out = grid.nearestFree([100, -100])!;
    expect(grid.isClear(out[0], out[1])).toBe(true);
    const ok = grid.nearestFree([-8.1, 16.1])!;
    expect(Math.hypot(ok[0] + 8.1, ok[1] - 16.1)).toBeLessThanOrEqual(b.nav.fallback_grid);
    const blocked = gridFromMap({ size: [4, 4], walls: [[0, 0, 4, 4]] }, b);
    expect(blocked.nearestFree([0, 0])).toBeNull();
  });
});

describe("caminho em volta de obstáculo", () => {
  it("grade A*: contorna o bloco central, chega ao destino e nunca entra em parede", () => {
    const g = across(normal);
    const m = runMeter(normal, g, 8, () => expect(insideWall(normal, g.hunter.x, g.hunter.z)).toBe(false));
    expect(Math.hypot(g.hunter.x, g.hunter.z - 6.5)).toBeLessThan(b.ai.search_radius + 1);
    expect(m.failAt).toBeNull();
    expect(g.hunter.ai!.replans).toBe(0);
  });
  it("navmesh do recast injetado na config (NavQuery), fora do estado", async () => {
    await initRecast();
    const nav = RecastNav.build(map, navParams(b, b.hunter.radius));
    const c = aiCfg("normal", { nav });
    expect(c.nav).toBe(nav);
    const g = across(c);
    const before = JSON.stringify(g);
    expect(before).not.toContain("navMesh");
    const m = runMeter(c, g, 8);
    expect(g.hunter.ai!.pathOk).toBe(true);
    expect(Math.hypot(g.hunter.x, g.hunter.z - 6.5)).toBeLessThan(b.ai.search_radius + 1);
    expect(m.failAt).toBeNull();
    nav.dispose();
  });
});

describe("anti-travamento e critério de trava T-03", () => {
  it("caminho que atravessa parede: o anti-travamento replaneja e o medidor acusa trava após ai.stuck_fail_after", () => {
    const straight: NavQuery = { findPath: (a: P2, z: P2) => [a, z] }; // "navmesh" quebrado: reta através do bloco
    const c = aiCfg("normal", { nav: straight });
    const g = across(c);
    const m = runMeter(c, g, b.ai.stuck_fail_after + 1.5);
    expect(g.hunter.ai!.replans).toBeGreaterThanOrEqual(Math.floor(b.ai.stuck_fail_after / b.ai.anti_stuck.window));
    expect(m.failAt).not.toBeNull();
    expect(m.failAt!.t).toBeGreaterThan(b.ai.stuck_fail_after);
    expect(m.worst).toBeGreaterThan(b.ai.stuck_fail_after);
    expect(g.hunter.ai!.pathOk).toBe(true);
  });
  it("sem caminho válido não conta como trava (pathOk falso)", () => {
    const none: NavQuery = { findPath: () => [] };
    const c = aiCfg("normal", { nav: none });
    const g = across(c);
    const m = runMeter(c, g, b.ai.stuck_fail_after + 1.5);
    expect(g.hunter.ai!.pathOk).toBe(false);
    expect(m.failAt).toBeNull();
    expect(m.worst).toBe(0);
  });
  it("meia-volta de propósito não é trava (o esperado é a soma vetorial do que a IA tentou andar)", () => {
    const g = aiGame(normal, { x: -8, z: 16 }, Math.PI);
    const ai = g.hunter.ai!;
    ai.mode = "investigate";
    const m = newStuckMeter(g);
    for (let i = 0; i < 6 * 60; i++) {
      // destino alterna entre dois pontos a 1,5 m a cada 0,5 s: anda o tempo todo e quase não sai do lugar
      const k = Math.floor(i / 30) % 2;
      ai.investigate = { x: -8, z: 16 + 1.5 * k, until: 1e9, spot: { x: -8, z: 16 + 1.5 * k } };
      step(normal, g, NO_INPUT); measureStuck(normal, g, m, 1 / 60);
    }
    expect(m.failAt).toBeNull();
    expect(m.dither).toBeGreaterThan(b.ai.stuck_fail_after); // o vaivém aparece só no indicador informativo
  });
  it("sem IA (caçador do R1) o medidor não faz nada", () => {
    const c = aiCfg("normal", { hunterBrain: "basic" });
    const g = aiGame(c);
    expect(g.hunter.ai).toBeUndefined();
    const m = newStuckMeter(g);
    measureStuck(c, g, m, 1 / 60);
    expect(m.win.t).toBe(0);
  });
});

describe("partidas headless (amostra do aceite T-03; o lote de 1.000 roda em tools/sim/run.ts)", () => {
  for (const d of ["easy", "normal", "hard", "nightmare"] as Difficulty[]) {
    it(`${d}: sem trava, sem exceção, transições dentro do grafo, fim até o limite duro`, () => {
      const c = aiCfg(d);
      for (let seed = 1; seed <= 6; seed++) {
        const r = playHeadless(c, seed);
        expect(r.stuck.failAt).toBeNull();
        expect(r.team).not.toBeNull();
        expect(r.time).toBeLessThanOrEqual(b.match.hard_time_limit + 1 / 30);
        for (const k of Object.keys(r.transitions)) {
          const [from, to] = k.split(">") as [HunterMode, HunterMode];
          expect(HUNTER_TRANSITIONS[from]).toContain(to);
        }
        // o caçador chega a perseguir; com os bots competentes (padrão do MJ-B) às vezes ouve antes de ver
        // (patrol>investigate>chase), então vale qualquer entrada em chase
        expect(Object.keys(r.transitions).some(k => k.endsWith(">chase"))).toBe(true);
      }
    });
  }
  it("partida que chega ao limite duro termina por time_limit", () => {
    const c = aiCfg("normal");
    const short = { ...c, balance: { ...c.balance, match: { ...c.balance.match, hard_time_limit: 5 } } };
    const r = playHeadless(short, 1);
    expect(r.reason).toBe("time_limit");
    expect(r.time).toBeCloseTo(5, 1);
  });
});
