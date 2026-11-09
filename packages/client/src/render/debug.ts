// Gancho de depuração da render para as capturas de referência (tools/visual/compare.mjs) e para medir
// `renderer.info` (GDD-v0.3 §10.6). Só lê o estado; não altera a simulação.
import type { GameState } from "@thehell/sim";
import type * as THREE from "three";
import { balance } from "../data.ts";
import type { PresetName } from "./present.ts";
import { getLayerA, getLayers, getReduceFlicker, setLayerA, setLayers, setOverrides, setReduceFlicker, type LayerAIntensity, type LayerSet } from "./layers.ts";
import { getHunterOutline, getPs1, Ps1Material, setHunterOutline, setHunterOutlineShape, setPs1, type Ps1Intensity } from "./ps1.ts";
import { tok } from "../look.ts";
import { genVisuals, meshes, renderFrame, setPreset, type RenderCtx } from "./scene.ts";
import { telegraphOn } from "./characters/runtime.ts";
import { portrait, type PortraitOptions } from "./characters/portrait.ts";
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
  /** contorno do caçador (D-18), intensidade de 0 a 1 */
  getHunterOutline(): number;
  setHunterOutline(v: number): void;
  /** forma do contorno para comparação de arte (amount ≤ 1/token por canal; null = render.hunter_outline) */
  setHunterOutlineShape(s: { amount: number; power: number } | null): void;
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
  /**
   * retrato de personagens numa cena à parte (teste de silhueta, Art Bible §5.1): desenha pelo mesmo caminho do jogo
   * (resolução interna do preset, material PS1, dither) e devolve os pixels como `capture`
   */
  portrait(o: PortraitOptions): Promise<{ width: number; height: number; rgba: string }>;
  /** estado visível da leitura (V3), após o último sync: olhos do caçador acesos e ids com cadeado à mostra */
  states(): { telegraph: boolean; locks: number[] };
}

type View = { yaw: number; pitch: number; thirdPerson: boolean };
/**
 * malhas escondidas na captura, por chave de `meshes` (hunter, beam<i>, s<id>…): legibilidade por diferença.
 * `flat`: malhas desenhadas chapadas em ui.text, sem luz, névoa nem bloom (máscara da silhueta inteira, mesmo onde a
 * cor some no fundo; tools/visual/compare.mjs)
 */
export interface CaptureOpts { hidden?: string[]; flat?: string[] }

/** material chapado da máscara de silhueta (criado na primeira captura com `flat`) */
let flatMat: Ps1Material | null = null;

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
    getHunterOutline, setHunterOutline, setHunterOutlineShape,
    getLayers, setLayers, getLayerA, setLayerA, getReduceFlicker, setReduceFlicker, setOverrides,
    info: () => {
      const { ctx } = need();
      const internal = balance.render.presets[ctx.presenter.preset].internal as [number, number];
      return { ...ctx.info, preset: ctx.presenter.preset, scale: ctx.presenter.scale, internal, layers: getLayers() };
    },
    capture: (view, opts = {}) => {
      const { ctx, G } = need();
      syncActors(G, view.thirdPerson);
      // beam<i>: feixe do gerador i (genVisuals do V3)
      const find = (k: string) => meshes.get(k) ?? (k.startsWith("beam") ? genVisuals[Number(k.slice(4))]?.beam : undefined);
      const hidden = (opts.hidden ?? []).map(find).filter((m): m is THREE.Object3D => !!m && m.visible);
      for (const m of hidden) m.visible = false;
      const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
      for (const root of (opts.flat ?? []).map(find)) {
        flatMat ??= new Ps1Material({ lit: false, fog: false, emissive: false, color: tok("ui.text") });
        root?.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.visible) { swapped.push([m, m.material]); m.material = flatMat!; } });
      }
      // a captura independe do histórico: o shadow map é redesenhado para esta vista
      ctx.shadowStep = NaN;
      renderFrame(ctx, G, view);
      for (const m of hidden) m.visible = true;
      for (const [m, mat] of swapped) m.material = mat;
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
