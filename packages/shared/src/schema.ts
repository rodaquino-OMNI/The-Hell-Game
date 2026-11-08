// Schema de data/balance.yaml (GDD v0.3; item G-01). Seções usadas pelo jogo são estritas;
// as seções ainda não implementadas (audio, net) passam sem validação
// detalhada até o agente dono implementá-las. nav e maps: item R2 (GDD v0.3 §8.6, §9); ui: item R7 (GDD v0.3 §12).
import { z } from "zod";

const num = z.number().finite();
const pos = num.nonnegative();
const range = z.tuple([num, num]);
const vec = z.tuple([num, num]);
const int = z.number().int();

/** GDD v0.3 §12.1 (HUD), §12.2 (FOV), §12.3 (tutorial), §12.4 (contraste) e §12.5 (idiomas); item R7 */
const UiSchema = z.object({
  threat_radius: pos.positive(), threat_sectors: z.number().int().min(4),
  ping_types: z.array(z.string().regex(/^[a-z_]+$/)).min(1), ping_cooldown: pos, ping_lifetime: pos.positive(),
  fov: z.object({ min: pos, max: pos, default: pos }).strict(),
  tutorial_time: pos, ftue_target_min: pos, min_contrast: z.number().min(1).max(21),
  locales: z.array(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/)).min(1),
}).strict();

/** GDD v0.3 §8.6: parâmetros do navmesh (recast-navigation) e da grade A* de reserva */
const NavSchema = z.object({
  cell_size: pos.positive(), cell_height: pos.positive(), agent_radius: pos.positive(), agent_height: pos.positive(),
  walkable_climb: pos, walkable_slope_deg: pos, fallback_grid: pos.positive(), query_snap: pos,
}).strict();

/** GDD v0.3 §9.1 (métricas do validador) e §9.3 (variação de layouts) */
const MapsSchema = z.object({
  corridor_min: pos.positive(), wall_height: pos, side: range,
  loop_short_perimeter: range, loop_long_perimeter_min: pos, loop_advantage: range,
  loop_coverage_radius: pos, loop_coverage_min: z.number().min(0).max(1),
  hideouts_min: int.nonnegative(), generator_min_dist: pos,
  generator_layouts: z.tuple([int.positive(), int.positive()]), cage_positions: int.positive(), exits: int.positive(),
  layout_hunter_dist_spread_max: pos,
}).strict();

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
  /** V3: distância (m) câmera–jogador abaixo da qual o modelo do jogador some em 3ª pessoa */
  hide_player_within: pos,
  lights: z.object({ ambient: pos, player: pos, player_decay: pos, player_height: pos }).strict(),
  player_light_radius: pos,
  anim_fps: num.positive(),
  shadow_map: z.number().int().positive(),
  budgets: z.object({ fps: pos, draw_calls: z.number().int().positive(), triangles: z.number().int().positive(), initial_download_mb: pos, map_download_mb: pos, time_to_play_s: pos }).strict(),
  models: z.object({ survivor_tris: minMax, hunter_tris: minMax, atlas: z.number().int().positive() }).strict(),
  /** V3 (Art Bible §4): padrões de feixe, telegraph dos olhos e cadeado do aliado preso */
  states: z.object({
    beam: z.object({ width: num.positive(), height: num.positive(), min_px: pos, snap: unit }).strict(),
    lamp: z.object({ size: z.tuple([num.positive(), num.positive(), num.positive()]), height: pos }).strict(),
    pending_hz: num.positive(), progress_hz: num.positive(), progress_pulse: pos,
    bonus: z.object({
      spiral_hz: pos, spiral_turns: num.positive(), spiral_steps: z.number().int().min(2), spiral_radius: num.positive(),
      spiral_block: num.positive(), diamond: num.positive(),
    }).strict(),
    eyes_flare: z.tuple([num.positive(), num.positive()]),
    lock: z.object({ size: num.positive(), above: pos }).strict(),
  }).strict(),
}).strict();

const difficulty = z.object({
  hunter_hp: pos, chase: pos, melee_cd: pos, detect: pos, reveal: pos, cage: pos, gate: pos,
  zone_mult: pos, projectile_dmg: pos, trap_interval: pos, points_mult: pos,
}).strict();

/** GDD-v0.3 §8.4 (valores do GDD-v0.2 §8.4): reação, previsão de projétil, conhecimento de loops e memória */
const aiDifficulty = z.object({
  reaction: pos,
  projectile_lead: z.enum(["none", "linear", "linear_static"]),
  loop_knowledge: z.enum(["none", "partial", "full", "avoid_long"]),
  memory: pos,
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
    /** GDD-v0.3 §8.3: ferido abaixo desta vida (clipe `ferido`, IA) */
    wounded_hp: pos,
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
  // ai: GDD-v0.3 §8 (R1 + R3). Só `bots` (§8.5, item R4) fica sem validação detalhada.
  ai: z.object({
    hunter_brain: z.enum(["basic", "utility"]),
    decision_hz: pos.positive(), perception_hz: pos.positive(), // §8.1
    hearing_investigate_time: pos,                               // §8.1 (audição)
    target_weights: z.object({ proximity: num, generator_progress: num, injured: num, isolated: num, protected: num }).strict(), // §8.3
    target_switch_margin: pos, isolated_radius: pos, protected_radius: pos, injured_hp: pos, // §8.3
    patrol_reach: pos.positive(), search_radius: pos, loop_band: pos, static_target_speed: pos, // técnicos (§8.1, §8.2, §8.4)
    by_difficulty: z.object({ easy: aiDifficulty, normal: aiDifficulty, hard: aiDifficulty, nightmare: aiDifficulty }).strict(), // §8.4
    loop_partial_laps_before_break: z.number().int().nonnegative(), // §8.4
    anti_stuck: z.object({ min_progress_ratio: z.number().min(0).max(1), window: pos.positive() }).strict(), // §8.6
    stuck_fail_after: pos.positive(),                                                                      // §8.6 (T-03)
    bots: z.record(z.string(), z.unknown()),
  }).strict(),
  // seções ainda não implementadas: validação detalhada quando o agente dono começar
  nav: NavSchema,
  maps: MapsSchema,
  render,
  audio: z.record(z.string(), z.unknown()),
  ui: UiSchema,
  net: z.record(z.string(), z.unknown()),
}).strict();

export type Balance = z.infer<typeof BalanceSchema>;

/** saída: portão e linha que o sobrevivente cruza para escapar (lado do portão em relação à linha) */
const ExitSchema = z.object({ gate: vec, exit_z: num }).strict();
/** um layout de geradores (GDD v0.3 §9.3): obrigatórios e bônus */
const GeneratorLayoutSchema = z.object({ generators: z.array(vec).min(1), bonus: z.array(vec) }).strict();
/** loop marcado nos metadados (GDD v0.3 §9.1, §9.4): rota em volta de um obstáculo, polígono fechado */
const LoopSchema = z.object({ id: z.string(), kind: z.enum(["short", "long"]), polygon: z.array(vec).min(3) }).strict();

const sameVec = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const sameVecs = (a: readonly (readonly number[])[], b: readonly (readonly number[])[]) =>
  a.length === b.length && a.every((v, i) => sameVec(v, b[i]));

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
  /**
   * GDD v0.3 §9.4 (spawns): pontos explícitos de nascimento dos sobreviventes, 1 por jogador (até 5, §3.5).
   * Os primeiros repetem a fórmula de survivor_spawn usada pelo protótipo (origem + (i − 1) × espaçamento).
   */
  survivor_spawns: z.array(vec).min(1).optional(),
  hunter_spawn: vec,
  /**
   * GDD v0.3 §9.3: variações escolhidas pela semente. O índice 0 de cada lista é o mapa de topo
   * (generators/bonus, cage, gate/exit_z), para que o layout 0 reproduza o mapa da paridade.
   */
  layouts: z.object({
    generators: z.array(GeneratorLayoutSchema).min(1),
    cages: z.array(vec).min(1),
    exits: z.array(ExitSchema).min(1),
  }).strict().optional(),
  /** GDD v0.3 §9.4: loops (polígono) e esconderijos nos metadados do mapa */
  loops: z.array(LoopSchema).optional(),
  hideouts: z.array(vec).optional(),
}).strict().superRefine((m, ctx) => {
  const l = m.layouts;
  if (!l) return;
  if (!sameVecs(l.generators[0].generators, m.generators) || !sameVecs(l.generators[0].bonus, m.bonus))
    ctx.addIssue({ code: "custom", path: ["layouts", "generators", 0], message: "layout 0 deve repetir generators/bonus do topo" });
  if (!sameVec(l.cages[0], m.cage))
    ctx.addIssue({ code: "custom", path: ["layouts", "cages", 0], message: "gaiola 0 deve repetir cage do topo" });
  if (!sameVec(l.exits[0].gate, m.gate) || l.exits[0].exit_z !== m.exit_z)
    ctx.addIssue({ code: "custom", path: ["layouts", "exits", 0], message: "saída 0 deve repetir gate/exit_z do topo" });
});
export type GameMap = z.infer<typeof MapSchema>;
export type MapExit = z.infer<typeof ExitSchema>;
export type MapLoop = z.infer<typeof LoopSchema>;
export type GeneratorLayout = z.infer<typeof GeneratorLayoutSchema>;
