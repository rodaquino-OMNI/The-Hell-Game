// Localização do cliente (GDD v0.3 §12.5): pt-BR, en e es, mensagens em formato ICU (icu.ts).
// Idioma: `?lang=` > escolha salva no menu > idiomas do navegador > primeiro de `ui.locales` (pt-BR).
// `pnpm i18n:check` falha se uma chave usada no código faltar em algum idioma, se sobrar chave sem uso
// ou se os argumentos de uma mensagem divergirem entre idiomas.
import { format, parse, type Node, type Params } from "./icu.ts";
import en from "./locales/en.json";
import es from "./locales/es.json";
import ptBR from "./locales/pt-BR.json";

/** chave de tradução (o catálogo pt-BR é a referência de tipos; o verificador cobre os outros) */
export type Key = keyof typeof ptBR;
export type { Params };

export const CATALOGS: Record<string, Record<string, string>> = { "pt-BR": ptBR, en, es };
const STORE = "thehell.lang";

let available: string[] = Object.keys(CATALOGS);
let current = available[0];
const cache = new Map<string, Node[]>();

/** idiomas oferecidos: os de `ui.locales` que têm catálogo */
export function configureLocales(locales: readonly string[]) {
  available = locales.filter(l => l in CATALOGS);
  if (!available.includes(current)) current = available[0];
}
export const locales = () => available;
export const locale = () => current;

/** escolhe o idioma pela URL, pela escolha salva ou pelo navegador */
export function detectLocale(search: string, saved: string | null, preferred: readonly string[]): string {
  const want = [new URLSearchParams(search).get("lang"), saved, ...preferred].filter((x): x is string => !!x);
  for (const w of want) {
    const exact = available.find(l => l.toLowerCase() === w.toLowerCase());
    if (exact) return exact;
    const base = available.find(l => l.split("-")[0] === w.toLowerCase().split("-")[0]);
    if (base) return base;
  }
  return available[0];
}

export function setLocale(l: string, persist = false) {
  if (!available.includes(l)) return;
  current = l;
  if (persist) { try { localStorage.setItem(STORE, l); } catch { /* sem armazenamento */ } }
}

/** idioma salvo pelo jogador (null sem escolha ou sem armazenamento) */
export function savedLocale(): string | null {
  try { return localStorage.getItem(STORE); } catch { return null; }
}

/** texto da chave no idioma atual (cai para o primeiro idioma se faltar; o verificador impede isso na CI) */
export function t(key: Key, params: Params = {}, lang: string = current): string {
  const id = lang + "\u0000" + key;
  let ast = cache.get(id);
  if (!ast) {
    const src = CATALOGS[lang]?.[key] ?? CATALOGS[available[0]][key] ?? key;
    ast = parse(src);
    cache.set(id, ast);
  }
  return format(ast, params, lang);
}

/** número no formato do idioma com `digits` casas decimais fixas */
const fixed = new Map<string, Intl.NumberFormat>();
export function num(n: number, digits = 0): string {
  const id = current + digits;
  let f = fixed.get(id);
  if (!f) { f = new Intl.NumberFormat(current, { minimumFractionDigits: digits, maximumFractionDigits: digits }); fixed.set(id, f); }
  return f.format(n);
}
