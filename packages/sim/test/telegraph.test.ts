// D-36 (GDD-v0.2 §4.1: "toda habilidade deve ter telegraph de pelo menos 0,4 s"): nos dois cérebros do v1 (basic e
// utility), golpe, dash, projétil e armadilha só saem depois de um preparo visível no estado por pelo menos
// `hunter.telegraph_min`, lido entre passos (como o cliente lê). O protótipo fica intacto (paridade).
import { describe, expect, it } from "vitest";
import { makeConfig, NO_INPUT, step, STEP, type GameState, type SimConfig, type Windup } from "../src/index.ts";
import { aiGame, b, map } from "./ai-helpers.ts";

type Kind = Windup["kind"];
const brains = ["basic", "utility"] as const;

/** cenário que leva o caçador a preparar `kind` (as outras habilidades em recarga longa) e o efeito que se observa */
function scene(c: SimConfig, kind: Kind): { g: GameState; effect: (g: GameState) => boolean } {
  const g = aiGame(c, { x: -8, z: 14 }, Math.PI);
  const H = g.hunter, P = g.survivors[0];
  H.atk = 1e9; H.dash = 1e9; H.projectile = 1e9; H.trap = 1e9;
  const d = { melee: 1.5, dash: 8, projectile: 10, trap: 40 }[kind];
  P.x = -8; P.z = 14 + d;
  if (kind === "trap") { P.x = 25; P.z = 25; }
  if (H.ai) H.ai.patrol = { x: -8, z: 29, gen: -1 }; // utility: patrulha na direção do alvo (fica no cone até reagir)
  if (kind === "melee") H.atk = 0;
  if (kind === "dash") H.dash = 0;
  if (kind === "projectile") H.projectile = 0;
  if (kind === "trap") H.trap = 0;
  const hp0 = P.hp, traps0 = g.traps.length, shots0 = g.projectiles.length;
  const effect = {
    melee: (x: GameState) => x.survivors[0].hp < hp0 || x.hunter.atk > 1,
    dash: (x: GameState) => x.hunter.dashing > 0,
    projectile: (x: GameState) => x.projectiles.length > shots0,
    trap: (x: GameState) => x.traps.length > traps0,
  }[kind];
  return { g, effect };
}

describe("D-36: telegraph ≥ hunter.telegraph_min em toda habilidade do caçador do v1", () => {
  for (const brain of brains) {
    const c = makeConfig(b, map, { ruleset: "v1", hunterBrain: brain, botBrain: "prototype" }); // bots fora (aiGame)
    for (const kind of ["melee", "dash", "projectile", "trap"] as const) {
      it(`${brain} · ${kind}: preparo visível ≥ ${b.hunter.telegraph_min} s antes do efeito`, () => {
        const { g, effect } = scene(c, kind);
        let appear = -1, release = -1, visible = 0;
        for (let i = 0; i < 6 * 60 && release < 0; i++) {
          step(c, g, NO_INPUT);
          const w = g.hunter.windup;
          if (w?.kind === kind) { visible++; if (appear < 0) appear = i; }
          if (appear < 0) expect(effect(g), "efeito antes do preparo").toBe(false);
          if (appear >= 0 && effect(g)) release = i;
        }
        expect(appear, "o preparo apareceu").toBeGreaterThanOrEqual(0);
        expect(release, "o efeito saiu").toBeGreaterThan(appear);
        expect((release - appear) * STEP).toBeGreaterThanOrEqual(b.hunter.telegraph_min - 1e-9);
        expect(visible).toBeGreaterThanOrEqual(Math.round(b.hunter.telegraph_min / STEP)); // ≥ 24 passos a 60 Hz
      });
    }
  }
});
