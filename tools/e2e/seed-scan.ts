// Escolha da semente do e2e da D-45 (tools/e2e/espera-personagens.mjs, constante SEED). Roda partidas headless
// (createGame + step com o jogador parado, NO_INPUT, como o cliente sem teclas) nas regras v1 com a classe padrão do
// menu e lista as sementes cujo primeiro preparo do caçador (hunter.windup) vem mais cedo, com a distância do
// caçador ao jogador nesse passo (o telegraph sonoro só é obrigatório dentro de audio.director.hunter_audible_radius,
// D-37). Uso: pnpm exec tsx tools/e2e/seed-scan.ts [sementes]   (padrão 3000)
import { readFileSync } from "node:fs";
import type { GameMap } from "../../packages/shared/src/index.ts";
import { loadBalanceFile } from "../../packages/shared/src/node.ts";
import { makeConfig, createGame, step, NO_INPUT } from "../../packages/sim/src/index.ts";

const root = new URL("../../", import.meta.url);
const bal = loadBalanceFile(new URL("data/balance.yaml", root).pathname);
const map = JSON.parse(readFileSync(new URL("data/maps/patio.json", root), "utf8")) as GameMap;
const cfg = makeConfig(bal, map, { ruleset: "v1" });
const N = Number(process.argv[2] ?? 3000);
/** horizonte da busca: 15 s de partida a 60 passos por segundo (GDD-v0.3 §13.3) */
const STEPS = 15 * bal.net.sim_step_hz;
const out: { t: number; seed: number; kind: string; dist: number }[] = [];
for (let seed = 1; seed <= N; seed++) {
  const g = createGame(cfg, "Curandeiro", seed);
  for (let i = 0; i < STEPS; i++) {
    step(cfg, g, NO_INPUT);
    const w = g.hunter.windup;
    if (w) { const p = g.survivors[0]; out.push({ t: g.t, seed, kind: w.kind, dist: Math.hypot(p.x - g.hunter.x, p.z - g.hunter.z) }); break; }
  }
}
out.sort((a, b) => a.t - b.t);
const R = bal.audio.director.hunter_audible_radius;
for (const r of out.slice(0, 10)) console.log(`semente ${r.seed}: ${r.kind} em G.t = ${r.t.toFixed(2)} s, caçador a ${r.dist.toFixed(1)} m${r.dist <= R ? "" : ` (> ${R} m)`}`);
