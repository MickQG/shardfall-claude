/**
 * Adaptive resolution (PERF-2): when frames actually run slow and the GPU is the bottleneck, render fewer pixels; when
 * frames are back on time for a while, step sharpness back up. A game that holds 60 fps never loses sharpness.
 * Pixel ratio stays within [PR_MIN, PR_MAX] device pixels per CSS pixel.
 */
export const PR_MAX = 1.25;
/** Low's ceiling: one device pixel per CSS pixel. */
export const PR_MAX_LOW = 1;
/** Lowest ratio (R3D-29): below this the picture visibly softens, so a screen is never pushed further. */
export const PR_MIN = 0.85;
export const PR_STEP = 0.1;
/** A frame slower than this counts as slow, ms (under 50 fps). */
export const SLOW_MS = 20;
/** A frame no slower than this counts as on time, ms (60 Hz with a little slack). */
export const ON_TIME_MS = 17.5;
/** Slow frames for this long, ms, before dropping a step. */
export const DROP_AFTER_MS = 1500;
/** On-time frames for this long, ms, before raising a step. */
export const RAISE_AFTER_MS = 8000;
/** With a GPU reading: the GPU is the bottleneck when it takes at least this share of the frame interval. */
export const GPU_BOUND_SHARE = 0.6;
/** With a GPU reading: a raise waits until the predicted GPU time one step up stays under this, ms (no flapping). */
export const GPU_RAISE_UNDER_MS = 13;
/** After a change, GPU readings are stale (queries lag, buffers reallocate): ignore them this long, ms. */
export const SETTLE_MS = 600;

export class ResolutionGovernor {
  private slowFor = 0;
  private fineFor = 0;
  private settle = 0;

  constructor(
    /** Highest pixel ratio: the device's, capped at PR_MAX. */
    readonly max = PR_MAX,
    public ratio = max,
  ) {}

  /**
   * Feed one frame: its interval, the CPU time the view spent on it and, when the GPU timer has a reading, the GPU time,
   * ms. Returns true when the pixel ratio changed. Long gaps (a hidden tab, a debugger) are ignored.
   * Only slow frames ever lower the ratio; the GPU reading just says whether the GPU is the cause, and how far a raise is safe.
   */
  step(frameMs: number, cpuMs: number, gpuMs: number | null = null): boolean {
    if (!(frameMs > 0) || frameMs > 250) return false;
    const floor = Math.min(PR_MIN, this.max);
    const timed = gpuMs !== null && gpuMs > 0 && this.settle <= 0;
    if (this.settle > 0) this.settle -= frameMs;
    if (frameMs > SLOW_MS) {
      // A missed frame is two intervals long whatever the cause, so the share is taken of one interval, not of the stretched frame.
      const gpuBound = timed ? gpuMs! >= Math.min(frameMs, SLOW_MS) * GPU_BOUND_SHARE : cpuMs < frameMs * 0.7;
      this.fineFor = 0;
      if (!gpuBound) {
        this.slowFor = 0;
        return false;
      }
      this.slowFor += frameMs;
      if (this.slowFor >= DROP_AFTER_MS && this.ratio > floor) {
        this.ratio = Math.max(floor, round(this.ratio - PR_STEP));
        this.slowFor = 0;
        this.settle = SETTLE_MS;
        return true;
      }
      return false;
    }
    // A frame that is not slow only drains the slow time by half its length instead of wiping it: a game that alternates one
    // frame on time with one frame missed (17 and 33 ms, under 50 fps on average) still counts as slow (PERF-2).
    this.slowFor = Math.max(0, this.slowFor - frameMs * 0.5);
    if (frameMs <= ON_TIME_MS) {
      const up = Math.min(this.max, round(this.ratio + PR_STEP));
      // A GPU reading can veto a raise that would land the GPU over budget again.
      const fits = !timed || gpuMs! * (up / this.ratio) ** 2 < GPU_RAISE_UNDER_MS;
      if (up > this.ratio && fits) {
        this.fineFor += frameMs;
        if (this.fineFor >= RAISE_AFTER_MS) {
          this.ratio = up;
          this.fineFor = 0;
          this.settle = SETTLE_MS;
          return true;
        }
      } else this.fineFor = 0;
    } else this.fineFor = 0;
    return false;
  }
}

const round = (x: number): number => Math.round(x * 100) / 100;
