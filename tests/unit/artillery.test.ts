import { describe, expect, it } from 'vitest';
import { artilleryNeeded, chooseUnitKind, type Intel } from '../../src/ai/ai';

const intel = (squads: number, total: number): Intel => ({ air: 0, heavy: 1 - squads, light: squads, squads, total });
const counts = { inf: 4, at: 2, tank: 3, art: 3, air: 0, scout: 1 };
const cands = ['hum_rifleman', 'hum_tank', 'hum_artillery'];

describe('AI artillery against infantry', () => {
  it('AI-19: the floor is one artillery per four enemy infantry squads seen, at most four', () => {
    expect(artilleryNeeded(intel(1, 2))).toBe(0);
    expect(artilleryNeeded(intel(0, 10))).toBe(0);
    expect(artilleryNeeded(intel(0.3, 10))).toBe(0);
    expect(artilleryNeeded(intel(0.4, 10))).toBe(1);
    expect(artilleryNeeded(intel(0.8, 10))).toBe(2);
    expect(artilleryNeeded(intel(1, 12))).toBe(3);
    expect(artilleryNeeded(intel(1, 16))).toBe(4);
    expect(artilleryNeeded(intel(1, 40))).toBe(4);
  });

  it('AI-19: the artillery tilt grows with the infantry share, for every personality mix', () => {
    // An all-infantry enemy tips the choice to artillery; a mixed one of the same size does not.
    expect(chooseUnitKind(cands, counts, intel(1, 8))).toBe('hum_artillery');
    expect(chooseUnitKind(cands, counts, intel(0.1, 8))).not.toBe('hum_artillery');
    expect(chooseUnitKind(cands, counts, intel(1, 8), { tank: 0.2, art: 0.08, at: -0.06, inf: -0.16 })).toBe('hum_artillery');
    expect(chooseUnitKind(cands, counts, intel(1, 8), { inf: 0.12, scout: 0.06, tank: -0.04, art: -0.04 })).toBe('hum_artillery');
  });

  it('AI-19: no artillery is ordered when it is unavailable', () => {
    for (const sq of [0.5, 1]) expect(chooseUnitKind(['hum_rifleman', 'hum_tank'], { ...counts, art: 0 }, intel(sq, 16))).not.toBe('hum_artillery');
  });
});
