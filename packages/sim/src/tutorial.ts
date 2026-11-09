// Modo tutorial (Treino do GDD-v0.3 §12.3; D-34): etapas, alvos e conclusão vêm de `tutorial` em data/balance.yaml.
// O laço de regras é o de game.ts; aqui só fica o roteiro: quem é o alvo de cada etapa e quando ela termina.
import { releaseFromCage } from "./cage.ts";
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
  g.tutorial = { step: steps[0], index: 0, target: null, progress: 0, goal: tutorialGoal(cfg, steps[0]) };
  g.tutorial.target = targetFor(g, steps[0], null);
}

/**
 * Meta de `progress` da etapa: `tutorial.move.distance` (m) em "move", `tutorial.puzzle.count` em "puzzle"; as demais
 * são uma ação só (1 = feita). 0 depois da última etapa.
 */
export function tutorialGoal(cfg: SimConfig, step: TutorialStepName | null): number {
  const tb = cfg.balance.tutorial;
  if (step === null) return 0;
  return step === "move" ? tb.move.distance : step === "puzzle" ? tb.puzzle.count : 1;
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
  if (!t || t.step === null) return;
  // alvo revisto a cada passo: mantém o atual enquanto válido, senão o gerador não concluído mais próximo
  if (t.target?.kind !== "cage") t.target = targetFor(g, t.step, t.target);
  if (stepDone(cfg, g, f)) advance(cfg, g, false);
}

/**
 * Pula a etapa atual (acessibilidade: pular só a etapa difícil, como o quebra-cabeça com tempo). Emite o mesmo
 * `tutorial_step` com `skipped: true` e avança como na conclusão normal; depois da última, `tutorial_end`. Não faz nada
 * fora do modo tutorial nem depois do fim. Devolve true se pulou. O quebra-cabeça aberto fecha sem acerto, erro nem
 * crédito; pular "rescue" solta o aliado (efeito do resgate, sem mensagem "rescued" e sem pontos).
 */
export function skipTutorialStep(cfg: SimConfig, g: GameState): boolean {
  const t = g.tutorial;
  if (!t || t.step === null || g.over) return false;
  g.puzzle = null; // um quebra-cabeça aberto bloquearia o resgate (game.ts exige !g.puzzle)
  if (t.step === "rescue" && t.target?.kind === "cage") {
    const c = g.survivors[t.target.id];
    if (c.st === "cage") releaseFromCage(cfg, g, c);
  }
  advance(cfg, g, true);
  return true;
}

/** conclui a etapa atual (`skipped` só aparece no evento quando a etapa foi pulada) e encerra depois da última */
function advance(cfg: SimConfig, g: GameState, skipped: boolean) {
  const t = g.tutorial!, steps = cfg.balance.tutorial.steps;
  g.events.push({ type: "tutorial_step", step: t.step!, index: t.index, done: true, ...(skipped ? { skipped: true as const } : {}) });
  t.index++;
  t.progress = 0;
  t.step = t.index < steps.length ? steps[t.index] : null;
  t.goal = tutorialGoal(cfg, t.step);
  t.target = targetFor(g, t.step, t.target);
  if (t.step === null) {
    g.over = true;
    g.puzzle = null;
    g.events.push({ type: "tutorial_end", time: Math.floor(g.t) });
  }
}

/** pode resgatar agora? No tutorial, só na etapa "rescue" */
export const rescueAllowed = (g: GameState) => !g.tutorial || g.tutorial.step === "rescue";
