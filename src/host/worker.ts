/// <reference lib="webworker" />
import type { Command, GameConfig } from '../sim';
import { SimRunner, TICK_MS, type AiSetup } from './runner';

export type ToWorker =
  | { type: 'init'; cfg: GameConfig; ai: AiSetup[]; viewer?: number; lockstep?: boolean }
  | { type: 'cmd'; cmd: Command }
  | { type: 'turn'; n: number; cmds: Command[] }
  | { type: 'speed'; value: number }
  | { type: 'pause'; value: boolean };

/** A state checksum from the worker in online play (NET-3); every other message from it is a Snapshot. */
export interface HashReport {
  hashReport: true;
  tick: number;
  h: number;
}

let runner: SimRunner | null = null;
let last = 0;

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'init') {
    runner = new SimRunner(m.cfg, (s) => self.postMessage(s), m.viewer ?? 0, m.ai);
    if (m.lockstep) {
      runner.lockstep();
      runner.onHash = (tick, h) => self.postMessage({ hashReport: true, tick, h } satisfies HashReport);
    }
    last = Date.now();
    setInterval(() => {
      const now = Date.now();
      runner?.advance(now - last);
      last = now;
    }, TICK_MS / 2);
  } else if (m.type === 'cmd') runner?.send(m.cmd);
  else if (m.type === 'turn') runner?.turn(m.n, m.cmds);
  else if (m.type === 'speed' && runner) runner.speed = m.value;
  else if (m.type === 'pause' && runner) runner.paused = m.value;
};
