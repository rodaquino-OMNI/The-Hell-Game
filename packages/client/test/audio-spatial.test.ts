// Áudio espacial (A-4 do V5; GDD-v0.3 §11): oclusão pela linha de visão da simulação no mapa real do pátio,
// cadeia source → lowpass → panner HRTF → barramento, rampa do filtro para 800 Hz atrás de parede e de volta na linha
// livre, e ouvinte seguindo a câmera. AudioContext falso (Node não tem Web Audio).
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameMap } from "@thehell/shared";
import { loadBalanceFile } from "@thehell/shared/node";
import { lineOfSight } from "@thehell/sim";
import { createEngine, useEngine } from "../src/audio/engine.ts";
import { cameraAxes, createSpatial, isOccluded } from "../src/audio/spatial.ts";
import { cfg as simCfg } from "../src/data.ts";
import { createVoiceManager } from "../src/audio/voices.ts";

const bal = loadBalanceFile(new URL("../../../data/balance.yaml", import.meta.url).pathname);
const cfg = bal.audio;
const patio = JSON.parse(readFileSync(new URL("../../../data/maps/patio.json", import.meta.url), "utf8")) as GameMap;

// a parede central do pátio ([0, 0, 8, 8] em data/maps/patio.json) fica entre estes dois pontos
const BEHIND = { listener: { x: -10, z: 0 }, source: { x: 10, z: 0 } };
// linha livre: x = −10, de z = 5 a z = −5 (nenhuma caixa cruza)
const FREE = { listener: { x: -10, z: 5 }, source: { x: -10, z: -5 } };

class FakeNode extends EventTarget {
  out: unknown[] = [];
  connect(n: unknown) { this.out.push(n); return n; }
  disconnect() { this.out = []; }
}
class FakeParam {
  value = 0;
  calls: [string, ...number[]][] = [];
  cancelScheduledValues(t: number) { this.calls.push(["cancel", t]); }
  setValueAtTime(v: number, t: number) { this.calls.push(["set", v, t]); this.value = v; }
  setTargetAtTime(v: number, t: number, tc: number) { this.calls.push(["target", v, t, tc]); this.value = v; }
  /** alvo da última rampa */
  get target() { const c = [...this.calls].reverse().find(x => x[0] === "target"); return c ? c[1] : undefined; }
}
class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeFilter extends FakeNode { type = "allpass"; frequency = new FakeParam(); }
class FakePanner extends FakeNode {
  panningModel = "equalpower"; distanceModel = "linear"; refDistance = 1; maxDistance = 10000; rolloffFactor = 1;
  positionX = new FakeParam(); positionY = new FakeParam(); positionZ = new FakeParam();
}
class FakeSource extends FakeNode { stopped = 0; stop() { this.stopped++; } }
class FakeListener {
  positionX = new FakeParam(); positionY = new FakeParam(); positionZ = new FakeParam();
  forwardX = new FakeParam(); forwardY = new FakeParam(); forwardZ = new FakeParam();
  upX = new FakeParam(); upY = new FakeParam(); upZ = new FakeParam();
}
class LegacyListener {
  pos: number[] = []; ori: number[] = [];
  setPosition(...v: number[]) { this.pos = v; }
  setOrientation(...v: number[]) { this.ori = v; }
}
class FakeCtx extends EventTarget {
  state = "running";
  currentTime = 3;
  sampleRate = 48000;
  destination = new FakeNode();
  listener: FakeListener | LegacyListener = new FakeListener();
  filters: FakeFilter[] = [];
  createGain() { return new FakeGain(); }
  createBiquadFilter() { const f = new FakeFilter(); this.filters.push(f); return f; }
  createPanner() { return new FakePanner(); }
  resume = async () => {};
  close = async () => {};
}

function setup() {
  const ctx = new FakeCtx();
  const engine = createEngine({ createContext: () => ctx as unknown as AudioContext, storage: null, cfg });
  engine.ensure();   // como depois do gesto: o contexto existe (updateListener não o cria)
  const sp = createSpatial({ engine, map: patio, cfg, voices: createVoiceManager({ max: cfg.max_voices, priorities: cfg.voice_priority }) });
  return { ctx, engine, sp };
}
const src = () => new FakeSource() as unknown as AudioNode;
const cam = (x: number, z: number) => ({ position: { x, y: bal.render.camera.eye_height, z }, quaternion: { x: 0, y: 0, z: 0, w: 1 } });

afterEach(() => useEngine(null));

describe("audio/spatial: oclusão (A-4)", () => {
  it("isOccluded = !lineOfSight no mapa real do pátio: parede central entre os pontos → ocluído; linha livre → não", () => {
    expect(isOccluded(patio, BEHIND.listener, BEHIND.source)).toBe(true);
    expect(lineOfSight(patio, BEHIND.listener, BEHIND.source)).toBe(false);
    expect(isOccluded(patio, FREE.listener, FREE.source)).toBe(false);
    // ignora a altura: só o plano x/z conta
    expect(isOccluded(patio, FREE.listener, { ...FREE.source, y: 99 } as never)).toBe(false);
  });

  it("voz atrás da parede rampa o passa-baixa para occlusion_lowpass_hz; na linha livre volta à frequência aberta", () => {
    const { ctx, engine, sp } = setup();
    expect(cfg.occlusion_lowpass_hz).toBe(800);
    const open = ctx.sampleRate / 2;
    sp.updateListener(cam(BEHIND.listener.x, BEHIND.listener.z));
    const v = sp.play("hunter", src(), { bus: "sfx", pos: FREE.listener })!;   // nasce em linha livre
    expect(v).not.toBeNull();
    expect(engine.plays().sfx).toBe(1);
    const f = v.filter as unknown as FakeFilter;
    expect(f.type).toBe("lowpass");
    expect(f.frequency.value).toBe(open);
    expect(v.occluded).toBe(false);

    v.setPosition(BEHIND.source);
    sp.updateSpatial();
    expect(v.occluded).toBe(true);
    expect(f.frequency.calls.at(-1)).toEqual(["target", cfg.occlusion_lowpass_hz, ctx.currentTime, cfg.occlusion_ramp_tc]);
    expect(f.frequency.calls.map(c => c[0])).toEqual(["cancel", "set", "target"]);

    // sem mudança de estado: nenhuma rampa nova (custo por quadro só no teste de linha)
    const n = f.frequency.calls.length;
    sp.updateSpatial();
    expect(f.frequency.calls.length).toBe(n);

    // fonte vai para a linha livre do ouvinte
    sp.updateListener(cam(FREE.listener.x, FREE.listener.z));
    v.setPosition(FREE.source);
    ctx.currentTime = 4;
    sp.updateSpatial();
    expect(v.occluded).toBe(false);
    expect(f.frequency.calls.at(-1)).toEqual(["target", open, 4, cfg.occlusion_ramp_tc]);
  });

  it("voz que já nasce atrás da parede começa em 800 Hz, sem rampa", () => {
    const { sp } = setup();
    sp.updateListener(cam(BEHIND.listener.x, BEHIND.listener.z));
    const v = sp.play("footstep", src(), { bus: "sfx", pos: BEHIND.source })!;
    const f = v.filter as unknown as FakeFilter;
    expect(v.occluded).toBe(true);
    expect(f.frequency.value).toBe(cfg.occlusion_lowpass_hz);
    expect(f.frequency.calls).toEqual([]);
  });
});

describe("audio/spatial: cadeia, vagas e motor (A-4)", () => {
  it("source → lowpass → panner HRTF (parâmetros do YAML) → barramento; posição (x, altura, z)", () => {
    const { ctx, engine, sp } = setup();
    const s = new FakeSource();
    const v = sp.play("generator", s as unknown as AudioNode, { bus: "sfx", pos: { x: 3, z: -7 } })!;
    const p = v.panner as unknown as FakePanner;
    expect(s.out).toEqual([v.filter]);
    expect((v.filter as unknown as FakeFilter).out).toEqual([v.panner]);
    expect(p.out).toEqual([engine.busInput("sfx")]);
    expect(p.panningModel).toBe("HRTF");
    expect(p.distanceModel).toBe(cfg.panner.distance_model);
    expect(p.refDistance).toBe(cfg.panner.ref_distance);
    expect(p.maxDistance).toBe(cfg.panner.max_distance);
    expect(p.rolloffFactor).toBe(cfg.panner.rolloff_factor);
    expect([p.positionX.value, p.positionY.value, p.positionZ.value]).toEqual([3, cfg.source_height, -7]);
    v.setPosition({ x: 1, y: 2, z: 5 });
    expect([p.positionX.value, p.positionY.value, p.positionZ.value]).toEqual([1, 2, 5]);
    expect(ctx.filters.length).toBe(1);
  });

  it("fim natural (evento ended) devolve a vaga; roubo para a fonte e chama onSteal", () => {
    const ctx = new FakeCtx();
    const engine = createEngine({ createContext: () => ctx as unknown as AudioContext, storage: null, cfg });
    const voices = createVoiceManager({ max: 2, priorities: cfg.voice_priority });
    const sp = createSpatial({ engine, map: patio, cfg, voices });
    const a = new FakeSource(), b = new FakeSource();
    const stolen: unknown[] = [];
    const va = sp.play("ambience", a as unknown as AudioNode, { bus: "sfx", pos: { x: 0, z: 10 }, onSteal: v => stolen.push(v) })!;
    sp.play("ambience", b as unknown as AudioNode, { bus: "sfx", pos: { x: 0, z: 10 } });
    b.dispatchEvent(new Event("ended"));
    expect(voices.count).toBe(1);
    expect(sp.active()).toEqual([va]);
    sp.play("telegraph", new FakeSource() as unknown as AudioNode, { bus: "sfx", pos: { x: 0, z: 10 } });
    sp.play("telegraph", new FakeSource() as unknown as AudioNode, { bus: "sfx", pos: { x: 0, z: 10 } });
    expect(stolen).toEqual([va]);
    expect(a.stopped).toBe(1);
    expect(a.out).toEqual([]);
    expect(voices.count).toBe(2);
    expect(sp.play("ambience", src(), { bus: "sfx", pos: { x: 0, z: 0 } })).toBeNull();
  });

  it("som do próprio jogador (pos: null): source → barramento, sem panner nem oclusão", () => {
    const { ctx, engine, sp } = setup();
    sp.updateListener(cam(BEHIND.listener.x, BEHIND.listener.z));
    const s = new FakeSource();
    const v = sp.play("footstep", s as unknown as AudioNode, { bus: "sfx", pos: null })!;
    expect(v).not.toBeNull();
    expect(v.filter).toBeNull();
    expect(v.panner).toBeNull();
    expect(v.pos).toBeNull();
    expect(v.occluded).toBe(false);
    expect(s.out).toEqual([engine.busInput("sfx")]);
    expect(ctx.filters.length).toBe(0);
    expect(engine.plays().sfx).toBe(1);
    expect(() => { v.setPosition(BEHIND.source); sp.updateSpatial(BEHIND.source); }).not.toThrow();
    expect(v.occluded).toBe(false);
    expect(sp.voices.count).toBe(1);
    s.dispatchEvent(new Event("ended"));
    expect(sp.voices.count).toBe(0);
    expect(s.out).toEqual([]);
  });

  it("sem Web Audio: play devolve null e não ocupa vaga; ouvinte e oclusão viram no-op", () => {
    const engine = createEngine({ createContext: () => null, storage: null, cfg });
    const voices = createVoiceManager({ priorities: cfg.voice_priority });
    const sp = createSpatial({ engine, map: patio, cfg, voices });
    expect(sp.play("hunter", src(), { bus: "sfx", pos: { x: 0, z: 0 } })).toBeNull();
    expect(voices.count).toBe(0);
    expect(() => { sp.updateListener(cam(1, 2)); sp.updateSpatial(); }).not.toThrow();
  });

  it("padrão usa o singleton do motor (getBusInput/notePlay) e o ouvinte não cria o AudioContext", () => {
    const ctx = new FakeCtx();
    let made = 0;
    const engine = createEngine({ createContext: () => { made++; return ctx as unknown as AudioContext; }, storage: null, cfg });
    useEngine(engine);
    const sp = createSpatial({ map: patio });
    sp.updateListener(cam(0, 0));
    sp.updateSpatial();
    expect(made).toBe(0);
    const v = sp.play("ui", src(), { bus: "ui", pos: { x: 0, z: 12 } })!;
    expect(made).toBe(1);
    expect((v.panner as unknown as FakePanner).out).toEqual([engine.busInput("ui")]);
    expect(engine.plays().ui).toBe(1);
  });
});

describe("audio/spatial: ouvinte na câmera (A-4)", () => {
  const close = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
    expect(a.x).toBeCloseTo(b.x, 6); expect(a.y).toBeCloseTo(b.y, 6); expect(a.z).toBeCloseTo(b.z, 6);
  };

  it("posição, frente e topo seguem a THREE.PerspectiveCamera (convenção de render/scene.ts: ordem YXZ)", () => {
    const { ctx, sp } = setup();
    const c = new THREE.PerspectiveCamera();
    c.rotation.order = "YXZ";
    c.position.set(4, bal.render.camera.eye_height, -6);
    c.rotation.set(-0.3, Math.PI / 2, 0);
    c.updateMatrixWorld();
    sp.updateListener(c);
    const l = ctx.listener as FakeListener;
    expect([l.positionX.value, l.positionY.value, l.positionZ.value]).toEqual([4, bal.render.camera.eye_height, -6]);
    const fwd = c.getWorldDirection(new THREE.Vector3());
    close({ x: l.forwardX.value, y: l.forwardY.value, z: l.forwardZ.value }, fwd);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(c.quaternion);
    close({ x: l.upX.value, y: l.upY.value, z: l.upZ.value }, up);
    // yaw de 90° sem inclinação olha para −x (a câmera do three olha para −z)
    close(cameraAxes({ position: c.position, quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0, "YXZ")) }).forward, { x: -1, y: 0, z: 0 });
    expect(sp.listener).toEqual({ x: 4, y: bal.render.camera.eye_height, z: -6 });
  });

  it("fallback: listener sem AudioParam usa setPosition/setOrientation; câmera só com getWorldDirection e up", () => {
    const { ctx, sp } = setup();
    ctx.listener = new LegacyListener();
    const c = new THREE.PerspectiveCamera();
    c.rotation.set(0, Math.PI, 0);
    c.updateMatrixWorld();
    sp.updateListener({ position: { x: 1, y: 2, z: 3 }, getWorldDirection: t => c.getWorldDirection(t), up: { x: 0, y: 1, z: 0 } });
    const l = ctx.listener;
    expect(l.pos).toEqual([1, 2, 3]);
    close({ x: l.ori[0], y: l.ori[1], z: l.ori[2] }, { x: 0, y: 0, z: 1 });
    expect(l.ori.slice(3)).toEqual([0, 1, 0]);
  });

  it("sem personagem informado, a oclusão cai no ouvinte: mover só a câmera para trás da parede liga o filtro", () => {
    const { sp } = setup();
    const clear = { x: 10, z: 10 };   // de (10, 10) a (10, 0) não há caixa no caminho
    expect(isOccluded(patio, clear, BEHIND.source)).toBe(false);
    sp.updateListener(cam(clear.x, clear.z));
    const v = sp.play("heartbeat", src(), { bus: "sfx", pos: BEHIND.source })!;
    expect(v.occluded).toBe(false);
    sp.updateListener(cam(BEHIND.listener.x, BEHIND.listener.z));
    sp.updateSpatial();
    expect(v.occluded).toBe(true);
    expect((v.filter as unknown as FakeFilter).frequency.target).toBe(cfg.occlusion_lowpass_hz);
  });

  it("oclusão pelo personagem: linha livre até a fonte com a câmera atrás de muro fino → não ocluída", () => {
    const { sp } = setup();
    // muro fino [−14, −12, 10, 3] (z de −13,5 a −10,5): personagem ao norte, câmera recuada ao sul, do outro lado
    const hero = { x: -14, z: -9 }, camBehind = { x: -14, z: -14.5 }, source = { x: -14, z: 0 };
    expect(isOccluded(patio, camBehind, source)).toBe(true);
    expect(isOccluded(patio, hero, source)).toBe(false);
    sp.updateListener(cam(camBehind.x, camBehind.z));
    sp.updateSpatial(hero);
    expect(sp.occlusionPoint).toEqual(hero);
    // play usa o último personagem para a oclusão inicial
    const v = sp.play("hunter", src(), { bus: "sfx", pos: source })!;
    expect(v.occluded).toBe(false);
    const f = (v.filter as unknown as FakeFilter).frequency;
    expect(f.calls).toEqual([]);
    // laço: câmera continua atrás do muro, personagem parado → segue livre; updateSpatial() sem argumento mantém o personagem
    sp.updateListener(cam(camBehind.x, camBehind.z));
    sp.updateSpatial(hero);
    sp.updateSpatial();
    expect(v.occluded).toBe(false);
    expect(f.calls).toEqual([]);
    // personagem passa para trás do muro → ocluída
    sp.updateSpatial(camBehind);
    expect(v.occluded).toBe(true);
    expect(f.target).toBe(cfg.occlusion_lowpass_hz);
    // personagem dentro da caixa central não importa para a câmera: a câmera dentro de [0,0,8,8] não oclui nada
    sp.updateListener(cam(0, 0));
    sp.updateSpatial(hero);
    expect(v.occluded).toBe(false);
  });
});

// R7-mapas (D-22/23/25): a oclusão lê as paredes do mapa EFETIVO (`cfg.map` de makeConfig), a mesma fonte da simulação
// (`SimConfig.map`); com `maps.v1.short_loop_pillars` ligada entram 3 pilares 1×1 m, um deles em (−10, 0), em cima da linha FREE
describe("audio/spatial: mapa padrão = cfg.map efetivo (R7)", () => {
  const PILLAR: [number, number, number, number] = [-10, 0, 1, 1];
  const engineOnly = () => {
    const ctx = new FakeCtx();
    const engine = createEngine({ createContext: () => ctx as unknown as AudioContext, storage: null, cfg });
    engine.ensure();
    return engine;
  };
  afterEach(() => { vi.doUnmock("../src/data.ts"); vi.resetModules(); });

  it("sem deps.map, usa cfg.map de data.ts: hoje ele traz todas as paredes do pátio e a linha FREE fica livre", () => {
    for (const w of patio.walls) expect(simCfg.map.walls).toContainEqual(w);
    expect(isOccluded(simCfg.map, FREE.listener, FREE.source)).toBe(false);
    expect(isOccluded(simCfg.map, BEHIND.listener, BEHIND.source)).toBe(true);
    const sp = createSpatial({ engine: engineOnly(), cfg });
    sp.updateListener(cam(FREE.listener.x, FREE.listener.z));
    expect(sp.play("footstep", src(), { bus: "sfx", pos: FREE.source })!.occluded).toBe(false);
  });

  it("uma parede que só existe no mapa efetivo (pilar do v1) oclui a voz; o mapa de topo não é lido", async () => {
    expect(patio.walls).not.toContainEqual(PILLAR);
    const real = await import("../src/data.ts");
    vi.resetModules();
    vi.doMock("../src/data.ts", () => ({ ...real, cfg: { ...real.cfg, map: { ...real.cfg.map, walls: [...real.cfg.map.walls, PILLAR] } } }));
    const fresh = await import("../src/audio/spatial.ts");
    const sp = fresh.createSpatial({ engine: engineOnly(), cfg });
    sp.updateListener(cam(FREE.listener.x, FREE.listener.z));
    const v = sp.play("footstep", src(), { bus: "sfx", pos: FREE.source })!;
    expect(v.occluded).toBe(true);
    expect((v.filter as unknown as FakeFilter).frequency.value).toBe(cfg.occlusion_lowpass_hz);
  });
});
