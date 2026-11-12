import { Lockstep } from '../net/lockstep';
import type { NetMsg } from '../net/protocol';
import { DrawClock } from '../render/interp';
import type { Command, GameConfig, SimEvent, Snapshot } from '../sim';
import type { AiSetup } from './runner';
import type { HashReport, ToWorker } from './worker';

/** Online play (NET-2): this browser's seat, how to reach the other player, and what to do on a desync. */
export interface NetLink {
  me: 0 | 1;
  send(msg: NetMsg): void;
  desync(tick: number): void;
}

/** Main-thread handle to the simulation running in a Web Worker. */
export class SimClient {
  private worker: Worker;
  /** Lockstep with the other player in an online match; null when playing alone. */
  private lockstep: Lockstep | null = null;
  prev: Snapshot | null = null;
  curr: Snapshot | null = null;
  /** performance.now() timestamp when `curr` arrived. */
  currAt = 0;
  /** Where units are drawn between the snapshots received (R3D-10). */
  readonly draw = new DrawClock();
  /** Effects from every received tick, drained by the renderer. */
  events: SimEvent[] = [];

  /** Held at its first tick until `start` (UI-12). */
  private held: boolean;

  /**
   * With `hold`, the game waits at tick 0 (its first snapshot is still sent, for the page to build the view from) and
   * only begins, online included, when `start` is called: nothing happens before the player can see and control it.
   */
  constructor(cfg: GameConfig, ai: AiSetup[] = [], opts: { viewer?: number; net?: NetLink; hold?: boolean } = {}) {
    this.held = !!opts.hold;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const net = opts.net;
    if (net) this.lockstep = new Lockstep(net.me, { send: (m) => net.send(m), deliver: (n, cmds) => this.post({ type: 'turn', n, cmds }), desync: (t) => net.desync(t) });
    this.worker.onmessage = (e: MessageEvent<Snapshot | HashReport>) => {
      const d = e.data;
      if ('hashReport' in d) {
        this.lockstep?.localHash(d.tick, d.h);
        return;
      }
      this.prev = this.curr ?? d;
      this.curr = d;
      this.currAt = performance.now();
      this.draw.push(d.tick, d.units, this.currAt);
      if (d.events.length > 0) this.events.push(...d.events);
      this.lockstep?.progress(d.tick);
    };
    this.post({ type: 'init', cfg, ai, viewer: opts.viewer ?? 0, lockstep: !!net, held: this.held });
    if (!this.held) this.lockstep?.start();
  }

  private post(m: ToWorker): void {
    this.worker.postMessage(m);
  }

  /** Begin a game created with `hold` (UI-12); online, the first turns are announced only now. */
  start(): void {
    if (!this.held) return;
    this.held = false;
    this.post({ type: 'go' });
    this.lockstep?.start();
  }

  /** Stop the simulation for good (an online match that ended outside the game, NET-3, NET-4). */
  stop(): void {
    this.worker.terminate();
    this.lockstep = null;
  }

  /** Online: the measured one-way latency to the other player, which sets the input delay (NET-2). */
  setLatency(oneWayMs: number): void {
    this.lockstep?.setLatency(oneWayMs);
  }

  /** Online: the input delay in turns (NET-2), or 0 when playing alone. */
  get delay(): number {
    return this.lockstep?.delay ?? 0;
  }

  /** Online: whether the game is held up waiting for the other player's turn. */
  get waiting(): boolean {
    return this.lockstep?.waiting ?? false;
  }

  get online(): boolean {
    return this.lockstep !== null;
  }

  /** A message from the other player (online play). */
  receive(msg: NetMsg): void {
    this.lockstep?.receive(msg);
  }

  send(cmd: Command): void {
    if (this.lockstep) this.lockstep.queue(cmd);
    else this.post({ type: 'cmd', cmd });
  }

  /** Speed and pause apply only when playing alone: an online match runs at real time for both players. */
  setSpeed(value: number): void {
    if (!this.lockstep) this.post({ type: 'speed', value });
  }

  setPaused(value: boolean): void {
    if (!this.lockstep) this.post({ type: 'pause', value });
  }
}
