// Relatório do telegraph sonoro (A-5; GDD-v0.3 §11 "≥ 0,4 s antes do efeito"): roda partidas headless do ruleset v1
// com o diretor de áudio real (sem Web Audio: o efeito só é registrado) e mede, por tipo de habilidade, quantos efeitos
// houve, quantos tiveram o preparo dentro do raio audível (D-37), quantos saíram sem telegraph e, como informação, a
// antecedência entre o início do preparo e o efeito. Pela D-36 a garantia ≥ telegraph_min é teste da simulação
// (Frente R); a prova do áudio na CI é packages/client/test/audio-telegraph.test.ts.
//
// Uso: pnpm exec tsx tools/audio/telegraph.ts [--n=20] [--seed=1] [--difficulty=normal|…|all] [--brain=utility|basic]
import { fileURLToPath } from "node:url";
import { loadBalanceFile, loadMapFile } from "../../packages/shared/src/node.ts";
import { makeConfig, STEP, type Difficulty, type HunterBrain } from "../../packages/sim/src/index.ts";
import { createAudioDirector } from "../../packages/client/src/audio/director.ts";
import { ABILITY_KINDS, measureTelegraph } from "../../packages/client/src/audio/testing/headless.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const DIFFS: Difficulty[] = ["easy", "normal", "hard", "nightmare"];
const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const n = Number(arg("n", "20")), seed0 = Number(arg("seed", "1"));
const diffArg = arg("difficulty", "all"), brain = arg("brain", "utility") as HunterBrain;
const diffs = diffArg === "all" ? DIFFS : [diffArg as Difficulty];
if (!(n > 0) || !diffs.every(d => DIFFS.includes(d)) || !["utility", "basic"].includes(brain)) {
  console.error("argumentos inválidos; veja o cabeçalho de tools/audio/telegraph.ts");
  process.exit(2);
}
const balance = loadBalanceFile(root + "data/balance.yaml");
const map = loadMapFile(root + "data/maps/patio.json");
const seeds = Array.from({ length: n }, (_, i) => seed0 + i);
const min = balance.hunter.telegraph_min;
const music = { update: () => undefined, duckFor: () => undefined };

console.log(`telegraph — ruleset v1, hunter_brain ${brain}, ${n} partidas por dificuldade; telegraph_min ${min} s, passo ${STEP.toFixed(4)} s`);
for (const difficulty of diffs) {
  const cfg = makeConfig(balance, map, { ruleset: "v1", hunterBrain: brain, difficulty });
  const rep = measureTelegraph(cfg, seeds, balance.audio.director.hunter_audible_radius, play => createAudioDirector({ play: (nm, o) => { play(nm, o); return null; }, music, cfg: balance, enabled: true }), () => true);
  const cols = ABILITY_KINDS.map(k => {
    const s = rep.byKind[k];
    return `${k} ${s.n} (audíveis ${s.audible}, sem telegraph ${s.missing}, antecedência mín ${Number.isFinite(s.minLead) ? s.minLead.toFixed(4) : "—"} s)`;
  });
  console.log(`${difficulty.padEnd(10)} ${cols.join(" | ")}${rep.mismatches.length ? ` | divergências ${rep.mismatches.length}` : ""}`);
}
