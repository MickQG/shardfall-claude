/** Rolling frame-time statistics over the last `size` frames (NXT-6): average, worst and the matching frame rate. */
export class FrameStats {
  private times: number[] = [];

  constructor(private size = 120) {}

  /** Record one frame's duration in ms. */
  push(ms: number): void {
    this.times.push(ms);
    if (this.times.length > this.size) this.times.shift();
  }

  get avg(): number {
    return this.times.length ? this.times.reduce((a, b) => a + b, 0) / this.times.length : 0;
  }

  get worst(): number {
    return this.times.length ? Math.max(...this.times) : 0;
  }

  get fps(): number {
    return this.avg > 0 ? 1000 / this.avg : 0;
  }

  /** One-line readout, e.g. "60 fps · avg 16.7 ms · worst 21.0 ms". */
  label(): string {
    return `${Math.round(this.fps)} fps · avg ${this.avg.toFixed(1)} ms · worst ${this.worst.toFixed(1)} ms`;
  }
}
