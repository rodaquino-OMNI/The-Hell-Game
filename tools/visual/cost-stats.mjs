// Estatística do custo das camadas na CI (D-44, docs/plano-construcao.md §7; render.cost_check em data/balance.yaml).
// Na CI não há GPU (SwiftShader na CPU) e a razão A+B / sem camadas depende do tipo de runner: a medida é um proxy de
// regressão, não o orçamento de 1,4× (que vale para hardware real). Funções puras, testadas em
// packages/client/test/cost-stats.test.ts:
//   - abbaOrder: ordem intercalada ABBA dos pares (A = sem camadas, B = A+B), que cancela a deriva linear de carga;
//   - median / bootstrapCi: mediana das razões pareadas e IC por bootstrap percentil, determinístico (PRNG com semente
//     e número fixo de reamostragens, ambos em render.cost_check);
//   - costVerdict: "fail" só se o limite inferior do IC passar do teto da CI, layer_cost_factor × (1 +
//     cost_check.ci_runner_margin) (regressão certa, descontado o viés do tipo de runner); "warn" se a mediana passar
//     de layer_cost_factor (o orçamento de hardware); "pass" caso contrário;
//   - costOutcome / ghaWarning (D-48): com cost_check.ci_mode "warn" o "fail" vira aviso que não reprova; o texto do
//     aviso vai numa anotação ::warning do GitHub Actions e no resumo do job;
//   - crossOrder / judgeVsMain / costVsMain / vsMainOutcome (issue #59, D-49): o PR e o build de main medidos no mesmo
//     job, em rodadas intercaladas; reprova só se o limite inferior do IC de (razão do PR − razão de main) passar de
//     cost_check.main_delta. Com o build de main o teto absoluto de D-44 vira só aviso; sem ele (main antigo ou
//     build ausente) vale o portão absoluto de D-44/D-48, com aviso.

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

/** tetos de D-44: `budget` = layer_cost_factor (aviso, na mediana); `fail` = budget × (1 + margem do runner) (no lo) */
export function costThresholds(factor, margin) {
  return { budget: factor, fail: factor * (1 + margin) };
}

/**
 * decisão de D-44 sobre o IC da razão: "fail" se lo > factor × (1 + margin); "warn" se a mediana > factor; senão
 * "pass". Valor não finito é erro (nunca "pass" silencioso)
 */
export function judgeCost({ median: med, lo }, factor, margin) {
  if (![med, lo, factor, margin].every(Number.isFinite) || margin < 0) {
    throw new Error(`judgeCost: valor inválido (mediana ${med}, lo ${lo}, teto ${factor}, margem ${margin})`);
  }
  const t = costThresholds(factor, margin);
  if (lo > t.fail) return "fail";
  if (med > t.budget) return "warn";
  return "pass";
}

/**
 * razões pareadas B/A, IC por bootstrap e decisão. `a` e `b`: ms por quadro de cada par (mesmo índice = mesmo par);
 * `cfg` = render.cost_check; `factor` = render.layer_cost_factor
 */
export function costVerdict(a, b, cfg, factor) {
  if (a.length !== b.length || !a.length) throw new Error("costVerdict: pares incompletos");
  // tempo nulo, negativo ou não finito = medida quebrada (ex.: /proc do processo de GPU sumiu no meio, cpuMs em
  // compare.mjs): erro, nunca "pass" silencioso
  const bad = [...a, ...b].findIndex(x => !(Number.isFinite(x) && x > 0));
  if (bad >= 0) throw new Error(`costVerdict: tempo inválido (${[...a, ...b][bad]} ms) no par ${bad % a.length}`);
  const ratios = a.map((x, i) => b[i] / x);
  const ci = bootstrapCi(ratios, { resamples: cfg.bootstrap_resamples, ci: cfg.ci, seed: cfg.seed });
  if (![ci.median, ci.lo, ci.hi].every(Number.isFinite)) throw new Error("costVerdict: IC não finito");
  return { ratios, ...ci, ...costThresholds(factor, cfg.ci_runner_margin), verdict: judgeCost(ci, factor, cfg.ci_runner_margin) };
}

/**
 * D-48 (docs/plano-construcao.md §7; render.cost_check.ci_mode): o que o resultado de costVerdict faz na CI.
 * `mode` "fail": verdict "fail" reprova (comportamento de D-44). `mode` "warn": verdict "fail" vira aviso e não
 * reprova. Em qualquer modo, verdict "warn" (mediana acima do orçamento) é aviso. Devolve { failing, warning }:
 * `warning` = texto de uma linha (razão, IC, base em ms/quadro, tetos) para a anotação e o resumo do job, ou null.
 * `ctx` = { view: nome da vista, baseMs: mediana do ms/quadro sem camadas, ciLevel: render.cost_check.ci }
 */
export function costOutcome(c, mode, { view, baseMs, ciLevel }) {
  if (mode !== "warn" && mode !== "fail") throw new Error(`costOutcome: ci_mode inválido (${mode})`);
  if (c.verdict === "pass") return { failing: false, warning: null };
  if (c.verdict === "fail" && mode === "fail") return { failing: true, warning: null };
  const x2 = (n) => `${n.toFixed(2)}×`;
  const why = c.verdict === "fail"
    ? `limite inferior do IC acima do teto da CI ${x2(c.fail)}: reprovaria, mas ci_mode warn (D-48) não reprova`
    : `mediana acima do orçamento ${x2(c.budget)}, limite inferior do IC ≤ teto da CI ${x2(c.fail)}: aviso, não reprova`;
  const warning = `vista ${view}: razão mediana ${x2(c.median)}, IC ${Math.round(ciLevel * 100)}% [${x2(c.lo)}, ${x2(c.hi)}], base ${baseMs.toFixed(1)} ms/quadro sem camadas; aviso se mediana > ${x2(c.budget)}, falha se limite inferior > ${x2(c.fail)}; ${why}`;
  return { failing: false, warning };
}

/** comando de workflow do GitHub Actions `::warning title=…::msg`, com o escape de % \r \n (e de : , no título) */
export function ghaWarning(title, msg) {
  const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  return `::warning title=${esc(title).replace(/:/g, "%3A").replace(/,/g, "%2C")}::${esc(msg)}`;
}

// ---------- issue #59 (D-49): custo do PR comparado com o build de main medido no mesmo job ----------

/**
 * ordem das 4 medidas da rodada i com o build de main: os builds em abbaOrder(i) (A = PR, B = main) e, dentro de
 * cada build, as camadas em abbaOrder(i) (A = sem camadas, B = A+B). Rodada par: PR sem, PR com, main sem, main com;
 * rodada ímpar: a mesma sequência invertida. Duas rodadas seguidas cancelam a deriva linear de carga entre builds e
 * entre camadas. Devolve [[build, camadas], …] com build "pr" | "main" e camadas "A" | "B"
 */
export function crossOrder(i) {
  const builds = abbaOrder(i).map(x => (x === "A" ? "pr" : "main"));
  return builds.flatMap(build => abbaOrder(i).map(layers => [build, layers]));
}

/**
 * decisão da issue #59 sobre o IC da diferença (razão do PR − razão de main): "fail" se lo > delta (regressão certa
 * em relação a main, medida na mesma máquina); "warn" se a mediana > delta; senão "pass". Valor não finito ou delta
 * negativo é erro (nunca "pass" silencioso)
 */
export function judgeVsMain({ median: med, lo }, delta) {
  if (![med, lo, delta].every(Number.isFinite) || delta < 0) {
    throw new Error(`judgeVsMain: valor inválido (mediana ${med}, lo ${lo}, delta ${delta})`);
  }
  if (lo > delta) return "fail";
  if (med > delta) return "warn";
  return "pass";
}

/**
 * razões pareadas de cada build e diferença por rodada (PR − main), IC por bootstrap da mediana das diferenças e
 * decisão de judgeVsMain. `pr` e `main` = { a, b } (ms por quadro sem camadas e com A+B; mesmo índice = mesma rodada
 * de crossOrder); `cfg` = render.cost_check (main_delta, bootstrap_resamples, ci, seed)
 */
export function costVsMain(pr, main, cfg) {
  const n = pr.a.length;
  if (!n || ![pr.b, main.a, main.b].every(v => v.length === n)) throw new Error("costVsMain: rodadas incompletas");
  const all = [...pr.a, ...pr.b, ...main.a, ...main.b];
  const bad = all.findIndex(x => !(Number.isFinite(x) && x > 0));
  if (bad >= 0) throw new Error(`costVsMain: tempo inválido (${all[bad]} ms) na rodada ${bad % n}`);
  const prRatios = pr.a.map((x, i) => pr.b[i] / x), mainRatios = main.a.map((x, i) => main.b[i] / x);
  const diffs = prRatios.map((r, i) => r - mainRatios[i]);
  const ci = bootstrapCi(diffs, { resamples: cfg.bootstrap_resamples, ci: cfg.ci, seed: cfg.seed });
  if (![ci.median, ci.lo, ci.hi].every(Number.isFinite)) throw new Error("costVsMain: IC não finito");
  return {
    diffs, ...ci, delta: cfg.main_delta, prMedian: median(prRatios), mainMedian: median(mainRatios),
    verdict: judgeVsMain(ci, cfg.main_delta),
  };
}

/**
 * o que a CI faz com a comparação com main (issue #59). `rel` = costVsMain; `abs` = costVerdict do PR (D-44), que
 * aqui só anota; `mode` = render.cost_check.ci_mode. Devolve { failing, warnings }: failing só com rel.verdict "fail"
 * e mode "fail"; warnings = textos de uma linha para a anotação e o resumo do job (rel "warn", rel "fail" em modo
 * warn, e o teto absoluto de D-44 passado, que nunca reprova quando há build de main).
 * `ctx` = { view, baseMs (ms/quadro sem camadas do PR), mainBaseMs (o mesmo em main), ciLevel }
 */
export function vsMainOutcome(rel, abs, mode, { view, baseMs, mainBaseMs, ciLevel }) {
  if (mode !== "warn" && mode !== "fail") throw new Error(`vsMainOutcome: ci_mode inválido (${mode})`);
  const x2 = (n) => `${n.toFixed(2)}×`, d2 = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;
  const pct = Math.round(ciLevel * 100);
  const warnings = [];
  const failing = rel.verdict === "fail" && mode === "fail";
  if (rel.verdict !== "pass" && !failing) {
    const why = rel.verdict === "fail"
      ? `limite inferior do IC acima de ${d2(rel.delta)}: reprovaria, mas ci_mode warn não reprova`
      : `mediana da diferença acima de ${d2(rel.delta)}, limite inferior do IC ≤ ${d2(rel.delta)}: aviso, não reprova`;
    warnings.push(`vista ${view}: PR ${x2(rel.prMedian)} × main ${x2(rel.mainMedian)} no mesmo job, diferença mediana ${d2(rel.median)}, IC ${pct}% [${d2(rel.lo)}, ${d2(rel.hi)}]; ${why}`);
  }
  if (abs.verdict !== "pass") {
    const what = abs.verdict === "fail" ? `limite inferior do IC acima do teto da CI ${x2(abs.fail)}` : `mediana acima do orçamento ${x2(abs.budget)}`;
    warnings.push(`vista ${view}: razão absoluta do PR ${x2(abs.median)}, IC ${pct}% [${x2(abs.lo)}, ${x2(abs.hi)}], base ${baseMs.toFixed(1)} ms/quadro sem camadas (main ${mainBaseMs.toFixed(1)}); ${what}: só aviso, o portão é a comparação com main (issue #59)`);
  }
  return { failing, warnings };
}
