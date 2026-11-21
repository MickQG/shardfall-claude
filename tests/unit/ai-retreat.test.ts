import { describe, expect, it } from 'vitest';
import { BEATEN_MEMORY, DEFAULT_RULES } from '../../src/ai/ai';
import { chooseFallback, FALLBACK_AWAY, RETREAT_CLEAR, RETREAT_HOLD, RETREAT_HOP, retreatStep, type FightingRetreat } from '../../src/ai/retreat';
import { armyPower, canOutrun, DEFENCE_WEIGHT, FRESH_SIGHT, freshEnemyPower, isOverwhelmed, OVERWHELM_R, OVERWHELM_RATIO, unitPower } from '../../src/ai/strength';
import { buildingDef, unitDef } from '../../src/data/defs';
import { FP, maxHpOf, type Game } from '../../src/sim';
import { ai, base, centreOf, LONG, many, reinforce, run, runUntil, teleport, tile, type Foe } from './aiWaveBench';

/**
 * Judging strength, retreat and regroup (AI-35 to AI-38): the pure rules (strength.ts, retreat.ts) and the AI on the wave
 * bench (aiWaveBench.ts: a small human base on seed 6, its army at its staging point, what it sees put in its snapshot).
 */

const FAR: Foe = { kind: 'ali_skitter', tx: 80, ty: 20 };
/** The wave has driven well out, beyond the reach of its base's recall (AI-23 c): where it stands now. */
const out = (g: Game, wave: readonly number[]): { x: number; y: number } => {
  teleport(g, wave, 45, 45);
  for (const u of g.state.units) if (wave.includes(u.id)) {
    u.x += (wave.indexOf(u.id) % 3) * FP;
    u.y += Math.floor(wave.indexOf(u.id) / 3) * FP;
  }
  return centreOf(g, wave);
};
const at = (x: number, y: number) => ({ kind: 'ali_brute', x: x * FP, y: y * FP, t: 0 });

describe('judging strength (AI-35)', () => {
  it('AI-35: a unit counts its cost scaled by its health over its real maximum health, and a ranked unit counts for more than a fresh one', () => {
    const tank = unitDef('hum_tank');
    expect(unitPower('hum_tank', tank.hp, 0)).toBeCloseTo(tank.cost);
    expect(unitPower('hum_tank', tank.hp / 2, 0)).toBeCloseTo(tank.cost / 2);
    // Rank 2: 20% more health and damage (VET-2); at full health it counts for more than a fresh tank.
    const full2 = unitPower('hum_tank', maxHpOf('hum_tank', 2), 2);
    expect(full2).toBeGreaterThan(1.2 * tank.cost);
    // A ranked unit at the fresh unit's health is not at full health: its share counts against its real maximum.
    expect(unitPower('hum_tank', tank.hp, 2) / full2).toBeCloseTo(tank.hp / maxHpOf('hum_tank', 2));
    expect(armyPower([{ kind: 'hum_tank', hp: tank.hp }, { kind: 'hum_tank', hp: maxHpOf('hum_tank', 2), rank: 2 }])).toBeCloseTo(tank.cost + full2);
  });

  it('AI-35: the enemy force near a group counts enemy units seen in the last 10 seconds, at their health when seen, and defences at 1.5 times their cost', () => {
    expect([FRESH_SIGHT, DEFENCE_WEIGHT]).toEqual([200, 1.5]);
    const brute = unitDef('ali_brute');
    const now = 5000;
    const seen = [
      { ...at(10, 10), t: now - 150 },
      { ...at(11, 10), t: now - FRESH_SIGHT - 1 }, // too old
      { ...at(30, 30), t: now }, // too far
      { ...at(10, 11), t: now, hp: brute.hp / 2, rank: 0 },
      { kind: 'ali_gorger', x: 10 * FP, y: 12 * FP, t: now }, // a hauler carries no weapon
    ];
    expect(freshEnemyPower(seen, [], now, 10, 10, OVERWHELM_R)).toBeCloseTo(brute.cost * 1.5);
    const spire = { kind: 'ali_spire', tx: 12, ty: 12 };
    expect(freshEnemyPower([], [spire], now, 10, 10, OVERWHELM_R)).toBeCloseTo(buildingDef('ali_spire').cost * DEFENCE_WEIGHT);
  });
});

describe('overwhelmed (AI-36)', () => {
  it('AI-36: a group is overwhelmed when the enemy power within 11 tiles is at least 1.5 times its own, its own defences counting on its side', () => {
    expect([OVERWHELM_R, OVERWHELM_RATIO]).toEqual([11, 1.5]);
    expect(isOverwhelmed(1000, 0, 1500)).toBe(true);
    expect(isOverwhelmed(1000, 0, 1499)).toBe(false);
    expect(isOverwhelmed(1000, 500, 1500)).toBe(false);
    expect(isOverwhelmed(1000, 0, 0)).toBe(false);
    expect([DEFAULT_RULES.overwhelm, DEFAULT_RULES.regroup]).toEqual([true, true]);
  });

  it('AI-36: a wave meeting an enemy of twice its power retreats instead of fighting on; one meeting an equal enemy fights on', () => {
    const go = (brutes: number) => {
      const g = base({ army: many('hum_tank', 6) });
      const who = ai();
      runUntil(g, who, 400, () => who.stats.waves > 0, [FAR]);
      expect(who.stats.waves).toBe(1);
      const wave = [...who.waveState!.members];
      const c = out(g, wave);
      const foes: Foe[] = [...Array(brutes)].map((_, i) => ({ kind: 'ali_brute', tx: Math.floor(c.x) + 5 + (i % 3), ty: Math.floor(c.y) + 5 + Math.floor(i / 3) }));
      run(g, who, 16, [FAR, ...foes]);
      return { who, wave };
    };
    // Six Bulwarks (4800) against twelve Brutes (9960).
    const big = go(12);
    expect(big.who.waveState).toBeNull();
    expect(big.who.stats.retreats).toBe(1);
    expect(big.who.retreatState[0]!.members).toEqual(expect.arrayContaining(big.wave));
    // Against six (4980): fights on.
    const even = go(6);
    expect(even.who.waveState).not.toBeNull();
    expect(even.who.stats.retreats).toBe(0);
  }, LONG);

  it('AI-36: standing units answering an attack (AI-34) retreat when overwhelmed, and so does the army pulled home by base defence (AI-7)', () => {
    // Six rifle squads at the staging point (one hurt, 580) hit by four Spitters (880): overwhelmed.
    const g = base({ army: many('hum_rifleman', 6) });
    const who = ai();
    const fog: Foe[] = [...Array(8)].map((_, i) => ({ kind: 'ali_brute', tx: 70 + (i % 4), ty: 40 + Math.floor(i / 4) }));
    run(g, who, 8, fog);
    const ids = g.state.units.filter((u) => u.owner === 0 && u.kind === 'hum_rifleman').map((u) => u.id);
    g.state.units.find((u) => u.id === ids[2])!.hp -= 20;
    const spitters: Foe[] = [26, 27].flatMap((x) => [22, 23].map((y) => ({ kind: 'ali_spitter', tx: x, ty: y })));
    run(g, who, 8, [...spitters, ...fog]);
    expect(who.stats.withdrawals).toBe(1);
    expect(who.retreatState[0]!.members).toEqual(expect.arrayContaining(ids));

    // Base defence: twelve Brutes by its refinery against six Bulwarks: it does not attack-move into them, it falls back.
    const home = (brutes: number) => {
      const b = base({ army: many('hum_tank', 6) });
      const w = ai();
      const raid: Foe[] = [...Array(brutes)].map((_, i) => ({ kind: 'ali_brute', tx: 16 + (i % 4), ty: 13 + Math.floor(i / 4) }));
      const log = run(b, w, 8, [...raid, ...fog]);
      return { w, log };
    };
    const big = home(12);
    expect(big.w.stats.defends).toBe(1);
    expect(big.log.some((c) => c.type === 'attackmove' && Math.hypot(tile(c.x) - 17.5, tile(c.y) - 14.5) < 4)).toBe(false);
    // Not overwhelmed (two Brutes): it attacks as before.
    const small = home(2);
    expect(small.w.stats.defends).toBe(1);
    expect(small.w.retreatState).toEqual([]);
    expect(small.log.some((c) => c.type === 'attackmove')).toBe(true);
  }, LONG);
});

describe('retreat (AI-37)', () => {
  const group = { x: 30, y: 30 };
  const enemy = { x: 40, y: 40 };
  const baseAt = { x: 12, y: 12 };

  it('AI-37: it falls back to the nearest friendly strength: the staging point while units gather there, else its nearest defence, else the base', () => {
    const staging = { x: 20, y: 20 };
    expect(chooseFallback(group, enemy, { staging, defences: [{ x: 15, y: 25 }], base: baseAt })).toEqual({ at: staging, kind: 'staging' });
    // Nothing gathering at the staging point: the nearest defence that lies away from the enemy.
    expect(chooseFallback(group, enemy, { staging: null, defences: [{ x: 15, y: 25 }, { x: 22, y: 26 }, { x: 45, y: 45 }], base: baseAt })).toEqual({ at: { x: 22, y: 26 }, kind: 'defence' });
    expect(chooseFallback(group, enemy, { staging: null, defences: [], base: baseAt })).toEqual({ at: baseAt, kind: 'base' });
    // A point closer than FALLBACK_AWAY tiles, or nearer the enemy, is no refuge; the base is the last resort.
    expect(FALLBACK_AWAY).toBe(6);
    expect(chooseFallback(group, enemy, { staging: { x: 32, y: 31 }, defences: [{ x: 50, y: 50 }], base: { x: 33, y: 33 } })).toBeNull();
    expect(chooseFallback(group, enemy, { staging: null, defences: [], base: { x: 33, y: 33 }, lastResort: true })).toEqual({ at: { x: 33, y: 33 }, kind: 'base' });
  });

  it('AI-37: it can outrun the enemy only when its slowest unit is faster than their fastest', () => {
    expect(canOutrun([{ kind: 'hum_tank' }], [{ kind: 'ali_brute' }])).toBe(true);
    expect(canOutrun([{ kind: 'hum_tank' }, { kind: 'hum_rifleman' }], [{ kind: 'ali_brute' }])).toBe(false);
    expect(canOutrun([{ kind: 'hum_rifleman' }], [{ kind: 'ali_spitter' }])).toBe(false);
  });

  it('AI-37: a fighting retreat hops about 3 tiles, holds its concave about a second, and hops again; it stops at friendly strength or after 3 s with no enemy near', () => {
    expect([RETREAT_HOP, RETREAT_HOLD, RETREAT_CLEAR]).toEqual([3, 20, 60]);
    const to = { x: 10, y: 30 };
    const s: FightingRetreat = { phase: 'hop', since: 0, hop: { x: 27, y: 30 }, lastNear: 0 };
    expect(retreatStep(s, 8, { x: 29, y: 30 }, to, true)).toBeNull();
    expect(retreatStep(s, 16, { x: 27.2, y: 30 }, to, true)).toEqual({ act: 'hold' });
    expect(retreatStep(s, 24, { x: 27.2, y: 30 }, to, true)).toBeNull();
    const hop = retreatStep(s, 36, { x: 27, y: 30 }, to, true);
    expect(hop).toEqual({ act: 'hop', to: { x: 24, y: 30 } });
    // At friendly strength: done.
    expect(retreatStep({ ...s }, 40, { x: 12, y: 30 }, to, true)).toEqual({ act: 'done' });
    // No enemy near for RETREAT_CLEAR ticks: done.
    const quiet: FightingRetreat = { phase: 'hold', since: 100 + RETREAT_CLEAR - 5, hop: { x: 20, y: 30 }, lastNear: 100 };
    expect(retreatStep(quiet, 100 + RETREAT_CLEAR - 1, { x: 20, y: 30 }, to, false)).toBeNull();
    expect(retreatStep(quiet, 100 + RETREAT_CLEAR, { x: 20, y: 30 }, to, false)).toEqual({ act: 'done' });
  });

  it('AI-37: an overwhelmed group that can outrun the enemy runs with a plain move; one that cannot makes a fighting retreat in hops', () => {
    const play = (army: string[], attackers: Foe[]) => {
      const g = base({ army });
      const who = ai();
      const fog: Foe[] = [...Array(8)].map((_, i) => ({ kind: 'ali_brute', tx: 70 + (i % 4), ty: 40 + Math.floor(i / 4) }));
      run(g, who, 8, fog);
      const ids = g.state.units.filter((u) => u.owner === 0 && unitDef(u.kind).weapon).map((u) => u.id);
      g.state.units.find((u) => u.id === ids[0])!.hp -= 30;
      const log = run(g, who, 8, [...attackers, ...fog]);
      return { who, ids, log };
    };
    // Bulwarks (speed 42) against Brutes (38): they run all the way.
    const brutes: Foe[] = [...Array(5)].map((_, i) => ({ kind: 'ali_brute', tx: 24 + (i % 3), ty: 24 + Math.floor(i / 3) }));
    const run1 = play(many('hum_tank', 3), brutes);
    expect(run1.who.retreatState).toEqual([expect.objectContaining({ fighting: false })]);
    const r = run1.who.retreatState[0]!;
    expect(run1.log.some((c) => c.type === 'move' && Math.hypot(tile(c.x) - r.to.x, tile(c.y) - r.to.y) <= 1)).toBe(true);
    expect(run1.who.stats.fightingRetreats).toBe(0);
    // Rifle squads (28) against Spitters (29): a fighting retreat, its first hop about 3 tiles toward the fallback point.
    const spitters: Foe[] = [26, 27].flatMap((x) => [22, 23].map((y) => ({ kind: 'ali_spitter', tx: x, ty: y })));
    const fight = play(many('hum_rifleman', 6), spitters);
    expect(fight.who.retreatState).toEqual([expect.objectContaining({ fighting: true })]);
    expect(fight.who.stats.fightingRetreats).toBe(1);
    const hop = fight.log.find((c) => c.type === 'move' && fight.ids.every((id) => c.units.includes(id)));
    expect(hop).toBeDefined();
    if (hop?.type === 'move') expect(Math.hypot(tile(hop.x) - 20.5, tile(hop.y) - 20)).toBeLessThanOrEqual(RETREAT_HOP + 2);
  }, LONG);

  it('AI-37: a beaten wave falls back to the staging point when reinforcements gather there', () => {
    const g = base({ army: many('hum_tank', 6) });
    const who = ai();
    runUntil(g, who, 400, () => who.stats.waves > 0, [FAR]);
    const wave = [...who.waveState!.members];
    // It has driven well out; three fresh Bulwarks stand at the staging point.
    teleport(g, wave, 45, 45);
    for (const u of g.state.units) if (wave.includes(u.id)) u.x += (wave.indexOf(u.id) % 3) * FP;
    reinforce(g, 'hum_tank', 2);
    const foes: Foe[] = [...Array(12)].map((_, i) => ({ kind: 'ali_brute', tx: 50 + (i % 3), ty: 50 + Math.floor(i / 3) }));
    run(g, who, 16, [FAR, ...foes]);
    expect(who.stats.retreats).toBe(1);
    const r = who.retreatState.find((x) => wave.every((id) => x.members.includes(id)));
    expect(r?.kind).toBe('staging');
  }, LONG);
});

describe('regroup (AI-38)', () => {
  it('AI-38: a beaten wave regroups at its fallback point with no 1200-tick cooldown; the strength that beat it is remembered and fades as its intel ages', () => {
    const play = (regroup: boolean) => {
      const g = base({ army: many('hum_tank', 6) });
      const who = ai('balanced', { regroup });
      runUntil(g, who, 400, () => who.stats.waves > 0, [FAR]);
      const wave = [...who.waveState!.members];
      const c = out(g, wave);
      const foes: Foe[] = [...Array(12)].map((_, i) => ({ kind: 'ali_brute', tx: Math.floor(c.x) + 5 + (i % 3), ty: Math.floor(c.y) + 5 + Math.floor(i / 3) }));
      run(g, who, 16, [FAR, ...foes]);
      expect(who.stats.retreats).toBe(1);
      const beatenAt = g.state.tick;
      // A big army stands ready at once, the Brutes long out of sight.
      reinforce(g, 'hum_tank', 30);
      for (const s of who.sightings.values()) (s as { t: number }).t = -100000;
      runUntil(g, who, 1400, () => who.stats.waves > 1, [FAR]);
      return { who, g, wave: g.state.tick - beatenAt };
    };
    const on = play(true);
    expect(on.who.stats.regroups).toBe(1);
    expect(on.who.stats.waves).toBe(2);
    expect(on.wave).toBeLessThan(1200);
    const off = play(false);
    expect(off.who.stats.regroups).toBe(0);
    expect(off.wave).toBeGreaterThanOrEqual(1200 - 16);
  }, LONG);

  it('AI-38: the next wave waits for an army that beats the remembered strength, and its army gathers at the fallback point meanwhile', () => {
    const g = base({ army: many('hum_tank', 6) });
    const who = ai();
    runUntil(g, who, 400, () => who.stats.waves > 0, [FAR]);
    const wave = [...who.waveState!.members];
    const c = out(g, wave);
    const foes: Foe[] = [...Array(12)].map((_, i) => ({ kind: 'ali_brute', tx: Math.floor(c.x) + 5 + (i % 3), ty: Math.floor(c.y) + 5 + Math.floor(i / 3) }));
    run(g, who, 16, [FAR, ...foes]);
    const mem = who.regroupState(g.state.tick)!;
    expect(mem.power).toBeGreaterThan(0.95 * 12 * unitDef('ali_brute').cost);
    expect(mem.at).not.toBeNull();
    // The memory fades as intel ages, to nothing after BEATEN_MEMORY ticks.
    expect(who.regroupState(g.state.tick + BEATEN_MEMORY / 2)!.power).toBeCloseTo(mem.power / 2, -2);
    expect(who.regroupState(g.state.tick + BEATEN_MEMORY)!.power).toBe(0);
    // Four fresh Bulwarks (3200) with the wave's six back are not enough against it, even with the Brutes' sightings gone.
    for (const s of who.sightings.values()) (s as { t: number }).t = -100000;
    const fresh = reinforce(g, 'hum_tank', 4);
    const log = run(g, who, 400, [FAR]);
    expect(who.stats.waves).toBe(1);
    // They gather at the fallback point, not the staging point.
    const at0 = mem.at!;
    expect(log.some((cmd) => (cmd.type === 'attackmove' || cmd.type === 'move') && cmd.units.some((id) => fresh.includes(id)) && Math.hypot(tile(cmd.x) - at0.tx - 0.5, tile(cmd.y) - at0.ty - 0.5) <= 3)).toBe(true);
  }, LONG);
});
