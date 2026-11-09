// Mockup do modo "Retro FPS" (D-13, D-14, D-15 em docs/plano-construcao.md §7): dados de render.retro coerentes com a
// paleta e com a ficha dos personagens.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBalance } from "../src/node.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const yaml = readFileSync(root + "data/balance.yaml", "utf8");
const palette = JSON.parse(readFileSync(root + "data/art/palette.json", "utf8")) as { tokens: Record<string, unknown> };
const sheet = JSON.parse(readFileSync(root + "data/art/personagens.json", "utf8")) as { personagens: { id: string; pecas: { forma: string; osso?: string; cor: string }[] }[] };

describe("modo Retro FPS (V9; mockup A2b aprovado na issue #27)", () => {
  const r = parseBalance(yaml).render.retro;

  it("toda cor de render.retro é token da paleta; os do preset industrial são world.industrial.*", () => {
    const ind = r.industrial;
    const industrial = [ind.wall.base, ind.wall.edge, ind.wall.seam, ind.wall.stripe_color, ind.floor.base, ind.floor.seam, ind.floor.fleck, ind.ambient, ind.bake_color, ind.lamp_token];
    for (const t of industrial) { expect(palette.tokens[t], t).toBeDefined(); expect(t.startsWith("world.industrial.")).toBe(true); }
    for (const t of [r.viewmodel.light.ambient, r.viewmodel.light.key]) expect(palette.tokens[t], t).toBeDefined();
  });

  it("as 5 classes têm ferramenta, e cada grupo acha peças na ficha (osso e cores)", () => {
    for (const id of ["curandeiro", "mecanico", "atacador", "protetor", "batedor"] as const) {
      const spec = r.viewmodel.classes[id], ch = sheet.personagens.find(p => p.id === id);
      expect(spec, id).toBeDefined();
      expect(ch, id).toBeDefined();
      for (const g of spec!.grupos) {
        // peças feitas em código (luneta do Batedor, A2b 2c): cores da paleta
        if ("pecas" in g) { for (const p of g.pecas) expect(palette.tokens[p.cor], `${id}: ${p.cor}`).toBeDefined(); continue; }
        const n = ch!.pecas.filter(p => p.forma !== "seg" && p.osso === g.osso && (!g.cores || g.cores.includes(p.cor))).length;
        expect(n, `${id}: ${g.osso}`).toBeGreaterThan(0);
      }
    }
  });

  it("A2b 2c: o Batedor leva a luneta (peças em código), não arma", () => {
    const g = r.viewmodel.classes.batedor!.grupos.find(x => "pecas" in x);
    expect(g).toBeDefined();
    expect(g && "pecas" in g ? g.pecas.every(p => p.cor !== "char.lamina") : false).toBe(true);
  });

  it("A2b 1b: a ferramenta encolhe para o canto (escala < 1)", () => {
    expect(r.viewmodel.corner.scale).toBeLessThan(1);
    expect(r.viewmodel.corner.scale).toBeGreaterThan(0);
  });

  it("balanço com intensidade de 0 a 1 (D-13)", () => {
    expect(r.bob).toBeGreaterThanOrEqual(0);
    expect(r.bob).toBeLessThanOrEqual(1);
    expect(() => parseBalance(yaml.replace(/^( {4}bob: )0\.5/m, "$11.5"))).toThrow();
  });
});
