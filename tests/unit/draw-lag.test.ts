import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../../src/host/runner';
import { tickMsAt } from '../../src/host/speed';
import { ARRIVAL_MS, DrawClock, interpolate } from '../../src/render/interp';
import { follow, SMOOTH_TIME, SQUAD_SMOOTH_TIME } from '../../src/render3d/motion';
import type { UnitSnap } from '../../src/sim';

/** A unit that stands until `start` and then moves `perTick` tiles each tick along x. */
const snapAt = (tick: number, start: number, perTick: number): UnitSnap[] =>
  [{ id: 1, owner: 0, kind: 'hum_tank', x: Math.max(0, tick - start) * perTick * 256, y: 0, hp: 100, load: 0, rank: 0, target: -1 } as unknown as UnitSnap];

interface LagRun {
  /** Mean distance the drawn unit trails the newest snapshot, in ms of real time at its speed. */
  trailMs: number;
  /** From the arrival of the first snapshot that shows it moving to the drawn unit having moved 0.02 tiles, ms. */
  onsetMs: number;
  /** Largest frame-to-frame change of the drawn step, as a share of the steady step. */
  stepChange: number;
  /** Largest departure of a frame's drawn step from the steady step, as a share of it. */
  speedDev: number;
  /** How far the drawn unit ever got ahead of the newest snapshot, tiles (UI-15: never). */
  ahead: number;
}

/**
 * The drawing model (R3D-10): the worker's pacing (a timer every ARRIVAL_MS, ticks when a whole tick of game time has
 * built up, host/worker.ts and host/runner.ts), each snapshot arriving `late(n)` ms after it was made, frames at 60 fps
 * drawn either the old way (interpolating by the time since the last arrival) or through the DrawClock, then the
 * position spring `follow` with `smooth` seconds.
 */
function model(opts: { speed: number; smooth: number; clock: boolean; late?: (n: number) => number; seconds?: number }): LagRun {
  const { speed, smooth, clock } = opts;
  const tickMs = tickMsAt(speed);
  const perTick = 0.1;
  const start = 20;
  const end = (opts.seconds ?? 6) * 1000;
  const arrivals: { at: number; tick: number }[] = [];
  let acc = 0;
  let tick = 0;
  for (let w = ARRIVAL_MS; w < end + 500; w += ARRIVAL_MS) {
    acc += ARRIVAL_MS * speed;
    while (acc >= TICK_MS) {
      acc -= TICK_MS;
      tick++;
      // Messages from the worker arrive in order: a late one holds up those behind it.
      arrivals.push({ at: Math.max(arrivals[arrivals.length - 1]?.at ?? 0, w + (opts.late?.(tick) ?? 0)), tick });
    }
  }
  const dc = new DrawClock();
  const f = { x: 0, z: 0, vx: 0, vz: 0 };
  let next = 0;
  let prev: UnitSnap[] = snapAt(0, start, perTick);
  let curr = prev;
  let currTick = 0;
  let currAt = 0;
  let firstMoving = -1;
  let onset = -1;
  let lastX = 0;
  let ahead = 0;
  const steps: number[] = [];
  const trail: number[] = [];
  const frame = 1000 / 60;
  for (let k = 1; k * frame < end; k++) {
    const now = k * frame;
    while (next < arrivals.length && (arrivals[next] as { at: number }).at <= now) {
      const a = arrivals[next++] as { at: number; tick: number };
      prev = curr;
      curr = snapAt(a.tick, start, perTick);
      currTick = a.tick;
      currAt = a.at;
      dc.push(a.tick, curr, a.at);
      if (a.tick === start + 1) firstMoving = a.at;
    }
    let x: number;
    if (clock) {
      dc.advance(now, tickMs);
      x = dc.units()[0]?.tx ?? 0;
    } else x = (interpolate(prev, curr, (now - currAt) / tickMs)[0] as { tx: number }).tx;
    follow(f, x, 0, 1 / 60, smooth);
    ahead = Math.max(ahead, f.x - Math.max(0, currTick - start) * perTick);
    if (onset < 0 && firstMoving >= 0 && f.x >= 0.02) onset = now - firstMoving;
    if (currTick > start + 30) {
      steps.push(f.x - lastX);
      trail.push((Math.max(0, currTick - start) * perTick - f.x) / (perTick / tickMs));
    }
    lastX = f.x;
  }
  const ideal = (perTick / tickMs) * frame;
  let stepChange = 0;
  let speedDev = 0;
  for (let i = 1; i < steps.length; i++) {
    stepChange = Math.max(stepChange, Math.abs((steps[i] as number) - (steps[i - 1] as number)) / ideal);
    speedDev = Math.max(speedDev, Math.abs((steps[i] as number) / ideal - 1));
  }
  return { trailMs: trail.reduce((a, b) => a + b, 0) / trail.length, onsetMs: onset, stepChange, speedDev, ahead };
}

/** Each message a little late by a fixed pseudo-random amount up to `ms`, as a busy main thread delivers them. */
const lateBy =
  (ms: number) =>
  (n: number): number =>
    ((n * 2654435761) % 1000) / 1000 * ms;

const show = (label: string, r: LagRun): string =>
  `${label}: trail ${r.trailMs.toFixed(1)} ms, onset ${r.onsetMs.toFixed(1)} ms, step change ${(r.stepChange * 100).toFixed(1)}%, speed ${(r.speedDev * 100).toFixed(1)}%`;

describe('drawing lag (R3D-10)', () => {
  it('R3D-10: at speed x0.8 a drawn unit trails the simulation by under 70 ms and shows a start of motion within 50 ms (was about 146 and 75)', () => {
    const before = model({ speed: 0.8, smooth: 0.12, clock: false });
    const now = model({ speed: 0.8, smooth: SMOOTH_TIME, clock: true });
    console.log(show('before', before));
    console.log(show('after', now));
    expect(before.trailMs).toBeGreaterThan(140);
    expect(now.trailMs).toBeLessThan(70);
    expect(now.onsetMs).toBeLessThan(50);
    expect(now.onsetMs).toBeLessThan(before.onsetMs);
    expect(now.ahead).toBeLessThanOrEqual(1e-9);
    // A squad's centre eases in a little longer (its members steer after it), still well under the old lag.
    const squad = model({ speed: 0.8, smooth: SQUAD_SMOOTH_TIME, clock: true });
    console.log(show('squad', squad));
    expect(squad.trailMs).toBeLessThan(100);
    expect(squad.speedDev).toBeLessThan(0.05);
  });

  it('R3D-10: a unit moving at constant speed is drawn moving smoothly when snapshots arrive 50 and 75 ms apart, or late by up to 10 ms', () => {
    for (const late of [0, 5, 10]) {
      const r = model({ speed: 0.8, smooth: SMOOTH_TIME, clock: true, late: lateBy(late) });
      console.log(show(`late up to ${late} ms`, r));
      // Smoother than the old 0.12 s spring on uneven snapshots (4.3% step to step, 7.3% when late), at under half the lag.
      expect(r.stepChange).toBeLessThan(0.04);
      expect(r.speedDev).toBeLessThan(0.05);
      expect(r.trailMs).toBeLessThan(70);
    }
    // Simply halving the old spring would shake: about 12% (19% when late).
    expect(model({ speed: 0.8, smooth: 0.06, clock: false }).speedDev).toBeGreaterThan(0.1);
  });

  it('R3D-10: drawn motion is smooth at every game speed', () => {
    for (const speed of [0.5, 0.8, 1, 2, 4]) {
      const r = model({ speed, smooth: SMOOTH_TIME, clock: true, late: lateBy(5) });
      const old = model({ speed, smooth: 0.12, clock: false, late: lateBy(5) });
      console.log(show(`speed ${speed}`, r), '|', show('old', old));
      expect(r.speedDev, `speed ${speed}`).toBeLessThan(0.06);
      expect(r.trailMs, `speed ${speed}`).toBeLessThan(old.trailMs / 2);
    }
  });

  it('R3D-10: the drawn time never runs backwards, never passes the newest snapshot, and waits through a pause', () => {
    const dc = new DrawClock();
    const tickMs = tickMsAt(0.8);
    let last = -Infinity;
    let tick = 0;
    for (let now = 0; now < 4000; now += 1000 / 60) {
      // Snapshots every tick, except for a second's pause in the middle.
      while ((tick + 1) * tickMs <= now && !(now > 1500 && now < 2500)) dc.push(++tick, snapAt(tick, 0, 0.1), now);
      if (tick === 0) continue;
      const t = dc.advance(now, tickMs);
      expect(t).toBeGreaterThanOrEqual(last);
      expect(t).toBeLessThanOrEqual(tick);
      last = t;
    }
    // A new game (its ticks start again) starts the drawn time afresh.
    dc.push(1, snapAt(1, 0, 0.1), 5000);
    expect(dc.advance(5000, tickMs)).toBe(1);
  });
});
