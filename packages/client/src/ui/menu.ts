// Menu inicial (idioma, escolha de classe, objetivo, botões) e tela de fim de partida.
// Acessibilidade (GDD v0.3 §12.4): tudo é botão nativo (teclado), seleção com aria-pressed, foco visível.
import { CLASSES, type ClassName, type GameEvent } from "@thehell/sim";
import { $, balance, map } from "../data.ts";
import { locale, t } from "../i18n/index.ts";
import { classDescription, className, endStats, endText, goalText } from "../text.ts";
import { applyStaticText, setupLanguagePicker } from "./locale.ts";
import { shop, updateCoins } from "./shop.ts";

let selected: ClassName = "Curandeiro";
/** classe escolhida no menu */
export const selectedClass = () => selected;

/** textos do menu que dependem de dados ou do idioma (também depois de trocar o idioma no menu de opções) */
export function refreshMenuText() {
  $("sub").textContent = t("menu.subtitle", { survivors: CLASSES.length });
  const classBox = $("cls");
  [...classBox.children].forEach((b, i) => { b.textContent = className(CLASSES[i]); });
  $("desc").textContent = classDescription(balance, selected);
  $("goal").textContent = goalText(balance, map.generators.length, map.bonus.length);
  updateCoins();
  // seletor de idioma do menu inicial com o idioma atual marcado
  for (const x of $("langs").querySelectorAll("button")) x.setAttribute("aria-pressed", String(x.lang === locale()));
}

export function setupMenu(onStart: () => void) {
  applyStaticText();
  const classBox = $("cls");
  for (const cls of CLASSES) {
    const b = document.createElement("button");
    b.type = "button";
    b.onclick = () => {
      selected = cls;
      [...classBox.children].forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
      $("desc").textContent = classDescription(balance, cls);
    };
    classBox.appendChild(b);
  }
  refreshMenuText();
  (classBox.children[0] as HTMLButtonElement).click();
  setupLanguagePicker($("langs"), refreshMenuText);
  $("go").onclick = onStart;
  $("sh").onclick = () => shop();
  $("again").onclick = () => location.reload();
  $("pzx").onmousedown = e => e.stopPropagation();
}

export function hideMenu() { $("menu").style.display = "none"; }

export function showEnd(e: Extract<GameEvent, { type: "end" }>) {
  const [title, sub] = endText(e, balance);
  $("et").textContent = title;
  $("es").textContent = sub;
  $("est").textContent = endStats(e);
  $("hud").hidden = true;
  $("end").style.display = "flex";
  $("again").focus();
}
