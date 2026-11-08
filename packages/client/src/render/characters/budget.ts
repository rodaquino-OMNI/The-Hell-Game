// Leitura de render.models e render.anim_fps (data/balance.yaml §14; GDD v0.3 §10.3, Art Bible §7).
// A seção `render` ainda passa sem schema em packages/shared (z.record); esta leitura falha alto se faltar campo.
// Quando o schema de `render` entrar (V1), esta função pode passar a usar o tipo validado.

export interface RenderModels {
  survivorTris: [number, number];
  hunterTris: [number, number];
  atlas: number;
  animFps: number;
}

const range = (v: unknown, name: string): [number, number] => {
  if (!Array.isArray(v) || v.length !== 2 || !v.every(x => typeof x === "number") || v[0] > v[1]) throw new Error(`render.models.${name}: esperava [mín, máx]`);
  return [v[0], v[1]];
};
const positive = (v: unknown, name: string): number => {
  if (typeof v !== "number" || !(v > 0)) throw new Error(`${name}: esperava número > 0`);
  return v;
};

export function readRenderModels(render: unknown): RenderModels {
  const r = (render ?? {}) as { models?: Record<string, unknown>; anim_fps?: unknown };
  if (!r.models) throw new Error("render.models ausente em data/balance.yaml");
  return {
    survivorTris: range(r.models.survivor_tris, "survivor_tris"),
    hunterTris: range(r.models.hunter_tris, "hunter_tris"),
    atlas: positive(r.models.atlas, "render.models.atlas"),
    animFps: positive(r.anim_fps, "render.anim_fps"),
  };
}
