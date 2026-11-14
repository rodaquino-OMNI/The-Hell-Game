// Painel do Treino no HUD (V6; GDD-v0.3 §12.3; D-34): etapa atual com o texto (i18n), barra de progresso só em "mover"
// e "quebra-cabeça", check nas etapas binárias quando chega o `tutorial_step`, aviso "concluída" ou "etapa pulada" por
// `ui.tutorial.done_s`, marcador do alvo no mundo (ou seta na borda) e o botão "Pular etapa" (tecla remapeável
// `tutorial_skip`, botão `ui.controls.gamepad.buttons.tutorial_skip`). A troca de etapa sai num aria-live polite
// (#tutl); a barra e o progresso não são anunciados a cada quadro. Fora do modo tutorial nada aparece.
// Lógica pura em tutorial-logic.ts; números de data/balance.yaml (`tutorial`, `ui.tutorial`).
import { tutorialGoal, type GameEvent, type GameState, type SimConfig, type TutorialStepName } from "@thehell/sim";
import { $, balance } from "../data.ts";
import { keysText } from "../bindings.ts";
import { num, t, type Key } from "../i18n/index.ts";
import { exposeDebugHook } from "../debug-hooks.ts";
import { getControls } from "../input.ts";
import { padButtonName } from "../ui/options.ts";
import {
  createSkipGate, markerPlacement, newTrack, panelView, tickTrack, trackEvents, type PanelView, type Projected, type TutorialTrack,
} from "./tutorial-logic.ts";

const STEP_NAME: Record<TutorialStepName, Key> = {
  move: "tut.step.move", generator: "tut.step.generator", puzzle: "tut.step.puzzle", rescue: "tut.step.rescue", ability: "tut.step.ability",
};
/** nome da etapa no idioma atual */
export const stepName = (s: TutorialStepName) => t(STEP_NAME[s]);

/** recuo da seta na borda da tela, em px (layout, não número de jogo) */
const EDGE_MARGIN = 40;
const ARROW = `<svg viewBox="0 0 16 16" width="100%" height="100%" aria-hidden="true" focusable="false" fill="currentColor" stroke="var(--ui-bg)" stroke-width="1"><path d="M8 1l6 9H10v5H6v-5H2z"/></svg>`;

const gate = createSkipGate(balance.ui.tutorial.skip_debounce_s);
let track: TutorialTrack = newTrack();
/** aviso parado na tela (só pelo gancho de depuração abaixo: capturas e axe do aviso em máquina lenta) */
let holdNotice = false;
/** gancho do Treino (tools/ui/v6-e2e.mjs e tools/a11y/axe.mjs; só com ?debug=1, D-33): segura o aviso de etapa
 *  terminada na tela (`hold(true)`) e solta (`hold(false)`); não mexe na simulação */
exposeDebugHook("__thehellTutorial", { hold: (on: boolean) => { holdNotice = on; } });
/** último estado escrito no DOM (o painel é revisto a cada quadro; só muda o que mudou) */
const last = new Map<string, string>();
const setText = (id: string, v: string) => { if (last.get(id) !== v) { last.set(id, v); $(id).textContent = v; } };
const setAttr = (id: string, a: string, v: string) => { const k = `${id}@${a}`; if (last.get(k) !== v) { last.set(k, v); $(id).setAttribute(a, v); } };

/**
 * pedido de "pular etapa" (tecla, botão do painel, gamepad); vale no máximo um por quadro e por `skip_debounce_s`.
 * `ms` = instante do acionamento (Event.timeStamp, mesmo relógio de performance.now): apertos enfileirados atrás de um
 * quadro lento contam pelo instante em que aconteceram, não por quando foram tratados
 */
export const requestTutorialSkip = (ms: number = performance.now()) => gate.request(ms / 1000);
/** chamado uma vez por quadro em main.ts, antes do passo: true = chamar `skipTutorialStep` agora */
export const takeTutorialSkip = () => gate.take();
/** como cada etapa terminou (tela `tutorial_end`) */
export const tutorialOutcomes = () => track.outcomes;
/** o aviso da última etapa terminada já saiu da tela (a tela de fim espera por ele) */
export const tutorialNoticeOver = () => track.notice === null;

/** liga o botão "Pular etapa" (o clique não vira golpe: o mousedown não chega ao canvas, como em #pzx) */
export function setupTutorialPanel() {
  const b = $("tuts");
  b.onmousedown = e => e.stopPropagation();
  b.onclick = e => requestTutorialSkip(e.timeStamp);
}

/** nova partida: painel e marcador escondidos fora do Treino; no Treino anuncia a primeira etapa */
export function resetTutorialHud(G: GameState) {
  track = newTrack();
  holdNotice = false;
  gate.reset();
  last.clear();
  const on = !!G.tutorial;
  $("tut").hidden = !on;
  $("tmk").hidden = true;
  $("tutl").textContent = "";
  if (on && G.tutorial!.step) $("tutl").textContent = t("tut.live.start", { n: G.tutorial!.index + 1, total: balance.tutorial.steps.length, step: stepName(G.tutorial!.step) });
}

/** eventos do quadro (os mesmos que main.ts drena): resultado das etapas e o anúncio da troca */
export function tutorialEvents(G: GameState, cfg: SimConfig, events: readonly GameEvent[]) {
  if (!G.tutorial) return;
  const ended = trackEvents(track, events, s => tutorialGoal(cfg, s), balance.ui.tutorial.done_s);
  if (!ended.length) return;
  const total = balance.tutorial.steps.length, now = G.tutorial;
  const parts = ended.map(o => t(o.outcome === "skipped" ? "tut.live.skipped" : "tut.live.done", { step: stepName(o.step) }));
  if (now.step) parts.push(t("tut.live.next", { n: now.index + 1, total, step: stepName(now.step) }));
  $("tutl").textContent = parts.join(" ");
}

function instruction(G: GameState, step: TutorialStepName): string {
  const k = getControls().keys, tb = balance.tutorial;
  switch (step) {
    case "move": return t("tut.do.move", { distance: num(tb.move.distance), keys: [k.forward, k.left, k.back, k.right].map(keysText).join(" ") });
    case "generator": return t("tut.do.generator", { key: keysText(k.interact) });
    case "puzzle": return t("tut.do.puzzle", { count: tb.puzzle.count });
    case "rescue": return t("tut.do.rescue", { key: keysText(k.interact) });
    case "ability": return G.survivors[0].cls === "Mecânico" ? t("tut.do.ability_generator", { key: keysText(k.ability) }) : t("tut.do.ability", { key: keysText(k.ability) });
  }
}

function render(G: GameState, v: PanelView) {
  setText("tuth", t("tut.header", { n: v.index + 1, total: balance.tutorial.steps.length }));
  setText("tutt", stepName(v.step));
  setText("tuto", v.outcome === "done" ? t("tut.done") : v.outcome === "skipped" ? t("tut.skipped") : "");
  setAttr("tutk", "data-mark", v.mark ?? "");
  setText("tutk", v.mark === "check" ? "✓" : v.mark === "skipped" ? "»" : "");
  setText("tutd", instruction(G, v.step));
  const bar = $("tutb");
  bar.hidden = v.bar === null;
  $("tutp").hidden = v.bar === null;
  if (v.bar !== null && v.progress) {
    const pct = Math.round(v.bar * 100);
    setAttr("tutb", "aria-valuenow", String(pct));
    setAttr("tutb", "aria-valuetext", t(v.step === "move" ? "tut.progress.move" : "tut.progress.puzzle", { done: num(v.progress.done, v.step === "move" ? 1 : 0), goal: num(v.progress.goal) }));
    (bar.firstElementChild as HTMLElement).style.width = `${pct}%`;
    setText("tutp", $("tutb").getAttribute("aria-valuetext")!);
  }
  const pad = padButtonName(balance.ui.controls.gamepad.buttons.tutorial_skip);
  setText("tuts", t("tut.skip", { key: keysText(getControls().keys.tutorial_skip), pad }));
}

/**
 * um quadro do painel: `dt` em s; `project` dá o ponto do alvo na tela (render/project.ts, câmera atual) e `aspect` a
 * proporção da imagem desenhada. Escondido fora do Treino e depois do fim
 */
export function tutorialHud(G: GameState, dt: number, project: (x: number, z: number) => Projected, aspect: number) {
  if (!G.tutorial) return;
  if (!holdNotice) tickTrack(track, dt);
  const v = panelView(G.tutorial, track.notice);
  $("tut").hidden = !v;
  if (v) render(G, v);
  const mk = $("tmk"), T = G.tutorial.target;
  if (!T || G.over) { mk.hidden = true; return; }
  const p = markerPlacement(project(T.x, T.z), aspect, innerWidth, innerHeight, EDGE_MARGIN);
  mk.hidden = false;
  if (!mk.firstChild) mk.innerHTML = ARROW;
  mk.dataset.edge = String(p.edge);
  mk.dataset.kind = T.kind;
  mk.style.left = `${p.x}px`;
  mk.style.top = `${p.y}px`;
  mk.style.transform = p.edge ? `translate(-50%,-50%) rotate(${p.angle}deg)` : `translate(-50%,-100%) rotate(180deg)`;
}
