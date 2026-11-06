import { Rng, type MapDef } from '../sim';
import { buildMap, DEFAULT_START, MAP_SIZE, type Blob, type Field, type MapPlan } from './mapPlan';

/**
 * The map generator (MAP-7..9): a map seed becomes the plan for one half of a point-symmetric map, built from the same
 * pieces as the hand-made maps (rock outcrops, lakes, a river with crossings, shard fields). Integer arithmetic and the
 * seeded Rng only, so every machine builds the same map from the same seed (MAP-7).
 */

/** Map seeds run from 0 to MAP_SEED_MAX - 1; the next seed after the last is 0 (MAP-9). */
export const MAP_SEED_MAX = 1_000_000;
/** How many seeds MAP-9 tries before giving up; in practice nearly every seed passes at once. */
const MAX_TRIES = 1000;

const W = MAP_SIZE;
const C = W - 1;

/** A map seed from untrusted input (the address bar, saved settings, the seed box): a whole number in range, or `fallback`. */
export function mapSeedOf(raw: unknown, fallback = 0): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,9}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isInteger(n) && n >= 0 && n < MAP_SEED_MAX ? n : fallback;
}

/**
 * A triangle wave through 0 at 0 with period `p` and peaks of +-1: odd, so a river that follows it is its own mirror
 * image. Only +, -, * and / of whole numbers, which every machine rounds the same way (MAP-7).
 */
function zigzag(a: number, p: number): number {
  const u = (((a - p / 4) % p) + p) % p;
  return (4 * Math.abs(u - p / 2)) / p - 1;
}

/** Where the bases stand: a corner (as Crossroads) or the middle of an edge (as Riverbed); home fields relative to it. */
const STARTS: readonly { start: { tx: number; ty: number }; home: [number, number][] }[] = [
  { start: DEFAULT_START, home: [[12, 2], [2, 14]] },
  { start: { tx: 45, ty: 9 }, home: [[13, 2], [-8, 2]] },
];

/** The base area every start keeps clear: its own buildings and room to build around them (MAP-8). */
function baseZone(start: { tx: number; ty: number }): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: Math.max(1, start.tx - 4), y0: Math.max(1, start.ty - 4), x1: start.tx + 13, y1: start.ty + 13 };
}

/** The plan for the map of one seed, before any check (MAP-7). */
export function generatePlan(seed: number): MapPlan {
  const rng = new Rng((seed >>> 0) * 2654435761 + 0x5eed);
  const int = (lo: number, hi: number): number => lo + rng.int(hi - lo + 1);
  const chance = (pct: number): boolean => rng.int(100) < pct;
  const site = STARTS[rng.int(STARTS.length)]!;
  const start = site.start;
  const turn = chance(50);
  const zone = baseZone(start);

  // Keep-out shapes for new pieces: both base zones and every field, with their mirrors, so no mirrored piece lands on
  // the other side's base or field either.
  const keep: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const keepOut = (x0: number, y0: number, x1: number, y1: number): void => {
    keep.push({ x0, y0, x1, y1 }, { x0: C - x1, y0: C - y1, x1: C - x0, y1: C - y0 });
  };
  keepOut(zone.x0, zone.y0, zone.x1, zone.y1);
  const clear = (x0: number, y0: number, x1: number, y1: number): boolean =>
    x0 >= 1 && y0 >= 1 && x1 <= C - 1 && y1 <= C - 1 && keep.every((k) => x1 < k.x0 || x0 > k.x1 || y1 < k.y0 || y0 > k.y1);
  // Player 0's half: the side of the anti-diagonal through the centre that holds its start, with a margin so pieces and
  // their mirrors do not overlap.
  const mine = (x: number, y: number, r: number): boolean => x + y + r < C - 1;

  const fields: Field[] = site.home.map(([dx, dy], i) => ({ cx: start.tx + dx, cy: start.ty + dy, r: 2, amount: i === 0 ? 3000 : 2500 }));
  for (const f of fields) keepOut(f.cx - 3, f.cy - 3, f.cx + 3, f.cy + 3);
  const centre = chance(70) ? { r: 3 + rng.int(2) * 0.6, amount: 4000 + 500 * int(0, 4) } : { r: 0, amount: 0 };
  if (centre.amount > 0) keepOut(C / 2 - 5, C / 2 - 5, C / 2 + 5, C / 2 + 5);

  // Expansion fields in the open middle of the player's half, away from its base.
  const extra = int(1, 3);
  for (let tries = 0; fields.length < 2 + extra && tries < 200; tries++) {
    const cx = int(6, 88);
    const cy = int(6, 88);
    if (!mine(cx, cy, 4) || (cx - start.tx) ** 2 + (cy - start.ty) ** 2 < 22 * 22 || !clear(cx - 3, cy - 3, cx + 3, cy + 3)) continue;
    fields.push({ cx, cy, r: 2, amount: 2500 + 500 * int(0, 4) });
    keepOut(cx - 3, cy - 3, cx + 3, cy + 3);
  }

  // A river between the bases on some maps; otherwise lakes. Either way there is water between the bases (MAP-8).
  const river = chance(35);
  let water: MapPlan['water'];
  if (river) {
    const period = int(40, 70);
    const amp = int(3, 8);
    const half = int(2, 3) + 0.5;
    const ford = int(30, 42);
    water = (x, y) => {
      const along = x - y;
      const across = x + y - C;
      if (Math.abs(across - amp * zigzag(along, period)) > half) return false;
      // A land bridge at the centre and a ford toward each flank.
      if (Math.abs(along) <= 5 || Math.abs(Math.abs(along) - ford) <= 3) return false;
      return true;
    };
    // The crossings stay open.
    keepOut(C / 2 - 8, C / 2 - 8, C / 2 + 8, C / 2 + 8);
  }

  const place = (n: number, size: [number, number], list: Blob[], tries = 300): void => {
    for (let t = 0; list.length < n && t < tries; t++) {
      const rx = int(size[0], size[1]);
      const ry = int(size[0], size[1]);
      const cx = int(3, 92);
      const cy = int(3, 92);
      if (!mine(cx, cy, Math.max(rx, ry) + 2) || !clear(cx - rx - 1, cy - ry - 1, cx + rx + 1, cy + ry + 1)) continue;
      // Near the river only away from its crossings, so it is never dammed.
      if (river && Math.abs(cx + cy - C) < 14) continue;
      list.push({ cx, cy, rx, ry });
      // Pieces keep a lane between them, so they make chokepoints rather than walls.
      keepOut(cx - rx - 3, cy - ry - 3, cx + rx + 3, cy + ry + 3);
    }
  };
  const lakes: Blob[] = [];
  place(river ? int(0, 1) : int(1, 3), [2, 4], lakes);
  const rocks: Blob[] = [];
  place(int(4, 8), [2, 5], rocks);
  return { start, turn, rocks, lakes, fields, centre, water };
}

/** Tiles reachable over open ground (4-way steps) from a tile, as a flag per tile. */
function reachable(m: MapDef, from: number): Uint8Array {
  const seen = new Uint8Array(W * W);
  const blocked = m.blocked ?? [];
  if (blocked[from]) return seen;
  const queue = [from];
  seen[from] = 1;
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k]!;
    const x = i % W;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
      if (j < 0 || j >= W * W || seen[j] || blocked[j]) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  return seen;
}

/**
 * Whether a planned map is fair and playable (MAP-8), checked on the map before any quarter turn (which changes none of
 * this): it is its own mirror image; both base areas are open; the starts are joined by ground; every shard tile can be
 * reached from both starts, every planned field holds shards, and both sides hold the same shards; and there is water,
 * or a chokepoint, between the bases.
 */
export function checkPlan(plan: MapPlan): { ok: boolean; why: string } {
  const m = buildMap(plan);
  const blocked = m.blocked ?? [];
  const shards = m.shards ?? [];
  const mirror = (i: number): number => W * W - 1 - i;
  for (let i = 0; i < W * W; i++) {
    if (blocked[i] !== blocked[mirror(i)] || shards[i] !== shards[mirror(i)] || m.heights[i] !== m.heights[mirror(i)]) return { ok: false, why: 'not symmetric' };
  }
  const start = plan.start ?? DEFAULT_START;
  const z = baseZone(start);
  for (let y = z.y0; y <= z.y1; y++) for (let x = z.x0; x <= z.x1; x++) if (blocked[y * W + x]) return { ok: false, why: 'base area blocked' };
  const home = (start.ty + 1) * W + start.tx + 1;
  const seen = reachable(m, home);
  if (!seen[mirror(home)]) return { ok: false, why: 'starts not connected' };
  for (let i = 0; i < W * W; i++) if ((shards[i] as number) > 0 && !seen[i]) return { ok: false, why: 'shards out of reach' };
  for (const f of plan.fields) {
    let n = 0;
    for (let y = f.cy - f.r; y <= f.cy + f.r; y++) for (let x = f.cx - f.r; x <= f.cx + f.r; x++) if ((shards[y * W + x] as number) > 0) n++;
    if (n < 9) return { ok: false, why: 'field buried' };
  }
  // Water between the bases: open-ground-level blocked tiles at least 20 tiles from both starts.
  const far = (x: number, y: number): boolean => (x - start.tx) ** 2 + (y - start.ty) ** 2 >= 400 && (C - x - start.tx) ** 2 + (C - y - start.ty) ** 2 >= 400;
  let wet = 0;
  for (let i = 0; i < W * W; i++) if (blocked[i] && m.heights[i] === 0 && far(i % W, Math.floor(i / W))) wet++;
  if (wet >= 16) return { ok: true, why: '' };
  // Or a chokepoint: some line across the map between the bases where at most two thirds of the ground is open.
  for (let k = 40; k <= C * 2 - 40; k += 2) {
    let open = 0;
    let all = 0;
    for (let x = Math.max(0, k - C); x <= Math.min(C, k); x++) {
      all++;
      if (!blocked[(k - x) * W + x]) open++;
    }
    if (open * 3 <= all * 2) return { ok: true, why: '' };
  }
  return { ok: false, why: 'no water or chokepoint' };
}

const resolved = new Map<number, { seed: number; plan: MapPlan }>();

/**
 * The map for a seed (MAP-9): that seed's plan if it passes MAP-8, or else the first seed after it that passes, wrapping
 * at MAP_SEED_MAX. `seed` is the seed that produced the map, so entering it gives the same map.
 */
export function generatedMap(seed: number): { seed: number; plan: MapPlan } {
  const s0 = mapSeedOf(seed);
  const hit = resolved.get(s0);
  if (hit) return hit;
  let out: { seed: number; plan: MapPlan } | null = null;
  for (let k = 0; k < MAX_TRIES && !out; k++) {
    const s = (s0 + k) % MAP_SEED_MAX;
    const plan = generatePlan(s);
    if (checkPlan(plan).ok) out = { seed: s, plan };
  }
  if (!out) throw new Error(`no playable map within ${MAX_TRIES} seeds of ${s0}`);
  if (resolved.size > 64) resolved.clear();
  resolved.set(s0, out);
  return out;
}

/** The seed that produces the map for `seed` (MAP-9). */
export const resolveMapSeed = (seed: number): number => generatedMap(seed).seed;
