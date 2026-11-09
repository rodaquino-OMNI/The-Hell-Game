// R3 — integração do R2 em game.ts no ruleset v1 (layout pela semente, saída por crossedExit, spawns da lista do mapa),
// escolha do caçador (`ai.hunter_brain`), schema da seção ai e determinismo/serialização do estado da IA.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BalanceSchema } from "@thehell/shared";
import { createGame, hit, makeConfig, spawnPoints, step, NO_INPUT, type GameState, type PlayerInput } from "../src/index.ts";
import { chooseLayout, resolveLayout } from "../src/nav/index.ts";
import { aiCfg, b, map, normal } from "./ai-helpers.ts";
import { withMapFlags } from "./helpers.ts";

// Integração do layout, da saída e dos spawns (regras do game.ts, não da IA): caçador `basic` e bots do protótipo
// fixados explicitamente desde o marco MJ-B (o padrão dos dados virou utility + competent); `proto` = ruleset do
// protótipo explícito.
const v1 = makeConfig(b, map, { ruleset: "v1", hunterBrain: "basic", botBrain: "prototype" });
const proto = makeConfig(b, map, { ruleset: "prototype" });
// D-25 desligada: a saída 1 volta a ser a do sul (z > exit_z), como antes do R7-mapas
// D-25 ligada explicitamente (os dados a deixam desligada até o cliente desenhar o portão lateral, revisão B-1)
const v1Side = makeConfig(b, map, { ruleset: "v1", hunterBrain: "basic", botBrain: "prototype", mapFlags: { side_exit: true } });
const v1South = makeConfig(withMapFlags(b, { side_exit: false }), map, { ruleset: "v1", hunterBrain: "basic", botBrain: "prototype" });
const seedFor = (pred: (c: ReturnType<typeof chooseLayout>) => boolean) => {
  for (let s = 1; s < 500; s++) if (pred(chooseLayout(map, s))) return s;
  throw new Error("sem semente");
};

describe("layout pela semente (GDD-v0.3 §9.3) no v1", () => {
  it("geradores, gaiola e saída da combinação escolhida; o protótipo usa sempre o topo do mapa", () => {
    const seen = new Set<string>();
    for (let s = 1; s <= 40; s++) {
      const choice = chooseLayout(map, s), m = resolveLayout(v1.map, choice);
      const g = createGame(v1, "Curandeiro", s);
      expect(g.arena.layout).toEqual(choice);
      expect(g.gens.filter(x => !x.bonus).map(x => [x.x, x.z])).toEqual(m.generators);
      expect(g.gens.filter(x => x.bonus).map(x => [x.x, x.z])).toEqual(m.bonus);
      expect(g.arena).toMatchObject({ cage: { x: m.cage[0], z: m.cage[1] }, gate: { x: m.gate[0], z: m.gate[1] } });
      expect([g.arena.exitZ, g.arena.exitX]).toEqual([m.exit_z, m.exit_x]);
      seen.add(JSON.stringify(choice));
      const p = createGame(proto, "Curandeiro", s);
      expect(p.arena).toEqual({ layout: { generators: 0, cage: 0, exit: 0 }, cage: { x: map.cage[0], z: map.cage[1] }, gate: { x: map.gate[0], z: map.gate[1] }, exitZ: map.exit_z, gateFacing: { x: 0, z: -1 } });
      expect(p.gens.filter(x => !x.bonus).map(x => [x.x, x.z])).toEqual(map.generators);
    }
    expect(seen.size).toBeGreaterThan(8);
  });
  it("captura leva para a gaiola do layout e o resgate solta ao lado dela", () => {
    const s = seedFor(c => c.cage === 1);
    const g = createGame(v1, "Curandeiro", s);
    const bot = g.survivors[1];
    hit(v1, g, bot, 200);
    expect(bot.st).toBe("cage");
    expect(bot.z).toBe(map.layouts!.cages[1][1]);
    expect(bot.x).toBeCloseTo(map.layouts!.cages[1][0] + (bot.id - 1) * b.prototype_extras.cage_slot_spacing, 10);
    const P = g.survivors[0]; P.x = bot.x + 1; P.z = bot.z; g.hunter.stun = 1e9; g.hunter.x = 25; g.hunter.z = 25;
    for (let i = 0; i < (b.cage.rescue_time + 0.1) * 60 && bot.st !== "ok"; i++) step(v1, g, { ...NO_INPUT, interactHeld: true });
    expect(bot.st).toBe("ok");
    // solto em z = gaiola + rescued_offset; no mesmo passo o bot já anda (até walk/60 m)
    expect(Math.abs(bot.z - (map.layouts!.cages[1][1] + b.prototype_extras.rescued_offset))).toBeLessThanOrEqual(b.survivor.bot.walk / 60 + 1e-9);
  });
});

describe("saída por crossedExit (norte, sul e lateral)", () => {
  function open(s: number, c = v1) {
    const g = createGame(c, "Curandeiro", s);
    g.hunter.stun = 1e9; g.hunter.x = 25; g.hunter.z = 25; g.reveal = 1e9;
    for (const x of g.gens) if (!x.bonus) x.done = true;
    g.gateStarted = true; g.gateOpen = true;
    return g;
  }
  it("saída sul (exit 1): escapa cruzando z > exit_z perto do portão; z < exit_z do norte não vale", () => {
    const ex = map.layouts!.exits[1], s = seedFor(c => c.exit === 1);
    const g = open(s, v1South), P = g.survivors[0];
    P.x = map.gate[0]; P.z = map.exit_z! - 0.5; // linha do norte (saída 0)
    step(v1South, g, NO_INPUT);
    expect(P.st).toBe("ok");
    P.x = ex.gate[0]; P.z = ex.exit_z! + 0.5;
    step(v1South, g, NO_INPUT);
    expect(P.st).toBe("out");
  });
  it("D-25: saída lateral (exit 1 com maps.v1.side_exit): cruzar a linha x = exit_x perto do portão conta como escapar", () => {
    const se = map.v1!.side_exit!, s = seedFor(c => c.exit === se.replaces);
    const g = open(s, v1Side), P = g.survivors[0], hw = b.prototype_extras.gate_exit_half_width;
    expect(g.arena).toMatchObject({ gate: { x: se.gate[0], z: se.gate[1] }, exitX: se.exit_x });
    expect(g.arena.exitZ).toBeUndefined();
    const out = Math.sign(se.gate[0] - se.exit_x); // lado de fora da linha (oeste: −1)
    P.x = map.gate[0]; P.z = map.exit_z! - 0.5; // linha do norte não vale
    step(v1Side, g, NO_INPUT);
    expect(P.st).toBe("ok");
    P.x = se.exit_x - out * 0.5; P.z = se.gate[1]; // ainda do lado de dentro
    step(v1Side, g, NO_INPUT);
    expect(P.st).toBe("ok");
    P.x = se.exit_x + out * 0.5; P.z = se.gate[1] + hw + 0.1; // fora da largura do portão
    step(v1Side, g, NO_INPUT);
    expect(P.st).toBe("ok");
    P.z = se.gate[1]; step(v1Side, g, NO_INPUT);
    expect(P.st).toBe("out");
  });
  it("saída norte (exit 0): como no protótipo", () => {
    const g = open(seedFor(c => c.exit === 0)), P = g.survivors[0];
    P.x = map.gate[0] + b.prototype_extras.gate_exit_half_width + 0.1; P.z = map.exit_z! - 0.5;
    step(v1, g, NO_INPUT);
    expect(P.st).toBe("ok"); // fora da largura do portão
    P.x = map.gate[0]; step(v1, g, NO_INPUT);
    expect(P.st).toBe("out");
  });
  it("bots vão para o portão do layout quando ele abre", () => {
    const ex = v1.map.layouts!.exits[1], g = open(seedFor(c => c.exit === 1)), bot = g.survivors[1];
    bot.x = ex.gate[0] + 6; bot.z = ex.gate[1] - 4;
    const d0 = Math.hypot(bot.x - ex.gate[0], bot.z - ex.gate[1]);
    step(v1, g, NO_INPUT);
    expect(Math.hypot(bot.x - ex.gate[0], bot.z - ex.gate[1])).toBeLessThan(d0);
  });
});

describe("spawns (GDD-v0.3 §9.4)", () => {
  it("v1 usa survivor_spawns; com menos pontos que sobreviventes, repete em ciclo; protótipo usa a fórmula", () => {
    expect(spawnPoints(v1, 3)).toEqual(map.survivor_spawns!.slice(0, 3));
    const one = makeConfig(b, { ...map, survivor_spawns: [[5, 26]] }, { ruleset: "v1" });
    expect(spawnPoints(one, 3)).toEqual([[5, 26], [5, 26], [5, 26]]);
    const g = createGame(one, "Atacador", 1);
    expect(g.survivors.map(s => [s.x, s.z])).toEqual([[5, 26], [5, 26], [5, 26]]);
    const noList = makeConfig(b, { ...map, survivor_spawns: undefined }, { ruleset: "v1" });
    expect(spawnPoints(noList, 2)).toEqual([[-3, 26], [0, 26]]);
    expect(spawnPoints(proto, 3)).toEqual([[-3, 26], [0, 26], [3, 26]]);
  });
});

describe("escolha do caçador (ai.hunter_brain)", () => {
  it("padrão do YAML = utility (marco MJ-B); basic explícito = caçador do R1 (suíte rules-v1); protótipo nunca usa a IA", () => {
    expect(b.ai.hunter_brain).toBe("utility");
    const dflt = makeConfig(b, map);
    expect(dflt.brain).toBe("utility");
    expect(createGame(dflt, "Curandeiro", 1).hunter.ai).toMatchObject({ mode: "patrol", target: -1 });
    expect(v1.brain).toBe("basic");
    expect(v1.grid).toBeNull();
    expect(createGame(v1, "Curandeiro", 1).hunter.ai).toBeUndefined();
    expect(normal.brain).toBe("utility");
    expect(normal.nav).toBe(normal.grid);
    expect(createGame(normal, "Curandeiro", 1).hunter.ai).toMatchObject({ mode: "patrol", target: -1 });
    const p = makeConfig(b, map, { ruleset: "prototype", hunterBrain: "utility" });
    expect(p.brain).toBe("basic");
    expect(createGame(p, "Curandeiro", 1).hunter.ai).toBeUndefined();
    const yaml = makeConfig({ ...b, ruleset: "v1", ai: { ...b.ai, hunter_brain: "basic" } }, map);
    expect(yaml.brain).toBe("basic");
  });
  it("aiLevel = ai.by_difficulty da dificuldade", () => {
    expect(aiCfg("nightmare").aiLevel).toEqual(b.ai.by_difficulty.nightmare);
    expect(normal.aiLevel).toEqual({ reaction: 0.4, projectile_lead: "none", loop_knowledge: "partial", memory: 8 });
  });
});

describe("schema da seção ai (packages/shared)", () => {
  it("recusa valores fora das enumerações e chave desconhecida", () => {
    const bad = (ai: object) => BalanceSchema.safeParse({ ...b, ai: { ...b.ai, ...ai } }).success;
    expect(bad({})).toBe(true);
    expect(bad({ hunter_brain: "smart" })).toBe(false);
    expect(bad({ by_difficulty: { ...b.ai.by_difficulty, hard: { ...b.ai.by_difficulty.hard, projectile_lead: "quadratic" } } })).toBe(false);
    expect(bad({ by_difficulty: { ...b.ai.by_difficulty, easy: { ...b.ai.by_difficulty.easy, loop_knowledge: "some" } } })).toBe(false);
    expect(bad({ anti_stuck: { min_progress_ratio: 1.5, window: 0.7 } })).toBe(false);
    expect(bad({ extra: 1 })).toBe(false);
  });
});

describe("determinismo e serialização com a IA (GDD-v0.3 §13.3)", () => {
  function scripted(i: number): PlayerInput {
    return { ...NO_INPUT, forward: i % 240 < 180 ? 1 : 0, strafe: i % 400 < 100 ? 1 : 0, run: i % 600 < 120, yaw: (i / 600) * Math.PI,
      interact: i % 300 === 0, interactHeld: i % 700 < 200, ability: i % 500 === 0, attack: i % 350 === 0, puzzleSpace: i % 45 === 0 };
  }
  const hash = (g: GameState) => createHash("sha256").update(JSON.stringify(g)).digest("hex");
  function playHash(seed: number, frames: number, from = 0, g = createGame(normal, "Mecânico", seed)) {
    for (let i = from; i < frames && !g.over; i++) step(normal, g, scripted(i));
    return { g, h: hash(g) };
  }
  it("mesma semente → mesmo hash em 30 execuções; semente diferente → partida diferente", () => {
    const ref = playHash(42, 40 * 60).h;
    for (let i = 0; i < 30; i++) expect(playHash(42, 40 * 60).h).toBe(ref);
    expect(playHash(43, 40 * 60).h).not.toBe(ref);
  });
  it("o estado (com a IA) sobrevive a JSON: continuar da cópia dá o mesmo resultado", () => {
    const mid = playHash(7, 20 * 60).g;
    const copy = JSON.parse(JSON.stringify(mid)) as GameState;
    const a = playHash(7, 40 * 60, 20 * 60, mid).h;
    const c = playHash(7, 40 * 60, 20 * 60, copy).h;
    expect(c).toBe(a);
  });
});
