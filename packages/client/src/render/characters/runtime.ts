// Personagens na cena: carrega os .glb de public/models (manifesto personagens.json), instancia por ator
// e toca o clipe escolhido em state.ts com o relógio da simulação amostrado a render.anim_fps (passo discreto
// no mixer, Art Bible §7). Material: Ps1Material do V1 (snap, afim, Gouraud; o skinning está no próprio material).
// V3: skin do jogador (troca de cor das secundárias no atlas + acessório pequeno no peito) e olhos do caçador que
// acendem no preparo (telegraph, Art Bible §1.5 e §4).
// D-18: o caçador leva o contorno (borda de luz por vértice do Ps1Material, render.hunter_outline) nas malhas iluminadas.
// D-45: os .glb podem ser pedidos antes da partida (`prefetchCharacters`, com o menu aberto, baixa prioridade); os bytes
// ficam em memória e o `createCharacter` os reusa (um só download por arquivo). Até o modelo chegar, ou se ele falhar, o
// contêiner mostra o modelo de reserva (render.models.fallback), cujos olhos também acendem no preparo.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { SkinDef } from "@thehell/shared";
import type { ClipName } from "../../assets/characters.ts";
import { balance } from "../../data.ts";
import { colorOverrides, FX, PALETTE, rgb5, tok } from "../../look.ts";
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
interface Telegraph { mesh: THREE.Mesh; rest: THREE.Material; hot: THREE.Material; flare: THREE.Mesh | null; on: boolean }
/** modelo de reserva (D-45): caixa na cor do personagem; olhos com telegraph só no caçador */
interface Fallback { group: THREE.Group; telegraph: Telegraph | null }

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
  /** modelo de reserva enquanto `model` é null (D-45); removido quando o .glb entra */
  fallback: Fallback | null;
}

const assets = new Map<string, Promise<Asset>>();
const instances = new WeakMap<THREE.Object3D, Instance>();
let fps = 0;
let manifestP: Promise<Manifest> | null = null;

const url = (p: string) => import.meta.env.BASE_URL + p;

/** bytes de cada .glb (chave: `arquivo` do manifesto); uma falha sai do cache para o próximo pedido tentar de novo */
const raw = new Map<string, Promise<ArrayBuffer>>();
function fetchModel(file: string, priority: "low" | "auto"): Promise<ArrayBuffer> {
  let p = raw.get(file);
  if (!p) {
    // `priority` (Fetch Priority, https://fetch.spec.whatwg.org/#request-priority): dica; navegador sem suporte ignora
    p = fetch(url(file), { priority } as RequestInit).then(r => {
      if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
      return r.arrayBuffer();
    });
    raw.set(file, p);
    p.catch(() => { if (raw.get(file) === p) raw.delete(file); });
  }
  return p;
}

/**
 * pede os .glb dos personagens `ids` em baixa prioridade (D-45: com o menu aberto, fora do download crítico); o
 * `createCharacter` seguinte reusa os bytes. Falha só avisa: o `createCharacter` pede de novo
 */
export function prefetchCharacters(ids: readonly string[]): Promise<void> {
  return loadManifest().then(man => Promise.all(ids.map(id => {
    const entry = man.personagens.find(e => e.id === id);
    return entry ? fetchModel(entry.arquivo, "low") : undefined;
  }))).then(() => undefined, e => console.warn("pré-carga dos personagens:", e));
}

/**
 * material do atlas: Ps1Material iluminado; emissivo (olhos, lanterna) chapado e sem névoa (Art Bible §3).
 * `rim`: contorno do caçador (D-18) nas malhas iluminadas
 */
function convertMaterial(m: THREE.Material, rim: boolean): THREE.Material {
  const std = m as THREE.MeshStandardMaterial;
  const map = std.map ?? undefined;
  if (map) { map.colorSpace = THREE.NoColorSpace; map.generateMipmaps = false; map.minFilter = map.magFilter = THREE.NearestFilter; map.needsUpdate = true; }
  const out = std.emissiveMap ? new Ps1Material({ lit: false, fog: false, map }) : new Ps1Material({ lit: true, map, rim });
  out.name = std.name;
  return out;
}

function loadManifest(): Promise<Manifest> {
  manifestP ??= fetch(url("models/personagens.json")).then(r => {
    if (!r.ok) throw new Error(`personagens.json: HTTP ${r.status}`);
    return r.json() as Promise<Manifest>;
  });
  // falha (rede): o próximo pedido tenta de novo
  manifestP.catch(() => { manifestP = null; });
  return manifestP;
}

function loadAsset(id: string, rim: boolean): Promise<Asset> {
  // o contorno muda o material: com e sem contorno são entradas separadas (retrato do teste de silhueta × jogo)
  const key = rim ? id + ":contorno" : id;
  let p = assets.get(key);
  if (!p) {
    p = loadManifest().then(async man => {
      fps = man.anim_fps;
      const entry = man.personagens.find(e => e.id === id);
      if (!entry) throw new Error(`personagem '${id}' fora de personagens.json`);
      const bytes = await fetchModel(entry.arquivo, "auto");
      const gltf = await new GLTFLoader().parseAsync(bytes, url(entry.arquivo).replace(/[^/]*$/, ""));
      const cache = new Map<THREE.Material, THREE.Material>();
      gltf.scene.traverse(o => {
        const mesh = o as THREE.SkinnedMesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const conv = mats.map(m => { if (!cache.has(m)) cache.set(m, convertMaterial(m, rim)); return cache.get(m)!; });
        mesh.material = Array.isArray(mesh.material) ? conv : conv[0];
        // a caixa da pose T não acompanha a animação; 6 personagens não pesam no recorte
        mesh.frustumCulled = false;
      });
      return { scene: gltf.scene, clips: gltf.animations, meta: new Map(entry.clipes.map(c => [c.nome, c])), ...(entry.acessorio ? { anchor: entry.acessorio } : {}) };
    });
    assets.set(key, p);
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

/**
 * blocos do atlas a repintar (pixels, RGB 8 bits): primeiro os tokens que o modo daltônico sobrepõe (na cor do modo),
 * depois as trocas da skin (cor de destino já com o modo). Vazio = o atlas assado serve como está. Puro (testes).
 */
export function atlasPaints(skin: Pick<SkinDef, "trocas">, size: number): { x: number; y: number; size: number; rgb: number[] }[] {
  const swaps: [string, string][] = [...colorOverrides().map(k => [k, k] as [string, string]), ...Object.entries(skin.trocas)];
  return swaps.map(([from, to]) => ({ ...atlasCell(PALETTE, size, from), rgb: rgb5(to).map(rgb5ToRgb8) }));
}

/**
 * atlas com as cores secundárias trocadas pelas da skin e os tokens sobrepostos pelo modo daltônico (V8, look.ts
 * `setColorMode`; mesmo layout do bake: atlas.ts). Cores sempre via `rgb5`, que já aplica o modo.
 */
function skinAtlas(src: THREE.Texture, skin: SkinDef): THREE.Texture {
  const size = balance.render.models.atlas;
  const k = document.createElement("canvas"); k.width = k.height = size;
  const x = k.getContext("2d")!;
  x.drawImage(src.image as CanvasImageSource, 0, 0, size, size);
  for (const p of atlasPaints(skin, size)) {
    x.fillStyle = `rgb(${p.rgb.join(",")})`;
    x.fillRect(p.x, p.y, p.size, p.size);
  }
  const t = new THREE.CanvasTexture(k);
  t.flipY = src.flipY; t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false;
  t.minFilter = t.magFilter = THREE.NearestFilter; t.wrapS = src.wrapS; t.wrapT = src.wrapT;
  return t;
}

/** veste a skin no modelo: material do atlas trocado (só nesta instância) e acessório preso ao osso do ponto `anchor` */
function applySkin(model: THREE.Object3D, skin: SkinDef, anchor: Anchor | undefined) {
  const meshes = skinnedMeshes(model);
  if (atlasPaints(skin, balance.render.models.atlas).length) {
    const cache = new Map<THREE.Texture, THREE.Material>();
    for (const mesh of meshes) {
      const m = mesh.material as Ps1Material, map = m.uniforms.tMap.value as THREE.Texture | null;
      if (!map || m.name !== "atlas") continue;
      if (!cache.has(map)) { const nm = new Ps1Material({ lit: true, map: skinAtlas(map, skin), rim: "PS1_RIM" in m.defines }); nm.name = m.name; cache.set(map, nm); }
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
  const hot = new Ps1Material({ lit: false, fog: false, color: tok(FX.eyesWindup) });
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
  if (t.flare) t.flare.visible = on;
}

/** acende (ou apaga) os olhos do caçador: chamado a cada quadro com `hunter.windup != null` */
export function setTelegraph(root: THREE.Object3D, on: boolean) {
  const inst = instances.get(root);
  if (!inst) return;
  inst.wantTelegraph = on;
  if (!inst.model) { if (inst.fallback?.telegraph) applyTelegraph(inst.fallback.telegraph, on); return; }
  if (inst.telegraph === undefined) inst.telegraph = prepareTelegraph(inst.model);
  if (inst.telegraph) applyTelegraph(inst.telegraph, on);
}

/** olhos acesos agora, no modelo ou no de reserva (para testes ponta a ponta e capturas) */
export function telegraphOn(root: THREE.Object3D): boolean {
  const inst = instances.get(root);
  if (!inst) return false;
  return (inst.model ? inst.telegraph?.on : inst.fallback?.telegraph?.on) ?? false;
}

/** o que o contêiner mostra: o modelo do .glb, o de reserva (D-45) ou nada (para testes ponta a ponta) */
export function characterForm(root: THREE.Object3D): "modelo" | "reserva" | null {
  const inst = instances.get(root);
  return inst?.model ? "modelo" : inst?.fallback ? "reserva" : null;
}

/**
 * modelo de reserva (D-45, render.models.fallback): caixa na cor da classe (`class.<id>`) ou do caçador
 * (`hunter.<id>`); o caçador tem a faixa dos olhos (hunter.olhos, hunter.olhos_preparo no preparo) na frente (−Z)
 */
function createFallback(id: string): Fallback {
  const f = balance.render.models.fallback;
  // token da paleta (não é chave de i18n): família + id do personagem
  const hunterTok = "hunter" + "." + id, classTok = "class" + "." + id;
  const hunter = hunterTok in PALETTE.tokens;
  const color = hunter ? hunterTok : classTok in PALETTE.tokens ? classTok : "ui.text";
  const [w, h, d] = hunter ? f.hunter : f.survivor;
  const group = new THREE.Group();
  group.name = "reserva:" + id;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), new Ps1Material({ lit: true, color: tok(color), rim: hunter }));
  body.castShadow = body.receiveShadow = true;
  group.add(body);
  if (!hunter) return { group, telegraph: null };
  const [ew, eh, ed] = f.eyes;
  const rest = new Ps1Material({ lit: false, fog: false, color: tok(FX.eyes) });
  const hot = new Ps1Material({ lit: false, fog: false, color: tok(FX.eyesWindup) });
  const eyes = new THREE.Mesh(new THREE.BoxGeometry(ew, eh, ed), rest);
  eyes.position.set(0, h - f.eyes_below, -d / 2 - ed / 2);
  group.add(eyes);
  return { group, telegraph: { mesh: eyes, rest, hot, flare: null, on: false } };
}

function disposeFallback(f: Fallback) {
  f.group.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  });
  // material de preparo dos olhos (fora da cena enquanto os olhos estão apagados)
  f.telegraph?.hot.dispose();
  f.telegraph?.rest.dispose();
  f.group.removeFromParent();
}

/**
 * contêiner do personagem (posição e rumo vêm da simulação); o modelo entra quando o .glb termina de carregar.
 * `o.outline`: contorno do caçador (D-18); vale para todas as instâncias do mesmo id (materiais compartilhados)
 */
export function createCharacter(id: string, skin?: SkinDef, o: { outline?: boolean } = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "personagem:" + id;
  const fallback = createFallback(id);
  root.add(fallback.group);
  const inst: Instance = { id, model: null, mixer: null, actions: new Map(), meta: new Map(), current: null, mem: null, step: -1, wantTelegraph: null, fallback };
  instances.set(root, inst);
  const p = loadAsset(id, o.outline ?? false).then(a => {
    const model = cloneSkinned(a.scene);
    // o glTF olha para +Z; na simulação o rumo 0 olha para −Z
    model.rotation.y = Math.PI;
    // modo daltônico (V8): sem skin, o atlas também é repintado se o modo sobrepõe algum token
    if (skin || colorOverrides().length) applySkin(model, skin ?? { trocas: {} } as SkinDef, a.anchor);
    disposeFallback(fallback);
    inst.fallback = null;
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
  }).catch(e => console.error(`modelo ${id} (fica o modelo de reserva):`, e));
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
