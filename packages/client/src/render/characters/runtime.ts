// Personagens na cena: carrega os .glb de public/models (manifesto personagens.json), instancia por ator
// e toca o clipe escolhido em state.ts com o relógio da simulação amostrado a render.anim_fps (passo discreto
// no mixer, Art Bible §7). Material: Ps1Material do V1 (snap, afim, Gouraud) com skinning acrescentado aqui.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ClipName } from "../../assets/characters.ts";
import { Ps1Material } from "../ps1.ts";
import { chooseClip, newMemory, type ActorView, type ClipContext, type Memory } from "./state.ts";

export interface ClipMeta { nome: ClipName; laco: boolean; duracao: number; velocidade_nativa: number }
interface Asset { scene: THREE.Object3D; clips: THREE.AnimationClip[]; meta: Map<ClipName, ClipMeta> }
interface Manifest { anim_fps: number; personagens: { id: string; arquivo: string; clipes: ClipMeta[] }[] }

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
      return { scene: gltf.scene, clips: gltf.animations, meta: new Map(entry.clipes.map(c => [c.nome, c])) };
    });
    assets.set(id, p);
  }
  return p;
}

/** promessas de todos os personagens criados (capturas de referência esperam por elas) */
const pending: Promise<unknown>[] = [];
/** resolve quando todos os personagens criados até agora estão na cena */
export const charactersReady = () => Promise.all(pending).then(() => true);

/** contêiner do personagem (posição e rumo vêm da simulação); o modelo entra quando o .glb termina de carregar */
export function createCharacter(id: string): THREE.Group {
  const root = new THREE.Group();
  root.name = "personagem:" + id;
  const inst: Instance = { id, model: null, mixer: null, actions: new Map(), meta: new Map(), current: null, mem: null, step: -1 };
  instances.set(root, inst);
  const p = loadAsset(id).then(a => {
    const model = cloneSkinned(a.scene);
    // o glTF olha para +Z; na simulação o rumo 0 olha para −Z
    model.rotation.y = Math.PI;
    root.add(model);
    inst.model = model;
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
