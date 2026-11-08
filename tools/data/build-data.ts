// Valida data/balance.yaml, data/maps/*.json e data/art/{palette,personagens}.json contra o schema e gera JSON para cliente e servidor
// em packages/shared/generated/. Falha (código 1) se algum arquivo não passar no schema.
// Gera também o navmesh de cada mapa (GDD v0.3 §8.6, C-14: "o navmesh é gerado no build") em
// packages/shared/generated/navmesh/<mapa>.bin (exportNavMesh do recast-navigation, parâmetros nav.*).
// Uso: pnpm data
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadBalanceFile, loadMapFile, loadPaletteFile, loadSheetFile } from "../../packages/shared/src/node.ts";
import { checkArt, type GameMap } from "../../packages/shared/src/index.ts";
import { initRecast, navParams, RecastNav } from "../../packages/sim/src/nav/recast.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const out = root + "packages/shared/generated/";
mkdirSync(out + "navmesh/", { recursive: true });
const balance = loadBalanceFile(root + "data/balance.yaml");
writeFileSync(out + "balance.json", JSON.stringify(balance));
const maps: Record<string, GameMap> = {};
for (const f of readdirSync(root + "data/maps").filter(f => f.endsWith(".json")).sort()) {
  const m = loadMapFile(root + "data/maps/" + f);
  maps[m.id] = m;
}
writeFileSync(out + "maps.json", JSON.stringify(maps));
// tokens de cor (Art Bible §2): o HUD e os menus leem as cores daqui (item R7)
writeFileSync(out + "palette.json", readFileSync(root + "data/art/palette.json", "utf8"));

// V3: paleta e ficha de arte dos personagens (Art Bible §2, §3, §7), validadas e cruzadas com as skins da economia
const palette = loadPaletteFile(root + "data/art/palette.json");
const sheet = loadSheetFile(root + "data/art/personagens.json");
const artErrors = checkArt(palette, sheet, Object.keys(balance.skins));
if (artErrors.length) {
  for (const e of artErrors) console.error("ERRO (arte):", e);
  process.exit(1);
}
writeFileSync(out + "palette.json", JSON.stringify(palette));
writeFileSync(out + "personagens.json", JSON.stringify(sheet));

let navInfo: string;
try {
  await initRecast();
  const sizes: string[] = [];
  for (const m of Object.values(maps)) {
    const nav = RecastNav.build(m, navParams(balance));
    const bytes = nav.toBytes();
    nav.dispose();
    writeFileSync(out + `navmesh/${m.id}.bin`, bytes);
    sizes.push(`${m.id} ${(bytes.length / 1024).toFixed(1)} KiB`);
  }
  navInfo = `navmesh: ${sizes.join(", ")}`;
} catch (e) {
  // Na CI (variável CI) ou com --strict, navmesh ausente é erro de build.
  if (process.env.CI || process.argv.includes("--strict")) {
    console.error(`ERRO: navmesh não gerado (${(e as Error).message}); modo estrito (CI)`);
    process.exit(1);
  }
  // GDD v0.3 §8.6: sem WASM, a navegação usa a grade A* de reserva (nav.fallback_grid), gerada em tempo de execução
  navInfo =`AVISO: navmesh não gerado (${(e as Error).message}); a navegação usa a grade A* de reserva`;
}
console.log(`dados ok: balance ${balance.version} (${balance.ruleset}), mapas: ${Object.keys(maps).join(", ")}, paleta ${palette.version} (${Object.keys(palette.tokens).length} tokens), ${sheet.personagens.length} personagens, ${Object.keys(sheet.skins.lista).length} skins; ${navInfo}`);
