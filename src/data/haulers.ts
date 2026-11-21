/**
 * Ideal hauler counts for one refinery (ECO-10): the largest number of haulers for which one more still raises income by
 * at least half a lone hauler's income. Measured by the deterministic bench in tests/unit/haulerBench.ts (npm run
 * bench:haulers): flat open ground, one refinery with its dock pad, a disc-shaped shard field east of it, income over
 * three minutes after a 30 second warm-up, shards per tile large enough that depletion never limits it.
 */

/** Hauler kinds in the table: the Shard Hauler (humans) and the Gorger (aliens). */
export type HaulerKind = 'hum_hauler' | 'ali_gorger';

export interface IdealTable {
  /** Field sizes measured, in tiles. */
  sizes: readonly number[];
  /** Distances measured, in tiles from the dock pad to the nearest shard tile of the field. */
  distances: readonly number[];
  /** counts[i][j]: ideal hauler count for a field of sizes[i] tiles at distances[j] tiles from the pad. */
  counts: readonly (readonly number[])[];
}

const SIZES = [13, 21, 44, 80] as const;
const DISTANCES = [2, 4, 6, 8, 10, 12] as const;

export const IDEAL_HAULERS: Record<HaulerKind, IdealTable> = {
  hum_hauler: {
    sizes: SIZES,
    distances: DISTANCES,
    counts: [
      [6, 8, 10, 12, 14, 16], // 13 tiles
      [5, 7, 9, 10, 12, 14], // 21 tiles
      [5, 7, 9, 11, 12, 14], // 44 tiles
      [6, 9, 11, 12, 14, 16], // 80 tiles
    ],
  },
  ali_gorger: {
    sizes: SIZES,
    distances: DISTANCES,
    counts: [
      [6, 8, 11, 12, 13, 14], // 13 tiles
      [5, 6, 8, 9, 11, 13], // 21 tiles
      [5, 6, 8, 10, 11, 13], // 44 tiles
      [7, 8, 9, 11, 12, 14], // 80 tiles
    ],
  },
};

/** The measured points around `v` in `xs` (ascending): its lower and upper neighbours, clamped to the ends. */
function bracket(xs: readonly number[], v: number): [number, number] {
  const last = xs.length - 1;
  if (v <= (xs[0] as number)) return [0, 0];
  if (v >= (xs[last] as number)) return [last, last];
  let i = 0;
  while ((xs[i + 1] as number) <= v) i++;
  return [i, i + 1];
}

/**
 * The ideal hauler count (ECO-10) for a field of `fieldTiles` tiles lying `padDistance` tiles from the dock pad. Between
 * measured points it interpolates linearly and rounds down, so the AI never overfills a field; outside them it takes
 * the nearest measured edge. At least 1.
 */
export function idealHaulers(kind: HaulerKind, fieldTiles: number, padDistance: number): number {
  const t = IDEAL_HAULERS[kind];
  const [i0, i1] = bracket(t.sizes, fieldTiles);
  const [j0, j1] = bracket(t.distances, padDistance);
  const sizeSpan = (t.sizes[i1] as number) - (t.sizes[i0] as number);
  const distSpan = (t.distances[j1] as number) - (t.distances[j0] as number);
  // Integer weights keep the value at a measured point exact: weight of the upper neighbour, out of the span.
  const wi = sizeSpan === 0 ? 0 : fieldTiles - (t.sizes[i0] as number);
  const wj = distSpan === 0 ? 0 : padDistance - (t.distances[j0] as number);
  const si = sizeSpan === 0 ? 1 : sizeSpan;
  const sj = distSpan === 0 ? 1 : distSpan;
  const at = (i: number, j: number): number => (t.counts[i] as readonly number[])[j] as number;
  const top = at(i0, j0) * (sj - wj) + at(i0, j1) * wj;
  const bottom = at(i1, j0) * (sj - wj) + at(i1, j1) * wj;
  return Math.max(1, Math.floor((top * (si - wi) + bottom * wi) / (si * sj)));
}
