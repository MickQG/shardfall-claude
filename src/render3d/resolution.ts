/**
 * Adaptive resolution (PERF-2): when frames run slow while the CPU side of a frame is light (so the GPU is the
 * bottleneck), render fewer pixels; when frames are back on time for a while, step sharpness back up.
 * Pixel ratio stays within [PR_MIN, PR_MAX] device pixels per CSS pixel.
 */
export const PR_MAX = 1.25;
export const PR_MIN = 0.75;
export const PR_STEP = 0.1;
/** A frame slower than this counts as slow, ms (under 50 fps). */
export const SLOW_MS = 20;
/** A frame no slower than this counts as on time, ms (60 Hz with a little slack). */
export const ON_TIME_MS = 17.5;
/** Slow frames for this long, ms, before dropping a step. */
export const DROP_AFTER_MS = 800;
/** On-time frames for this long, ms, before raising a step. */
export const RAISE_AFTER_MS = 8000;

export class ResolutionGovernor {
  private slowFor = 0;
  private fineFor = 0;

  constructor(
    /** Highest pixel ratio: the device's, capped at PR_MAX. */
    readonly max = PR_MAX,
    public ratio = max,
  ) {}

  /**
   * Feed one frame: its interval and the CPU time the view spent on it, ms. Returns true when the pixel ratio changed.
   * Long gaps (a hidden tab, a debugger) are ignored.
   */
  step(frameMs: number, cpuMs: number): boolean {
    if (!(frameMs > 0) || frameMs > 250) return false;
    const floor = Math.min(PR_MIN, this.max);
    if (frameMs > SLOW_MS && cpuMs < frameMs * 0.5) {
      this.slowFor += frameMs;
      this.fineFor = 0;
      if (this.slowFor >= DROP_AFTER_MS && this.ratio > floor) {
        this.ratio = Math.max(floor, round(this.ratio - PR_STEP));
        this.slowFor = 0;
        return true;
      }
      return false;
    }
    this.slowFor = 0;
    if (frameMs <= ON_TIME_MS) {
      this.fineFor += frameMs;
      if (this.fineFor >= RAISE_AFTER_MS && this.ratio < this.max) {
        this.ratio = Math.min(this.max, round(this.ratio + PR_STEP));
        this.fineFor = 0;
        return true;
      }
    } else this.fineFor = 0;
    return false;
  }
}

const round = (x: number): number => Math.round(x * 100) / 100;
