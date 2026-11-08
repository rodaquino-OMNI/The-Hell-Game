// Formato de mensagem ICU (GDD v0.3 §12.5), subconjunto usado pelo jogo, sobre o `Intl` nativo (sem dependência):
//   {nome}                       valor (número formatado pelo idioma, texto como está)
//   {nome, number}               número formatado pelo idioma
//   {nome, plural, =0 {…} one {…} other {…}}   com `#` = o número; `offset:` não é suportado
//   {nome, select, a {…} b {…} other {…}}
// Apóstrofo segue o ICU (modo DOUBLE_OPTIONAL): `''` vira `'`; `'` antes de { } # | abre um trecho literal.
// O verificador `pnpm i18n:check` usa `parse` e `signature` para comparar os três idiomas.

export type Node =
  | { t: "text"; v: string }
  | { t: "arg"; name: string; num: boolean }
  | { t: "pound" }
  | { t: "plural"; name: string; options: Record<string, Node[]> }
  | { t: "select"; name: string; options: Record<string, Node[]> };

export class IcuSyntaxError extends Error {}

const ID = /^[A-Za-z_][\w]*$/;

/** analisa uma mensagem ICU; lança IcuSyntaxError com a posição do erro */
export function parse(src: string): Node[] {
  let i = 0;
  const fail = (m: string): never => { throw new IcuSyntaxError(`${m} (posição ${i}) em "${src}"`); };
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const word = () => { const s = i; while (i < src.length && !/[\s{},#]/.test(src[i])) i++; return src.slice(s, i); };

  function message(inPlural: boolean, nested: boolean): Node[] {
    const out: Node[] = [];
    let text = "";
    const flush = () => { if (text) { out.push({ t: "text", v: text }); text = ""; } };
    while (i < src.length) {
      const c = src[i];
      if (c === "'") {
        const n = src[i + 1];
        if (n === "'") { text += "'"; i += 2; continue; }
        if (n === "{" || n === "}" || n === "|" || (n === "#" && inPlural)) {
          i++;
          while (i < src.length) {
            if (src[i] === "'") { if (src[i + 1] === "'") { text += "'"; i += 2; continue; } i++; break; }
            text += src[i++];
          }
          continue;
        }
        text += c; i++; continue;
      }
      if (c === "}") { if (nested) break; fail("} sem {"); }
      if (c === "#" && inPlural) { flush(); out.push({ t: "pound" }); i++; continue; }
      if (c === "{") { flush(); out.push(argument(inPlural)); continue; }
      text += c; i++;
    }
    flush();
    return out;
  }

  function options(kind: "plural" | "select", inPlural: boolean): Record<string, Node[]> {
    const opts: Record<string, Node[]> = {};
    ws();
    while (i < src.length && src[i] !== "}") {
      const key = word();
      if (!key) fail("seletor vazio");
      if (kind === "plural" && !/^(=\d+|zero|one|two|few|many|other)$/.test(key)) fail(`seletor de plural inválido "${key}"`);
      if (kind === "select" && !ID.test(key)) fail(`seletor de select inválido "${key}"`);
      if (key in opts) fail(`seletor repetido "${key}"`);
      ws();
      if (src[i] !== "{") fail(`esperava { após "${key}"`);
      i++;
      opts[key] = message(kind === "plural" || inPlural, true);
      if (src[i] !== "}") fail("opção sem }");
      i++;
      ws();
    }
    if (!("other" in opts)) fail(`${kind} sem a opção other`);
    return opts;
  }

  function argument(inPlural: boolean): Node {
    i++; // {
    ws();
    const name = word();
    if (!ID.test(name)) fail(`nome de argumento inválido "${name}"`);
    ws();
    if (src[i] === "}") { i++; return { t: "arg", name, num: false }; }
    if (src[i] !== ",") fail("esperava , ou }");
    i++; ws();
    const type = word();
    ws();
    if (type === "number") {
      if (src[i] !== "}") fail("estilo de number não suportado");
      i++;
      return { t: "arg", name, num: true };
    }
    if (type !== "plural" && type !== "select") fail(`tipo não suportado "${type}"`);
    if (src[i] !== ",") fail("esperava , após o tipo");
    i++;
    const opts = options(type as "plural" | "select", inPlural);
    if (src[i] !== "}") fail("argumento sem }");
    i++;
    return { t: type as "plural" | "select", name, options: opts };
  }

  return message(false, false);
}

export type Params = Record<string, string | number>;
export type ArgKind = "any" | "number" | "select";

/** formata a árvore com os parâmetros no idioma `locale` (argumento ausente vira `{nome}`, visível nos testes) */
const numberFormats = new Map<string, Intl.NumberFormat>(), pluralRules = new Map<string, Intl.PluralRules>();
const nfFor = (l: string) => numberFormats.get(l) ?? numberFormats.set(l, new Intl.NumberFormat(l)).get(l)!;
const prFor = (l: string) => pluralRules.get(l) ?? pluralRules.set(l, new Intl.PluralRules(l)).get(l)!;

export function format(ast: Node[], params: Params, locale: string, pound?: number): string {
  const nf = nfFor(locale);
  let out = "";
  for (const n of ast) {
    if (n.t === "text") out += n.v;
    else if (n.t === "pound") out += pound === undefined ? "#" : nf.format(pound);
    else if (n.t === "arg") {
      const v = params[n.name];
      out += v === undefined ? `{${n.name}}` : typeof v === "number" ? nf.format(v) : v;
    } else if (n.t === "plural") {
      const v = Number(params[n.name]);
      const exact = n.options[`=${v}`];
      const opt = exact ?? n.options[prFor(locale).select(v)] ?? n.options.other;
      out += format(opt, params, locale, v);
    } else {
      const v = String(params[n.name]);
      out += format(Object.hasOwn(n.options, v) ? n.options[v] : n.options.other, params, locale, pound);
    }
  }
  return out;
}

/** argumentos da mensagem e o tipo de cada um, e as opções de cada select (para comparar idiomas) */
export function signature(ast: Node[], acc = { args: new Map<string, ArgKind>(), selects: new Map<string, Set<string>>() }) {
  const put = (name: string, kind: ArgKind) => {
    const prev = acc.args.get(name);
    if (!prev || prev === "any") acc.args.set(name, kind);
    else if (kind !== "any" && prev !== kind) acc.args.set(name, kind === "select" || prev === "select" ? "select" : kind);
  };
  for (const n of ast) {
    if (n.t === "arg") put(n.name, n.num ? "number" : "any");
    else if (n.t === "plural" || n.t === "select") {
      put(n.name, n.t === "plural" ? "number" : "select");
      if (n.t === "select") {
        const s = acc.selects.get(n.name) ?? new Set<string>();
        for (const k of Object.keys(n.options)) s.add(k);
        acc.selects.set(n.name, s);
      }
      for (const o of Object.values(n.options)) signature(o, acc);
    }
  }
  return acc;
}
