import { describe, expect, it } from 'vitest';
import { FAST_SPEED, HIT_MIN, HIT_SHARE, HIT_WAVE_MIN, RAIDER_SCOUTS, SPLIT_APART, SPLIT_MIN, SPLIT_RATIO, chooseUnitKind, type AI, type Personality } from '../../src/ai/ai';
import { SteamrollAI } from '../../src/ai/steamroll';
import { unitDef } from '../../src/data/defs';
import { type Command, type Game } from '../../src/sim';
import { ai, base, BY_TARGET, kill, LONG, many, MAP, reinforce, run, runUntil, SEED, sentTo, sideOf, teleport, tile, type Foe } from './aiWaveBench';

/**
 * Hit squads go for the enemy economy from a side the army is not on (AI-27): (a) Raider splits a raid in two, and may
 * train scout units for its army; (b) Balanced and Doomsday send a hit squad of fast units beside a main wave. Played on
 * the bench of aiWaveBench.ts (a human base on seed 6, the enemy headquarters at 83,83).
 */

const TARGET = { tx: 83, ty: 83 };
/** Enemy haulers it has seen: parts of the enemy economy (AI-14). A is nearest its staging point; B is 30 tiles from A, C 8.6. */
const A = { tx: 40, ty: 40 };
const B = { tx: 70, ty: 26 };
const C = { tx: 45, ty: 47 };
const hauler = (t: { tx: number; ty: number }): Foe => ({ kind: 'ali_gorger', ...t });
/** Two Brutes standing guard by a target (1 660 credits). */
const guard = (t: { tx: number; ty: number }): Foe[] => [0, 1].map((i) => ({ kind: 'ali_brute', tx: t.tx + 2 + i, ty: t.ty + 2 }));

const value = (g: Game, ids: readonly number[]): number =>
  g.state.units.filter((u) => ids.includes(u.id)).reduce((s, u) => s + (unitDef(u.kind).cost * u.hp) / unitDef(u.kind).hp, 0);
const squads = (who: AI) => who.groupState.filter((s) => s.kind !== 'wave');
const idsOf = (g: Game, kind: string): number[] => g.state.units.filter((u) => u.owner === 0 && u.kind === kind).map((u) => u.id);

/** Raider with four tanks and four Rocketeers at its staging point, having seen these. */
function raid(sight: Foe[], rules?: Parameters<typeof ai>[1], army = [...many('hum_tank', 4), ...many('hum_rocketeer', 4)]): { g: Game; who: AI } {
  const g = base({ army });
  const who = ai('raider', rules);
  run(g, who, 24, [BY_TARGET, ...sight]);
  return { g, who };
}

/** A group fell back to friendly strength (AI-37): a plain move with these units to its fallback point, or the first hop of a fighting retreat. */
const fellBack = (who: AI, log: readonly Command[], ids: readonly number[]): boolean => {
  const r = who.retreatState.find((x) => ids.every((id) => x.members.includes(id)));
  return r !== undefined && log.some((c) => c.type === 'move' && ids.every((id) => c.units.includes(id)) && (r.fighting || Math.hypot(tile(c.x) - r.to.x, tile(c.y) - r.to.y) <= 1));
};

describe('hit squads (AI-27)', () => {
  describe('(a) Raider splits a raid in two', () => {
    it('AI-27 (a): a raid of six units or more, knowing two economy targets at least 8 tiles apart that it may go for, sets out as two hit squads of about equal value, the units dealt out alternately from the dearest down, to the nearest target and the one farthest from it', () => {
      expect([SPLIT_MIN, SPLIT_APART, HIT_MIN]).toEqual([6, 8, 3]);
      const { g, who } = raid([hauler(A), hauler(B), hauler(C)]);
      expect(who.stats.waves).toBe(1);
      expect(who.stats.splitRaids).toBe(1);
      expect(who.waveState).toBeNull();
      const [s1, s2] = squads(who);
      expect(squads(who).map((s) => s.kind)).toEqual(['raid', 'raid']);
      // Dealt out from the dearest down: the tanks alternately, then the Rocketeers.
      const tanks = idsOf(g, 'hum_tank');
      const rockets = idsOf(g, 'hum_rocketeer');
      expect([...s1!.members].sort((a, b) => a - b)).toEqual([tanks[0], tanks[2], rockets[0], rockets[2]].sort((a, b) => a! - b!));
      expect([...s2!.members].sort((a, b) => a - b)).toEqual([tanks[1], tanks[3], rockets[1], rockets[3]].sort((a, b) => a! - b!));
      expect(value(g, s1!.members)).toBe(value(g, s2!.members));
      // The nearest target, and the one farthest from it (B, not C, which is nearer A).
      expect({ tx: s1!.tx, ty: s1!.ty }).toEqual(A);
      expect({ tx: s2!.tx, ty: s2!.ty }).toEqual(B);
    }, LONG);

    it("AI-27 (a): each squad goes by the flank on its target's side of the straight line, so the two come from different sides", () => {
      const { who } = raid([hauler(A), hauler(B)]);
      const stage = who.stagingPoint!;
      const [s1, s2] = squads(who);
      const mid = { tx: (A.tx + B.tx) / 2, ty: (A.ty + B.ty) / 2 };
      const side = (n: number): 'left' | 'right' => (n > 0 ? 'left' : 'right');
      expect(sideOf(stage, mid, A)).not.toBe(0);
      expect(s1!.via).toEqual(who.flankPoint(stage, A, side(sideOf(stage, mid, A))));
      expect(s2!.via).toEqual(who.flankPoint(stage, B, side(sideOf(stage, mid, B))));
      expect(sideOf(stage, mid, A)).toBe(-sideOf(stage, mid, B));
      // Its approach points lie on either side of the raid's line.
      expect(sideOf(stage, mid, s1!.via!)).toBe(sideOf(stage, mid, A));
      expect(sideOf(stage, mid, s2!.via!)).toBe(sideOf(stage, mid, B));
    }, LONG);

    it('AI-27 (a): otherwise the raid sets out as one body: under six units, targets under 8 tiles apart, or a second target too well guarded for the squad that would go there', () => {
      const one = (who: AI): void => {
        expect(who.stats.waves).toBe(1);
        expect(who.stats.splitRaids).toBe(0);
        expect(who.groupState.map((s) => s.kind)).toEqual(['wave']);
      };
      one(raid([hauler(A), hauler(B)], undefined, many('hum_tank', 5)).who);
      one(raid([hauler(A), hauler({ tx: 44, ty: 44 })]).who);
      // Two Brutes by B: less than half the whole raid (4 200), but not less than half the squad that would go (2 100).
      const guarded = raid([hauler(A), hauler(B), ...guard(B)]).who;
      one(guarded);
      expect(guarded.waveState).toMatchObject(A);
      // With the rule off it never splits (measurement only).
      one(raid([hauler(A), hauler(B)], { raidSplit: false }).who);
    }, LONG);

    it('AI-27 (a): a raid splits only when each squad is worth at least the enemy army it has seen in the last two minutes; otherwise it sets out as one body', () => {
      expect(SPLIT_RATIO).toBe(1);
      // Away from both targets, so they guard neither (AI-23 e).
      const seen = (n: number): Foe[] => [...Array(n)].map((_, i) => ({ kind: 'ali_brute', tx: 80 + (i % 2), ty: 50 + (i >> 1) }));
      // Each squad is worth 2 100: two Brutes seen (1 660) leave it strong enough; three (2 490) do not.
      const strong = raid([hauler(A), hauler(B), ...seen(2)]).who;
      expect(strong.stats.splitRaids).toBe(1);
      expect(squads(strong)).toHaveLength(2);
      const weak = raid([hauler(A), hauler(B), ...seen(3)]).who;
      expect(weak.stats.waves).toBe(1);
      expect(weak.stats.splitRaids).toBe(0);
      expect(weak.groupState.map((s) => s.kind)).toEqual(['wave']);
      // Units seen more than two minutes ago do not count.
      const g = base({ army: [...many('hum_tank', 4), ...many('hum_rocketeer', 4)], tick: 3000 - 20 * 121 });
      const old = ai('raider');
      run(g, old, 8, [BY_TARGET, ...seen(3)]);
      g.state.tick = 3000;
      run(g, old, 24, [BY_TARGET, hauler(A), hauler(B)]);
      expect(old.stats.splitRaids).toBe(1);
      // splitRatio 0 drops the condition (measurement only); a lower ratio lets the weaker squads split.
      expect(raid([hauler(A), hauler(B), ...seen(3)], { splitRatio: 0 }).who.stats.splitRaids).toBe(1);
      expect(raid([hauler(A), hauler(B), ...seen(4)], { splitRatio: 0.6 }).who.stats.splitRaids).toBe(1);
      const over = raid([hauler(A), hauler(B), ...seen(5)], { splitRatio: 0.6 }).who;
      expect(over.stats.waves).toBe(1);
      expect(over.stats.splitRaids).toBe(0);
    }, LONG);

    it('AI-27 (a): each squad is judged on its own: a beaten one goes back to the staging point while the other goes on; the split raid is one attack, beaten back once when both squads have ended', () => {
      const { g, who } = raid([hauler(A), hauler(B)]);
      const [s1, s2] = squads(who);
      // Three of the first squad's four are lost: it falls back to friendly strength (AI-37); the second goes on.
      kill(g, s1!.members.slice(0, 3));
      const log = run(g, who, 16, [BY_TARGET, hauler(A), hauler(B)]);
      expect(fellBack(who, log, [s1!.members[3]!])).toBe(true);
      expect(squads(who).map((s) => s.members)).toEqual([s2!.members]);
      expect(who.stats.retreats).toBe(1);
      expect(who.raidsBeatenBack).toBe(0);
      // The second is lost too: the raid has ended, beaten back once, and was one attack.
      kill(g, s2!.members);
      run(g, who, 16, [BY_TARGET, hauler(A), hauler(B)]);
      expect(squads(who)).toEqual([]);
      expect(who.raidsBeatenBack).toBe(1);
      expect(who.stats.waves).toBe(1);
      expect(who.stats.earlyWaves).toBe(1);
    }, LONG);

    it('AI-27 (a): reinforcements gathered at the staging point join the squad with fewer units left', () => {
      const { g, who } = raid([hauler(A), hauler(B)]);
      const [, s2] = squads(who);
      kill(g, [s2!.members[0]!]);
      const extra = reinforce(g, 'hum_tank', 3);
      runUntil(g, who, 200, () => squads(who).some((s) => extra.every((id) => s.members.includes(id))), [BY_TARGET, hauler(A), hauler(B)]);
      const [n1, n2] = squads(who);
      expect(n2!.members).toEqual(expect.arrayContaining(extra));
      expect(n1!.members.some((id) => extra.includes(id))).toBe(false);
    }, LONG);

    it('AI-27 (a): a squad that has done with its target moves on to the next economy target it knows, straight', () => {
      const { g, who } = raid([hauler(A), hauler(B), hauler(C)]);
      const [s1] = squads(who);
      teleport(g, s1!.members, A.tx, A.ty);
      // The hauler at A is gone: it moves on to the next it knows, C.
      run(g, who, 70, [BY_TARGET, hauler(B), hauler(C)]);
      const now = squads(who).find((s) => s.members.includes(s1!.members[0]!))!;
      expect({ tx: now.tx, ty: now.ty }).toEqual(C);
      expect(now.via).toBeNull();
    }, LONG);

    it('AI-27 (a): Raider may train up to three scout units beyond its standing scout, and they belong to the army', () => {
      expect(RAIDER_SCOUTS).toBe(3);
      // Production: a scout unit is worth training while there are fewer than the cap (its standing scout and three).
      const counts = { inf: 0, at: 0, tank: 9, art: 0, air: 0, scout: 2 };
      const none = { air: 0, heavy: 0, light: 0, total: 0 };
      const tilt = { inf: 0.12, scout: 0.06, tank: -0.04, art: -0.04 };
      expect(chooseUnitKind(['hum_tank', 'hum_buggy'], counts, none, tilt, 1 + RAIDER_SCOUTS)).toBe('hum_buggy');
      expect(chooseUnitKind(['hum_tank', 'hum_buggy'], counts, none, tilt)).toBe('hum_tank');
      // Three scout units in its army: it trains its standing scout, and no fourth for the army.
      const g = base({ army: [...many('hum_buggy', 3), ...many('hum_tank', 2)], credits: 20000, haulers: 3 });
      const who = ai('raider');
      const buggies = idsOf(g, 'hum_buggy');
      const log = run(g, who, 2400, [BY_TARGET]);
      expect(who.raiderScouts).toEqual(buggies);
      expect(log.filter((c) => c.type === 'produce' && c.kind === 'hum_buggy')).toHaveLength(1);
      expect(who.standingScout).toBeGreaterThan(0);
      expect(buggies).not.toContain(who.standingScout);
      // Its army scouts set out with its raids; the standing scout does not.
      const raider = ai('raider');
      const g2 = base({ army: [...many('hum_buggy', 3), ...many('hum_tank', 3)] });
      run(g2, raider, 24, [BY_TARGET, hauler(A)]);
      expect(raider.waveState?.members).toEqual(expect.arrayContaining(idsOf(g2, 'hum_buggy')));
    }, LONG);
  });

  describe('(b) Balanced and Doomsday send a hit squad beside their main wave', () => {
    /** Economy targets: D farthest from the wave's target, E near it. D lies left of the line from the staging point to the target. */
    const D = { tx: 50, ty: 30 };
    const E = { tx: 75, ty: 60 };
    /** Ten tanks and some Scout Buggies (the first of which becomes its standing scout) at its staging point. */
    function beside(personality: Personality, buggies: number, sight: Foe[] = [hauler(D), hauler(E)], rules?: Parameters<typeof ai>[1]): { g: Game; who: AI; fast: number[] } {
      const g = base({ army: [...many('hum_tank', 10), ...many('hum_buggy', buggies)] });
      const who = ai(personality, rules);
      run(g, who, 24, [BY_TARGET, ...sight]);
      const fast = idsOf(g, 'hum_buggy').filter((id) => id !== who.standingScout);
      return { g, who, fast };
    }

    it('AI-27 (b): the fastest of its fast units, at most a tenth of the army and at least three, set out as a hit squad at the economy target farthest from the wave; the wave and its strength do not count them', () => {
      expect([FAST_SPEED, HIT_SHARE]).toEqual([45, 0.1]);
      expect(unitDef('hum_buggy').speed).toBeGreaterThanOrEqual(FAST_SPEED);
      for (const p of ['balanced', 'doomsday'] as const) {
        // Ten tanks (8 000) and six buggies in the army (1 500): a tenth is 950, room for three.
        const { g, who, fast } = beside(p, 7);
        expect(fast).toHaveLength(6);
        expect(who.stats.hitSquads, p).toBe(1);
        const [wave, hit] = who.groupState;
        expect(wave!.kind).toBe('wave');
        expect(hit!.kind).toBe('hit');
        expect(hit!.members).toHaveLength(3);
        expect(value(g, hit!.members)).toBeLessThanOrEqual(HIT_SHARE * value(g, [...wave!.members, ...hit!.members]));
        expect({ tx: hit!.tx, ty: hit!.ty }).toEqual(D);
        expect({ tx: wave!.tx, ty: wave!.ty }).toEqual(TARGET);
        // Not part of the wave: the other three buggies go with the wave, and the wave's strength is its own.
        expect(wave!.members.some((id) => hit!.members.includes(id))).toBe(false);
        expect(wave!.members).toHaveLength(13);
        expect(wave!.peak).toBeCloseTo(value(g, wave!.members), 6);
        expect(who.waveState!.peak).toBeCloseTo(value(g, wave!.members), 6);
      }
    }, LONG);

    it('AI-27 (b): the hit squad goes by the flank on the other side from the main wave\'s approach, or, when the wave goes straight, the flank on its target\'s side', () => {
      // Straight (seed 6 starts its turn there, and it has seen no enemy army): D lies left of the wave's line.
      const straight = beside('balanced', 7);
      const stage = straight.who.stagingPoint!;
      expect(straight.who.stats.approachLog).toEqual(['straight']);
      expect(sideOf(stage, TARGET, D)).toBe(1);
      expect(straight.who.groupState[1]!.via).toEqual(straight.who.flankPoint(stage, D, 'left'));
      // The enemy army seen by the left flank: the wave goes right, and the hit squad by its left flank.
      const left = straight.who.flankPoint(stage, TARGET, 'left')!;
      const army = [0, 1, 2, 3].map((i) => ({ kind: 'ali_skitter', tx: left.tx + (i % 2), ty: left.ty + (i >> 1) }));
      const right = beside('balanced', 7, [hauler(D), hauler(E), ...army]);
      expect(right.who.stats.approachLog).toEqual(['right']);
      expect(right.who.groupState[1]!.via).toEqual(right.who.flankPoint(stage, D, 'left'));
      // And the other way round: seen by the right flank, the wave goes left and the hit squad by its right flank.
      const rp = straight.who.flankPoint(stage, TARGET, 'right')!;
      const army2 = [0, 1, 2, 3].map((i) => ({ kind: 'ali_skitter', tx: rp.tx + (i % 2), ty: rp.ty + (i >> 1) }));
      const lw = beside('balanced', 7, [hauler(D), hauler(E), ...army2]);
      expect(lw.who.stats.approachLog).toEqual(['left']);
      expect(lw.who.groupState[1]!.via).toEqual(lw.who.flankPoint(stage, D, 'right'));
    }, LONG);

    it('AI-27 (b): with fewer than three fast units, a tenth of the army too small for three, or no economy target it may go for, no hit squad sets out and the fast units go with the wave', () => {
      const none = ({ who, fast }: { who: AI; fast: number[] }): void => {
        expect(who.stats.waves).toBe(1);
        expect(who.stats.hitSquads).toBe(0);
        expect(who.groupState.map((s) => s.kind)).toEqual(['wave']);
        expect(who.waveState!.members).toEqual(expect.arrayContaining(fast));
      };
      none(beside('balanced', 3));
      none(beside('balanced', 7, [hauler(D), hauler(E), ...guard(D), ...guard(E)]));
      // One tank and four buggies (1 800): a tenth (180) holds none.
      const g = base({ army: [...many('hum_tank', 1), ...many('hum_buggy', 5)] });
      const who = ai('balanced');
      run(g, who, 400, [BY_TARGET, hauler(D)]);
      none({ who, fast: idsOf(g, 'hum_buggy').filter((id) => id !== who.standingScout) });
      // Nor when it would leave a lone wave behind (under five units, HAR-2): three tanks and five buggies, with room for all five.
      const g2 = base({ army: [...many('hum_tank', 3), ...many('hum_buggy', 6)] });
      const who2 = ai('balanced', { hitShare: 0.5 });
      run(g2, who2, 400, [BY_TARGET, hauler(D)]);
      expect(HIT_WAVE_MIN).toBe(5);
      none({ who: who2, fast: idsOf(g2, 'hum_buggy').filter((id) => id !== who2.standingScout) });
      // With the rule off it sends none (measurement only).
      none(beside('balanced', 7, undefined, { hitSquad: false }));
      // A twentieth of the army (475) holds only one buggy, when measurement changes the share.
      none(beside('balanced', 7, undefined, { hitShare: 0.05 }));
    }, LONG);

    it("AI-27 (b): a hit squad is not a wave in the harness's counts and starts no wave cooldown; a beaten one goes back to the staging point and its units rejoin the army", () => {
      const { g, who } = beside('balanced', 7);
      expect(who.stats).toMatchObject({ waves: 1, lone: 0, suicides: 0, hitSquads: 1 });
      const hit = who.groupState[1]!;
      // The main wave is lost: it starts its cooldown.
      kill(g, who.groupState[0]!.members);
      run(g, who, 16, [BY_TARGET, hauler(D), hauler(E)]);
      const beatenAt = g.state.tick;
      expect(who.waveState).toBeNull();
      expect(squads(who)).toHaveLength(1);
      // Later the hit squad is beaten: its last two go back to the staging point.
      run(g, who, 600, [BY_TARGET, hauler(D), hauler(E)]);
      const alive = hit.members.filter((id) => g.state.units.some((u) => u.id === id));
      kill(g, alive.slice(0, alive.length - 2));
      const log = run(g, who, 16, [BY_TARGET, hauler(D), hauler(E)]);
      expect(squads(who)).toEqual([]);
      expect(fellBack(who, log, alive.slice(-2))).toBe(true);
      expect(who.stats.waves).toBe(1);
      // A fresh army sets out once the wave's cooldown is over, not a cooldown after the hit squad ended.
      reinforce(g, 'hum_tank', 6);
      runUntil(g, who, 2000, () => who.stats.waves > 1, [BY_TARGET, hauler(D), hauler(E)]);
      expect(who.stats.waves).toBe(2);
      expect(g.state.tick - beatenAt).toBeLessThan(1200 + 600);
      // Its units rejoin the army once back at friendly strength (AI-37): the two that came back set out with it, or, if
      // the fresh army left while they were still retreating, are no longer retreating once there.
      const back = alive.slice(-2).filter((id) => g.state.units.some((u) => u.id === id));
      if (!back.every((id) => who.waveState!.members.includes(id))) {
        runUntil(g, who, 1200, () => who.retreatState.length === 0, [BY_TARGET, hauler(D), hauler(E)]);
        expect(who.retreatState).toEqual([]);
      }
    }, LONG);

    it('AI-27 (b): a threat to the base calls the hit squad home like any other group (AI-7, AI-23 c)', () => {
      // An attack on the base: every group comes back to defend it. (Brutes attacking are armour away from its base: with
      // rules.ballRaid a hit squad would go for the economy at once, AI-31; that rule is tested on its own.)
      const one = beside('balanced', 7, undefined, { ballRaid: false });
      const hit = one.who.groupState[1]!;
      const raiders = [0, 1, 2].map((i) => ({ kind: 'ali_brute', tx: 14 + i, ty: 18 }));
      const log = run(one.g, one.who, 16, [BY_TARGET, hauler(D), hauler(E), ...raiders]);
      expect(one.who.groupState).toEqual([]);
      // Every unit of it is sent at the threat: by one order, or by its slot in the concave (AI-42).
      expect(hit.members.every((id) => log.some((c) => c.type === 'attackmove' && c.units.includes(id)))).toBe(true);
      // A big enemy force seen near the base, beyond the defence's reach: it comes home to the hold point (AI-23 c).
      const two = beside('balanced', 7, undefined, { ballRaid: false });
      const hit2 = two.who.groupState[1]!;
      run(two.g, two.who, 200, [BY_TARGET, hauler(D), hauler(E)]);
      // Six Brutes (4 980): at least half its army (9 500).
      const force = [0, 1, 2, 3, 4, 5].map((i) => ({ kind: 'ali_brute', tx: 4 + i, ty: 34 }));
      const back = run(two.g, two.who, 16, [BY_TARGET, hauler(D), hauler(E), ...force]);
      expect(squads(two.who)).toEqual([]);
      expect(sentTo(back, hit2.members.filter((id) => two.g.state.units.some((u) => u.id === id)), two.who.recalledTo!)).toBe(true);
    }, LONG);

    it('AI-27 (b): Raider sends none beside a raid, and the steamroll opponent none beside its attack (HAR-5)', () => {
      const r = raid([hauler(A)], undefined, [...many('hum_tank', 4), ...many('hum_buggy', 5)]);
      expect(r.who.stats.hitSquads).toBe(0);
      expect(r.who.groupState.map((s) => s.kind)).toEqual(['wave']);
      const g = base({ army: [...many('hum_tank', 18), ...many('hum_buggy', 4)] });
      const steam = new SteamrollAI(0, 'human', MAP, SEED);
      run(g, steam, 400, [BY_TARGET, hauler(D)]);
      expect(steam.stats.waves).toBe(1);
      expect(steam.stats.hitSquads).toBe(0);
      expect(steam.groupState.map((s) => s.kind)).toEqual(['wave']);
    }, LONG);
  });
});
