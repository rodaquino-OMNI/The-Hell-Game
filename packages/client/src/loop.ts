// Relógio do laço do cliente (GDD-v0.3 §13.3: passo fixo de 1/60 s). O tempo real de cada quadro entra num
// acumulador e vira passos inteiros da simulação, para a partida correr em tempo real mesmo com quadro lento.
// Tetos de `client` em data/balance.yaml contra a espiral da morte: tempo por quadro (`max_frame_dt`) e passos por
// quadro (`max_steps_per_frame`); o excesso é descartado. O protótipo limitava o quadro a 0,05 s (P-13).

export interface LoopLimits { max_frame_dt: number; max_steps_per_frame: number }
export interface LoopClock { acc: number }

/**
 * soma o tempo real do quadro (`realDt`, em s) ao acumulador e devolve quantos passos de `step` s rodar e o tempo
 * do quadro já limitado (para temporizadores de HUD e animação)
 */
export function advanceClock(clock: LoopClock, realDt: number, step: number, lim: LoopLimits): { steps: number; dt: number } {
  const dt = Math.min(lim.max_frame_dt, Math.max(0, Number.isFinite(realDt) ? realDt : 0));
  clock.acc += dt;
  let steps = 0;
  // folga de 1e-9 s: 0,07 s / (1/60) dá 4,2 passos; sem ela, erros de ponto flutuante perdem um passo exato
  while (clock.acc + 1e-9 >= step && steps < lim.max_steps_per_frame) { clock.acc -= step; steps++; }
  // acima do teto de passos, o excesso é descartado (não acumula atraso)
  if (steps === lim.max_steps_per_frame && clock.acc >= step) clock.acc %= step;
  if (clock.acc < 0) clock.acc = 0;
  return { steps, dt };
}

/**
 * cadeia única de quadros: `start` pode ser chamado a cada partida (reinício pelo menu), mas só a primeira chamada
 * agenda `frame` em `raf`; as seguintes não criam uma segunda cadeia (que desenharia duas vezes por quadro)
 */
export function frameLoop(raf: (cb: (now: number) => void) => unknown, frame: (now: number) => void) {
  let running = false;
  const tick = (now: number) => { frame(now); raf(tick); };
  return {
    /** agenda o primeiro quadro; devolve false se a cadeia já estava rodando */
    start(): boolean {
      if (running) return false;
      running = true;
      raf(tick);
      return true;
    },
  };
}
