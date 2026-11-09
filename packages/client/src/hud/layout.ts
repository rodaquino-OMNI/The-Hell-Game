// Coluna do centro embaixo (#bot: legendas, painel de espectador e dica) × painel de pings no canto esquerdo (V8b,
// revisão do qa no #61). Em tela estreita ou com fonte grande, a coluna centralizada chega à largura dos pings; aí ela
// sobe acima deles (classe `lift`, altura em `--pings-lift`). Recalcula só quando um dos dois muda de tamanho
// (ResizeObserver) ou a janela muda; nada por quadro. No modo Retro FPS (V9) a altura real da barra de estado (#sb)
// vai para `--sb-h`, base de pings e da coluna (index.html), e o ResizeObserver também acompanha a barra.
import { $ } from "../data.ts";

/** a coluna precisa subir: as faixas horizontais se cruzam (retângulos sem a subida aplicada) */
export const needsLift = (bot: { left: number; right: number }, pings: { left: number; right: number; width: number }) =>
  pings.width > 0 && bot.left < pings.right && pings.left < bot.right;

/** distância do pé da tela até o topo da barra de estado do modo Retro FPS (0 com ela escondida) */
export const statusBarLift = (sb: { hidden: boolean; top: number }, viewportHeight: number) => (sb.hidden ? 0 : Math.max(0, viewportHeight - sb.top));

export function setupBottomLayout() {
  const bot = $("bot"), pings = $("pings"), sb = $("sb");
  const update = () => {
    // modo Retro FPS (V9): pings e coluna começam acima da altura real da barra (que quebra linha com a fonte grande)
    document.documentElement.style.setProperty("--sb-h", `${statusBarLift({ hidden: sb.hidden, top: sb.getBoundingClientRect().top }, innerHeight)}px`);
    const b = bot.getBoundingClientRect(), p = pings.getBoundingClientRect();
    const lift = !pings.hidden && needsLift(b, p);
    bot.classList.toggle("lift", lift);
    bot.style.setProperty("--pings-lift", lift ? `${p.height}px` : "0px");
  };
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(update);
    ro.observe(bot);
    ro.observe(pings);
    ro.observe(sb);
  }
  addEventListener("resize", update);
  update();
}
