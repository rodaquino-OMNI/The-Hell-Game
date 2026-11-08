// R2 (F1-04): regras do validador de mapas (GDD v0.3 §9.1, §9.3). O Pátio passa em todas as combinações;
// mapas quebrados de propósito falham na regra certa.
import type { GameMap } from "@thehell/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { gridBackend, validateMap, type RuleResult } from "../src/nav/index.ts";
import { initRecast, recastBackend } from "../src/nav/recast.ts";
import { balance, patio } from "./nav-helpers.ts";

const grid = gridBackend(balance);
const failed = (r: RuleResult[]) => r.filter(x => x.status === "falha").map(x => x.rule);
const clone = (m: GameMap): GameMap => JSON.parse(JSON.stringify(m));

beforeAll(() => initRecast());

describe("validador de mapas", () => {
  it("Pátio passa em todas as regras com o navmesh e com a grade", () => {
    for (const b of [recastBackend(balance), grid]) {
      const r = validateMap(patio, balance, b);
      expect(failed(r), b.name).toEqual([]);
      expect(r.filter(x => x.rule.endsWith("alcançáveis") && x.rule.startsWith("layout"))).toHaveLength(16);
      // a única regra não verificável é a vantagem por volta (simulador, R5)
      expect(r.filter(x => x.status === "lacuna").map(x => x.rule)).toEqual(["vantagem de loop_advantage por volta"]);
    }
  });

  it("geradores perto demais falham em generator_min_dist", () => {
    const m = clone(patio);
    m.layouts!.generators[2].generators[1] = [-14, -20];
    expect(failed(validateMap(m, balance, grid))).toContain("geradores g2: distância ≥ generator_min_dist");
  });

  it("gerador dentro de parede ou em sala fechada falha em alcançabilidade", () => {
    const m = clone(patio);
    m.layouts!.cages[1] = [0, 0];
    const f = failed(validateMap(m, balance, grid));
    expect(f).toContain("layout g0/gaiola1/saída0: geradores, gaiola e saída alcançáveis");
    expect(f).not.toContain("layout g0/gaiola0/saída0: geradores, gaiola e saída alcançáveis");
  });

  it("vão estreito entre caixas falha no corredor mínimo", () => {
    const m = clone(patio);
    m.walls.push([0, 5.5, 4, 1]); // a 1 m do bloco central (z 4): vão menor que 1,6 m
    const f = failed(validateMap(m, balance, grid));
    expect(f).toContain("corredor ≥ corridor_min (vãos entre caixas)");
  });

  it("passagem estreita única isola uma área no raio do corredor", () => {
    // sala com porta de 1,5 m: passa o agente (0,5 m) mas não o raio de 0,8 m
    const m = clone(patio);
    m.walls.push([20, 15, 10, 1], [20, 25, 10, 1], [15, 20, 1, 10], [25, 17.125, 1, 4.25], [25, 22.875, 1, 4.25]);
    for (const b of [grid, recastBackend(balance)]) {
      const r = validateMap(m, balance, b);
      expect(failed(r), b.name).toContain("corredor ≥ corridor_min (conexidade)");
      expect(failed(r), b.name).toContain("corredor ≥ corridor_min (vãos entre caixas)");
      expect(failed(r), b.name).not.toContain("área jogável conexa no raio do agente");
    }
  });

  it("loops: perímetro fora da faixa, rota bloqueada e falta de loops", () => {
    const m = clone(patio);
    m.loops![0] = { id: "curto", kind: "short", polygon: m.loops![0].polygon };
    m.loops![1] = { id: "parede", kind: "long", polygon: [[-15, -15], [-10, -15], [-10, -5], [-15, -5]] };
    const f = failed(validateMap(m, balance, grid));
    expect(f).toContain("loop curto: perímetro (short)");
    expect(f).toContain("loop parede: rota caminhável em volta de obstáculo");
    const none = clone(patio);
    none.loops = [];
    const g = failed(validateMap(none, balance, grid));
    expect(g).toContain("loops marcados");
    expect(g).toContain("cobertura de loops");
  });

  it("esconderijos, variações e spawns fora das regras", () => {
    const m = clone(patio);
    m.hideouts = [[0, 0]];
    m.layouts!.cages.push([0, -14]);
    m.layouts!.exits.pop();
    m.survivor_spawns = [[-3, 26]];
    m.hunter_spawn = [6, 26];
    m.size = [90, 90];
    m.wall_height = 2;
    const f = failed(validateMap(m, balance, grid));
    for (const rule of ["esconderijos ≥ hideouts_min", "esconderijos alcançáveis", "posições de gaiola", "saídas",
      "spawns livres e alcançáveis", "caçador nasce a ≥ hunter_spawn_min_dist", "lado do mapa", "altura das paredes"])
      expect(f).toContain(rule);
  });

  it("layouts desequilibrados falham no §9.3 (caçador → geradores)", () => {
    const m = clone(patio);
    m.layouts!.generators[3].generators = [[14, -26], [26, -24], [-10, -27], [24, -2]];
    expect(failed(validateMap(m, balance, grid))).toContain("equilíbrio dos layouts (caçador → geradores)");
  });

  it("mapa sem metadados novos falha nas contagens, sem quebrar", () => {
    const m = clone(patio);
    delete m.layouts; delete m.loops; delete m.hideouts;
    const f = failed(validateMap(m, balance, grid));
    expect(f).toEqual(expect.arrayContaining(["layouts de geradores", "posições de gaiola", "saídas", "loops marcados", "esconderijos ≥ hideouts_min"]));
  });
});
