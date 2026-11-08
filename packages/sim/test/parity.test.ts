// Paridade com o protótipo: uma verificação por linha de docs/prototipo-paridade.md (seção 1) e itens P-xx.
import { describe, expect, it } from "vitest";
import { attack, ability, createGame, drainEvents, hit, openPuzzle, step, NO_INPUT, type GameState } from "../src/index.ts";
import { balance as b, cfg, map, openSpot, quietGame, run, SPOT, tap } from "./helpers.ts";

const P = (g: GameState) => g.survivors[0];

describe("sobrevivente", () => {
  it("começa com vida 100 e stamina cheia", () => {
    const g = createGame(cfg, "Atacador", 1);
    expect(P(g).hp).toBe(100);
    expect(P(g).stamina).toBe(100);
  });
  it("anda a 4,0 m/s e corre a 5,4 m/s", () => {
    const g = quietGame(); openSpot(g);
    run(g, 1, { forward: 1 });
    expect(26 - P(g).z).toBeCloseTo(4.0, 1);
    openSpot(g); P(g).stamina = 100;
    run(g, 1, { forward: 1, run: true });
    expect(26 - P(g).z).toBeCloseTo(5.4, 1);
  });
  it("stamina: gasta 15/s correndo, recupera 14/s, 10/s em quebra-cabeça", () => {
    const g = quietGame(); openSpot(g);
    run(g, 1, { forward: 1, run: true });
    expect(P(g).stamina).toBeCloseTo(85, 0);
    run(g, 1);
    expect(P(g).stamina).toBeCloseTo(99, 0);
    P(g).stamina = 50; openPuzzle(cfg, g, 0);
    run(g, 1);
    expect(P(g).stamina).toBeCloseTo(60, 0);
  });
  it("não corre com stamina abaixo de 5", () => {
    const g = quietGame(); openSpot(g); P(g).stamina = 4;
    tap(g, { forward: 1, run: true });
    expect(26 - P(g).z).toBeCloseTo(4.0 / 60, 5);
  });
  it("armadilha deixa a ×0,6 por 3 s", () => {
    const g = quietGame(); openSpot(g);
    g.traps.push({ id: 99, x: P(g).x, z: P(g).z });
    tap(g, {});
    expect(P(g).slow).toBeCloseTo(3, 1);
    const z0 = P(g).z; run(g, 1, { forward: 1 });
    expect(z0 - P(g).z).toBeCloseTo(4.0 * 0.6, 1);
  });
});

describe("caçador", () => {
  it("vida 80", () => expect(createGame(cfg, "Curandeiro", 1).hunter.hp).toBe(80));

  function chaseSetup(dist: number) {
    const g = createGame(cfg, "Curandeiro", 3);
    for (const s of g.survivors) if (s.bot) s.st = "dead";
    g.reveal = 1e9;
    g.hunter.x = SPOT.x; g.hunter.z = SPOT.z - dist; g.hunter.dash = 1e9; g.hunter.projectile = 1e9; g.hunter.trap = 1e9;
    openSpot(g);
    return g;
  }
  it("persegue a 3,9 m/s (ruleset do protótipo) e patrulha a 3,1 m/s", () => {
    const g = chaseSetup(10);
    const z0 = g.hunter.z; run(g, 0.5);
    expect(g.hunter.z - z0).toBeCloseTo(3.9 * 0.5, 1);
    const p = chaseSetup(15); p.hunter.patrol = { x: SPOT.x, z: -100 };
    const z1 = p.hunter.z; run(p, 0.5);
    expect(z1 - p.hunter.z).toBeCloseTo(3.1 * 0.5, 1);
  });
  it("na pressão final fica ×1,2 mais rápido e o golpe dá 18", () => {
    const g = chaseSetup(10); g.gateStarted = true; g.gateTimer = 1e9;
    const z0 = g.hunter.z; run(g, 0.5);
    expect(g.hunter.z - z0).toBeCloseTo(3.9 * 1.2 * 0.5, 1);
    const h = chaseSetup(1.5); h.gateStarted = true; h.gateTimer = 1e9;
    tap(h, {});
    expect(P(h).hp).toBe(100 - 18);
  });
  it("detecta a 11 m em 360°, não a 11,5 m", () => {
    const g = chaseSetup(10.9); tap(g, {});
    expect(g.hunter.target).toBe(0);
    const f = chaseSetup(11.5); tap(f, {});
    expect(f.hunter.target).toBe(-1);
  });
  it("golpe: alcance 1,8, dano 15, recarga 1,7 s", () => {
    const g = chaseSetup(1.7);
    tap(g, {});
    expect(P(g).hp).toBe(85);
    expect(g.hunter.atk).toBeCloseTo(1.7, 2);
    const f = chaseSetup(1.9); f.hunter.dash = 1e9; tap(f, {}); // fora do alcance no primeiro quadro
    expect(P(f).hp).toBe(100);
  });
  it("revela os 2 mais próximos a cada 28 s por 3,5 s (primeira aos 20 s)", () => {
    const g = createGame(cfg, "Curandeiro", 1);
    expect(g.reveal).toBe(20);
    g.hunter.stun = 0; g.reveal = 1 / 60;
    g.hunter.x = 0; g.hunter.z = -20;
    tap(g, {});
    expect(g.reveal).toBeCloseTo(28, 1);
    expect(g.survivors.filter(s => s.revealed > 3.4).length).toBe(2);
  });
  it("falha em quebra-cabeça atrai o caçador por 8 s, de qualquer distância (C-08)", () => {
    const g = createGame(cfg, "Curandeiro", 1);
    openPuzzle(cfg, g, 0);
    g.puzzle!.kind = "sequence"; g.puzzle!.seq = ["up", "up", "up", "up"];
    tap(g, { puzzleArrow: "down" });
    expect(g.hunter.alert).toEqual({ x: -22, z: -22 });
    expect(g.hunter.alertTime).toBeCloseTo(8, 1);
  });
  it("dash: 11 m/s por 0,35 s, recarga 15 s, só entre 5 e 11 m", () => {
    const g = chaseSetup(8); g.hunter.dash = 0;
    tap(g, {});
    expect(g.hunter.dash).toBeCloseTo(15, 1);
    expect(g.hunter.dashing).toBeCloseTo(0.35, 2);
    const z0 = g.hunter.z; run(g, 0.2);
    expect(g.hunter.z - z0).toBeCloseTo(11 * 0.2, 1);
    const n = chaseSetup(4); n.hunter.dash = 0; tap(n, {});
    expect(n.hunter.dashing).toBeLessThanOrEqual(0);
  });
  it("projétil: 14 m/s, dano 8, recarga 10 s, entre 5 e 16 m, vida 2 s", () => {
    const g = chaseSetup(12); g.hunter.projectile = 0; g.survivors[0].revealed = 1e9;
    tap(g, {});
    expect(g.projectiles.length).toBe(1);
    expect(Math.hypot(g.projectiles[0].vx, g.projectiles[0].vz)).toBeCloseTo(14, 5);
    expect(g.hunter.projectile).toBeCloseTo(10, 1);
    run(g, 1.5);
    expect(P(g).hp).toBe(92);
    const far = chaseSetup(17); far.hunter.projectile = 0; far.survivors[0].revealed = 1e9; tap(far, {});
    expect(far.projectiles.length).toBe(0);
    const life = createGame(cfg, "Curandeiro", 1);
    life.projectiles.push({ id: 1, x: 0, z: 26, vx: 0, vz: 0, t: b.prototype_extras.projectile_life });
    for (const s of life.survivors) s.st = "dead";
    life.survivors[0].st = "ok"; life.survivors[0].x = 20; life.survivors[0].z = -20; life.hunter.stun = 1e9;
    run(life, 2.05);
    expect(life.projectiles.length).toBe(0);
  });
  it("armadilha a cada 32 s, raio 0,9 m", () => {
    const g = chaseSetup(20); g.hunter.trap = 0;
    tap(g, {});
    expect(g.traps.length).toBe(1);
    expect(g.hunter.trap).toBeCloseTo(32, 1);
    const t = quietGame(); openSpot(t);
    t.traps.push({ id: 5, x: P(t).x + 0.95, z: P(t).z });
    tap(t, {});
    expect(t.traps.length).toBe(1);
  });
});

describe("prisão e resgate", () => {
  it("derrubado vai para a gaiola em (0, 10) por 75 s e morre se ninguém resgatar", () => {
    const g = quietGame();
    hit(cfg, g, P(g), 200);
    expect(P(g).st).toBe("cage");
    expect(P(g).z).toBe(map.cage[1]);
    run(g, 74.9);
    expect(P(g).st).toBe("cage");
    run(g, 0.2);
    expect(P(g).st).toBe("dead");
  });
  it("a 2ª derrubada mata na hora (P-09)", () => {
    const g = quietGame();
    P(g).captures = 1;
    hit(cfg, g, P(g), 200);
    expect(P(g).st).toBe("dead");
  });
  it("resgate: segurar E por 3 s a menos de 2,4 m; volta com 60 de vida e 4 s imune", () => {
    const g = quietGame();
    const bot = g.survivors[1]; bot.st = "ok"; hit(cfg, g, bot, 200);
    expect(bot.st).toBe("cage");
    P(g).x = bot.x + 2.3; P(g).z = bot.z;
    run(g, 2.9, { interactHeld: true });
    expect(bot.st).toBe("cage");
    run(g, 0.2, { interactHeld: true });
    expect(bot.st).toBe("ok");
    expect(bot.hp).toBe(60);
    expect(bot.immune).toBeGreaterThan(3.7);
    hit(cfg, g, bot, 50);
    expect(bot.hp).toBe(60);
  });
});

describe("mapa, geradores e portão", () => {
  it("62×62 m, 4 muros + 11 obstáculos de 3,4 m", () => {
    expect(map.size).toEqual([62, 62]);
    expect(map.walls.length).toBe(15);
    expect(map.wall_height).toBe(3.4);
  });
  it("4 geradores nos cantos (±22) e 3 bônus em (±27, 0) e (0, −12)", () => {
    expect(map.generators).toEqual([[-22, -22], [22, -22], [-22, 22], [22, 22]]);
    expect(map.bonus).toEqual([[-27, 0], [27, 0], [0, -12]]);
  });
  it("quebra-cabeças alternam timing e sequência; 5 por gerador", () => {
    const g = quietGame(); openPuzzle(cfg, g, 0);
    expect(g.puzzle!.kind).toBe("timing");
    g.gens[0].n = 1; openPuzzle(cfg, g, 0);
    expect(g.puzzle!.kind).toBe("sequence");
    expect(g.puzzle!.seq.length).toBe(4);
    expect(b.generator.puzzles_per_generator).toBe(5);
  });
  it("timing: marcador a 0,9/s, zona 0,25 (0,4 para o Mecânico)", () => {
    const g = quietGame(); openPuzzle(cfg, g, 0);
    expect(g.puzzle!.zoneWidth).toBe(0.25);
    run(g, 0.5);
    expect(g.puzzle!.t).toBeCloseTo(0.45, 2);
    const m = quietGame("Mecânico"); openPuzzle(cfg, m, 0);
    expect(m.puzzle!.zoneWidth).toBe(0.4);
  });
  it("portão abre 45 s depois do último gerador; saída em z < −28 e |x| < 3,2", () => {
    const g = quietGame();
    for (const x of g.gens) if (!x.bonus) x.done = true;
    tap(g, {});
    expect(g.gateStarted).toBe(true);
    run(g, 44.8);
    expect(g.gateOpen).toBe(false);
    run(g, 0.3);
    expect(g.gateOpen).toBe(true);
    P(g).x = 3.1; P(g).z = -28.5;
    tap(g, {});
    expect(P(g).st).toBe("out");
    expect(g.over).toBe(true);
  });
});

describe("pontos e economia", () => {
  function solveTiming(g: GameState) { g.puzzle!.kind = "timing"; g.puzzle!.t = g.puzzle!.zoneCenter; tap(g, { puzzleSpace: true }); }
  it("quebra-cabeça +10, gerador +40: total 90 por gerador no protótipo (o GDD diz 50; P-12)", () => {
    const g = quietGame(); openPuzzle(cfg, g, 0);
    for (let i = 0; i < 5; i++) solveTiming(g);
    expect(g.points).toBe(5 * 10 + 40);
    expect(g.gens[0].done).toBe(true);
    expect(g.puzzle).toBeNull();
  });
  it("bônus: +25 por quebra-cabeça e +75 ao concluir (total 200); não conta para o portão", () => {
    const g = quietGame(); openPuzzle(cfg, g, 4);
    for (let i = 0; i < 5; i++) solveTiming(g);
    expect(g.points).toBe(200);
    expect(g.gateStarted).toBe(false);
  });
  it("moedas = 20 + 30 na vitória + pontos × conversão; começa com 150", () => {
    const g = quietGame(); g.points = 100; g.hunter.hp = 0;
    tap(g, {});
    const end = drainEvents(g).find(e => e.type === "end");
    expect(end).toMatchObject({ win: true, outcome: "hunter_down", coins: 20 + 30 + 100 * b.economy.points_to_coins });
    expect(b.economy.start_coins).toBe(150);
  });
  it("7 skins, a padrão é gratuita (preços de D-04)", () => {
    expect(Object.keys(b.skins).length).toBe(7);
    expect(b.skins.std).toBe(0);
  });
});

describe("classes", () => {
  it("Curandeiro: +45 de vida em raio de 6 m, recarga 10 s", () => {
    const g = quietGame("Curandeiro"); const ally = g.survivors[1]; ally.st = "ok"; ally.hp = 30; ally.x = P(g).x + 5.9; ally.z = P(g).z;
    const far = g.survivors[2]; far.st = "ok"; far.hp = 30; far.x = P(g).x + 6.1; far.z = P(g).z;
    tap(g, { ability: true });
    expect(ally.hp).toBe(75);
    expect(far.hp).toBe(30);
    expect(P(g).cd).toBeCloseTo(10, 1);
  });
  it("Mecânico: conserto turbo +1 a menos de 3 m, recarga 14 s; sem gerador perto não gasta", () => {
    const g = quietGame("Mecânico");
    tap(g, { ability: true });
    expect(P(g).cd).toBeLessThanOrEqual(0);
    P(g).x = -22; P(g).z = -19.5;
    tap(g, { ability: true });
    expect(g.gens[0].n).toBe(1);
    expect(P(g).cd).toBeCloseTo(14, 1);
  });
  it("Mecânico: parafuso a 8 m em cone, dano 6, lentidão ×0,5 por 3 s, recarga 6 s só ao acertar", () => {
    const g = quietGame("Mecânico"); openSpot(g); g.hunter.stun = 0;
    g.hunter.x = SPOT.x; g.hunter.z = SPOT.z + 3; P(g).a = 0; // caçador atrás (+z): não acerta
    attack(cfg, g, P(g));
    expect(g.hunter.hp).toBe(80);
    expect(P(g).atk).toBeLessThanOrEqual(0);
    g.hunter.z = SPOT.z - 7.5; P(g).a = 0; // à frente (−z)
    attack(cfg, g, P(g));
    expect(g.hunter.hp).toBe(74);
    expect(g.hunter.slow).toBe(3);
    expect(P(g).atk).toBe(6);
  });
  it("Atacador: bloqueio anula 1 golpe por 5 s, recarga 8 s", () => {
    const g = quietGame("Atacador");
    ability(cfg, g, P(g));
    expect(P(g).block).toBe(5);
    expect(P(g).cd).toBe(8);
    hit(cfg, g, P(g), 15);
    expect(P(g).hp).toBe(100);
    hit(cfg, g, P(g), 15);
    expect(P(g).hp).toBe(85);
  });
  it("Atacador: golpe a 3,2 m, dano 12, atordoa 3 s, recarga 5 s mesmo errando (P-08)", () => {
    const g = quietGame("Atacador"); g.hunter.stun = 0; g.hunter.x = P(g).x + 3.1; g.hunter.z = P(g).z;
    attack(cfg, g, P(g));
    expect(g.hunter.hp).toBe(68);
    expect(g.hunter.stun).toBe(3);
    const m = quietGame("Atacador"); m.hunter.stun = 0; m.hunter.x = P(m).x + 3.3; m.hunter.z = P(m).z;
    attack(cfg, m, P(m));
    expect(m.hunter.hp).toBe(80);
    expect(P(m).atk).toBe(5);
  });
  it("Mecânico jogador desarma armadilha com E a menos de 2 m; bot Mecânico é imune (P-06)", () => {
    const g = quietGame("Mecânico"); openSpot(g);
    g.traps.push({ id: 7, x: P(g).x + 1.5, z: P(g).z });
    tap(g, { interact: true });
    expect(g.traps.length).toBe(0);
    const h = quietGame("Curandeiro"); const mech = h.survivors.find(s => s.cls === "Mecânico")!; mech.st = "ok";
    h.traps.push({ id: 8, x: mech.x, z: mech.z });
    tap(h, {});
    expect(h.traps.length).toBe(1);
    expect(mech.slow).toBeLessThanOrEqual(0);
  });
  it("bots consertam em 10 s por quebra-cabeça (Mecânico: 6 s)", () => {
    expect(b.survivor.bot.puzzle_time).toBe(10);
    expect(b.classes.mechanic.bot_puzzle_time).toBe(6);
    const g = createGame(cfg, "Curandeiro", 1); g.hunter.stun = 1e9; g.hunter.x = 25; g.hunter.z = 25; g.reveal = 1e9;
    const mech = g.survivors.find(s => s.cls === "Mecânico")!; g.survivors[2].st = "dead";
    mech.x = -22; mech.z = -20.5; P(g).x = 10; P(g).z = 0;
    for (let i = 0; i < 6.1 * 60; i++) step(cfg, g, NO_INPUT);
    expect(g.gens[0].n).toBe(1);
  });
});
