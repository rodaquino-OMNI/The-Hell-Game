// Verificação dos catálogos de tradução (GDD v0.3 §12.5, aceite: "a CI falha se alguma chave usada no código faltar
// em um dos três idiomas"). Função pura; a leitura de arquivos fica em tools/i18n/check.ts (`pnpm i18n:check`).
// Regras:
//  1. os idiomas de `ui.locales` têm catálogo, e não há catálogo fora da lista;
//  2. todos os catálogos têm as mesmas chaves do primeiro idioma (sem falta e sem sobra);
//  3. toda mensagem é ICU válida, e os argumentos (nome e tipo) e as opções de cada select batem com o 1º idioma;
//  4. toda chave citada no código existe; toda chave do catálogo é citada no código (sem órfã);
//  5. chave montada em tempo de execução (template com `${}` começando por um prefixo de chave) é proibida,
//     porque o verificador não consegue conferir;
//  6. o HTML não tem texto de interface fixo fora de data-i18n (só símbolos, como setas, são aceitos).
import { parse, signature, type ArgKind } from "./icu.ts";

export interface Source { file: string; text: string }
type Catalog = Record<string, string>;

const KEY_LITERAL = /(["'`])([a-z][a-z0-9_]*(?:\.[a-zA-Z0-9_]+)+)\1/g;
const HTML_KEY = /data-i18n(?:-[a-z-]+)?="([^"]+)"/g;

/** chaves citadas e chaves dinâmicas proibidas num arquivo-fonte */
export function keysInSource(src: Source, namespaces: Set<string>): { used: Set<string>; dynamic: string[] } {
  const used = new Set<string>(), dynamic: string[] = [];
  const re = src.file.endsWith(".html") ? HTML_KEY : KEY_LITERAL;
  for (const m of src.text.matchAll(re)) {
    const key = src.file.endsWith(".html") ? m[1] : m[2];
    if (namespaces.has(key.split(".")[0]) && key.includes(".")) used.add(key);
  }
  for (const m of src.text.matchAll(/`([a-z][a-z0-9_]*)\.[^`]*?\$\{/g)) {
    if (namespaces.has(m[1])) dynamic.push(`${src.file}: chave dinâmica "${m[0]}"`);
  }
  return { used, dynamic };
}

/** texto visível fixo num HTML (fora de script, style, comentários e title) */
export function hardcodedHtmlText(html: string): string[] {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|title)\b[\s\S]*?<\/\1>/gi, "");
  const out: string[] = [];
  for (const m of body.matchAll(/>([^<]+)</g)) {
    const txt = m[1].trim();
    if (/\p{L}/u.test(txt)) out.push(txt);
  }
  return out;
}

function sameSet(a: Iterable<string>, b: Iterable<string>) {
  const x = [...a].sort(), y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

export function checkCatalogs(catalogs: Record<string, Catalog>, expectedLocales: readonly string[], sources: readonly Source[]): string[] {
  const errors: string[] = [];
  for (const l of expectedLocales) if (!catalogs[l]) errors.push(`idioma ${l} de ui.locales sem catálogo`);
  for (const l of Object.keys(catalogs)) if (!expectedLocales.includes(l)) errors.push(`catálogo ${l} fora de ui.locales`);
  const baseLocale = expectedLocales[0], base = catalogs[baseLocale];
  if (!base) return errors;
  const baseKeys = Object.keys(base);

  // 2 e 3: mesmas chaves, ICU válido e argumentos iguais
  const sigs = new Map<string, Map<string, ReturnType<typeof signature>>>();
  for (const [l, cat] of Object.entries(catalogs)) {
    for (const k of baseKeys) if (!(k in cat)) errors.push(`${l}: falta a chave "${k}"`);
    for (const k of Object.keys(cat)) if (!(k in base)) errors.push(`${l}: chave "${k}" não existe em ${baseLocale}`);
    const m = new Map<string, ReturnType<typeof signature>>();
    for (const [k, msg] of Object.entries(cat)) {
      try { m.set(k, signature(parse(msg))); } catch (e) { errors.push(`${l}: "${k}" não é ICU válido: ${(e as Error).message}`); }
    }
    sigs.set(l, m);
  }
  const fmt = (args: Map<string, ArgKind>) => [...args].map(([n, k]) => `${n}:${k}`).sort().join(", ") || "(nenhum)";
  const compatible = (a: ArgKind, b: ArgKind) => a === b || (a !== "select" && b !== "select" && (a === "any" || b === "any"));
  for (const [l, m] of sigs) {
    if (l === baseLocale) continue;
    for (const [k, s] of m) {
      const ref = sigs.get(baseLocale)!.get(k);
      if (!ref) continue;
      const okArgs = sameSet(ref.args.keys(), s.args.keys()) && [...ref.args].every(([n, kind]) => compatible(kind, s.args.get(n)!));
      if (!okArgs) errors.push(`${l}: "${k}" tem argumentos ${fmt(s.args)}, ${baseLocale} tem ${fmt(ref.args)}`);
      for (const [n, opts] of ref.selects) {
        const other = s.selects.get(n);
        if (other && !sameSet(opts, other)) errors.push(`${l}: "${k}" select "${n}" com opções [${[...other].sort()}], ${baseLocale} tem [${[...opts].sort()}]`);
      }
    }
  }

  // 4 e 5: chaves do código
  const namespaces = new Set(baseKeys.map(k => k.split(".")[0]));
  const used = new Set<string>();
  for (const src of sources) {
    const r = keysInSource(src, namespaces);
    for (const k of r.used) used.add(k);
    errors.push(...r.dynamic);
    if (src.file.endsWith(".html")) for (const txt of hardcodedHtmlText(src.text)) errors.push(`${src.file}: texto fixo fora de data-i18n: "${txt}"`);
  }
  for (const k of used) if (!(k in base)) errors.push(`chave usada no código e ausente dos catálogos: "${k}"`);
  for (const k of baseKeys) if (!used.has(k)) errors.push(`chave órfã (não usada no código): "${k}"`);
  return errors;
}
