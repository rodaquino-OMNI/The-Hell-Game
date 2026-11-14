// Cliente THE HELL (fase 0): porte da tela do protótipo (prototype/the-hell.html) sobre a simulação de @thehell/sim.
// A lógica de jogo está toda em packages/sim; este arquivo só orquestra o laço. Entrada em input.ts, render em render/,
// HUD em hud/, menu e loja em ui/, áudio em audio/.
import { createGame, drainEvents, makeConfig, matchReport, puzzleZoneWidth, skipTutorialStep, step, STEP, type GameEvent, type GameMode, type GameOptions, type GameState, type SimConfig } from "@thehell/sim";
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
import { resetTutorialHud, setupTutorialPanel, takeTutorialSkip, tutorialEvents, tutorialHud, tutorialNoticeOver, tutorialOutcomes } from "./hud/tutorial.ts";
import { advanceClock, frameLoop } from "./loop.ts";
import { getControls, isMuteKey, muteMessage, lockPointer, readInput, requestPuzzleExit, resetInput, setupInput, view } from "./input.ts";
import { exposeDebugHook } from "./debug-hooks.ts";
import { getColorMode } from "./look.ts";
import { getLayerA, getReduceFlicker } from "./render/layers.ts";
import { bobScale, cameraFov } from "./render/motion.ts";
import { installRenderHook } from "./render/debug.ts";
import { urlPs1, urlRetroClass, urlSeed, urlStress } from "./render/options.ts";
import { retroMode } from "./render/retro/mode.ts";
import { getPs1, setPs1 } from "./render/ps1.ts";
import { buildActors, buildWorld, disposeWorld, renderFrame, type RenderCtx } from "./render/scene.ts";
import { projectGround } from "./render/project.ts";
import { buildStress, renderStress, type StressScene } from "./render/stress.ts";
import { syncActors, syncDynamic } from "./render/sync.ts";
import { messageText } from "./text.ts";
import { matchConfig, selectedDifficulty } from "./ui/difficulty.ts";
import { initLocale } from "./ui/locale.ts";
import { applyOptions } from "./ui/apply.ts";
import { closeMenuDialogs, hideMenu, refreshMenuText, selectedClass, setStartBusy, setStartMode, setupMenu, showEnd } from "./ui/menu.ts";
import { currentOptions, refreshVolumeSliders, setupOptions } from "./ui/options.ts";
import { startPadLoop } from "./ui/padnav.ts";
import { loadOptions } from "./ui/settings.ts";
import { afterLoadIdle, startGate } from "./ui/start-gate.ts";
import { charactersReady } from "./render/characters/runtime.ts";
import { prefetchMatchCharacters } from "./render/characters/actors.ts";
import { reportEnabled, reportOptions } from "./ui/report.ts";
import { holdCount, resultsCount } from "./ui/results.ts";
import { persist, save } from "./ui/shop.ts";
import { setupTutorialEnd, showTutorialEnd } from "./ui/tutorial-end.ts";

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
/** modo Retro FPS da partida atual (V9; lido em init: mudar a opção vale na próxima partida) */
let retro = false;
/** partida normal ou Treino (V6; GDD-v0.3 §12.3, D-34), escolhido no menu */
let mode: GameMode = "normal";
/** fim do Treino recebido: a tela `tutorial_end` abre quando o aviso da última etapa sai do painel */
let tutorialEnd: Extract<GameEvent, { type: "tutorial_end" }> | null = null;

/** opções de `createGame`: na partida normal as mesmas de antes (só o relatório com ?debug=1); no Treino, o modo */
function gameOptions(): GameOptions | undefined {
  return mode === "tutorial" ? { ...reportOptions(), mode } : reportOptions();
}

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
  if (ctx) disposeWorld(ctx);
  ctx = buildWorld($("c") as HTMLCanvasElement);
  gameCfg = currentOptions().puzzleAccessible
    ? makeConfig(balance, map, { ruleset, difficulty: selectedDifficulty(), accessiblePuzzles: true, ...(mapFlags ? { mapFlags } : {}) })
    : matchConfig(cfg);
  // relatório de playtest (R8; ui/report.ts): a coleta só liga com ?debug=1; sem ela, nenhuma opção
  G = createGame(gameCfg, selectedClass(), urlSeed ?? ((Math.random() * 2 ** 31) | 0), gameOptions());
  tutorialEnd = null;
  resetInput();
  buildActors(ctx, G, save.eq);
  if (urlStress) stress = buildStress(ctx, G);
  view.yaw = 0;
  resetHud();
  resetTutorialHud(G);
  // modo Retro FPS (V9, D-13; opção do menu ou ?debug=1&retro=1): começa em 1ª pessoa (tecla da câmera alterna) com a
  // barra de estado fina embaixo; desligado, a 3ª pessoa padrão e o HUD padrão
  retro = retroMode();
  view.thirdPerson = !retro;
  setupStatusBar(retro);
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
  retro: retroMode(), colorMode: getColorMode(), uiScale: getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim(), controls: getControls(),
  puzzleZone: puzzleZoneWidth(gameCfg, false), accessiblePuzzles: gameCfg.accessiblePuzzles,
}));
/** vista da câmera (yaw, pitch, 1ª/3ª pessoa) exposta às capturas (tools/art/a2b-capturas.mjs, v9-capturas.mjs); só com ?debug=1 */
exposeDebugHook("__thehellView", view);
/** contagem do resumo de fim (tools/ui/r6-e2e.mjs e tools/a11y/axe.mjs; só com ?debug=1): estado, congelar numa fração
 *  (a em andamento ou a próxima: capturas e axe no meio da contagem) e pular */
exposeDebugHook("__thehellResults", {
  state: () => { const c = resultsCount(); return c ? { counting: c.counting, fraction: c.fraction } : null; },
  hold: (p: number) => holdCount(p),
  finish: () => resultsCount()?.finish(),
});

async function start(m: GameMode = "normal") {
  if (gate.busy()) return;
  mode = m;
  setStartMode(m);
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
setupTutorialPanel();
// fim do Treino: "Jogar partida" começa a partida normal na mesma página (o clique é o gesto do áudio e do pointer
// lock); "Voltar ao menu" recarrega, como "Jogar de novo" na tela de fim
setupTutorialEnd(() => void start("normal"), () => location.reload());
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
  // Treino: "pular etapa" pedido desde o último quadro, no máximo uma vez por quadro (hud/tutorial.ts)
  if (G.tutorial && !G.over && takeTutorialSkip()) skipTutorialStep(gameCfg, G);
  for (let i = 0; i < steps && !G.over; i++) step(gameCfg, G, readInput(G, STEP));
  // uma só drenagem por quadro: HUD e áudio leem a mesma lista (audioEvents é no-op com audio.director_enabled false)
  const events = drainEvents(G);
  audioEvents(events, G.survivors[0].id);
  tutorialEvents(G, gameCfg, events);
  for (const e of events) {
    if (e.type === "msg") showMessage(messageText(e));
    // com o diretor ligado o efeito completo sai em audioEvents; o bipe da fase 0 tocaria em dobro
    else if (e.type === "sound") { if (!directorEnabled()) beep(...SOUNDS[e.name]); }
    else if (e.type === "flash") triggerFlash();
    else if (e.type === "end") {
      save.co += e.coins; persist();
      document.exitPointerLock?.();
      captionsFrame(false);
      // relatório de playtest (só com ?debug=1): semente e dificuldade do nome do arquivo saem do próprio relatório
      const r = reportEnabled() && G.report ? matchReport(G) : null;
      showEnd(e, r ? { json: JSON.stringify(r), seed: r.seed, difficulty: r.difficulty } : null);
    }
    else if (e.type === "tutorial_end") {
      tutorialEnd = e;
      document.exitPointerLock?.();
      captionsFrame(false);
    }
  }
  tickTimers(dt);
  draw(dt);
  if (tutorialEnd && tutorialNoticeOver()) { showTutorialEnd(tutorialEnd, tutorialOutcomes()); tutorialEnd = null; }
}
const frames = frameLoop(requestAnimationFrame, loop);

function draw(dt: number) {
  syncActors(G, view.thirdPerson);
  // modo espectador (v1, GDD-v0.3 §3.3 item 4): a câmera segue o aliado escolhido, em 3ª pessoa
  const target = cameraTarget(G);
  if (target) renderFrame(ctx, { ...G, survivors: [target] }, { ...view, thirdPerson: true });
  else renderFrame(ctx, G, view);
  // áudio (V5, atrás de audio.director_enabled): ouvinte na câmera ativa (inclusive a 1ª pessoa do modo Retro FPS), logo
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
  // Treino: painel da etapa e marcador do alvo pela câmera que acabou de desenhar (no-op fora do modo tutorial)
  if (G.tutorial) tutorialHud(G, dt, (x, z) => projectGround(ctx.cam, x, z), ctx.cam.aspect);
  if (retro) statusBar(G, urlRetroClass);
  syncDynamic(ctx, G);
  puzzlePanel(G);
}
