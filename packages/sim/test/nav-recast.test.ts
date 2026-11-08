// R2 (F1-03): navmesh do recast-navigation (GDD v0.3 §8.6) em Node. Caminho do spawn a cada gerador,
// gaiola e saída; caminho impossível vazio; determinismo da geração e das consultas; ida e volta pelos bytes.
import { beforeAll, describe, expect, it } from "vitest";
import { floorRects, pathLength, type P2 } from "../src/nav/index.ts";
import { floorMesh, initRecast, navParams, recastBackend, RecastNav } from "../src/nav/recast.ts";
import { balance, closedRoom, insideRoom, patio, patioTargets, spawn } from "./nav-helpers.ts";

let nav: RecastNav;
beforeAll(async () => {
  await initRecast();
  await initRecast(); // idempotente
  nav = RecastNav.build(patio, navParams(balance));
});

describe("navmesh (recast)", () => {
  it("parâmetros vêm de nav.*", () => {
    const p = navParams(balance);
    expect(p).toMatchObject({ cellSize: balance.nav.cell_size, agentRadius: balance.nav.agent_radius, snap: balance.nav.query_snap });
    expect(navParams(balance, balance.maps.corridor_min / 2).agentRadius).toBe(balance.maps.corridor_min / 2);
  });

  it("malha do chão cobre o mapa menos as caixas", () => {
    const area = floorRects(patio.size, patio.walls).reduce((s, [x0, z0, x1, z1]) => s + (x1 - x0) * (z1 - z0), 0);
    const inner = patio.walls.slice(4).reduce((s, w) => s + w[2] * w[3], 0);
    expect(area).toBeCloseTo(60 * 60 - inner, 6);
    const { positions, indices } = floorMesh(patio);
    expect(indices.length / 3).toBe((positions.length / 3 / 4) * 2);
  });

  it("encontra caminho do spawn a cada gerador, bônus, gaiola e saída em todas as combinações", () => {
    for (const [name, p] of patioTargets()) {
      const path = nav.findPath(spawn, p);
      expect(path.length, name).toBeGreaterThan(1);
      const end = path[path.length - 1];
      expect(Math.hypot(end[0] - p[0], end[1] - p[1]), name).toBeLessThanOrEqual(balance.nav.query_snap);
    }
  });

  it("contorna o bloco central", () => {
    const path = nav.findPath([0, -7], [0, 7]);
    expect(pathLength(path)).toBeGreaterThan(14);
  });

  it("caminho impossível devolve vazio (dentro da parede, fora do mapa, sala fechada)", () => {
    expect(nav.findPath(spawn, [0, 0])).toEqual([]);
    expect(nav.findPath(spawn, [100, 100])).toEqual([]);
    const room = RecastNav.build(closedRoom, navParams(balance));
    expect(room.findPath(spawn, insideRoom)).toEqual([]);
    expect(room.findPath(insideRoom, [22, 22]).length).toBeGreaterThan(1);
    expect(room.components!.count).toBe(2);
    room.dispose();
  });

  it("geração determinística: mesmos bytes e mesmos caminhos", () => {
    const again = RecastNav.build(patio, navParams(balance));
    expect(again.toBytes()).toEqual(nav.toBytes());
    const a: P2 = [-25, -25], b: P2 = [25, 25];
    expect(again.findPath(a, b)).toEqual(nav.findPath(a, b));
    again.dispose();
  });

  it("navmesh exportado no build volta igual (fromBytes)", () => {
    const loaded = RecastNav.fromBytes(nav.toBytes(), navParams(balance));
    expect(loaded.components).toBeNull();
    for (const [, p] of patioTargets().slice(0, 9)) expect(loaded.findPath(spawn, p)).toEqual(nav.findPath(spawn, p));
    loaded.dispose();
  });

  it("componentes: Pátio conexo no raio do agente e no raio do corredor mínimo", () => {
    expect(nav.components!.count).toBe(1);
    expect(nav.components!.areas[0]).toBeGreaterThan(0);
    const b = recastBackend(balance).open(patio, balance.maps.corridor_min / 2);
    expect(b.componentCount()).toBe(1);
    expect(b.findPath(spawn, [-22, -22]).length).toBeGreaterThan(1);
    b.dispose!();
  });

  it("falha clara quando o mapa não tem chão", () => {
    expect(() => RecastNav.build({ size: [10, 10], walls: [[0, 0, 10, 10]], wall_height: 3.4 }, navParams(balance))).toThrow(/navmesh/);
  });
});
