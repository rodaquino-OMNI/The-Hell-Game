// Monta a configuração da simulação a partir de data/balance.yaml e do mapa.
// Nenhum número de jogo fica na simulação: todos vêm daqui.
import type { Balance, GameMap } from "@thehell/shared";
import { gridFromMap, type GridNav, type NavQuery } from "./nav/grid.ts";

export type Difficulty = Balance["difficulty"];
export type HunterBrain = Balance["ai"]["hunter_brain"];
export type BotBrain = Balance["ai"]["bot_brain"];
export type AiDifficulty = Balance["ai"]["by_difficulty"]["normal"];

/** transição de estado do caçador (GDD-v0.3 §8.2), para o log do simulador */
export interface AiTrace { t: number; from: string; to: string }

export interface SimConfig {
  balance: Balance;
  map: GameMap;
  /** true com `ruleset: v1` (regras do GDD v0.3); false reproduz o protótipo (paridade da fase 0) */
  v1: boolean;
  difficulty: Difficulty;
  /** velocidade de perseguição efetiva: ruleset "prototype" usa o valor do protótipo (paridade da fase 0) */
  chaseSpeed: number;
  requiredGenerators: number;
  // Valores efetivos da tabela de dificuldade (GDD-v0.2 §7.3). No ruleset "prototype" valem os do protótipo (§2.3).
  meleeCooldown: number;
  /** raio de detecção (no v1, alcance do cone de visão; GDD-v0.3 §8.1) */
  detectRadius: number;
  revealInterval: number;
  cageTime: number;
  gateTime: number;
  /** multiplicador da zona de acerto do quebra-cabeça de timing */
  zoneMult: number;
  projectileDamage: number;
  trapInterval: number;
  pointsMult: number;
  /** caçador do v1: "basic" (R1) ou "utility" (IA do R3, GDD-v0.3 §8). No protótipo é sempre "basic". */
  brain: HunterBrain;
  /** bots aliados do v1: "prototype" (updateBot, paridade) ou "competent" (ai/bots.ts, R4; GDD-v0.3 §8.5). No protótipo é sempre "prototype". */
  botBrain: BotBrain;
  /** parâmetros da IA na dificuldade (GDD-v0.3 §8.4) */
  aiLevel: AiDifficulty;
  /**
   * grade A* de reserva do mapa (`nav.fallback_grid`, o maior raio entre `hunter.radius` e `survivor.bot_radius`, a
   * grade é comum ao caçador e aos bots): projeção de pontos e linha livre. Só com a IA do caçador ou com os bots
   * competentes.
   */
  grid: GridNav | null;
  /** consulta de caminho da IA: o navmesh injetado (RecastNav) ou a própria grade. Não é serializável e não entra no estado. */
  nav: NavQuery | null;
  /**
   * gancho opcional: o caçador trocou de alvo perseguido (visto ou lembrado) sem sair da perseguição. Só observa; o
   * simulador encerra aí o episódio de perseguição (métrica do §8.5)
   */
  traceTarget?: (e: { t: number; target: number }) => void;
  /** gancho opcional chamado a cada transição de estado do caçador (simulador, testes) */
  trace?: (e: AiTrace) => void;
}

export interface ConfigOptions {
  /** sobrepõe `balance.ruleset` (testes e simulador) */
  ruleset?: Balance["ruleset"];
  /** sobrepõe `balance.difficulty` */
  difficulty?: Difficulty;
  /** sobrepõe `ai.hunter_brain` (só vale no v1) */
  hunterBrain?: HunterBrain;
  /** sobrepõe `ai.bot_brain` (só vale no v1) */
  botBrain?: BotBrain;
  /** navmesh para a IA (ex.: RecastNav de "@thehell/sim/nav/recast"); sem isto, a grade A* de reserva (GDD-v0.3 §8.6) */
  nav?: NavQuery;
  trace?: (e: AiTrace) => void;
}

export function makeConfig(balance: Balance, map: GameMap, opts: ConfigOptions = {}): SimConfig {
  const v1 = (opts.ruleset ?? balance.ruleset) === "v1";
  const difficulty = opts.difficulty ?? balance.difficulty;
  const h = balance.hunter;
  const brain: HunterBrain = v1 ? opts.hunterBrain ?? balance.ai.hunter_brain : "basic";
  const botBrain: BotBrain = v1 ? opts.botBrain ?? balance.ai.bot_brain : "prototype";
  const grid = brain === "utility" || botBrain === "competent" ? gridFromMap(map, balance, Math.max(h.radius, balance.survivor.bot_radius)) : null;
  const base = {
    balance, map, v1, difficulty,
    requiredGenerators: map.generators.length,
    brain, botBrain, aiLevel: balance.ai.by_difficulty[difficulty], grid, nav: grid ? opts.nav ?? grid : null, trace: opts.trace,
  };
  if (!v1) {
    return {
      ...base,
      chaseSpeed: balance.prototype_extras.chase_speed,
      meleeCooldown: h.melee.cooldown, detectRadius: h.detect_radius, revealInterval: h.reveal.interval,
      cageTime: balance.cage.time, gateTime: balance.generator.gate_time, zoneMult: 1,
      projectileDamage: h.projectile.damage, trapInterval: h.trap.interval, pointsMult: 1,
    };
  }
  // ruleset v1: tabela de dificuldade inteira (GDD-v0.2 §7.3; perseguição escalada pela D-03 b, GDD-v0.3 C-07)
  const d = balance.difficulty_table[difficulty];
  return {
    ...base,
    chaseSpeed: d.chase,
    meleeCooldown: d.melee_cd, detectRadius: d.detect, revealInterval: d.reveal,
    cageTime: d.cage, gateTime: d.gate, zoneMult: d.zone_mult,
    projectileDamage: d.projectile_dmg, trapInterval: d.trap_interval, pointsMult: d.points_mult,
  };
}

/**
 * Vida do caçador. Protótipo: `hunter.hp_base` (80). v1: `difficulty_table[dif].hunter_hp × hunter_hp_scale[n]`
 * (GDD-v0.3 C-03). Falha se não houver fator para `n` sobreviventes.
 */
export function hunterMaxHp(cfg: SimConfig, survivors: number): number {
  const b = cfg.balance;
  if (!cfg.v1) return b.hunter.hp_base;
  const scale = b.hunter_hp_scale[String(survivors)];
  if (scale === undefined) throw new Error(`hunter_hp_scale sem fator para ${survivors} sobreviventes`);
  return b.difficulty_table[cfg.difficulty].hunter_hp * scale;
}
