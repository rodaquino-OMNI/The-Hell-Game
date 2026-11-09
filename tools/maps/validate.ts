// Validador de mapas (GDD v0.3 §9.1 e §9.3; item R2/F1-04). Roda todas as regras da tabela de métricas
// em todos os mapas de data/maps e em todas as combinações de layout (geradores × gaiola × saída),
// com o navmesh do recast e com a grade A* de reserva. Falha (código 1) se alguma regra falhar.
// Item R7-mapas: valida também o mapa efetivo do ruleset v1 em todas as combinações das flags `maps.v1`
// (D-22 5º gerador, D-23 pilares com loop curto, D-25 saída lateral), cada uma com as regras dela; a combinação
// com todas desligadas é o mapa de topo (o do protótipo).
// Uso: pnpm maps:validate [--nav=recast|grid|both] [--strict] [--flags=all|data] [mapa...]
//      --flags=data valida só a combinação de data/balance.yaml (e o mapa de topo).
// Com CI definido (ou --strict), falha se o WASM do recast não carregar, em vez de cair na grade.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadBalanceFile, loadMapFile } from "../../packages/shared/src/node.ts";
import { allLayoutChoices, gridBackend, mapForV1, validateMap, type MapFlags, type NavBackend } from "../../packages/sim/src/nav/index.ts";
import { initRecast, recastBackend } from "../../packages/sim/src/nav/recast.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const navArg = args.find(a => a.startsWith("--nav="))?.slice(6) ?? "both";
const flagsArg = args.find(a => a.startsWith("--flags="))?.slice(8) ?? "all";
const only = args.filter(a => !a.startsWith("--"));
if (!["recast", "grid", "both"].includes(navArg) || !["all", "data"].includes(flagsArg)) {
  console.error(`argumento inválido: --nav=${navArg} --flags=${flagsArg} (use --nav=recast|grid|both, --flags=all|data)`);
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
    // Na CI (variável CI) ou com --strict, a falta do WASM é erro: o navmesh é o backend de referência.
    const strict = !!process.env.CI || args.includes("--strict");
    console[strict ? "error" : "warn"](`${strict ? "ERRO" : "AVISO"}: WASM do recast indisponível (${(e as Error).message}); ${strict ? "modo estrito (CI)" : "usando só a grade A* de reserva"}`);
    if (strict || navArg === "recast") process.exit(1);
  }
}
if (navArg !== "recast") backends.push(gridBackend(balance));

const files = readdirSync(root + "data/maps").filter(f => f.endsWith(".json")).sort();
let failures = 0, lacunas = 0;
for (const f of files) {
  const map = loadMapFile(root + "data/maps/" + f);
  if (only.length && !only.includes(map.id)) continue;
  const combos = allLayoutChoices(map).length;
  const names = Object.keys(balance.maps.v1) as (keyof MapFlags)[];
  const off = Object.fromEntries(names.map(k => [k, false])) as MapFlags;
  // todas as combinações das flags (2^n), ou só a de topo e a dos dados
  const flagSets: MapFlags[] = flagsArg === "data" ? [off, balance.maps.v1]
    : Array.from({ length: 2 ** names.length }, (_, i) => Object.fromEntries(names.map((k, j) => [k, !!(i & (1 << j))])) as MapFlags);
  for (const flags of flagSets) for (const b of backends) {
    const on = names.filter(k => flags[k]);
    console.log(`\n== ${map.name} (${map.id}) · ${b.name} · ${combos} combinações de layout · flags v1: ${on.length ? on.join(", ") : "nenhuma (mapa de topo)"} ==`);
    for (const r of validateMap(mapForV1(map, flags), balance, b, flags)) {
      const tag = r.status === "ok" ? "ok    " : r.status === "falha" ? "FALHA " : "LACUNA";
      console.log(`${tag} ${r.rule}: ${r.detail}`);
      if (r.status === "falha") failures++;
      if (r.status === "lacuna") lacunas++;
    }
  }
}
console.log(`\n${failures ? `FALHOU: ${failures} regra(s)` : "mapas ok"}; ${lacunas} lacuna(s) não verificável(is) automaticamente`);
process.exit(failures ? 1 : 0);
