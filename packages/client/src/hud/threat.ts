// Seta de ameaça (GDD v0.3 §12.1; Art Bible §4): aparece quando o caçador está a menos de `ui.threat_radius` ou
// revelado, e mostra só a direção quantizada em `ui.threat_sectors` setores, relativa à câmera — nunca a distância
// nem a posição. No multijogador (fase 3) o servidor envia só o setor; aqui o cliente calcula a partir do estado
// local e o HUD só recebe o setor.
import type { Vec } from "@thehell/sim";
import { relativeSector } from "../geom/sector.ts";

/** reexportado do módulo neutro (geom/sector.ts), também usado pelas legendas de som (audio/captions.ts) */
export { relativeSector };

export interface ThreatUi { threat_radius: number; threat_sectors: number }

/** nomes das 8 direções, no sentido horário a partir da frente (chaves `dir.*`) */
export const DIRECTIONS = ["front", "front_right", "right", "back_right", "back", "back_left", "left", "front_left"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** setor da seta de ameaça, ou null se o caçador está fora do raio e não está revelado */
export function threatSector(player: Vec, yaw: number, hunter: Vec, ui: ThreatUi, revealed = false): number | null {
  const d = Math.hypot(hunter.x - player.x, hunter.z - player.z);
  if (!revealed && !(d < ui.threat_radius)) return null;
  return relativeSector(player, yaw, hunter, ui.threat_sectors) ?? 0;
}

/** nome da direção do setor (com outra quantidade de setores, a direção de 8 mais próxima) */
export function sectorDirection(sector: number, sectors: number): Direction {
  return DIRECTIONS[Math.round((sector * DIRECTIONS.length) / sectors) % DIRECTIONS.length];
}

/** ângulo do centro do setor em graus (0 = frente, sentido horário), para posicionar e girar a seta */
export const sectorDegrees = (sector: number, sectors: number) => (sector * 360) / sectors;
