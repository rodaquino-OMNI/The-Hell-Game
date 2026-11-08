// Pipeline de personagens (V2): escolha de clipe pelo estado do sim e consistência das fichas com a paleta.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHARACTERS, CLIP_NAMES } from "../src/assets/characters.ts";
import { ACTIVE, chooseClip, newMemory, type ClipContext } from "../src/render/characters/state.ts";
import { atlasLayout, atlasPixels, type Palette } from "../src/render/characters/bake.ts";

const palette = JSON.parse(readFileSync(new URL("../../../data/art/palette.json", import.meta.url), "utf8")) as Palette;
const ctx = (t: number, extra: Partial<ClipContext> = {}): ClipContext => ({ t, walk: 4, run: 5.4, strikeDuration: 0.5, ...extra });

describe("estado → clipe", () => {
  it("parado, andando e correndo pela velocidade medida entre passos", () => {
    const m = newMemory(0, 0, 0);
    expect(chooseClip({ x: 0, z: 0, atk: 0 }, m, ctx(0)).clip).toBe("idle");
    expect(chooseClip({ x: 0.4, z: 0, atk: 0 }, m, ctx(0.1)).clip).toBe("andar");
    expect(chooseClip({ x: 0.94, z: 0, atk: 0 }, m, ctx(0.2)).clip).toBe("correr");
    // quadro sem passo da simulação mantém a última velocidade
    expect(chooseClip({ x: 0.94, z: 0, atk: 0 }, m, ctx(0.2)).clip).toBe("correr");
    expect(chooseClip({ x: 0.94, z: 0, atk: 0 }, m, ctx(0.3)).clip).toBe("idle");
  });

  it("prioridade: preso > atordoado > dash > golpe > interagir", () => {
    const m = newMemory(0, 0, 0);
    expect(chooseClip({ x: 0, z: 0, atk: 0, caged: true, stunned: true }, m, ctx(0.1)).clip).toBe("preso");
    expect(chooseClip({ x: 0, z: 0, atk: 0, stunned: true, dashing: true }, m, ctx(0.2)).clip).toBe("atordoado");
    expect(chooseClip({ x: 0, z: 0, atk: 0, dashing: true, interacting: true }, m, ctx(0.3)).clip).toBe("dash");
    expect(chooseClip({ x: 0, z: 0, atk: 0, interacting: true }, m, ctx(0.4)).clip).toBe("interagir");
  });

  it("golpe dura o clipe a partir da borda de subida de atk", () => {
    const m = newMemory(0, 0, 0);
    chooseClip({ x: 0, z: 0, atk: -1 }, m, ctx(0.1));
    expect(chooseClip({ x: 0, z: 0, atk: 1.7 }, m, ctx(0.2)).clip).toBe("golpe");
    expect(chooseClip({ x: 0, z: 0, atk: 1.6 }, m, ctx(0.5)).clip).toBe("golpe");
    expect(chooseClip({ x: 0, z: 0, atk: 1.5 }, m, ctx(0.8)).clip).toBe("idle");
  });

  it("bot interage enquanto `work` sobe; ferido só com limiar em dados", () => {
    const m = newMemory(0, 0, 0);
    chooseClip({ x: 0, z: 0, atk: 0, work: 0 }, m, ctx(0.1));
    expect(chooseClip({ x: 0, z: 0, atk: 0, work: 0.1 }, m, ctx(0.2)).clip).toBe("interagir");
    expect(chooseClip({ x: 0, z: 0, atk: 0, work: 0.1 }, m, ctx(0.2)).clip).toBe("interagir");
    expect(chooseClip({ x: 0.4, z: 0, atk: 0, hp: 30 }, m, ctx(0.3)).clip).toBe("andar");
    expect(chooseClip({ x: 0.8, z: 0, atk: 0, hp: 30 }, m, ctx(0.4, { woundedHp: 40 })).clip).toBe("ferido");
  });

  it("tabela de ativação cobre os 9 clipes nos dois tipos", () => {
    for (const k of ["sobrevivente", "cacador"] as const) expect(Object.keys(ACTIVE[k]).sort()).toEqual([...CLIP_NAMES].sort());
  });
});

describe("fichas e atlas", () => {
  it("toda peça usa token da paleta e todo personagem tem os 9 clipes", () => {
    for (const c of CHARACTERS) {
      expect(palette.tokens[c.cor], c.id).toBeDefined();
      for (const p of c.pecas) expect(palette.tokens[p.cor], `${c.id}: ${p.cor}`).toBeDefined();
      expect(Object.keys(c.clipes).sort()).toEqual([...CLIP_NAMES].sort());
    }
  });

  it("atlas 64×64 só com cores da paleta (e preto do fundo)", () => {
    const px = atlasPixels(palette, 64), { uv } = atlasLayout(palette, 64);
    const allowed = new Set(Object.values(palette.tokens).map(t => t.rgb5.map(v => Math.round((v * 255) / 31)).join(",")));
    allowed.add("0,0,0");
    for (let i = 0; i < px.length; i += 4) expect(allowed.has(`${px[i]},${px[i + 1]},${px[i + 2]}`)).toBe(true);
    for (const [, [u, v]] of uv) { expect(u).toBeGreaterThan(0); expect(u).toBeLessThan(1); expect(v).toBeGreaterThan(0); expect(v).toBeLessThan(1); }
  });
});
