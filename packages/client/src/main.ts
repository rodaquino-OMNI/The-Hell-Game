// Cliente THE HELL (fase 0): porte da tela do protótipo (prototype/the-hell.html) sobre a simulação de @thehell/sim.
// A lógica de jogo está toda em packages/sim; este arquivo só orquestra o laço. Entrada em input.ts, render em render/,
// HUD em hud/, menu e loja em ui/, áudio em audio/.
import { createGame, drainEvents, step, STEP, type GameState } from "@thehell/sim";
import { initAudio, beep, SOUNDS } from "./audio/beeps.ts";
import { audioEvents, directorEnabled, updateAudio } from "./audio/director.ts";
import { installMuteKey } from "./audio/mute.ts";
import { updateListener, updateSpatial } from "./audio/spatial.ts";
import { $, balance, cfg } from "./data.ts";
import { cameraTarget, hud, resetHud, setupHud, showMessage, tickTimers, triggerFlash } from "./hud/hud.ts";
import { applyPalette } from "./hud/palette.ts";
import { puzzlePanel, setupPuzzlePanel } from "./hud/puzzle.ts";
import { setupStatusBar, statusBar } from "./hud/statusbar.ts";
import { advanceClock, frameLoop } from "./loop.ts";
import { lockPointer, readInput, requestPuzzleExit, setupInput, view } from "./input.ts";
import { exposeDebugHook } from "./debug-hooks.ts";
import { installRenderHook } from "./render/debug.ts";
import { urlPs1, urlRetro, urlRetroClass, urlSeed, urlStress } from "./render/options.ts";
import { setPs1 } from "./render/ps1.ts";
import { buildActors, buildWorld, renderFrame, type RenderCtx } from "./render/scene.ts";
import { buildStress, renderStress, type StressScene } from "./render/stress.ts";
import { syncActors, syncDynamic } from "./render/sync.ts";
import { t } from "./i18n/index.ts";
import { messageText } from "./text.ts";
import { initLocale } from "./ui/locale.ts";
import { hideMenu, selectedClass, setStartBusy, setupMenu, showEnd } from "./ui/menu.ts";
import { afterLoadIdle, startGate } from "./ui/start-gate.ts";
import { charactersReady } from "./render/characters/runtime.ts";
import { prefetchMatchCharacters } from "./render/characters/actors.ts";
import { persist, save } from "./ui/shop.ts";

let G: GameState;
let ctx: RenderCtx;
/** cena de pior caso (`?stress=1`, V7): estado sintético desenhado no lugar da partida, que fica parada */
let stress: StressScene | null = null;
const clock = { acc: 0 };
let last = 0;

applyPalette(document.documentElement);
initLocale();
setupMenu(start);
// D-45: .glb dos personagens pedidos em baixa prioridade com o menu aberto (depois do load, navegador ocioso)
afterLoadIdle(() => void prefetchMatchCharacters());
/** D-45: a partida só começa com os personagens na cena (teto ui.start_wait_s, depois o modelo de reserva) */
const gate = startGate({ ready: charactersReady, timeoutS: balance.ui.start_wait_s, setBusy: setStartBusy });

function init() {
  ctx = buildWorld($("c") as HTMLCanvasElement);
  G = createGame(cfg, selectedClass(), urlSeed ?? ((Math.random() * 2 ** 31) | 0));
  buildActors(ctx, G, save.eq);
  if (urlStress) stress = buildStress(ctx, G);
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
setPs1(urlPs1);
/** mockup Retro FPS: vista da câmera exposta às capturas do A2b (tools/art/a2b-capturas.mjs); sem ?retro não existe */
if (urlRetro) exposeDebugHook("__thehellView", view);

async function start() {
  if (gate.busy()) return;
  // áudio e pointer lock no gesto do clique (a espera abaixo pode passar da ativação transitória)
  initAudio();
  lockPointer($("c") as HTMLCanvasElement);
  init();
  // nenhum passo da simulação antes dos personagens (D-45): o botão fica em "carregando…" na espera
  await gate.wait();
  hideMenu();
  clock.acc = 0;
  last = performance.now();
  // uma só cadeia de quadros: a partir da 2ª partida o laço já está rodando
  frames.start();
}

setupInput(() => G);
setupHud(() => G);
setupPuzzlePanel(requestPuzzleExit);
// mudo do master na tecla M até os sliders do V8 (D-41), com aviso na linha de mensagens do HUD
installMuteKey(window, muted => showMessage(t(muted ? "caption.sound_muted" : "caption.sound_unmuted")));

// ---------- quadro ----------
function loop(now: number) {
  // passo fixo em tempo real (GDD-v0.3 §13.3), com os tetos de `client` (loop.ts)
  const { steps, dt } = advanceClock(clock, (now - last) / 1000, STEP, balance.client);
  last = now;
  if (stress) {
    // cena de pior caso: a simulação não avança; só o relógio dos efeitos e das animações
    stress.G.t += dt;
    renderStress(ctx, stress, 0, false);
    return;
  }
  for (let i = 0; i < steps && !G.over; i++) step(cfg, G, readInput(G, STEP));
  // uma só drenagem por quadro: HUD e áudio leem a mesma lista (audioEvents é no-op com audio.director_enabled false)
  const events = drainEvents(G);
  audioEvents(events, G.survivors[0].id);
  for (const e of events) {
    if (e.type === "msg") showMessage(messageText(e));
    // com o diretor ligado o efeito completo sai em audioEvents; o bipe da fase 0 tocaria em dobro
    else if (e.type === "sound") { if (!directorEnabled()) beep(...SOUNDS[e.name]); }
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
  // áudio (V5, atrás de audio.director_enabled): ouvinte na câmera ativa (inclusive a 1ª pessoa de ?retro=1), logo
  // depois de posicioná-la; oclusão e diretor pelo personagem visto. O diretor roda no mesmo quadro em que o windup
  // do caçador é desenhado, então o telegraph sai junto com o visual (D-36)
  if (directorEnabled()) {
    const at = target ?? G.survivors[0];
    updateListener(ctx.cam);
    updateSpatial(at);
    updateAudio(G, G.survivors[0].id, dt, at, view.yaw);
  }
  hud(G, dt, view.yaw);
  if (urlRetro) statusBar(G, urlRetroClass);
  syncDynamic(ctx, G);
  puzzlePanel(G);
}
