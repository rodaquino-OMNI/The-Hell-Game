// Grade A* de reserva (GDD v0.3 §8.6, `nav.fallback_grid`): célula livre se o centro está a pelo menos
// `radius` de toda caixa e da borda do mapa. Determinística: vizinhos em ordem fixa e desempate da fila
// por ordem de inserção. Sem dependência externa, serve em Node, navegador e servidor.
// Limite da reserva: só os centros de célula contam, então uma passagem mais estreita que
// 2 × raio + célula pode sumir na grade (o navmesh, com célula de nav.cell_size, não tem esse limite).
import type { Balance, GameMap } from "@thehell/shared";
import { clearance, segmentHitsBox, type Box, type P2 } from "./geometry.ts";

/** consulta comum ao navmesh (recast) e à grade de reserva */
export interface NavQuery {
  /** caminho de a até b (inclui os dois pontos); vazio se não houver caminho */
  findPath(a: P2, b: P2): P2[];
}

export interface GridOptions {
  /** tamanho do mapa [x, z], centrado na origem */
  size: P2;
  boxes: readonly Box[];
  /** lado da célula (m) */
  cell: number;
  /** raio do agente (m) */
  radius: number;
  /** distância máxima do ponto pedido até o centro de célula livre usado (m) */
  snap: number;
}

// vizinhos: 4 ortogonais e 4 diagonais (ordem fixa = determinismo)
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

/** fila de prioridade mínima com desempate estável (custo, depois ordem de inserção) */
class MinHeap {
  private k: number[] = [];
  private s: number[] = [];
  private v: number[] = [];
  private seq = 0;
  get size() { return this.v.length; }
  push(key: number, val: number) {
    this.k.push(key); this.s.push(this.seq++); this.v.push(val);
    let i = this.v.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p); i = p;
    }
  }
  pop(): number {
    const top = this.v[0], n = this.v.length - 1;
    this.swap(0, n);
    this.k.pop(); this.s.pop(); this.v.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < n && this.less(l, m)) m = l;
      if (r < n && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m); i = m;
    }
    return top;
  }
  private less(a: number, b: number) { return this.k[a] < this.k[b] || (this.k[a] === this.k[b] && this.s[a] < this.s[b]); }
  private swap(a: number, b: number) {
    [this.k[a], this.k[b]] = [this.k[b], this.k[a]];
    [this.s[a], this.s[b]] = [this.s[b], this.s[a]];
    [this.v[a], this.v[b]] = [this.v[b], this.v[a]];
  }
}

export class GridNav implements NavQuery {
  readonly nx: number;
  readonly nz: number;
  readonly cell: number;
  readonly radius: number;
  /** 1 = livre */
  readonly free: Uint8Array;
  private readonly x0: number;
  private readonly z0: number;
  private readonly hx: number;
  private readonly hz: number;
  private readonly boxes: readonly Box[];
  private readonly snap: number;

  constructor(o: GridOptions) {
    this.cell = o.cell;
    this.radius = o.radius;
    this.boxes = o.boxes;
    this.snap = o.snap;
    this.hx = o.size[0] / 2;
    this.hz = o.size[1] / 2;
    this.x0 = -this.hx;
    this.z0 = -this.hz;
    this.nx = Math.max(1, Math.round(o.size[0] / o.cell));
    this.nz = Math.max(1, Math.round(o.size[1] / o.cell));
    this.free = new Uint8Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const [x, z] = this.center(j * this.nx + i);
        this.free[j * this.nx + i] = this.isClear(x, z) ? 1 : 0;
      }
    }
  }

  /** ponto a pelo menos `radius` de toda caixa e da borda do mapa */
  isClear(x: number, z: number): boolean {
    const r = this.radius;
    if (Math.abs(x) > this.hx - r || Math.abs(z) > this.hz - r) return false;
    const c = clearance(x, z, this.boxes);
    return c >= r && c > 0;
  }

  center(c: number): P2 {
    const i = c % this.nx, j = (c - i) / this.nx;
    return [this.x0 + (i + 0.5) * this.cell, this.z0 + (j + 0.5) * this.cell];
  }

  cellOf(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    return j * this.nx + i;
  }

  /** célula livre mais próxima do ponto, até `snap` de distância; -1 se não houver */
  snapCell(p: P2): number {
    const reach = Math.ceil(this.snap / this.cell) + 1;
    const i0 = Math.floor((p[0] - this.x0) / this.cell), j0 = Math.floor((p[1] - this.z0) / this.cell);
    let best = -1, bestD = Infinity;
    for (let j = j0 - reach; j <= j0 + reach; j++) {
      for (let i = i0 - reach; i <= i0 + reach; i++) {
        if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
        const c = j * this.nx + i;
        if (!this.free[c]) continue;
        const [x, z] = this.center(c);
        const d = Math.hypot(x - p[0], z - p[1]);
        if (d <= this.snap && d < bestD) { best = c; bestD = d; }
      }
    }
    return best;
  }

  /**
   * Centro de célula livre mais próximo do ponto, sem limite de distância (null só se a grade não tiver célula
   * livre). Usado para projetar destinos (ponto de patrulha, vasculha, interceptação) num ponto navegável:
   * um ponto sorteado ou previsto pode cair dentro de parede (achado da revisão do R2). Busca em anéis
   * quadrados crescentes; para quando o anel já está mais longe que o melhor achado (determinística).
   */
  nearestFree(p: P2): P2 | null {
    const i0 = Math.min(this.nx - 1, Math.max(0, Math.floor((p[0] - this.x0) / this.cell)));
    const j0 = Math.min(this.nz - 1, Math.max(0, Math.floor((p[1] - this.z0) / this.cell)));
    let best = -1, bestD = Infinity;
    const maxK = Math.max(this.nx, this.nz);
    for (let k = 0; k <= maxK; k++) {
      if (best >= 0 && (k - 1) * this.cell > bestD) break;
      for (let j = j0 - k; j <= j0 + k; j++) {
        for (let i = i0 - k; i <= i0 + k; i++) {
          if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== k) continue; // só a borda do anel
          if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
          const c = j * this.nx + i;
          if (!this.free[c]) continue;
          const [x, z] = this.center(c);
          const d = Math.hypot(x - p[0], z - p[1]);
          if (d < bestD) { best = c; bestD = d; }
        }
      }
    }
    return best >= 0 ? this.center(best) : null;
  }

  /** linha reta livre para o agente (caixas infladas em `radius`, dentro do mapa) */
  lineOfSight(a: P2, b: P2): boolean {
    const r = this.radius;
    for (const p of [a, b]) if (Math.abs(p[0]) > this.hx - r || Math.abs(p[1]) > this.hz - r) return false;
    return !this.boxes.some(box => segmentHitsBox(a, b, box, r));
  }

  private neighbors(c: number, visit: (n: number, cost: number) => void) {
    const i = c % this.nx, j = (c - i) / this.nx;
    for (let k = 0; k < 8; k++) {
      const ni = i + DX[k], nj = j + DZ[k];
      if (ni < 0 || nj < 0 || ni >= this.nx || nj >= this.nz) continue;
      const n = nj * this.nx + ni;
      if (!this.free[n]) continue;
      // diagonal só se as duas ortogonais estiverem livres (sem cortar quina)
      if (k >= 4 && (!this.free[j * this.nx + ni] || !this.free[nj * this.nx + i])) continue;
      visit(n, k >= 4 ? Math.SQRT2 * this.cell : this.cell);
    }
  }

  /** A* com heurística octil; devolve a sequência de células (vazia se não houver caminho) */
  findCells(start: number, goal: number): number[] {
    if (start < 0 || goal < 0) return [];
    const n = this.free.length;
    const g = new Float64Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const gi = goal % this.nx, gj = (goal - gi) / this.nx;
    const h = (c: number) => {
      const i = c % this.nx, j = (c - i) / this.nx;
      const dx = Math.abs(i - gi), dz = Math.abs(j - gj);
      return this.cell * (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz));
    };
    const open = new MinHeap();
    g[start] = 0;
    open.push(h(start), start);
    while (open.size) {
      const c = open.pop();
      if (closed[c]) continue;
      if (c === goal) {
        const out: number[] = [];
        for (let k = c; k !== -1; k = from[k]) out.push(k);
        return out.reverse();
      }
      closed[c] = 1;
      this.neighbors(c, (m, cost) => {
        const ng = g[c] + cost;
        if (ng < g[m]) { g[m] = ng; from[m] = c; open.push(ng + h(m), m); }
      });
    }
    return [];
  }

  findPath(a: P2, b: P2): P2[] {
    const cells = this.findCells(this.snapCell(a), this.snapCell(b));
    if (!cells.length) return [];
    const raw: P2[] = [a, ...cells.map(c => this.center(c)), b];
    return this.smooth(raw);
  }

  /** puxa o fio: liga cada ponto ao mais distante com linha livre */
  private smooth(pts: P2[]): P2[] {
    const out: P2[] = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.lineOfSight(pts[i], pts[j])) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  /** Dijkstra a partir de várias células; distância pela grade (m), Infinity onde não alcança */
  distanceField(sources: readonly number[]): Float64Array {
    const d = new Float64Array(this.free.length).fill(Infinity);
    const open = new MinHeap();
    for (const s of sources) if (s >= 0 && this.free[s] && d[s] !== 0) { d[s] = 0; open.push(0, s); }
    while (open.size) {
      const c = open.pop();
      this.neighbors(c, (m, cost) => {
        const nd = d[c] + cost;
        if (nd < d[m]) { d[m] = nd; open.push(nd, m); }
      });
    }
    return d;
  }

  /** componentes conexas das células livres: rótulo por célula (-1 = bloqueada) e quantidade */
  components(): { labels: Int32Array; count: number; sizes: number[] } {
    const labels = new Int32Array(this.free.length).fill(-1);
    const sizes: number[] = [];
    const stack: number[] = [];
    for (let s = 0; s < this.free.length; s++) {
      if (!this.free[s] || labels[s] !== -1) continue;
      const id = sizes.length;
      let size = 0;
      labels[s] = id;
      stack.push(s);
      while (stack.length) {
        const c = stack.pop()!;
        size++;
        this.neighbors(c, m => { if (labels[m] === -1) { labels[m] = id; stack.push(m); } });
      }
      sizes.push(size);
    }
    return { labels, count: sizes.length, sizes };
  }
}

/** grade de reserva do mapa com `nav.fallback_grid` e `nav.query_snap`; `radius` padrão = `nav.agent_radius` */
export function gridFromMap(map: Pick<GameMap, "size" | "walls">, balance: Balance, radius = balance.nav.agent_radius): GridNav {
  return new GridNav({ size: map.size, boxes: map.walls, cell: balance.nav.fallback_grid, radius, snap: balance.nav.query_snap });
}
