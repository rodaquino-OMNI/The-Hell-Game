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

/** elemento com id opcional e texto (textContent: nada de HTML vindo das traduções) */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, id?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (id) e.id = id;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** linha da tabela: cabeçalho de linha e valor */
function row(label: string, value: number, valueId?: string): HTMLTableRowElement {
  const tr = el("tr");
  const th = el("th", label);
  th.scope = "row";
  tr.append(th, el("td", num(value), valueId));
  return tr;
}

/** monta (ou esconde) o resumo dentro da tela de fim, antes de `before` */
export function showResults(e: EndEvent, before: Element = $("again")) {
  document.getElementById("rs")?.remove();
  const s = resultsSummary(e);
  if (!s) return;
  const box = el("section", undefined, "rs");
  box.setAttribute("aria-labelledby", "rst");
  const body = el("tbody");
  for (const r of s.rows) {
    const tr = row(r.label, r.points);
    tr.dataset.cat = r.category;
    body.append(tr);
  }
  const foot = el("tfoot");
  foot.append(row(t("score.total"), s.total, "rstot"));
  const table = el("table");
  table.append(body, foot);
  box.append(el("h2", t("score.title"), "rst"), table, el("p", s.coinsText, "rsc"));
  if (s.team) box.append(el("p", t("score.team", { team: s.team }), "rsteam"));
  if (s.individual) box.append(el("p", t("score.individual", { individual: s.individual }), "rsind"));
  before.before(box);
}
