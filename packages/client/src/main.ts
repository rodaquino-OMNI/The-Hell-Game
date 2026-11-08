// Cliente THE HELL (fase 0): porte da tela do protótipo (prototype/the-hell.html) sobre a simulação de @thehell/sim.
// A lógica de jogo está toda em packages/sim; este arquivo só orquestra o laço. Entrada em input.ts, render em render/,
// HUD em hud/, menu e loja em ui/, áudio em audio/.
import { createGame, drainEvents, step, STEP, type GameState } from "@thehell/sim";
import { initAudio, beep, SOUNDS } from "./audio/beeps.ts";
import { $, cfg } from "./data.ts";
import { hud, showMessage, tickTimers, triggerFlash } from "./hud/hud.ts";
import { puzzlePanel, setupPuzzlePanel } from "./hud/puzzle.ts";
import { lockPointer, readInput, requestPuzzleExit, setupInput, view } from "./input.ts";
import { installRenderHook } from "./render/debug.ts";
import { urlPs1, urlSeed } from "./render/options.ts";
import { setPs1 } from "./render/ps1.ts";
import { buildActors, buildWorld, renderFrame, type RenderCtx } from "./render/scene.ts";
import { syncActors, syncDynamic } from "./render/sync.ts";
import { messageText } from "./text.ts";
import { hideMenu, selectedClass, setupMenu, showEnd } from "./ui/menu.ts";
import { persist, save } from "./ui/shop.ts";

let G: GameState;
let ctx: RenderCtx;
let acc = 0, last = 0;

setupMenu(start);

function init() {
  ctx = buildWorld($("c") as HTMLCanvasElement);
  G = createGame(cfg, selectedClass(), urlSeed ?? ((Math.random() * 2 ** 31) | 0));
  buildActors(ctx, G, save.eq);
  view.yaw = 0;
}

/** gancho somente-leitura para os testes ponta a ponta (tools/smoke.mjs) */
(window as unknown as { __thehell: () => GameState | undefined }).__thehell = () => G;
/** gancho de render (capturas de referência e renderer.info) e intensidades PS1 do parâmetro de URL `?ps1=` */
installRenderHook(() => ctx, () => G);
setPs1(urlPs1);

function start() {
  hideMenu();
  initAudio();
  lockPointer($("c") as HTMLCanvasElement);
  init();
  last = performance.now();
  requestAnimationFrame(loop);
}

setupInput(() => G);
setupPuzzlePanel(requestPuzzleExit);

// ---------- quadro ----------
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  acc += dt;
  while (acc >= STEP && !G.over) { step(cfg, G, readInput(G, STEP)); acc -= STEP; }
  for (const e of drainEvents(G)) {
    if (e.type === "msg") showMessage(messageText(e));
    else if (e.type === "sound") beep(...SOUNDS[e.name]);
    else if (e.type === "flash") triggerFlash();
    else if (e.type === "end") {
      save.co += e.coins; persist();
      document.exitPointerLock?.();
      showEnd(e);
    }
  }
  tickTimers(dt);
  draw(dt);
  requestAnimationFrame(loop);
}

function draw(dt: number) {
  syncActors(G, view.thirdPerson);
  renderFrame(ctx, G, view);
  hud(G, dt);
  syncDynamic(ctx, G);
  puzzlePanel(G);
}
