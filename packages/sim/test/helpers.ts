import { fileURLToPath } from "node:url";
import type { Balance } from "@thehell/shared";
import { loadBalanceFile, loadMapFile } from "@thehell/shared/node";
import { createGame, makeConfig, NO_INPUT, step, type ClassName, type GameState, type PlayerInput, type SimConfig } from "../src/index.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
export const balance = loadBalanceFile(root + "data/balance.yaml");
export const map = loadMapFile(root + "data/maps/patio.json");
// Paridade com o protótipo (parity.test.ts, determinism.test.ts): desde o MJ-B o padrão dos dados é `ruleset: v1`,
// então a config do protótipo é fixada explicitamente aqui.
export const cfg: SimConfig = makeConfig(balance, map, { ruleset: "prototype" });

/** partida com o caçador neutralizado e afastado, para medir uma regra isolada */
export function quietGame(cls: ClassName = "Curandeiro", seed = 1): GameState {
  const g = createGame(cfg, cls, seed);
  g.hunter.stun = 1e9;
  g.hunter.x = 25; g.hunter.z = 25;
  for (const s of g.survivors) if (s.bot) s.st = "dead";
  g.reveal = 1e9;
  return g;
}

export function run(g: GameState, seconds: number, input: Partial<PlayerInput> = {}, c: SimConfig = cfg) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) step(c, g, { ...NO_INPUT, ...input });
}

export function tap(g: GameState, input: Partial<PlayerInput>, c: SimConfig = cfg) {
  step(c, g, { ...NO_INPUT, ...input });
}

/** posiciona o jogador num ponto aberto do mapa (sem paredes por perto) */
export const SPOT = { x: -8, z: 26 };
export function openSpot(g: GameState) { const p = g.survivors[0]; p.x = SPOT.x; p.z = SPOT.z; p.a = 0; }

/** balanço com as flags de mapa do v1 (`maps.v1`, item R7-mapas) sobrepostas */
export function withMapFlags(base: Balance, flags: Partial<Balance["maps"]["v1"]>): Balance {
  return { ...base, maps: { ...base.maps, v1: { ...base.maps.v1, ...flags } } };
}

/** todas as flags de mapa do v1 desligadas: o v1 com o mapa de topo (como antes do R7-mapas) */
export const NO_MAP_FLAGS = { fifth_generator: false, short_loop_pillars: false, side_exit: false } as const;

/** ponto a `d` m além da linha da saída da partida, na frente do portão (norte/sul: exitZ; lateral: exitX) */
export function outsideExit(g: GameState, d = 1): { x: number; z: number } {
  const { gate, exitX, exitZ } = g.arena;
  if (exitX !== undefined) return { x: exitX + (gate.x < exitX ? -d : d), z: gate.z };
  return { x: gate.x, z: exitZ! + (gate.z < exitZ! ? -d : d) };
}
