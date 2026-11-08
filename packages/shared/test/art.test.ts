// V3: schema e coerência dos dados de arte (data/art/palette.json, data/art/personagens.json).
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { checkArt, resolveClips, CLIP_NAMES } from "../src/index.ts";
import { loadBalanceFile, loadPaletteFile, loadSheetFile } from "../src/node.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const palette = loadPaletteFile(root + "data/art/palette.json");
const sheet = loadSheetFile(root + "data/art/personagens.json");
const skins = Object.keys(loadBalanceFile(root + "data/balance.yaml").skins);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("dados de arte", () => {
  it("ficha, paleta e skins da economia coerentes", () => {
    expect(checkArt(palette, sheet, skins)).toEqual([]);
  });

  it("todo conjunto de clipes resolve os 9 clipes", () => {
    for (const k of Object.keys(sheet.conjuntos_clipes)) expect(Object.keys(resolveClips(sheet, k)).sort()).toEqual([...CLIP_NAMES].sort());
  });

  it("acusa cor de estado no corpo, token inexistente e skin que troca a cor dominante", () => {
    const bad = clone(sheet);
    bad.personagens[0].pecas[0].cor = "ui.accent";
    bad.personagens[1].corpo.pele = "nao.existe";
    bad.skins.lista.abo.trocas[bad.personagens[0].cor] = "skin.abo.a";
    const errs = checkArt(palette, bad, skins).join("\n");
    expect(errs).toMatch(/ui\.accent/);
    expect(errs).toMatch(/nao\.existe/);
    expect(errs).toMatch(/não é cor secundária/);
  });

  it("acusa skin da loja sem ficha", () => {
    expect(checkArt(palette, sheet, [...skins, "nova"]).join()).toMatch(/skins da ficha/);
  });
});
