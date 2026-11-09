// D-44 (a): guardas das otimizações exatas das camadas A+B (PR #81).
//  - lanterna: o Ps1Material (render/ps1.ts) calcula a coordenada da sombra sem o deslocamento pela normal
//    (não lê shadowNormalBias); normalBias ≠ 0 seria ignorado em silêncio;
//  - scanlines: scanRow(k) do quad final (render/present.ts) dá o mesmo padrão de linhas da fórmula anterior
//    mod( floor( y ), k ) em toda escala inteira. compare.mjs captura com escala 1 (deviceScaleFactor 1, janela do
//    tamanho interno) e não cobre as escalas ≥ 2.
import { describe, expect, it } from "vitest";
import { createLantern } from "../src/render/environment.ts";
import { scanlineDark, scanRow } from "../src/render/present.ts";

describe("lanterna (camada B)", () => {
  it("normalBias da sombra fica em 0", () => {
    expect(
      createLantern().shadow.normalBias,
      "render/ps1.ts calcula vSpotLightCoord sem o deslocamento pela normal do chunk shadowmap_vertex (D-44 a): com " +
        "normalBias ≠ 0 o valor seria ignorado; volte ao #include <shadowmap_vertex> no vertex shader antes de mudá-lo",
    ).toBe(0);
  });
});

/** fórmula anterior do BLIT_FRAGMENT (antes do D-44 a): linha escura com escala k */
const oldDark = (row: number, k: number) => {
  const ys = Math.floor(row + 0.5);
  return (k >= 2 ? (ys % k < 0.5 ? 1 : 0) : ys % 2) === 1;
};

describe("scanlines do quad final", () => {
  it("scanRow(k) dá o mesmo padrão que mod( floor( y ), k ) para k = 1..4", () => {
    for (let k = 1; k <= 4; k++) {
      for (let row = 0; row < 4320; row++) {
        expect(scanlineDark(row, k), `escala ${k}, linha ${row}`).toBe(oldDark(row, k));
      }
    }
  });

  it("uma linha escura a cada k (k ≥ 2) e linhas alternadas com escala 1", () => {
    expect(scanRow(1)).toEqual([0.5, 1]);
    for (let k = 2; k <= 4; k++) expect(scanRow(k)).toEqual([1 / k, 0]);
  });
});
