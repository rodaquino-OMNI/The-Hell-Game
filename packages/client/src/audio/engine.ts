// Motor de áudio (item A-1 do V5; GDD-v0.3 §11 e GDD-v0.2 §11): um AudioContext preguiçoso, barramentos
// music/sfx/voice/ui → master → destination, desbloqueio no gesto do usuário (e de novo se o navegador suspender o
// contexto depois de ter rodado) e volume persistente em localStorage, gravado com atraso.
// O AudioContext só nasce quando alguém pede (gesto, initAudio, barramento); o import não cria nada, para rodar em
// Node (testes) e sem Web Audio (tudo vira no-op). Valores de mixagem: data/balance.yaml `audio.buses`,
// `audio.volume_ramp_tc` e `audio.volume_persist_delay`; taxa do contexto: `audio.compose.sample_rate` (a dos stems, A-3).
import type { Balance } from "@thehell/shared";
import { balance } from "../data.ts";

/** barramentos de entrada: os sliders de música, efeitos, voz e UI (GDD-v0.3 §11, Mixagem) */
export const BUSES = ["music", "sfx", "voice", "ui"] as const;
export type BusName = (typeof BUSES)[number];
/** tudo que tem volume próprio: os 4 barramentos e o master */
export type VolumeName = BusName | "master";
export type Volumes = Record<VolumeName, number>;
export type Plays = Record<BusName, number>;
const VOLUME_NAMES: readonly string[] = [...BUSES, "master"];
const isVolumeName = (b: unknown): b is VolumeName => typeof b === "string" && VOLUME_NAMES.includes(b);
const isBusName = (b: unknown): b is BusName => typeof b === "string" && (BUSES as readonly string[]).includes(b);

export type AudioCfg = Pick<Balance["audio"], "buses" | "volume_ramp_tc" | "volume_persist_delay">;
/** subconjunto de Storage que o motor usa (localStorage no navegador) */
export type VolumeStorage = Pick<Storage, "getItem" | "setItem">;
export interface EngineDeps {
  /** fábrica do contexto; null (ou exceção) = sem Web Audio */
  createContext?: () => AudioContext | null;
  /** onde persistir os volumes; null = sem persistência */
  storage?: VolumeStorage | null;
  cfg?: AudioCfg;
}

export interface AudioEngine {
  /** contexto atual, sem criar (null antes do primeiro uso ou sem Web Audio) */
  readonly context: AudioContext | null;
  /** cria o contexto e o grafo se ainda não existem; null sem Web Audio. Falha na criação permite nova tentativa */
  ensure(): AudioContext | null;
  /** cria (se preciso) e chama resume(); deve rodar dentro de um gesto do usuário */
  unlock(): Promise<void>;
  /** nó de entrada de um barramento (A-2…A-5 conectam aqui); cria o contexto se preciso; null sem Web Audio */
  busInput(bus: BusName): AudioNode | null;
  /** limita a [0, 1], aplica na hora com rampa e agenda a gravação; devolve o valor aplicado (NaN = nome inválido) */
  setBusVolume(bus: VolumeName, v: number): number;
  /** NaN para nome inválido */
  getBusVolume(bus: VolumeName): number;
  volumes(): Volumes;
  /** grava agora os volumes pendentes (também no `pagehide`) */
  flushVolumes(): void;
  /** registra um som tocado no barramento (contador lido pelo gancho do e2e) */
  notePlay(bus: BusName): void;
  plays(): Plays;
  state(): AudioContextState | "interrupted" | "none";
  /** ouvintes de gesto que desbloqueiam o contexto; saem quando ele roda e voltam se ele for suspenso depois */
  installUnlock(target: EventTarget): void;
}

/** chave do localStorage (não é número de jogo; mesmo padrão de ui/shop.ts e i18n/index.ts) */
export const STORAGE_KEY = "thehell.audio.volumes";
/** gestos que dão ativação ao documento (pointerdown de toque não dá; pointerup, touchend e click dão) */
export const GESTURES = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;
/** conversão de unidade (s → ms do setTimeout), não é número de jogo */
const MS_PER_S = 1000;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const noop = () => {};

/** volumes salvos; JSON inválido, valor fora de tipo ou storage que lança caem no padrão do YAML, chave a chave */
function loadVolumes(storage: VolumeStorage | null, defaults: Volumes): Volumes {
  const out = { ...defaults };
  if (!storage) return out;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return out;
    const j: unknown = JSON.parse(raw);
    if (!j || typeof j !== "object") return out;
    for (const k of VOLUME_NAMES as VolumeName[]) {
      const v = (j as Record<string, unknown>)[k];
      if (typeof v === "number" && Number.isFinite(v)) out[k] = clamp01(v);
    }
  } catch { /* sem armazenamento ou JSON corrompido: padrão */ }
  return out;
}

/** construtores de contexto que o navegador pode expor (webkitAudioContext: Safari antigo) */
export interface AudioCtors { AudioContext?: new (opts?: AudioContextOptions) => AudioContext; webkitAudioContext?: new (opts?: AudioContextOptions) => AudioContext }

/**
 * Cria o AudioContext na taxa dos stems (A-3). Os stems são gravados a `audio.compose.sample_rate`, e o decodeAudioData
 * reamostra para a taxa do contexto: num contexto de 44,1 kHz o reamostrador do Chromium trata o loop como buffer
 * finito (1 amostra a menos e borda descontínua = estalo na junção; tools/audio/check-loop.mjs). Forçando a taxa, o
 * buffer fica exato e o navegador reamostra só a saída para o dispositivo, como fluxo contínuo.
 * Navegador que recusa a opção (construtor lança): cai para o construtor sem opção; depois para webkitAudioContext.
 */
export function createAudioContext(sampleRate: number, g: AudioCtors = globalThis as unknown as AudioCtors): AudioContext | null {
  for (const Ctor of [g.AudioContext, g.webkitAudioContext]) {
    if (!Ctor) continue;
    try { return new Ctor({ sampleRate }); } catch { /* opção não suportada ou taxa recusada */ }
    try { return new Ctor(); } catch { /* este construtor não serve: tenta o próximo */ }
  }
  return null;
}

function defaultContext(): AudioContext | null {
  return createAudioContext(balance.audio.compose.sample_rate);
}

function defaultStorage(): VolumeStorage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** chama uma função que pode lançar ou devolver promessa rejeitada, sem propagar nada */
function quiet(f: () => unknown) {
  try { const r = f(); if (r && typeof (r as Promise<unknown>).catch === "function") (r as Promise<unknown>).catch(noop); } catch { /* ignora */ }
}

export function createEngine(deps: EngineDeps = {}): AudioEngine {
  const cfg = deps.cfg ?? balance.audio;
  const createContext = deps.createContext ?? defaultContext;
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const vol = loadVolumes(storage, { ...cfg.buses });
  const played: Plays = { music: 0, sfx: 0, voice: 0, ui: 0 };
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let nodes: Partial<Record<BusName, GainNode>> = {};
  /** o contexto já rodou alguma vez (suspensão depois disso = interrupção do navegador) */
  let ran = false;
  const targets: EventTarget[] = [];
  let armed = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;

  const listen = (t: EventTarget) => { for (const ev of GESTURES) t.addEventListener(ev, onGesture, true); };
  const arm = () => { if (armed) return; armed = true; for (const t of targets) listen(t); };
  const disarm = () => {
    if (!armed) return;
    armed = false;
    for (const t of targets) for (const ev of GESTURES) t.removeEventListener(ev, onGesture, true);
  };

  function onState() {
    if (!ctx) return;
    const s = ctx.state as string;
    if (s === "running") { ran = true; disarm(); }
    else if (ran && (s === "suspended" || s === "interrupted")) {
      // o navegador suspendeu (aba em segundo plano, chamada no iOS): tenta já e volta a ouvir gestos
      arm();
      const c = ctx;
      quiet(() => c.resume());
    }
  }

  const ensure = (): AudioContext | null => {
    if (ctx) return ctx;
    let c: AudioContext | null = null;
    try {
      c = createContext();
      if (!c) return null;
      const m = c.createGain();
      m.gain.value = vol.master;
      m.connect(c.destination);
      const made: Partial<Record<BusName, GainNode>> = {};
      for (const b of BUSES) {
        const g = c.createGain();
        g.gain.value = vol[b];
        g.connect(m);
        made[b] = g;
      }
      c.addEventListener?.("statechange", onState);
      master = m; nodes = made; ctx = c;
      onState(); // contexto que já nasce "running" (política de autoplay permissiva) conta como rodado
    } catch {
      // contexto parcial: fecha e deixa o próximo ensure()/gesto tentar de novo
      const partial = c;
      if (partial) quiet(() => partial.close());
      ctx = null; master = null; nodes = {};
    }
    return ctx;
  };

  async function unlock(): Promise<void> {
    const c = ensure();
    if (!c) return;
    try { if (c.state !== "running") await c.resume(); } catch { /* resume recusado: tenta no próximo gesto */ }
    if (c.state === "running") { ran = true; disarm(); }
  }

  /** só gesto real: evento sintético (ex.: o `.click()` que ui/menu.ts dispara ao montar o menu) não dá ativação de
   *  usuário ao documento e criaria o contexto antes da hora */
  function onGesture(e: Event) { if (e.isTrusted) void unlock(); }

  const flushVolumes = () => {
    if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
    if (!dirty || !storage) return;
    dirty = false;
    try { storage.setItem(STORAGE_KEY, JSON.stringify(vol)); } catch { /* sem armazenamento */ }
  };
  const scheduleSave = () => {
    if (!storage) return;
    dirty = true;
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushVolumes, cfg.volume_persist_delay * MS_PER_S);
  };

  return {
    get context() { return ctx; },
    ensure,
    unlock,
    busInput(bus) { return isBusName(bus) && ensure() ? nodes[bus] ?? null : null; },
    setBusVolume(bus, v) {
      if (!isVolumeName(bus)) return Number.NaN;
      if (!Number.isFinite(v)) return vol[bus];
      const x = clamp01(v);
      vol[bus] = x;
      const node = bus === "master" ? master : nodes[bus];
      if (ctx && node) {
        const p = node.gain, t = ctx.currentTime;
        try {
          p.cancelScheduledValues(t);
          p.setValueAtTime(p.value, t);
          p.setTargetAtTime(x, t, cfg.volume_ramp_tc);
        } catch { /* contexto fechado */ }
      }
      scheduleSave();
      return x;
    },
    getBusVolume(bus) { return isVolumeName(bus) ? vol[bus] : Number.NaN; },
    volumes() { return { ...vol }; },
    flushVolumes,
    notePlay(bus) { if (isBusName(bus)) played[bus]++; },
    plays() { return { ...played }; },
    state() { return ctx?.state ?? "none"; },
    installUnlock(target) {
      if (targets.includes(target)) return;
      targets.push(target);
      if (ctx?.state === "running") return;
      if (armed) listen(target); else arm();
    },
  };
}

let engine: AudioEngine | null = null;
/** singleton preguiçoso com o AudioContext e o localStorage reais */
export function getEngine(): AudioEngine {
  return (engine ??= createEngine());
}
/** troca o motor do singleton (testes injetam um com contexto falso; null volta ao real na próxima chamada) */
export function useEngine(e: AudioEngine | null) { engine = e; }

/** nó de entrada do barramento (atalho do singleton) */
export const getBusInput = (bus: BusName) => getEngine().busInput(bus);
export const setBusVolume = (bus: VolumeName, v: number) => getEngine().setBusVolume(bus, v);
export const getBusVolume = (bus: VolumeName) => getEngine().getBusVolume(bus);
export const flushVolumes = () => getEngine().flushVolumes();

export interface AudioHookState { state: ReturnType<AudioEngine["state"]>; buses: Volumes; plays: Plays }
declare global {
  interface Window { __thehellAudio?: () => AudioHookState }
}

/** no navegador: desbloqueio no gesto, gravação ao sair da página e gancho só-leitura do e2e (tools/audio/e2e.mjs).
 *  Nada disso cria o AudioContext. */
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  getEngine().installUnlock(window);
  window.addEventListener("pagehide", () => getEngine().flushVolumes());
  window.__thehellAudio = () => { const e = getEngine(); return { state: e.state(), buses: e.volumes(), plays: e.plays() }; };
}
