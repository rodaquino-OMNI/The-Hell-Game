// Cores do jogo: só tokens de data/art/palette.json (Art Bible §2; V3, F2-03). `pnpm data` valida a paleta e a copia
// para packages/shared/generated/palette.json; a ficha das skins vem de data/art/personagens.json (mesmo caminho).
// Nenhuma cor fixa no código: quem precisa de cor pede um token aqui.
import { COLOR_MODES, type ColorMode, type PaletteData, type Sheet, type SkinDef } from "@thehell/shared";
import paletteJson from "@thehell/shared/generated/palette.json";
import sheetJson from "@thehell/shared/generated/personagens.json";

export const PALETTE = paletteJson as unknown as PaletteData;
const SKINS = (sheetJson as unknown as Sheet).skins;

const to8 = (v: number) => Math.round((v * 255) / 31);

/** modo de cor: "normal" ou um dos 3 modos daltônicos de `modos_daltonico` (GDD v0.3 §12.4; Art Bible §5.2) */
export type ColorModeOption = "normal" | ColorMode;
export const COLOR_MODE_OPTIONS: readonly ColorModeOption[] = ["normal", ...COLOR_MODES];
let colorMode: ColorModeOption = "normal";
let overrides: Record<string, readonly [number, number, number]> = {};

/**
 * troca de tokens do modo daltônico (V8): os tokens sobrepostos pelo modo mudam de cor; os demais ficam como na
 * paleta normal. Vale para o que for criado depois (HUD: `applyPalette` de novo; 3D: na próxima partida).
 */
export function setColorMode(m: ColorModeOption) {
  colorMode = COLOR_MODE_OPTIONS.includes(m) ? m : "normal";
  overrides = colorMode === "normal" ? {} : PALETTE.modos_daltonico[colorMode].tokens;
}
export const getColorMode = () => colorMode;

/** cor do token em 5 bits por canal, já com o modo de cor atual */
export function rgb5(name: string): readonly [number, number, number] {
  const t = PALETTE.tokens[name];
  if (!t) throw new Error(`token de cor inexistente: ${name}`);
  return overrides[name] ?? t.rgb5;
}

/** paleta com o modo de cor atual aplicado (para quem pinta o atlas de cores, ex.: retro/viewmodel.ts) */
export function activePalette(): { tokens: Record<string, { rgb5: readonly number[] }> } {
  return { tokens: Object.fromEntries(Object.keys(PALETTE.tokens).map(k => [k, { rgb5: rgb5(k) }])) };
}

/** cor do token (0xRRGGBB, 8 bits por canal derivados dos 5 bits: round(v·255/31), como em palette-check) */
export function tok(name: string): number {
  const [r, g, b] = rgb5(name).map(to8);
  return (r << 16) | (g << 8) | b;
}
/** cor do token em CSS (#rrggbb) */
export const tokCss = (name: string) => "#" + tok(name).toString(16).padStart(6, "0");

/** cor dominante de cada classe jogável (Art Bible §2) */
export const CLASS_TOKENS = { Curandeiro: "class.curandeiro", Mecânico: "class.mecanico", Atacador: "class.atacador" } as const;

/** mundo, luzes e objetos (os tokens world.* e light.* da paleta) */
export const WORLD = {
  fog: "world.fog", wall: "world.wall", ground: "world.ground", cage: "world.gaiola",
  genBody: "world.gerador", bonusBody: "world.gerador_bonus", gateClosed: "world.portao", gateOpen: "gen.pronto",
  ambient: "light.ambiente", playerLight: "light.jogador",
} as const;

/** perigo do caçador e marcadores de estado (Art Bible §4) */
export const FX = { projectile: "fx.ameaca", trap: "fx.armadilha", caged: "fx.preso", eyes: "hunter.olhos", eyesWindup: "hunter.olhos_preparo" } as const;

/** estado do gerador → token do feixe (Art Bible §4) */
export const GEN_TOKENS = { pendente: "gen.pendente", progresso: "gen.progresso", pronto: "gen.pronto", bonus: "gen.bonus" } as const;
export type GenState = keyof typeof GEN_TOKENS;

/** skin pela chave da loja (data/balance.yaml skins); desconhecida = padrão */
export function skinDef(id: string): SkinDef {
  return SKINS.lista[id] ?? SKINS.lista.std;
}

/** cores da amostra da loja: calça (corpo da amostra), pele (cabeça) e sapatos/acessório (faixa); null = cores da classe */
export function skinSwatch(id: string): { body: string | null; head: string; accent: string | null } {
  const s = skinDef(id), calca = s.trocas["char.calca"], acc = s.acessorio?.cor ?? s.trocas["char.sapato"];
  return { body: calca ? tokCss(calca) : null, head: tokCss("char.pele"), accent: acc ? tokCss(acc) : null };
}
