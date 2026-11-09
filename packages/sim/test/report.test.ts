// Relatório de playtest (R8, report.ts): coleta passiva em `g.report` e `matchReport(g)`. Confere que a coleta não muda
// a partida (hash do resto do estado idêntico), o determinismo do relatório, os tempos de quebra-cabeça e de gerador
// num cenário controlado, a equivalência das perseguições com `chaseEpisodes` e o script tools/sim/compare-human.ts.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CLASSES, createGame, hit, makeConfig, matchReport, newMatchLog, playHeadless, playHeadlessReport, REPORT_VERSION, step, NO_INPUT,
  type AiTrace, type ClassName, type GameState, type PlayerInput, type SimConfig,
} from "../src/index.ts";
import { balance as b, cfg as proto, map, outsideExit } from "./helpers.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const prod: SimConfig = makeConfig(b, map);
const rules: SimConfig = makeConfig(b, map, { ruleset: "v1", hunterBrain: "basic", botBrain: "prototype" });
const STEP = 1 / 60;
// limite de execução dos testes que jogam partidas inteiras (CI de 2 núcleos com cobertura), não regra de jogo
const LONG_MS = 120_000;

function scriptedInput(i: number): PlayerInput {
  return { ...NO_INPUT, forward: i % 240 < 180 ? 1 : 0, strafe: i % 400 < 100 ? 1 : 0, run: i % 600 < 120, yaw: (i / 600) * Math.PI,
    interact: i % 300 === 0, interactHeld: false, ability: i % 500 === 0, attack: i % 350 === 0, puzzleSpace: i % 45 === 0 };
}

const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
function play(c: SimConfig, seed: number, frames: number, report: boolean, cls: ClassName = "Mecânico") {
  const g = createGame(c, cls, seed, report ? { report: true } : {});
  for (let i = 0; i < frames && !g.over; i++) step(c, g, scriptedInput(i));
  return g;
}
const withoutReport = (g: GameState) => { const rest: Partial<GameState> = { ...g }; delete rest.report; return rest; };

describe("relatório: não muda a partida", () => {
  it("sem `report` o estado não ganha o campo; com ele, o resto do estado é idêntico (v1 de produção e protótipo)", () => {
    for (const c of [prod, proto]) {
      const off = play(c, 42, 60 * 60, false), on = play(c, 42, 60 * 60, true);
      expect("report" in off).toBe(false);
      expect(on.report?.version).toBe(REPORT_VERSION);
      expect(hash(withoutReport(on))).toBe(hash(off));
    }
  }, LONG_MS);
  it("partida inteira de bots: mesmo resultado de playHeadless e os ganchos da config continuam sendo chamados", () => {
    const traces = [true, false].map(report => {
      const seen: AiTrace[] = [], c = makeConfig(b, map, { trace: e => seen.push(e) });
      const g = createGame(c, "Atacador", 3, report ? { report: true } : {});
      g.survivors[0].bot = true;
      for (let i = 0; i < 60 * 40; i++) { step(c, g, NO_INPUT); g.events.length = 0; }
      return seen;
    });
    expect(traces[0].length).toBeGreaterThan(0);
    expect(traces[0]).toEqual(traces[1]);
    const r = playHeadlessReport(prod, CLASSES[3 % CLASSES.length], 3);
    const h = playHeadless(prod, 3);
    expect(r.duration).toBe(h.time);
    expect(r.end?.reason).toBe(h.reason);
    expect(r.team.escaped).toBe(h.escaped);
  }, LONG_MS);
});

describe("relatório: determinismo", () => {
  it("mesma semente e mesmas entradas → mesmo relatório em 100 execuções; semente diferente → outro", () => {
    const ref = hash(matchReport(play(prod, 42, 10 * 60, true)));
    for (let i = 0; i < 100; i++) expect(hash(matchReport(play(prod, 42, 10 * 60, true)))).toBe(ref);
    expect(hash(matchReport(play(prod, 43, 10 * 60, true)))).not.toBe(ref);
  }, LONG_MS);
  it("o JSON é serializável e volta igual", () => {
    const r = matchReport(play(prod, 7, 20 * 60, true));
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(r.version).toBe(REPORT_VERSION);
    expect(r.seed).toBe(7);
  });
});

/** v1 com o caçador básico atordoado e longe, sem revelação, e os bots fora (o acumulador recomeça depois da montagem) */
function controlled(cls: ClassName, keep: number[] = []): GameState {
  const g = createGame(rules, cls, 1, { report: true });
  for (const s of g.survivors) if (s.bot && !keep.includes(s.id)) s.st = "dead";
  g.hunter.stun = 1e9; g.hunter.x = 25; g.hunter.z = 25;
  g.reveal = 1e9;
  g.report = newMatchLog(rules, g, "normal");
  return g;
}
const tap = (g: GameState, input: Partial<PlayerInput> = {}) => step(rules, g, { ...NO_INPUT, ...input });
const wait = (g: GameState, frames: number) => { for (let i = 0; i < frames; i++) tap(g); };
const atGen = (g: GameState, i: number) => { const P = g.survivors[0]; P.x = g.gens[i].x; P.z = g.gens[i].z + 1; };

describe("relatório: cenário controlado", () => {
  it("tempos de quebra-cabeça (acerto, erro, abandono) e do gerador, do primeiro trabalho ao pronto", () => {
    const g = controlled("Curandeiro"), ppg = b.generator.puzzles_per_generator;
    atGen(g, 0);
    tap(g, { interact: true });
    const t1 = g.t;
    expect(g.puzzle?.kind).toBe("timing");
    wait(g, 300);
    g.puzzle!.t = g.puzzle!.zoneCenter;
    tap(g, { puzzleSpace: true });
    const t2 = g.t;
    expect(g.puzzle?.kind).toBe("sequence"); // reaberto no mesmo gerador
    wait(g, 119);
    const wrong = (["left", "up", "right", "down"] as const).find(a => a !== g.puzzle!.seq[0])!;
    tap(g, { puzzleArrow: wrong });
    const t3 = g.t;
    wait(g, 59);
    tap(g, { puzzleExit: true });
    const t4 = g.t;
    // último quebra-cabeça do gerador: abre de novo e acerta
    g.gens[0].n = ppg - 1;
    tap(g, { interact: true });
    const t5 = g.t;
    wait(g, 60);
    g.puzzle!.t = g.puzzle!.zoneCenter;
    tap(g, { puzzleSpace: true });
    const t6 = g.t;
    expect(g.gens[0].done).toBe(true);

    const r = matchReport(g);
    const p = r.human.puzzles;
    expect(p.map(x => [x.kind, x.result])).toEqual([["timing", "ok"], ["sequence", "fail"], ["sequence", "abandoned"], ["timing", "ok"]]);
    expect(p[0].start).toBe(t1); expect(p[0].end).toBe(t2);
    expect(p[0].time).toBeCloseTo(t2 - t1, 9);
    expect(p[0].time).toBeCloseTo(301 * STEP, 9);
    expect(p[1].time).toBeCloseTo(t3 - t2, 9);
    expect(p[1].time).toBeCloseTo(2, 9);
    expect(p[2].time).toBeCloseTo(t4 - t3, 9);
    expect(p[3].start).toBe(t5); expect(p[3].time).toBeCloseTo(t6 - t5, 9);
    // mediana das tentativas terminadas (acerto ou erro): 301/60, 2 e 61/60 s
    expect(r.human.puzzleMedian).toBeCloseTo(2, 9);
    const gen = r.team.generators[0];
    expect(gen.start).toBe(t1);
    expect(gen.end).toBe(t6);
    expect(gen.duration).toBeCloseTo(t6 - t1, 9);
    expect(gen.human).toEqual({ puzzles: 2, turbo: 0, fails: 1, time: expect.closeTo(t4 - t1 + t6 - t5, 9) });
    expect(gen.bots).toEqual({ puzzles: 0, turbo: 0, fails: 0, time: 0 });
    expect(r.team.puzzles.human).toBe(2);
    expect(r.team.generators[1].start).toBeNull();
  });

  it("bot: tentativa = tempo de trabalho (`survivor.bot.puzzle_time`) e o tempo entra no gerador como dos bots", () => {
    const g = controlled("Curandeiro", [2]);
    const bot = g.survivors[2];
    expect(bot.cls).toBe("Atacador");
    const P = g.survivors[0]; P.x = -25; P.z = 26; // longe dos geradores
    const i = g.gens.findIndex(x => !x.bonus);
    bot.x = g.gens[i].x; bot.z = g.gens[i].z + 1;
    wait(g, Math.round(2.5 * b.survivor.bot.puzzle_time * 60));
    const r = matchReport(g);
    const mine = r.human.puzzles, theirs = r.team.botPuzzles;
    expect(mine).toEqual([]);
    const ok = theirs.filter(x => x.result === "ok");
    expect(ok.length).toBe(2);
    for (const x of ok) {
      expect(x.kind).toBe("bot");
      expect(x.time).toBeCloseTo(b.survivor.bot.puzzle_time, 1);
      expect(x.end - x.start).toBeCloseTo(b.survivor.bot.puzzle_time, 1);
    }
    expect(r.team.puzzles.botMedian).toBeCloseTo(b.survivor.bot.puzzle_time, 1);
    const gen = r.team.generators[i];
    expect(gen.bots.puzzles).toBe(2);
    expect(gen.bots.time).toBeGreaterThanOrEqual(2 * b.survivor.bot.puzzle_time);
    expect(gen.start).toBeCloseTo(0, 9);
  });

  it("Turbo do Mecânico humano conta no gerador obrigatório mais próximo", () => {
    const g = controlled("Mecânico");
    const i = g.gens.findIndex(x => !x.bonus);
    atGen(g, i);
    tap(g, { ability: true });
    const r = matchReport(g);
    expect(r.team.generators[i].human.turbo).toBe(1);
    expect(r.team.generators[i].start).toBe(g.t);
  });

  it("golpes, cura, captura, resgate feito por bot, morte; fuga e fim da partida", () => {
    const g = controlled("Curandeiro", [2]);
    const P = g.survivors[0], bot = g.survivors[2];
    bot.x = P.x + 1; bot.z = P.z;
    hit(rules, g, P, 30, "melee");
    tap(g);
    tap(g, { ability: true }); // pulso de cura (o próprio Curandeiro)
    hit(rules, g, P, b.survivor.hp, "melee"); // captura
    tap(g);
    expect(P.st).toBe("cage");
    for (let i = 0; i < 60 * 60 && P.st === "cage"; i++) tap(g);
    expect(P.st).toBe("ok");
    P.immune = 0; P.antiTunnel = 0;
    hit(rules, g, P, b.survivor.hp, "melee"); // 2ª captura: morre (`cage.deaths_at_capture`)
    tap(g);
    expect(P.st).toBe("dead");
    const r = matchReport(g);
    expect(r.human.hits).toBe(3);
    expect(r.human.damage).toBe(30 + (b.survivor.hp - 30 + Math.min(b.classes.healer.pulse_heal, 30)) + b.cage.rescue_hp);
    expect(r.human.heals).toBe(1);
    expect(r.human.healed).toBe(Math.min(b.classes.healer.pulse_heal, 30));
    expect(r.human.captures.length).toBe(2);
    expect(r.human.deaths.length).toBe(1);
    expect(r.human.rescued).toEqual([{ t: expect.any(Number), by: 2 }]);
    expect(r.team.survivors[2].rescues).toBe(1);
    expect(r.team.captures).toBe(2);
    expect(r.team.rescues).toBe(1);
    // o bot sai pelo portão aberto: todos terminais, fim da partida
    g.gateOpen = true; g.gateStarted = true;
    const out = outsideExit(g); bot.x = out.x; bot.z = out.z;
    tap(g);
    const end = matchReport(g);
    expect(end.over).toBe(true);
    expect(end.end).toMatchObject({ reason: "all_terminal", individual: "dead", win: false });
    expect(end.team.escaped).toBe(1);
    expect(end.score.points).toBe(g.points);
  });

  it("o humano resgata um aliado e escapa", () => {
    const g = controlled("Curandeiro", [1]);
    const P = g.survivors[0], ally = g.survivors[1];
    hit(rules, g, ally, b.survivor.hp, "melee");
    tap(g);
    P.x = ally.x; P.z = ally.z + 1;
    for (let i = 0; i < 60 * (b.cage.rescue_time + 1) && ally.st === "cage"; i++) tap(g, { interactHeld: true });
    expect(ally.st).toBe("ok");
    g.gateOpen = true; g.gateStarted = true;
    const out = outsideExit(g); P.x = out.x; P.z = out.z;
    tap(g);
    const r = matchReport(g);
    expect(r.human.rescues).toEqual([{ t: expect.any(Number), ally: 1 }]);
    expect(r.human.escapedAt).toBe(g.t);
    expect(r.human.state).toBe("out");
  });

  it("protótipo, tutorial e partida sem relatório", () => {
    const g = createGame(proto, "Curandeiro", 1, { report: true });
    for (let i = 0; i < 60 * 25; i++) step(proto, g, NO_INPUT);
    const r = matchReport(g);
    expect([r.ruleset, r.mapFlags, r.end]).toEqual(["prototype", null, null]);
    expect(r.team.botPuzzles.some(x => x.result === "ok")).toBe(true);
    const t = createGame(prod, "Curandeiro", 1, { mode: "tutorial", report: true });
    step(prod, t, NO_INPUT);
    expect(matchReport(t).mode).toBe("tutorial");
    expect(() => matchReport(createGame(prod, "Curandeiro", 1))).toThrow(/report: true/);
  });
});

describe("relatório: perseguições", () => {
  it("os episódios `capture` do time têm as durações de chaseEpisodes (playHeadless), no Pesadelo", () => {
    const c = makeConfig(b, map, { difficulty: "nightmare" });
    let total = 0;
    for (const seed of [3, 4, 6]) {
      const r = playHeadlessReport(c, CLASSES[seed % CLASSES.length], seed), h = playHeadless(c, seed);
      expect(r.team.chases.captureDurations).toEqual(h.chases);
      total += h.chases.length;
      const onHuman = r.human.chases;
      expect(onHuman.length).toBe(r.team.chases.onHuman);
      for (const x of onHuman) { expect(x.target).toBe(0); expect(x.duration).toBeCloseTo(x.end - x.start, 9); }
    }
    expect(total).toBeGreaterThan(0);
  }, LONG_MS);
});

// tools/sim/compare-human.ts fica fora do projeto TypeScript de packages/sim: import dinâmico com os tipos mínimos
interface Side { matches: number; puzzle: number | null; puzzleN: number; generator: number | null; duration: number | null; escape: number }
interface CompareModule {
  summarize(r: unknown[]): Side;
  groupsOf(r: unknown[]): { group: { difficulty: string; cls: string }; reports: unknown[] }[];
  sideBySide(group: unknown, human: Side, bot: Side, target: readonly [number, number]): string;
}
const script = root + "tools/sim/compare-human.ts";
const fixture = root + "tools/sim/fixtures/bot-report.json";
const tsx = root + "node_modules/.bin/tsx";

describe("tools/sim/compare-human.ts", () => {
  it("medianas, grupos e o destaque da meta de 12–18 s", async () => {
    const m = await import(/* @vite-ignore */ script) as CompareModule;
    const rep = JSON.parse(readFileSync(fixture, "utf8"));
    expect(rep.version).toBe(REPORT_VERSION);
    const groups = m.groupsOf([rep, rep]);
    expect(groups.length).toBe(1);
    expect(groups[0].group).toMatchObject({ difficulty: rep.difficulty, cls: rep.human.cls });
    const side = m.summarize([rep]);
    expect(side.matches).toBe(1);
    expect(side.puzzleN).toBeGreaterThan(0);
    const target = b.generator.puzzle_time_target.full as [number, number];
    const mid = (target[0] + target[1]) / 2;
    expect(m.sideBySide(groups[0].group, { ...side, puzzle: mid }, side, target)).toMatch(/DENTRO da meta/);
    expect(m.sideBySide(groups[0].group, { ...side, puzzle: target[1] + 1 }, side, target)).toMatch(/FORA da meta/);
    expect(m.sideBySide(groups[0].group, { ...side, puzzle: null }, side, target)).toMatch(/SEM DADO/);
    expect(m.summarize([]).escape).toBe(0);
  });
  it("roda de ponta a ponta com o fixture (2 partidas de bot) e recusa argumentos inválidos", () => {
    const out = execFileSync(tsx, [script, fixture, "--n=2", "--workers=1"], { cwd: root, encoding: "utf8" });
    expect(out).toMatch(/tempo por quebra-cabeça \(mediana\)/);
    expect(out).toMatch(/tempo por gerador obrigatório/);
    expect(out).toMatch(/>> tempo humano por quebra-cabeça: (DENTRO|FORA) da meta/);
    expect(out).toMatch(/bots: 2 partidas por grupo/);
    expect(() => execFileSync(tsx, [script, "--n=2"], { cwd: root, stdio: "pipe" })).toThrow();
  }, LONG_MS);
});

