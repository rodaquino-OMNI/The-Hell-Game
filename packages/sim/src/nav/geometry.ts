// Geometria 2D do plano do chão (x, z) usada pela navegação e pelo validador de mapas (GDD v0.3 §8.6, §9.1).
// Caixas no formato do mapa: [x, z, largura, profundidade] (centro e tamanho), como em data/maps/*.json.

export type P2 = readonly [number, number];
export type Box = readonly [number, number, number, number];

/** distância do ponto à caixa (0 se dentro) */
export function pointBoxDist(x: number, z: number, b: Box): number {
  const dx = Math.max(Math.abs(x - b[0]) - b[2] / 2, 0);
  const dz = Math.max(Math.abs(z - b[1]) - b[3] / 2, 0);
  return Math.hypot(dx, dz);
}

/** menor distância do ponto a qualquer caixa (Infinity se não houver caixas) */
export function clearance(x: number, z: number, boxes: readonly Box[]): number {
  let d = Infinity;
  for (const b of boxes) d = Math.min(d, pointBoxDist(x, z, b));
  return d;
}

/** o segmento a→b cruza a caixa inflada em r (teste de lajes; inflação quadrada, conservadora) */
export function segmentHitsBox(a: P2, b: P2, box: Box, r: number): boolean {
  const hx = box[2] / 2 + r, hz = box[3] / 2 + r;
  let t0 = 0, t1 = 1;
  const d = [b[0] - a[0], b[1] - a[1]];
  const o = [a[0] - box[0], a[1] - box[1]];
  const h = [hx, hz];
  for (let i = 0; i < 2; i++) {
    if (d[i] === 0) {
      if (Math.abs(o[i]) >= h[i]) return false;
      continue;
    }
    let ta = (-h[i] - o[i]) / d[i], tb = (h[i] - o[i]) / d[i];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 >= t1) return false;
  }
  return true;
}

export function polygonPerimeter(poly: readonly P2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return s;
}

/** ponto dentro do polígono (regra par-ímpar) */
export function pointInPolygon(x: number, z: number, poly: readonly P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function pathLength(path: readonly P2[]): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return s;
}

/**
 * Chão caminhável do mapa (retângulo `size` centrado na origem) menos as caixas, como retângulos
 * disjuntos [x0, z0, x1, z1] por compressão de coordenadas. Base da malha do navmesh.
 */
export function floorRects(size: P2, boxes: readonly Box[]): [number, number, number, number][] {
  const hx = size[0] / 2, hz = size[1] / 2;
  const clampX = (v: number) => Math.min(hx, Math.max(-hx, v));
  const clampZ = (v: number) => Math.min(hz, Math.max(-hz, v));
  const xs = new Set<number>([-hx, hx]), zs = new Set<number>([-hz, hz]);
  for (const b of boxes) {
    xs.add(clampX(b[0] - b[2] / 2)); xs.add(clampX(b[0] + b[2] / 2));
    zs.add(clampZ(b[1] - b[3] / 2)); zs.add(clampZ(b[1] + b[3] / 2));
  }
  const X = [...xs].sort((a, b) => a - b), Z = [...zs].sort((a, b) => a - b);
  const out: [number, number, number, number][] = [];
  for (let i = 0; i + 1 < X.length; i++) {
    for (let j = 0; j + 1 < Z.length; j++) {
      const cx = (X[i] + X[i + 1]) / 2, cz = (Z[j] + Z[j + 1]) / 2;
      if (!boxes.some(b => pointBoxDist(cx, cz, b) === 0)) out.push([X[i], Z[j], X[i + 1], Z[j + 1]]);
    }
  }
  return out;
}

/** menor vão entre duas caixas que não se tocam (0 se encostadas ou sobrepostas) */
export function boxGap(a: Box, b: Box): number {
  const gx = Math.max(Math.abs(a[0] - b[0]) - (a[2] + b[2]) / 2, 0);
  const gz = Math.max(Math.abs(a[1] - b[1]) - (a[3] + b[3]) / 2, 0);
  return Math.hypot(gx, gz);
}
