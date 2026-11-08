// Valida data/balance.yaml e data/maps/*.json contra o schema e gera JSON para cliente e servidor
// em packages/shared/generated/. Falha (código 1) se algum arquivo não passar no schema.
// Uso: pnpm data
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadBalanceFile, loadMapFile } from "../../packages/shared/src/node.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const out = root + "packages/shared/generated/";
mkdirSync(out, { recursive: true });
const balance = loadBalanceFile(root + "data/balance.yaml");
writeFileSync(out + "balance.json", JSON.stringify(balance));
const maps: Record<string, unknown> = {};
for (const f of readdirSync(root + "data/maps").filter(f => f.endsWith(".json"))) {
  const m = loadMapFile(root + "data/maps/" + f);
  maps[m.id] = m;
}
writeFileSync(out + "maps.json", JSON.stringify(maps));
console.log(`dados ok: balance ${balance.version} (${balance.ruleset}), mapas: ${Object.keys(maps).join(", ")}`);
