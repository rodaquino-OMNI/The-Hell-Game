// R6 — pontuação completa e dificuldades (F1-08, F1-09; GDD-v0.2 §7.1–§7.3, GDD-v0.3 D-04).
// Um teste por evento de pontuação, lendo valores de data/balance.yaml; eventos [Proposta] ligados só nos cenários.
import { describe, expect, it } from "vitest";
import type { Balance } from "@thehell/shared";
import {
  ability, attack, chasedTarget, createGame, drainEvents, hit, makeConfig, newHunterAi, openPuzzle, scaledPoints, scoreTotal,
  step, NO_INPUT, SCORE_CATEGORIES, type ClassName, type Difficulty, type GameEvent, type GameState, type HunterPointEvent,
  type SimConfig, type SurvivorPointEvent,
} from "../src/index.ts";
import { balance as b, map, run, SPOT, tap } from "./helpers.ts";

type PointsEv = Extract<GameEvent, { type: "points" }>;
type EndEv = Extract<GameEvent, { type: "end" }>;
const DIFFS: Difficulty[] = ["easy", "normal", "hard", "nightmare"];
const P = (g: GameState) => g.survivors[0];
const pointsOf = (g: GameState) => drainEvents(g).filter((e): e is PointsEv => e.type === "points");
const endOf = (g: GameState) => drainEvents(g).find((e): e is EndEv => e.type === "end");
const ev = (k: SurvivorPointEvent) => b.points.events[k];
const hev = (k: HunterPointEvent) => b.points.hunter_events[k];

/** balanço com todos os eventos ligados (e ajustes opcionais) */
function balanceWith(edit: (x: Balance) => void = () => {}): Balance {
  const x = structuredClone(b);
  for (const e of Object.values(x.points.events)) e.enabled = true;
  for (const e of Object.values(x.points.hunter_events)) e.enabled = true;
  edit(x);
  return x;
}
const v1All = (difficulty: Difficulty = "normal", edit?: (x: Balance) => void) => makeConfig(balanceWith(edit), map, { ruleset: "v1", difficulty });
const all = v1All();
const v1 = makeConfig(b, map, { ruleset: "v1" });

/** v1 sem caçador ativo (atordoado e longe), bots fora, revelação desligada */
function quiet(c: SimConfig = all, cls: ClassName = "Curandeiro") {
  const g = createGame(c, cls, 1);
  g.hunter.stun = 1e9; g.hunter.x = 25; g.hunter.z = 25;
  for (const s of g.survivors) if (s.bot) s.st = "dead";
  g.reveal = 1e9;
  P(g).x = SPOT.x; P(g).z = SPOT.z; P(g).a = 0;
  drainEvents(g);
  return g;
}
function solve(c: SimConfig, g: GameState) { g.puzzle!.kind = "timing"; g.puzzle!.t = g.puzzle!.zoneCenter; tap(g, { puzzleSpace: true }, c); }

describe("dados de pontos (GDD-v0.2 §7.1)", () => {
  it("[Implementado] ligados, [Proposta] desligados por padrão; valores do §7.1", () => {
    const on = Object.entries(b.points.events).filter(([, e]) => e.enabled).map(([k]) => k);
    expect(on.sort()).toEqual(["bonus_generator", "bonus_puzzle", "generator", "puzzle"]);
    expect(Object.values(b.points.hunter_events).every(e => !e.enabled)).toBe(true);
    const vals = Object.fromEntries(Object.entries(b.points.events).map(([k, e]) => [k, e.value]));
    expect(vals).toEqual({
      puzzle: 10, generator: 40, bonus_puzzle: 25, bonus_generator: 75, rescue: 60, heal: 30, block_bolt: 25, stun: 40,
      chase_escape: 30, trap_disarm: 15, escape: 100,
    });
    expect(b.points.events.heal.min_effective).toBe(20);
    expect(b.points.events.chase_escape.min_time).toBe(15);
    expect(Object.fromEntries(Object.entries(b.points.hunter_events).map(([k, e]) => [k, e.value])))
      .toEqual({ capture: 50, hit: 15, kill: 100, long_chase: 30, reveal: 20, deny_rescue: 40 });
    expect(b.economy.win_coins_to).toBe("alive");
  });
});

describe("eventos do sobrevivente (v1)", () => {
  it("quebra-cabeça e gerador: Objetivos do jogador, evento `points` e g.points", () => {
    const g = quiet(); openPuzzle(all, g, 0);
    for (let k = 0; k < b.generator.puzzles_per_generator; k++) solve(all, g);
    const ps = pointsOf(g);
    expect(ps.filter(e => e.event === "puzzle")).toHaveLength(b.generator.puzzles_per_generator);
    expect(ps.find(e => e.event === "generator")).toMatchObject({ who: 0, value: ev("generator").value, category: "objectives" });
    const total = b.generator.puzzles_per_generator * ev("puzzle").value + ev("generator").value;
    expect(P(g).score.objectives).toBe(total);
    expect(g.points).toBe(total);
  });
  it("gerador bônus: +25 por quebra-cabeça e +75 ao concluir", () => {
    const g = quiet(); const i = g.gens.findIndex(x => x.bonus); openPuzzle(all, g, i);
    for (let k = 0; k < b.generator.puzzles_per_generator; k++) solve(all, g);
    expect(P(g).score.objectives).toBe(b.generator.puzzles_per_generator * ev("bonus_puzzle").value + ev("bonus_generator").value);
  });
  it("bot pontua o próprio conserto, sem somar em g.points (placar por sobrevivente)", () => {
    const g = quiet(); const bot = g.survivors[1];
    bot.st = "ok"; const gen = g.gens.find(x => !x.bonus)!; bot.x = gen.x; bot.z = gen.z;
    run(g, b.survivor.bot.puzzle_time + 0.5, {}, all);
    expect(bot.score.objectives).toBeGreaterThanOrEqual(ev("puzzle").value);
    expect(pointsOf(g).some(e => e.who === bot.id && e.event === "puzzle")).toBe(true);
    expect(g.points).toBe(0);
  });
  it("resgate: +60 de Altruísmo para quem resgatou", () => {
    const g = quiet(); const c = g.survivors[1];
    c.st = "cage"; c.cage = 1e9; c.x = P(g).x; c.z = P(g).z;
    run(g, b.cage.rescue_time + 0.1, { interactHeld: true }, all);
    expect(c.st).toBe("ok");
    expect(P(g).score.altruism).toBe(ev("rescue").value);
    expect(pointsOf(g)).toContainEqual({ type: "points", who: 0, event: "rescue", value: ev("rescue").value, category: "altruism" });
  });
  it("bot que resgata também pontua", () => {
    const g = quiet(); const r = g.survivors[1], c = g.survivors[2];
    r.st = "ok"; c.st = "cage"; c.cage = 1e9; r.x = c.x = g.arena.cage.x; r.z = c.z = g.arena.cage.z;
    run(g, b.cage.rescue_time + 0.2, {}, all);
    expect(r.score.altruism).toBe(ev("rescue").value);
  });
  it("cura: +30 por aliado com cura efetiva ≥ 20; não pontua a si mesmo nem cura menor", () => {
    const g = quiet(); const [a, c] = [g.survivors[1], g.survivors[2]];
    a.st = "ok"; a.hp = b.survivor.hp - b.points.events.heal.min_effective; a.x = P(g).x; a.z = P(g).z;   // efetiva = 20
    c.st = "ok"; c.hp = b.survivor.hp - b.points.events.heal.min_effective + 1; c.x = P(g).x; c.z = P(g).z; // efetiva = 19
    P(g).hp = 1;
    ability(all, g, P(g));
    expect(P(g).score.altruism).toBe(ev("heal").value);
    expect(pointsOf(g).filter(e => e.event === "heal")).toHaveLength(1);
  });
  it("bloqueio útil: bloqueio que anula um golpe dá +25 de Audácia", () => {
    const g = quiet(all, "Atacador");
    ability(all, g, P(g));
    hit(all, g, P(g), b.hunter.melee.damage, "melee");
    expect(P(g).hp).toBe(b.survivor.hp);
    expect(P(g).score.boldness).toBe(ev("block_bolt").value);
  });
  it("parafuso útil: parafuso que acerta o caçador dá +25 de Audácia", () => {
    const g = quiet(all, "Mecânico"); g.hunter.x = P(g).x; g.hunter.z = P(g).z - 3;
    attack(all, g, P(g));
    expect(g.hunter.slow).toBeGreaterThan(0);
    expect(P(g).score.boldness).toBe(ev("block_bolt").value);
    const miss = quiet(all, "Mecânico"); attack(all, miss, P(miss)); // caçador longe: não acerta, não pontua
    expect(P(miss).score.boldness).toBe(0);
  });
  it("atordoar: golpe do Atacador que acerta dá +40 de Audácia", () => {
    const g = quiet(all, "Atacador"); g.hunter.stun = 0; g.hunter.x = P(g).x; g.hunter.z = P(g).z - 1;
    attack(all, g, P(g));
    expect(g.hunter.stun).toBe(b.classes.fighter.strike.stun);
    expect(P(g).score.boldness).toBe(ev("stun").value);
  });
  it("fugir de perseguição > 15 s: +30 de Audácia ao fim da perseguição; ≤ 15 s não pontua", () => {
    const min = b.points.events.chase_escape.min_time;
    const g = quiet(); g.scoreTrack.chase = { target: 0, since: g.t - min - 1 };
    tap(g, {}, all); // caçador sem alvo: a perseguição acaba
    expect(g.scoreTrack.chase).toBeNull();
    expect(P(g).score.boldness).toBe(ev("chase_escape").value);
    const s = quiet(); s.scoreTrack.chase = { target: 0, since: s.t - min + 1 };
    tap(s, {}, all);
    expect(P(s).score.boldness).toBe(0);
  });
  it("perseguição real com o cérebro basic: começa ao ser visto e acaba ao sumir da memória", () => {
    const g = quiet(); const H = g.hunter;
    H.stun = 0; H.x = P(g).x; H.z = P(g).z - 6; H.a = Math.PI; H.dash = 1e9; H.projectile = 1e9; H.trap = 1e9;
    tap(g, {}, all);
    expect(g.scoreTrack.chase).toMatchObject({ target: 0 });
    // some da vista e da memória (teletransporte para longe): fim da perseguição curta, sem pontos
    H.x = 25; H.z = 25; H.stun = 1e9; H.target = -1; H.alertTime = 0;
    tap(g, {}, all);
    expect(g.scoreTrack.chase).toBeNull();
    expect(P(g).score.boldness).toBe(0);
  });
  it("desativar armadilha: +15 de Audácia para o Mecânico", () => {
    const g = quiet(all, "Mecânico"); g.traps.push({ id: 99, x: P(g).x, z: P(g).z });
    tap(g, { interact: true }, all);
    expect(g.traps).toHaveLength(0);
    expect(P(g).score.boldness).toBe(ev("trap_disarm").value);
  });
  it("escapar: +100 de Sobrevivência; o resumo do fim traz as 4 categorias", () => {
    const g = quiet(); g.gateOpen = g.gateStarted = true;
    P(g).x = g.arena.gate.x; P(g).z = g.arena.exitZ + (g.arena.gate.z < g.arena.exitZ ? -1 : 1);
    tap(g, {}, all);
    expect(P(g).st).toBe("out");
    expect(P(g).score.survival).toBe(ev("escape").value);
    const e = g.events.find((x): x is EndEv => x.type === "end")!;
    expect(Object.keys(e.score!).sort()).toEqual([...SCORE_CATEGORIES].sort());
    expect(e.score!.survival).toBe(ev("escape").value);
  });
});

describe("eventos do caçador (v1)", () => {
  it("captura +50, golpe +15, perseguição longa +30 (captura ao fim de perseguição > 15 s), abate +100", () => {
    const g = quiet(); g.scoreTrack.chase = { target: 0, since: g.t - b.points.hunter_events.long_chase.min_time - 1 };
    hit(all, g, P(g), b.survivor.hp, "melee");
    expect(P(g).st).toBe("cage");
    expect(g.scoreTrack.chase).toBeNull(); // capturado: não conta como fuga
    expect(g.hunterPoints).toBe(hev("capture").value + hev("hit").value + hev("long_chase").value);
    const ps = pointsOf(g);
    expect(ps.every(e => e.who === -1 && e.category === "hunter")).toBe(true);
    P(g).st = "ok"; P(g).immune = 0; P(g).antiTunnel = 0; P(g).hp = 1;
    hit(all, g, P(g), b.survivor.hp, "projectile"); // segunda captura = morte; projétil não conta como golpe
    expect(P(g).st).toBe("dead");
    expect(pointsOf(g).map(e => e.event).sort()).toEqual(["capture", "kill"]);
  });
  it("abate pelo tempo de gaiola", () => {
    const g = quiet(); const c = g.survivors[1]; c.st = "cage"; c.cage = 0.01;
    tap(g, {}, all);
    expect(c.st).toBe("dead");
    expect(g.hunterPoints).toBe(hev("kill").value);
  });
  it("revelação eficaz: +20 no primeiro acerto em sobrevivente revelado, uma vez por revelação", () => {
    const g = quiet(); P(g).revealed = b.hunter.reveal.duration;
    hit(all, g, P(g), 1, "projectile");
    hit(all, g, P(g), 1, "projectile");
    expect(g.hunterPoints).toBe(hev("reveal").value);
    P(g).revealed = 0; tap(g, {}, all); // revelação acabou: libera
    expect(g.scoreTrack.revealHit).toEqual([]);
  });
  it("evitar resgate: +40 ao acertar quem resgata um preso", () => {
    const g = quiet(); const c = g.survivors[1];
    c.st = "cage"; c.cage = 1e9; c.x = P(g).x; c.z = P(g).z; P(g).rescue = 1;
    hit(all, g, P(g), 1);
    expect(g.hunterPoints).toBe(hev("deny_rescue").value);
  });
  it("chasedTarget: utility usa os modos chase/attack/recoil e a memória", () => {
    const g = quiet(); const ai = newHunterAi(); g.hunter.ai = ai;
    expect(chasedTarget(g)).toBe(-1);
    ai.mode = "chase"; ai.target = 2; expect(chasedTarget(g)).toBe(2);
    ai.mode = "attack"; expect(chasedTarget(g)).toBe(2);
    ai.mode = "recoil"; ai.target = -1; ai.memory = { id: 1, x: 0, z: 0, until: 9 }; expect(chasedTarget(g)).toBe(1);
    ai.memory = null; expect(chasedTarget(g)).toBe(-1);
    ai.mode = "investigate"; ai.target = 2; expect(chasedTarget(g)).toBe(-1);
  });
  it("chasedTarget: basic segue o alvo e a memória (alertTime) da perseguição em curso", () => {
    const g = quiet(); const H = g.hunter;
    H.target = 0; expect(chasedTarget(g)).toBe(0);
    H.target = -1; H.alertTime = 1; expect(chasedTarget(g)).toBe(-1); // ruído sem perseguição em curso
    g.scoreTrack.chase = { target: 0, since: 0 }; expect(chasedTarget(g)).toBe(0);
    H.alertTime = 0; expect(chasedTarget(g)).toBe(-1);
  });
});

describe("evento desligado não pontua", () => {
  it("com os padrões ([Proposta] desligadas) resgate, bloqueio, escapar e caçador não pontuam", () => {
    const g = quiet(v1, "Atacador"); const c = g.survivors[1];
    c.st = "cage"; c.cage = 1e9; c.x = P(g).x; c.z = P(g).z;
    run(g, b.cage.rescue_time + 0.1, { interactHeld: true }, v1);
    ability(v1, g, P(g)); hit(v1, g, P(g), 10, "melee");
    expect(scoreTotal(P(g).score)).toBe(0);
    expect(g.hunterPoints).toBe(0);
    expect(pointsOf(g)).toEqual([]);
  });
  it("[Implementado] desligado também deixa de pontuar", () => {
    const c = v1All("normal", x => { x.points.events.puzzle.enabled = false; });
    const g = quiet(c); openPuzzle(c, g, 0); solve(c, g);
    expect(g.gens[0].n).toBe(1);
    expect(g.points).toBe(0);
  });
  it("protótipo: só os quebra-cabeças do jogador; nenhum evento `points`, nenhum ponto de caçador", () => {
    const proto = makeConfig(balanceWith(), map, { ruleset: "prototype" });
    const g = createGame(proto, "Atacador", 1);
    g.hunter.stun = 1e9; g.hunter.x = 25; g.hunter.z = 25; g.reveal = 1e9;
    for (const s of g.survivors) if (s.bot) s.st = "dead";
    ability(proto, g, P(g)); hit(proto, g, P(g), 10, "melee"); hit(proto, g, P(g), 200, "melee");
    openPuzzle(proto, g, 0);
    expect(g.hunterPoints).toBe(0);
    expect(scoreTotal(P(g).score)).toBe(0);
    expect(pointsOf(g)).toEqual([]);
  });
});

describe("multiplicador de pontos e arredondamento (GDD-v0.2 §7.3)", () => {
  it.each(DIFFS)("%s: points_mult aplicado e valores inteiros", d => {
    const c = v1All(d), m = b.difficulty_table[d].points_mult;
    expect(c.pointsMult).toBe(m);
    const g = quiet(c); openPuzzle(c, g, 0); solve(c, g);
    expect(g.points).toBe(Math.round(ev("puzzle").value * m));
    const i = g.gens.findIndex(x => x.bonus); openPuzzle(c, g, i); solve(c, g);
    const ps = pointsOf(g);
    expect(ps.map(e => e.value)).toEqual([Math.round(ev("puzzle").value * m), Math.round(ev("bonus_puzzle").value * m)]);
    expect(ps.every(e => Number.isInteger(e.value))).toBe(true);
  });
  it("Difícil: 25 × 1,3 = 32,5 vira 33 com `round` e 32 com `floor`", () => {
    const r = v1All("hard"), f = v1All("hard", x => { x.points.rounding = "floor"; });
    expect(scaledPoints(r, ev("bonus_puzzle").value)).toBe(33);
    expect(scaledPoints(f, ev("bonus_puzzle").value)).toBe(32);
  });
  it("partida inteira com bots e IA utility em Difícil: placar e eventos só com inteiros; total do jogador = g.points", () => {
    const c = makeConfig(balanceWith(), map, { ruleset: "v1", difficulty: "hard", hunterBrain: "utility" });
    const g = createGame(c, "Curandeiro", 5);
    const ps: PointsEv[] = [];
    for (let i = 0; i < (b.match.hard_time_limit + 1) * 60 && !g.over; i++) {
      step(c, g, { ...NO_INPUT, ability: i % 600 === 0 });
      ps.push(...pointsOf(g));
    }
    expect(g.over).toBe(true);
    expect(ps.length).toBeGreaterThan(0);
    expect(ps.every(e => Number.isInteger(e.value))).toBe(true);
    for (const s of g.survivors) for (const k of SCORE_CATEGORIES) expect(Number.isInteger(s.score[k])).toBe(true);
    expect(scoreTotal(P(g).score)).toBe(g.points);
    expect(ps.filter(e => e.who === 0).reduce((n, e) => n + e.value, 0)).toBe(g.points);
    expect(ps.filter(e => e.who === -1).reduce((n, e) => n + e.value, 0)).toBe(g.hunterPoints);
  });
});

describe("moedas por dificuldade (GDD-v0.2 §7.2, GDD-v0.3 D-04)", () => {
  const e = b.economy;
  function withGenerator(c: SimConfig) {
    const g = quiet(c); openPuzzle(c, g, 0);
    for (let k = 0; k < b.generator.puzzles_per_generator; k++) solve(c, g);
    drainEvents(g);
    return g;
  }
  it.each(DIFFS)("%s: vitória e derrota", d => {
    const c = makeConfig(b, map, { ruleset: "v1", difficulty: d }), m = b.difficulty_table[d].points_mult;
    const pts = b.generator.puzzles_per_generator * Math.round(ev("puzzle").value * m) + Math.round(ev("generator").value * m);
    const win = withGenerator(c); win.hunter.hp = 0; tap(win, {}, c);
    expect(win.points).toBe(pts);
    expect(endOf(win)).toMatchObject({ win: true, coins: e.base_coins + e.win_coins + pts * e.points_to_coins });
    const lose = withGenerator(c); P(lose).st = "dead"; tap(lose, {}, c);
    expect(endOf(lose)).toMatchObject({ win: false, team: "hunter", coins: e.base_coins + pts * e.points_to_coins });
  });
  it("Normal com um gerador: 20 + 30 + 90 = 140 moedas na vitória", () => {
    const g = withGenerator(v1); g.hunter.hp = 0; tap(g, {}, v1);
    expect(endOf(g)!.coins).toBe(140);
  });
  it("economy.win_coins_to: `alive` (padrão, decisão do Rodrigo 09/11/2026) dá o bônus a todos os vivos do time vencedor; `escaped` só a quem escapou", () => {
    const esc = makeConfig({ ...b, economy: { ...b.economy, win_coins_to: "escaped" } }, map, { ruleset: "v1" });
    const alive = quiet(v1); alive.hunter.hp = 0; tap(alive, {}, v1);
    expect(endOf(alive)).toMatchObject({ win: true, coins: e.base_coins + e.win_coins });
    const notOut = quiet(esc); notOut.hunter.hp = 0; tap(notOut, {}, esc);
    expect(endOf(notOut)).toMatchObject({ win: true, coins: e.base_coins });
    const out = quiet(esc); out.gateOpen = out.gateStarted = true;
    P(out).x = out.arena.gate.x; P(out).z = out.arena.exitZ + (out.arena.gate.z < out.arena.exitZ ? -1 : 1);
    tap(out, {}, esc);
    expect(endOf(out)).toMatchObject({ individual: "escaped", coins: e.base_coins + e.win_coins });
  });
});
