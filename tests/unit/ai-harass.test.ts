import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../../src/ai/ai';
import { catchers, CHASE_RATIO, effectiveSpeed, KITE_DUTY, HARASS_LEASH, HARASS_PATIENCE, HARASS_R, harassAnswer, isHarasser, KITE_WINDOW, KiteWatch, leashed, mainUnits, type Seen } from '../../src/ai/harass';
import { unitDef } from '../../src/data/defs';
import { FP, type Command } from '../../src/sim';
import { ai, base, LONG, many, run, tile, type Foe } from './aiWaveBench';

/**
 * Harassment (AI-39, AI-40): the pure rules in harass.ts, and the AI's standing army on the wave bench (aiWaveBench.ts:
 * a small human base on seed 6, its army at its staging point; what it sees is put into its snapshot).
 */

const seen = (id: number, kind: string, x: number, y: number, target = -1): Seen => ({ id, kind, x: x * FP, y: y * FP, hp: unitDef(kind).hp, target });
const own = (kind: string, n: number) => [...Array(n)].map(() => ({ kind, x: 0, y: 0, hp: unitDef(kind).hp }));

describe('harassers (AI-39)', () => {
  it('AI-39: a weaker enemy group that out-ranges the units making up most of the army is a harasser: Glare Skimmers against Bulwarks', () => {
    expect([HARASS_R, KITE_WINDOW]).toEqual([12, 60]);
    const skimmers = [seen(1, 'ali_skimmer', 10, 10), seen(2, 'ali_skimmer', 11, 10)];
    expect(isHarasser(skimmers, own('hum_tank', 6), () => false)).toBe(true);
    // As strong as the army or stronger: a real fight.
    expect(isHarasser(skimmers, own('hum_tank', 2), () => false)).toBe(false);
    // Out-ranging the army's few rifle squads does not count when Hammer artillery is most of its power.
    expect(mainUnits([...own('hum_artillery', 3), ...own('hum_rifleman', 3)]).every((u) => u.kind === 'hum_artillery')).toBe(true);
    expect(isHarasser(skimmers, [...own('hum_artillery', 3), ...own('hum_rifleman', 3)], () => false)).toBe(false);
  });

  it('AI-39: a smaller army that merely has the longer guns and stands its ground is no harasser; one that kites, or Skimmers that fire on the move, is', () => {
    // Bulwarks and rifles out-range Brutes by far, but standing and shooting is a real fight (judged by AI-36).
    const aegis = [seen(1, 'hum_tank', 10, 10, 50), seen(2, 'hum_tank', 11, 10, 50), seen(3, 'hum_rifleman', 10, 11, 50)];
    expect(isHarasser(aegis, own('ali_brute', 6), () => false)).toBe(false);
    // The same group kiting is a harasser.
    expect(isHarasser(aegis, own('ali_brute', 6), (id) => id === 1)).toBe(true);
    // Skimmers fire on the move (SKM-3): out-ranging is enough.
    expect(isHarasser([seen(4, 'ali_skimmer', 10, 10)], own('hum_tank', 6), () => false)).toBe(true);
  });

  it('AI-39: kiting is the enemy unit’s own move away while firing; the AI’s units backing off from one that stands and fires is no kiting', () => {
    const watch = new KiteWatch();
    // A Bulwark stands at 15,10 firing; the AI's unit backs off from 10,10 to 8,10.
    watch.see(100, [seen(1, 'hum_tank', 15, 10, 77)], [{ x: 10 * FP, y: 10 * FP }]);
    watch.see(108, [seen(1, 'hum_tank', 15, 10, 77)], [{ x: 8 * FP, y: 10 * FP }]);
    expect(watch.kited(1, 108)).toBe(false);
  });

  it('AI-39: a faster group that moved away while firing in the last 3 seconds is a harasser (Bulwarks kiting Brutes); one merely turning away is not', () => {
    const watch = new KiteWatch();
    const army = [{ x: 10 * FP, y: 10 * FP }];
    // Bulwarks firing (they have a target) as they back off from the Brutes.
    watch.see(100, [seen(1, 'hum_tank', 15, 10, 77), seen(2, 'hum_tank', 15, 12)], army);
    watch.see(108, [seen(1, 'hum_tank', 15.5, 10, 77), seen(2, 'hum_tank', 15.5, 12)], army);
    expect(watch.kited(1, 108)).toBe(true);
    // The other drove away without firing: turning away, not kiting.
    expect(watch.kited(2, 108)).toBe(false);
    // Firing while closing in is not kiting either.
    watch.see(116, [seen(3, 'hum_tank', 15, 14, 77)], army);
    watch.see(124, [seen(3, 'hum_tank', 14, 14, 77)], army);
    expect(watch.kited(3, 124)).toBe(false);
    // It ages out after KITE_WINDOW ticks.
    expect(watch.kited(1, 108 + KITE_WINDOW + 1)).toBe(false);
    // A Vrax army whose power is mostly Skimmers (range 9, speed 40): the Bulwarks (range 6, speed 42) do not out-range
    // it, so they are harassers only while kiting.
    const vrax = [...own('ali_brute', 3), ...own('ali_skimmer', 3)];
    const tanks = [seen(1, 'hum_tank', 15, 10), seen(2, 'hum_tank', 15, 12)];
    expect(isHarasser(tanks, vrax, (id) => id === 1)).toBe(true);
    expect(isHarasser(tanks, vrax, () => false)).toBe(false);
  });
});

describe('harassment discipline (AI-40)', () => {
  it('AI-40: it chases only with the units that can catch or reach the harassers, and only when they have 1.5 times their power', () => {
    expect([CHASE_RATIO, HARASS_LEASH, HARASS_PATIENCE]).toEqual([1.5, 8, 200]);
    const skim = [seen(1, 'ali_skimmer', 0, 0)];
    // Bulwarks are faster than a Skimmer: they catch it; rifle squads neither catch nor reach it.
    const army = [...own('hum_tank', 2), ...own('hum_rifleman', 6)];
    expect(catchers(army, skim).map((u) => u.kind)).toEqual(['hum_tank', 'hum_tank']);
    // Two Bulwarks (1600) against one Skimmer (950): chase, the Bulwarks alone.
    const a = harassAnswer(army, skim);
    expect(a.mode).toBe('chase');
    if (a.mode === 'chase') expect(a.chasers.every((u) => u.kind === 'hum_tank')).toBe(true);
    // One Bulwark (800) is not 1.5 times as strong: push as one body.
    expect(harassAnswer([...own('hum_tank', 1), ...own('hum_rifleman', 9)], skim).mode).toBe('push');
    // A Bulwark holds fire while it moves (CMB-4): kiting, it really gets away at KITE_DUTY of its speed (42 * 0.6 = 25.2),
    // so Brutes (38) catch it as well as Skimmers (range 9 against 6) reach it. A Skimmer fires on the move: full speed (40).
    expect(KITE_DUTY).toBe(0.6);
    expect(effectiveSpeed('hum_tank')).toBeCloseTo(25.2);
    expect(effectiveSpeed('ali_skimmer')).toBe(40);
    expect(catchers([...own('ali_brute', 3), ...own('ali_skimmer', 2)], [seen(1, 'hum_tank', 0, 0)]).map((u) => u.kind)).toEqual(['ali_brute', 'ali_brute', 'ali_brute', 'ali_skimmer', 'ali_skimmer']);
    expect(catchers(own('hum_rifleman', 3), [seen(1, 'ali_skimmer', 0, 0)])).toEqual([]);
    // The leash.
    expect(leashed({ x: 0, y: 0 }, { x: 20, y: 0 })).toEqual({ x: HARASS_LEASH, y: 0 });
    expect(leashed({ x: 0, y: 0 }, { x: 5, y: 0 })).toEqual({ x: 5, y: 0 });
    expect(DEFAULT_RULES.harass).toBe(true);
  });

  /** Standing units at the staging point, one hit, with these enemy units seen; the orders over `ticks`. */
  const standing = (army: string[], foes: Foe[], ticks = 16) => {
    const g = base({ army });
    const who = ai();
    const fog: Foe[] = [...Array(8)].map((_, i) => ({ kind: 'ali_brute', tx: 70 + (i % 4), ty: 40 + Math.floor(i / 4) }));
    run(g, who, 8, fog);
    const ids = g.state.units.filter((u) => u.owner === 0 && unitDef(u.kind).weapon).map((u) => u.id);
    const home = { x: g.state.units.filter((u) => ids.includes(u.id)).reduce((s, u) => s + u.x, 0) / ids.length / FP, y: g.state.units.filter((u) => ids.includes(u.id)).reduce((s, u) => s + u.y, 0) / ids.length / FP };
    g.state.units.find((u) => u.id === ids[0])!.hp -= 20;
    const log = run(g, who, ticks, [...foes, ...fog]);
    return { g, who, ids, log, home, fog };
  };
  const moves = (log: readonly Command[]) => log.filter((c): c is Extract<Command, { type: 'move' | 'attackmove' }> => c.type === 'move' || c.type === 'attackmove');

  it('AI-40: a standing army that can catch the harassers chases with those units only, no farther than HARASS_LEASH tiles', () => {
    // Four Bulwarks and four rifle squads (3600) against a Skimmer (950) out-ranging the Bulwarks, by the hit one.
    const army = [...many('hum_tank', 4), ...many('hum_rifleman', 4)];
    const { g, who, ids, log, home } = standing(army, [{ kind: 'ali_skimmer', tx: 25, ty: 25 }]);
    expect(who.stats.harassResponses.chase).toBe(1);
    const tanks = ids.filter((id) => g.state.units.find((u) => u.id === id)!.kind === 'hum_tank');
    const chase = moves(log).filter((c) => c.type === 'attackmove');
    expect(chase.length).toBeGreaterThan(0);
    for (const c of chase) {
      expect(c.units.every((id) => tanks.includes(id))).toBe(true);
      expect(Math.hypot(tile(c.x) - home.x, tile(c.y) - home.y)).toBeLessThanOrEqual(HARASS_LEASH + 1);
    }
  }, LONG);

  it('AI-40: one that cannot catch them pushes toward them as one body, never past the leash, and falls back after 10 s if it keeps losing value', () => {
    // Twelve rifle squads (1200) against a Skimmer (950) by the hit one: weaker, out-ranging, and nothing catches it.
    const skim: Foe[] = [{ kind: 'ali_skimmer', tx: 26, ty: 24 }];
    const { g, who, ids, log, home, fog } = standing(many('hum_rifleman', 12), skim);
    expect(who.stats.harassResponses.push).toBe(1);
    expect(who.stats.harassResponses.chase).toBe(0);
    // All of them go, in one body (a concave) whose middle stays within the leash, no unit sent farther than
    // HARASS_LEASH + 4 tiles from that middle (the kite scenario's mark for straying).
    const ms = moves(log);
    expect(ids.every((id) => ms.some((c) => c.units.includes(id)))).toBe(true);
    const mid = { x: ms.reduce((t, c) => t + tile(c.x), 0) / ms.length, y: ms.reduce((t, c) => t + tile(c.y), 0) / ms.length };
    expect(Math.hypot(mid.x - home.x, mid.y - home.y)).toBeLessThanOrEqual(HARASS_LEASH + 1.5);
    for (const c of ms) expect(Math.hypot(tile(c.x) - mid.x, tile(c.y) - mid.y)).toBeLessThanOrEqual(HARASS_LEASH + 4);
    // The Skimmer keeps hurting them and is not pushed off: after HARASS_PATIENCE ticks they fall back onto friendly strength.
    for (let k = 0; k < HARASS_PATIENCE / 8 + 2; k++) {
      const u = g.state.units.find((x) => ids.includes(x.id));
      if (u) u.hp -= 1;
      run(g, who, 8, [...skim, ...fog]);
    }
    expect(who.stats.harassResponses.fallBack).toBe(1);
    expect(who.retreatState.length).toBe(1);
  }, LONG);
});
