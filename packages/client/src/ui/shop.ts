// Persistência local (moedas e skins, como no protótipo; servidor na fase 3) e loja de skins (só cosméticos).
// A loja é um diálogo modal: foco no título ao abrir, Esc ou "Voltar" fecham e o foco volta ao botão da loja.
import { $, balance } from "../data.ts";
import { t } from "../i18n/index.ts";
import { skinSwatch } from "../look.ts";
import { skinName } from "../text.ts";

export interface Save { co: number; own: string[]; eq: string }
export let save: Save = { co: balance.economy.start_coins, own: ["std"], eq: "std" };
try { const j = JSON.parse(localStorage.getItem("thehell") || "null"); if (j) save = Object.assign(save, j); } catch { /* sem armazenamento */ }
export const persist = () => { try { localStorage.setItem("thehell", JSON.stringify(save)); } catch { /* sem armazenamento */ } };
// amostra da skin com as cores que ela troca no modelo 3D (look.ts `skinSwatch`: calça, pele, sapatos/acessório);
// a skin padrão não troca cor e mostra as dominantes das classes, que nenhuma skin muda (Art Bible §3)
const CLASS_GRADIENT = "linear-gradient(90deg,var(--class-curandeiro),var(--class-mecanico),var(--class-atacador))";

export function updateCoins() { $("co").textContent = t("menu.coins", { coins: save.co }); }

function closeShop() {
  $("shop").style.display = "none";
  $("menu").inert = false;
  $("sh").focus();
}

export function shop(focusId?: string) {
  const s = $("shop");
  s.style.display = "flex";
  $("menu").inert = true;
  s.innerHTML = `<h1 id="shopt" tabindex="-1">${t("shop.title")}</h1><p>${t("shop.coins", { coins: save.co })}</p><div id="sg"></div><button type="button" id="sx">${t("shop.back")}</button>`;
  const grid = $("sg");
  for (const [id, price] of Object.entries(balance.skins)) {
    const k = skinSwatch(id), own = save.own.includes(id), eq = save.eq === id;
    const d = document.createElement("div");
    d.className = "sk" + (eq ? " on" : "");
    d.innerHTML = `<div class="sw" aria-hidden="true" style="background:${k.body ?? CLASS_GRADIENT}"><i style="background:${k.head}"></i>${k.accent ? `<u style="background:${k.accent}"></u>` : ""}</div><b id="skn-${id}">${skinName(id)}</b>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "skb-" + id;
    btn.textContent = eq ? t("shop.equipped") : own ? t("shop.equip") : t("shop.buy", { price });
    btn.setAttribute("aria-describedby", "skn-" + id);
    btn.disabled = eq || (!own && save.co < price);
    btn.onclick = () => { if (!own) { save.co -= price; save.own.push(id); } save.eq = id; persist(); updateCoins(); shop("sx"); };
    d.appendChild(btn);
    grid.appendChild(d);
  }
  $("sx").onclick = closeShop;
  s.onkeydown = e => { if (e.key === "Escape") { e.stopPropagation(); closeShop(); } };
  $(focusId ?? "shopt").focus();
}
