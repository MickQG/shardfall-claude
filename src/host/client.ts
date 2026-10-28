import type { Command, GameConfig, Snapshot } from '../sim';
import type { ToWorker } from './worker';

/** Main-thread handle to the simulation running in a Web Worker. */
export class SimClient {
  private worker: Worker;
  prev: Snapshot | null = null;
  curr: Snapshot | null = null;
  /** performance.now() timestamp when `curr` arrived. */
  currAt = 0;

  constructor(cfg: GameConfig) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<Snapshot>) => {
      this.prev = this.curr ?? e.data;
      this.curr = e.data;
      this.currAt = performance.now();
    };
    this.post({ type: 'init', cfg });
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
