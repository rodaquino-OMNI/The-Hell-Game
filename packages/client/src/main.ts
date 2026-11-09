// Cliente THE HELL (fase 0): porte da tela do protótipo (prototype/the-hell.html) sobre a simulação de @thehell/sim.
// A lógica de jogo está toda em packages/sim; este arquivo só orquestra o laço. Entrada em input.ts, render em render/,
// HUD em hud/, menu e loja em ui/, áudio em audio/.
import { createGame, drainEvents, makeConfig, step, STEP, type GameState, type SimConfig } from "@thehell/sim";
import { initAudio, beep, SOUNDS } from "./audio/beeps.ts";
import { clearCaptions, getCaptionBus } from "./audio/captions.ts";
import { audioEvents, directorEnabled, updateAudio } from "./audio/director.ts";
import { installMuteKey } from "./audio/mute.ts";
import { updateListener, updateSpatial } from "./audio/spatial.ts";
import { $, balance, cfg, map, mapFlags, ruleset } from "./data.ts";
import { cameraTarget, hud, resetHud, setupHud, showMessage, tickTimers, triggerFlash } from "./hud/hud.ts";
import { captionsFrame, setupCaptions } from "./hud/captions.ts";
import { setupBottomLayout } from "./hud/layout.ts";
import { applyPalette } from "./hud/palette.ts";
import { puzzlePanel, setupPuzzlePanel } from "./hud/puzzle.ts";
import { setupStatusBar, statusBar } from "./hud/statusbar.ts";
import { advanceClock, frameLoop } from "./loop.ts";
import { getControls, isMuteKey, muteMessage, lockPointer, readInput, requestPuzzleExit, resetInput, setupInput, view } from "./input.ts";
import { exposeDebugHook } from "./debug-hooks.ts";
import { getColorMode } from "./look.ts";
import { getLayerA, getReduceFlicker } from "./render/layers.ts";
import { bobScale, cameraFov } from "./render/motion.ts";
import { installRenderHook } from "./render/debug.ts";
import { urlPs1, urlRetro, urlRetroClass, urlSeed, urlStress } from "./render/options.ts";
import { getPs1, setPs1 } from "./render/ps1.ts";
import { buildActors, buildWorld, renderFrame, type RenderCtx } from "./render/scene.ts";
import { buildStress, renderStress, type StressScene } from "./render/stress.ts";
import { syncActors, syncDynamic } from "./render/sync.ts";
import { messageText } from "./text.ts";
import { matchConfig, selectedDifficulty } from "./ui/difficulty.ts";
import { initLocale } from "./ui/locale.ts";
import { applyOptions } from "./ui/apply.ts";
import { closeMenuDialogs, hideMenu, refreshMenuText, selectedClass, setStartBusy, setupMenu, showEnd } from "./ui/menu.ts";
import { currentOptions, refreshVolumeSliders, setupOptions } from "./ui/options.ts";
import { startPadLoop } from "./ui/padnav.ts";
import { loadOptions, withAccessiblePuzzles } from "./ui/settings.ts";
import { afterLoadIdle, startGate } from "./ui/start-gate.ts";
import { charactersReady } from "./render/characters/runtime.ts";
import { prefetchMatchCharacters } from "./render/characters/actors.ts";
import { persist, save } from "./ui/shop.ts";

let G: GameState;
/**
 * configuração da partida atual: a de data.ts com a dificuldade do menu (R6, ui/difficulty.ts), e com o quebra-cabeça
 * acessível quando a opção está ligada (V8, `puzzles.accessible`)
 */
let gameCfg: SimConfig = cfg;
let ctx: RenderCtx;
/** cena de pior caso (`?stress=1`, V7): estado sintético desenhado no lugar da partida, que fica parada */
let stress: StressScene | null = null;
const clock = { acc: 0 };
let last = 0;
/** partida em curso (D-45): antes disso, na espera pelos personagens, a entrada não mexe na câmera nem na partida */
// não volta a false no fim: a partida acabada é tratada por G.over em input.ts, e "jogar de novo" recarrega a página
let playing = false;

applyPalette(document.documentElement);
initLocale();
setupMenu(start);
// D-45: .glb dos personagens pedidos em baixa prioridade com o menu aberto (depois do load, navegador ocioso)
afterLoadIdle(() => void prefetchMatchCharacters());
/** D-45: a partida só começa com os personagens na cena (teto ui.start_wait_s, depois o modelo de reserva) */
const gate = startGate({ ready: charactersReady, timeoutS: balance.ui.start_wait_s, setBusy: setStartBusy });
// opções do jogador (V8): gravadas no localStorage; aplicadas antes do primeiro quadro
const saved = loadOptions();
applyOptions(saved);
setupOptions(saved, refreshMenuText);

function init() {
  ctx = buildWorld($("c") as HTMLCanvasElement);
  gameCfg = currentOptions().puzzleAccessible
    ? makeConfig(withAccessiblePuzzles(balance), map, { ruleset, difficulty: selectedDifficulty(), ...(mapFlags ? { mapFlags } : {}) })
    : matchConfig(cfg);
  G = createGame(gameCfg, selectedClass(), urlSeed ?? ((Math.random() * 2 ** 31) | 0));
  resetInput();
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

async function start() {
  if (gate.busy()) return;
  // áudio e pointer lock no gesto do clique (a espera abaixo pode passar da ativação transitória)
  initAudio();
  lockPointer($("c") as HTMLCanvasElement);
  // legendas (V8b): nada da partida anterior ou do menu passa para a nova, e o aria-live já fica "off" antes do
  // primeiro quadro (uma legenda emitida nele não é anunciada por cima do início da partida)
  clearCaptions();
  captionsFrame(true);
  init();
  // nenhum passo da simulação antes dos personagens (D-45): o botão fica em "carregando…" na espera
  await gate.wait();
  closeMenuDialogs();
  hideMenu();
  playing = true;
  clock.acc = 0;
  last = performance.now();
  // uma só cadeia de quadros: a partir da 2ª partida o laço já está rodando
  frames.start();
}

setupInput(() => (playing ? G : undefined));
setupHud(() => G);
setupPuzzlePanel(requestPuzzleExit);
setupCaptions();
setupBottomLayout();
/** gancho de teste das legendas (tools/a11y/axe.mjs; só com ?debug=1): publica a legenda de um efeito como se ele
 *  tivesse tocado em `pos` (sem `pos`, sem direção), ouvida pelo jogador com a câmera atual, e escolhe o tempo na tela */
exposeDebugHook("__thehellCaptions", {
  emit: (name: string, pos?: { x: number; z: number }) => getCaptionBus().emit({ name, pos: pos ?? null, ear: G?.survivors[0] ?? null, yaw: view.yaw }),
  duration: (s: number) => getCaptionBus().setDuration(s),
});
startPadLoop(() => G);
// mudo do master (D-41) na tecla da ação `mute` (remapeável, V8; padrão M), com aviso na linha de mensagens do HUD;
// o slider de volume geral do menu de opções acompanha
installMuteKey(window, muted => { showMessage(muteMessage(muted)); refreshVolumeSliders(); }, undefined, isMuteKey);

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
  for (let i = 0; i < steps && !G.over; i++) step(gameCfg, G, readInput(G, STEP));
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
      captionsFrame(false);
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
  // legendas de som (V8b): só esmaecer e aria-live; a lista é refeita quando o barramento avisa
  captionsFrame(!G.over);
  hud(G, dt, view.yaw);
  if (urlRetro) statusBar(G, urlRetroClass);
  syncDynamic(ctx, G);
  puzzlePanel(G);
}
