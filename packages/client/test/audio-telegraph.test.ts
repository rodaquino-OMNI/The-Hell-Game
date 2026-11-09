// Telegraph sonoro com a simulação headless (A-5 do V5; GDD-v0.3 §11 "Teste: evento de som emitido ≥ 0,4 s antes
// do efeito"; GDD-v0.2 §4.1; docs/handoff/plano-audio-v5.md §3 e §4). Partidas determinísticas (sementes fixas) com
// `ruleset: v1` e a IA do R3 (`hunter_brain: utility`, a que põe golpe, dash, projétil e armadilha em
// `hunter.windup`), montadas como tools/sim/run.ts. Cada quadro vai ao diretor real (director.ts) tocando pelo
// catálogo real (sfx.ts) e pelo espacial real (spatial.ts) num AudioContext falso; registra-se o instante de cada
// playSfx. Para cada efeito de habilidade detectado no estado do sim, exige-se o telegraph do mesmo tipo antes.
//
// Antecedência mínima: o sim cria o preparo e já o decrementa no mesmo passo (ai/hunter.ts: `think` cria
// `H.windup` com t = telegraph_min e, no fim do mesmo passo, `H.windup.t -= dt`; solta com t ≤ EPS). O preparo dura
// 24 passos de sim (0,4 s do início do passo de criação ao fim do passo de disparo), mas o cliente só lê o estado entre
// passos: do 1º quadro em que o preparo aparece ao quadro do efeito passam 23 passos = telegraph_min − STEP. O
// diretor toca no mesmo quadro em que o preparo aparece (atraso zero, conferido abaixo), então a antecedência
// audível é limitada pelo sim, não pelo áudio. O teste exige ≥ telegraph_min − STEP e relata quantos efeitos
// cumprem o ≥ telegraph_min estrito; a correção (não decrementar no passo de criação) é da Frente R (sessoes.md §2).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameMap } from "@thehell/shared";
import { loadBalanceFile } from "@thehell/shared/node";
import { makeConfig, STEP, type Difficulty } from "@thehell/sim";
import { createAudioDirector } from "../src/audio/director.ts";
import { createEngine } from "../src/audio/engine.ts";
import { createSfx } from "../src/audio/sfx.ts";
import { createSpatial } from "../src/audio/spatial.ts";
import { FakeContext } from "../src/audio/testing/fake-webaudio.ts";
import { ABILITY_KINDS, measureTelegraph, runMatch } from "../src/audio/testing/headless.ts";
import { createVoiceManager } from "../src/audio/voices.ts";

const bal = loadBalanceFile(new URL("../../../data/balance.yaml", import.meta.url).pathname);
const patio = JSON.parse(readFileSync(new URL("../../../data/maps/patio.json", import.meta.url), "utf8")) as GameMap;
const DIFFS: Difficulty[] = ["easy", "normal", "hard", "nightmare"];
/** sementes fixas por dificuldade */
const SEEDS = [1, 2, 3, 4, 5, 6];
/** folga de ponto flutuante na comparação de tempos (soma de 1/60) */
const FP = 1e-9;

function rig() {
  const ctx = new FakeContext();
  const engine = createEngine({ createContext: () => ctx as unknown as AudioContext, storage: null, cfg: bal.audio });
  engine.ensure();
  const voices = createVoiceManager({ max: bal.audio.max_voices, priorities: bal.audio.voice_priority, now: () => ctx.currentTime });
  const spatial = createSpatial({ engine, map: patio, cfg: bal.audio, voices });
  const sfx = createSfx({ context: () => ctx as unknown as BaseAudioContext, spatial, cfg: bal.audio });
  return { ctx, engine, sfx };
}

describe("audio/telegraph: som do preparo antes do efeito, em partidas headless (A-5)", () => {
  const music = { update: () => undefined, duckFor: () => undefined };
  const reports = DIFFS.map(difficulty => {
    const cfg = makeConfig(bal, patio, { ruleset: "v1", hunterBrain: "utility", difficulty });
    const { ctx, sfx } = rig();
    const rep = measureTelegraph(cfg, SEEDS, play => createAudioDirector({ play: (n, o) => play(n, o) as never, music, cfg: bal, enabled: true }),
      (name, opts, now) => { ctx.advance(now); return sfx.play(name, opts as never); });
    return { difficulty, rep };
  });

  it("todo efeito de habilidade (golpe, dash, projétil, armadilha) teve telegraph do mesmo tipo antes", () => {
    for (const { rep } of reports) for (const k of ABILITY_KINDS) expect(rep.byKind[k].missing, k).toBe(0);
    expect(reports.every(r => r.rep.refused === 0)).toBe(true); // o telegraph (prioridade máxima) sempre ganha voz
  });

  it("os 4 tipos ocorrem nas partidas", () => {
    for (const k of ABILITY_KINDS) expect(reports.reduce((n, r) => n + r.rep.byKind[k].n, 0), k).toBeGreaterThan(0);
  });

  it("antecedência ≥ telegraph_min − 1 passo do sim (limite de quem lê o estado entre passos) e ≤ preparo", () => {
    const min = bal.hunter.telegraph_min;
    const lines: string[] = [];
    let strict = 0, total = 0, worst = Infinity;
    for (const k of ABILITY_KINDS) {
      const all = reports.flatMap(r => r.rep.samples.filter(s => s.kind === k));
      const leads = all.map(s => s.lead!);
      const lo = Math.min(...leads), hi = Math.max(...leads);
      worst = Math.min(worst, lo);
      strict += leads.filter(l => l + FP >= min).length;
      total += leads.length;
      lines.push(`${k}: ${leads.length} efeitos, antecedência mín ${lo.toFixed(4)} s, máx ${hi.toFixed(4)} s`);
      expect(lo + FP, k).toBeGreaterThanOrEqual(min - STEP);
      expect(hi - FP, k).toBeLessThanOrEqual(min); // casou com o telegraph do próprio preparo, não com um antigo
    }
    console.log(`[A-5 telegraph] ${SEEDS.length} sementes × ${DIFFS.join("/")}\n  ${lines.join("\n  ")}\n  menor: ${worst.toFixed(4)} s; ≥ ${min} s estrito: ${strict}/${total}`);
  });

  it("o diretor toca o telegraph no mesmo quadro em que hunter.windup aparece (atraso zero do áudio)", () => {
    const cfg = makeConfig(bal, patio, { ruleset: "v1", hunterBrain: "utility", difficulty: "normal" });
    const seen: number[] = [], played: number[] = [];
    let now = 0, had = false;
    const dir = createAudioDirector({ play: n => { if (n.startsWith("telegraph_")) played.push(now); return null; }, music, cfg: bal, enabled: true });
    runMatch(cfg, 1, (g, dt) => {
      now = g.t;
      if (g.hunter.windup && !had) seen.push(g.t);
      had = !!g.hunter.windup;
      dir.update(g, 0, dt);
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(played).toEqual(seen);
  });
});
