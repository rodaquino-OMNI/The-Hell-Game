// MOCKUP A2b — barra de estado inferior do modo "Retro FPS" (D-13, docs/plano-construcao.md §7): largura total, estilo
// de gênero dos anos 90 com arte própria (sem rosto no centro, sem elementos de jogos comerciais). Mostra os dados do
// HUD do R7 (GDD v0.3 §12.1): classe, vida, fôlego, habilidade, geradores e quebra-cabeças, vida do caçador e os
// retratos da equipe com ícone de classe e estado. Textos só por chave (i18n/), cores só por token (index.html).
// Só com `?retro=1`: os painéis do jogador, dos objetivos e da equipe do HUD padrão dão lugar à barra.
import type { GameState } from "@thehell/sim";
import { $, balance } from "../data.ts";
import { t, type Key } from "../i18n/index.ts";
import type { RetroClass } from "../render/options.ts";
import { CLASS_ID, className } from "../text.ts";
import { CLASS_ICON, PREVIEW_CLASS_ICON } from "./icons.ts";
import { portraitsHtml } from "./team.ts";

/** classes da fase 4 mostradas só na vista do mockup (?retro_class) */
const PREVIEW: Partial<Record<RetroClass, { name: Key; css: string }>> = {
  protetor: { name: "class.protector", css: "c-protector" },
  batedor: { name: "class.scout", css: "c-scout" },
};

let last = "";

/** liga a barra: classe `retro` no corpo (CSS do index.html) e barra visível */
export function setupStatusBar() {
  document.body.classList.add("retro");
  $("sb").hidden = false;
}

const meter = (label: string, value: number, max: number, color: string) =>
  `<div class="sbm" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="${Math.round(max)}" aria-valuenow="${Math.max(0, Math.round(value))}"><i style="width:${Math.max(0, Math.min(100, (value / max) * 100))}%;background:var(${color})"></i></div>`;

/** HTML da barra para o estado `G`; `preview` = classe pedida em ?retro_class */
export function statusBarHtml(G: GameState, preview?: RetroClass): string {
  const P = G.survivors[0], H = G.hunter, b = balance;
  const pv = preview ? PREVIEW[preview] : undefined;
  const name = pv ? t(pv.name) : className(P.cls);
  const icon = pv ? PREVIEW_CLASS_ICON[preview as "protetor" | "batedor"] : CLASS_ICON[P.cls];
  const css = pv ? pv.css : `c-${CLASS_ID[P.cls]}`;
  const req = G.gens.filter(g => !g.bonus), done = req.filter(g => g.done).length, puzzles = req.reduce((a, g) => a + g.n, 0);
  const hp = Math.max(0, Math.round(P.hp)), st = Math.max(0, Math.round(P.stamina));
  const ability = P.cd > 0 ? t("retro.ability_cd", { n: Math.ceil(P.cd) }) : t("retro.ability_ready");
  return `<div class="sbs sb-me ${css}"><span class="ci" aria-hidden="true">${icon}</span><b>${name}</b></div>` +
    `<div class="sbs"><small>${t("retro.health")}</small><span class="big${P.hp < b.survivor.wounded_hp ? " danger" : ""}">${hp}</span>${meter(t("retro.health"), P.hp, b.survivor.hp, "--ui-danger")}</div>` +
    `<div class="sbs"><small>${t("retro.stamina")}</small><span class="big">${st}</span>${meter(t("retro.stamina"), P.stamina, b.survivor.stamina.max, "--ui-text-dim")}</div>` +
    `<div class="sbs"><small>${t("retro.ability")}</small><span class="big${P.cd > 0 ? "" : " ok"}">${ability}</span></div>` +
    `<div class="sbs"><small>${t("retro.generators")}</small><span class="big">${done}/${req.length}</span><small>${t("retro.puzzles", { done: puzzles, total: req.length * b.generator.puzzles_per_generator })}</small></div>` +
    `<div class="sbs"><small>${t("retro.hunter")}</small>${meter(t("retro.hunter"), H.hp, H.maxHp, "--hunter-espectro")}</div>` +
    `<div class="sbs sb-tm"><small>${t("retro.team")}</small><ul>${portraitsHtml(G.survivors, b.survivor.wounded_hp)}</ul></div>`;
}

/** atualiza a barra (só troca o HTML quando muda) */
export function statusBar(G: GameState, preview?: RetroClass) {
  const html = statusBarHtml(G, preview);
  if (html !== last) { last = html; $("sb").innerHTML = html; }
}
