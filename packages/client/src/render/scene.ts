// Render: renderer, cena, câmera, mapa estático e figuras (visual da fase 0 sobre o material PS1 do V1).
// Valores de render vêm de data/balance.yaml `render` (GDD-v0.3 §10); fov da câmera de `prototype_extras.camera.fov`
// (P-02, paridade da fase 0; `ui.fov` é a faixa do futuro slider do V8).
import * as THREE from "three";
import { insideWall, type GameState } from "@thehell/sim";
import { balance, cfg, map, px } from "../data.ts";
import { WORLD_COLORS } from "../look.ts";
import { createHunterModel, createSurvivorModel } from "./characters/actors.ts";
import { clientRandom, urlPreset } from "./options.ts";
import { createPresenter, type Presenter } from "./present.ts";
import { Ps1Material } from "./ps1.ts";

/** contexto de render devolvido por `buildWorld` (substitui os `let` exportados da fase 0) */
export interface RenderCtx {
  R: THREE.WebGLRenderer;
  S: THREE.Scene;
  cam: THREE.PerspectiveCamera;
  /** luz pontual que segue o jogador */
  PL: THREE.PointLight;
  presenter: Presenter;
  /** `renderer.info` do último quadro (cena + passe final) */
  info: { calls: number; triangles: number };
}

const rc = balance.render;
/** malhas indexadas por chave: s<id>, hunter, lamp<i>, beam<i>, gate, p<id> (projétil), t<id> (armadilha) */
export const meshes = new Map<string, THREE.Object3D>();
/** semente das texturas procedurais (fluxo próprio do PRNG do cliente) */
const TEX_SALT = 1;

function tex(rand: () => number, color: string, n: number, rx: number, rz: number) {
  const k = document.createElement("canvas"); k.width = k.height = 32;
  const x = k.getContext("2d")!;
  x.fillStyle = color; x.fillRect(0, 0, 32, 32);
  for (let i = 0; i < n; i++) { x.fillStyle = `rgba(0,0,0,${rand() * 0.4})`; x.fillRect((rand() * 32) | 0, (rand() * 32) | 0, 2, 2); }
  const t = new THREE.CanvasTexture(k);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, rz);
  return t;
}
/** material iluminado (Lambert + flatShading na fase 0; agora PS1 com Gouraud) */
export const lambert = (o: { color?: THREE.ColorRepresentation; map?: THREE.Texture }) => new Ps1Material({ lit: true, ...o });
/** material chapado (MeshBasicMaterial na fase 0) */
export const basic = (c: number, fog = false) => new Ps1Material({ lit: false, color: c, fog });
export function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); return b;
}
/** subdivisões de uma dimensão para o tamanho de célula `render.tessellate` (GDD-v0.3 §10.1 item 2) */
const seg = (len: number) => Math.max(1, Math.ceil(len / rc.tessellate));
/** renderer, cena, câmera, luzes e mapa estático (chão, muros, jaula); roda antes de criar a partida */
export function buildWorld(canvas: HTMLCanvasElement): RenderCtx {
  // three.js atual com a aparência da r128: sem gerenciamento de cor e luzes sem unidades físicas
  THREE.ColorManagement.enabled = false;
  const R = new THREE.WebGLRenderer({ canvas, antialias: false });
  R.outputColorSpace = THREE.LinearSRGBColorSpace;
  R.setPixelRatio(1);
  R.info.autoReset = false;
  const presenter = createPresenter(R, canvas, urlPreset);
  const [iw, ih] = rc.presets[presenter.preset].internal;
  const S = new THREE.Scene();
  S.background = new THREE.Color(WORLD_COLORS.background);
  S.fog = new THREE.Fog(WORLD_COLORS.background, rc.fog.near, rc.fog.far);
  const cam = new THREE.PerspectiveCamera(px.camera.fov, iw / ih, rc.camera.near, rc.camera.far);
  cam.rotation.order = "YXZ";
  S.add(new THREE.AmbientLight(WORLD_COLORS.ambient, rc.lights.ambient * Math.PI));
  const PL = new THREE.PointLight(WORLD_COLORS.playerLight, rc.lights.player * Math.PI, rc.player_light_radius, rc.lights.player_decay);
  S.add(PL);
  const rand = clientRandom(TEX_SALT);
  const [w, d] = map.size;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d, seg(w), seg(d)), lambert({ map: tex(rand, WORLD_COLORS.floor, 260, 18, 18) }));
  floor.rotation.x = -Math.PI / 2; S.add(floor);
  for (const [x, z, ww, wd] of map.walls) {
    const m = lambert({ map: tex(rand, WORLD_COLORS.wall, 200, Math.max(1, ww / 3), 1) });
    const b = new THREE.Mesh(new THREE.BoxGeometry(ww, map.wall_height, wd, seg(ww), seg(map.wall_height), seg(wd)), m);
    b.position.set(x, map.wall_height / 2, z); S.add(b);
  }
  S.add(box(2.6, 2.4, 2.6, new Ps1Material({ lit: false, color: WORLD_COLORS.cage, wireframe: true }), map.cage[0], 1.2, map.cage[1]));
  return { R, S, cam, PL, presenter, info: { calls: 0, triangles: 0 } };
}

/** troca o preset de resolução interna (low/medium/high) */
export function setPreset(ctx: RenderCtx, name: Presenter["preset"]) {
  ctx.presenter.setPreset(name);
  const [iw, ih] = rc.presets[name].internal;
  ctx.cam.aspect = iw / ih; ctx.cam.updateProjectionMatrix();
}

/** geradores, portão e personagens da partida criada; `_skin` (skin equipada) volta com as skins de paleta (V3) */
export function buildActors(ctx: RenderCtx, G: GameState, _skin: string) {
  const { S } = ctx;
  G.gens.forEach((g, i) => {
    const gr = new THREE.Group();
    gr.add(box(1.5, 1, 1, lambert({ color: g.bonus ? WORLD_COLORS.bonusBody : WORLD_COLORS.genBody }), 0, 0.5, 0));
    const lamp = box(0.4, 0.3, 0.4, basic(0xff3333), 0, 1.2, 0); gr.add(lamp);
    gr.position.set(g.x, 0, g.z); S.add(gr);
    const beam = box(0.25, 14, 0.25, basic(0xff3333), g.x, 7, g.z); S.add(beam);
    meshes.set("lamp" + i, lamp); meshes.set("beam" + i, beam);
  });
  const gate = box(6, 3, 0.6, basic(WORLD_COLORS.gateClosed), map.gate[0], 1.5, map.gate[1] + 1); S.add(gate); meshes.set("gate", gate);
  // personagens do pipeline V2 (render/characters): posição e rumo vêm da simulação em sync.ts
  G.survivors.forEach(s => { const m = createSurvivorModel(s); S.add(m); meshes.set("s" + s.id, m); });
  const hm = createHunterModel(); S.add(hm); meshes.set("hunter", hm);
}

/** posiciona câmera e luz do jogador e desenha o quadro (alvo em baixa resolução → passe final) */
export function renderFrame(ctx: RenderCtx, G: GameState, view: { yaw: number; pitch: number; thirdPerson: boolean }) {
  const { cam, PL } = ctx;
  const P = G.survivors[0], { yaw, pitch, thirdPerson } = view;
  const c = px.camera;
  if (thirdPerson) {
    let d = c.distance;
    const sx = Math.cos(yaw) * c.shoulder, sz = -Math.sin(yaw) * c.shoulder;
    while (d > 0.7 && insideWall(cfg, P.x + Math.sin(yaw) * d + sx, P.z + Math.cos(yaw) * d + sz)) d -= c.wall_step;
    cam.position.set(P.x + Math.sin(yaw) * d + sx, c.height, P.z + Math.cos(yaw) * d + sz);
  } else cam.position.set(P.x, rc.camera.eye_height, P.z);
  cam.rotation.set(pitch - (thirdPerson ? 0.2 : 0), yaw, 0);
  PL.position.set(P.x, rc.lights.player_height, P.z);
  present(ctx);
}

/** desenha a cena no alvo da resolução interna e o leva à tela pelo passe final; registra `renderer.info` */
export function present(ctx: RenderCtx) {
  ctx.R.info.reset();
  ctx.presenter.present(ctx.S, ctx.cam);
  ctx.info.calls = ctx.R.info.render.calls;
  ctx.info.triangles = ctx.R.info.render.triangles;
}
