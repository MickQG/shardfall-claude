import { TICKS_PER_SECOND } from '../sim';

/**
 * Game speed (UX-3): how fast game time passes in real time. It only paces the ticks; per tick the game is exactly the
 * same at every speed, so balance, AI timings and replays do not depend on it.
 */
export const SPEEDS = [0.5, 0.8, 1, 2, 4] as const;
/** Slightly slower than one game second a second, so players have time to react (UX-3). */
export const DEFAULT_SPEED = 0.8;
/** Online matches play at the default speed for both players, who cannot change it (UX-3, NET-2). */
export const ONLINE_SPEED = DEFAULT_SPEED;

/** A game speed from untrusted input (saved settings): one of SPEEDS, or the default. */
export const speedOf = (v: unknown): number => ((SPEEDS as readonly unknown[]).includes(v) ? (v as number) : DEFAULT_SPEED);

/** The next speed up (+1) or down (-1) from `v`, staying within SPEEDS. */
export function stepSpeed(v: number, dir: 1 | -1): number {
  const i = SPEEDS.indexOf(speedOf(v) as (typeof SPEEDS)[number]);
  return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + dir))] as number;
}

/** Real milliseconds one tick lasts at a speed: what units are interpolated over, so motion stays smooth (UX-3). */
export const tickMsAt = (speed: number): number => 1000 / TICKS_PER_SECOND / speed;
