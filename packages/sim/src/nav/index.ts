// Navegação sem WASM (GDD v0.3 §8.6, §9.3): grade A* de reserva, geometria e layouts.
// O navmesh do recast fica em "./recast.ts" (import separado, para não pesar no bundle do cliente).
export * from "./geometry.ts";
export * from "./grid.ts";
export * from "./layout.ts";
export * from "./rules.ts";

