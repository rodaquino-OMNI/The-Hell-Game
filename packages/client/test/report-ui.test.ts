// Relatório de playtest na tela de fim (ui/report.ts): nome do arquivo, portão de depuração (D-33) da coleta e dos
// botões, e área de transferência com falha. A prova no navegador (botões, aria-live, teclas) está em
// tools/ui/r6-e2e.mjs e tools/a11y/axe.mjs.
import { describe, expect, it } from "vitest";
import { debugEnabled } from "../src/debug-hooks.ts";
import { copyText, reportEnabled, reportFileName, reportOptions, showReport } from "../src/ui/report.ts";

describe("reportFileName", () => {
  it("the-hell-<seed>-<difficulty>-<YYYYMMDD-HHMM>.json com a hora local", () => {
    expect(reportFileName(1234, "hard", new Date(2026, 10, 9, 14, 5, 59))).toBe("the-hell-1234-hard-20261109-1405.json");
    expect(reportFileName(7, "normal", new Date(2027, 0, 2, 3, 4))).toBe("the-hell-7-normal-20270102-0304.json");
    expect(reportFileName(0, "nightmare", new Date(2026, 11, 31, 23, 59))).toBe("the-hell-0-nightmare-20261231-2359.json");
  });
});

describe("visibilidade e coleta só com ?debug=1", () => {
  it("sem debug: sem coleta e sem botões (showReport não toca no DOM)", () => {
    for (const q of ["", "?seed=7", "?debug=0", "?debug=true"]) {
      const d = debugEnabled(q);
      expect(reportEnabled(d)).toBe(false);
      expect(reportOptions(d)).toBeUndefined();
    }
    // no Node não há `document`: se showReport tentasse montar algo além de remover, lançaria
    const doc = globalThis as { document?: unknown };
    const had = "document" in doc;
    const calls: string[] = [];
    doc.document = { getElementById: (id: string) => { calls.push(id); return null; } };
    try {
      const after = { after: () => { throw new Error("montou os botões sem debug"); } } as unknown as Element;
      showReport({ json: "{}", seed: 1, difficulty: "normal" }, after, false);
      expect(calls).toEqual(["rpt"]);
    } finally { if (!had) delete doc.document; }
  });

  it("com debug: coleta ligada e botões montados depois de Jogar de novo", () => {
    const d = debugEnabled("?seed=7&debug=1");
    expect(reportEnabled(d)).toBe(true);
    expect(reportOptions(d)).toEqual({ report: true });
    const made: { tag: string; id?: string; text?: string; attrs: Record<string, string>; kids: unknown[] }[] = [];
    const doc = globalThis as { document?: unknown };
    const had = "document" in doc;
    doc.document = {
      getElementById: () => null,
      createElement: (tag: string) => {
        const e = { tag, attrs: {} as Record<string, string>, kids: [] as unknown[], setAttribute(k: string, v: string) { this.attrs[k] = v; }, append(...k: unknown[]) { this.kids.push(...k); } };
        made.push(e as never);
        return e;
      },
    };
    let placed: unknown = null;
    try {
      showReport({ json: "{}", seed: 1, difficulty: "normal" }, { after: (b: unknown) => { placed = b; } } as unknown as Element, true);
    } finally { if (!had) delete doc.document; }
    const box = made.find(e => e.id === "rpt");
    expect(placed).toBe(box);
    expect(box!.kids.map(k => (k as { id: string }).id)).toEqual(["rptc", "rptd", "rpts"]);
    const status = made.find(e => e.id === "rpts")!;
    expect(status.attrs).toEqual({ role: "status", "aria-live": "polite" });
  });
});

describe("copyText", () => {
  it("falso sem a API ou com a permissão negada; verdadeiro quando escreve", async () => {
    expect(await copyText("x", undefined)).toBe(false);
    expect(await copyText("x", { writeText: () => Promise.reject(new DOMException("negado", "NotAllowedError")) })).toBe(false);
    let got = "";
    expect(await copyText("abc", { writeText: async (s: string) => { got = s; } })).toBe(true);
    expect(got).toBe("abc");
  });
});
