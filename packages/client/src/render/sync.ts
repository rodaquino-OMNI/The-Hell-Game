// Render: malhas dinâmicas sincronizadas com o estado da simulação a cada quadro.
import * as THREE from "three";
import type { GameState } from "@thehell/sim";
import { HUNTER_COLORS, WORLD_COLORS } from "../look.ts";
import type { Ps1Material } from "./ps1.ts";
import { basic, box, meshes, type RenderCtx } from "./scene.ts";

/** posição e visibilidade de figuras, lâmpadas dos geradores e cor do portão */
export function syncActors(G: GameState, thirdPerson: boolean) {
  const P = G.survivors[0], H = G.hunter;
  for (const s of G.survivors) {
    const m = meshes.get("s" + s.id)!;
    m.position.set(s.x, 0, s.z); m.rotation.y = s.a; m.scale.y = s.st === "cage" ? 0.6 : 1;
    m.visible = (s.st === "ok" || s.st === "cage") && (s !== P || thirdPerson);
  }
  const hm = meshes.get("hunter")!; hm.position.set(H.x, 0, H.z); hm.rotation.y = H.a;
  G.gens.forEach((g, i) => {
    const c = g.bonus ? (g.done ? 0x555566 : 0x4da6ff) : g.done ? 0x33ff66 : g.n > 0 ? 0xffcc33 : 0xff3333;
    const lamp = meshes.get("lamp" + i) as THREE.Mesh, beam = meshes.get("beam" + i) as THREE.Mesh;
    (lamp.material as Ps1Material).color.set(c); (beam.material as Ps1Material).color.set(c);
    lamp.visible = Math.sin(G.t * 6) > -0.3;
  });
  if (G.gateOpen) ((meshes.get("gate") as THREE.Mesh).material as Ps1Material).color.set(WORLD_COLORS.gateOpen);
}

/** cria e remove malhas de projéteis e armadilhas conforme o estado */
export function syncDynamic({ S }: RenderCtx, G: GameState) {
  const alive = new Set<string>();
  for (const p of G.projectiles) {
    const key = "p" + p.id; alive.add(key);
    let m = meshes.get(key);
    if (!m) { m = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 6), basic(HUNTER_COLORS.projectile, true)); S.add(m); meshes.set(key, m); }
    m.position.set(p.x, 1.2, p.z);
  }
  for (const t of G.traps) {
    const key = "t" + t.id; alive.add(key);
    if (!meshes.has(key)) { const m = box(0.9, 0.15, 0.9, basic(HUNTER_COLORS.trap, true), t.x, 0.08, t.z); S.add(m); meshes.set(key, m); }
  }
  for (const [key, m] of meshes) if ((key[0] === "p" || key[0] === "t") && !alive.has(key)) { S.remove(m); meshes.delete(key); }
}
