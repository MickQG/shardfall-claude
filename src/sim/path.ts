/** Deterministic 8-direction A* on a tile grid. */

export interface Grid {
  width: number;
  height: number;
  /** 1 = blocked, 0 = free. Row-major. */
  blocked: Uint8Array;
}

const DIRS: readonly (readonly [number, number, number])[] = [
  [0, -1, 10],
  [1, 0, 10],
  [0, 1, 10],
  [-1, 0, 10],
  [1, -1, 14],
  [1, 1, 14],
  [-1, 1, 14],
  [-1, -1, 14],
];

export const inBounds = (g: Grid, x: number, y: number): boolean => x >= 0 && y >= 0 && x < g.width && y < g.height;
export const isBlocked = (g: Grid, x: number, y: number): boolean => !inBounds(g, x, y) || g.blocked[y * g.width + x] === 1;

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return 10 * (dx + dy) - 6 * Math.min(dx, dy);
}

/** Binary min-heap keyed by (f, h, index) for fully deterministic ordering. */
class Heap {
  private a: number[] = [];
  constructor(
    private f: Int32Array,
    private h: Int32Array,
  ) {}

  private less(i: number, j: number): boolean {
    const a = this.a[i] as number;
    const b = this.a[j] as number;
    const fa = this.f[a] as number;
    const fb = this.f[b] as number;
    if (fa !== fb) return fa < fb;
    const ha = this.h[a] as number;
    const hb = this.h[b] as number;
    if (ha !== hb) return ha < hb;
    return a < b;
  }

  get size(): number {
    return this.a.length;
  }

  push(n: number): void {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      [a[i], a[p]] = [a[p] as number, a[i] as number];
      i = p;
    }
  }

  pop(): number {
    const a = this.a;
    const top = a[0] as number;
    const last = a.pop() as number;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(l, m)) m = l;
        if (r < a.length && this.less(r, m)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m] as number, a[i] as number];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Path from (sx,sy) to (gx,gy) as a list of tile indices excluding the start.
 * If the goal is blocked or unreachable, returns a path to the reachable tile nearest the goal.
 * Returns [] when already there or no progress is possible.
 */
export function findPath(g: Grid, sx: number, sy: number, gx: number, gy: number): number[] {
  const W = g.width;
  const N = W * g.height;
  const start = sy * W + sx;
  if (!inBounds(g, gx, gy) || !inBounds(g, sx, sy)) return [];

  const gScore = new Int32Array(N).fill(0x7fffffff);
  const fScore = new Int32Array(N);
  const hScore = new Int32Array(N);
  const parent = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = new Heap(fScore, hScore);

  gScore[start] = 0;
  hScore[start] = octile(sx, sy, gx, gy);
  fScore[start] = hScore[start] as number;
  heap.push(start);

  let best = start;
  let bestH = hScore[start] as number;
  let goalIdx = -1;

  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % W;
    const cy = (cur - cx) / W;
    const ch = hScore[cur] as number;
    if (ch < bestH || (ch === bestH && (gScore[cur] as number) < (gScore[best] as number))) {
      best = cur;
      bestH = ch;
    }
    if (cx === gx && cy === gy) {
      goalIdx = cur;
      break;
    }
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (isBlocked(g, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (isBlocked(g, cx + dx, cy) || isBlocked(g, cx, cy + dy))) continue;
      const ni = ny * W + nx;
      if (closed[ni]) continue;
      const ng = (gScore[cur] as number) + cost;
      if (ng < (gScore[ni] as number)) {
        gScore[ni] = ng;
        parent[ni] = cur;
        hScore[ni] = octile(nx, ny, gx, gy);
        fScore[ni] = ng + (hScore[ni] as number);
        heap.push(ni);
      }
    }
  }

  const end = goalIdx >= 0 ? goalIdx : best;
  if (end === start) return [];
  const path: number[] = [];
  for (let n = end; n !== start && n !== -1; n = parent[n] as number) path.push(n);
  path.reverse();
  return path;
}
