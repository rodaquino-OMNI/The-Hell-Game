// Telegraph sonoro com a simulação headless (A-5 do V5; GDD-v0.3 §11 "som próprio que começa junto com o telegraph
// visual"; GDD-v0.2 §4.1; docs/handoff/plano-audio-v5.md §3 e §4). Partidas determinísticas (sementes fixas) com
// `ruleset: v1` e a IA do R3 (`hunter_brain: utility`, a que põe golpe, dash, projétil e armadilha em
// `hunter.windup`), montadas como tools/sim/run.ts. Cada passo vai ao diretor real (director.ts) tocando pelo
// catálogo real (sfx.ts) e pelo espacial real (spatial.ts) num AudioContext falso.
//
// D-36 (docs/plano-construcao.md §7): este teste prova só o que é do áudio. O som de telegraph começa no mesmo passo
// em que `hunter.windup` aparece (ou troca de kind, ou recomeça), com o kind certo, e todo efeito de habilidade
// medido teve antes o telegraph do mesmo tipo. A garantia de antecedência ≥ hunter.telegraph_min é teste da
// simulação (Frente R); tools/audio/telegraph.ts imprime a antecedência como informação.
// D-37: preparo que começa além de audio.director.hunter_audible_radius do personagem visto não toca (esperado).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameMap } from "@thehell/shared";
import { loadBalanceFile } from "@thehell/shared/node";
import { makeConfig, type Difficulty } from "@thehell/sim";
import { createAudioDirector } from "../src/audio/director.ts";
import { createEngine } from "../src/audio/engine.ts";
import { createSfx } from "../src/audio/sfx.ts";
import { createSpatial } from "../src/audio/spatial.ts";
import { FakeContext } from "../src/audio/testing/fake-webaudio.ts";
import { ABILITY_KINDS, measureTelegraph } from "../src/audio/testing/headless.ts";
import { createVoiceManager } from "../src/audio/voices.ts";

const bal = loadBalanceFile(new URL("../../../data/balance.yaml", import.meta.url).pathname);
const patio = JSON.parse(readFileSync(new URL("../../../data/maps/patio.json", import.meta.url), "utf8")) as GameMap;
const DIFFS: Difficulty[] = ["easy", "normal", "hard", "nightmare"];
/** sementes fixas por dificuldade */
const SEEDS = [1, 2, 3, 4, 5, 6];
const R = bal.audio.director.hunter_audible_radius;

function rig() {
  const ctx = new FakeContext();
  const engine = createEngine({ createContext: () => ctx as unknown as AudioContext, storage: null, cfg: bal.audio });
  engine.ensure();
  const voices = createVoiceManager({ max: bal.audio.max_voices, priorities: bal.audio.voice_priority, now: () => ctx.currentTime });
  const spatial = createSpatial({ engine, map: patio, cfg: bal.audio, voices });
  const sfx = createSfx({ context: () => ctx as unknown as BaseAudioContext, spatial, cfg: bal.audio });
  return { ctx, sfx };
}

describe("audio/telegraph: som no passo em que o preparo aparece, em partidas headless (A-5, D-36)", () => {
  const music = { update: () => undefined, duckFor: () => undefined };
  const reports = DIFFS.map(difficulty => {
    const cfg = makeConfig(bal, patio, { ruleset: "v1", hunterBrain: "utility", difficulty });
    const { ctx, sfx } = rig();
    const rep = measureTelegraph(cfg, SEEDS, R,
      play => createAudioDirector({ play: (n, o) => play(n, o) as never, music, cfg: bal, enabled: true }),
      (name, opts, now) => { ctx.advance(now); return sfx.play(name, opts as never); });
    return { difficulty, rep };
  });

  it("em todo passo, o telegraph tocado é exatamente o do preparo que começa ali (kind certo; nada fora de um início)", () => {
    for (const { difficulty, rep } of reports) {
      expect(rep.mismatches, difficulty).toEqual([]);
      expect(rep.onsets.filter(o => o.audible).every(o => o.played), difficulty).toBe(true);
      expect(rep.onsets.filter(o => !o.audible).some(o => o.played), difficulty).toBe(false);
    }
    expect(reports.every(r => r.rep.refused === 0)).toBe(true); // o telegraph (prioridade máxima) sempre ganha voz
  });

  it("todo efeito de habilidade medido teve antes um preparo do mesmo tipo e, se audível, o telegraph dele", () => {
    for (const { difficulty, rep } of reports) for (const k of ABILITY_KINDS) expect(rep.byKind[k].missing, `${difficulty} ${k}`).toBe(0);
  });

  it("os 4 tipos ocorrem com telegraph audível nas partidas (relato por tipo)", () => {
    const lines = ABILITY_KINDS.map(k => {
      const n = reports.reduce((a, r) => a + r.rep.byKind[k].n, 0), au = reports.reduce((a, r) => a + r.rep.byKind[k].audible, 0);
      expect(au, k).toBeGreaterThan(0);
      return `${k}: ${n} efeitos, ${au} com preparo dentro de ${R} m (telegraph tocado no mesmo passo)`;
    });
    const on = reports.flatMap(r => r.rep.onsets);
    console.log(`[A-5 telegraph] ${SEEDS.length} sementes × ${DIFFS.join("/")}; ${on.length} preparos, ${on.filter(o => !o.audible).length} além de ${R} m (sem som, D-37)\n  ${lines.join("\n  ")}`);
  });
});
