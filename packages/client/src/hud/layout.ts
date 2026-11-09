// Coluna do centro embaixo (#bot: legendas, painel de espectador e dica) × painel de pings no canto esquerdo (V8b,
// revisão do qa no #61). Em tela estreita ou com fonte grande, a coluna centralizada chega à largura dos pings; aí ela
// sobe acima deles (classe `lift`, altura em `--pings-lift`). Recalcula só quando um dos dois muda de tamanho
// (ResizeObserver) ou a janela muda; nada por quadro.
import { $ } from "../data.ts";

/** a coluna precisa subir: as faixas horizontais se cruzam (retângulos sem a subida aplicada) */
export const needsLift = (bot: { left: number; right: number }, pings: { left: number; right: number; width: number }) =>
  pings.width > 0 && bot.left < pings.right && pings.left < bot.right;

export function setupBottomLayout() {
  const bot = $("bot"), pings = $("pings");
  const update = () => {
    const b = bot.getBoundingClientRect(), p = pings.getBoundingClientRect();
    const lift = !pings.hidden && needsLift(b, p);
    bot.classList.toggle("lift", lift);
    bot.style.setProperty("--pings-lift", lift ? `${p.height}px` : "0px");
  };
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(update);
    ro.observe(bot);
    ro.observe(pings);
  }
  addEventListener("resize", update);
  update();
}
