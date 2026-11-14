// HUD: painel do quebra-cabeça do gerador (barra de tempo ou sequência de setas).
import type { Arrow, GameState } from "@thehell/sim";
import { $, balance } from "../data.ts";
import { t } from "../i18n/index.ts";
import { ARROW_LABEL } from "../text.ts";

const AR: Record<Arrow, string> = { left: "←", up: "↑", right: "→", down: "↓" };

/** botão de sair do painel */
export function setupPuzzlePanel(onExit: () => void) {
  $("pzx").onclick = onExit;
}

export function puzzlePanel(G: GameState) {
  const z = G.puzzle, panel = $("pz");
  if (!z) { panel.style.display = "none"; return; }
  panel.style.display = "block";
  const title = `<b>${t("puzzle.title", { n: G.gens[z.gen].n + 1, total: balance.generator.puzzles_per_generator })}</b>`;
  $("pzc").innerHTML = z.kind === "timing"
    ? `${title}<div class="bar"><i class="zn" style="left:${(z.zoneCenter - z.zoneWidth / 2) * 100}%;width:${z.zoneWidth * 100}%"></i><i class="cu" style="left:${z.t * 100}%"></i></div><small>${t(z.untimed ? "puzzle.timing_untimed" : "puzzle.timing")}</small>`
    : `${title}<div class="sq">${z.seq.map((a, i) => `<span role="img" aria-label="${t(ARROW_LABEL[a])}" class="${i < z.i ? "ok" : ""}">${AR[a]}</span>`).join("")}</div><small>${t("puzzle.sequence")}</small>`;
}
