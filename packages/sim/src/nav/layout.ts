// Variação procedural leve (GDD v0.3 §9.3): layouts de geradores, gaiolas e saídas por mapa.
// O índice 0 de cada lista é o mapa de topo, então a combinação (0, 0, 0) devolve o mapa da paridade.
import type { Balance, GameMap, MapExit } from "@thehell/shared";
import { nextRandom } from "../rng.ts";
import type { P2 } from "./geometry.ts";

export interface LayoutChoice {
  generators: number;
  cage: number;
  exit: number;
}

export interface LayoutCounts {
  generators: number;
  cages: number;
  exits: number;
}

/** quantas variações o mapa tem (mapa sem `layouts` = 1 de cada) */
export function layoutCounts(map: GameMap): LayoutCounts {
  const l = map.layouts;
  return { generators: l?.generators.length ?? 1, cages: l?.cages.length ?? 1, exits: l?.exits.length ?? 1 };
}

/** todas as combinações, em ordem fixa (geradores, depois gaiola, depois saída) */
export function allLayoutChoices(map: GameMap): LayoutChoice[] {
  const n = layoutCounts(map);
  const out: LayoutChoice[] = [];
  for (let g = 0; g < n.generators; g++)
    for (let c = 0; c < n.cages; c++)
      for (let e = 0; e < n.exits; e++) out.push({ generators: g, cage: c, exit: e });
  return out;
}

/**
 * Sal fixo (constante técnica, não é número de jogo) para derivar a sub-semente do layout: sem ele, a escolha
 * do layout repetiria o primeiro sorteio da partida feito com a mesma semente (mesmo PRNG mulberry32).
 * Valor: parte fracionária da razão áurea × 2^32, usual para descorrelacionar sementes.
 */
export const LAYOUT_SEED_SALT = 0x9e3779b9;

/**
 * A semente da partida escolhe a combinação (GDD v0.3 §9.3); usa o PRNG da simulação com a sub-semente
 * `seed ^ LAYOUT_SEED_SALT`. createGame não chama esta função: o ruleset "prototype" usa sempre o layout 0.
 */
export function chooseLayout(map: GameMap, seed: number): LayoutChoice {
  const all = allLayoutChoices(map);
  const state = { seed: (seed ^ LAYOUT_SEED_SALT) | 0 };
  return all[Math.floor(nextRandom(state) * all.length)];
}

/** mapa plano com a combinação escolhida nos campos de topo (generators, bonus, cage, gate, exit_z) */
export function resolveLayout(map: GameMap, choice: LayoutChoice): GameMap {
  const l = map.layouts;
  if (!l) {
    if (choice.generators || choice.cage || choice.exit) throw new Error(`mapa ${map.id} não tem layouts`);
    return map;
  }
  const gl = l.generators[choice.generators], cage = l.cages[choice.cage], exit = l.exits[choice.exit];
  if (!gl || !cage || !exit) throw new Error(`combinação fora do mapa ${map.id}: ${JSON.stringify(choice)}`);
  return {
    ...map,
    generators: gl.generators.map(p => [p[0], p[1]] as [number, number]),
    bonus: gl.bonus.map(p => [p[0], p[1]] as [number, number]),
    cage: [cage[0], cage[1]],
    gate: [exit.gate[0], exit.gate[1]],
    exit_z: exit.exit_z,
  };
}

/**
 * Sobrevivente cruzou a linha da saída perto do portão. O lado de fora é o lado do portão em relação
 * a `exit_z` (saída ao norte: z < exit_z, como no protótipo; ao sul: z > exit_z).
 */
export function crossedExit(exit: MapExit, x: number, z: number, halfWidth: number): boolean {
  const side = Math.sign(exit.gate[1] - exit.exit_z) || -1;
  return side * (z - exit.exit_z) > 0 && Math.abs(x - exit.gate[0]) < halfWidth;
}

/**
 * Posições de nascimento dos sobreviventes para n jogadores: a lista explícita `survivor_spawns`
 * (GDD v0.3 §9.4) quando houver; senão a fórmula de createGame (origem + (i − 1) × espaçamento).
 * Se a lista tiver menos de n pontos, devolve só os que existem (o validador acusa a falta).
 */
export function survivorSpawns(map: GameMap, n: number): P2[] {
  if (map.survivor_spawns) return map.survivor_spawns.slice(0, n).map(p => [p[0], p[1]] as P2);
  const { origin, spacing } = map.survivor_spawn;
  return Array.from({ length: n }, (_, i) => [origin[0] + (i - 1) * spacing, origin[1]] as P2);
}

/** a fórmula do protótipo para os primeiros n jogadores (para conferir a lista explícita) */
export function formulaSpawns(map: GameMap, n: number): P2[] {
  return survivorSpawns({ ...map, survivor_spawns: undefined }, n);
}

/** maior tamanho de equipe previsto nos dados (GDD v0.2 §3.5, `generator.by_team_size`) */
export function maxTeamSize(balance: Balance): number {
  return Math.max(...Object.keys(balance.generator.by_team_size).map(Number));
}
