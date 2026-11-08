// R2 (F1-03): grade A* de reserva (GDD v0.3 §8.6, nav.fallback_grid). Caminho do spawn a cada gerador,
// gaiola e saída de todas as combinações; caminho impossível vazio; determinismo.
import { describe, expect, it } from "vitest";
import { GridNav, gridFromMap, pathLength, type P2 } from "../src/nav/index.ts";
import { balance, closedRoom, insideRoom, patio, patioTargets, spawn } from "./nav-helpers.ts";

const grid = gridFromMap(patio, balance);

describe("grade A* de reserva", () => {
  it("usa nav.fallback_grid e nav.agent_radius", () => {
    expect(grid.cell).toBe(balance.nav.fallback_grid);
    expect(grid.radius).toBe(balance.nav.agent_radius);
    expect(grid.nx).toBe(Math.round(patio.size[0] / balance.nav.fallback_grid));
  });

  it("encontra caminho do spawn a cada gerador, bônus, gaiola e saída em todas as combinações", () => {
    const targets = patioTargets();
    expect(targets.length).toBeGreaterThan(0);
    for (const [name, p] of targets) {
      const path = grid.findPath(spawn, p);
      expect(path.length, name).toBeGreaterThan(1);
      expect(path[0]).toEqual(spawn);
      expect(path[path.length - 1]).toEqual(p);
      // cada trecho do caminho é livre para o agente
      for (let i = 1; i < path.length; i++) expect(grid.lineOfSight(path[i - 1], path[i]), name).toBe(true);
    }
  });

  it("linha reta livre devolve só os dois pontos", () => {
    const a: P2 = [-8, 26], b: P2 = [-20, 26];
    expect(grid.findPath(a, b)).toEqual([a, b]);
  });

  it("contorna o bloco central: caminho mais longo que a reta", () => {
    const a: P2 = [0, -7], b: P2 = [0, 7];
    const path = grid.findPath(a, b);
    expect(path.length).toBeGreaterThan(2);
    expect(pathLength(path)).toBeGreaterThan(14);
  });

  it("caminho impossível devolve vazio (destino dentro da parede, fora do mapa ou em sala fechada)", () => {
    expect(grid.findPath(spawn, [0, 0])).toEqual([]);
    expect(grid.findPath(spawn, [100, 100])).toEqual([]);
    expect(grid.findPath([0, 0], spawn)).toEqual([]);
    const room = gridFromMap(closedRoom, balance);
    expect(room.findPath(spawn, insideRoom)).toEqual([]);
    expect(room.findPath(insideRoom, [22, 22]).length).toBeGreaterThan(1);
  });

  it("é determinística: mesma entrada, mesmo caminho, em instâncias diferentes", () => {
    const other = gridFromMap(patio, balance);
    for (const [, p] of patioTargets()) expect(other.findPath(spawn, p)).toEqual(grid.findPath(spawn, p));
    expect(grid.findPath([-25, -25], [25, 25])).toEqual(grid.findPath([-25, -25], [25, 25]));
  });

  it("componentes: Pátio conexo; sala fechada vira ilha separada", () => {
    expect(grid.components().count).toBe(1);
    const room = gridFromMap(closedRoom, balance).components();
    expect(room.count).toBe(2);
    expect(room.sizes.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it("campo de distância cresce com o caminho e ignora fonte bloqueada", () => {
    const s = grid.snapCell(spawn);
    const d = grid.distanceField([s, -1, grid.cellOf(0, 0)]);
    expect(d[s]).toBe(0);
    const far = grid.cellOf(-25, -25);
    const [sx, sz] = grid.center(s), [fx, fz] = grid.center(far);
    expect(d[far]).toBeGreaterThanOrEqual(Math.hypot(fx - sx, fz - sz));
    expect(d[far]).toBeLessThan(Infinity);
    expect(d[grid.cellOf(0, 0)]).toBe(Infinity);
  });

  it("não corta quina na diagonal e respeita a borda do mapa", () => {
    const g = new GridNav({ size: [4, 4], boxes: [[-0.5, -0.5, 1, 1], [0.5, 0.5, 1, 1]], cell: 1, radius: 0, snap: 0.5 });
    // células (1,1) e (2,2) livres em diagonal, mas as ortogonais (2,1) e (1,2) estão bloqueadas
    expect(g.findCells(g.cellOf(-0.5, 0.5), g.cellOf(0.5, -0.5))).not.toHaveLength(2);
    expect(g.cellOf(-3, 0)).toBe(-1);
    expect(g.isClear(1.9, 0)).toBe(true);
    expect(new GridNav({ size: [4, 4], boxes: [], cell: 1, radius: 0.5, snap: 0.5 }).isClear(1.9, 0)).toBe(false);
  });
});
