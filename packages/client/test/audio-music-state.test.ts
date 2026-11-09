// Estado musical (A-2 do V5; GDD-v0.3 §11): prioridade pressão final > perseguição > resgate > tensão > ambiente,
// com GameState montado pelo sim (createGame + makeConfig) e campos mutados por cenário.
import { describe, expect, it } from "vitest";
import { loadBalanceFile, loadMapFile } from "@thehell/shared/node";
import { createGame, makeConfig, newHunterAi, type GameState, type HunterMode } from "@thehell/sim";
import { musicStateFor } from "../src/audio/musicState.ts";

const root = new URL("../../../", import.meta.url).pathname;
const bal = loadBalanceFile(root + "data/balance.yaml");
const map = loadMapFile(root + "data/maps/patio.json");
const basic = makeConfig(bal, map, { ruleset: "v1", hunterBrain: "basic" });
const cfg = bal.audio.music;
const R = cfg.tension_radius;
const EPS = 1e-6;
const P = 0;

/** partida nova com o caçador longe (> 3 × raio) e sem alvo; `utility` liga a IA do R3 no caçador */
function game(utility = false): GameState {
  const g = createGame(basic, "Curandeiro", 7);
  const p = g.survivors[P];
  g.hunter.x = p.x + 3 * R; g.hunter.z = p.z;
  g.hunter.target = -1;
  if (utility) g.hunter.ai = newHunterAi();
  return g;
}
/** caçador a `d` metros do sobrevivente `id`, numa diagonal (testa a distância no plano xz) */
function hunterAt(g: GameState, d: number, id = P) {
  const s = g.survivors.find(x => x.id === id)!;
  g.hunter.x = s.x + d * Math.SQRT1_2; g.hunter.z = s.z + d * Math.SQRT1_2;
}
function chase(g: GameState, id = P, mode: HunterMode = "chase") {
  g.hunter.target = id;
  if (g.hunter.ai) { g.hunter.ai.mode = mode; g.hunter.ai.target = id; }
}
const cage = (g: GameState, id: number) => { const s = g.survivors.find(x => x.id === id)!; s.st = "cage"; s.cage = bal.cage.time; };
const state = (g: GameState, id = P) => musicStateFor(g, id, cfg);

describe("musicStateFor: 10 cenários e conflitos de prioridade", () => {
  it("1. partida nova, caçador longe e sem alvo → ambiente", () => {
    expect(state(game())).toBe("ambient");
  });

  it("2. caçador a tension_radius − ε → tensão; + ε e exatamente no raio → ambiente (< estrito, GDD-v0.3 §11)", () => {
    const g = game();
    hunterAt(g, R - EPS); expect(state(g)).toBe("tension");
    hunterAt(g, R + EPS); expect(state(g)).toBe("ambient");
    g.hunter.x = g.survivors[P].x + R; g.hunter.z = g.survivors[P].z; expect(state(g)).toBe("ambient");
  });

  it("3. aliado preso → resgate; o próprio jogador preso → resgate", () => {
    const g = game(); cage(g, 1); expect(state(g)).toBe("rescue");
    const h = game(); cage(h, P); expect(state(h)).toBe("rescue");
  });

  it("4. resgate + tensão → resgate", () => {
    const g = game(); cage(g, 2); hunterAt(g, R / 2); expect(state(g)).toBe("rescue");
  });

  it("5. caçador básico (sem IA do R3) com o jogador como alvo → perseguição; alvo em outro → só tensão", () => {
    const g = game(); hunterAt(g, R / 2); chase(g);
    expect(state(g)).toBe("chase");
    chase(g, 1); expect(state(g)).toBe("tension");
  });

  it("6. IA do R3: modo chase, attack ou recoil com o jogador como alvo → perseguição; investigate/patrol/cage com alvo → não", () => {
    const g = game(true);
    for (const mode of ["chase", "attack", "recoil"] as const) { chase(g, P, mode); expect(state(g)).toBe("chase"); }
    for (const mode of ["investigate", "patrol", "cage"] as const) { chase(g, P, mode); expect(state(g)).toBe("ambient"); }
    hunterAt(g, R - EPS); chase(g, P, "investigate"); expect(state(g)).toBe("tension");
  });

  it("7. perseguição + resgate → perseguição", () => {
    const g = game(true); cage(g, 1); chase(g); expect(state(g)).toBe("chase");
  });

  it("8. pressão final (portão em contagem) + perseguição → pressão final; portão aberto também", () => {
    const g = game(true); chase(g); g.gateStarted = true; g.gateTimer = basic.gateTime;
    expect(state(g)).toBe("final_pressure");
    g.gateOpen = true; g.gateTimer = 0; expect(state(g)).toBe("final_pressure");
  });

  it("9. pressão final + resgate + tensão → pressão final; sem portão volta à regra seguinte", () => {
    const g = game(); g.gateStarted = true; cage(g, 1); hunterAt(g, R / 2);
    expect(state(g)).toBe("final_pressure");
    g.gateStarted = false; expect(state(g)).toBe("rescue");
  });

  it("10. o estado é do jogador pedido: perseguição e tensão medidas a partir dele, não do sobrevivente 0", () => {
    const g = game(); hunterAt(g, R / 2, 2); chase(g, 2);
    expect(state(g, 2)).toBe("chase");
    expect(state(g, P)).not.toBe("chase");
    chase(g, -1); expect(state(g, 2)).toBe("tension");
    expect(state(g, 99)).toBe("ambient"); // id inexistente: sem distância
  });

  it("alvo velho do caçador básico: jogador preso com target nele → resgate, não perseguição; morto → ambiente", () => {
    for (const utility of [false, true]) {
      const g = game(utility); hunterAt(g, R / 2); chase(g); cage(g, P);
      expect(state(g)).toBe("rescue");
      g.survivors[P].st = "dead"; expect(state(g)).toBe("ambient");
    }
  });

  it("jogador fora de jogo (morto ou escapado): sem tensão nem perseguição; pressão final e resgate valem (LACUNA)", () => {
    for (const st of ["dead", "out"] as const) {
      const g = game(true); hunterAt(g, R / 2); chase(g); g.survivors[P].st = st;
      expect(state(g)).toBe("ambient");
      cage(g, 1); expect(state(g)).toBe("rescue");
      g.gateStarted = true; expect(state(g)).toBe("final_pressure");
    }
  });

  it("é pura: não altera o estado", () => {
    const g = game(true); cage(g, 1); chase(g); hunterAt(g, R / 3);
    const before = JSON.stringify(g);
    state(g); state(g, 1);
    expect(JSON.stringify(g)).toBe(before);
  });
});
