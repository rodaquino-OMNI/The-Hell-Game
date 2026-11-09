// Telas do R6 (GDD v0.2 §7.1–7.3): resumo de fim de partida a partir do evento `end` e persistência da dificuldade.
import { describe, expect, it } from "vitest";
import { loadBalanceFile } from "@thehell/shared/node";
import { makeConfig, SCORE_CATEGORIES, type GameEvent } from "@thehell/sim";
import { map } from "../src/data.ts";
import { setLocale, t } from "../src/i18n/index.ts";
import { DIFFICULTY_STORE, difficulties, difficultyNote, loadDifficulty, matchConfig, saveDifficulty, type KeyStore } from "../src/ui/difficulty.ts";
import { countFraction, countValue, reduceMotion, resultsSummary, startCountUp } from "../src/ui/results.ts";
import { SCORE_ICON } from "../src/hud/icons.ts";
import { goalText } from "../src/text.ts";

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
    expect(yes).toContain(`(inclui ${bal.economy.win_coins} moedas pela vitória)`);
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

  it("nota: multiplicador efetivo no v1; no protótipo só o aviso (pointsMult é sempre 1)", () => {
    setLocale("pt-BR");
    const v1 = makeConfig(bal, map, { ruleset: "v1" });
    expect(difficultyNote("hard", v1)).toBe(t("difficulty.points_mult", { mult: bal.difficulty_table.hard.points_mult }));
    const proto = makeConfig(bal, map, { ruleset: "prototype" });
    expect(difficultyNote("hard", proto)).toBe(t("difficulty.prototype_note"));
    expect(matchConfig(proto, "hard").pointsMult).toBe(1);
  });

  it("objetivo do menu usa o portão da dificuldade da partida", () => {
    setLocale("pt-BR");
    const v1 = makeConfig(bal, map, { ruleset: "v1" });
    for (const d of difficulties(bal)) {
      const gate = matchConfig(v1, d).gateTime;
      expect(gate).toBe(bal.difficulty_table[d].gate);
      expect(goalText(bal, 4, 3, gate)).toContain(`(${gate} s)`);
    }
    expect(goalText(bal, 4, 3)).toContain(`(${bal.generator.gate_time} s)`);
  });
});

describe("contagem dos pontos na tela de fim (issue #66, resposta 3b)", () => {
  setLocale("pt-BR");
  const D = bal.ui.results.count_up_s;
  /** relógio e requestAnimationFrame falsos: cada quadro avança `dt` ms */
  const fakeClock = () => {
    let ms = 0, queued: (() => void) | null = null;
    return {
      now: () => ms,
      raf: (cb: () => void) => { queued = cb; },
      frame(dt: number) { ms += dt; const cb = queued; queued = null; cb?.(); },
      get pending() { return queued !== null; },
    };
  };
  const cell = (final: number) => ({ el: { textContent: "" } as unknown as Element, final });

  it("duração vem de ui.results.count_up_s (positiva)", () => {
    expect(D).toBeGreaterThan(0);
  });

  it("fração e valor: de 0 ao final exato, limitados", () => {
    expect(countFraction(0, D)).toBe(0);
    expect(countFraction(D / 2, D)).toBeCloseTo(0.5);
    expect(countFraction(D * 3, D)).toBe(1);
    expect(countFraction(1, 0)).toBe(1);
    expect(countValue(250, 0)).toBe(0);
    expect(countValue(250, 0.5)).toBe(125);
    expect(countValue(250, 1)).toBe(250);
    expect(countValue(7, 0.999)).toBeLessThanOrEqual(7);
  });

  it("conta até o final em count_up_s e avisa uma vez", () => {
    setLocale("pt-BR");
    const c = fakeClock(), cells = [cell(90), cell(250)];
    let done = 0;
    const cu = startCountUp(cells, D, false, () => done++, c.raf, c.now);
    expect(cu.counting).toBe(true);
    expect(cells.map(x => x.el.textContent)).toEqual(["0", "0"]);
    c.frame((D * 1000) / 2);
    expect(cu.counting).toBe(true);
    expect(cells[1].el.textContent).toBe("125");
    c.frame(D * 1000);
    expect(cu.counting).toBe(false);
    expect(cells.map(x => x.el.textContent)).toEqual(["90", "250"]);
    expect(c.pending).toBe(false);
    cu.finish();
    expect(done).toBe(1);
  });

  it("pular (Enter/A) mostra os finais na hora; congelar segura a fração", () => {
    setLocale("pt-BR");
    const c = fakeClock(), cells = [cell(1000)];
    const cu = startCountUp(cells, D, false, undefined, c.raf, c.now);
    cu.hold(0.4);
    c.frame(D * 5000);
    expect(cu.counting).toBe(true);
    expect(cu.fraction).toBeCloseTo(0.4);
    expect(cells[0].el.textContent).toBe("400");
    cu.finish();
    expect(cu.counting).toBe(false);
    expect(cells[0].el.textContent).toBe(new Intl.NumberFormat("pt-BR").format(1000));
  });

  it("reduzir movimento: valores finais sem nenhum quadro de contagem", () => {
    const c = fakeClock(), cells = [cell(60)];
    const cu = startCountUp(cells, D, true, undefined, c.raf, c.now);
    expect(cu.counting).toBe(false);
    expect(cells[0].el.textContent).toBe("60");
    expect(c.pending).toBe(false);
  });

  it("contagem desligada com reduzir balanço de câmera ou prefers-reduced-motion", () => {
    expect(reduceMotion(false, false)).toBe(false);
    expect(reduceMotion(true, false)).toBe(true);
    expect(reduceMotion(false, true)).toBe(true);
  });

  it("um ícone por categoria, escondido do leitor de tela", () => {
    expect(Object.keys(SCORE_ICON).sort()).toEqual([...SCORE_CATEGORIES].sort());
    for (const svg of Object.values(SCORE_ICON)) expect(svg).toContain('aria-hidden="true"');
  });
});
