/** Deterministic 8-direction A* on a tile grid. */

export interface Grid {
  width: number;
  height: number;
  /** 1 = blocked, 0 = free. Row-major. */
  blocked: Uint8Array;
}

/** The eight steps: x offset, y offset and cost (10 straight, 14 diagonal). Straight steps first. */
const DX = Int8Array.of(0, 1, 0, -1, 1, 1, -1, -1);
const DY = Int8Array.of(-1, 0, 1, 0, -1, 1, 1, -1);
const COST = Int8Array.of(10, 10, 10, 10, 14, 14, 14, 14);

export const inBounds = (g: Grid, x: number, y: number): boolean => x >= 0 && y >= 0 && x < g.width && y < g.height;
export const isBlocked = (g: Grid, x: number, y: number): boolean => !inBounds(g, x, y) || g.blocked[y * g.width + x] === 1;

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return 10 * (dx + dy) - 6 * Math.min(dx, dy);
}

/** f and h are packed into one exact key, f * H_SPAN + h; both stay far below H_SPAN on any map. */
const H_SPAN = 4194304;

/**
 * Binary min-heap of nodes keyed by (f, h, index) for fully deterministic ordering. Each entry carries the key it was
 * pushed with, so a node pushed again with a better score leaves its older entry correctly placed (it is skipped when
 * popped, being closed by then); reading keys from live score arrays instead would break the heap order.
 */
class Heap {
  private node = new Int32Array(256);
  private key = new Float64Array(256);
  size = 0;

  clear(): void {
    this.size = 0;
  }

  private less(i: number, j: number): boolean {
    const a = this.key[i] as number;
    const b = this.key[j] as number;
    return a < b || (a === b && (this.node[i] as number) < (this.node[j] as number));
  }

  private swap(i: number, j: number): void {
    const n = this.node[i] as number;
    this.node[i] = this.node[j] as number;
    this.node[j] = n;
    const k = this.key[i] as number;
    this.key[i] = this.key[j] as number;
    this.key[j] = k;
  }

  push(n: number, f: number, h: number): void {
    if (this.size === this.node.length) {
      const node = new Int32Array(this.size * 2);
      node.set(this.node);
      this.node = node;
      const key = new Float64Array(this.size * 2);
      key.set(this.key);
      this.key = key;
    }
    let i = this.size++;
    this.node[i] = n;
    this.key[i] = f * H_SPAN + h;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.node[0] as number;
    const len = --this.size;
    if (len > 0) {
      this.node[0] = this.node[len] as number;
      this.key[0] = this.key[len] as number;
    }
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < len && this.less(l, m)) m = l;
      if (r < len && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
}

/**
 * Scratch space reused by every search, so a search allocates nothing in proportion to the map. A node's scores are
 * valid only when its stamp equals the current search's, which saves clearing the arrays between searches. Purely a
 * cache: the result of a search never depends on what earlier searches left behind.
 */
const scratch = {
  size: 0,
  run: 0,
  gScore: new Int32Array(0),
  parent: new Int32Array(0),
  /** Stamp of the search that last reached the node (its scores are valid for that search only). */
  seen: new Uint32Array(0),
  /** Stamp of the search that closed the node. */
  closed: new Uint32Array(0),
  heap: new Heap(),
};

function prepare(n: number): typeof scratch {
  const c = scratch;
  if (c.size !== n || c.run >= 0xfffffff0) {
    c.size = n;
    c.run = 0;
    c.gScore = new Int32Array(n);
    c.parent = new Int32Array(n);
    c.seen = new Uint32Array(n);
    c.closed = new Uint32Array(n);
  }
  c.run++;
  c.heap.clear();
  return c;
}

/** Work done by searches: tiles expanded, summed over every call that is passed this record. */
export interface PathWork {
  expanded: number;
}

/** Distance in a distance field for a tile that cannot be reached. */
export const FAR = 0x7fffffff;

/** Whether step `k` from tile (cx,cy) lands on a free tile without cutting across a blocked corner (SIM-4). */
function canStep(blocked: Uint8Array, W: number, H: number, cx: number, cy: number, k: number): boolean {
  const nx = cx + (DX[k] as number);
  const ny = cy + (DY[k] as number);
  if (nx < 0 || ny < 0 || nx >= W || ny >= H || blocked[ny * W + nx] === 1) return false;
  return k < 4 || (blocked[cy * W + nx] !== 1 && blocked[ny * W + cx] !== 1);
}

/**
 * Exact 8-direction travel cost (10 straight, 14 diagonal, no cut corners) from tile `src` (or the nearest of several) to
 * every tile, or FAR: a Dijkstra flood over the whole map. Steps are symmetric, so it is also the cost from every tile to
 * `src`.
 */
export function distanceField(g: Grid, src: number | readonly number[], work?: PathWork): Int32Array {
  const W = g.width;
  const H = g.height;
  const blocked = g.blocked;
  const dist = new Int32Array(W * H).fill(FAR);
  const c = prepare(W * H);
  const run = c.run;
  const { closed, heap } = c;
  for (const s of typeof src === 'number' ? [src] : src) {
    dist[s] = 0;
    heap.push(s, 0, 0);
  }
  let expanded = 0;
  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur] === run) continue;
    closed[cur] = run;
    expanded++;
    const cx = cur % W;
    const cy = (cur - cx) / W;
    const d = dist[cur] as number;
    for (let k = 0; k < 8; k++) {
      if (!canStep(blocked, W, H, cx, cy, k)) continue;
      const ni = cur + (DY[k] as number) * W + (DX[k] as number);
      const nd = d + (COST[k] as number);
      if (closed[ni] === run || nd >= (dist[ni] as number)) continue;
      dist[ni] = nd;
      heap.push(ni, nd, 0);
    }
  }
  if (work) work.expanded += expanded;
  return dist;
}

/**
 * Walk down a distance field `f` (exact costs to one tile, from `distanceField`) from (sx,sy) toward (gx,gy), a tile near
 * the field's own (SIM-10): every step stays on a shortest way to the field's tile (no cut corners, SIM-4), and among
 * such steps it takes the one nearest (gx,gy), so units bound for different tiles keep to different lanes where the
 * ground allows. Stops on the first tile within `near` tiles (Chebyshev) of (gx,gy), or at the field's tile. Returns the
 * tiles stepped onto, excluding the start; `work`, when given, is credited with one per step. Costs nothing when the
 * start cannot reach the field's tile.
 */
export function descend(g: Grid, f: Int32Array, sx: number, sy: number, gx: number, gy: number, near: number, work?: PathWork, floor = 0): number[] {
  const W = g.width;
  const H = g.height;
  const blocked = g.blocked;
  const out: number[] = [];
  let cur = sy * W + sx;
  let cx = sx;
  let cy = sy;
  let d = f[cur] as number;
  if (d === FAR) return out;
  while (d > floor && Math.max(Math.abs(cx - gx), Math.abs(cy - gy)) > near) {
    let best = -1;
    let bestK = -1;
    let bestH = FAR;
    for (let k = 0; k < 8; k++) {
      if (!canStep(blocked, W, H, cx, cy, k)) continue;
      const ni = cur + (DY[k] as number) * W + (DX[k] as number);
      if ((f[ni] as number) + (COST[k] as number) !== d) continue;
      const h = octile(cx + (DX[k] as number), cy + (DY[k] as number), gx, gy);
      if (h < bestH) {
        bestH = h;
        best = ni;
        bestK = k;
      }
    }
    // A finite field value always has a neighbour one step nearer; guard anyway.
    if (best < 0) break;
    cur = best;
    cx += DX[bestK] as number;
    cy += DY[bestK] as number;
    d = f[cur] as number;
    out.push(cur);
  }
  if (work) work.expanded += out.length;
  return out;
}

/**
 * The free tiles a route to the blocked tile (gx,gy) ends on: those at the smallest octile distance from it (SIM-3). A
 * route to it ends on the one of them cheapest to reach.
 */
export function nearestFreeTiles(g: Grid, gx: number, gy: number): number[] {
  const near = nearestFree(g, gx, gy);
  const out: number[] = [];
  if (near === FAR) return out;
  const r = Math.ceil(near / 10);
  for (let y = gy - r; y <= gy + r; y++) for (let x = gx - r; x <= gx + r; x++) if (!isBlocked(g, x, y) && octile(x, y, gx, gy) === near) out.push(y * g.width + x);
  return out;
}

/** The smallest octile distance from (gx,gy) to any free tile: how near a path to a blocked goal can get. */
function nearestFree(g: Grid, gx: number, gy: number): number {
  let best = FAR;
  for (let r = 1; r < Math.max(g.width, g.height) && 10 * r < best; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || isBlocked(g, gx + dx, gy + dy)) continue;
        best = Math.min(best, octile(gx + dx, gy + dy, gx, gy));
      }
    }
  }
  return best;
}

/**
 * Path from (sx,sy) to (gx,gy) as a list of tile indices excluding the start.
 * If the goal is blocked or unreachable, returns a path to the reachable tile nearest the goal.
 * Returns [] when already there or no progress is possible. `work`, when given, is credited with the tiles expanded.
 *
 * `landmarks`, distance fields from tiles near the route's ends (a group order's destination and starting point, SIM-10),
 * sharpen the estimate without changing the result's length: |field(n) - field(goal)| never exceeds the true cost from
 * n to the goal (triangle inequality), so the search still finds a shortest path, but explores far less of the map.
 */
export function findPath(g: Grid, sx: number, sy: number, gx: number, gy: number, work?: PathWork, landmarks: readonly Int32Array[] = []): number[] {
  const W = g.width;
  const H = g.height;
  const blocked = g.blocked;
  const start = sy * W + sx;
  if (!inBounds(g, gx, gy) || !inBounds(g, sx, sy)) return [];

  const c = prepare(W * H);
  const run = c.run;
  const { gScore, parent, seen, closed, heap } = c;
  // A blocked goal is never reached: the search stops at the first tile as near to it as any free tile can be
  // (`enough`) rather than search the whole map. Tiles pop in order of cost plus octile distance, so that tile is the
  // one the full search would have chosen (the nearest, then the cheapest to reach); for that, a blocked goal uses no landmarks.
  const enough = isBlocked(g, gx, gy) ? nearestFree(g, gx, gy) : -1;
  const goal = gy * W + gx;
  const lms = enough < 0 ? landmarks.filter((f) => f[goal] !== FAR) : [];
  const estimate = (x: number, y: number, i: number): number => {
    let h = octile(x, y, gx, gy);
    for (const f of lms) {
      const d = f[i] as number;
      if (d === FAR) continue;
      const at = f[goal] as number;
      const a = d > at ? d - at : at - d;
      if (a > h) h = a;
    }
    return h;
  };

  seen[start] = run;
  gScore[start] = 0;
  parent[start] = -1;
  const h0 = estimate(sx, sy, start);
  heap.push(start, h0, h0);

  let best = start;
  let bestH = octile(sx, sy, gx, gy);
  let goalIdx = -1;
  let expanded = 0;

  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur] === run) continue;
    closed[cur] = run;
    expanded++;
    const cx = cur % W;
    const cy = (cur - cx) / W;
    const ch = octile(cx, cy, gx, gy);
    const cg = gScore[cur] as number;
    if (ch < bestH || (ch === bestH && cg < (gScore[best] as number))) {
      best = cur;
      bestH = ch;
    }
    if ((cx === gx && cy === gy) || bestH === enough) {
      goalIdx = best;
      break;
    }
    for (let k = 0; k < 8; k++) {
      if (!canStep(blocked, W, H, cx, cy, k)) continue;
      const ni = cur + (DY[k] as number) * W + (DX[k] as number);
      if (closed[ni] === run) continue;
      const ng = cg + (COST[k] as number);
      if (seen[ni] !== run || ng < (gScore[ni] as number)) {
        seen[ni] = run;
        gScore[ni] = ng;
        parent[ni] = cur;
        const h = estimate(cx + (DX[k] as number), cy + (DY[k] as number), ni);
        heap.push(ni, ng + h, h);
      }
    }
  }
  if (work) work.expanded += expanded;

  const end = goalIdx >= 0 ? goalIdx : best;
  if (end === start) return [];
  const path: number[] = [];
  for (let n = end; n !== start && n !== -1; n = parent[n] as number) path.push(n);
  path.reverse();
  return path;
}
