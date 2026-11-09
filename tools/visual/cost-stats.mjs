// Estatística do custo das camadas na CI (D-44, docs/plano-construcao.md §7; render.cost_check em data/balance.yaml).
// Na CI não há GPU (SwiftShader na CPU) e a razão A+B / sem camadas depende do tipo de runner: a medida é um proxy de
// regressão, não o orçamento de 1,4× (que vale para hardware real). Funções puras, testadas em
// packages/client/test/cost-stats.test.ts:
//   - abbaOrder: ordem intercalada ABBA dos pares (A = sem camadas, B = A+B), que cancela a deriva linear de carga;
//   - median / bootstrapCi: mediana das razões pareadas e IC por bootstrap percentil, determinístico (PRNG com semente
//     e número fixo de reamostragens, ambos em render.cost_check);
//   - costVerdict: "fail" só se o limite inferior do IC passar do teto (regressão certa); "warn" se só a mediana
//     passar; "pass" caso contrário.

/** PRNG mulberry32, o mesmo algoritmo de packages/sim/src/rng.ts (GDD v0.3 §13.3): mesma semente, mesma sequência */
export function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    let t = (s = (s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ordem de medida do par i: ABBA (pares pares A→B, pares ímpares B→A) */
export function abbaOrder(i) {
  return i % 2 === 0 ? ["A", "B"] : ["B", "A"];
}

/** mediana (média dos dois do meio com n par) */
export function median(v) {
  if (!v.length) return NaN;
  const s = [...v].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * IC da mediana por bootstrap percentil: `resamples` reamostragens com reposição sorteadas por mulberry32(`seed`);
 * `ci` = nível de confiança (ex.: 0,95). Devolve { median, lo, hi }.
 */
export function bootstrapCi(values, { resamples, ci, seed }) {
  const n = values.length, rand = mulberry32(seed), meds = new Array(resamples), buf = new Array(n);
  for (let r = 0; r < resamples; r++) {
    for (let i = 0; i < n; i++) buf[i] = values[Math.floor(rand() * n)];
    meds[r] = median(buf);
  }
  meds.sort((x, y) => x - y);
  const alpha = 1 - ci;
  const lo = meds[Math.max(0, Math.floor((alpha / 2) * resamples))];
  const hi = meds[Math.min(resamples - 1, Math.ceil((1 - alpha / 2) * resamples) - 1)];
  return { median: median(values), lo, hi };
}

/** decisão de D-44 sobre o IC da razão: "fail" se lo > teto, "warn" se só a mediana > teto, senão "pass" */
export function judgeCost({ median: med, lo }, factor) {
  if (lo > factor) return "fail";
  if (med > factor) return "warn";
  return "pass";
}

/**
 * razões pareadas B/A, IC por bootstrap e decisão. `a` e `b`: ms por quadro de cada par (mesmo índice = mesmo par);
 * `cfg` = render.cost_check; `factor` = render.layer_cost_factor
 */
export function costVerdict(a, b, cfg, factor) {
  if (a.length !== b.length || !a.length) throw new Error("costVerdict: pares incompletos");
  const ratios = a.map((x, i) => b[i] / x);
  const ci = bootstrapCi(ratios, { resamples: cfg.bootstrap_resamples, ci: cfg.ci, seed: cfg.seed });
  return { ratios, ...ci, verdict: judgeCost(ci, factor) };
}
