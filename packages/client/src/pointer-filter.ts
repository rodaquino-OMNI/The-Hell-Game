// Filtro do movimento do mouse para a câmera (input.ts). Corrige o salto de câmera ao adquirir o pointer lock:
// o Chromium pode emitir, perto da aquisição do lock, um mousemove com movementX/movementY espúrios (medido
// ≈ −568 px, a própria posição clientX do cursor ao clicar em "#go"), o que girava a câmera ≈ 1,4 rad no início da
// partida. No jogo o salto também chega SEM lock, antes do `pointerlockchange` (medido em tools/e2e/pointer-lock.mjs:
// [-88,-62,false] depois do mouseup, então [0,0,true] — o evento de movimento nulo do próprio Chromium ao travar —
// e só então o pointerlockchange). Defesas:
// 1. "tentativa de lock": começa no pedido (`requested()`, chamado por lockPointer) ou numa sessão de lock nova
//    (pointer travado sem pedido registrado); enquanto ela não descartou nada, o primeiro movimento NÃO NULO é
//    descartado, com ou sem lock. Termina quando o lock é solto ou o pedido falha (`pointerlockerror`);
// 2. movimento nulo (dx === 0 && dy === 0) nunca consome o descarte (não gira nada; é o evento real do Chromium);
// 3. qualquer evento isolado com |movementX| ou |movementY| acima de `client.mouse_max_delta` (data/balance.yaml, D-47)
//    é ignorado (não truncado: truncar ainda giraria a câmera pelo próprio limite).
// Custo aceito: num navegador sem o salto (Firefox), o primeiro movimento real de cada lock é perdido (um evento,
// poucos px). LACUNA: a ordem dos eventos no Chrome com janela (headful) não foi medida; só no headless do Playwright.

export interface PointerFilter {
  /** lockPointer pediu o pointer lock (requestPointerLock); o lock ainda não chegou */
  requested(): void;
  /** `pointerlockchange`: `locked` = o documento tem pointerLockElement depois da troca */
  lockChange(locked: boolean): void;
  /** `pointerlockerror`: o pedido falhou */
  lockError(): void;
  /** um mousemove; `locked` = havia pointerLockElement. Devolve se o movimento pode girar a câmera */
  accept(locked: boolean, dx: number, dy: number): boolean;
}

export function pointerFilter(maxDelta: number): PointerFilter {
  /** há pedido de lock sem resposta (pointerlockchange ou pointerlockerror) */
  let pending = false;
  /** a tentativa de lock atual já descartou seu primeiro movimento não nulo */
  let dropped = false;
  /** último estado de lock informado (pointerlockchange ou mousemove) */
  let isLocked = false;
  const end = () => { pending = false; dropped = false; isLocked = false; };
  return {
    requested() {
      if (isLocked) return; // já travado: requestPointerLock não abre sessão nova
      pending = true; dropped = false;
    },
    lockChange(locked) {
      if (!locked) { end(); return; }
      pending = false; isLocked = true; // a sessão herda o descarte já feito durante o pedido
    },
    lockError() { end(); },
    accept(locked, dx, dy) {
      if (!locked && !pending) { dropped = false; isLocked = false; } // arrastar sem lock: nada a descartar
      if (locked) isLocked = true;
      if (dx === 0 && dy === 0) return true;
      if ((locked || pending) && !dropped) { dropped = true; return false; }
      return Math.abs(dx) <= maxDelta && Math.abs(dy) <= maxDelta;
    },
  };
}
