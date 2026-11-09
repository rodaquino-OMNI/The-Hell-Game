// Servidor THE HELL. Fase 0: serve o cliente estático e responde /healthz (Fly.io).
// O servidor autoritativo Colyseus entra na fase 3 (F3-01).
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = process.env.APP_VERSION ?? "dev";

export function createApp(publicDir: string): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.get("/healthz", (_req, res) => { res.set("Cache-Control", "no-store").json({ ok: true, version: VERSION }); });
  app.use("/assets", express.static(path.join(publicDir, "assets"), { immutable: true, maxAge: "365d" }));
  app.use(express.static(publicDir, { maxAge: 0, setHeaders: res => res.setHeader("Cache-Control", "no-cache") }));
  return app;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const dir = process.env.PUBLIC_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
  // PORT=0: porta livre escolhida pelo sistema, anunciada na linha abaixo (scripts de teste: tools/lib/server.mjs)
  const raw = process.env.PORT;
  const port = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 8080;
  const srv = createApp(dir).listen(port, () => {
    const addr = srv.address();
    console.log(`THE HELL ${VERSION} ouvindo na porta ${typeof addr === "object" && addr ? addr.port : port}`);
  });
}
