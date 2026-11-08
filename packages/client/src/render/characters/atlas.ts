// Atlas de cores dos personagens (Art Bible §7: 64×64, filtro nearest): um bloco chapado por token da paleta, na
// ordem de data/art/palette.json. Puro (sem DOM): usado pelo bake (gera o PNG) e pelo cliente (troca de cor das skins).

export interface Palette { tokens: Record<string, { rgb5: readonly number[] }> }

/** grade do atlas: um bloco por token da paleta, na ordem de palette.json */
export function atlasLayout(palette: Palette, size: number) {
  const names = Object.keys(palette.tokens);
  const cols = Math.ceil(Math.sqrt(names.length)), cell = Math.floor(size / cols);
  const uv = new Map<string, [number, number]>();
  names.forEach((n, i) => uv.set(n, [((i % cols) * cell + cell / 2) / size, (Math.floor(i / cols) * cell + cell / 2) / size]));
  return { names, cols, cell, uv };
}

/** bloco do token no atlas, em pixels a partir do canto superior esquerdo */
export function atlasCell(palette: Palette, size: number, token: string): { x: number; y: number; size: number } {
  const { names, cols, cell } = atlasLayout(palette, size);
  const i = names.indexOf(token);
  if (i < 0) throw new Error(`token '${token}' fora da paleta`);
  return { x: (i % cols) * cell, y: Math.floor(i / cols) * cell, size: cell };
}

export const rgb5ToRgb8 = (v: number) => Math.round((v * 255) / 31);

/** pixels RGBA do atlas (cores chapadas dos tokens; o resto em preto) */
export function atlasPixels(palette: Palette, size: number): Uint8Array {
  const { names, cols, cell } = atlasLayout(palette, size);
  const px = new Uint8Array(size * size * 4);
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  names.forEach((n, i) => {
    const [r, g, b] = palette.tokens[n].rgb5.map(rgb5ToRgb8);
    const x0 = (i % cols) * cell, y0 = Math.floor(i / cols) * cell;
    for (let y = y0; y < y0 + cell; y++) for (let x = x0; x < x0 + cell; x++) px.set([r, g, b, 255], (y * size + x) * 4);
  });
  return px;
}
