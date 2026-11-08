// Entrada: teclado, mouse e ponteiro; monta o PlayerInput de cada passo da simulação.
import type { Arrow, GameState, PlayerInput } from "@thehell/sim";

/** estado de câmera controlado pela entrada (lido pela render) */
export const view = { yaw: 0, pitch: 0, thirdPerson: true };
let drag = false;
const keys: Record<string, boolean> = {};
const pending: Partial<PlayerInput> = {};

const ARROW_KEYS: Record<string, Arrow> = { ArrowLeft: "left", ArrowUp: "up", ArrowRight: "right", ArrowDown: "down", KeyA: "left", KeyW: "up", KeyD: "right", KeyS: "down" };
const EXIT_KEYS = ["Escape", "Backspace", "KeyX", "KeyE", "ShiftLeft", "ShiftRight"]; // P-10: o Shift direito também sai

/** liga os ouvintes globais; `game` devolve a partida atual (indefinida antes do início) */
export function setupInput(game: () => GameState | undefined) {
  onkeydown = e => {
    const G = game();
    if (!G) return;
    keys[e.code] = true;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    if (e.code === "KeyV") view.thirdPerson = !view.thirdPerson;
    if (e.code === "KeyQ" && !e.repeat) pending.ability = true;
    if (G.puzzle && EXIT_KEYS.includes(e.code)) { pending.puzzleExit = true; return; }
    if (e.code === "KeyE" && !e.repeat) pending.interact = true;
    if (G.puzzle) {
      if (G.puzzle.kind === "timing" && e.code === "Space") pending.puzzleSpace = true;
      else if (G.puzzle.kind === "sequence" && ARROW_KEYS[e.code] && !e.repeat) pending.puzzleArrow = ARROW_KEYS[e.code];
    }
  };
  onkeyup = e => { keys[e.code] = false; };
  onmousemove = e => {
    const G = game();
    if (!G || G.over) return;
    if (document.pointerLockElement || drag) { view.yaw -= e.movementX * 0.0025; view.pitch = Math.max(-1.2, Math.min(1.2, view.pitch - e.movementY * 0.0025)); }
  };
  onmousedown = () => { const G = game(); drag = true; if (G && !G.over) pending.attack = true; };
  onmouseup = () => { drag = false; };
}

/** pedido de saída do quebra-cabeça vindo do botão do painel */
export function requestPuzzleExit() { pending.puzzleExit = true; }

/** tenta capturar o ponteiro no canvas (falha silenciosa sem suporte) */
export function lockPointer(canvas: HTMLCanvasElement) {
  try { const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined; p?.catch?.(() => {}); } catch { /* sem pointer lock */ }
}

export function readInput(G: GameState, dt: number): PlayerInput {
  if (!G.puzzle) view.yaw += ((keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0)) * 2 * dt;
  const input: PlayerInput = {
    forward: (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), strafe: (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
    run: !!(keys.ShiftLeft || keys.ShiftRight), yaw: view.yaw, interact: !!pending.interact, interactHeld: !!keys.KeyE,
    ability: !!pending.ability, attack: !!pending.attack, puzzleSpace: pending.puzzleSpace, puzzleArrow: pending.puzzleArrow, puzzleExit: pending.puzzleExit,
  };
  for (const k of Object.keys(pending)) delete (pending as Record<string, unknown>)[k];
  return input;
}
