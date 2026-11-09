// Mudo do volume mestre pela tecla M (D-41, docs/plano-construcao.md §7): acesso mínimo ao volume sem abrir o código
// até os sliders da sessão Visual (V8; GDD-v0.3 §11 "sliders separados", §12.4). Alterna o barramento `master`
// (engine.ts setBusVolume, que já grava os volumes no localStorage) entre 0 e o valor de antes do mudo. O valor de
// antes também é gravado, para o M desfazer o mudo depois de recarregar a página; sem ele (ou se for 0) volta ao padrão
// `audio.buses.master` de data/balance.yaml.
// Tecla: KeyM não é usada por input.ts (WASD, setas, Espaço, Shift, Q, E, V, X, Esc, Backspace), hud/hud.ts (1–4,
// Espaço) nem ui/shop.ts (Esc); não há remapeamento de teclas no cliente.
import { balance } from "../data.ts";
import { getBusVolume, setBusVolume, type VolumeName } from "./engine.ts";

/** chave do localStorage com o volume mestre de antes do mudo */
export const UNMUTE_STORAGE_KEY = "thehell.audio.unmute";
/** tecla do mudo (KeyboardEvent.code) */
export const MUTE_KEY = "KeyM";

export interface MuteDeps {
  get(bus: VolumeName): number;
  set(bus: VolumeName, v: number): number;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  /** volume mestre padrão (audio.buses.master) */
  fallback?: number;
}

export interface MuteToggle {
  /** o master está em 0? */
  muted(): boolean;
  /** alterna e devolve o novo estado (true = mudo) */
  toggle(): boolean;
}

function defaultStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function createMuteToggle(deps: MuteDeps): MuteToggle {
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const fallback = deps.fallback ?? balance.audio.buses.master;
  const muted = () => deps.get("master") <= 0;
  const saved = (): number => {
    try {
      const v = Number(storage?.getItem(UNMUTE_STORAGE_KEY));
      return Number.isFinite(v) && v > 0 && v <= 1 ? v : fallback;
    } catch { return fallback; }
  };
  return {
    muted,
    toggle() {
      if (muted()) { deps.set("master", saved()); return false; }
      const before = deps.get("master");
      try { storage?.setItem(UNMUTE_STORAGE_KEY, String(before)); } catch { /* sem armazenamento */ }
      deps.set("master", 0);
      return true;
    },
  };
}

/** liga a tecla M em `target`: alterna o mudo e avisa `notify(mudo)`. Ignora repetição, modificadores e campos de
 *  texto. Devolve a função que desliga. */
export function installMuteKey(target: EventTarget, notify: (muted: boolean) => void = () => {}, toggle: MuteToggle = createMuteToggle({ get: getBusVolume, set: setBusVolume })): () => void {
  const onKey = (ev: Event) => {
    const e = ev as KeyboardEvent;
    if (e.code !== MUTE_KEY || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target as { tagName?: string; isContentEditable?: boolean } | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
    notify(toggle.toggle());
  };
  target.addEventListener("keydown", onKey);
  return () => target.removeEventListener("keydown", onKey);
}
