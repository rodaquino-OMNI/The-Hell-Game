// Cores do visual da fase 0, idênticas às do protótipo (paridade visual).
// Na fase 2 (F2-01, F2-03) estas cores passam a vir dos tokens de data/art/palette.json aprovados no marco A1.
import type { ClassName } from "@thehell/sim";

export const CLASS_COLORS: Record<ClassName, number> = { Curandeiro: 0x3fbf6a, Mecânico: 0xe0b030, Atacador: 0xc83a3a };

export const HUNTER_COLORS = { body: 0x15121a, head: 0x222222, eyes: 0xff2020, arms: 0x111111, projectile: 0xff3030, trap: 0x990000 };

export const WORLD_COLORS = {
  background: 0x050507, ambient: 0x404058, playerLight: 0xffe0a0, floor: "#2b2a26", wall: "#4a3f3a", cage: 0x777777,
  genBody: 0x555560, bonusBody: 0x6a5a20, gateClosed: 0x401010, gateOpen: 0x33ff66, skinTone: 0xd9b89a,
};

/** skins: c = corpo, h = cabeça, t = chapéu (prototype/the-hell.html L57) */
export const SKIN_COLORS: Record<string, { c?: number | null; h?: number; t?: number }> = {
  std: { c: null },
  abo: { c: 0xe07010, h: 0x70c020, t: 0x205010 },
  som: { c: 0x2a2a30, h: 0x888888 },
  neo: { c: 0x20d8e8, h: 0xe8ffff, t: 0x20d8e8 },
  car: { c: 0x8a1018, h: 0xd9b89a, t: 0x300508 },
  our: { c: 0xd4af37, h: 0xffe9a0, t: 0xd4af37 },
  fan: { c: 0xe8e8f0, h: 0xffffff, t: 0xaaaaff },
};
