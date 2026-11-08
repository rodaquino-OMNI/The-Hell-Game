// Estado da simulação → clipe (Art Bible §7: 9 clipes). Puro, testável sem DOM.
// Usa só o que @thehell/sim expõe hoje; o resto fica mapeado e inativo até o R1 expor (ver ACTIVE abaixo).
import type { ClipName } from "../../assets/characters.ts";

/** quais clipes cada tipo consegue disparar com o estado atual do sim (fase 0, ruleset prototype) */
export const ACTIVE: Record<"sobrevivente" | "cacador", Record<ClipName, string>> = {
  sobrevivente: {
    idle: "parado",
    andar: "velocidade medida > 0 e ≤ média de survivor.walk e survivor.run",
    correr: "velocidade medida > média de survivor.walk e survivor.run",
    interagir: "jogador com quebra-cabeça aberto (G.puzzle) ou resgatando (rescue > 0); bot com `work` subindo",
    ferido: "INATIVO: falta survivor.wounded_hp em data/balance.yaml (GDD v0.3 §8.3 usa 40; GDD v0.2 §3.2 [Proposta])",
    preso: "st = cage",
    golpe: "borda de subida de `atk` (recarga do ataque reiniciada = acabou de atacar)",
    dash: "INATIVO: sobrevivente sem dash no sim",
    atordoado: "INATIVO: sobrevivente sem atordoamento no sim",
  },
  cacador: {
    idle: "parado",
    andar: "velocidade medida > 0 e ≤ média de hunter.patrol_speed e hunter.chase_speed",
    correr: "velocidade medida acima dessa média (perseguição)",
    interagir: "INATIVO: o caçador não interage com objetos no sim",
    ferido: "INATIVO: sem estado ferido do caçador",
    preso: "INATIVO: o caçador nunca é preso",
    golpe: "borda de subida de hunter.atk; o PREPARO do golpe (telegraph 0,4 s) depende do R1",
    dash: "hunter.dashing > 0; o PREPARO do dash depende do R1",
    atordoado: "hunter.stun > 0",
  },
};

export interface Memory {
  x: number; z: number; t: number; speed: number;
  atk: number; work: number; working: boolean;
  oneShot: ClipName | null; oneShotEnd: number;
}

export const newMemory = (x: number, z: number, t: number): Memory => ({ x, z, t, speed: 0, atk: 0, work: 0, working: false, oneShot: null, oneShotEnd: 0 });

export interface ActorView {
  x: number; z: number;
  /** recarga do ataque (sobe quando o ator ataca) */
  atk: number;
  caged?: boolean;
  interacting?: boolean;
  work?: number;
  hp?: number;
  dashing?: boolean;
  stunned?: boolean;
}

export interface ClipContext {
  t: number;
  /** velocidades de referência (m/s) do tipo: [andar, correr] lidas de data/balance.yaml */
  walk: number; run: number;
  /** vida abaixo da qual o ator está ferido; ausente = clipe `ferido` inativo */
  woundedHp?: number;
  /** duração (s) do clipe golpe deste personagem */
  strikeDuration: number;
}

export interface ClipChoice { clip: ClipName; speed: number }

/** atualiza a memória do ator e escolhe o clipe pela prioridade: preso > atordoado > dash > golpe > interagir > locomoção */
export function chooseClip(v: ActorView, mem: Memory, ctx: ClipContext): ClipChoice {
  const dt = ctx.t - mem.t;
  // só reavalia velocidade e trabalho quando a simulação andou (vários quadros podem cair no mesmo passo)
  if (dt > 0) {
    mem.speed = Math.hypot(v.x - mem.x, v.z - mem.z) / dt;
    mem.working = v.work != null && v.work > mem.work;
    mem.x = v.x; mem.z = v.z; mem.t = ctx.t; mem.work = v.work ?? 0;
  } else if (dt < 0) { mem.x = v.x; mem.z = v.z; mem.t = ctx.t; mem.speed = 0; mem.working = false; mem.work = v.work ?? 0; }
  const attacked = v.atk > mem.atk;
  mem.atk = v.atk;
  if (attacked) { mem.oneShot = "golpe"; mem.oneShotEnd = ctx.t + ctx.strikeDuration; }
  if (mem.oneShot && ctx.t >= mem.oneShotEnd) mem.oneShot = null;

  const speed = mem.speed;
  if (v.caged) return { clip: "preso", speed: 0 };
  if (v.stunned) return { clip: "atordoado", speed: 0 };
  if (v.dashing) return { clip: "dash", speed };
  if (mem.oneShot) return { clip: mem.oneShot, speed };
  if (v.interacting || mem.working) return { clip: "interagir", speed: 0 };
  if (speed > 0) {
    if (ctx.woundedHp != null && v.hp != null && v.hp < ctx.woundedHp) return { clip: "ferido", speed };
    return { clip: speed > (ctx.walk + ctx.run) / 2 ? "correr" : "andar", speed };
  }
  return { clip: "idle", speed: 0 };
}
