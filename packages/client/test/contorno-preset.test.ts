// D-54 (Art Bible §5.3): o contorno do caçador (D-18) leva render.hunter_outline.preset_scale do preset de render;
// uRim = opção do jogador (V8) × fator do preset × retro_scale (só no Retro em 1ª pessoa, issue #48).
import { afterEach, describe, expect, it } from "vitest";
import { balance } from "../src/data.ts";
import {
  getHunterOutline, rimUniforms, setHunterOutline, setHunterOutlinePreset, setHunterOutlinePresetScale, setHunterOutlineRetroView,
} from "../src/render/ps1.ts";

const ho = balance.render.hunter_outline;
const presets = Object.keys(balance.render.presets) as (keyof typeof ho.preset_scale)[];

describe("contorno do caçador por preset (D-54)", () => {
  afterEach(() => {
    setHunterOutlineRetroView(false);
    setHunterOutline(ho.intensity);
    setHunterOutlinePreset(balance.render.default_preset);
  });

  it("medium fica como antes de D-54 (fator 1)", () => {
    expect(ho.preset_scale.medium).toBe(1);
  });

  it("todo preset tem fator e ele multiplica a intensidade escolhida", () => {
    for (const p of presets) {
      expect(ho.preset_scale[p], p).toBeGreaterThan(0);
      setHunterOutlinePreset(p);
      expect(rimUniforms.uRim.value).toBeCloseTo(ho.intensity * ho.preset_scale[p], 10);
      setHunterOutline(0.5);
      expect(rimUniforms.uRim.value).toBeCloseTo(0.5 * ho.preset_scale[p], 10);
      expect(getHunterOutline()).toBe(0.5);
      setHunterOutline(0);
      expect(rimUniforms.uRim.value).toBe(0);
      setHunterOutline(ho.intensity);
    }
  });

  it("Retro em 1ª pessoa: opção × fator do preset × retro_scale", () => {
    for (const p of presets) {
      setHunterOutlinePreset(p);
      setHunterOutlineRetroView(true);
      expect(rimUniforms.uRim.value).toBeCloseTo(ho.intensity * ho.preset_scale[p] * ho.retro_scale, 10);
      setHunterOutline(0.5);
      expect(rimUniforms.uRim.value).toBeCloseTo(0.5 * ho.preset_scale[p] * ho.retro_scale, 10);
      setHunterOutlineRetroView(false);
      setHunterOutline(ho.intensity);
    }
  });

  it("fator fixado à mão (capturas de comparação) e null volta ao do preset atual", () => {
    setHunterOutlinePreset("high");
    setHunterOutlinePresetScale(1);
    expect(rimUniforms.uRim.value).toBeCloseTo(ho.intensity, 10);
    setHunterOutlinePresetScale(null);
    expect(rimUniforms.uRim.value).toBeCloseTo(ho.intensity * ho.preset_scale.high, 10);
  });
});
