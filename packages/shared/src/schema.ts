// Schema de data/balance.yaml (GDD v0.3; item G-01). Seções usadas pelo jogo são estritas;
// as seções ainda não implementadas (ai, nav, maps, render, audio, ui, net) passam sem validação
// detalhada até o agente dono implementá-las.
import { z } from "zod";

const num = z.number().finite();
const pos = num.nonnegative();
const range = z.tuple([num, num]);
const vec = z.tuple([num, num]);

const difficulty = z.object({
  hunter_hp: pos, chase: pos, melee_cd: pos, detect: pos, reveal: pos, cage: pos, gate: pos,
  zone_mult: pos, projectile_dmg: pos, trap_interval: pos, points_mult: pos,
}).strict();

export const BalanceSchema = z.object({
  version: z.string(),
  difficulty: z.enum(["easy", "normal", "hard", "nightmare"]),
  ruleset: z.enum(["prototype", "v1"]),
  survivor: z.object({
    hp: pos, walk: pos, run: pos,
    stamina: z.object({ max: pos, drain: pos, regen: pos, regen_puzzle: pos }).strict(),
    bot: z.object({ walk: pos, flee: pos, puzzle_time: pos }).strict(),
    radius: pos, bot_radius: pos, height: pos,
  }).strict(),
  hunter: z.object({
    hp_base: pos, chase_speed: pos, patrol_speed: pos, final_pressure_speed_mult: pos,
    melee: z.object({ range: pos, cooldown: pos, damage: pos, damage_final: pos, recoil: pos }).strict(),
    detect_radius: pos, vision_fov_deg: pos,
    reveal: z.object({ interval: pos, targets: z.number().int().positive(), duration: pos }).strict(),
    puzzle_fail_alert: pos,
    dash: z.object({ speed: pos, duration: pos, cooldown: pos, min: pos, max: pos }).strict(),
    projectile: z.object({ speed: pos, damage: pos, cooldown: pos, min: pos, max: pos }).strict(),
    trap: z.object({ interval: pos, radius: pos, slow: pos, slow_time: pos }).strict(),
    telegraph_min: pos, anti_tunnel: pos, radius: pos, height: pos,
  }).strict(),
  hunter_hp_scale: z.record(z.string(), pos),
  cage: z.object({ time: pos, rescue_time: pos, rescue_range: pos, rescue_hp: pos, immunity: pos, deaths_at_capture: z.number().int().positive() }).strict(),
  generator: z.object({
    puzzles_per_generator: z.number().int().positive(), gate_time: pos, fails_to_regress: z.number().int().positive(),
    fail_spark_time: pos, completed_reveal: pos,
    by_team_size: z.record(z.string(), z.object({ required: z.number().int().positive(), bonus: z.number().int().nonnegative() }).strict()),
    puzzle_time_target: z.object({ full: range, solo: range }).strict(),
  }).strict(),
  puzzles: z.object({
    timing: z.object({ speed: pos, zone: pos }).strict(),
    sequence: z.object({ length: z.number().int().positive() }).strict(),
    accessible: z.object({ zone_mult: pos, timed: z.boolean() }).strict(),
  }).strict(),
  noise: z.record(z.string(), pos),
  points: z.object({ puzzle: pos, generator: pos, bonus_puzzle: pos, bonus_generator: pos }).strict(),
  economy: z.object({ start_coins: pos, base_coins: pos, win_coins: pos, points_to_coins: pos }).strict(),
  skins: z.record(z.string(), pos),
  classes: z.object({
    healer: z.object({ pulse_heal: pos, pulse_radius: pos, cooldown: pos }).strict(),
    mechanic: z.object({
      turbo: z.object({ cooldown: pos, range: pos }).strict(),
      bolt: z.object({ damage: pos, slow: pos, slow_time: pos, cooldown: pos, range: pos }).strict(),
      puzzle_zone: pos, bot_puzzle_time: pos,
    }).strict(),
    fighter: z.object({
      strike: z.object({ damage: pos, stun: pos, cooldown: pos, range: pos }).strict(),
      block: z.object({ time: pos, cooldown: pos }).strict(),
    }).strict(),
    repeat_penalty: z.object({ cooldown_base: pos, effect_step: pos }).strict(),
    upgrade_caps: z.object({ min_cooldown_mult: pos, max_effect_mult: pos }).strict(),
  }).strict(),
  difficulty_table: z.object({ easy: difficulty, normal: difficulty, hard: difficulty, nightmare: difficulty }).strict(),
  prototype_extras: z.object({
    interact_range: z.object({ generator: pos, trap: pos }).strict(),
    camera: z.object({ fov: pos, shoulder: pos, distance: pos, height: pos, wall_step: pos }).strict(),
    heartbeat: z.object({ radius: pos, base_interval: pos, range_interval: pos }).strict(),
    vignette_radius: pos,
    mechanic_bot_trap_immune: z.boolean(),
    bolt_aim_cos: num,
    fighter_strike_cd_on_miss: z.boolean(),
    projectile_life: pos,
    gate_exit_half_width: pos,
    chase_speed: pos,
    hunter_initial: z.object({ dash: pos, projectile: pos, trap: pos, reveal: pos }).strict(),
    patrol: z.object({ range: pos, reach: pos }).strict(),
    projectile_hit_radius: pos,
    sidestep: z.object({ time: pos, angle: num, min_progress: pos }).strict(),
    cage_slot_spacing: pos,
    rescued_offset: num,
    stamina_min_to_run: pos,
    bot: z.object({
      heal_threshold: pos, mechanic_bolt_dist: pos, fighter_block_dist: pos, fighter_engage_dist: pos,
      fighter_chase_stunned_dist: pos, fighter_strike_dist: pos, flee_dist: pos, rescue_min_hunter_dist: pos,
      reach: pos, gate_speed: pos, wait_point: vec, wait_reach: pos,
    }).strict(),
  }).strict(),
  match: z.object({ prep_time: range, hunter_spawn_min_dist: pos, hard_time_limit: pos, team_min_escapes: z.number().int().positive() }).strict(),
  // seções ainda não implementadas: validação detalhada quando o agente dono começar
  ai: z.record(z.string(), z.unknown()),
  nav: z.record(z.string(), z.unknown()),
  maps: z.record(z.string(), z.unknown()),
  render: z.record(z.string(), z.unknown()),
  audio: z.record(z.string(), z.unknown()),
  ui: z.record(z.string(), z.unknown()),
  net: z.record(z.string(), z.unknown()),
}).strict();

export type Balance = z.infer<typeof BalanceSchema>;

export const MapSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: vec,
  wall_height: pos,
  /** caixas [x, z, largura, profundidade] */
  walls: z.array(z.tuple([num, num, pos, pos])),
  generators: z.array(vec),
  bonus: z.array(vec),
  cage: vec,
  gate: vec,
  exit_z: num,
  survivor_spawn: z.object({ origin: vec, spacing: pos }).strict(),
  hunter_spawn: vec,
}).strict();
export type GameMap = z.infer<typeof MapSchema>;
