// Filtro do movimento do mouse para a câmera (input.ts). Corrige o salto de câmera ao adquirir o pointer lock:
// o Chromium pode emitir, perto da aquisição do lock, um mousemove com movementX/movementY espúrios (medido
// ≈ −568 px, a própria posição clientX do cursor ao clicar em "#go"), o que girava a câmera ≈ 1,4 rad no início da
// partida. No jogo o salto também chega SEM lock, antes do `pointerlockchange` (ordem medida: mv(+pos) →
// requestPointerLock → mv(−pos, sem lock) → … → eventos com lock; o qa reproduziu também um par COM lock
// [185,264,true],[-185,-264,true], abaixo do limite, que girava o yaw −0,462 rad e voltava). Defesas:
// 1. "tentativa de lock": começa no pedido (`requested()`, chamado por lockPointer) ou numa sessão de lock nova
//    (pointer travado sem pedido registrado). O primeiro movimento NÃO NULO COM lock da tentativa é descartado.
//    Termina quando o lock é solto ou o pedido falha (`pointerlockerror`);
// 2. com o pedido pendente, movimento não nulo SEM lock é ignorado e NÃO consome o descarte (o salto sem lock é
//    inofensivo para a câmera, pois look() exige lock ou arrasto, mas gastaria o descarte que protege a sessão);
// 3. o salto com lock pode vir em par (+pos, −pos: visto no headless e reproduzido pelo qa). Se o movimento não nulo
//    seguinte ao descartado for o seu negativo exato, ele também é descartado (uma vez); sem isso o par, que antes
//    girava e voltava, deixaria a câmera girada pelo −pos. Movimento real que seja o negativo exato do anterior é
//    improvável; o custo é perder mais um evento;
// 4. movimento nulo (dx === 0 && dy === 0) nunca consome o descarte (não gira nada; é o evento real do Chromium);
// 5. qualquer evento isolado com |movementX| ou |movementY| acima de `client.mouse_max_delta` (data/balance.yaml, D-47)
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
  /** movimento descartado no lock, à espera do possível par negativo (só o evento não nulo seguinte) */
  let pair: [number, number] | null = null;
  const end = () => { pending = false; dropped = false; isLocked = false; pair = null; };
  return {
    requested() {
      if (isLocked) return; // já travado: requestPointerLock não abre sessão nova
      pending = true; dropped = false; pair = null;
    },
    lockChange(locked) {
      if (!locked) { end(); return; }
      pending = false; isLocked = true; // um mousemove com lock pode ter chegado antes: não descarta de novo
    },
    lockError() { end(); },
    accept(locked, dx, dy) {
      if (!locked && !pending) { dropped = false; isLocked = false; pair = null; } // arrastar sem lock: nada a descartar
      if (locked) isLocked = true;
      if (dx === 0 && dy === 0) return true;
      if (!locked && pending) return false; // salto sem lock durante o pedido: ignorado, o descarte fica para o lock
      if (locked && !dropped) { dropped = true; pair = [dx, dy]; return false; }
      const p = pair; pair = null;
      if (p && dx === -p[0] && dy === -p[1]) return false; // segunda metade do par espúrio
      return Math.abs(dx) <= maxDelta && Math.abs(dy) <= maxDelta;
    },
  };
}
