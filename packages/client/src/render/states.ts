// Leitura de estado no jogo (V3, F2-03; Art Bible §4): feixes de gerador com padrão próprio por estado e
// cadeado sobre o aliado preso. Cores só de tokens (look.ts); medidas e frequências de data/balance.yaml
// `render.states`. O olho do caçador no preparo fica em characters/runtime.ts (`setTelegraph`).
//
// Padrões (Art Bible §4: "sem depender só de cor"):
//  - pendente: feixe laranja-avermelhado que pisca devagar (render.states.pending_hz, aceso metade do ciclo);
//  - em progresso: feixe amarelo que pulsa na largura (progress_hz, amplitude progress_pulse);
//  - pronto: feixe verde-água contínuo;
//  - bônus: feixe magenta com espiral girando em volta e losango no topo.
// O feixe não usa vertex snapping (uniforme uSnap próprio, render.states.beam.snap) e mantém largura mínima de
// render.states.beam.min_px pixels da resolução interna: de longe ele continua uma linha cheia, não um tracejado.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { GameState, Generator } from "@thehell/sim";
import { balance } from "../data.ts";
import { FX, GEN_TOKENS, tok, type GenState } from "../look.ts";
import { ps1Uniforms, Ps1Material } from "./ps1.ts";

const st = balance.render.states;
const TAU = Math.PI * 2;

/** estado de leitura do gerador (Art Bible §4); o bônus concluído passa a "pronto" */
export function genState(g: Generator): GenState {
  if (g.done) return "pronto";
  if (g.bonus) return "bonus";
  return g.n > 0 ? "progresso" : "pendente";
}

/** o feixe/lâmpada está aceso no instante `t` (só o pendente apaga: pisca a pending_hz) */
export function beamLit(state: GenState, t: number): boolean {
  return state !== "pendente" || (t * st.pending_hz) % 1 < 0.5;
}

/** multiplicador de largura do feixe no instante `t` (só o em progresso pulsa, a progress_hz) */
export function beamPulse(state: GenState, t: number): number {
  return state === "progresso" ? 1 + st.progress_pulse * (0.5 - 0.5 * Math.cos(TAU * st.progress_hz * t)) : 1;
}

/** escala de largura para o feixe ter pelo menos `minPx` pixels a `dist` metros (câmera perspectiva, altura interna `ih`) */
export function minWidthScale(dist: number, fovDeg: number, ih: number, width: number, minPx: number): number {
  const pxWorld = (2 * dist * Math.tan((fovDeg * Math.PI) / 360)) / ih;
  return Math.max(1, (minPx * pxWorld) / width);
}

/** material chapado e sem névoa (feixes, marcadores); `snap` = intensidade própria do vertex snapping */
function flat(token: string, snap?: number): Ps1Material {
  const m = new Ps1Material({ lit: false, fog: false, color: tok(token) });
  if (snap !== undefined) m.uniforms.uSnap = { value: snap };
  return m;
}

export interface GenVisual {
  lamp: THREE.Mesh;
  beam: THREE.Mesh;
  spiral: THREE.Object3D;
  diamond: THREE.Mesh;
  /** estado e instante do último sync (lidos no onBeforeRender do feixe) */
  state: GenState;
  t: number;
}

/** lâmpada, feixe, espiral e losango de um gerador em (x, z) */
export function createGenVisual(S: THREE.Scene, x: number, z: number): GenVisual {
  const b = st.beam, l = st.lamp, bo = st.bonus;
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(...l.size), flat(GEN_TOKENS.pendente));
  lamp.position.set(x, l.height, z);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(b.width, b.height, b.width), flat(GEN_TOKENS.pendente, b.snap));
  beam.position.set(x, b.height / 2, z);
  // espiral: blocos numa hélice em volta do feixe; o grupo gira em torno do eixo do feixe
  const blocks: THREE.BufferGeometry[] = [];
  for (let i = 0; i < bo.spiral_steps; i++) {
    const f = i / (bo.spiral_steps - 1), a = f * bo.spiral_turns * TAU;
    blocks.push(new THREE.BoxGeometry(bo.spiral_block, bo.spiral_block, bo.spiral_block).translate(Math.cos(a) * bo.spiral_radius, f * b.height, Math.sin(a) * bo.spiral_radius));
  }
  const spiral = new THREE.Mesh(mergeGeometries(blocks)!, flat(GEN_TOKENS.bonus));
  spiral.position.set(x, 0, z);
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(bo.diamond), flat(GEN_TOKENS.bonus));
  diamond.position.set(x, b.height + bo.diamond, z);
  const v: GenVisual = { lamp, beam, spiral, diamond, state: "pendente", t: 0 };
  // largura mínima em tela e pulso, calculados para a câmera que vai desenhar o quadro
  beam.onBeforeRender = (_r, _s, camera) => {
    const cam = camera as THREE.PerspectiveCamera;
    const dist = Math.hypot(cam.position.x - x, cam.position.z - z);
    const k = minWidthScale(dist, cam.fov ?? 60, ps1Uniforms.uRes.value.y, b.width, b.min_px) * beamPulse(v.state, v.t);
    if (beam.scale.x !== k) { beam.scale.set(k, 1, k); beam.updateMatrixWorld(); }
  };
  S.add(lamp, beam, spiral, diamond);
  return v;
}

/** cor, piscar, espiral e losango conforme o estado do gerador no instante da simulação */
export function syncGenVisual(v: GenVisual, g: Generator, t: number) {
  const state = genState(g), color = tok(GEN_TOKENS[state]);
  v.state = state; v.t = t;
  (v.lamp.material as Ps1Material).color.setHex(color);
  (v.beam.material as Ps1Material).color.setHex(color);
  const lit = beamLit(state, t);
  v.lamp.visible = v.beam.visible = lit;
  const bonus = state === "bonus";
  v.spiral.visible = v.diamond.visible = bonus;
  if (bonus) { v.spiral.rotation.y = TAU * st.bonus.spiral_hz * t; v.diamond.rotation.y = -v.spiral.rotation.y; }
}

// ---------- cadeado do aliado preso ----------

/**
 * Cadeado de blocos (Art Bible §4: "ícone de cadeado", cor fx.preso), lado `render.states.lock.size`.
 * Proporções do desenho em frações do lado: corpo 1 × 0,8 × 0,35; alça de duas hastes e travessa.
 */
function lockGeometry(s: number): THREE.BufferGeometry {
  const parts = [
    new THREE.BoxGeometry(s, 0.8 * s, 0.35 * s),
    new THREE.BoxGeometry(0.18 * s, 0.5 * s, 0.2 * s).translate(-0.32 * s, 0.6 * s, 0),
    new THREE.BoxGeometry(0.18 * s, 0.5 * s, 0.2 * s).translate(0.32 * s, 0.6 * s, 0),
    new THREE.BoxGeometry(0.82 * s, 0.18 * s, 0.2 * s).translate(0, 0.85 * s, 0),
  ];
  return mergeGeometries(parts)!;
}

/** cadeado oculto; `syncLock` mostra sobre o aliado preso. Gira para a câmera (só em Y). */
export function createLock(S: THREE.Scene): THREE.Mesh {
  const m = new THREE.Mesh(lockGeometry(st.lock.size), flat(FX.caged));
  m.visible = false;
  m.onBeforeRender = (_r, _s, camera) => {
    const yaw = Math.atan2(camera.position.x - m.position.x, camera.position.z - m.position.z);
    if (m.rotation.y !== yaw) { m.rotation.y = yaw; m.updateMatrixWorld(); }
  };
  S.add(m);
  return m;
}

/** mostra o cadeado acima do sobrevivente `id` preso, se não for o jogador (o próprio jogador vê o HUD) */
export function syncLock(lock: THREE.Object3D, G: GameState, id: number) {
  const s = G.survivors.find(v => v.id === id);
  lock.visible = !!s && s.st === "cage" && id !== G.survivors[0].id;
  if (s && lock.visible) lock.position.set(s.x, balance.survivor.height + st.lock.above, s.z);
}
