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
      const src = trainSource(pools, 'hum_tank', null) as number;
      sent.push(src);
      (pools.find((p) => p.id === src) as { queue: Q[] }).queue.push(tank());
    }
    expect(sent).toEqual([1, 2, 1, 2]);
  });

  it('PRD-11: equal queue lengths go to the producer with less build time left', () => {
    const pools = [b(1, 'hum_factory', [tank(10)]), b(2, 'hum_factory', [buggy(10)])];
    expect(trainSource(pools, 'hum_tank', null)).toBe(2);
    const nearlyDone = [b(1, 'hum_factory', [tank(90)]), b(2, 'hum_factory', [tank(10)])];
    expect(trainSource(nearlyDone, 'hum_tank', null)).toBe(1);
  });

  it('PRD-11: a selected producer of that kind takes the order; other buildings are ignored', () => {
    const blds = [b(1, 'hum_factory', []), b(2, 'hum_factory', [tank(), tank()]), b(3, 'hum_barracks', [])];
    expect(trainSource(blds, 'hum_tank', 2)).toBe(2);
    expect(trainSource(blds, 'hum_tank', 3)).toBe(1);
    expect(trainSource(blds, 'hum_rifleman', null)).toBe(3);
    expect(trainSource([], 'hum_tank', null)).toBeNull();
  });

  it('PRD-11: full queues are skipped', () => {
    const full = Array.from({ length: 20 }, () => tank());
    expect(trainSource([b(1, 'hum_factory', full)], 'hum_tank', null)).toBeNull();
    expect(trainSource([b(1, 'hum_factory', full), b(2, 'hum_factory', full.slice(1))], 'hum_tank', null)).toBe(2);
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
    expect(queueable('hum_tank', pools, owned, 800, null)).toBe(true);
    expect(queueable('hum_tank', pools, owned, 799, null)).toBe(false);
    expect(queueable('hum_artillery', pools, owned, 5000, null)).toBe(false);
    expect(queueable('hum_tank', [b(1, 'hum_factory', Array.from({ length: 20 }, () => tank()))], owned, 5000, null)).toBe(false);
  });
});
