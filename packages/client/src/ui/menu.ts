// Menu inicial (idioma, escolha de classe, objetivo, botões) e tela de fim de partida.
// Acessibilidade (GDD v0.3 §12.4): tudo é botão nativo (teclado), seleção com aria-pressed, foco visível.
import { CLASSES, type ClassName, type GameEvent } from "@thehell/sim";
import { $, balance, cfg } from "../data.ts";
import { locale, t } from "../i18n/index.ts";
import { classDescription, className, endStats, endText, goalText } from "../text.ts";
import { difficultyText, matchConfig, setupDifficulty } from "./difficulty.ts";
import { applyStaticText, setupLanguagePicker } from "./locale.ts";
import { closeOptions } from "./options.ts";
import { showResults } from "./results.ts";
import { shop, updateCoins } from "./shop.ts";

let selected: ClassName = "Curandeiro";
/** D-45: menu travado na espera pelos personagens (só o #go fica ativo; a partida já foi montada com estas escolhas) */
let locked = false;
/** controles do menu além do #go: classe, dificuldade, idioma, loja e opções */
const lockable = () => [...$("menu").querySelectorAll<HTMLElement>("button, select, input")].filter(el => el.id !== "go");
/** classe escolhida no menu */
export const selectedClass = () => selected;

/** textos do menu que dependem de dados ou do idioma (também depois de trocar o idioma no menu de opções) */
export function refreshMenuText() {
  $("sub").textContent = t("menu.subtitle", { survivors: CLASSES.length });
  const classBox = $("cls");
  [...classBox.children].forEach((b, i) => { b.textContent = className(CLASSES[i]); });
  $("desc").textContent = classDescription(balance, selected);
  $("goal").textContent = goalText(balance, cfg.map.generators.length, cfg.map.bonus.length, matchConfig(cfg).gateTime);
  difficultyText();
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
  setupDifficulty($("go").parentElement!, cfg, refreshMenuText);
  refreshMenuText();
  (classBox.children[0] as HTMLButtonElement).click();
  setupLanguagePicker($("langs"), refreshMenuText);
  $("go").onclick = onStart;
  $("sh").onclick = () => shop();
  $("again").onclick = () => location.reload();
  $("pzx").onmousedown = e => e.stopPropagation();
  // D-45: na espera, clique (mouse, Enter/Espaço ou o .click() da navegação por gamepad) fora do #go não faz nada
  $("menu").addEventListener("click", e => {
    if (locked && !$("go").contains(e.target as Node)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
}

/** fecha loja e opções se estiverem abertas (D-45: a partida não começa por baixo de um diálogo modal) */
export function closeMenuDialogs() {
  if ($("shop").style.display === "flex") { $("shop").style.display = "none"; $("menu").inert = false; }
  if (!$("opts").hidden) closeOptions();
}

export function hideMenu() { $("menu").style.display = "none"; }

/**
 * estado de carregando do botão "Começar" enquanto os personagens chegam (D-45): texto curto no botão, aviso no
 * #gost (role="status", aria-live polite), aria-busy e aria-disabled (desativado sem `disabled`, que tiraria o foco;
 * o clique é ignorado em main.ts enquanto a espera dura). Classe, dificuldade, idioma, loja e opções ficam travados:
 * a partida já foi montada (init) com as escolhas do clique
 */
export function setStartBusy(on: boolean) {
  const go = $("go");
  $("gol").setAttribute("data-i18n", on ? "menu.loading" : "menu.start");
  $("gol").textContent = t(on ? "menu.loading" : "menu.start");
  $("gost").textContent = on ? t("menu.loading_status") : "";
  go.setAttribute("aria-busy", String(on));
  // o resto do menu fica inerte (fora do Tab e do clique) e marcado como desativado; o foco fica no #go
  locked = on;
  for (const el of [go, ...lockable()]) {
    if (on) el.setAttribute("aria-disabled", "true"); else el.removeAttribute("aria-disabled");
    if (el !== go) el.inert = on;
  }
}

export function showEnd(e: Extract<GameEvent, { type: "end" }>) {
  const [title, sub] = endText(e, balance);
  $("et").textContent = title;
  $("es").textContent = sub;
  $("est").textContent = endStats(e);
  showResults(e);
  $("hud").hidden = true;
  $("end").style.display = "flex";
  $("again").focus();
}
