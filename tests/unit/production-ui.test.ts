import { describe, expect, it } from 'vitest';
import { newestQueued, queueable, trainSource } from '../../src/ui/production';

type Q = { kind: string; pct: number; ready: boolean };
const b = (id: number, kind: string, queue: Q[]): { id: number; kind: string; queue: Q[] } => ({ id, kind, queue });
const tank = (pct = 0): Q => ({ kind: 'hum_tank', pct, ready: false });
const buggy = (pct = 0): Q => ({ kind: 'hum_buggy', pct, ready: false });

describe('production routing', () => {
  it('PRD-11: repeated orders spread across producers by shortest queue', () => {
    const pools = [b(1, 'hum_factory', []), b(2, 'hum_factory', [])];
    const sent: number[] = [];
    for (let i = 0; i < 4; i++) {
      const src = trainSource(pools, 'hum_tank') as number;
      sent.push(src);
      (pools.find((p) => p.id === src) as { queue: Q[] }).queue.push(tank());
    }
    expect(sent).toEqual([1, 2, 1, 2]);
  });

  it('PRD-11: equal queue lengths go to the producer with less build time left', () => {
    const pools = [b(1, 'hum_factory', [tank(10)]), b(2, 'hum_factory', [buggy(10)])];
    expect(trainSource(pools, 'hum_tank')).toBe(2);
    const nearlyDone = [b(1, 'hum_factory', [tank(90)]), b(2, 'hum_factory', [tank(10)])];
    expect(trainSource(nearlyDone, 'hum_tank')).toBe(1);
  });

  it('PRD-11: only producers of that kind take the order, and a selected building does not pull orders to itself', () => {
    const blds = [b(1, 'hum_factory', []), b(2, 'hum_factory', [tank(), tank()]), b(3, 'hum_barracks', [])];
    expect(trainSource(blds, 'hum_tank')).toBe(1);
    expect(trainSource(blds, 'hum_rifleman')).toBe(3);
    expect(trainSource([], 'hum_tank')).toBeNull();
  });

  it('PRD-11: mixed unit kinds keep every producer working, for both factions and every producing building', () => {
    const cases: [string, string, string][] = [['hum_factory', 'hum_tank', 'hum_buggy'], ['hum_barracks', 'hum_rifleman', 'hum_rocketeer'], ['ali_nest', 'ali_skitter', 'ali_spitter'], ['ali_pit', 'ali_brute', 'ali_stalker']];
    for (const [kind, x, y] of cases) {
      const pools = [b(1, kind, []), b(2, kind, [])];
      const order = (k: string): number => {
        const src = trainSource(pools, k) as number;
        (pools.find((p) => p.id === src) as { queue: Q[] }).queue.push({ kind: k, pct: 0, ready: false });
        return src;
      };
      // One of each kind: both buildings start at once.
      expect([order(x), order(y)].sort(), kind).toEqual([1, 2]);
      // A longer mix: the build time queued at each building never differs by more than one unit's build time.
      for (const k of [x, x, y, x, y, y, x]) order(k);
      expect(pools.every((p) => p.queue.length > 0), kind).toBe(true);
    }
    // Five quick units go to a building with one slow one in progress rather than all queue behind a single building.
    const pools = [b(1, 'hum_factory', [tank(10)]), b(2, 'hum_factory', [])];
    const sent: number[] = [];
    for (let i = 0; i < 5; i++) {
      const src = trainSource(pools, 'hum_buggy') as number;
      sent.push(src);
      (pools.find((p) => p.id === src) as { queue: Q[] }).queue.push(buggy());
    }
    expect(sent.filter((s) => s === 1).length).toBeGreaterThan(0);
    expect(sent[0]).toBe(2);
  });

  it('PRD-11: full queues are skipped', () => {
    const full = Array.from({ length: 20 }, () => tank());
    expect(trainSource([b(1, 'hum_factory', full)], 'hum_tank')).toBeNull();
    expect(trainSource([b(1, 'hum_factory', full), b(2, 'hum_factory', full.slice(1))], 'hum_tank')).toBe(2);
  });

  it('PRD-12: cancel targets the newest copy of a kind across all buildings', () => {
    const blds = [b(1, 'hum_factory', [tank(50), buggy(), tank()]), b(2, 'hum_factory', [tank(20)])];
    expect(newestQueued(blds, 'hum_tank')).toEqual({ source: 1, index: 2 });
    expect(newestQueued([b(1, 'hum_factory', [tank(50)]), b(2, 'hum_factory', [tank(20), tank()])], 'hum_tank')).toEqual({ source: 2, index: 1 });
    expect(newestQueued(blds, 'hum_gunship')).toBeNull();
  });

  it('PRD-12: with one copy per building, the one with the least progress goes first', () => {
    const blds = [b(1, 'hum_factory', [tank(70)]), b(2, 'hum_factory', [tank(20)])];
    expect(newestQueued(blds, 'hum_tank')).toEqual({ source: 2, index: 0 });
  });

  it('PRD-13: an item is unavailable when unaffordable, missing a prerequisite or with no room, even with copies queued', () => {
    const owned = ['hum_hq', 'hum_reactor', 'hum_refinery', 'hum_barracks', 'hum_factory'];
    const pools = [b(1, 'hum_factory', [tank()])];
    expect(queueable('hum_tank', pools, owned, 800)).toBe(true);
    expect(queueable('hum_tank', pools, owned, 799)).toBe(false);
    expect(queueable('hum_artillery', pools, owned, 5000)).toBe(false);
    expect(queueable('hum_tank', [b(1, 'hum_factory', Array.from({ length: 20 }, () => tank()))], owned, 5000)).toBe(false);
  });
});
