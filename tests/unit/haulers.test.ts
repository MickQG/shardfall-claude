import { describe, expect, it } from 'vitest';
import { idealHaulers, IDEAL_HAULERS, type HaulerKind } from '../../src/data/haulers';

const KINDS: HaulerKind[] = ['hum_hauler', 'ali_gorger'];

describe('ideal hauler counts', () => {
  it('ECO-10: the lookup returns the measured table at every measured field size and pad distance', () => {
    for (const kind of KINDS) {
      const t = IDEAL_HAULERS[kind];
      t.sizes.forEach((n, i) => t.distances.forEach((d, j) => expect(idealHaulers(kind, n, d), `${kind} ${n}/${d}`).toBe((t.counts[i] as readonly number[])[j])));
    }
  });

  it('ECO-10: between measured points the lookup rounds down, never above the larger neighbour, and a farther pad never wants fewer haulers', () => {
    for (const kind of KINDS) {
      const t = IDEAL_HAULERS[kind];
      for (let n = 13; n <= 80; n++) {
        let prev = 0;
        for (let d = 2; d <= 12; d += 0.5) {
          const v = idealHaulers(kind, n, d);
          expect(v, `${kind} ${n}/${d}`).toBeGreaterThanOrEqual(prev);
          expect(v).toBeGreaterThanOrEqual(1);
          expect(v).toBeLessThanOrEqual(Math.max(...t.counts.flat()));
          prev = v;
        }
      }
      // Half way along a row is between the two measured values, rounded down.
      const a = (t.counts[1] as readonly number[])[1] as number;
      const b = (t.counts[1] as readonly number[])[2] as number;
      expect(idealHaulers(kind, 21, 5)).toBe(Math.floor((a + b) / 2));
    }
  });

  it('ECO-10: outside the measured range the lookup takes the nearest measured edge', () => {
    for (const kind of KINDS) {
      const t = IDEAL_HAULERS[kind];
      expect(idealHaulers(kind, 5, 0)).toBe((t.counts[0] as readonly number[])[0]);
      expect(idealHaulers(kind, 500, 40)).toBe((t.counts[3] as readonly number[])[5]);
    }
  });

  it('ECO-10: a lone hauler is far from enough: every measured cell wants at least five haulers on a refinery', () => {
    for (const kind of KINDS) for (const row of IDEAL_HAULERS[kind].counts) for (const v of row) expect(v).toBeGreaterThanOrEqual(5);
  });
});
