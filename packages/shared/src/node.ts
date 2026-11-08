// Carga de dados em Node (servidor, ferramentas e testes): lê o YAML em tempo de execução,
// então trocar um valor não exige recompilar (critério de aceite do G-01).
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { PaletteSchema, SheetSchema, type PaletteData, type Sheet } from "./art.ts";
import { BalanceSchema, MapSchema, type Balance, type GameMap } from "./schema.ts";

export function parseBalance(text: string): Balance {
  return BalanceSchema.parse(parse(text));
}
export function loadBalanceFile(path: string): Balance {
  return parseBalance(readFileSync(path, "utf8"));
}
export function loadMapFile(path: string): GameMap {
  return MapSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
/** data/art/palette.json (V3) */
export function loadPaletteFile(path: string): PaletteData {
  return PaletteSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
/** data/art/personagens.json (V3): ficha de arte dos personagens e skins */
export function loadSheetFile(path: string): Sheet {
  return SheetSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
