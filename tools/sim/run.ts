// Simulador headless mínimo (item R3; o R5 completa com métricas de balanceamento e porta de regressão, GDD-v0.3 C-15).
// Roda N partidas do ruleset v1 com a IA do caçador (`ai.hunter_brain: utility`) e os bots atuais em todas as vagas
// de sobrevivente, e confere o aceite T-03 (GDD-v0.3 §8.6): nenhuma trava (`ai.stuck_fail_after`), nenhuma exceção
// e nenhuma transição de estado fora do grafo do §8.2. Sai com código 1 se algum falhar.
//
// Uso: pnpm sim [--n=1000] [--seed=1] [--difficulty=normal|easy|hard|nightmare|all] [--map=patio]
//               [--workers=4] [--nav=grid|recast] [--bot-brain=prototype|competent] [--json=saida.json]
import { readdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { loadBalanceFile, loadMapFile } from "../../packages/shared/src/node.ts";
import { HUNTER_TRANSITIONS, makeConfig, playHeadless, type HeadlessResult, type HunterMode } from "../../packages/sim/src/index.ts";
import type { NavQuery } from "../../packages/sim/src/nav/index.ts";

type Difficulty = "easy" | "normal" | "hard" | "nightmare";
const DIFFS: Difficulty[] = ["easy", "normal", "hard", "nightmare"];
const root = fileURLToPath(new URL("../../", import.meta.url));

interface Job { map: string; difficulty: Difficulty; seeds: number[]; nav: "grid" | "recast"; botBrain?: "prototype" | "competent" }
interface Row extends Omit<HeadlessResult, "stuck"> { stuck: boolean; stuckWorst: number; dither: number; failAt: HeadlessResult["stuck"]["failAt"]; error?: string }

async function runJob(job: Job): Promise<Row[]> {
  const balance = loadBalanceFile(root + "data/balance.yaml");
  const map = loadMapFile(`${root}data/maps/${job.map}.json`);
  let nav: NavQuery | undefined;
  if (job.nav === "recast") {
    const { initRecast, navParams, RecastNav } = await import("../../packages/sim/src/nav/recast.ts");
    await initRecast();
    nav = RecastNav.build(map, navParams(balance, balance.hunter.radius));
  }
  const cfg = makeConfig(balance, map, { ruleset: "v1", hunterBrain: "utility", difficulty: job.difficulty, nav, botBrain: job.botBrain });
  return job.seeds.map(seed => {
    try {
      const r = playHeadless(cfg, seed);
      return { ...r, stuck: !!r.stuck.failAt, stuckWorst: r.stuck.worst, dither: r.stuck.dither, failAt: r.stuck.failAt };
    } catch (e) {
      return {
        seed, time: 0, team: null, reason: null, escaped: 0, captures: 0, transitions: {}, replans: 0, layout: "", chases: [],
        stuck: false, stuckWorst: 0, dither: 0, failAt: null, error: (e as Error).stack ?? String(e),
      };
    }
  });
}

if (!isMainThread) {
  parentPort!.postMessage(await runJob(workerData as Job));
} else {
  const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
  const n = Number(arg("n", "1000")), seed0 = Number(arg("seed", "1"));
  const diffArg = arg("difficulty", "normal"), nav = arg("nav", "grid") as Job["nav"];
  const botArg = arg("bot-brain", ""), botBrain = botArg ? botArg as NonNullable<Job["botBrain"]> : undefined;
  const workers = Math.max(1, Number(arg("workers", String(Math.min(4, availableParallelism())))));
  const maps = arg("map", "all") === "all" ? readdirSync(root + "data/maps").filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort() : [arg("map", "")];
  const diffs = diffArg === "all" ? DIFFS : [diffArg as Difficulty];
  if (!diffs.every(d => DIFFS.includes(d)) || !["grid", "recast"].includes(nav) || !(n > 0) || (botBrain && !["prototype", "competent"].includes(botBrain))) {
    console.error("argumentos inválidos; veja o cabeçalho de tools/sim/run.ts");
    process.exit(2);
  }
  const t0 = performance.now();
  let failed = false;
  const all: Record<string, Row[]> = {};
  for (const map of maps) for (const difficulty of diffs) {
    const seeds = Array.from({ length: n }, (_, i) => seed0 + i);
    const chunks = Array.from({ length: workers }, (_, w) => seeds.filter((_, i) => i % workers === w)).filter(c => c.length);
    const parts = await Promise.all(chunks.map(c => workers === 1 ? runJob({ map, difficulty, seeds: c, nav, botBrain }) : new Promise<Row[]>((ok, ko) => {
      const w = new Worker(new URL(import.meta.url), { workerData: { map, difficulty, seeds: c, nav, botBrain } satisfies Job });
      w.once("message", ok); w.once("error", ko);
    })));
    const rows = parts.flat().sort((a, b) => a.seed - b.seed);
    all[`${map}/${difficulty}`] = rows;
    failed = report(map, difficulty, nav, rows) || failed;
  }
  console.log(`\ntempo total ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  const json = arg("json", "");
  if (json) writeFileSync(json, JSON.stringify(all, null, 1));
  console.log(failed ? "FALHOU (trava, exceção ou transição fora do grafo)" : "ok: sem trava, sem exceção, transições dentro do grafo");
  process.exit(failed ? 1 : 0);
}

function report(map: string, difficulty: string, nav: string, rows: Row[]): boolean {
  const ok = rows.filter(r => !r.error);
  const pct = (k: number) => `${((100 * k) / Math.max(1, ok.length)).toFixed(1)}%`;
  const mean = (f: (r: Row) => number) => ok.reduce((s, r) => s + f(r), 0) / Math.max(1, ok.length);
  const errors = rows.filter(r => r.error), stuck = ok.filter(r => r.stuck);
  const trans: Record<string, number> = {};
  for (const r of ok) for (const [k, v] of Object.entries(r.transitions)) trans[k] = (trans[k] ?? 0) + v;
  const invalid = Object.keys(trans).filter(k => {
    const [from, to] = k.split(">") as [HunterMode, HunterMode];
    return !HUNTER_TRANSITIONS[from]?.includes(to);
  });
  const reasons: Record<string, number> = {};
  for (const r of ok) reasons[r.reason ?? "sem fim"] = (reasons[r.reason ?? "sem fim"] ?? 0) + 1;
  const times = ok.map(r => r.time);
  console.log(`\n== ${map} · ${difficulty} · ${rows.length} partidas (sementes ${rows[0]?.seed}..${rows.at(-1)?.seed}) · ${nav === "grid" ? "grade A*" : "navmesh"} ==`);
  console.log(`duração média ${mean(r => r.time).toFixed(1)} s (mín ${Math.min(...times).toFixed(1)}, máx ${Math.max(...times).toFixed(1)})`);
  console.log(`vitória do caçador ${pct(ok.filter(r => r.team === "hunter").length)} · da equipe ${pct(ok.filter(r => r.team === "survivors").length)}`);
  console.log(`fim: ${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`capturas por partida ${mean(r => r.captures).toFixed(2)} · escapados por partida ${mean(r => r.escaped).toFixed(2)}`);
  console.log(`travas (T-03, > ai.stuck_fail_after): ${stuck.length} · maior sequência abaixo do mínimo ${Math.max(0, ...ok.map(r => r.stuckWorst)).toFixed(1)} s · vaivém máx (informativo) ${Math.max(0, ...ok.map(r => r.dither)).toFixed(1)} s`);
  console.log(`replanejamentos do anti-travamento: ${ok.reduce((s, r) => s + r.replans, 0)} (${mean(r => r.replans).toFixed(1)} por partida)`);
  const median = (xs: number[]) => { const v = [...xs].sort((a, b) => a - b); return v.length ? (v[(v.length - 1) >> 1] + v[v.length >> 1]) / 2 : NaN; };
  const chases = ok.flatMap(r => r.chases);
  console.log(`perseguição antes da captura (alvo visto ou lembrado, D-35; aceite §8.5 ≥ 15 s): mediana ${median(chases).toFixed(1)} s (n=${chases.length})`);
  console.log(`exceções: ${errors.length}`);
  console.log(`transições: ${Object.entries(trans).sort().map(([k, v]) => `${k.replace(">", "→")} ${v}`).join(", ")}`);
  console.log(`transições fora do grafo (GDD-v0.3 §8.2): ${invalid.length ? invalid.join(", ") : "nenhuma"}`);
  for (const r of stuck.slice(0, 5)) console.log(`  trava: semente ${r.seed} t=${r.failAt!.t.toFixed(1)} (${r.failAt!.x.toFixed(1)}, ${r.failAt!.z.toFixed(1)}) ${r.failAt!.mode}`);
  for (const r of errors.slice(0, 3)) console.log(`  exceção: semente ${r.seed}\n${r.error}`);
  return stuck.length > 0 || errors.length > 0 || invalid.length > 0;
}
