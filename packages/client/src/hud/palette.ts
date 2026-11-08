// Cores do HUD e dos menus: só os tokens de data/art/palette.json (Art Bible §2, §8), publicados como variáveis CSS.
// Token "ui.text_dim" vira "--ui-text-dim"; o hex é o de 15 bits do PS1 (round(v × 255 / 31)).
import palette from "@thehell/shared/generated/palette.json";

type Token = { rgb5: [number, number, number] };
const tokens = (palette as unknown as { tokens: Record<string, Token> }).tokens;

/** cor do token em #rrggbb */
export function tokenHex(name: string): string {
  const tok = tokens[name];
  if (!tok) throw new Error(`token de cor inexistente: ${name}`);
  return "#" + tok.rgb5.map(v => Math.round((v * 255) / 31).toString(16).padStart(2, "0")).join("");
}

/** nome da variável CSS do token */
export const cssVar = (name: string) => "--" + name.replace(/[._]/g, "-");

/** todas as variáveis CSS dos tokens */
export function paletteVars(): Record<string, string> {
  return Object.fromEntries(Object.keys(tokens).map(k => [cssVar(k), tokenHex(k)]));
}

/** aplica as variáveis no elemento raiz do documento */
export function applyPalette(root: HTMLElement) {
  for (const [k, v] of Object.entries(paletteVars())) root.style.setProperty(k, v);
}
