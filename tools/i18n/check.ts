// pnpm i18n:check — confere os catálogos de tradução do cliente contra o código (GDD v0.3 §12.5; plano §9).
// Regras em packages/client/src/i18n/check.ts. Sai com código 1 e lista os problemas se algum falhar.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCatalogs, type Source } from "../../packages/client/src/i18n/check.ts";
import { loadBalanceFile } from "../../packages/shared/src/node.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const client = join(root, "packages/client");
const localesDir = join(client, "src/i18n/locales");

const catalogs: Record<string, Record<string, string>> = {};
for (const f of readdirSync(localesDir).filter(f => f.endsWith(".json"))) {
  catalogs[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(localesDir, f), "utf8"));
}

const sources: Source[] = [];
const walk = (dir: string) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    // o próprio verificador cita chaves de exemplo nos comentários; fica de fora
    else if (/\.ts$/.test(f) && !p.endsWith(join("i18n", "check.ts"))) sources.push({ file: relative(root, p), text: readFileSync(p, "utf8") });
  }
};
walk(join(client, "src"));
sources.push({ file: "packages/client/index.html", text: readFileSync(join(client, "index.html"), "utf8") });

const { ui } = loadBalanceFile(join(root, "data/balance.yaml"));
// nomes de token da paleta não são chaves de tradução (ver regra em packages/client/src/i18n/check.ts)
const paletteTokens = new Set(Object.keys(JSON.parse(readFileSync(join(root, "data/art/palette.json"), "utf8")).tokens));
const errors = checkCatalogs(catalogs, ui.locales, sources, paletteTokens);
const keys = Object.keys(catalogs[ui.locales[0]] ?? {}).length;
if (errors.length) {
  console.error(`i18n: ${errors.length} problema(s):\n` + errors.map(e => "  - " + e).join("\n"));
  process.exit(1);
}
console.log(`i18n ok: ${ui.locales.join(", ")} · ${keys} chaves · ${sources.length} arquivos conferidos`);
