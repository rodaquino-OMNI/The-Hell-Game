// Ícones do HUD em SVG 16×16 (Art Bible §8: um ícone por classe com a forma-chave da §3; §4: cadeado do preso).
// Desenhados com `currentColor`; a cor vem do token da classe ou do estado via CSS.
import type { ClassName } from "@thehell/sim";

const svg = (body: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square">${body}</svg>`;

/** forma-chave de cada classe: cajado com caduceu, chave inglesa, espada */
export const CLASS_ICON: Record<ClassName, string> = {
  Curandeiro: svg(`<path d="M8 1v14"/><path d="M5 4c3 0 6 1.5 3 3.5S5 10 8 10s3 1 0 2"/><circle cx="8" cy="2" r="1" fill="currentColor"/>`),
  Mecânico: svg(`<path d="M3 13l6-6"/><path d="M9 7a3 3 0 1 0 2-5l-1.5 1.5 1 2 2 1L14 5a3 3 0 0 1-5 2"/>`),
  Atacador: svg(`<path d="M3 13L12 4"/><path d="M12 4l2-2"/><path d="M4 9l3 3"/><path d="M2 14l1.5-1.5"/>`),
};

/**
 * mockup do modo Retro FPS (D-13): ícones das classes da fase 4, só para as vistas de Protetor e Batedor do A2b
 * (Art Bible §3: escudo redondo; capuz com ponta e cachecol)
 */
export const PREVIEW_CLASS_ICON = {
  protetor: svg(`<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/>`),
  batedor: svg(`<path d="M8 1l3 6H5z"/><path d="M5 9h6"/><path d="M9 9l5 3M8 10l4 5"/>`),
} as const;

/** ícone de cada estado do retrato (o vivo não leva ícone) */
export const STATE_ICON = {
  ok: "",
  wounded: svg(`<path d="M8 14S2 10 2 6a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 4-6 8-6 8z"/><path d="M8 5l-1 3 2 1-1 3"/>`),
  caged: svg(`<rect x="3" y="7" width="10" height="7"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/><path d="M8 10v2"/>`),
  dead: svg(`<path d="M3 3l10 10M13 3L3 13"/>`),
  escaped: svg(`<path d="M2 8h9"/><path d="M8 5l3 3-3 3"/><path d="M13 2v12"/>`),
} as const;

/** seta da ameaça, apontando para cima (girada pelo setor) */
export const THREAT_ARROW = `<svg viewBox="0 0 32 32" width="48" height="48" aria-hidden="true" focusable="false"><path d="M16 2L28 22H20V30H12V22H4Z" fill="currentColor"/></svg>`;
