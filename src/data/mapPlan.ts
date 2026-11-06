import type { MapDef } from '../sim';

/**
 * How a skirmish map is built (MAP-2, MAP-4): one half is described as a plan of rocks, lakes and shard fields, and
 * mirrored through the map centre. Shared by the hand-made maps and the map generator (MAP-7).
 */
export const MAP_SIZE = 96;

/** Player 0's start (its HQ's top-left tile) unless a map says otherwise: the top corner in the isometric view. */
export const DEFAULT_START = { tx: 10, ty: 10 } as const;

export interface Blob {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface Field {
  cx: number;
  cy: number;
  r: number;
  amount: number;
}

/**
 * One half of a point-symmetric map (MAP-4): every rock, lake and field listed is mirrored through the map centre, so
 * both players get the same ground. `water` adds a per-tile shape that must be point-symmetric itself.
 */
export interface MapPlan {
  rocks: Blob[];
  lakes: Blob[];
  fields: Field[];
  /** Shards in the disc of radius `r` around the exact centre; amount 0 for none. */
  centre: { r: number; amount: number };
  /** Extra water. */
  water?: (x: number, y: number) => boolean;
  /** Player 0's HQ tile, with the base laid out toward +x and +y from it; player 1 mirrors it. DEFAULT_START otherwise. */
  start?: { tx: number; ty: number };
  /**
   * Turn the whole map, bases included, a quarter turn about its centre, (x, y) to (W - 1 - y, x): in the isometric view
   * the top and bottom corners become the right and left ones (MAP-6).
   */
  turn?: boolean;
}

/** A tile turned a quarter about the map centre (MapPlan.turn). */
const turnTile = (x: number, y: number): [number, number] => [MAP_SIZE - 1 - y, x];

/** The same map turned a quarter about its centre (MapPlan.turn); still point-symmetric. */
export function turnMap(m: MapDef): MapDef {
  const W = MAP_SIZE;
  const out = (a: readonly number[]): number[] => {
    const r = new Array<number>(W * W).fill(0);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const [nx, ny] = turnTile(x, y);
        r[ny * W + nx] = a[y * W + x] as number;
      }
    return r;
  };
  return { width: W, height: W, heights: out(m.heights), blocked: out(m.blocked ?? []), shards: out(m.shards ?? []) };
}

export function buildMap(plan: MapPlan): MapDef {
  const W = MAP_SIZE;
  const heights = new Array<number>(W * W).fill(0);
  const blocked = new Array<number>(W * W).fill(0);
  const shards = new Array<number>(W * W).fill(0);
  const set = (x: number, y: number, rock: number): void => {
    if (x < 0 || y < 0 || x >= W || y >= W) return;
    const i = y * W + x;
    heights[i] = Math.max(heights[i] as number, rock);
    blocked[i] = 1;
  };
  for (const b of plan.rocks) {
    for (let y = b.cy - b.ry; y <= b.cy + b.ry; y++) {
      for (let x = b.cx - b.rx; x <= b.cx + b.rx; x++) {
        const d = ((x - b.cx) / (b.rx + 0.5)) ** 2 + ((y - b.cy) / (b.ry + 0.5)) ** 2;
        if (d > 1) continue;
        const h = d < 0.45 ? 2 : 1;
        set(x, y, h);
        set(W - 1 - x, W - 1 - y, h);
      }
    }
  }
  // A crest (level 2) needs rock all round it, so rock always steps down one level at a time to open ground.
  const crest = heights.slice();
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      if (crest[y * W + x] !== 2) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < W && !crest[ny * W + nx]) heights[y * W + x] = 1;
        }
      }
    }
  }
  // Water is blocked ground at level 0; it never replaces rock.
  const wet = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= W || y >= W) return;
    const i = y * W + x;
    if ((heights[i] as number) > 0) return;
    blocked[i] = 1;
  };
  for (const b of plan.lakes) {
    for (let y = b.cy - b.ry; y <= b.cy + b.ry; y++) {
      for (let x = b.cx - b.rx; x <= b.cx + b.rx; x++) {
        // A rounder, slightly uneven outline than the rocks.
        const wobble = 0.12 * Math.sin(x * 1.7 + y * 0.9);
        const d = ((x - b.cx) / (b.rx + 0.5)) ** 2 + ((y - b.cy) / (b.ry + 0.5)) ** 2;
        if (d > 1 + wobble) continue;
        wet(x, y);
        wet(W - 1 - x, W - 1 - y);
      }
    }
  }
  if (plan.water) for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (plan.water(x, y)) wet(x, y);
  // Shards lie on open ground only, never under rock or water.
  const shard = (i: number, amount: number): void => {
    if (!blocked[i]) shards[i] = amount;
  };
  for (const f of plan.fields) {
    for (let y = f.cy - f.r; y <= f.cy + f.r; y++) {
      for (let x = f.cx - f.r; x <= f.cx + f.r; x++) {
        if ((x - f.cx) ** 2 + (y - f.cy) ** 2 > f.r * f.r + 1) continue;
        shard(y * W + x, f.amount);
        shard((W - 1 - y) * W + (W - 1 - x), f.amount);
      }
    }
  }
  // The centre field is a disc around the map's exact centre (47.5, 47.5), so it is point-symmetric.
  const c = (W - 1) / 2;
  const r = plan.centre.r;
  if (plan.centre.amount > 0) for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if ((x - c) ** 2 + (y - c) ** 2 <= r * r) shard(y * W + x, plan.centre.amount);
  return { width: W, height: W, heights, blocked, shards };
}

