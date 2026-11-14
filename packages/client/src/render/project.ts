// Projeção de um ponto do chão pela câmera da render (V6: marcador do alvo do Treino, hud/tutorial.ts). Só lê a câmera
// já posicionada no quadro (renderFrame); não mexe na cena.
import * as THREE from "three";
import type { Projected } from "../hud/tutorial-logic.ts";

const v = new THREE.Vector3();

/** ponto (x, 0, z) em coordenadas normalizadas da câmera (−1 a 1) e se está atrás dela */
export function projectGround(cam: THREE.Camera, x: number, z: number): Projected {
  v.set(x, 0, z).applyMatrix4(cam.matrixWorldInverse);
  const behind = v.z > 0;
  v.applyMatrix4(cam.projectionMatrix);
  return { nx: v.x, ny: v.y, behind };
}
