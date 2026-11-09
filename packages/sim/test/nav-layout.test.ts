// R2: layouts de geradores, gaiolas e saídas (GDD v0.3 §9.3) e compatibilidade do layout 0 com a paridade.
import { MapSchema } from "@thehell/shared";
import { describe, expect, it } from "vitest";
import { createGame, makeConfig, nextRandom } from "../src/index.ts";
import {
  allLayoutChoices, chooseLayout, crossedExit, LAYOUT_SEED_SALT, formulaSpawns, layoutCounts, maxTeamSize, resolveLayout, survivorSpawns,
} from "../src/nav/index.ts";
import { balance, closedRoom, patio } from "./nav-helpers.ts";

describe("layouts do mapa", () => {
  it("Pátio tem 3–4 layouts de geradores, 2 gaiolas e 2 saídas (maps.*)", () => {
    const n = layoutCounts(patio);
    expect(n.generators).toBeGreaterThanOrEqual(balance.maps.generator_layouts[0]);
    expect(n.generators).toBeLessThanOrEqual(balance.maps.generator_layouts[1]);
    expect(n.cages).toBe(balance.maps.cage_positions);
    expect(n.exits).toBe(balance.maps.exits);
    expect(allLayoutChoices(patio)).toHaveLength(n.generators * n.cages * n.exits);
  });

  it("combinação (0, 0, 0) reproduz exatamente o mapa da paridade", () => {
    const m = resolveLayout(patio, { generators: 0, cage: 0, exit: 0 });
    expect(m).toEqual(patio);
    // a partida criada com o layout 0 é idêntica à criada com o mapa de topo
    expect(createGame(makeConfig(balance, m), "Curandeiro", 7)).toEqual(createGame(makeConfig(balance, patio), "Curandeiro", 7));
  });

  it("outras combinações trocam geradores, bônus, gaiola e saída", () => {
    const m = resolveLayout(patio, { generators: 1, cage: 1, exit: 1 });
    expect(m.generators).toEqual(patio.layouts!.generators[1].generators);
    expect(m.bonus).toEqual(patio.layouts!.generators[1].bonus);
    expect(m.cage).toEqual(patio.layouts!.cages[1]);
    expect(m.gate).toEqual(patio.layouts!.exits[1].gate);
    expect(m.exit_z).toBe(patio.layouts!.exits[1].exit_z);
    expect(m.walls).toBe(patio.walls);
    expect(() => resolveLayout(patio, { generators: 9, cage: 0, exit: 0 })).toThrow(/fora do mapa/);
  });

  it("mapa sem layouts tem uma combinação só", () => {
    expect(layoutCounts(closedRoom)).toEqual({ generators: 1, cages: 1, exits: 1 });
    expect(resolveLayout(closedRoom, { generators: 0, cage: 0, exit: 0 })).toBe(closedRoom);
    expect(() => resolveLayout(closedRoom, { generators: 1, cage: 0, exit: 0 })).toThrow(/não tem layouts/);
  });

  it("a semente escolhe a combinação de forma determinística e cobre todas", () => {
    const all = allLayoutChoices(patio);
    const seen = new Set<string>();
    for (let s = 0; s < 400; s++) {
      const c = chooseLayout(patio, s);
      expect(chooseLayout(patio, s)).toEqual(c);
      seen.add(JSON.stringify(c));
    }
    expect(seen.size).toBe(all.length);
  });

  it("a escolha usa sub-semente com sal fixo, descorrelacionada do primeiro sorteio da partida", () => {
    const all = allLayoutChoices(patio);
    let same = 0;
    for (let s = 0; s < 400; s++) {
      const c = chooseLayout(patio, s);
      // com o sal: igual a sortear com a semente seed ^ LAYOUT_SEED_SALT
      expect(c).toEqual(all[Math.floor(nextRandom({ seed: (s ^ LAYOUT_SEED_SALT) | 0 }) * all.length)]);
      // sem o sal, o índice seria o do primeiro nextRandom da partida
      if (JSON.stringify(c) === JSON.stringify(all[Math.floor(nextRandom({ seed: s }) * all.length)])) same++;
    }
    expect(same).toBeLessThan(400 / 4);
  });

  it("saída ao norte (protótipo) e ao sul", () => {
    const [north, south] = patio.layouts!.exits;
    const hw = balance.prototype_extras.gate_exit_half_width;
    expect(crossedExit(north, north.gate[0], north.exit_z! - 0.1, hw)).toBe(true);
    expect(crossedExit(north, north.gate[0], north.exit_z! + 0.1, hw)).toBe(false);
    expect(crossedExit(north, north.gate[0] + hw + 1, north.exit_z! - 0.1, hw)).toBe(false);
    expect(crossedExit(south, south.gate[0], south.exit_z! + 0.1, hw)).toBe(true);
    expect(crossedExit(south, south.gate[0], south.exit_z! - 0.1, hw)).toBe(false);
    expect(crossedExit({ gate: [0, 5], exit_z: 5 }, 0, 4, hw)).toBe(true);
  });

  it("spawns: lista explícita para até 5 jogadores, começando pela fórmula do protótipo", () => {
    const n = maxTeamSize(balance);
    expect(survivorSpawns(patio, n)).toHaveLength(n);
    const g = createGame(makeConfig(balance, patio), "Curandeiro", 1);
    const proto = formulaSpawns(patio, g.survivors.length);
    expect(survivorSpawns(patio, g.survivors.length)).toEqual(proto);
    expect(g.survivors.map(s => [s.x, s.z])).toEqual(proto);
    expect(survivorSpawns(closedRoom, 2)).toEqual(formulaSpawns(closedRoom, 2));
  });

  it("schema recusa layout 0 diferente do topo", () => {
    const raw = JSON.parse(JSON.stringify(patio));
    expect(MapSchema.safeParse(raw).success).toBe(true);
    raw.layouts.generators[0].generators[0] = [0, 0];
    raw.layouts.cages[0] = [1, 1];
    raw.layouts.exits[0].exit_z = 0;
    const r = MapSchema.safeParse(raw);
    expect(r.success).toBe(false);
    expect(r.error!.issues).toHaveLength(3);
  });
});
