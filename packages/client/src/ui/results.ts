// Resumo de fim de partida (R6; GDD v0.2 §7.1–7.2): pontos do jogador nas 4 categorias (Objetivos, Altruísmo,
// Sobrevivência, Audácia), total, moedas (com ou sem o bônus de vitória) e resultado da equipe e individual.
// Só o v1 traz `score` no evento `end`; no protótipo o resumo fica oculto e a tela de fim mostra só o resultado e as
// moedas (menu.ts `showEnd`). Números: só os do evento e de `economy` (data/balance.yaml).
// Visual neutro provisório: tabela nativa com os estilos já existentes da tela de fim.
import type { Balance } from "@thehell/shared";
import { SCORE_CATEGORIES, type GameEvent, type Individual, type ScoreCategory, type Team } from "@thehell/sim";
import { $, balance } from "../data.ts";
import { num, t, type Key } from "../i18n/index.ts";

type EndEvent = Extract<GameEvent, { type: "end" }>;

const CATEGORY: Record<ScoreCategory, Key> = {
  objectives: "score.objectives", altruism: "score.altruism", survival: "score.survival", boldness: "score.boldness",
};

export interface ResultsSummary {
  /** categorias na ordem do §7.1, com o rótulo traduzido */
  rows: { category: ScoreCategory; label: string; points: number }[];
  total: number;
  coins: number;
  /** linha das moedas (com o bônus de vitória quando `winCoins`) */
  coinsText: string;
  team?: Team;
  individual?: Individual;
}

/** resumo a partir do evento `end`; null no formato do protótipo (sem `score`) */
export function resultsSummary(e: EndEvent, b: Balance = balance): ResultsSummary | null {
  const score = e.score;
  if (!score) return null;
  const rows = SCORE_CATEGORIES.map(category => ({ category, label: t(CATEGORY[category]), points: score[category] }));
  const total = rows.reduce((s, r) => s + r.points, 0);
  const coinsText = t("score.coins", { coins: e.coins, bonus: e.winCoins ? "yes" : "no", win: b.economy.win_coins });
  return { rows, total, coins: e.coins, coinsText, team: e.team, individual: e.individual };
}

/** monta (ou esconde) o resumo dentro da tela de fim, antes de `before` */
export function showResults(e: EndEvent, before: Element = $("again")) {
  document.getElementById("rs")?.remove();
  const s = resultsSummary(e);
  if (!s) return;
  const box = document.createElement("section");
  box.id = "rs";
  box.setAttribute("aria-labelledby", "rst");
  const rowsHtml = s.rows.map(r => `<tr data-cat="${r.category}"><th scope="row">${r.label}</th><td>${num(r.points)}</td></tr>`).join("");
  box.innerHTML =
    `<h2 id="rst">${t("score.title")}</h2>` +
    `<table><tbody>${rowsHtml}</tbody><tfoot><tr><th scope="row">${t("score.total")}</th><td id="rstot">${num(s.total)}</td></tr></tfoot></table>` +
    `<p id="rsc">${s.coinsText}</p>` +
    (s.team ? `<p id="rsteam">${t("score.team", { team: s.team })}</p>` : "") +
    (s.individual ? `<p id="rsind">${t("score.individual", { individual: s.individual })}</p>` : "");
  before.before(box);
}
