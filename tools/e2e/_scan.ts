import { readFileSync } from "node:fs";
import type { GameMap } from "../../packages/shared/src/index.ts";
import { loadBalanceFile } from "../../packages/shared/src/node.ts";
import { makeConfig, createGame, step, NO_INPUT } from "../../packages/sim/src/index.ts";
const bal = loadBalanceFile("data/balance.yaml");
const map = JSON.parse(readFileSync("data/maps/patio.json", "utf8")) as GameMap;
const cfg = makeConfig(bal, map, { ruleset: "v1" });
const out: [number, number, string, number][] = [];
for (let seed = 1; seed <= 3000; seed++) {
  const g = createGame(cfg, "Curandeiro", seed);
  for (let i = 0; i < 60 * 15; i++) {
    step(cfg, g, NO_INPUT);
    if (g.hunter.windup) { const p = g.survivors[0]; out.push([g.t, seed, g.hunter.windup.kind, Math.hypot(p.x - g.hunter.x, p.z - g.hunter.z)]); break; }
  }
}
out.sort((a, b) => a[0] - b[0]);
console.log(out.slice(0, 10).map(r => r.map(x => typeof x === "number" ? +x.toFixed(2) : x).join(" ")).join("\n"));
console.log("1234:", out.find(r => r[1] === 1234));
