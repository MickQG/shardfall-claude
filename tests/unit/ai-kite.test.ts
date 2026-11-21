import { describe, expect, it } from 'vitest';
import { cost } from './battle';
import { AEGIS_ARMY, kiteBench, overwhelmBench, STRAGGLE, VRAX_ARMY, WAVE_ARMY, type BenchResult } from './kiteBench';

/**
 * The kite and overwhelm scenarios (HAR-9, HAR-10; spec 033) on open ground, with the real Hard AI deciding from fog-limited
 * snapshots (see kiteBench.ts). Today's AI (before spec 033's AI-35..AI-42) measures, with the default seed (1), 90 s for the
 * kite variants and 60 s for the overwhelm scenario:
 *
 *   skimmer (Aegis AI, 18 units, 4100 credits, vs 4 Glare Skimmers at 3800)
 *     aiLost 4100 (the whole army dies, all 18 units), harasserLost 0, maxStray 12.96 tiles (13.0 to 15.2 on seeds 2, 3),
 *     everStraggled 13 of 18, retreats 0, counters 7..9. The skimmers lose nothing.
 *   bulwark (Vrax AI, 13 units, 3850 credits, vs 4 Bulwarks at 3200 using kiteOrders)
 *     aiLost 3630 of 3850, harasserLost 3200 (all four Bulwarks die), maxStray 13.57 tiles, everStraggled 12 of 13,
 *     1 unit alive at the end and 21.9 tiles from where it started, retreats 0, counters 7, heldBack 5.
 *   overwhelm (Aegis wave of 14 units, 3400 credits, vs 22 Vrax units at 7380)
 *     the wave sets out, meets the army, retreats once (retreats 1) and is still wiped out: survival 0 after 60 s
 *     (all 14 dead by 20 s), aiLost 3400, enemy lost 480, maxStray 18.0 tiles.
 *
 * The seed changes little: the numbers are the same to the credit on seeds 1 to 3, bar the skimmer stray.
 */

/** The pass marks of spec 033, to switch on once the AI changes land. HARASS_LEASH (8, AI-40) plus 4 tiles. */
const STRAY_LIMIT = 8 + 4;
const BASELINE = { skimmerAiLost: 4100, bulwarkAiLost: 3630 };

const memo = new Map<string, BenchResult>();
const once = (key: string, f: () => BenchResult): BenchResult => {
  if (!memo.has(key)) memo.set(key, f());
  return memo.get(key)!;
};
const skimmer = (): BenchResult => once('skimmer', () => kiteBench('skimmer'));
const bulwark = (): BenchResult => once('bulwark', () => kiteBench('bulwark'));
const overwhelm = (): BenchResult => once('overwhelm', () => overwhelmBench());

const army = (kinds: string[]): number => cost(kinds.reduce<Record<string, number>>((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {}));

/** The numbers that must be finite and in range whatever the AI does. */
const sane = (r: BenchResult, startCost: number, foeCost: number): void => {
  for (const v of [r.aiLost, r.foeLost, r.aiValueLeft, r.aiValueStart, r.maxStray, r.drift, r.survival, r.straggled, r.everStraggled]) expect(Number.isFinite(v)).toBe(true);
  expect(r.aiValueStart).toBeCloseTo(startCost, 6);
  expect(r.aiLost).toBeGreaterThanOrEqual(0);
  expect(r.aiLost).toBeLessThanOrEqual(startCost);
  expect(r.foeLost).toBeGreaterThanOrEqual(0);
  expect(r.foeLost).toBeLessThanOrEqual(foeCost);
  expect(r.survival).toBeGreaterThanOrEqual(0);
  expect(r.survival).toBeLessThanOrEqual(1);
  expect(r.aiUnitsEnd).toBeLessThanOrEqual(r.aiUnitsStart);
  expect(r.everStraggled).toBeLessThanOrEqual(r.aiUnitsStart);
};

describe('the kite scenario (HAR-9)', () => {
  it('HAR-9: Glare Skimmers harass an Aegis army on open ground: the bench runs, is deterministic, and reports value traded and stray', () => {
    const r = skimmer();
    sane(r, army(AEGIS_ARMY), 4 * 950);
    expect(r.aiUnitsStart).toBe(AEGIS_ARMY.length);
    expect(army(AEGIS_ARMY)).toBeGreaterThanOrEqual(4 * 950);
    // Same numbers twice.
    const again = kiteBench('skimmer');
    expect(again.hash).toBe(r.hash);
    expect({ ...again, stats: undefined }).toEqual({ ...r, stats: undefined });
    // The harassers did something: either side lost value, or the army moved.
    expect(r.aiLost + r.foeLost + r.drift).toBeGreaterThan(0);
  });

  it('HAR-9: Bulwark Tanks kite a Vrax army with HAR-7 kiteOrders: the bench runs, is deterministic, and reports value traded and stray', () => {
    const r = bulwark();
    sane(r, army(VRAX_ARMY), 4 * 800);
    expect(r.aiUnitsStart).toBe(VRAX_ARMY.length);
    expect(army(VRAX_ARMY)).toBeGreaterThanOrEqual(4 * 800);
    const again = kiteBench('bulwark');
    expect(again.hash).toBe(r.hash);
    expect({ ...again, stats: undefined }).toEqual({ ...r, stats: undefined });
    expect(r.aiLost + r.foeLost + r.drift).toBeGreaterThan(0);
  });

  it('HAR-9: today the harassers win: the Aegis army loses most of its value to Skimmers that lose none, and the Vrax army chases past 12 tiles', () => {
    const s = skimmer();
    expect(s.aiLost).toBeGreaterThan(0.5 * s.aiValueStart);
    expect(s.foeLost).toBeLessThan(0.5 * 4 * 950);
    const b = bulwark();
    expect(b.stats.heldBack).toBeGreaterThan(0);
    expect(b.everStraggled).toBeGreaterThan(0);
  });

  // The pass marks of spec 033 (HAR-9), for when the AI's discipline lands: remove `.skip`.
  it.skip('HAR-9 pass mark: against Glare Skimmers the AI loses less value than the baseline (4100) and strays at most HARASS_LEASH + 4 tiles from its army centre', () => {
    const r = skimmer();
    expect(r.aiLost).toBeLessThan(BASELINE.skimmerAiLost);
    expect(r.maxStray).toBeLessThanOrEqual(STRAY_LIMIT);
    expect(r.straggled).toBe(0);
  });

  it.skip('HAR-9 pass mark: against kiting Bulwarks the AI loses less value than the baseline (3630) and strays at most HARASS_LEASH + 4 tiles from its army centre', () => {
    const r = bulwark();
    expect(r.aiLost).toBeLessThan(BASELINE.bulwarkAiLost);
    expect(r.maxStray).toBeLessThanOrEqual(STRAY_LIMIT);
    expect(r.straggled).toBe(0);
  });
});

describe('the overwhelm scenario (HAR-10)', () => {
  it('HAR-10: an Aegis wave meets a Vrax army of about twice its power: the bench runs, is deterministic, and reports survival and retreats', () => {
    const r = overwhelm();
    sane(r, army(WAVE_ARMY), 7380);
    expect(r.aiValueStart / 7380).toBeLessThan(0.55);
    expect(r.aiValueStart / 7380).toBeGreaterThan(0.4);
    expect(r.stats.waves).toBeGreaterThanOrEqual(1);
    const again = overwhelmBench();
    expect(again.hash).toBe(r.hash);
    expect(again.survival).toBe(r.survival);
    expect(again.stats.retreats).toBe(r.stats.retreats);
  });

  it('HAR-10: today the wave is wiped out whatever it does: less than 40% survives after 60 s', () => {
    const r = overwhelm();
    expect(r.survival).toBeLessThan(0.4);
    expect(STRAGGLE).toBe(12);
  });

  // The pass mark of spec 033 (HAR-10), for when the AI retreats and regroups: remove `.skip`.
  it.skip('HAR-10 pass mark: the wave retreats and keeps at least 40% of its value after 60 s', () => {
    const r = overwhelm();
    expect(r.stats.retreats).toBeGreaterThanOrEqual(1);
    expect(r.survival).toBeGreaterThanOrEqual(0.4);
  });
});
