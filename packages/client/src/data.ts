// Dados do jogo carregados no cliente (gerados de data/balance.yaml e data/maps/) e atalho de DOM.
import type { Balance, GameMap } from "@thehell/shared";
import { makeConfig } from "@thehell/sim";
import balanceJson from "@thehell/shared/generated/balance.json";
import mapsJson from "@thehell/shared/generated/maps.json";
import { debugEnabled, urlDebug } from "./debug-hooks.ts";

export const balance = balanceJson as unknown as Balance;
export const map = (mapsJson as unknown as Record<string, GameMap>).patio;
/**
 * `?ruleset=v1` (ou `prototype`) sobrepõe `balance.ruleset` para testes e capturas no navegador, só com `?debug=1`
 * (como os ganchos da D-33, debug-hooks.ts): sem depuração vale o padrão dos dados (v1 desde o marco MJ-B).
 */
export function rulesetOverride(search: string, debug: boolean = debugEnabled(search)): "v1" | "prototype" | undefined {
  if (!debug) return undefined;
  const p = new URLSearchParams(search).get("ruleset");
  return p === "v1" || p === "prototype" ? p : undefined;
}
const ruleset = typeof location === "undefined" ? undefined : rulesetOverride(location.search, urlDebug);
export const cfg = makeConfig(balance, map, { ruleset });
export const px = balance.prototype_extras;
export const $ = (id: string) => document.getElementById(id)!;
