// Remapeamento de teclas (V8, GDD-v0.3 §12.2: "remapeamento de todas as ações"). Cada ação tem uma lista de teclas
// (KeyboardEvent.code); o padrão vem de data/balance.yaml `ui.controls.keyboard`. Puro (sem DOM), testado em
// packages/client/test/controls.test.ts.
import { CONTROL_ACTIONS, type ControlAction } from "@thehell/shared";
import { balance } from "./data.ts";

export type Bindings = Record<ControlAction, string[]>;
export { CONTROL_ACTIONS, type ControlAction };

/** teclas que nunca viram atalho de jogo: Esc cancela a captura e fecha diálogos; Tab navega pelo menu (WCAG 2.1.2) */
export const RESERVED_KEYS: readonly string[] = ["Escape", "Tab"];
const CODE = /^[A-Za-z0-9]+$/;

/** cópia nova do mapeamento padrão (`ui.controls.keyboard`) */
export function defaultBindings(): Bindings {
  const k = balance.ui.controls.keyboard;
  return Object.fromEntries(CONTROL_ACTIONS.map(a => [a, [...k[a]]])) as Bindings;
}

/** a tecla pode ser atribuída a uma ação */
export const bindable = (code: string) => CODE.test(code) && !RESERVED_KEYS.includes(code);

/**
 * mapeamento salvo → mapeamento válido: ação ausente ou com lista inválida volta ao padrão; tecla repetida em duas
 * ações fica só na primeira (na ordem de CONTROL_ACTIONS)
 */
export function parseBindings(raw: unknown): Bindings {
  const def = defaultBindings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return def;
  const src = raw as Record<string, unknown>;
  const out = {} as Bindings;
  const seen = new Set<string>();
  for (const a of CONTROL_ACTIONS) {
    const v = Object.hasOwn(src, a) ? src[a] : undefined;
    const list = Array.isArray(v) && v.every(c => typeof c === "string" && bindable(c)) ? (v as string[]) : def[a];
    out[a] = list.filter(c => !seen.has(c) && (seen.add(c), true));
  }
  return out;
}

/**
 * atribui `code` como a tecla de `action` (substitui as anteriores) e tira a tecla de quem a usava. Devolve o novo
 * mapeamento e as ações que perderam a tecla (o menu avisa o jogador).
 */
export function rebind(b: Bindings, action: ControlAction, code: string): { bindings: Bindings; displaced: ControlAction[] } {
  if (!bindable(code)) return { bindings: b, displaced: [] };
  const displaced: ControlAction[] = [];
  const out = {} as Bindings;
  for (const a of CONTROL_ACTIONS) {
    if (a === action) { out[a] = [code]; continue; }
    out[a] = b[a].filter(c => c !== code);
    if (out[a].length !== b[a].length) displaced.push(a);
  }
  return { bindings: out, displaced };
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
