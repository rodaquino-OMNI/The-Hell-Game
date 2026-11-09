// Entrada: teclado, mouse, ponteiro e gamepad; monta o PlayerInput de cada passo da simulação.
// V8 (GDD-v0.3 §12.2 e §12.4): teclas remapeáveis (bindings.ts), sensibilidade e inversão do eixo Y, "alternar em
// vez de segurar" para correr e interagir/resgatar, e gamepad no layout padrão (gamepad.ts). Números em
// data/balance.yaml `ui.controls`.
import type { Arrow, GameState, PlayerInput } from "@thehell/sim";
import { balance } from "./data.ts";
import { pointerFilter } from "./pointer-filter.ts";
import { actionsOf, defaultBindings, held, holdOrToggle, PUZZLE_ARROW_KEYS, PUZZLE_EXIT_KEYS, type Bindings, type ControlAction } from "./bindings.ts";
import { button, padSticks, type PadLike } from "./gamepad.ts";

const ctl = balance.ui.controls;
const gp = ctl.gamepad;

/** estado de câmera controlado pela entrada (lido pela render) */
export const view = { yaw: 0, pitch: 0, thirdPerson: true };
let drag = false;
const keys: Record<string, boolean> = {};
const pending: Partial<PlayerInput> = {};
/** descarta o salto espúrio ao adquirir o pointer lock e eventos fora do limite (pointer-filter.ts) */
const mouseFilter = pointerFilter(balance.client.mouse_max_delta);

/** preferências de controle do menu de opções (V8) */
export interface ControlPrefs { keys: Bindings; toggleRun: boolean; toggleInteract: boolean; sensitivity: number; invertY: boolean }
const prefs: ControlPrefs = { keys: defaultBindings(), toggleRun: ctl.toggle_run, toggleInteract: ctl.toggle_interact, sensitivity: ctl.sensitivity.default, invertY: ctl.invert_y };
export function setControls(p: Partial<ControlPrefs>) { Object.assign(prefs, p); }
export const getControls = (): ControlPrefs => ({ ...prefs });

/** estado alternado de correr e de interagir (só vale com "alternar"; invertido a cada aperto) */
const hold = { run: false, interact: false };
/** estado do gamepad no último quadro (gamepad.ts, lido em readInput) */
const pad = { forward: 0, strafe: 0, run: false, interact: false };

const MOVE_ARROW: Partial<Record<ControlAction, Arrow>> = { left: "left", forward: "up", right: "right", back: "down" };
const PING_ACTIONS: readonly ControlAction[] = ["ping_1", "ping_2", "ping_3", "ping_4"];

/** seta do quebra-cabeça de sequência para a tecla: setas sempre, e as teclas de movimento (WASD no padrão) */
function arrowOf(code: string): Arrow | undefined {
  if (PUZZLE_ARROW_KEYS[code]) return PUZZLE_ARROW_KEYS[code];
  for (const a of actionsOf(prefs.keys, code)) if (MOVE_ARROW[a]) return MOVE_ARROW[a];
  return undefined;
}

/** índice do ping (0–3) da tecla, ou -1 (lido por hud/hud.ts) */
export function pingIndexOf(code: string): number {
  const a = actionsOf(prefs.keys, code);
  return PING_ACTIONS.findIndex(p => a.includes(p));
}

/** a tecla é a do mudo (ação `mute`, D-41; audio/mute.ts `installMuteKey`) */
export const isMuteKey = (code: string) => prefs.keys.mute.includes(code);

/** zera os estados alternados (nova partida) */
export function resetInput() { hold.run = hold.interact = false; for (const k of Object.keys(keys)) keys[k] = false; }

/** liga os ouvintes globais; `game` devolve a partida atual (indefinida antes do início) */
export function setupInput(game: () => GameState | undefined) {
  onkeydown = e => {
    const G = game();
    if (G && keyDown(G, e.code, e.repeat)) e.preventDefault();
  };
  onkeyup = e => keyUp(e.code);
  document.addEventListener("pointerlockchange", () => mouseFilter.lockChange(!!document.pointerLockElement));
  onmousemove = e => {
    if (!mouseFilter.accept(!!document.pointerLockElement, e.movementX, e.movementY)) return;
    const G = game();
    if (!G || G.over) return;
    if (document.pointerLockElement || drag) look(e.movementX * ctl.mouse_rad_per_px * prefs.sensitivity, e.movementY * ctl.mouse_rad_per_px * prefs.sensitivity);
  };
  onmousedown = () => { const G = game(); drag = true; if (G && !G.over) pending.attack = true; };
  onmouseup = () => { drag = false; };
  // a janela perde o foco: nenhuma tecla fica "presa" apertada (o estado alternado continua)
  onblur = () => { for (const k of Object.keys(keys)) keys[k] = false; };
}

const SCROLL_KEYS = ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

/**
 * uma tecla apertada na partida `G` (exportada para os testes). Dentro do quebra-cabeça a entrada dele vence: na
 * sequência, uma seta (ou tecla de movimento) é sempre seta, mesmo que outra ação use a tecla; no timing, a tecla de
 * confirmar confirma; só depois vêm as saídas (Esc, Backspace, X, interagir, correr). Devolve se o navegador deve
 * ignorar a tecla (preventDefault): Espaço e setas sempre, e qualquer tecla com ação durante a partida.
 */
export function keyDown(G: GameState, code: string, repeat: boolean): boolean {
  keys[code] = true;
  const acts = actionsOf(prefs.keys, code), first = !repeat;
  const block = SCROLL_KEYS.includes(code) || (!G.over && acts.length > 0);
  if (G.puzzle) {
    if (G.puzzle.kind === "sequence") { const a = arrowOf(code); if (a) { if (first) pending.puzzleArrow = a; return true; } }
    else if (acts.includes("puzzle_confirm")) { pending.puzzleSpace = true; return true; }
  }
  if (acts.includes("camera") && first) view.thirdPerson = !view.thirdPerson;
  if (acts.includes("ability") && first) pending.ability = true;
  if (acts.includes("attack") && first) pending.attack = true;
  if (G.puzzle && (PUZZLE_EXIT_KEYS.includes(code) || acts.includes("interact") || acts.includes("run"))) { pending.puzzleExit = true; return true; }
  if (acts.includes("run") && first) hold.run = holdOrToggle(prefs.toggleRun, hold.run, true, true);
  if (acts.includes("interact") && first) {
    pending.interact = true;
    hold.interact = holdOrToggle(prefs.toggleInteract, hold.interact, true, true);
  }
  return block;
}
/** tecla solta (exportada para os testes) */
export function keyUp(code: string) { keys[code] = false; }

/** gira a câmera (rad; dy positivo = olhar para baixo, invertido com "inverter eixo Y") */
function look(dx: number, dy: number) {
  view.yaw -= dx;
  const lim = ctl.pitch_limit;
  view.pitch = Math.max(-lim, Math.min(lim, view.pitch - (prefs.invertY ? -dy : dy)));
}

/**
 * um quadro do gamepad em partida (chamado por ui/padnav.ts com o controle e as bordas de descida): analógicos,
 * botões segurados e apertos. No quebra-cabeça: `interact` confirma o timing, `puzzle_exit` sai, o direcional dá as
 * setas da sequência. Devolve o índice do ping pedido (0–3) ou -1.
 */
export function padFrame(G: GameState, p: PadLike, down: ReadonlySet<number>, dt: number): number {
  const b = gp.buttons, th = gp.trigger_threshold, s = padSticks(p, gp);
  pad.forward = s.forward; pad.strafe = s.strafe;
  look(s.lookX * gp.look_speed * prefs.sensitivity * dt, s.lookY * gp.look_speed * prefs.sensitivity * dt);
  if (down.has(b.camera)) view.thirdPerson = !view.thirdPerson;
  if (down.has(b.ability)) pending.ability = true;
  if (down.has(b.attack)) pending.attack = true;
  if (G.puzzle) {
    pad.run = pad.interact = false;
    if (down.has(b.puzzle_exit)) pending.puzzleExit = true;
    else if (G.puzzle.kind === "timing" && down.has(b.interact)) pending.puzzleSpace = true;
    else if (G.puzzle.kind === "sequence") {
      const m = gp.menu;
      const a: Arrow | undefined = down.has(m.up) ? "up" : down.has(m.down) ? "down" : down.has(m.left) ? "left" : down.has(m.right) ? "right" : undefined;
      if (a) pending.puzzleArrow = a;
    }
    return -1;
  }
  if (down.has(b.run)) hold.run = holdOrToggle(prefs.toggleRun, hold.run, true, true);
  if (down.has(b.interact)) { pending.interact = true; hold.interact = holdOrToggle(prefs.toggleInteract, hold.interact, true, true); }
  pad.run = button(p, b.run, th);
  pad.interact = button(p, b.interact, th);
  return [b.ping_1, b.ping_2, b.ping_3, b.ping_4].findIndex(i => down.has(i));
}
/** o controle foi desconectado ou a partida parou de ler o gamepad */
export function padIdle() { pad.forward = pad.strafe = 0; pad.run = pad.interact = false; }

/** pedido de saída do quebra-cabeça vindo do botão do painel */
export function requestPuzzleExit() { pending.puzzleExit = true; }

/** tenta capturar o ponteiro no canvas (falha silenciosa sem suporte) */
export function lockPointer(canvas: HTMLCanvasElement) {
  try { const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined; p?.catch?.(() => {}); } catch { /* sem pointer lock */ }
}

const axisKeys = (neg: ControlAction, posA: ControlAction) => (held(prefs.keys, posA, keys) ? 1 : 0) - (held(prefs.keys, neg, keys) ? 1 : 0);
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

export function readInput(G: GameState, dt: number): PlayerInput {
  if (!G.puzzle) view.yaw += axisKeys("look_right", "look_left") * ctl.key_turn_speed * dt;
  const input: PlayerInput = {
    forward: clamp1(axisKeys("back", "forward") + pad.forward), strafe: clamp1(axisKeys("left", "right") + pad.strafe),
    run: holdOrToggle(prefs.toggleRun, hold.run, held(prefs.keys, "run", keys) || pad.run, false), yaw: view.yaw,
    interact: !!pending.interact, interactHeld: holdOrToggle(prefs.toggleInteract, hold.interact, held(prefs.keys, "interact", keys) || pad.interact, false),
    ability: !!pending.ability, attack: !!pending.attack, puzzleSpace: pending.puzzleSpace, puzzleArrow: pending.puzzleArrow, puzzleExit: pending.puzzleExit,
  };
  for (const k of Object.keys(pending)) delete (pending as Record<string, unknown>)[k];
  return input;
}
