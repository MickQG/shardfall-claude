import type { Command } from '../sim';
import { DELAY_TURNS, MAX_CMDS_PER_TURN, sanitizeCommand, TURN_TICKS, type NetMsg } from './protocol';

/** What lockstep needs from its surroundings: a way to send, and where complete turns and desyncs go. */
export interface LockstepHooks {
  send(msg: NetMsg): void;
  /** Both players' commands for turn `n`, player 0's first, each in the order issued (NET-2). */
  deliver(n: number, cmds: Command[]): void;
  /** The two simulations disagree after `tick` ticks (NET-3). */
  desync(tick: number): void;
}

/** Turns further ahead than this are not accepted from the peer (a flood guard; real peers are never that far ahead). */
const MAX_AHEAD = 64;

/**
 * Deterministic lockstep for two players (NET-2, NET-3). Time is split into turns of TURN_TICKS ticks. Each player
 * announces its commands for turn `k` once its own simulation has reached turn `k - DELAY_TURNS`, sending a turn
 * message even when it is empty, so the other side knows it may go on. A turn is handed to the simulation only when
 * both players' messages for it have arrived, so both simulations apply exactly the same commands on the same tick.
 * Pure: no timers, sockets or DOM; the caller feeds it messages and progress.
 */
export class Lockstep {
  private mine = new Map<number, Command[]>();
  private theirs = new Map<number, Command[]>();
  private queued: Command[] = [];
  /** Highest turn announced, and the next turn to hand to the simulation. */
  private sent = -1;
  private next = 0;
  private myHashes = new Map<number, number>();
  private theirHashes = new Map<number, number>();
  private desynced = false;
  readonly peer: 0 | 1;

  constructor(
    readonly me: 0 | 1,
    private hooks: LockstepHooks,
  ) {
    this.peer = me === 0 ? 1 : 0;
  }

  /** Announce the first turns, so both sides can start at once. */
  start(): void {
    this.progress(0);
  }

  /**
   * A local order: it is sent in the next turn announced. It goes through the same JSON round trip and checks as the
   * peer's copy, so both sides apply byte-identical commands.
   */
  queue(cmd: Command): void {
    if (this.queued.length >= MAX_CMDS_PER_TURN * 4) return;
    const clean = sanitizeCommand(JSON.parse(JSON.stringify(cmd)) as unknown, this.me);
    if (clean) this.queued.push(clean);
  }

  /** The local simulation has run `tick` ticks: announce every turn up to DELAY_TURNS ahead of the current one. */
  progress(tick: number): void {
    const current = Math.floor(tick / TURN_TICKS);
    while (this.sent < current + DELAY_TURNS) {
      const n = ++this.sent;
      const c = this.queued.splice(0, MAX_CMDS_PER_TURN);
      this.mine.set(n, c);
      this.hooks.send({ t: 'turn', n, c });
    }
    this.flush();
  }

  /** A message from the peer (already parsed and checked to come from the peer). */
  receive(msg: NetMsg): void {
    if (msg.t === 'turn') {
      if (msg.n < this.next || msg.n > this.next + MAX_AHEAD || this.theirs.has(msg.n)) return;
      const cmds: Command[] = [];
      for (const raw of msg.c) {
        const c = sanitizeCommand(raw, this.peer);
        if (c) cmds.push(c);
      }
      this.theirs.set(msg.n, cmds);
      this.flush();
    } else if (msg.t === 'hash') {
      this.theirHashes.set(msg.tick, msg.h);
      this.compare(msg.tick);
    }
  }

  /** The local simulation's checksum after `tick` ticks: sent to the peer and compared with theirs (NET-3). */
  localHash(tick: number, h: number): void {
    this.myHashes.set(tick, h);
    this.hooks.send({ t: 'hash', tick, h });
    this.compare(tick);
  }

  /** Whether the simulation is held up by the peer: our next turn is ready but theirs has not arrived. */
  get waiting(): boolean {
    return this.mine.has(this.next) && !this.theirs.has(this.next);
  }

  /** The next turn the simulation needs. */
  get nextTurn(): number {
    return this.next;
  }

  private flush(): void {
    for (;;) {
      const a = this.mine.get(this.next);
      const b = this.theirs.get(this.next);
      if (!a || !b) return;
      const [p0, p1] = this.me === 0 ? [a, b] : [b, a];
      this.mine.delete(this.next);
      this.theirs.delete(this.next);
      this.hooks.deliver(this.next, [...p0, ...p1]);
      this.next++;
    }
  }

  private compare(tick: number): void {
    const a = this.myHashes.get(tick);
    const b = this.theirHashes.get(tick);
    if (a === undefined || b === undefined) return;
    this.myHashes.delete(tick);
    this.theirHashes.delete(tick);
    if (a !== b && !this.desynced) {
      this.desynced = true;
      this.hooks.desync(tick);
    }
  }
}
