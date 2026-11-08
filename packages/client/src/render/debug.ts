// Gancho de depuração da render para as capturas de referência (tools/visual/compare.mjs) e para medir
// `renderer.info` (GDD-v0.3 §10.6). Só lê o estado; não altera a simulação.
import type { GameState } from "@thehell/sim";
import { balance } from "../data.ts";
import type { PresetName } from "./present.ts";
import { getPs1, setPs1, type Ps1Intensity } from "./ps1.ts";
import { meshes, renderFrame, setPreset, type RenderCtx } from "./scene.ts";
import { telegraphOn } from "./characters/runtime.ts";
import { portrait, type PortraitOptions } from "./characters/portrait.ts";
import { syncActors, syncDynamic } from "./sync.ts";

export interface RenderHook {
  getPs1(): Ps1Intensity;
  setPs1(p: Partial<Ps1Intensity>): void;
  setPreset(name: PresetName): void;
  /** `renderer.info` do último quadro: chamadas de desenho e triângulos */
  info(): { calls: number; triangles: number; preset: PresetName; scale: number; internal: [number, number] };
  /**
   * sincroniza as malhas com o estado atual, desenha um quadro com a vista dada e devolve os pixels da tela (RGBA, linhas de cima para baixo) em base64,
   * lidos no mesmo quadro (sem preserveDrawingBuffer)
   */
  capture(view: { yaw: number; pitch: number; thirdPerson: boolean }): { width: number; height: number; rgba: string };
  /**
   * retrato de personagens numa cena à parte (teste de silhueta, Art Bible §5.1): desenha pelo mesmo caminho do jogo
   * (resolução interna do preset, material PS1, dither) e devolve os pixels como `capture`
   */
  portrait(o: PortraitOptions): Promise<{ width: number; height: number; rgba: string }>;
  /** estado visível da leitura (V3), após o último sync: olhos do caçador acesos e ids com cadeado à mostra */
  states(): { telegraph: boolean; locks: number[] };
}

export function installRenderHook(getCtx: () => RenderCtx | undefined, getGame: () => GameState | undefined) {
  const need = () => {
    const ctx = getCtx(), G = getGame();
    if (!ctx || !G) throw new Error("partida não iniciada");
    return { ctx, G };
  };
  const hook: RenderHook = {
    getPs1,
    setPs1,
    setPreset: name => setPreset(need().ctx, name),
    info: () => {
      const { ctx } = need();
      const internal = balance.render.presets[ctx.presenter.preset].internal as [number, number];
      return { ...ctx.info, preset: ctx.presenter.preset, scale: ctx.presenter.scale, internal };
    },
    capture: view => {
      const { ctx, G } = need();
      syncActors(G, view.thirdPerson);
      renderFrame(ctx, G, view);
      syncDynamic(ctx, G);
      return readScreen(ctx);
    },
    states: () => ({
      telegraph: telegraphOn(meshes.get("hunter")!),
      locks: [...meshes].filter(([k, m]) => k.startsWith("lock") && m.visible).map(([k]) => Number(k.slice(4))),
    }),
    portrait: async o => {
      const { ctx } = need();
      await portrait(ctx, o);
      return readScreen(ctx);
    },
  };
  (window as unknown as { __thehellRender: RenderHook }).__thehellRender = hook;
}

/** pixels da tela (RGBA, linhas de cima para baixo) em base64, lidos no mesmo quadro (sem preserveDrawingBuffer) */
function readScreen(ctx: RenderCtx) {
  const gl = ctx.R.getContext();
  const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
  const px = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const flipped = new Uint8Array(px.length), row = width * 4;
  for (let y = 0; y < height; y++) flipped.set(px.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  let bin = "";
  for (let i = 0; i < flipped.length; i += 0x8000) bin += String.fromCharCode(...flipped.subarray(i, i + 0x8000));
  return { width, height, rgba: btoa(bin) };
}
