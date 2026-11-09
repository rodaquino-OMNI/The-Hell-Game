// R1 — regras v1 (F1-01, F1-02): uma verificação por regra, em cenários construídos com semente fixa.
// Fontes: GDD-v0.3 Δ1, §3.3 revisto, §8.1; GDD-v0.2 §3.4, §3.5, §4.1, §4.3, §6.2, §7.3.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canSee, createGame, drainEvents, hit, hunterMaxHp, individualResult, inCone, lineOfSight, makeConfig, matchEnd,
  openPuzzle, segmentHitsBox, step, NO_INPUT, type GameEvent, type GameState, type PlayerInput, type SimConfig,
  type SurvivorState,
} from "../src/index.ts";
import { balance as b, map, NO_MAP_FLAGS, run, SPOT, tap, withMapFlags } from "./helpers.ts";

// Marco MJ-B: o padrão dos dados passou a ser v1 + caçador `utility` + bots `competent`. Esta suíte testa REGRAS
// (cone, ruído, fim, vida, tabela, telegraph, geradores) num cenário montado à mão: fixa explicitamente o caçador
// `basic` (age a 60 Hz, sem tempo de reação) e os bots do protótipo, para que a regra não dependa da IA. As asserções
// do caçador que fazem sentido com a IA do R3 têm a versão `utility` aqui (seção 5) ou nas suítes ai-*.test.ts e
// telegraph.test.ts; `proto` é o ruleset do protótipo fixado explicitamente.
const RULES = { hunterBrain: "basic", botBrain: "prototype" } as const;
const v1 = makeConfig(b, map, { ruleset: "v1", ...RULES });
const hard = makeConfig(b, map, { ruleset: "v1", difficulty: "hard", ...RULES });
const proto = makeConfig(b, map, { ruleset: "prototype" });
const AI = { ruleset: "v1", hunterBrain: "utility", botBrain: "competent" } as const;
const P = (g: GameState) => g.survivors[0];
const ends = (g: GameState) => drainEvents(g).filter((e): e is Extract<GameEvent, { type: "end" }> => e.type === "end");

/** partida v1 com bots mortos, revelação desligada e o caçador `d` metros à frente do jogador (−z), olhando para ele */
function chase(d: number, c: SimConfig = v1, facing = true) {
  const g = createGame(c, "Curandeiro", 3);
  for (const s of g.survivors) if (s.bot) s.st = "dead";
  g.reveal = 1e9;
  const H = g.hunter;
  H.x = SPOT.x; H.z = SPOT.z - d; H.a = facing ? Math.PI : 0;
  H.dash = 1e9; H.projectile = 1e9; H.trap = 1e9;
  if (H.ai) H.ai.patrol = { x: SPOT.x, z: SPOT.z + 3, gen: -1 }; // IA (utility): patrulha na direção do jogador, olhando para ele
  P(g).x = SPOT.x; P(g).z = SPOT.z; P(g).a = 0;
  return g;
}

/** partida v1 sem caçador ativo (atordoado e longe) e com os bots fora */
function quiet(c: SimConfig = v1, cls: "Curandeiro" | "Mecânico" | "Atacador" = "Curandeiro") {
  const g = createGame(c, cls, 1);
  g.hunter.stun = 1e9; g.hunter.x = 25; g.hunter.z = 25;
  for (const s of g.survivors) if (s.bot) s.st = "dead";
  g.reveal = 1e9;
  return g;
}

function failPuzzle(c: SimConfig, g: GameState) {
  g.puzzle!.kind = "sequence"; g.puzzle!.seq = ["up", "up", "up", "up"]; g.puzzle!.i = 0;
  tap(g, { puzzleArrow: "down" }, c);
}
function solvePuzzle(c: SimConfig, g: GameState) {
  g.puzzle!.kind = "timing"; g.puzzle!.t = g.puzzle!.zoneCenter;
  tap(g, { puzzleSpace: true }, c);
}

describe("dados: valores base batem com difficulty_table.normal (evita divergência silenciosa)", () => {
  it("hunter.*, cage.time e generator.gate_time = linha Normal da tabela", () => {
    const n = b.difficulty_table.normal, h = b.hunter;
    expect(h.hp_base).toBe(n.hunter_hp);
    expect(h.chase_speed).toBe(n.chase);
    expect(h.melee.cooldown).toBe(n.melee_cd);
    expect(h.detect_radius).toBe(n.detect);
    expect(h.reveal.interval).toBe(n.reveal);
    expect(h.projectile.damage).toBe(n.projectile_dmg);
    expect(h.trap.interval).toBe(n.trap_interval);
    expect(b.cage.time).toBe(n.cage);
    expect(b.generator.gate_time).toBe(n.gate);
    expect(n.zone_mult).toBe(1);
    expect(n.points_mult).toBe(1);
  });
});

describe("configuração do ruleset", () => {
  it("o padrão em data/balance.yaml é v1 com caçador utility e bots competentes (marco MJ-B)", () => {
    expect(b.ruleset).toBe("v1");
    expect(b.ai.hunter_brain).toBe("utility");
    expect(b.ai.bot_brain).toBe("competent");
    const dflt = makeConfig(b, map);
    expect([dflt.v1, dflt.brain, dflt.botBrain]).toEqual([true, "utility", "competent"]);
    expect([v1.v1, v1.brain, v1.botBrain]).toEqual([true, "basic", "prototype"]);
    expect([proto.v1, proto.brain, proto.botBrain]).toEqual([false, "basic", "prototype"]);
  });
});

describe("1. cone de visão de 90° com linha de visão (GDD-v0.3 §8.1, C-06)", () => {
  it("cenários fixos: dentro do cone, fora do cone, além do raio, atrás de parede", () => {
    const fov = b.hunter.vision_fov_deg, r = b.difficulty_table.normal.detect;
    const H = { x: -8, z: 16 };
    expect(canSee(map, H, Math.PI, { x: -8, z: 26 }, fov, r)).toBe(true); // à frente (+z), 10 m
    expect(canSee(map, H, Math.PI, { x: -8 + 4, z: 20.5 }, fov, r)).toBe(true); // 41,6° do eixo: dentro de ±45°
    expect(canSee(map, H, Math.PI, { x: -8 + 5, z: 20 }, fov, r)).toBe(false); // 51,3°: fora do cone
    expect(canSee(map, H, 0, { x: -8, z: 26 }, fov, r)).toBe(false); // costas
    expect(canSee(map, H, Math.PI, { x: -8, z: 27.5 }, fov, r)).toBe(false); // 11,5 m: além do raio
    expect(canSee(map, { x: 0, z: -4.6 }, Math.PI, { x: 0, z: 4.6 }, fov, r)).toBe(false); // bloco central no meio
    expect(lineOfSight(map, { x: -8, z: 16 }, { x: -8, z: 26 })).toBe(true);
    expect(inCone(H, 0, H, fov)).toBe(true);
  });
  it("raio contra caixa: paralelo aos eixos, tangente e através", () => {
    const box = [0, 0, 2, 2] as const;
    expect(segmentHitsBox({ x: -3, z: 0 }, { x: 3, z: 0 }, box)).toBe(true);
    expect(segmentHitsBox({ x: -3, z: 1 }, { x: 3, z: 1 }, box)).toBe(false); // na borda: não cruza o interior
    expect(segmentHitsBox({ x: -3, z: 5 }, { x: 3, z: 5 }, box)).toBe(false);
    expect(segmentHitsBox({ x: 0, z: -3 }, { x: 0, z: 3 }, box)).toBe(true);
    expect(segmentHitsBox({ x: -3, z: -3 }, { x: -2, z: -2 }, box)).toBe(false); // termina antes da caixa
    expect(segmentHitsBox({ x: -3, z: -3 }, { x: 3, z: 3 }, box)).toBe(true);
  });
  it("na partida: vê de frente, não vê de costas (o protótipo vê em 360°)", () => {
    const front = chase(8); tap(front, {}, v1);
    expect(front.hunter.target).toBe(0);
    const back = chase(8, v1, false); tap(back, {}, v1);
    expect(back.hunter.target).toBe(-1);
    const p = chase(8, proto, false); tap(p, {}, proto);
    expect(p.hunter.target).toBe(0);
  });
  it("na partida: não vê através do bloco central; revelado é visto mesmo assim", () => {
    const g = chase(8);
    g.hunter.x = 0; g.hunter.z = -4.6; P(g).x = 0; P(g).z = 4.6;
    tap(g, {}, v1);
    expect(g.hunter.target).toBe(-1);
    P(g).revealed = 5; tap(g, {}, v1);
    expect(g.hunter.target).toBe(0);
  });
  it("memória: ao perder o alvo, investiga a última posição vista por ai.by_difficulty.memory", () => {
    // Difícil: memória (12 s) ≠ ai.hearing_investigate_time (8 s), para distinguir um parâmetro do outro
    const mem = b.ai.by_difficulty.hard.memory;
    expect(mem).not.toBe(b.ai.hearing_investigate_time);
    const g = chase(8, hard); tap(g, {}, hard);
    expect(g.hunter.alertTime).toBeCloseTo(mem, 5);
    g.hunter.a = 0; P(g).x = SPOT.x + 3; tap(g, {}, hard); // vira de costas: perde de vista
    expect(g.hunter.target).toBe(-1);
    expect(g.hunter.alert).toEqual({ x: SPOT.x, z: SPOT.z });
    expect(g.hunter.alertTime).toBeCloseTo(mem - 1 / 60, 5);
  });
});

describe("2. ruído da tabela §3.4 e investigação de 8 s", () => {
  it("correr faz ruído de 10 m; andar não faz", () => {
    const g = chase(9.5, v1, false);
    tap(g, { strafe: 1 }, v1);
    expect(g.hunter.alert).toBeNull();
    tap(g, { strafe: 1, run: true }, v1);
    expect(g.hunter.alert).not.toBeNull();
    expect(g.hunter.alertTime).toBeCloseTo(b.ai.hearing_investigate_time, 1);
    const far = chase(10.5, v1, false);
    tap(far, { strafe: 1, run: true }, v1);
    expect(far.hunter.alert).toBeNull();
  });
  it("o caçador vai até o som e desiste depois de ai.hearing_investigate_time", () => {
    const g = chase(9.5, v1, false);
    tap(g, { strafe: 1, run: true }, v1);
    const spot = { ...g.hunter.alert! }, d0 = Math.hypot(g.hunter.x - spot.x, g.hunter.z - spot.z);
    P(g).x = -20; P(g).z = 26; // sai de vista
    run(g, 1, {}, v1);
    expect(Math.hypot(g.hunter.x - spot.x, g.hunter.z - spot.z)).toBeLessThan(d0 - 2);
    g.hunter.alertTime = 0.01; g.hunter.patrol = null; tap(g, {}, v1);
    expect(g.hunter.alertTime).toBeLessThanOrEqual(0);
    // fim da investigação: volta a patrulhar e se move rumo ao ponto de patrulha, não ao som
    const patrol = g.hunter.patrol!;
    expect(patrol).not.toBeNull();
    expect(patrol).not.toEqual(spot);
    const dp0 = Math.hypot(g.hunter.x - patrol.x, g.hunter.z - patrol.z);
    run(g, 0.5, {}, v1);
    expect(g.hunter.patrol).toEqual(patrol);
    expect(Math.hypot(g.hunter.x - patrol.x, g.hunter.z - patrol.z)).toBeCloseTo(dp0 - b.hunter.patrol_speed * 0.5, 1);
  });
  it("falha em quebra-cabeça = ruído de 18 m no gerador, não alerta global (C-08)", () => {
    const g = quiet(); openPuzzle(v1, g, 0); // gerador em (−22, −22); caçador em (25, 25)
    failPuzzle(v1, g);
    expect(g.hunter.alert).toBeNull();
    expect(drainEvents(g)).toContainEqual({ type: "noise", kind: "puzzle_fail", x: -22, z: -22, radius: 18, heard: false });
    g.hunter.x = -22; g.hunter.z = -5; // 17 m
    failPuzzle(v1, g);
    expect(g.hunter.alert).toEqual({ x: -22, z: -22 });
    expect(g.hunter.alertTime).toBe(b.ai.hearing_investigate_time);
  });
  it("cura e resgate fazem ruído de 6 m", () => {
    const g = quiet(); g.hunter.x = P(g).x + 5.9; g.hunter.z = P(g).z;
    tap(g, { ability: true }, v1);
    expect(g.hunter.alert).toEqual({ x: P(g).x, z: P(g).z });
    const r = quiet(); const bot = r.survivors[1]; bot.st = "ok"; hit(v1, r, bot, 200);
    P(r).x = bot.x + 2; P(r).z = bot.z; r.hunter.x = P(r).x + 5.9; r.hunter.z = P(r).z;
    tap(r, { interactHeld: true }, v1);
    expect(r.hunter.alert).toEqual({ x: P(r).x, z: P(r).z });
    const far = quiet(); far.hunter.x = P(far).x + 6.1; far.hunter.z = P(far).z;
    tap(far, { ability: true }, v1);
    expect(far.hunter.alert).toBeNull();
  });
  it("bot resgatando faz ruído de 6 m (o bot do protótipo só resgata com o caçador a > 16 m, então não é ouvido)", () => {
    const g = quiet(); const bot = g.survivors[1], other = g.survivors[2];
    bot.st = "ok"; other.st = "ok"; hit(v1, g, other, 200);
    bot.x = other.x + 1; bot.z = other.z; P(g).x = -20; P(g).z = 26;
    g.hunter.x = bot.x + 17; g.hunter.z = bot.z;
    tap(g, {}, v1);
    expect(bot.rescue).toBeGreaterThan(0);
    expect(g.hunter.alert).toBeNull();
  });
  it("bot resgatando com o caçador a < 6 m: o caçador investiga a posição do bot", () => {
    const px = b.prototype_extras;
    const c = makeConfig({ ...b, prototype_extras: { ...px, bot: { ...px.bot, rescue_min_hunter_dist: 3 } } }, map, { ruleset: "v1", ...RULES });
    const g = quiet(c); const bot = g.survivors[1], other = g.survivors[2]; // caçador atordoado: o bot não foge
    bot.st = "ok"; other.st = "ok"; hit(c, g, other, 200);
    bot.x = other.x + 1; bot.z = other.z; P(g).x = -20; P(g).z = 26;
    g.hunter.x = bot.x + 5; g.hunter.z = bot.z;
    tap(g, {}, c);
    expect(bot.rescue).toBeGreaterThan(0);
    expect(g.hunter.alert).toEqual({ x: bot.x, z: bot.z });
    expect(g.hunter.alertTime).toBe(b.ai.hearing_investigate_time);
  });
});

describe("3. fim de partida do §3.3 revisto (D-01 b, D-02 a)", () => {
  const STATES: SurvivorState[] = ["ok", "cage", "dead", "out"];
  function* combos(n: number): Generator<SurvivorState[]> {
    if (n === 0) { yield []; return; }
    for (const rest of combos(n - 1)) for (const s of STATES) yield [...rest, s];
  }
  it("n = 1 a 5, todas as combinações de escapados, mortos, presos e caçador derrotado", () => {
    const m = b.match;
    let cases = 0;
    for (let n = 1; n <= 5; n++) for (const states of combos(n)) for (const hp of [0, 50]) for (const t of [10, m.hard_time_limit]) {
      cases++;
      const r = matchEnd(v1, states, hp, t);
      const escaped = states.filter(s => s === "out").length;
      const terminal = states.every(s => s === "out" || s === "dead");
      if (hp > 0 && !terminal && t < m.hard_time_limit) { expect(r).toBeNull(); continue; }
      expect(r).not.toBeNull();
      expect(r!.escaped).toBe(escaped);
      expect(r!.reason).toBe(hp <= 0 ? "hunter_down" : terminal ? "all_terminal" : "time_limit");
      expect(r!.team).toBe(hp <= 0 || escaped >= m.team_min_escapes ? "survivors" : "hunter");
    }
    expect(cases).toBe(4 * (4 + 16 + 64 + 256 + 1024));
    expect(individualResult("out")).toBe("escaped");
    expect(individualResult("dead")).toBe("dead");
    expect(individualResult("cage")).toBe("not_escaped");
    expect(individualResult("ok")).toBe("not_escaped");
  });
  it("casos escritos à mão (independentes do oráculo)", () => {
    const L = b.match.hard_time_limit;
    expect(matchEnd(v1, ["out", "dead", "dead"], 50, L)).toEqual({ team: "survivors", reason: "all_terminal", escaped: 1 });
    expect(matchEnd(v1, ["out", "dead", "ok"], 50, L)).toEqual({ team: "survivors", reason: "time_limit", escaped: 1 });
    expect(matchEnd(v1, ["ok", "cage", "dead"], 50, L)).toEqual({ team: "hunter", reason: "time_limit", escaped: 0 });
    expect(matchEnd(v1, ["dead", "dead", "dead", "dead", "dead"], 50, 10)).toEqual({ team: "hunter", reason: "all_terminal", escaped: 0 });
    expect(matchEnd(v1, ["cage"], 0, 10)).toEqual({ team: "survivors", reason: "hunter_down", escaped: 0 });
    expect(matchEnd(v1, ["out", "ok"], 50, 10)).toBeNull();
    expect(matchEnd(v1, ["cage", "cage", "cage", "cage"], 50, L - 1)).toBeNull();
  });
  it("jogador escapa: a partida continua até os outros chegarem a estado terminal", () => {
    const g = quiet(); g.survivors[1].st = "ok";
    P(g).st = "out";
    tap(g, {}, v1);
    expect(g.over).toBe(false);
    g.survivors[1].st = "dead"; tap(g, {}, v1);
    expect(g.over).toBe(true);
    expect(ends(g)[0]).toMatchObject({ team: "survivors", reason: "all_terminal", individual: "escaped", win: true, outcome: "escaped" });
  });
  it("jogador morto vira espectador; time vence se um bot escapar, mas o morto perde", () => {
    const g = quiet(); const bot = g.survivors[1]; bot.st = "ok";
    P(g).captures = 1; hit(v1, g, P(g), 200);
    expect(P(g).st).toBe("dead");
    tap(g, {}, v1);
    expect(g.over).toBe(false);
    bot.st = "out"; tap(g, {}, v1);
    const e = ends(g)[0];
    expect(e).toMatchObject({ team: "survivors", individual: "dead", win: false, outcome: "died" });
    expect(e.coins).toBe(b.economy.base_coins);
  });
  it("todos mortos: vence o caçador", () => {
    const g = quiet(); P(g).st = "dead";
    tap(g, {}, v1);
    expect(ends(g)[0]).toMatchObject({ team: "hunter", reason: "all_terminal", win: false });
  });
  it("caçador a 0 encerra na hora com vitória da equipe", () => {
    const g = quiet(); g.survivors[1].st = "ok"; g.hunter.hp = 0;
    tap(g, {}, v1);
    expect(ends(g)[0]).toMatchObject({ team: "survivors", reason: "hunter_down", outcome: "hunter_down", win: true });
  });
  it("limite duro de match.hard_time_limit: quem não escapou conta como não escapado", () => {
    const g = quiet(); g.points = 30;
    g.t = b.match.hard_time_limit - 0.5;
    run(g, 0.4, {}, v1);
    expect(g.over).toBe(false);
    run(g, 0.2, {}, v1);
    const e = ends(g)[0];
    expect(e).toMatchObject({ team: "hunter", reason: "time_limit", individual: "not_escaped", win: false });
    expect(e.coins).toBe(b.economy.base_coins + 30); // não perde pontos já ganhos
  });
  it("partida inteira com bots termina até o limite duro", () => {
    const g = createGame(v1, "Atacador", 11);
    for (let i = 0; i < (b.match.hard_time_limit + 1) * 60 && !g.over; i++) step(v1, g, NO_INPUT);
    expect(g.over).toBe(true);
    expect(g.t).toBeLessThanOrEqual(b.match.hard_time_limit + 1 / 30);
  });
});

describe("4. vida do caçador = difficulty_table[dif].hunter_hp × hunter_hp_scale[n] (C-03)", () => {
  it("valores da tabela e escala por time", () => {
    expect(createGame(v1, "Curandeiro", 1).hunter.hp).toBe(80);
    expect(createGame(hard, "Curandeiro", 1).hunter.maxHp).toBe(100);
    expect(hunterMaxHp(hard, 5)).toBe(125); // exemplo do GDD-v0.3 C-03
    expect(hunterMaxHp(v1, 1)).toBe(50);
    expect(hunterMaxHp(v1, 2)).toBe(65);
    expect(hunterMaxHp(makeConfig(b, map, { ruleset: "v1", difficulty: "nightmare" }), 4)).toBe(135);
    expect(hunterMaxHp(makeConfig(b, map, { ruleset: "v1", difficulty: "easy" }), 3)).toBe(60);
    expect(() => hunterMaxHp(v1, 6)).toThrow();
    expect(hunterMaxHp(proto, 5)).toBe(b.hunter.hp_base); // protótipo: sem escala
  });
});

describe("5. perseguição de 4,3 m/s e tabela de dificuldade (D-03 b, GDD-v0.2 §7.3)", () => {
  it("persegue a hunter.chase_speed em Normal e à velocidade da tabela em Difícil", () => {
    expect(v1.chaseSpeed).toBe(b.hunter.chase_speed);
    const g = chase(10); const z0 = g.hunter.z; run(g, 0.5, {}, v1);
    expect(g.hunter.z - z0).toBeCloseTo(4.3 * 0.5, 1);
    const h = chase(10, hard); const z1 = h.hunter.z; run(h, 0.5, {}, hard);
    expect(h.hunter.z - z1).toBeCloseTo(b.difficulty_table.hard.chase * 0.5, 1);
  });
  it("utility (padrão do MJ-B): depois do tempo de reação, persegue à mesma velocidade da tabela", () => {
    for (const d of ["normal", "hard"] as const) {
      const c = makeConfig(b, map, { ...AI, difficulty: d });
      const g = chase(10, c);
      run(g, b.ai.by_difficulty[d].reaction + 2 / b.ai.decision_hz, {}, c); // viu, reagiu e decidiu Perseguir
      expect(g.hunter.ai!.mode).toBe("chase");
      const z0 = g.hunter.z; run(g, 0.25, {}, c);
      expect(g.hunter.z - z0).toBeCloseTo(b.difficulty_table[d].chase * 0.25, 1);
    }
  });
  it("Difícil: detecção 13 m, gaiola 60 s, portão 55 s, zona ×0,8, pontos ×1,3", () => {
    const t = b.difficulty_table.hard;
    const far = chase(12.5, hard); tap(far, {}, hard);
    expect(far.hunter.target).toBe(0);
    const n = chase(12.5); tap(n, {}, v1);
    expect(n.hunter.target).toBe(-1);
    // utility (padrão do MJ-B): o mesmo raio da tabela vale para a percepção da IA
    // (patrulha parada, para a distância não mudar enquanto a IA lê e reage)
    const still = (c: SimConfig): SimConfig => ({ ...c, balance: { ...c.balance, hunter: { ...c.balance.hunter, patrol_speed: 0 } } });
    const hu = still(makeConfig(b, map, { ...AI, difficulty: "hard" })), nu = still(makeConfig(b, map, AI));
    const seenU = (c: SimConfig) => { const x = chase(12.5, c); run(x, 1, {}, c); return x.hunter.target; };
    expect(seenU(hu)).toBe(0);
    expect(seenU(nu)).toBe(-1);
    const g = quiet(hard);
    hit(hard, g, P(g), 200);
    expect(P(g).cage).toBe(t.cage);
    const z = quiet(hard); openPuzzle(hard, z, 0);
    expect(z.puzzle!.zoneWidth).toBeCloseTo(b.puzzles.timing.zone * t.zone_mult, 10);
    solvePuzzle(hard, z);
    expect(z.points).toBe(Math.round(b.points.events.puzzle.value * t.points_mult));
    expect(z.points).toBe(13);
    const full = quiet(hard); openPuzzle(hard, full, 0);
    for (let k = 0; k < b.generator.puzzles_per_generator; k++) solvePuzzle(hard, full);
    expect(full.gens[0].done).toBe(true);
    // arredondamento por evento (`points.rounding`, LACUNA GDD-v0.2 §7.1 × §7.3)
    expect(full.points).toBe(b.generator.puzzles_per_generator * Math.round(b.points.events.puzzle.value * t.points_mult) + Math.round(b.points.events.generator.value * t.points_mult));
    expect(full.points).toBe(5 * 13 + 52);
    const bonus = quiet(hard); openPuzzle(hard, bonus, bonus.gens.findIndex(x => x.bonus));
    solvePuzzle(hard, bonus);
    expect(bonus.points).toBe(33); // 25 × 1,3 = 32,5
    for (let k = 1; k < b.generator.puzzles_per_generator; k++) solvePuzzle(hard, bonus);
    expect(bonus.points).toBe(5 * 33 + 98); // 75 × 1,3 = 97,5 → 98; total 263 (pelo total seriam 260)
    const gate = quiet(hard);
    for (const x of gate.gens) if (!x.bonus) x.done = true;
    tap(gate, {}, hard);
    expect(gate.gateTimer).toBeCloseTo(t.gate, 1);
  });
  it("Difícil: recarga do golpe 1,4 s, projétil 10, armadilha a cada 26 s, revelação a cada 22 s", () => {
    const t = b.difficulty_table.hard;
    const g = chase(1, hard); run(g, b.hunter.telegraph_min + 0.05, {}, hard);
    expect(g.hunter.atk).toBeGreaterThan(t.melee_cd - 0.1);
    expect(g.hunter.atk).toBeLessThanOrEqual(t.melee_cd);
    // D-36: projétil e armadilha também saem depois do preparo (GDD-v0.2 §4.1)
    const p = chase(12, hard); p.hunter.projectile = 0; tap(p, {}, hard);
    expect(p.hunter.windup?.kind).toBe("projectile");
    expect(p.projectiles.length).toBe(0);
    run(p, b.hunter.telegraph_min + 0.05, {}, hard);
    expect(p.projectiles.length).toBe(1);
    run(p, 1.5, {}, hard);
    expect(P(p).hp).toBe(100 - t.projectile_dmg);
    const tr = chase(20, hard); tr.hunter.trap = 0; tap(tr, {}, hard);
    expect(tr.hunter.trap).toBeCloseTo(t.trap_interval, 1);
    expect(tr.hunter.windup?.kind).toBe("trap");
    run(tr, b.hunter.telegraph_min + 0.05, {}, hard);
    expect(tr.traps.length).toBe(1);
    const rv = chase(20, hard); rv.reveal = 1 / 60; tap(rv, {}, hard);
    expect(rv.reveal).toBeCloseTo(t.reveal, 1);
  });
});

describe("6. anti-tunnel de 15 s e recuo de 0,6 s (GDD-v0.2 §4.3)", () => {
  it("não captura o mesmo alvo duas vezes em menos de hunter.anti_tunnel", () => {
    const g = quiet(); const bot = g.survivors[1]; bot.st = "ok";
    hit(v1, g, bot, 200);
    expect(bot.st).toBe("cage");
    expect(bot.antiTunnel).toBe(b.hunter.anti_tunnel);
    bot.st = "ok"; bot.hp = 10; bot.immune = 0; // resgatado e sem imunidade
    hit(v1, g, bot, 15);
    expect(bot.st).toBe("ok");
    expect(bot.hp).toBe(10);
    hit(v1, g, bot, 5); // dano que não captura continua valendo
    expect(bot.hp).toBe(5);
    run(g, b.hunter.anti_tunnel, {}, v1);
    hit(v1, g, bot, 15);
    expect(bot.st).toBe("dead"); // 2ª captura = morte
  });
  it("o caçador ignora como alvo quem está sob anti-tunnel", () => {
    const g = chase(5); P(g).antiTunnel = 10; tap(g, {}, v1);
    expect(g.hunter.target).toBe(-1);
  });
  it("após acertar o golpe, fica parado por hunter.melee.recoil", () => {
    const g = chase(1);
    run(g, b.hunter.telegraph_min + 0.05, {}, v1);
    expect(P(g).hp).toBe(100 - b.hunter.melee.damage);
    expect(g.hunter.recoil).toBeGreaterThan(b.hunter.melee.recoil - 0.1);
    const at = { x: g.hunter.x, z: g.hunter.z };
    P(g).z = SPOT.z + 3; // alvo se afasta
    run(g, b.hunter.melee.recoil - 0.15, {}, v1);
    expect({ x: g.hunter.x, z: g.hunter.z }).toEqual(at);
    run(g, 0.2, {}, v1);
    expect(g.hunter.z).toBeGreaterThan(at.z);
  });
});

describe("7. telegraph ≥ hunter.telegraph_min antes de golpe e dash (GDD-v0.2 §4.1)", () => {
  it("golpe: preparo exposto em hunter.windup e dano só no fim do preparo", () => {
    const g = chase(1.5);
    tap(g, {}, v1);
    expect(g.hunter.windup).toMatchObject({ kind: "melee", total: b.hunter.telegraph_min });
    expect(g.hunter.windup!.total).toBeGreaterThanOrEqual(b.hunter.telegraph_min);
    run(g, b.hunter.telegraph_min - 0.05, {}, v1);
    expect(P(g).hp).toBe(100);
    expect(g.hunter.windup!.t).toBeGreaterThan(0);
    run(g, 0.1, {}, v1);
    expect(P(g).hp).toBe(100 - b.hunter.melee.damage);
    expect(g.hunter.windup).toBeNull();
  });
  it("golpe erra se o alvo sair do alcance durante o preparo (contra-jogo), e gasta a recarga", () => {
    const g = chase(1.5); tap(g, {}, v1);
    P(g).z = SPOT.z + 4;
    run(g, b.hunter.telegraph_min + 0.05, {}, v1);
    expect(P(g).hp).toBe(100);
    expect(g.hunter.recoil).toBeLessThanOrEqual(0);
    expect(g.hunter.atk).toBeGreaterThan(0);
  });
  it("dash: preparo antes de disparar", () => {
    const g = chase(8); g.hunter.dash = 0;
    tap(g, {}, v1);
    expect(g.hunter.windup).toMatchObject({ kind: "dash" });
    expect(g.hunter.dashing).toBeLessThanOrEqual(0);
    run(g, b.hunter.telegraph_min - 0.05, {}, v1);
    expect(g.hunter.dashing).toBeLessThanOrEqual(0);
    run(g, 0.1, {}, v1);
    expect(g.hunter.dashing).toBeGreaterThan(0);
    expect(g.hunter.windup).toBeNull();
  });
  it("atordoar cancela o preparo", () => {
    const g = chase(1.5); tap(g, {}, v1);
    g.hunter.stun = 1; tap(g, {}, v1);
    expect(g.hunter.windup).toBeNull();
    const h = chase(1.5); tap(h, {}, v1);
    P(h).st = "dead"; h.survivors[1].st = "cage"; tap(h, {}, v1);
    expect(h.hunter.windup).toBeNull();
  });
});

describe("8. regras de gerador do §6.2", () => {
  function complete(c: SimConfig, g: GameState, i = 0) {
    openPuzzle(c, g, i);
    for (let k = 0; k < b.generator.puzzles_per_generator; k++) solvePuzzle(c, g);
  }
  it("gerador completo revela a posição por generator.completed_reveal e faz ruído de 25 m", () => {
    const g = quiet(); g.hunter.x = -22; g.hunter.z = 2; // 24 m do gerador 0
    complete(v1, g);
    expect(g.gens[0].done).toBe(true);
    expect(g.gens[0].revealed).toBeCloseTo(b.generator.completed_reveal, 1);
    expect(g.hunter.alert).toEqual({ x: -22, z: -22 });
    expect(g.hunter.alertTime).toBe(b.ai.hearing_investigate_time);
    run(g, b.generator.completed_reveal + 0.05, {}, v1);
    expect(g.gens[0].revealed).toBeLessThanOrEqual(0);
    const local = makeConfig({ ...b, generator: { ...b.generator, completed_reveal_global: false } }, map, { ruleset: "v1", ...RULES });
    const far = quiet(local); complete(local, far);
    expect(far.gens[0].revealed).toBeGreaterThan(0);
    expect(far.hunter.alert).toBeNull();
  });
  it("padrão (D-21, completed_reveal_global: true): a revelação alcança o caçador de qualquer distância", () => {
    expect(b.generator.completed_reveal_global).toBe(true);
    const g = quiet(); complete(v1, g);
    expect(g.hunter.alert).toEqual({ x: -22, z: -22 });
    expect(g.hunter.alertTime).toBe(b.generator.completed_reveal);
  });
  it("conclusão por bot e por conserto turbo também revela", () => {
    const g = quiet(v1, "Mecânico"); g.gens[0].n = b.generator.puzzles_per_generator - 1;
    P(g).x = -22; P(g).z = -19.5;
    tap(g, { ability: true }, v1);
    expect(g.gens[0].revealed).toBeGreaterThan(0);
    const bt = quiet(); const mech = bt.survivors.find(s => s.cls === "Mecânico")!; mech.st = "ok";
    bt.gens[0].n = b.generator.puzzles_per_generator - 1; mech.x = -22; mech.z = -20.5; P(bt).x = 10; P(bt).z = 0;
    run(bt, b.classes.mechanic.bot_puzzle_time + 0.1, {}, v1);
    expect(bt.gens[0].done).toBe(true);
    expect(bt.gens[0].revealed).toBeGreaterThan(0);
  });
  it("generator.fails_to_regress falhas seguidas regridem 1 quebra-cabeça e dão faísca", () => {
    const g = quiet(); g.gens[0].n = 2; openPuzzle(v1, g, 0);
    for (let k = 0; k < b.generator.fails_to_regress - 1; k++) failPuzzle(v1, g);
    expect(g.gens[0].n).toBe(2);
    failPuzzle(v1, g);
    expect(g.gens[0].n).toBe(2 - b.generator.regress_amount);
    expect(b.generator.regress_amount).toBe(1); // GDD-v0.2 §6.2
    expect(g.gens[0].spark).toBe(b.generator.fail_spark_time);
    expect(g.gens[0].fails).toBe(0);
  });
  it("acerto zera a contagem; sem progresso não regride abaixo de 0; protótipo não regride", () => {
    const g = quiet(); g.gens[0].n = 2; openPuzzle(v1, g, 0);
    failPuzzle(v1, g); failPuzzle(v1, g); solvePuzzle(v1, g); failPuzzle(v1, g); failPuzzle(v1, g);
    expect(g.gens[0].n).toBe(3);
    const z = quiet(); openPuzzle(v1, z, 0);
    for (let k = 0; k < b.generator.fails_to_regress; k++) failPuzzle(v1, z);
    expect(z.gens[0].n).toBe(0);
    const p = createGame(proto, "Curandeiro", 1); p.gens[0].n = 2; openPuzzle(proto, p, 0);
    for (let k = 0; k < b.generator.fails_to_regress; k++) failPuzzle(proto, p);
    expect(p.gens[0].n).toBe(2);
  });
});

describe("determinismo no ruleset v1", () => {
  function scripted(i: number): PlayerInput {
    return { ...NO_INPUT, forward: i % 240 < 180 ? 1 : 0, strafe: i % 400 < 100 ? 1 : 0, run: i % 600 < 120, yaw: (i / 600) * Math.PI,
      interact: i % 300 === 0, interactHeld: i % 700 < 200, ability: i % 500 === 0, attack: i % 350 === 0, puzzleSpace: i % 45 === 0 };
  }
  // 101 partidas de 60 s (≈ 364 mil passos): ~2 s sozinho, mas passou de 5 s (padrão do vitest) na CI de 2 núcleos
  // com cobertura e os outros arquivos em paralelo (run 42539890494). O teste é pesado de propósito; o limite é de
  // execução do teste, não de regra de jogo.
  const DETERMINISM_TIMEOUT_MS = 30_000;
  function playHash(seed: number, frames: number) {
    const g = createGame(v1, "Mecânico", seed);
    for (let i = 0; i < frames && !g.over; i++) step(v1, g, scripted(i));
    return createHash("sha256").update(JSON.stringify(g)).digest("hex");
  }
  it("mesma semente → mesmo hash em 100 execuções", () => {
    const ref = playHash(42, 60 * 60);
    for (let i = 0; i < 100; i++) expect(playHash(42, 60 * 60)).toBe(ref);
  }, DETERMINISM_TIMEOUT_MS);
  it("semente diferente → partida diferente", () => {
    expect(playHash(42, 60 * 60)).not.toBe(playHash(43, 60 * 60));
  });
  it("hash de referência do v1 com caçador basic e bots do protótipo (calculado em main 89c8f8f; pega desvio)", () => {
    // R4 (revisão qa B-5): `ai.bot_brain: competent` e a D-35 não podem mudar esta partida. Dash, projétil e armadilha
    // desligados porque a D-36 (telegraph em toda habilidade) muda de propósito o disparo deles no basic.
    // R7-mapas: com as flags de mapa desligadas (maps.v1.*) a partida é byte a byte a de antes (pilares, saída lateral
    // e 5º gerador só entram atrás delas).
    const c = makeConfig(withMapFlags(b, NO_MAP_FLAGS), map, { ruleset: "v1", hunterBrain: "basic", botBrain: "prototype" });
    const g = createGame(c, "Mecânico", 42);
    g.hunter.dash = 1e9; g.hunter.projectile = 1e9; g.hunter.trap = 1e9;
    for (let i = 0; i < 60 * 60 && !g.over; i++) step(c, g, scripted(i));
    expect(createHash("sha256").update(JSON.stringify(g)).digest("hex")).toBe("2f9b008d36779918272a309e6112cfa33fef0d144dec99ade6248de97c4925a6");
  });
  it("hash de referência do v1 com as flags de mapa ligadas (R7-mapas: pilares, saída lateral, 5º gerador; pega desvio)", () => {
    const c = makeConfig(withMapFlags(b, { fifth_generator: true, short_loop_pillars: true, side_exit: true }), map, { ruleset: "v1", hunterBrain: "basic", botBrain: "prototype" });
    const g = createGame(c, "Mecânico", 42);
    g.hunter.dash = 1e9; g.hunter.projectile = 1e9; g.hunter.trap = 1e9;
    for (let i = 0; i < 60 * 60 && !g.over; i++) step(c, g, scripted(i));
    expect(createHash("sha256").update(JSON.stringify(g)).digest("hex")).toBe("5a5ed1de0a8f0301af037ad081177beee68c139ccc57007ca9b9fea988476f0c");
  });
});
