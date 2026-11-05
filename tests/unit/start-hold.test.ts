import { describe, expect, it } from 'vitest';
import { skirmishConfig } from '../../src/data/maps';
import { SimRunner } from '../../src/host/runner';
import type { Snapshot } from '../../src/sim';
import { READY_FRAMES, READY_TIMEOUT_MS, readyToStart } from '../../src/ui/loading';

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

describe('the game starts in a background tab too', () => {
  /** A fake frame clock and timer: frames and timeouts run only when the test says so. */
  const fake = () => {
    const frames: (() => void)[] = [];
    const timers: (() => void)[] = [];
    return {
      raf: (cb: () => void) => void frames.push(cb),
      wait: (cb: () => void) => void timers.push(cb),
      frame: () => frames.splice(0).forEach((f) => f()),
      timeout: () => timers.splice(0).forEach((f) => f()),
    };
  };

  it('UI-12: the game is released after its first frames are drawn', async () => {
    const f = fake();
    const p = readyToStart(READY_FRAMES, READY_TIMEOUT_MS, f.raf, f.wait);
    for (let i = 0; i < READY_FRAMES; i++) f.frame();
    expect(await p).toBe('drawn');
  });

  it('UI-12: in a background tab, which draws no frames, the game is released after a few seconds anyway', async () => {
    const f = fake();
    let settled = false;
    const p = readyToStart(READY_FRAMES, READY_TIMEOUT_MS, f.raf, f.wait).then((why) => ((settled = true), why));
    await Promise.resolve();
    expect(settled).toBe(false); // no frames, no timeout yet: still waiting
    f.timeout();
    expect(await p).toBe('timeout');
    expect(READY_TIMEOUT_MS).toBeLessThanOrEqual(3000);
    // A late frame changes nothing.
    f.frame();
  });
});
