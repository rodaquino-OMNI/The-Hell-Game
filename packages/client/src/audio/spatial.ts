// Áudio espacial (item A-4 do V5; GDD-v0.3 §11 "PannerNode HRTF; oclusão por parede com passa-baixa em 800 Hz quando
// o raio até a fonte cruza parede", GDD-v0.2 §11). Por voz: source → BiquadFilter(lowpass) → PannerNode(HRTF) → bus.
// A decisão de oclusão é pura e reusa `lineOfSight` da simulação (packages/sim/src/perception.ts L27), sem duplicar
// geometria (docs/handoff/plano-audio-v5.md §1 e §3).
// Dois pontos distintos:
//   - o OUVINTE do panner (direção e distância do som) segue a câmera ativa (RenderCtx.cam em render/scene.ts), porque
//     em `?retro=1` a câmera é de 1ª pessoa;
//   - a OCLUSÃO é decidida pela posição do PERSONAGEM visto (o laço passa `cameraTarget(G) ?? G.survivors[0]` em
//     `updateSpatial(at)`), não pela câmera: em 3ª pessoa o recuo da câmera (scene.ts `renderFrame`) só evita o
//     interior do muro, então ela pode parar do outro lado de um muro fino ou dentro de uma caixa e ocluiria tudo.
//     Sem nenhum `at` recebido ainda, a oclusão usa a posição do ouvinte.
// Sons do próprio jogador (`pos: null`) vão direto ao barramento: sem panner e sem oclusão. Coordenadas: as do render (scene.ts `renderFrame`: cam.position.set(P.x, altura, P.z)), isto é, x e z do
// jogo no plano e y para cima; a fonte vai em (x, altura, z).
// Valores: data/balance.yaml `audio.max_voices`, `audio.voice_priority`, `audio.occlusion_lowpass_hz`,
// `audio.occlusion_ramp_tc`, `audio.panner`, `audio.source_height`.
import type { Balance, GameMap } from "@thehell/shared";
import { lineOfSight, type Vec } from "@thehell/sim";
import { balance, cfg as simCfg } from "../data.ts";
import { getBusInput, getEngine, type BusName } from "./engine.ts";
import { createVoiceManager, type Voice, type VoiceManager } from "./voices.ts";

export interface Vec3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }
/** o que a câmera do three expõe e o ouvinte usa (tipo estrutural; THREE.PerspectiveCamera serve) */
export interface CameraLike {
  position: Vec3;
  /** orientação (preferida: dá forward e up reais) */
  quaternion?: Quat;
  /** alternativa sem quaternion; o alvo recebe a direção de frente em mundo */
  getWorldDirection?: (target: never) => Vec3;
  /** dica de "para cima" quando não há quaternion (Object3D.up) */
  up?: Vec3;
}
/** posição da fonte: x/z do jogo; y opcional (padrão audio.source_height) */
export type SourcePos = Vec & { y?: number };

export type SpatialCfg = Pick<Balance["audio"], "occlusion_lowpass_hz" | "occlusion_ramp_tc" | "panner" | "source_height">;

/** a voz em `source` está atrás de parede para quem ouve em `listener`? (só o plano x/z, como a visão do caçador) */
export function isOccluded(map: GameMap, listener: Vec, source: Vec): boolean {
  return !lineOfSight(map, { x: listener.x, z: listener.z }, { x: source.x, z: source.z });
}

/** gira `v` pelo quaternion unitário `q` (v' = v + w·t + q×t, t = 2·q×v) */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** eixos locais do three: a câmera olha para −z e o topo é +y */
const LOCAL_FORWARD: Vec3 = { x: 0, y: 0, z: -1 };
const LOCAL_UP: Vec3 = { x: 0, y: 1, z: 0 };

/** frente e topo da câmera em mundo.
 *  Premissa: a câmera não tem pai (render/scene.ts a põe direto na cena), então o quaternion e a posição locais são
 *  os de mundo. Se ela ganhar pai, quem chama deve passar `getWorldQuaternion`/`getWorldPosition` no lugar. */
export function cameraAxes(cam: CameraLike): { forward: Vec3; up: Vec3 } {
  if (cam.quaternion) return { forward: rotate(cam.quaternion, LOCAL_FORWARD), up: rotate(cam.quaternion, LOCAL_UP) };
  if (cam.getWorldDirection) {
    // alvo mínimo compatível com THREE.Vector3: Object3D.getWorldDirection chama target.set(...).normalize() e
    // Camera.getWorldDirection ainda chama .negate() no resultado (three 0.186)
    const t = {
      x: 0, y: 0, z: 0,
      set(x: number, y: number, z: number) { t.x = x; t.y = y; t.z = z; return t; },
      normalize() { const k = Math.hypot(t.x, t.y, t.z) || 1; t.x /= k; t.y /= k; t.z /= k; return t; },
      negate() { t.x = -t.x; t.y = -t.y; t.z = -t.z; return t; },
    };
    const d = cam.getWorldDirection(t as never);
    return { forward: { x: d.x, y: d.y, z: d.z }, up: cam.up ? { ...cam.up } : { ...LOCAL_UP } };
  }
  return { forward: { ...LOCAL_FORWARD }, up: cam.up ? { ...cam.up } : { ...LOCAL_UP } };
}

export interface SpatialVoice {
  readonly voice: Voice;
  readonly bus: BusName;
  /** null em voz não espacial (`pos: null`) */
  readonly filter: BiquadFilterNode | null;
  /** null em voz não espacial (`pos: null`) */
  readonly panner: PannerNode | null;
  /** posição atual da fonte; null em voz não espacial */
  readonly pos: Readonly<Vec3> | null;
  /** estado de oclusão da última avaliação */
  readonly occluded: boolean;
  /** move a fonte (o panner muda já; a oclusão é reavaliada no próximo updateSpatial); no-op em voz não espacial */
  setPosition(p: SourcePos): void;
  /** fim pelo dono: desliga a cadeia e devolve a vaga */
  release(): void;
}

export interface PlayOpts {
  bus: BusName;
  /** posição da fonte; null = som do próprio jogador, não espacial (source → barramento, sem panner nem oclusão) */
  pos: SourcePos | null;
  /** chamado quando outra voz toma a vaga (a fonte já foi parada e desligada) */
  onSteal?: (v: SpatialVoice) => void;
}

/** o pedaço do motor que o espacial usa (padrão: o singleton de engine.ts) */
export interface SpatialEngine {
  /** contexto atual sem criar (o ouvinte e a oclusão, chamados a cada quadro, não criam o AudioContext antes do gesto) */
  readonly context: AudioContext | null;
  /** cria o contexto se preciso (só `play`) */
  ensure(): AudioContext | null;
  busInput(bus: BusName): AudioNode | null;
  notePlay(bus: BusName): void;
}

export interface SpatialDeps {
  engine?: SpatialEngine;
  /** padrão: `cfg.map` de data.ts (mapa efetivo de makeConfig, não o mapa de topo) */
  map?: GameMap;
  cfg?: SpatialCfg;
  voices?: VoiceManager;
}

export interface Spatial {
  readonly voices: VoiceManager;
  /** posição do ouvinte do panner (última câmera recebida) */
  readonly listener: Readonly<Vec3>;
  /** ponto de onde a oclusão é decidida: o último `at` de updateSpatial (personagem) ou, sem nenhum, o ouvinte */
  readonly occlusionPoint: Readonly<Vec>;
  /** liga `source` → filtro → panner → barramento numa vaga de voz (ou `source` → barramento com `pos: null`); null
   *  sem vaga ou sem Web Audio. A oclusão inicial usa `occlusionPoint`.
   *  Fonte com evento `ended` (AudioBufferSourceNode, OscillatorNode) devolve a vaga sozinha no fim natural. */
  play(kind: string, source: AudioNode, opts: PlayOpts): SpatialVoice | null;
  /** ouvinte do panner na câmera ativa (posição, frente e topo); só direção e distância, não a oclusão. Chamar a cada
   *  quadro depois de posicionar a câmera */
  updateListener(cam: CameraLike): void;
  /** reavalia a oclusão das vozes espaciais ativas a partir de `at` = posição do personagem visto (guardada para os
   *  próximos `play`); sem `at`, usa o último recebido ou, se nunca houve, o ouvinte. Rampa só quando o estado muda */
  updateSpatial(at?: Vec): void;
  active(): SpatialVoice[];
}

type ParamLike = AudioParam | undefined;
/** muda um AudioParam na hora (por quadro, sem rampa); false se o nó não tem o parâmetro (Safari antigo) */
function setParams(params: ParamLike[], values: number[]): boolean {
  if (params.some(p => !p)) return false;
  params.forEach((p, i) => { p!.value = values[i]; });
  return true;
}

function quiet(f: () => unknown) { try { f(); } catch { /* nó já desligado ou contexto fechado */ } }

const singletonEngine: SpatialEngine = {
  get context() { return getEngine().context; },
  ensure: () => getEngine().ensure(),
  busInput: bus => getBusInput(bus),
  notePlay: bus => getEngine().notePlay(bus),
};

export function createSpatial(deps: SpatialDeps = {}): Spatial {
  const engine = deps.engine ?? singletonEngine;
  // paredes do mapa EFETIVO da partida (makeConfig: com as flags do v1, p.ex. os pilares de loop curto da D-23,
  // `maps.v1.short_loop_pillars`), a mesma fonte da simulação (`SimConfig.map`), e não o mapa de topo de data/maps.
  // A render ainda lê o mapa de topo (render/scene.ts, environment.ts, retro/industrial.ts) e migra no R7
  const map = deps.map ?? simCfg.map;
  const cfg = deps.cfg ?? balance.audio;
  const voices = deps.voices ?? createVoiceManager();
  const listener: Vec3 = { x: 0, y: 0, z: 0 };
  /** último personagem recebido em updateSpatial(at); null = ainda nenhum (usa o ouvinte) */
  let occAt: Vec | null = null;
  const occFrom = (): Vec => occAt ?? listener;
  type Live = SpatialVoice & { occluded: boolean; pos: Vec3 | null };
  const live = new Map<number, Live>();

  const openHz = (ctx: BaseAudioContext) => ctx.sampleRate / 2; // Nyquist: o passa-baixa fica transparente
  const targetHz = (ctx: BaseAudioContext, occ: boolean) => (occ ? cfg.occlusion_lowpass_hz : openHz(ctx));

  function placePanner(p: PannerNode, v: Vec3) {
    if (!setParams([p.positionX, p.positionY, p.positionZ], [v.x, v.y, v.z])) quiet(() => p.setPosition(v.x, v.y, v.z));
  }

  return {
    voices,
    listener,
    get occlusionPoint() { return occFrom(); },
    play(kind, source, opts) {
      const ctx = engine.ensure();
      const out = ctx ? engine.busInput(opts.bus) : null;
      if (!ctx || !out) return null;
      let sv: Live | null = null;
      const teardown = () => {
        if (!sv) return;
        live.delete(sv.voice.id);
        source.removeEventListener?.("ended", onEnded);
        quiet(() => source.disconnect());
        const { filter: f, panner: pn } = sv;
        if (f) quiet(() => f.disconnect());
        if (pn) quiet(() => pn.disconnect());
      };
      const onEnded = () => { sv?.voice.release(); teardown(); };
      const voice = voices.acquire(kind, {
        onSteal: () => {
          const stop = (source as Partial<AudioScheduledSourceNode>).stop;
          if (typeof stop === "function") quiet(() => stop.call(source));
          teardown();
          if (sv) opts.onSteal?.(sv);
        },
      });
      if (!voice) return null;

      if (opts.pos === null) {
        // som do próprio jogador: direto no barramento, sem panner nem oclusão
        source.connect(out);
        source.addEventListener?.("ended", onEnded);
        engine.notePlay(opts.bus);
        sv = {
          voice, bus: opts.bus, filter: null, panner: null, pos: null, occluded: false,
          setPosition() { /* não espacial */ },
          release() { voice.release(); teardown(); },
        };
        live.set(voice.id, sv);
        return sv;
      }

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      const panner = ctx.createPanner();
      const pc = cfg.panner;
      panner.panningModel = pc.panning_model;
      panner.distanceModel = pc.distance_model;
      panner.refDistance = pc.ref_distance;
      panner.maxDistance = pc.max_distance;
      panner.rolloffFactor = pc.rolloff_factor;

      const pos: Vec3 = { x: opts.pos.x, y: opts.pos.y ?? cfg.source_height, z: opts.pos.z };
      const occluded = isOccluded(map, occFrom(), pos);
      filter.frequency.value = targetHz(ctx, occluded); // começa já no estado certo, sem rampa
      placePanner(panner, pos);
      source.connect(filter);
      filter.connect(panner);
      panner.connect(out);
      source.addEventListener?.("ended", onEnded);
      engine.notePlay(opts.bus);

      sv = {
        voice, bus: opts.bus, filter, panner, pos, occluded,
        setPosition(p) {
          pos.x = p.x; pos.z = p.z; if (p.y !== undefined) pos.y = p.y;
          placePanner(panner, pos);
        },
        release() { voice.release(); teardown(); },
      };
      live.set(voice.id, sv);
      return sv;
    },
    updateListener(cam) {
      const ctx = engine.context;
      const { position: p } = cam;
      listener.x = p.x; listener.y = p.y; listener.z = p.z;
      if (!ctx) return;
      const l = ctx.listener;
      const { forward: f, up: u } = cameraAxes(cam);
      if (!setParams([l.positionX, l.positionY, l.positionZ], [p.x, p.y, p.z])) quiet(() => l.setPosition(p.x, p.y, p.z));
      if (!setParams([l.forwardX, l.forwardY, l.forwardZ, l.upX, l.upY, l.upZ], [f.x, f.y, f.z, u.x, u.y, u.z])) {
        quiet(() => l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z));
      }
    },
    updateSpatial(at) {
      if (at) occAt = { x: at.x, z: at.z };
      const ctx = engine.context;
      if (!ctx) return;
      const from = occFrom();
      for (const sv of live.values()) {
        if (!sv.pos || !sv.filter) continue;
        const occ = isOccluded(map, from, sv.pos);
        if (occ === sv.occluded) continue;
        sv.occluded = occ;
        const f = sv.filter.frequency, t = ctx.currentTime;
        quiet(() => {
          f.cancelScheduledValues(t);
          f.setValueAtTime(f.value, t);
          f.setTargetAtTime(targetHz(ctx, occ), t, cfg.occlusion_ramp_tc);
        });
      }
    },
    active() { return [...live.values()]; },
  };
}

let spatial: Spatial | null = null;
/** singleton preguiçoso sobre o motor real e o mapa do pátio */
export function getSpatial(): Spatial {
  return (spatial ??= createSpatial());
}
/** ouvinte na câmera ativa (atalho do singleton, para o laço do render chamar a cada quadro) */
export const updateListener = (cam: CameraLike) => getSpatial().updateListener(cam);
/** oclusão das vozes ativas a partir do personagem visto (atalho do singleton) */
export const updateSpatial = (at?: Vec) => getSpatial().updateSpatial(at);
