// Schema de data/balance.yaml (GDD v0.3; item G-01). Seções usadas pelo jogo são estritas;
// as seções ainda não implementadas (ai, nav, maps, audio, ui, net) passam sem validação
// detalhada até o agente dono implementá-las.
import { z } from "zod";

const num = z.number().finite();
const pos = num.nonnegative();
const range = z.tuple([num, num]);
const vec = z.tuple([num, num]);

const unit = num.min(0).max(1);
const preset = z.object({ internal: z.tuple([z.number().int().positive(), z.number().int().positive()]), layers: z.array(z.enum(["A", "B", "C"])), shadows: z.boolean() }).strict();
const minMax = z.tuple([z.number().int().positive(), z.number().int().positive()]);

/** render (GDD-v0.3 §10.1, §10.2, §10.6): presets de resolução interna, intensidades PS1 de 0 a 1, névoa e orçamentos */
const render = z.object({
  default_preset: z.enum(["low", "medium", "high"]),
  presets: z.object({ low: preset, medium: preset, high: preset }).strict(),
  ps1: z.object({
    snap: unit, snap_grid: z.number().int().positive(), affine: unit, gouraud: unit, dither: unit,
    color_bits: z.number().int().min(1).max(8),
  }).strict(),
  tessellate: num.positive(),
  fog: z.object({ near: pos, far: pos }).strict().refine(f => f.far > f.near, "render.fog: far deve ser maior que near"),
  camera: z.object({ near: num.positive(), far: num.positive(), eye_height: pos }).strict().refine(c => c.far > c.near, "render.camera: far deve ser maior que near"),
  lights: z.object({ ambient: pos, player: pos, player_decay: pos, player_height: pos }).strict(),
  player_light_radius: pos,
  anim_fps: num.positive(),
  shadow_map: z.number().int().positive(),
  budgets: z.object({ fps: pos, draw_calls: z.number().int().positive(), triangles: z.number().int().positive(), initial_download_mb: pos, map_download_mb: pos, time_to_play_s: pos }).strict(),
  models: z.object({ survivor_tris: minMax, hunter_tris: minMax, atlas: z.number().int().positive() }).strict(),
}).strict();

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
    regress_amount: z.number().int().nonnegative(), // GDD-v0.2 §6.2
    fail_spark_time: pos, completed_reveal: pos,
    // LACUNA GDD-v0.2 §3.4 × §6.2: a revelação do gerador completo vale fora do raio de ruído? (padrão conservador: não)
    completed_reveal_global: z.boolean(),
    by_team_size: z.record(z.string(), z.object({ required: z.number().int().positive(), bonus: z.number().int().nonnegative() }).strict()),
    puzzle_time_target: z.object({ full: range, solo: range }).strict(),
  }).strict(),
  puzzles: z.object({
    timing: z.object({ speed: pos, zone: pos }).strict(),
    sequence: z.object({ length: z.number().int().positive() }).strict(),
    accessible: z.object({ zone_mult: pos, timed: z.boolean() }).strict(),
  }).strict(),
  // raios de ruído em metros (GDD-v0.2 §3.4; ruleset v1)
  noise: z.object({ walk: pos, run: pos, puzzle_fail: pos, rescue: pos, heal: pos, generator_done: pos }).strict(),
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
  // ai: só as chaves usadas pelas regras v1 (R1) são validadas; o resto da seção fica para a IA (R3, R4)
  ai: z.looseObject({
    hearing_investigate_time: pos,   // GDD-v0.3 §8.1 (audição)
    by_difficulty: z.object({        // GDD-v0.3 §8.4 / GDD-v0.2 §8.4 (memória da última posição)
      easy: z.looseObject({ memory: pos }), normal: z.looseObject({ memory: pos }),
      hard: z.looseObject({ memory: pos }), nightmare: z.looseObject({ memory: pos }),
    }).strict(),
  }),
  // seções ainda não implementadas: validação detalhada quando o agente dono começar
  nav: z.record(z.string(), z.unknown()),
  maps: z.record(z.string(), z.unknown()),
  render,
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
