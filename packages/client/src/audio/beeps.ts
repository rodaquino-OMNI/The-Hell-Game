// Áudio da fase 0: osciladores, como no protótipo, tocados pelo barramento `sfx` do motor (engine.ts, item A-1).
// Fachada mantida para main.ts e hud/hud.ts (donos: Visual). Os valores dos 5 bipes vêm do catálogo do A-5
// (data/balance.yaml `audio.sfx`, 1ª camada de cada efeito); com `audio.director_enabled` o diretor (director.ts)
// toca os mesmos efeitos com a receita completa.
import type { GameEvent } from "@thehell/sim";
import { balance } from "../data.ts";
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
    e.notePlay("sfx");
  } catch { /* áudio indisponível */ }
}

/** nomes dos GameEvent "sound" (packages/sim/src/types.ts) */
export type SoundName = Extract<GameEvent, { type: "sound" }>["name"];
export const SOUND_NAMES: readonly SoundName[] = ["puzzle_ok", "puzzle_fail", "hit", "stun", "bolt"];

/** [frequência, duração, volume] do bipe = 1ª camada (oscilador) do efeito no catálogo `audio.sfx` */
function beepOf(name: string): [number, number, number] {
  const l = balance.audio.sfx[name]?.recipe[0];
  if (!l || l.type !== "osc" || l.freq === undefined) throw new Error(`audio.sfx.${name}: 1ª camada deve ser oscilador`);
  return [l.freq, l.attack + l.decay, l.gain];
}

export const SOUNDS: Record<string, [number, number, number]> = Object.fromEntries(SOUND_NAMES.map(n => [n, beepOf(n)]));
