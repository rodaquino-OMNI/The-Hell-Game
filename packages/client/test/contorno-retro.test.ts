// Issue #48 (resposta 3b): o contorno do caçador (D-18) leva render.hunter_outline.retro_scale só no modo Retro em
// 1ª pessoa; na 3ª pessoa fica a intensidade escolhida (opção do jogador, V8), sem mudança.
import { afterEach, describe, expect, it } from "vitest";
import { balance } from "../src/data.ts";
import { getHunterOutline, rimUniforms, setHunterOutline, setHunterOutlineRetroView } from "../src/render/ps1.ts";

const ho = balance.render.hunter_outline;

describe("contorno do caçador no modo Retro em 1ª pessoa (issue #48)", () => {
  afterEach(() => { setHunterOutlineRetroView(false); setHunterOutline(ho.intensity); });

  it("3ª pessoa: intensidade escolhida, igual a render.hunter_outline.intensity no padrão", () => {
    expect(rimUniforms.uRim.value).toBe(ho.intensity);
    setHunterOutline(0.5);
    expect(rimUniforms.uRim.value).toBe(0.5);
  });

  it("Retro em 1ª pessoa: intensidade × retro_scale; a opção do jogador continua a escolhida", () => {
    expect(ho.retro_scale).toBeLessThan(1);
    setHunterOutlineRetroView(true);
    expect(rimUniforms.uRim.value).toBeCloseTo(ho.intensity * ho.retro_scale, 10);
    expect(getHunterOutline()).toBe(ho.intensity);
    setHunterOutline(0.5);
    expect(rimUniforms.uRim.value).toBeCloseTo(0.5 * ho.retro_scale, 10);
    setHunterOutline(0);
    expect(rimUniforms.uRim.value).toBe(0);
  });

  it("volta à intensidade escolhida ao sair da 1ª pessoa (V)", () => {
    setHunterOutlineRetroView(true);
    setHunterOutlineRetroView(false);
    expect(rimUniforms.uRim.value).toBe(ho.intensity);
  });
});
