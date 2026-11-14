// Humano × bot competente (R8, relatório humano). Lê de 1 a 5 relatórios de `matchReport` (JSON de packages/sim,
// report.ts: as partidas do dono do projeto no staging) e, para cada grupo de dificuldade × classe da vaga 0 × mapa ×
// flags de mapa presente neles, joga N partidas headless com bots competentes (`ai.bot_brain: competent` em todas as
// vagas, a vaga 0 com a mesma classe) e imprime lado a lado as medianas: tempo por quebra-cabeça RESOLVIDO (vaga 0,
// tempo ativo do acerto + tentativas erradas anteriores no mesmo gerador; por tentativa só informativo), tempo por gerador (obrigatórios concluídos, do primeiro trabalho ao
// pronto), duração da partida, capturas e perseguições da vaga 0 por partida, e a fuga da vaga 0. Destaca se o tempo
// humano por quebra-cabeça cai na meta `generator.puzzle_time_target.full` (GDD-v0.2 §6.2 L141: 12–18 s).
// Recusa relatórios do Treino (`mode: "tutorial"`); partida inacabada (`over: false`) gera aviso e fica fora das medianas.
//
// Uso:  pnpm exec tsx tools/sim/compare-human.ts rel1.json [rel2.json … rel5.json] [--n=200] [--workers=2] [--seed=1] [--json=saida.json]
//       (acima de 50 partidas: `flock /tmp/claude-0/heavy.lock pnpm exec tsx tools/sim/compare-human.ts … --workers=2`)
//       pnpm exec tsx tools/sim/compare-human.ts --bot-report=saida.json [--class=Mecânico] [--difficulty=normal] [--seed=1]
//       grava o relatório de uma partida de bot (tools/sim/fixtures/bot-report.json = --class=Curandeiro --difficulty=normal --seed=3)
// No cliente: createGame(cfg, cls, seed, { report: true }) e, no evento "end" (depois do último step), salve
// JSON.stringify(matchReport(G)) — um arquivo por partida; é ele que entra aqui. Formato: packages/sim/src/report.ts
// (MatchReport, `version`). Vaga 0 = humano; "bot" = a mesma vaga jogada pelo bot competente.
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { loadBalanceFile, loadMapFile } from "../../packages/shared/src/node.ts";
import type { Balance } from "../../packages/shared/src/schema.ts";
import { CLASSES, makeConfig, playHeadlessReport, puzzleSolves, REPORT_VERSION, type ClassName, type MatchReport } from "../../packages/sim/src/index.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
type Difficulty = Balance["difficulty"];
type MapFlags = Balance["maps"]["v1"];

interface Group { difficulty: Difficulty; cls: ClassName; map: string; mapFlags: MapFlags | null; hunterBrain: MatchReport["hunterBrain"] }
interface Job extends Group { seeds: number[] }

function config(group: Group) {
  const balance = loadBalanceFile(root + "data/balance.yaml");
  const map = loadMapFile(`${root}data/maps/${group.map}.json`);
  return makeConfig(balance, map, {
    ruleset: "v1", difficulty: group.difficulty, hunterBrain: group.hunterBrain, botBrain: "competent", ...(group.mapFlags ? { mapFlags: group.mapFlags } : {}),
  });
}

function runJob(job: Job): MatchReport[] {
  const cfg = config(job);
  return job.seeds.map(seed => playHeadlessReport(cfg, job.cls, seed));
}

const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface Side {
  matches: number;
  /**
   * mediana do tempo por quebra-cabeça RESOLVIDO da vaga 0 (`puzzleSolves` de report.ts: tentativas erradas
   * anteriores no mesmo gerador somadas ao acerto; todas as partidas juntas). É a métrica da meta 12–18 s.
   */
  puzzle: number | null; puzzleN: number;
  /** informativo: mediana por tentativa terminada (acerto ou erro) */
  attempt: number | null; attemptN: number;
  /** mediana da duração dos obrigatórios concluídos (primeiro trabalho → pronto) */
  generator: number | null; generatorN: number;
  duration: number | null;
  /** medianas por partida (vaga 0) */
  captures: number | null;
  chases: number | null;
  /** mediana da duração das perseguições à vaga 0 */
  chaseTime: number | null;
  /** fração das partidas em que a vaga 0 escapou */
  escape: number;
}

/** medianas de um lado (humano ou bot) a partir dos relatórios */
export function summarize(reports: readonly MatchReport[]): Side {
  const puzzles = reports.flatMap(r => puzzleSolves(r.human.puzzles).map(p => p.time));
  const attempts = reports.flatMap(r => r.human.puzzles.filter(p => p.result !== "abandoned").map(p => p.time));
  const gens = reports.flatMap(r => r.team.generators.filter(x => !x.bonus && x.duration !== null).map(x => x.duration!));
  return {
    matches: reports.length,
    puzzle: median(puzzles), puzzleN: puzzles.length,
    attempt: median(attempts), attemptN: attempts.length,
    generator: median(gens), generatorN: gens.length,
    duration: median(reports.map(r => r.duration)),
    captures: median(reports.map(r => r.human.captures.length)),
    chases: median(reports.map(r => r.human.chases.length)),
    chaseTime: median(reports.flatMap(r => r.human.chases.map(c => c.duration))),
    escape: reports.length ? reports.filter(r => r.human.state === "out").length / reports.length : 0,
  };
}

const groupKey = (g: Group) => JSON.stringify([g.difficulty, g.cls, g.map, g.mapFlags, g.hunterBrain]);

/** grupos presentes nos relatórios (dificuldade × classe da vaga 0 × mapa × flags × cérebro do caçador) */
export function groupsOf(reports: readonly MatchReport[]): { group: Group; reports: MatchReport[] }[] {
  const out = new Map<string, { group: Group; reports: MatchReport[] }>();
  for (const r of reports) {
    const group: Group = { difficulty: r.difficulty, cls: r.human.cls, map: r.map, mapFlags: r.mapFlags, hunterBrain: r.hunterBrain };
    const k = groupKey(group);
    if (!out.has(k)) out.set(k, { group, reports: [] });
    out.get(k)!.reports.push(r);
  }
  return [...out.values()];
}

/** tabela lado a lado (texto) e o veredito da meta do tempo por quebra-cabeça */
export function sideBySide(group: Group, human: Side, bot: Side, target: readonly [number, number]): string {
  const s = (v: number | null, unit = "") => (v === null ? "—" : `${v.toFixed(1)}${unit}`);
  const pct = (v: number) => `${(100 * v).toFixed(0)}%`;
  const rows: [string, string, string][] = [
    ["partidas", `${human.matches}`, `${bot.matches}`],
    ["tempo por quebra-cabeça resolvido (mediana)", `${s(human.puzzle, " s")} (${human.puzzleN})`, `${s(bot.puzzle, " s")} (${bot.puzzleN})`],
    ["tempo por tentativa, acerto ou erro (mediana)", `${s(human.attempt, " s")} (${human.attemptN})`, `${s(bot.attempt, " s")} (${bot.attemptN})`],
    ["tempo por gerador obrigatório (mediana)", `${s(human.generator, " s")} (${human.generatorN})`, `${s(bot.generator, " s")} (${bot.generatorN})`],
    ["duração da partida (mediana)", s(human.duration, " s"), s(bot.duration, " s")],
    ["capturas da vaga 0 por partida (mediana)", s(human.captures), s(bot.captures)],
    ["perseguições à vaga 0 por partida (mediana)", s(human.chases), s(bot.chases)],
    ["duração da perseguição à vaga 0 (mediana)", s(human.chaseTime, " s"), s(bot.chaseTime, " s")],
    ["fuga da vaga 0", pct(human.escape), pct(bot.escape)],
  ];
  const w0 = Math.max(...rows.map(r => r[0].length)), w1 = Math.max("humano".length, ...rows.map(r => r[1].length));
  const line = (a: string, b: string, c: string) => `${a.padEnd(w0)} | ${b.padStart(w1)} | ${c}`;
  const flags = group.mapFlags ? Object.entries(group.mapFlags).filter(([, v]) => v).map(([k]) => k).join(",") || "nenhuma" : "protótipo";
  const [lo, hi] = target;
  const verdict = human.puzzle === null ? `SEM DADO: nenhum quebra-cabeça humano resolvido (meta ${lo}–${hi} s)`
    : human.puzzle >= lo && human.puzzle <= hi ? `DENTRO da meta: ${s(human.puzzle, " s")} em ${lo}–${hi} s (GDD-v0.2 §6.2)`
      : `FORA da meta: ${s(human.puzzle, " s")} fora de ${lo}–${hi} s (GDD-v0.2 §6.2)`;
  return [
    `== ${group.difficulty} · ${group.cls} · ${group.map} · flags ${flags} ==`,
    line("métrica", "humano", "bot competente"),
    line("-".repeat(w0), "-".repeat(w1), "-".repeat(14)),
    ...rows.map(r => line(...r)),
    `>> tempo humano por quebra-cabeça resolvido: ${verdict}`,
  ].join("\n");
}

async function runGroup(group: Group, n: number, seed0: number, workers: number): Promise<MatchReport[]> {
  const seeds = Array.from({ length: n }, (_, i) => seed0 + i);
  const chunks = Array.from({ length: workers }, (_, w) => seeds.filter((_, i) => i % workers === w)).filter(c => c.length);
  const parts = await Promise.all(chunks.map(c => workers === 1 ? runJob({ ...group, seeds: c }) : new Promise<MatchReport[]>((ok, ko) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { ...group, seeds: c } satisfies Job });
    w.once("message", ok); w.once("error", ko);
  })));
  return parts.flat();
}

/** lê e valida um relatório: versão atual, ruleset v1 e partida normal (o Treino nunca é comparado com o bot) */
export function readReport(path: string): MatchReport {
  const r = JSON.parse(readFileSync(path, "utf8")) as MatchReport;
  if (r.version !== REPORT_VERSION) throw new Error(`${path}: relatório versão ${r.version}, esperado ${REPORT_VERSION}`);
  if (r.mode !== "normal") throw new Error(`${path}: relatório do modo "${r.mode}" (Treino); só partidas normais são comparáveis aos bots`);
  if (r.ruleset !== "v1") throw new Error(`${path}: só o ruleset v1 é comparável aos bots competentes`);
  return r;
}

/**
 * separa as partidas comparáveis: ficam fora das medianas, com aviso, as inacabadas (`over: false`) e as com o
 * quebra-cabeça acessível (`accessiblePuzzles: true`, GDD-v0.3 §12.4: outro quebra-cabeça, sem par entre os bots).
 * Relatórios anteriores ao campo não o têm: contam como normais.
 */
export function finishedOnly(reports: readonly { path: string; report: MatchReport }[]): { kept: MatchReport[]; warnings: string[] } {
  const warnings: string[] = [], kept: MatchReport[] = [];
  for (const { path, report: r } of reports) {
    if (!r.over) warnings.push(`aviso: ${path} é de partida inacabada (over: false, ${r.duration.toFixed(1)} s); fica fora das medianas`);
    else if (r.accessiblePuzzles === true) warnings.push(`aviso: ${path} usou o quebra-cabeça acessível (accessiblePuzzles: true); fica fora das medianas contra o bot normal`);
    else kept.push(r);
  }
  return { kept, warnings };
}

if (!isMainThread) {
  parentPort!.postMessage(runJob(workerData as Job));
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const arg = (k: string, d: string) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
  const paths = argv.filter(a => !a.startsWith("--"));
  const seed0 = Number(arg("seed", "1"));
  const balance = loadBalanceFile(root + "data/balance.yaml");
  const botOut = arg("bot-report", "");
  if (botOut) {
    const cls = arg("class", CLASSES[0]) as ClassName, difficulty = arg("difficulty", balance.difficulty) as Difficulty;
    if (!CLASSES.includes(cls) || !(difficulty in balance.difficulty_table) || !Number.isInteger(seed0)) {
      console.error("argumentos inválidos; veja o cabeçalho de tools/sim/compare-human.ts");
      process.exit(2);
    }
    const r = playHeadlessReport(config({ difficulty, cls, map: "patio", mapFlags: null, hunterBrain: balance.ai.hunter_brain }), cls, seed0);
    writeFileSync(botOut, JSON.stringify(r, null, 1) + "\n");
    console.log(`relatório de bot gravado em ${botOut}`);
    process.exit(0);
  }
  const n = Number(arg("n", "200")), workers = Math.max(1, Number(arg("workers", "2")));
  if (paths.length < 1 || paths.length > 5 || !(n > 0) || !Number.isInteger(n) || !Number.isInteger(seed0) || !Number.isInteger(workers)) {
    console.error("uso: tsx tools/sim/compare-human.ts rel1.json [… rel5.json] [--n=200] [--workers=2] [--seed=1] [--json=saida.json]");
    process.exit(2);
  }
  let read: { path: string; report: MatchReport }[];
  try { read = paths.map(path => ({ path, report: readReport(path) })); } catch (e) { console.error((e as Error).message); process.exit(2); }
  const { kept: reports, warnings } = finishedOnly(read);
  for (const w of warnings) console.error(w);
  if (!reports.length) { console.error("nenhum relatório de partida terminada para comparar"); process.exit(2); }
  const target = balance.generator.puzzle_time_target.full as [number, number];
  const out: { group: Group; human: Side; bot: Side }[] = [];
  for (const { group, reports: rs } of groupsOf(reports)) {
    const bots = await runGroup(group, n, seed0, workers);
    const human = summarize(rs), bot = summarize(bots);
    out.push({ group, human, bot });
    console.log(sideBySide(group, human, bot, target) + "\n");
  }
  console.log(`bots: ${n} partidas por grupo, sementes ${seed0}..${seed0 + n - 1}, ai.bot_brain competent em todas as vagas`);
  const json = arg("json", "");
  if (json) writeFileSync(json, JSON.stringify({ version: REPORT_VERSION, n, seed: seed0, target, groups: out }, null, 1) + "\n");
}
