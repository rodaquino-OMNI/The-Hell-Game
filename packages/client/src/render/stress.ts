// Cena de pior caso dos orçamentos de render (V7, F2-07; GDD-v0.3 §10.6: "6 personagens, mapa inteiro, efeitos").
// Só cliente e só com `?stress=1`: um estado SINTÉTICO montado a partir da partida criada (a simulação não roda e
// não é alterada). O sim tem 3 classes hoje; Protetor e Batedor (fase 4) entram só como atores de render, com as
// fichas do V2 (public/models). Pior caso, tudo ao mesmo tempo:
//  - 1 caçador (olhos acesos no preparo) + 5 sobreviventes das 5 classes, em grupo à frente do jogador, dentro do
//    cone da lanterna (todos projetam sombra); um deles preso (cadeado à mostra);
//  - geradores obrigatórios em progresso (feixe sempre aceso) e bônus com espiral e losango;
//  - armadilhas: o máximo que uma partida acumula (match.hard_time_limit / menor difficulty_table.*.trap_interval);
//    projéteis: o máximo simultâneo (prototype_extras.projectile_life / hunter.projectile.cooldown);
//  - vistas (render.stress): varredura de `sweep` rumos de cima (mapa inteiro no frustum, lanterna no rumo), em 3ª e
//    em 1ª pessoa (a ferramenta do modo Retro FPS na mão, com `?retro=1`). As camadas são as do preset.
// tools/perf/budget.mjs mede `renderer.info` em todas as vistas e vale o máximo.
import type * as THREE from "three";
import { insideWall, type GameState, type Survivor } from "@thehell/sim";
import { balance, cfg } from "../data.ts";
import { SURVIVOR_MODEL } from "./characters/actors.ts";
import { charactersReady, createCharacter } from "./characters/runtime.ts";
import { RETRO_CLASSES } from "./options.ts";
import { drawFrame, meshes, placeCamera, type RenderCtx } from "./scene.ts";
import { setHunterOutlineRetroView } from "./ps1.ts";
import { createLock } from "./states.ts";
import { syncActors, syncDynamic } from "./sync.ts";

const rs = balance.render.stress;

export interface StressScene {
  /** estado sintético (cópia da partida com os atores do pior caso); `t` avança no laço, a simulação não */
  G: GameState;
  /** rumo da câmera que olha do jogador para o grupo */
  yaw: number;
  /** número de vistas: `sweep` rumos de cima, em 3ª pessoa e em 1ª pessoa */
  views: number;
}

let current: StressScene | null = null;
/** cena de pior caso montada (null fora do `?stress=1`) */
export const stressScene = () => current;

/** armadilhas que uma partida acumula no máximo e projéteis no ar ao mesmo tempo (dados de balance.yaml) */
export function stressCounts() {
  const b = balance;
  const minTrap = Math.min(...Object.values(b.difficulty_table).map(d => d.trap_interval));
  return {
    traps: Math.ceil(b.match.hard_time_limit / minTrap),
    projectiles: Math.ceil(b.prototype_extras.projectile_life / b.hunter.projectile.cooldown),
  };
}

/** monta o estado sintético e os atores que o sim não tem (Protetor, Batedor); chamar depois de `buildActors` */
export function buildStress(ctx: RenderCtx, G0: GameState): StressScene {
  const used = new Set(G0.survivors.map(s => SURVIVOR_MODEL[s.cls]));
  const extra = RETRO_CLASSES.filter(c => !used.has(c));
  const P = { ...G0.survivors[0] };
  const others: Survivor[] = G0.survivors.slice(1).map(s => ({ ...s }));
  // o modelo dos atores extras é escolhido aqui; a classe do sim só entra nos campos que a animação não lê
  extra.forEach((id, i) => {
    const s: Survivor = { ...G0.survivors[0], id: G0.survivors.length + i, bot: true };
    others.push(s);
    const m = createCharacter(id); ctx.S.add(m); meshes.set("s" + s.id, m);
    meshes.set("lock" + s.id, createLock(ctx.S));
  });
  // grupo à frente do jogador, à vista: caçador no meio, sobreviventes em fila dos dois lados. Rumo: o primeiro dos
  // `sweep` rumos (a partir do que olha para o centro do mapa) com os atores e o caminho até eles fora dos muros
  const slot = (i: number) => (i % 2 ? 1 : -1) * Math.ceil(i / 2) * rs.spacing;
  const n = others.length;
  const place = (dx: number, dz: number) => {
    const cx = P.x + dx * rs.distance, cz = P.z + dz * rs.distance;
    return Array.from({ length: n + 1 }, (_, i) => ({ x: cx - dz * slot(i), z: cz + dx * slot(i) }));
  };
  const clear = (dx: number, dz: number) => place(dx, dz).every(q => {
    const steps = Math.ceil(Math.hypot(q.x - P.x, q.z - P.z) / rs.spacing);
    for (let j = 1; j <= steps; j++) if (insideWall(cfg, P.x + ((q.x - P.x) * j) / steps, P.z + ((q.z - P.z) * j) / steps)) return false;
    return true;
  });
  const a0 = Math.atan2(-P.x, -P.z);
  let dx = Math.sin(a0), dz = Math.cos(a0);
  for (let j = 0; j < rs.sweep; j++) {
    const b = a0 + (2 * Math.PI * j) / rs.sweep;
    if (clear(Math.sin(b), Math.cos(b))) { dx = Math.sin(b); dz = Math.cos(b); break; }
  }
  const spots = place(dx, dz);
  const a = Math.atan2(-dx, -dz);
  const H = { ...G0.hunter, ...spots[0], a };
  // preparo de golpe: olhos acesos e lampejo (telegraph do V3)
  H.windup = { kind: "melee", t: 0, total: balance.hunter.telegraph_min };
  others.forEach((s, i) => { Object.assign(s, spots[i + 1]); s.a = a + Math.PI; s.st = "ok"; });
  // um aliado preso (cadeado sobre ele)
  if (others.length) others[others.length - 1].st = "cage";
  const { traps, projectiles } = stressCounts();
  const [w, d] = cfg.map.size;
  let id = G0.nextId;
  const G: GameState = {
    ...G0,
    survivors: [P, ...others],
    hunter: H,
    gens: G0.gens.map(g => ({ ...g, done: false, n: g.bonus ? 0 : 1 })),
    // armadilhas numa grade sobre o mapa inteiro (todas à vista na vista de cima)
    traps: Array.from({ length: traps }, (_, i) => {
      const n = Math.ceil(Math.sqrt(traps)), u = (i % n + 0.5) / n, v = (Math.floor(i / n) + 0.5) / n;
      return { id: id++, x: (u - 0.5) * w, z: (v - 0.5) * d };
    }),
    projectiles: Array.from({ length: projectiles }, (_, i) => ({ id: id++, x: (P.x + H.x) / 2 - dz * i, z: (P.z + H.z) / 2 + dx * i, vx: 0, vz: 0, t: 0 })),
    puzzle: null,
    events: [],
  };
  G.nextId = id;
  void charactersReady().then(() => {
    for (const s of others) {
      const m = meshes.get("s" + s.id);
      if (!m || ctx.casters.includes(m)) continue;
      m.traverse(o => { if ((o as THREE.Mesh).isMesh) o.receiveShadow = true; });
      ctx.casters.push(m);
    }
    ctx.shadowStep = NaN;
  });
  current = { G, yaw: a, views: 3 * rs.sweep };
  return current;
}

/**
 * desenha a vista `i` da cena e devolve `renderer.info` do quadro. Vistas em 3 blocos de `sweep` rumos (o 1º olha o
 * grupo): de cima (mapa inteiro, lanterna apontada no rumo), 3ª pessoa e 1ª pessoa. `everyFrame`: shadow map
 * redesenhado neste quadro (pior caso de draw calls); sem ele, a render.anim_fps como no jogo (contagem de FPS)
 */
export function renderStress(ctx: RenderCtx, sc: StressScene, i: number, everyFrame = true) {
  const { G } = sc;
  const kind = Math.floor(i / rs.sweep) % 3, top = kind === 0, third = kind === 1;
  const yaw = sc.yaw + (2 * Math.PI * (i % rs.sweep)) / rs.sweep;
  syncActors(G, true);
  syncDynamic(ctx, G);
  // câmera e lanterna da vista em 3ª pessoa no rumo; a vista de cima depois só troca a câmera
  placeCamera(ctx, G, { yaw, pitch: 0, thirdPerson: !(kind === 2) });
  // como renderFrame: o fator do contorno do Retro (issue #48) só na 1ª pessoa do Retro
  setHunterOutlineRetroView(!!ctx.retro && kind === 2);
  if (everyFrame) ctx.shadowStep = NaN;
  if (top) {
    const restore = overview(ctx);
    // pior caso: corpo do jogador à vista e ferramenta na mão (mockup Retro FPS) no mesmo quadro
    drawFrame(ctx, G, true);
    restore();
  } else drawFrame(ctx, G, !third);
  return { ...ctx.info };
}

/** câmera de cima com o mapa inteiro (mais `render.stress.margin`) no frustum; devolve quem desfaz a troca */
function overview(ctx: RenderCtx) {
  const { cam, S } = ctx;
  const [w, d] = cfg.map.size;
  const tv = Math.tan((cam.fov * Math.PI) / 360), th = tv * cam.aspect;
  const h = Math.max((d / 2 + rs.margin) / tv, (w / 2 + rs.margin) / th);
  const far0 = cam.far, fog = S.fog as THREE.Fog, fog0 = [fog.near, fog.far] as const;
  cam.position.set(0, h, 0);
  cam.rotation.set(-Math.PI / 2, 0, 0);
  // o canto mais distante do mapa (com a altura dos muros) cabe no plano distante; a névoa desce junto com a câmera
  cam.far = Math.hypot(h, w / 2 + rs.margin, d / 2 + rs.margin);
  cam.updateProjectionMatrix();
  fog.near = fog0[0] + h; fog.far = fog0[1] + h;
  return () => { cam.far = far0; cam.updateProjectionMatrix(); fog.near = fog0[0]; fog.far = fog0[1]; };
}
