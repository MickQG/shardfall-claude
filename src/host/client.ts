import type { Command, GameConfig, SimEvent, Snapshot } from '../sim';
import type { AiSetup } from './runner';
import type { ToWorker } from './worker';

/** Main-thread handle to the simulation running in a Web Worker. */
export class SimClient {
  private worker: Worker;
  prev: Snapshot | null = null;
  curr: Snapshot | null = null;
  /** performance.now() timestamp when `curr` arrived. */
  currAt = 0;
  /** Effects from every received tick, drained by the renderer. */
  events: SimEvent[] = [];

  constructor(cfg: GameConfig, ai: AiSetup[] = []) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<Snapshot>) => {
      this.prev = this.curr ?? e.data;
      this.curr = e.data;
      this.currAt = performance.now();
      if (e.data.events.length > 0) this.events.push(...e.data.events);
    };
    this.post({ type: 'init', cfg, ai });
  }

  private post(m: ToWorker): void {
    this.worker.postMessage(m);
  }

  send(cmd: Command): void {
    this.post({ type: 'cmd', cmd });
  }

  setSpeed(value: number): void {
    this.post({ type: 'speed', value });
  }

  setPaused(value: boolean): void {
    this.post({ type: 'pause', value });
  }
}
