// Os muros do render vêm do mapa EFETIVO (`cfg.map`, de makeConfig), não do `map` de topo: assim as pilastras do v1
// (`maps.v1.short_loop_pillars`, GDD-v0.3 D-22/23/25) entram no cenário quando a Frente R liga a flag.
// O teste troca `cfg.map` por um mapa com uma caixa a mais (só no efetivo) e confere que ela é desenhada.
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { GameMap } from "@thehell/shared";

/** caixa de teste [x, z, largura_x, profundidade_z] que existe só no mapa efetivo (fora de todos os muros do Pátio; mesma posição de uma pilastra da R7) */
const EXTRA: [number, number, number, number] = [-10, 0, 1, 1];

vi.mock("../src/data.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/data.ts")>();
  const effective: GameMap = { ...real.map, walls: [...real.map.walls, EXTRA] };
  return { ...real, cfg: { ...real.cfg, map: effective } };
});

const { cfg, map } = await import("../src/data.ts");
const { addWalls } = await import("../src/render/scene.ts");
const { wallDistance } = await import("../src/render/environment.ts");
const { lampPoints } = await import("../src/render/retro/industrial.ts");

describe("render lê os muros de cfg.map", () => {
  it("pré-condição: a caixa extra existe só no mapa efetivo", () => {
    expect(cfg.map.walls.length).toBe(map.walls.length + 1);
    expect(map.walls.some(([x, z]) => x === EXTRA[0] && z === EXTRA[1])).toBe(false);
  });

  it("addWalls desenha uma malha por caixa do mapa efetivo, inclusive a extra", () => {
    const S = new THREE.Group(), baked: THREE.Mesh[] = [];
    const out = addWalls(S, baked, () => new THREE.MeshBasicMaterial());
    expect(out.length).toBe(cfg.map.walls.length);
    expect(baked.length).toBe(cfg.map.walls.length);
    const hit = out.find((m) => m.position.x === EXTRA[0] && m.position.z === EXTRA[1]);
    expect(hit).toBeDefined();
    hit!.geometry.computeBoundingBox();
    const size = hit!.geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(EXTRA[2]);
    expect(size.y).toBeCloseTo(cfg.map.wall_height);
    expect(size.z).toBeCloseTo(EXTRA[3]);
    expect(hit!.position.y).toBeCloseTo(cfg.map.wall_height / 2);
  });

  it("a oclusão assada (wallDistance) enxerga a caixa extra", () => {
    expect(wallDistance(EXTRA[0], EXTRA[1])).toBe(0);
  });

  it("as luminárias do preset industrial nascem também nas faces da caixa extra", () => {
    const [x, z, ww, wd] = EXTRA;
    const near = lampPoints().filter((l) => Math.abs(l.x - x) <= ww && Math.abs(l.z - z) <= wd);
    expect(near.length).toBeGreaterThan(0);
  });
});
