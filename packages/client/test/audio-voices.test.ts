// Gerenciador de vozes (A-4 do V5; GDD-v0.3 §11, aceite "33ª voz derruba a de menor prioridade"): vagas, roubo por
// prioridade e idade, recusa, liberação e tabela de prioridade do YAML. Núcleo puro, sem Web Audio.
import { describe, expect, it, vi } from "vitest";
import { loadBalanceFile } from "@thehell/shared/node";
import { createVoiceManager, type Voice } from "../src/audio/voices.ts";

const bal = loadBalanceFile(new URL("../../../data/balance.yaml", import.meta.url).pathname);
const cfg = bal.audio;
const P = cfg.voice_priority;
const kinds = Object.keys(P).sort((a, b) => P[a] - P[b]);
const lowest = kinds[0], highest = kinds[kinds.length - 1];

function clock() { let t = 0; return { now: () => t, tick: () => { t += 1; } }; }

describe("audio/voices (A-4)", () => {
  it("prioridades e teto vêm do YAML (max_voices = 32, tabela voice_priority)", () => {
    expect(cfg.max_voices).toBe(32);
    const m = createVoiceManager();
    expect(m.max).toBe(cfg.max_voices);
    for (const k of kinds) expect(m.priorityOf(k)).toBe(P[k]);
    expect(kinds.length).toBeGreaterThan(2);
  });

  it("a 33ª derruba a de menor prioridade e, entre as empatadas, a mais antiga, chamando onSteal dela", () => {
    const c = clock();
    const m = createVoiceManager({ max: cfg.max_voices, priorities: P, now: c.now });
    const stolen: Voice[] = [];
    const spies = new Map<number, ReturnType<typeof vi.fn>>();
    // prioridades mistas: percorre os tipos acima do menor; 3 vozes do tipo menor espalhadas no tempo
    const mid = kinds.slice(1);
    const lowIds: number[] = [];
    for (let i = 0; i < cfg.max_voices; i++) {
      const kind = i === 5 || i === 12 || i === 20 ? lowest : mid[i % mid.length];
      const spy = vi.fn((v: Voice) => { stolen.push(v); });
      const v = m.acquire(kind, { onSteal: spy })!;
      expect(v).not.toBeNull();
      spies.set(v.id, spy);
      if (kind === lowest) lowIds.push(v.id);
      c.tick();
    }
    expect(m.count).toBe(32);
    const oldestLow = m.active().find(v => v.id === lowIds[0])!;

    const nova = m.acquire(highest)!;
    expect(nova).not.toBeNull();
    expect(m.count).toBe(32);
    expect(stolen.map(v => v.id)).toEqual([oldestLow.id]);
    expect(spies.get(oldestLow.id)).toHaveBeenCalledTimes(1);
    expect(oldestLow.active).toBe(false);
    expect(m.active().some(v => v.id === oldestLow.id)).toBe(false);
    // as outras duas de menor prioridade continuam; a próxima a sair é a segunda mais antiga
    m.acquire(highest);
    expect(stolen.map(v => v.id)).toEqual([lowIds[0], lowIds[1]]);
    // release depois do roubo não mexe na contagem
    oldestLow.release();
    expect(m.count).toBe(32);
  });

  it("empate com a menor prioridade ativa: derruba a mais antiga dela", () => {
    const c = clock();
    const m = createVoiceManager({ max: 3, priorities: P, now: c.now });
    const a = m.acquire(lowest)!; c.tick();
    const b = m.acquire(lowest)!; c.tick();
    m.acquire(highest); c.tick();
    const d = m.acquire(lowest);
    expect(d).not.toBeNull();
    expect(a.active).toBe(false);
    expect(b.active).toBe(true);
  });

  it("nova de prioridade menor que todas as ativas é recusada (null) e ninguém sai", () => {
    const m = createVoiceManager({ max: cfg.max_voices, priorities: P });
    const onSteal = vi.fn();
    for (let i = 0; i < cfg.max_voices; i++) m.acquire(kinds[1], { onSteal });
    expect(m.acquire(lowest)).toBeNull();
    expect(onSteal).not.toHaveBeenCalled();
    expect(m.count).toBe(32);
  });

  it("release (fim natural) devolve a vaga; é idempotente e não chama onSteal", () => {
    const m = createVoiceManager({ max: cfg.max_voices, priorities: P });
    const onSteal = vi.fn();
    const vs = Array.from({ length: cfg.max_voices }, () => m.acquire(highest, { onSteal })!);
    expect(m.acquire(lowest)).toBeNull();
    vs[7].release();
    vs[7].release();
    expect(m.count).toBe(31);
    expect(m.acquire(lowest)).not.toBeNull();
    expect(m.count).toBe(32);
    expect(onSteal).not.toHaveBeenCalled();
    m.clear();
    expect(m.count).toBe(0);
  });

  it("tipo desconhecido lança erro (não toca calado nem rouba vaga)", () => {
    const m = createVoiceManager({ max: 2, priorities: P });
    expect(() => m.acquire("tipo_inexistente")).toThrow(/desconhecido/);
    expect(() => m.acquire("toString")).toThrow(/desconhecido/);
    expect(m.count).toBe(0);
  });
});
