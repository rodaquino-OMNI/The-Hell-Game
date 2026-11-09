// G-01: os dados passam no schema, e trocar um valor no YAML muda o resultado sem recompilar.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBalance, loadMapFile } from "../src/node.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const yaml = readFileSync(root + "data/balance.yaml", "utf8");

describe("dados", () => {
  it("data/balance.yaml passa no schema", () => {
    expect(parseBalance(yaml).survivor.hp).toBe(100);
  });
  it("trocar um valor no YAML muda o valor carregado (sem recompilar)", () => {
    const changed = yaml.replace(/^ {2}hp: 100$/m, "  hp: 123");
    expect(parseBalance(changed).survivor.hp).toBe(123);
  });
  it("schema recusa valor inválido", () => {
    expect(() => parseBalance(yaml.replace(/^ {2}hp: 100$/m, "  hp: -5"))).toThrow();
    expect(() => parseBalance(yaml.replace(/^ruleset: \w+$/m, "ruleset: qualquer"))).toThrow();
  });
  it("mapa do Pátio passa no schema", () => {
    expect(loadMapFile(root + "data/maps/patio.json").walls.length).toBe(15);
  });
});
