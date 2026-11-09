// Motor de áudio (item A-1 do V5; GDD-v0.3 §11 e GDD-v0.2 §11): um AudioContext preguiçoso, barramentos
// music/sfx/voice/ui → master → destination, desbloqueio no primeiro gesto e volume persistente em localStorage.
// O AudioContext só nasce quando alguém pede (gesto, initAudio, barramento); o import não cria nada, para rodar em
// Node (testes) e sem Web Audio (tudo vira no-op). Valores de mixagem: data/balance.yaml `audio.buses` e
// `audio.volume_ramp_tc`.
import type { Balance } from "@thehell/shared";
import { balance } from "../data.ts";

/** barramentos de entrada: os sliders de música, efeitos, voz e UI (GDD-v0.3 §11, Mixagem) */
export const BUSES = ["music", "sfx", "voice", "ui"] as const;
export type BusName = (typeof BUSES)[number];
/** tudo que tem volume próprio: os 4 barramentos e o master */
export type VolumeName = BusName | "master";
export type Volumes = Record<VolumeName, number>;
const VOLUME_NAMES: readonly VolumeName[] = [...BUSES, "master"];

export type AudioCfg = Pick<Balance["audio"], "buses" | "volume_ramp_tc">;
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
  /** cria o contexto e o grafo se ainda não existem; null sem Web Audio */
  ensure(): AudioContext | null;
  /** cria (se preciso) e chama resume(); deve rodar dentro de um gesto do usuário */
  unlock(): Promise<void>;
  /** nó de entrada de um barramento (A-2…A-5 conectam aqui); cria o contexto se preciso; null sem Web Audio */
  busInput(bus: BusName): AudioNode | null;
  /** limita a [0, 1], aplica com rampa e persiste; devolve o valor aplicado */
  setBusVolume(bus: VolumeName, v: number): number;
  getBusVolume(bus: VolumeName): number;
  volumes(): Volumes;
  state(): AudioContextState | "none";
  /** ouvintes pointerdown/keydown que desbloqueiam o contexto; saem sozinhos quando ele fica "running" */
  installUnlock(target: EventTarget): void;
}

/** chave do localStorage (não é número de jogo; mesmo padrão de ui/shop.ts e i18n/index.ts) */
export const STORAGE_KEY = "thehell.audio.volumes";
const GESTURES = ["pointerdown", "keydown"] as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** volumes salvos; JSON inválido, valor fora de tipo ou storage que lança caem no padrão do YAML, chave a chave */
function loadVolumes(storage: VolumeStorage | null, defaults: Volumes): Volumes {
  const out = { ...defaults };
  if (!storage) return out;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return out;
    const j: unknown = JSON.parse(raw);
    if (!j || typeof j !== "object") return out;
    for (const k of VOLUME_NAMES) {
      const v = (j as Record<string, unknown>)[k];
      if (typeof v === "number" && Number.isFinite(v)) out[k] = clamp01(v);
    }
  } catch { /* sem armazenamento ou JSON corrompido: padrão */ }
  return out;
}

function defaultContext(): AudioContext | null {
  const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

function defaultStorage(): VolumeStorage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function createEngine(deps: EngineDeps = {}): AudioEngine {
  const cfg = deps.cfg ?? balance.audio;
  const createContext = deps.createContext ?? defaultContext;
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const vol = loadVolumes(storage, { ...cfg.buses });
  let ctx: AudioContext | null = null;
  let tried = false;
  let master: GainNode | null = null;
  const nodes = {} as Record<BusName, GainNode>;
  const targets: EventTarget[] = [];

  const ensure = (): AudioContext | null => {
    if (tried) return ctx;
    tried = true;
    try {
      const c = createContext();
      if (!c) return null;
      const m = c.createGain();
      m.gain.value = vol.master;
      m.connect(c.destination);
      for (const b of BUSES) {
        const g = c.createGain();
        g.gain.value = vol[b];
        g.connect(m);
        nodes[b] = g;
      }
      master = m;
      ctx = c;
    } catch { ctx = null; master = null; }
    return ctx;
  };

  const removeUnlock = () => {
    for (const t of targets.splice(0)) for (const ev of GESTURES) t.removeEventListener(ev, onGesture, true);
  };

  async function unlock(): Promise<void> {
    const c = ensure();
    if (!c) { removeUnlock(); return; }
    try { if (c.state !== "running") await c.resume(); } catch { /* resume recusado: tenta no próximo gesto */ }
    if (c.state === "running") removeUnlock();
  }

  function onGesture() { void unlock(); }

  const persist = () => {
    if (!storage) return;
    try { storage.setItem(STORAGE_KEY, JSON.stringify(vol)); } catch { /* sem armazenamento */ }
  };

  return {
    get context() { return ctx; },
    ensure,
    unlock,
    busInput(bus) { return ensure() ? nodes[bus] ?? null : null; },
    setBusVolume(bus, v) {
      if (!VOLUME_NAMES.includes(bus) || !Number.isFinite(v)) return vol[bus];
      const x = clamp01(v);
      vol[bus] = x;
      const node = bus === "master" ? master : nodes[bus];
      if (ctx && node) {
        try { node.gain.setTargetAtTime(x, ctx.currentTime, cfg.volume_ramp_tc); } catch { /* contexto fechado */ }
      }
      persist();
      return x;
    },
    getBusVolume(bus) { return vol[bus]; },
    volumes() { return { ...vol }; },
    state() { return ctx?.state ?? "none"; },
    installUnlock(target) {
      if (targets.includes(target)) return;
      targets.push(target);
      for (const ev of GESTURES) target.addEventListener(ev, onGesture, true);
    },
  };
}

let engine: AudioEngine | null = null;
/** singleton preguiçoso com o AudioContext e o localStorage reais */
export function getEngine(): AudioEngine {
  return (engine ??= createEngine());
}

/** nó de entrada do barramento (atalho do singleton) */
export const getBusInput = (bus: BusName) => getEngine().busInput(bus);
export const setBusVolume = (bus: VolumeName, v: number) => getEngine().setBusVolume(bus, v);
export const getBusVolume = (bus: VolumeName) => getEngine().getBusVolume(bus);

export interface AudioHookState { state: AudioContextState | "none"; buses: Volumes }
declare global {
  interface Window { __thehellAudio?: () => AudioHookState }
}

/** no navegador: desbloqueio no primeiro gesto e gancho só-leitura para o e2e (tools/audio/e2e.mjs); não cria contexto */
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  getEngine().installUnlock(window);
  window.__thehellAudio = () => { const e = getEngine(); return { state: e.state(), buses: e.volumes() }; };
}
