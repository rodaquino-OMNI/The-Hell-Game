// Tela de fim do Treino (V6; GDD-v0.3 §12.3; evento `tutorial_end` do sim): mensagem de conclusão, a lista das etapas
// com feita/pulada e os botões "Jogar partida" e "Voltar ao menu". Não é a tela de resultados da partida (#end): o
// Treino não dá pontos nem moedas. Acessibilidade (WCAG 2.2 AA; GDD-v0.3 §12.4): diálogo modal com título e
// descrição, botões nativos (teclado e gamepad pela navegação de ui/padnav.ts), foco no primeiro botão ao abrir.
import type { GameEvent, TutorialStepName } from "@thehell/sim";
import { $, balance } from "../data.ts";
import { t } from "../i18n/index.ts";
import { stepName } from "../hud/tutorial.ts";
import type { StepOutcome } from "../hud/tutorial-logic.ts";

/** linhas da lista: cada etapa de `tutorial.steps` na ordem, com o resultado registrado (ausente conta como pulada) */
export function endRows(steps: readonly TutorialStepName[], outcomes: ReadonlyMap<number, { step: TutorialStepName; outcome: StepOutcome }>) {
  return steps.map((step, i) => ({ step, outcome: outcomes.get(i)?.outcome ?? ("skipped" as StepOutcome) }));
}

/** liga os botões: `play` começa uma partida normal; `menu` volta ao menu inicial */
export function setupTutorialEnd(play: () => void, menu: () => void) {
  $("tplay").onclick = () => { hideTutorialEnd(); play(); };
  $("tmenu").onclick = menu;
}

export function hideTutorialEnd() { $("tend").style.display = "none"; }

export function showTutorialEnd(e: Extract<GameEvent, { type: "tutorial_end" }>, outcomes: ReadonlyMap<number, { step: TutorialStepName; outcome: StepOutcome }>) {
  const rows = endRows(balance.tutorial.steps, outcomes);
  const skipped = rows.filter(r => r.outcome === "skipped").length;
  $("tes").textContent = t("tutend.sub", { time: e.time }) + " " + t("tutend.summary", { skipped });
  $("tel").replaceChildren(...rows.map(r => {
    const li = document.createElement("li");
    li.dataset.outcome = r.outcome;
    const mark = document.createElement("span");
    mark.className = "tm";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = r.outcome === "done" ? "✓" : "»";
    const name = document.createElement("span");
    name.textContent = stepName(r.step);
    const st = document.createElement("span");
    st.className = "ts";
    st.textContent = t(r.outcome === "done" ? "tutend.item_done" : "tutend.item_skipped");
    li.append(mark, name, st);
    return li;
  }));
  $("hud").hidden = true;
  $("tend").style.display = "flex";
  $("tplay").focus();
}
