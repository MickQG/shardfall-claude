import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SimClient } from '../../src/host/client';
import { LatencyMeter, LATENCY_SAMPLES, PING_EVERY_MS } from '../../src/net/latency';
import type { Match } from '../../src/net/lobby';
import { Lockstep } from '../../src/net/lockstep';
import { delayFor, DELAY_TURNS, JITTER_MS, MAX_DELAY_TURNS, MIN_DELAY_TURNS, parseMessage, TURN_MS, TURN_TICKS, type NetMsg } from '../../src/net/protocol';
import { END_GRACE_MS, OnlineWatch, type EndReason } from '../../src/net/watch';

describe('online input delay', () => {
  it('NET-2 UX-3: turns are 125 ms at the online speed; the input delay fits the measured one-way latency plus jitter slack, within bounds', () => {
    expect(TURN_TICKS).toBe(2);
    expect(TURN_MS).toBe(125);
    expect(delayFor(0)).toBe(MIN_DELAY_TURNS);
    expect(delayFor(30)).toBe(1); // a good connection: one turn from click to effect
    expect(delayFor(TURN_MS - JITTER_MS + 1)).toBe(2);
    expect(delayFor(2 * TURN_MS - JITTER_MS + 1)).toBe(3);
    expect(delayFor(5000)).toBe(MAX_DELAY_TURNS);
    expect(delayFor(-20)).toBe(MIN_DELAY_TURNS);
    expect(DELAY_TURNS).toBe(2); // until the first round trip is measured
  });

  it('NET-2: the latency meter reports half the slowest of the recent round trips', () => {
    const m = new LatencyMeter();
    expect(m.oneWay()).toBeNull();
    m.add(40);
    m.add(120);
    m.add(60);
    expect(m.oneWay()).toBe(60);
    for (let i = 0; i < LATENCY_SAMPLES; i++) m.add(50); // the slow one ages out
    expect(m.oneWay()).toBe(25);
    m.add(Number.NaN);
    m.add(-5);
    expect(m.oneWay()).toBe(25);
  });

  it('NET-2: with a fitted delay of one turn, an order is announced for the very next turn', () => {
    const sent: NetMsg[] = [];
    const ls = new Lockstep(0, { send: (m) => sent.push(m), deliver: () => undefined, desync: () => undefined });
    ls.start();
    expect(sent.filter((m) => m.t === 'turn').map((m) => (m as { n: number }).n)).toEqual([0, 1, 2]); // DELAY_TURNS ahead
    ls.setLatency(20);
    expect(ls.delay).toBe(1);
    // The game reaches turn 2: nothing new until it has caught up with the turns already announced, then one ahead.
    ls.queue({ type: 'stop', player: 0, units: [1] });
    ls.progress(2 * TURN_TICKS);
    const last = sent.filter((m) => m.t === 'turn').at(-1) as { n: number; c: unknown[] };
    expect(last.n).toBe(3);
    expect(last.c).toHaveLength(1);
    // A slower connection raises the delay at once: more turns are announced ahead.
    ls.setLatency(200);
    ls.progress(2 * TURN_TICKS);
    expect((sent.filter((m) => m.t === 'turn').at(-1) as { n: number }).n).toBe(2 + delayFor(200));
  });

  it('NET-2 NET-5: round-trip probes and an ended-game goodbye are well-formed messages', () => {
    expect(parseMessage({ t: 'ping', id: 1234 })).toEqual({ t: 'ping', id: 1234 });
    expect(parseMessage({ t: 'pong', id: 7 })).toEqual({ t: 'pong', id: 7 });
    expect(parseMessage({ t: 'ping', id: -1 })).toBeNull();
    expect(parseMessage({ t: 'pong', id: 'x' })).toBeNull();
    expect(parseMessage({ t: 'bye', end: 900 })).toEqual({ t: 'bye', end: 900 });
    expect(parseMessage({ t: 'bye' })).toEqual({ t: 'bye' });
    expect(parseMessage({ t: 'bye', end: 'soon' })).toEqual({ t: 'bye' });
  });
});

describe('online match ends', () => {
  /** Just enough of a browser page for the watch: a banner element, timers we run by hand, and a clock. */
  const g = globalThis as unknown as Record<string, unknown>;
  let saved: Record<string, unknown>;
  let tickers: (() => void)[];
  let clock: number;
  beforeEach(() => {
    saved = { document: g.document, window: g.window, performance: g.performance };
    tickers = [];
    clock = 1000;
    const el = () => ({ style: {} as Record<string, string>, setAttribute: () => undefined, textContent: '' });
    g.document = { createElement: el, body: { appendChild: () => undefined } };
    g.window = { addEventListener: () => undefined, setInterval: (f: () => void) => tickers.push(f), clearInterval: () => undefined };
    Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true });
  });
  afterEach(() => {
    g.document = saved.document;
    g.window = saved.window;
    Object.defineProperty(globalThis, 'performance', { value: saved.performance, configurable: true });
  });

  /** A watch over a fake connection and game: what it sent, how it ended, and the latency it handed the game. */
  function watched() {
    const sent: NetMsg[] = [];
    let handler: ((msg: NetMsg, from: string) => void) | null = null;
    const transport = { userId: 'me', send: (m: NetMsg) => sent.push(m), setHandler: (h: typeof handler) => (handler = h), onClose: null, close: () => undefined };
    const ended: EndReason[] = [];
    const latency: number[] = [];
    const sim = { receive: () => undefined, setLatency: (ms: number) => latency.push(ms), stop: () => undefined, waiting: false } as unknown as SimClient;
    const w = new OnlineWatch({ transport, me: 0, peer: 'them', setup: { seed: 1, map: 'crossroads', factions: ['human', 'alien'] }, room: 'ABCDEF' } as unknown as Match, { end: (why) => ended.push(why) });
    w.attach(sim);
    const from = (m: NetMsg): void => handler?.(m, 'them');
    const tick = (ms: number): void => {
      clock += ms;
      tickers.forEach((f) => f());
    };
    return { w, sent, ended, latency, from, tick };
  }

  it('NET-4: a goodbye because the opponent game ended does not count as leaving: this game plays on to the same end', () => {
    const m = watched();
    m.from({ t: 'bye', end: 1234 });
    m.tick(250);
    expect(m.ended).toEqual([]);
    // Our game reaches the end itself and says so in its own goodbye.
    m.w.finished(1234);
    expect(m.sent.at(-1)).toEqual({ t: 'bye', end: 1234 });
    m.tick(END_GRACE_MS + 1000);
    expect(m.ended).toEqual([]);
  });

  it('NET-4: leaving the page still ends the match at once; an ended game that never catches up counts as left after a grace period', () => {
    const left = watched();
    left.from({ t: 'bye' });
    expect(left.ended).toEqual(['left']);

    const stuck = watched();
    stuck.from({ t: 'bye', end: 50 });
    stuck.tick(END_GRACE_MS - 500);
    expect(stuck.ended).toEqual([]);
    stuck.tick(1000);
    expect(stuck.ended).toEqual(['left']);
  });

  it('NET-2: the watch probes the round trip every second, answers probes, and fits the input delay to it', () => {
    const m = watched();
    m.tick(PING_EVERY_MS);
    const ping = m.sent.find((s) => s.t === 'ping') as { id: number };
    expect(ping).toBeDefined();
    clock += 80; // the pong comes back 80 ms later
    m.from({ t: 'pong', id: ping.id });
    expect(m.latency).toEqual([40]);
    m.from({ t: 'ping', id: 99 });
    expect(m.sent.at(-1)).toEqual({ t: 'pong', id: 99 });
  });
});
