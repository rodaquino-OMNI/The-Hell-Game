// Cores do HUD e dos menus: só os tokens de data/art/palette.json (Art Bible §2, §8), publicados como variáveis CSS.
// Token "ui.text_dim" vira "--ui-text-dim"; o hex é o de 15 bits do PS1 (round(v × 255 / 31)).
// O modo daltônico (look.ts `setColorMode`, V8) troca tokens; `applyPalette` de novo publica as cores trocadas.
import { PALETTE, rgb5 } from "../look.ts";

const tokens = PALETTE.tokens;

/** cor do token em #rrggbb (com o modo de cor atual) */
export function tokenHex(name: string): string {
  return "#" + rgb5(name).map(v => Math.round((v * 255) / 31).toString(16).padStart(2, "0")).join("");
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
