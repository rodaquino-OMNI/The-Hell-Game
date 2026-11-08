// Personagens na cena: carrega os .glb de public/models (manifesto personagens.json), instancia por ator
// e toca o clipe escolhido em state.ts com o relógio da simulação amostrado a render.anim_fps (passo discreto
// no mixer, Art Bible §7). Material: Ps1Material do V1 (snap, afim, Gouraud) com skinning acrescentado aqui.
// V3: skin do jogador (troca de cor das secundárias no atlas + acessório pequeno no peito) e olhos do caçador que
// acendem no preparo (telegraph, Art Bible §1.5 e §4).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { SkinDef } from "@thehell/shared";
import type { ClipName } from "../../assets/characters.ts";
import { balance } from "../../data.ts";
import { FX, PALETTE, tok } from "../../look.ts";
import { ps1Uniforms, Ps1Material } from "../ps1.ts";
import { minWidthScale } from "../states.ts";
import { atlasCell, rgb5ToRgb8 } from "./atlas.ts";
import { chooseClip, newMemory, type ActorView, type ClipContext, type Memory } from "./state.ts";

export interface ClipMeta { nome: ClipName; laco: boolean; duracao: number; velocidade_nativa: number }
/** ponto do acessório de skin gravado pelo bake: osso e centro na pose de ligação (metros finais) */
interface Anchor { osso: string; centro: [number, number, number] }
interface Asset { scene: THREE.Object3D; clips: THREE.AnimationClip[]; meta: Map<ClipName, ClipMeta>; anchor?: Anchor }
interface Manifest { anim_fps: number; personagens: { id: string; arquivo: string; clipes: ClipMeta[]; acessorio?: Anchor }[] }

/** olhos do caçador: material de repouso (atlas, hunter.olhos) e de preparo (hunter.olhos_preparo) e o lampejo */
interface Telegraph { mesh: THREE.Mesh; rest: THREE.Material; hot: THREE.Material; flare: THREE.Mesh; on: boolean }

interface Instance {
  id: string;
  model: THREE.Object3D | null;
  mixer: THREE.AnimationMixer | null;
  actions: Map<ClipName, THREE.AnimationAction>;
  meta: Map<ClipName, ClipMeta>;
  current: ClipName | null;
  mem: Memory | null;
  /** último passo de animação aplicado (índice em 1/anim_fps) */
  step: number;
  /** olhos acesos no preparo: preparado na primeira chamada de `setTelegraph` (null = modelo sem olhos emissivos) */
  telegraph?: Telegraph | null;
  /** último pedido de `setTelegraph` (null = nunca pedido: personagem sem telegraph) */
  wantTelegraph: boolean | null;
}

const assets = new Map<string, Promise<Asset>>();
const instances = new WeakMap<THREE.Object3D, Instance>();
let fps = 0;
let manifestP: Promise<Manifest> | null = null;

const url = (p: string) => import.meta.env.BASE_URL + p;

/** acrescenta os chunks de skinning do three.js ao vértice do Ps1Material (o V1 não deforma malha) */
function withSkinning(m: Ps1Material): Ps1Material {
  const steps: [string, string][] = [
    ["#include <common>", "#include <common>\n#include <skinning_pars_vertex>"],
    ["vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );",
      "vec3 transformed = vec3( position );\n  vec3 objectNormal = vec3( normal );\n  #include <skinbase_vertex>\n  #include <skinnormal_vertex>\n  #include <skinning_vertex>\n  vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );"],
  ];
  let vs = m.vertexShader;
  for (const [from, to] of steps) {
    if (!vs.includes(from)) throw new Error(`Ps1Material mudou: trecho '${from}' não encontrado para o skinning`);
    vs = vs.replace(from, to);
  }
  m.vertexShader = vs.replace(/normalMatrix \* normal\b/g, "normalMatrix * objectNormal");
  return m;
}

/** material do atlas: Ps1Material iluminado; emissivo (olhos, lanterna) chapado e sem névoa (Art Bible §3) */
function convertMaterial(m: THREE.Material): THREE.Material {
  const std = m as THREE.MeshStandardMaterial;
  const map = std.map ?? undefined;
  if (map) { map.colorSpace = THREE.NoColorSpace; map.generateMipmaps = false; map.minFilter = map.magFilter = THREE.NearestFilter; map.needsUpdate = true; }
  const out = withSkinning(std.emissiveMap ? new Ps1Material({ lit: false, fog: false, map }) : new Ps1Material({ lit: true, map }));
  out.name = std.name;
  return out;
}

function loadManifest(): Promise<Manifest> {
  manifestP ??= fetch(url("models/personagens.json")).then(r => {
    if (!r.ok) throw new Error(`personagens.json: HTTP ${r.status}`);
    return r.json() as Promise<Manifest>;
  });
  return manifestP;
}

function loadAsset(id: string): Promise<Asset> {
  let p = assets.get(id);
  if (!p) {
    p = loadManifest().then(async man => {
      fps = man.anim_fps;
      const entry = man.personagens.find(e => e.id === id);
      if (!entry) throw new Error(`personagem '${id}' fora de personagens.json`);
      const gltf = await new GLTFLoader().loadAsync(url(entry.arquivo));
      const cache = new Map<THREE.Material, THREE.Material>();
      gltf.scene.traverse(o => {
        const mesh = o as THREE.SkinnedMesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const conv = mats.map(m => { if (!cache.has(m)) cache.set(m, convertMaterial(m)); return cache.get(m)!; });
        mesh.material = Array.isArray(mesh.material) ? conv : conv[0];
        // a caixa da pose T não acompanha a animação; 6 personagens não pesam no recorte
        mesh.frustumCulled = false;
      });
      return { scene: gltf.scene, clips: gltf.animations, meta: new Map(entry.clipes.map(c => [c.nome, c])), ...(entry.acessorio ? { anchor: entry.acessorio } : {}) };
    });
    assets.set(id, p);
  }
  return p;
}

/** promessas de todos os personagens criados (capturas de referência esperam por elas) */
const pending: Promise<unknown>[] = [];
/** resolve quando todos os personagens criados até agora estão na cena */
export const charactersReady = () => Promise.all(pending).then(() => true);

// ---------- skins e telegraph (V3) ----------

/** malhas do modelo (cada primitiva do glTF vira uma SkinnedMesh com um material) */
function skinnedMeshes(model: THREE.Object3D): THREE.SkinnedMesh[] {
  const out: THREE.SkinnedMesh[] = [];
  model.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh); });
  return out;
}

/** matriz que leva um ponto da pose de ligação (espaço do modelo) para o espaço local do osso `name` */
function bindToBone(mesh: THREE.SkinnedMesh, name: string): { bone: THREE.Bone; m: THREE.Matrix4 } {
  const i = mesh.skeleton.bones.findIndex(b => b.name === name);
  if (i < 0) throw new Error(`osso '${name}' não está no esqueleto`);
  return { bone: mesh.skeleton.bones[i], m: new THREE.Matrix4().multiplyMatrices(mesh.skeleton.boneInverses[i], mesh.bindMatrix) };
}

/** atlas com as cores secundárias trocadas pelas da skin (mesmo layout do bake: atlas.ts) */
function skinAtlas(src: THREE.Texture, skin: SkinDef): THREE.Texture {
  const size = balance.render.models.atlas;
  const k = document.createElement("canvas"); k.width = k.height = size;
  const x = k.getContext("2d")!;
  x.drawImage(src.image as CanvasImageSource, 0, 0, size, size);
  for (const [from, to] of Object.entries(skin.trocas)) {
    const c = atlasCell(PALETTE, size, from), [r, g, b] = PALETTE.tokens[to].rgb5.map(rgb5ToRgb8);
    x.fillStyle = `rgb(${r},${g},${b})`;
    x.fillRect(c.x, c.y, c.size, c.size);
  }
  const t = new THREE.CanvasTexture(k);
  t.flipY = src.flipY; t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false;
  t.minFilter = t.magFilter = THREE.NearestFilter; t.wrapS = src.wrapS; t.wrapT = src.wrapT;
  return t;
}

/** veste a skin no modelo: material do atlas trocado (só nesta instância) e acessório preso ao osso do ponto `anchor` */
function applySkin(model: THREE.Object3D, skin: SkinDef, anchor: Anchor | undefined) {
  const meshes = skinnedMeshes(model);
  if (Object.keys(skin.trocas).length) {
    const cache = new Map<THREE.Texture, THREE.Material>();
    for (const mesh of meshes) {
      const m = mesh.material as Ps1Material, map = m.uniforms.tMap.value as THREE.Texture | null;
      if (!map || m.name !== "atlas") continue;
      if (!cache.has(map)) { const nm = withSkinning(new Ps1Material({ lit: true, map: skinAtlas(map, skin) })); nm.name = m.name; cache.set(map, nm); }
      mesh.material = cache.get(map)!;
    }
  }
  if (skin.acessorio && anchor && meshes.length) {
    const { bone, m } = bindToBone(meshes[0], anchor.osso);
    const a = skin.acessorio, rot = (a.rot ?? [0, 0, 0]).map(THREE.MathUtils.degToRad) as [number, number, number];
    const geo = new THREE.BoxGeometry(...a.tam)
      .applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)))
      .translate(...anchor.centro)
      .applyMatrix4(m);
    const acc = new THREE.Mesh(geo, new Ps1Material({ lit: true, color: tok(a.cor) }));
    acc.name = "acessorio-skin";
    acc.frustumCulled = false;
    bone.add(acc);
  }
}

/** olhos do caçador: material de preparo (cor chapada hunter.olhos_preparo) e lampejo horizontal preso ao osso da cabeça */
function prepareTelegraph(model: THREE.Object3D): Telegraph | null {
  const mesh = skinnedMeshes(model).find(m => (m.material as THREE.Material).name === "brilho");
  if (!mesh) return null;
  const hot = withSkinning(new Ps1Material({ lit: false, fog: false, color: tok(FX.eyesWindup) }));
  hot.name = "brilho-preparo";
  mesh.geometry.computeBoundingBox();
  const center = mesh.geometry.boundingBox!.getCenter(new THREE.Vector3());
  const { bone, m } = bindToBone(mesh, "Head");
  const [w, h, ahead, minPx] = balance.render.states.eyes_flare;
  const flareMat = new Ps1Material({ lit: false, fog: false, color: tok(FX.eyesWindup) });
  flareMat.uniforms.uSnap = { value: 0 };
  const flare = new THREE.Mesh(new THREE.PlaneGeometry(w, h), flareMat);
  const eyes = center.applyMatrix4(m);
  flare.position.copy(eyes);
  flare.visible = false;
  flare.frustumCulled = false;
  // sempre de frente para a câmera (o lampejo se lê de qualquer ângulo)
  // e avançado `ahead` m na direção da câmera (o braço erguido no golpe não o cobre)
  const q = new THREE.Quaternion(), p = new THREE.Vector3(), c = new THREE.Vector3();
  flare.onBeforeRender = (_r, _s, camera) => {
    const parent = flare.parent!;
    parent.getWorldQuaternion(q).invert().multiply(camera.quaternion);
    flare.quaternion.copy(q);
    p.copy(eyes).applyMatrix4(parent.matrixWorld);
    c.setFromMatrixPosition(camera.matrixWorld).sub(p).normalize().multiplyScalar(ahead).add(p);
    // altura mínima em tela: minPx pixels da resolução interna
    const dist = c.distanceTo(camera.getWorldPosition(p)), fov = (camera as THREE.PerspectiveCamera).fov ?? 60;
    flare.position.copy(parent.worldToLocal(c));
    flare.scale.setScalar(minWidthScale(dist, fov, ps1Uniforms.uRes.value.y, h, minPx));
    flare.updateMatrixWorld();
  };
  bone.add(flare);
  return { mesh, rest: mesh.material as THREE.Material, hot, flare, on: false };
}

function applyTelegraph(t: Telegraph, on: boolean) {
  if (t.on === on) return;
  t.on = on;
  t.mesh.material = on ? t.hot : t.rest;
  t.flare.visible = on;
}

/** acende (ou apaga) os olhos do caçador: chamado a cada quadro com `hunter.windup != null` */
export function setTelegraph(root: THREE.Object3D, on: boolean) {
  const inst = instances.get(root);
  if (!inst) return;
  inst.wantTelegraph = on;
  if (inst.model && inst.telegraph === undefined) inst.telegraph = prepareTelegraph(inst.model);
  if (inst.telegraph) applyTelegraph(inst.telegraph, on);
}

/** olhos acesos agora (para testes ponta a ponta e capturas) */
export const telegraphOn = (root: THREE.Object3D) => instances.get(root)?.telegraph?.on ?? false;

/** contêiner do personagem (posição e rumo vêm da simulação); o modelo entra quando o .glb termina de carregar */
export function createCharacter(id: string, skin?: SkinDef): THREE.Group {
  const root = new THREE.Group();
  root.name = "personagem:" + id;
  const inst: Instance = { id, model: null, mixer: null, actions: new Map(), meta: new Map(), current: null, mem: null, step: -1, wantTelegraph: null };
  instances.set(root, inst);
  const p = loadAsset(id).then(a => {
    const model = cloneSkinned(a.scene);
    // o glTF olha para +Z; na simulação o rumo 0 olha para −Z
    model.rotation.y = Math.PI;
    if (skin) applySkin(model, skin, a.anchor);
    root.add(model);
    inst.model = model;
    if (inst.wantTelegraph !== null) setTelegraph(root, inst.wantTelegraph);
    inst.mixer = new THREE.AnimationMixer(model);
    inst.meta = a.meta;
    for (const clip of a.clips) {
      const act = inst.mixer.clipAction(clip);
      const meta = a.meta.get(clip.name as ClipName);
      if (meta && !meta.laco) { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; }
      inst.actions.set(clip.name as ClipName, act);
    }
  }).catch(e => console.error(`modelo ${id}:`, e));
  pending.push(p);
  return root;
}

/** escolhe e toca o clipe do ator para o instante `ctx.t` (tempo da simulação) */
export function animateCharacter(root: THREE.Object3D, view: ActorView, ctx: Omit<ClipContext, "strikeDuration">): ClipName | null {
  const inst = instances.get(root);
  if (!inst?.mixer) return null;
  inst.mem ??= newMemory(view.x, view.z, ctx.t);
  const choice = chooseClip(view, inst.mem, { ...ctx, strikeDuration: inst.meta.get("golpe")?.duracao ?? 0 });
  const act = inst.actions.get(choice.clip);
  if (!act) return inst.current;
  if (choice.clip !== inst.current) {
    if (inst.current) inst.actions.get(inst.current)?.stop();
    act.reset().play();
    inst.current = choice.clip;
  }
  // locomoção na velocidade da simulação: o pé não escorrega (velocidade nativa medida no root motion do pacote)
  const native = inst.meta.get(choice.clip)?.velocidade_nativa ?? 0;
  act.timeScale = native > 0 && choice.speed > 0 ? choice.speed / native : 1;
  // passo discreto: o mixer só avança em múltiplos de 1/anim_fps do relógio da simulação
  const step = Math.floor(ctx.t * fps);
  if (inst.step < 0 || step < inst.step) { inst.mixer.setTime(step / fps); inst.step = step; }
  else if (step > inst.step) { inst.mixer.update((step - inst.step) / fps); inst.step = step; }
  return inst.current;
}

/** clipe atual de um contêiner (para testes ponta a ponta) */
export const currentClip = (root: THREE.Object3D) => instances.get(root)?.current ?? null;
