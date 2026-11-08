// V4: estado da camada A (setters do V8, "reduzir flicker") e a LUT fria (GDD-v0.3 §10.2, §12.4).
import { Color } from "three";
import { describe, expect, it } from "vitest";
import { balance } from "../src/data.ts";
import {
  buildColdLut, getLayerA, postUniforms, setLayerA, setLayers, setOverrides, setReduceFlicker, tickLayers,
} from "../src/render/layers.ts";

const la = balance.render.layer_a;

describe("camada A", () => {
  it("intensidades limitadas a 0..1 e zeradas com a camada desligada", () => {
    setLayers({ A: true });
    setLayerA({ grain: 2, vignette: -1 });
    expect(getLayerA().grain).toBe(1);
    expect(getLayerA().vignette).toBe(0);
    setLayers({ A: false });
    expect(postUniforms.uGrain.value).toBe(0);
    setLayers({ A: true });
    setLayerA({ grain: la.grain, vignette: la.vignette });
  });

  it("aberração só no pulso de dano, decai em aberration_time e some com reduzir flicker", () => {
    setOverrides({ damage: null, time: null });
    setReduceFlicker(false);
    tickLayers(10, null);
    expect(postUniforms.uAberration.value).toBe(0);
    tickLayers(10, 10);
    expect(postUniforms.uAberration.value).toBeCloseTo(la.aberration);
    tickLayers(10 + la.aberration_time / 2, 10);
    expect(postUniforms.uAberration.value).toBeCloseTo(la.aberration / 2);
    tickLayers(10 + la.aberration_time, 10);
    expect(postUniforms.uAberration.value).toBe(0);
    setReduceFlicker(true);
    tickLayers(10, 10);
    expect(postUniforms.uAberration.value).toBe(0);
  });

  it("grão anima no relógio da simulação e congela com reduzir flicker", () => {
    setReduceFlicker(false);
    tickLayers(0, null);
    const f0 = postUniforms.uGrainFrame.value;
    tickLayers(1, null);
    expect(postUniforms.uGrainFrame.value - f0).toBe(la.grain_fps);
    setReduceFlicker(true);
    tickLayers(1, null);
    expect(postUniforms.uGrainFrame.value).toBe(0);
    expect(postUniforms.uGrain.value).toBeCloseTo(la.grain * balance.render.reduce_flicker.grain);
    setReduceFlicker(false);
  });
});

describe("LUT fria", () => {
  const tint = new Color(0.1, 0.13, 0.2);
  it("neutra (sem tom, ganho 1, saturação 1) é a identidade", () => {
    const n = 4;
    const lut = buildColdLut(n, { tint, tintAmount: 0, pivot: 0.35, gain: [1, 1, 1], saturation: 1 });
    for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
      const i = (r + g * n + b * n * n) * 4;
      expect([lut[i], lut[i + 1], lut[i + 2]]).toEqual([r, g, b].map(v => Math.round((v / (n - 1)) * 255)));
    }
  });
  it("com o tom frio o preto puxa para o azul e o branco esfria", () => {
    const n = 8;
    const lut = buildColdLut(n, { tint, tintAmount: la.lut_tint_amount, pivot: la.lut_shadow_pivot, gain: la.lut_gain, saturation: la.lut_saturation });
    expect(lut[2]).toBeGreaterThan(lut[0]);                 // preto: B > R
    const w = (n * n * n - 1) * 4;
    expect(lut[w + 2]).toBeGreaterThanOrEqual(lut[w]);      // branco: B ≥ R
  });
});
