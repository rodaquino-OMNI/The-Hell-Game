// Carga de dados em Node (servidor, ferramentas e testes): lê o YAML em tempo de execução,
// então trocar um valor não exige recompilar (critério de aceite do G-01).
import { readFileSync } from "node:fs";
import { parse } from "yaml";
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
