export * from "./types.ts";
export * from "./game.ts";
export { makeConfig, hunterMaxHp, type SimConfig, type ConfigOptions, type Difficulty, type HunterBrain, type AiDifficulty, type AiTrace } from "./config.ts";
export { matchEnd, individualResult, isTerminal, type MatchEnd } from "./match.ts";
export { canSee, inCone, lineOfSight, segmentHitsBox } from "./perception.ts";
export { nextRandom } from "./rng.ts";
export {
  HUNTER_TRANSITIONS, aimPoint, canBreakLoop, loopAt, newHunterAi, project, projectileAllowed, setMode, think, trackLoop,
  updateHunterAi, type HunterEffects,
} from "./ai/hunter.ts";
export { perceive } from "./ai/percept.ts";
export { chooseTarget, utilityScore, utilityTerms, type TargetChoice, type UtilityTerms } from "./ai/utility.ts";
export { chaseEpisodes, playHeadless, measureStuck, newStuckMeter, type HeadlessResult, type StuckMeter } from "./headless.ts";
