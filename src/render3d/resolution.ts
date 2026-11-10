/**
 * Adaptive resolution (PERF-2): when frames run slow while the CPU side of a frame is light (so the GPU is the
 * bottleneck), render fewer pixels; when frames are back on time for a while, step sharpness back up.
 * Pixel ratio stays within [PR_MIN, PR_MAX] device pixels per CSS pixel.
 */
export const PR_MAX = 1.25;
/** Low's ceiling: one device pixel per CSS pixel. */
export const PR_MAX_LOW = 1;
/** Lowest ratio: a very busy battle may render at about two thirds of the screen's pixels before the sharpness shows (R3D-29). */
export const PR_MIN = 0.65;
export const PR_STEP = 0.1;
/** A frame slower than this counts as slow, ms (under 50 fps). */
export const SLOW_MS = 20;
/** A frame no slower than this counts as on time, ms (60 Hz with a little slack). */
export const ON_TIME_MS = 17.5;
/** Slow frames for this long, ms, before dropping a step. */
export const DROP_AFTER_MS = 800;
/** On-time frames for this long, ms, before raising a step. */
export const RAISE_AFTER_MS = 8000;
/** GPU frame time the governor steers towards, ms: leaves headroom under 16.7 ms for CPU stalls and presentation (R3D-29). */
export const GPU_BUDGET_MS = 12.5;
/** GPU time above this, ms, for DROP_GPU_AFTER_MS counts as over budget. */
export const GPU_OVER_MS = 13.5;
export const DROP_GPU_AFTER_MS = 400;
/** A raise needs the predicted GPU time one step up to stay under this, ms (hysteresis against flapping). */
export const GPU_RAISE_UNDER_MS = 11.5;
export const RAISE_GPU_AFTER_MS = 3000;
/** Step size when raising on GPU readings. */
export const PR_RAISE_STEP = 0.05;
/** After a change, GPU readings are stale (queries lag, buffers reallocate): ignore them this long, ms. */
export const SETTLE_MS = 600;

export class ResolutionGovernor {
  private slowFor = 0;
  private fineFor = 0;
  private overFor = 0;
  private settle = 0;

  constructor(
    /** Highest pixel ratio: the device's, capped at PR_MAX. */
    readonly max = PR_MAX,
    public ratio = max,
  ) {}

  /**
   * Feed one frame: its interval and the CPU time the view spent on it, ms. Returns true when the pixel ratio changed.
   * Long gaps (a hidden tab, a debugger) are ignored.
   */
  step(frameMs: number, cpuMs: number, gpuMs: number | null = null): boolean {
    if (!(frameMs > 0) || frameMs > 250) return false;
    const floor = Math.min(PR_MIN, this.max);
    if (gpuMs !== null && gpuMs > 0) return this.stepGpu(frameMs, gpuMs, floor);
    if (frameMs > SLOW_MS && cpuMs < frameMs * 0.7) {
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

  /**
   * GPU-timed steering (R3D-29): pixel cost scales with the ratio squared, so when the GPU runs over budget the ratio
   * drops straight to the one that should land on GPU_BUDGET_MS; it climbs back in small steps, only when the next step
   * is predicted to stay comfortably inside the budget.
   */
  private stepGpu(frameMs: number, gpuMs: number, floor: number): boolean {
    if (this.settle > 0) {
      this.settle -= frameMs;
      return false;
    }
    if (gpuMs > GPU_OVER_MS) {
      this.fineFor = 0;
      this.overFor += frameMs;
      if (this.overFor >= DROP_GPU_AFTER_MS && this.ratio > floor) {
        const want = this.ratio * Math.sqrt(GPU_BUDGET_MS / gpuMs);
        this.ratio = Math.max(floor, round(Math.floor(Math.min(this.ratio - 0.02, Math.max(this.ratio - 0.12, want)) * 20) / 20));
        this.overFor = 0;
        this.settle = SETTLE_MS;
        return true;
      }
      return false;
    }
    this.overFor = 0;
    const up = Math.min(this.max, this.ratio + PR_RAISE_STEP);
    if (up > this.ratio && gpuMs * (up / this.ratio) ** 2 < GPU_RAISE_UNDER_MS) {
      this.fineFor += frameMs;
      if (this.fineFor >= RAISE_GPU_AFTER_MS) {
        this.ratio = round(up);
        this.fineFor = 0;
        this.settle = SETTLE_MS;
        return true;
      }
    } else this.fineFor = 0;
    return false;
  }
}

const round = (x: number): number => Math.round(x * 100) / 100;
