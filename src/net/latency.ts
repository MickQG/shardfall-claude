/** How many recent round trips the meter remembers. */
export const LATENCY_SAMPLES = 8;
/** How often a game probes the round trip to its opponent (NET-2). */
export const PING_EVERY_MS = 1000;

/**
 * Round-trip meter (NET-2): keeps the last few round trips and reports half the slowest of them as the one-way latency,
 * so a single slow message does not stall the game but a slow connection is never under-estimated. Pure.
 */
export class LatencyMeter {
  private samples: number[] = [];

  add(rttMs: number): void {
    if (!Number.isFinite(rttMs) || rttMs < 0) return;
    this.samples.push(rttMs);
    if (this.samples.length > LATENCY_SAMPLES) this.samples.shift();
  }

  /** One-way latency in ms, or null before any round trip has been measured. */
  oneWay(): number | null {
    return this.samples.length ? Math.max(...this.samples) / 2 : null;
  }
}
