// Textos do jogo montados a partir das chaves de tradução (i18n/, GDD v0.3 §12.5).
// Números vêm dos dados: o protótipo mostrava recargas desatualizadas no menu (P-11).
import type { Balance } from "@thehell/shared";
import type { Arrow, ClassName, EndReason, GameEvent, Individual, MsgKey, Outcome, Team } from "@thehell/sim";
import type { Direction } from "./hud/threat.ts";
import { t, type Key } from "./i18n/index.ts";

/** identificador da classe em `balance.classes` e nas chaves `class.*` */
export const CLASS_ID: Record<ClassName, "healer" | "mechanic" | "fighter"> = {
  Curandeiro: "healer", Mecânico: "mechanic", Atacador: "fighter",
};

const CLASS_NAME: Record<ClassName, Key> = { Curandeiro: "class.healer", Mecânico: "class.mechanic", Atacador: "class.fighter" };
const CLASS_DESC: Record<ClassName, Key> = { Curandeiro: "class.healer.desc", Mecânico: "class.mechanic.desc", Atacador: "class.fighter.desc" };

/** nome da classe no idioma atual */
export const className = (cls: ClassName) => t(CLASS_NAME[cls]);

export function classDescription(b: Balance, cls: ClassName): string {
  const c = b.classes;
  return t(CLASS_DESC[cls], {
    cooldown: c.healer.cooldown, turbo: c.mechanic.turbo.cooldown, bolt: c.mechanic.bolt.cooldown,
    stun: c.fighter.strike.stun, block: c.fighter.block.cooldown,
  });
}

/** `gate`: abertura do portão da partida (no v1 vem da dificuldade, `SimConfig.gateTime`; padrão `generator.gate_time`) */
export function goalText(b: Balance, generators: number, bonus: number, gate: number = b.generator.gate_time): string {
  return t("menu.goal", { generators, puzzles: b.generator.puzzles_per_generator, gate, bonus });
}

const MSG: Record<MsgKey, Key> = {
  puzzle_points: "msg.puzzle_points", gen_done: "msg.gen_done", bonus_done: "msg.bonus_done", spark: "msg.spark",
  heal_pulse: "msg.heal_pulse", turbo: "msg.turbo", block_on: "msg.block_on", bolt_hit: "msg.bolt_hit",
  strike_hit: "msg.strike_hit", blocked: "msg.blocked", caged: "msg.caged", died: "msg.died", rescued: "msg.rescued",
  trap_caught: "msg.trap_caught", trap_disarmed: "msg.trap_disarmed", revealed: "msg.revealed",
  gate_countdown: "msg.gate_countdown", gate_open: "msg.gate_open",
};

export function messageText(e: Extract<GameEvent, { type: "msg" }>): string {
  return t(MSG[e.key], { n: e.n ?? 0, cls: e.cls ? className(e.cls) : "" });
}

const END_PROTOTYPE: Record<Outcome, [Key, Key]> = {
  escaped: ["end.escaped.title", "end.escaped.sub"],
  hunter_down: ["end.hunter_down.title", "end.hunter_down.sub"],
  died: ["end.died.title", "end.died.sub"],
};

/**
 * Título e subtítulo da tela de fim. No v1 (evento com `team`, `reason` e `individual`, GDD-v0.3 §3.3 revisto) o
 * título é o resultado individual e o subtítulo diz quem venceu, por quê e o que vale para o jogador; no protótipo
 * vale o texto da fase 0 por `outcome`.
 */
export function endText(e: Extract<GameEvent, { type: "end" }>, b: Balance): [string, string] {
  if (e.team && e.reason && e.individual) return endTextV1(e.team, e.reason, e.individual, b);
  const [title, sub] = END_PROTOTYPE[e.outcome];
  return [t(title), t(sub)];
}

export function endTextV1(team: Team, reason: EndReason, individual: Individual, b: Balance): [string, string] {
  const sub = `${t("end.v1.team", { team })}: ${t("end.v1.reason", { reason, limit: b.match.hard_time_limit })} ${t("end.v1.individual", { individual })}`;
  return [t("end.v1.title", { individual }), sub];
}

export const endStats = (e: Extract<GameEvent, { type: "end" }>) => t("end.stats", { time: e.time, coins: e.coins });

const SKIN: Record<string, Key> = {
  std: "skin.std", abo: "skin.abo", som: "skin.som", neo: "skin.neo", car: "skin.car", our: "skin.our", fan: "skin.fan",
};
/** nome da skin no idioma atual (id cru se a skin não tiver chave) */
export const skinName = (id: string) => (SKIN[id] ? t(SKIN[id]) : id);

export const ARROW_LABEL: Record<Arrow, Key> = {
  left: "puzzle.arrow.left", up: "puzzle.arrow.up", right: "puzzle.arrow.right", down: "puzzle.arrow.down",
};

const DIR: Record<Direction, Key> = {
  front: "dir.front", front_right: "dir.front_right", right: "dir.right", back_right: "dir.back_right",
  back: "dir.back", back_left: "dir.back_left", left: "dir.left", front_left: "dir.front_left",
};
/** direção relativa no idioma atual ("aqui" sem direção) */
export const directionText = (d: Direction | null) => t(d ? DIR[d] : "dir.here");

/** nome de cada tipo de `ui.ping_types` (um teste garante que todo tipo dos dados tem nome) */
export const PING_NAME: Record<string, Key> = {
  generator_here: "ping.generator_here", hunter_here: "ping.hunter_here", need_help: "ping.need_help",
  going_to_rescue: "ping.going_to_rescue",
};
export const pingName = (type: string) => (PING_NAME[type] ? t(PING_NAME[type]) : type);
