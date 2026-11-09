// Aplica as opções do jogador (ui/settings.ts) nos módulos donos de cada efeito (V8): intensidades PS1
// e contorno do caçador (render/ps1.ts), camada A e "reduzir flicker" (render/layers.ts), fov e balanço (render/motion.ts), modo daltônico
// (look.ts + hud/palette.ts), tamanho da fonte (variável CSS `--ui-scale` no documento) e controles (input.ts).
import { balance } from "../data.ts";
import { applyPalette } from "../hud/palette.ts";
import { setControls } from "../input.ts";
import { setColorMode } from "../look.ts";
import { setLayerA, setReduceFlicker } from "../render/layers.ts";
import { setFov, setReduceCameraBob } from "../render/motion.ts";
import { setHunterOutline, setPs1 } from "../render/ps1.ts";
import type { Options } from "./settings.ts";

export function applyOptions(o: Options, doc: Document = document) {
  setPs1(o.ps1);
  setLayerA(o.layerA);
  setReduceFlicker(o.reduceFlicker);
  setReduceCameraBob(o.reduceCameraBob);
  setHunterOutline(o.hunterOutline);
  setFov(o.fov);
  setColorMode(o.colorMode);
  setControls({ keys: o.keys, toggleRun: o.toggleRun, toggleInteract: o.toggleInteract, sensitivity: o.sensitivity, invertY: o.invertY });
  const root = doc.documentElement;
  applyPalette(root);
  root.style.setProperty("--ui-scale", String(balance.ui.options.font_scales[o.fontSize]));
  root.dataset.fontSize = o.fontSize;
  // "reduzir flicker" também para o pulso da seta de ameaça do HUD (classe lida pelo CSS do index.html)
  root.classList.toggle("reduce-flicker", o.reduceFlicker);
}
