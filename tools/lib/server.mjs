// Sobe o servidor compilado (packages/server/dist/server.mjs) numa porta livre para os scripts de teste e captura.
// Achado de revisão (V7): com porta fixa, outro processo na mesma porta fazia o /healthz responder pelo servidor
// alheio. Aqui o servidor sobe com PORT=0 (o sistema escolhe a porta), a porta real vem da linha "ouvindo na porta N"
// que o PRÓPRIO processo filho escreve, e o /healthz só conta enquanto esse filho está vivo.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = fileURLToPath(new URL("../../", import.meta.url));

/**
 * inicia o servidor e espera o /healthz dele; devolve `{ url, port, child, stop }`.
 * Falha (exceção) se o filho sair, se não anunciar a porta ou se o /healthz não responder em `timeoutMs`.
 */
export async function startServer({ env = {}, timeoutMs = 15000 } = {}) {
  const child = spawn(process.execPath, [join(root, "packages/server/dist/server.mjs")], {
    cwd: root, env: { ...process.env, ...env, PORT: "0" }, stdio: ["ignore", "pipe", "inherit"],
  });
  let port = null, out = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    out += chunk;
    const m = /ouvindo na porta (\d+)/.exec(out);
    if (m && port === null) port = Number(m[1]);
  });
  const stop = () => { if (child.exitCode === null) child.kill(); };
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`o servidor saiu com código ${child.exitCode} antes de responder`);
    if (port !== null) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/healthz`);
        if (r.ok && (await r.json()).ok && child.exitCode === null) return { url: `http://127.0.0.1:${port}`, port, child, stop };
      } catch { /* subindo */ }
    }
    await sleep(100);
  }
  stop();
  throw new Error(`o servidor não respondeu ao /healthz em ${timeoutMs} ms (porta anunciada: ${port ?? "nenhuma"})`);
}
