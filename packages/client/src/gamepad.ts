// Gamepad (V8, GDD-v0.3 §12.2: "gamepad no layout padrão da Gamepad API"). Leitura pura do estado de um controle
// (eixos com zona morta, botões com borda de descida) e repetição de direção nos menus. Índices de botões e eixos em
// data/balance.yaml `ui.controls.gamepad` (layout "standard", https://w3c.github.io/gamepad/#remapping).
// O DOM (foco e cliques nos menus) fica em ui/padnav.ts; a entrada de jogo em input.ts.
import type { Balance } from "@thehell/shared";

export type PadCfg = Balance["ui"]["controls"]["gamepad"];
/** subconjunto de `Gamepad` que o jogo lê (os testes simulam `navigator.getGamepads`) */
export interface PadLike {
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
}
export type GetPads = () => readonly (PadLike | null)[];

/** `navigator.getGamepads` quando existe (sem suporte: lista vazia) */
export const browserPads: GetPads = () => {
  try { return typeof navigator !== "undefined" && navigator.getGamepads ? [...navigator.getGamepads()] : []; } catch { return []; }
};

/** primeiro controle conectado, preferindo o de layout "standard" */
export function firstPad(pads: readonly (PadLike | null)[]): PadLike | null {
  const on = pads.filter((p): p is PadLike => !!p && p.connected);
  return on.find(p => p.mapping === "standard") ?? on[0] ?? null;
}

/** eixo com zona morta, reescalado para continuar indo de 0 a 1 fora dela */
export function axis(p: PadLike, i: number, deadzone: number): number {
  const v = p.axes[i] ?? 0;
  if (!Number.isFinite(v) || Math.abs(v) <= deadzone) return 0;
  return (Math.sign(v) * (Math.abs(v) - deadzone)) / (1 - deadzone);
}

/** botão apertado (gatilho analógico conta a partir de `threshold`) */
export function button(p: PadLike, i: number, threshold: number): boolean {
  const b = p.buttons[i];
  return !!b && (b.pressed || b.value >= threshold);
}

/** bordas de descida: `update` devolve os índices de botão que acabaram de ser apertados */
export function createEdges(threshold: number) {
  let prev: boolean[] = [];
  return {
    update(p: PadLike | null): Set<number> {
      const now = p ? p.buttons.map((_, i) => button(p, i, threshold)) : [];
      const out = new Set<number>();
      now.forEach((d, i) => { if (d && !prev[i]) out.add(i); });
      prev = now;
      return out;
    },
    reset() { prev = []; },
  };
}

/** movimento (frente, lado) e olhar (x, y) do controle, com zona morta; o movimento fica no círculo unitário */
export function padSticks(p: PadLike, c: PadCfg) {
  let strafe = axis(p, c.axes.move_x, c.deadzone), forward = -axis(p, c.axes.move_y, c.deadzone);
  const m = Math.hypot(strafe, forward);
  if (m > 1) { strafe /= m; forward /= m; }
  return { forward, strafe, lookX: axis(p, c.axes.look_x, c.deadzone), lookY: axis(p, c.axes.look_y, c.deadzone) };
}

export type NavDir = "up" | "down" | "left" | "right";

/** direção pedida nos menus: direcional ou analógico esquerdo (o direcional vence) */
export function navDirection(p: PadLike, c: PadCfg): NavDir | null {
  const m = c.menu, th = c.trigger_threshold;
  if (button(p, m.up, th)) return "up";
  if (button(p, m.down, th)) return "down";
  if (button(p, m.left, th)) return "left";
  if (button(p, m.right, th)) return "right";
  const x = axis(p, c.axes.move_x, c.deadzone), y = axis(p, c.axes.move_y, c.deadzone);
  // o analógico só vira direção de menu além de `menu_stick` (fração do curso depois da zona morta)
  if (Math.abs(x) < c.menu_stick && Math.abs(y) < c.menu_stick) return null;
  return Math.abs(y) >= Math.abs(x) ? (y < 0 ? "up" : "down") : (x < 0 ? "left" : "right");
}

/** repetição ao segurar uma direção (s): dispara na hora, depois de `delay` e a cada `interval` */
export function createRepeater(r: PadCfg["menu_repeat"]) {
  let dir: NavDir | null = null, next = 0;
  return {
    step(d: NavDir | null, now: number): NavDir | null {
      if (d !== dir) { dir = d; next = now + r.delay; return d; }
      if (d && now >= next) { next = now + r.interval; return d; }
      return null;
    },
  };
}
