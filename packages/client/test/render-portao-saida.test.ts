// Portão, saída e jaula do render vêm da PARTIDA (`GameState.arena`) e muros/tamanho do mapa EFETIVO (`cfg.map`), não do
// `map` de topo: com `maps.v1.side_exit` (D-25) o portão lateral do Pátio fica na parede oeste, girado por
// `arena.gateFacing`; com `maps.v1.short_loop_pillars` (D-23) os pilares entram no cenário (R7-mapas, GDD-v0.3 §9.3).
// O teste liga as duas flags como a Frente R indica: makeConfig(balance, map, { ruleset: "v1", mapFlags }).
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/data.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/data.ts")>();
  const { makeConfig } = await import("@thehell/sim");
  return { ...real, cfg: makeConfig(real.balance, real.map, { ruleset: "v1", mapFlags: { short_loop_pillars: true, side_exit: true } }) };
});

const { balance, cfg, map } = await import("../src/data.ts");
const { createGame, insideWall } = await import("@thehell/sim");
const { addGate, addWalls, gatePose, meshes, placeCage } = await import("../src/render/scene.ts");

/** primeira semente cuja partida sorteia a saída pedida (o layout vem da semente, GDD-v0.3 §9.3) */
function gameWith(pred: (a: ReturnType<typeof createGame>["arena"]) => boolean) {
  for (let s = 1; s < 5000; s++) { const g = createGame(cfg, "Curandeiro", s); if (pred(g.arena)) return g; }
  throw new Error("nenhuma semente sorteou a saída pedida");
}

describe("render: portão e saída pela arena, pilares pelo mapa efetivo (flags R7 ligadas)", () => {
  it("pré-condição: as flags estão ligadas no cfg do teste", () => {
    expect(cfg.v1).toBe(true);
    expect(cfg.balance.maps.v1.side_exit).toBe(true);
    expect(cfg.balance.maps.v1.short_loop_pillars).toBe(true);
  });

  it("pilares: addWalls desenha as caixas do mapa de topo mais as 3 do v1", () => {
    const pillars = map.v1!.pillars!;
    expect(pillars.length).toBe(3);
    const S = new THREE.Group(), baked: THREE.Mesh[] = [];
    const out = addWalls(S, baked, () => new THREE.MeshBasicMaterial());
    expect(out.length).toBe(map.walls.length + 3);
    for (const [x, z] of pillars) expect(out.some((m) => m.position.x === x && m.position.z === z)).toBe(true);
  });

  it("saída lateral oeste: portão na linha exitX, centrado em arena.gate.z, girado por gateFacing", () => {
    const g = gameWith((a) => a.exitX !== undefined);
    const a = g.arena;
    expect(a.gateFacing).toEqual({ x: -1, z: 0 });
    // o portão da partida não é o do mapa de topo (a quebra "map.gate" cai aqui)
    expect([a.gate.x, a.gate.z]).not.toEqual(map.gate);
    const S = new THREE.Group();
    const gate = addGate(S, a, new THREE.MeshBasicMaterial());
    expect(meshes.get("gate")).toBe(gate);
    expect(gate.position.x).toBe(a.exitX);
    expect(gate.position.z).toBe(a.gate.z);
    expect(gate.rotation.y).toBeCloseTo(Math.PI / 2);
    // −z local aponta para fora (gateFacing) e a largura (x local) corre em z, ao longo da abertura
    gate.updateMatrixWorld();
    const out = new THREE.Vector3(0, 0, -1).transformDirection(gate.matrixWorld);
    expect(out.x).toBeCloseTo(a.gateFacing.x); expect(out.z).toBeCloseTo(a.gateFacing.z);
    const along = new THREE.Vector3(1, 0, 0).transformDirection(gate.matrixWorld);
    expect(Math.abs(along.z)).toBeCloseTo(1);
    // dentro da abertura (meia-largura prototype_extras.gate_exit_half_width) e fora de qualquer muro, nas duas pontas
    gate.geometry.computeBoundingBox();
    const half = gate.geometry.boundingBox!.max.x;
    expect(half).toBeLessThanOrEqual(balance.prototype_extras.gate_exit_half_width);
    for (const k of [-1, 0, 1]) expect(insideWall(cfg, gate.position.x, gate.position.z + k * half)).toBe(false);
  });

  it("saída norte (layout 0): mesma pose de antes, (gate.x, exitZ) e sem giro", () => {
    const g = gameWith((a) => a.exitZ !== undefined && a.gateFacing.z === -1);
    const p = gatePose(g.arena);
    expect([p.x, p.z]).toEqual([g.arena.gate.x, g.arena.exitZ]);
    // giro nulo exato (sem ruído de ponto flutuante na matriz: as capturas de referência ficam iguais pixel a pixel)
    expect(p.rotY === 0).toBe(true);
  });

  it("gatePose gira pelo gateFacing dado, não pela posição", () => {
    const base = { gate: { x: 0, z: 0 }, exitZ: 0 };
    expect(Math.abs(gatePose({ ...base, gateFacing: { x: 0, z: 1 } }).rotY)).toBeCloseTo(Math.PI);
    expect(gatePose({ ...base, gateFacing: { x: 1, z: 0 } }).rotY).toBeCloseTo(-Math.PI / 2);
    expect(gatePose({ ...base, gateFacing: { x: -1, z: 0 } }).rotY).toBeCloseTo(Math.PI / 2);
  });

  it("jaula: placeCage usa arena.cage da partida", () => {
    const g = gameWith((a) => a.cage.z !== map.cage[1]);
    const cage = new THREE.Object3D(); cage.position.set(map.cage[0], 1.2, map.cage[1]);
    meshes.set("cage", cage);
    placeCage(g.arena);
    expect([cage.position.x, cage.position.y, cage.position.z]).toEqual([g.arena.cage.x, 1.2, g.arena.cage.z]);
    meshes.delete("cage");
  });
});
