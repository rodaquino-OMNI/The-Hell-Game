// Cliente THE HELL (fase 0): porte da tela do protótipo (prototype/the-hell.html) sobre a simulação de @thehell/sim.
// A lógica de jogo está toda em packages/sim; este arquivo só orquestra o laço. Entrada em input.ts, render em render/,
// HUD em hud/, menu e loja em ui/, áudio em audio/.
import { createGame, drainEvents, makeConfig, step, STEP, type GameState, type SimConfig } from "@thehell/sim";
import { initAudio, beep, SOUNDS } from "./audio/beeps.ts";
import { $, balance, cfg, map, ruleset } from "./data.ts";
import { cameraTarget, hud, resetHud, setupHud, showMessage, tickTimers, triggerFlash } from "./hud/hud.ts";
import { applyPalette } from "./hud/palette.ts";
import { puzzlePanel, setupPuzzlePanel } from "./hud/puzzle.ts";
import { setupStatusBar, statusBar } from "./hud/statusbar.ts";
import { advanceClock, frameLoop } from "./loop.ts";
import { getControls, lockPointer, readInput, requestPuzzleExit, resetInput, setupInput, view } from "./input.ts";
import { exposeDebugHook } from "./debug-hooks.ts";
import { getColorMode } from "./look.ts";
import { getLayerA, getReduceFlicker } from "./render/layers.ts";
import { bobScale, cameraFov } from "./render/motion.ts";
import { installRenderHook } from "./render/debug.ts";
import { urlPs1, urlRetro, urlRetroClass, urlSeed } from "./render/options.ts";
import { getPs1, setPs1 } from "./render/ps1.ts";
import { buildActors, buildWorld, renderFrame, type RenderCtx } from "./render/scene.ts";
import { syncActors, syncDynamic } from "./render/sync.ts";
import { messageText } from "./text.ts";
import { initLocale } from "./ui/locale.ts";
import { applyOptions } from "./ui/apply.ts";
import { hideMenu, refreshMenuText, selectedClass, setupMenu, showEnd } from "./ui/menu.ts";
import { currentOptions, setupOptions } from "./ui/options.ts";
import { startPadLoop } from "./ui/padnav.ts";
import { loadOptions, withAccessiblePuzzles } from "./ui/settings.ts";
import { persist, save } from "./ui/shop.ts";

let G: GameState;
/** configuração da partida atual: a de data.ts, ou com o quebra-cabeça acessível (V8, `puzzles.accessible`) */
let gameCfg: SimConfig = cfg;
let ctx: RenderCtx;
const clock = { acc: 0 };
let last = 0;

applyPalette(document.documentElement);
initLocale();
setupMenu(start);
// opções do jogador (V8): gravadas no localStorage; aplicadas antes do primeiro quadro
const saved = loadOptions();
applyOptions(saved);
setupOptions(saved, refreshMenuText);

function init() {
  ctx = buildWorld($("c") as HTMLCanvasElement);
  gameCfg = currentOptions().puzzleAccessible ? makeConfig(withAccessiblePuzzles(balance), map, { ruleset }) : cfg;
  G = createGame(gameCfg, selectedClass(), urlSeed ?? ((Math.random() * 2 ** 31) | 0));
  resetInput();
  buildActors(ctx, G, save.eq);
  view.yaw = 0;
  resetHud();
  // mockup do modo Retro FPS (?retro=1, D-13): começa em 1ª pessoa (V alterna) com a barra de estado inferior
  if (urlRetro) { view.thirdPerson = false; setupStatusBar(); }
}

// ganchos de depuração só com ?debug=1 (D-33, debug-hooks.ts)
/** gancho somente-leitura para os testes ponta a ponta (tools/smoke.mjs) */
exposeDebugHook("__thehell", () => G);
/** gancho de render (capturas de referência e renderer.info) e intensidades PS1 do parâmetro de URL `?ps1=` */
installRenderHook(() => ctx, () => G);
// `?ps1=` (depuração e capturas de referência) vale por cima das opções salvas
setPs1(urlPs1);
/** gancho somente-leitura das opções (tools/a11y/axe.mjs; só com ?debug=1): o que o jogador escolheu e o estado efetivo de cada módulo */
exposeDebugHook("__thehellOptions", () => ({
  options: currentOptions(), ps1: getPs1(), layerA: getLayerA(), reduceFlicker: getReduceFlicker(), bobScale: bobScale(), fov: cameraFov(),
  colorMode: getColorMode(), uiScale: getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim(), controls: getControls(),
  puzzleZone: gameCfg.balance.puzzles.timing.zone,
}));
/** mockup Retro FPS: vista da câmera exposta às capturas do A2b (tools/art/a2b-capturas.mjs); sem ?retro não existe */
if (urlRetro) exposeDebugHook("__thehellView", view);

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
startPadLoop(() => G);

// ---------- quadro ----------
function loop(now: number) {
  // passo fixo em tempo real (GDD-v0.3 §13.3), com os tetos de `client` (loop.ts)
  const { steps, dt } = advanceClock(clock, (now - last) / 1000, STEP, balance.client);
  last = now;
  for (let i = 0; i < steps && !G.over; i++) step(gameCfg, G, readInput(G, STEP));
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
  if (urlRetro) statusBar(G, urlRetroClass);
  syncDynamic(ctx, G);
  puzzlePanel(G);
}
