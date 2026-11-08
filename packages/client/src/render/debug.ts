// Gancho de depuração da render para as capturas de referência (tools/visual/compare.mjs) e para medir
// `renderer.info` (GDD-v0.3 §10.6). Só lê o estado; não altera a simulação.
import type { GameState } from "@thehell/sim";
import type * as THREE from "three";
import { balance } from "../data.ts";
import type { PresetName } from "./present.ts";
import { getLayerA, getLayers, getReduceFlicker, setLayerA, setLayers, setOverrides, setReduceFlicker, type LayerAIntensity, type LayerSet } from "./layers.ts";
import { getPs1, setPs1, type Ps1Intensity } from "./ps1.ts";
import { meshes, renderFrame, setPreset, type RenderCtx } from "./scene.ts";
import { syncActors, syncDynamic } from "./sync.ts";

export interface RenderHook {
  getPs1(): Ps1Intensity;
  setPs1(p: Partial<Ps1Intensity>): void;
  setPreset(name: PresetName): void;
  /** camadas visuais (GDD-v0.3 §10.2); `setPreset` volta ao padrão do preset */
  getLayers(): LayerSet;
  setLayers(l: Partial<LayerSet>): void;
  /** intensidades da camada A (0 a 1) */
  getLayerA(): LayerAIntensity;
  setLayerA(p: Partial<LayerAIntensity>): void;
  /** opção "reduzir flicker" (GDD-v0.3 §12.4) */
  getReduceFlicker(): boolean;
  setReduceFlicker(on: boolean): void;
  /** força o pulso de dano (0..1) e o relógio dos efeitos animados; null volta ao jogo */
  setOverrides(o: { damage?: number | null; time?: number | null }): void;
  /** `renderer.info` do último quadro: chamadas de desenho e triângulos */
  info(): { calls: number; triangles: number; preset: PresetName; scale: number; internal: [number, number]; layers: LayerSet };
  /**
   * sincroniza as malhas com o estado atual, desenha um quadro com a vista dada e devolve os pixels da tela (RGBA, linhas de cima para baixo) em base64,
   * lidos no mesmo quadro (sem preserveDrawingBuffer)
   */
  capture(view: View, opts?: CaptureOpts): { width: number; height: number; rgba: string };
  /**
   * desenha `frames` quadros com a vista dada, sincronizando a GPU a cada um (readPixels de 1 pixel), para medir o
   * custo de render de forma síncrona (tools/visual/compare.mjs mede o tempo de fora da página)
   */
  bench(view: View, frames: number): void;
}

type View = { yaw: number; pitch: number; thirdPerson: boolean };
/** malhas escondidas na captura, por chave de `meshes` (hunter, beam<i>, s<id>…): legibilidade por diferença */
export interface CaptureOpts { hidden?: string[] }

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
    getLayers, setLayers, getLayerA, setLayerA, getReduceFlicker, setReduceFlicker, setOverrides,
    info: () => {
      const { ctx } = need();
      const internal = balance.render.presets[ctx.presenter.preset].internal as [number, number];
      return { ...ctx.info, preset: ctx.presenter.preset, scale: ctx.presenter.scale, internal, layers: getLayers() };
    },
    capture: (view, opts = {}) => {
      const { ctx, G } = need();
      syncActors(G, view.thirdPerson);
      const hidden = (opts.hidden ?? []).map(k => meshes.get(k)).filter((m): m is THREE.Object3D => !!m && m.visible);
      for (const m of hidden) m.visible = false;
      // a captura independe do histórico: o shadow map é redesenhado para esta vista
      ctx.shadowStep = NaN;
      renderFrame(ctx, G, view);
      for (const m of hidden) m.visible = true;
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
    bench: (view, frames) => {
      const { ctx, G } = need();
      syncActors(G, view.thirdPerson);
      const gl = ctx.R.getContext(), px = new Uint8Array(4);
      // relógio parado: o shadow map é redesenhado como num jogo a render.budgets.fps, a render.anim_fps
      const { fps } = balance.render.budgets, hz = balance.render.anim_fps;
      for (let i = 0; i < frames; i++) {
        if (Math.floor((i * hz) / fps) !== Math.floor(((i - 1) * hz) / fps)) ctx.shadowStep = NaN;
        renderFrame(ctx, G, view);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
    },
  };
  (window as unknown as { __thehellRender: RenderHook }).__thehellRender = hook;
}
