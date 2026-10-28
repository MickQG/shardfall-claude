import { describe, expect, it } from 'vitest';
import { demoMap } from '../../src/data/maps';
import { screenToTile, tileToScreen } from '../../src/render/iso';
import * as api from '../../src/sim';
import { createGame, hash, Rng, snapshot, submit, tick } from '../../src/sim';

const run = (seed: number, ticks: number): number => {
  const g = createGame({ seed, map: demoMap(16, 16) });
  for (let i = 0; i < ticks; i++) {
    if (i % 3 === 0) submit(g, { type: 'noop', player: 0 });
    tick(g);
  }
  return hash(g);
};

describe('foundation', () => {
  it('FND-1: the sim exposes createGame, submit, tick, snapshot and hash', () => {
    for (const fn of ['createGame', 'submit', 'tick', 'snapshot', 'hash']) {
      expect(typeof (api as Record<string, unknown>)[fn]).toBe('function');
    }
  });

  it('FND-2: PRNG is reproducible per seed and differs across seeds', () => {
    const a = new Rng(7);
    const b = new Rng(7);
    const c = new Rng(8);
    const sa = Array.from({ length: 8 }, () => a.nextU32());
    const sb = Array.from({ length: 8 }, () => b.nextU32());
    const sc = Array.from({ length: 8 }, () => c.nextU32());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it('FND-3: same seed and commands give the same hash; different seed differs', () => {
    expect(run(42, 100)).toBe(run(42, 100));
    expect(run(42, 100)).not.toBe(run(43, 100));
  });

  it('FND-4: snapshot reports map size and tick', () => {
    const g = createGame({ seed: 1, map: demoMap(10, 12) });
    tick(g);
    tick(g);
    const s = snapshot(g);
    expect(s.mapWidth).toBe(10);
    expect(s.mapHeight).toBe(12);
    expect(s.heights).toHaveLength(120);
    expect(s.tick).toBe(2);
  });

  it('FND-5: isometric projection round-trips', () => {
    for (const [x, y] of [[0, 0], [3, 7], [95, 95], [12.5, 4.25]] as const) {
      const p = tileToScreen(x, y);
      const t = screenToTile(p.x, p.y);
      expect(t.x).toBeCloseTo(x, 9);
      expect(t.y).toBeCloseTo(y, 9);
    }
  });
});
