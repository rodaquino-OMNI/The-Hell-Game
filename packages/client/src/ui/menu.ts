// Menu inicial (escolha de classe, objetivo, botões) e tela de fim de partida.
import { CLASSES, type ClassName, type GameEvent } from "@thehell/sim";
import { $, balance, map } from "../data.ts";
import { classDescription, END_TEXT, goalText } from "../text.ts";
import { shop, updateCoins } from "./shop.ts";

let selected: ClassName = "Curandeiro";
/** classe escolhida no menu */
export const selectedClass = () => selected;

export function setupMenu(onStart: () => void) {
  const classBox = $("cls");
  for (const cls of CLASSES) {
    const b = document.createElement("button");
    b.textContent = cls;
    b.onclick = () => { selected = cls; [...classBox.children].forEach(x => x.classList.toggle("on", x === b)); $("desc").textContent = classDescription(balance, cls); };
    classBox.appendChild(b);
  }
  (classBox.children[0] as HTMLButtonElement).click();
  $("goal").textContent = goalText(balance, map.generators.length);
  $("go").onclick = onStart;
  $("sh").onclick = shop;
  $("again").onclick = () => location.reload();
  $("pzx").onmousedown = e => e.stopPropagation();
  updateCoins();
}

export function hideMenu() { $("menu").style.display = "none"; }

export function showEnd(e: Extract<GameEvent, { type: "end" }>) {
  const [title, sub] = END_TEXT[e.outcome];
  $("et").textContent = title;
  $("es").textContent = `${sub} · Tempo: ${e.time} s · +${e.coins} moedas`;
  $("end").style.display = "flex";
}
