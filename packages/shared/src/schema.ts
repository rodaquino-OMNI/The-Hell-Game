// Schema de data/balance.yaml (GDD v0.3; item G-01). Seções usadas pelo jogo são estritas;
// a seção ainda não implementada (net) passa sem validação
// detalhada até o agente dono implementá-la. nav e maps: item R2 (GDD v0.3 §8.6, §9); ui: item R7 (GDD v0.3 §12);
// audio: item A-1 do V5 (GDD v0.3 §11).
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

/** simulador e porta de regressão (GDD v0.3 C-15, D-05 a, D-16 a; GDD v0.2 §7.6; item R5) */
/** tolerância null = "a medir" (ruído ainda não medível; a métrica não é comparada) */
const simTol = { max_worsening: pos.nullable(), pooled_max_worsening: pos.nullable().optional(), min_samples: z.number().int().positive().optional() };
const simMetric = z.discriminatedUnion("worse", [
  z.object({ worse: z.enum(["higher", "lower"]), ...simTol }).strict(),
  z.object({ worse: z.literal("band"), band: range.refine(r => r[1] >= r[0], "banda: máx deve ser ≥ mín"), ...simTol }).strict(),
]);
const SimSchema = z.object({
  short_match_seconds: pos.positive(),
  check: z.object({
    matches_per_group: z.number().int().positive(), seed: z.number().int(),
    difficulties: z.array(z.enum(["easy", "normal", "hard", "nightmare"])).min(1),
  }).strict(),
  nightly: z.object({ matches_per_group: z.number().int().positive() }).strict(),
  /** métricas de tools/sim/metrics.ts (METRICS); as ausentes aqui só são medidas */
  regression: z.object({
    hunter_win: simMetric, survivor_escape: simMetric, duration_mean: simMetric, duration_median: simMetric,
    captures_per_match: simMetric, short_match_rate: simMetric, chase_median: simMetric, chases_per_match: simMetric,
  }).partial().strict(),
}).strict();

/** ganho linear de barramento: 0 (mudo) a 1 (sem atenuação) */
const gain01 = num.min(0).max(1);
/** GDD v0.3 §11 (música em camadas, vozes, oclusão, mixagem) e GDD v0.2 §11; barramentos e rampa: item A-1 do V5 */
const AudioSchema = z.object({
  music: z.object({
    // GDD-v0.2 §11: 3 a 5 stems; cada um é um estado musical do A-2 (GDD-v0.3 §11), sem repetição
    stems: z.array(z.enum(["ambient", "tension", "chase", "final_pressure", "rescue"])).min(3).max(5)
      .refine(a => new Set(a).size === a.length, "stems repetidos"),
    tension_radius: pos.positive(), crossfade_bars: pos,
    /** A-2: andamento e compasso (decisão do Rodrigo, 09/11/2026) e tom lido pelo A-3 */
    bpm: pos.positive(), beats_per_bar: z.number().int().positive(), key: z.string().min(1),
    layer_gain: gain01, duck_attack: pos.positive(), duck_release: pos.positive(), start_lead: pos,
  }).strict(),
  max_voices: z.number().int().positive(),
  occlusion_lowpass_hz: pos.positive(),
  loudness_lufs: z.number().max(0), loudness_tolerance: pos, true_peak_dbtp: z.number().max(0),
  ducking_db: z.number().max(0),
  buses: z.object({ master: gain01, music: gain01, sfx: gain01, voice: gain01, ui: gain01 }).strict(),
  volume_ramp_tc: pos.positive(), volume_persist_delay: pos,
  /** A-4: prioridade por tipo de voz (maior = mais importante) */
  voice_priority: z.record(z.string().regex(/^[a-z_]+$/), int.nonnegative())
    .refine(r => Object.keys(r).length > 0, "voice_priority vazio"),
  /** A-4: PannerNode por voz (GDD v0.3 §11: HRTF) */
  panner: z.object({
    panning_model: z.literal("HRTF"), distance_model: z.enum(["linear", "inverse", "exponential"]),
    ref_distance: pos.positive(), max_distance: pos.positive(), rolloff_factor: pos,
  }).strict().refine(p => p.max_distance > p.ref_distance, "panner.max_distance deve passar de ref_distance"),
  occlusion_ramp_tc: pos.positive(), source_height: pos,
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
/** nome de token de data/art/palette.json (a existência é conferida em packages/shared/test/render-layers.test.ts) */
const token = z.string().regex(/^[a-z_]+\.[a-z_]+$/);
const minMax = z.tuple([z.number().int().positive(), z.number().int().positive()]);

/** token com grupo e subgrupo (world.industrial.parede); a existência é conferida em packages/shared/test/retro.test.ts */
const token3 = z.string().regex(/^[a-z_]+(\.[a-z0-9_]+)+$/);
const V3n = z.tuple([num, num, num]);
/** faixa [mín, máx] de opacidade (0..1) e de pixels (inteiros ≥ 1) */
const unitRange = z.tuple([unit, unit]).refine(r => r[1] >= r[0], "faixa: máx deve ser ≥ mín");
const pxRange = z.tuple([z.number().int().positive(), z.number().int().positive()]).refine(r => r[1] > r[0], "faixa: máx deve ser > mín");
/**
 * mockup do modo "Retro FPS" (D-13, D-14, D-15 em docs/plano-construcao.md §7; V9 em docs/handoff/plano-fases-1-2.md
 * §5): balanço e ferramenta da classe na mão (D-13) e variante industrial do Pátio (D-15). Só com `?retro=1`.
 */
const retro = z.object({
  bob: unit, bob_amplitude: z.tuple([pos, pos]), bob_stride: num.positive(), bob_return: unit,
  viewmodel: z.object({
    fov: num.positive().max(150),
    far: num.positive(),
    light: z.object({ ambient: token3, ambient_intensity: pos, key: token3, key_intensity: pos, key_pos: V3n }).strict(),
    hand: z.object({ size: z.tuple([num.positive(), num.positive(), num.positive()]), forearm: z.tuple([num.positive(), num.positive()]), forearm_sides: z.number().int().min(3) }).strict(),
    classes: z.record(
      z.enum(["curandeiro", "mecanico", "atacador", "protetor", "batedor"]),
      z.object({
        grupos: z.array(z.object({ osso: z.string().min(1), cores: z.array(token3).optional(), origem: V3n, pos: V3n, rot: V3n, escala: num.positive() }).strict()).min(1),
        maos: z.array(z.object({ pos: V3n, rot: V3n, antebraco: V3n }).strict()),
      }).strict(),
    ),
  }).strict(),
  industrial: z.object({
    texture: z.number().int().min(16).max(256),
    wall: z.object({
      base: token3, edge: token3, seam: token3, stripe_color: token3, plates: z.number().int().positive(), edge_alpha: unit,
      rivet: z.tuple([z.number().int().positive(), z.number().int().positive()]),
      rivet_step: z.number().int().positive(), rivet_inset: z.number().int().nonnegative(), stripe: z.number().int().nonnegative(),
      stripe_period: z.number().int().positive(), grime: z.number().int().nonnegative(), grime_alpha: unitRange, grime_drip: pxRange,
    }).strict(),
    floor: z.object({
      base: token3, seam: token3, fleck: token3, flecks: z.number().int().nonnegative(), fleck_alpha: unitRange,
      stains: z.number().int().nonnegative(), stain_alpha: unitRange, stain_size: z.number().int().positive(),
    }).strict(),
    ambient: token3, ambient_intensity: pos, bake_color: token3, bake_intensity: pos,
    lamp_token: token3, lamp_spacing: num.positive(), lamp_offset: pos, lamp_size: z.tuple([num.positive(), num.positive(), num.positive()]),
  }).strict(),
}).strict();

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
  layer_a: z.object({
    grain: unit, grain_amount: pos, grain_fps: num.positive(),
    vignette: unit, vignette_radius: range.refine(r => r[1] > r[0], "vignette_radius: fim deve ser maior que início"), vignette_amount: unit,
    scanlines: unit, scanline_amount: unit,
    aberration: unit, aberration_px: pos, aberration_time: num.positive(),
    bloom: unit, bloom_radius_px: z.number().int().min(1).max(8), bloom_amount: pos,
    lut: unit, lut_size: z.number().int().min(2).max(64), lut_tint: token, lut_tint_amount: pos, lut_shadow_pivot: num.positive(),
    lut_gain: z.tuple([pos, pos, pos]), lut_saturation: pos,
  }).strict(),
  reduce_flicker: z.object({ grain: unit, aberration: unit }).strict(),
  layer_b: z.object({
    lantern: z.object({
      color: token, intensity: pos, distance: pos.positive(), decay: pos, angle_deg: num.positive().max(89), penumbra: unit,
      height: pos, forward: pos, side: num, shadow_bias: num,
    }).strict(),
    caster_radius: pos.positive(),
    bake: z.object({ ao_min: unit, ao_radius: pos.positive(), light_color: token, light_intensity: pos, light_radius: pos.positive(), light_height: pos }).strict(),
  }).strict(),
  layer_c: z.object({
    fog_billboards: z.object({
      color: token, count: z.number().int().nonnegative(), size: range, height: range, opacity: unit, drift: pos, drift_speed: pos, near_fade: pos,
    }).strict(),
    dust: z.object({ count: z.number().int().nonnegative(), box: pos.positive(), size_px: pos.positive(), opacity: unit, ambient: unit, color: token, fall: pos, sway: pos }).strict(),
  }).strict(),
  layer_cost_factor: num.min(1),
  legibility: z.object({ min_contrast: num.min(1), body_keep: unit }).strict(),
  /** D-18: contorno do caçador (borda de luz por vértice); intensity de 0 a 1, amount = escala da cor do token */
  hunter_outline: z.object({ intensity: unit, color: token, amount: pos, power: num.positive() }).strict(),
  budgets: z.object({ fps: pos, draw_calls: z.number().int().positive(), triangles: z.number().int().positive(), initial_download_mb: pos, map_download_mb: pos, time_to_play_s: pos }).strict(),
  models: z.object({ survivor_tris: minMax, hunter_tris: minMax, atlas: z.number().int().positive() }).strict(),
  /** V3 (Art Bible §4): padrões de feixe, telegraph dos olhos e cadeado do aliado preso */
  states: z.object({
    beam: z.object({ width: num.positive(), height: num.positive(), min_px: pos, snap: unit }).strict(),
    lamp: z.object({ size: z.tuple([num.positive(), num.positive(), num.positive()]), height: pos }).strict(),
    pending_hz: num.positive(), pending_duty: z.number().gt(0).lt(1), progress_hz: num.positive(), progress_pulse: pos,
    bonus: z.object({
      spiral_hz: pos, spiral_turns: num.positive(), spiral_steps: z.number().int().min(2), spiral_radius: num.positive(),
      spiral_block: num.positive(), diamond: num.positive(),
    }).strict(),
    eyes_flare: z.tuple([num.positive(), num.positive(), pos, pos]),
    lock: z.object({ size: num.positive(), above: pos }).strict(),
  }).strict(),
  retro,
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

/** categorias do resumo de fim de partida (GDD-v0.2 §7.1): Objetivos, Altruísmo, Sobrevivência, Audácia */
const SCORE_CATEGORIES = ["objectives", "altruism", "survival", "boldness"] as const;
const pointEvent = z.object({ value: pos, category: z.enum(SCORE_CATEGORIES), enabled: z.boolean() }).strict();
const hunterPointEvent = z.object({ value: pos, enabled: z.boolean() }).strict();

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
  // pontos por evento (GDD-v0.2 §7.1): valor, categoria do resumo e chave liga/desliga ([Proposta] desligadas)
  points: z.object({
    // LACUNA §7.1 × §7.3: arredondamento de valor × points_mult (o GDD não define)
    rounding: z.enum(["round", "floor"]),
    events: z.object({
      puzzle: pointEvent, generator: pointEvent, bonus_puzzle: pointEvent, bonus_generator: pointEvent,
      rescue: pointEvent,
      heal: pointEvent.extend({ min_effective: pos }).strict(), // "curar aliado (efetivo ≥ 20)"
      block_bolt: pointEvent, stun: pointEvent,
      chase_escape: pointEvent.extend({ min_time: pos }).strict(), // "fugir de perseguição por mais de 15 s"
      trap_disarm: pointEvent, escape: pointEvent,
    }).strict(),
    // pontos do caçador (§7.1, sem categoria no GDD)
    hunter_events: z.object({
      capture: hunterPointEvent, hit: hunterPointEvent, kill: hunterPointEvent,
      long_chase: hunterPointEvent.extend({ min_time: pos }).strict(), reveal: hunterPointEvent, deny_rescue: hunterPointEvent,
    }).strict(),
  }).strict(),
  // GDD-v0.2 §7.2 e GDD-v0.3 D-04; win_coins_to: quem leva o bônus de vitória (alive = decisão do Rodrigo 09/11/2026, pergunta 1 da sessão Visual; diverge da leitura literal do GDD v0.3 §3.3 item 1)
  economy: z.object({ start_coins: pos, base_coins: pos, win_coins: pos, points_to_coins: pos, win_coins_to: z.enum(["alive", "escaped"]) }).strict(),
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
    target_switch_margin: pos, isolated_radius: pos, protected_radius: pos, // §8.3
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
  audio: AudioSchema,
  ui: UiSchema,
  net: z.record(z.string(), z.unknown()),
  sim: SimSchema,
  /** laço do cliente: passo fixo (GDD-v0.3 §13.3) com tetos por quadro */
  client: z.object({ max_frame_dt: num.positive(), max_steps_per_frame: z.number().int().positive() }).strict(),
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
