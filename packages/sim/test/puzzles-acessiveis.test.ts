// F2-08: quebra-cabeça acessível dentro do simulador (`makeConfig(..., { accessiblePuzzles: true })`).
// Fontes: GDD-v0.3 §12.4 ("quebra-cabeças sem tempo e com zona maior (`puzzles.accessible`)") e GDD-v0.2 §6.1 item b
// ("ter versão de acessibilidade (zona maior, sem tempo)"). Todos os valores vêm de data/balance.yaml; as variações
// de parâmetro abaixo são dados de teste (outros balances possíveis), não regras de jogo.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Balance } from "@thehell/shared";
import {
  createGame, makeConfig, matchReport, openPuzzle, playHeadless, puzzleUntimed, puzzleZoneWidth, REPORT_VERSION, step, STEP, NO_INPUT,
  type ClassName, type GameState, type PlayerInput, type SimConfig,
} from "../src/index.ts";
import { balance as b, map } from "./helpers.ts";

const RULESETS = ["v1", "prototype"] as const;
const DIFFS = Object.keys(b.difficulty_table) as SimConfig["difficulty"][];

/** partida sem caçador ativo e com os bots fora: só o quebra-cabeça do jogador conta */
function quiet(c: SimConfig, cls: ClassName = "Curandeiro", seed = 1): GameState {
  const g = createGame(c, cls, seed);
  g.hunter.stun = 1e9; g.hunter.x = 25; g.hunter.z = 25;
  for (const s of g.survivors) if (s.bot) s.st = "dead";
  g.reveal = 1e9;
  return g;
}
const sounds = (g: GameState, name: string) => g.events.filter(e => e.type === "sound" && e.name === name).length;
function hold(c: SimConfig, g: GameState, seconds: number, input: Partial<PlayerInput> = {}) {
  for (let i = 0, n = Math.round(seconds / STEP); i < n; i++) step(c, g, { ...NO_INPUT, ...input });
}
/** balance com parâmetros de quebra-cabeça trocados (o modo acessível não pode depender dos valores atuais) */
function variant(o: { puzzleTime: number; mechTime: number; speed: number; zone: number; mechZone: number; mult: number; timed?: boolean }): Balance {
  return {
    ...b,
    survivor: { ...b.survivor, bot: { ...b.survivor.bot, puzzle_time: o.puzzleTime } },
    classes: { ...b.classes, mechanic: { ...b.classes.mechanic, bot_puzzle_time: o.mechTime, puzzle_zone: o.mechZone } },
    puzzles: { ...b.puzzles, timing: { speed: o.speed, zone: o.zone }, accessible: { zone_mult: o.mult, timed: o.timed ?? b.puzzles.accessible.timed } },
  };
}
// a base é o próprio YAML; as outras linhas dobram o tempo do quebra-cabeça, mudam a velocidade e as zonas
const BASE = {
  puzzleTime: b.survivor.bot.puzzle_time, mechTime: b.classes.mechanic.bot_puzzle_time, speed: b.puzzles.timing.speed,
  zone: b.puzzles.timing.zone, mechZone: b.classes.mechanic.puzzle_zone, mult: b.puzzles.accessible.zone_mult,
};
const VARIANTS = [
  BASE,
  { ...BASE, puzzleTime: BASE.puzzleTime * 2, mechTime: BASE.mechTime * 2 },
  { ...BASE, puzzleTime: BASE.puzzleTime * 2, speed: BASE.speed * 3 },
  { ...BASE, speed: BASE.speed / 2, zone: BASE.zone / 2, mechZone: BASE.mechZone / 2 },
  { ...BASE, puzzleTime: BASE.puzzleTime / 2, mult: BASE.mult * 2, zone: BASE.zone * 2 }, // passa da barra: teto em 1
];

describe("quebra-cabeça acessível: zona maior (puzzles.accessible.zone_mult)", () => {
  it("timing e Mecânico × zone_mult depois da dificuldade, limitada à barra; desligado = cálculo de sempre", () => {
    for (const rs of RULESETS) for (const d of DIFFS) for (const cls of ["Curandeiro", "Mecânico"] as const) {
      const on = makeConfig(b, map, { ruleset: rs, difficulty: d, accessiblePuzzles: true });
      const off = makeConfig(b, map, { ruleset: rs, difficulty: d });
      const mech = cls === "Mecânico";
      const base = (mech ? b.classes.mechanic.puzzle_zone : b.puzzles.timing.zone) * off.zoneMult;
      const g = quiet(on, cls); openPuzzle(on, g, 0);
      const h = quiet(off, cls); openPuzzle(off, h, 0);
      expect(g.puzzle!.zoneWidth).toBeCloseTo(Math.min(1, base * b.puzzles.accessible.zone_mult), 12);
      expect(h.puzzle!.zoneWidth).toBe(base);
      expect(puzzleZoneWidth(on, mech)).toBe(g.puzzle!.zoneWidth);
    }
  });
  it("teto: zone_mult que passaria da barra dá a barra inteira", () => {
    const c = makeConfig(variant({ ...BASE, mult: 1 / b.puzzles.timing.zone + 1 }), map, { accessiblePuzzles: true });
    expect(puzzleZoneWidth(c, false)).toBe(1);
    expect(puzzleZoneWidth(c, true)).toBe(1);
  });
});

describe("quebra-cabeça acessível: sem tempo (puzzles.accessible.timed: false)", () => {
  it("vale para qualquer tempo de quebra-cabeça, velocidade e zona: esperar não reprova, o marcador só anda com o jogador", () => {
    for (const rs of RULESETS) for (const v of VARIANTS) for (const cls of ["Curandeiro", "Mecânico"] as const) {
      const c = makeConfig(variant({ ...v, timed: false }), map, { ruleset: rs, accessiblePuzzles: true });
      expect(puzzleUntimed(c)).toBe(true);
      const g = quiet(c, cls); openPuzzle(c, g, 0);
      const z = g.puzzle!, gen = g.gens[0];
      expect(z.kind).toBe("timing");
      expect(z.untimed).toBe(true);
      expect(z.zoneWidth).toBeCloseTo(Math.min(1, (cls === "Mecânico" ? v.mechZone : v.zone) * c.zoneMult * v.mult), 12);
      // espera bem maior que o maior tempo de conserto dos dados: nada anda, nada reprova, a tentativa continua aberta
      const wait = 3 * Math.max(v.puzzleTime, v.mechTime);
      const t0 = z.t;
      hold(c, g, wait);
      expect(g.puzzle).toBe(z);
      expect(z.t).toBe(t0);
      expect(sounds(g, "puzzle_fail")).toBe(0);
      expect(gen.n).toBe(0);
      // o jogador move o marcador até a zona (eixo lateral, na `timing.speed`) e solta: ele para ali
      let guard = Math.ceil(2 / (v.speed * STEP)); // no máximo duas travessias da barra
      while (Math.abs(g.puzzle!.t - z.zoneCenter) >= z.zoneWidth / 2 && guard-- > 0) {
        const before = g.puzzle!.t, dir = z.zoneCenter > before ? 1 : -1;
        step(c, g, { ...NO_INPUT, strafe: dir });
        expect(Math.abs(g.puzzle!.t - before)).toBeCloseTo(v.speed * STEP, 9);
      }
      expect(Math.abs(z.t - z.zoneCenter)).toBeLessThan(z.zoneWidth / 2);
      const parked = z.t;
      hold(c, g, wait);
      expect(z.t).toBe(parked);
      expect(sounds(g, "puzzle_fail")).toBe(0);
      // confirma quando quiser: acerto
      step(c, g, { ...NO_INPUT, puzzleSpace: true });
      expect(sounds(g, "puzzle_ok")).toBe(1);
      expect(gen.n).toBe(1);
    }
  });
  it("errar ainda reprova (só o tempo deixa de reprovar)", () => {
    const c = makeConfig(b, map, { ruleset: "v1", accessiblePuzzles: true });
    const g = quiet(c); openPuzzle(c, g, 0);
    const z = g.puzzle!;
    expect(z.zoneWidth).toBeLessThan(1); // pré-condição: há onde errar
    const far = z.zoneCenter < 0.5 ? 1 : 0; // ponta da barra mais longe da zona
    hold(c, g, 1 / b.puzzles.timing.speed + STEP, { strafe: far ? 1 : -1 });
    expect(z.t).toBe(far);
    expect(Math.abs(z.t - z.zoneCenter)).toBeGreaterThanOrEqual(z.zoneWidth / 2); // pré-condição: fora da zona
    step(c, g, { ...NO_INPUT, puzzleSpace: true });
    expect(sounds(g, "puzzle_fail")).toBe(1);
  });
  it("entrada analógica parcial: strafe 0,5 anda metade da distância", () => {
    const c = makeConfig(b, map, { ruleset: "v1", accessiblePuzzles: true });
    const full = quiet(c); openPuzzle(c, full, 0);
    const half = quiet(c); openPuzzle(c, half, 0);
    const secs = 1 / (2 * b.puzzles.timing.speed); // meia barra no eixo cheio: nenhum dos dois bate na ponta
    hold(c, full, secs, { strafe: 1 });
    hold(c, half, secs, { strafe: 0.5 });
    expect(full.puzzle!.t).toBeGreaterThan(0);
    expect(full.puzzle!.t).toBeLessThan(1);
    expect(half.puzzle!.t).toBeCloseTo(full.puzzle!.t / 2, 9);
  });
  it("com timed: true só a zona muda: o marcador anda sozinho como no normal", () => {
    const c = makeConfig(variant({ ...BASE, timed: true }), map, { ruleset: "v1", accessiblePuzzles: true });
    const n = makeConfig(b, map, { ruleset: "v1" });
    expect(puzzleUntimed(c)).toBe(false);
    const g = quiet(c); openPuzzle(c, g, 0);
    const h = quiet(n); openPuzzle(n, h, 0);
    expect(g.puzzle!.untimed).toBeUndefined();
    hold(c, g, 1); hold(n, h, 1);
    expect(g.puzzle!.t).toBe(h.puzzle!.t);
    expect(g.puzzle!.zoneWidth).toBeGreaterThan(h.puzzle!.zoneWidth);
  });
  it("a sequência já não tem prazo nem zona: esperar não reprova", () => {
    const c = makeConfig(b, map, { ruleset: "v1", accessiblePuzzles: true });
    const g = quiet(c); openPuzzle(c, g, 0);
    g.gens[0].n = 1; openPuzzle(c, g, 0); // n ímpar = sequência
    expect(g.puzzle!.kind).toBe("sequence");
    hold(c, g, 3 * b.survivor.bot.puzzle_time);
    expect(g.puzzle).not.toBeNull();
    expect(sounds(g, "puzzle_fail")).toBe(0);
  });
});

describe("quebra-cabeça acessível: determinismo, bots e modo normal", () => {
  const script = (i: number): PlayerInput => ({ ...NO_INPUT, forward: i % 240 < 180 ? 1 : 0, strafe: i % 400 < 100 ? 1 : -1,
    yaw: (i / 600) * Math.PI, interact: i % 300 === 0, puzzleSpace: i % 45 === 0 });
  const play = (c: SimConfig, seed: number) => {
    const g = createGame(c, "Mecânico", seed);
    for (let i = 0; i < 30 * 60 && !g.over; i++) step(c, g, script(i));
    return createHash("sha256").update(JSON.stringify(g)).digest("hex");
  };
  it("mesma semente e entradas → mesmo estado", () => {
    const c = makeConfig(b, map, { ruleset: "prototype", accessiblePuzzles: true });
    const ref = play(c, 7);
    for (let i = 0; i < 5; i++) expect(play(c, 7)).toBe(ref);
  });
  it("desligado é o padrão e não deixa rastro no estado", () => {
    expect(makeConfig(b, map).accessiblePuzzles).toBe(false);
    const c = makeConfig(b, map, { ruleset: "prototype" });
    const g = quiet(c); openPuzzle(c, g, 0);
    expect("untimed" in g.puzzle!).toBe(false);
  });
  it("bots não mudam: partida só de bots igual com a opção ligada ou desligada", () => {
    const opts = { ruleset: "v1", hunterBrain: "basic", botBrain: "prototype" } as const;
    const off = playHeadless(makeConfig(b, map, opts), 2);
    const on = playHeadless(makeConfig(b, map, { ...opts, accessiblePuzzles: true }), 2);
    expect(JSON.stringify(on)).toBe(JSON.stringify(off));
  });
  it("relatório registra a opção no topo, sem mudar a versão", () => {
    for (const a of [false, true]) {
      const c = makeConfig(b, map, { ruleset: "prototype", accessiblePuzzles: a });
      const g = createGame(c, "Curandeiro", 1, { report: true });
      step(c, g, NO_INPUT);
      const r = matchReport(g);
      expect(r.accessiblePuzzles).toBe(a);
      expect(r.version).toBe(REPORT_VERSION);
      expect(r.puzzleZone).toBe(puzzleZoneWidth(c, false));
    }
  });
});
