// Legendas de som (A-6 do V5; GDD-v0.3 §12.4, §12.1 e §12.5; D-37): emissão ligada ao som que tocou, nada quando o
// som não toca (raio, voz recusada, flag), setor relativo à câmera, expiração, limite, fusão, assinatura,
// persistência da opção e chaves nos três idiomas.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameMap } from "@thehell/shared";
import { loadBalanceFile } from "@thehell/shared/node";
import { createGame, makeConfig, STEP, type GameState } from "@thehell/sim";
import {
  CAPTION_KEYS, CAPTIONS_DURATION_KEY, CAPTIONS_STORAGE_KEY, captionDuration, captionFor, setCaptionDuration, createCaptionBus, distanceGain, getCaptions, subscribeCaptions,
  tickCaptions, setCaptionsEnabled, captionsEnabled, useCaptionBus, type Caption, type CaptionStorage,
} from "../src/audio/captions.ts";
import { createAudioDirector, DIRECTOR_SFX } from "../src/audio/director.ts";
import { CATALOGS, t } from "../src/i18n/index.ts";

const bal = loadBalanceFile(new URL("../../../data/balance.yaml", import.meta.url).pathname);
const patio = JSON.parse(readFileSync(new URL("../../../data/maps/patio.json", import.meta.url), "utf8")) as GameMap;
const simCfg = makeConfig(bal, patio, { ruleset: "v1" });
const C = bal.audio.captions, DUR = C.durations[C.default_duration_index], R = bal.audio.director.hunter_audible_radius, S = bal.ui.threat_sectors;
const cfg = { ...bal.audio, ui: bal.ui };

function mem(init: Record<string, string> = {}): CaptionStorage & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
}
function bus(on = true) {
  const b = createCaptionBus({ cfg, storage: mem(), translate: k => `[${k}]` });
  if (on) b.setEnabled(true);
  return b;
}
/** diretor com play falso: `refuse` = nomes cujo play devolve null (voz recusada / sem contexto) */
function rig(opts: { enabled?: boolean; refuse?: string[] } = {}) {
  const played: string[] = [];
  const b = bus();
  const dir = createAudioDirector({
    enabled: opts.enabled ?? true, cfg: bal, captions: b,
    play: name => { if (opts.refuse?.includes(name)) return null; played.push(name); return { cancel() {}, setPosition() {} }; },
    music: { update() {}, duckFor() {} },
  });
  return { dir, b, played };
}
function state(): GameState {
  const g = createGame(simCfg, "Atacador", 7);
  const P = g.survivors[0];
  P.x = 0; P.z = 0;
  g.hunter.x = 100; g.hunter.z = 100;
  for (const s of g.survivors.slice(1)) { s.x = -100; s.z = -100; }
  return g;
}
const step = (r: ReturnType<typeof rig>, g: GameState, yaw = 0) => { g.t += STEP; r.dir.update(g, 0, STEP, undefined, yaw); };
const keys = (l: Caption[]) => l.map(c => c.key);

describe("audio/captions: dados e chaves (A-6)", () => {
  it("todo efeito de audio.captions.effects existe no catálogo, é tocado pelo diretor e aponta para CAPTION_KEYS", () => {
    const events = ["puzzle_ok", "puzzle_fail", "hit", "stun", "bolt"]; // GameEvent "sound" (packages/sim/src/types.ts)
    for (const [name, { key }] of Object.entries(C.effects)) {
      expect(bal.audio.sfx[name], name).toBeDefined();
      expect([...DIRECTOR_SFX, ...events]).toContain(name);
      expect(CAPTION_KEYS as readonly string[]).toContain(key);
    }
    expect(new Set(Object.values(C.effects).map(e => e.key))).toEqual(new Set(CAPTION_KEYS));
  });

  it("as chaves caption.* existem nos 3 idiomas (pt-BR, en, es) e têm texto", () => {
    for (const l of bal.ui.locales) for (const k of CAPTION_KEYS) expect(CATALOGS[l][k], `${l} ${k}`).toBeTruthy();
    for (const k of CAPTION_KEYS) expect(t(k)).toBe(CATALOGS["pt-BR"][k]);
  });

  it("prioridade = voice_priority do kind do efeito; efeito sem legenda = null", () => {
    expect(captionFor("telegraph_dash", cfg)).toEqual({ key: "caption.hunter_dash", category: "hunter_attack", priority: bal.audio.voice_priority.telegraph });
    expect(captionFor("puzzle_fail", cfg)?.priority).toBe(bal.audio.voice_priority.ui);
    expect(captionFor("heartbeat", cfg)).toBeNull();
    expect(captionFor("nao_existe", cfg)).toBeNull();
  });
});

describe("audio/captions: emissão pelo diretor", () => {
  it("prisão: a legenda sai no mesmo passo do som, com a direção da fonte", () => {
    const r = rig(), g = state();
    const s = g.survivors[1];
    s.x = 0; s.z = -10; // à frente com yaw 0 (frente = (−sen yaw, −cos yaw), hud/threat.ts)
    step(r, g);
    expect(r.b.list()).toEqual([]);
    s.st = "cage";
    step(r, g);
    expect(r.played).toContain("cage");
    const [c] = r.b.list();
    expect(c.key).toBe("caption.cage");
    expect(c.dir).toBe(0);
    expect(c.text).toBe("[caption.cage]");
    expect(c.category).toBe("survivor");
    expect(c.intensity).toBeCloseTo(distanceGain(10, bal.audio.panner));
  });

  it("partida nova (relógio volta) limpa as legendas da partida anterior", () => {
    const r = rig(), g = state();
    step(r, g);
    g.survivors[1].st = "cage"; g.survivors[1].x = 0; g.survivors[1].z = -10;
    step(r, g);
    expect(keys(r.b.list())).toEqual(["caption.cage"]);
    const h = state(); // relógio em 0, menor que o da partida anterior
    r.dir.update(h, 0, STEP, undefined, 0);
    expect(r.b.list()).toEqual([]);
  });

  it("som recusado (play devolve null: sem vaga de voz ou sem contexto) não gera legenda", () => {
    const r = rig({ refuse: ["cage"] }), g = state();
    step(r, g);
    g.survivors[1].st = "cage";
    step(r, g);
    expect(r.played).not.toContain("cage");
    expect(r.b.list()).toEqual([]);
  });

  it("D-37: telegraph além de hunter_audible_radius não toca e não legenda; dentro toca e legenda", () => {
    const far = rig(), g = state();
    g.hunter.x = R + 1; g.hunter.z = 0;
    step(far, g);
    g.hunter.windup = { kind: "dash", t: 0.4, total: 0.4 };
    step(far, g);
    expect(far.played).toEqual([]);
    expect(far.b.list()).toEqual([]);

    const near = rig(), h = state();
    h.hunter.x = R - 1; h.hunter.z = 0; // à direita com yaw 0
    step(near, h);
    h.hunter.windup = { kind: "dash", t: 0.4, total: 0.4 };
    step(near, h);
    expect(near.played).toContain("telegraph_dash");
    expect(keys(near.b.list())).toEqual(["caption.hunter_dash"]);
    expect(near.b.list()[0].dir).toBe(S / 4);
  });

  it("audio.director_enabled false: nenhum som, nenhuma legenda", () => {
    const r = rig({ enabled: false }), g = state();
    step(r, g);
    g.survivors[1].st = "cage";
    g.hunter.x = 5; g.hunter.z = 0;
    g.hunter.windup = { kind: "melee", t: 0.4, total: 0.4 };
    step(r, g);
    r.dir.events([{ type: "sound", name: "puzzle_fail" }]);
    expect(r.played).toEqual([]);
    expect(r.b.list()).toEqual([]);
  });

  it("falha no quebra-cabeça (GameEvent sound, sem posição) sai sem direção; efeitos sem legenda não publicam", () => {
    const r = rig();
    r.dir.events([{ type: "sound", name: "puzzle_fail" }, { type: "sound", name: "puzzle_ok" }, { type: "sound", name: "hit" }]);
    const l = r.b.list();
    expect(keys(l)).toEqual(["caption.puzzle_fail"]);
    expect(l[0].dir).toBeNull();
  });

  it("o diretor avança o relógio das legendas: a legenda some depois de audio.captions.duration", () => {
    const r = rig();
    r.dir.events([{ type: "sound", name: "puzzle_fail" }]);
    const g = state();
    for (let i = 0; i < Math.ceil(DUR / STEP) + 1; i++) step(r, g);
    expect(r.b.list()).toEqual([]);
  });
});

describe("audio/captions: barramento", () => {
  const ear = { x: 0, z: 0 };
  it("setor em 4 direções com yaw 0 e girado (o mesmo relativeSector da seta de ameaça)", () => {
    const cases: [{ x: number; z: number }, number][] = [
      [{ x: 0, z: -10 }, 0], [{ x: 10, z: 0 }, S / 4], [{ x: 0, z: 10 }, S / 2], [{ x: -10, z: 0 }, (3 * S) / 4],
    ];
    for (const [pos, want] of cases) expect(bus().emit({ name: "cage", pos, ear, yaw: 0 })?.dir).toBe(want);
    // câmera virada 90° (yaw π/2: frente = (−1, 0)); a fonte em −x fica à frente
    expect(bus().emit({ name: "cage", pos: { x: -10, z: 0 }, ear, yaw: Math.PI / 2 })?.dir).toBe(0);
    // sem yaw ou sem posição: sem direção
    expect(bus().emit({ name: "cage", pos: { x: 10, z: 0 }, ear })?.dir).toBeNull();
    expect(bus().emit({ name: "cage", pos: null, ear, yaw: 0 })?.dir).toBeNull();
  });

  it("expira por ttl (tickCaptions)", () => {
    const b = bus();
    b.emit({ name: "rescue" });
    b.tick(DUR / 2);
    expect(b.list()[0].ttl).toBeCloseTo(DUR / 2);
    b.tick(DUR / 2);
    expect(b.list()).toEqual([]);
  });

  it("limite de simultâneas: a nova derruba a de menor prioridade; de prioridade menor que todas é descartada", () => {
    const b = bus();
    const names = ["puzzle_fail", "cage", "rescue", "generator_done", "step_hunter", "telegraph_melee"];
    for (const n of names) b.emit({ name: n });
    expect(b.list().length).toBe(C.max_on_screen);
    // ficam as de maior prioridade: telegraph (100), caçador (90) e o evento mais novo (85)
    expect(keys(b.list())).toEqual(["caption.generator_done", "caption.hunter_steps", "caption.hunter_growl"]);
    expect(b.emit({ name: "puzzle_fail" })).toBeNull(); // ui (30) < todas
    expect(b.list().length).toBe(C.max_on_screen);
  });

  it("duplicata próxima funde: mesmo id, contagem, ttl renovado e direção nova", () => {
    const b = bus();
    const a = b.emit({ name: "step_hunter", pos: { x: 0, z: -10 }, ear, yaw: 0 })!;
    b.tick(C.merge_window / 2);
    const m = b.emit({ name: "step_hunter", pos: { x: 10, z: 0 }, ear, yaw: 0 })!;
    expect(b.list().length).toBe(1);
    expect(m.id).toBe(a.id);
    expect(m.count).toBe(2);
    expect(m.ttl).toBe(DUR);
    expect(m.dir).toBe(S / 4);
    // do mesmo setor funde mesmo depois da janela; de outro setor e depois da janela abre outra
    b.tick(C.merge_window * 1.5);
    b.emit({ name: "step_hunter", pos: { x: 10, z: 0 }, ear, yaw: 0 });
    expect(b.list().length).toBe(1);
    b.tick(C.merge_window * 1.5);
    b.emit({ name: "step_hunter", pos: { x: 0, z: 10 }, ear, yaw: 0 });
    expect(b.list().length).toBe(2);
  });

  it("subscribe recebe a lista a cada mudança; unsubscribe para; assinante com erro não derruba", () => {
    const b = bus(), seen: number[] = [];
    b.subscribe(() => { throw new Error("x"); });
    const off = b.subscribe(l => seen.push(l.length));
    b.emit({ name: "rescue" });
    b.emit({ name: "cage" });
    b.tick(DUR);
    expect(seen).toEqual([1, 2, 0]);
    off();
    b.emit({ name: "rescue" });
    expect(seen).toEqual([1, 2, 0]);
  });

  it("enabled: padrão dos dados, persiste no storage, relê ao recriar, desligar limpa e bloqueia; storage com erro não lança", () => {
    const st = mem();
    const a = createCaptionBus({ cfg, storage: st });
    expect(a.enabled()).toBe(C.enabled_default);
    a.setEnabled(true);
    expect(st.data[CAPTIONS_STORAGE_KEY]).toBe("1");
    a.emit({ name: "rescue" });
    expect(a.list().length).toBe(1);
    expect(createCaptionBus({ cfg, storage: st }).enabled()).toBe(true);
    a.setEnabled(false);
    expect(a.list()).toEqual([]);
    expect(a.emit({ name: "rescue" })).toBeNull();
    expect(createCaptionBus({ cfg, storage: st }).enabled()).toBe(false);
    const broken: CaptionStorage = { getItem: () => { throw new Error("negado"); }, setItem: () => { throw new Error("cheio"); } };
    const c = createCaptionBus({ cfg, storage: broken });
    expect(c.enabled()).toBe(C.enabled_default);
    expect(() => c.setEnabled(true)).not.toThrow();
    expect(c.enabled()).toBe(true);
  });

  it("D-39/D-40: padrão ligado e 3 s; categorias cobrem os 4 grupos do ícone direcional", () => {
    expect(C.enabled_default).toBe(true);
    expect(C.durations).toEqual([3, 5, 8]);
    expect(DUR).toBe(3);
    expect(new Set(Object.values(C.effects).map(e => e.category))).toEqual(new Set(["hunter_steps", "hunter_attack", "generator", "survivor"]));
    const b = bus();
    expect(b.emit({ name: "step_hunter" })?.category).toBe("hunter_steps");
    expect(b.emit({ name: "telegraph_trap" })?.category).toBe("hunter_attack");
    expect(b.emit({ name: "puzzle_fail" })?.category).toBe("generator");
  });

  it("duração ajustável: só valores da lista, vale para as próximas emissões, persiste; storage com erro ou valor velho cai no padrão", () => {
    const st = mem();
    const b = createCaptionBus({ cfg, storage: st });
    expect(b.duration()).toBe(DUR);
    for (const bad of [4, 0, -3, Number.NaN, 100]) expect(b.setDuration(bad)).toBe(false);
    expect(b.duration()).toBe(DUR);
    expect(st.data[CAPTIONS_DURATION_KEY]).toBeUndefined();
    const longest = C.durations[C.durations.length - 1];
    expect(b.setDuration(longest)).toBe(true);
    expect(st.data[CAPTIONS_DURATION_KEY]).toBe(String(longest));
    expect(b.emit({ name: "rescue" })?.ttl).toBe(longest);
    b.tick(DUR);
    expect(b.list().length).toBe(1); // ainda na tela depois do padrão
    b.tick(longest - DUR);
    expect(b.list()).toEqual([]);
    expect(createCaptionBus({ cfg, storage: st }).duration()).toBe(longest);
    expect(createCaptionBus({ cfg, storage: mem({ [CAPTIONS_DURATION_KEY]: "4" }) }).duration()).toBe(DUR);
    const broken: CaptionStorage = { getItem: () => { throw new Error("negado"); }, setItem: () => { throw new Error("cheio"); } };
    const c = createCaptionBus({ cfg, storage: broken });
    expect(c.duration()).toBe(DUR);
    expect(c.setDuration(C.durations[1])).toBe(true);
    expect(c.duration()).toBe(C.durations[1]);
  });

  it("API do singleton: setCaptionsEnabled, subscribeCaptions, getCaptions (texto do i18n atual), tickCaptions", () => {
    useCaptionBus(createCaptionBus({ cfg, storage: mem() }));
    setCaptionsEnabled(true);
    expect(captionsEnabled()).toBe(true);
    expect(captionDuration()).toBe(DUR);
    expect(setCaptionDuration(4)).toBe(false);
    expect(setCaptionDuration(DUR)).toBe(true);
    const got: Caption[][] = [];
    const off = subscribeCaptions(l => got.push(l));
    useCaptionBusEmit();
    expect(getCaptions()[0].text).toBe(t("caption.generator_done"));
    tickCaptions(DUR);
    expect(getCaptions()).toEqual([]);
    expect(got.map(l => l.length)).toEqual([1, 0]);
    off();
    useCaptionBus(null);
  });
});

/** gerador concluído pelo diretor ligado ao singleton (sem `captions` nas deps) */
function useCaptionBusEmit() {
  const d = createAudioDirector({ enabled: true, cfg: bal, play: () => ({}), music: { update() {}, duckFor() {} } });
  const g = state();
  d.update(g, 0, 0, undefined, 0);
  g.gens[0].done = true;
  g.t += STEP;
  d.update(g, 0, 0, undefined, 0);
}
