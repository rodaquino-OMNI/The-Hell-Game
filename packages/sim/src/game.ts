// Simulação da partida: porte fiel de prototype/the-hell.html (L114–L181), determinística.
// Referências "L" apontam para as linhas do protótipo; números vêm de SimConfig (data/balance.yaml).
import type { SimConfig } from "./config.ts";
import { nextRandom } from "./rng.ts";
import {
  ARROWS, CLASSES, type ClassName, type GameEvent, type GameState, type Generator, type Hunter,
  type MsgKey, type PlayerInput, type Survivor, type Vec,
} from "./types.ts";

export const STEP = 1 / 60;

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);

// ---------- criação ----------

export function createGame(cfg: SimConfig, playerClass: ClassName, seed: number): GameState {
  const b = cfg.balance, m = cfg.map, px = b.prototype_extras;
  const order: ClassName[] = [playerClass, ...CLASSES.filter(c => c !== playerClass)];
  const survivors: Survivor[] = order.map((cls, i) => ({
    id: i, cls, bot: i > 0, x: m.survivor_spawn.origin[0] + (i - 1) * m.survivor_spawn.spacing, z: m.survivor_spawn.origin[1],
    hp: b.survivor.hp, st: "ok", cage: 0, captures: 0, cd: 0, atk: 0, block: 0, slow: 0, revealed: 0, immune: 0,
    stamina: b.survivor.stamina.max, a: 0, rescue: 0, work: 0, sidestep: 0, sidestepDir: 1,
  }));
  const gens: Generator[] = [
    ...m.generators.map(([x, z]) => ({ x, z, n: 0, done: false, bonus: false })),
    ...m.bonus.map(([x, z]) => ({ x, z, n: 0, done: false, bonus: true })),
  ];
  const hunter: Hunter = {
    x: m.hunter_spawn[0], z: m.hunter_spawn[1], hp: b.hunter.hp_base, slow: 0, stun: 0, atk: 0,
    dash: px.hunter_initial.dash, dashing: 0, projectile: px.hunter_initial.projectile, trap: px.hunter_initial.trap,
    a: 0, alert: null, alertTime: 0, patrol: null, sidestep: 0, sidestepDir: 1, target: -1,
  };
  return {
    t: 0, seed: seed | 0, points: 0, reveal: px.hunter_initial.reveal, gateTimer: 0, gateStarted: false, gateOpen: false,
    over: false, gens, survivors, hunter, traps: [], projectiles: [], puzzle: null, nextId: 1, events: [],
  };
}

export const player = (g: GameState) => g.survivors[0];

// ---------- colisão (L73–L74) ----------

export function collide(cfg: SimConfig, p: Vec, r: number) {
  for (const [wx, wz, ww, wd] of cfg.map.walls) {
    const dx = p.x - wx, dz = p.z - wz, hx = ww / 2 + r, hz = wd / 2 + r;
    if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
      const px = hx - Math.abs(dx), pz = hz - Math.abs(dz);
      if (px < pz) p.x += Math.sign(dx || 1) * px; else p.z += Math.sign(dz || 1) * pz;
    }
  }
}

export function insideWall(cfg: SimConfig, x: number, z: number) {
  return cfg.map.walls.some(([wx, wz, ww, wd]) => Math.abs(x - wx) < ww / 2 && Math.abs(z - wz) < wd / 2);
}

// ---------- utilidades ----------

const emit = (g: GameState, e: GameEvent) => { g.events.push(e); };
const msg = (g: GameState, key: MsgKey, extra: { n?: number; cls?: ClassName } = {}) => emit(g, { type: "msg", key, ...extra });

/** movimento com desvio lateral ao travar (L129) */
function move(cfg: SimConfig, g: GameState, e: Survivor | Hunter, dx: number, dz: number, speed: number, dt: number) {
  const ss = cfg.balance.prototype_extras.sidestep;
  const k = Math.hypot(dx, dz) || 1;
  if (e.sidestep > 0) {
    e.sidestep -= dt;
    const c = Math.cos(ss.angle * e.sidestepDir), s = Math.sin(ss.angle * e.sidestepDir);
    [dx, dz] = [dx * c - dz * s, dx * s + dz * c];
  }
  const ox = e.x, oz = e.z;
  e.x += (dx / k) * speed * dt;
  e.z += (dz / k) * speed * dt;
  collide(cfg, e, "cls" in e ? cfg.balance.survivor.bot_radius : cfg.balance.hunter.radius);
  if (Math.hypot(e.x - ox, e.z - oz) < speed * dt * ss.min_progress && !(e.sidestep > 0)) {
    e.sidestep = ss.time;
    e.sidestepDir = nextRandom(g) < 0.5 ? 1 : -1;
  }
  e.a = Math.atan2(-dx, -dz);
}

// ---------- quebra-cabeças (L117–L118) ----------

export function openPuzzle(cfg: SimConfig, g: GameState, genIndex: number) {
  const b = cfg.balance, gen = g.gens[genIndex];
  const mech = player(g).cls === "Mecânico";
  const kind = gen.n % 2 ? "sequence" : "timing";
  const zc = 0.2 + nextRandom(g) * 0.6;
  const seq = kind === "sequence" ? Array.from({ length: b.puzzles.sequence.length }, () => ARROWS[(nextRandom(g) * 4) | 0]) : [];
  g.puzzle = {
    gen: genIndex, kind, t: 0, dir: 1, zoneCenter: zc,
    zoneWidth: mech ? b.classes.mechanic.puzzle_zone : b.puzzles.timing.zone, i: 0, seq,
  };
}

function puzzleResult(cfg: SimConfig, g: GameState, ok: boolean) {
  const b = cfg.balance, z = g.puzzle!, gen = g.gens[z.gen];
  if (ok) {
    gen.n++;
    const pp = gen.bonus ? b.points.bonus_puzzle : b.points.puzzle;
    g.points += pp;
    msg(g, "puzzle_points", { n: pp });
    emit(g, { type: "sound", name: "puzzle_ok" });
    if (gen.n >= b.generator.puzzles_per_generator) {
      gen.done = true;
      const bonus = gen.bonus ? b.points.bonus_generator : b.points.generator;
      g.points += bonus;
      g.puzzle = null;
      msg(g, gen.bonus ? "bonus_done" : "gen_done", { n: pp + bonus });
      return;
    }
  } else {
    g.hunter.alert = { x: gen.x, z: gen.z };
    g.hunter.alertTime = b.hunter.puzzle_fail_alert;
    emit(g, { type: "sound", name: "puzzle_fail" });
    msg(g, "spark");
  }
  openPuzzle(cfg, g, z.gen);
}

// ---------- habilidades e ataques (L119–L123) ----------

export function ability(cfg: SimConfig, g: GameState, s: Survivor) {
  const c = cfg.balance.classes;
  if (s.cd > 0 || s.st !== "ok") return;
  if (s.cls === "Curandeiro") {
    for (const a of g.survivors) if (a.st === "ok" && dist(a, s) < c.healer.pulse_radius) a.hp = Math.min(cfg.balance.survivor.hp, a.hp + c.healer.pulse_heal);
    s.cd = c.healer.cooldown;
    if (!s.bot) msg(g, "heal_pulse");
  } else if (s.cls === "Mecânico") {
    const gen = g.gens.find(x => !x.bonus && !x.done && dist(x, s) < c.mechanic.turbo.range);
    if (!gen) return;
    gen.n++;
    if (gen.n >= cfg.balance.generator.puzzles_per_generator) gen.done = true;
    s.cd = c.mechanic.turbo.cooldown;
    if (!s.bot) msg(g, "turbo");
  } else {
    s.block = c.fighter.block.time;
    s.cd = c.fighter.block.cooldown;
    if (!s.bot) msg(g, "block_on");
  }
}

export function attack(cfg: SimConfig, g: GameState, s: Survivor) {
  const c = cfg.balance.classes, H = g.hunter;
  if (s.st !== "ok" || s.atk > 0) return;
  if (s.cls === "Mecânico") {
    const dx = H.x - s.x, dz = H.z - s.z, k = Math.hypot(dx, dz) || 1;
    const facing = (-Math.sin(s.a) * dx - Math.cos(s.a) * dz) / k;
    if (k < c.mechanic.bolt.range && (s.bot || facing > cfg.balance.prototype_extras.bolt_aim_cos)) {
      s.atk = c.mechanic.bolt.cooldown;
      H.hp -= c.mechanic.bolt.damage;
      H.slow = c.mechanic.bolt.slow_time;
      emit(g, { type: "sound", name: "bolt" });
      if (!s.bot) msg(g, "bolt_hit");
    }
    return;
  }
  if (s.cls !== "Atacador") return;
  s.atk = c.fighter.strike.cooldown; // gasta a recarga mesmo errando (P-08)
  if (dist(s, H) < c.fighter.strike.range) {
    H.hp -= c.fighter.strike.damage;
    H.stun = c.fighter.strike.stun;
    emit(g, { type: "sound", name: "stun" });
    if (!s.bot) msg(g, "strike_hit");
  }
}

// ---------- dano, prisão e resgate (L124–L127) ----------

export function hit(cfg: SimConfig, g: GameState, s: Survivor, damage: number) {
  if (s.immune > 0 || s.st !== "ok") return;
  if (s.block > 0) { s.block = 0; if (!s.bot) msg(g, "blocked"); return; }
  s.hp -= damage;
  if (!s.bot) emit(g, { type: "flash" });
  emit(g, { type: "sound", name: "hit" });
  if (s.hp <= 0) knockDown(cfg, g, s);
}

function knockDown(cfg: SimConfig, g: GameState, s: Survivor) {
  const b = cfg.balance, m = cfg.map;
  if (!s.bot) g.puzzle = null;
  if (s.captures >= b.cage.deaths_at_capture - 1) { kill(g, s); return; }
  s.st = "cage";
  s.captures++;
  s.cage = b.cage.time;
  s.hp = 0;
  s.x = m.cage[0] + (s.id - 1) * b.prototype_extras.cage_slot_spacing;
  s.z = m.cage[1];
  if (!s.bot) msg(g, "caged", { n: b.cage.time });
}

function kill(g: GameState, s: Survivor) { s.st = "dead"; msg(g, "died", { cls: s.cls }); }

function free(cfg: SimConfig, g: GameState, c: Survivor) {
  const b = cfg.balance;
  c.st = "ok";
  c.hp = b.cage.rescue_hp;
  c.immune = b.cage.immunity;
  c.z = cfg.map.cage[1] + b.prototype_extras.rescued_offset;
  msg(g, "rescued", { cls: c.cls });
}

// ---------- caçador (L159–L169) ----------

function updateHunter(cfg: SimConfig, g: GameState, dt: number) {
  const b = cfg.balance, h = b.hunter, px = b.prototype_extras, H = g.hunter;
  if (H.stun > 0) { H.stun -= dt; return; }
  H.atk -= dt; H.dash -= dt; H.projectile -= dt; H.trap -= dt; H.dashing -= dt; H.alertTime -= dt; H.slow -= dt; g.reveal -= dt;
  const alive = g.survivors.filter(s => s.st === "ok");
  if (!alive.length) return;
  const d = (s: Survivor) => dist(s, H);
  if (g.reveal <= 0) {
    g.reveal = h.reveal.interval;
    [...alive].sort((a, c) => d(a) - d(c)).slice(0, h.reveal.targets).forEach(s => { s.revealed = h.reveal.duration; });
    if (player(g).st === "ok" && player(g).revealed > 0) msg(g, "revealed");
  }
  // detecção em 360° no ruleset do protótipo (L162; GDD v0.3 C-06)
  let c: Survivor | null = null, cd = Infinity;
  for (const s of alive) { const k = d(s); if ((k < h.detect_radius || s.revealed > 0) && k < cd) { c = s; cd = k; } }
  H.target = c ? c.id : -1;
  let tx: number, tz: number;
  if (c) { tx = c.x; tz = c.z; }
  else if (H.alertTime > 0 && H.alert) { tx = H.alert.x; tz = H.alert.z; }
  else {
    if (!H.patrol || dist(H.patrol, H) < px.patrol.reach) H.patrol = { x: (nextRandom(g) - 0.5) * px.patrol.range, z: (nextRandom(g) - 0.5) * px.patrol.range };
    tx = H.patrol.x; tz = H.patrol.z;
  }
  let sp = (c ? cfg.chaseSpeed : h.patrol_speed) * (g.gateStarted ? h.final_pressure_speed_mult : 1);
  if (H.dashing > 0) sp = h.dash.speed;
  if (H.slow > 0) sp *= b.classes.mechanic.bolt.slow;
  if (c && H.dash <= 0 && cd > h.dash.min && cd < h.dash.max) { H.dash = h.dash.cooldown; H.dashing = h.dash.duration; }
  if (c && H.projectile <= 0 && cd > h.projectile.min && cd < h.projectile.max) {
    H.projectile = h.projectile.cooldown;
    const k = cd || 1;
    g.projectiles.push({ id: g.nextId++, x: H.x, z: H.z, vx: ((c.x - H.x) / k) * h.projectile.speed, vz: ((c.z - H.z) / k) * h.projectile.speed, t: px.projectile_life });
  }
  if (H.trap <= 0) { H.trap = h.trap.interval; g.traps.push({ id: g.nextId++, x: H.x, z: H.z }); }
  move(cfg, g, H, tx - H.x, tz - H.z, sp, dt);
  if (c && cd < h.melee.range && H.atk <= 0) { H.atk = h.melee.cooldown; hit(cfg, g, c, g.gateStarted ? h.melee.damage_final : h.melee.damage); }
}

// ---------- bots (L171–L181) ----------

function updateBot(cfg: SimConfig, g: GameState, s: Survivor, dt: number) {
  const b = cfg.balance, bt = b.prototype_extras.bot, H = g.hunter, dh = dist(s, H);
  if (s.cls === "Curandeiro" && g.survivors.some(a => a.st === "ok" && a.hp < bt.heal_threshold && dist(a, s) < b.classes.healer.pulse_radius)) ability(cfg, g, s);
  if (s.cls === "Mecânico" && dh < bt.mechanic_bolt_dist) attack(cfg, g, s);
  if (s.cls === "Atacador") {
    if (dh < bt.fighter_block_dist) ability(cfg, g, s);
    if ((dh < bt.fighter_engage_dist && s.atk <= 0 && H.stun <= 0) || (H.stun > 0 && dh < bt.fighter_chase_stunned_dist)) {
      if (dh > bt.fighter_strike_dist) move(cfg, g, s, H.x - s.x, H.z - s.z, b.survivor.bot.flee, dt); else attack(cfg, g, s);
      return;
    }
  }
  if (dh < bt.flee_dist && H.stun <= 0) { move(cfg, g, s, s.x - H.x, s.z - H.z, b.survivor.bot.flee, dt); return; }
  const caged = g.survivors.find(a => a.st === "cage");
  if (caged && dh > bt.rescue_min_hunter_dist) {
    if (dist(s, caged) > bt.reach) move(cfg, g, s, caged.x - s.x, caged.z - s.z, b.survivor.bot.walk, dt);
    else { s.rescue += dt; if (s.rescue >= b.cage.rescue_time) { free(cfg, g, caged); s.rescue = 0; } }
    return;
  }
  s.rescue = 0;
  const gate = { x: cfg.map.gate[0], z: cfg.map.gate[1] };
  if (g.gateOpen) { move(cfg, g, s, gate.x - s.x, gate.z - s.z, bt.gate_speed, dt); return; }
  const gen = g.gens.filter(x => !x.bonus && !x.done).sort((a, c) => dist(a, s) - dist(c, s))[0];
  if (gen) {
    if (dist(gen, s) > bt.reach) move(cfg, g, s, gen.x - s.x, gen.z - s.z, b.survivor.bot.walk, dt);
    else {
      s.work += dt;
      const need = s.cls === "Mecânico" ? b.classes.mechanic.bot_puzzle_time : b.survivor.bot.puzzle_time;
      if (s.work > need) { s.work = 0; gen.n++; if (gen.n >= b.generator.puzzles_per_generator) gen.done = true; }
    }
  } else {
    const w = { x: bt.wait_point[0], z: bt.wait_point[1] };
    if (dist(s, w) > bt.wait_reach) move(cfg, g, s, w.x - s.x, w.z - s.z, b.survivor.bot.walk, dt);
  }
}

// ---------- passo da simulação (L132–L156) ----------

export function step(cfg: SimConfig, g: GameState, input: PlayerInput, dt: number = STEP) {
  if (g.over) return;
  const b = cfg.balance, sv = b.survivor, px = b.prototype_extras, P = player(g), H = g.hunter;
  g.t += dt;
  for (const s of g.survivors) {
    s.cd -= dt; s.atk -= dt; s.block -= dt; s.slow -= dt; s.revealed -= dt; s.immune -= dt;
    if (s.st === "cage") { s.cage -= dt; if (s.cage <= 0) kill(g, s); }
  }
  if (g.puzzle && g.gens[g.puzzle.gen].done) g.puzzle = null;

  // eventos de teclado do jogador (L109–L113, L141)
  if (input.ability) ability(cfg, g, P);
  if (input.attack) attack(cfg, g, P);
  if (g.puzzle && input.puzzleExit) g.puzzle = null;
  if (g.puzzle && P.st === "ok") {
    const z = g.puzzle;
    if (z.kind === "timing" && input.puzzleSpace) puzzleResult(cfg, g, Math.abs(z.t - z.zoneCenter) < z.zoneWidth / 2);
    else if (z.kind === "sequence" && input.puzzleArrow) {
      if (input.puzzleArrow === z.seq[z.i]) { z.i++; if (z.i >= z.seq.length) puzzleResult(cfg, g, true); }
      else { z.i = 0; puzzleResult(cfg, g, false); }
    }
  }

  if (P.st === "ok") {
    if (g.puzzle) {
      P.stamina = Math.min(sv.stamina.max, P.stamina + sv.stamina.regen_puzzle * dt);
      const z = g.puzzle;
      if (z.kind === "timing") {
        z.t += z.dir * dt * b.puzzles.timing.speed;
        if (z.t > 1) { z.t = 1; z.dir = -1; }
        if (z.t < 0) { z.t = 0; z.dir = 1; }
      }
    } else {
      const f = input.forward, s = input.strafe;
      const run = input.run && P.stamina > px.stamina_min_to_run && (f !== 0 || s !== 0);
      P.stamina = run ? Math.max(0, P.stamina - sv.stamina.drain * dt) : Math.min(sv.stamina.max, P.stamina + sv.stamina.regen * dt);
      const speed = (run ? sv.run : sv.walk) * (P.slow > 0 ? b.hunter.trap.slow : 1), y = input.yaw;
      P.x += (-Math.sin(y) * f + Math.cos(y) * s) * speed * dt;
      P.z += (-Math.cos(y) * f - Math.sin(y) * s) * speed * dt;
      collide(cfg, P, sv.radius);
      P.a = y;
    }
    const caged = g.survivors.find(a => a.st === "cage" && dist(a, P) < b.cage.rescue_range);
    if (caged && input.interactHeld && !g.puzzle) { P.rescue += dt; if (P.rescue >= b.cage.rescue_time) { free(cfg, g, caged); P.rescue = 0; } }
    else P.rescue = 0;
    if (input.interact) {
      if (g.puzzle) g.puzzle = null;
      else {
        const trap = g.traps.find(t => dist(t, P) < px.interact_range.trap);
        if (trap && P.cls === "Mecânico") { g.traps.splice(g.traps.indexOf(trap), 1); msg(g, "trap_disarmed"); }
        else {
          const i = g.gens.findIndex(x => !x.done && dist(x, P) < px.interact_range.generator);
          if (i >= 0) openPuzzle(cfg, g, i);
        }
      }
    }
  }

  for (const s of g.survivors) if (s.bot && s.st === "ok") updateBot(cfg, g, s, dt);
  updateHunter(cfg, g, dt);

  g.projectiles = g.projectiles.filter(p => {
    p.x += p.vx * dt; p.z += p.vz * dt; p.t -= dt;
    let dead = p.t <= 0 || insideWall(cfg, p.x, p.z);
    for (const s of g.survivors) if (!dead && s.st === "ok" && dist(s, p) < px.projectile_hit_radius) { hit(cfg, g, s, b.hunter.projectile.damage); dead = true; }
    return !dead;
  });
  g.traps = g.traps.filter(t => {
    const s = g.survivors.find(s => s.st === "ok" && dist(s, t) < b.hunter.trap.radius && !(px.mechanic_bot_trap_immune && s.cls === "Mecânico" && s.bot));
    if (s) { s.slow = b.hunter.trap.slow_time; if (!s.bot) msg(g, "trap_caught"); return false; }
    return true;
  });

  if (!g.gateStarted && g.gens.filter(x => !x.bonus).every(x => x.done)) {
    g.gateStarted = true; g.gateTimer = b.generator.gate_time; msg(g, "gate_countdown", { n: b.generator.gate_time });
  }
  if (g.gateStarted && !g.gateOpen) { g.gateTimer -= dt; if (g.gateTimer <= 0) { g.gateOpen = true; msg(g, "gate_open"); } }
  for (const s of g.survivors) {
    if (g.gateOpen && s.st === "ok" && s.z < cfg.map.exit_z && Math.abs(s.x - cfg.map.gate[0]) < px.gate_exit_half_width) s.st = "out";
  }
  if (P.st === "out") end(cfg, g, true, "escaped");
  else if (H.hp <= 0) end(cfg, g, true, "hunter_down");
  else if (P.st === "dead") end(cfg, g, false, "died");
}

function end(cfg: SimConfig, g: GameState, win: boolean, outcome: "escaped" | "hunter_down" | "died") {
  const e = cfg.balance.economy;
  g.over = true;
  g.puzzle = null;
  const coins = Math.round(e.base_coins + (win ? e.win_coins : 0) + g.points * e.points_to_coins);
  emit(g, { type: "end", win, outcome, coins, time: Math.floor(g.t) });
}

/** retira os eventos acumulados (o cliente consome a cada quadro) */
export function drainEvents(g: GameState): GameEvent[] { const e = g.events; g.events = []; return e; }
