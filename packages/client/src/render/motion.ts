// Opções de câmera do menu de opções (V8, F2-08): campo de visão (GDD-v0.3 §12.2, `ui.fov`: 60 a 100) e "reduzir
// balanço de câmera" (GDD-v0.3 §12.4). Lidos por scene.ts (fov da câmera do mundo) e retro/viewmodel.ts (balanço).
// Sem escolha do jogador, a câmera mantém o fov do protótipo (`prototype_extras.camera.fov`, P-02, paridade da fase 0
// e das capturas de referência de tools/visual); o slider parte dele.
import { balance, px } from "../data.ts";

const fovRange = balance.ui.fov;
let fov: number | null = null;
let reduceBob = false;

/** fov escolhido (graus, limitado a `ui.fov`) ou null para o padrão */
export function setFov(v: number | null) {
  fov = v === null || !Number.isFinite(v) ? null : Math.min(fovRange.max, Math.max(fovRange.min, v));
}
/** fov vertical efetivo da câmera do mundo (graus) */
export const cameraFov = () => fov ?? px.camera.fov;
export const getFovChoice = () => fov;

/** "reduzir balanço de câmera": multiplica o balanço por `ui.options.reduced_bob` (0 = zera) */
export function setReduceCameraBob(on: boolean) { reduceBob = on; }
export const getReduceCameraBob = () => reduceBob;
/** multiplicador do balanço (render.retro.bob × este valor) */
export const bobScale = () => (reduceBob ? balance.ui.options.reduced_bob : 1);
