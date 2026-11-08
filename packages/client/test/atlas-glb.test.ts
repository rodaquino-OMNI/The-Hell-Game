// Grade do atlas da paleta × atlas gravado nos .glb (Art Bible §7). Tokens novos entram no fim da grade; enquanto a
// paleta couber em (render.models.atlas / 8)² blocos (tools/art/palette-check.mjs), a grade não muda e os modelos
// assados continuam com as UVs certas. Se este teste falhar: crescer render.models.atlas e rebake (pnpm build).
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { atlasLayout, rgb5ToRgb8, type Palette } from "../src/render/characters/atlas.ts";

const root = new URL("../../../", import.meta.url);
const palette = JSON.parse(readFileSync(new URL("data/art/palette.json", root), "utf8")) as Palette;
const sheet = JSON.parse(readFileSync(new URL("data/art/personagens.json", root), "utf8")) as {
  personagens: { id: string; cor: string; corpo?: Record<string, unknown>; pecas: { cor: string }[] }[];
};
const models = new URL("packages/client/public/models/", root);
const SIZE = 64;
/** decodificador PNG das ferramentas (tools/visual/png.mjs, JavaScript sem tipos) */
const { decodePng } = (await import(new URL("tools/visual/png.mjs", root).href)) as {
  decodePng: (buf: Buffer) => { width: number; height: number; rgba: Uint8Array };
};

/** PNG do atlas embutido no .glb (primeira imagem) */
function glbAtlas(file: URL) {
  const buf = readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const binStart = 20 + jsonLen + 8;
  const view = json.bufferViews[json.images[0].bufferView];
  return decodePng(buf.subarray(binStart + (view.byteOffset ?? 0), binStart + (view.byteOffset ?? 0) + view.byteLength));
}

describe("atlas da paleta × atlas dos .glb", () => {
  const { cols, cell, uv } = atlasLayout(palette, SIZE);

  it("grade de 8 colunas com blocos de 8 px (a dos modelos assados)", () => {
    expect(cols).toBe(8);
    expect(cell).toBe(8);
  });

  for (const f of readdirSync(models).filter(n => n.endsWith(".glb"))) {
    it(`${f}: cada token usado pelo personagem está no mesmo bloco do atlas gravado`, () => {
      const img = glbAtlas(new URL(f, models));
      expect([img.width, img.height]).toEqual([SIZE, SIZE]);
      const ch = sheet.personagens.find(p => p.id === f.replace(/\.glb$/, ""));
      expect(ch, f).toBeDefined();
      const used = new Set<string>([ch!.cor, ...ch!.pecas.map(p => p.cor), ...Object.values(ch!.corpo ?? {}).filter((v): v is string => typeof v === "string")]);
      for (const t of used) {
        const [u, v] = uv.get(t)!;
        const x = Math.floor(u * SIZE), y = Math.floor(v * SIZE), i = (y * SIZE + x) * 4;
        expect([...img.rgba.subarray(i, i + 3)], `${f}: ${t}`).toEqual(palette.tokens[t].rgb5.map(rgb5ToRgb8));
      }
    });
  }
});
