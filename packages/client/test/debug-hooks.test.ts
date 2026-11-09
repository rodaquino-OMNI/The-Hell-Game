// Portão dos ganchos de depuração do cliente (D-33, docs/plano-construcao.md §7): `window.__thehell*` só com `?debug=1`.
// A prova no navegador (página real, sem e com o parâmetro) está em tools/smoke.mjs.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { debugEnabled, exposeDebugHook } from "../src/debug-hooks.ts";

const HOOKS = ["__thehell", "__thehellRender", "__thehellCharactersReady", "__thehellAudio", "__thehellView"] as const;

describe("debugEnabled", () => {
  it("só liga com debug=1", () => {
    expect(debugEnabled("")).toBe(false);
    expect(debugEnabled("?seed=7&preset=low")).toBe(false);
    expect(debugEnabled("?debug=0")).toBe(false);
    expect(debugEnabled("?debug=true")).toBe(false);
    expect(debugEnabled("?debug")).toBe(false);
    expect(debugEnabled("?debug=1")).toBe(true);
    expect(debugEnabled("?seed=7&debug=1&preset=low")).toBe(true);
  });
});

describe("exposeDebugHook", () => {
  it("não publica nada sem depuração", () => {
    const w: Record<string, unknown> = {};
    for (const k of HOOKS) expect(exposeDebugHook(k, () => 1, false, w)).toBe(false);
    for (const k of HOOKS) expect(w[k]).toBeUndefined();
    expect(Object.keys(w)).toEqual([]);
  });

  it("publica com depuração", () => {
    const w: Record<string, unknown> = {};
    const fn = () => 1;
    for (const k of HOOKS) expect(exposeDebugHook(k, fn, true, w)).toBe(true);
    for (const k of HOOKS) expect(w[k]).toBe(fn);
  });
});

describe("urlDebug lido de location.search", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete (globalThis as Record<string, unknown>).__thehellRender;
  });

  const load = async (search: string) => {
    vi.resetModules();
    vi.stubGlobal("location", { search });
    return import("../src/debug-hooks.ts");
  };

  it("sem ?debug=1: window.__thehellRender indefinido", async () => {
    const m = await load("?seed=1");
    expect(m.urlDebug).toBe(false);
    m.exposeDebugHook("__thehellRender", {});
    expect((globalThis as Record<string, unknown>).__thehellRender).toBeUndefined();
  });

  it("com ?debug=1: window.__thehellRender definido", async () => {
    const m = await load("?seed=1&debug=1");
    expect(m.urlDebug).toBe(true);
    const hook = {};
    m.exposeDebugHook("__thehellRender", hook);
    expect((globalThis as Record<string, unknown>).__thehellRender).toBe(hook);
  });
});

describe("nenhum gancho fora do portão", () => {
  it("packages/client/src não atribui window.__thehell* nem globalThis.__thehell* diretamente", () => {
    const src = fileURLToPath(new URL("../src/", import.meta.url));
    const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
    });
    // atribuição direta: `.__thehellX =` (não `==`) ou `["__thehellX"] =`
    const direct = /(\.__thehell\w*|\[\s*["'`]__thehell\w*["'`]\s*\])\s*=(?!=)/;
    const offenders = files(src).filter(f => !f.endsWith("debug-hooks.ts") && direct.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
