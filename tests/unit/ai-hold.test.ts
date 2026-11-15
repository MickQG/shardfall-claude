import { describe, expect, it } from 'vitest';
import { AI, DIFFICULTIES, GROWTH_MAX, HOLD_REACH, RAID_GUARD_SHARE, RECALL_RANGE, RECALL_SHARE, STALEMATE_ARMY, STALEMATE_QUIET, type AiRules, type Personality } from '../../src/ai/ai';
import { buildingDef, unitDef } from '../../src/data/defs';
import { skirmishConfig } from '../../src/data/maps';
import { createGame, FP, snapshot, submit, tick, type BuildingSnap, type Command, type Game } from '../../src/sim';
import { addUnit } from '../../src/sim/state';

/**
 * No feeding of losing waves (AI-23): a wave's strength counts its reinforcements, none join a losing wave, a wave out
 * comes home to a big enemy force near the base, equal AIs break a stalemate, and Raider raids only weakly guarded targets.
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
 * ticks more take the wave away from the base, beyond the reach of the recall (c).
 */
function launched(army: string[], o: Base = {}, out = 0, rules?: Partial<AiRules>): { g: Game; who: AI; wave: number[] } {
  const g = base({ army, ...o });
  const who = ai('balanced', rules);
  run(g, who, 24 + out, [FAR]);
  expect(who.stats.waves).toBe(1);
  return { g, who, wave: [...who.waveState!.members] };
}

describe('no feeding of losing waves (AI-23)', () => {
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
    // It falls back to its staging point (AI-8).
    const back = log.find((c) => c.type === 'move' && left.every((id) => c.units.includes(id)));
    expect(back?.type).toBe('move');
    if (back?.type === 'move') expect(Math.hypot(tile(back.x) - 20, tile(back.y) - 20)).toBeLessThanOrEqual(3);
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

  it('AI-23 (c): a wave out comes home when an enemy force worth at least half its army is seen within 20 tiles of its buildings, to a point on the enemy side of its base within 5 tiles of its buildings', () => {
    expect([RECALL_RANGE, RECALL_SHARE, HOLD_REACH]).toEqual([20, 0.5, 5]);
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
    const p = who.recalledTo!;
    expect(sentTo(log, wave, p)).toBe(true);
    expect(toBase(g, p.tx + 0.5, p.ty + 0.5)).toBeLessThanOrEqual(HOLD_REACH);
    // On the enemy side: farther toward the enemy (down the diagonal) than its headquarters' centre.
    expect(p.tx + p.ty).toBeGreaterThan(2 * (HQ.tx + 1.5));
  }, LONG);

  it('AI-23 (d): after three quiet minutes with five barracks and five factories, or an army worth 25 000, it attacks at parity, so equal AIs do not wait for ever', () => {
    expect([STALEMATE_QUIET, STALEMATE_ARMY, GROWTH_MAX]).toEqual([3600, 25000, 5]);
    const play = (o: Base, seen: Foe[]): AI => {
      const g = base({ tick: 4000, ...o });
      const who = ai();
      run(g, who, 1400, [FAR, ...seen]);
      return who;
    };
    // Ten tanks (8 000) against eight Brutes seen (6 640): no clear advantage, but it has five of each and breaks the stalemate.
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

  it('AI-23 (e): Raider raids only a target where the defenders it has seen lately are worth less than half the raid; otherwise the next one, or it waits', () => {
    expect(RAID_GUARD_SHARE).toBe(0.5);
    const A = { tx: 40, ty: 40 };
    const B = { tx: 70, ty: 26 };
    const guard = (t: { tx: number; ty: number }): Foe[] => [0, 1, 2, 3].map((i) => ({ kind: 'ali_brute', tx: t.tx + 2 + (i % 2), ty: t.ty + 2 + (i >> 1) }));
    const raid = (seen: Foe[]): AI => {
      const g = base({ army: many('hum_tank', 8) });
      const who = ai('raider');
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

    it('AI-23 (c): with recall off a wave out does not come home for an enemy force near the base', () => {
      const spot = [...Array(3)].map((_, i) => ({ kind: 'ali_brute', tx: 4 + i, ty: 34 }));
      const { g, who } = launched(many('hum_tank', 6), {}, 0, { recall: false });
      run(g, who, 16, [FAR, ...spot]);
      expect(who.waveState).not.toBeNull();
    }, LONG);

    it('AI-23 (d): with stalemate off it does not attack at parity after quiet minutes', () => {
      const g = base({ tick: 4000, barracks: 5, factories: 5, army: many('hum_tank', 10) });
      const who = ai('balanced', { stalemate: false });
      run(g, who, 1400, [FAR, ...fogArmy('ali_brute', 8)]);
      expect(who.stats.waves).toBe(0);
    }, LONG);

    it('AI-23 (e): with raidGuard off Raider raids the nearest target it knows, however guarded', () => {
      const A = { tx: 40, ty: 40 };
      const B = { tx: 70, ty: 26 };
      const g = base({ army: many('hum_tank', 8) });
      const who = ai('raider', { raidGuard: false });
      run(g, who, 24, [FAR, { kind: 'ali_gorger', ...A }, { kind: 'ali_gorger', ...B }, ...[0, 1, 2, 3].map((i) => ({ kind: 'ali_brute', tx: A.tx + 2 + (i % 2), ty: A.ty + 2 + (i >> 1) }))]);
      expect(who.waveState).toMatchObject(A);
    }, LONG);
  });
});
