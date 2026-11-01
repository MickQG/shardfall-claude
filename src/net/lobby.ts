import { NET_VERSION, type MatchSetup, type NetMsg } from './protocol';
import type { Transport } from './transport';

/** A match both players have agreed on, ready to start (NET-1). */
export interface Match {
  transport: Transport;
  me: 0 | 1;
  /** The other player's user id: only their messages count. */
  peer: string;
  setup: MatchSetup;
  room: string;
}

/** How often a guest asks to join, and how long it waits for a host before giving up. */
export const HELLO_EVERY_MS = 1000;
export const JOIN_TIMEOUT_MS = 20_000;

export interface Pending {
  match: Promise<Match>;
  cancel(): void;
}

/**
 * Host a room (NET-1): wait for the first guest of the same version, welcome them with the match and start. A guest of
 * another version is told so; anyone who asks after the start is told the room is full (`fromPeer`).
 */
export function hostRoom(transport: Transport, room: string, setup: MatchSetup): Pending {
  let cancel = (): void => undefined;
  const match = new Promise<Match>((resolve, reject) => {
    transport.setHandler((msg: NetMsg, from: string) => {
      if (msg.t !== 'hello') return;
      if (msg.v !== NET_VERSION) return transport.send({ t: 'refuse', to: from, why: 'version' });
      transport.send({ t: 'welcome', v: NET_VERSION, to: from, setup });
      // Keep whatever the guest sends next (its first turns) until the game takes over.
      transport.setHandler(null);
      resolve({ transport, me: 0, peer: from, setup, room });
    });
    cancel = () => {
      transport.setHandler(null);
      reject(new Error('cancelled'));
    };
  });
  return { match, cancel };
}

/** Join a room (NET-1): ask the host until welcomed, refused, or no host answers in time. */
/** Timers for the lobby, injectable for tests. */
export interface Timers {
  every(fn: () => void, ms: number): unknown;
  after(fn: () => void, ms: number): unknown;
  clearEvery(id: unknown): void;
  clearAfter(id: unknown): void;
}

/** The browser's timers, each called as a plain function (as a method of another object they throw "Illegal invocation"). */
const realTimers: Timers = {
  every: (fn, ms) => setInterval(fn, ms),
  after: (fn, ms) => setTimeout(fn, ms),
  clearEvery: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  clearAfter: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export function joinRoom(transport: Transport, room: string, timers: Timers = realTimers): Pending {
  let cancel = (): void => undefined;
  const match = new Promise<Match>((resolve, reject) => {
    const hello = (): void => transport.send({ t: 'hello', v: NET_VERSION });
    const done = (): void => {
      timers.clearEvery(ask);
      timers.clearAfter(give);
      transport.setHandler(null);
    };
    const ask = timers.every(hello, HELLO_EVERY_MS);
    const give = timers.after(() => {
      done();
      reject(new Error('Nobody is hosting that room. Check the code with your friend.'));
    }, JOIN_TIMEOUT_MS);
    transport.setHandler((msg: NetMsg, from: string) => {
      if (msg.t === 'welcome' && msg.to === transport.userId) {
        if (msg.v !== NET_VERSION) {
          done();
          reject(new Error('Your friend is on a different version of the game. Both of you should reload the page.'));
          return;
        }
        done();
        resolve({ transport, me: 1, peer: from, setup: msg.setup, room });
      } else if (msg.t === 'refuse' && msg.to === transport.userId) {
        done();
        reject(new Error(msg.why === 'full' ? 'That room already has two players.' : 'Your friend is on a different version of the game. Both of you should reload the page.'));
      }
    });
    hello();
    cancel = () => {
      done();
      reject(new Error('cancelled'));
    };
  });
  return { match, cancel };
}

/**
 * Whose message is this, in a started match (NET-5)? Only the opponent's count; anyone else who asks to join is told the
 * room already has two players, and everything else from them is ignored.
 */
export function fromPeer(m: Pick<Match, 'peer' | 'transport'>, msg: NetMsg, from: string): boolean {
  if (from === m.peer) return true;
  if (msg.t === 'hello') m.transport.send({ t: 'refuse', to: from, why: 'full' });
  return false;
}

/** The match this page is playing, handed from the menu to the game without reloading (the connection stays open). */
let active: Match | null = null;
export const setActiveMatch = (m: Match | null): void => {
  active = m;
};
export const activeMatch = (): Match | null => active;
