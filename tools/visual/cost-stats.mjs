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
//   - crossOrder / judgeVsMain / costVsMain / vsMainOutcome / costInfo (issue #59, D-49; critério de D-51): o PR e o
//     build de main medidos no mesmo job, em rodadas intercaladas; reprova só se o limite inferior do IC da diferença
//     relativa do ms/quadro com A+B (PR_AB / main_AB − 1, pareada por rodada) passar de cost_check.main_rel_delta.
//     A razão A+B ÷ sem camadas (e a comparação dela com main e com o teto de D-44) fica só no log e no resumo;
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
 * decisão do portão contra main sobre o IC: "fail" se lo > delta (regressão certa em relação a main, medida na mesma
 * máquina); "warn" se a mediana > delta; senão "pass". Com D-51 o IC é o da diferença relativa do ms/quadro com A+B
 * (PR_AB / main_AB − 1) e delta = cost_check.main_rel_delta. Valor não finito ou delta negativo é erro (nunca "pass"
 * silencioso)
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
 * D-51 (supervisão por delegação do Rodrigo, 09/11/2026; docs/plano-construcao.md §7): portão contra main no ms/quadro
 * ABSOLUTO com A+B. `pr` e `main` = { a, b } (ms por quadro sem camadas e com A+B; mesmo índice = mesma rodada de
 * crossOrder); `cfg` = render.cost_check (main_rel_delta, bootstrap_resamples, ci, seed). Por rodada, a diferença
 * relativa rel = PR_AB / main_AB − 1; IC por bootstrap da mediana de rel e decisão de judgeVsMain contra
 * main_rel_delta. A razão A+B ÷ sem camadas de cada build e a diferença (razão do PR − razão de main), com IC, saem
 * em `ratio` só para informação: a razão penaliza otimizar a base (o denominador encolhe), por isso não reprova
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
  if (![ci.median, ci.lo, ci.hi, rci.median, rci.lo, rci.hi].every(Number.isFinite)) throw new Error("costVsMain: IC não finito");
  return {
    rels, ...ci, delta: cfg.main_rel_delta,
    prAbMs: median(pr.b), mainAbMs: median(main.b), prBaseMs: median(pr.a), mainBaseMs: median(main.a),
    ratio: { diffs, ...rci, prMedian: median(prRatios), mainMedian: median(mainRatios) },
    verdict: judgeVsMain(ci, cfg.main_rel_delta),
  };
}

const x2 = (n) => `${n.toFixed(2)}×`, d2 = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;
const p1 = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(1)}%`;

/**
 * o que a CI faz com a comparação com main (D-51). `rel` = costVsMain; `mode` = render.cost_check.ci_mode. Devolve
 * { failing, warnings }: failing só com rel.verdict "fail" e mode "fail"; warnings = textos de uma linha para a
 * anotação e o resumo do job (rel "warn", rel "fail" em modo warn). A razão A+B ÷ sem camadas e o teto absoluto de
 * D-44 não entram aqui (são informativos: costInfo). `ctx` = { view, ciLevel }
 */
export function vsMainOutcome(rel, mode, { view, ciLevel }) {
  if (mode !== "warn" && mode !== "fail") throw new Error(`vsMainOutcome: ci_mode inválido (${mode})`);
  const pct = Math.round(ciLevel * 100);
  const warnings = [];
  const failing = rel.verdict === "fail" && mode === "fail";
  if (rel.verdict !== "pass" && !failing) {
    const why = rel.verdict === "fail"
      ? `limite inferior do IC acima de ${p1(rel.delta)}: reprovaria, mas ci_mode warn não reprova`
      : `mediana acima de ${p1(rel.delta)}, limite inferior do IC ≤ ${p1(rel.delta)}: aviso, não reprova`;
    warnings.push(`vista ${view}: A+B ${rel.prAbMs.toFixed(1)} ms/quadro no PR × ${rel.mainAbMs.toFixed(1)} em main no mesmo job, diferença relativa mediana ${p1(rel.median)}, IC ${pct}% [${p1(rel.lo)}, ${p1(rel.hi)}]; ${why}`);
  }
  return { failing, warnings };
}

/**
 * linha informativa para o log e o resumo do job (D-51): o portão (ms/quadro com A+B, PR × main) e, só para
 * informação, a razão A+B ÷ sem camadas dos dois builds com a diferença e o IC, e a razão do PR contra o teto
 * absoluto de D-44 (`abs` = costVerdict do PR). Nada daqui reprova nem vira anotação
 */
export function costInfo(rel, abs, { view, ciLevel }) {
  const pct = Math.round(ciLevel * 100), r = rel.ratio;
  const gate = `A+B ${rel.prAbMs.toFixed(1)} ms/quadro no PR × ${rel.mainAbMs.toFixed(1)} em main, diferença relativa ${p1(rel.median)} [${p1(rel.lo)}, ${p1(rel.hi)}], limite ${p1(rel.delta)} → ${rel.verdict}`;
  const info = `informativo: sem camadas ${rel.prBaseMs.toFixed(1)} × ${rel.mainBaseMs.toFixed(1)} ms/quadro; razão A+B ÷ sem camadas PR ${x2(r.prMedian)} × main ${x2(r.mainMedian)}, diferença ${d2(r.median)} [${d2(r.lo)}, ${d2(r.hi)}]; razão do PR ${x2(abs.median)} [${x2(abs.lo)}, ${x2(abs.hi)}] contra o orçamento ${x2(abs.budget)} e o teto ${x2(abs.fail)} de D-44 → ${abs.verdict} (não reprova)`;
  return `vista ${view}: ${gate} (IC ${pct}%, D-51); ${info}`;
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
