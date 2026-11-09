// IA do caçador (item R3; GDD-v0.3 §8). Ativa no ruleset v1 com `ai.hunter_brain: utility`.
//
// Ciclo por passo de simulação (60 Hz):
//   1. percepção a `ai.perception_hz` (percept.ts: snapshot filtrado, única leitura do GameState);
//   2. decisão a `ai.decision_hz` (think: só lê o Percept e o próprio estado) — máquina de estados explícita do §8.2,
//      alvo por utilidade com histerese (§8.3), dificuldade (§8.4: reação, memória, loops, previsão de projétil);
//   3. ação a cada passo (act): telegraph de toda habilidade (GDD-v0.2 §4.1), movimento pelo caminho da grade A*
//      ou navmesh e anti-travamento (§8.6).
// Todo número vem de SimConfig (data/balance.yaml). Sorteios pelo PRNG da partida (rng.ts).
import type { MapLoop } from "@thehell/shared";
import type { SimConfig } from "../config.ts";
import { polygonPerimeter, type P2 } from "../nav/geometry.ts";
import { lineOfSight } from "../perception.ts";
import { nextRandom } from "../rng.ts";
import type { GameState, Hunter, HunterAi, HunterMode, Percept, SeenSurvivor, Survivor, Vec } from "../types.ts";
import { perceive } from "./percept.ts";
import { chooseTarget, nearAttacker } from "./utility.ts";

/** grafo de transições válidas (GDD-v0.3 §8.2). Aceite: nenhuma transição fora dele em 1.000 partidas. */
export const HUNTER_TRANSITIONS: Readonly<Record<HunterMode, readonly HunterMode[]>> = {
  patrol: ["investigate", "chase"],
  investigate: ["patrol", "chase"],
  chase: ["attack", "investigate", "patrol"],
  attack: ["recoil", "chase"],
  recoil: ["cage", "chase"],
  cage: ["patrol"],
};

/** efeitos da partida que a IA usa (injetados por game.ts para evitar import circular) */
export interface HunterEffects {
  hit(s: Survivor, damage: number): void;
  collide(p: Vec, r: number): void;
  /** revelação periódica (regra da partida, GDD-v0.2 §2.3) */
  reveal(alive: Survivor[]): void;
}

// Tolerância de ponto flutuante na comparação de tempos acumulados em passos de 1/60 s (técnica, não é número de jogo).
const EPS = 1e-9;
/** modos de perseguição (§8.2): neles o alvo lembrado segura a histerese do §8.3 */
const CHASE_MODES: readonly HunterMode[] = ["chase", "attack", "recoil"];
const TAU = Math.PI * 2;
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);
const v2 = (p: P2): Vec => ({ x: p[0], z: p[1] });
const p2 = (v: Vec): P2 => [v.x, v.z];

export function newHunterAi(): HunterAi {
  return {
    mode: "patrol", perceiveIn: 0, decideIn: 0, percept: null, noticed: [], target: -1, score: 0, switchedAt: 0, protection: [],
    memory: null, investigate: null, heard: null, patrol: null, goal: null, path: [], pathOk: true, forceAstar: false,
    loop: null, seenTarget: -1, intercept: null, captured: false, stuck: { t: 0, x: 0, z: 0, ex: 0, ez: 0 }, speed: 0, step: { x: 0, z: 0 }, replans: 0,
  };
}

/** troca de estado; só aceita arestas do grafo (erro = bug da IA, pego pelos testes e pelo simulador) */
export function setMode(cfg: SimConfig, t: number, ai: HunterAi, to: HunterMode) {
  if (ai.mode === to) return;
  if (!HUNTER_TRANSITIONS[ai.mode].includes(to)) throw new Error(`transição inválida do caçador: ${ai.mode} → ${to}`);
  cfg.trace?.({ t, from: ai.mode, to });
  ai.mode = to;
}

/** ponto navegável mais próximo (grade de reserva); o próprio ponto se não houver grade */
export function project(cfg: SimConfig, p: Vec): Vec {
  const q = cfg.grid?.nearestFree(p2(p));
  return q ? v2(q) : { x: p.x, z: p.z };
}

// ---------- loops (GDD-v0.3 §8.4) ----------

function segDist(p: Vec, a: P2, b: P2): number {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.z - a[1]) * dz) / l2)) : 0;
  return Math.hypot(p.x - (a[0] + t * dx), p.z - (a[1] + t * dz));
}

/** ponto da rota do loop mais próximo de p */
function closestOnLoop(l: MapLoop, p: Vec): Vec {
  let best: Vec = v2(l.polygon[0]), bd = Infinity;
  for (let i = 0; i < l.polygon.length; i++) {
    const a = l.polygon[i], b = l.polygon[(i + 1) % l.polygon.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.z - a[1]) * dz) / l2)) : 0;
    const q = { x: a[0] + t * dx, z: a[1] + t * dz }, d = dist(q, p);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

/** loop (dos metadados do mapa) em cuja rota o ponto está, a até `ai.loop_band`; o mais próximo */
export function loopAt(cfg: SimConfig, p: Vec): MapLoop | null {
  let best: MapLoop | null = null, bd = Infinity;
  for (const l of cfg.map.loops ?? []) {
    let d = Infinity;
    for (let i = 0; i < l.polygon.length; i++) d = Math.min(d, segDist(p, l.polygon[i], l.polygon[(i + 1) % l.polygon.length]));
    if (d <= cfg.balance.ai.loop_band && d < bd) { bd = d; best = l; }
  }
  return best;
}

const centroid = (l: MapLoop): Vec => ({
  x: l.polygon.reduce((s, p) => s + p[0], 0) / l.polygon.length,
  z: l.polygon.reduce((s, p) => s + p[1], 0) / l.polygon.length,
});

/** soma ao contador de voltas o ângulo de `p` em volta do centro do loop; nova fonte só fixa o ângulo de partida */
function accumulate(ai: HunterAi, l: MapLoop, target: number, p: Vec, src: "target" | "self"): number {
  const c = centroid(l), ang = Math.atan2(p.z - c.z, p.x - c.x);
  if (ai.loop && ai.loop.id === l.id && ai.loop.target === target) {
    if (ai.loop.src === src) {
      let d = ang - ai.loop.last;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      ai.loop.acc += d;
    }
    ai.loop.last = ang; ai.loop.src = src;
  } else ai.loop = { id: l.id, target, acc: 0, last: ang, src };
  return Math.abs(ai.loop.acc) / TAU;
}

/** atualiza a contagem de voltas do alvo percebido em torno do loop (ângulo acumulado em volta do centro ÷ 2π) */
export function trackLoop(cfg: SimConfig, ai: HunterAi, s: SeenSurvivor): { loop: MapLoop; laps: number } | null {
  const l = loopAt(cfg, s);
  if (!l) { ai.loop = null; return null; }
  return { loop: l, laps: accumulate(ai, l, s.id, s, "target") };
}

/**
 * Alvo fora de vista, mas lembrado (R8 passo 1; GDD-v0.3 §8.4 "2 voltas no mesmo obstáculo"): no loop o alvo some
 * atrás do obstáculo a cada meia volta, e zerar a contagem aí impediria o Normal de chegar às 2 voltas. Enquanto a
 * memória do alvo vale, a contagem continua com o ângulo do próprio caçador em volta do mesmo obstáculo (ele segue o
 * alvo pela rota; só usa a própria posição e os metadados do mapa). Memória expirada ou de outro alvo: zera.
 */
// LACUNA (aproximação, GDD v0.3 §8.4): com o alvo só lembrado, as voltas são contadas pelo ângulo do PRÓPRIO caçador em
// volta do obstáculo; na troca de fonte (alvo visto ↔ caçador) o trecho entre as duas posições é descartado (conta a
// menos, conservador) e, se o alvo saiu do loop sem ser visto, o caçador ainda conta voltas até a memória expirar.
export function trackLoopMemory(cfg: SimConfig, ai: HunterAi, self: Vec, t: number): void {
  const m = ai.memory, lp = ai.loop;
  if (!lp || !m || m.id !== lp.target || m.until <= t) { ai.loop = null; return; }
  const l = (cfg.map.loops ?? []).find(x => x.id === lp.id);
  if (!l) { ai.loop = null; return; }
  accumulate(ai, l, lp.target, self, "self");
}

/**
 * Pode usar dash/projétil contra um alvo em loop? (GDD-v0.3 §8.4) "none" (Fácil): não quebra loop; "partial"
 * (Normal): depois de `ai.loop_partial_laps_before_break` voltas; "full" (Difícil) e "avoid_long" (Pesadelo): já na
 * primeira volta. Fora de loop, sempre.
 */
export function canBreakLoop(cfg: SimConfig, onLoop: { laps: number } | null): boolean {
  if (!onLoop) return true;
  switch (cfg.aiLevel.loop_knowledge) {
    case "none": return false;
    case "partial": return onLoop.laps + EPS >= cfg.balance.ai.loop_partial_laps_before_break;
    default: return true;
  }
}

// ---------- projétil (GDD-v0.3 §8.4) ----------

/**
 * Ponto de mira. "none" (Fácil, Normal): posição percebida. "linear" e "linear_static": posição prevista com a
 * velocidade percebida do alvo (interceptação de velocidade constante: |p + v·t − h| = velocidade × t).
 */
export function aimPoint(cfg: SimConfig, from: Vec, s: SeenSurvivor): Vec {
  if (cfg.aiLevel.projectile_lead === "none") return { x: s.x, z: s.z };
  const sp = cfg.balance.hunter.projectile.speed;
  const rx = s.x - from.x, rz = s.z - from.z;
  const a = s.vx * s.vx + s.vz * s.vz - sp * sp, b = 2 * (rx * s.vx + rz * s.vz), c = rx * rx + rz * rz;
  let t: number;
  if (Math.abs(a) < EPS) t = b < 0 ? -c / b : -1;
  else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return { x: s.x, z: s.z };
    const r = Math.sqrt(disc), t1 = (-b - r) / (2 * a), t2 = (-b + r) / (2 * a);
    t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
  }
  if (!(t > 0)) return { x: s.x, z: s.z };
  return { x: s.x + s.vx * t, z: s.z + s.vz * t };
}

/** "alvo parado" (Pesadelo): não atira em alvo parado atrás de obstáculo */
export function projectileAllowed(cfg: SimConfig, from: Vec, s: SeenSurvivor): boolean {
  if (cfg.aiLevel.projectile_lead !== "linear_static") return true;
  const still = Math.hypot(s.vx, s.vz) < cfg.balance.ai.static_target_speed;
  return !(still && !lineOfSight(cfg.map, from, s));
}

// ---------- decisão (10 Hz) ----------

/**
 * Destino da patrulha (GDD-v0.3 §8.2): gerador não concluído sorteado com peso proporcional ao progresso (todos
 * zerados = peso igual), sem repetir `prev` quando há outro; na pressão final, ponto em volta do portão.
 */
export function choosePatrol(cfg: SimConfig, rng: { seed: number }, p: Percept, prev: number): { x: number; z: number; gen: number } {
  if (!p.finalPressure) {
    // §8.2: visita geradores com peso proporcional ao progresso (todos zerados = peso igual); concluídos ficam de fora
    let idx = p.gens.map((x, i) => (x.done ? -1 : i)).filter(i => i >= 0);
    if (idx.length > 1) idx = idx.filter(i => i !== prev);
    if (idx.length) {
      const w = idx.map(i => p.gens[i].progress), total = w.reduce((s, x) => s + x, 0);
      let r = nextRandom(rng) * (total > 0 ? total : idx.length), k = 0;
      for (; k < idx.length - 1; k++) { r -= total > 0 ? w[k] : 1; if (r < 0) break; }
      const gen = p.gens[idx[k]];
      return { ...project(cfg, gen), gen: idx[k] };
    }
  }
  // pressão final: patrulha o portão (pontos sorteados em volta dele)
  return { ...searchSpot(cfg, rng, p.gate, p.self), gen: -1 };
}

function around(c: Vec, radius: number, rng: { seed: number }): Vec {
  const ang = nextRandom(rng) * TAU, r = radius * Math.sqrt(nextRandom(rng));
  return { x: c.x + Math.cos(ang) * r, z: c.z + Math.sin(ang) * r };
}

/**
 * Ponto navegável em volta de `c` (até `ai.search_radius`): o mais distante de `from` entre as amostras que não
 * precisaram de projeção maior que uma célula da grade; sem nenhuma assim, o mais distante de todas.
 */
export function searchSpot(cfg: SimConfig, rng: { seed: number }, c: Vec, from: Vec): Vec {
  let best: Vec | null = null, bd = -1, inside = false;
  // `ai.search_samples` (LACUNA): perto de quinas a maior parte dos sorteios cai fora da área navegável e a projeção
  // os junta no mesmo canto; ficar com o mais distante entre amostras já navegáveis evita o vaivém
  for (let i = 0; i < cfg.balance.ai.search_samples; i++) {
    const raw = around(c, cfg.balance.ai.search_radius, rng), q = project(cfg, raw), d = dist(q, from);
    const ok = dist(raw, q) <= cfg.balance.nav.fallback_grid;
    if ((ok && !inside) || (ok === inside && d > bd)) { bd = d; best = q; inside = ok; }
  }
  return best!;
}

/**
 * Decisão a partir do Percept (GDD-v0.3 §8.1–§8.4). Não recebe o GameState: só a leitura filtrada, o próprio
 * caçador (recargas, preparo) e o PRNG. Pode iniciar um preparo (telegraph) em `H.windup`.
 */
export function think(cfg: SimConfig, H: Hunter, ai: HunterAi, p: Percept, rng: { seed: number }) {
  const b = cfg.balance, h = b.hunter, lvl = cfg.aiLevel, t = p.t;
  // tempo de reação (GDD-v0.2 §8.4): quem acabou de aparecer só vira candidato depois de `reaction`
  ai.noticed = p.survivors.map(s => ai.noticed.find(n => n.id === s.id) ?? { id: s.id, at: t });
  const ready = (id: number) => t - ai.noticed.find(n => n.id === id)!.at + EPS >= lvl.reaction;
  const candidates = p.survivors.filter(s => !s.antiTunnel && ready(s.id));
  // D-52: "protegido" (§8.3) com histerese de tempo mínimo no estado: a leitura instantânea (Atacador a menos de
  // `ai.protected_radius`) só muda o termo depois de ficar `ai.protected_hold` seguido no valor oposto. Primeira vez
  // que o caçador vê o sobrevivente: vale a leitura instantânea. Fora de vista, o estado fica como estava.
  for (const s of p.survivors) {
    const raw = nearAttacker(cfg, p, s), e = ai.protection.find(x => x.id === s.id);
    if (!e) ai.protection.push({ id: s.id, on: raw, since: -1 });
    else if (raw === e.on) e.since = -1;
    else if (e.since < 0) e.since = t;
    else if (t - e.since + EPS >= b.ai.protected_hold) { e.on = raw; e.since = -1; }
  }
  const held = ai.protection.filter(x => x.on).map(x => x.id);
  // alvo perseguido (visto ou lembrado) antes desta decisão: a troca dentro da perseguição encerra o episódio na
  // métrica do §8.5 (gancho `traceTarget`, só observação)
  const pursuedBefore = ai.target >= 0 ? ai.target : ai.memory && ai.memory.until > t ? ai.memory.id : -1;
  // §8.3 (histerese) com a D-35: o alvo perseguido pela memória (fora de vista) continua sendo o atual; outro só
  // toma o lugar com placar acima do último placar dele mais a margem (correção do aceite "não alterna de alvo mais
  // de 1 vez por segundo")
  const remembered = pursuedBefore >= 0 && CHASE_MODES.includes(ai.mode) && !ai.captured ? { id: pursuedBefore, score: ai.score } : undefined;
  const choice = chooseTarget(cfg, p, candidates, pursuedBefore, remembered, held);
  if (choice) {
    if (choice.id !== ai.target) ai.switchedAt = t;
    ai.target = choice.id; ai.score = choice.score;
  } else { ai.target = -1; if (!remembered) ai.score = 0; ai.intercept = null; trackLoopMemory(cfg, ai, p.self, t); }
  const tgt = choice ? p.survivors.find(s => s.id === choice.id)! : null;
  // reencontro (R8 passo 1): o alvo perseguido (visto ou lembrado) volta ao cone depois de não estar visível na
  // decisão anterior
  const reacquired = !!tgt && tgt.visible && tgt.id === pursuedBefore && ai.seenTarget !== tgt.id;
  ai.seenTarget = tgt && tgt.visible ? tgt.id : -1;
  if (tgt) ai.memory = { id: tgt.id, x: tgt.x, z: tgt.z, until: t + lvl.memory, vx: tgt.vx, vz: tgt.vz, ax: tgt.x, az: tgt.z };
  if (tgt && pursuedBefore >= 0 && tgt.id !== pursuedBefore && (ai.mode === "chase" || ai.mode === "attack" || ai.mode === "recoil")) {
    cfg.traceTarget?.({ t, target: tgt.id, from: pursuedBefore });
  }

  // audição (§8.1): investiga a posição do som depois do tempo de reação
  let heard: { x: number; z: number; until: number } | null = null;
  if (p.heard && t - p.heard.at + EPS >= lvl.reaction) {
    heard = { x: p.heard.x, z: p.heard.z, until: p.heard.at + p.heard.dur };
    if (ai.heard && ai.heard.at === p.heard.at) ai.heard = null;
  }

  switch (ai.mode) {
    case "cage":
      setMode(cfg, t, ai, "patrol");
      return;
    case "attack":
    case "recoil":
      return; // resolvidos na ação (fim do preparo e fim do recuo)
  }

  if (tgt) {
    if (ai.mode !== "chase") { setMode(cfg, t, ai, "chase"); ai.investigate = null; }
    chaseActions(cfg, H, ai, p, tgt, reacquired);
  } else if (ai.mode === "chase") {
    // D-35 (§8.1 memória, §8.2): sem o alvo à vista, segue em Perseguir enquanto a memória vale (indo à última
    // posição conhecida e projetando a fuga, ver `chaseMemoryGoal`); Investigar só quando a memória expira, em volta
    // do último ponto, por `ai.memory_investigate_time`. LACUNA: ruído ouvido enquanto persegue pela memória é ignorado
    // (o caçador não sabe quem o fez; seguir o ruído trocaria de alvo sem vê-lo)
    const m = ai.memory;
    if (!m) setMode(cfg, t, ai, "patrol");
    else if (m.until <= t) {
      setMode(cfg, t, ai, "investigate");
      ai.investigate = { x: m.x, z: m.z, until: t + b.ai.memory_investigate_time, spot: null };
    }
  } else if (heard && heard.until > t) {
    if (ai.mode === "patrol") setMode(cfg, t, ai, "investigate");
    ai.investigate = { x: heard.x, z: heard.z, until: heard.until, spot: null };
  } else if (ai.mode === "investigate" && (!ai.investigate || ai.investigate.until <= t)) {
    setMode(cfg, t, ai, "patrol");
    ai.investigate = null;
  }
  // §8.2 (R8 passo 1): o destino da patrulha também muda quando o gerador de destino foi concluído no caminho
  // (concluídos não entram no sorteio) e quando a pressão final começa (passa a patrulhar o portão)
  const stale = ai.patrol && ai.patrol.gen >= 0 && (p.finalPressure || p.gens[ai.patrol.gen]?.done);
  if (ai.mode === "patrol" && (!ai.patrol || stale)) ai.patrol = choosePatrol(cfg, rng, p, ai.patrol?.gen ?? -1);

  // armadilha (GDD-v0.2 §2.3) com telegraph (§4.1); fora do ataque (o golpe ocupa o preparo)
  if (H.trap <= 0 && !H.windup) {
    H.trap = cfg.trapInterval;
    H.windup = { kind: "trap", t: h.telegraph_min, total: h.telegraph_min };
  }
}

/**
 * Perseguir: golpe no alcance (vira Atacar), projétil e dash conforme loops e previsão da dificuldade. Reencontro de
 * alvo ferido a menos de `ai.dash_reacquire_dist` (R8 passo 1): o dash vem antes do projétil, porque termina no
 * alcance do golpe. Faixa de uso, recargas, telegraph e conhecimento de loops valem como sempre.
 */
function chaseActions(cfg: SimConfig, H: Hunter, ai: HunterAi, p: Percept, s: SeenSurvivor, reacquired: boolean) {
  const h = cfg.balance.hunter, d = dist(p.self, s);
  const onLoop = trackLoop(cfg, ai, s);
  // Pesadelo, "evita loops longos": não segue o alvo pela rota do loop; corta pelo navmesh até o ponto da rota
  // onde ele estará quando o caçador chegar (velocidade percebida × tempo de chegada)
  ai.intercept = null;
  if (onLoop && cfg.aiLevel.loop_knowledge === "avoid_long" && polygonPerimeter(onLoop.loop.polygon) > cfg.balance.maps.loop_long_perimeter_min
    && cfg.grid && !cfg.grid.lineOfSight(p2(p.self), p2(s))) {
    const tau = d / cfg.chaseSpeed;
    ai.intercept = project(cfg, closestOnLoop(onLoop.loop, { x: s.x + s.vx * tau, z: s.z + s.vz * tau }));
  }
  if (H.windup || H.dashing > 0) return;
  // D-50: só prepara o golpe com linha de visão até o alvo (não tenta golpear pela quina; segue perseguindo em volta)
  if (d < h.melee.range && H.atk <= 0 && lineOfSight(cfg.map, p.self, s)) {
    setMode(cfg, p.t, ai, "attack");
    H.windup = { kind: "melee", t: h.telegraph_min, total: h.telegraph_min };
    return;
  }
  if (!canBreakLoop(cfg, onLoop)) return;
  const dashOk = H.dash <= 0 && s.visible && d > h.dash.min && d < h.dash.max && lineOfSight(cfg.map, p.self, s);
  if (dashOk && reacquired && s.hp < cfg.balance.survivor.wounded_hp && d < cfg.balance.ai.dash_reacquire_dist) {
    H.dash = h.dash.cooldown;
    H.windup = { kind: "dash", t: h.telegraph_min, total: h.telegraph_min };
    return;
  }
  if (H.projectile <= 0 && d > h.projectile.min && d < h.projectile.max && projectileAllowed(cfg, p.self, s)) {
    H.projectile = h.projectile.cooldown;
    H.windup = { kind: "projectile", t: h.telegraph_min, total: h.telegraph_min };
    return;
  }
  // dash só com linha de visão (é em linha reta); o preparo dá o telegraph do §4.1
  if (dashOk) {
    H.dash = h.dash.cooldown;
    H.windup = { kind: "dash", t: h.telegraph_min, total: h.telegraph_min };
  }
}

// ---------- ação (60 Hz) ----------

/** passo do caçador com a IA do R3 */
export function updateHunterAi(cfg: SimConfig, g: GameState, dt: number, fx: HunterEffects) {
  const b = cfg.balance, h = b.hunter, H = g.hunter, ai = H.ai!;
  if (H.stun > 0) {
    // atordoar cancela o preparo (contra-jogo, GDD-v0.2 §4.1)
    H.stun -= dt; H.windup = null; idle(ai);
    if (ai.mode === "attack") setMode(cfg, g.t, ai, "chase");
    resetStuck(ai, H);
    return;
  }
  H.atk -= dt; H.dash -= dt; H.projectile -= dt; H.trap -= dt; H.dashing -= dt; H.alertTime -= dt; H.slow -= dt;
  H.recoil -= dt; g.reveal -= dt;
  const alive = g.survivors.filter(s => s.st === "ok");
  if (alive.length) fx.reveal(alive);
  else {
    // ninguém livre (todos presos, mortos ou fora): cancela o preparo e segue patrulhando
    H.windup = null;
    if (ai.mode === "attack") setMode(cfg, g.t, ai, "chase");
  }

  // preparo que já existia antes da decisão deste passo: só ele é descontado agora (o que nasce neste passo fica
  // visível por inteiro, ≥ `hunter.telegraph_min`, GDD-v0.2 §4.1)
  const prevWindup = H.windup;
  // leitura e decisão a 10 Hz: a primeira no passo inicial, depois a cada 1/hz (o resto do intervalo é mantido)
  if (ai.perceiveIn <= EPS) { ai.percept = perceive(cfg, g, ai.percept); ai.perceiveIn += 1 / b.ai.perception_hz; }
  if (ai.decideIn <= EPS) { think(cfg, H, ai, ai.percept!, g); ai.decideIn += 1 / b.ai.decision_hz; }
  ai.perceiveIn -= dt; ai.decideIn -= dt;
  // campos expostos ao cliente (mesmo significado do R1)
  H.target = ai.target;
  if (ai.investigate) { H.alert = { x: ai.investigate.x, z: ai.investigate.z }; H.alertTime = ai.investigate.until - g.t; }
  H.patrol = ai.patrol ? { x: ai.patrol.x, z: ai.patrol.z } : null;

  if (ai.mode === "recoil") {
    // recuo pós-golpe: parado e sem agir (GDD-v0.2 §4.3); depois Prender (se capturou) ou volta a Perseguir
    if (H.recoil > 0) { idle(ai); resetStuck(ai, H); return; }
    setMode(cfg, g.t, ai, ai.captured ? "cage" : "chase");
    ai.captured = false;
  }

  const seen = ai.percept?.survivors.find(s => s.id === ai.target) ?? null;
  let goal: Vec | null = null, stopAt = 0;
  if (ai.mode === "chase" && !seen && ai.memory) chaseMemoryGoal(cfg, g, H, ai.memory);
  if (ai.mode === "chase" || ai.mode === "attack") {
    goal = ai.intercept ?? (seen ? { x: seen.x, z: seen.z } : ai.memory ? { x: ai.memory.x, z: ai.memory.z } : null);
    stopAt = ai.intercept ? 0 : h.radius + b.survivor.radius;
  } else if (ai.mode === "investigate" && ai.investigate) {
    const inv = ai.investigate;
    if (!inv.spot) inv.spot = project(cfg, inv);
    if (dist(H, inv.spot) < b.ai.patrol_reach) inv.spot = searchSpot(cfg, g, inv, H);
    goal = inv.spot;
  } else if (ai.mode === "patrol" && ai.percept) {
    if (!ai.patrol || dist(H, ai.patrol) < b.ai.patrol_reach) ai.patrol = choosePatrol(cfg, g, ai.percept, ai.patrol?.gen ?? -1);
    goal = ai.patrol;
  }

  let sp = (ai.mode === "chase" || ai.mode === "attack" ? cfg.chaseSpeed : h.patrol_speed) * (g.gateStarted ? h.final_pressure_speed_mult : 1);
  if (H.dashing > 0) sp = h.dash.speed;
  if (H.slow > 0) sp *= b.classes.mechanic.bolt.slow;

  if (H.dashing > 0 && seen) moveStraight(cfg, H, ai, seen, sp, dt, fx);
  else if (goal && dist(H, goal) > stopAt) followPath(cfg, H, ai, goal, sp, dt, fx);
  else {
    idle(ai);
    if (seen) H.a = Math.atan2(-(seen.x - H.x), -(seen.z - H.z)); // parado junto ao alvo: olha para ele
  }
  antiStuck(cfg, H, ai, dt);

  if (H.windup) {
    if (seen && (H.windup.kind === "melee" || H.windup.kind === "projectile")) H.a = Math.atan2(-(seen.x - H.x), -(seen.z - H.z));
    if (H.windup !== prevWindup) return;
    H.windup.t -= dt;
    if (H.windup.t > EPS) return;
    const kind = H.windup.kind;
    H.windup = null;
    release(cfg, g, ai, kind, seen, fx);
  }
}

/**
 * Perseguir só pela memória (D-35): ao chegar à última posição conhecida, projeta a direção de fuga com a última
 * velocidade percebida, `ai.chase_projection` metros à frente (ponto navegável mais próximo). Repete a cada chegada.
 * Sem projeção possível (alvo parado ou parede à frente), vasculha em volta do último ponto (`searchSpot`, até
 * `ai.search_radius`) até a memória expirar, em vez de ficar parado.
 */
export function chaseMemoryGoal(cfg: SimConfig, rng: { seed: number }, H: Vec, m: NonNullable<HunterAi["memory"]>) {
  const b = cfg.balance;
  if (dist(H, m) > b.ai.patrol_reach) return;
  const k = Math.hypot(m.vx, m.vz);
  if (k >= b.ai.static_target_speed) {
    const q = project(cfg, { x: m.x + (m.vx / k) * b.ai.chase_projection, z: m.z + (m.vz / k) * b.ai.chase_projection });
    if (dist(q, m) > b.nav.fallback_grid) { m.x = q.x; m.z = q.z; m.ax = q.x; m.az = q.z; return; }
    m.vx = 0; m.vz = 0; // parede à frente: a projeção acabou, passa a vasculhar
  }
  const q = searchSpot(cfg, rng, { x: m.ax, z: m.az }, H);
  m.x = q.x; m.z = q.z;
}

function release(cfg: SimConfig, g: GameState, ai: HunterAi, kind: "melee" | "dash" | "projectile" | "trap", seen: SeenSurvivor | null, fx: HunterEffects) {
  const h = cfg.balance.hunter, H = g.hunter;
  if (kind === "dash") { H.dashing = h.dash.duration; return; }
  if (kind === "trap") { g.traps.push({ id: g.nextId++, x: H.x, z: H.z }); return; }
  if (kind === "projectile") {
    const aim = seen ? aimPoint(cfg, H, seen) : ai.memory ? { x: ai.memory.x, z: ai.memory.z } : null;
    if (!aim) return;
    const dx = aim.x - H.x, dz = aim.z - H.z, k = Math.hypot(dx, dz) || 1;
    g.projectiles.push({ id: g.nextId++, x: H.x, z: H.z, vx: (dx / k) * h.projectile.speed, vz: (dz / k) * h.projectile.speed, t: cfg.balance.prototype_extras.projectile_life });
    return;
  }
  // golpe: sai no fim do preparo e só acerta se o alvo ainda estiver no alcance e com linha de visão (D-50, mesma
  // função da percepção); recarga gasta mesmo errando
  H.atk = cfg.meleeCooldown;
  const c = g.survivors.find(s => s.id === ai.target);
  if (c && c.st === "ok" && dist(c, H) < h.melee.range && lineOfSight(cfg.map, H, c)) {
    fx.hit(c, g.gateStarted ? h.melee.damage_final : h.melee.damage);
    H.recoil = h.melee.recoil;
    ai.captured = c.st !== "ok";
    setMode(cfg, g.t, ai, "recoil");
  } else setMode(cfg, g.t, ai, "chase");
}

// ---------- navegação (GDD-v0.3 §8.6) ----------

function moveStraight(cfg: SimConfig, H: Hunter, ai: HunterAi, to: Vec, sp: number, dt: number, fx: HunterEffects) {
  const dx = to.x - H.x, dz = to.z - H.z, k = Math.hypot(dx, dz);
  const step = Math.min(sp * dt, k);
  ai.speed = step / dt;
  const x0 = H.x, z0 = H.z;
  if (k > 0) { H.x += (dx / k) * step; H.z += (dz / k) * step; H.a = Math.atan2(-dx, -dz); }
  intend(ai, H.x - x0, H.z - z0);
  fx.collide(H, cfg.balance.hunter.radius);
}

/**
 * Segue o caminho até `goal`. Replaneja quando o destino anda mais que uma célula da grade (`nav.fallback_grid`),
 * quando o caminho acaba ou quando o anti-travamento pede. Com linha livre para o agente, vai reto (sem A*).
 */
function followPath(cfg: SimConfig, H: Hunter, ai: HunterAi, goal: Vec, sp: number, dt: number, fx: HunterEffects) {
  const grid = cfg.grid!, nav = cfg.nav!;
  if (ai.forceAstar || !ai.goal || !ai.path.length || dist(ai.goal, goal) > cfg.balance.nav.fallback_grid) {
    if (!ai.forceAstar && grid.lineOfSight(p2(H), p2(goal))) { ai.path = [goal]; ai.pathOk = true; }
    else {
      const path = nav.findPath(p2(H), p2(goal));
      ai.pathOk = path.length > 0;
      // sem caminho (destino fora da área navegável): tenta o ponto navegável mais próximo dele
      const alt = ai.pathOk ? path : nav.findPath(p2(H), p2(project(cfg, goal)));
      if (!ai.pathOk && alt.length) ai.pathOk = true;
      ai.path = alt.length ? alt.slice(1).map(v2) : [goal];
      if (!ai.path.length) ai.path = [goal];
    }
    ai.goal = { x: goal.x, z: goal.z };
    ai.forceAstar = false;
  }
  let budget = sp * dt;
  const x0 = H.x, z0 = H.z;
  let dirX = 0, dirZ = 0;
  while (budget > EPS && ai.path.length) {
    const w = ai.path[0], d = dist(H, w);
    if (!dirX && !dirZ && d > EPS) { dirX = w.x - H.x; dirZ = w.z - H.z; }
    if (d <= budget) { H.x = w.x; H.z = w.z; budget -= d; ai.path.shift(); }
    else { H.x += ((w.x - H.x) / d) * budget; H.z += ((w.z - H.z) / d) * budget; budget = 0; }
  }
  ai.speed = (sp * dt - budget) / dt;
  intend(ai, H.x - x0, H.z - z0);
  fx.collide(H, cfg.balance.hunter.radius);
  if (dirX || dirZ) H.a = Math.atan2(-dirX, -dirZ);
  else if (H.x !== x0 || H.z !== z0) H.a = Math.atan2(-(H.x - x0), -(H.z - z0));
}

function resetStuck(ai: HunterAi, H: Vec) { ai.stuck = { t: 0, x: H.x, z: H.z, ex: 0, ez: 0 }; }
function idle(ai: HunterAi) { ai.speed = 0; ai.step = { x: 0, z: 0 }; }
function intend(ai: HunterAi, dx: number, dz: number) { ai.step = { x: dx, z: dz }; ai.stuck.ex += dx; ai.stuck.ez += dz; }

/**
 * Anti-travamento (`ai.anti_stuck`, GDD-v0.3 §8.6): deslocamento real na janela abaixo de `min_progress_ratio` do
 * esperado → replaneja pelo A*. "Esperado" = soma vetorial do que a IA tentou andar (velocidade pretendida × dt):
 * colisão com parede reduz o real e não o esperado; meia-volta de propósito reduz os dois e não conta como trava.
 */
function antiStuck(cfg: SimConfig, H: Hunter, ai: HunterAi, dt: number) {
  const a = cfg.balance.ai.anti_stuck;
  ai.stuck.t += dt;
  if (ai.stuck.t + EPS < a.window) return;
  const moved = Math.hypot(H.x - ai.stuck.x, H.z - ai.stuck.z), expected = Math.hypot(ai.stuck.ex, ai.stuck.ez);
  if (expected > EPS && moved < a.min_progress_ratio * expected) {
    ai.forceAstar = true; ai.path = []; ai.replans++;
  }
  resetStuck(ai, H);
}
