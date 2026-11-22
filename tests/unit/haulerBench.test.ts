import { describe, expect, it } from 'vitest';
import { idealHaulers, type HaulerKind } from '../../src/data/haulers';
import { measureIncome, type HaulerFaction } from './haulerBench';

/**
 * Re-measures a few cells of the ECO-10 table. The full sweep is `npm run bench:haulers`. A cell holds when a hauler
 * count within one of the table's still adds at least half a lone hauler's income, and the counts two and three above it do not.
 */
const CELLS: { faction: HaulerFaction; kind: HaulerKind; size: number; distance: number }[] = [
  { faction: 'human', kind: 'hum_hauler', size: 21, distance: 6 },
  { faction: 'alien', kind: 'ali_gorger', size: 44, distance: 8 },
  { faction: 'human', kind: 'hum_hauler', size: 80, distance: 2 },
];

describe('hauler bench', () => {
  for (const c of CELLS)
    it(`ECO-10: ${c.faction} haulers on a ${c.size} tile field ${c.distance} tiles from the pad measure within one of the table (${idealHaulers(c.kind, c.size, c.distance)})`, () => {
      const table = idealHaulers(c.kind, c.size, c.distance);
      const income = new Map<number, number>();
      const at = (k: number): number => {
        if (!income.has(k)) income.set(k, measureIncome(c.faction, c.size, c.distance, k));
        return income.get(k) as number;
      };
      const half = 0.5 * at(1);
      const adds = (k: number): boolean => at(k) - at(k - 1) >= half;
      expect([table - 1, table, table + 1].some(adds), 'a count within one of the table still pays').toBe(true);
      expect(adds(table + 2), `${table + 2} haulers`).toBe(false);
      expect(adds(table + 3), `${table + 3} haulers`).toBe(false);
    }, 60_000);
});
