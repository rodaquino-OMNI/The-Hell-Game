// R3 — máquina de estados do caçador (GDD-v0.3 §8.2): Patrulha → Investigar → Perseguir → Atacar → Recuo → Prender,
// patrulha ponderada pelo progresso dos geradores, portão na pressão final e telegraph de toda habilidade
// (GDD-v0.2 §4.1: golpe, dash, projétil e armadilha).
import { describe, expect, it } from "vitest";
import {
  HUNTER_TRANSITIONS, newHunterAi, project, setMode, step, think, NO_INPUT, type Hunter, type HunterMode,
} from "../src/index.ts";
import { aiGame, b, normal, percept, play, seen, traced } from "./ai-helpers.ts";

const edges = (log: { from: string; to: string }[]) => log.map(e => `${e.from}>${e.to}`);
const free = (p: { x: number; z: number }) => normal.grid!.isClear(p.x, p.z);

describe("grafo de transições", () => {
  it("é o do §8.2 (com as saídas de perda de alvo, erro do golpe e atordoamento)", () => {
    expect(HUNTER_TRANSITIONS).toEqual({
      patrol: ["investigate", "chase"], investigate: ["patrol", "chase"], chase: ["attack", "investigate", "patrol"],
      attack: ["recoil", "chase"], recoil: ["cage", "chase"], cage: ["patrol"],
    });
  });
  it("setMode recusa aresta fora do grafo, avisa o gancho trace e ignora o mesmo estado", () => {
    const { cfg, log } = traced();
    const ai = newHunterAi();
    expect(() => setMode(cfg, 1, ai, "attack")).toThrow(/patrol → attack/);
    setMode(cfg, 1, ai, "patrol");
    expect(log).toEqual([]);
    setMode(cfg, 2, ai, "chase");
    expect(log).toEqual([{ t: 2, from: "patrol", to: "chase" }]);
    const all = Object.keys(HUNTER_TRANSITIONS) as HunterMode[];
    for (const from of all) for (const to of all) {
      if (from === to) continue;
      const a = { ...newHunterAi(), mode: from };
      if (HUNTER_TRANSITIONS[from].includes(to)) { setMode(cfg, 0, a, to); expect(a.mode).toBe(to); }
      else expect(() => setMode(cfg, 0, a, to)).toThrow();
    }
  });
});

describe("ciclo Patrulha → Perseguir → Atacar → Recuo → Prender → Patrulha", () => {
  it("golpe que não captura: Recuo de hunter.melee.recoil e volta a Perseguir", () => {
    const { cfg, log } = traced();
    const g = aiGame(cfg);
    const P = g.survivors[0]; P.x = -8; P.z = 19;
    g.hunter.ai!.patrol = { x: -8, z: 29, gen: -1 };
    while (g.hunter.ai!.mode !== "recoil" && g.t < 3) step(cfg, g, NO_INPUT);
    expect(P.hp).toBe(100 - b.hunter.melee.damage);
    expect(edges(log)).toEqual(["patrol>chase", "chase>attack", "attack>recoil"]);
    expect(g.hunter.recoil).toBeCloseTo(b.hunter.melee.recoil, 5);
    const at = { x: g.hunter.x, z: g.hunter.z };
    play(cfg, g, b.hunter.melee.recoil - 0.2);
    expect({ x: g.hunter.x, z: g.hunter.z }).toEqual(at); // parado no recuo
    expect(g.hunter.ai!.mode).toBe("recoil");
    play(cfg, g, 0.3);
    expect(edges(log).slice(3)).toEqual(["recoil>chase"]);
  });
  it("golpe que captura: Recuo → Prender → Patrulha; alvo sob anti-tunnel deixa de ser candidato", () => {
    const { cfg, log } = traced();
    const g = aiGame(cfg);
    const P = g.survivors[0]; P.x = -8; P.z = 19; P.hp = 10;
    g.hunter.ai!.patrol = { x: -8, z: 29, gen: -1 };
    while (g.hunter.ai!.mode !== "recoil" && g.t < 3) step(cfg, g, NO_INPUT);
    expect(P.st).toBe("cage");
    expect(g.hunter.ai!.captured).toBe(true);
    play(cfg, g, b.hunter.melee.recoil + 0.25);
    expect(edges(log)).toEqual(["patrol>chase", "chase>attack", "attack>recoil", "recoil>cage", "cage>patrol"]);
    expect(g.hunter.ai!.mode).toBe("patrol");
    expect(g.hunter.ai!.captured).toBe(false);
    // resgatado e em vista, mas sob anti-tunnel: não vira alvo
    P.st = "ok"; P.hp = 60; P.immune = 0; P.x = g.hunter.x; P.z = g.hunter.z + 3; g.hunter.a = Math.PI;
    play(cfg, g, 1);
    expect(g.hunter.target).toBe(-1);
  });
  it("golpe errado (alvo sai do alcance no preparo): Atacar → Perseguir", () => {
    const { cfg, log } = traced();
    const g = aiGame(cfg);
    const P = g.survivors[0]; P.x = -8; P.z = 19;
    g.hunter.ai!.patrol = { x: -8, z: 29, gen: -1 };
    while (g.hunter.ai!.mode !== "attack") step(cfg, g, NO_INPUT);
    expect(g.hunter.windup).toMatchObject({ kind: "melee", total: b.hunter.telegraph_min });
    P.z += 5;
    play(cfg, g, b.hunter.telegraph_min + 0.05);
    expect(P.hp).toBe(100);
    expect(edges(log).slice(-1)).toEqual(["attack>chase"]);
    expect(g.hunter.atk).toBeGreaterThan(0); // recarga gasta mesmo errando
  });
  it("atordoar no preparo cancela o golpe: Atacar → Perseguir", () => {
    const { cfg, log } = traced();
    const g = aiGame(cfg);
    const P = g.survivors[0]; P.x = -8; P.z = 19;
    g.hunter.ai!.patrol = { x: -8, z: 29, gen: -1 };
    while (g.hunter.ai!.mode !== "attack") step(cfg, g, NO_INPUT);
    g.hunter.stun = 1;
    step(cfg, g, NO_INPUT);
    expect(g.hunter.windup).toBeNull();
    expect(g.hunter.ai!.speed).toBe(0);
    expect(edges(log).slice(-1)).toEqual(["attack>chase"]);
  });
  it("sem sobreviventes vivos no preparo: cancela e volta a Perseguir; depois Patrulha", () => {
    const { cfg, log } = traced();
    const g = aiGame(cfg);
    const P = g.survivors[0]; P.x = -8; P.z = 19;
    g.hunter.ai!.patrol = { x: -8, z: 29, gen: -1 };
    while (g.hunter.ai!.mode !== "attack") step(cfg, g, NO_INPUT);
    g.survivors[1].st = "cage"; P.st = "cage";
    step(cfg, g, NO_INPUT);
    expect(g.hunter.windup).toBeNull();
    expect(edges(log).slice(-1)).toEqual(["attack>chase"]);
  });
});

describe("Perseguir → Investigar/Patrulha e Investigar → Perseguir", () => {
  it("perde o alvo com memória vencida: vai direto para Patrulha", () => {
    const { cfg, log } = traced();
    const g = aiGame(cfg);
    const P = g.survivors[0]; P.x = -8; P.z = 24;
    g.hunter.ai!.patrol = { x: -8, z: 29, gen: -1 };
    play(cfg, g, 0.6);
    expect(g.hunter.ai!.mode).toBe("chase");
    P.x = 25; P.z = -25;
    g.hunter.ai!.memory!.until = g.t - 1;
    // a próxima leitura ainda pode renovar a memória com a posição antiga; congela a decisão até lá
    g.hunter.ai!.percept = { ...g.hunter.ai!.percept!, survivors: [] };
    g.hunter.ai!.decideIn = 0;
    step(cfg, g, NO_INPUT);
    expect(edges(log).slice(-1)).toEqual(["chase>patrol"]);
  });
  it("revê o alvo durante a investigação: Investigar → Perseguir", () => {
    const { cfg, log } = traced();
    const g = aiGame(cfg);
    const P = g.survivors[0]; P.x = -8; P.z = 24;
    g.hunter.ai!.patrol = { x: -8, z: 29, gen: -1 };
    play(cfg, g, 0.6);
    P.x = 25; P.z = -25;
    play(cfg, g, 0.3);
    expect(g.hunter.ai!.mode).toBe("investigate");
    const inv = g.hunter.ai!.investigate!;
    P.x = inv.x; P.z = inv.z; // reaparece na última posição conhecida, à frente do caçador
    play(cfg, g, 0.6);
    expect(edges(log)).toEqual(["patrol>chase", "chase>investigate", "investigate>chase"]);
  });
  it("investiga o ponto e vasculha em volta (pontos navegáveis a até ai.search_radius) até o prazo", () => {
    const g = aiGame();
    const ai = g.hunter.ai!;
    ai.mode = "investigate";
    ai.investigate = { x: -8, z: 18, until: 6, spot: null };
    const spots = new Set<string>();
    for (let i = 0; i < 5 * 60; i++) {
      step(normal, g, NO_INPUT);
      const s = ai.investigate?.spot;
      if (s) {
        spots.add(`${s.x},${s.z}`);
        expect(free(s)).toBe(true);
        expect(Math.hypot(s.x + 8, s.z - 18)).toBeLessThanOrEqual(b.ai.search_radius + b.nav.fallback_grid);
      }
    }
    expect(spots.size).toBeGreaterThan(1);
    play(normal, g, 1.5);
    expect(ai.mode).toBe("patrol");
    expect(ai.investigate).toBeNull();
  });
});

describe("patrulha (§8.2): geradores com peso proporcional ao progresso; portão na pressão final", () => {
  const H = () => ({ atk: 1e9, dash: 1e9, projectile: 1e9, trap: 1e9, dashing: 0, windup: null }) as unknown as Hunter;
  const gens = (p: number[], done: boolean[] = []) => p.map((progress, i) => ({ x: [-22, 22, -22, 22][i], z: [-22, -22, 22, 22][i], progress, done: !!done[i], bonus: false }));
  function picks(pp: ReturnType<typeof percept>, n: number) {
    const rng = { seed: 9 }, out: number[] = [];
    for (let i = 0; i < n; i++) { const ai = newHunterAi(); think(normal, H(), ai, pp, rng); out.push(ai.patrol!.gen); }
    return out;
  }
  it("só o gerador com progresso é visitado; todos zerados = todos visitados; concluídos ficam de fora", () => {
    expect(new Set(picks(percept([], { gens: gens([0, 0, 0.6, 0]) }), 50))).toEqual(new Set([2]));
    const counts = [0, 0, 0, 0];
    for (const k of picks(percept([], { gens: gens([0.2, 0.6, 0, 0]) }), 400)) counts[k]++;
    expect(counts[2] + counts[3]).toBe(0);
    expect(counts[1]).toBeGreaterThan(counts[0] * 2); // 0,6 contra 0,2 → ~3:1
    expect(new Set(picks(percept([], { gens: gens([0, 0, 0, 0]) }), 80))).toEqual(new Set([0, 1, 2, 3]));
    expect(new Set(picks(percept([], { gens: gens([0, 0, 0, 0], [true, false, true, false]) }), 40))).toEqual(new Set([1, 3]));
  });
  it("o destino da patrulha é um ponto navegável (projetado na grade)", () => {
    const ai = newHunterAi();
    think(normal, H(), ai, percept([], { gens: [{ x: 0, z: 0, progress: 0, done: false, bonus: false }] }), { seed: 1 });
    expect(free(ai.patrol!)).toBe(true); // o centro do bloco central foi projetado para fora dele
    expect(Math.max(Math.abs(ai.patrol!.x), Math.abs(ai.patrol!.z))).toBeLessThan(4 + b.hunter.radius + b.nav.fallback_grid);
  });
  it("pressão final: patrulha pontos navegáveis em volta do portão", () => {
    for (let s = 1; s < 30; s++) {
      const ai = newHunterAi();
      think(normal, H(), ai, percept([], { gens: gens([0.4, 0, 0, 0]), finalPressure: true, gate: { x: 0, z: -29 } }), { seed: s });
      expect(ai.patrol!.gen).toBe(-1);
      expect(free(ai.patrol!)).toBe(true);
      expect(Math.hypot(ai.patrol!.x, ai.patrol!.z + 29)).toBeLessThanOrEqual(b.ai.search_radius + b.nav.fallback_grid);
    }
  });
  it("na partida: ao chegar ao gerador, escolhe outro (não repete o mesmo)", () => {
    const g = aiGame();
    const ai = g.hunter.ai!;
    step(normal, g, NO_INPUT);
    const first = ai.patrol!;
    g.hunter.x = first.x; g.hunter.z = first.z;
    step(normal, g, NO_INPUT);
    expect(ai.patrol!.gen).not.toBe(first.gen);
    expect(ai.patrol!.gen).toBeGreaterThanOrEqual(0);
  });
  it("project: ponto dentro de parede ou fora do mapa vai para o ponto navegável mais próximo; ponto livre fica", () => {
    const inside = project(normal, { x: 0.5, z: 0 });
    expect(free(inside)).toBe(true);
    expect(inside.x).toBeGreaterThan(4);
    const out = project(normal, { x: 40, z: 40 });
    expect(free(out)).toBe(true);
    const ok = project(normal, { x: -8.1, z: 16.1 });
    expect(Math.hypot(ok.x + 8.1, ok.z - 16.1)).toBeLessThanOrEqual(b.nav.fallback_grid);
    const noGrid = project({ ...normal, grid: null }, { x: 0, z: 0 });
    expect(noGrid).toEqual({ x: 0, z: 0 });
  });
});

describe("telegraph ≥ hunter.telegraph_min em toda habilidade (GDD-v0.2 §4.1)", () => {
  function chasing(d: number) {
    const g = aiGame();
    const P = g.survivors[0]; P.x = -8; P.z = 16 + d;
    g.hunter.ai!.patrol = { x: -8, z: 29, gen: -1 };
    return g;
  }
  it("projétil: preparo exposto em hunter.windup (kind projectile) e o disparo só no fim", () => {
    const g = chasing(10); g.hunter.projectile = 0;
    while (!g.hunter.windup) step(normal, g, NO_INPUT);
    expect(g.hunter.windup).toMatchObject({ kind: "projectile", total: b.hunter.telegraph_min });
    expect(g.hunter.projectile).toBeCloseTo(b.hunter.projectile.cooldown, 5);
    play(normal, g, b.hunter.telegraph_min - 0.05);
    expect(g.projectiles.length).toBe(0);
    play(normal, g, 0.1);
    expect(g.projectiles.length).toBe(1);
    expect(g.hunter.windup).toBeNull();
    play(normal, g, 1);
    expect(g.survivors[0].hp).toBe(100 - normal.projectileDamage);
  });
  it("armadilha: preparo (kind trap), recarga reiniciada no início e armadilha só no fim", () => {
    const g = aiGame(); g.hunter.trap = 0;
    step(normal, g, NO_INPUT);
    expect(g.hunter.windup).toMatchObject({ kind: "trap", total: b.hunter.telegraph_min });
    expect(g.hunter.trap).toBeCloseTo(normal.trapInterval, 5);
    play(normal, g, b.hunter.telegraph_min - 0.05);
    expect(g.traps.length).toBe(0);
    play(normal, g, 0.1);
    expect(g.traps.length).toBe(1);
  });
  it("dash: preparo (kind dash) e depois avanço a hunter.dash.speed", () => {
    const g = chasing(8); g.hunter.dash = 0;
    while (!g.hunter.windup) step(normal, g, NO_INPUT);
    expect(g.hunter.windup).toMatchObject({ kind: "dash", total: b.hunter.telegraph_min });
    play(normal, g, b.hunter.telegraph_min - 0.05);
    expect(g.hunter.dashing).toBeLessThanOrEqual(0);
    play(normal, g, 0.1);
    expect(g.hunter.dashing).toBeGreaterThan(0);
    const z0 = g.hunter.z;
    step(normal, g, NO_INPUT);
    expect(g.hunter.z - z0).toBeCloseTo(b.hunter.dash.speed / 60, 3);
  });
  it("projétil perdido de vista no preparo: mira na última posição conhecida; sem memória, não dispara", () => {
    const g = chasing(10); g.hunter.projectile = 0;
    while (!g.hunter.windup) step(normal, g, NO_INPUT);
    g.survivors[0].x = 25; g.survivors[0].z = -25;
    play(normal, g, b.hunter.telegraph_min + 0.05);
    expect(g.projectiles.length).toBe(1);
    const h = chasing(10); h.hunter.projectile = 0;
    while (!h.hunter.windup) step(normal, h, NO_INPUT);
    h.survivors[0].x = 25; h.survivors[0].z = -25; h.hunter.ai!.memory = null;
    h.hunter.ai!.percept = { ...h.hunter.ai!.percept!, survivors: [] }; h.hunter.ai!.perceiveIn = 1;
    play(normal, h, b.hunter.telegraph_min + 0.05);
    expect(h.projectiles.length).toBe(0);
  });
  it("na pressão final persegue ×final_pressure_speed_mult e o golpe dá damage_final", () => {
    const g = chasing(8); g.gateStarted = true; g.gateTimer = 1e9;
    play(normal, g, 0.6);
    const z0 = g.hunter.z;
    play(normal, g, 0.25);
    expect(g.hunter.z - z0).toBeCloseTo(normal.chaseSpeed * b.hunter.final_pressure_speed_mult * 0.25, 1);
    play(normal, g, 3);
    expect(g.survivors[0].hp).toBe(100 - b.hunter.melee.damage_final);
  });
});

describe("uso de seen() fora do jogo", () => {
  it("think sem candidatos e sem ruído mantém Patrulha e escolhe destino", () => {
    const ai = newHunterAi();
    const H = { atk: 1e9, dash: 1e9, projectile: 1e9, trap: 1e9, dashing: 0, windup: null } as unknown as Hunter;
    think(normal, H, ai, percept([seen(0, 3, 0, { antiTunnel: true })]), { seed: 3 });
    expect(ai.mode).toBe("patrol");
    expect(ai.target).toBe(-1);
    expect(ai.patrol).not.toBeNull();
  });
});
