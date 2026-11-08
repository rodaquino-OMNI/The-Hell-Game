// Persistência local (moedas e skins, como no protótipo; servidor na fase 3) e loja de skins (só cosméticos).
import { $, balance } from "../data.ts";
import { CLASS_TOKENS, skinSwatch, tokCss } from "../look.ts";
import { SKIN_NAMES } from "../text.ts";

export interface Save { co: number; own: string[]; eq: string }
export let save: Save = { co: balance.economy.start_coins, own: ["std"], eq: "std" };
try { const j = JSON.parse(localStorage.getItem("thehell") || "null"); if (j) save = Object.assign(save, j); } catch { /* sem armazenamento */ }
export const persist = () => { try { localStorage.setItem("thehell", JSON.stringify(save)); } catch { /* sem armazenamento */ } };
/** amostra sem troca de cor: as cores dominantes das classes (a skin nunca as muda, Art Bible §3) */
const classGradient = () => `linear-gradient(90deg,${Object.values(CLASS_TOKENS).map(tokCss).join(",")})`;

export function updateCoins() { $("co").textContent = String(save.co); }

export function shop() {
  const s = $("shop");
  s.style.display = "flex";
  s.innerHTML = `<h1 style="font-size:30px">LOJA DE SKINS</h1><div>Moedas: <b>${save.co}</b> ⛁ · só cosméticos, sem vantagem no jogo</div><div id="sg"></div><button id="sx">Voltar</button>`;
  const grid = $("sg");
  for (const [id, price] of Object.entries(balance.skins)) {
    const k = skinSwatch(id), own = save.own.includes(id), eq = save.eq === id;
    const d = document.createElement("div");
    d.className = "sk" + (eq ? " on" : "");
    d.innerHTML = `<div class="sw" style="background:${k.body ?? classGradient()}"><i style="background:${k.head}"></i>${k.accent ? `<u style="background:${k.accent}"></u>` : ""}</div><b>${SKIN_NAMES[id] ?? id}</b>`;
    const btn = document.createElement("button");
    btn.textContent = eq ? "Equipada" : own ? "Equipar" : `Comprar · ${price}`;
    btn.disabled = eq || (!own && save.co < price);
    btn.onclick = () => { if (!own) { save.co -= price; save.own.push(id); } save.eq = id; persist(); updateCoins(); shop(); };
    d.appendChild(btn);
    grid.appendChild(d);
  }
  $("sx").onclick = () => { s.style.display = "none"; };
}
