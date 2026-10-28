/// <reference lib="webworker" />
import type { Command, GameConfig } from '../sim';
import { SimRunner, TICK_MS } from './runner';

export type ToWorker = { type: 'init'; cfg: GameConfig } | { type: 'cmd'; cmd: Command } | { type: 'speed'; value: number } | { type: 'pause'; value: boolean };

let runner: SimRunner | null = null;
let last = 0;

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'init') {
    runner = new SimRunner(m.cfg, (s) => self.postMessage(s));
    last = Date.now();
    setInterval(() => {
      const now = Date.now();
      runner?.advance(now - last);
      last = now;
    }, TICK_MS / 2);
  } else if (m.type === 'cmd') runner?.send(m.cmd);
  else if (m.type === 'speed' && runner) runner.speed = m.value;
  else if (m.type === 'pause' && runner) runner.paused = m.value;
};
