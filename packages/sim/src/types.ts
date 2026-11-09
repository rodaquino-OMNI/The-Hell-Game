// Tipos do estado da partida. Todo o estado é dado puro (serializável), sem DOM nem three.js.
import type { Balance } from "@thehell/shared";

export const CLASSES = ["Curandeiro", "Mecânico", "Atacador"] as const;
export type ClassName = (typeof CLASSES)[number];
export type Arrow = "left" | "up" | "right" | "down";
export const ARROWS: readonly Arrow[] = ["left", "up", "right", "down"];

export interface Vec { x: number; z: number }

/** categoria do resumo de fim de partida (GDD-v0.2 §7.1): Objetivos, Altruísmo, Sobrevivência, Audácia */
export type ScoreCategory = Balance["points"]["events"]["puzzle"]["category"];
export const SCORE_CATEGORIES: readonly ScoreCategory[] = ["objectives", "altruism", "survival", "boldness"];
/** placar por categoria (pontos já multiplicados pela dificuldade e arredondados) */
export type Score = Record<ScoreCategory, number>;
/** evento de pontos do sobrevivente (`points.events.*`) e do caçador (`points.hunter_events.*`) */
export type SurvivorPointEvent = keyof Balance["points"]["events"];
export type HunterPointEvent = keyof Balance["points"]["hunter_events"];

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
  /** pontos que este sobrevivente fez, por categoria (GDD-v0.2 §7.1) */
  score: Score;
  /** v1 com `ai.bot_brain: competent`: estado do cérebro do bot (R4); ausente no jogador humano e nos bots do protótipo */
  ai?: BotAi;
}

/** modos do bot competente (GDD-v0.3 §8.1: máquina de estados com utilidade) */
export type BotMode = "work" | "flee" | "rescue" | "escape" | "wait";

/** caçador como o bot o viu pela última vez (snapshot filtrado: só com linha de visão até `ai.bots.sight_radius`) */
export interface BotSeenHunter extends Vec {
  /** instante da leitura */
  at: number;
  /** preparo visível (telegraph, GDD-v0.2 §4.1) */
  windup: Windup["kind"] | null;
  stunned: boolean;
}

/** evento que o bot percebeu e ainda não tratou (reage depois de um atraso de `ai.bots.ping_reaction`) */
export interface BotPending { kind: "caged" | "danger"; id: number; x: number; z: number; at: number }

/** estado do bot competente (R4). Dado puro e serializável: entra no hash de determinismo. */
export interface BotAi {
  /** chave em `ai.bots.personalities` (sorteada pelo PRNG da partida) */
  personality: string;
  mode: BotMode;
  perceiveIn: number;
  decideIn: number;
  /** última vez que viu o caçador (null = nunca); `seen` = visto na leitura atual */
  hunter: BotSeenHunter | null;
  seen: boolean;
  /** instante em que o bot reage ao caçador que acabou de aparecer (tempo de reação, `ai.bots.ping_reaction`) */
  reactAt: number;
  /** instante em que olha em volta depois de o batimento começar (`look_on_heartbeat`) */
  lookAt: number;
  /** próxima olhada em volta (360°) fora de interação (`ai.bots.glance_interval`) */
  glanceAt: number;
  /** no quebra-cabeça ou segurando o resgate: a câmera fica no alvo da interação */
  busy: boolean;
  /** batimento: caçador a menos de `prototype_extras.heartbeat.radius` (só a distância, sem direção; P-03) */
  heartbeat: boolean;
  lastHp: number;
  /** instante do último dano recebido */
  hitAt: number | null;
  /** stamina esgotada: anda até `ai.bots.stamina_resume` */
  exhausted: boolean;
  /** correu no último passo */
  running: boolean;
  /** aliados que o bot sabe estarem presos (HUD) e eventos à espera do tempo de reação */
  caged: number[];
  pending: BotPending[];
  /** perigos conhecidos (gerador revelado, falha ouvida) até `until` */
  dangers: { x: number; z: number; until: number }[];
  /** loop (id dos metadados do mapa) usado na fuga */
  loop: string | null;
  /** instante em que chegou à rota do loop atual (-1 = ainda a caminho) */
  loopSince: number;
  /** gerador escolhido (índice em `gens`, -1 = nenhum) e aliado a resgatar (-1) */
  gen: number;
  rescueId: number;
  /** capturas na última atualização (detecta a volta da gaiola: caminho velho) */
  captures: number;
  // navegação (GDD-v0.3 §8.6), mesmo esquema do caçador
  goal: Vec | null;
  path: Vec[];
  pathOk: boolean;
  forceAstar: boolean;
  stuck: { t: number; x: number; z: number; ex: number; ez: number };
  replans: number;
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
  /**
   * sobreviventes fora de jogo (enjaulado, morto ou que escapou): ids. Estado público da partida (todos sabem quem
   * está preso, morto ou fora); não traz posição
   */
  gone: number[];
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
  /**
   * histerese do termo "protegido" (D-52): estado filtrado por sobrevivente (`on`) e desde quando a leitura
   * instantânea discorda dele (`since`, -1 = concorda)
   */
  protection: { id: number; on: boolean; since: number }[];
  /** última posição conhecida do alvo (memória da dificuldade) */
  memory: {
    id: number; x: number; z: number; until: number;
    /** velocidade percebida na última leitura (direção de fuga projetada ao chegar à última posição, D-35) */
    vx: number; vz: number;
    /** centro da vasculha quando não há projeção possível (última posição vista ou o fim da projeção) */
    ax: number; az: number;
  } | null;
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
  /**
   * contagem de voltas no loop em que o alvo corre (GDD-v0.3 §8.4). `src` = de onde veio o último ângulo: "target"
   * (alvo percebido) ou "self" (o próprio caçador, enquanto segue o alvo lembrado atrás do obstáculo, R8 passo 1)
   */
  loop: { id: string; target: number; acc: number; last: number; src: "target" | "self" } | null;
  /** alvo visível (no cone, não só revelado) na decisão anterior (-1 = nenhum): reencontro do alvo (R8 passo 1) */
  seenTarget: number;
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
  /** linha da saída na parede norte/sul (z); ausente com saída lateral */
  exitZ?: number;
  /**
   * linha da saída na parede lateral (x; D-25, ruleset v1, `maps.v1.side_exit`); ausente com saída norte/sul.
   * Regra do portão lateral para o cliente: a parede do portão (o lado de fora) é o sinal de `gate.x − exitX`
   * (−1 = oeste, +1 = leste; o mesmo vetor está em `gateFacing`); a abertura corre em z, centrada em `gate.z`, com
   * meia-largura `prototype_extras.gate_exit_half_width`. Escapa quem cruza a linha x = exitX para o lado de fora.
   */
  exitX?: number;
  /**
   * vetor unitário do portão para fora do mapa, em todas as saídas e nos dois rulesets: lateral {x: ±1, z: 0},
   * norte/sul {x: 0, z: ±1} (norte do protótipo: {x: 0, z: −1}). O cliente gira o portão por ele sem deduzir a parede;
   * a abertura é perpendicular a ele, com meia-largura `prototype_extras.gate_exit_half_width`.
   */
  gateFacing: { x: number; z: number };
  /**
   * Cópia opcional das caixas [x, z, largura, profundidade] da partida, só no v1 com `maps.v1.short_loop_pillars`.
   * A FONTE ÚNICA das paredes no cliente é `cfg.map.walls` (SimConfig.map, o mapa efetivo: no v1 inclui os pilares
   * da D-23; no protótipo é o mapa de topo). Este campo repete a mesma lista e pode faltar.
   */
  walls?: [number, number, number, number][];
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
  /**
   * só no v1: pontos creditados (GDD-v0.2 §7.1). `who` = id do sobrevivente, ou −1 para o caçador (categoria "hunter").
   * `value` é inteiro (já com `points_mult` e `points.rounding`).
   */
  | { type: "points"; who: number; event: SurvivorPointEvent | HunterPointEvent; value: number; category: ScoreCategory | "hunter" }
  | {
      type: "end"; win: boolean; outcome: Outcome; coins: number; time: number;
      /** só no v1: resultado da equipe, motivo do fim e resultado individual do jogador */
      team?: Team; reason?: EndReason; individual?: Individual;
      /** só no v1: placar do jogador nas 4 categorias do §7.1 */
      score?: Score;
      /**
       * só no v1: o jogador recebeu o bônus `economy.win_coins` (regra `economy.win_coins_to`). Com `escaped`, `win`
       * pode ser true sem bônus (venceu com o time, mas não escapou).
       */
      winCoins?: boolean;
    }
  /** só no modo tutorial (D-34): a etapa `step` (posição `index` em `tutorial.steps`) foi concluída */
  | {
      type: "tutorial_step"; step: TutorialStepName; index: number; done: true;
      /** só quando a etapa foi pulada (`skipTutorialStep`, telemetria de FTUE do GDD-v0.3 §12.3); ausente na conclusão normal */
      skipped?: true;
    }
  /** só no modo tutorial: a última etapa foi concluída; a partida para (`over`). `time` = segundos inteiros (FTUE, §12.3) */
  | { type: "tutorial_end"; time: number };

/** modo da partida: normal (protótipo ou v1) ou o Treino do GDD-v0.3 §12.3 (D-34) */
export type GameMode = "normal" | "tutorial";
export interface GameOptions { mode?: GameMode }
/** etapa do Treino (`tutorial.steps` em data/balance.yaml, GDD-v0.3 §12.3) */
export type TutorialStepName = Balance["tutorial"]["steps"][number];
/** alvo da etapa: gerador (`id` = índice em `gens`) ou aliado preso (`id` = id do sobrevivente), com a posição */
export interface TutorialTarget { kind: "generator" | "cage"; id: number; x: number; z: number }
/** estado do Treino; dado puro (entra no hash). Ausente fora do modo tutorial. */
export interface TutorialState {
  /** etapa atual; null depois da última (tutorial concluído) */
  step: TutorialStepName | null;
  /** posição da etapa atual em `tutorial.steps` (= número de etapas no fim) */
  index: number;
  /** alvo da etapa (null em "mover" e na habilidade sem alvo) */
  target: TutorialTarget | null;
  /** progresso da etapa atual: metros andados em "move", acertos em "puzzle"; 0 nas demais */
  progress: number;
  /** meta de `progress` na etapa atual (`tutorialGoal`): metros em "move", acertos em "puzzle", 1 nas demais; 0 no fim */
  goal: number;
}

/** rastreio da pontuação do v1 (perseguição em curso e revelações já pontuadas); dado puro */
export interface ScoreTrack {
  /** perseguição em curso: alvo e instante em que começou */
  chase: { target: number; since: number } | null;
  /** sobreviventes cuja revelação atual já rendeu `revelação eficaz` ao caçador */
  revealHit: number[];
  /**
   * último capturado (−1 = nenhum): o alvo do caçador pode ficar parado nele depois da captura (atordoado, ninguém
   * livre); enquanto o alvo bruto for este id, não há perseguição. Limpo quando o alvo bruto muda.
   */
  stale: number;
}

export interface GameState {
  t: number;
  seed: number;
  /** pontos do jogador (survivors[0]); é o que vira moedas no fim */
  points: number;
  /** pontos do caçador (GDD-v0.2 §7.1; só no v1) */
  hunterPoints: number;
  scoreTrack: ScoreTrack;
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
  /** só no modo tutorial (D-34); ausente na partida normal (o hash da partida normal não muda) */
  tutorial?: TutorialState;
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
