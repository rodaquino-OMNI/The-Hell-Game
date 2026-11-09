// Escolha de dificuldade no menu (R6; GDD v0.2 §7.3, GDD v0.3 §12.4). Os níveis e o multiplicador de pontos vêm de
// `difficulty_table` (data/balance.yaml); o padrão é `difficulty`. A escolha fica no localStorage (com try/catch,
// como o idioma) e entra no `makeConfig` de cada partida (`matchConfig`).
// Acessibilidade: botões nativos com aria-pressed num grupo rotulado (teclado e navegação por gamepad), foco visível
// pelo estilo global de :focus-visible. Visual neutro provisório: só os estilos já existentes do menu.
import type { Balance } from "@thehell/shared";
import { makeConfig, type Difficulty, type SimConfig } from "@thehell/sim";
import { $, balance } from "../data.ts";
import { t } from "../i18n/index.ts";

export const DIFFICULTY_STORE = "thehell.difficulty";

/** armazenamento mínimo (localStorage ou um falso nos testes) */
export interface KeyStore { getItem(k: string): string | null; setItem(k: string, v: string): void }
const storage = (): KeyStore | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** níveis na ordem da tabela de dados */
export const difficulties = (b: Balance = balance) => Object.keys(b.difficulty_table) as Difficulty[];

/** dificuldade salva, se válida; senão o padrão dos dados */
export function loadDifficulty(b: Balance = balance, store: KeyStore | null = storage()): Difficulty {
  let v: string | null = null;
  try { v = store?.getItem(DIFFICULTY_STORE) ?? null; } catch { /* sem armazenamento */ }
  return v && v in b.difficulty_table ? (v as Difficulty) : b.difficulty;
}

/** grava a escolha (ignora falha de armazenamento) */
export function saveDifficulty(d: Difficulty, store: KeyStore | null = storage()) {
  try { store?.setItem(DIFFICULTY_STORE, d); } catch { /* sem armazenamento */ }
}

let current: Difficulty | null = null;
/** dificuldade escolhida no menu */
export const selectedDifficulty = (): Difficulty => (current ??= loadDifficulty());

/** configuração da partida: a base (ruleset do cliente) com a dificuldade escolhida */
export function matchConfig(base: SimConfig, d: Difficulty = selectedDifficulty()): SimConfig {
  if (d === base.difficulty) return base;
  return makeConfig(base.balance, base.map, { ruleset: base.v1 ? "v1" : "prototype", difficulty: d });
}

/** multiplicador de pontos da dificuldade (dados) */
export const pointsMult = (d: Difficulty, b: Balance = balance) => b.difficulty_table[d].points_mult;

/** texto do multiplicador; no protótipo a dificuldade não muda a partida (`makeConfig`), e o texto diz isso */
export function difficultyNote(d: Difficulty, v1: boolean, b: Balance = balance): string {
  const mult = t("difficulty.points_mult", { mult: pointsMult(d, b) });
  return v1 ? mult : `${mult} · ${t("difficulty.prototype_note")}`;
}

const NAME: Record<Difficulty, "difficulty.easy" | "difficulty.normal" | "difficulty.hard" | "difficulty.nightmare"> = {
  easy: "difficulty.easy", normal: "difficulty.normal", hard: "difficulty.hard", nightmare: "difficulty.nightmare",
};
export const difficultyName = (d: Difficulty) => t(NAME[d]);

let v1 = false;

/** textos do seletor (troca de idioma) */
export function difficultyText() {
  const box = document.getElementById("dif");
  if (!box) return;
  $("difl").textContent = t("difficulty.label");
  for (const b of box.querySelectorAll<HTMLButtonElement>("button")) b.textContent = difficultyName(b.dataset.d as Difficulty);
  $("difm").textContent = difficultyNote(selectedDifficulty(), v1);
}

/** monta o seletor antes de `before` (dentro do menu) */
export function setupDifficulty(before: Element, isV1: boolean) {
  v1 = isV1;
  const label = document.createElement("p");
  label.id = "difl";
  const box = document.createElement("div");
  box.id = "dif";
  box.setAttribute("role", "group");
  box.setAttribute("aria-labelledby", "difl");
  box.setAttribute("aria-describedby", "difm");
  const note = document.createElement("p");
  note.id = "difm";
  note.setAttribute("aria-live", "polite");
  for (const d of difficulties()) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.d = d;
    b.setAttribute("aria-pressed", String(d === selectedDifficulty()));
    b.onclick = () => {
      current = d;
      saveDifficulty(d);
      for (const x of box.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
      $("difm").textContent = difficultyNote(d, v1);
    };
    box.appendChild(b);
  }
  before.before(label, box, note);
  difficultyText();
}
