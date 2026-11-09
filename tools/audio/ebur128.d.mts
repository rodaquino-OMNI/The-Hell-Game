// Tipos de tools/audio/ebur128.mjs (usado por compose.ts e pelos testes TypeScript do cliente)
export interface Loudness { I: number; TP: number }
export function hasBinaries(names?: string[]): boolean;
export function measureLoudness(file: string): Loudness;
