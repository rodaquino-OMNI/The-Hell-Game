// Retratos da equipe (GDD v0.3 §12.1; Art Bible §3, §4, §8): cor e ícone da classe e o estado de cada aliado
// (vivo, ferido, preso com cadeado, morto, escapou). O estado nunca depende só de cor: cada um tem ícone e texto.
import type { Survivor } from "@thehell/sim";
import { t, type Key } from "../i18n/index.ts";
import { CLASS_ID, className } from "../text.ts";
import { CLASS_ICON, STATE_ICON } from "./icons.ts";

export type PortraitState = "ok" | "wounded" | "caged" | "dead" | "escaped";

/** estado do retrato; "ferido" = vivo com vida abaixo de `survivor.wounded_hp` (GDD-v0.3 §8.3; GDD-v0.2 §3.2) */
export function portraitState(s: Pick<Survivor, "st" | "hp">, woundedHp: number): PortraitState {
  if (s.st === "cage") return "caged";
  if (s.st === "dead") return "dead";
  if (s.st === "out") return "escaped";
  return s.hp < woundedHp ? "wounded" : "ok";
}

const STATE_TEXT: Record<PortraitState, Key> = {
  ok: "team.state.ok", wounded: "team.state.wounded", caged: "team.state.caged", dead: "team.state.dead", escaped: "team.state.escaped",
};

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * HTML dos retratos (itens de lista); o texto completo vai para leitores de tela, o curto fica visível. `cageTimer`
 * falso (Treino: o cronômetro da gaiola não corre no modo tutorial, packages/sim game.ts) mostra o preso sem prazo
 */
export function portraitsHtml(survivors: readonly Survivor[], woundedHp: number, cageTimer = true): string {
  return survivors.map(s => {
    const state = portraitState(s, woundedHp);
    const untimed = state === "caged" && !cageTimer;
    const p = { hp: Math.max(0, Math.round(s.hp)), n: Math.max(0, Math.ceil(s.cage)) };
    const name = className(s.cls);
    const full = t("team.portrait", { cls: name, you: s.bot ? "no" : "yes", state: untimed ? "caged_untimed" : state, ...p });
    const you = s.bot ? "" : ` <span class="you">(${esc(t("team.you"))})</span>`;
    return `<li class="pt ${state} c-${CLASS_ID[s.cls]}"><span class="sr">${esc(full)}</span>` +
      `<span aria-hidden="true" class="ci">${CLASS_ICON[s.cls]}</span>` +
      `<span aria-hidden="true" class="nm">${esc(name)}${you}</span>` +
      `<span aria-hidden="true" class="st">${STATE_ICON[state]}${esc(t(untimed ? "team.state.caged_untimed" : STATE_TEXT[state], p))}</span></li>`;
  }).join("");
}
