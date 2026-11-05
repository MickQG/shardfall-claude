import type { NetLink, SimClient } from '../host/client';
import { LatencyMeter, PING_EVERY_MS } from './latency';
import { fromPeer, type Match } from './lobby';

/** Why an online match ended outside the simulation (NET-3, NET-4). */
export type EndReason = 'left' | 'timeout' | 'lost' | 'desync';

/** The game is held up and nothing has come from the opponent for this long: say so (NET-4). */
export const WAIT_NOTICE_MS = 1000;
/** Nothing from the opponent for this long: they are gone, and the player who stayed wins (NET-4). Before their game has
 * sent anything at all (it may still be loading on a slow machine), twice as long. */
export const GIVE_UP_MS = 30_000;
/**
 * After the opponent's game says it ended, ours plays on to the same end; if it has not got there in this long (it
 * should within moments), the opponent is taken to have left (NET-4).
 */
export const END_GRACE_MS = 15_000;

/** What the watch shows while the game waits for the opponent (pure, for tests). */
export function waitText(silentMs: number, limitMs = GIVE_UP_MS): string {
  if (silentMs < 5000) return 'Waiting for your opponent';
  const left = Math.max(0, Math.ceil((limitMs - silentMs) / 1000));
  return `Your opponent is not responding · you win in ${left} s if they do not return`;
}

/**
 * Looks after an online match's connection (NET-1..4): routes the opponent's messages to the simulation, turns away
 * anyone else in the room, shows when the game waits for the opponent, and ends the match when they leave, go silent,
 * the connection drops or the two games desync.
 */
export class OnlineWatch {
  readonly link: NetLink;
  private sim: SimClient | null = null;
  private lastHeard = performance.now();
  private done = false;
  private heard = false;
  private timer = 0;
  private banner: HTMLDivElement | null = null;
  private latency = new LatencyMeter();
  private lastPing = 0;
  /** When the opponent's game said it had ended (NET-4), or null. */
  private peerEndedAt: number | null = null;

  constructor(
    private match: Match,
    private hooks: { end(why: EndReason, tick?: number): void },
  ) {
    this.link = { me: match.me, send: (m) => match.transport.send(m), desync: (tick) => this.stop('desync', tick) };
  }

  attach(sim: SimClient): void {
    this.sim = sim;
    const t = this.match.transport;
    t.onClose = () => this.stop('lost');
    t.setHandler((msg, from) => {
      if (!fromPeer(this.match, msg, from)) return;
      this.lastHeard = performance.now();
      this.heard = true;
      if (msg.t === 'bye') {
        // Their game ended (NET-4): ours, a few turns behind, plays on to the same end and shows its own result.
        if (msg.end !== undefined) this.peerEndedAt ??= performance.now();
        else this.stop('left');
      } else if (msg.t === 'ping') t.send({ t: 'pong', id: msg.id });
      else if (msg.t === 'pong') {
        // Round trip measured against our own clock (the id is our send time): fit the input delay to it (NET-2).
        this.latency.add(Math.round(performance.now()) - msg.id);
        const oneWay = this.latency.oneWay();
        if (oneWay !== null) sim.setLatency(oneWay);
      } else if (msg.t === 'turn' || msg.t === 'hash') sim.receive(msg);
    });
    window.addEventListener('pagehide', () => {
      if (!this.done) t.send({ t: 'bye' });
    });
    this.banner = document.createElement('div');
    this.banner.id = 'net-wait';
    this.banner.setAttribute('role', 'status');
    this.banner.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:30;display:none;padding:10px 18px;border-radius:10px;background:rgba(8,12,17,.92);border:1px solid #6b5520;color:#ffe08a;font:600 14px/1.3 system-ui,sans-serif;pointer-events:none';
    document.body.appendChild(this.banner);
    this.timer = window.setInterval(() => this.check(), 250);
  }

  /** The match ended in the game itself, at `tick`: nothing more to watch; the opponent's game plays on to it (NET-4). */
  finished(tick: number): void {
    if (this.done) return;
    this.done = true;
    window.clearInterval(this.timer);
    if (this.banner) this.banner.style.display = 'none';
    this.match.transport.send({ t: 'bye', end: tick });
  }

  private check(): void {
    if (this.done || !this.sim || !this.banner) return;
    const now = performance.now();
    if (now - this.lastPing >= PING_EVERY_MS) {
      this.lastPing = now;
      this.match.transport.send({ t: 'ping', id: Math.round(now) });
    }
    if (this.peerEndedAt !== null && now - this.peerEndedAt > END_GRACE_MS) return this.stop('left');
    const silent = now - this.lastHeard;
    const limit = this.heard ? GIVE_UP_MS : GIVE_UP_MS * 2;
    if (silent > limit) return this.stop('timeout');
    const show = this.sim.waiting && silent > WAIT_NOTICE_MS;
    this.banner.style.display = show ? 'block' : 'none';
    if (show) this.banner.textContent = waitText(silent, limit);
  }

  private stop(why: EndReason, tick?: number): void {
    if (this.done) return;
    this.done = true;
    window.clearInterval(this.timer);
    if (this.banner) this.banner.style.display = 'none';
    this.sim?.stop();
    this.match.transport.onClose = null;
    this.match.transport.close();
    this.hooks.end(why, tick);
  }
}
