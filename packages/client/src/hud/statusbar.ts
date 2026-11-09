// Modo "Retro FPS" (V9; D-13 em docs/plano-construcao.md §7) — barra de estado inferior, estilo de gênero dos anos 90
// com arte própria (sem rosto no centro, sem elementos de jogos comerciais). Resposta 3b do A2b (issue #27): barra fina
// só com vida, fôlego e habilidade (com o ícone da classe). Os objetivos, o caçador e a equipe seguem no HUD padrão do
// R7 (GDD v0.3 §12.1); só o painel do jogador (#me) dá lugar à barra. Textos só por chave (i18n/), cores só por token
// (index.html), tamanhos de letra em `--ui-scale` (os 3 tamanhos de fonte). Só com o modo ligado (render/retro/mode.ts).
import type { GameState } from "@thehell/sim";
import { $, balance } from "../data.ts";
import { keyLabel } from "../bindings.ts";
import { t, type Key } from "../i18n/index.ts";
import { getControls } from "../input.ts";
import type { RetroClass } from "../render/options.ts";
import { CLASS_ID, className } from "../text.ts";
import { CLASS_ICON, PREVIEW_CLASS_ICON } from "./icons.ts";

/** classes da fase 4 mostradas só na vista de depuração (?debug=1&retro_class) */
const PREVIEW: Partial<Record<RetroClass, { name: Key; css: string }>> = {
  protetor: { name: "class.protector", css: "c-protector" },
  batedor: { name: "class.scout", css: "c-scout" },
};

let last = "";

/** liga ou desliga a barra: classe `retro` no corpo (CSS do index.html) e barra visível */
export function setupStatusBar(on: boolean) {
  document.body.classList.toggle("retro", on);
  $("sb").hidden = !on;
  last = "";
}

const meter = (label: string, value: number, max: number, color: string) =>
  `<div class="sbm" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="${Math.round(max)}" aria-valuenow="${Math.max(0, Math.round(value))}"><i style="width:${Math.max(0, Math.min(100, (value / max) * 100))}%;background:var(${color})"></i></div>`;

/**
 * HTML da barra para o estado `G`: três blocos (vida, fôlego, habilidade); `preview` = classe pedida em ?retro_class;
 * `abilityKey` = tecla atual da ação `ability` (remapeável, V8)
 */
export function statusBarHtml(G: GameState, preview?: RetroClass, abilityKey: string = keyLabel(getControls().keys, "ability")): string {
  const P = G.survivors[0], b = balance;
  const pv = preview ? PREVIEW[preview] : undefined;
  const name = pv ? t(pv.name) : className(P.cls);
  const icon = pv ? PREVIEW_CLASS_ICON[preview as "protetor" | "batedor"] : CLASS_ICON[P.cls];
  const css = pv ? pv.css : `c-${CLASS_ID[P.cls]}`;
  const hp = Math.max(0, Math.round(P.hp)), st = Math.max(0, Math.round(P.stamina));
  const ability = P.cd > 0 ? t("retro.ability_cd", { n: Math.ceil(P.cd) }) : t("retro.ability_ready");
  return `<div class="sbs"><small>${t("retro.health")}</small><span class="big${P.hp < b.survivor.wounded_hp ? " danger" : ""}">${hp}</span>${meter(t("retro.health"), P.hp, b.survivor.hp, "--ui-danger")}</div>` +
    `<div class="sbs"><small>${t("retro.stamina")}</small><span class="big">${st}</span>${meter(t("retro.stamina"), P.stamina, b.survivor.stamina.max, "--ui-text-dim")}</div>` +
    `<div class="sbs sb-ab ${css}"><span class="ci" role="img" aria-label="${name}">${icon}</span><small>${t("retro.ability", { key: abilityKey })}</small><span class="big${P.cd > 0 ? "" : " ok"}">${ability}</span></div>`;
}

/** atualiza a barra (só troca o HTML quando muda) */
export function statusBar(G: GameState, preview?: RetroClass) {
  const html = statusBarHtml(G, preview);
  if (html !== last) { last = html; $("sb").innerHTML = html; }
}
