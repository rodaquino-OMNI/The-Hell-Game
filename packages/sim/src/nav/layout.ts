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

/** flags de mapa do ruleset v1 (`maps.v1`, item R7-mapas) */
export type MapFlags = Balance["maps"]["v1"];

/**
 * Mapa efetivo do ruleset v1 (item R7-mapas): aplica os acréscimos de `map.v1` cujas flags `maps.v1.*` estão ligadas.
 * - short_loop_pillars (D-23): `v1.pillars` entram em `walls` (depois das caixas do topo) e `v1.short_loops` em `loops`;
 * - side_exit (D-25): `layouts.exits[v1.side_exit.replaces]` vira a saída lateral (portão + linha x = exit_x);
 * - fifth_generator (D-22): cada layout de geradores ganha `large_team` (obrigatórios para a maior equipe).
 * Sem flag ligada (ou mapa sem `v1`) devolve um mapa com os mesmos campos do topo, sem o bloco `v1`. O protótipo não
 * chama esta função (makeConfig usa o mapa de topo), então o layout 0 do protótipo não muda.
 */
export function mapForV1(map: GameMap, flags: MapFlags): GameMap {
  const { v1: extra, ...base } = map;
  if (!extra) return map;
  const out: GameMap = { ...base };
  if (flags.short_loop_pillars && extra.pillars?.length) {
    out.walls = [...map.walls, ...extra.pillars.map(w => [w[0], w[1], w[2], w[3]] as [number, number, number, number])];
    out.loops = [...(map.loops ?? []), ...(extra.short_loops ?? [])];
  }
  if (map.layouts && ((flags.side_exit && extra.side_exit) || (flags.fifth_generator && extra.large_team_generators))) {
    const l = map.layouts, se = flags.side_exit ? extra.side_exit : undefined;
    const big = flags.fifth_generator ? extra.large_team_generators : undefined;
    out.layouts = {
      ...l,
      generators: big ? l.generators.map((g, i) => ({ ...g, large_team: big[i].map(p => [p[0], p[1]] as [number, number]) })) : l.generators,
      exits: se ? l.exits.map((e, i) => (i === se.replaces ? { gate: [se.gate[0], se.gate[1]] as [number, number], exit_x: se.exit_x } : e)) : l.exits,
    };
  }
  return out;
}

/**
 * Mapa plano com a combinação escolhida nos campos de topo (generators, bonus, cage, gate, exit_z ou exit_x).
 * `required` (D-22, `generator.by_team_size[n].required`): se passar do número de obrigatórios do layout e o layout
 * tiver `large_team` com obrigatórios suficientes, usa essa lista.
 */
export function resolveLayout(map: GameMap, choice: LayoutChoice, required = 0): GameMap {
  const l = map.layouts;
  if (!l) {
    if (choice.generators || choice.cage || choice.exit) throw new Error(`mapa ${map.id} não tem layouts`);
    return map;
  }
  const gl = l.generators[choice.generators], cage = l.cages[choice.cage], exit = l.exits[choice.exit];
  if (!gl || !cage || !exit) throw new Error(`combinação fora do mapa ${map.id}: ${JSON.stringify(choice)}`);
  const gens = required > gl.generators.length && gl.large_team && gl.large_team.length >= required ? gl.large_team : gl.generators;
  const out: GameMap = {
    ...map,
    generators: gens.map(p => [p[0], p[1]] as [number, number]),
    bonus: gl.bonus.map(p => [p[0], p[1]] as [number, number]),
    cage: [cage[0], cage[1]],
    gate: [exit.gate[0], exit.gate[1]],
  };
  // a linha da saída escolhida substitui a do topo (exatamente uma entre exit_z e exit_x)
  delete out.exit_z; delete out.exit_x;
  if (exit.exit_x !== undefined) out.exit_x = exit.exit_x; else out.exit_z = exit.exit_z;
  return out;
}

/**
 * Vetor unitário do portão para fora do mapa (lado de fora da linha da saída), para o cliente girar o portão:
 * saída lateral {x: ±1, z: 0} pelo sinal de gate.x − exit_x; norte/sul {x: 0, z: ±1} pelo sinal de gate.z − exit_z.
 * Portão sobre a linha (sinal 0) segue crossedExit: oeste (−1) ou norte (−1).
 */
export function gateFacing(exit: Pick<MapExit, "gate" | "exit_x" | "exit_z">): { x: number; z: number } {
  if (exit.exit_x !== undefined) return { x: Math.sign(exit.gate[0] - exit.exit_x) || -1, z: 0 };
  if (exit.exit_z === undefined) throw new Error("saída sem exit_z nem exit_x");
  return { x: 0, z: Math.sign(exit.gate[1] - exit.exit_z) || -1 };
}

/**
 * Sobrevivente cruzou a linha da saída perto do portão. O lado de fora é o lado do portão em relação à linha:
 * parede norte/sul, linha z = exit_z (norte: z < exit_z, como no protótipo; sul: z > exit_z); parede lateral (D-25),
 * linha x = exit_x (oeste: x < exit_x; leste: x > exit_x), com a meia-largura medida em z a partir do portão.
 */
export function crossedExit(exit: MapExit, x: number, z: number, halfWidth: number): boolean {
  if (exit.exit_x !== undefined) {
    // portão exatamente sobre a linha (sinal 0): vale o lado oeste (−1), como o norte (−1) na regra de exit_z; os mapas
    // válidos sempre põem o portão fora da linha
    const side = Math.sign(exit.gate[0] - exit.exit_x) || -1;
    return side * (x - exit.exit_x) > 0 && Math.abs(z - exit.gate[1]) < halfWidth;
  }
  const ez = exit.exit_z;
  if (ez === undefined) throw new Error("saída sem exit_z nem exit_x");
  // portão sobre a linha (sinal 0): vale o norte (z < exit_z), a saída do protótipo
  const side = Math.sign(exit.gate[1] - ez) || -1;
  return side * (z - ez) > 0 && Math.abs(x - exit.gate[0]) < halfWidth;
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
