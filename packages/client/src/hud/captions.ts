// Faixa de legendas de som no HUD (V8b; GDD-v0.3 §12.4 "legendas de sons" e §11 L218 "ícone direcional"). Dados do
// barramento do áudio (audio/captions.ts, A-6): texto, categoria, setor, ×N e ttl. Aqui só o desenho:
//  - faixa no centro embaixo, acima da dica de interação (e acima da barra de estado no ?retro=1);
//  - cada legenda: seta na direção do som (o mesmo setor da seta de ameaça) ou ponto sem direção, texto e ×N; a
//    direção também vai em texto para leitor de tela, e as categorias do caçador levam borda de perigo (a informação
//    não depende só de cor nem só do ícone; WCAG 2.2, 1.3.3 e 1.4.1);
//  - some aos poucos nos últimos `ui.captions.fade` s, em `ui.captions.opacity_steps` degraus (no máximo esse número
//    de escritas de estilo por legenda; nada de escrever no DOM a cada quadro); com "reduzir flicker", sem esmaecer;
//  - aria-live "off" durante a partida (o leitor de tela não fala por cima do jogo) e "polite" fora dela.
// Cores só por token (index.html); visual padrão simples, a decisão de estilo fica para o marco de arte.
import { getCaptions, subscribeCaptions, type Caption } from "../audio/captions.ts";
import { $, balance } from "../data.ts";
import { t } from "../i18n/index.ts";
import { getReduceFlicker } from "../render/layers.ts";
import { directionText } from "../text.ts";
import { sectorDegrees, sectorDirection } from "./threat.ts";

const cu = balance.ui.captions;
const sectors = balance.ui.threat_sectors;
/** seta da legenda (a mesma forma da seta de ameaça, menor; aponta para cima = frente) */
const ARROW = `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M16 2L28 22H20V30H12V22H4Z" fill="currentColor"/></svg>`;
const DOT = `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="7" fill="currentColor"/></svg>`;
const DANGER = new Set(["hunter_steps", "hunter_attack"]);

/** opacidade da legenda com `ttl` s restantes: 1 até os últimos `fade` s, depois em degraus; 1 com reduzir flicker */
export function captionOpacity(ttl: number, fade: number, steps: number, reduceFlicker: boolean): number {
  if (reduceFlicker || fade <= 0 || ttl >= fade) return 1;
  return Math.max(1, Math.ceil((Math.max(0, ttl) / fade) * steps)) / steps;
}

/** HTML de uma legenda (texto já traduzido pelo barramento) */
export function captionHtml(c: Caption): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, ch => `&#${ch.charCodeAt(0)};`);
  const dir = c.dir === null ? "" : `<span class="sr"> (${esc(directionText(sectorDirection(c.dir, sectors)))})</span>`;
  const icon = c.dir === null ? DOT : ARROW;
  const rot = c.dir === null ? "" : ` style="transform:rotate(${sectorDegrees(c.dir, sectors)}deg)"`;
  const count = c.count > 1 ? `<span class="cn">${esc(t("hud.caption_count", { n: c.count }))}</span>` : "";
  return `<li class="cp${DANGER.has(c.category) ? " hz" : ""}" data-id="${c.id}"><span class="ca"${rot}>${icon}</span><span class="ct">${esc(c.text ?? "")}${dir}</span>${count}</li>`;
}

const shown = new Map<number, number>();
let live: "off" | "polite" | null = null;

function render(list: readonly Caption[]) {
  const el = $("cap");
  el.innerHTML = list.map(captionHtml).join("");
  shown.clear();
  el.hidden = list.length === 0;
}

/** assina o barramento: a lista só é refeita quando muda (nova legenda, fusão, expiração, idioma) */
export function setupCaptions() {
  subscribeCaptions(render);
  render(getCaptions());
}

/** uma vez por quadro: esmaece as que estão saindo (só escreve quando o degrau muda) e acerta o aria-live */
export function captionsFrame(inMatch: boolean) {
  const want = inMatch ? "off" : "polite";
  const el = $("cap");
  if (want !== live) { el.setAttribute("aria-live", want); live = want; }
  if (el.hidden) return;
  const rf = getReduceFlicker();
  for (const c of getCaptions()) {
    const o = captionOpacity(c.ttl, cu.fade, cu.opacity_steps, rf);
    if (shown.get(c.id) === o) continue;
    shown.set(c.id, o);
    const li = el.querySelector<HTMLElement>(`li[data-id="${c.id}"]`);
    if (li) li.style.opacity = String(o);
  }
}
