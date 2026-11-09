// Saída da gaiola (GDD-v0.2 §2.3, `cage.*`): o efeito do resgate no aliado, sem pontos nem mensagem. Usado pelo
// resgate normal (game.ts, free) e pela etapa "rescue" pulada no tutorial (tutorial.ts, D-34).
import type { SimConfig } from "./config.ts";
import type { GameState, Survivor } from "./types.ts";

export function releaseFromCage(cfg: SimConfig, g: GameState, c: Survivor) {
  const b = cfg.balance;
  c.st = "ok";
  c.hp = b.cage.rescue_hp;
  c.immune = b.cage.immunity;
  c.z = g.arena.cage.z + b.prototype_extras.rescued_offset;
}
