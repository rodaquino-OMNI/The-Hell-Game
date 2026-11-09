// Escolha de alvo por utilidade (GDD-v0.3 §8.3; fórmula do GDD-v0.2 §8.3 e Apêndice C). Funções puras sobre o
// Percept: os termos usam só sobreviventes percebidos (aliado fora de vista conta como ausente).
import type { SimConfig } from "../config.ts";
import type { Percept, SeenSurvivor } from "../types.ts";

export interface UtilityTerms {
  /** 1 − distância ÷ raio de detecção, limitado a [0, 1] */
  proximity: number;
  /** fração do gerador em que o alvo trabalha (0 se não trabalha) */
  progress: number;
  /** 1 se a vida estiver abaixo de `survivor.wounded_hp` (GDD-v0.3 §8.3; fonte única do limiar de ferido) */
  injured: number;
  /** 1 se não há aliado percebido a menos de `ai.isolated_radius` */
  isolated: number;
  /**
   * 1 se há Atacador percebido a menos de `ai.protected_radius` (o Protetor do §8.3 ainda não existe). Com `held`
   * (estado filtrado pela histerese da D-52), vale a lista em vez da leitura instantânea
   */
  protected: number;
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * "Trabalha no gerador" = está ao alcance de interação (`prototype_extras.interact_range.generator`) de um gerador
 * não concluído: é o que se vê de fora (a pessoa parada junto ao gerador). Vale o mais próximo.
 */
export function utilityTerms(cfg: SimConfig, p: Percept, s: SeenSurvivor, held?: readonly number[]): UtilityTerms {
  const ai = cfg.balance.ai, reach = cfg.balance.prototype_extras.interact_range.generator;
  let progress = 0, best = Infinity;
  for (const gen of p.gens) {
    const d = dist(gen, s);
    if (!gen.done && d < reach && d < best) { best = d; progress = gen.progress; }
  }
  const others = p.survivors.filter(o => o.id !== s.id);
  return {
    proximity: Math.min(1, Math.max(0, 1 - dist(p.self, s) / cfg.detectRadius)),
    progress,
    injured: s.hp < cfg.balance.survivor.wounded_hp ? 1 : 0,
    isolated: others.some(o => dist(o, s) < ai.isolated_radius) ? 0 : 1,
    protected: (held ? held.includes(s.id) : nearAttacker(cfg, p, s)) ? 1 : 0,
  };
}

/** há Atacador percebido a menos de `ai.protected_radius` (o "protegido" do §8.3 sem a histerese da D-52) */
export function nearAttacker(cfg: SimConfig, p: Percept, s: SeenSurvivor): boolean {
  return p.survivors.some(o => o.id !== s.id && o.cls === "Atacador" && dist(o, s) < cfg.balance.ai.protected_radius);
}

/** placar = Σ peso × termo (`ai.target_weights`; o peso de "protegido" já é negativo nos dados) */
export function utilityScore(cfg: SimConfig, t: UtilityTerms): number {
  const w = cfg.balance.ai.target_weights;
  return w.proximity * t.proximity + w.generator_progress * t.progress + w.injured * t.injured
    + w.isolated * t.isolated + w.protected * t.protected;
}

export interface TargetChoice { id: number; score: number }

/**
 * Melhor candidato por utilidade, com histerese (`ai.target_switch_margin`, GDD-v0.3 §8.3 Δ): se o alvo atual
 * continua candidato, só troca quando o novo placar supera o atual em mais que a margem. Empate: menor id
 * (determinismo). Devolve null sem candidatos.
 *
 * `remembered` = alvo perseguido pela memória (fora de vista, D-35) e o último placar dele: a histerese vale contra
 * esse placar; sem margem, devolve null (o caçador segue a memória em vez de pegar o primeiro visível). `held` = ids
 * protegidos depois da histerese da D-52 (sem ele, a leitura instantânea).
 */
export function chooseTarget(
  cfg: SimConfig, p: Percept, candidates: readonly SeenSurvivor[], current: number, remembered?: TargetChoice, held?: readonly number[],
): TargetChoice | null {
  let best: TargetChoice | null = null, cur: TargetChoice | null = null;
  for (const s of candidates) {
    const score = utilityScore(cfg, utilityTerms(cfg, p, s, held));
    if (!best || score > best.score || (score === best.score && s.id < best.id)) best = { id: s.id, score };
    if (s.id === current) cur = { id: s.id, score };
  }
  const margin = cfg.balance.ai.target_switch_margin;
  if (best && cur && best.id !== cur.id && !(best.score > cur.score + margin)) return cur;
  if (best && !cur && remembered && best.id !== remembered.id && !(best.score > remembered.score + margin)) return null;
  return best;
}
