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
/** sobreposição em vigor (main.ts a reaplica na config dos quebra-cabeças acessíveis) */
export const ruleset = typeof location === "undefined" ? undefined : rulesetOverride(location.search, urlDebug);
/**
 * `?map_flags=short_loop_pillars,side_exit` liga flags de `maps.v1` (R7-mapas, D-22/D-23/D-25) para testes e capturas
 * no navegador, só com `?debug=1` (como `?ruleset=`): as nomeadas valem true, as omitidas ficam com o valor dos dados
 * (`makeConfig` opts.mapFlags). Nome desconhecido é ignorado. Sem depuração, ou sem nomes válidos, vale o padrão dos dados.
 */
export function mapFlagsOverride(search: string, debug: boolean = debugEnabled(search)): Partial<Balance["maps"]["v1"]> | undefined {
  if (!debug) return undefined;
  const p = new URLSearchParams(search).get("map_flags");
  if (!p) return undefined;
  const known = Object.keys(balance.maps.v1) as (keyof Balance["maps"]["v1"])[];
  const out: Partial<Balance["maps"]["v1"]> = {};
  for (const name of p.split(",")) if ((known as string[]).includes(name)) out[name as keyof Balance["maps"]["v1"]] = true;
  return Object.keys(out).length ? out : undefined;
}
/** flags de mapa sobrepostas em vigor (main.ts as reaplica na config dos quebra-cabeças acessíveis) */
export const mapFlags = typeof location === "undefined" ? undefined : mapFlagsOverride(location.search, urlDebug);
/**
 * config da simulação; `cfg.map` é o mapa EFETIVO (no v1, com os pilares de `maps.v1.short_loop_pillars`). Gaiola,
 * portão e saída da partida vêm de `GameState.arena` (layout escolhido pela semente), não daqui nem do `map` de topo.
 */
export const cfg = makeConfig(balance, map, { ruleset, ...(mapFlags ? { mapFlags } : {}) });
export const px = balance.prototype_extras;
export const $ = (id: string) => document.getElementById(id)!;
