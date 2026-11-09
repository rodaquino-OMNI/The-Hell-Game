// Diretor de áudio (A-5 do V5; GDD-v0.3 §11, GDD-v0.2 §11 e §4.1): flag em dados (D-32), mapeamento dos GameEvent
// "sound" sem drenar a fila, transições por quadro (telegraph, gerador concluído, prisão, resgate), contínuos
// (batimento pela distância do caçador, respiração pela stamina, zumbido pelo progresso, passos pela velocidade) e
// música (updateMusic a cada quadro, ducking em golpe no jogador e prisão).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameMap } from "@thehell/shared";
import { loadBalanceFile } from "@thehell/shared/node";
import { createGame, makeConfig, STEP, type GameEvent, type GameState } from "@thehell/sim";
import { audioEvents, createAudioDirector, directorEnabled, updateAudio } from "../src/audio/director.ts";
import type { SfxOpts } from "../src/audio/sfx.ts";

const bal = loadBalanceFile(new URL("../../../data/balance.yaml", import.meta.url).pathname);
const patio = JSON.parse(readFileSync(new URL("../../../data/maps/patio.json", import.meta.url), "utf8")) as GameMap;
const simCfg = makeConfig(bal, patio, { ruleset: "v1" });
const D = bal.audio.director, HB = bal.prototype_extras.heartbeat;

interface Call { name: string; opts?: SfxOpts; t: number }
function rig(enabled = true) {
  const calls: Call[] = [], ducks: number[] = [], music: GameState[] = [];
  let now = 0;
  const moved: { x: number; z: number }[] = [];
  const dir = createAudioDirector({
    enabled, cfg: bal,
    play: (name, opts) => { calls.push({ name, opts, t: now }); return { setPosition: p => moved.push({ x: p.x, z: p.z }) }; },
    music: { update: s => { music.push(s); }, duckFor: s => { ducks.push(s); } },
  });
  return { dir, calls, ducks, music, moved, setNow: (t: number) => { now = t; } };
}

/** estado parado: jogador 0 na origem, caçador longe, geradores sem progresso */
function state(): GameState {
  const g = createGame(simCfg, "Atacador", 7);
  const P = g.survivors[0];
  P.x = 0; P.z = 0;
  g.hunter.x = 100; g.hunter.z = 100;
  for (const s of g.survivors.slice(1)) { s.x = -100; s.z = -100; }
  return g;
}
/** roda `secs` segundos de quadros STEP sem mexer em nada além de g.t */
function run(r: ReturnType<typeof rig>, g: GameState, secs: number, each?: (g: GameState) => void) {
  for (let i = 0; i < Math.round(secs / STEP); i++) { g.t += STEP; each?.(g); r.setNow(g.t); r.dir.update(g, 0, STEP); }
}
const named = (c: Call[], n: string) => c.filter(x => x.name === n);

describe("audio/director: flag e eventos (A-5)", () => {
  it("audio.director_enabled false (padrão, D-32): updateAudio e audioEvents não fazem nada", () => {
    expect(directorEnabled()).toBe(false);
    const g = state();
    g.hunter.windup = { kind: "dash", t: 0.4, total: 0.4 };
    expect(() => { updateAudio(g, 0, STEP); audioEvents([{ type: "sound", name: "hit" }]); }).not.toThrow();
    const r = rig(false);
    expect(r.dir.enabled).toBe(false);
    run(r, g, 1);
    r.dir.events([{ type: "sound", name: "hit" }, { type: "flash" }]);
    expect(r.calls).toEqual([]);
    expect(r.music).toEqual([]);
    expect(r.ducks).toEqual([]);
  });

  it("audioEvents toca os 5 GameEvent 'sound' pelo catálogo (pos null), duck no golpe ao jogador e não drena a fila", () => {
    const r = rig();
    const list: GameEvent[] = [
      { type: "sound", name: "puzzle_ok" }, { type: "sound", name: "puzzle_fail" }, { type: "sound", name: "hit" },
      { type: "sound", name: "stun" }, { type: "sound", name: "bolt" }, { type: "flash" }, { type: "msg", key: "spark" },
    ];
    const copy = structuredClone(list);
    r.dir.events(list);
    expect(r.calls.map(c => c.name)).toEqual(["puzzle_ok", "puzzle_fail", "hit", "stun", "bolt"]);
    expect(r.calls.every(c => c.opts?.pos === null)).toBe(true);
    expect(r.ducks).toEqual([D.duck_time]);
    expect(list).toEqual(copy); // recebe o array já drenado e não o altera
  });

  it("updateMusic do A-2 a cada quadro", () => {
    const r = rig(), g = state();
    run(r, g, 10 * STEP);
    expect(r.music.length).toBe(10);
    expect(r.music[0]).toBe(g);
  });
});

describe("audio/director: telegraph e transições (A-5)", () => {
  it("windup nulo → presente: telegraph do tipo no mesmo quadro, na posição do caçador, seguindo-o; um por preparo", () => {
    for (const kind of ["melee", "dash", "projectile", "trap"] as const) {
      const r = rig(), g = state();
      g.hunter.x = 5; g.hunter.z = 5;
      run(r, g, 0.1);
      g.hunter.windup = { kind, t: 0.4, total: 0.4 };
      run(r, g, STEP);
      expect(named(r.calls, `telegraph_${kind}`)).toEqual([{ name: `telegraph_${kind}`, opts: { pos: { x: 5, z: 5 } }, t: g.t }]);
      run(r, g, 0.2, s => { s.hunter.windup!.t -= STEP; s.hunter.x += 0.01; });
      expect(named(r.calls, `telegraph_${kind}`).length).toBe(1);
      expect(r.moved.at(-1)!.x).toBeCloseTo(g.hunter.x, 9);
      // preparo seguinte (outro, depois de um quadro sem preparo) toca de novo
      g.hunter.windup = null; run(r, g, STEP);
      g.hunter.windup = { kind, t: 0.4, total: 0.4 }; run(r, g, STEP);
      expect(named(r.calls, `telegraph_${kind}`).length).toBe(2);
    }
  });

  it("troca de preparo sem quadro nulo (vários passos por quadro) também toca", () => {
    const r = rig(), g = state();
    g.hunter.windup = { kind: "trap", t: 0.01, total: 0.4 }; run(r, g, STEP);
    g.hunter.windup = { kind: "melee", t: 0.4, total: 0.4 }; run(r, g, STEP);
    g.hunter.windup = { kind: "melee", t: 0.39, total: 0.4 }; run(r, g, STEP);
    g.hunter.windup = { kind: "melee", t: 0.4, total: 0.4 }; run(r, g, STEP); // recomeçou
    expect(r.calls.filter(c => c.name.startsWith("telegraph_")).map(c => c.name)).toEqual(["telegraph_trap", "telegraph_melee", "telegraph_melee"]);
  });

  it("gerador concluído, prisão (com ducking) e resgate, na posição; partida nova não dispara transição", () => {
    const r = rig(), g = state();
    run(r, g, STEP);
    g.gens[1].done = true; g.gens[1].n = bal.generator.puzzles_per_generator;
    const B = g.survivors[2];
    B.st = "cage"; B.x = 3; B.z = 4;
    run(r, g, STEP);
    expect(named(r.calls, "generator_done")).toEqual([{ name: "generator_done", opts: { pos: { x: g.gens[1].x, z: g.gens[1].z } }, t: g.t }]);
    expect(named(r.calls, "cage")[0].opts).toEqual({ pos: { x: 3, z: 4 } });
    expect(r.ducks).toEqual([D.duck_time]);
    B.st = "ok"; run(r, g, STEP);
    expect(named(r.calls, "rescue").length).toBe(1);
    // partida nova (relógio volta): sem "concluído" falso nem resgate falso
    const h = state(); h.gens[0].done = true; h.survivors[1].st = "cage";
    r.calls.length = 0; r.setNow(0); r.dir.update(h, 0, STEP);
    expect(r.calls.filter(c => ["generator_done", "cage", "rescue"].includes(c.name))).toEqual([]);
  });

  it("partida encerrada: silêncio", () => {
    const r = rig(), g = state();
    g.over = true; g.hunter.x = 1; g.hunter.windup = { kind: "dash", t: 0.4, total: 0.4 };
    run(r, g, 1);
    expect(r.calls).toEqual([]);
  });
});

describe("audio/director: contínuos (A-5)", () => {
  /** batimentos em `secs` com o caçador a `d` m do jogador */
  function beats(d: number, secs = 6) {
    const r = rig(), g = state();
    g.hunter.x = d; g.hunter.z = 0;
    run(r, g, secs);
    return named(r.calls, "heartbeat");
  }
  it("batimento só dentro de prototype_extras.heartbeat.radius; acelera e fica mais forte com a proximidade", () => {
    expect(beats(HB.radius + 1).length).toBe(0);
    const far = beats(HB.radius * 0.9), mid = beats(HB.radius * 0.5), near = beats(HB.radius * 0.1);
    expect(far.length).toBeGreaterThan(0);
    expect(mid.length).toBeGreaterThan(far.length);
    expect(near.length).toBeGreaterThan(mid.length);
    expect(near[0].opts!.intensity!).toBeGreaterThan(mid[0].opts!.intensity!);
    expect(mid[0].opts!.intensity!).toBeGreaterThan(far[0].opts!.intensity!);
    expect(near[0].opts!.pos).toBeNull();
    // intervalo = base + (d / raio) × range (mesma fórmula do HUD)
    const gap = near[1].t - near[0].t;
    expect(gap).toBeCloseTo(HB.base_interval + 0.1 * HB.range_interval, 1);
  });

  it("respiração liga abaixo de director.breath.stamina_below × stamina.max e acelera com menos stamina", () => {
    const breaths = (stamina: number) => { const r = rig(), g = state(); g.survivors[0].stamina = stamina; run(r, g, 6); return named(r.calls, "breath"); };
    const limit = D.breath.stamina_below * bal.survivor.stamina.max;
    expect(breaths(limit + 1).length).toBe(0);
    expect(breaths(bal.survivor.stamina.max).length).toBe(0);
    const some = breaths(limit * 0.8), empty = breaths(0);
    expect(some.length).toBeGreaterThan(0);
    expect(empty.length).toBeGreaterThan(some.length);
    expect(empty[0].opts).toEqual({ pos: null, intensity: 1 });
    expect(some[0].opts!.intensity!).toBeCloseTo(0.2, 9);
  });

  it("zumbido: só gerador com progresso, perto, não concluído; intensidade = n / puzzles_per_generator", () => {
    const hum = (n: number, d: number, done = false) => {
      const r = rig(), g = state();
      const x = g.gens[0]; x.x = d; x.z = 0; x.n = n; x.done = done;
      for (const o of g.gens.slice(1)) { o.x = 200; o.z = 200; }
      run(r, g, 3);
      return named(r.calls, "generator_hum");
    };
    const per = bal.generator.puzzles_per_generator;
    expect(hum(0, 5).length).toBe(0);
    expect(hum(2, D.hum.radius + 1).length).toBe(0);
    expect(hum(per, 5, true).length).toBe(0);
    const low = hum(1, 5), high = hum(per - 1, 5);
    expect(low.length).toBeGreaterThan(0);
    expect(low[0].opts).toEqual({ pos: { x: 5, z: 0 }, intensity: 1 / per });
    expect(high[0].opts!.intensity).toBeCloseTo((per - 1) / per, 9);
    expect(low[1].t - low[0].t).toBeCloseTo(D.hum.period, 1);
  });

  it("passos do caçador: espaciais, um a cada hunter_stride metros (cadência pela velocidade); salto não conta", () => {
    const steps = (speed: number, secs = 4) => {
      const r = rig(), g = state();
      run(r, g, secs, s => { s.hunter.x += speed * STEP; });
      return named(r.calls, "step_hunter");
    };
    const patrol = steps(bal.hunter.patrol_speed), dash = steps(bal.hunter.dash.speed);
    expect(patrol.length).toBe(Math.floor((bal.hunter.patrol_speed * 4 + 1e-6) / D.hunter_stride));
    expect(dash.length).toBeGreaterThan(patrol.length * 3);
    expect(patrol[0].opts!.pos).not.toBeNull();
    const r = rig(), g = state();
    run(r, g, STEP); g.hunter.x += D.teleport_dist + 1; run(r, g, STEP);
    expect(named(r.calls, "step_hunter")).toEqual([]);
  });

  it("passos do jogador: pos null; corrida quando a stamina cai, caminhada senão; parado, nada", () => {
    const go = (speed: number, drain: boolean) => {
      const r = rig(), g = state();
      run(r, g, 3, s => { s.survivors[0].x += speed * STEP; if (drain) s.survivors[0].stamina -= bal.survivor.stamina.drain * STEP; });
      return r.calls;
    };
    const walk = go(bal.survivor.walk, false), run_ = go(bal.survivor.run, true);
    expect(named(walk, "step_walk").length).toBe(Math.floor((bal.survivor.walk * 3 + 1e-6) / D.walk_stride));
    expect(named(walk, "step_run")).toEqual([]);
    expect(named(run_, "step_run").length).toBe(Math.floor((bal.survivor.run * 3 + 1e-6) / D.run_stride));
    expect(named(run_, "step_walk")).toEqual([]);
    expect(named(walk, "step_walk")[0].opts).toEqual({ pos: null });
    expect(go(0, false).filter(c => c.name.startsWith("step_"))).toEqual([]);
  });

  it("jogador fora de jogo (preso): sem passos, respiração nem batimento dele", () => {
    const r = rig(), g = state();
    g.survivors[0].st = "cage"; g.survivors[0].stamina = 0; g.hunter.x = 2; g.hunter.z = 0;
    run(r, g, 3, s => { s.survivors[0].x += 0.05; });
    expect(r.calls.filter(c => ["heartbeat", "breath", "step_walk", "step_run"].includes(c.name))).toEqual([]);
  });
});
