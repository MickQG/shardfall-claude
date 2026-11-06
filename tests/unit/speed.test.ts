import { describe, expect, it } from 'vitest';
import { SimRunner } from '../../src/host/runner';
import { DEFAULT_SPEED, ONLINE_SPEED, SPEEDS, speedOf, stepSpeed, tickMsAt } from '../../src/host/speed';
import { skirmishConfig } from '../../src/data/maps';
import { TURN_MS, TURN_TICKS } from '../../src/net/protocol';
import { hash } from '../../src/sim';
import { loadSettings, saveSettings } from '../../src/ui/settings';

describe('game speed', () => {
  it('UX-3: ×0.8 by default, 16 ticks a real second; steps ×0.5 to ×4; online plays at ×0.8 with 125 ms turns', () => {
    expect(DEFAULT_SPEED).toBe(0.8);
    expect([...SPEEDS]).toEqual([0.5, 0.8, 1, 2, 4]);
    const r = new SimRunner(skirmishConfig(1), () => undefined);
    expect(r.speed).toBe(0.8);
    let ticks = 0;
    for (let i = 0; i < 100; i++) ticks += r.advance(10);
    expect(ticks).toBe(16);
    expect(stepSpeed(0.8, 1)).toBe(1);
    expect(stepSpeed(0.8, -1)).toBe(0.5);
    expect(stepSpeed(4, 1)).toBe(4);
    expect(stepSpeed(0.5, -1)).toBe(0.5);
    expect(ONLINE_SPEED).toBe(0.8);
    expect(TURN_MS).toBe(TURN_TICKS * tickMsAt(ONLINE_SPEED));
    // Units are interpolated over the real length of a tick at the current speed.
    expect(tickMsAt(0.8)).toBe(62.5);
    expect(tickMsAt(2)).toBe(25);
  });

  it('UX-3: speed only paces the ticks: the same ticks give the same game at every speed', () => {
    const run = (speed: number): number => {
      const r = new SimRunner(skirmishConfig(4), () => undefined, 0, [{ player: 1, difficulty: 'medium' }]);
      r.speed = speed;
      let ticks = 0;
      while (ticks < 400) ticks += r.advance(Math.min(40, (400 - ticks) * tickMsAt(speed)));
      return hash((r as unknown as { game: Parameters<typeof hash>[0] }).game);
    };
    expect(run(0.8)).toBe(run(1));
    expect(run(0.5)).toBe(run(4));
  });

  it('UX-3: the last chosen speed is remembered on the device; anything else reads as the default', () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(loadSettings(store).speed).toBe(0.8);
    saveSettings(store, { ...loadSettings(store), speed: 2 });
    expect(loadSettings(store).speed).toBe(2);
    for (const bad of [3, '2', -1, null]) {
      m.set('shardfall.settings.v2', JSON.stringify({ speed: bad }));
      expect(loadSettings(store).speed).toBe(DEFAULT_SPEED);
    }
    expect(speedOf(1)).toBe(1);
  });
});
