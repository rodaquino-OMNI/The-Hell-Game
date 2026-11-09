// Opções do jogador (V8, F2-08; GDD-v0.3 §10.1, §10.2, §12.2 e §12.4): modelo, valores padrão de data/balance.yaml e
// persistência em localStorage. Cada campo é validado sozinho: valor ausente ou inválido cai no padrão daquele campo
// (o resto do que foi salvo continua valendo). Volumes e idioma têm persistência própria (audio/engine.ts e
// i18n/index.ts); aqui ficam só os demais. Puro (sem DOM): a aplicação nos módulos fica em ui/apply.ts.
import { COLOR_MODES } from "@thehell/shared";
import { balance } from "../data.ts";
import { parseBindings, defaultBindings, type Bindings } from "../bindings.ts";
import type { ColorModeOption } from "../look.ts";
import type { LayerAEffect } from "../render/layers.ts";
import type { Ps1Effect } from "../render/ps1.ts";

/** chave do localStorage (não é número de jogo; mesmo padrão de ui/shop.ts, i18n e audio/engine.ts) */
export const OPTIONS_KEY = "thehell.options";

export const PS1_OPTIONS: readonly Ps1Effect[] = ["snap", "affine", "gouraud", "dither"];
/** efeitos da camada A expostos no menu (a LUT fria é a cor do jogo, não um efeito de conforto) */
export const LAYER_A_OPTIONS: readonly Exclude<LayerAEffect, "lut">[] = ["grain", "vignette", "scanlines", "aberration", "bloom"];
export type FontSize = keyof Balance["ui"]["options"]["font_scales"];
export const FONT_SIZES: readonly FontSize[] = ["normal", "large", "xlarge"];
type Balance = typeof balance;

export interface Options {
  ps1: Record<Ps1Effect, number>;
  layerA: Record<(typeof LAYER_A_OPTIONS)[number], number>;
  reduceFlicker: boolean;
  reduceCameraBob: boolean;
  /** graus (`ui.fov`); null = fov do protótipo (render/motion.ts) */
  fov: number | null;
  fontSize: FontSize;
  colorMode: ColorModeOption;
  toggleRun: boolean;
  toggleInteract: boolean;
  /** quebra-cabeça acessível (`puzzles.accessible`) */
  puzzleAccessible: boolean;
  sensitivity: number;
  invertY: boolean;
  keys: Bindings;
}

export function defaultOptions(): Options {
  const r = balance.render, c = balance.ui.controls;
  return {
    ps1: { snap: r.ps1.snap, affine: r.ps1.affine, gouraud: r.ps1.gouraud, dither: r.ps1.dither },
    layerA: { grain: r.layer_a.grain, vignette: r.layer_a.vignette, scanlines: r.layer_a.scanlines, aberration: r.layer_a.aberration, bloom: r.layer_a.bloom },
    reduceFlicker: false,
    reduceCameraBob: false,
    fov: null,
    fontSize: balance.ui.options.font_default,
    colorMode: "normal",
    toggleRun: c.toggle_run,
    toggleInteract: c.toggle_interact,
    puzzleAccessible: false,
    sensitivity: c.sensitivity.default,
    invertY: c.invert_y,
    keys: defaultBindings(),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const get = (o: Record<string, unknown>, k: string) => (Object.hasOwn(o, k) ? o[k] : undefined);
const unit = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const inRange = (v: unknown, min: number, max: number, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : d);
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : d);

/** opções salvas (JSON já lido) → opções válidas; cada campo inválido vira o padrão */
export function parseOptions(raw: unknown): Options {
  const d = defaultOptions();
  if (!isObj(raw)) return d;
  const ps1 = isObj(get(raw, "ps1")) ? (get(raw, "ps1") as Record<string, unknown>) : {};
  const la = isObj(get(raw, "layerA")) ? (get(raw, "layerA") as Record<string, unknown>) : {};
  const fr = balance.ui.fov, s = balance.ui.controls.sensitivity;
  const fov = get(raw, "fov");
  return {
    ps1: Object.fromEntries(PS1_OPTIONS.map(e => [e, unit(get(ps1, e), d.ps1[e])])) as Options["ps1"],
    layerA: Object.fromEntries(LAYER_A_OPTIONS.map(e => [e, unit(get(la, e), d.layerA[e])])) as Options["layerA"],
    reduceFlicker: bool(get(raw, "reduceFlicker"), d.reduceFlicker),
    reduceCameraBob: bool(get(raw, "reduceCameraBob"), d.reduceCameraBob),
    fov: typeof fov === "number" && Number.isFinite(fov) && fov >= fr.min && fov <= fr.max ? fov : d.fov,
    fontSize: oneOf(get(raw, "fontSize"), FONT_SIZES, d.fontSize),
    colorMode: oneOf(get(raw, "colorMode"), ["normal", ...COLOR_MODES] as const, d.colorMode),
    toggleRun: bool(get(raw, "toggleRun"), d.toggleRun),
    toggleInteract: bool(get(raw, "toggleInteract"), d.toggleInteract),
    puzzleAccessible: bool(get(raw, "puzzleAccessible"), d.puzzleAccessible),
    sensitivity: inRange(get(raw, "sensitivity"), s.min, s.max, d.sensitivity),
    invertY: bool(get(raw, "invertY"), d.invertY),
    keys: parseBindings(get(raw, "keys")),
  };
}

export type OptionsStorage = Pick<Storage, "getItem" | "setItem">;
/** localStorage, ou null sem armazenamento (modo privado, cota, política do navegador) */
export function defaultStorage(): OptionsStorage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** lê as opções salvas; JSON quebrado ou armazenamento indisponível = padrão */
export function loadOptions(storage: OptionsStorage | null = defaultStorage()): Options {
  try { return parseOptions(JSON.parse(storage?.getItem(OPTIONS_KEY) ?? "null")); } catch { return defaultOptions(); }
}

/** grava as opções; devolve false se o armazenamento recusou */
export function saveOptions(o: Options, storage: OptionsStorage | null = defaultStorage()): boolean {
  try { if (!storage) return false; storage.setItem(OPTIONS_KEY, JSON.stringify(o)); return true; } catch { return false; }
}

/**
 * `balance` com o quebra-cabeça acessível (`puzzles.accessible`, GDD-v0.3 §12.4 e GDD-v0.2 §6 item b): zona de acerto
 * do timing × `zone_mult` (também a zona maior do Mecânico), limitada à barra inteira. Só a configuração da partida
 * local muda; a simulação (packages/sim) lê os mesmos campos de sempre.
 */
export function withAccessiblePuzzles(b: Balance): Balance {
  const k = b.puzzles.accessible.zone_mult;
  return {
    ...b,
    puzzles: { ...b.puzzles, timing: { ...b.puzzles.timing, zone: Math.min(1, b.puzzles.timing.zone * k) } },
    classes: { ...b.classes, mechanic: { ...b.classes.mechanic, puzzle_zone: Math.min(1, b.classes.mechanic.puzzle_zone * k) } },
  };
}
