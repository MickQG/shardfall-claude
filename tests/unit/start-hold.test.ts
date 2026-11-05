import { describe, expect, it } from 'vitest';
import { skirmishConfig } from '../../src/data/maps';
import { SimRunner } from '../../src/host/runner';
import type { Snapshot } from '../../src/sim';

describe('the game waits for the page', () => {
  it('UI-12: a held game sends its first snapshot but stays at tick 0, AI included, until it is released', () => {
    const snaps: Snapshot[] = [];
    const r = new SimRunner(skirmishConfig(1), (s) => snaps.push(s), 0, [{ player: 1, difficulty: 'hard' }]);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.tick).toBe(0);
    r.paused = true; // held, as the worker does on `init` with `held`
    expect(r.advance(5000)).toBe(0);
    expect(snaps.at(-1)!.tick).toBe(0);
    r.paused = false; // `go`
    expect(r.advance(500)).toBeGreaterThan(0);
    expect(snaps.at(-1)!.tick).toBeGreaterThan(0);
  });
});
