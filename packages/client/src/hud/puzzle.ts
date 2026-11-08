// HUD: painel do quebra-cabeça do gerador (barra de tempo ou sequência de setas).
import type { Arrow, GameState } from "@thehell/sim";
import { $, balance } from "../data.ts";

/** botão de sair do painel */
export function setupPuzzlePanel(onExit: () => void) {
  $("pzx").onclick = onExit;
}

export function puzzlePanel(G: GameState) {
  const z = G.puzzle, panel = $("pz");
  if (!z) { panel.style.display = "none"; return; }
  panel.style.display = "block";
  const n = G.gens[z.gen].n + 1, total = balance.generator.puzzles_per_generator;
  const AR: Record<Arrow, string> = { left: "←", up: "↑", right: "→", down: "↓" };
  $("pzc").innerHTML = z.kind === "timing"
    ? `<b>Gerador — quebra-cabeça ${n}/${total}</b><div class="bar"><i class="zn" style="left:${(z.zoneCenter - z.zoneWidth / 2) * 100}%;width:${z.zoneWidth * 100}%"></i><i class="cu" style="left:${z.t * 100}%"></i></div><small>ESPAÇO quando o marcador estiver na zona verde</small>`
    : `<b>Gerador — quebra-cabeça ${n}/${total}</b><div class="sq">${z.seq.map((a, i) => `<span class="${i < z.i ? "ok" : ""}">${AR[a]}</span>`).join("")}</div><small>repita a sequência com as setas ou WASD</small>`;
}
