// V3 (F2-03): leitura de estado — padrões de feixe (Art Bible §4), skins e paleta no cliente.
import { describe, expect, it } from "vitest";
import { balance } from "../src/data.ts";
import { PALETTE, skinDef, skinSwatch, tok } from "../src/look.ts";
import { beamLit, beamPulse, genState, minWidthScale } from "../src/render/states.ts";
import { atlasCell, atlasLayout } from "../src/render/characters/atlas.ts";
import { CHARACTERS, SHEET } from "../src/assets/characters.ts";

const st = balance.render.states;
const gen = (o: Partial<{ n: number; done: boolean; bonus: boolean }>) => ({ x: 0, z: 0, n: 0, done: false, bonus: false, fails: 0, spark: 0, revealed: 0, ...o });

describe("feixes de gerador (Art Bible §4)", () => {
  it("estado de leitura: pendente, em progresso, pronto, bônus (bônus concluído = pronto)", () => {
    expect(genState(gen({}))).toBe("pendente");
    expect(genState(gen({ n: 2 }))).toBe("progresso");
    expect(genState(gen({ n: 5, done: true }))).toBe("pronto");
    expect(genState(gen({ bonus: true }))).toBe("bonus");
    expect(genState(gen({ bonus: true, done: true }))).toBe("pronto");
  });

  it("pendente pisca a pending_hz (aceso metade do ciclo); os outros ficam acesos", () => {
    const period = 1 / st.pending_hz;
    let on = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) if (beamLit("pendente", (i / N) * period)) on++;
    expect(on / N).toBeCloseTo(0.5, 2);
    expect(beamLit("pendente", 0.25 * period)).toBe(true);
    expect(beamLit("pendente", 0.75 * period)).toBe(false);
    for (const s of ["progresso", "pronto", "bonus"] as const) for (let i = 0; i < 20; i++) expect(beamLit(s, i * 0.137)).toBe(true);
  });

  it("em progresso pulsa a progress_hz entre 1 e 1 + progress_pulse; os outros não pulsam", () => {
    const period = 1 / st.progress_hz;
    expect(beamPulse("progresso", 0)).toBeCloseTo(1);
    expect(beamPulse("progresso", period / 2)).toBeCloseTo(1 + st.progress_pulse);
    expect(beamPulse("progresso", period)).toBeCloseTo(1);
    expect(st.progress_hz).toBeGreaterThan(st.pending_hz);
    for (const s of ["pendente", "pronto", "bonus"] as const) expect(beamPulse(s, period / 2)).toBe(1);
  });

  it("largura mínima em tela: perto não escala, longe garante min_px pixels internos", () => {
    const fov = balance.prototype_extras.camera.fov, ih = balance.render.presets.medium.internal[1];
    expect(minWidthScale(1, fov, ih, st.beam.width, st.beam.min_px)).toBe(1);
    for (const d of [30, 45, 60]) {
      const k = minWidthScale(d, fov, ih, st.beam.width, st.beam.min_px);
      const px = (k * st.beam.width * ih) / (2 * d * Math.tan((fov * Math.PI) / 360));
      expect(px).toBeGreaterThanOrEqual(st.beam.min_px - 1e-9);
    }
  });
});

describe("paleta e skins no cliente (V3)", () => {
  it("tok() lê o token da paleta (5 bits → 8 bits) e falha com token inexistente", () => {
    const [r, g, b] = PALETTE.tokens["gen.pronto"].rgb5.map(v => Math.round((v * 255) / 31));
    expect(tok("gen.pronto")).toBe((r << 16) | (g << 8) | b);
    expect(() => tok("nao.existe")).toThrow();
  });

  it("toda skin da loja existe na ficha e só troca cores secundárias (nunca a dominante)", () => {
    const dominants = new Set(CHARACTERS.map(c => c.cor));
    for (const id of Object.keys(balance.skins)) {
      const s = skinDef(id);
      for (const from of Object.keys(s.trocas)) {
        expect(SHEET.skins.slots).toContain(from);
        expect(dominants.has(from)).toBe(false);
      }
      expect(skinSwatch(id).head).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(skinDef("inexistente")).toBe(SHEET.skins.lista.std);
  });

  it("cachecol e lanterna não usam a cor do marcador de preso (ui.accent = fx.preso)", () => {
    for (const c of CHARACTERS) for (const p of c.pecas) expect(["ui.accent", "fx.preso"]).not.toContain(p.cor);
  });

  it("bloco do atlas de cada slot de skin bate com o layout do bake", () => {
    const size = balance.render.models.atlas, { uv } = atlasLayout(PALETTE, size);
    for (const t of SHEET.skins.slots) {
      const c = atlasCell(PALETTE, size, t), [u, v] = uv.get(t)!;
      expect((c.x + c.size / 2) / size).toBeCloseTo(u);
      expect((c.y + c.size / 2) / size).toBeCloseTo(v);
    }
  });
});
