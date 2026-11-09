// Bots aliados competentes (item R4; GDD-v0.3 §8.5). Ativos no ruleset v1 com `ai.bot_brain: competent`; os bots
// do protótipo (game.ts `updateBot`) continuam intactos para a paridade.
//
// Ciclo por passo de simulação (60 Hz), como o do caçador (GDD-v0.3 §8.1):
//   1. percepção a `ai.perception_hz` (perceiveBot: única leitura do caçador; só o que um jogador naquela posição
//      teria: caçador com linha de visão até `ai.bots.sight_radius`, batimento só como distância, HUD dos aliados,
//      geradores públicos, ruídos ouvidos);
//   2. decisão a `ai.decision_hz` (thinkBot: máquina de estados com utilidade — fugir, resgatar, consertar, escapar,
//      esperar — e habilidade da classe para fugir ou proteger);
//   3. ação a cada passo (actBot): movimento pelo caminho da grade A* ou navmesh, volta no loop, stamina e corrida com
//      as regras do jogador, quebra-cabeça com `ai.bots.puzzle_fail_rate`, anti-travamento (§8.6).
// Todo número vem de SimConfig (data/balance.yaml). Sorteios pelo PRNG da partida (rng.ts).
import type { MapLoop } from "@thehell/shared";
import type { SimConfig } from "../config.ts";
import type { P2 } from "../nav/geometry.ts";
import { inCone, lineOfSight } from "../perception.ts";
import { nextRandom } from "../rng.ts";
import type { BotAi, BotMode, GameState, Generator, NoiseKind, Survivor, Vec } from "../types.ts";
import { project } from "./hunter.ts";

/** efeitos da partida que o bot usa (injetados por game.ts para evitar import circular) */
export interface BotEffects {
  ability(s: Survivor): void;
  attack(s: Survivor): void;
  collide(p: Vec, r: number): void;
  noise(kind: NoiseKind, at: Vec, event: boolean): void;
  /** resultado de um quebra-cabeça do bot: as mesmas regras do jogador no v1 (GDD-v0.2 §6.2) */
  puzzle(s: Survivor, gen: Generator, ok: boolean): void;
  /** resgate concluído: solta `caged` e credita o resgate a `by` (R6, GDD-v0.2 §7.1) */
  free(caged: Survivor, by: Survivor): void;
}

// Tolerância de ponto flutuante (técnica, não é número de jogo), a mesma do caçador.
const EPS = 1e-9;
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);
const v2 = (p: P2): Vec => ({ x: p[0], z: p[1] });
const p2 = (v: Vec): P2 => [v.x, v.z];

export type Personality = SimConfig["balance"]["ai"]["bots"]["personalities"][string];

/** sorteia a personalidade com o PRNG da partida (uniforme entre as chaves de `ai.bots.personalities`) */
export function newBotAi(cfg: SimConfig, rng: { seed: number }, s: Survivor): BotAi {
  const keys = Object.keys(cfg.balance.ai.bots.personalities);
  const personality = keys[Math.min(keys.length - 1, Math.floor(nextRandom(rng) * keys.length))];
  return {
    personality, mode: "work", perceiveIn: 0, decideIn: 0, hunter: null, seen: false, heartbeat: false,
    lastHp: s.hp, hitAt: null, reactAt: 0, lookAt: 0, glanceAt: 0, busy: false, exhausted: false, running: false, caged: [], pending: [], dangers: [], loop: null, loopSince: -1,
    gen: -1, rescueId: -1, captures: s.captures,
    goal: null, path: [], pathOk: true, forceAstar: false, stuck: { t: 0, x: s.x, z: s.z, ex: 0, ez: 0 }, replans: 0,
  };
}

export const personalityOf = (cfg: SimConfig, ai: BotAi): Personality => cfg.balance.ai.bots.personalities[ai.personality];

const reactionDelay = (cfg: SimConfig, rng: { seed: number }) => {
  const [a, b] = cfg.balance.ai.bots.ping_reaction;
  return a + nextRandom(rng) * (b - a);
};

/**
 * Ruído ouvido pelos bots (chamado por game.ts `noise`). Reagem só à falha de quebra-cabeça de outro sobrevivente
 * dentro do raio do ruído (§3.4): o caçador pode estar indo para lá. Os outros ruídos não mudam a decisão do bot.
 */
export function botsHear(cfg: SimConfig, g: GameState, kind: NoiseKind, at: Vec) {
  if (kind !== "puzzle_fail") return;
  const radius = cfg.balance.noise[kind];
  for (const s of g.survivors) {
    if (!s.ai || s.st !== "ok") continue;
    const d = dist(s, at);
    // a própria falha o bot já conhece (está no gerador)
    if (d > radius || d < cfg.balance.prototype_extras.interact_range.generator) continue;
    s.ai.pending.push({ kind: "danger", id: -1, x: at.x, z: at.z, at: g.t + reactionDelay(cfg, g) });
  }
}

// ---------- percepção (10 Hz) ----------

/** leitura do bot: só o que um jogador naquela posição teria (GDD-v0.3 §8.1) */
export function perceiveBot(cfg: SimConfig, g: GameState, s: Survivor, ai: BotAi) {
  const b = cfg.balance, H = g.hunter, t = g.t, d = dist(s, H);
  // batimento (P-03): só a distância; quem `look_on_heartbeat` larga o quebra-cabeça e olha em volta depois da reação
  const beat = d < b.prototype_extras.heartbeat.radius;
  if (beat && !ai.heartbeat) ai.lookAt = t + reactionDelay(cfg, g);
  ai.heartbeat = beat;
  // visão: o campo da câmera (`prototype_extras.camera.fov`) na direção do personagem; a câmera de 3ª pessoa gira
  // livre, então fora de interação o bot olha em volta (360°) a cada `ai.bots.glance_interval`. No quebra-cabeça ou
  // segurando o resgate a câmera fica no gerador/gaiola: só olha em volta quem `look_on_heartbeat`, ao ouvir o
  // batimento. Sempre com linha de visão e até a névoa (`ai.bots.sight_radius`).
  let looking = ai.busy ? personalityOf(cfg, ai).look_on_heartbeat && beat && t + EPS >= ai.lookAt : t + EPS >= ai.glanceAt;
  if (!ai.busy && looking) ai.glanceAt = t + b.ai.bots.glance_interval;
  if (d < b.hunter.radius + b.survivor.radius) looking = true; // contato (mesma regra do caçador, LACUNA do R1)
  ai.seen = d < b.ai.bots.sight_radius && lineOfSight(cfg.map, s, H) && (looking || inCone(s, s.a, H, b.prototype_extras.camera.fov));
  // tempo de reação só para o caçador "novo" (sem ser visto há `calm_time`); entre olhadas a informação continua valendo
  if (ai.seen && !(ai.hunter && t - ai.hunter.at < b.ai.bots.calm_time)) ai.reactAt = t + reactionDelay(cfg, g);
  if (ai.seen) ai.hunter = { x: H.x, z: H.z, at: t, windup: H.windup?.kind ?? null, stunned: H.stun > 0 };
  if (s.hp < ai.lastHp) ai.hitAt = t;
  ai.lastHp = s.hp;
  // HUD: estado dos aliados (preso) e luz de gerador concluído; o bot reage depois do tempo de reação
  for (const o of g.survivors) {
    if (o.id === s.id) continue;
    const known = ai.caged.includes(o.id), waiting = ai.pending.some(e => e.kind === "caged" && e.id === o.id);
    if (o.st === "cage" && !known && !waiting) ai.pending.push({ kind: "caged", id: o.id, x: o.x, z: o.z, at: t + reactionDelay(cfg, g) });
    if (o.st !== "cage") {
      if (known) ai.caged = ai.caged.filter(id => id !== o.id);
      if (waiting) ai.pending = ai.pending.filter(e => !(e.kind === "caged" && e.id === o.id));
    }
  }
  g.gens.forEach((x, i) => {
    // luz do gerador concluído (`generator.completed_reveal`): o caçador pode ir até lá
    if (x.revealed > 0 && !ai.pending.some(e => e.kind === "danger" && e.id === i) && !ai.dangers.some(z => z.x === x.x && z.z === x.z)) {
      ai.pending.push({ kind: "danger", id: i, x: x.x, z: x.z, at: t + reactionDelay(cfg, g) });
    }
  });
  const ready = ai.pending.filter(e => e.at <= t + EPS);
  ai.pending = ai.pending.filter(e => e.at > t + EPS);
  for (const e of ready) {
    if (e.kind === "caged") ai.caged.push(e.id);
    else ai.dangers.push({ x: e.x, z: e.z, until: t + b.ai.hearing_investigate_time });
  }
  ai.dangers = ai.dangers.filter(z => z.until > t);
}

/** caçador visto agora ou na última olhada em volta (`ai.bots.glance_interval`): informação "atual" */
export function freshHunter(cfg: SimConfig, ai: BotAi, t: number) {
  return ai.hunter && t - ai.hunter.at <= cfg.balance.ai.bots.glance_interval + EPS ? ai.hunter : null;
}

/** levou dano há menos de `ai.bots.calm_time` (null = nunca; serializável, sem −Infinity) */
const hitRecently = (cfg: SimConfig, ai: BotAi, t: number) => ai.hitAt !== null && t - ai.hitAt < cfg.balance.ai.bots.calm_time;

/** caçador conhecido (visto há até `ai.bots.memory`) */
export function knownHunter(cfg: SimConfig, ai: BotAi, t: number) {
  return ai.hunter && t - ai.hunter.at <= cfg.balance.ai.bots.memory + EPS ? ai.hunter : null;
}

// ---------- loops (metadados do mapa, os mesmos da IA do caçador) ----------

function closestParam(poly: readonly P2[], p: Vec): { s: number; d: number; L: number } {
  let acc = 0, best = 0, bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], c = poly[(i + 1) % poly.length];
    const dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz);
    const u = l ? Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.z - a[1]) * dz) / (l * l))) : 0;
    const d = Math.hypot(p.x - (a[0] + u * dx), p.z - (a[1] + u * dz));
    if (d < bd) { bd = d; best = acc + u * l; }
    acc += l;
  }
  return { s: best, d: bd, L: acc };
}

function pointAt(poly: readonly P2[], s: number, L: number): Vec {
  s = ((s % L) + L) % L;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], c = poly[(i + 1) % poly.length], l = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (s <= l || i === poly.length - 1) { const u = l ? Math.min(1, s / l) : 0; return { x: a[0] + u * (c[0] - a[0]), z: a[1] + u * (c[1] - a[1]) }; }
    s -= l;
  }
  /* c8 ignore next */
  return v2(poly[0]);
}

const centroid = (poly: readonly P2[]): Vec => ({
  x: poly.reduce((s, p) => s + p[0], 0) / poly.length,
  z: poly.reduce((s, p) => s + p[1], 0) / poly.length,
});

/** ponto da rota do loop do lado oposto ao caçador (raio do centro na direção contrária a ele) */
export function oppositeOnLoop(l: MapLoop, h: Vec): Vec {
  const c = centroid(l.polygon), dx = c.x - h.x, dz = c.z - h.z, k = Math.hypot(dx, dz) || 1, ux = dx / k, uz = dz / k;
  let best: Vec | null = null, bt = Infinity;
  for (let i = 0; i < l.polygon.length; i++) {
    const a = l.polygon[i], e = l.polygon[(i + 1) % l.polygon.length];
    const ex = e[0] - a[0], ez = e[1] - a[1], den = ux * ez - uz * ex;
    if (Math.abs(den) < EPS) continue;
    const ax = a[0] - c.x, az = a[1] - c.z;
    const tt = (ax * ez - az * ex) / den, u = (ax * uz - az * ux) / den;
    if (tt > 0 && u >= -EPS && u <= 1 + EPS && tt < bt) { bt = tt; best = { x: c.x + ux * tt, z: c.z + uz * tt }; }
  }
  /* c8 ignore next */
  return best ?? v2(l.polygon[0]);
}

/**
 * Loop da rota de fuga: o de entrada mais próxima entre os que o bot alcança antes do caçador (distância até a
 * entrada × velocidade do caçador ÷ velocidade de corrida); sem nenhum assim, o de maior folga.
 */
export function chooseLoop(cfg: SimConfig, s: Vec, h: Vec | null, exclude: string | null = null): MapLoop | null {
  const ratio = cfg.chaseSpeed / cfg.balance.survivor.run;
  let best: MapLoop | null = null, bestSafe = false, bestKey = Infinity;
  for (const l of cfg.map.loops ?? []) {
    if (l.id === exclude) continue;
    const cp = closestParam(l.polygon, s), e = pointAt(l.polygon, cp.s, cp.L);
    const ds = dist(s, e), dh = h ? dist(h, e) : Infinity;
    const safe = dh > ds * ratio;
    const key = safe ? ds : -(dh - ds);
    if ((safe && !bestSafe) || (safe === bestSafe && key < bestKey)) { best = l; bestSafe = safe; bestKey = key; }
  }
  return best;
}

const loopById = (cfg: SimConfig, id: string | null) => (id ? cfg.map.loops?.find(l => l.id === id) ?? null : null);

// ---------- decisão (10 Hz) ----------

/** escolha do gerador: o mais próximo fora de perigo; bônus conforme a personalidade (GDD-v0.3 §8.5) */
export function chooseGenerator(cfg: SimConfig, g: GameState, s: Survivor, ai: BotAi): number {
  const bt = cfg.balance.ai.bots, P = personalityOf(cfg, ai), hk = knownHunter(cfg, ai, g.t);
  const danger = (x: Vec) => ai.dangers.some(z => dist(z, x) < bt.danger_radius) || (hk !== null && dist(hk, x) < bt.danger_radius);
  let best = -1, bk = Infinity, bestSafe = false;
  g.gens.forEach((x, i) => {
    if (x.done || (x.bonus && P.bonus === "avoid")) return;
    if (!x.bonus && g.gateStarted) return;
    const safe = !danger(x);
    // fica no gerador atual enquanto ele estiver seguro (sem vaivém entre dois geradores parecidos)
    const k = i === ai.gen && safe ? -1 : dist(x, s) * (x.bonus ? bt.bonus_prefer_mult : 1);
    if ((safe && !bestSafe) || (safe === bestSafe && k < bk)) { best = i; bk = k; bestSafe = safe; }
  });
  return best;
}

/**
 * pode ir resgatar? `rescue_priority` da personalidade (GDD-v0.3 §8.5: o Altruísta prioriza resgate). O batimento só
 * impede de começar: quem já está a caminho só desiste se souber do caçador perto da gaiola (sem vaivém na borda).
 */
export function canRescue(cfg: SimConfig, g: GameState, ai: BotAi): boolean {
  const P = personalityOf(cfg, ai), hk = knownHunter(cfg, ai, g.t), cage = g.arena.cage;
  if (P.rescue_priority === "high") return !(hk && dist(hk, cage) < P.flee_dist);
  return (ai.mode === "rescue" || !ai.heartbeat) && !(hk && dist(hk, cage) < cfg.balance.ai.bots.rescue_safe_dist);
}

function setBotMode(ai: BotAi, m: BotMode) {
  if (ai.mode === m) return;
  ai.mode = m;
  ai.goal = null; ai.path = [];
  if (m !== "flee") { ai.loop = null; ai.loopSince = -1; }
}

export function thinkBot(cfg: SimConfig, g: GameState, s: Survivor, ai: BotAi, fx: BotEffects) {
  const b = cfg.balance, bt = b.ai.bots, P = personalityOf(cfg, ai), t = g.t;
  const hk = knownHunter(cfg, ai, t), dh = hk ? dist(s, hk) : Infinity;
  // o caçador que acaba de aparecer só vira ameaça depois do tempo de reação (`ai.bots.ping_reaction`)
  const fresh = freshHunter(cfg, ai, t);
  const threat = (fresh !== null && t + EPS >= ai.reactAt && dh < P.flee_dist && !fresh.stunned) || hitRecently(cfg, ai, t);
  const calm = !ai.hunter || t - ai.hunter.at >= bt.calm_time;
  if (threat || (ai.mode === "flee" && !calm)) {
    if (g.gateOpen && hk && dist(hk, g.arena.gate) > dh) setBotMode(ai, "escape"); // o portão aberto é a melhor fuga
    else {
      setBotMode(ai, "flee");
      const cur = loopById(cfg, ai.loop), d = cur ? closestParam(cur.polygon, s).d : Infinity;
      // troca de loop se o caçador fechou a entrada antes de o bot chegar à rota, ou depois de segurar o loop pela
      // vantagem que o desenho do mapa prevê para ele (`maps.loop_advantage`, GDD-v0.3 §9.1): encadeia o próximo
      const held = cur && ai.loopSince >= 0 && t - ai.loopSince > b.maps.loop_advantage[1];
      if (!cur || held || (d > b.ai.loop_band && hk && dist(hk, s) < d)) {
        ai.loop = chooseLoop(cfg, s, hk, held ? cur.id : null)?.id ?? null;
        ai.loopSince = -1;
      }
    }
  } else if (g.gateOpen) setBotMode(ai, "escape");
  else {
    const caged = ai.caged.map(id => g.survivors[id]).filter(o => o.st === "cage");
    if (caged.length && canRescue(cfg, g, ai)) {
      setBotMode(ai, "rescue");
      if (!caged.some(o => o.id === ai.rescueId)) ai.rescueId = caged.sort((a, c) => dist(a, s) - dist(c, s))[0].id;
    } else {
      const gen = chooseGenerator(cfg, g, s, ai);
      if (gen !== ai.gen) s.work = 0; // trocar de gerador perde o quebra-cabeça em andamento
      ai.gen = gen;
      setBotMode(ai, gen >= 0 ? "work" : "wait");
    }
  }
  if (ai.mode !== "rescue") ai.rescueId = -1;
  useAbility(cfg, g, s, ai, fx, hk, dh);
}

/** habilidade da classe para fugir ou proteger (GDD-v0.3 §8.5): bloqueio, pulso de cura, parafuso; golpe só de defesa */
function useAbility(cfg: SimConfig, g: GameState, s: Survivor, ai: BotAi, fx: BotEffects, hk: Vec | null, dh: number) {
  const c = cfg.balance.classes, maxHp = cfg.balance.survivor.hp, fleeing = ai.mode === "flee" || ai.mode === "escape";
  if (s.cls === "Curandeiro") {
    // pulso quando alguém no raio está abaixo de `heal_below` da personalidade (padrão: vida ≤ máximo − cura, aproveita
    // a cura inteira; o Altruísta cura mais cedo, §8.5 "prioriza resgate e cura"); aliado só se visto
    const below = personalityOf(cfg, ai).heal_below ?? maxHp - c.healer.pulse_heal;
    const need = (o: Survivor) => o.st === "ok" && o.hp <= below && dist(o, s) < c.healer.pulse_radius
      && (o.id === s.id || lineOfSight(cfg.map, s, o));
    if (s.cd <= 0 && g.survivors.some(need)) fx.ability(s);
  } else if (s.cls === "Mecânico") {
    // parafuso: só fugindo e encurralado (sem stamina ou com um preparo do caçador à vista), com o caçador perto
    // (`defend_dist`); vira para ele antes (mesma mira do jogador)
    const cornered = ai.exhausted || ai.hunter?.windup != null;
    if (fleeing && freshHunter(cfg, ai, g.t) && hk && cornered && dh < Math.min(c.mechanic.bolt.range, cfg.balance.ai.bots.defend_dist) && s.atk <= 0) {
      s.a = Math.atan2(-(hk.x - s.x), -(hk.z - s.z));
      fx.attack(s);
    }
  } else if (s.cls === "Atacador" && freshHunter(cfg, ai, g.t) && hk) {
    if (fleeing && s.cd <= 0 && s.block <= 0 && dh < cfg.balance.ai.bots.defend_dist) fx.ability(s);
    // golpe só de defesa, no desespero: contra o preparo de golpe visível que o derrubaria, sem bloqueio ativo
    else {
      const h = cfg.balance.hunter, lethal = s.hp <= (g.gateStarted ? h.melee.damage_final : h.melee.damage);
      if (ai.hunter!.windup === "melee" && lethal && s.block <= 0 && s.atk <= 0 && dh < c.fighter.strike.range) fx.attack(s);
    }
  }
}

// ---------- ação (60 Hz) ----------

export function updateBotAi(cfg: SimConfig, g: GameState, s: Survivor, dt: number, fx: BotEffects) {
  const b = cfg.balance;
  if (!s.ai) s.ai = newBotAi(cfg, g, s);
  const ai = s.ai;
  if (ai.captures !== s.captures) {
    // voltou da gaiola (teletransporte): caminho e janela do anti-travamento velhos
    ai.captures = s.captures; ai.goal = null; ai.path = []; resetStuck(ai, s);
  }
  if (ai.perceiveIn <= EPS) { perceiveBot(cfg, g, s, ai); ai.perceiveIn += 1 / b.ai.perception_hz; }
  if (ai.decideIn <= EPS) { thinkBot(cfg, g, s, ai, fx); ai.decideIn += 1 / b.ai.decision_hz; }
  ai.perceiveIn -= dt; ai.decideIn -= dt;
  if (s.st !== "ok") return; // a própria habilidade não muda o estado, mas por segurança
  actBot(cfg, g, s, ai, dt, fx);
}

function actBot(cfg: SimConfig, g: GameState, s: Survivor, ai: BotAi, dt: number, fx: BotEffects) {
  const b = cfg.balance, sv = b.survivor, px = b.prototype_extras, t = g.t;
  const hk = knownHunter(cfg, ai, t), P = personalityOf(cfg, ai);
  let goal: Vec | null = null, stopAt = 0, working = false;
  ai.busy = false;
  if (ai.mode !== "rescue") s.rescue = 0;
  switch (ai.mode) {
    case "flee": {
      const l = loopById(cfg, ai.loop);
      if (l) {
        const cp = closestParam(l.polygon, s);
        if (cp.d <= b.ai.loop_band) { if (ai.loopSince < 0) ai.loopSince = t; loopStep(cfg, g, s, ai, l, hk, dt, fx); return; }
        goal = pointAt(l.polygon, cp.s, cp.L);
      } else goal = fleeProbe(cfg, s, hk);
      break;
    }
    case "escape": goal = { x: g.arena.gate.x, z: g.arena.gate.z }; break;
    case "rescue": {
      const c = g.survivors[ai.rescueId];
      if (dist(s, c) < b.cage.rescue_range) {
        s.rescue += dt;
        ai.busy = true; s.a = Math.atan2(-(c.x - s.x), -(c.z - s.z));
        fx.noise("rescue", s, false);
        if (s.rescue >= b.cage.rescue_time) { fx.free(c, s); s.rescue = 0; }
        stamina(cfg, s, ai, false, false, dt);
        idle(ai);
        return;
      }
      s.rescue = 0;
      goal = c; stopAt = b.cage.rescue_range - sv.bot_radius;
      break;
    }
    case "work": {
      const gen = g.gens[ai.gen];
      if (dist(s, gen) < px.interact_range.generator) {
        working = true;
        ai.busy = true; s.a = Math.atan2(-(gen.x - s.x), -(gen.z - s.z));
        if (s.cls === "Mecânico" && s.cd <= 0 && !gen.bonus && dist(s, gen) < b.classes.mechanic.turbo.range) fx.ability(s);
        if (!gen.done) {
          s.work += dt;
          const need = s.cls === "Mecânico" ? b.classes.mechanic.bot_puzzle_time : sv.bot.puzzle_time;
          if (s.work >= need) { s.work = 0; fx.puzzle(s, gen, nextRandom(g) >= b.ai.bots.puzzle_fail_rate); }
        }
        stamina(cfg, s, ai, false, true, dt);
        idle(ai);
        return;
      }
      goal = gen; stopAt = px.interact_range.generator - sv.bot_radius;
      break;
    }
    case "wait": {
      // espera o portão perto dele, no esconderijo mais próximo (metadados do mapa, GDD-v0.3 §9.4)
      const gate = g.arena.gate, hides = (cfg.map.hideouts ?? []).map(v2);
      goal = hides.sort((a, c) => dist(a, gate) - dist(c, gate))[0] ?? gate;
      stopAt = b.ai.loop_band;
      break;
    }
  }
  // como o jogador: só corre (e gasta stamina) quando há passo
  const moving = goal !== null && dist(s, goal) > stopAt;
  const sp = stamina(cfg, s, ai, moving && wantsRun(cfg, s, ai, P.flee_dist, t), working, dt);
  if (moving) followPath(cfg, s, ai, project(cfg, goal!), sp, dt, fx);
  else { idle(ai); ai.path = []; ai.goal = null; }
  antiStuck(cfg, s, ai, dt);
}

/**
 * Corre só em fuga, com o caçador visto a menos de `flee_dist` ou logo depois de um dano (até `ai.bots.calm_time`);
 * fora disso anda e recupera stamina (GDD-v0.3 §8.5: andar quando a stamina não sustenta a fuga).
 */
function wantsRun(cfg: SimConfig, s: Survivor, ai: BotAi, fleeDist: number, t: number): boolean {
  if (ai.mode !== "flee" && ai.mode !== "escape") return false;
  const fresh = freshHunter(cfg, ai, t);
  return (fresh !== null && dist(s, fresh) < fleeDist) || hitRecently(cfg, ai, t);
}

/** stamina com as regras do jogador (GDD-v0.2 §2.3, `prototype_extras.stamina_min_to_run`); devolve a velocidade */
function stamina(cfg: SimConfig, s: Survivor, ai: BotAi, wantRun: boolean, puzzle: boolean, dt: number): number {
  const b = cfg.balance, sv = b.survivor, st = sv.stamina;
  if (s.stamina <= b.prototype_extras.stamina_min_to_run) ai.exhausted = true;
  else if (s.stamina >= b.ai.bots.stamina_resume) ai.exhausted = false;
  const run = wantRun && !ai.exhausted && s.stamina > b.prototype_extras.stamina_min_to_run;
  ai.running = run;
  if (run) s.stamina = Math.max(0, s.stamina - st.drain * dt);
  else s.stamina = Math.min(st.max, s.stamina + (puzzle ? st.regen_puzzle : st.regen) * dt);
  return (run ? sv.run : sv.walk) * (s.slow > 0 ? b.hunter.trap.slow : 1);
}

/** volta no loop: anda pela rota até o ponto do lado oposto ao caçador (o obstáculo quebra a linha de visão) */
function loopStep(cfg: SimConfig, g: GameState, s: Survivor, ai: BotAi, l: MapLoop, hk: Vec | null, dt: number, fx: BotEffects) {
  const P = personalityOf(cfg, ai);
  const cp = closestParam(l.polygon, s);
  // parado na rota, a câmera fica na última posição conhecida do caçador (de onde ele deve reaparecer); parado não
  // corre, então recupera stamina como o jogador
  const watch = () => {
    if (ai.hunter) s.a = Math.atan2(-(ai.hunter.x - s.x), -(ai.hunter.z - s.z));
    stamina(cfg, s, ai, false, false, dt); idle(ai); resetStuck(ai, s);
  };
  if (!hk) { watch(); return; }
  const target = closestParam(l.polygon, oppositeOnLoop(l, hk));
  let delta = target.s - cp.s;
  if (delta > cp.L / 2) delta -= cp.L;
  if (delta < -cp.L / 2) delta += cp.L;
  if (Math.abs(delta) <= cfg.balance.ai.loop_band) { watch(); return; }
  const sp = stamina(cfg, s, ai, wantsRun(cfg, s, ai, P.flee_dist, g.t), false, dt);
  const step = Math.min(sp * dt, Math.abs(delta));
  const next = pointAt(l.polygon, cp.s + Math.sign(delta) * step, cp.L);
  const dx = next.x - s.x, dz = next.z - s.z, k = Math.hypot(dx, dz);
  const x0 = s.x, z0 = s.z;
  if (k > EPS) { const m = Math.min(step, k); s.x += (dx / k) * m; s.z += (dz / k) * m; s.a = Math.atan2(-dx, -dz); }
  intend(ai, s.x - x0, s.z - z0);
  fx.collide(s, cfg.balance.survivor.bot_radius);
  ai.goal = null; ai.path = [];
  if (ai.running) fx.noise("run", s, false);
  antiStuck(cfg, s, ai, dt);
}

/** fuga sem loop: das `ai.bots.flee_probe_dirs` direções a `flee_probe`, a que mais se afasta do caçador, preferindo sem linha de visão */
export function fleeProbe(cfg: SimConfig, s: Vec, hk: Vec | null): Vec {
  if (!hk) return { x: s.x, z: s.z };
  const r = cfg.balance.ai.bots.flee_probe, n = cfg.balance.ai.bots.flee_probe_dirs, grid = cfg.grid!;
  let best: Vec = { x: s.x, z: s.z }, bk = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, q = project(cfg, { x: s.x + Math.cos(a) * r, z: s.z + Math.sin(a) * r });
    if (!grid.lineOfSight(p2(s), p2(q))) continue;
    const k = dist(q, hk) + (lineOfSight(cfg.map, q, hk) ? 0 : r);
    if (k > bk) { bk = k; best = q; }
  }
  return best;
}

// ---------- navegação (GDD-v0.3 §8.6), o mesmo esquema do caçador ----------

function followPath(cfg: SimConfig, s: Survivor, ai: BotAi, goal: Vec, sp: number, dt: number, fx: BotEffects) {
  const grid = cfg.grid!, nav = cfg.nav!;
  if (ai.forceAstar || !ai.goal || !ai.path.length || dist(ai.goal, goal) > cfg.balance.nav.fallback_grid) {
    if (!ai.forceAstar && grid.lineOfSight(p2(s), p2(goal))) { ai.path = [goal]; ai.pathOk = true; }
    else {
      const path = nav.findPath(p2(s), p2(goal));
      ai.pathOk = path.length > 0;
      ai.path = path.length ? path.slice(1).map(v2) : [goal];
      if (!ai.path.length) ai.path = [goal];
    }
    ai.goal = { x: goal.x, z: goal.z };
    ai.forceAstar = false;
  }
  let budget = sp * dt;
  const x0 = s.x, z0 = s.z;
  let dirX = 0, dirZ = 0;
  while (budget > EPS && ai.path.length) {
    const w = ai.path[0], d = dist(s, w);
    if (!dirX && !dirZ && d > EPS) { dirX = w.x - s.x; dirZ = w.z - s.z; }
    if (d <= budget) { s.x = w.x; s.z = w.z; budget -= d; ai.path.shift(); }
    else { s.x += ((w.x - s.x) / d) * budget; s.z += ((w.z - s.z) / d) * budget; budget = 0; }
  }
  intend(ai, s.x - x0, s.z - z0);
  fx.collide(s, cfg.balance.survivor.bot_radius);
  if (dirX || dirZ) s.a = Math.atan2(-dirX, -dirZ);
  if (ai.running) fx.noise("run", s, false);
}

function resetStuck(ai: BotAi, p: Vec) { ai.stuck = { t: 0, x: p.x, z: p.z, ex: 0, ez: 0 }; }
function idle(ai: BotAi) { ai.running = false; }
function intend(ai: BotAi, dx: number, dz: number) { ai.stuck.ex += dx; ai.stuck.ez += dz; }

/** anti-travamento (`ai.anti_stuck`, GDD-v0.3 §8.6: "vale para caçador e bots"): replaneja pelo A* */
function antiStuck(cfg: SimConfig, s: Survivor, ai: BotAi, dt: number) {
  const a = cfg.balance.ai.anti_stuck;
  ai.stuck.t += dt;
  if (ai.stuck.t + EPS < a.window) return;
  const moved = Math.hypot(s.x - ai.stuck.x, s.z - ai.stuck.z), expected = Math.hypot(ai.stuck.ex, ai.stuck.ez);
  if (expected > EPS && moved < a.min_progress_ratio * expected) { ai.forceAstar = true; ai.path = []; ai.replans++; }
  resetStuck(ai, s);
}
