// Render: malhas dinâmicas sincronizadas com o estado da simulação a cada quadro.
import * as THREE from "three";
import type { GameState } from "@thehell/sim";
import { FX, tok, WORLD } from "../look.ts";
import type { Ps1Material } from "./ps1.ts";
import { animateHunter, animateSurvivor } from "./characters/actors.ts";
import { setTelegraph } from "./characters/runtime.ts";
import { basic, box, genVisuals, meshes, type RenderCtx } from "./scene.ts";
import { syncGenVisual, syncLock } from "./states.ts";

/** posição e visibilidade de figuras, feixes dos geradores, cadeados, olhos do caçador e cor do portão */
export function syncActors(G: GameState, thirdPerson: boolean) {
  const P = G.survivors[0], H = G.hunter;
  for (const s of G.survivors) {
    const m = meshes.get("s" + s.id)!;
    m.position.set(s.x, 0, s.z); m.rotation.y = s.a;
    m.visible = (s.st === "ok" || s.st === "cage") && (s !== P || thirdPerson);
    animateSurvivor(m, s, G);
    syncLock(meshes.get("lock" + s.id)!, G, s.id);
  }
  const hm = meshes.get("hunter")!; hm.position.set(H.x, 0, H.z); hm.rotation.y = H.a;
  animateHunter(hm, H, G);
  // telegraph (Art Bible §1.5 e §4): olhos acesos durante todo o preparo de golpe ou dash (hunter.windup, regras v1)
  setTelegraph(hm, H.windup != null);
  G.gens.forEach((g, i) => syncGenVisual(genVisuals[i], g, G.t));
  if (G.gateOpen) ((meshes.get("gate") as THREE.Mesh).material as Ps1Material).color.setHex(tok(WORLD.gateOpen));
}

/** cria e remove malhas de projéteis e armadilhas conforme o estado */
export function syncDynamic({ S }: RenderCtx, G: GameState) {
  const alive = new Set<string>();
  for (const p of G.projectiles) {
    const key = "p" + p.id; alive.add(key);
    let m = meshes.get(key);
    if (!m) { m = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 6), basic(tok(FX.projectile), true)); S.add(m); meshes.set(key, m); }
    m.position.set(p.x, 1.2, p.z);
  }
  for (const t of G.traps) {
    const key = "t" + t.id; alive.add(key);
    if (!meshes.has(key)) { const m = box(0.9, 0.15, 0.9, basic(tok(FX.trap), true), t.x, 0.08, t.z); S.add(m); meshes.set(key, m); }
  }
  for (const [key, m] of meshes) if ((key[0] === "p" || key[0] === "t") && !alive.has(key)) { S.remove(m); meshes.delete(key); }
}
