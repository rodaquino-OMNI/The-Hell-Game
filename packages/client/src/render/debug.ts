// Gancho de depuração da render para as capturas de referência (tools/visual/compare.mjs) e para medir
// `renderer.info` (GDD-v0.3 §10.6). Só lê o estado; não altera a simulação.
import type { GameState } from "@thehell/sim";
import { balance } from "../data.ts";
import type { PresetName } from "./present.ts";
import { getPs1, setPs1, type Ps1Intensity } from "./ps1.ts";
import { renderFrame, setPreset, type RenderCtx } from "./scene.ts";
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
      const gl = ctx.R.getContext();
      const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
      const px = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const flipped = new Uint8Array(px.length), row = width * 4;
      for (let y = 0; y < height; y++) flipped.set(px.subarray((height - 1 - y) * row, (height - y) * row), y * row);
      let bin = "";
      for (let i = 0; i < flipped.length; i += 0x8000) bin += String.fromCharCode(...flipped.subarray(i, i + 0x8000));
      return { width, height, rgba: btoa(bin) };
    },
  };
  (window as unknown as { __thehellRender: RenderHook }).__thehellRender = hook;
}
