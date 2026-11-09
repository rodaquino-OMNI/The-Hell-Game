// Dados comuns aos testes da IA do caçador (R3): configs v1 com `hunterBrain: utility` e cenários montados à mão.
// Desde o marco MJ-B a config é a de produção, fixada explicitamente: bots `competent` (sobreponha com `opts`).
import {
  createGame, makeConfig, NO_INPUT, step, type AiTrace, type ClassName, type ConfigOptions, type Difficulty, type GameState,
  type Percept, type PlayerInput, type SeenSurvivor, type SimConfig,
} from "../src/index.ts";
import { balance, map } from "./helpers.ts";

export { balance, map };
export const b = balance;

export function aiCfg(difficulty: Difficulty = "normal", opts: ConfigOptions = {}): SimConfig {
  return makeConfig(balance, map, { ruleset: "v1", hunterBrain: "utility", botBrain: "competent", difficulty, ...opts });
}
export const normal = aiCfg("normal");

/** transições registradas pelo gancho `trace` */
export function traced(difficulty: Difficulty = "normal"): { cfg: SimConfig; log: AiTrace[] } {
  const log: AiTrace[] = [];
  return { cfg: aiCfg(difficulty, { trace: e => log.push(e) }), log };
}

/**
 * Partida v1 com a IA, bots fora, revelação e habilidades do caçador desligadas. Semente 43 = layout de geradores 0
 * (o do topo do mapa). O caçador fica em `h` olhando para `yaw`.
 */
export function aiGame(c: SimConfig = normal, h = { x: -8, z: 16 }, yaw = Math.PI, seed = 43): GameState {
  const g = createGame(c, "Curandeiro", seed);
  for (const s of g.survivors) if (s.bot) s.st = "dead";
  g.reveal = 1e9;
  const H = g.hunter;
  H.x = h.x; H.z = h.z; H.a = yaw;
  H.dash = 1e9; H.projectile = 1e9; H.trap = 1e9;
  const P = g.survivors[0];
  P.x = -20; P.z = 26; // fora de vista (atrás e longe)
  return g;
}

export function play(c: SimConfig, g: GameState, seconds: number, input: Partial<PlayerInput> = {}) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n && !g.over; i++) step(c, g, { ...NO_INPUT, ...input });
}

/** sobrevivente percebido montado à mão */
export function seen(id: number, x: number, z: number, o: Partial<SeenSurvivor> = {}): SeenSurvivor {
  return { id, x, z, cls: "Curandeiro" as ClassName, hp: 100, vx: 0, vz: 0, visible: true, antiTunnel: false, ...o };
}

/** leitura de percepção montada à mão: caçador na origem, sem geradores, sem ruído */
export function percept(survivors: SeenSurvivor[], o: Partial<Percept> = {}): Percept {
  return { t: 10, self: { x: 0, z: 0, a: 0 }, survivors, gens: [], gate: { x: 0, z: -29 }, finalPressure: false, heard: null, gone: [], ...o };
}
