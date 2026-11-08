// V1: a seção render de data/balance.yaml passa no schema e recusa intensidade PS1 fora de 0..1 (GDD-v0.3 §10.1).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBalance } from "../src/node.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const yaml = readFileSync(root + "data/balance.yaml", "utf8");
const ps1Line = /^ {2}ps1: \{.*\}$/m;

describe("dados de render", () => {
  it("presets com a resolução interna do GDD §10.2 e preset padrão médio", () => {
    const r = parseBalance(yaml).render;
    expect(r.presets.low.internal).toEqual([320, 180]);
    expect(r.presets.medium.internal).toEqual([384, 216]);
    expect(r.presets.high.internal).toEqual([480, 270]);
    expect(r.default_preset).toBe("medium");
    expect(r.ps1.color_bits).toBe(5);
    expect(r.fog).toEqual({ near: 3, far: 30 });
  });
  it("intensidade PS1 fora de 0..1 é recusada", () => {
    expect(ps1Line.test(yaml)).toBe(true);
    expect(() => parseBalance(yaml.replace(ps1Line, "  ps1: {snap: 1.5, snap_grid: 128, affine: 1.0, gouraud: 1.0, dither: 1.0, color_bits: 5}"))).toThrow();
    expect(() => parseBalance(yaml.replace(ps1Line, "  ps1: {snap: 1.0, snap_grid: 128, affine: -0.1, gouraud: 1.0, dither: 1.0, color_bits: 5}"))).toThrow();
  });
  it("trocar uma intensidade no YAML muda o valor carregado", () => {
    const r = parseBalance(yaml.replace(ps1Line, "  ps1: {snap: 0.5, snap_grid: 64, affine: 0, gouraud: 1.0, dither: 0.25, color_bits: 4}")).render;
    expect(r.ps1).toEqual({ snap: 0.5, snap_grid: 64, affine: 0, gouraud: 1.0, dither: 0.25, color_bits: 4 });
  });
  it("névoa com far menor que near é recusada", () => {
    expect(() => parseBalance(yaml.replace("fog: {near: 3, far: 30}", "fog: {near: 30, far: 3}"))).toThrow();
  });
});
