// Navmesh por mapa com recast-navigation-js (GDD v0.3 §8.6). Fica fora do índice de @thehell/sim para não
// levar o WASM ao bundle do cliente sem necessidade: importe de "@thehell/sim/nav/recast".
// Parâmetros de `nav.*` (data/balance.yaml). A malha de entrada é o chão do mapa menos as caixas
// (geometry.floorRects); a erosão pelo raio do agente fica com o próprio recast.
import { init, NavMesh, NavMeshQuery, exportNavMesh, importNavMesh, freeCompactHeightfield, freeContourSet, freeHeightfield, freePolyMesh, freePolyMeshDetail } from "@recast-navigation/core";
import { generateSoloNavMesh, type SoloNavMeshGeneratorIntermediates } from "@recast-navigation/generators";
import type { Balance, GameMap } from "@thehell/shared";
import { floorRects, type P2 } from "./geometry.ts";
import type { NavQuery } from "./grid.ts";
import type { NavBackend } from "./rules.ts";

export interface RecastParams {
  cellSize: number;
  cellHeight: number;
  agentRadius: number;
  agentHeight: number;
  walkableClimb: number;
  walkableSlopeDeg: number;
  /** tolerância de consulta (m), `nav.query_snap` */
  snap: number;
}

/** parâmetros de `nav.*`; `radius` troca o raio do agente (ex.: corredor mínimo do §9.1) */
export function navParams(balance: Balance, radius = balance.nav.agent_radius): RecastParams {
  const n = balance.nav;
  return {
    cellSize: n.cell_size, cellHeight: n.cell_height, agentRadius: radius, agentHeight: n.agent_height,
    walkableClimb: n.walkable_climb, walkableSlopeDeg: n.walkable_slope_deg, snap: n.query_snap,
  };
}

let ready: Promise<void> | null = null;
/** carrega o WASM (uma vez por processo/aba) */
export function initRecast(): Promise<void> {
  ready ??= init();
  return ready;
}

// Erro de ponto flutuante na divisão metros ÷ célula (0,5 ÷ 0,1 = 5,000000000000001): tolerância técnica.
const EPS = 1e-6;
const cellsUp = (v: number, c: number) => Math.ceil(v / c - EPS);
const cellsDown = (v: number, c: number) => Math.floor(v / c + EPS);
/** vizinho de polígono nulo no rcPolyMesh (RC_MESH_NULL_IDX) e marca de portal externo */
const NULL_IDX = 0xffff;
const EXT_LINK = 0x8000;

/** malha de triângulos (y para cima) do chão caminhável do mapa */
export function floorMesh(map: Pick<GameMap, "size" | "walls">): { positions: number[]; indices: number[] } {
  const positions: number[] = [], indices: number[] = [];
  for (const [x0, z0, x1, z1] of floorRects(map.size, map.walls)) {
    const k = positions.length / 3;
    positions.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1);
    indices.push(k, k + 2, k + 1, k, k + 3, k + 2);
  }
  return { positions, indices };
}

export interface NavComponents {
  /** quantidade de ilhas de polígonos desconexas */
  count: number;
  /** área (m²) de cada ilha, em ordem decrescente */
  areas: number[];
}

export class RecastNav implements NavQuery {
  readonly navMesh: NavMesh;
  readonly query: NavMeshQuery;
  /** conexidade da malha (só quando gerada aqui, a partir das intermediárias do recast) */
  readonly components: NavComponents | null;
  private readonly params: RecastParams;

  private constructor(navMesh: NavMesh, params: RecastParams, components: NavComponents | null) {
    this.navMesh = navMesh;
    this.params = params;
    this.components = components;
    this.query = new NavMeshQuery(navMesh);
  }

  /** gera o navmesh das caixas do mapa; exige initRecast() antes */
  static build(map: Pick<GameMap, "size" | "walls" | "wall_height">, p: RecastParams): RecastNav {
    const { positions, indices } = floorMesh(map);
    const hx = map.size[0] / 2, hz = map.size[1] / 2;
    const res = generateSoloNavMesh(positions, indices, {
      cs: p.cellSize,
      ch: p.cellHeight,
      walkableRadius: cellsUp(p.agentRadius, p.cellSize),
      walkableHeight: cellsUp(p.agentHeight, p.cellHeight),
      walkableClimb: cellsDown(p.walkableClimb, p.cellHeight),
      walkableSlopeAngle: p.walkableSlopeDeg,
      bounds: [[-hx, -p.cellHeight, -hz], [hx, Math.max(map.wall_height, p.agentHeight), hz]],
    }, true);
    const comps = res.intermediates.polyMesh ? polyComponents(res.intermediates) : null;
    freeIntermediates(res.intermediates);
    if (!res.success) throw new Error(`navmesh falhou: ${res.error}`);
    return new RecastNav(res.navMesh, p, comps);
  }

  /** navmesh exportado no build (exportNavMesh) */
  static fromBytes(bytes: Uint8Array, p: RecastParams): RecastNav {
    const { navMesh } = importNavMesh(bytes);
    return new RecastNav(navMesh, p, null);
  }

  toBytes(): Uint8Array {
    return exportNavMesh(this.navMesh);
  }

  findPath(a: P2, b: P2): P2[] {
    const s = this.params.snap;
    const r = this.query.computePath({ x: a[0], y: 0, z: a[1] }, { x: b[0], y: 0, z: b[1] }, {
      halfExtents: { x: s, y: this.params.agentHeight, z: s },
    });
    if (!r.success || !r.path.length) return [];
    const first = r.path[0], last = r.path[r.path.length - 1];
    // o Detour devolve caminho parcial até o ponto mais próximo quando o destino é inalcançável
    if (Math.hypot(first.x - a[0], first.z - a[1]) > s || Math.hypot(last.x - b[0], last.z - b[1]) > s) return [];
    return r.path.map(v => [v.x, v.z] as P2);
  }

  dispose() {
    this.query.destroy();
    this.navMesh.destroy();
  }
}

/** backend do validador com o navmesh do recast (GDD v0.3 §9.1: "distância no navmesh") */
export function recastBackend(balance: Balance): NavBackend {
  return {
    name: "navmesh (recast)",
    open(map, radius) {
      const nav = RecastNav.build(map, navParams(balance, radius));
      return {
        findPath: (a, b) => nav.findPath(a, b),
        componentCount: () => nav.components!.count,
        dispose: () => nav.dispose(),
      };
    },
  };
}

function polyComponents(im: SoloNavMeshGeneratorIntermediates): NavComponents {
  const pm = im.polyMesh!;
  const nvp = pm.nvp(), np = pm.npolys(), cs = pm.cs(), bmin = pm.bmin();
  const parent = Array.from({ length: np }, (_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const area = new Float64Array(np);
  for (let p = 0; p < np; p++) {
    const base = p * 2 * nvp;
    const vx: number[] = [], vz: number[] = [];
    for (let j = 0; j < nvp; j++) {
      const v = pm.polys(base + j);
      if (v === NULL_IDX) break;
      vx.push(bmin.x + pm.verts(v * 3) * cs);
      vz.push(bmin.z + pm.verts(v * 3 + 2) * cs);
      const nei = pm.polys(base + nvp + j);
      if (nei !== NULL_IDX && !(nei & EXT_LINK)) {
        const a = find(p), b = find(nei);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
    let s = 0;
    for (let j = 0; j < vx.length; j++) {
      const k = (j + 1) % vx.length;
      s += vx[j] * vz[k] - vx[k] * vz[j];
    }
    area[p] = Math.abs(s) / 2;
  }
  const byRoot = new Map<number, number>();
  for (let p = 0; p < np; p++) byRoot.set(find(p), (byRoot.get(find(p)) ?? 0) + area[p]);
  const areas = [...byRoot.values()].sort((a, b) => b - a);
  return { count: areas.length, areas };
}

function freeIntermediates(im: SoloNavMeshGeneratorIntermediates) {
  if (im.heightfield) freeHeightfield(im.heightfield);
  if (im.compactHeightfield) freeCompactHeightfield(im.compactHeightfield);
  if (im.contourSet) freeContourSet(im.contourSet);
  if (im.polyMesh) freePolyMesh(im.polyMesh);
  if (im.polyMeshDetail) freePolyMeshDetail(im.polyMeshDetail);
}
