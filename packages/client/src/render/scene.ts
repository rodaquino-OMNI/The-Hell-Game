// Render: renderer, cena, câmera, mapa estático e figuras (visual da fase 0 sobre o material PS1 do V1).
// Valores de render vêm de data/balance.yaml `render` (GDD-v0.3 §10); fov da câmera de `prototype_extras.camera.fov`
// (P-02, paridade da fase 0) até o jogador escolher outro no menu de opções (V8, `ui.fov`, render/motion.ts).
import * as THREE from "three";
import { insideWall, type GameState } from "@thehell/sim";
import { balance, cfg, map, px } from "../data.ts";
import { skinDef, tok, tokCss, WORLD } from "../look.ts";
import { createHunterModel, createSurvivorModel, SURVIVOR_MODEL } from "./characters/actors.ts";
import { charactersReady } from "./characters/runtime.ts";
import { aimLantern, bakeVertexLight, createAmbience, createLantern, cullShadowCasters, neutralBake, type Ambience } from "./environment.ts";
import { cameraFov } from "./motion.ts";
import { fxTime, onLayersChange, presetLayers, setGrainSeed, setLayers, tickLayers, type LayerSet } from "./layers.ts";
import { clientRandom, urlPreset, urlRetro, urlRetroClass, type RetroClass } from "./options.ts";
import { createPresenter, type Presenter } from "./present.ts";
import { Ps1Material, ps1Uniforms } from "./ps1.ts";
import { createIndustrial, type Industrial } from "./retro/industrial.ts";
import { createViewmodel, type Viewmodel } from "./retro/viewmodel.ts";
import { createGenVisual, createLock, type GenVisual } from "./states.ts";

/** contexto de render devolvido por `buildWorld` (substitui os `let` exportados da fase 0) */
export interface RenderCtx {
  R: THREE.WebGLRenderer;
  S: THREE.Scene;
  cam: THREE.PerspectiveCamera;
  /** luz pontual que segue o jogador */
  PL: THREE.PointLight;
  presenter: Presenter;
  /** camada B: lanterna do jogador (cone e sombra) */
  lantern: THREE.SpotLight;
  /** camada B: chão e muros com luz assada nos vértices (assada em `buildActors`, com as lâmpadas da partida) */
  baked: THREE.Mesh[];
  /** camada C: névoa em billboards e poeira */
  ambience: Ambience;
  /** pulso de aberração: sobrevivente seguido, vida dele no quadro anterior e instante do último dano (relógio da simulação) */
  fx: { id: number | null; lastHp: number | null; hitT: number | null };
  /** personagens que podem projetar a sombra da lanterna (o próprio jogador não) */
  casters: THREE.Object3D[];
  /** passo (em 1/render.anim_fps) da última atualização do shadow map; NaN força a próxima */
  shadowStep: number;
  /** `renderer.info` do último quadro (sombra + cena + passes finais) */
  info: { calls: number; triangles: number };
  /** mockup do modo Retro FPS (`?retro=1`, D-13/D-15): Pátio industrial e ferramenta na mão; ausente sem o parâmetro */
  retro?: { industrial: Industrial; vm: Viewmodel | null; overlay?: { scene: THREE.Scene; camera: THREE.Camera } };
}

const rc = balance.render;
/** malhas indexadas por chave: s<id>, hunter, lock<id> (cadeado), gate, p<id> (projétil), t<id> (armadilha) */
export const meshes = new Map<string, THREE.Object3D>();
/** feixe, lâmpada, espiral e losango de cada gerador (índice de G.gens) */
export const genVisuals: GenVisual[] = [];
/** semente das texturas procedurais (fluxo próprio do PRNG do cliente) */
const TEX_SALT = 1;
/** sementes do grão da camada A e das posições da camada C (fluxos próprios) */
const GRAIN_SALT = 2, AMBIENCE_SALT = 3;
/** semente das texturas do preset industrial (mockup Retro FPS, D-15) */
const INDUSTRIAL_SALT = 4;

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
/**
 * muros do mapa EFETIVO (`cfg.map`, de makeConfig: no v1 inclui as pilastras de `maps.v1.short_loop_pillars`,
 * GDD-v0.3 D-22/23/25), não o `map` de topo; um material por caixa (`wallMat` recebe a largura em x). Devolve as malhas.
 */
export function addWalls(S: THREE.Object3D, baked: THREE.Mesh[], wallMat: (ww: number) => THREE.Material): THREE.Mesh[] {
  const { walls, wall_height: h } = cfg.map;
  const out: THREE.Mesh[] = [];
  for (const [x, z, ww, wd] of walls) {
    const g = new THREE.BoxGeometry(ww, h, wd, seg(ww), seg(h), seg(wd));
    neutralBake(g);
    const b = new THREE.Mesh(g, wallMat(ww));
    b.name = "muro";
    b.position.set(x, h / 2, z); b.castShadow = b.receiveShadow = true; S.add(b); baked.push(b); out.push(b);
  }
  return out;
}

/** renderer, cena, câmera, luzes e mapa estático (chão, muros, jaula); roda antes de criar a partida */
export function buildWorld(canvas: HTMLCanvasElement): RenderCtx {
  // three.js atual com a aparência da r128: sem gerenciamento de cor e luzes sem unidades físicas
  THREE.ColorManagement.enabled = false;
  const R = new THREE.WebGLRenderer({ canvas, antialias: false });
  R.outputColorSpace = THREE.LinearSRGBColorSpace;
  R.setPixelRatio(1);
  R.info.autoReset = false;
  // camada B: sombra da lanterna em shadow map sem filtro (BasicShadowMap: texel nearest, sombra pixelada)
  R.shadowMap.enabled = true;
  R.shadowMap.type = THREE.BasicShadowMap;
  // o shadow map é redesenhado a render.anim_fps (12 Hz, o passo PS1 da animação), não a cada quadro
  R.shadowMap.autoUpdate = false;
  setGrainSeed(Math.floor(clientRandom(GRAIN_SALT)() * 65536));
  const presenter = createPresenter(R, canvas, urlPreset);
  const [iw, ih] = rc.presets[presenter.preset].internal;
  const S = new THREE.Scene();
  // fundo e névoa: world.fog (Art Bible §2: "névoa e fundo a 30 m")
  S.background = new THREE.Color(tok(WORLD.fog));
  S.fog = new THREE.Fog(tok(WORLD.fog), rc.fog.near, rc.fog.far);
  const cam = new THREE.PerspectiveCamera(px.camera.fov, iw / ih, rc.camera.near, rc.camera.far);
  cam.rotation.order = "YXZ";
  // preset industrial (D-15): luz ambiente fria no lugar de light.ambiente
  const industrial = urlRetro ? createIndustrial(clientRandom(INDUSTRIAL_SALT)) : null;
  const ri = rc.retro.industrial;
  S.add(industrial ? new THREE.AmbientLight(tok(ri.ambient), ri.ambient_intensity * Math.PI) : new THREE.AmbientLight(tok(WORLD.ambient), rc.lights.ambient * Math.PI));
  const PL = new THREE.PointLight(tok(WORLD.playerLight), rc.lights.player * Math.PI, rc.player_light_radius, rc.lights.player_decay);
  S.add(PL);
  const rand = clientRandom(TEX_SALT);
  const [w, d] = map.size;
  const baked: THREE.Mesh[] = [];
  const floorGeo = new THREE.PlaneGeometry(w, d, seg(w), seg(d));
  neutralBake(floorGeo);
  const floor = new THREE.Mesh(floorGeo, new Ps1Material({ lit: true, baked: true, map: industrial ? industrial.floor(18, 18) : tex(rand, tokCss(WORLD.ground), 260, 18, 18) }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; S.add(floor); baked.push(floor);
  addWalls(S, baked, (ww) => new Ps1Material({ lit: true, baked: true, map: industrial ? industrial.wall(Math.max(1, ww / 3), 1) : tex(rand, tokCss(WORLD.wall), 200, Math.max(1, ww / 3), 1) }));
  S.add(box(2.6, 2.4, 2.6, new Ps1Material({ lit: false, color: tok(WORLD.cage), wireframe: true }), map.cage[0], 1.2, map.cage[1]));
  const lantern = createLantern();
  S.add(lantern, lantern.target);
  const ambience = createAmbience(clientRandom(AMBIENCE_SALT));
  S.add(ambience.group);
  if (industrial) S.add(industrial.fixtures);
  const ctx: RenderCtx = { R, S, cam, PL, presenter, lantern, baked, ambience, fx: { id: null, lastHp: null, hitT: null }, casters: [], shadowStep: NaN, info: { calls: 0, triangles: 0 } };
  if (industrial) ctx.retro = { industrial, vm: null };
  onLayersChange(l => applyLayers(ctx, l));
  setLayers(presetLayers(presenter.preset));
  return ctx;
}

/** liga as camadas B (lanterna, sombra, luz assada) e C (névoa e poeira); a A fica no passe final (layers.ts) */
function applyLayers(ctx: RenderCtx, l: LayerSet) {
  ctx.lantern.visible = l.B;
  ps1Uniforms.uBake.value = l.B ? 1 : 0;
  ctx.ambience.group.visible = l.C;
  ctx.shadowStep = NaN;
}

/** troca o preset de resolução interna (low/medium/high) */
export function setPreset(ctx: RenderCtx, name: Presenter["preset"]) {
  ctx.presenter.setPreset(name);
  setLayers(presetLayers(name));
  const [iw, ih] = rc.presets[name].internal;
  ctx.cam.aspect = iw / ih; ctx.cam.updateProjectionMatrix();
  ctx.retro?.vm?.setAspect(iw / ih);
}

/** geradores, portão e personagens da partida criada; `skin` = skin equipada (loja), aplicada ao sobrevivente do jogador */
export function buildActors(ctx: RenderCtx, G: GameState, skin: string) {
  const { S } = ctx;
  genVisuals.length = 0;
  G.gens.forEach(g => {
    const body = box(1.5, 1, 1, lambert({ color: tok(g.bonus ? WORLD.bonusBody : WORLD.genBody) }), g.x, 0.5, g.z);
    body.castShadow = body.receiveShadow = true;
    S.add(body);
    // feixe e lâmpada com o padrão do estado (states.ts, Art Bible §4)
    genVisuals.push(createGenVisual(S, g.x, g.z));
  });
  // o portão é chapado mas não emissivo: o bloom da camada A fica nos olhos, lanterna, feixes e lâmpadas
  const gate = box(6, 3, 0.6, new Ps1Material({ lit: false, fog: false, emissive: false, color: tok(WORLD.gateClosed) }), map.gate[0], 1.5, map.gate[1] + 1); S.add(gate); meshes.set("gate", gate);
  // personagens do pipeline V2 (render/characters): posição e rumo vêm da simulação em sync.ts.
  // Skin (V3): só o sobrevivente do jogador (id 0) a veste, como no protótipo.
  G.survivors.forEach(s => {
    const m = createSurvivorModel(s, s.id === G.survivors[0].id ? skinDef(skin) : undefined); S.add(m); meshes.set("s" + s.id, m);
    meshes.set("lock" + s.id, createLock(S));
  });
  const hm = createHunterModel(); S.add(hm); meshes.set("hunter", hm);
  // camada B: luz assada com as lâmpadas dos geradores desta partida (o layout muda a posição)
  const r = ctx.retro;
  if (r) {
    // preset industrial (D-15): luz assada âmbar nos geradores e nas luminárias dos muros
    const ri = rc.retro.industrial;
    bakeVertexLight(ctx.baked, [...G.gens, ...r.industrial.lamps], { color: ri.bake_color, intensity: ri.bake_intensity });
    // ferramenta na mão da classe do jogador (ou a pedida em ?retro_class)
    const cls: RetroClass = urlRetroClass ?? (SURVIVOR_MODEL[G.survivors[0].cls] as RetroClass);
    const [iw, ih] = rc.presets[ctx.presenter.preset].internal;
    r.vm = createViewmodel(cls, iw / ih);
    r.overlay = { scene: r.vm.scene, camera: r.vm.camera };
  } else bakeVertexLight(ctx.baked, G.gens);
  ctx.fx = { id: null, lastHp: null, hitT: null };
  // personagens recebem a sombra da lanterna e projetam quando estão no cone (cullShadowCasters); o próprio
  // jogador não projeta (a lanterna sai do corpo dele)
  const own = meshes.get("s" + G.survivors[0].id);
  ctx.casters = [];
  ctx.shadowStep = NaN;
  void charactersReady().then(() => {
    for (const s of G.survivors.map(v => meshes.get("s" + v.id)).concat(hm)) {
      if (!s) continue;
      s.traverse(o => { if ((o as THREE.Mesh).isMesh) o.receiveShadow = true; });
      if (s !== own) ctx.casters.push(s);
    }
    ctx.shadowStep = NaN;
  });
}

/** posiciona câmera e luz do jogador e desenha o quadro (alvo em baixa resolução → passe final) */
export function renderFrame(ctx: RenderCtx, G: GameState, view: { yaw: number; pitch: number; thirdPerson: boolean }) {
  placeCamera(ctx, G, view);
  drawFrame(ctx, G, !view.thirdPerson);
}

/** câmera (1ª ou 3ª pessoa), luz do jogador e lanterna apontada para onde a câmera olha */
export function placeCamera(ctx: RenderCtx, G: GameState, view: { yaw: number; pitch: number; thirdPerson: boolean }) {
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
  // fov do menu de opções (V8, GDD-v0.3 §12.2); sem escolha, o do protótipo (render/motion.ts)
  const fov = cameraFov();
  if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
  PL.position.set(P.x, rc.lights.player_height, P.z);
  aimLantern(ctx.lantern, cam, P.x, P.z);
}

/**
 * desenha o quadro com a câmera já posta (`placeCamera`, ou a vista de cima da cena de pior caso, stress.ts);
 * `tool` = ferramenta na mão à vista (mockup Retro FPS: só em 1ª pessoa)
 */
export function drawFrame(ctx: RenderCtx, G: GameState, tool: boolean) {
  const { cam } = ctx;
  const P = G.survivors[0];
  // camada B: shadow map a render.anim_fps no relógio da simulação, só com os projetores dentro do cone
  const shadowStep = Math.floor(fxTime(G.t) * rc.anim_fps);
  if (ctx.lantern.visible && shadowStep !== ctx.shadowStep) {
    cullShadowCasters(ctx.lantern, ctx.casters);
    ctx.R.shadowMap.needsUpdate = true;
    ctx.shadowStep = shadowStep;
  }
  // camada A: pulso de aberração quando a vida do jogador cai; grão e camada C no relógio da simulação
  // só o dano do mesmo sobrevivente conta: trocar o alvo da câmera (modo espectador) não dispara o pulso
  if (ctx.fx.id === P.id && ctx.fx.lastHp !== null && P.hp < ctx.fx.lastHp) ctx.fx.hitT = G.t;
  ctx.fx.id = P.id;
  ctx.fx.lastHp = P.hp;
  tickLayers(G.t, ctx.fx.hitT);
  ctx.ambience.update(fxTime(G.t), cam, ctx.lantern);
  // ferramenta na mão (mockup Retro FPS): só em 1ª pessoa, com o jogador de pé
  ctx.retro?.vm?.update(P.x, P.z, G.t, tool && P.st === "ok");
  present(ctx);
}

/** desenha a cena no alvo da resolução interna e o leva à tela pelo passe final; registra `renderer.info` */
export function present(ctx: RenderCtx) {
  ctx.R.info.reset();
  // overlay da ferramenta só quando ela está à vista (em 3ª pessoa não há clearDepth nem passe extra)
  const r = ctx.retro;
  ctx.presenter.present(ctx.S, ctx.cam, r?.vm?.visible ? r.overlay : undefined);
  ctx.info.calls = ctx.R.info.render.calls;
  ctx.info.triangles = ctx.R.info.render.triangles;
}
