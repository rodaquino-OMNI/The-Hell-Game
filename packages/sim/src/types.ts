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

/**
 * Preparo visível de uma habilidade (telegraph, GDD-v0.2 §4.1: "toda habilidade"). `t` = segundos até soltar;
 * `total` = duração do preparo. Golpe e dash desde o R1; projétil e armadilha com a IA do R3 (`ai.hunter_brain: utility`).
 */
export interface Windup { kind: "melee" | "dash" | "projectile" | "trap"; t: number; total: number }

/** estados do caçador (GDD-v0.3 §8.2): Patrulha → Investigar → Perseguir → Atacar → Recuo → Prender */
export type HunterMode = "patrol" | "investigate" | "chase" | "attack" | "recoil" | "cage";

/** sobrevivente como o caçador o percebeu na última leitura (snapshot filtrado, GDD-v0.3 §8.1) */
export interface SeenSurvivor extends Vec {
  id: number;
  cls: ClassName;
  hp: number;
  /** velocidade estimada entre duas leituras seguidas (0 na primeira) */
  vx: number;
  vz: number;
  /** visto pelo cone/linha de visão ou por contato (false = só pela revelação periódica) */
  visible: boolean;
  /** sob anti-tunnel (GDD-v0.2 §4.3): o caçador sabe quem prendeu há pouco */
  antiTunnel: boolean;
}

/** gerador como informação pública (posição, progresso e conclusão; GDD-v0.3 §8.2 e §8.3) */
export interface SeenGenerator extends Vec { progress: number; done: boolean; bonus: boolean }

/** leitura de percepção do caçador: só o que um jogador naquela posição receberia (GDD-v0.3 §8.1) */
export interface Percept {
  t: number;
  self: Vec & { a: number };
  survivors: SeenSurvivor[];
  gens: SeenGenerator[];
  gate: Vec;
  /** pressão final (portão em contagem ou aberto) */
  finalPressure: boolean;
  /** último ruído ouvido (posição e instante), se houver */
  heard: { x: number; z: number; at: number; dur: number } | null;
}

/** estado da IA do caçador (R3). Dado puro e serializável: entra no hash de determinismo. */
export interface HunterAi {
  mode: HunterMode;
  /** tempo até a próxima leitura de percepção e a próxima decisão (`ai.perception_hz`, `ai.decision_hz`) */
  perceiveIn: number;
  decideIn: number;
  percept: Percept | null;
  /** quando cada sobrevivente visível foi notado (tempo de reação da dificuldade, GDD-v0.2 §8.4) */
  noticed: { id: number; at: number }[];
  /** alvo atual (-1 = nenhum) e seu placar de utilidade */
  target: number;
  score: number;
  /** instante da última troca de alvo */
  switchedAt: number;
  /** última posição conhecida do alvo (memória da dificuldade) */
  memory: { id: number; x: number; z: number; until: number } | null;
  /** ponto investigado e prazo; `spot` = ponto atual da vasculha em volta dele */
  investigate: { x: number; z: number; until: number; spot: Vec | null } | null;
  /** ruído ouvido ainda não tratado (vira investigação depois do tempo de reação) */
  heard: { x: number; z: number; at: number; dur: number } | null;
  /** destino da patrulha (gerador ou portão, projetado na grade) e índice do gerador */
  patrol: { x: number; z: number; gen: number } | null;
  /** caminho atual: destino pedido e pontos restantes */
  goal: Vec | null;
  path: Vec[];
  /** há caminho válido até o destino (critério de trava do T-03) */
  pathOk: boolean;
  /** força replanejamento pelo A* (anti-travamento) */
  forceAstar: boolean;
  /** contagem de voltas no loop em que o alvo corre (GDD-v0.3 §8.4) */
  loop: { id: string; target: number; acc: number; last: number } | null;
  /** ponto de corte pelo navmesh quando o alvo corre num loop longo (Pesadelo, "evita loops longos") */
  intercept: Vec | null;
  /** o último golpe capturou o alvo (Recuo → Prender) */
  captured: boolean;
  /**
   * janela do anti-travamento (`ai.anti_stuck`): tempo, posição inicial e deslocamento esperado (soma vetorial dos
   * deslocamentos pretendidos, antes da colisão)
   */
  stuck: { t: number; x: number; z: number; ex: number; ez: number };
  /** velocidade pretendida no último passo (0 = parado de propósito) */
  speed: number;
  /** deslocamento pretendido no último passo, antes da colisão (base do critério de trava T-03) */
  step: Vec;
  /** quantas vezes o anti-travamento replanejou */
  replans: number;
}

/** posição da gaiola e saída da partida (variação de layout escolhida pela semente, GDD-v0.3 §9.3) */
export interface Arena {
  layout: { generators: number; cage: number; exit: number };
  cage: Vec;
  gate: Vec;
  exitZ: number;
}

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
  /** v1 com `ai.hunter_brain: utility`: estado da IA do R3 */
  ai?: HunterAi;
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
  /** gaiola e saída desta partida (protótipo: as do topo do mapa; v1: layout da semente) */
  arena: Arena;
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
