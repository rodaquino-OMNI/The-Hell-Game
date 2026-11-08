// Ligação simulação → personagens: qual modelo cada ator usa e o que do estado do sim vira clipe (state.ts).
import type { ClassName, GameState, Hunter, Survivor } from "@thehell/sim";
import type * as THREE from "three";
import { balance, cfg } from "../../data.ts";
import { animateCharacter, charactersReady, createCharacter } from "./runtime.ts";

/** modelo de cada classe jogável hoje (as demais fichas — Batedor, Protetor — entram com as classes, fase 4) */
const SURVIVOR_MODEL: Record<ClassName, string> = { Curandeiro: "curandeiro", Mecânico: "mecanico", Atacador: "atacador" };
/** caçador de lançamento (Art Bible §3) */
const HUNTER_MODEL = "espectro";

/** vida abaixo da qual o sobrevivente está ferido: lida de survivor.wounded_hp quando existir (LACUNA, ver state.ts) */
const woundedHp = (balance.survivor as { wounded_hp?: number }).wounded_hp;

export const createSurvivorModel = (s: Survivor) => createCharacter(SURVIVOR_MODEL[s.cls]);
export const createHunterModel = () => createCharacter(HUNTER_MODEL);

/** clipe do sobrevivente `s`; o jogador (id 0) interage pelo quebra-cabeça aberto */
export function animateSurvivor(root: THREE.Object3D, s: Survivor, G: GameState) {
  const sv = balance.survivor;
  return animateCharacter(root, {
    x: s.x, z: s.z, atk: s.atk, hp: s.hp,
    caged: s.st === "cage",
    interacting: (s.id === 0 && G.puzzle != null) || s.rescue > 0,
    work: s.bot ? s.work : undefined,
  }, { t: G.t, walk: sv.walk, run: sv.run, woundedHp });
}

export function animateHunter(root: THREE.Object3D, H: Hunter, G: GameState) {
  return animateCharacter(root, {
    x: H.x, z: H.z, atk: H.atk,
    dashing: H.dashing > 0,
    stunned: H.stun > 0,
  }, { t: G.t, walk: balance.hunter.patrol_speed, run: cfg.chaseSpeed });
}

/** gancho para as capturas de referência (tools/visual/compare.mjs): resolve quando os modelos criados estão na cena */
(globalThis as unknown as { __thehellCharactersReady: () => Promise<boolean> }).__thehellCharactersReady = charactersReady;
