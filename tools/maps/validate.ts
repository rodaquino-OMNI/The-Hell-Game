// Validador de mapas (GDD v0.3 §9.1 e §9.3; item R2/F1-04). Roda todas as regras da tabela de métricas
// em todos os mapas de data/maps e em todas as combinações de layout (geradores × gaiola × saída),
// com o navmesh do recast e com a grade A* de reserva. Falha (código 1) se alguma regra falhar.
// Uso: pnpm maps:validate [--nav=recast|grid|both] [mapa...]
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadBalanceFile, loadMapFile } from "../../packages/shared/src/node.ts";
import { allLayoutChoices, gridBackend, validateMap, type NavBackend } from "../../packages/sim/src/nav/index.ts";
import { initRecast, recastBackend } from "../../packages/sim/src/nav/recast.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const navArg = args.find(a => a.startsWith("--nav="))?.slice(6) ?? "both";
const only = args.filter(a => !a.startsWith("--"));
if (!["recast", "grid", "both"].includes(navArg)) {
  console.error(`--nav inválido: ${navArg} (use recast, grid ou both)`);
  process.exit(2);
}

const balance = loadBalanceFile(root + "data/balance.yaml");
const backends: NavBackend[] = [];
if (navArg !== "grid") {
  try {
    await initRecast();
    backends.push(recastBackend(balance));
  } catch (e) {
    // GDD v0.3 §8.6: a grade de 0,5 m é a reserva quando o navmesh não está disponível
    console.warn(`AVISO: WASM do recast indisponível (${(e as Error).message}); usando só a grade A* de reserva`);
    if (navArg === "recast") process.exit(1);
  }
}
if (navArg !== "recast") backends.push(gridBackend(balance));

const files = readdirSync(root + "data/maps").filter(f => f.endsWith(".json")).sort();
let failures = 0, lacunas = 0;
for (const f of files) {
  const map = loadMapFile(root + "data/maps/" + f);
  if (only.length && !only.includes(map.id)) continue;
  const combos = allLayoutChoices(map).length;
  for (const b of backends) {
    console.log(`\n== ${map.name} (${map.id}) · ${b.name} · ${combos} combinações de layout ==`);
    for (const r of validateMap(map, balance, b)) {
      const tag = r.status === "ok" ? "ok    " : r.status === "falha" ? "FALHA " : "LACUNA";
      console.log(`${tag} ${r.rule}: ${r.detail}`);
      if (r.status === "falha") failures++;
      if (r.status === "lacuna") lacunas++;
    }
  }
}
console.log(`\n${failures ? `FALHOU: ${failures} regra(s)` : "mapas ok"}; ${lacunas} lacuna(s) não verificável(is) automaticamente`);
process.exit(failures ? 1 : 0);
