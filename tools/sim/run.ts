// Simulador headless (itens R3 e R5; GDD-v0.3 C-15, D-05 a, D-16 a; métricas do GDD-v0.2 §7.6).
// Roda N partidas do ruleset v1 com a IA do caçador (`ai.hunter_brain: utility`; o tempo de perseguição só existe com
// ela) e os bots atuais em todas as vagas de sobrevivente. Por mapa e dificuldade (e o agregado "mapa/all"): vitória
// do caçador por partida, fuga por sobrevivente, duração média e mediana, capturas por partida, % abaixo de 3 min,
// uso de classe (com bots: a distribuição sorteada), mediana de perseguição até a captura e o aceite T-03 (GDD-v0.3
// §8.6): nenhuma trava, exceção, partida sem fim ou transição fora do grafo do §8.2. Sai com código 1 se algum
// falhar ou se a comparação com a linha de base reprovar.
//
// Uso: pnpm sim [--n=1000] [--seed=1] [--difficulty=normal|easy|hard|nightmare|all] [--map=all|patio]
//               [--workers=4] [--nav=grid|recast] [--json=saida.json] [--md=saida.md] [--compare=data/sim/baseline.json]
//      pnpm sim:check      = --check: parâmetros de `sim.check` (data/balance.yaml), compara com data/sim/baseline.json
//      pnpm sim:baseline   = --check --write-baseline: regrava data/sim/baseline.json com o mesmo lote do check
//      pnpm sim:nightly    = --nightly: como o check, com `sim.nightly.matches_per_group` partidas por grupo (10.000 no
//                            Pátio; .github/workflows/sim-nightly.yml). O JSON traz `failed` (true = regressão/falha dura).
//      pnpm sim --noise=10 : 10 lotes do check com sementes disjuntas (seed + k × n); imprime o desvio-padrão de cada
//                            métrica por grupo e a tolerância sugerida (3 × √2 × maior desvio, separado para os grupos
//                            de 1 dificuldade e para o agregado "mapa/all"; resolução de 1 partida se o desvio for 0).
//                            É assim que as tolerâncias de `sim.regression` foram justificadas (√2: a diferença entre
//                            duas amostras independentes; 3: ~0,1% de alarme falso unilateral por comparação).
//
// Lote do check e da linha de base (semente fixa): `sim.check` = 50 partidas por dificuldade (easy, normal, hard,
// nightmare) em cada mapa de data/maps, sementes 1..50 em todos os grupos, grade A* (nav=grid). Com 1 mapa, 200
// partidas. O resultado não depende de --workers (cada partida só depende da semente; as linhas são ordenadas).
//
// ATUALIZAR A LINHA DE BASE é um PR explícito: rode `pnpm sim:check` antes (relatório "antes"), `pnpm sim:baseline`,
// `pnpm sim:check` de novo (relatório "depois") e anexe as duas tabelas e a justificativa ao PR. Se o comportamento
// mudou de natureza (ex.: bots competentes do R4), meça o ruído de novo com --noise=10 e revise `sim.regression`.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { loadBalanceFile, loadMapFile } from "../../packages/shared/src/node.ts";
import { HUNTER_TRANSITIONS, makeConfig, playHeadless, type HunterMode } from "../../packages/sim/src/index.ts";
import type { NavQuery } from "../../packages/sim/src/nav/index.ts";
import { groupMetrics, hardFailures, METRICS, type GroupMetrics, type MatchRow } from "./metrics.ts";
import { compare, comparisonMarkdown, POOLED, type Baseline, type Rules } from "./regression.ts";

type Difficulty = "easy" | "normal" | "hard" | "nightmare";
const DIFFS: Difficulty[] = ["easy", "normal", "hard", "nightmare"];
const root = fileURLToPath(new URL("../../", import.meta.url));
const BASELINE = root + "data/sim/baseline.json";

interface Job { map: string; difficulty: Difficulty; seeds: number[]; nav: "grid" | "recast" }

async function runJob(job: Job): Promise<MatchRow[]> {
  const balance = loadBalanceFile(root + "data/balance.yaml");
  const map = loadMapFile(`${root}data/maps/${job.map}.json`);
  let nav: NavQuery | undefined;
  if (job.nav === "recast") {
    const { initRecast, navParams, RecastNav } = await import("../../packages/sim/src/nav/recast.ts");
    await initRecast();
    nav = RecastNav.build(map, navParams(balance, balance.hunter.radius));
  }
  const cfg = makeConfig(balance, map, { ruleset: "v1", hunterBrain: "utility", difficulty: job.difficulty, nav });
  return job.seeds.map(seed => {
    try {
      const r = playHeadless(cfg, seed);
      return { ...r, stuck: !!r.stuck.failAt, stuckWorst: r.stuck.worst, dither: r.stuck.dither, failAt: r.stuck.failAt };
    } catch (e) {
      return {
        seed, time: 0, team: null, reason: null, escaped: 0, captures: 0, transitions: {}, replans: 0, layout: "", chases: [], survivors: [],
        stuck: false, stuckWorst: 0, dither: 0, failAt: null, error: (e as Error).stack ?? String(e),
      };
    }
  });
}

const isValid = (from: string, to: string) => !!HUNTER_TRANSITIONS[from as HunterMode]?.includes(to as HunterMode);

/** joga todos os grupos (mapa × dificuldade) com as sementes seed0..seed0+n−1 */
async function runAll(maps: string[], diffs: Difficulty[], n: number, seed0: number, nav: Job["nav"], workers: number) {
  const rows: Record<string, MatchRow[]> = {};
  for (const map of maps) {
    for (const difficulty of diffs) {
      const seeds = Array.from({ length: n }, (_, i) => seed0 + i);
      const chunks = Array.from({ length: workers }, (_, w) => seeds.filter((_, i) => i % workers === w)).filter(c => c.length);
      const parts = await Promise.all(chunks.map(c => workers === 1 ? runJob({ map, difficulty, seeds: c, nav }) : new Promise<MatchRow[]>((ok, ko) => {
        const w = new Worker(new URL(import.meta.url), { workerData: { map, difficulty, seeds: c, nav } satisfies Job });
        w.once("message", ok); w.once("error", ko);
      })));
      rows[`${map}/${difficulty}`] = parts.flat().sort((a, b) => a.seed - b.seed);
    }
    if (diffs.length > 1) rows[`${map}${POOLED}`] = diffs.flatMap(d => rows[`${map}/${d}`]);
  }
  return rows;
}

if (!isMainThread) {
  parentPort!.postMessage(await runJob(workerData as Job));
} else {
  const argv = process.argv.slice(2);
  const flag = (k: string) => argv.includes(`--${k}`);
  const arg = (k: string, d: string) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
  const balance = loadBalanceFile(root + "data/balance.yaml");
  const sim = balance.sim, nightly = flag("nightly"), check = flag("check") || nightly;
  const n = Number(arg("n", String(nightly ? sim.nightly.matches_per_group : check ? sim.check.matches_per_group : 1000)));
  const seed0 = Number(arg("seed", String(check ? sim.check.seed : 1)));
  const diffArg = arg("difficulty", check ? "all" : "normal"), nav = arg("nav", "grid") as Job["nav"];
  const workers = Math.max(1, Number(arg("workers", String(Math.min(4, availableParallelism())))));
  const mapArg = arg("map", "all");
  const maps = mapArg === "all" ? readdirSync(root + "data/maps").filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort() : [mapArg];
  const diffs = diffArg === "all" ? (check ? sim.check.difficulties : DIFFS) : [diffArg as Difficulty];
  const noise = Number(arg("noise", "0"));
  if (!diffs.every(d => DIFFS.includes(d)) || !["grid", "recast"].includes(nav) || !(n > 0) || !Number.isInteger(seed0) || !(noise >= 0)) {
    console.error("argumentos inválidos; veja o cabeçalho de tools/sim/run.ts");
    process.exit(2);
  }
  const t0 = performance.now();
  if (noise > 0) {
    await noiseReport(maps, diffs, n, seed0, nav, workers, noise, sim.short_match_seconds);
    console.error(`tempo total ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    process.exit(0);
  }
  const rows = await runAll(maps, diffs, n, seed0, nav, workers);
  const groups: Record<string, GroupMetrics> = {};
  for (const [k, r] of Object.entries(rows)) groups[k] = groupMetrics(r, sim.short_match_seconds, isValid);
  // comando reproduzível (sem as opções que não mudam o resultado)
  const shown = argv.filter(a => !/^--(json=|md=|workers=|write-baseline$)/.test(a)).join(" ");
  const meta = {
    command: ({ "--check": "pnpm sim:check", "--nightly": "pnpm sim:nightly" } as Record<string, string>)[shown] ?? `pnpm sim ${shown}`.trim(),
    ruleset: "v1", hunter_brain: "utility", bot_brain: "prototype (updateBot de game.ts)", nav,
    maps, difficulties: diffs, matches_per_group: n, seeds: `${seed0}..${seed0 + n - 1} em todos os grupos`,
    short_match_seconds: sim.short_match_seconds,
  };

  let failed = false;
  const md: string[] = [`# Simulador — ${meta.command}`, "", "```json", JSON.stringify(meta, null, 1), "```", ""];
  for (const [k, m] of Object.entries(groups)) {
    const hard = hardFailures(m);
    if (hard.length) failed = true;
    const text = groupText(k, m, rows[k], hard);
    console.log(text.console);
    md.push(text.md, "");
  }

  const comparePath = flag("write-baseline") ? "" : arg("compare", check ? BASELINE : "");
  let comparison: ReturnType<typeof compare> | null = null;
  if (comparePath) {
    const baseline = JSON.parse(readFileSync(comparePath, "utf8")) as Baseline;
    comparison = compare(baseline, groups, sim.regression as Rules);
    const table = comparisonMarkdown(comparison.rows);
    console.log(`\n== comparação com ${comparePath.replace(root, "")} (tolerâncias de sim.regression, data/balance.yaml) ==\n${table}`);
    md.push(`## Comparação com a linha de base (\`${comparePath.replace(root, "")}\`)`, "", table, "");
    if (comparison.failed) failed = true;
  }
  if (flag("write-baseline")) {
    if (failed) { console.error("linha de base NÃO gravada: há falha dura (trava, exceção, sem fim ou transição fora do grafo)"); process.exit(1); }
    writeFileSync(BASELINE, JSON.stringify({ meta, groups } satisfies Baseline, null, 1) + "\n");
    console.log(`\nlinha de base gravada em data/sim/baseline.json`);
  }
  const json = arg("json", ""), mdPath = arg("md", "");
  const verdict = failed
    ? "FALHOU (trava, exceção, partida sem fim, transição fora do grafo ou métrica pior que a tolerância)"
    : "ok: sem trava, sem exceção, transições dentro do grafo" + (comparison ? ", nenhuma métrica pior que a tolerância" : "");
  md.push(`**Resultado:** ${verdict}`, "");
  if (json) writeFileSync(json, JSON.stringify({ meta, failed, groups, comparison, matches: rows }, null, 1));
  if (mdPath) writeFileSync(mdPath, md.join("\n"));
  console.error(`\ntempo total ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`\n${verdict}`);
  process.exit(failed ? 1 : 0);
}

function groupText(key: string, m: GroupMetrics, rows: MatchRow[], hard: string[]) {
  const pct = (v: number) => `${(100 * v).toFixed(1)}%`;
  const ok = rows.filter(r => !r.error);
  const times = ok.map(r => r.time);
  const shares = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k} ${pct(v)}`).join(", ") || "—";
  const lines: [string, string][] = [
    ["partidas", `${m.matches} (sementes ${rows[0]?.seed}..${rows.at(-1)?.seed})`],
    ["vitória do caçador por partida (meta D-16: 45–55%)", pct(m.hunter_win)],
    ["fuga por sobrevivente (só medida, D-16)", pct(m.survivor_escape)],
    ["duração média / mediana (§7.6: 6–8 min)", `${m.duration_mean.toFixed(1)} s / ${m.duration_median.toFixed(1)} s (mín ${Math.min(...times).toFixed(1)}, máx ${Math.max(...times).toFixed(1)})`],
    ["capturas por partida (§7.6: 1,5–2,5)", m.captures_per_match.toFixed(2)],
    ["partidas < 3 min (§7.6: < 5%)", pct(m.short_match_rate)],
    ["mediana de perseguição até a captura (§8.5: ≥ 15 s)", m.chase_median === null ? `— (${m.chase_count} episódios)` : `${m.chase_median.toFixed(1)} s (${m.chase_count} episódios)`],
    ["uso de classe (vagas; bots: sorteio fixo, 1 de cada)", shares(m.class_use)],
    ["classe do sobrevivente 0 (semente)", shares(m.first_class)],
    ["fuga por classe (informativo)", shares(m.class_escape)],
    ["fim", Object.entries(m.end_reasons).map(([k, v]) => `${k} ${v}`).join(", ")],
    ["travas (T-03) / exceções / sem fim", `${m.stuck} / ${m.errors} / ${m.unfinished}`],
    ["maior sequência abaixo do mínimo / vaivém máx (informativo)", `${Math.max(0, ...ok.map(r => r.stuckWorst)).toFixed(1)} s / ${Math.max(0, ...ok.map(r => r.dither)).toFixed(1)} s`],
    ["replanejamentos do anti-travamento", `${ok.reduce((s, r) => s + r.replans, 0)}`],
    ["transições fora do grafo (GDD-v0.3 §8.2)", m.invalid_transitions.length ? m.invalid_transitions.join(", ") : "nenhuma"],
  ];
  const details = [
    ...ok.filter(r => r.stuck).slice(0, 5).map(r => `  trava: semente ${r.seed} t=${r.failAt!.t.toFixed(1)} (${r.failAt!.x.toFixed(1)}, ${r.failAt!.z.toFixed(1)}) ${r.failAt!.mode}`),
    ...rows.filter(r => r.error).slice(0, 3).map(r => `  exceção: semente ${r.seed}\n${r.error}`),
    ...(hard.length ? [`  FALHA: ${hard.join("; ")}`] : []),
  ];
  return {
    console: [`\n== ${key} ==`, ...lines.map(([k, v]) => `${k}: ${v}`), ...details].join("\n"),
    md: [`## ${key}`, "", "| métrica | valor |", "| --- | --- |", ...lines.map(([k, v]) => `| ${k} | ${v} |`), ...(details.length ? ["", "```", ...details, "```"] : [])].join("\n"),
  };
}

/** desvio-padrão amostral */
function sd(xs: number[]): number {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
}

/** --noise=K: K lotes com sementes disjuntas; desvio de cada métrica por grupo e tolerância sugerida */
async function noiseReport(maps: string[], diffs: Difficulty[], n: number, seed0: number, nav: Job["nav"], workers: number, k: number, short: number) {
  const samples: Record<string, Record<string, number[]>> = {};
  for (let b = 0; b < k; b++) {
    const rows = await runAll(maps, diffs, n, seed0 + b * n, nav, workers);
    for (const [g, r] of Object.entries(rows)) {
      const m = groupMetrics(r, short, isValid);
      for (const metric of METRICS) {
        const v = m[metric];
        if (v === null) continue;
        ((samples[g] ??= {})[metric] ??= []).push(v);
      }
      ((samples[g] ??= {}).chase_count ??= []).push(m.chase_count);
    }
  }
  console.log(`ruído: ${k} lotes de ${n} partidas por grupo, sementes ${seed0}..${seed0 + k * n - 1}`);
  console.log("| grupo | métrica | média | desvio | valores |\n| --- | --- | --- | --- | --- |");
  const worst: Record<string, number> = {}, worstPooled: Record<string, number> = {};
  for (const [g, ms] of Object.entries(samples)) {
    for (const [metric, xs] of Object.entries(ms)) {
      const s = xs.length > 1 ? sd(xs) : NaN, mean = xs.reduce((a, x) => a + x, 0) / xs.length;
      const w = g.endsWith(POOLED) ? worstPooled : worst;
      if (Number.isFinite(s)) w[metric] = Math.max(w[metric] ?? 0, s);
      console.log(`| ${g} | ${metric} | ${mean.toFixed(4)} | ${Number.isFinite(s) ? s.toFixed(4) : "—"} (${xs.length} lotes) | ${xs.map(x => x.toFixed(3)).join(" ")} |`);
    }
  }
  console.log("\ntolerância sugerida = 3 × √2 × maior desvio (max_worsening: grupos de 1 dificuldade; pooled_max_worsening: \"mapa/all\"):");
  for (const [metric, s] of Object.entries(worst)) {
    const p = worstPooled[metric] ?? 0;
    console.log(`  ${metric}: desvio máx ${s.toFixed(4)} → ${(3 * Math.SQRT2 * s).toFixed(4)} · agregado ${p.toFixed(4)} → ${(3 * Math.SQRT2 * p).toFixed(4)}`);
  }
}
