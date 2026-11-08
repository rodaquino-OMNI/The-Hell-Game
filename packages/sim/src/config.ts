// Monta a configuração da simulação a partir de data/balance.yaml e do mapa.
// Nenhum número de jogo fica na simulação: todos vêm daqui.
import type { Balance, GameMap } from "@thehell/shared";

export type Difficulty = Balance["difficulty"];

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
}

export interface ConfigOptions {
  /** sobrepõe `balance.ruleset` (testes e simulador) */
  ruleset?: Balance["ruleset"];
  /** sobrepõe `balance.difficulty` */
  difficulty?: Difficulty;
}

export function makeConfig(balance: Balance, map: GameMap, opts: ConfigOptions = {}): SimConfig {
  const v1 = (opts.ruleset ?? balance.ruleset) === "v1";
  const difficulty = opts.difficulty ?? balance.difficulty;
  const h = balance.hunter;
  const base = {
    balance, map, v1, difficulty,
    requiredGenerators: map.generators.length,
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
