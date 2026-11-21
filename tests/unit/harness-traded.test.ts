import { describe, expect, it } from 'vitest';
import { DIFFICULTIES } from '../../src/ai/ai';
import { playMatch } from '../../src/ai/harness';
import { unitDef } from '../../src/data/defs';
import { battle, cost, rounds } from './battle';

describe('value traded (HAR-8)', () => {
  it('HAR-8: the battle harness reports the cost each side lost, in credits, beside the percentages', () => {
    const a = { hum_tank: 4 };
    const b = { ali_brute: 4 };
    for (const seat of [0, 1] as const) {
      const r = battle(a, b, seat);
      // Whole units only, never more than the army cost, and the loser lost everything.
      expect(r.aCostLost % unitDef('hum_tank').cost).toBe(0);
      expect(r.bCostLost % unitDef('ali_brute').cost).toBe(0);
      expect(r.aCostLost).toBeLessThanOrEqual(cost(a));
      expect(r.bCostLost).toBeLessThanOrEqual(cost(b));
      expect(r.aCostLost + r.bCostLost).toBeGreaterThan(0);
      // The side wiped out lost its whole cost; a side that lost nothing has no percent lost either.
      for (const [lost, pct, total] of [[r.aCostLost, r.aLost, cost(a)], [r.bCostLost, r.bLost, cost(b)]] as const) {
        if (pct >= 100) expect(lost).toBe(total);
        if (lost === 0) expect(pct).toBeLessThan(100);
        expect(lost / total).toBeLessThanOrEqual(1);
      }
    }
    // Over the standard rounds both numbers are reported and finite.
    for (const r of rounds(a, b)) {
      expect(Number.isFinite(r.aCostLost) && Number.isFinite(r.bCostLost)).toBe(true);
      expect(r.aCostLost + r.bCostLost).toBeGreaterThan(0);
    }
  }, 60_000);

  it('HAR-8: the match harness reports, per AI, the cost of its units and buildings lost and of the enemy\'s it destroyed', () => {
    const r = playMatch({ seed: 1, factions: ['human', 'alien'], difficulties: [DIFFICULTIES.hard, DIFFICULTIES.hard], maxTicks: 3000 });
    const [t0, t1] = r.traded;
    // What one side lost is what the other destroyed.
    expect(t0.destroyed).toBe(t1.lost);
    expect(t1.destroyed).toBe(t0.lost);
    for (const t of r.traded) {
      expect(t.lost).toBe(t.lostUnits + t.lostBuildings);
      for (const v of [t.lostUnits, t.lostBuildings, t.lost, t.destroyed]) expect(Number.isFinite(v) && v >= 0).toBe(true);
    }
    // The per-AI reactions are in the result too.
    for (const s of r.ai) expect(Number.isFinite(s.retreats) && Number.isFinite(s.defends)).toBe(true);
  }, 60_000);
});
