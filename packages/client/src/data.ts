// Dados do jogo carregados no cliente (gerados de data/balance.yaml e data/maps/) e atalho de DOM.
import type { Balance, GameMap } from "@thehell/shared";
import { makeConfig } from "@thehell/sim";
import balanceJson from "@thehell/shared/generated/balance.json";
import mapsJson from "@thehell/shared/generated/maps.json";

export const balance = balanceJson as unknown as Balance;
export const map = (mapsJson as unknown as Record<string, GameMap>).patio;
/** `?ruleset=v1` (ou `prototype`) sobrepõe `balance.ruleset` para testar as regras do R1 no navegador (HUD e telas do R7) */
const rulesetParam = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("ruleset");
const ruleset = rulesetParam === "v1" || rulesetParam === "prototype" ? rulesetParam : undefined;
export const cfg = makeConfig(balance, map, { ruleset });
export const px = balance.prototype_extras;
export const $ = (id: string) => document.getElementById(id)!;
