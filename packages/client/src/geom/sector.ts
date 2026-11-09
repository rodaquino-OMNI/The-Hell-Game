// Setor relativo à câmera (GDD v0.3 §12.1): módulo neutro, sem HUD nem áudio, usado pela seta de ameaça
// (hud/threat.ts) e pelas legendas de som (audio/captions.ts), para as duas mostrarem a mesma direção.
import type { Vec } from "@thehell/sim";

/**
 * Setor de `to` visto de `from` com a câmera em `yaw`: 0 = à frente, crescendo no sentido horário (com 8 setores,
 * 2 = direita, 4 = atrás, 6 = esquerda). Frente da câmera = (−sen yaw, −cos yaw), direita = (cos yaw, −sen yaw),
 * as mesmas da entrada (input.ts). Devolve null se os pontos coincidem.
 */
export function relativeSector(from: Vec, yaw: number, to: Vec, sectors: number): number | null {
  const dx = to.x - from.x, dz = to.z - from.z;
  if (dx === 0 && dz === 0) return null;
  const fwd = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
  const right = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
  const step = (2 * Math.PI) / sectors;
  const s = Math.round(Math.atan2(right, fwd) / step) % sectors;
  return (s + sectors) % sectors; // também normaliza −0
}
