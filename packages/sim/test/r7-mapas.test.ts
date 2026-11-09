// Item R7-mapas (docs/plano-construcao.md §7: D-22, D-23, D-25): mudanças de mapa só do ruleset v1, cada uma atrás de
// uma flag em `maps.v1`. O protótipo usa sempre o mapa de topo (paridade); com as flags desligadas o v1 é o de antes.
import { createHash } from "node:crypto";
import { MapSchema } from "@thehell/shared";
import { describe, expect, it } from "vitest";
import { collide, createGame, insideWall, makeConfig, NO_INPUT, step, type GameState } from "../src/index.ts";
import { lineOfSight } from "../src/perception.ts";
import { allLayoutChoices, chooseLayout, crossedExit, gateFacing, gridBackend, mapForV1, maxTeamSize, pointInPolygon, polygonPerimeter, resolveLayout, validateMap } from "../src/nav/index.ts";
import { balance as b, map, NO_MAP_FLAGS, withMapFlags } from "./helpers.ts";

const ALL = { fifth_generator: true, short_loop_pillars: true, side_exit: true } as const;
const cfgOf = (flags: Partial<typeof ALL>, ruleset: "v1" | "prototype" = "v1") =>
  makeConfig(withMapFlags(b, { ...NO_MAP_FLAGS, ...flags }), map, { ruleset, hunterBrain: "basic", botBrain: "prototype" });
const extra = map.v1!;

describe("flags de mapa do v1 (maps.v1)", () => {
  it("os dados: 5º gerador ligado (inerte com 3 sobreviventes); pilares e saída lateral desligados até o cliente desenhá-los (B-1)", () => {
    expect(b.maps.v1).toEqual({ fifth_generator: true, short_loop_pillars: false, side_exit: false });
  });
  it("makeConfig({ mapFlags }) sobrepõe só as flags dadas (capturas do cliente com ?debug=1)", () => {
    const c = makeConfig(b, map, { ruleset: "v1", mapFlags: { short_loop_pillars: true, side_exit: true } });
    expect(c.balance.maps.v1).toEqual(ALL);
    expect(c.map.walls).toEqual([...map.walls, ...extra.pillars!]);
    expect(c.map.layouts!.exits[extra.side_exit!.replaces]).toEqual({ gate: extra.side_exit!.gate, exit_x: extra.side_exit!.exit_x });
    expect(makeConfig(b, map, { ruleset: "prototype", mapFlags: ALL }).map).toBe(map);
    expect(b.maps.v1.short_loop_pillars).toBe(false); // o balanço de origem não muda
  });
  it("protótipo: o mapa da config é o de topo, mesmo com as flags ligadas (paridade)", () => {
    const p = cfgOf(ALL, "prototype");
    expect(p.map).toBe(map);
    const g = createGame(p, "Curandeiro", 3);
    expect(g.arena).toEqual({ layout: { generators: 0, cage: 0, exit: 0 }, cage: { x: map.cage[0], z: map.cage[1] }, gate: { x: map.gate[0], z: map.gate[1] }, exitZ: map.exit_z, gateFacing: { x: 0, z: -1 } });
    expect(g.gens.filter(x => !x.bonus).map(x => [x.x, x.z])).toEqual(map.generators);
  });
  it("v1 com as flags desligadas: mesmo mapa de topo (sem o bloco v1) e partida idêntica à do mapa sem acréscimos", () => {
    const off = cfgOf({});
    const { v1: _drop, ...top } = map;
    void _drop;
    expect(off.map).toEqual(top);
    const plain = makeConfig(withMapFlags(b, NO_MAP_FLAGS), top, { ruleset: "v1", hunterBrain: "basic", botBrain: "prototype" });
    const play = (c: typeof off) => { const g = createGame(c, "Mecânico", 11); for (let i = 0; i < 1200; i++) step(c, g, NO_INPUT); return JSON.stringify(g); };
    expect(play(off)).toBe(play(plain));
  });
  it("cada flag só mexe na parte dela", () => {
    const p = cfgOf({ short_loop_pillars: true }).map, s = cfgOf({ side_exit: true }).map, f = cfgOf({ fifth_generator: true }).map;
    expect(p.walls).toEqual([...map.walls, ...extra.pillars!]);
    expect(p.layouts).toEqual(map.layouts);
    expect(s.walls).toBe(map.walls);
    expect(s.layouts!.generators).toEqual(map.layouts!.generators);
    expect(f.walls).toBe(map.walls);
    expect(f.layouts!.exits).toEqual(map.layouts!.exits);
    expect(f.layouts!.generators.map(g => g.large_team)).toEqual(extra.large_team_generators);
  });
});

describe("D-23: pilares com loops curtos de 8–12 m", () => {
  const c = cfgOf({ short_loop_pillars: true });
  it("pilares entram em walls do mapa efetivo e do layout resolvido; a arena traz as caixas para o cliente", () => {
    expect(extra.pillars!.length).toBeGreaterThanOrEqual(2);
    expect(extra.pillars!.length).toBeLessThanOrEqual(3);
    for (const ch of allLayoutChoices(c.map)) expect(resolveLayout(c.map, ch).walls).toEqual(c.map.walls);
    const g = createGame(c, "Curandeiro", 5);
    expect(g.arena.walls).toEqual(c.map.walls);
    expect(createGame(cfgOf({}), "Curandeiro", 5).arena.walls).toBeUndefined();
  });
  it("cada pilar tem um loop curto em volta, com perímetro na faixa maps.loop_short_perimeter", () => {
    const short = c.map.loops!.filter(l => l.kind === "short");
    expect(short.length).toBeGreaterThanOrEqual(b.maps.short_loops_min);
    const [lo, hi] = b.maps.loop_short_perimeter;
    for (const [x, z] of extra.pillars!) {
      const l = short.find(s => pointInPolygon(x, z, s.polygon));
      expect(l, `loop em volta do pilar (${x}, ${z})`).toBeDefined();
      const per = polygonPerimeter(l!.polygon);
      expect(per).toBeGreaterThanOrEqual(lo);
      expect(per).toBeLessThanOrEqual(hi);
    }
  });
  it("o validador mede o loop curto: regra nova verde no mapa com pilares; sem os pilares o mapa não tem loop curto", () => {
    const r = validateMap(c.map, b, gridBackend(b), { ...NO_MAP_FLAGS, short_loop_pillars: true });
    expect(r.filter(x => x.status === "falha")).toEqual([]);
    const rule = r.find(x => x.rule.startsWith("loops curtos"));
    expect(rule?.status).toBe("ok");
    for (const l of extra.short_loops!) {
      expect(r.find(x => x.rule === `loop ${l.id}: perímetro (short)`)?.status).toBe("ok");
      expect(r.find(x => x.rule === `loop ${l.id}: rota caminhável em volta de obstáculo`)?.status).toBe("ok");
    }
    // a regra exige o loop: o mapa de topo validado como se tivesse os pilares falha nela
    const top = validateMap(cfgOf({}).map, b, gridBackend(b), { ...NO_MAP_FLAGS, short_loop_pillars: true });
    expect(top.find(x => x.rule.startsWith("loops curtos"))?.status).toBe("falha");
  });
  it("colisão e visão: o pilar é parede (empurra para fora e bloqueia a linha de visão)", () => {
    const [px, pz, w] = extra.pillars![0];
    expect(insideWall(c, px, pz)).toBe(true);
    expect(insideWall(cfgOf({}), px, pz)).toBe(false);
    const p = { x: px - w / 2, z: pz };
    collide(c, p, b.survivor.radius);
    expect(p.x).toBeCloseTo(px - w / 2 - b.survivor.radius, 9);
    expect(lineOfSight(c.map, { x: px - 2, z: pz }, { x: px + 2, z: pz })).toBe(false);
    expect(lineOfSight(cfgOf({}).map, { x: px - 2, z: pz }, { x: px + 2, z: pz })).toBe(true);
  });
});

describe("D-22: geradores pelo tamanho da equipe (generator.by_team_size)", () => {
  const c = cfgOf({ fifth_generator: true });
  it("equipe de 4–5 → 5 obrigatórios em todos os layouts; até 3, os 4 do layout", () => {
    for (let gi = 0; gi < map.layouts!.generators.length; gi++) {
      const ch = { generators: gi, cage: 0, exit: 0 };
      for (const n of [4, 5]) {
        const need = b.generator.by_team_size[String(n)].required;
        expect(need).toBe(5);
        expect(resolveLayout(c.map, ch, need).generators).toHaveLength(need);
      }
      expect(resolveLayout(c.map, ch, b.generator.by_team_size["3"].required).generators).toEqual(map.layouts!.generators[gi].generators);
      // sem a flag não há lista para equipe grande: ficam os 4
      expect(resolveLayout(cfgOf({}).map, ch, 5).generators).toEqual(map.layouts!.generators[gi].generators);
    }
    expect(maxTeamSize(b)).toBe(5);
  });
  it("layout 0 do v1 com 5: os 4 do protótipo mais um (o layout 0 não muda)", () => {
    const five = resolveLayout(c.map, { generators: 0, cage: 0, exit: 0 }, 5).generators;
    expect(five.slice(0, 4)).toEqual(map.generators);
  });
  it("createGame usa by_team_size do tamanho da equipe: 3 sobreviventes → 4 + 3 bônus (igual a antes da flag)", () => {
    for (let s = 1; s <= 20; s++) {
      const on = createGame(c, "Curandeiro", s), off = createGame(cfgOf({}), "Curandeiro", s);
      expect(on.gens).toEqual(off.gens);
      expect(on.gens.filter(x => !x.bonus)).toHaveLength(b.generator.by_team_size["3"].required);
      expect(on.gens.filter(x => x.bonus)).toHaveLength(b.generator.by_team_size["3"].bonus);
    }
  });
  it("com a tabela pedindo 5 para a equipe da partida, a partida tem 5 obrigatórios e o portão espera os 5", () => {
    const bt = { ...b.generator.by_team_size, 3: { required: 5, bonus: 3 } };
    const big = withMapFlags({ ...b, generator: { ...b.generator, by_team_size: bt } }, ALL);
    const cc = makeConfig(big, map, { ruleset: "v1", hunterBrain: "basic", botBrain: "prototype" });
    const s = 9, g = createGame(cc, "Curandeiro", s);
    const req = g.gens.filter(x => !x.bonus);
    expect(req.map(x => [x.x, x.z])).toEqual(map.v1!.large_team_generators![chooseLayout(map, s).generators]);
    g.hunter.stun = 1e9;
    for (const x of req.slice(0, 4)) x.done = true;
    step(cc, g, NO_INPUT);
    expect(g.gateStarted).toBe(false);
    req[4].done = true;
    step(cc, g, NO_INPUT);
    expect(g.gateStarted).toBe(true);
  });
});

describe("D-25: segunda saída na parede lateral", () => {
  const c = cfgOf({ side_exit: true });
  const se = extra.side_exit!;
  it("troca a saída 1 (a do sul); a saída 0 (norte, paridade) fica", () => {
    expect(c.map.layouts!.exits[0]).toEqual(map.layouts!.exits[0]);
    expect(c.map.layouts!.exits[se.replaces]).toEqual({ gate: se.gate, exit_x: se.exit_x });
    expect(c.map.layouts!.exits).toHaveLength(b.maps.exits);
  });
  it("portão na parede lateral (perto de x = ±lado/2) e longe dos spawns (mais que a saída do sul que ela troca)", () => {
    const half = map.size[0] / 2;
    expect(half - Math.abs(se.gate[0])).toBeLessThanOrEqual(b.nav.agent_radius * 4);
    const near = (gate: readonly number[]) => Math.min(...map.survivor_spawns!.map(p => Math.hypot(p[0] - gate[0], p[1] - gate[1])));
    expect(near(se.gate)).toBeGreaterThan(near(map.layouts!.exits[se.replaces].gate) * 2);
  });
  it("crossedExit com exit_x: lado de fora é o do portão, dentro da meia-largura em z", () => {
    const hw = b.prototype_extras.gate_exit_half_width;
    const west = { gate: se.gate, exit_x: se.exit_x }, east = { gate: [29, 4] as [number, number], exit_x: 28 };
    expect(crossedExit(west, se.exit_x - 0.1, se.gate[1], hw)).toBe(true);
    expect(crossedExit(west, se.exit_x + 0.1, se.gate[1], hw)).toBe(false);
    expect(crossedExit(west, se.exit_x - 0.1, se.gate[1] + hw + 0.1, hw)).toBe(false);
    expect(crossedExit(east, 28.1, 4, hw)).toBe(true);
    expect(crossedExit(east, 27.9, 4, hw)).toBe(false);
  });
  it("na partida: arena com exitX, sem exitZ; o bot vai até o portão lateral e escapa", () => {
    let s = 1;
    while (chooseLayout(map, s).exit !== se.replaces) s++;
    const g: GameState = createGame(c, "Curandeiro", s);
    expect(g.arena.exitX).toBe(se.exit_x);
    expect(g.arena.exitZ).toBeUndefined();
    g.hunter.stun = 1e9; g.hunter.x = 25; g.hunter.z = 25; g.reveal = 1e9;
    for (const x of g.gens) if (!x.bonus) x.done = true;
    g.gateStarted = true; g.gateOpen = true;
    const bot = g.survivors[1];
    bot.x = se.gate[0] + 6; bot.z = se.gate[1];
    for (let i = 0; i < 60 * 10 && bot.st === "ok"; i++) step(c, g, NO_INPUT);
    expect(bot.st).toBe("out");
  });
});

describe("gateFacing: vetor do portão para fora, nas duas saídas", () => {
  it("unidade: lateral oeste/leste e norte/sul", () => {
    expect(gateFacing({ gate: [-29, -10], exit_x: -28 })).toEqual({ x: -1, z: 0 });
    expect(gateFacing({ gate: [29, 4], exit_x: 28 })).toEqual({ x: 1, z: 0 });
    expect(gateFacing({ gate: [0, -29], exit_z: -28 })).toEqual({ x: 0, z: -1 });
    expect(gateFacing({ gate: [-20, 29], exit_z: 28 })).toEqual({ x: 0, z: 1 });
  });
  it("na partida: as duas saídas do v1 (com e sem D-25) e o protótipo; um passo na direção sai pela linha", () => {
    const hw = b.prototype_extras.gate_exit_half_width;
    for (const c of [cfgOf({ side_exit: true }), cfgOf({}), cfgOf({}, "prototype")])
      for (const exit of c.v1 ? [0, 1] : [0]) {
        let s = 1;
        while (c.v1 && chooseLayout(map, s).exit !== exit) s++;
        const g = createGame(c, "Curandeiro", s), f = g.arena.gateFacing;
        expect(Math.hypot(f.x, f.z)).toBe(1);
        const ex = { gate: [g.arena.gate.x, g.arena.gate.z] as [number, number], exit_x: g.arena.exitX, exit_z: g.arena.exitZ };
        expect(crossedExit(ex, g.arena.gate.x + f.x, g.arena.gate.z + f.z, hw)).toBe(true);
        expect(crossedExit(ex, g.arena.gate.x - 2 * f.x, g.arena.gate.z - 2 * f.z, hw)).toBe(false);
      }
  });
});

describe("validador: bloco da D-22 (obrigatórios da maior equipe)", () => {
  const flags = { ...NO_MAP_FLAGS, fifth_generator: true };
  const d22 = (r: ReturnType<typeof validateMap>) => r.filter(x => x.rule.includes("equipe de"));
  it("mapa do v1 com o 5º gerador: todas as regras verdes, uma por layout", () => {
    const r = validateMap(mapForV1(map, flags), b, gridBackend(b), flags);
    expect(r.filter(x => x.status === "falha")).toEqual([]);
    expect(d22(r)).toHaveLength(map.layouts!.generators.length * 3 + 1);
    expect(d22(r).every(x => x.status === "ok")).toBe(true);
  });
  it("falha forçada: dois geradores da lista de 5 a menos de 25 m", () => {
    const bad = JSON.parse(JSON.stringify(map)) as typeof map;
    const l0 = bad.v1!.large_team_generators![0];
    l0[4] = [l0[0][0] + 3, l0[0][1]]; // a 3 m do primeiro
    const r = validateMap(mapForV1(bad, flags), b, gridBackend(b), flags);
    const rule = r.find(x => x.rule === `geradores g0 (equipe de ${maxTeamSize(b)}): distância ≥ generator_min_dist`);
    expect(rule?.status).toBe("falha");
  });
  it("falha forçada: lista com menos obrigatórios que by_team_size pede", () => {
    const bad = JSON.parse(JSON.stringify(map)) as typeof map;
    bad.v1!.large_team_generators![1] = bad.v1!.large_team_generators![1].slice(0, 4);
    const r = validateMap(mapForV1(bad, flags), b, gridBackend(b), flags);
    expect(r.find(x => x.rule === `geradores g1 (equipe de ${maxTeamSize(b)}): ${b.generator.by_team_size[String(maxTeamSize(b))].required} obrigatórios`)?.status).toBe("falha");
  });
});

describe("schema do mapa (R7-mapas)", () => {
  it("saída precisa de exatamente um entre exit_z e exit_x; a saída lateral não troca a saída 0", () => {
    const raw = () => JSON.parse(JSON.stringify(map));
    expect(MapSchema.safeParse(raw()).success).toBe(true);
    const both = raw(); both.layouts.exits[1].exit_x = -28;
    expect(MapSchema.safeParse(both).success).toBe(false);
    const none = raw(); delete none.layouts.exits[1].exit_z;
    expect(MapSchema.safeParse(none).success).toBe(false);
    const zero = raw(); zero.v1.side_exit.replaces = 0;
    expect(MapSchema.safeParse(zero).success).toBe(false);
    const short = raw(); short.v1.large_team_generators.pop();
    expect(MapSchema.safeParse(short).success).toBe(false);
  });
});

describe("determinismo com as flags ligadas", () => {
  function playHash(seed: number) {
    const c = cfgOf(ALL), g = createGame(c, "Mecânico", seed);
    for (let i = 0; i < 60 * 30 && !g.over; i++) step(c, g, { ...NO_INPUT, forward: i % 240 < 180 ? 1 : 0, yaw: (i / 600) * Math.PI });
    return createHash("sha256").update(JSON.stringify(g)).digest("hex");
  }
  it("mesma semente → mesmo hash; semente diferente → outro", () => {
    const ref = playHash(42);
    for (let i = 0; i < 10; i++) expect(playHash(42)).toBe(ref);
    expect(playHash(43)).not.toBe(ref);
  });
});
