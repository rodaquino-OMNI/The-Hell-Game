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
//   - crossOrder / judgeVsMain / judgeDual / costVsMain / vsMainOutcome / costInfo (issue #59, D-49; critério duplo
//     de D-51): o PR e o build de main medidos no mesmo job, em rodadas intercaladas; reprova só se os DOIS limites
//     inferiores dos IC passarem: o da diferença relativa do ms/quadro com A+B (rel_AB = PR_AB / main_AB − 1, pareada
//     por rodada) acima de cost_check.main_rel_delta E o da diferença de razão A+B ÷ sem camadas (razão do PR − razão
//     de main, pareada por rodada) acima de cost_check.main_ratio_delta. Aviso se qualquer das medianas passar do seu
//     limite. O teto absoluto de D-44 fica só no log e no resumo;
//   - costGateOutcome (complemento de D-49, supervisão por delegação do Rodrigo, 09/11/2026): o desfecho do portão.
//     Sem build de main utilizável (passo falhou, build ou render.layer_a ausentes, main sem o gancho de custo,
//     servidor de main não subiu, exceção no meio da medida do lado de main) a comparação não é feita: só aviso
//     ("sem build de main, comparação não feita"), nunca falha, nem com o teto absoluto de D-44 estourado.

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
 * plano das rodadas de uma vista (D-51, investigação do viés): `warmupRounds` rodadas medidas e descartadas, depois
 * `pairs` rodadas guardadas. As guardadas usam crossOrder(r) com r = 0, 1, … (rodada 0: PR primeiro), contadas sem o
 * aquecimento; o aquecimento j usa crossOrder(warmupRounds − j), então o último aquecimento é crossOrder(1) (main
 * primeiro) e a ordem segue alternando até a rodada 0. Com pairs ímpar sobra 1 rodada com o PR primeiro (desbalanço
 * de 1 que já existia antes do aquecimento). Devolve [{ round: r | null (aquecimento), order }]
 */
export function roundPlan(warmupRounds, pairs) {
  if (![warmupRounds, pairs].every(Number.isInteger) || warmupRounds < 0 || pairs < 1) {
    throw new Error(`roundPlan: valor inválido (aquecimento ${warmupRounds}, rodadas ${pairs})`);
  }
  const warm = Array.from({ length: warmupRounds }, (_, j) => ({ round: null, order: crossOrder(warmupRounds - j) }));
  return [...warm, ...Array.from({ length: pairs }, (_, r) => ({ round: r, order: crossOrder(r) }))];
}

/**
 * executa `plan` (roundPlan) chamando `measure(build, layers, round)` (round null = aquecimento) na ordem de cada
 * rodada e guarda só as rodadas com round ≠ null: { pr: { A, B }, main: { A, B } } (ms por quadro; mesmo índice =
 * mesma rodada). `stop()` verdadeiro depois de uma medida interrompe tudo (exceção do lado de main em compare.mjs) e
 * devolve { stopped: true }
 */
export async function runRounds(plan, measure, stop = () => false) {
  const ms = { pr: { A: [], B: [] }, main: { A: [], B: [] } };
  for (const { round, order } of plan) {
    for (const [build, layers] of order) {
      const t = await measure(build, layers, round);
      if (stop()) return { stopped: true, ms };
      if (round !== null) ms[build][layers].push(t);
    }
  }
  return { stopped: false, ms };
}

/**
 * confere as amostras de um build ({ A, B }): `pairs` tempos finitos e > 0 em cada camada; senão lança (no lado do
 * PR a exceção reprova; no lado de main compare.mjs a converte em aviso)
 */
export function checkSamples(xs, pairs, who) {
  for (const l of ["A", "B"]) {
    const v = xs[l];
    if (v.length !== pairs || !v.every(t => Number.isFinite(t) && t > 0)) {
      throw new Error(`amostras de ${who} (${l}): ${v.length} de ${pairs}, alguma não finita ou ≤ 0`);
    }
  }
}

/**
 * decisão de UMA medida contra main sobre o IC: "fail" se lo > delta (regressão certa em relação a main, medida na
 * mesma máquina); "warn" se a mediana > delta; senão "pass". Era o portão de D-49 (diferença de razão); com D-51 o
 * portão é judgeDual, que combina as duas medidas. Valor não finito ou delta negativo é erro (nunca "pass" silencioso)
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
 * critério duplo de D-51 (emenda da supervisão por delegação do Rodrigo, 09/11/2026): "fail" só se rel.lo > relDelta
 * E ratio.lo > ratioDelta; "warn" se qualquer mediana passar do seu limite; senão "pass". rel_AB sozinho reprovaria
 * um viés de quadro inteiro entre os dois builds (o run 42578537893 do PR #80 mediu −5,7% em A+B sem nada mudar no
 * render); a razão sozinha reprovaria otimizar a base (o denominador encolhe). Exigir os dois isola a regressão das
 * camadas. Valor não finito ou limite ≤ 0 é erro (nunca "pass" silencioso)
 */
export function judgeDual(rel, relDelta, ratio, ratioDelta) {
  const v = [rel?.median, rel?.lo, ratio?.median, ratio?.lo, relDelta, ratioDelta];
  if (!v.every(Number.isFinite) || !(relDelta > 0) || !(ratioDelta > 0)) {
    throw new Error(`judgeDual: valor inválido (rel ${rel?.median}/${rel?.lo}, razão ${ratio?.median}/${ratio?.lo}, limites ${relDelta}/${ratioDelta})`);
  }
  if (rel.lo > relDelta && ratio.lo > ratioDelta) return "fail";
  if (rel.median > relDelta || ratio.median > ratioDelta) return "warn";
  return "pass";
}

/**
 * D-51 (supervisão por delegação do Rodrigo, 09/11/2026; docs/plano-construcao.md §7): portão contra main. `pr` e
 * `main` = { a, b } (ms por quadro sem camadas e com A+B; mesmo índice = mesma rodada de crossOrder); `cfg` =
 * render.cost_check (main_rel_delta, main_ratio_delta, bootstrap_resamples, ci, seed). Por rodada: rel_AB = PR_AB /
 * main_AB − 1 (topo do objeto: rels, median, lo, hi, delta); diferença de razão = PR_B/PR_A − main_B/main_A (`ratio`:
 * diffs, median, lo, hi, delta, prMedian, mainMedian); e, só para informação, rel_A = PR_A / main_A − 1 (`base`:
 * indica viés de quadro inteiro entre os builds). Decisão de judgeDual
 */
export function costVsMain(pr, main, cfg) {
  const n = pr.a.length;
  if (!n || ![pr.b, main.a, main.b].every(v => v.length === n)) throw new Error("costVsMain: rodadas incompletas");
  const all = [...pr.a, ...pr.b, ...main.a, ...main.b];
  const bad = all.findIndex(x => !(Number.isFinite(x) && x > 0));
  if (bad >= 0) throw new Error(`costVsMain: tempo inválido (${all[bad]} ms) na rodada ${bad % n}`);
  const boot = { resamples: cfg.bootstrap_resamples, ci: cfg.ci, seed: cfg.seed };
  const rels = pr.b.map((x, i) => x / main.b[i] - 1);
  const ci = bootstrapCi(rels, boot);
  const prRatios = pr.a.map((x, i) => pr.b[i] / x), mainRatios = main.a.map((x, i) => main.b[i] / x);
  const diffs = prRatios.map((r, i) => r - mainRatios[i]);
  const rci = bootstrapCi(diffs, boot);
  const baseRels = pr.a.map((x, i) => x / main.a[i] - 1);
  const bci = bootstrapCi(baseRels, boot);
  if (![ci, rci, bci].every(c => [c.median, c.lo, c.hi].every(Number.isFinite))) throw new Error("costVsMain: IC não finito");
  const ratio = { diffs, ...rci, delta: cfg.main_ratio_delta, prMedian: median(prRatios), mainMedian: median(mainRatios) };
  return {
    rels, ...ci, delta: cfg.main_rel_delta,
    prAbMs: median(pr.b), mainAbMs: median(main.b), prBaseMs: median(pr.a), mainBaseMs: median(main.a),
    ratio, base: { rels: baseRels, ...bci },
    verdict: judgeDual(ci, cfg.main_rel_delta, ratio, cfg.main_ratio_delta),
  };
}

/** formatos do log e do resumo: razão (1.30×), diferença de razão (+0.05) e diferença relativa (+5.0%) */
export const x2 = (n) => `${n.toFixed(2)}×`;
export const d2 = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;
export const p1 = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(1)}%`;

/**
 * o que a CI faz com a comparação com main (D-51, critério duplo). `rel` = costVsMain; `mode` =
 * render.cost_check.ci_mode. Devolve { failing, warnings }: failing só com rel.verdict "fail" e mode "fail"; warnings
 * = textos de uma linha para a anotação e o resumo do job (verdict "warn", ou "fail" em modo warn), com as duas
 * medidas. O teto absoluto de D-44 não entra aqui (informativo: costInfo). `ctx` = { view, ciLevel }
 */
export function vsMainOutcome(rel, mode, { view, ciLevel }) {
  if (mode !== "warn" && mode !== "fail") throw new Error(`vsMainOutcome: ci_mode inválido (${mode})`);
  const warnings = [];
  const failing = rel.verdict === "fail" && mode === "fail";
  if (rel.verdict !== "pass" && !failing) {
    const why = rel.verdict === "fail"
      ? `os dois limites inferiores acima dos limites: reprovaria, mas ci_mode warn não reprova`
      : `mediana acima do limite em ${[rel.median > rel.delta && "rel_AB", rel.ratio.median > rel.ratio.delta && "Δrazão"].filter(Boolean).join(" e ")}, sem os dois limites inferiores acima: aviso, não reprova`;
    warnings.push(`vista ${view}: ${gateText(rel, ciLevel)}; ${why}`);
  }
  return { failing, warnings };
}

/** as duas medidas do portão de D-51 numa linha: rel_AB e Δrazão com mediana, IC e limite */
function gateText(rel, ciLevel) {
  const pct = Math.round(ciLevel * 100), r = rel.ratio;
  return `rel_AB (A+B ${rel.prAbMs.toFixed(1)} ms/quadro no PR × ${rel.mainAbMs.toFixed(1)} em main) mediana ${p1(rel.median)}, IC ${pct}% [${p1(rel.lo)}, ${p1(rel.hi)}], limite ${p1(rel.delta)}; Δrazão (PR ${x2(r.prMedian)} × main ${x2(r.mainMedian)}) mediana ${d2(r.median)}, IC ${pct}% [${d2(r.lo)}, ${d2(r.hi)}], limite ${d2(r.delta)}`;
}

/**
 * linha para o log e o resumo do job, SEMPRE impressa por vista (D-51, para acompanhar a taxa de avisos): rel_AB e
 * Δrazão com mediana e IC (o portão duplo) e o desfecho; só para informação, rel_A (sem camadas, PR ÷ main − 1: viés
 * de quadro inteiro entre os builds) e a razão do PR contra o orçamento e o teto de D-44 (`abs` = costVerdict do PR).
 * Nada daqui reprova nem vira anotação
 */
export function costInfo(rel, abs, { view, ciLevel }) {
  const pct = Math.round(ciLevel * 100), b = rel.base;
  const info = `informativo: sem camadas ${rel.prBaseMs.toFixed(1)} × ${rel.mainBaseMs.toFixed(1)} ms/quadro, rel_A ${p1(b.median)} [${p1(b.lo)}, ${p1(b.hi)}]; razão do PR ${x2(abs.median)} [${x2(abs.lo)}, ${x2(abs.hi)}] contra o orçamento ${x2(abs.budget)} e o teto ${x2(abs.fail)} de D-44 → ${abs.verdict} (não reprova)`;
  return `vista ${view}: ${gateText(rel, ciLevel)} → ${rel.verdict} (IC ${pct}%, D-51: reprova só com os dois limites inferiores acima); ${info}`;
}

/** título da anotação ::warning do portão de custo das camadas (D-49; critério de D-51) */
export const COST_TITLE = "Custo das camadas (D-49)";

/**
 * desfecho do portão de custo das camadas na CI (D-49 e complemento, docs/plano-construcao.md §7). `cmp`:
 *   - { rel, abs? } com a comparação com main feita (rel = costVsMain; abs = costVerdict do PR, informativo e
 *     ignorado aqui): vsMainOutcome (D-51: ms/quadro com A+B);
 *   - { reason, abs? } sem build de main utilizável (`reason` = o motivo, uma linha; `abs` = costVerdict do PR, se
 *     houver): não reprova, nem com o teto absoluto de D-44 passado; um aviso "sem build de main, comparação não
 *     feita (motivo)" para a anotação e o resumo do job.
 * `mode` e `ctx` como em vsMainOutcome. Devolve { failing, warnings }. Sem rel e sem motivo é erro (nunca "pass"
 * silencioso). Exceção do lado do PR não passa por aqui: compare.mjs a deixa reprovar
 */
export function costGateOutcome(cmp, mode, ctx) {
  if (mode !== "warn" && mode !== "fail") throw new Error(`costGateOutcome: ci_mode inválido (${mode})`);
  if (cmp?.rel) return vsMainOutcome(cmp.rel, mode, ctx);
  if (typeof cmp?.reason !== "string" || !cmp.reason.trim()) throw new Error("costGateOutcome: sem comparação com main e sem motivo");
  return { failing: false, warnings: [`sem build de main, comparação não feita (${cmp.reason.trim()})`] };
}
