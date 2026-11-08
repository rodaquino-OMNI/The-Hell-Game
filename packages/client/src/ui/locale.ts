// Idioma da interface (GDD v0.3 §12.5): escolha inicial, textos fixos do index.html (atributos data-i18n) e
// seletor de idioma do menu. Idiomas oferecidos: `ui.locales` de data/balance.yaml.
import { balance } from "../data.ts";
import { configureLocales, detectLocale, locale, locales, savedLocale, setLocale, t, CATALOGS, type Key } from "../i18n/index.ts";

/** escolhe o idioma (URL, escolha salva, navegador) antes do primeiro texto */
export function initLocale() {
  configureLocales(balance.ui.locales);
  setLocale(detectLocale(location.search, savedLocale(), navigator.languages ?? [navigator.language]));
}

/**
 * Aplica as traduções dos elementos com `data-i18n` (texto) e `data-i18n-<atributo>` (atributo, ex.
 * `data-i18n-aria-label`) e o `lang` do documento.
 */
export function applyStaticText(root: ParentNode = document) {
  document.documentElement.lang = locale();
  document.title = t("app.title");
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    for (const a of el.getAttributeNames()) {
      if (a === "data-i18n") el.textContent = t(el.getAttribute(a) as Key);
      else if (a.startsWith("data-i18n-")) el.setAttribute(a.slice("data-i18n-".length), t(el.getAttribute(a) as Key));
    }
  }
}

/** botões de idioma (nome de cada idioma no próprio idioma); `onChange` refaz os textos dinâmicos */
export function setupLanguagePicker(box: HTMLElement, onChange: () => void) {
  box.replaceChildren();
  for (const l of locales()) {
    const b = document.createElement("button");
    b.type = "button";
    b.lang = l;
    b.textContent = CATALOGS[l]["lang.name"];
    b.setAttribute("aria-pressed", String(l === locale()));
    b.onclick = () => {
      setLocale(l, true);
      for (const x of box.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
      applyStaticText();
      onChange();
    };
    box.appendChild(b);
  }
}
