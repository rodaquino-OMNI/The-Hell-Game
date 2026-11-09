// Áudio da fase 0: osciladores, como no protótipo, tocados pelo barramento `sfx` do motor (engine.ts, item A-1).
import { getEngine } from "./engine.ts";

/** cria e desbloqueia o contexto de áudio (precisa de gesto do usuário, por isso só no início da partida) */
export function initAudio() {
  void getEngine().unlock();
}

export function beep(f: number, d: number, v: number) {
  // sem contexto (antes do primeiro gesto ou sem Web Audio) não cria um: fica em silêncio, como no protótipo
  const e = getEngine(), audio = e.context;
  const out = audio ? e.busInput("sfx") : null;
  if (!audio || !out) return;
  try {
    const o = audio.createOscillator(), gn = audio.createGain();
    o.frequency.value = f; gn.gain.setValueAtTime(v, audio.currentTime); gn.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + d);
    o.connect(gn); gn.connect(out); o.start(); o.stop(audio.currentTime + d);
  } catch { /* áudio indisponível */ }
}

export const SOUNDS: Record<string, [number, number, number]> = { puzzle_ok: [660, 0.1, 0.2], puzzle_fail: [120, 0.25, 0.3], hit: [90, 0.2, 0.4], stun: [200, 0.15, 0.3], bolt: [300, 0.12, 0.3] };
