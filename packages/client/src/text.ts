// Textos do jogo em pt-BR (os de en e es entram na fase 1, GDD v0.3 §12.5).
// Números vêm dos dados: o protótipo mostrava recargas desatualizadas no menu (P-11).
import type { Balance } from "@thehell/shared";
import type { ClassName, GameEvent, Outcome } from "@thehell/sim";

export function classDescription(b: Balance, cls: ClassName): string {
  const c = b.classes;
  if (cls === "Curandeiro") return `Q — pulso de cura em área (${c.healer.cooldown} s). Cura aliados próximos.`;
  if (cls === "Mecânico") return `Q — conserto turbo (${c.mechanic.turbo.cooldown} s). Clique — parafuso elétrico: causa dano e deixa o caçador lento (${c.mechanic.bolt.cooldown} s). Zona de acerto maior nos quebra-cabeças.`;
  return `Clique — golpe que atordoa o caçador (${c.fighter.strike.stun} s) · Q — bloqueio que anula 1 ataque (${c.fighter.block.cooldown} s).`;
}

export function goalText(b: Balance, generators: number): string {
  return `Conserte os ${generators} geradores (${b.generator.puzzles_per_generator} quebra-cabeças cada), espere o portão (${b.generator.gate_time} s) e fuja.`;
}

export function messageText(e: Extract<GameEvent, { type: "msg" }>): string {
  switch (e.key) {
    case "puzzle_points": return `+${e.n} pontos`;
    case "gen_done": return `Gerador consertado! +${e.n} pontos`;
    case "bonus_done": return `Gerador bônus! +${e.n} pontos`;
    case "spark": return "Faísca! O caçador ouviu…";
    case "heal_pulse": return "Pulso de cura!";
    case "turbo": return "Conserto turbo!";
    case "block_on": return "Bloqueio ativo";
    case "bolt_hit": return "Parafuso elétrico! Caçador lento";
    case "strike_hit": return "Golpe! Caçador atordoado";
    case "blocked": return "Bloqueado!";
    case "caged": return `Você foi preso! Espere o resgate (${e.n} s)`;
    case "died": return `${e.cls} morreu`;
    case "rescued": return `${e.cls} resgatado!`;
    case "trap_caught": return "Preso na armadilha!";
    case "trap_disarmed": return "Armadilha desativada";
    case "revealed": return "O caçador sentiu você!";
    case "gate_countdown": return `Geradores prontos! Portão abrindo em ${e.n} s — o caçador está furioso!`;
    case "gate_open": return "PORTÃO ABERTO! CORRA!";
  }
}

export const END_TEXT: Record<Outcome, [string, string]> = {
  escaped: ["VOCÊ ESCAPOU!", "Os sobreviventes fugiram do inferno."],
  hunter_down: ["CAÇADOR DERROTADO!", "Os sobreviventes venceram."],
  died: ["VOCÊ MORREU", "O caçador venceu."],
};

export const SKIN_NAMES: Record<string, string> = {
  std: "Padrão", abo: "Abóbora", som: "Sombra", neo: "Neon Ciano", car: "Carmesim", our: "Ouro", fan: "Fantasma",
};
