// Dados do jogo carregados no cliente (gerados de data/balance.yaml e data/maps/) e atalho de DOM.
import type { Balance, GameMap } from "@thehell/shared";
import { makeConfig } from "@thehell/sim";
import balanceJson from "@thehell/shared/generated/balance.json";
import mapsJson from "@thehell/shared/generated/maps.json";

export const balance = balanceJson as unknown as Balance;
export const map = (mapsJson as unknown as Record<string, GameMap>).patio;
export const cfg = makeConfig(balance, map);
export const px = balance.prototype_extras;
export const $ = (id: string) => document.getElementById(id)!;
