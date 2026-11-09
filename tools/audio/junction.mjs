// Critério da junção do loop (item A-3 do V5), o mesmo em packages/client/test/audio-stems.test.ts e em
// tools/audio/check-loop.mjs. Local: compara a junção (última amostra → primeira) com a vizinhança imediata.
//
//   degrau na junção   s = |x[0] − x[−1]|
//   curvatura na junção c = max(|x[1] − 2x[0] + x[−1]|, |x[0] − 2x[−1] + x[−2]|)
//   referências: o maior degrau e a maior 2ª diferença em ±window amostras (índices circulares), sem os termos que
//   cruzam a junção; passa se s ≤ factor × maior degrau e c ≤ factor × maior 2ª diferença.
//
// Janela e fator: audio.compose.junction_window e junction_factor (data/balance.yaml, onde está a calibração).

/**
 * @param {(i: number) => number} at amostra no índice do loop (negativo = antes do fim: at(−1) é a última)
 * @param {number} window
 */
export function junctionStats(at, window) {
  const step = Math.abs(at(0) - at(-1));
  const curv = Math.max(Math.abs(at(1) - 2 * at(0) + at(-1)), Math.abs(at(0) - 2 * at(-1) + at(-2)));
  let stepRef = 0, curvRef = 0;
  // degraus at(k) → at(k+1), menos o da junção (k = −1)
  for (let k = -window; k < window; k++) if (k !== -1) stepRef = Math.max(stepRef, Math.abs(at(k + 1) - at(k)));
  // 2ª diferença centrada em k, menos as duas que usam a junção (k = −1 e k = 0)
  for (let k = -window; k <= window; k++) if (k !== -1 && k !== 0) curvRef = Math.max(curvRef, Math.abs(at(k + 1) - 2 * at(k) + at(k - 1)));
  return { step, stepRef, curv, curvRef };
}

/** acesso circular a um canal inteiro */
export const circular = (x) => (i) => x[((i % x.length) + x.length) % x.length];

/** amostras de que junctionStats precisa: as `window + 2` últimas e as `window + 2` primeiras */
export const neighborhood = (window) => window + 2;

/** acesso a partir de só a vizinhança: `tail` = últimas amostras, `head` = primeiras */
export const fromNeighborhood = (tail, head) => (i) => (i < 0 ? tail[tail.length + i] : head[i]);

/** a junção passa? (ratios: s / maior degrau e c / maior 2ª diferença) */
export function junctionOk(st, factor) {
  const stepRatio = st.step / st.stepRef, curvRatio = st.curv / st.curvRef;
  return { ok: stepRatio <= factor && curvRatio <= factor, stepRatio, curvRatio };
}
