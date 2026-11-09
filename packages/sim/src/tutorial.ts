// Modo tutorial (Treino do GDD-v0.3 §12.3; D-34): etapas, alvos e conclusão vêm de `tutorial` em data/balance.yaml.
// O laço de regras é o de game.ts; aqui só fica o roteiro: quem é o alvo de cada etapa e quando ela termina.
import type { SimConfig } from "./config.ts";
import type { GameState, TutorialStepName, TutorialTarget, Vec } from "./types.ts";

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.z - b.z);

/** foto do início do passo da simulação, para medir o que mudou nele */
export interface TutorialFrame { x: number; z: number; cd: number; puzzleGen: number; events: number }

export function tutorialFrame(g: GameState): TutorialFrame {
  const P = g.survivors[0];
  return { x: P.x, z: P.z, cd: P.cd, puzzleGen: g.puzzle ? g.puzzle.gen : -1, events: g.events.length };
}

/** gerador obrigatório não concluído mais perto do jogador (empate: o de menor índice) */
function nearestGenerator(g: GameState): TutorialTarget | null {
  const P = g.survivors[0];
  let best = -1, bd = Infinity;
  g.gens.forEach((x, i) => { if (!x.bonus && !x.done && dist(x, P) < bd) { best = i; bd = dist(x, P); } });
  return best < 0 ? null : { kind: "generator", id: best, x: g.gens[best].x, z: g.gens[best].z };
}

/** alvo da etapa; o gerador-alvo se mantém entre etapas enquanto não for concluído */
function targetFor(g: GameState, step: TutorialStepName | null, prev: TutorialTarget | null): TutorialTarget | null {
  const gen = () => prev?.kind === "generator" && !g.gens[prev.id].done ? prev : nearestGenerator(g);
  switch (step) {
    case "generator": case "puzzle": return gen();
    case "rescue": {
      const c = g.survivors.find(s => s.st === "cage");
      return c ? { kind: "cage", id: c.id, x: c.x, z: c.z } : null;
    }
    // só o Turbo do Mecânico depende de lugar (gerador obrigatório no alcance, `classes.mechanic.turbo.range`)
    case "ability": return g.survivors[0].cls === "Mecânico" ? gen() : null;
    default: return null;
  }
}

/** prepara a partida criada em modo tutorial: aliado preso (gaiola sem cronômetro) e a primeira etapa */
export function startTutorial(cfg: SimConfig, g: GameState) {
  const b = cfg.balance, cage = g.arena.cage;
  for (const s of g.survivors) {
    if (!s.bot) continue;
    s.st = "cage"; s.hp = 0; s.cage = cfg.cageTime;
    // mesma vaga da gaiola que a prisão normal usa (game.ts, knockDown)
    s.x = cage.x + (s.id - 1) * b.prototype_extras.cage_slot_spacing;
    s.z = cage.z;
    break; // um aliado preso basta para a etapa de resgate; os demais (team_size > 2) ficam parados
  }
  const steps = b.tutorial.steps;
  g.tutorial = { step: steps[0], index: 0, target: null, progress: 0 };
  g.tutorial.target = targetFor(g, steps[0], null);
}

/** etapa atual concluída neste passo? Atualiza `progress` */
function stepDone(cfg: SimConfig, g: GameState, f: TutorialFrame): boolean {
  const t = g.tutorial!, tb = cfg.balance.tutorial, P = g.survivors[0];
  switch (t.step) {
    case "move":
      t.progress += Math.hypot(P.x - f.x, P.z - f.z);
      return t.progress >= tb.move.distance;
    case "generator":
      return t.target !== null && g.puzzle !== null && g.puzzle.gen === t.target.id;
    case "puzzle": {
      if (t.target === null || f.puzzleGen !== t.target.id) return false;
      for (let i = f.events; i < g.events.length; i++) {
        const e = g.events[i];
        if (e.type === "sound" && e.name === "puzzle_ok") t.progress++;
      }
      return t.progress >= tb.puzzle.count;
    }
    case "rescue":
      return t.target !== null && g.survivors[t.target.id].st === "ok";
    case "ability":
      // a habilidade só arma a recarga quando tem efeito (game.ts, ability)
      return P.cd > f.cd;
    default:
      return false;
  }
}

/** fim do passo da simulação no modo tutorial: conclui a etapa, avança e encerra depois da última */
export function updateTutorial(cfg: SimConfig, g: GameState, f: TutorialFrame) {
  const t = g.tutorial;
  if (!t || t.step === null || !stepDone(cfg, g, f)) return;
  const steps = cfg.balance.tutorial.steps;
  g.events.push({ type: "tutorial_step", step: t.step, index: t.index, done: true });
  t.index++;
  t.progress = 0;
  t.step = t.index < steps.length ? steps[t.index] : null;
  t.target = targetFor(g, t.step, t.target);
  if (t.step === null) {
    g.over = true;
    g.puzzle = null;
    g.events.push({ type: "tutorial_end", time: Math.floor(g.t) });
  }
}

/** pode resgatar agora? No tutorial, só na etapa "rescue" */
export const rescueAllowed = (g: GameState) => !g.tutorial || g.tutorial.step === "rescue";
