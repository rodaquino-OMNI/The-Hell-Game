// R3 — IA por dificuldade (GDD-v0.3 §8.4): conhecimento de loops (metadados `loops` do mapa, R2) e previsão de projétil.
import { describe, expect, it } from "vitest";
import {
  aimPoint, canBreakLoop, loopAt, newHunterAi, projectileAllowed, think, trackLoop, type Difficulty, type Hunter, type SeenSurvivor,
} from "../src/index.ts";
import { aiCfg, b, normal, percept, seen } from "./ai-helpers.ts";

const hunter = (o: Partial<Hunter> = {}) => ({ atk: 1e9, dash: 1e9, projectile: 1e9, trap: 1e9, dashing: 0, windup: null, ...o }) as Hunter;

/** pontos da rota do loop "centro" (quadrado ±5 m em volta do bloco central), 1 m por passo, sentido anti-horário */
function squareRoute(laps: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const corners = [[-5, -5], [5, -5], [5, 5], [-5, 5]];
  for (let l = 0; l < laps; l++) for (let c = 0; c < 4; c++) {
    const [ax, az] = corners[c], [bx, bz] = corners[(c + 1) % 4];
    for (let k = 0; k < 10; k++) out.push({ x: ax + ((bx - ax) * k) / 10, z: az + ((bz - az) * k) / 10 });
  }
  return out;
}

describe("loops dos metadados do mapa", () => {
  it("loopAt: na rota (até ai.loop_band) é o loop; no meio do obstáculo ou longe, nenhum", () => {
    expect(loopAt(normal, { x: 5, z: 0 })?.id).toBe("centro");
    expect(loopAt(normal, { x: 5 + b.ai.loop_band - 0.05, z: 0 })?.id).toBe("centro");
    expect(loopAt(normal, { x: 5 + b.ai.loop_band + 0.05, z: 0 })).toBeNull();
    expect(loopAt(normal, { x: 0, z: 0 })).toBeNull();
    expect(loopAt(normal, { x: -20, z: 26 })).toBeNull();
    expect(loopAt({ ...normal, map: { ...normal.map, loops: undefined } }, { x: 5, z: 0 })).toBeNull();
  });
  it("trackLoop conta voltas pelo ângulo em volta do centro; troca de alvo ou saída do loop zera", () => {
    const ai = newHunterAi();
    let r: ReturnType<typeof trackLoop> = null;
    for (const p of squareRoute(2)) r = trackLoop(normal, ai, seen(0, p.x, p.z));
    expect(r!.loop.id).toBe("centro");
    expect(r!.laps).toBeGreaterThan(1.9);
    expect(r!.laps).toBeLessThan(2);
    // ida e volta não soma voltas
    const back = newHunterAi();
    for (const p of [...squareRoute(1).slice(0, 20), ...squareRoute(1).slice(0, 20).reverse()]) r = trackLoop(normal, back, seen(0, p.x, p.z));
    expect(r!.laps).toBeLessThan(0.05);
    expect(trackLoop(normal, ai, seen(1, 5, 0))!.laps).toBe(0); // outro alvo
    expect(trackLoop(normal, ai, seen(1, -20, 26))).toBeNull();
    expect(ai.loop).toBeNull();
  });
  it("canBreakLoop: Fácil nunca; Normal depois de ai.loop_partial_laps_before_break voltas; Difícil e Pesadelo já; fora de loop sempre", () => {
    const n = b.ai.loop_partial_laps_before_break;
    expect(n).toBe(2);
    const lvl = (d: Difficulty) => aiCfg(d);
    expect(canBreakLoop(lvl("easy"), { laps: 5 })).toBe(false);
    expect(canBreakLoop(lvl("normal"), { laps: n - 0.1 })).toBe(false);
    expect(canBreakLoop(lvl("normal"), { laps: n })).toBe(true);
    expect(canBreakLoop(lvl("hard"), { laps: 0 })).toBe(true);
    expect(canBreakLoop(lvl("nightmare"), { laps: 0 })).toBe(true);
    for (const d of ["easy", "normal", "hard", "nightmare"] as Difficulty[]) expect(canBreakLoop(lvl(d), null)).toBe(true);
  });
});

describe("quebra de loop com dash/projétil na decisão (§8.4)", () => {
  /** alvo corre `laps` voltas no loop central; caçador parado a norte com projétil e dash prontos */
  function run(d: Difficulty, laps: number) {
    const c = aiCfg(d), ai = newHunterAi(), H = hunter({ projectile: 0, dash: 0 });
    const route = squareRoute(laps);
    let firstBreak = -1;
    route.forEach((p, k) => {
      if (H.windup) return;
      const s = seen(0, p.x, p.z, { vx: 0, vz: 0 });
      think(c, H, ai, percept([s], { t: k / b.ai.decision_hz, self: { x: 0, z: -12, a: 0 } }), { seed: 1 });
      if (H.windup && firstBreak < 0) firstBreak = k;
    });
    return { firstBreak, laps: ai.loop ? Math.abs(ai.loop.acc) / (2 * Math.PI) : 0, H };
  }
  it("Fácil (none) não usa dash nem projétil em alvo no loop", () => {
    expect(run("easy", 3).firstBreak).toBe(-1);
  });
  it("Normal (partial) só quebra depois de 2 voltas", () => {
    const r = run("normal", 3);
    expect(r.firstBreak).toBeGreaterThanOrEqual(2 * 40 - 1);
    expect(["projectile", "dash"]).toContain(r.H.windup!.kind);
  });
  it("Difícil (full) quebra na primeira volta, assim que o tempo de reação passa", () => {
    const r = run("hard", 1);
    expect(r.firstBreak).toBeGreaterThan(0);
    expect(r.firstBreak).toBeLessThan(10);
  });
  it("Pesadelo (avoid_long): alvo atrás do obstáculo de loop longo → ponto de corte na rota, navegável", () => {
    const c = aiCfg("nightmare"), ai = newHunterAi();
    const s = seen(0, 0, 5, { vx: 4, vz: 0 });
    for (let k = 0; k < 4; k++) think(c, hunter(), ai, percept([s], { t: k / 10, self: { x: 0, z: -7, a: 0 } }), { seed: 1 });
    expect(ai.mode).toBe("chase");
    expect(ai.intercept).not.toBeNull();
    expect(c.grid!.isClear(ai.intercept!.x, ai.intercept!.z)).toBe(true);
    expect(ai.intercept!.x).toBeGreaterThan(0); // à frente do alvo (velocidade +x)
    // com linha livre até o alvo, persegue direto; Difícil nunca corta
    think(c, hunter(), ai, percept([seen(0, 6, -5)], { t: 1, self: { x: 0, z: -7, a: 0 } }), { seed: 1 });
    expect(ai.intercept).toBeNull();
    const hard = aiCfg("hard"), h = newHunterAi();
    for (let k = 0; k < 4; k++) think(hard, hunter(), h, percept([s], { t: k / 10, self: { x: 0, z: -7, a: 0 } }), { seed: 1 });
    expect(h.mode).toBe("chase");
    expect(h.intercept).toBeNull();
  });
});

describe("previsão de projétil (§8.4)", () => {
  const sp = b.hunter.projectile.speed, H = { x: 0, z: 0 };
  const mv = (x: number, z: number, vx: number, vz: number): SeenSurvivor => seen(0, x, z, { vx, vz });
  it("Fácil e Normal (none): mira na posição percebida", () => {
    expect(aimPoint(aiCfg("easy"), H, mv(10, 0, 0, 4))).toEqual({ x: 10, z: 0 });
    expect(aimPoint(normal, H, mv(10, 0, 0, 4))).toEqual({ x: 10, z: 0 });
  });
  it("Difícil (linear): mira onde o alvo estará com a velocidade atual (|mira| = velocidade do projétil × t)", () => {
    const hard = aiCfg("hard");
    const a = aimPoint(hard, H, mv(10, 0, 0, 4));
    const t = Math.sqrt(100 / (sp * sp - 16));
    expect(a.x).toBeCloseTo(10, 10);
    expect(a.z).toBeCloseTo(4 * t, 10);
    expect(Math.hypot(a.x, a.z)).toBeCloseTo(sp * t, 10);
    expect(aimPoint(hard, H, mv(10, 0, 0, 0))).toEqual({ x: 10, z: 0 }); // parado
    expect(aimPoint(hard, H, mv(10, 0, 20, 0))).toEqual({ x: 10, z: 0 }); // foge mais rápido que o projétil
    expect(aimPoint(hard, H, mv(10, 0, 0, 20))).toEqual({ x: 10, z: 0 }); // sem solução (discriminante < 0)
    const toward = aimPoint(hard, H, mv(10, 0, -sp, 0)); // vem na direção do caçador à velocidade do projétil
    expect(toward.x).toBeCloseTo(5, 10);
    expect(aimPoint(hard, H, mv(10, 0, sp, 0))).toEqual({ x: 10, z: 0 }); // foge à mesma velocidade: não alcança
  });
  it("Pesadelo (linear_static): não atira em alvo parado atrás de obstáculo", () => {
    const nm = aiCfg("nightmare"), from = { x: 0, z: -4.6 };
    expect(projectileAllowed(nm, from, mv(0, 4.6, 0, 0))).toBe(false);
    expect(projectileAllowed(nm, from, mv(0, 4.6, 3, 0))).toBe(true); // em movimento
    expect(projectileAllowed(nm, { x: -8, z: 16 }, mv(-8, 24, 0, 0))).toBe(true); // parado, mas à vista
    expect(projectileAllowed(aiCfg("hard"), from, mv(0, 4.6, 0, 0))).toBe(true); // Difícil atira
    expect(aimPoint(nm, H, mv(10, 0, 0, 4)).z).toBeGreaterThan(0); // e prevê como o Difícil
  });
});
