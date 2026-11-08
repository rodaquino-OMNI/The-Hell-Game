// Bake de personagem: esqueleto e animações do pacote de origem (Quaternius UAL1) + peças procedurais da ficha
// (src/assets/characters.ts) → um .glb por personagem, com skin rígido, atlas 64×64 de tokens da paleta,
// e os 9 clipes amostrados a render.anim_fps com interpolação STEP (passo do PS1, Art Bible §7).
// Puro (sem Node nem DOM): a E/S fica em tools/assets/build-characters.ts.
import { Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { CLIP_NAMES, type CharacterSpec, type ClipName, type Piece, type V3 } from "../../assets/characters.ts";
import { atlasLayout, type Palette } from "./atlas.ts";
import { box, ellipsoid, prism, pyramid, type Paint, type Tri } from "./geometry.ts";

export { atlasLayout, atlasPixels, rgb5ToRgb8, type Palette } from "./atlas.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- JSON do glTF de origem é dado externo */
export interface SourceGlb { json: any; bin: Uint8Array }

export interface BakeInput {
  spec: CharacterSpec;
  source: SourceGlb;
  palette: Palette;
  /** render.anim_fps (data/balance.yaml §14) */
  animFps: number;
  /** render.models.atlas (lado do atlas em px) */
  atlasSize: number;
  /** PNG do atlas, gerado de `atlasPixels` pela ferramenta */
  atlasPng: Uint8Array;
  /** velocidade de deslocamento (m/s) de cada clipe de origem, medida na versão com root motion do pacote */
  nativeSpeed: Record<string, number>;
}

export interface BakedClip { nome: ClipName; fonte: string; derivado: boolean; velocidade: number; laco: boolean; duracao: number; velocidade_nativa: number; nota: string }

/** ponto do acessório de skin: osso e centro em espaço do modelo na pose de ligação (metros finais) */
export interface AccessoryAnchor { osso: string; centro: [number, number, number] }

export interface BakeOutput { glb: Uint8Array; triangles: number; joints: number; clips: BakedClip[]; scale: number; acessorio?: AccessoryAnchor }

const FINGER = /^(index|middle|ring|pinky|thumb)_/;
const FINGER_BASE = /^(index|middle|ring|pinky|thumb)_01_/;
const ARM = /^(lowerarm|hand)_[lr]$/;

// ---------- leitura do glb de origem ----------

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readFloats(src: SourceGlb, index: number): Float32Array {
  const a = src.json.accessors[index], bv = src.json.bufferViews[a.bufferView];
  if (a.componentType !== 5126) throw new Error(`acessor ${index}: esperava float`);
  const n = COMPONENTS[a.type], stride = bv.byteStride ?? n * 4;
  const out = new Float32Array(a.count * n), dv = new DataView(src.bin.buffer, src.bin.byteOffset);
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = dv.getFloat32(base + i * stride + k * 4, true);
  return out;
}

interface Track { times: Float32Array; values: Float32Array; size: number }

function sample(t: Track, time: number, out: number[], slerp: boolean) {
  const { times, values, size } = t, n = times.length;
  let i = 0;
  while (i < n - 1 && times[i + 1] <= time) i++;
  if (i >= n - 1 || time <= times[0]) { const k = time <= times[0] ? 0 : n - 1; for (let c = 0; c < size; c++) out[c] = values[k * size + c]; return; }
  const f = (time - times[i]) / (times[i + 1] - times[i]);
  if (slerp) {
    const a = new Quaternion().fromArray(values, i * 4), b = new Quaternion().fromArray(values, (i + 1) * 4);
    a.slerp(b, f).normalize();
    out[0] = a.x; out[1] = a.y; out[2] = a.z; out[3] = a.w;
  } else for (let c = 0; c < size; c++) out[c] = values[i * size + c] * (1 - f) + values[(i + 1) * size + c] * f;
}

// ---------- escrita do glb ----------

class BinWriter {
  chunks: Uint8Array[] = []; length = 0;
  bufferViews: any[] = []; accessors: any[] = [];
  add(bytes: Uint8Array, target?: number): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.chunks.push(new Uint8Array(pad)); this.length += pad; }
    this.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    this.chunks.push(bytes); this.length += bytes.byteLength;
    return this.bufferViews.length - 1;
  }
  accessor(data: Float32Array | Uint16Array | Uint8Array, type: string, opts: { target?: number; minmax?: boolean; normalized?: boolean } = {}): number {
    const componentType = data instanceof Float32Array ? 5126 : data instanceof Uint16Array ? 5123 : 5121;
    const n = COMPONENTS[type];
    const view = this.add(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), opts.target);
    const acc: any = { bufferView: view, componentType, count: data.length / n, type };
    if (opts.minmax) {
      const min = Array(n).fill(Infinity), max = Array(n).fill(-Infinity);
      for (let i = 0; i < data.length; i++) { const k = i % n; min[k] = Math.min(min[k], data[i]); max[k] = Math.max(max[k], data[i]); }
      acc.min = min; acc.max = max;
    }
    this.accessors.push(acc);
    return this.accessors.length - 1;
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length + ((4 - (this.length % 4)) % 4));
    let o = 0; for (const c of this.chunks) { out.set(c, o); o += c.byteLength; }
    return out;
  }
}

function glb(json: object, bin: Uint8Array): Uint8Array {
  let text = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (text.byteLength % 4)) % 4;
  if (jpad) { const t = new Uint8Array(text.byteLength + jpad).fill(0x20); t.set(text); text = t; }
  const total = 12 + 8 + text.byteLength + 8 + bin.byteLength;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, text.byteLength, true); dv.setUint32(16, 0x4e4f534a, true); out.set(text, 20);
  const b = 20 + text.byteLength;
  dv.setUint32(b, bin.byteLength, true); dv.setUint32(b + 4, 0x004e4942, true); out.set(bin, b + 8);
  return out;
}

// ---------- bake ----------

export function bakeCharacter(input: BakeInput): BakeOutput {
  const { spec, source: src, palette, animFps } = input;
  const J = src.json;
  const byName = new Map<string, number>(J.nodes.map((n: any, i: number) => [n.name, i]));
  const rootIdx = byName.get("root");
  if (rootIdx == null) throw new Error("glb de origem sem osso 'root'");

  // altura de origem: maior Y do manequim (malha que acompanha o pacote)
  const meshPos = J.meshes[0].primitives.map((p: any) => J.accessors[p.attributes.POSITION].max[1]);
  const srcHeight = Math.max(...meshPos);
  const s = spec.altura / srcHeight;

  // ossos mantidos (subárvore de root, sem dedos para quem não os modela), em ordem de profundidade
  const kept: number[] = [];
  const parentOf = new Map<number, number>();
  const walk = (i: number) => {
    if (!spec.manterDedos && FINGER.test(J.nodes[i].name)) return;
    kept.push(i);
    for (const c of J.nodes[i].children ?? []) { parentOf.set(c, i); walk(c); }
  };
  walk(rootIdx);
  const keptSet = new Set(kept);
  const jointOf = new Map<string, number>(kept.map((n, k) => [J.nodes[n].name as string, k]));

  /** fator de comprimento de cada osso (aplicado à translação local, no repouso e nas chaves) */
  const lengthFactor = (name: string) => {
    let f = s;
    if (ARM.test(name)) f *= spec.bracos ?? 1;
    if (FINGER.test(name) && !FINGER_BASE.test(name)) f *= spec.dedos ?? 1;
    return f;
  };

  // pose de repouso (ligação) escalada
  const objs = new Map<number, Object3D>();
  for (const i of kept) {
    const n = J.nodes[i], o = new Object3D();
    if (n.translation) o.position.fromArray(n.translation).multiplyScalar(lengthFactor(n.name));
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    objs.set(i, o);
    const p = parentOf.get(i);
    if (p != null && objs.has(p)) objs.get(p)!.add(o);
  }
  const root3 = objs.get(rootIdx)!;
  root3.updateMatrixWorld(true);
  const world = (name: string) => {
    const i = byName.get(name);
    if (i == null || !keptSet.has(i)) throw new Error(`${spec.id}: osso '${name}' inexistente ou descartado`);
    return new Vector3().setFromMatrixPosition(objs.get(i)!.matrixWorld);
  };

  // ---------- peças ----------
  const tris: Tri[] = [];
  const v3 = (a: V3) => new Vector3(a[0], a[1], a[2]).multiplyScalar(s);
  const r2 = (r: [number, number]): [number, number] => [r[0] * s, r[1] * s];
  for (const pc of spec.pecas as Piece[]) {
    if (!palette.tokens[pc.cor]) throw new Error(`${spec.id}: cor '${pc.cor}' não é token de data/art/palette.json`);
    const joint = "osso" in pc && pc.osso ? pc.osso : (pc as { de: string }).de;
    world(joint);
    const paint: Paint = { token: pc.cor, joint, glow: "brilho" in pc && !!pc.brilho };
    switch (pc.forma) {
      case "seg": {
        const a = world(pc.de).add(v3(pc.deDesloc ?? [0, 0, 0])), b = world(pc.ate).add(v3(pc.ateDesloc ?? [0, 0, 0]));
        prism(tris, paint, a, b, r2(pc.r[0]), r2(pc.r[1]), pc.lados, pc.giro);
        break;
      }
      case "caixa": box(tris, paint, world(pc.em ?? pc.osso).add(v3(pc.desloc)), pc.tam.map(x => x * s) as V3, pc.rot); break;
      case "elipse": ellipsoid(tris, paint, world(pc.em ?? pc.osso).add(v3(pc.desloc)), pc.r.map(x => x * s) as V3, pc.lados, pc.aneis); break;
      case "cilindro": {
        const o = world(pc.em ?? pc.osso);
        const rr = typeof pc.r[0] === "number" ? [pc.r as [number, number], pc.r as [number, number]] : (pc.r as [[number, number], [number, number]]);
        prism(tris, paint, o.clone().add(v3(pc.de)), o.clone().add(v3(pc.ate)), r2(rr[0]), r2(rr[1]), pc.lados, pc.giro);
        break;
      }
      case "piramide": { const o = world(pc.em ?? pc.osso); pyramid(tris, paint, o.clone().add(v3(pc.base)), o.clone().add(v3(pc.ponta)), pc.r * s); break; }
    }
  }

  // ponto do acessório de skin (V3): o cliente prende ali a caixa da skin equipada (manifesto personagens.json)
  let acessorio: AccessoryAnchor | undefined;
  if (spec.acessorio) {
    const c = world(spec.acessorio.osso).add(v3(spec.acessorio.desloc));
    acessorio = { osso: spec.acessorio.osso, centro: [+c.x.toFixed(4), +c.y.toFixed(4), +c.z.toFixed(4)] };
  }

  const bw = new BinWriter();
  const { uv } = atlasLayout(palette, input.atlasSize);
  const primitives: any[] = [];
  const e1 = new Vector3(), e2 = new Vector3(), nrm = new Vector3();
  for (const glow of [false, true]) {
    const list = tris.filter(t => t.glow === glow);
    if (!list.length) continue;
    const n = list.length * 3;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), tex = new Float32Array(n * 2);
    const jnt = new Uint8Array(n * 4), wgt = new Float32Array(n * 4), idx = new Uint16Array(n);
    list.forEach((t, k) => {
      nrm.crossVectors(e1.subVectors(t.b, t.a), e2.subVectors(t.c, t.a)).normalize();
      const [u, v] = uv.get(t.token)!, j = jointOf.get(t.joint)!;
      [t.a, t.b, t.c].forEach((p, c) => {
        const i = k * 3 + c;
        pos.set([p.x, p.y, p.z], i * 3); nor.set([nrm.x, nrm.y, nrm.z], i * 3); tex.set([u, v], i * 2);
        jnt[i * 4] = j; wgt[i * 4] = 1; idx[i] = i;
      });
    });
    primitives.push({
      attributes: {
        POSITION: bw.accessor(pos, "VEC3", { target: 34962, minmax: true }),
        NORMAL: bw.accessor(nor, "VEC3", { target: 34962 }),
        TEXCOORD_0: bw.accessor(tex, "VEC2", { target: 34962 }),
        JOINTS_0: bw.accessor(jnt, "VEC4", { target: 34962 }),
        WEIGHTS_0: bw.accessor(wgt, "VEC4", { target: 34962 }),
      },
      indices: bw.accessor(idx, "SCALAR", { target: 34963 }),
      material: glow ? 1 : 0,
      mode: 4,
    });
  }

  // nós: 0 = malha (raiz), 1.. = ossos
  const nodeOf = new Map<number, number>(kept.map((i, k) => [i, k + 1]));
  const nodes: any[] = [{ name: spec.id, mesh: 0, skin: 0 }];
  for (const i of kept) {
    const n = J.nodes[i], o = objs.get(i)!;
    const node: any = { name: n.name };
    if (n.translation) node.translation = o.position.toArray();
    if (n.rotation) node.rotation = o.quaternion.toArray();
    if (n.scale) node.scale = o.scale.toArray();
    const ch = (n.children ?? []).filter((c: number) => keptSet.has(c)).map((c: number) => nodeOf.get(c));
    if (ch.length) node.children = ch;
    nodes.push(node);
  }
  const ibm = new Float32Array(kept.length * 16);
  kept.forEach((i, k) => ibm.set(new Matrix4().copy(objs.get(i)!.matrixWorld).invert().elements, k * 16));

  // ---------- animações ----------
  const srcAnim = new Map<string, any>(J.animations.map((a: any) => [a.name, a]));
  const animations: any[] = [];
  const clips: BakedClip[] = [];
  const restOf = (i: number, path: string) => J.nodes[i][path] ?? (path === "scale" ? [1, 1, 1] : path === "rotation" ? [0, 0, 0, 1] : [0, 0, 0]);
  for (const name of CLIP_NAMES) {
    const rc = spec.clipes[name];
    const a = srcAnim.get(rc.fonte);
    if (!a) throw new Error(`${spec.id}/${name}: clipe de origem '${rc.fonte}' não existe no pacote`);
    const speed = rc.velocidade ?? 1;
    const tracks = a.channels.filter((c: any) => keptSet.has(c.target.node)).map((c: any) => {
      const smp = a.samplers[c.sampler];
      return { node: c.target.node as number, path: c.target.path as string, track: { times: readFloats(src, smp.input), values: readFloats(src, smp.output), size: c.target.path === "rotation" ? 4 : 3 } };
    });
    const srcDur = Math.max(...tracks.map((t: any) => t.track.times[t.track.times.length - 1]));
    const steps = Math.max(1, Math.round((srcDur / speed) * animFps));
    const times = new Float32Array(steps + 1).map((_, k) => k / animFps);
    const timeAcc = bw.accessor(times, "SCALAR", { minmax: true });
    const samplers: any[] = [], channels: any[] = [];
    const bend = new Map<string, Quaternion>();
    for (const b of rc.curvar ?? []) {
      if (!jointOf.has(b.osso)) world(b.osso);
      const [x, y, z] = b.graus.map(d => (d * Math.PI) / 180);
      bend.set(b.osso, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), x)
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), y))
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), z)));
    }
    for (const { node, path, track } of tracks) {
      const nm = J.nodes[node].name as string;
      if (path !== "rotation") {
        // translação e escala constantes (iguais ao repouso) saem: o repouso escalado já as representa
        const rest = restOf(node, path);
        let constant = true;
        for (let i = 0; i < track.values.length && constant; i++) if (Math.abs(track.values[i] - rest[i % 3]) > 1e-4) constant = false;
        if (constant) continue;
      }
      const out = new Float32Array(times.length * track.size), tmp: number[] = [];
      const q = new Quaternion();
      times.forEach((t, k) => {
        sample(track, Math.min(t * speed, srcDur), tmp, path === "rotation");
        if (path === "rotation") {
          q.fromArray(tmp);
          const b = bend.get(nm);
          if (b) q.multiply(b);
          q.normalize();
          out.set([q.x, q.y, q.z, q.w], k * 4);
        } else {
          const f = path === "translation" ? lengthFactor(nm) : 1;
          out.set(tmp.slice(0, 3).map(v => v * f), k * 3);
        }
      });
      samplers.push({ input: timeAcc, output: bw.accessor(out, path === "rotation" ? "VEC4" : "VEC3"), interpolation: "STEP" });
      channels.push({ sampler: samplers.length - 1, target: { node: nodeOf.get(node), path } });
    }
    const derived = speed !== 1 || !!rc.curvar?.length;
    const clip: BakedClip = {
      nome: name, fonte: rc.fonte, derivado: derived, velocidade: speed, laco: rc.laco, duracao: steps / animFps,
      velocidade_nativa: +((input.nativeSpeed[rc.fonte] ?? 0) * speed * s).toFixed(3), nota: rc.nota,
    };
    clips.push(clip);
    animations.push({ name, channels, samplers, extras: { fonte: rc.fonte, derivado: derived, velocidade: speed, laco: rc.laco, velocidade_nativa: clip.velocidade_nativa } });
  }

  const ibmAcc = bw.accessor(ibm, "MAT4");
  const image = bw.add(input.atlasPng);
  const json = {
    asset: { version: "2.0", generator: "THE HELL tools/assets/build-characters.ts", copyright: "base: Quaternius (CC0 1.0); peças: THE HELL" },
    scene: 0,
    scenes: [{ name: spec.id, nodes: [0, nodeOf.get(rootIdx)] }],
    nodes,
    meshes: [{ name: spec.id, primitives }],
    skins: [{ name: spec.id, joints: kept.map(i => nodeOf.get(i)), inverseBindMatrices: ibmAcc, skeleton: nodeOf.get(rootIdx) }],
    materials: [
      { name: "atlas", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } },
      { name: "brilho", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 }, emissiveTexture: { index: 0 }, emissiveFactor: [1, 1, 1] },
    ],
    // filtro nearest, sem mipmap (Art Bible §7)
    samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: image, mimeType: "image/png", name: "atlas" }],
    textures: [{ sampler: 0, source: 0 }],
    animations,
    accessors: bw.accessors,
    bufferViews: bw.bufferViews,
    buffers: [{ byteLength: 0 }],
    extras: { thehell: { id: spec.id, tipo: spec.tipo, altura: spec.altura, anim_fps: animFps, ...(spec.variante ? { variante: spec.variante } : {}) } },
  };
  if (!primitives.some(p => p.material === 1)) json.materials.pop();
  const bin = bw.bytes();
  json.buffers[0].byteLength = bin.byteLength;
  return { glb: glb(json, bin), triangles: tris.length, joints: kept.length, clips, scale: s, ...(acessorio ? { acessorio } : {}) };
}
