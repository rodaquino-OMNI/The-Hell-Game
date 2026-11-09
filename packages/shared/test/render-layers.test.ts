// V4: camadas visuais do GDD-v0.3 §10.2 em data/balance.yaml (render.layer_a, reduce_flicker, layer_b, layer_c).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBalance } from "../src/node.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const yaml = readFileSync(root + "data/balance.yaml", "utf8");
const palette = JSON.parse(readFileSync(root + "data/art/palette.json", "utf8")) as { tokens: Record<string, unknown> };

describe("camadas visuais (GDD-v0.3 §10.2)", () => {
  const r = parseBalance(yaml).render;

  it("presets: A em todos, B no Médio e no Alto, C só no Alto; sombra de 256 px", () => {
    expect(r.presets.low.layers).toEqual(["A"]);
    expect(r.presets.medium.layers).toEqual(["A", "B"]);
    expect(r.presets.high.layers).toEqual(["A", "B", "C"]);
    expect(r.shadow_map).toBe(256);
  });

  it("toda cor das camadas é token de data/art/palette.json", () => {
    for (const t of [r.layer_a.lut_tint, r.layer_b.lantern.color, r.layer_b.bake.light_color, r.layer_c.fog_billboards.color, r.layer_c.dust.color]) {
      expect(palette.tokens[t], t).toBeDefined();
    }
  });

  it("reduzir flicker zera a aberração e atenua o grão", () => {
    expect(r.reduce_flicker.aberration).toBe(0);
    expect(r.reduce_flicker.grain).toBeLessThan(1);
  });

  it("intensidade da camada A fora de 0..1 é recusada", () => {
    expect(() => parseBalance(yaml.replace(/^( {4}grain: )1\.0/m, "$11.5"))).toThrow();
    expect(() => parseBalance(yaml.replace(/^( {4}bloom: )1\.0/m, "$1-0.1"))).toThrow();
  });

  it("token de cor malformado é recusado", () => {
    expect(() => parseBalance(yaml.replace("lut_tint: world.fog", "lut_tint: \"#192131\""))).toThrow();
  });
});

describe("contorno do caçador (D-18; Art Bible §5.3)", () => {
  const r = parseBalance(yaml).render;

  it("cor é token da paleta e a intensidade fica em 0..1", () => {
    expect(palette.tokens[r.hunter_outline.color], r.hunter_outline.color).toBeDefined();
    expect(r.hunter_outline.intensity).toBeGreaterThanOrEqual(0);
    expect(r.hunter_outline.intensity).toBeLessThanOrEqual(1);
  });

  it("intensidade fora de 0..1 e cor que não é token são recusadas", () => {
    expect(() => parseBalance(yaml.replace(/(hunter_outline: \{intensity: )[\d.]+/, "$11.5"))).toThrow();
    expect(() => parseBalance(yaml.replace(/(hunter_outline: \{intensity: [\d.]+, color: )[a-z_.]+/, "$1\"#5a5e66\""))).toThrow();
  });
});
