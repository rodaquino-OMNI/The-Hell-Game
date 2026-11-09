export * from "./types.ts";
export * from "./game.ts";
export { makeConfig, hunterMaxHp, botBrainOf, anyCompetentBot, type SimConfig, type ConfigOptions, type Difficulty, type HunterBrain, type BotBrain, type AiDifficulty, type AiTrace } from "./config.ts";
export { matchEnd, individualResult, isTerminal, type MatchEnd } from "./match.ts";
export { canSee, inCone, lineOfSight, segmentHitsBox } from "./perception.ts";
export { nextRandom } from "./rng.ts";
export {
  HUNTER_TRANSITIONS, aimPoint, canBreakLoop, choosePatrol, trackLoopMemory, loopAt, newHunterAi, project, projectileAllowed, setMode, think, trackLoop,
  updateHunterAi, type HunterEffects,
} from "./ai/hunter.ts";
export { perceive } from "./ai/percept.ts";
export { chooseTarget, nearAttacker, utilityScore, utilityTerms, type TargetChoice, type UtilityTerms } from "./ai/utility.ts";
export { chaseEpisodes, playHeadless, playHeadlessReport, measureStuck, newStuckMeter, type HeadlessResult, type StuckMeter } from "./headless.ts";
export {
  chasedTarget, closeChase, coinsFor, credit, creditHunter, newScore, newScoreTrack, scaledPoints, scoreTotal, winsCoins,
} from "./score.ts";
export { newBotAi, updateBotAi, type BotEffects } from "./ai/bots.ts";
// modo tutorial (D-34, GDD-v0.3 §12.3); os tipos GameMode, GameOptions, TutorialState, TutorialStepName e
// TutorialTarget saem de types.ts
export { rescueAllowed, skipTutorialStep, startTutorial, tutorialGoal, tutorialFrame, updateTutorial, type TutorialFrame } from "./tutorial.ts";
export { TUTORIAL_STEPS } from "@thehell/shared";
// relatório de playtest (R8): createGame(cfg, cls, seed, { report: true }) e matchReport(g) no fim
export {
  matchReport, newMatchLog, puzzleSolves, type PuzzleSolve, observeStep, reportConfig, REPORT_VERSION, type ChaseEnd, type ChaseRecord, type GeneratorReport, type MatchLog,
  type MatchReport, type PuzzleRecord, type PuzzleResult,
} from "./report.ts";
