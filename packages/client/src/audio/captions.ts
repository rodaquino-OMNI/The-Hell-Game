// Legendas de som (item A-6 do V5; GDD-v0.3 §12.4 "legendas de sons"). Barramento puro, sem DOM: o diretor
// (director.ts) publica uma legenda no mesmo passo em que o efeito correspondente tocou de verdade (playSfx devolveu
// voz); efeito cortado pelo raio da D-37 (docs/plano-construcao.md §7) ou recusado pelo limite de vozes não gera
// legenda, então a legenda nunca diz mais do que o som. A sessão Visual assina a lista e desenha no HUD; cor,
// tamanho e posição são dela (docs/handoff/sessoes.md §2). O texto vem do i18n (chaves `caption.*`, GDD-v0.3 §12.5).
// Direção: setor de `ui.threat_sectors` relativo à câmera (GDD-v0.3 §12.1), pela função da seta de ameaça
// (geom/sector.ts `relativeSector`), sem geometria duplicada; null = som sem posição (do próprio jogador ou da UI).
// Regras: duração, limite de simultâneas (a nova derruba a de menor prioridade e mais antiga, se a sua for maior ou
// igual), fusão da mesma chave (mesma direção, ou dentro de `merge_window`) e estado inicial da opção: data/balance.yaml
// `audio.captions`. Prioridade = `audio.voice_priority` do `kind` do efeito (audio.sfx).
// Ícone: cada legenda traz `category` (hunter_steps | hunter_attack | generator | survivor, mapeada em
// `audio.captions.effects`) e `dir`; a Visual desenha o ícone direcional do GDD-v0.3 §11 (L218, "ícone direcional
// para passos de corrida, falha de gerador, grito do caçador e resgate") a partir dos dois, para a informação não
// depender só do texto nem da cor (WCAG 2.2, 1.3.3 Características sensoriais e 1.4.1 Uso de cor). O áudio entrega
// só dados: ícone, cor, tamanho e posição são da Visual.
// Sem legenda de propósito: o batimento, porque a seta de ameaça do HUD (GDD-v0.3 §12.1) já mostra o setor do
// caçador a < ui.threat_radius, e legendar cada batida repetiria a informação; respiração, zumbido, passos do próprio
// jogador e bipes de UI, que são retorno da própria ação (ver o comentário de `audio.captions.effects`).
// `relativeSector` vem do módulo neutro geom/sector.ts (o mesmo da seta de ameaça, hud/threat.ts).
// Opções do menu, no localStorage com try/catch: liga/desliga (`thehell.audio.captions`; padrão ligado, D-39) e
// duração na tela (`thehell.audio.captions.duration`; só valores de `audio.captions.durations`, padrão 3 s, D-40).
// Desligada, nada é publicado.
import type { Balance } from "@thehell/shared";
import type { Vec } from "@thehell/sim";
import { balance } from "../data.ts";
import { relativeSector } from "../geom/sector.ts";
import { t } from "../i18n/index.ts";

/**
 * Chaves de legenda. Ficam aqui como literais para o `pnpm i18n:check` (regra 4: toda chave citada no código) e o
 * teste conferem que cada `audio.captions.effects` aponta para uma delas e que as três línguas as têm.
 */
export const CAPTION_KEYS = [
  "caption.hunter_steps", "caption.hunter_growl", "caption.hunter_dash", "caption.hunter_projectile",
  "caption.hunter_trap", "caption.puzzle_fail", "caption.generator_done", "caption.cage", "caption.rescue",
] as const;
export type CaptionKey = (typeof CAPTION_KEYS)[number];
/** categoria da legenda (ícone direcional da Visual); vem de `audio.captions.effects[efeito].category` */
export type CaptionCategory = Balance["audio"]["captions"]["effects"][string]["category"];
const isCaptionKey = (k: string): k is CaptionKey => (CAPTION_KEYS as readonly string[]).includes(k);

export interface Caption {
  /** identificador estável enquanto a legenda vive (a fusão mantém o id) */
  readonly id: number;
  /** chave i18n `caption.*` */
  readonly key: CaptionKey;
  /** categoria do som, para o ícone direcional (GDD-v0.3 §11, L218) */
  readonly category: CaptionCategory;
  /** texto no idioma atual (i18n `t`), resolvido a cada leitura */
  readonly text?: string;
  /** setor 0..ui.threat_sectors−1 (0 = frente, sentido horário) relativo à câmera; null = sem direção */
  readonly dir: number | null;
  /** 0–1: intensidade pedida ao efeito × atenuação de distância do panner (audio.panner), o volume que se ouve */
  readonly intensity: number;
  /** instante (s, relógio do barramento, que anda com tickCaptions) da última emissão */
  readonly t: number;
  /** segundos que ainda restam na tela (some em 0); renovado a captionDuration() na fusão */
  readonly ttl: number;
  /** quantas emissões fundidas nesta legenda (1 = só a primeira) */
  readonly count: number;
  /** prioridade (audio.voice_priority do efeito) */
  readonly priority: number;
}

export type CaptionsCfg = Pick<Balance["audio"], "captions" | "sfx" | "voice_priority" | "panner"> & {
  /** só `threat_sectors` é lido */
  ui?: Pick<Balance["ui"], "threat_sectors">;
};
/** o que o barramento precisa saber do som que tocou */
export interface CaptionSound {
  /** nome do efeito do catálogo `audio.sfx` (só os de `audio.captions.effects` geram legenda) */
  name: string;
  /** posição da fonte; null/ausente = sem direção */
  pos?: Vec | null;
  /** ouvinte (personagem visto) e yaw da câmera; sem algum dos dois a legenda sai sem direção */
  ear?: Vec | null;
  yaw?: number;
  /** intensidade pedida ao efeito (0–1, padrão 1) */
  intensity?: number;
}
export type CaptionStorage = Pick<Storage, "getItem" | "setItem">;

export interface CaptionDeps {
  cfg?: CaptionsCfg;
  /** padrão: localStorage (null = sem persistência) */
  storage?: CaptionStorage | null;
  /** tradução (padrão: i18n `t` no idioma atual) */
  translate?: (key: CaptionKey) => string;
}

export interface CaptionBus {
  /** publica a legenda do som que tocou; devolve a legenda criada/fundida, ou null (desligado, efeito sem legenda,
   *  lista cheia de prioridade maior) */
  emit(s: CaptionSound): Caption | null;
  /** avança o relógio e expira as legendas com ttl ≤ 0 */
  tick(dt: number): void;
  list(): Caption[];
  subscribe(cb: (list: Caption[]) => void): () => void;
  setEnabled(on: boolean): void;
  enabled(): boolean;
  /** escolhe a duração na tela (s); só aceita um valor de `audio.captions.durations` (devolve false e não muda
   *  nada com outro); grava no localStorage. Vale para as emissões seguintes */
  setDuration(s: number): boolean;
  duration(): number;
  clear(): void;
}

/** chave do localStorage (não é número de jogo; mesmo padrão de engine.ts e i18n/index.ts) */
export const CAPTIONS_STORAGE_KEY = "thehell.audio.captions";
/** chave do localStorage da duração escolhida (s) */
export const CAPTIONS_DURATION_KEY = "thehell.audio.captions.duration";
const ON = "1", OFF = "0";

function defaultStorage(): CaptionStorage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Ganho de distância do PannerNode com os parâmetros de `audio.panner` (fórmulas da especificação Web Audio,
 * https://webaudio.github.io/web-audio-api/#dom-pannernode-distancemodel), para a intensidade da legenda acompanhar
 * o volume que o jogador ouve.
 */
export function distanceGain(d: number, p: Balance["audio"]["panner"]): number {
  const ref = p.ref_distance, max = p.max_distance, r = p.rolloff_factor;
  const x = Math.min(Math.max(d, ref), max);
  if (p.distance_model === "linear") return 1 - Math.min(r, 1) * (x - ref) / (max - ref);
  if (p.distance_model === "exponential") return Math.pow(x / ref, -r);
  return ref / (ref + r * (x - ref));
}

/** chave e prioridade da legenda do efeito `name`, ou null se o efeito não gera legenda */
export function captionFor(name: string, cfg: CaptionsCfg): { key: CaptionKey; category: CaptionCategory; priority: number } | null {
  const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  if (!own(cfg.captions.effects, name) || !own(cfg.sfx, name)) return null;
  const { key, category } = cfg.captions.effects[name];
  if (!isCaptionKey(key)) return null;
  return { key, category, priority: cfg.voice_priority[cfg.sfx[name].kind] ?? 0 };
}

interface Live { id: number; key: CaptionKey; category: CaptionCategory; dir: number | null; intensity: number; t: number; ttl: number; count: number; priority: number; seq: number }

export function createCaptionBus(deps: CaptionDeps = {}): CaptionBus {
  const cfg = deps.cfg ?? { ...balance.audio, ui: balance.ui };
  const c = cfg.captions;
  const sectors = cfg.ui?.threat_sectors ?? balance.ui.threat_sectors;
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const translate = deps.translate ?? ((k: CaptionKey) => t(k));
  const subs = new Set<(list: Caption[]) => void>();
  let live: Live[] = [];
  let clock = 0, nextId = 1, seq = 0;

  let on = c.enabled_default;
  try {
    const v = storage?.getItem(CAPTIONS_STORAGE_KEY);
    if (v === ON) on = true;
    else if (v === OFF) on = false;
  } catch { /* sem armazenamento: fica o padrão dos dados */ }
  let dur = c.durations[c.default_duration_index] ?? c.durations[0];
  try {
    const v = Number(storage?.getItem(CAPTIONS_DURATION_KEY) ?? NaN);
    if (c.durations.includes(v)) dur = v; // valor fora da lista (dado velho ou editado) é ignorado
  } catch { /* idem */ }

  const snapshot = (): Caption[] => live.map(l => {
    let text: string | undefined;
    try { text = translate(l.key); } catch { text = undefined; }
    return { id: l.id, key: l.key, category: l.category, text, dir: l.dir, intensity: l.intensity, t: l.t, ttl: l.ttl, count: l.count, priority: l.priority };
  });
  const notify = () => {
    if (!subs.size) return;
    const list = snapshot();
    for (const cb of [...subs]) { try { cb(list); } catch { /* assinante com erro não derruba o áudio */ } }
  };

  function emit(s: CaptionSound): Caption | null {
    if (!on) return null;
    const info = captionFor(s.name, cfg);
    if (!info) return null;
    const dir = s.pos && s.ear && s.yaw !== undefined ? relativeSector(s.ear, s.yaw, s.pos, sectors) : null;
    const dist = s.pos && s.ear ? Math.hypot(s.pos.x - s.ear.x, s.pos.z - s.ear.z) : 0;
    const intensity = clamp01((s.intensity ?? 1) * (s.pos && s.ear ? distanceGain(dist, cfg.panner) : 1));
    seq++;
    // fusão: mesma chave ainda na tela, vinda da mesma direção ou até merge_window s depois da última emissão
    const same = live.find(l => l.key === info.key && (l.dir === dir || clock - l.t <= c.merge_window));
    let out: Live;
    if (same) {
      // renova o tempo, a direção passa a ser a da emissão mais nova, a intensidade é a maior
      same.t = clock; same.ttl = dur; same.dir = dir; same.count++; same.seq = seq;
      same.intensity = Math.max(same.intensity, intensity);
      out = same;
    } else {
      if (live.length >= c.max_on_screen) {
        let victim = live[0];
        for (const l of live) if (l.priority < victim.priority || (l.priority === victim.priority && l.seq < victim.seq)) victim = l;
        if (victim.priority > info.priority) return null;
        live = live.filter(l => l !== victim);
      }
      out = { id: nextId++, key: info.key, category: info.category, dir, intensity, t: clock, ttl: dur, count: 1, priority: info.priority, seq };
      live.push(out);
    }
    notify();
    return snapshot().find(x => x.id === out.id) ?? null;
  }

  function tick(dt: number) {
    if (!(dt > 0)) return;
    clock += dt;
    if (!live.length) return;
    for (const l of live) l.ttl = Math.max(0, l.ttl - dt);
    const before = live.length;
    live = live.filter(l => l.ttl > 0);
    if (live.length !== before) notify();
  }

  function clear() {
    if (!live.length) return;
    live = [];
    notify();
  }

  return {
    emit, tick, clear,
    list: snapshot,
    subscribe(cb) {
      subs.add(cb);
      return () => { subs.delete(cb); };
    },
    setEnabled(v) {
      on = !!v;
      try { storage?.setItem(CAPTIONS_STORAGE_KEY, on ? ON : OFF); } catch { /* sem armazenamento */ }
      if (!on) clear();
    },
    enabled: () => on,
    setDuration(v) {
      if (!c.durations.includes(v)) return false;
      dur = v;
      try { storage?.setItem(CAPTIONS_DURATION_KEY, String(v)); } catch { /* sem armazenamento */ }
      return true;
    },
    duration: () => dur,
  };
}

let bus: CaptionBus | null = null;
/** barramento único do jogo (o diretor publica nele) */
export function getCaptionBus(): CaptionBus { return (bus ??= createCaptionBus()); }
/** troca o barramento único (testes); null recria no próximo uso */
export function useCaptionBus(b: CaptionBus | null) { bus = b; }

/** assina a lista de legendas; chamado só quando a lista muda (nova, fundida, expirada, limpa), não a cada quadro.
 *  Para fade ou contagem regressiva, leia getCaptions() no laço de render: o `ttl` vem atualizado ali, enquanto a
 *  lista recebida aqui fica com o ttl do momento da mudança. Devolve o cancelamento */
export const subscribeCaptions = (cb: (list: Caption[]) => void): (() => void) => getCaptionBus().subscribe(cb);
/** legendas na tela agora (cópia; `text` no idioma atual) */
export const getCaptions = (): Caption[] => getCaptionBus().list();
/** avança `dt` s e expira (o diretor já chama a cada quadro em updateAudio; não chame de novo no HUD) */
export const tickCaptions = (dt: number) => getCaptionBus().tick(dt);
/** liga/desliga as legendas (menu de opções) e grava no localStorage; desligar limpa a lista */
export const setCaptionsEnabled = (on: boolean) => getCaptionBus().setEnabled(on);
/** estado atual da opção (localStorage, ou `audio.captions.enabled_default`) */
export const captionsEnabled = () => getCaptionBus().enabled();
/** duração na tela (s) para o menu: só aceita um valor de `audio.captions.durations` (devolve false com outro) */
export const setCaptionDuration = (s: number): boolean => getCaptionBus().setDuration(s);
/** duração atual (s): a gravada, ou `durations[default_duration_index]` (D-40) */
export const captionDuration = () => getCaptionBus().duration();
/** valores que o menu pode oferecer (s) */
export const captionDurations = (): readonly number[] => balance.audio.captions.durations;
