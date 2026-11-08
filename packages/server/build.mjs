// Empacota o servidor (com dependências) em dist/server.mjs e copia o cliente compilado para dist/public.
import { build } from "esbuild";
import { cpSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
await build({ entryPoints: ["src/index.ts"], outfile: "dist/server.mjs", bundle: true, platform: "node", format: "esm", target: "node22", sourcemap: true,
  // bundle autossuficiente: a imagem de produção só precisa de dist/ (dependências CommonJS precisam de require)
  banner: { js: "import { createRequire as __cr } from \"node:module\"; const require = __cr(import.meta.url);" } });
cpSync("../client/dist", "dist/public", { recursive: true });
console.log("servidor ok → dist/server.mjs + dist/public");
