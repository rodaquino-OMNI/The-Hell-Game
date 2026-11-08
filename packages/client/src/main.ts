// Cliente THE HELL (fase 0): porte da tela do protótipo (prototype/the-hell.html) sobre a simulação de @thehell/sim.
// A lógica de jogo está toda em packages/sim; este arquivo só orquestra o laço. Entrada em input.ts, render em render/,
// HUD em hud/, menu e loja em ui/, áudio em audio/.
import { createGame, drainEvents, step, STEP, type GameState } from "@thehell/sim";
import { initAudio, beep, SOUNDS } from "./audio/beeps.ts";
import { $, balance, cfg } from "./data.ts";
import { cameraTarget, hud, resetHud, setupHud, showMessage, tickTimers, triggerFlash } from "./hud/hud.ts";
import { applyPalette } from "./hud/palette.ts";
import { puzzlePanel, setupPuzzlePanel } from "./hud/puzzle.ts";
import { advanceClock, frameLoop } from "./loop.ts";
import { lockPointer, readInput, requestPuzzleExit, setupInput, view } from "./input.ts";
import { installRenderHook } from "./render/debug.ts";
import { urlPs1, urlSeed } from "./render/options.ts";
import { setPs1 } from "./render/ps1.ts";
import { buildActors, buildWorld, renderFrame, type RenderCtx } from "./render/scene.ts";
import { syncActors, syncDynamic } from "./render/sync.ts";
import { messageText } from "./text.ts";
import { initLocale } from "./ui/locale.ts";
import { hideMenu, selectedClass, setupMenu, showEnd } from "./ui/menu.ts";
import { persist, save } from "./ui/shop.ts";

let G: GameState;
let ctx: RenderCtx;
const clock = { acc: 0 };
let last = 0;

applyPalette(document.documentElement);
initLocale();
setupMenu(start);

function init() {
  ctx = buildWorld($("c") as HTMLCanvasElement);
  G = createGame(cfg, selectedClass(), urlSeed ?? ((Math.random() * 2 ** 31) | 0));
  buildActors(ctx, G, save.eq);
  view.yaw = 0;
  resetHud();
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
  clock.acc = 0;
  last = performance.now();
  // uma só cadeia de quadros: a partir da 2ª partida o laço já está rodando
  frames.start();
}

setupInput(() => G);
setupHud(() => G);
setupPuzzlePanel(requestPuzzleExit);

// ---------- quadro ----------
function loop(now: number) {
  // passo fixo em tempo real (GDD-v0.3 §13.3), com os tetos de `client` (loop.ts)
  const { steps, dt } = advanceClock(clock, (now - last) / 1000, STEP, balance.client);
  last = now;
  for (let i = 0; i < steps && !G.over; i++) step(cfg, G, readInput(G, STEP));
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
}
const frames = frameLoop(requestAnimationFrame, loop);

function draw(dt: number) {
  syncActors(G, view.thirdPerson);
  // modo espectador (v1, GDD-v0.3 §3.3 item 4): a câmera segue o aliado escolhido, em 3ª pessoa
  const target = cameraTarget(G);
  if (target) renderFrame(ctx, { ...G, survivors: [target] }, { ...view, thirdPerson: true });
  else renderFrame(ctx, G, view);
  hud(G, dt, view.yaw);
  syncDynamic(ctx, G);
  puzzlePanel(G);
}
