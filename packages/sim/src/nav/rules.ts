// Regras do validador de mapas (GDD v0.3 §9.1, tabela "Métricas"; §9.3 variação de layouts).
// Independe do backend: recebe uma fábrica de consulta (navmesh do recast ou grade A* de reserva).
// Todos os limites vêm de data/balance.yaml (`maps.*`, `nav.*`, `match.hunter_spawn_min_dist`).
import type { Balance, GameMap } from "@thehell/shared";
import { boxGap, clearance, pathLength, pointBoxDist, pointInPolygon, polygonPerimeter, type P2 } from "./geometry.ts";
import { gridFromMap, type NavQuery } from "./grid.ts";
import { allLayoutChoices, layoutCounts, maxTeamSize, resolveLayout, survivorSpawns } from "./layout.ts";

/** consulta do backend num raio de agente, com o número de ilhas desconexas de área caminhável */
export interface NavBackend {
  name: string;
  open(map: GameMap, radius: number): NavQuery & { componentCount(): number; dispose?(): void };
}

export type RuleStatus = "ok" | "falha" | "lacuna";
export interface RuleResult {
  rule: string;
  status: RuleStatus;
  detail: string;
}

/** backend da grade de reserva (GDD v0.3 §8.6, `nav.fallback_grid`) */
export function gridBackend(balance: Balance): NavBackend {
  return {
    name: "grade A*",
    open(map, radius) {
      const g = gridFromMap(map, balance, radius);
      return { findPath: (a, b) => g.findPath(a, b), componentCount: () => g.components().count };
    },
  };
}

const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "∞");
const pt = (p: P2) => `(${p[0]}, ${p[1]})`;

export function validateMap(map: GameMap, balance: Balance, backend: NavBackend): RuleResult[] {
  const M = balance.maps, N = balance.nav;
  const out: RuleResult[] = [];
  const add = (rule: string, ok: boolean, detail: string) => out.push({ rule, status: ok ? "ok" : "falha", detail });
  const inner = map.walls; // caixas do mapa (inclui as paredes externas)

  // --- tamanho e paredes (GDD v0.2 §9.1: lado 60–80 m, paredes de 3,4 m) ---
  add("lado do mapa", map.size.every(s => s >= M.side[0] && s <= M.side[1]), `${map.size.join(" × ")} m, faixa ${M.side.join("–")} m`);
  add("altura das paredes", map.wall_height === M.wall_height, `${map.wall_height} m (esperado ${M.wall_height} m)`);

  // --- corredor mínimo (§9.1): navmesh com raio corridor_min/2 conecta todas as áreas jogáveis ---
  const wide = backend.open(map, M.corridor_min / 2);
  const wideCount = wide.componentCount();
  add("corredor ≥ corridor_min (conexidade)", wideCount === 1, `${wideCount} ilha(s) com raio ${M.corridor_min / 2} m`);
  wide.dispose?.();
  // vão entre caixas que deixa passar o agente mas é mais estreito que o corredor mínimo
  const narrow: string[] = [];
  for (let i = 0; i < inner.length; i++)
    for (let j = i + 1; j < inner.length; j++) {
      const gap = boxGap(inner[i], inner[j]);
      if (gap > 0 && gap < M.corridor_min) narrow.push(`caixas ${i} e ${j}: ${gap.toFixed(2)} m`);
    }
  add("corredor ≥ corridor_min (vãos entre caixas)", narrow.length === 0, narrow.length ? narrow.join("; ") : "nenhum vão estreito");

  const nav = backend.open(map, N.agent_radius);
  const count = nav.componentCount();
  add("área jogável conexa no raio do agente", count === 1, `${count} ilha(s) com raio ${N.agent_radius} m`);

  const dists = new Map<string, number>();
  const navDist = (a: P2, b: P2) => {
    const key = `${a[0]},${a[1]}>${b[0]},${b[1]}`;
    let d = dists.get(key);
    if (d === undefined) {
      const p = nav.findPath(a, b);
      d = p.length ? pathLength(p) : Infinity;
      dists.set(key, d);
    }
    return d;
  };
  const clear = (p: P2) => {
    const hx = map.size[0] / 2, hz = map.size[1] / 2;
    return Math.min(clearance(p[0], p[1], inner), hx - Math.abs(p[0]), hz - Math.abs(p[1]));
  };

  // --- spawns ---
  const team = maxTeamSize(balance);
  const spawns = survivorSpawns(map, team);
  const origin = map.survivor_spawn.origin as P2;
  const points: [string, P2][] = [["caçador", map.hunter_spawn], ...spawns.map((s, i) => [`sobrevivente ${i}`, s] as [string, P2])];
  const badSpawn = points.filter(([, p]) => clear(p) < N.agent_radius || !Number.isFinite(navDist(origin, p)));
  add("spawns livres e alcançáveis", badSpawn.length === 0 && spawns.length === team,
    badSpawn.length ? badSpawn.map(([n, p]) => `${n} ${pt(p)}`).join("; ") : `${spawns.length} spawns de sobrevivente para equipe de ${team}`);
  const hd = spawns.map(s => navDist(map.hunter_spawn, s));
  const minHd = Math.min(...hd);
  add("caçador nasce a ≥ hunter_spawn_min_dist", minHd >= balance.match.hunter_spawn_min_dist,
    `menor distância (${backend.name}) ${fmt(minHd)} m (mínimo ${balance.match.hunter_spawn_min_dist} m)`);

  // --- quantidade de variações (§9.3) ---
  const n = layoutCounts(map);
  add("layouts de geradores", n.generators >= M.generator_layouts[0] && n.generators <= M.generator_layouts[1], `${n.generators} (faixa ${M.generator_layouts.join("–")})`);
  add("posições de gaiola", n.cages === M.cage_positions, `${n.cages} (esperado ${M.cage_positions})`);
  add("saídas", n.exits === M.exits, `${n.exits} (esperado ${M.exits})`);

  // --- loops (§9.1): perímetro pela classe, rota caminhável em volta de um obstáculo ---
  const loops = map.loops ?? [];
  add("loops marcados", loops.length > 0, `${loops.length} loop(s)`);
  for (const l of loops) {
    const per = polygonPerimeter(l.polygon);
    const [s0, s1] = M.loop_short_perimeter;
    const inBand = l.kind === "short" ? per >= s0 && per <= s1 : per >= M.loop_long_perimeter_min;
    const band = l.kind === "short" ? `${s0}–${s1} m` : `≥ ${M.loop_long_perimeter_min} m`;
    add(`loop ${l.id}: perímetro (${l.kind})`, inBand, `${fmt(per)} m, faixa ${band}`);
    const around = inner.some(b => pointInPolygon(b[0], b[1], l.polygon) && l.polygon.every(p => pointBoxDist(p[0], p[1], b) > 0));
    const edgesOk = l.polygon.every((p, i) => {
      const q = l.polygon[(i + 1) % l.polygon.length];
      const path = nav.findPath(p, q);
      // a aresta é percorrível sem desvio: caminho existe e não é mais longo que a reta + tolerância
      return path.length > 0 && pathLength(path) <= Math.hypot(q[0] - p[0], q[1] - p[1]) + N.query_snap * 2;
    });
    add(`loop ${l.id}: rota caminhável em volta de obstáculo`, around && edgesOk, `${around ? "contorna caixa" : "não contorna caixa"}; ${edgesOk ? "arestas livres" : "aresta bloqueada"}`);
  }

  // --- cobertura de loops (§9.1): ≥ loop_coverage_min da área caminhável a menos de loop_coverage_radius ---
  {
    const g = gridFromMap(map, balance);
    const src: number[] = [];
    for (let c = 0; c < g.free.length; c++) {
      if (!g.free[c]) continue;
      const [x, z] = g.center(c);
      if (loops.some(l => l.polygon.some((p, i) => segDist(x, z, p, l.polygon[(i + 1) % l.polygon.length]) <= g.cell))) src.push(c);
    }
    const d = g.distanceField(src);
    let free = 0, near = 0;
    for (let c = 0; c < g.free.length; c++) if (g.free[c]) { free++; if (d[c] <= M.loop_coverage_radius) near++; }
    const frac = free ? near / free : 0;
    add("cobertura de loops", frac >= M.loop_coverage_min, `${(frac * 100).toFixed(1)}% da área a ≤ ${M.loop_coverage_radius} m de um loop (mínimo ${M.loop_coverage_min * 100}%)`);
  }

  // --- esconderijos (§9.1) ---
  const hideouts = map.hideouts ?? [];
  add("esconderijos ≥ hideouts_min", hideouts.length >= M.hideouts_min, `${hideouts.length} (mínimo ${M.hideouts_min})`);
  const badHide = hideouts.filter(h => clear(h) < N.agent_radius || !Number.isFinite(navDist(origin, h)));
  add("esconderijos alcançáveis", badHide.length === 0, badHide.length ? badHide.map(pt).join("; ") : "todos");

  // --- combinações (§9.3): alcançabilidade e distância entre geradores ---
  const genChecked = new Set<number>();
  const avgHunter: number[] = [];
  for (const choice of allLayoutChoices(map)) {
    const m = resolveLayout(map, choice);
    const tag = `layout g${choice.generators}/gaiola${choice.cage}/saída${choice.exit}`;
    const pois: [string, P2][] = [
      ...m.generators.map((p, i) => [`gerador ${i} ${pt(p)}`, p] as [string, P2]),
      ...m.bonus.map((p, i) => [`bônus ${i} ${pt(p)}`, p] as [string, P2]),
      [`gaiola ${pt(m.cage)}`, m.cage], [`portão ${pt(m.gate)}`, m.gate],
    ];
    const bad = pois.filter(([, p]) => clear(p) < N.agent_radius || !Number.isFinite(navDist(origin, p)) || !Number.isFinite(navDist(map.hunter_spawn, p)));
    add(`${tag}: geradores, gaiola e saída alcançáveis`, bad.length === 0, bad.length ? `inalcançável ou encostado na parede: ${bad.map(b => b[0]).join("; ")}` : `${pois.length} pontos a partir do spawn e do caçador`);
    if (genChecked.has(choice.generators)) continue;
    genChecked.add(choice.generators);
    let minG = Infinity, pair = "";
    for (let i = 0; i < m.generators.length; i++)
      for (let j = i + 1; j < m.generators.length; j++) {
        const d = navDist(m.generators[i], m.generators[j]);
        if (d < minG) { minG = d; pair = `${pt(m.generators[i])}–${pt(m.generators[j])}`; }
      }
    add(`geradores g${choice.generators}: distância ≥ generator_min_dist`, minG >= M.generator_min_dist, `menor ${fmt(minG)} m ${pair} (mínimo ${M.generator_min_dist} m)`);
    avgHunter.push(m.generators.reduce((s, p) => s + navDist(map.hunter_spawn, p), 0) / m.generators.length);
  }
  const lo = Math.min(...avgHunter), hi = Math.max(...avgHunter);
  const spread = (hi - lo) / lo;
  add("equilíbrio dos layouts (caçador → geradores)", spread <= M.layout_hunter_dist_spread_max,
    `médias ${avgHunter.map(fmt).join(", ")} m; diferença ${(spread * 100).toFixed(1)}% (máximo ${M.layout_hunter_dist_spread_max * 100}%)`);

  out.push({ rule: "vantagem de loop_advantage por volta", status: "lacuna", detail: `${M.loop_advantage.join("–")} s: medido no simulador (R5) com a IA do caçador (R3); depende de C-07 (GDD v0.3 §9.1)` });
  nav.dispose?.();
  return out;
}

function segDist(x: number, z: number, a: P2, b: P2): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0;
  return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz));
}
