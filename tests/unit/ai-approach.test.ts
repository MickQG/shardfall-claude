import { describe, expect, it } from 'vitest';
import { AI, APPROACH_FLANK, APPROACH_OPEN, APPROACH_PASSED, APPROACHES, DIFFICULTIES, WAVE_HOP, type Approach } from '../../src/ai/ai';
import { SteamrollAI } from '../../src/ai/steamroll';
import { Rng, type Command, type Game } from '../../src/sim';
import { ai, base, BY_TARGET, centreOf, kill, LONG, many, MAP, reinforce, run, runUntil, SEED, sentTo, sideOf, teleport, tile, type Foe, type Sight } from './aiWaveBench';

/**
 * Main waves vary their approach (AI-26): straight, or by an approach point on the left or right flank; never the
 * approach its previous main wave chose; away from the enemy army it last saw, or in turn from a seeded start. Played on
 * the bench of aiWaveBench.ts (a human base on seed 6, the enemy headquarters at 83,83).
 */

const TARGET = { tx: 83, ty: 83 };

/** Where an AI's turn through the approaches starts: the draw after its jitter, from its seed (AI-26). */
const seededStart = (seed: number, player = 0): number => {
  const r = new Rng(seed * 7919 + player * 104729 + 13);
  for (let i = 0; i < 3; i++) r.int(1000);
  return r.int(APPROACHES.length);
};

/** Four cheap enemy units seen around a tile: an enemy army there, too weak to stop a wave setting out. */
const armyAt = (p: { tx: number; ty: number }): Foe[] => [0, 1, 2, 3].map((i) => ({ kind: 'ali_skitter', tx: p.tx + (i % 2), ty: p.ty + (i >> 1) }));

/** Its last wave out is beaten (its units lost); after the cooldown a fresh army at the staging point sets out again. */
function nextWave(g: Game, who: AI, sight: Sight): void {
  const waves = who.stats.waves;
  kill(g, [...who.waveState!.members]);
  reinforce(g, 'hum_tank', 6);
  runUntil(g, who, 3000, () => who.stats.waves > waves, sight);
  expect(who.stats.waves).toBe(waves + 1);
}

/** A base with six tanks at the staging point that has sent them out as a main wave. */
function launch(sight: Sight = [BY_TARGET], seed = SEED, personality: 'balanced' | 'doomsday' = 'balanced'): { g: Game; who: AI } {
  const g = base({ army: many('hum_tank', 6) });
  const who = ai(personality, undefined, seed);
  run(g, who, 24, sight);
  expect(who.stats.waves).toBe(1);
  return { g, who };
}

describe('main waves vary their approach (AI-26)', () => {
  it("AI-26: a flank's approach point lies halfway along the straight line from the staging point to the target and 10 tiles to that side of it, moved to the nearest open ground; a flank off the map or with no open ground within 6 tiles is not offered", () => {
    expect([APPROACH_FLANK, APPROACH_OPEN]).toEqual([10, 6]);
    const who = ai();
    const from = { tx: 20, ty: 20 };
    const len = Math.hypot(TARGET.tx - from.tx, TARGET.ty - from.ty);
    const mid = { x: (from.tx + TARGET.tx) / 2 + 0.5, y: (from.ty + TARGET.ty) / 2 + 0.5 };
    for (const side of ['left', 'right'] as const) {
      const p = who.flankPoint(from, TARGET, side)!;
      const s = side === 'left' ? 1 : -1;
      // Left as seen looking along the line on the map (y downward): (dy, -dx).
      const raw = { x: mid.x + (s * (TARGET.ty - from.ty) * 10) / len, y: mid.y - (s * (TARGET.tx - from.tx) * 10) / len };
      expect(Math.hypot(p.tx + 0.5 - raw.x, p.ty + 0.5 - raw.y), side).toBeLessThanOrEqual(1);
      expect(sideOf(from, TARGET, p), side).toBe(s);
    }
    // Measurement may change how far to the side it lies (rules.approachFlank). (11, not further out: 14 would lie on one of Crossroads' lane walls, MAP-10)
    const wide = ai('balanced', { approachFlank: 11 }).flankPoint(from, TARGET, 'right')!;
    expect(Math.abs(Math.hypot(wide.tx + 0.5 - mid.x, wide.ty + 0.5 - mid.y) - 11)).toBeLessThanOrEqual(1);
    // Along the top edge, the left flank would lie off the map: not offered; the right one is.
    expect(who.flankPoint({ tx: 20, ty: 2 }, { tx: 80, ty: 2 }, 'left')).toBeNull();
    expect(who.flankPoint({ tx: 20, ty: 2 }, { tx: 80, ty: 2 }, 'right')).not.toBeNull();
    // Rock all round the left point (more than 6 tiles): not offered; the right one still is.
    const left = who.flankPoint(from, TARGET, 'left')!;
    const blocked = [...(MAP.blocked ?? new Array<number>(MAP.width * MAP.height).fill(0))];
    for (let y = left.ty - 8; y <= left.ty + 8; y++) for (let x = left.tx - 8; x <= left.tx + 8; x++) blocked[y * MAP.width + x] = 1;
    const rocky = new AI(0, 'human', DIFFICULTIES.hard, { ...MAP, blocked }, SEED);
    expect(rocky.flankPoint(from, TARGET, 'left')).toBeNull();
    expect(rocky.flankPoint(from, TARGET, 'right')).toEqual(who.flankPoint(from, TARGET, 'right'));
    // Rock over the point itself, with open ground 2 tiles off: it moves there.
    const near = [...(MAP.blocked ?? new Array<number>(MAP.width * MAP.height).fill(0))];
    for (let y = left.ty - 1; y <= left.ty + 1; y++) for (let x = left.tx - 1; x <= left.tx + 1; x++) near[y * MAP.width + x] = 1;
    const moved = new AI(0, 'human', DIFFICULTIES.hard, { ...MAP, blocked: near }, SEED).flankPoint(from, TARGET, 'left')!;
    expect(Math.hypot(moved.tx - left.tx, moved.ty - left.ty)).toBeGreaterThanOrEqual(1.9);
    expect(Math.hypot(moved.tx - left.tx, moved.ty - left.ty)).toBeLessThanOrEqual(APPROACH_OPEN);
  });

  it('AI-26: with no sighting of the enemy army it takes the straight, left and right approaches in turn, starting from one drawn from its seed, never the same twice running', () => {
    // Seeds whose turns start at each approach.
    const seeds = APPROACHES.map((_, k) => [...Array(60)].map((__, i) => i + 1).find((s) => seededStart(s) === k)!);
    for (const seed of seeds) {
      const { g, who } = launch([BY_TARGET], seed);
      for (let i = 0; i < 3; i++) nextWave(g, who, [BY_TARGET]);
      const start = seededStart(seed);
      expect(who.stats.approachLog, `seed ${seed}`).toEqual([0, 1, 2, 3].map((i) => APPROACHES[(start + i) % 3]));
      expect(who.stats.approaches, `seed ${seed}`).toEqual({ straight: 1, left: 1, right: 1, [APPROACHES[start] as Approach]: 2 });
      // The wave out goes by the flank it chose: no point for the straight approach, one on its side for a flank.
      const last = who.stats.approachLog.at(-1) as Approach;
      const via = who.groupState[0]!.via;
      const stage = who.stagingPoint!;
      if (last === 'straight') expect(via).toBeNull();
      else expect(via).toEqual(who.flankPoint(stage, TARGET, last));
    }
    // The same seed and settings give the same choices (HAR-1).
    const again = launch([BY_TARGET], seeds[1]);
    for (let i = 0; i < 3; i++) nextWave(again.g, again.who, [BY_TARGET]);
    expect(again.who.stats.approachLog).toEqual([0, 1, 2, 3].map((i) => APPROACHES[(1 + i) % 3]));
  }, LONG);

  it('AI-26: of the approaches it may take it chooses the one farthest from where it last saw the enemy army, the defenders within 10 tiles of the target left out', () => {
    const probe = ai();
    const left = probe.flankPoint({ tx: 20, ty: 20 }, TARGET, 'left')!;
    // The enemy army last seen by the left flank point: the right flank is farthest from it.
    const sight = [BY_TARGET, ...armyAt(left)];
    const { g, who } = launch(sight);
    expect(who.stats.approachLog).toEqual(['right']);
    expect(who.groupState[0]!.via).toEqual(who.flankPoint(who.stagingPoint!, TARGET, 'right'));
    // Seen there again: the right flank is farthest still, but its previous wave chose it, so the next farthest, straight.
    nextWave(g, who, sight);
    expect(who.stats.approachLog).toEqual(['right', 'straight']);
    nextWave(g, who, sight);
    expect(who.stats.approachLog).toEqual(['right', 'straight', 'right']);
    // An army seen only beside the target is its defenders: no sighting, so it takes them in turn from its seeded start.
    const defenders = launch([BY_TARGET, ...armyAt({ tx: 80, ty: 77 })]);
    expect(defenders.who.stats.approachLog).toEqual([APPROACHES[seededStart(SEED)]]);
  }, LONG);

  it('AI-26: the wave goes to its approach point as one body, in hops, and has passed it once its centre is within 4 tiles of it; then it goes on to the target', () => {
    expect([APPROACH_PASSED, WAVE_HOP]).toEqual([4, 8]);
    const probe = ai();
    const sight = [BY_TARGET, ...armyAt(probe.flankPoint({ tx: 20, ty: 20 }, TARGET, 'left')!)];
    const { g, who } = launch(sight);
    const ids = [...who.waveState!.members];
    const via = who.groupState[0]!.via!;
    expect(via).not.toBeNull();
    const before: Command[] = [];
    let at = { x: 0, y: 0 };
    for (let i = 0; i < 6000 && !who.groupState[0]!.passed; i++) {
      if (g.state.tick % who.diff.thinkEvery === 0) {
        const c = centreOf(g, ids);
        const cmds = run(g, who, 1, sight);
        if (who.groupState[0]!.passed) at = c;
        else {
          // Every hop of the whole wave leads toward its approach point, at most a hop (and the closing-in margin) ahead.
          for (const o of cmds) {
            if (o.type !== 'attackmove' || !ids.every((id) => o.units.includes(id))) continue;
            before.push(o);
            const ahead = Math.hypot(tile(o.x) - c.x, tile(o.y) - c.y);
            expect(ahead).toBeLessThanOrEqual(WAVE_HOP + 2.5);
            expect(Math.hypot(tile(o.x) - via.tx - 0.5, tile(o.y) - via.ty - 0.5)).toBeLessThanOrEqual(Math.hypot(c.x - via.tx - 0.5, c.y - via.ty - 0.5) + 0.75);
          }
        }
      } else run(g, who, 1, sight);
    }
    expect(who.groupState[0]!.passed).toBe(true);
    expect(before.length).toBeGreaterThan(3);
    expect(Math.hypot(at.x - via.tx - 0.5, at.y - via.ty - 0.5)).toBeLessThanOrEqual(APPROACH_PASSED + 0.01);
    // Then on to the target: the next hop leads there, and the wave closes on it.
    const after = run(g, who, 70, sight).filter((o) => o.type === 'attackmove' && ids.every((id) => o.units.includes(id)));
    expect(after.length).toBeGreaterThan(0);
    const hop = after[0] as { x: number; y: number };
    expect(Math.hypot(tile(hop.x) - TARGET.tx, tile(hop.y) - TARGET.ty)).toBeLessThan(Math.hypot(via.tx - TARGET.tx, via.ty - TARGET.ty));
  }, LONG);

  it('AI-26: reinforcements that join the wave after it has passed its approach point go by the point too', () => {
    const probe = ai();
    const sight = [BY_TARGET, ...armyAt(probe.flankPoint({ tx: 20, ty: 20 }, TARGET, 'left')!)];
    const { g, who } = launch(sight);
    runUntil(g, who, 6000, () => who.groupState[0]!.passed, sight);
    const via = who.groupState[0]!.via!;
    const extra = reinforce(g, 'hum_tank', 4);
    const log = runUntil(g, who, 400, () => extra.every((id) => who.groupState[0]!.members.includes(id)), sight);
    expect(who.groupState[0]!.members).toEqual(expect.arrayContaining(extra));
    expect(who.groupState[0]!.trail).toEqual(expect.arrayContaining(extra));
    expect(sentTo(log, extra, via)).toBe(true);
    // Once at the point they are part of the body again.
    runUntil(g, who, 4000, () => who.groupState[0]?.trail.length === 0, sight);
    expect(who.groupState[0]?.trail ?? []).toEqual([]);
    for (const id of extra) {
      const u = g.state.units.find((x) => x.id === id);
      if (u) expect(Math.hypot(tile(u.x) - via.tx - 0.5, tile(u.y) - via.ty - 0.5)).toBeLessThanOrEqual(APPROACH_PASSED + 2);
    }
  }, LONG);

  it('AI-26: a wave that picks a new target on the way, its objective gone or reached, goes straight to it', () => {
    const probe = ai();
    const sight = [BY_TARGET, ...armyAt(probe.flankPoint({ tx: 20, ty: 20 }, TARGET, 'left')!)];
    const { g, who } = launch(sight);
    expect(who.groupState[0]!.via).not.toBeNull();
    expect(who.groupState[0]!.passed).toBe(false);
    // The wave stands at its objective, which is gone: it knows no enemy building now.
    const ids = [...who.waveState!.members];
    teleport(g, ids, TARGET.tx - 2, TARGET.ty - 2);
    run(g, who, 70, [], true);
    const w = who.groupState[0]!;
    expect({ tx: w.tx, ty: w.ty }).not.toEqual(TARGET);
    expect(w.via).toBeNull();
  }, LONG);

  describe('exceptions', () => {
    it('AI-26: a raid chooses no approach: it sets out straight (AI-14, AI-27)', () => {
      const g = base({ army: many('hum_tank', 5) });
      const who = ai('raider');
      run(g, who, 24, [BY_TARGET, { kind: 'ali_gorger', tx: 40, ty: 40 }]);
      expect(who.stats.waves).toBe(1);
      expect(who.stats.approachLog).toEqual([]);
      expect(who.groupState).toHaveLength(1);
      expect(who.groupState[0]!.via).toBeNull();
    }, LONG);

    it('AI-26: a Doomsday wave timed with a charged strike goes straight (AI-15)', () => {
      const g = base({ army: many('hum_tank', 6), superweapon: true });
      const who = ai('doomsday');
      run(g, who, 24, [BY_TARGET]);
      expect(who.stats.waves).toBe(1);
      expect(who.stats.approachLog).toEqual([]);
      expect(who.groupState[0]!.via).toBeNull();
    }, LONG);

    it('AI-26: the steamroll opponent always goes straight (HAR-5)', () => {
      const g = base({ army: many('hum_tank', 18) });
      const who = new SteamrollAI(0, 'human', MAP, SEED);
      run(g, who, 400, [BY_TARGET]);
      expect(who.stats.waves).toBe(1);
      expect(who.stats.approachLog).toEqual([]);
      expect(who.groupState[0]!.via).toBeNull();
    }, LONG);

    it('AI-26: with the approach rule off every main wave goes straight (measurement only)', () => {
      const g = base({ army: many('hum_tank', 6) });
      const who = ai('balanced', { approach: false });
      const probe = ai();
      const sight = [BY_TARGET, ...armyAt(probe.flankPoint({ tx: 20, ty: 20 }, TARGET, 'left')!)];
      run(g, who, 24, sight);
      nextWave(g, who, sight);
      expect(who.stats.waves).toBe(2);
      expect(who.stats.approachLog).toEqual([]);
      expect(who.groupState[0]!.via).toBeNull();
    }, LONG);
  });
});
