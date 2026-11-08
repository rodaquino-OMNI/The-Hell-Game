// i18n (GDD v0.3 §12.5): formato ICU, catálogos e o verificador de `pnpm i18n:check`.
import { describe, expect, it } from "vitest";
import { loadBalanceFile } from "@thehell/shared/node";
import { checkCatalogs, hardcodedHtmlText, keysInSource } from "../src/i18n/check.ts";
import { format, IcuSyntaxError, parse, signature } from "../src/i18n/icu.ts";
import { CATALOGS, configureLocales, detectLocale, setLocale, t } from "../src/i18n/index.ts";
import { endTextV1, skinName } from "../src/text.ts";

const balance = loadBalanceFile(new URL("../../../data/balance.yaml", import.meta.url).pathname);
const fmt = (m: string, p: Record<string, string | number>, l = "pt-BR") => format(parse(m), p, l);

describe("ICU", () => {
  it("argumentos, números no formato do idioma, plural com # e =N, select", () => {
    expect(fmt("Olá {nome}", { nome: "Ana" })).toBe("Olá Ana");
    expect(fmt("{n} s", { n: 1.5 })).toBe("1,5 s");
    expect(fmt("{n} s", { n: 1.5 }, "en")).toBe("1.5 s");
    const pl = "{n, plural, =0 {nada} one {# moeda} other {# moedas}}";
    expect([0, 1, 2, 1000].map(n => fmt(pl, { n }))).toEqual(["nada", "1 moeda", "2 moedas", "1.000 moedas"]);
    const sel = "{x, select, a {A {n, plural, one {# um} other {# vários}}} other {outro}}";
    expect(fmt(sel, { x: "a", n: 3 })).toBe("A 3 vários");
    expect(fmt(sel, { x: "z", n: 3 })).toBe("outro");
  });

  it("apóstrofo: '' vira ' e '{' é literal", () => {
    expect(fmt("it''s '{x}' {y}", { y: 1 }, "en")).toBe("it's {x} 1");
    expect(fmt("don't", {}, "en")).toBe("don't");
  });

  it("erros de sintaxe", () => {
    for (const bad of ["{", "a}", "{n, plural, one {x}}", "{n, select, a {x}}", "{n, foo}", "{1x}", "{n, plural, um {x} other {y}}", "{n, select, a {x} a {y} other {z}}"]) {
      expect(() => parse(bad), bad).toThrow(IcuSyntaxError);
    }
  });

  it("assinatura: argumentos e opções de select", () => {
    const s = signature(parse("{a} {b, number} {c, plural, other {# {d}}} {e, select, x {} other {}}"));
    expect(Object.fromEntries(s.args)).toEqual({ a: "any", b: "number", c: "number", d: "any", e: "select" });
    expect([...s.selects.get("e")!]).toEqual(["x", "other"]);
  });
});

describe("catálogos", () => {
  it("ui.locales = pt-BR, en, es, todos com catálogo e mensagens válidas", () => {
    expect(balance.ui.locales).toEqual(["pt-BR", "en", "es"]);
    expect(checkCatalogs(CATALOGS, balance.ui.locales, [])).toEqual(
      Object.keys(CATALOGS["pt-BR"]).map(k => `chave órfã (não usada no código): "${k}"`),
    );
  });

  it("toda skin de balance.skins tem nome traduzido", () => {
    setLocale("pt-BR");
    for (const id of Object.keys(balance.skins)) expect(skinName(id)).not.toBe(id);
  });

  it("idioma: ?lang > escolha salva > navegador (base da língua) > pt-BR", () => {
    configureLocales(balance.ui.locales);
    expect(detectLocale("?lang=es", "en", ["pt-BR"])).toBe("es");
    expect(detectLocale("", "en", ["es"])).toBe("en");
    expect(detectLocale("", null, ["en-US", "es"])).toBe("en");
    expect(detectLocale("", null, ["es-MX"])).toBe("es");
    expect(detectLocale("", null, ["pt-PT"])).toBe("pt-BR");
    expect(detectLocale("?lang=xx", null, ["de"])).toBe("pt-BR");
  });

  it("fim do v1: no limite de tempo, quem não escapou não 'morreu' (GDD-v0.3 §3.3)", () => {
    setLocale("pt-BR");
    const [title, sub] = endTextV1("hunter", "time_limit", "not_escaped", balance);
    expect(title).toBe("VOCÊ NÃO ESCAPOU");
    expect(sub).toContain(`${balance.match.hard_time_limit} s`);
    expect(endTextV1("survivors", "all_terminal", "dead", balance)[0]).toBe("VOCÊ MORREU");
    expect(endTextV1("survivors", "hunter_down", "escaped", balance)[1]).toContain("A equipe venceu");
    setLocale("en");
    expect(endTextV1("hunter", "time_limit", "not_escaped", balance)[0]).toBe("YOU DID NOT ESCAPE");
    expect(t("end.stats", { time: 12, coins: 1 })).toBe("Time: 12 s · +1 coin");
    setLocale("pt-BR");
  });
});

describe("verificador (pnpm i18n:check)", () => {
  const cats = () => ({
    "pt-BR": { "a.x": "Oi {nome}", "a.y": "{n, plural, one {# um} other {# vários}}", "a.z": "{s, select, p {P} other {O}}" },
    en: { "a.x": "Hi {nome}", "a.y": "{n, plural, one {# one} other {# many}}", "a.z": "{s, select, p {P} other {O}}" },
  });
  const src = [{ file: "x.ts", text: `t("a.x"); t('a.y'); const k = "a.z";` }];
  const L = ["pt-BR", "en"];

  it("tudo certo: sem erros", () => {
    expect(checkCatalogs(cats(), L, src)).toEqual([]);
  });

  it("chave usada faltando num idioma", () => {
    const c = cats(); delete (c.en as Record<string, string>)["a.y"];
    expect(checkCatalogs(c, L, src)).toContain('en: falta a chave "a.y"');
  });

  it("chave usada no código e ausente de todos os catálogos", () => {
    expect(checkCatalogs(cats(), L, [...src, { file: "y.ts", text: `t("a.nova")` }])).toContain('chave usada no código e ausente dos catálogos: "a.nova"');
  });
  it("nome de token da paleta no mesmo namespace não conta como chave; chave de verdade ausente continua falhando", () => {
    const extra = { file: "z.ts", text: `const cor = "a.token"; t("a.nova")` };
    const errs = checkCatalogs(cats(), L, [...src, extra], new Set(["a.token"]));
    expect(errs).not.toContain('chave usada no código e ausente dos catálogos: "a.token"');
    expect(errs).toContain('chave usada no código e ausente dos catálogos: "a.nova"');
  });

  it("chave órfã e chave sobrando num idioma", () => {
    const c = cats(); (c.en as Record<string, string>)["a.extra"] = "x";
    const e = checkCatalogs(c, L, [{ file: "x.ts", text: `t("a.x"); t("a.y")` }]);
    expect(e).toContain('chave órfã (não usada no código): "a.z"');
    expect(e).toContain('en: chave "a.extra" não existe em pt-BR');
  });

  it("placeholder diferente, tipo diferente, opção de select diferente e ICU inválido", () => {
    const c = cats();
    c.en["a.x"] = "Hi {name}";
    c.en["a.y"] = "{n, select, a {x} other {y}}";
    c.en["a.z"] = "{s, select, q {Q} other {O}}";
    const e = checkCatalogs(c, L, src);
    expect(e.some(x => x.startsWith('en: "a.x" tem argumentos'))).toBe(true);
    expect(e.some(x => x.startsWith('en: "a.y" tem argumentos'))).toBe(true);
    expect(e.some(x => x.startsWith('en: "a.z" select "s"'))).toBe(true);
    c.en["a.x"] = "{nome";
    expect(checkCatalogs(c, L, src).some(x => x.startsWith('en: "a.x" não é ICU válido'))).toBe(true);
  });

  it("idioma de ui.locales sem catálogo e catálogo fora da lista", () => {
    expect(checkCatalogs(cats(), ["pt-BR", "en", "es"], src)).toContain("idioma es de ui.locales sem catálogo");
    expect(checkCatalogs(cats(), ["pt-BR"], src)).toContain("catálogo en fora de ui.locales");
  });

  it("chave dinâmica e texto fixo no HTML", () => {
    expect(keysInSource({ file: "z.ts", text: "t(`a.${x}`)" }, new Set(["a"])).dynamic).toHaveLength(1);
    expect(keysInSource({ file: "z.ts", text: "`b.${x}`" }, new Set(["a"])).dynamic).toHaveLength(0);
    expect(keysInSource({ file: "i.html", text: '<b data-i18n="a.x"></b><i data-i18n-aria-label="a.y"></i>' }, new Set(["a"])).used).toEqual(new Set(["a.x", "a.y"]));
    expect(hardcodedHtmlText('<title>X</title><style>a{}</style><!-- nota --><b data-i18n="a.x"></b><span>▶ </span><p>Olá</p>')).toEqual(["Olá"]);
  });
});
