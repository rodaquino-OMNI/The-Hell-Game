// Laço do gamepad (V8; GDD-v0.3 §12.4, aceite U-01: "navegação completa só por gamepad"). Um quadro por
// requestAnimationFrame: em partida, entrega o controle a input.ts (`padFrame`); fora dela, navega pelos menus:
// direcional ou analógico move o foco (na ordem do Tab), ← → ajustam o slider focado, A ativa (= clique) e B volta
// (= Esc no elemento focado, que fecha diálogos). Botões em data/balance.yaml `ui.controls.gamepad.menu`.
import type { GameState } from "@thehell/sim";
import { $, balance } from "../data.ts";
import { browserPads, createEdges, createRepeater, firstPad, navDirection, type GetPads, type NavDir } from "../gamepad.ts";
import { pingByIndex } from "../hud/hud.ts";
import { isSpectating, nextSpectatorTarget } from "../hud/spectator.ts";
import { padFrame, padIdle } from "../input.ts";

const gp = balance.ui.controls.gamepad;
const FOCUSABLE = "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])";

const shown = (el: HTMLElement) => el.checkVisibility?.() ?? el.offsetParent !== null;

/** elementos focáveis de `root`, na ordem do documento (= ordem do Tab: o jogo não usa tabindex positivo) */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => !(el as HTMLButtonElement).disabled && !el.closest("[inert],[hidden]") && shown(el));
}

/** diálogo aberto por cima (opções, loja, fim) ou o menu inicial */
export function activeRoot(): HTMLElement | null {
  for (const d of [...document.querySelectorAll<HTMLElement>("[role=dialog]")].reverse()) if (shown(d) && !d.closest("[inert]")) return d;
  const m = $("menu");
  return m && shown(m) ? m : null;
}

/** foco no próximo (`delta` = 1) ou anterior (−1) focável de `root`, circular */
export function moveFocus(root: HTMLElement, delta: number) {
  const list = focusables(root);
  if (!list.length) return;
  const i = list.indexOf(document.activeElement as HTMLElement);
  const next = i < 0 ? (delta > 0 ? 0 : list.length - 1) : (i + delta + list.length) % list.length;
  list[next].focus();
}

/** ajusta o slider (`input[type=range]`) um passo e avisa como se fosse o teclado */
export function adjustRange(el: HTMLInputElement, dir: 1 | -1) {
  if (dir > 0) el.stepUp(); else el.stepDown();
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** uma direção nos menus: slider focado recebe ← →; o resto move o foco */
export function navigate(dir: NavDir) {
  const root = activeRoot();
  if (!root) return;
  const el = document.activeElement as HTMLElement | null;
  if (el instanceof HTMLInputElement && el.type === "range" && (dir === "left" || dir === "right") && root.contains(el)) adjustRange(el, dir === "right" ? 1 : -1);
  else moveFocus(root, dir === "up" || dir === "left" ? -1 : 1);
}

/** botão A: ativa o elemento focado (ou foca o primeiro do menu) */
export function confirm() {
  const root = activeRoot();
  if (!root) return;
  const el = document.activeElement as HTMLElement | null;
  if (el && el !== document.body && root.contains(el)) el.click();
  else moveFocus(root, 1);
}

/** botão B: Esc no elemento focado (diálogos fecham com Esc; a captura de tecla do remapeamento cancela) */
export function back() {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
}

/**
 * liga o laço do gamepad no primeiro `gamepadconnected` (o navegador só expõe o controle depois de um botão apertado,
 * e chamar navigator.getGamepads() a cada quadro sem controle custa caro no Chromium). `game` devolve a partida atual;
 * `getPads`, `raf` e `target` são injetáveis (testes).
 */
export function startPadLoop(game: () => GameState | undefined, getPads: GetPads = browserPads, raf: (cb: (t: number) => void) => unknown = requestAnimationFrame, target: EventTarget = window) {
  let started = false;
  target.addEventListener("gamepadconnected", () => { if (!started) { started = true; padLoop(game, getPads, raf); } });
}

function padLoop(game: () => GameState | undefined, getPads: GetPads, raf: (cb: (t: number) => void) => unknown) {
  const edges = createEdges(gp.trigger_threshold), rep = createRepeater(gp.menu_repeat);
  let last = NaN;
  const frame = (now: number) => {
    const dt = Number.isFinite(last) ? Math.min(balance.client.max_frame_dt, Math.max(0, (now - last) / 1000)) : 0;
    last = now;
    const p = firstPad(getPads());
    if (!p) { padIdle(); edges.reset(); raf(frame); return; }
    const down = edges.update(p);
    const G = game();
    if (G && !G.over && !shown($("menu"))) {
      if (isSpectating(G) && down.has(gp.menu.confirm)) nextSpectatorTarget(G);
      const pi = padFrame(G, p, down, dt);
      if (pi >= 0) pingByIndex(G, pi);
    } else {
      padIdle();
      const d = rep.step(navDirection(p, gp), now / 1000);
      if (d) navigate(d);
      if (down.has(gp.menu.confirm)) confirm();
      if (down.has(gp.menu.back)) back();
    }
    raf(frame);
  };
  raf(frame);
}
