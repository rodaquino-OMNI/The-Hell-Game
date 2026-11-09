// Filtro do movimento do mouse para a câmera (input.ts). Corrige o salto de câmera ao adquirir o pointer lock:
// o Chromium pode emitir, no momento em que o lock é adquirido, um mousemove com movementX/movementY espúrios (medido
// ≈ −568 px, a própria posição clientX do cursor ao clicar em "#go"), o que girava a câmera ≈ 1,4 rad no início da
// partida. Duas defesas, independentes:
// 1. a primeira leitura de cada sessão de lock é descartada (vale chegue o mousemove antes ou depois do
//    `pointerlockchange`; a sessão termina quando o lock é solto);
// 2. qualquer evento isolado com |movementX| ou |movementY| acima de `client.mouse_max_delta` (data/balance.yaml) é
//    ignorado (não truncado: truncar ainda giraria a câmera pelo próprio limite).

export interface PointerFilter {
  /** `pointerlockchange`: `locked` = o documento tem pointerLockElement depois da troca */
  lockChange(locked: boolean): void;
  /** um mousemove; `locked` = havia pointerLockElement. Devolve se o movimento pode girar a câmera */
  accept(locked: boolean, dx: number, dy: number): boolean;
}

export function pointerFilter(maxDelta: number): PointerFilter {
  /** a primeira leitura da sessão de lock atual já foi descartada */
  let dropped = false;
  return {
    lockChange(locked) { if (!locked) dropped = false; },
    accept(locked, dx, dy) {
      if (!locked) dropped = false;
      else if (!dropped) { dropped = true; return false; }
      return Math.abs(dx) <= maxDelta && Math.abs(dy) <= maxDelta;
    },
  };
}
