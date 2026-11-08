// Render: renderer, cena, câmera, mapa estático e figuras (visual da fase 0, paridade com o protótipo).
import * as THREE from "three";
import { insideWall, type GameState } from "@thehell/sim";
import { cfg, map, px } from "../data.ts";
import { CLASS_COLORS, HUNTER_COLORS, SKIN_COLORS, WORLD_COLORS } from "../look.ts";

export let R: THREE.WebGLRenderer, S: THREE.Scene, cam: THREE.PerspectiveCamera, PL: THREE.PointLight;
/** malhas indexadas por chave: s<id>, hunter, lamp<i>, beam<i>, gate, p<id> (projétil), t<id> (armadilha) */
export const meshes = new Map<string, THREE.Object3D>();

function tex(color: string, n: number, rx: number, rz: number) {
  const k = document.createElement("canvas"); k.width = k.height = 32;
  const x = k.getContext("2d")!;
  x.fillStyle = color; x.fillRect(0, 0, 32, 32);
  for (let i = 0; i < n; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.4})`; x.fillRect((Math.random() * 32) | 0, (Math.random() * 32) | 0, 2, 2); }
  const t = new THREE.CanvasTexture(k);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, rz);
  return t;
}
export const lambert = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial({ flatShading: true, ...o });
export const basic = (c: number, fog = false) => new THREE.MeshBasicMaterial({ color: c, fog });
export function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); return b;
}
function figure(color: number, big: boolean, skin?: { c?: number | null; h?: number; t?: number }) {
  const g = new THREE.Group();
  g.add(box(big ? 1 : 0.6, big ? 2 : 1.1, big ? 0.8 : 0.4, lambert({ color: skin && skin.c != null ? skin.c : color }), 0, big ? 1.3 : 0.75, 0));
  g.add(box(0.4, 0.4, 0.4, lambert({ color: big ? HUNTER_COLORS.head : skin?.h ?? WORLD_COLORS.skinTone }), 0, big ? 2.5 : 1.55, 0));
  if (skin?.t) g.add(box(0.5, 0.2, 0.5, lambert({ color: skin.t }), 0, 1.85, 0));
  if (big) {
    g.add(box(0.1, 0.1, 0.05, basic(HUNTER_COLORS.eyes), -0.1, 2.55, -0.22), box(0.1, 0.1, 0.05, basic(HUNTER_COLORS.eyes), 0.1, 2.55, -0.22));
    g.add(box(0.2, 1.6, 0.2, lambert({ color: HUNTER_COLORS.arms }), -0.65, 1.3, 0), box(0.2, 1.6, 0.2, lambert({ color: HUNTER_COLORS.arms }), 0.65, 1.3, 0));
  }
  S.add(g);
  return g;
}

/** renderer, cena, câmera, luzes e mapa estático (chão, muros, jaula); roda antes de criar a partida */
export function buildWorld(canvas: HTMLCanvasElement) {
  // three.js atual com a aparência da r128: sem gerenciamento de cor e luzes sem unidades físicas
  THREE.ColorManagement.enabled = false;
  R = new THREE.WebGLRenderer({ canvas, antialias: false });
  R.outputColorSpace = THREE.LinearSRGBColorSpace;
  R.setPixelRatio(1);
  R.setSize(384, 216, false);
  S = new THREE.Scene();
  S.background = new THREE.Color(WORLD_COLORS.background);
  S.fog = new THREE.Fog(WORLD_COLORS.background, 3, 30);
  cam = new THREE.PerspectiveCamera(px.camera.fov, 384 / 216, 0.1, 60);
  cam.rotation.order = "YXZ";
  S.add(new THREE.AmbientLight(WORLD_COLORS.ambient, 0.9 * Math.PI));
  PL = new THREE.PointLight(WORLD_COLORS.playerLight, 1.2 * Math.PI, 24, 1);
  S.add(PL);
  const [w, d] = map.size;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lambert({ map: tex(WORLD_COLORS.floor, 260, 18, 18) }));
  floor.rotation.x = -Math.PI / 2; S.add(floor);
  for (const [x, z, ww, wd] of map.walls) S.add(box(ww, map.wall_height, wd, lambert({ map: tex(WORLD_COLORS.wall, 200, Math.max(1, ww / 3), 1) }), x, map.wall_height / 2, z));
  S.add(box(2.6, 2.4, 2.6, new THREE.MeshBasicMaterial({ color: WORLD_COLORS.cage, wireframe: true }), map.cage[0], 1.2, map.cage[1]));
}

/** geradores, portão e figuras da partida criada; `skin` é a skin equipada do jogador */
export function buildActors(G: GameState, skin: string) {
  G.gens.forEach((g, i) => {
    const gr = new THREE.Group();
    gr.add(box(1.5, 1, 1, lambert({ color: g.bonus ? WORLD_COLORS.bonusBody : WORLD_COLORS.genBody }), 0, 0.5, 0));
    const lamp = box(0.4, 0.3, 0.4, basic(0xff3333), 0, 1.2, 0); gr.add(lamp);
    gr.position.set(g.x, 0, g.z); S.add(gr);
    const beam = box(0.25, 14, 0.25, basic(0xff3333), g.x, 7, g.z); S.add(beam);
    meshes.set("lamp" + i, lamp); meshes.set("beam" + i, beam);
  });
  const gate = box(6, 3, 0.6, basic(WORLD_COLORS.gateClosed), map.gate[0], 1.5, map.gate[1] + 1); S.add(gate); meshes.set("gate", gate);
  G.survivors.forEach(s => meshes.set("s" + s.id, figure(CLASS_COLORS[s.cls], false, s.id === 0 ? SKIN_COLORS[skin] : undefined)));
  meshes.set("hunter", figure(HUNTER_COLORS.body, true));
}

/** posiciona câmera e luz do jogador e desenha o quadro */
export function renderFrame(G: GameState, view: { yaw: number; pitch: number; thirdPerson: boolean }) {
  const P = G.survivors[0], { yaw, pitch, thirdPerson } = view;
  const c = px.camera;
  if (thirdPerson) {
    let d = c.distance;
    const sx = Math.cos(yaw) * c.shoulder, sz = -Math.sin(yaw) * c.shoulder;
    while (d > 0.7 && insideWall(cfg, P.x + Math.sin(yaw) * d + sx, P.z + Math.cos(yaw) * d + sz)) d -= c.wall_step;
    cam.position.set(P.x + Math.sin(yaw) * d + sx, c.height, P.z + Math.cos(yaw) * d + sz);
  } else cam.position.set(P.x, 1.5, P.z);
  cam.rotation.set(pitch - (thirdPerson ? 0.2 : 0), yaw, 0);
  PL.position.set(P.x, 2.5, P.z);
  R.render(S, cam);
}
