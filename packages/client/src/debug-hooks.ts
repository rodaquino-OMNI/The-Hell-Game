// Ganchos globais de depuração do cliente (`window.__thehell*`), só com o parâmetro de URL `?debug=1` (D-33,
// docs/plano-construcao.md §7). Sem o parâmetro nenhum gancho existe em `window`: a produção não expõe o estado da
// partida nem a render. Consumidores: tools/smoke.mjs, tools/visual/compare.mjs, tools/art/*-capturas.mjs,
// tools/a11y/axe.mjs, tools/audio/e2e.mjs (todos abrem a página com `?debug=1`).

/** `?debug=1` presente na query dada */
export function debugEnabled(search: string): boolean {
  return new URLSearchParams(search).get("debug") === "1";
}

/** depuração ligada na página atual (falso fora do navegador) */
export const urlDebug: boolean = debugEnabled(typeof location === "undefined" ? "" : location.search);

/**
 * publica `value` como `target[name]` só com a depuração ligada; devolve se publicou.
 * `enabled` e `target` existem para o teste unitário (packages/client/test/debug-hooks.test.ts).
 */
export function exposeDebugHook(name: `__thehell${string}`, value: unknown, enabled: boolean = urlDebug, target: object = globalThis): boolean {
  if (!enabled) return false;
  (target as Record<string, unknown>)[name] = value;
  return true;
}
