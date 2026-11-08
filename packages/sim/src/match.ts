// Fim de partida do ruleset v1 (GDD-v0.3 §3.3 revisto, C-01, C-02; decisões D-01 b e D-02 a). Função pura.
import type { SimConfig } from "./config.ts";
import type { EndReason, Individual, SurvivorState, Team } from "./types.ts";

export interface MatchEnd { team: Team; reason: EndReason; escaped: number }

/** Escapou e Morto são os estados terminais (GDD-v0.2 §3.2). */
export const isTerminal = (st: SurvivorState) => st === "out" || st === "dead";

/**
 * A partida acaba quando a vida do caçador chega a 0, quando todos os sobreviventes estão em estado terminal ou no
 * limite duro `match.hard_time_limit`. A equipe vence com ≥ `match.team_min_escapes` escapados ou com o caçador a 0;
 * senão vence o caçador. Devolve null enquanto a partida continua.
 */
export function matchEnd(cfg: SimConfig, states: readonly SurvivorState[], hunterHp: number, t: number): MatchEnd | null {
  const m = cfg.balance.match;
  const escaped = states.filter(s => s === "out").length;
  let reason: EndReason;
  if (hunterHp <= 0) reason = "hunter_down";
  else if (states.every(isTerminal)) reason = "all_terminal";
  else if (t >= m.hard_time_limit) reason = "time_limit";
  else return null;
  const team: Team = reason === "hunter_down" || escaped >= m.team_min_escapes ? "survivors" : "hunter";
  return { team, reason, escaped };
}

/** resultado individual (GDD-v0.3 §3.3 item 1): no limite, quem não escapou conta como não escapado */
export function individualResult(st: SurvivorState): Individual {
  return st === "out" ? "escaped" : st === "dead" ? "dead" : "not_escaped";
}
