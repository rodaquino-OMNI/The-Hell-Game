// Primitivas low-poly das peças dos personagens (Art Bible §3 e §7). Cada face é plana (vértices próprios),
// com uma única cor da paleta e presa a um único osso (skin rígido, como no PS1).
// Puro: sem DOM, roda no navegador e no Node (tools/assets/build-characters.ts).
import { Euler, Quaternion, Vector3 } from "three";

/** triângulo já em espaço do modelo (pose de ligação), com a cor (token) e o osso */
export interface Tri { a: Vector3; b: Vector3; c: Vector3; token: string; joint: string; glow: boolean }

export interface Paint { token: string; joint: string; glow: boolean }

/** base ortonormal (u, v) perpendicular a `dir` */
function basis(dir: Vector3): [Vector3, Vector3] {
  const ref = Math.abs(dir.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const u = new Vector3().crossVectors(dir, ref).normalize();
  const v = new Vector3().crossVectors(u, dir).normalize();
  return [u, v];
}

/** vira os triângulos (a partir de `start`) cuja normal aponta para dentro da peça convexa de centro `c` */
function orient(out: Tri[], start: number, c: Vector3) {
  const e1 = new Vector3(), e2 = new Vector3(), n = new Vector3(), m = new Vector3();
  for (let i = start; i < out.length; i++) {
    const t = out[i];
    n.crossVectors(e1.subVectors(t.b, t.a), e2.subVectors(t.c, t.a));
    m.copy(t.a).add(t.b).add(t.c).divideScalar(3).sub(c);
    if (n.dot(m) < 0) out[i] = { ...t, b: t.c, c: t.b };
  }
}

function quad(out: Tri[], p: Paint, a: Vector3, b: Vector3, c: Vector3, d: Vector3) {
  out.push({ a, b, c, ...p }, { a, b: c, c: d, ...p });
}

/** polígono convexo em leque (vértices em ordem anti-horária vista de fora) */
function fan(out: Tri[], p: Paint, ring: Vector3[]) {
  for (let i = 1; i + 1 < ring.length; i++) out.push({ a: ring[0], b: ring[i], c: ring[i + 1], ...p });
}

/**
 * Prisma (tronco de cone) de `from` até `to`, seção elíptica com raios [x, z] em cada ponta e `sides` lados.
 * `twist` gira a seção (graus) para alinhar faces planas. Triângulos: 2·lados + 2·(lados − 2).
 */
export function prism(out: Tri[], p: Paint, from: Vector3, to: Vector3, r0: [number, number], r1: [number, number], sides: number, twist = 0) {
  const dir = new Vector3().subVectors(to, from).normalize();
  const [u, v] = basis(dir);
  const ring = (o: Vector3, r: [number, number]) => Array.from({ length: sides }, (_, i) => {
    const t = (i / sides) * Math.PI * 2 + (twist * Math.PI) / 180;
    return o.clone().addScaledVector(u, Math.cos(t) * r[0]).addScaledVector(v, Math.sin(t) * r[1]);
  });
  const start = out.length, A = ring(from, r0), B = ring(to, r1);
  for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; quad(out, p, A[i], A[j], B[j], B[i]); }
  fan(out, p, [...A].reverse());
  fan(out, p, B);
  orient(out, start, from.clone().lerp(to, 0.5));
}

/** caixa de tamanho [x, y, z] centrada em `c`, girada por `rot` (graus, XYZ). 12 triângulos. */
export function box(out: Tri[], p: Paint, c: Vector3, size: [number, number, number], rot: [number, number, number] = [0, 0, 0]) {
  const q = new Quaternion().setFromEuler(new Euler(...rot.map(d => (d * Math.PI) / 180) as [number, number, number]));
  const h = size.map(s => s / 2);
  const P = (x: number, y: number, z: number) => new Vector3(x * h[0], y * h[1], z * h[2]).applyQuaternion(q).add(c);
  const v = [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)];
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [0, 1, 5, 4], [3, 7, 6, 2]];
  const start = out.length;
  for (const [a, b, cc, d] of faces) quad(out, p, v[a], v[b], v[cc], v[d]);
  orient(out, start, c);
}

/** elipsoide em grade de latitude e longitude. Triângulos: 2·lados·(aneis − 1). */
export function ellipsoid(out: Tri[], p: Paint, c: Vector3, r: [number, number, number], sides: number, rings: number) {
  const pt = (i: number, k: number) => {
    const th = (k / rings) * Math.PI, ph = (i / sides) * Math.PI * 2;
    return new Vector3(Math.sin(th) * Math.cos(ph) * r[0], Math.cos(th) * r[1], Math.sin(th) * Math.sin(ph) * r[2]).add(c);
  };
  const start = out.length;
  for (let k = 0; k < rings; k++) for (let i = 0; i < sides; i++) {
    const a = pt(i, k), b = pt(i + 1, k), cc = pt(i + 1, k + 1), d = pt(i, k + 1);
    if (k === 0) out.push({ a, b: cc, c: d, ...p });
    else if (k === rings - 1) out.push({ a, b, c: d, ...p });
    else quad(out, p, a, b, cc, d);
  }
  orient(out, start, c);
}

/** pirâmide de base quadrada (ponta da cabeça do Batedor, caduceu). 6 triângulos. */
export function pyramid(out: Tri[], p: Paint, base: Vector3, tip: Vector3, r: number) {
  const dir = new Vector3().subVectors(tip, base).normalize();
  const [u, v] = basis(dir);
  const ring = [0, 1, 2, 3].map(i => base.clone().addScaledVector(u, Math.cos((i * Math.PI) / 2) * r).addScaledVector(v, Math.sin((i * Math.PI) / 2) * r));
  const start = out.length;
  for (let i = 0; i < 4; i++) out.push({ a: ring[i], b: ring[(i + 1) % 4], c: tip, ...p });
  fan(out, p, [...ring].reverse());
  orient(out, start, base.clone().lerp(tip, 0.25));
}
