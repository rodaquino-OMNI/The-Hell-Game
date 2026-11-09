// R4 — bots competentes (GDD-v0.3 §8.5): cenários de fuga para loop, quebra de linha de visão, habilidade de cada
// classe, resgate por personalidade, stamina, erro humano (falha de quebra-cabeça, tempo de reação), percepção
// filtrada, determinismo e o despacho do cérebro (`ai.bot_brain`).
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BalanceSchema } from "@thehell/shared";
import {
  botsHear, canRescue, chooseGenerator, chooseLoop, fleeProbe, knownHunter, newBotAi, oppositeOnLoop, perceiveBot,
  personalityOf, thinkBot, updateBotAi, type BotEffects,
} from "../src/ai/bots.ts";
import { loopAt } from "../src/ai/hunter.ts";
import {
  chaseEpisodes, createGame, hit, lineOfSight, makeConfig, playHeadless, step, NO_INPUT, type GameState,
  type SimConfig, type Survivor, type Vec,
} from "../src/index.ts";
import { b, map } from "./ai-helpers.ts";

const comp = (o: Parameters<typeof makeConfig>[2] = {}) => makeConfig(b, map, { ruleset: "v1", hunterBrain: "utility", botBrain: "competent", ...o });
const cfg = comp();
const dist = (a: Vec, c: Vec) => Math.hypot(a.x - c.x, a.z - c.z);
const withBots = (patch: Partial<SimConfig["balance"]["ai"]["bots"]>): SimConfig =>
  ({ ...cfg, balance: { ...b, ai: { ...b.ai, bots: { ...b.ai.bots, ...patch } } } });

/** partida com todos os sobreviventes como bots, caçador sem habilidades nem revelação; semente 43 = layout 0 */
function game(c: SimConfig = cfg, seed = 43): GameState {
  const g = createGame(c, "Curandeiro", seed);
  g.survivors[0].bot = true;
  g.reveal = 1e9;
  return g;
}

/** caçador preso num ponto (reposto antes de cada passo), sem atacar */
function pinned(c: SimConfig, g: GameState, seconds: number, h: Vec | null, each?: () => void) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n && !g.over; i++) {
    const H = g.hunter;
    H.dash = 1e9; H.projectile = 1e9; H.trap = 1e9; H.atk = 1e9; H.windup = null;
    if (h) { H.x = h.x; H.z = h.z; }
    step(c, g, NO_INPUT);
    each?.();
  }
}

/** só o bot `id` fica em jogo (os outros ficam fora, mortos: a partida segue enquanto ele estiver livre) */
function solo(g: GameState, id: number, at: Vec, personality = "cautious"): Survivor {
  for (const s of g.survivors) if (s.id !== id) s.st = "dead";
  const s = g.survivors[id];
  s.x = at.x; s.z = at.z;
  s.ai = newBotAi(cfg, { seed: 1 }, s);
  s.ai.personality = personality;
  return s;
}

function fx(): BotEffects & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    ability: s => calls.push(`ability:${s.cls}`),
    attack: s => calls.push(`attack:${s.cls}`),
    collide: () => {},
    noise: k => calls.push(`noise:${k}`),
    puzzle: (_s, _gen, ok) => calls.push(`puzzle:${ok}`),
    free: (c, by) => calls.push(`free:${c.id}:${by.id}`),
  };
}

describe("despacho e dados (ai.bot_brain)", () => {
  it("padrão prototype; o ruleset prototype ignora a sobreposição; v1 aceita competent e monta a grade", () => {
    expect(b.ai.bot_brain).toBe("prototype");
    expect(makeConfig(b, map, { botBrain: "competent" }).botBrain).toBe("prototype");
    expect(makeConfig(b, map, { ruleset: "v1" }).botBrain).toBe("prototype");
    const basic = makeConfig(b, map, { ruleset: "v1", hunterBrain: "basic", botBrain: "competent" });
    expect(basic.botBrain).toBe("competent");
    expect(basic.grid).not.toBeNull();
    expect(makeConfig(b, map, { ruleset: "v1", hunterBrain: "basic" }).grid).toBeNull();
  });
  it("schema: bot_brain é enum e ai.bots é estrito", () => {
    expect(BalanceSchema.safeParse({ ...b, ai: { ...b.ai, bot_brain: "smart" } }).success).toBe(false);
    expect(BalanceSchema.safeParse({ ...b, ai: { ...b.ai, bots: { ...b.ai.bots, extra: 1 } } }).success).toBe(false);
    expect(BalanceSchema.safeParse({ ...b, ai: { ...b.ai, bots: { ...b.ai.bots, ping_reaction: [0.8, 0.3] } } }).success).toBe(false);
    expect(BalanceSchema.safeParse({ ...b, ai: { ...b.ai, bots: { ...b.ai.bots, personalities: {} } } }).success).toBe(false);
  });
  it("bots do protótipo não ganham estado de IA; os competentes sim, no primeiro passo", () => {
    const proto = makeConfig(b, map, { ruleset: "v1", hunterBrain: "utility" });
    const g = createGame(proto, "Curandeiro", 5);
    step(proto, g, NO_INPUT);
    expect(g.survivors.some(s => s.ai)).toBe(false);
    const h = createGame(cfg, "Curandeiro", 5);
    step(cfg, h, NO_INPUT);
    expect(h.survivors[0].ai).toBeUndefined(); // o jogador humano não tem cérebro
    expect(h.survivors.slice(1).every(s => s.ai && s.ai.personality in b.ai.bots.personalities)).toBe(true);
  });
  it("valores do GDD-v0.3 §8.5 nos dados", () => {
    const p = b.ai.bots.personalities;
    expect([p.cautious.flee_dist, p.bold.flee_dist, p.altruist.flee_dist]).toEqual([12, 7, 9]);
    expect([p.cautious.bonus, p.bold.bonus, p.altruist.bonus]).toEqual(["avoid", "prefer", "avoid"]);
    expect(p.altruist.rescue_priority).toBe("high");
    expect(b.ai.bots.puzzle_fail_rate).toBe(0.15);
    expect(b.ai.bots.ping_reaction).toEqual([0.3, 0.8]);
  });
});

describe("personalidade sorteada pelo PRNG da partida", () => {
  it("mesma semente → mesma personalidade; o sorteio avança o PRNG; todas aparecem", () => {
    const s = game().survivors[1];
    const r1 = { seed: 9 }, r2 = { seed: 9 };
    expect(newBotAi(cfg, r1, s).personality).toBe(newBotAi(cfg, r2, s).personality);
    expect(r1.seed).not.toBe(9);
    const seen = new Set<string>();
    for (let k = 0; k < 60; k++) seen.add(newBotAi(cfg, { seed: k }, s).personality);
    expect([...seen].sort()).toEqual(Object.keys(b.ai.bots.personalities).sort());
  });
  it("na partida: depende da semente e não muda o sorteio do ruleset prototype", () => {
    const pers = (seed: number) => { const g = game(cfg, seed); step(cfg, g, NO_INPUT); return g.survivors.map(s => s.ai!.personality).join(); };
    expect(pers(7)).toBe(pers(7));
    const all = new Set(Array.from({ length: 20 }, (_, i) => pers(i + 1)));
    expect(all.size).toBeGreaterThan(3);
  });
});

describe("percepção filtrada (GDD-v0.3 §8.1: o que um jogador naquela posição veria)", () => {
  it("caçador atrás de parede não é visto; em campo aberto e no raio, sim; além da névoa, não", () => {
    const g = game(), s = solo(g, 1, { x: -8, z: 26 }), ai = s.ai!;
    const H = g.hunter;
    H.x = -8; H.z = 22; perceiveBot(cfg, g, s, ai);
    expect(ai.seen).toBe(true);
    expect(ai.hunter).toMatchObject({ x: -8, z: 22 });
    ai.glanceAt = 0; H.x = 0; H.z = 0; s.x = 0; s.z = 8; perceiveBot(cfg, g, s, ai); // parede central entre os dois
    expect(lineOfSight(map, s, H)).toBe(false);
    expect(ai.seen).toBe(false);
    expect(ai.hunter).toMatchObject({ x: -8, z: 22 }); // memória: a última posição vista
    ai.glanceAt = 0; s.x = -8; s.z = 26; H.x = -8; H.z = 26 - b.ai.bots.sight_radius - 1; perceiveBot(cfg, g, s, ai);
    expect(ai.seen).toBe(false);
  });
  it("no quebra-cabeça vale só o campo da câmera; Cauteloso olha em volta ao ouvir o batimento, Ousado não", () => {
    for (const [pers, expected] of [["cautious", true], ["bold", false]] as const) {
      const g = game(), s = solo(g, 1, { x: -8, z: 26 }, pers), ai = s.ai!;
      ai.busy = true; s.a = 0; // olhando para −z
      g.hunter.x = -8; g.hunter.z = 30 - 1.5; // atrás dele, a 2,5 m (batimento ligado)
      perceiveBot(cfg, g, s, ai);
      expect(ai.seen).toBe(false);
      expect(ai.heartbeat).toBe(true);
      g.t += b.ai.bots.ping_reaction[1] + 0.01;
      perceiveBot(cfg, g, s, ai);
      expect(ai.seen).toBe(expected);
    }
  });
  it("fora de interação: campo da câmera entre olhadas em volta a cada glance_interval", () => {
    const g = game(), s = solo(g, 1, { x: -8, z: 26 }), ai = s.ai!;
    s.a = 0; g.hunter.x = -8; g.hunter.z = 29; // atrás
    perceiveBot(cfg, g, s, ai); expect(ai.seen).toBe(true); // primeira olhada
    g.t += 0.1; perceiveBot(cfg, g, s, ai); expect(ai.seen).toBe(false);
    g.t += b.ai.bots.glance_interval; perceiveBot(cfg, g, s, ai); expect(ai.seen).toBe(true);
  });
  it("memória: o caçador conhecido expira depois de ai.bots.memory", () => {
    const g = game(), s = solo(g, 1, { x: -8, z: 26 }), ai = s.ai!;
    g.hunter.x = -8; g.hunter.z = 22; perceiveBot(cfg, g, s, ai);
    expect(knownHunter(cfg, ai, g.t)).not.toBeNull();
    expect(knownHunter(cfg, ai, g.t + b.ai.bots.memory + 0.1)).toBeNull();
  });
});

describe("fuga competente (GDD-v0.3 §8.5)", () => {
  it("sob perseguição vai ao loop mais próximo da rota de fuga e quebra a linha de visão", () => {
    const g = game(), s = solo(g, 1, { x: -8, z: 22 }), h = { x: -14, z: 26 };
    let lostSight = -1;
    pinned(cfg, g, 6, h, () => { if (lostSight < 0 && loopAt(cfg, s) && !lineOfSight(map, s, h)) lostSight = g.t; });
    expect(s.ai!.mode).toBe("flee");
    expect(s.ai!.loop).toBe("sul");
    expect(loopAt(cfg, s)?.id).toBe("sul");
    expect(lostSight).toBeGreaterThan(0);
    expect(lineOfSight(map, s, h)).toBe(false); // segue do outro lado do obstáculo
  });
  it("escolha do loop: prefere o que alcança antes do caçador; sem nenhum, o de maior folga", () => {
    const l = chooseLoop(cfg, { x: -8, z: 22 }, { x: -14, z: 26 });
    expect(l?.id).toBe("sul");
    // caçador em cima do loop "sul": o bot não corre para ele
    expect(chooseLoop(cfg, { x: -8, z: 22 }, { x: -4, z: 22 })?.id).not.toBe("sul");
    expect(chooseLoop({ ...cfg, map: { ...map, loops: [] } }, { x: 0, z: 0 }, null)).toBeNull();
  });
  it("encadeia loops: depois de maps.loop_advantage no mesmo loop troca para outro", () => {
    const g = game(), s = solo(g, 1, { x: 0, z: 22.5 }), ai = s.ai!;
    g.t = 50;
    ai.mode = "flee"; ai.loop = "sul"; ai.loopSince = g.t - b.maps.loop_advantage[0];
    ai.hunter = { x: 0, z: 15, at: g.t, windup: null, stunned: false }; ai.reactAt = 0;
    thinkBot(cfg, g, s, ai, fx());
    expect(ai.loop).toBe("sul"); // ainda dentro da vantagem do loop
    ai.loopSince = g.t - b.maps.loop_advantage[1] - 0.1;
    thinkBot(cfg, g, s, ai, fx());
    expect(ai.loop).not.toBe("sul");
    expect(ai.loopSince).toBe(-1);
  });
  it("ponto oposto ao caçador na rota do loop", () => {
    const sul = map.loops!.find(l => l.id === "sul")!;
    expect(oppositeOnLoop(sul, { x: 0, z: 0 })).toEqual({ x: 0, z: 22.5 });
    expect(oppositeOnLoop(sul, { x: 20, z: 20 })).toEqual({ x: -4, z: 20 });
  });
  it("sem loops no mapa: foge para o ponto de teste mais longe do caçador, preferindo sem linha de visão", () => {
    const c = comp(), noLoops = { ...c, map: { ...map, loops: [] } };
    const p = fleeProbe(noLoops, { x: -8, z: 26 }, { x: -8, z: 20 });
    expect(p.z).toBeGreaterThan(26);
    expect(fleeProbe(noLoops, { x: -8, z: 26 }, null)).toEqual({ x: -8, z: 26 });
    const g = game(noLoops), s = solo(g, 1, { x: -8, z: 22 });
    pinned(noLoops, g, 2, { x: -8, z: 17 });
    expect(s.ai!.mode).toBe("flee");
    expect(dist(s, { x: -8, z: 17 })).toBeGreaterThan(5);
  });
  it("tempo de reação: o caçador que aparece só vira ameaça depois de ping_reaction", () => {
    const g = game(), s = solo(g, 1, { x: -8, z: 22 }), ai = s.ai!;
    g.hunter.x = -14; g.hunter.z = 26;
    perceiveBot(cfg, g, s, ai);
    expect(ai.reactAt - g.t).toBeGreaterThanOrEqual(b.ai.bots.ping_reaction[0]);
    expect(ai.reactAt - g.t).toBeLessThanOrEqual(b.ai.bots.ping_reaction[1]);
    thinkBot(cfg, g, s, ai, fx());
    expect(ai.mode).not.toBe("flee");
    g.t = ai.reactAt; thinkBot(cfg, g, s, ai, fx());
    expect(ai.mode).toBe("flee");
  });
  it("dano recebido também dispara a fuga, mesmo sem ver o caçador", () => {
    const g = game(), s = solo(g, 1, { x: -8, z: 26 }), ai = s.ai!;
    g.hunter.x = 25; g.hunter.z = -25;
    perceiveBot(cfg, g, s, ai);
    s.hp -= 8; g.t += 0.1; perceiveBot(cfg, g, s, ai);
    expect(ai.hitAt).toBe(g.t);
    thinkBot(cfg, g, s, ai, fx());
    expect(ai.mode).toBe("flee");
  });
  it("caçador atordoado não assusta; portão aberto com o caçador do outro lado: foge pela saída", () => {
    const g = game(), s = solo(g, 1, { x: -8, z: 22 }), ai = s.ai!;
    g.hunter.x = -8; g.hunter.z = 18; g.hunter.stun = 5;
    perceiveBot(cfg, g, s, ai); g.t = ai.reactAt; thinkBot(cfg, g, s, ai, fx());
    expect(ai.mode).toBe("work");
    g.hunter.stun = 0; g.gateOpen = true; g.hunter.x = -8; g.hunter.z = 28;
    perceiveBot(cfg, g, s, ai); g.t = ai.reactAt + 1; perceiveBot(cfg, g, s, ai); thinkBot(cfg, g, s, ai, fx());
    expect(ai.mode).toBe("escape");
  });
});

describe("habilidade da classe na fuga (bloqueio, pulso de cura, parafuso)", () => {
  function fleeing(cls: Survivor["cls"], hunterAt: Vec, o: { windup?: "melee" | null; hp?: number; exhausted?: boolean } = {}) {
    const g = game();
    const s = g.survivors.find(x => x.cls === cls)!;
    solo(g, s.id, { x: -8, z: 22 });
    const ai = s.ai!;
    if (o.hp !== undefined) s.hp = o.hp;
    ai.lastHp = s.hp; ai.exhausted = !!o.exhausted;
    g.hunter.x = hunterAt.x; g.hunter.z = hunterAt.z;
    perceiveBot(cfg, g, s, ai);
    ai.mode = "flee"; ai.hitAt = g.t; // perseguido
    ai.hunter!.windup = o.windup ?? null;
    const f = fx();
    thinkBot(cfg, g, s, ai, f);
    return { g, s, f };
  }
  it("Atacador: bloqueio com o caçador perto (defend_dist); golpe só contra preparo letal", () => {
    expect(fleeing("Atacador", { x: -8, z: 19 }).f.calls).toContain("ability:Atacador");
    expect(fleeing("Atacador", { x: -8, z: 14 }).f.calls).not.toContain("ability:Atacador");
    const r = fleeing("Atacador", { x: -8, z: 20 }, { windup: "melee", hp: 10 });
    r.s.cd = 1; r.f.calls.length = 0; thinkBot(cfg, r.g, r.s, r.s.ai!, r.f);
    expect(r.f.calls).toContain("attack:Atacador");
    const safe = fleeing("Atacador", { x: -8, z: 20 }, { windup: "melee", hp: 100 });
    safe.s.cd = 1; safe.f.calls.length = 0; thinkBot(cfg, safe.g, safe.s, safe.s.ai!, safe.f);
    expect(safe.f.calls).not.toContain("attack:Atacador");
  });
  it("Mecânico: parafuso só encurralado (sem stamina ou com preparo à vista) e perto", () => {
    expect(fleeing("Mecânico", { x: -8, z: 19 }).f.calls).not.toContain("attack:Mecânico");
    expect(fleeing("Mecânico", { x: -8, z: 19 }, { exhausted: true }).f.calls).toContain("attack:Mecânico");
    expect(fleeing("Mecânico", { x: -8, z: 19 }, { windup: "melee" }).f.calls).toContain("attack:Mecânico");
    expect(fleeing("Mecânico", { x: -8, z: 12 }, { exhausted: true }).f.calls).not.toContain("attack:Mecânico");
  });
  it("Curandeiro: pulso quando alguém no raio aproveita a cura inteira", () => {
    expect(fleeing("Curandeiro", { x: -8, z: 14 }, { hp: 50 }).f.calls).toContain("ability:Curandeiro");
    expect(fleeing("Curandeiro", { x: -8, z: 14 }, { hp: 60 }).f.calls).not.toContain("ability:Curandeiro");
  });
  it("na partida: o parafuso acerta e desacelera o caçador; o bloqueio fica ativo; a cura sobe a vida", () => {
    for (const cls of ["Mecânico", "Atacador", "Curandeiro"] as const) {
      const g = game(), s = g.survivors.find(x => x.cls === cls)!;
      solo(g, s.id, { x: -8, z: 22 });
      s.hp = 40; s.stamina = 0;
      const H = g.hunter;
      let used = false;
      for (let i = 0; i < 120 && !used; i++) {
        H.x = -8; H.z = 19; H.dash = 1e9; H.projectile = 1e9; H.trap = 1e9; H.atk = 1e9;
        if (i === 30) H.windup = { kind: "melee", t: 10, total: 10 };
        step(cfg, g, NO_INPUT);
        used = cls === "Mecânico" ? H.slow > 0 : cls === "Atacador" ? s.block > 0 : s.hp > 40;
      }
      expect(used, cls).toBe(true);
    }
  });
});

describe("resgate por personalidade (Altruísta prioriza)", () => {
  function scene(pers: [string, string]) {
    const g = game(), cage = g.arena.cage;
    hit(cfg, g, g.survivors[2], 200);
    expect(g.survivors[2].st).toBe("cage");
    const a = g.survivors[0], c = g.survivors[1];
    for (const [s, p] of [[a, pers[0]], [c, pers[1]]] as const) { s.x = cage.x; s.z = cage.z + 7; s.ai = newBotAi(cfg, { seed: 3 }, s); s.ai.personality = p; }
    return { g, a, c, cage };
  }
  it("caçador visível a 12 m da gaiola (batimento ligado): o Altruísta vai resgatar, o Cauteloso não", () => {
    const { g, a, c, cage } = scene(["altruist", "cautious"]);
    let beat = false;
    pinned(cfg, g, 1.5, { x: cage.x + 12, z: cage.z - 3 }, () => { beat ||= a.ai!.heartbeat && c.ai!.heartbeat; });
    expect(beat).toBe(true);
    expect(a.ai!.mode).toBe("rescue");
    expect(c.ai!.mode).not.toBe("rescue");
  });
  it("caçador longe: os dois vão; o resgate solta o aliado em rescue_time", () => {
    const { g, a, c } = scene(["altruist", "cautious"]);
    pinned(cfg, g, 1.5, { x: 25, z: -25 });
    expect(a.ai!.mode).toBe("rescue");
    expect(c.ai!.mode).toBe("rescue");
    pinned(cfg, g, 3 + b.cage.rescue_time, { x: 25, z: -25 });
    expect(g.survivors[2].st).toBe("ok");
  });
  it("regras de canRescue: alta prioridade desiste com o caçador conhecido a menos de flee_dist da gaiola", () => {
    const { g, a, c, cage } = scene(["altruist", "cautious"]);
    for (const s of [a, c]) s.ai!.hunter = { x: cage.x + 5, z: cage.z, at: g.t, windup: null, stunned: false };
    expect(canRescue(cfg, g, a.ai!)).toBe(false);
    expect(canRescue(cfg, g, c.ai!)).toBe(false);
    for (const s of [a, c]) s.ai!.hunter = null;
    c.ai!.heartbeat = true;
    expect(canRescue(cfg, g, c.ai!)).toBe(false);
    c.ai!.mode = "rescue"; // já a caminho: o batimento sozinho não faz desistir
    expect(canRescue(cfg, g, c.ai!)).toBe(true);
  });
  it("aliado preso só é notado depois do tempo de reação (HUD)", () => {
    const { g, a } = scene(["altruist", "altruist"]);
    perceiveBot(cfg, g, a, a.ai!);
    expect(a.ai!.caged).toEqual([]);
    const at = a.ai!.pending[0].at - g.t;
    expect(at).toBeGreaterThanOrEqual(b.ai.bots.ping_reaction[0]);
    expect(at).toBeLessThanOrEqual(b.ai.bots.ping_reaction[1]);
    g.t += at; perceiveBot(cfg, g, a, a.ai!);
    expect(a.ai!.caged).toEqual([2]);
    g.survivors[2].st = "ok"; perceiveBot(cfg, g, a, a.ai!);
    expect(a.ai!.caged).toEqual([]);
  });
});

describe("stamina com as regras do jogador", () => {
  it("corre com o caçador perto e stamina; esgotada, anda e recupera até stamina_resume", () => {
    const g = game(), s = solo(g, 1, { x: -8, z: 22 }, "cautious"), h = { x: -8, z: 14 };
    s.ai!.hitAt = 0; // perseguido
    let ran = false;
    pinned(cfg, g, 1.2, h, () => { ran ||= s.ai!.running; });
    expect(ran).toBe(true);
    expect(s.stamina).toBeLessThan(b.survivor.stamina.max);
    s.stamina = b.prototype_extras.stamina_min_to_run; s.ai!.hitAt = g.t;
    const walk: boolean[] = [];
    pinned(cfg, g, 1, h, () => walk.push(s.ai!.running));
    expect(walk.every(r => !r)).toBe(true);
    expect(s.ai!.exhausted).toBe(true);
    expect(s.stamina).toBeGreaterThan(b.prototype_extras.stamina_min_to_run);
    s.stamina = b.ai.bots.stamina_resume; pinned(cfg, g, 0.1, h);
    expect(s.ai!.exhausted).toBe(false);
  });
  it("sem ameaça anda (sem gastar stamina)", () => {
    const g = game(), s = solo(g, 1, { x: -8, z: 26 });
    pinned(cfg, g, 2, { x: 25, z: -25 });
    expect(s.ai!.running).toBe(false);
    expect(s.stamina).toBe(b.survivor.stamina.max);
  });
});

describe("erro humano: falha de quebra-cabeça (ai.bots.puzzle_fail_rate)", () => {
  it("≈ 15% numa amostra de 2.000 quebra-cabeças", () => {
    const g = game(), s = solo(g, 1, { x: -8, z: 26 }), f = fx();
    const gen = g.gens.findIndex(x => !x.bonus);
    s.x = g.gens[gen].x + 1; s.z = g.gens[gen].z;
    g.hunter.x = 25; g.hunter.z = 25;
    const need = b.survivor.bot.puzzle_time;
    for (let i = 0; i < 2000; i++) { s.work = need; s.ai!.mode = "work"; s.ai!.gen = gen; s.ai!.decideIn = 1; s.ai!.perceiveIn = 1; updateBotAi(cfg, g, s, 1 / 60, f); }
    const fails = f.calls.filter(c => c === "puzzle:false").length, total = f.calls.filter(c => c.startsWith("puzzle:")).length;
    expect(total).toBe(2000);
    expect(fails / total).toBeGreaterThan(0.12);
    expect(fails / total).toBeLessThan(0.18);
  });
  it("falha faz o ruído de 18 m e a regressão do jogador; acerto avança e zera as falhas", () => {
    for (const rate of [1, 0]) {
      const c = withBots({ puzzle_fail_rate: rate }), g = game(c), s = solo(g, 1, { x: -8, z: 26 });
      s.ai = newBotAi(c, { seed: 1 }, s);
      const gen = g.gens.find(x => !x.bonus)!;
      gen.n = 2; gen.fails = rate ? 0 : 2;
      s.x = gen.x + 1; s.z = gen.z;
      const noises: string[] = [];
      const need = s.cls === "Mecânico" ? b.classes.mechanic.bot_puzzle_time : b.survivor.bot.puzzle_time;
      s.cd = 1e9; // sem conserto turbo
      for (let i = 0; i < 60 * (3 * need + 1); i++) {
        g.hunter.x = 25; g.hunter.z = 25; g.hunter.stun = 1e9;
        step(c, g, NO_INPUT);
        for (const e of g.events) if (e.type === "noise") noises.push(e.kind);
        g.events.length = 0;
      }
      if (rate) { expect(noises.filter(k => k === "puzzle_fail").length).toBe(3); expect(gen.n).toBe(2 - b.generator.regress_amount); }
      else { expect(gen.fails).toBe(0); expect(gen.n).toBe(5); expect(gen.done).toBe(true); }
    }
  });
});

describe("reação a eventos que o sim emite (LACUNA: sem pings no sim)", () => {
  it("falha de quebra-cabeça ouvida e gerador revelado viram perigo; o gerador perto do perigo é evitado", () => {
    const g = game(), s = solo(g, 1, { x: -8, z: 26 });
    const ai = s.ai!, req = g.gens.map((x, i) => i).filter(i => !g.gens[i].bonus);
    const near = req.sort((i, j) => dist(g.gens[i], s) - dist(g.gens[j], s))[0];
    expect(chooseGenerator(cfg, g, s, ai)).toBe(near);
    botsHear(cfg, g, "puzzle_fail", { x: g.gens[near].x, z: g.gens[near].z });
    botsHear(cfg, g, "run", { x: g.gens[near].x, z: g.gens[near].z }); // ignorado
    expect(ai.pending).toHaveLength(1);
    g.t += b.ai.bots.ping_reaction[1]; perceiveBot(cfg, g, s, ai);
    expect(ai.dangers).toHaveLength(1);
    expect(chooseGenerator(cfg, g, s, ai)).not.toBe(near);
    g.t += b.ai.hearing_investigate_time + 0.1; perceiveBot(cfg, g, s, ai);
    expect(ai.dangers).toHaveLength(0);
    const other = g.gens.find(x => !x.bonus && x !== g.gens[near])!;
    other.revealed = 3; other.done = true; perceiveBot(cfg, g, s, ai);
    expect(ai.pending.some(e => e.kind === "danger" && e.x === other.x)).toBe(true);
  });
  it("bônus: o Ousado prioriza, Cauteloso e Altruísta evitam; na pressão final só o Ousado segue em bônus", () => {
    const g = game(), s = solo(g, 1, { x: -27, z: 3 }), ai = s.ai!;
    expect(g.gens[chooseGenerator(cfg, g, s, ai)].bonus).toBe(false);
    ai.personality = "bold";
    expect(g.gens[chooseGenerator(cfg, g, s, ai)].bonus).toBe(true);
    for (const x of g.gens) if (!x.bonus) x.done = true;
    g.gateStarted = true;
    expect(g.gens[chooseGenerator(cfg, g, s, ai)].bonus).toBe(true);
    ai.personality = "cautious";
    expect(chooseGenerator(cfg, g, s, ai)).toBe(-1);
  });
  it("na pressão final espera perto do portão e escapa quando ele abre", () => {
    const g = game(), s = solo(g, 1, { x: -8, z: 0 });
    for (const x of g.gens) if (!x.bonus) x.done = true;
    pinned(cfg, g, 1, { x: 25, z: 25 });
    expect(s.ai!.mode).toBe("wait");
    g.gateOpen = true; g.gateTimer = 0;
    pinned(cfg, g, 30, { x: 25, z: 25 });
    expect(s.st).toBe("out");
  });
});

describe("determinismo e simulador", () => {
  const hash = (seed: number) => {
    const g = game(cfg, seed);
    for (let i = 0; i < 60 * 90 && !g.over; i++) step(cfg, g, NO_INPUT);
    return createHash("sha256").update(JSON.stringify(g)).digest("hex");
  };
  it("mesma semente → mesmo estado (incluindo o cérebro dos bots); semente diferente → outro", () => {
    expect(hash(11)).toBe(hash(11));
    expect(hash(11)).not.toBe(hash(12));
  });
  it("partida headless com bots competentes: termina, sem trava, perseguições medidas", () => {
    const r = playHeadless(comp({ difficulty: "nightmare" }), 3);
    expect(r.stuck.failAt).toBeNull();
    expect(r.team).not.toBeNull();
    for (const d of r.chases) expect(d).toBeGreaterThan(0);
  });
  it("métrica do §8.5 (D-35): com o caçador seguindo pela memória, o episódio sobrevive à perda de linha de visão", () => {
    // chaseEpisodes conta chase/attack/recoil contínuos até cage; com a D-35 o chase cobre o alvo visto ou lembrado
    expect(chaseEpisodes([
      { t: 1, from: "patrol", to: "chase" }, { t: 3, from: "chase", to: "attack" }, { t: 3.4, from: "attack", to: "recoil" },
      { t: 4, from: "recoil", to: "chase" }, { t: 20, from: "chase", to: "attack" }, { t: 20.4, from: "attack", to: "recoil" },
      { t: 21, from: "recoil", to: "cage" },
    ])).toEqual([19.4]);
  });
  it("personalidade de bot desconhecida não existe nos dados (personalityOf lê ai.bots.personalities)", () => {
    const s = game().survivors[1], ai = newBotAi(cfg, { seed: 2 }, s);
    expect(personalityOf(cfg, ai)).toBe(b.ai.bots.personalities[ai.personality]);
  });
  it("volta da gaiola: caminho velho descartado", () => {
    const g = game(), s = solo(g, 1, { x: -8, z: 26 });
    pinned(cfg, g, 0.5, { x: 25, z: 25 });
    s.ai!.path = [{ x: 0, z: 0 }]; s.captures = 1;
    const spy = vi.fn();
    updateBotAi(cfg, g, s, 1 / 60, { ...fx(), collide: spy });
    expect(s.ai!.captures).toBe(1);
  });
});
