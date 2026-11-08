// Monta a configuração da simulação a partir de data/balance.yaml e do mapa.
// Nenhum número de jogo fica na simulação: todos vêm daqui.
import type { Balance, GameMap } from "@thehell/shared";

export interface SimConfig {
  balance: Balance;
  map: GameMap;
  /** velocidade de perseguição efetiva: ruleset "prototype" usa o valor do protótipo (paridade da fase 0) */
  chaseSpeed: number;
  requiredGenerators: number;
}

export function makeConfig(balance: Balance, map: GameMap): SimConfig {
  const proto = balance.ruleset === "prototype";
  return {
    balance,
    map,
    chaseSpeed: proto ? balance.prototype_extras.chase_speed : balance.hunter.chase_speed,
    requiredGenerators: map.generators.length,
  };
}
