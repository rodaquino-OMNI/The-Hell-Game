// Resumo de fim de partida (R6; GDD v0.2 §7.1–7.2): pontos do jogador nas 4 categorias (Objetivos, Altruísmo,
// Sobrevivência, Audácia), total, moedas (com ou sem o bônus de vitória) e resultado da equipe e individual.
// Só o v1 traz `score` no evento `end`; no protótipo o resumo fica oculto e a tela de fim mostra só o resultado e as
// moedas (menu.ts `showEnd`). Números: só os do evento, de `economy` e de `ui.results` (data/balance.yaml).
// Visual (issue #66): ícone ao lado de cada categoria (aria-hidden, o leitor de tela lê só o nome), total grande e
// destacado, moedas numa linha. Os pontos contam de 0 até o valor em `ui.results.count_up_s`; com "reduzir balanço de
// câmera" (opção do jogo) ou prefers-reduced-motion (sistema) aparecem na hora. Durante a contagem o foco já está em
// "Jogar de novo" e a primeira ativação (Enter, Espaço, A do gamepad ou clique) só pula para os valores finais.
// Leitor de tela: o número que conta é aria-hidden; ao lado fica o valor final em texto só para leitores (.sr).
import type { Balance } from "@thehell/shared";
import { SCORE_CATEGORIES, type GameEvent, type Individual, type ScoreCategory, type Team } from "@thehell/sim";
import { $, balance } from "../data.ts";
import { SCORE_ICON } from "../hud/icons.ts";
import { num, t, type Key } from "../i18n/index.ts";
import { getReduceCameraBob } from "../render/motion.ts";
import { REPORT_BOX } from "./report.ts";

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

// ---------- contagem ----------

/** fração da contagem (0 a 1) depois de `elapsed` s; duração 0 = já no fim */
export const countFraction = (elapsed: number, duration: number) => (duration <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / duration)));

/** valor mostrado na fração `p`: inteiro de 0 até `final` (o final exato em p = 1) */
export const countValue = (final: number, p: number) => (p >= 1 ? final : Math.round(final * Math.max(0, p)));

/** contagem desligada: "reduzir balanço de câmera" do menu de opções ou prefers-reduced-motion do sistema */
export function reduceMotion(
  bob: boolean = getReduceCameraBob(),
  media: boolean = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
): boolean {
  return bob || media;
}

export interface CountUp {
  /** ainda contando */
  readonly counting: boolean;
  /** fração mostrada (0 a 1) */
  readonly fraction: number;
  /** pula para os valores finais */
  finish(): void;
  /** congela a contagem na fração `p` (gancho de depuração: capturas e axe no meio da contagem) */
  hold(p: number): void;
}

/**
 * contagem de `cells` (elemento visível e valor final) em `durationS` s; `instant` mostra os finais na hora.
 * `raf` e `now` são injetáveis (testes). `onDone` roda uma vez, ao chegar nos finais (pelo tempo ou por `finish`)
 */
export function startCountUp(
  cells: { el: Element; final: number }[], durationS: number, instant: boolean, onDone: () => void = () => {},
  raf: (cb: () => void) => unknown = cb => requestAnimationFrame(cb), now: () => number = () => performance.now(),
): CountUp {
  let p = 0, done = false, held: number | null = null;
  const t0 = now();
  const show = (f: number) => { p = f; for (const c of cells) c.el.textContent = num(countValue(c.final, f)); };
  const finish = () => { if (done) return; done = true; show(1); onDone(); };
  const tick = () => {
    if (done) return;
    const f = held ?? countFraction((now() - t0) / 1000, durationS);
    if (f >= 1) { finish(); return; }
    show(f);
    raf(tick);
  };
  if (instant || durationS <= 0) finish();
  else { show(0); raf(tick); }
  return {
    get counting() { return !done; },
    get fraction() { return p; },
    finish,
    hold(f: number) { if (done) return; held = Math.min(1, Math.max(0, f)); if (held >= 1) finish(); else show(held); },
  };
}

let current: CountUp | null = null;
/** contagem da última tela de fim (null sem resumo) */
export const resultsCount = (): CountUp | null => current;

let nextHold: number | null = null;
/**
 * gancho de depuração: congela na fração `p` a contagem em andamento ou, sem contagem em andamento, a próxima (a tela
 * de fim chega pela simulação; congelar antes evita depender da velocidade da máquina nas capturas e no axe)
 */
export function holdCount(p: number) {
  if (current?.counting) current.hold(p);
  else nextHold = p;
}

// ---------- DOM ----------

/** elemento com id opcional e texto (textContent: nada de HTML vindo das traduções) */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, id?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (id) e.id = id;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** linha da tabela: cabeçalho (ícone opcional + rótulo) e valor (número que conta, aria-hidden, e o final para leitores) */
function row(label: string, value: number, icon?: string, valueId?: string): { tr: HTMLTableRowElement; shown: HTMLElement } {
  const tr = el("tr");
  const th = el("th");
  th.scope = "row";
  if (icon) {
    const i = el("span");
    i.className = "rsi";
    i.setAttribute("aria-hidden", "true");
    i.innerHTML = icon; // SVG fixo de hud/icons.ts (sem texto de tradução)
    th.append(i);
  }
  th.append(label);
  const td = el("td", undefined, valueId);
  const shown = el("span", num(value));
  shown.className = "rsv";
  shown.setAttribute("aria-hidden", "true");
  const sr = el("span", num(value));
  sr.className = "sr";
  td.append(shown, sr);
  tr.append(th, td);
  return { tr, shown };
}

let skipInstalled = false;
/** durante a contagem, a 1ª ativação dentro da tela de fim (Enter/Espaço/A em "Jogar de novo" ou clique) só pula */
function installSkip(end: HTMLElement) {
  if (skipInstalled) return;
  skipInstalled = true;
  end.addEventListener("click", e => {
    if (!current?.counting) return;
    // botões do relatório de playtest (só com ?debug=1, report.ts) não pulam a contagem
    if ((e.target as Element | null)?.closest?.(`#${REPORT_BOX}`)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    current.finish();
  }, true);
}

/** monta (ou esconde) o resumo dentro da tela de fim, antes de `before`, e começa a contagem */
export function showResults(e: EndEvent, before: Element = $("again")) {
  document.getElementById("rs")?.remove();
  current?.finish();
  current = null;
  const s = resultsSummary(e);
  if (!s) return;
  const box = el("section", undefined, "rs");
  box.setAttribute("aria-labelledby", "rst");
  const body = el("tbody");
  const cells: { el: Element; final: number }[] = [];
  for (const r of s.rows) {
    const { tr, shown } = row(r.label, r.points, SCORE_ICON[r.category]);
    tr.dataset.cat = r.category;
    body.append(tr);
    cells.push({ el: shown, final: r.points });
  }
  const foot = el("tfoot");
  const tot = row(t("score.total"), s.total, undefined, "rstot");
  foot.append(tot.tr);
  cells.push({ el: tot.shown, final: s.total });
  const table = el("table");
  table.append(body, foot);
  box.append(el("h2", t("score.title"), "rst"), table, el("p", s.coinsText, "rsc"));
  if (s.team) box.append(el("p", t("score.team", { team: s.team }), "rsteam"));
  if (s.individual) box.append(el("p", t("score.individual", { individual: s.individual }), "rsind"));
  before.before(box);
  const end = before.closest<HTMLElement>("#end");
  if (end) installSkip(end);
  box.dataset.counting = "true";
  current = startCountUp(cells, balance.ui.results.count_up_s, reduceMotion(), () => { box.dataset.counting = "false"; });
  if (nextHold !== null) { current.hold(nextHold); nextHold = null; }
}
