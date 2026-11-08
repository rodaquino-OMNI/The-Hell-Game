// MOCKUP A2b — ferramenta da classe na mão em 1ª pessoa (D-13, docs/plano-construcao.md §7). As peças vêm da ficha
// de personagem (data/art/personagens.json, as mesmas do .glb: cajado, chave, espada, escudo, cachecol), montadas com
// as primitivas low-poly do bake (characters/geometry.ts), coloridas pelo atlas da paleta e desenhadas com o material
// PS1 numa cena própria por cima do mundo (sem atravessar paredes), na mesma resolução interna e no mesmo passe final.
// Posição, giro, escala e balanço em data/balance.yaml `render.retro`. Só com `?retro=1`.
import * as THREE from "three";
import type { Sheet, SheetCharacter, SheetPiece } from "@thehell/shared";
import sheetJson from "@thehell/shared/generated/personagens.json";
import { balance } from "../../data.ts";
import { PALETTE, tok } from "../../look.ts";
import { atlasLayout, atlasPixels } from "../characters/atlas.ts";
import { box, ellipsoid, prism, pyramid, type Tri } from "../characters/geometry.ts";
import { Ps1Material } from "../ps1.ts";
import type { RetroClass } from "../options.ts";

const rt = balance.render.retro;
const vm = rt.viewmodel;
const SHEET = sheetJson as unknown as Sheet;
type V3 = [number, number, number];

/** triângulos das peças da ficha presas a `osso` (e com as `cores`, se dadas), em coordenadas da ficha */
export function pieceTris(ch: SheetCharacter, osso: string, cores?: readonly string[]): Tri[] {
  const out: Tri[] = [];
  const v = (a: readonly number[]) => new THREE.Vector3(a[0], a[1], a[2]);
  for (const pc of ch.pecas as SheetPiece[]) {
    if (pc.forma === "seg" || pc.osso !== osso || (cores && !cores.includes(pc.cor))) continue;
    const paint = { token: pc.cor, joint: osso, glow: "brilho" in pc && !!pc.brilho };
    switch (pc.forma) {
      case "caixa": box(out, paint, v(pc.desloc), pc.tam as V3, pc.rot as V3 | undefined); break;
      case "elipse": ellipsoid(out, paint, v(pc.desloc), pc.r as V3, pc.lados, pc.aneis); break;
      case "cilindro": {
        const rr = typeof pc.r[0] === "number" ? [pc.r as [number, number], pc.r as [number, number]] : (pc.r as [[number, number], [number, number]]);
        prism(out, paint, v(pc.de), v(pc.ate), rr[0], rr[1], pc.lados, pc.giro);
        break;
      }
      case "piramide": pyramid(out, paint, v(pc.base), v(pc.ponta), pc.r); break;
    }
  }
  return out;
}

const deg = (r: readonly number[]) => new THREE.Euler(...(r.map(d => (d * Math.PI) / 180) as V3));

/** geometria com normal de face e UV no bloco do token no atlas (linha 0 do DataTexture = v 0, como no PNG do glTF) */
function toGeometry(tris: Tri[], m: THREE.Matrix4): THREE.BufferGeometry {
  const { uv } = atlasLayout(PALETTE, balance.render.models.atlas);
  const pos: number[] = [], nor: number[] = [], uvs: number[] = [];
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (const t of tris) {
    const a = t.a.clone().applyMatrix4(m), b = t.b.clone().applyMatrix4(m), c = t.c.clone().applyMatrix4(m);
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
    const [u, vv] = uv.get(t.token)!;
    for (const p of [a, b, c]) { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uvs.push(u, vv); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

export interface Viewmodel {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** triângulos da ferramenta e das mãos */
  triangles: number;
  /** ferramenta à vista (1ª pessoa, jogador de pé) no último `update` */
  readonly visible: boolean;
  /** balanço a partir do deslocamento do jogador no relógio da simulação */
  update(x: number, z: number, t: number, visible: boolean): void;
  setAspect(aspect: number): void;
}

/** monta a ferramenta (peças da ficha) e as mãos de `cls` numa cena própria com câmera e luzes */
export function createViewmodel(cls: RetroClass, aspect: number): Viewmodel {
  const ch = SHEET.personagens.find(p => p.id === cls);
  if (!ch) throw new Error(`classe '${cls}' fora de data/art/personagens.json`);
  const spec = vm.classes[cls];
  if (!spec) throw new Error(`classe '${cls}' sem render.retro.viewmodel`);
  const lit: Tri[] = [], glow: Tri[] = [];
  const geos: THREE.BufferGeometry[] = [], glowGeos: THREE.BufferGeometry[] = [];
  const mtx = (pos: readonly number[], rot: readonly number[], s: number, origin: readonly number[] = [0, 0, 0]) =>
    new THREE.Matrix4().compose(new THREE.Vector3(...(pos as V3)), new THREE.Quaternion().setFromEuler(deg(rot)), new THREE.Vector3(s, s, s))
      .multiply(new THREE.Matrix4().makeTranslation(-origin[0], -origin[1], -origin[2]));
  for (const g of spec.grupos) {
    const tris = pieceTris(ch, g.osso, g.cores);
    if (!tris.length) throw new Error(`${cls}: nenhuma peça da ficha no osso '${g.osso}'`);
    const m = mtx(g.pos, g.rot, g.escala, g.origem);
    const a = tris.filter(t => !t.glow), b = tris.filter(t => t.glow);
    if (a.length) geos.push(toGeometry(a, m));
    if (b.length) glowGeos.push(toGeometry(b, m));
    lit.push(...a); glow.push(...b);
  }
  // mãos: caixa de pele e antebraço na cor dos braços da ficha (o corpo do personagem não aparece em 1ª pessoa)
  const [hx, hy, hz] = vm.hand.size, [r0, r1] = vm.hand.forearm;
  for (const h of spec.maos) {
    const tris: Tri[] = [];
    box(tris, { token: ch.corpo.pele, joint: "hand", glow: false }, new THREE.Vector3(), [hx, hy, hz]);
    const local = new THREE.Vector3(...(h.antebraco as V3)).applyQuaternion(new THREE.Quaternion().setFromEuler(deg(h.rot)).invert());
    prism(tris, { token: ch.corpo.bracos, joint: "arm", glow: false }, new THREE.Vector3(0, 0, hz / 2), local, [r0, r0], [r1, r1], vm.hand.forearm_sides);
    geos.push(toGeometry(tris, mtx(h.pos, h.rot, 1)));
    lit.push(...tris);
  }
  const size = balance.render.models.atlas;
  const atlas = new THREE.DataTexture(atlasPixels(PALETTE, size), size, size, THREE.RGBAFormat);
  atlas.magFilter = atlas.minFilter = THREE.NearestFilter; atlas.generateMipmaps = false; atlas.colorSpace = THREE.NoColorSpace;
  atlas.needsUpdate = true;
  const merge = (list: THREE.BufferGeometry[]) => {
    const g = new THREE.BufferGeometry();
    for (const name of ["position", "normal", "uv"] as const) {
      const parts = list.map(x => x.getAttribute(name).array as Float32Array);
      const arr = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
      let o = 0; for (const p of parts) { arr.set(p, o); o += p.length; }
      g.setAttribute(name, new THREE.BufferAttribute(arr, name === "uv" ? 2 : 3));
    }
    return g;
  };
  const group = new THREE.Group();
  group.name = "ferramenta-" + cls;
  // sem névoa: a ferramenta está a menos de 1 m do olho
  if (geos.length) group.add(new THREE.Mesh(merge(geos), new Ps1Material({ lit: true, fog: false, map: atlas })));
  if (glowGeos.length) group.add(new THREE.Mesh(merge(glowGeos), new Ps1Material({ lit: false, fog: false, map: atlas })));
  for (const o of group.children) o.frustumCulled = false;
  const scene = new THREE.Scene();
  const l = vm.light;
  scene.add(new THREE.AmbientLight(tok(l.ambient), l.ambient_intensity * Math.PI));
  const key = new THREE.PointLight(tok(l.key), l.key_intensity * Math.PI, 0, 0);
  key.position.set(...(l.key_pos as V3));
  scene.add(key, group);
  const camera = new THREE.PerspectiveCamera(vm.fov, aspect, balance.render.camera.near, vm.far);

  // balanço: fase pela distância andada; amplitude pela velocidade (corrida = 1) × render.retro.bob
  let lx = NaN, lz = NaN, lt = NaN, phase = 0, amp = 0;
  return {
    scene, camera, triangles: lit.length + glow.length,
    get visible() { return group.visible; },
    setAspect(a) { camera.aspect = a; camera.updateProjectionMatrix(); },
    update(x, z, t, visible) {
      group.visible = visible;
      const dt = t - lt, d = Math.hypot(x - lx, z - lz);
      if (dt > 0 && Number.isFinite(d)) {
        phase += (d / rt.bob_stride) * Math.PI * 2;
        const target = Math.min(1, d / dt / balance.survivor.run);
        amp += (target - amp) * rt.bob_return;
      } else if (!(dt >= 0)) amp = 0;
      lx = x; lz = z; lt = t;
      const k = rt.bob * amp;
      group.position.set(Math.sin(phase) * rt.bob_amplitude[0] * k, -Math.abs(Math.cos(phase)) * rt.bob_amplitude[1] * k, 0);
    },
  };
}
