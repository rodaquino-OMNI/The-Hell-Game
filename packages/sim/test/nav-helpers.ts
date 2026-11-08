// Dados comuns aos testes de navegação (R2): balance e Pátio reais, mais mapas de teste.
import { fileURLToPath } from "node:url";
import type { GameMap } from "@thehell/shared";
import { loadBalanceFile, loadMapFile } from "@thehell/shared/node";
import { allLayoutChoices, resolveLayout, survivorSpawns, type P2 } from "../src/nav/index.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
export const balance = loadBalanceFile(root + "data/balance.yaml");
export const patio = loadMapFile(root + "data/maps/patio.json");

/** spawn do jogador e todos os pontos de interesse de todas as combinações de layout */
export function patioTargets(): [string, P2][] {
  const out: [string, P2][] = [];
  for (const c of allLayoutChoices(patio)) {
    const m = resolveLayout(patio, c);
    const tag = `g${c.generators}c${c.cage}e${c.exit}`;
    m.generators.forEach((p, i) => out.push([`${tag} gerador ${i}`, p]));
    m.bonus.forEach((p, i) => out.push([`${tag} bônus ${i}`, p]));
    out.push([`${tag} gaiola`, m.cage], [`${tag} saída`, m.gate]);
  }
  return out;
}
export const spawn: P2 = survivorSpawns(patio, 1)[0];

/** mapa 62 × 62 com uma sala fechada (paredes de 1 m) em volta de (20, 20): o interior é inalcançável */
export const closedRoom: GameMap = {
  ...patio,
  id: "sala",
  walls: [
    ...patio.walls.slice(0, 4),
    [20, 15, 10, 1], [20, 25, 10, 1], [15, 20, 1, 10], [25, 20, 1, 10],
  ],
  layouts: undefined, loops: undefined, hideouts: undefined, survivor_spawns: undefined,
};
export const insideRoom: P2 = [20, 20];
