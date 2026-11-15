import { describe, expect, it } from 'vitest';
import { AI, CONTACT, DIFFICULTIES, GATHER_R, GROWTH_MAX, HOLD_RATIO, HOLD_REACH, RAID_GUARD_SHARE, RECALL_RANGE, RECALL_SHARE, STALEMATE_ARMY, STALEMATE_QUIET, plantOutput, type AiRules, type Personality } from '../../src/ai/ai';
import { buildingDef, unitDef } from '../../src/data/defs';
import { skirmishConfig } from '../../src/data/maps';
import { createGame, FP, snapshot, submit, tick, type BuildingSnap, type Command, type Game } from '../../src/sim';
import { addUnit } from '../../src/sim/state';

/**
 * Hold and defend (AI-23): the AI does not feed a stronger enemy and meets an attack at its base with its whole army.
 * Decided from a small human base on seed 6 (headquarters at 10,10, the enemy's at 83,83 on a 96 by 96 map), with no
 * credits so it builds and trains nothing. What it has seen of the enemy is added to its own snapshot ("sightings"), so
 * each test controls exactly what it knows; units in the fog stay remembered, units in sight vanish when no longer seen.
 */

/** Each test plays up to a few thousand ticks of a small game. */
const LONG = 60_000;

const CFG = skirmishConfig(6, { factions: ['human', 'alien'] });
const MAP = CFG.map;
const HQ = { tx: 10, ty: 10 };

interface Base {
  barracks?: number;
  factories?: number;
  turrets?: [number, number][];
  /** Its army, by kind, standing at its staging point (about 19 to 21 tiles out along the diagonal). */
  army?: string[];
  tick?: number;
}

const BARRACKS: [number, number][] = [[2, 8], [5, 8], [2, 11], [5, 11], [2, 14]];
const FACTORIES: [number, number][] = [[14, 6], [18, 6], [2, 17], [6, 17], [2, 21]];
const REACTORS: [number, number][] = [[2, 2], [5, 2], [8, 2], [11, 2], [14, 2], [17, 2], [2, 5], [5, 5]];

/** Where the n-th unit of its army stands: rows of three around its staging point. */
const atStage = (i: number): [number, number] => [19 + (i % 3), 19 + Math.floor(i / 3)];

function base(o: Base = {}): Game {
  const own = (kind: string, [tx, ty]: [number, number]) => ({ owner: 0, kind, tx, ty });
  const buildings = [
    ...CFG.buildings!.filter((b) => b.owner !== 0),
    { owner: 0, kind: 'hum_hq', ...HQ },
    own('hum_reactor', [10, 14]),
    own('hum_refinery', [14, 10]),
    ...REACTORS.map((p) => own('hum_reactor', p)),
    ...BARRACKS.slice(0, o.barracks ?? 1).map((p) => own('hum_barracks', p)),
    ...FACTORIES.slice(0, o.factories ?? 1).map((p) => own('hum_factory', p)),
    ...(o.turrets ?? []).map((p) => own('hum_turret', p)),
  ];
  const units = [...(CFG.units ?? []).filter((u) => u.owner !== 0), ...(o.army ?? []).map((kind, i) => ({ owner: 0, kind, tx: atStage(i)[0], ty: atStage(i)[1] }))];
  const g = createGame({ ...CFG, players: [{ faction: 'human', credits: 0 }, CFG.players![1]!], buildings, units });
  g.state.tick = o.tick ?? 3000;
  return g;
}

const ai = (personality: Personality = 'balanced', rules?: Partial<AiRules>): AI => new AI(0, 'human', DIFFICULTIES.hard, MAP, 6, personality, { rules });
const many = (kind: string, n: number): string[] => [...Array(n)].map(() => kind);

/** An enemy unit it sees, at a tile. */
interface Foe {
  kind: string;
  tx: number;
  ty: number;
}
type Sight = Foe[] | ((g: Game) => Foe[]);

/** The enemy headquarters as a remembered building, so it knows where the enemy is and does not send a scout. */
const enemyHq = (g: Game): BuildingSnap[] => {
  const b = g.state.buildings.find((x) => x.owner === 1 && buildingDef(x.kind).hq);
  if (!b) return [];
  return [{ id: b.id, owner: 1, kind: b.kind, tx: b.tx, ty: b.ty, hp: b.hp, queue: [], repairing: false, rally: null, charge: 0 }];
};

/** One decision, with these enemy units seen (each keeps its id by its place in the list). */
function look(g: Game, who: AI, sight: Sight = []): Command[] {
  const s = snapshot(g, 0);
  const foes = typeof sight === 'function' ? sight(g) : sight;
  s.units.push(...foes.map((f, i) => ({ id: 900000 + i, owner: 1, kind: f.kind, x: f.tx * FP + FP / 2, y: f.ty * FP + FP / 2, hp: unitDef(f.kind).hp, dest: null, load: 0, rank: 0, target: -1 })));
  if (!s.buildings.some((b) => b.owner === 1) && s.ghosts.length === 0) s.ghosts.push(...enemyHq(g));
  return who.think(s);
}

/** `ticks` of play, the AI deciding on its cadence; every order it gave. */
function run(g: Game, who: AI, ticks: number, sight: Sight = []): Command[] {
  const log: Command[] = [];
  for (let i = 0; i < ticks; i++) {
    if (g.state.tick % who.diff.thinkEvery === 0) {
      const cmds = look(g, who, sight);
      for (const c of cmds) submit(g, c);
      log.push(...cmds);
    }
    tick(g);
  }
  return log;
}

/** A weak enemy unit seen far off in the fog: fresh intel, but nothing to fear. */
const FAR: Foe = { kind: 'ali_skitter', tx: 80, ty: 20 };
/** `n` enemy units of a kind in the fog, far from everything. */
const fogArmy = (kind: string, n: number): Foe[] => [...Array(n)].map((_, i) => ({ kind, tx: 70 + (i % 5), ty: 40 + Math.floor(i / 5) }));

const tile = (v: number): number => v / FP;
const mine = (g: Game, ids?: readonly number[]) => g.state.units.filter((u) => u.owner === 0 && unitDef(u.kind).weapon && (!ids || ids.includes(u.id)));
const centreOf = (g: Game, ids: readonly number[]): { x: number; y: number } => {
  const us = mine(g, ids);
  return { x: us.reduce((s, u) => s + tile(u.x), 0) / us.length, y: us.reduce((s, u) => s + tile(u.y), 0) / us.length };
};
/** Attack-move orders with all these units, to within `r` tiles of a point. */
const sentTo = (log: readonly Command[], ids: readonly number[], p: { tx: number; ty: number }, r = 1.5): boolean =>
  log.some((c) => c.type === 'attackmove' && ids.every((id) => c.units.includes(id)) && Math.hypot(tile(c.x) - p.tx - 0.5, tile(c.y) - p.ty - 0.5) <= r);
/** Distance (tiles) from a point to the nearest of its own buildings' footprints. */
const toBase = (g: Game, x: number, y: number): number =>
  Math.min(
    ...g.state.buildings
      .filter((b) => b.owner === 0)
      .map((b) => {
        const d = buildingDef(b.kind);
        return Math.hypot(Math.max(b.tx - x, 0, x - (b.tx + d.w)), Math.max(b.ty - y, 0, y - (b.ty + d.h)));
      }),
  );

/**
 * A base with this army at its staging point that has sent it out as a wave, against a weak enemy seen far off; `out`
 * ticks more take the wave away from the base, beyond the reach of the recall (d).
 */
function launched(army: string[], o: Base = {}, out = 0, rules?: Partial<AiRules>): { g: Game; who: AI; wave: number[] } {
  const g = base({ army, ...o });
  const who = ai('balanced', rules);
  run(g, who, 24 + out, [FAR]);
  expect(who.stats.waves).toBe(1);
  return { g, who, wave: [...who.waveState!.members] };
}

describe('hold and defend (AI-23)', () => {
  it('AI-23 (a): a wave counts its reinforcements: the retreat test compares it with the strongest it has been', () => {
    const { g, who, wave } = launched(many('hum_tank', 6));
    // Six more tanks reach the staging point and join the wave in a group (AI-11).
    const extra = [...Array(6)].map((_, i) => addUnit(g.state, 0, 'hum_tank', (atStage(i)[0] + 0.5) * FP, (atStage(i)[1] + 0.5) * FP).id);
    run(g, who, 70, [FAR]);
    expect(who.waveState!.members).toEqual(expect.arrayContaining([...wave, ...extra]));
    expect(who.waveState!.peak).toBeGreaterThan(11 * unitDef('hum_tank').cost);
    // Seven are lost: five left is more than 45% of the six that set out, but less than 45% of the twelve it was.
    const gone = [...wave, ...extra].slice(0, 7);
    g.state.units = g.state.units.filter((u) => !gone.includes(u.id));
    const left = [...wave, ...extra].slice(7);
    const log = run(g, who, 16, [FAR]);
    expect(who.stats.retreats).toBe(1);
    expect(who.waveState).toBeNull();
    // It falls back fighting, to its hold point (AI-23 e).
    expect(sentTo(log, left, who.hold.point!)).toBe(true);
  }, LONG);

  it('AI-23 (b): reinforcements join a wave only while it is at least as strong as the enemy seen near it; otherwise they wait at the gathering point', () => {
    const { g, who, wave } = launched(many('hum_tank', 6), {}, 200);
    const extra = [...Array(4)].map((_, i) => addUnit(g.state, 0, 'hum_tank', (atStage(i)[0] + 0.5) * FP, (atStage(i)[1] + 0.5) * FP).id);
    // Seven Brutes just ahead of the wave: stronger than it, but not so strong that it turns back (1.5 times).
    const brutes = (gm: Game): Foe[] => {
      const c = centreOf(gm, wave);
      return [FAR, ...[...Array(7)].map((_, i) => ({ kind: 'ali_brute', tx: Math.floor(c.x + 4 + (i % 3)), ty: Math.floor(c.y + 4 + Math.floor(i / 3)) }))];
    };
    const held = run(g, who, 130, brutes);
    expect(who.stats.retreats).toBe(0);
    expect(who.waveState!.members).toHaveLength(6);
    expect(held.some((c) => c.type === 'attackmove' && extra.some((id) => c.units.includes(id)) && c.units.some((id) => wave.includes(id)))).toBe(false);
    // The Brutes are gone (out of sight where they stood): now the reinforcements join.
    run(g, who, 130, [FAR]);
    expect(who.waveState!.members).toEqual(expect.arrayContaining(extra));
  }, LONG);

  it('AI-23 (c): it holds while the enemy army it has seen is worth at least 80% of its own, gathering at a hold point on the enemy side of its base within 5 tiles of its buildings', () => {
    expect(HOLD_RATIO).toBe(0.8);
    expect(HOLD_REACH).toBe(5);
    // Six tanks (4 800) against five Brutes seen (4 150, over 80% of it): it holds and launches nothing.
    const g = base({ army: many('hum_tank', 6) });
    const who = ai();
    const tanks = mine(g).map((u) => u.id);
    const log = run(g, who, 200, [FAR, ...fogArmy('ali_brute', 5)]);
    expect(who.hold.holding).toBe(true);
    expect(who.stats.waves).toBe(0);
    const p = who.hold.point!;
    // Every tank is there or on its way (those already within 7 tiles of it stay where they are).
    for (const u of mine(g, tanks)) {
      const sent = log.some((c) => c.type === 'attackmove' && c.units.includes(u.id) && Math.hypot(tile(c.x) - p.tx - 0.5, tile(c.y) - p.ty - 0.5) <= 1);
      expect(sent || Math.hypot(tile(u.x) - p.tx - 0.5, tile(u.y) - p.ty - 0.5) <= 8, `tank ${u.id}`).toBe(true);
    }
    expect(sentTo(log, tanks.slice(0, 1), p) || sentTo(log, tanks.slice(-1), p)).toBe(true);
    expect(toBase(g, p.tx + 0.5, p.ty + 0.5)).toBeLessThanOrEqual(HOLD_REACH);
    // On the enemy side: farther toward the enemy (down the diagonal) than its headquarters' centre.
    expect(p.tx + p.ty).toBeGreaterThan(2 * (HQ.tx + 1.5));
    // Four Brutes (3 320, under 80%): no hold; the army gathers at the forward staging point instead (AI-11).
    const g2 = base({ army: many('hum_tank', 6) });
    const who2 = ai();
    const log2 = run(g2, who2, 200, [FAR, ...fogArmy('ali_brute', 4)]);
    expect(who2.hold.holding).toBe(false);
    const p2 = who2.hold.point!;
    expect(log2.some((c) => c.type === 'attackmove' && Math.hypot(tile(c.x) - p2.tx - 0.5, tile(c.y) - p2.ty - 0.5) <= 1)).toBe(false);
    for (const u of mine(g2)) expect(Math.hypot(tile(u.x) - 20, tile(u.y) - 20)).toBeLessThanOrEqual(GATHER_R);
  }, LONG);

  it('AI-23 (c): with turrets it holds beside them; an attack on its base keeps it holding for 30 s, then it attacks again', () => {
    const g = base({ army: many('hum_tank', 6), turrets: [[20, 15], [22, 13]] });
    const who = ai();
    run(g, who, 200, [FAR, ...fogArmy('ali_brute', 5)]);
    const p = who.hold.point!;
    expect(Math.min(Math.hypot(p.tx - 20, p.ty - 15), Math.hypot(p.tx - 22, p.ty - 13))).toBeLessThanOrEqual(HOLD_REACH);

    // Ten tanks against a weak enemy would attack at once; but three Brutes were at its buildings a moment ago.
    const g2 = base({ army: many('hum_tank', 10) });
    const who2 = ai();
    run(g2, who2, 8, [FAR, ...[0, 1, 2].map((i) => ({ kind: 'ali_brute', tx: 12 + i, ty: 17 }))]);
    expect(who2.stats.defends).toBeGreaterThan(0);
    run(g2, who2, 560, [FAR]);
    expect(who2.hold.holding).toBe(true);
    expect(who2.stats.waves).toBe(0);
    run(g2, who2, 1400, [FAR]);
    expect(who2.hold.holding).toBe(false);
    expect(who2.stats.waves).toBeGreaterThan(0);
  }, LONG);

  it('AI-23 (d): a wave out comes home when an enemy force worth at least half its army is seen within 20 tiles of its buildings', () => {
    expect([RECALL_RANGE, RECALL_SHARE]).toEqual([20, 0.5]);
    // Out of the base defence's reach (16 tiles from a building's corner), within 20 of a building's footprint.
    const spot = (n: number): Foe[] => [...Array(n)].map((_, i) => ({ kind: 'ali_brute', tx: 4 + i, ty: 34 }));
    const { g, who, wave } = launched(many('hum_tank', 6));
    for (const f of spot(3)) {
      expect(toBase(g, f.tx, f.ty)).toBeLessThanOrEqual(RECALL_RANGE);
      for (const b of g.state.buildings.filter((x) => x.owner === 0)) expect(Math.hypot(f.tx - b.tx, f.ty - b.ty)).toBeGreaterThan(16);
    }
    // Two Brutes (1 660, under half of 4 800): the wave goes on.
    run(g, who, 16, [FAR, ...spot(2)]);
    expect(who.waveState).not.toBeNull();
    // Three (2 490): it comes home, attack-moving to its hold point; not a retreat, and not the base defence.
    const log = run(g, who, 16, [FAR, ...spot(3)]);
    expect(who.waveState).toBeNull();
    expect(who.stats.retreats).toBe(0);
    expect(who.stats.defends).toBe(0);
    expect(sentTo(log, wave, who.hold.point!)).toBe(true);
  }, LONG);

  it('AI-23 (e): a beaten wave in contact turns back only if its slowest unit outruns the enemy; out of contact it still turns back; a retreat is an attack-move to the hold point', () => {
    expect(CONTACT).toBe(8);
    const ahead = (ids: number[], n: number, kind: string, by: number) => (gm: Game): Foe[] => {
      const c = centreOf(gm, ids);
      const s = Math.SQRT1_2;
      return [FAR, ...[...Array(n)].map((_, i) => ({ kind, tx: Math.floor(c.x + by * s + (i % 6) - 2.5), ty: Math.floor(c.y + by * s - (i % 6) + 2.5 + Math.floor(i / 6)) }))];
    };
    // Rocketeers (speed 27) in contact with eight Brutes (speed 38, far stronger): it cannot get away, so it fights on.
    const slow = launched(many('hum_rocketeer', 8), {}, 300);
    run(slow.g, slow.who, 40, ahead(slow.wave, 8, 'ali_brute', 4));
    expect(slow.who.stats.retreats).toBe(0);
    expect(slow.who.waveState).not.toBeNull();

    // Tanks (speed 42) in contact with Spitters (speed 29) worth over 1.5 times the wave: they get away, fighting.
    const fast = launched(many('hum_tank', 5), {}, 200);
    const log = run(fast.g, fast.who, 16, ahead(fast.wave, 28, 'ali_spitter', 4));
    expect(fast.who.stats.retreats).toBe(1);
    expect(sentTo(log, fast.wave, fast.who.hold.point!)).toBe(true);
    expect(log.some((c) => c.type === 'move' && fast.wave.every((id) => c.units.includes(id)))).toBe(false);

    // Eight Brutes in one spot near the wave, out of contact: the slow wave turns back from the stronger enemy (AI-8).
    const far = launched(many('hum_rocketeer', 8), {}, 300);
    // The tile within 9.8 tiles of the wave's centre farthest from all its units.
    const c0 = centreOf(far.g, far.wave);
    let best = { tx: 0, ty: 0, d: -1 };
    for (let dy = -11; dy <= 11; dy++)
      for (let dx = -11; dx <= 11; dx++) {
        if (Math.hypot(dx, dy) > 9.8) continue;
        const tx = Math.floor(c0.x) + dx;
        const ty = Math.floor(c0.y) + dy;
        const d = Math.min(...mine(far.g, far.wave).map((u) => Math.hypot(tile(u.x) - tx - 0.5, tile(u.y) - ty - 0.5)));
        if (d > best.d) best = { tx, ty, d };
      }
    const spot = (): Foe[] => [FAR, ...[...Array(8)].map(() => ({ kind: 'ali_brute', tx: best.tx, ty: best.ty }))];
    const f = spot()[1]!;
    for (const u of mine(far.g, far.wave)) expect(Math.hypot(tile(u.x) - f.tx - 0.5, tile(u.y) - f.ty - 0.5)).toBeGreaterThan(CONTACT + 0.9);
    run(far.g, far.who, 8, spot);
    expect(far.who.stats.retreats).toBe(1);
  }, LONG);

  it('AI-23 (f): after three quiet minutes with five barracks and five factories, or an army worth 25 000, it attacks at parity, so equal AIs do not wait for ever', () => {
    expect([STALEMATE_QUIET, STALEMATE_ARMY, GROWTH_MAX]).toEqual([3600, 25000, 5]);
    const play = (o: Base, seen: Foe[]): AI => {
      const g = base({ tick: 4000, ...o });
      const who = ai();
      run(g, who, 1400, [FAR, ...seen]);
      return who;
    };
    // Ten tanks (8 000) against eight Brutes seen (6 640): it holds (over 80%), but has five of each and breaks the stalemate.
    const full = { barracks: 5, factories: 5, army: many('hum_tank', 10) };
    const broke = play(full, fogArmy('ali_brute', 8));
    expect(broke.stats.waves).toBe(1);
    expect(broke.stats.suicides).toBe(0);
    // Not before three quiet minutes, not with four barracks, not against a stronger army seen.
    expect(play({ ...full, tick: 2000 }, fogArmy('ali_brute', 8)).stats.waves).toBe(0);
    expect(play({ ...full, barracks: 4 }, fogArmy('ali_brute', 8)).stats.waves).toBe(0);
    expect(play(full, fogArmy('ali_brute', 10)).stats.waves).toBe(0);
    // An army worth 25 000 breaks it too, with fewer production buildings.
    expect(play({ army: many('hum_tank', 32) }, fogArmy('ali_brute', 29)).stats.waves).toBe(1);
  }, LONG);

  it('AI-23 (g): Raider raids only a target where the defenders it has seen lately are worth less than half the raid; otherwise the next one, or it waits', () => {
    expect(RAID_GUARD_SHARE).toBe(0.5);
    const A = { tx: 40, ty: 40 };
    const B = { tx: 70, ty: 26 };
    const guard = (t: { tx: number; ty: number }): Foe[] => [0, 1, 2, 3].map((i) => ({ kind: 'ali_brute', tx: t.tx + 2 + (i % 2), ty: t.ty + 2 + (i >> 1) }));
    const raid = (seen: Foe[]): AI => {
      const g = base({ army: many('hum_tank', 8) });
      // Brutes guard the targets: AI-24 off, or seeing them would end Raider's opening (AI-16, AI-24).
      const who = ai('raider', { counterMix: false });
      run(g, who, 24, [FAR, { kind: 'ali_gorger', ...A }, { kind: 'ali_gorger', ...B }, ...seen]);
      return who;
    };
    // Eight tanks (6 400): four Brutes (3 320) is more than half of it.
    const open = raid([]);
    expect(open.waveState).toMatchObject(A); // the nearest hauler it knows
    const guarded = raid(guard(A));
    expect(guarded.waveState).toMatchObject(B); // the next one
    const both = raid([...guard(A), ...guard(B)]);
    expect(both.stats.waves).toBe(0); // it waits
  }, LONG);

  describe('each rule switched off restores the behaviour before it (measurement only)', () => {
    it('AI-23 (a): with wavePeak off the retreat test compares the wave with what set out', () => {
      const { g, who, wave } = launched(many('hum_tank', 6), {}, 0, { wavePeak: false });
      const extra = [...Array(6)].map((_, i) => addUnit(g.state, 0, 'hum_tank', (atStage(i)[0] + 0.5) * FP, (atStage(i)[1] + 0.5) * FP).id);
      run(g, who, 70, [FAR]);
      const gone = [...wave, ...extra].slice(0, 7);
      g.state.units = g.state.units.filter((u) => !gone.includes(u.id));
      run(g, who, 16, [FAR]);
      // Five tanks left is more than 45% of the six that set out: it goes on.
      expect(who.stats.retreats).toBe(0);
      expect(who.waveState).not.toBeNull();
    }, LONG);

    it('AI-23 (b): with noFeed off reinforcements join a wave facing a stronger enemy', () => {
      const { g, who, wave } = launched(many('hum_tank', 6), {}, 200, { noFeed: false });
      const extra = [...Array(4)].map((_, i) => addUnit(g.state, 0, 'hum_tank', (atStage(i)[0] + 0.5) * FP, (atStage(i)[1] + 0.5) * FP).id);
      const brutes = (gm: Game): Foe[] => {
        const c = centreOf(gm, wave);
        return [FAR, ...[...Array(7)].map((_, i) => ({ kind: 'ali_brute', tx: Math.floor(c.x + 4 + (i % 3)), ty: Math.floor(c.y + 4 + Math.floor(i / 3)) }))];
      };
      run(g, who, 130, brutes);
      expect(who.waveState!.members).toEqual(expect.arrayContaining(extra));
    }, LONG);

    it('AI-23 (c): with hold off it gathers at the staging point against a stronger army seen; holdRatio moves the line', () => {
      const g = base({ army: many('hum_tank', 6) });
      const who = ai('balanced', { hold: false });
      run(g, who, 200, [FAR, ...fogArmy('ali_brute', 5)]);
      expect(who.hold.holding).toBe(false);
      for (const u of mine(g)) expect(Math.hypot(tile(u.x) - 20, tile(u.y) - 20)).toBeLessThanOrEqual(GATHER_R);
      // At 0.9, five Brutes (4 150, 86% of 4 800) are not enough.
      const who2 = ai('balanced', { holdRatio: 0.9 });
      run(base({ army: many('hum_tank', 6) }), who2, 40, [FAR, ...fogArmy('ali_brute', 5)]);
      expect(who2.hold.holding).toBe(false);
    }, LONG);

    it('AI-23 (c): with enemyEstimate 1 it remembers the largest army it had in its intel, and holds after the enemy has gone out of sight', () => {
      // Five Brutes seen in its sight once, then gone from where it sees: forgotten at once, unless it keeps a peak memory.
      const once = (gm: Game): Foe[] => (gm.state.tick < 3010 ? [FAR, ...[0, 1, 2, 3, 4].map((i) => ({ kind: 'ali_brute', tx: 24 + (i % 3), ty: 24 + Math.floor(i / 3) }))] : [FAR]);
      const plain = ai('balanced', { stalemate: false });
      const g = base({ army: many('hum_tank', 6) });
      run(g, plain, 60, once);
      expect(plain.hold.holding).toBe(false);
      const peak = ai('balanced', { enemyEstimate: 1 });
      run(base({ army: many('hum_tank', 6) }), peak, 60, once);
      expect(peak.hold.holding).toBe(true);
      expect(peak.stats.waves).toBe(0);
      // Mode 2 counts what the enemy's barracks and factories can have built: 60% of their output since first seen.
      expect(plantOutput('hum_barracks')).toBeCloseTo(unitDef('hum_rifleman').cost / unitDef('hum_rifleman').buildTime);
      expect(plantOutput('ali_pit')).toBeCloseTo(unitDef('ali_brute').cost / unitDef('ali_brute').buildTime);
      expect(plantOutput('ali_nest')).toBeCloseTo(unitDef('ali_skitter').cost / unitDef('ali_skitter').buildTime);
      expect(plantOutput('hum_lab')).toBe(0);
    }, LONG);

    it('AI-23 (d): with recall off a wave out does not come home for an enemy force near the base', () => {
      const spot = [...Array(3)].map((_, i) => ({ kind: 'ali_brute', tx: 4 + i, ty: 34 }));
      const { g, who } = launched(many('hum_tank', 6), {}, 0, { recall: false });
      run(g, who, 16, [FAR, ...spot]);
      expect(who.waveState).not.toBeNull();
    }, LONG);

    it('AI-23 (e): with escapeOnly off a beaten wave in contact turns back however fast the enemy; with fightingRetreat off it moves to the staging point', () => {
      const ahead = (ids: number[]) => (gm: Game): Foe[] => {
        const c = centreOf(gm, ids);
        const s = Math.SQRT1_2;
        return [FAR, ...[...Array(8)].map((_, i) => ({ kind: 'ali_brute', tx: Math.floor(c.x + 4 * s + (i % 6) - 2.5), ty: Math.floor(c.y + 4 * s - (i % 6) + 2.5 + Math.floor(i / 6)) }))];
      };
      const slow = launched(many('hum_rocketeer', 8), {}, 300, { escapeOnly: false, fightingRetreat: false });
      const log = run(slow.g, slow.who, 40, ahead(slow.wave));
      expect(slow.who.stats.retreats).toBe(1);
      const back = log.find((c) => c.type === 'move' && slow.wave.every((id) => c.units.includes(id)));
      expect(back?.type).toBe('move');
      if (back?.type === 'move') expect(Math.hypot(tile(back.x) - 20, tile(back.y) - 20)).toBeLessThanOrEqual(3);
    }, LONG);

    it('AI-23 (f): with stalemate off it does not attack at parity after quiet minutes', () => {
      const g = base({ tick: 4000, barracks: 5, factories: 5, army: many('hum_tank', 10) });
      const who = ai('balanced', { stalemate: false });
      run(g, who, 1400, [FAR, ...fogArmy('ali_brute', 8)]);
      expect(who.stats.waves).toBe(0);
    }, LONG);

    it('AI-23 (g): with raidGuard off Raider raids the nearest target it knows, however guarded', () => {
      const A = { tx: 40, ty: 40 };
      const B = { tx: 70, ty: 26 };
      const g = base({ army: many('hum_tank', 8) });
      const who = ai('raider', { raidGuard: false, counterMix: false });
      run(g, who, 24, [FAR, { kind: 'ali_gorger', ...A }, { kind: 'ali_gorger', ...B }, ...[0, 1, 2, 3].map((i) => ({ kind: 'ali_brute', tx: A.tx + 2 + (i % 2), ty: A.ty + 2 + (i >> 1) }))]);
      expect(who.waveState).toMatchObject(A);
    }, LONG);
  });
});
