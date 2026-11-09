// MOCKUP A2b — preset industrial do Pátio (D-15, docs/plano-construcao.md §7): variante de texturas e iluminação,
// sem layout novo. Texturas procedurais de metal rebitado e concreto (PRNG com semente do cliente, render/options.ts),
// luz ambiente fria, luz assada âmbar e luminárias emissivas no topo dos muros. Só com `?retro=1`.
// Números em data/balance.yaml `render.retro.industrial`; cores só por token world.industrial.* de data/art/palette.json.
import * as THREE from "three";
import { insideWall } from "@thehell/sim";
import { balance, cfg } from "../../data.ts";
import { tok, tokCss } from "../../look.ts";
import { Ps1Material } from "../ps1.ts";

const ind = balance.render.retro.industrial;
/** valor da faixa [mín, máx] em u ∈ [0, 1) */
const lerp = (r: readonly number[], u: number) => r[0] + (r[1] - r[0]) * u;

function canvas2d(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const k = document.createElement("canvas"); k.width = k.height = ind.texture;
  return [k, k.getContext("2d")!];
}

function toTexture(k: HTMLCanvasElement, rx: number, rz: number) {
  const t = new THREE.CanvasTexture(k);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, rz);
  return t;
}

/** chapas de aço rebitadas com faixa de segurança diagonal na base (o ladrilho cobre a altura do muro) */
export function industrialWallCanvas(rand: () => number): HTMLCanvasElement {
  const w = ind.wall, n = ind.texture, [k, x] = canvas2d();
  x.fillStyle = tokCss(w.base); x.fillRect(0, 0, n, n);
  const plate = n / w.plates;
  // sujeira: salpicos escuros, mais densos em baixo, escorridos de grime_drip px de altura
  x.fillStyle = tokCss(w.seam);
  for (let i = 0; i < w.grime; i++) {
    const px = (rand() * n) | 0, py = (Math.sqrt(rand()) * n) | 0;
    x.globalAlpha = lerp(w.grime_alpha, rand()); x.fillRect(px, py, 1, Math.floor(lerp(w.grime_drip, rand())));
  }
  x.globalAlpha = 1;
  for (let i = 0; i < w.plates; i++) {
    const o = i * plate;
    // junta escura entre chapas e borda iluminada logo abaixo / à direita
    x.fillStyle = tokCss(w.seam); x.fillRect(o, 0, 1, n); x.fillRect(0, o, n, 1);
    x.fillStyle = tokCss(w.edge); x.globalAlpha = w.edge_alpha; x.fillRect(o + 1, 0, 1, n); x.fillRect(0, o + 1, n, 1); x.globalAlpha = 1;
  }
  // rebites: ponto claro com sombra embaixo, ao longo das bordas de cada chapa
  for (let py = 0; py < w.plates; py++) for (let pxi = 0; pxi < w.plates; pxi++) {
    const ox = pxi * plate, oy = py * plate;
    for (let s = w.rivet_inset; s < plate - 1; s += w.rivet_step) {
      for (const [rx, ry] of [[ox + s, oy + w.rivet_inset], [ox + s, oy + plate - w.rivet_inset - 1], [ox + w.rivet_inset, oy + s], [ox + plate - w.rivet_inset - 1, oy + s]]) {
        const [rw, rh] = w.rivet;
        x.fillStyle = tokCss(w.seam); x.fillRect(rx, ry + rh, rw, rh);
        x.fillStyle = tokCss(w.edge); x.fillRect(rx, ry, rw, rh);
      }
    }
  }
  // faixa de segurança: listras diagonais âmbar / escuro na base
  if (w.stripe > 0) {
    for (let yy = n - w.stripe; yy < n; yy++) for (let xx = 0; xx < n; xx++) {
      const on = Math.floor((xx + yy) / (w.stripe_period / 2)) % 2 === 0;
      x.fillStyle = tokCss(on ? w.stripe_color : w.seam); x.fillRect(xx, yy, 1, 1);
    }
    x.fillStyle = tokCss(w.edge); x.fillRect(0, n - w.stripe - 1, n, 1);
  }
  return k;
}

/** lajes de concreto: junta na borda do ladrilho, manchas e salpicos */
export function industrialFloorCanvas(rand: () => number): HTMLCanvasElement {
  const f = ind.floor, n = ind.texture, [k, x] = canvas2d();
  x.fillStyle = tokCss(f.base); x.fillRect(0, 0, n, n);
  x.fillStyle = tokCss(f.seam);
  for (let i = 0; i < f.stains; i++) { x.globalAlpha = lerp(f.stain_alpha, rand()); x.fillRect((rand() * n) | 0, (rand() * n) | 0, f.stain_size, f.stain_size); }
  x.fillStyle = tokCss(f.fleck);
  for (let i = 0; i < f.flecks; i++) { x.globalAlpha = lerp(f.fleck_alpha, rand()); x.fillRect((rand() * n) | 0, (rand() * n) | 0, 1, 1); }
  x.globalAlpha = 1;
  x.fillStyle = tokCss(f.seam); x.fillRect(0, 0, n, 1); x.fillRect(0, 0, 1, n);
  return k;
}

export interface Industrial {
  wall(rx: number, rz: number): THREE.CanvasTexture;
  floor(rx: number, rz: number): THREE.CanvasTexture;
  /** pontos (x, z) das luminárias, para a luz assada */
  lamps: { x: number; z: number }[];
  /** luminárias emissivas (uma InstancedMesh) */
  fixtures: THREE.InstancedMesh;
}

/**
 * luminárias ao longo das faces dos muros (posições derivadas das caixas do mapa efetivo `cfg.map`, com as pilastras
 * do v1 quando ligadas: o layout não muda)
 */
export function lampPoints(): { x: number; z: number; rotY: number; fx: number; fz: number }[] {
  const out: { x: number; z: number; rotY: number; fx: number; fz: number }[] = [];
  const [W, D] = cfg.map.size;
  for (const [wx, wz, ww, wd] of cfg.map.walls) {
    const alongX = ww >= wd, len = alongX ? ww : wd, half = (alongX ? wd : ww) / 2;
    const count = Math.max(1, Math.floor(len / ind.lamp_spacing));
    for (let i = 0; i < count; i++) {
      const u = (i + 0.5) / count - 0.5;
      for (const side of [-1, 1]) {
        const d = half + ind.lamp_offset;
        const x = alongX ? wx + u * len : wx + side * d, z = alongX ? wz + side * d : wz + u * len;
        if (Math.abs(x) > W / 2 - ind.lamp_offset || Math.abs(z) > D / 2 - ind.lamp_offset || insideWall(cfg, x, z)) continue;
        // a luminária fica colada na face (fx, fz)
        const fx = alongX ? x : wx + side * (half + ind.lamp_size[2] / 2), fz = alongX ? wz + side * (half + ind.lamp_size[2] / 2) : z;
        out.push({ x, z, rotY: alongX ? 0 : Math.PI / 2, fx, fz });
      }
    }
  }
  return out;
}

export function createIndustrial(rand: () => number): Industrial {
  const wallK = industrialWallCanvas(rand), floorK = industrialFloorCanvas(rand);
  const pts = lampPoints();
  const [sx, sy, sz] = ind.lamp_size;
  const fixtures = new THREE.InstancedMesh(new THREE.BoxGeometry(sx, sy, sz), new Ps1Material({ lit: false, fog: false, color: tok(ind.lamp_token) }), Math.max(1, pts.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  pts.forEach((l, i) => fixtures.setMatrixAt(i, m.compose(p.set(l.fx, cfg.map.wall_height - sy, l.fz), q.setFromEuler(e.set(0, l.rotY, 0)), one)));
  fixtures.count = pts.length;
  fixtures.name = "luminarias-industriais";
  return {
    wall: (rx, rz) => toTexture(wallK, rx, rz),
    floor: (rx, rz) => toTexture(floorK, rx, rz),
    lamps: pts.map(({ x, z }) => ({ x, z })),
    fixtures,
  };
}
