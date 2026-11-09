// Remapeamento de teclas (V8, GDD-v0.3 §12.2: "remapeamento de todas as ações"). Cada ação tem uma lista de teclas
// (KeyboardEvent.code); o padrão vem de data/balance.yaml `ui.controls.keyboard`. Puro (sem DOM), testado em
// packages/client/test/options.test.ts.
import { CONTROL_ACTIONS, type ControlAction } from "@thehell/shared";
import { balance } from "./data.ts";

export type Bindings = Record<ControlAction, string[]>;
export { CONTROL_ACTIONS, type ControlAction };

/**
 * Teclas que podem virar atalho: só as que o navegador não usa sozinhas. Ficam de fora F1–F12 (F5 recarrega, F11 tela
 * cheia, F12 ferramentas), Alt e Meta (menu e sistema), ContextMenu, Tab (navegação, WCAG 2.1.2), Esc (cancela a
 * captura e fecha diálogos), / e ' (busca rápida do Firefox) e as de navegação de página (PageUp/Down, Home, End).
 * Lista técnica (KeyboardEvent.code, https://www.w3.org/TR/uievents-code/), não número de jogo.
 */
const SAFE_CODE = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Up|Down|Left|Right)|Space|Enter|Backspace|(Shift|Control)(Left|Right)|Comma|Period|Semicolon|Minus|Equal|Bracket(Left|Right)|Backslash|Backquote|Numpad(Add|Subtract|Multiply|Decimal|Enter))$/;

/** saídas fixas do quebra-cabeça (P-10: Esc, Backspace, X; a tecla de interagir e a de correr também saem) */
export const PUZZLE_EXIT_KEYS: readonly string[] = ["Escape", "Backspace", "KeyX"];
/** setas fixas do quebra-cabeça de sequência (as teclas de movimento também valem) */
export const PUZZLE_ARROW_KEYS: Readonly<Record<string, "left" | "up" | "right" | "down">> = { ArrowLeft: "left", ArrowUp: "up", ArrowRight: "right", ArrowDown: "down" };
const MOVE_ACTIONS: readonly ControlAction[] = ["forward", "back", "left", "right"];

/** cópia nova do mapeamento padrão (`ui.controls.keyboard`) */
export function defaultBindings(): Bindings {
  const k = balance.ui.controls.keyboard;
  return Object.fromEntries(CONTROL_ACTIONS.map(a => [a, [...k[a]]])) as Bindings;
}

/** a tecla pode ser atribuída a uma ação */
export const bindable = (code: string) => SAFE_CODE.test(code);

/**
 * mapeamento salvo → mapeamento válido. Primeiro as listas salvas válidas (o que o jogador escolheu vale), depois o
 * padrão das ações ausentes ou inválidas, sem as teclas já usadas; tecla repetida em duas listas salvas fica só na
 * primeira (na ordem de CONTROL_ACTIONS)
 */
export function parseBindings(raw: unknown): Bindings {
  const def = defaultBindings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return def;
  const src = raw as Record<string, unknown>;
  const out = {} as Bindings;
  const seen = new Set<string>();
  const take = (list: readonly string[]) => list.filter(c => !seen.has(c) && (seen.add(c), true));
  const valid = (v: unknown): v is string[] => Array.isArray(v) && v.every(c => typeof c === "string" && bindable(c));
  const missing: ControlAction[] = [];
  for (const a of CONTROL_ACTIONS) {
    const v = Object.hasOwn(src, a) ? src[a] : undefined;
    if (valid(v)) out[a] = take(v); else missing.push(a);
  }
  for (const a of missing) out[a] = take(def[a]);
  return out;
}

/**
 * atribui `code` como a tecla de `action` (substitui as anteriores) e tira a tecla de quem a usava. Devolve o novo
 * mapeamento e as ações que perderam a tecla (o menu avisa o jogador).
 */
export function rebind(b: Bindings, action: ControlAction, code: string): { bindings: Bindings; displaced: ControlAction[]; puzzle: PuzzleConflict } {
  if (!bindable(code)) return { bindings: b, displaced: [], puzzle: null };
  const displaced: ControlAction[] = [];
  const out = {} as Bindings;
  for (const a of CONTROL_ACTIONS) {
    if (a === action) { out[a] = [code]; continue; }
    out[a] = b[a].filter(c => c !== code);
    if (out[a].length !== b[a].length) displaced.push(a);
  }
  return { bindings: out, displaced, puzzle: puzzleConflict(action, code) };
}

/** a tecla tem outro papel fixo dentro do quebra-cabeça: "exit" (sai dele) ou "arrow" (seta da sequência) */
export type PuzzleConflict = "exit" | "arrow" | null;
export function puzzleConflict(action: ControlAction, code: string): PuzzleConflict {
  if (PUZZLE_EXIT_KEYS.includes(code) && action !== "interact" && action !== "run") return "exit";
  if (PUZZLE_ARROW_KEYS[code] && !MOVE_ACTIONS.includes(action)) return "arrow";
  return null;
}

/** ações ligadas à tecla */
export function actionsOf(b: Bindings, code: string): ControlAction[] {
  return CONTROL_ACTIONS.filter(a => b[a].includes(code));
}

/** alguma tecla da ação está apertada */
export function held(b: Bindings, action: ControlAction, keys: Readonly<Record<string, boolean>>): boolean {
  return b[action].some(c => !!keys[c]);
}

/**
 * "alternar em vez de segurar" (GDD-v0.3 §12.4): com `toggle`, cada aperto (`pressed`, borda de descida) inverte o
 * estado; sem `toggle`, o estado é o da tecla (`down`)
 */
export function holdOrToggle(toggle: boolean, prev: boolean, down: boolean, pressed: boolean): boolean {
  return toggle ? (pressed ? !prev : prev) : down;
}
