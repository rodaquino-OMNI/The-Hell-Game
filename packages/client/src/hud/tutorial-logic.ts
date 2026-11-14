// Lógica pura da tela do Treino (V6; GDD-v0.3 §12.3; D-34): barra de progresso, aviso de etapa terminada (concluída ou
// pulada), "pular etapa" com um pedido por acionamento e posição do marcador do alvo. Sem DOM nem i18n: testada em
// packages/client/test/tutorial-ui.test.ts. O roteiro (etapas, metas, alvos) é do sim (packages/sim/src/tutorial.ts).
import type { GameEvent, TutorialState, TutorialStepName } from "@thehell/sim";

/** como a etapa terminou: feita pelo jogador ou pulada (`tutorial_step` com `skipped: true`) */
export type StepOutcome = "done" | "skipped";

/** etapas com meta contável (`progress`/`goal`): só estas têm barra; as outras são binárias (generator, rescue, ability) */
export const isBarStep = (s: TutorialStepName): boolean => s === "move" || s === "puzzle";

/**
 * fração da barra: `min(1, progress/goal)` só em "move" e "puzzle"; null sem barra (fim do Treino, `step === null`, ou
 * etapa binária, em que `progress` fica em 0 e o fim chega pelo evento; types.ts `TutorialState.goal`)
 */
export function barFraction(t: TutorialState | undefined): number | null {
  if (!t || t.step === null || !isBarStep(t.step) || !(t.goal > 0)) return null;
  return Math.min(1, Math.max(0, t.progress / t.goal));
}

/** evento → etapa terminada e como (null se não é `tutorial_step`) */
export function stepOutcome(e: GameEvent): { step: TutorialStepName; index: number; outcome: StepOutcome } | null {
  if (e.type !== "tutorial_step") return null;
  return { step: e.step, index: e.index, outcome: e.skipped ? "skipped" : "done" };
}

/**
 * ícone da etapa: "empty" (quadro do check numa etapa binária em andamento), "check" (binária concluída: o evento
 * chegou), "skipped" (qualquer etapa pulada) ou null (etapa com barra, que não usa check)
 */
export type StepMark = "empty" | "check" | "skipped" | null;

/** aviso da etapa que acabou de terminar, mostrado por `ui.tutorial.done_s` antes da etapa seguinte */
export interface Notice { step: TutorialStepName; index: number; outcome: StepOutcome; goal: number; left: number }

/** o que o painel mostra */
export interface PanelView {
  step: TutorialStepName;
  index: number;
  /** null = etapa em andamento; senão o aviso de etapa terminada */
  outcome: StepOutcome | null;
  /** fração da barra (0 a 1) ou null sem barra */
  bar: number | null;
  /** progresso em números (metros ou acertos) junto da barra; null sem barra */
  progress: { done: number; goal: number } | null;
  mark: StepMark;
}

/** painel: o aviso da etapa terminada enquanto dura; senão a etapa atual; null depois da última etapa sem aviso */
export function panelView(t: TutorialState | undefined, notice: Notice | null): PanelView | null {
  if (notice) {
    const bar = isBarStep(notice.step);
    const full = bar && notice.outcome === "done";
    return {
      step: notice.step, index: notice.index, outcome: notice.outcome,
      // etapa com barra concluída: barra cheia; pulada: sem barra (não foi cumprida). Binária: nunca barra
      bar: full ? 1 : null, progress: full ? { done: notice.goal, goal: notice.goal } : null,
      mark: notice.outcome === "skipped" ? "skipped" : bar ? null : "check",
    };
  }
  if (!t || t.step === null) return null;
  const bar = barFraction(t);
  return {
    step: t.step, index: t.index, outcome: null, bar,
    progress: bar === null ? null : { done: Math.min(t.progress, t.goal), goal: t.goal },
    mark: bar === null ? "empty" : null,
  };
}

/** registro do Treino na tela: como cada etapa terminou (para a tela `tutorial_end`) e o aviso em curso */
export interface TutorialTrack { outcomes: Map<number, { step: TutorialStepName; outcome: StepOutcome }>; notice: Notice | null }
export const newTrack = (): TutorialTrack => ({ outcomes: new Map(), notice: null });

/**
 * aplica os eventos do quadro: cada `tutorial_step` grava o resultado e vira o aviso (o último do quadro vence).
 * `goalOf` = meta da etapa (sim `tutorialGoal`), para a barra cheia da etapa concluída. Devolve as etapas terminadas
 * neste quadro, na ordem (para o aria-live)
 */
export function trackEvents(tr: TutorialTrack, events: readonly GameEvent[], goalOf: (s: TutorialStepName) => number, doneS: number) {
  const out: { step: TutorialStepName; index: number; outcome: StepOutcome }[] = [];
  for (const e of events) {
    const o = stepOutcome(e);
    if (!o) continue;
    tr.outcomes.set(o.index, { step: o.step, outcome: o.outcome });
    tr.notice = { ...o, goal: goalOf(o.step), left: doneS };
    out.push(o);
  }
  return out;
}

/** passa o tempo do aviso (s); some ao zerar */
export function tickTrack(tr: TutorialTrack, dt: number) {
  if (!tr.notice) return;
  tr.notice.left -= dt;
  if (tr.notice.left <= 0) tr.notice = null;
}

/**
 * "pular etapa" com debounce: `request(now)` (tecla, botão, gamepad; `now` = instante do acionamento em s, relógio real)
 * aceita o pedido só se o último aceito foi há pelo menos `debounceS` s, senão o descarta (não fica guardado para pular
 * a etapa seguinte sozinho). `take`, chamado uma vez por quadro antes do passo da simulação, devolve true no máximo
 * uma vez por quadro: vários pedidos aceitos no mesmo quadro viram um. O intervalo conta do acionamento, não do
 * quadro: com quadro lento (mais longo que `debounceS`), dois apertos seguidos caem em quadros diferentes e o segundo
 * ainda é descartado
 */
export interface SkipGate { request(now: number): boolean; take(): boolean; reset(): void }
export function createSkipGate(debounceS: number): SkipGate {
  let pending = false, last = -Infinity;
  return {
    request(now: number) {
      if (now - last < debounceS) return false;
      last = now;
      pending = true;
      return true;
    },
    take() { const ok = pending; pending = false; return ok; },
    reset() { pending = false; last = -Infinity; },
  };
}

/** ponto do alvo projetado pela câmera: coordenadas normalizadas (−1 a 1) e se está atrás dela */
export interface Projected { nx: number; ny: number; behind: boolean }
/** posição do marcador em px da janela; `edge` = alvo fora da vista (seta na borda); `angle` em graus, 0 = para cima */
export interface Placement { x: number; y: number; edge: boolean; angle: number }

/**
 * marcador do alvo: no ponto da tela quando visível; senão uma seta na borda (recuada `margin` px) na direção do alvo.
 * O canvas é desenhado com `object-fit: cover` (index.html, #c), então a imagem de proporção `aspect` cobre a janela
 * `w`×`h` e é cortada no eixo que sobra. Atrás da câmera a projeção sai espelhada: a direção é invertida.
 */
export function markerPlacement(p: Projected, aspect: number, w: number, h: number, margin: number): Placement {
  let iw = w, ih = w / aspect;
  if (ih < h) { ih = h; iw = h * aspect; }
  const x = w / 2 + (p.nx * iw) / 2, y = h / 2 - (p.ny * ih) / 2;
  if (!p.behind && x >= margin && x <= w - margin && y >= margin && y <= h - margin) return { x, y, edge: false, angle: 180 };
  let dx = x - w / 2, dy = y - h / 2;
  if (p.behind) { dx = -dx; dy = -dy; }
  if (dx === 0 && dy === 0) dy = 1; // atrás, no eixo da câmera: seta para baixo
  const hw = w / 2 - margin, hh = h / 2 - margin;
  const k = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return { x: w / 2 + dx * k, y: h / 2 + dy * k, edge: true, angle: (Math.atan2(dx, -dy) * 180) / Math.PI };
}
