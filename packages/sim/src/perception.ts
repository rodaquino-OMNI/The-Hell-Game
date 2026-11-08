// Percepção do caçador no ruleset v1 (GDD-v0.3 §8.1; GDD-v0.2 §3.4): cone de visão com linha de visão
// por raio 2D contra as caixas de colisão do mapa. Funções puras, sem estado.
import type { GameMap } from "@thehell/shared";
import type { Vec } from "./types.ts";

/** o segmento a→b cruza o interior da caixa [cx, cz, largura, profundidade]? (método das placas) */
export function segmentHitsBox(a: Vec, b: Vec, box: readonly [number, number, number, number]): boolean {
  const [cx, cz, w, d] = box;
  const min = [cx - w / 2, cz - d / 2], max = [cx + w / 2, cz + d / 2];
  const o = [a.x, a.z], dir = [b.x - a.x, b.z - a.z];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 2; i++) {
    if (dir[i] === 0) {
      if (o[i] <= min[i] || o[i] >= max[i]) return false;
      continue;
    }
    let ta = (min[i] - o[i]) / dir[i], tb = (max[i] - o[i]) / dir[i];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 >= t1) return false;
  }
  return true;
}

/** linha de visão livre entre dois pontos (nenhuma parede no caminho) */
export function lineOfSight(map: GameMap, a: Vec, b: Vec): boolean {
  return !map.walls.some(w => segmentHitsBox(a, b, w));
}

/**
 * `to` está dentro do cone de abertura `fovDeg` centrado na direção `yaw`? A direção de frente segue a convenção
 * da simulação: yaw `a` olha para (−sen a, −cos a).
 */
export function inCone(from: Vec, yaw: number, to: Vec, fovDeg: number): boolean {
  const dx = to.x - from.x, dz = to.z - from.z, k = Math.hypot(dx, dz);
  if (k === 0) return true;
  const cos = (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / k;
  return cos >= Math.cos(((fovDeg / 2) * Math.PI) / 180);
}

/** visão do caçador: dentro do raio, do cone e com linha de visão (GDD-v0.3 §8.1, aceite: atrás de parede, fora do cone, além do raio) */
export function canSee(map: GameMap, from: Vec, yaw: number, to: Vec, fovDeg: number, radius: number): boolean {
  return Math.hypot(to.x - from.x, to.z - from.z) < radius && inCone(from, yaw, to, fovDeg) && lineOfSight(map, from, to);
}
