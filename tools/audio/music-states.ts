// Medição pedida na D-26 (docs/plano-construcao.md §7): fração do tempo de partida em cada estado musical
// (musicStateFor do A-2, packages/client/src/audio/musicState.ts) para o jogador 0, em partidas headless do ruleset v1
// montadas como tools/sim/run.ts. Alerta se "rescue" passar de 40% (gatilho de revisão da D-26).
//
// Uso: pnpm exec tsx tools/audio/music-states.ts [--n=50] [--seed=1] [--difficulty=normal|easy|hard|nightmare|all]
//                                                [--brain=utility|basic]
import { fileURLToPath } from "node:url";
import { loadBalanceFile, loadMapFile } from "../../packages/shared/src/node.ts";
import { makeConfig, type Difficulty, type HunterBrain } from "../../packages/sim/src/index.ts";
import { MUSIC_STATES, musicStateFor, type MusicState } from "../../packages/client/src/audio/musicState.ts";
import { runMatch } from "../../packages/client/src/audio/testing/headless.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const DIFFS: Difficulty[] = ["easy", "normal", "hard", "nightmare"];
/** D-26: "se o resgate passar de ~40% do tempo de partida, revisar" */
const RESCUE_ALERT = 0.4;

const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const n = Number(arg("n", "50")), seed0 = Number(arg("seed", "1"));
const diffArg = arg("difficulty", "all"), brain = arg("brain", "utility") as HunterBrain;
const diffs = diffArg === "all" ? DIFFS : [diffArg as Difficulty];
if (!(n > 0) || !diffs.every(d => DIFFS.includes(d)) || !["utility", "basic"].includes(brain)) {
  console.error("argumentos inválidos; veja o cabeçalho de tools/audio/music-states.ts");
  process.exit(2);
}

const balance = loadBalanceFile(root + "data/balance.yaml");
const map = loadMapFile(root + "data/maps/patio.json");
const pct = (x: number) => `${(x * 100).toFixed(1).padStart(5)}%`;
const total: Record<MusicState, number> = Object.fromEntries(MUSIC_STATES.map(s => [s, 0])) as Record<MusicState, number>;
let alert = false;

console.log(`estados musicais do jogador 0 — ruleset v1, hunter_brain ${brain}, ${n} partidas por dificuldade (sementes ${seed0}…${seed0 + n - 1})`);
console.log(`dificuldade  ${MUSIC_STATES.map(s => s.padStart(16)).join("")}   partidas c/ rescue > 40%`);
for (const difficulty of diffs) {
  const cfg = makeConfig(balance, map, { ruleset: "v1", hunterBrain: brain, difficulty });
  const acc: Record<MusicState, number> = Object.fromEntries(MUSIC_STATES.map(s => [s, 0])) as Record<MusicState, number>;
  let over40 = 0, captures = 0, matchTime = 0;
  for (let seed = seed0; seed < seed0 + n; seed++) {
    const one: Record<string, number> = {};
    let time = 0;
    const end = runMatch(cfg, seed, (g, dt) => {
      const s = musicStateFor(g, 0, balance.audio.music);
      one[s] = (one[s] ?? 0) + dt;
      time += dt;
    });
    captures += end.survivors.reduce((a, s) => a + s.captures, 0);
    matchTime += time;
    for (const s of MUSIC_STATES) acc[s] += one[s] ?? 0;
    if ((one.rescue ?? 0) / time > RESCUE_ALERT) over40++;
  }
  const sum = MUSIC_STATES.reduce((a, s) => a + acc[s], 0);
  for (const s of MUSIC_STATES) total[s] += acc[s];
  console.log(`${difficulty.padEnd(12)} ${MUSIC_STATES.map(s => pct(acc[s] / sum).padStart(16)).join("")}   ${over40}/${n}   (média: ${(matchTime / n).toFixed(0)} s, ${(captures / n).toFixed(2)} prisões por partida)`);
  if (acc.rescue / sum > RESCUE_ALERT) alert = true;
}
const all = MUSIC_STATES.reduce((a, s) => a + total[s], 0);
console.log(`${"todas".padEnd(12)} ${MUSIC_STATES.map(s => pct(total[s] / all).padStart(16)).join("")}`);
if (alert || total.rescue / all > RESCUE_ALERT) console.log(`ALERTA D-26: rescue acima de ${RESCUE_ALERT * 100}% do tempo de partida`);
else console.log(`rescue abaixo de ${RESCUE_ALERT * 100}% em todas as dificuldades`);
