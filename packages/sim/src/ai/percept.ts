// Percepção do caçador (GDD-v0.3 §8.1): monta o snapshot filtrado que a IA consome. É a ÚNICA função da IA que
// lê o GameState; a decisão (brain.ts) só recebe o Percept, então não há como "ver através de parede".
// Visão: cone de `hunter.vision_fov_deg` até o raio da dificuldade, com linha de visão contra as caixas do mapa.
// Revelação periódica (`hunter.reveal.*`) e contato físico também entregam a posição. Audição: o último ruído
// ouvido (game.ts `noise`, tabela §3.4). Geradores, portão e pressão final são informação pública do mapa/HUD.
import type { SimConfig } from "../config.ts";
import { canSee } from "../perception.ts";
import type { GameState, Percept, SeenSurvivor } from "../types.ts";

export function perceive(cfg: SimConfig, g: GameState, prev: Percept | null): Percept {
  const b = cfg.balance, h = b.hunter, H = g.hunter;
  // contato: sem colisão entre personagens, o caçador pode passar por cima do alvo e o cone o perderia "nas costas"
  // (mesma regra do R1; LACUNA: o GDD não define percepção por contato)
  const touch = h.radius + b.survivor.radius;
  const survivors: SeenSurvivor[] = [];
  for (const s of g.survivors) {
    if (s.st !== "ok") continue;
    const d = Math.hypot(s.x - H.x, s.z - H.z);
    const visible = d < touch || canSee(cfg.map, H, H.a, s, h.vision_fov_deg, cfg.detectRadius);
    if (!visible && !(s.revealed > 0)) continue;
    const before = prev?.survivors.find(p => p.id === s.id);
    const dt = prev ? g.t - prev.t : 0;
    survivors.push({
      id: s.id, cls: s.cls, hp: s.hp, x: s.x, z: s.z,
      vx: before && dt > 0 ? (s.x - before.x) / dt : 0,
      vz: before && dt > 0 ? (s.z - before.z) / dt : 0,
      visible, antiTunnel: s.antiTunnel > 0,
    });
  }
  const per = b.generator.puzzles_per_generator;
  return {
    t: g.t,
    self: { x: H.x, z: H.z, a: H.a },
    survivors,
    gens: g.gens.map(x => ({ x: x.x, z: x.z, progress: Math.min(1, x.n / per), done: x.done, bonus: x.bonus })),
    gate: { x: g.arena.gate.x, z: g.arena.gate.z },
    finalPressure: g.gateStarted,
    heard: H.ai?.heard ? { ...H.ai.heard } : null,
  };
}
