import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "thehell-"));
writeFileSync(join(dir, "index.html"), "<title>THE HELL</title>");
const server = createApp(dir).listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
afterAll(() => { server.close(); });

describe("servidor", () => {
  it("/healthz responde ok", async () => {
    const r = await fetch(base + "/healthz");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true });
  });
  it("serve o cliente sem cache no index", async () => {
    const r = await fetch(base + "/");
    expect(await r.text()).toContain("THE HELL");
    expect(r.headers.get("cache-control")).toBe("no-cache");
  });
});
