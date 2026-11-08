// V3: schema e coerência dos dados de arte (data/art/palette.json, data/art/personagens.json).
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { checkArt, resolveClips, variantIds, CLIP_NAMES } from "../src/index.ts";
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

  it("variantes de arte (A2-ajuste): padrão primeiro, padrão inexistente e cor de estado na variante acusados", () => {
    const cur = sheet.personagens.find(c => c.id === "curandeiro")!;
    expect(variantIds(cur)[0]).toBe(cur.variantes!.padrao);
    expect(variantIds(cur).sort()).toEqual(Object.keys(cur.variantes!.lista).sort());
    expect(variantIds(sheet.personagens.find(c => !c.variantes)!)).toEqual([undefined]);
    const bad = clone(sheet);
    const c = bad.personagens.find(x => x.id === "curandeiro")!;
    c.variantes!.padrao = "nenhuma";
    c.variantes!.lista.mago_caduceu.pecas[0].cor = "fx.preso";
    const errs = checkArt(palette, bad, skins).join("\n");
    expect(errs).toMatch(/variante padrão 'nenhuma'/);
    expect(errs).toMatch(/fx\.preso/);
  });
});
