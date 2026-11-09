// D-45: a partida só começa com os personagens carregados (packages/client/src/ui/start-gate.ts). Casos: pronto antes
// do teto, pronto tarde (depois de outra espera), promessa rejeitada, teto ui.start_wait_s, clique duplo ignorado.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadBalanceFile } from "@thehell/shared/node";
import { startGate } from "../src/ui/start-gate.ts";

const bal = loadBalanceFile(new URL("../../../data/balance.yaml", import.meta.url).pathname);
const WAIT = bal.ui.start_wait_s;

/** promessa controlada de fora (charactersReady simulado) */
function deferred() {
  let resolve!: () => void, reject!: (e: unknown) => void;
  const p = new Promise<void>((ok, ko) => { resolve = ok; reject = ko; });
  return { p, resolve, reject };
}

function setup(ready: () => Promise<unknown>) {
  const busy: boolean[] = [], logs: string[] = [];
  const gate = startGate({ ready, timeoutS: WAIT, setBusy: on => busy.push(on), log: m => logs.push(m) });
  return { gate, busy, logs };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("portão do início (D-45)", () => {
  it("o teto vem dos dados (ui.start_wait_s = 10 s)", () => {
    expect(WAIT).toBe(10);
  });

  it("só libera quando charactersReady resolve, mesmo tarde; botão em carregando durante a espera", async () => {
    const d = deferred();
    const { gate, busy, logs } = setup(() => d.p);
    let outcome: string | null = null;
    const w = gate.wait().then(o => { outcome = o; });
    await vi.advanceTimersByTimeAsync(6000);
    expect(outcome).toBeNull();
    expect(gate.busy()).toBe(true);
    expect(busy).toEqual([true]);
    d.resolve();
    await w;
    expect(outcome).toBe("pronto");
    expect(busy).toEqual([true, false]);
    expect(gate.busy()).toBe(false);
    expect(logs).toEqual([]);
    // o temporizador do teto foi limpo: nada dispara depois
    await vi.advanceTimersByTimeAsync(WAIT * 1000);
    expect(logs).toEqual([]);
  });

  it("charactersReady rejeitado: começa assim mesmo (modelo de reserva) e registra", async () => {
    const d = deferred();
    const { gate, busy, logs } = setup(() => d.p);
    const w = gate.wait();
    d.reject(new Error("rede"));
    expect(await w).toBe("erro");
    expect(busy).toEqual([true, false]);
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("rede");
  });

  it("ready que lança na chamada conta como falha", async () => {
    const { gate } = setup(() => { throw new Error("sem manifesto"); });
    expect(await gate.wait()).toBe("erro");
  });

  it("download travado: começa no teto ui.start_wait_s e registra", async () => {
    const { gate, busy, logs } = setup(() => new Promise(() => {}));
    let outcome: string | null = null;
    const w = gate.wait().then(o => { outcome = o; });
    await vi.advanceTimersByTimeAsync(WAIT * 1000 - 1);
    expect(outcome).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await w;
    expect(outcome).toBe("tempo");
    expect(busy).toEqual([true, false]);
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("ui.start_wait_s");
  });

  it("personagens já na cena: libera sem esperar o teto", async () => {
    const { gate } = setup(() => Promise.resolve(true));
    expect(await gate.wait()).toBe("pronto");
  });
});
