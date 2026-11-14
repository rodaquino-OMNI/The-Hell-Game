// HUD do R7 (GDD v0.3 §12.1): quantização da seta de ameaça em 8 setores, recarga dos pings e estado dos retratos.
import { describe, expect, it } from "vitest";
import { loadBalanceFile } from "@thehell/shared/node";
import { newPingState, pingRemaining, prunePings, tryPing } from "../src/hud/ping.ts";
import { portraitsHtml, portraitState } from "../src/hud/team.ts";
import { DIRECTIONS, relativeSector, sectorDegrees, sectorDirection, threatSector } from "../src/hud/threat.ts";
import { PING_NAME } from "../src/text.ts";

const bal = loadBalanceFile(new URL("../../../data/balance.yaml", import.meta.url).pathname);
const ui = bal.ui;
const N = ui.threat_sectors;
const P = { x: 3, z: -7 };
/** ponto a `d` metros de P no ângulo `deg` (0 = frente da câmera com yaw, sentido horário) */
const at = (deg: number, d: number, yaw = 0) => {
  const a = (deg * Math.PI) / 180;
  const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) }, right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  return { x: P.x + d * (Math.cos(a) * fwd.x + Math.sin(a) * right.x), z: P.z + d * (Math.cos(a) * fwd.z + Math.sin(a) * right.z) };
};

describe("seta de ameaça (8 setores, ui.threat_radius)", () => {
  it("os dados pedem 8 setores e 15 m (GDD v0.3 §12.1)", () => {
    expect(N).toBe(8);
    expect(ui.threat_radius).toBe(15);
  });

  it("cada direção cai no setor certo, para vários yaw da câmera", () => {
    for (const yaw of [0, 0.7, -2.1, Math.PI, 5.5]) {
      for (let s = 0; s < N; s++) {
        expect(threatSector(P, yaw, at(s * 45, 10, yaw), ui)).toBe(s);
        // dentro de ±22,5° do centro continua no mesmo setor
        expect(threatSector(P, yaw, at(s * 45 + 20, 10, yaw), ui)).toBe(s);
        expect(threatSector(P, yaw, at(s * 45 - 20, 10, yaw), ui)).toBe(s);
      }
    }
  });

  it("fronteira: 23° à direita já é o setor 1; 338° volta ao 0", () => {
    expect(threatSector(P, 0, at(23, 5), ui)).toBe(1);
    expect(threatSector(P, 0, at(338, 5), ui)).toBe(0);
    expect(threatSector(P, 0, at(-157, 5), ui)).toBe(5);
  });

  it("frente e direita seguem a entrada: yaw 0 olha para −z, direita = +x", () => {
    expect(relativeSector(P, 0, { x: P.x, z: P.z - 1 }, N)).toBe(0);
    expect(relativeSector(P, 0, { x: P.x + 1, z: P.z }, N)).toBe(2);
    expect(relativeSector(P, 0, { x: P.x, z: P.z + 1 }, N)).toBe(4);
    expect(relativeSector(P, 0, { x: P.x - 1, z: P.z }, N)).toBe(6);
    expect(relativeSector(P, 0, P, N)).toBeNull();
  });

  it("só aparece dentro do raio (estrito) ou com o caçador revelado; a saída não depende da distância", () => {
    const r = ui.threat_radius;
    expect(threatSector(P, 0, at(90, r - 0.01), ui)).toBe(2);
    expect(threatSector(P, 0, at(90, r + 0.01), ui)).toBeNull();
    expect(threatSector(P, 0, { x: P.x + r, z: P.z }, ui)).toBeNull();
    expect(threatSector(P, 0, at(90, 400), ui, true)).toBe(2);
    expect(threatSector(P, 0, at(90, 1), ui)).toBe(threatSector(P, 0, at(90, r - 1), ui));
    expect(threatSector(P, 0, P, ui, true)).toBe(0);
  });

  it("nome e ângulo de cada setor", () => {
    expect([...Array(N).keys()].map(s => sectorDirection(s, N))).toEqual([...DIRECTIONS]);
    expect(sectorDirection(1, 4)).toBe("right");
    expect(sectorDegrees(3, N)).toBe(135);
  });
});

describe("pings (ui.ping_types, ui.ping_cooldown, ui.ping_lifetime)", () => {
  it("4 tipos com recarga de 2 s (GDD v0.3 §12.1), todos com nome traduzível", () => {
    expect(ui.ping_types).toHaveLength(4);
    expect(ui.ping_cooldown).toBe(2);
    for (const p of ui.ping_types) expect(PING_NAME[p]).toBeDefined();
  });

  it("recusa outro ping do mesmo jogador antes de ui.ping_cooldown e aceita depois", () => {
    const s = newPingState(), cd = ui.ping_cooldown;
    expect(tryPing(s, 10, ui, { type: "need_help", from: 0, x: 0, z: 0 })).toBe(true);
    expect(pingRemaining(s, 0, 10, ui)).toBe(cd);
    expect(tryPing(s, 10 + cd / 2, ui, { type: "hunter_here", from: 0, x: 0, z: 0 })).toBe(false);
    expect(pingRemaining(s, 0, 10 + cd / 2, ui)).toBeCloseTo(cd / 2);
    expect(tryPing(s, 10 + cd - 0.001, ui, { type: "hunter_here", from: 0, x: 0, z: 0 })).toBe(false);
    expect(tryPing(s, 10 + cd, ui, { type: "hunter_here", from: 0, x: 1, z: 2 })).toBe(true);
    // o novo substitui o anterior do mesmo jogador
    expect(s.active).toEqual([{ type: "hunter_here", from: 0, x: 1, z: 2, t: 10 + cd }]);
  });

  it("a recarga é por jogador e o ping recusado não reinicia a recarga", () => {
    const s = newPingState();
    tryPing(s, 0, ui, { type: "need_help", from: 0, x: 0, z: 0 });
    expect(tryPing(s, 0.5, ui, { type: "need_help", from: 1, x: 0, z: 0 })).toBe(true);
    tryPing(s, 1, ui, { type: "need_help", from: 0, x: 0, z: 0 });
    expect(pingRemaining(s, 0, ui.ping_cooldown, ui)).toBe(0);
    expect(s.active).toHaveLength(2);
  });

  it("tipo fora de ui.ping_types é recusado e não consome a recarga", () => {
    const s = newPingState();
    expect(tryPing(s, 0, ui, { type: "dance", from: 0, x: 0, z: 0 })).toBe(false);
    expect(pingRemaining(s, 0, 0, ui)).toBe(0);
  });

  it("some depois de ui.ping_lifetime", () => {
    const s = newPingState();
    tryPing(s, 0, ui, { type: "generator_here", from: 0, x: 0, z: 0 });
    prunePings(s, ui.ping_lifetime - 0.01, ui);
    expect(s.active).toHaveLength(1);
    prunePings(s, ui.ping_lifetime, ui);
    expect(s.active).toHaveLength(0);
  });
});

describe("retratos da equipe", () => {
  it("vivo, ferido (< survivor.wounded_hp), preso, morto e escapou", () => {
    const w = bal.survivor.wounded_hp;
    expect(portraitState({ st: "ok", hp: w }, w)).toBe("ok");
    expect(portraitState({ st: "ok", hp: w - 0.5 }, w)).toBe("wounded");
    expect(portraitState({ st: "cage", hp: 10 }, w)).toBe("caged");
    expect(portraitState({ st: "dead", hp: 0 }, w)).toBe("dead");
    expect(portraitState({ st: "out", hp: 5 }, w)).toBe("escaped");
  });
  it("preso no Treino (cronômetro da gaiola parado) aparece sem prazo; na partida, com os segundos", () => {
    const w = bal.survivor.wounded_hp;
    const caged = [{ st: "cage", hp: 0, cage: 75, cls: "Mecânico", bot: true }] as unknown as Parameters<typeof portraitsHtml>[0];
    const match = portraitsHtml(caged, w), tut = portraitsHtml(caged, w, false);
    expect(match).toContain("75");
    expect(tut).not.toContain("75");
    expect(tut).toContain('class="pt caged');
  });
});
