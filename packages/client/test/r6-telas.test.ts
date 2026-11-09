// Telas do R6 (GDD v0.2 §7.1–7.3): resumo de fim de partida a partir do evento `end` e persistência da dificuldade.
import { describe, expect, it } from "vitest";
import { loadBalanceFile } from "@thehell/shared/node";
import { makeConfig, SCORE_CATEGORIES, type GameEvent } from "@thehell/sim";
import { map } from "../src/data.ts";
import { setLocale, t } from "../src/i18n/index.ts";
import { DIFFICULTY_STORE, difficulties, difficultyNote, loadDifficulty, matchConfig, pointsMult, saveDifficulty, type KeyStore } from "../src/ui/difficulty.ts";
import { resultsSummary } from "../src/ui/results.ts";

const bal = loadBalanceFile(new URL("../../../data/balance.yaml", import.meta.url).pathname);
type End = Extract<GameEvent, { type: "end" }>;
const v1End: End = {
  type: "end", win: true, outcome: "escaped", coins: 263, time: 300, team: "survivors", reason: "all_terminal",
  individual: "escaped", score: { objectives: 90, altruism: 60, survival: 100, boldness: 0 }, winCoins: true,
};

const memStore = (init: Record<string, string> = {}): KeyStore & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
};

describe("resumo de fim de partida (results.ts)", () => {
  setLocale("pt-BR");

  it("v1: 4 categorias na ordem do §7.1, total e rótulos traduzidos", () => {
    const s = resultsSummary(v1End, bal)!;
    expect(s.rows.map(r => r.category)).toEqual([...SCORE_CATEGORIES]);
    expect(s.rows.map(r => r.label)).toEqual(["score.objectives", "score.altruism", "score.survival", "score.boldness"].map(k => t(k as never)));
    expect(s.rows.map(r => r.points)).toEqual([90, 60, 100, 0]);
    expect(s.total).toBe(250);
    expect(s.team).toBe("survivors");
    expect(s.individual).toBe("escaped");
  });

  it("moedas: com e sem o bônus de vitória (valor de economy.win_coins)", () => {
    const yes = resultsSummary(v1End, bal)!.coinsText;
    expect(yes).toContain("263");
    expect(yes).toContain(String(bal.economy.win_coins));
    expect(yes).toContain("bônus de vitória de");
    const no = resultsSummary({ ...v1End, win: true, winCoins: false, individual: "dead" }, bal)!.coinsText;
    expect(no).toContain("sem bônus de vitória");
  });

  it("protótipo (evento sem score): sem resumo", () => {
    expect(resultsSummary({ type: "end", win: false, outcome: "died", coins: 40, time: 100 }, bal)).toBeNull();
  });

  it("os textos existem nos 3 idiomas", () => {
    for (const l of ["en", "es", "pt-BR"]) {
      setLocale(l);
      const s = resultsSummary(v1End, bal)!;
      for (const r of s.rows) expect(r.label).not.toMatch(/^score\./);
      expect(s.coinsText).not.toContain("{");
    }
    setLocale("pt-BR");
  });
});

describe("dificuldade (difficulty.ts)", () => {
  it("níveis e multiplicadores vêm de difficulty_table", () => {
    expect(difficulties(bal)).toEqual(["easy", "normal", "hard", "nightmare"]);
    for (const d of difficulties(bal)) expect(pointsMult(d, bal)).toBe(bal.difficulty_table[d].points_mult);
  });

  it("sem escolha salva (ou com valor inválido) usa o padrão dos dados", () => {
    expect(loadDifficulty(bal, memStore())).toBe(bal.difficulty);
    expect(loadDifficulty(bal, memStore({ [DIFFICULTY_STORE]: "impossivel" }))).toBe(bal.difficulty);
    expect(loadDifficulty(bal, null)).toBe(bal.difficulty);
  });

  it("grava e relê a escolha", () => {
    const s = memStore();
    saveDifficulty("nightmare", s);
    expect(s.data[DIFFICULTY_STORE]).toBe("nightmare");
    expect(loadDifficulty(bal, s)).toBe("nightmare");
  });

  it("armazenamento que lança erro não quebra", () => {
    const broken: KeyStore = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    expect(() => saveDifficulty("hard", broken)).not.toThrow();
    expect(loadDifficulty(bal, broken)).toBe(bal.difficulty);
  });

  it("matchConfig aplica a dificuldade no makeConfig e mantém o ruleset", () => {
    const v1 = makeConfig(bal, map, { ruleset: "v1" });
    const hard = matchConfig(v1, "hard");
    expect(hard.v1).toBe(true);
    expect(hard.difficulty).toBe("hard");
    expect(hard.pointsMult).toBe(bal.difficulty_table.hard.points_mult);
    expect(matchConfig(v1, v1.difficulty)).toBe(v1);
    const proto = matchConfig(makeConfig(bal, map, { ruleset: "prototype" }), "nightmare");
    expect(proto.v1).toBe(false);
    expect(proto.difficulty).toBe("nightmare");
  });

  it("nota do multiplicador; no protótipo avisa que a dificuldade não altera a partida", () => {
    setLocale("pt-BR");
    expect(difficultyNote("hard", true, bal)).toBe(t("difficulty.points_mult", { mult: bal.difficulty_table.hard.points_mult }));
    expect(difficultyNote("hard", false, bal)).toContain(t("difficulty.prototype_note"));
  });
});
