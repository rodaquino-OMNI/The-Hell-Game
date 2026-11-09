// Tipos de tools/audio/junction.mjs (usado pelo teste TypeScript do cliente)
export interface JunctionStats { step: number; stepRef: number; curv: number; curvRef: number }
export function junctionStats(at: (i: number) => number, window: number): JunctionStats;
export function circular(x: ArrayLike<number>): (i: number) => number;
export function neighborhood(window: number): number;
export function fromNeighborhood(tail: ArrayLike<number>, head: ArrayLike<number>): (i: number) => number;
export function junctionOk(st: JunctionStats, factor: number): { ok: boolean; stepRatio: number; curvRatio: number };
