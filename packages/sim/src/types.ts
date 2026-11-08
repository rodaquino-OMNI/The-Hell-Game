// Tipos do estado da partida. Todo o estado é dado puro (serializável), sem DOM nem three.js.

export const CLASSES = ["Curandeiro", "Mecânico", "Atacador"] as const;
export type ClassName = (typeof CLASSES)[number];
export type Arrow = "left" | "up" | "right" | "down";
export const ARROWS: readonly Arrow[] = ["left", "up", "right", "down"];

export interface Vec { x: number; z: number }

export type SurvivorState = "ok" | "cage" | "dead" | "out";

export interface Survivor extends Vec {
  id: number;
  cls: ClassName;
  bot: boolean;
  hp: number;
  st: SurvivorState;
  /** tempo restante na gaiola */
  cage: number;
  /** quantas vezes já foi preso */
  captures: number;
  /** recarga da habilidade (Q) */
  cd: number;
  /** recarga do ataque (clique) */
  atk: number;
  /** bloqueio ativo (Atacador) */
  block: number;
  slow: number;
  /** revelado ao caçador */
  revealed: number;
  immune: number;
  stamina: number;
  /** direção (yaw) em radianos */
  a: number;
  /** progresso do resgate em andamento */
  rescue: number;
  /** progresso do bot no quebra-cabeça atual */
  work: number;
  sidestep: number;
  sidestepDir: number;
  /** v1: anti-tunnel (GDD-v0.2 §4.3) — tempo restante em que o caçador não pode capturar este sobrevivente de novo */
  antiTunnel: number;
}

/** Preparo visível de um golpe ou dash (telegraph, GDD-v0.2 §4.1). `t` = segundos até soltar; `total` = duração do preparo. */
export interface Windup { kind: "melee" | "dash"; t: number; total: number }

export interface Hunter extends Vec {
  hp: number;
  slow: number;
  stun: number;
  atk: number;
  dash: number;
  dashing: number;
  projectile: number;
  trap: number;
  a: number;
  alert: Vec | null;
  alertTime: number;
  patrol: Vec | null;
  sidestep: number;
  sidestepDir: number;
  /** alvo atual (id do sobrevivente) ou -1, exposto para o cliente */
  target: number;
  /** vida máxima da partida (v1: dificuldade × tamanho do time, GDD-v0.3 C-03) */
  maxHp: number;
  /** v1: preparo de golpe ou dash em andamento (telegraph exposto ao cliente; null fora do preparo) */
  windup: Windup | null;
  /** v1: recuo pós-golpe restante (GDD-v0.2 §4.3, `hunter.melee.recoil`): parado e sem agir */
  recoil: number;
}

export interface Generator extends Vec {
  n: number;
  done: boolean;
  bonus: boolean;
  /** v1: falhas seguidas neste gerador (GDD-v0.2 §6.2) */
  fails: number;
  /** v1: faísca visível restante após regressão (`generator.fail_spark_time`) */
  spark: number;
  /** v1: luz de gerador completo revelando a posição (`generator.completed_reveal`) */
  revealed: number;
}

export interface Trap extends Vec { id: number }
export interface Projectile extends Vec { id: number; vx: number; vz: number; t: number }

export interface Puzzle {
  /** índice em `gens` (obrigatórios e bônus juntos) */
  gen: number;
  kind: "timing" | "sequence";
  /** posição do marcador (0..1) e direção */
  t: number;
  dir: 1 | -1;
  zoneCenter: number;
  zoneWidth: number;
  /** passos já acertados da sequência */
  i: number;
  seq: Arrow[];
}

/** Mensagens são chaves; o texto (pt-BR, en, es) fica no cliente (GDD v0.3 §12.5). */
export type MsgKey =
  | "puzzle_points" | "gen_done" | "bonus_done" | "spark" | "heal_pulse" | "turbo" | "block_on" | "bolt_hit"
  | "strike_hit" | "blocked" | "caged" | "died" | "rescued" | "trap_caught" | "trap_disarmed" | "revealed"
  | "gate_countdown" | "gate_open";
export type Outcome = "escaped" | "hunter_down" | "died";
/** v1 (GDD-v0.3 §3.3 revisto) */
export type Team = "survivors" | "hunter";
export type EndReason = "all_terminal" | "hunter_down" | "time_limit";
export type Individual = "escaped" | "dead" | "not_escaped";
/** fonte de ruído da tabela GDD-v0.2 §3.4 (chave em `noise.*`) */
export type NoiseKind = "run" | "puzzle_fail" | "rescue" | "heal" | "generator_done";

export type GameEvent =
  | { type: "msg"; key: MsgKey; n?: number; cls?: ClassName }
  | { type: "sound"; name: "puzzle_ok" | "puzzle_fail" | "hit" | "stun" | "bolt" }
  | { type: "flash" }
  | { type: "noise"; kind: NoiseKind; x: number; z: number; radius: number; heard: boolean }
  | {
      type: "end"; win: boolean; outcome: Outcome; coins: number; time: number;
      /** só no v1: resultado da equipe, motivo do fim e resultado individual do jogador */
      team?: Team; reason?: EndReason; individual?: Individual;
    };

export interface GameState {
  t: number;
  seed: number;
  points: number;
  /** tempo até a próxima revelação */
  reveal: number;
  gateTimer: number;
  gateStarted: boolean;
  gateOpen: boolean;
  over: boolean;
  gens: Generator[];
  survivors: Survivor[];
  hunter: Hunter;
  traps: Trap[];
  projectiles: Projectile[];
  puzzle: Puzzle | null;
  nextId: number;
  events: GameEvent[];
}

/** Entrada do jogador num passo. `interact`, `ability`, `attack` e os campos de `puzzle` são eventos de um quadro (borda de subida). */
export interface PlayerInput {
  forward: number;
  strafe: number;
  run: boolean;
  /** direção da câmera, em radianos (o cliente integra mouse e setas) */
  yaw: number;
  interact: boolean;
  interactHeld: boolean;
  ability: boolean;
  attack: boolean;
  puzzleSpace?: boolean;
  puzzleArrow?: Arrow;
  puzzleExit?: boolean;
}

export const NO_INPUT: PlayerInput = { forward: 0, strafe: 0, run: false, yaw: 0, interact: false, interactHeld: false, ability: false, attack: false };
