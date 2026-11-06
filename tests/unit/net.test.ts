import { describe, expect, it } from 'vitest';
import { skirmishConfig } from '../../src/data/maps';
import { SimRunner, TICK_MS } from '../../src/host/runner';
import { fromPeer, hostRoom, HELLO_EVERY_MS, joinRoom, JOIN_TIMEOUT_MS } from '../../src/net/lobby';
import { Lockstep } from '../../src/net/lockstep';
import { DELAY_TURNS, HASH_EVERY, MAX_CMDS_PER_TURN, MAX_IDS, NET_VERSION, normalizeCode, parseMessage, ROOM_CODE, sanitizeCommand, TURN_TICKS, type NetMsg } from '../../src/net/protocol';
import type { Transport } from '../../src/net/transport';
import { GIVE_UP_MS, waitText } from '../../src/net/watch';
import { FP, type Command, type Snapshot } from '../../src/sim';

/** A seeded generator for network delays (tests only). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

interface Side {
  runner: SimRunner;
  ls: Lockstep;
  snap: Snapshot | null;
  delivered: string[];
  hashes: Map<number, number>;
  desyncs: number[];
}

/**
 * Two complete simulations in lockstep over a fake network (NET-2): every message goes through JSON and
 * `parseMessage`, arrives after a random delay (so messages overtake each other), and `drop` can lose some.
 */
function match(opts: { seed?: number; jitter?: number; drop?: (from: number, m: NetMsg) => boolean; tamper?: (me: number, n: number, cmds: Command[]) => Command[] } = {}) {
  const cfg = skirmishConfig(opts.seed ?? 11, { factions: ['human', 'alien'], map: 'crossroads' });
  const rnd = lcg(opts.seed ?? 11);
  let now = 0;
  const wire: { to: number; at: number; data: unknown }[] = [];
  const sides: Side[] = [];
  for (const me of [0, 1] as const) {
    const side = { snap: null, delivered: [], hashes: new Map(), desyncs: [] } as unknown as Side;
    side.runner = new SimRunner(cfg, (s) => {
      side.snap = s;
      side.ls?.progress(s.tick);
    }, me);
    side.runner.lockstep();
    side.ls = new Lockstep(me, {
      send: (m) => {
        if (opts.drop?.(me, m)) return;
        wire.push({ to: 1 - me, at: now + 5 + rnd() * (opts.jitter ?? 120), data: JSON.parse(JSON.stringify(m)) });
      },
      deliver: (n, cmds) => {
        side.delivered.push(JSON.stringify([n, cmds]));
        side.runner.turn(n, opts.tamper ? opts.tamper(me, n, cmds) : cmds);
      },
      desync: (t) => side.desyncs.push(t),
    });
    side.runner.onHash = (t, h) => {
      side.hashes.set(t, h);
      side.ls.localHash(t, h);
    };
    sides.push(side);
  }
  for (const s of sides) s.ls.start();
  const step = (ms: number): void => {
    now += ms;
    for (let i = 0; i < wire.length; ) {
      const w = wire[i]!;
      if (w.at <= now) {
        wire.splice(i, 1);
        const msg = parseMessage(w.data);
        if (msg) sides[w.to]!.ls.receive(msg);
      } else i++;
    }
    for (const s of sides) s.runner.advance(ms);
  };
  return { sides, step, now: () => now };
}

/** Orders a player might give: move squads around, build, and attack-move toward the enemy. */
function orders(s: Side, me: number, tick: number): void {
  const snap = s.snap;
  if (!snap) return;
  const mine = snap.units.filter((u) => u.owner === me).map((u) => u.id);
  const hq = snap.buildings.find((b) => b.owner === me && b.kind.endsWith('_hq'));
  if (tick % 90 === 0 && mine.length) s.ls.queue({ type: 'move', player: me, units: mine.slice(1), x: ((10 + (tick % 13)) * FP) | 0, y: ((12 + (tick % 7)) * FP) | 0 });
  if (tick % 150 === 0 && hq) s.ls.queue({ type: 'produce', player: me, source: hq.id, kind: me === 0 ? 'hum_reactor' : 'ali_generator' });
  if (tick % 400 === 0 && mine.length) s.ls.queue({ type: 'attackmove', player: me, units: mine, x: 18 * FP, y: 18 * FP });
}

describe('online lockstep', () => {
  it('NET-2: two simulations given the same turns over a jittery, reordering network stay identical', () => {
    const m = match({ jitter: 140 });
    let lastOrder = -1;
    while (Math.min(...m.sides.map((s) => s.snap?.tick ?? 0)) < 1200) {
      const t = m.sides[0]!.snap?.tick ?? 0;
      if (t !== lastOrder) {
        lastOrder = t;
        m.sides.forEach((s, me) => orders(s, me, t));
      }
      m.step(10);
      expect(m.now()).toBeLessThan(400_000);
    }
    const [a, b] = m.sides as [Side, Side];
    // The same turns, with the same commands in the same order, reached both simulations.
    const n = Math.min(a.delivered.length, b.delivered.length);
    expect(n).toBeGreaterThan(390);
    expect(a.delivered.slice(0, n)).toEqual(b.delivered.slice(0, n));
    expect(a.delivered.some((d) => d.includes('"produce"')) && a.delivered.some((d) => d.includes('"move"'))).toBe(true);
    // Both players' orders are in it, player 0's first within a turn.
    const both = a.delivered.find((d) => d.includes('"player":0') && d.includes('"player":1'))!;
    expect(both.indexOf('"player":0')).toBeLessThan(both.indexOf('"player":1'));
    // Their checksums agree at every check, and nobody saw a desync.
    let checks = 0;
    for (const [tick, h] of a.hashes) {
      if (!b.hashes.has(tick)) continue;
      expect(b.hashes.get(tick), `tick ${tick}`).toBe(h);
      checks++;
    }
    expect(checks).toBeGreaterThanOrEqual(1200 / HASH_EVERY - 1);
    expect(a.desyncs).toEqual([]);
    expect(b.desyncs).toEqual([]);
  }, 60_000);

  it('NET-2: a simulation never runs past a turn it has not received from the other player', () => {
    // Player 1's turn 30 never arrives.
    const m = match({ drop: (from, msg) => from === 1 && msg.t === 'turn' && msg.n === 30 });
    for (let i = 0; i < 3000; i++) m.step(10);
    const [a, b] = m.sides as [Side, Side];
    expect(a.snap!.tick).toBe(30 * TURN_TICKS);
    expect(a.runner.stalled).toBe(true);
    expect(a.ls.waiting).toBe(true);
    // Player 1 is held up too, a little later (it is waiting on player 0, who is stuck), never desynced.
    expect(b.snap!.tick).toBeLessThanOrEqual((30 + DELAY_TURNS + 1) * TURN_TICKS);
    expect(a.desyncs.concat(b.desyncs)).toEqual([]);
  }, 60_000);

  it('NET-3: when one simulation diverges, both detect it at the next checksum', () => {
    // Player 0's game applies an extra order in turn 50 that player 1's never sees.
    const m = match({ tamper: (me, n, cmds) => (me === 0 && n === 50 ? [...cmds, { type: 'produce', player: 0, source: 1, kind: 'hum_reactor' }, { type: 'move', player: 0, units: [8, 9, 10, 11, 12, 13, 14, 15], x: 30 * FP, y: 5 * FP }] : cmds) });
    for (let i = 0; i < 8000 && m.sides.some((s) => s.desyncs.length === 0); i++) m.step(10);
    const [a, b] = m.sides as [Side, Side];
    expect(a.desyncs.length).toBe(1);
    expect(b.desyncs.length).toBe(1);
    // Caught at the first checksum after the change.
    expect(a.desyncs[0]).toBe(Math.ceil((50 * TURN_TICKS + 1) / HASH_EVERY) * HASH_EVERY);
    expect(b.desyncs[0]).toBe(a.desyncs[0]);
  }, 60_000);

  it('NET-5: commands from the other player are rebuilt for their seat: a tampered game can only order its own side', () => {
    const got: Command[][] = [];
    const ls = new Lockstep(0, { send: () => undefined, deliver: (_n, c) => got.push(c), desync: () => undefined });
    ls.start();
    ls.receive({ t: 'turn', n: 0, c: [{ type: 'move', player: 0, units: [1, 2], x: 10, y: 20, extra: 'x' } as unknown as Command, { type: 'nuke', player: 1 } as unknown as Command, { type: 'sell', player: 1, building: -4 } as unknown as Command] });
    expect(got[0]).toEqual([{ type: 'move', player: 1, units: [1, 2], x: 10, y: 20 }]);
    // Duplicates and turns far ahead are ignored.
    ls.receive({ t: 'turn', n: 0, c: [{ type: 'stop', player: 1, units: [3] }] });
    ls.receive({ t: 'turn', n: 500, c: [] });
    expect(got).toHaveLength(1);
  });

  it('NET-5: only well-formed messages of known types and bounded size get through', () => {
    expect(parseMessage({ t: 'turn', n: 3, c: [] })).toEqual({ t: 'turn', n: 3, c: [] });
    expect(parseMessage({ t: 'turn', n: -1, c: [] })).toBeNull();
    expect(parseMessage({ t: 'turn', n: 1.5, c: [] })).toBeNull();
    expect(parseMessage({ t: 'turn', n: 1, c: new Array(MAX_CMDS_PER_TURN + 1).fill({ type: 'noop' }) })).toBeNull();
    expect(parseMessage({ t: 'hash', tick: 60, h: 12345 })).toEqual({ t: 'hash', tick: 60, h: 12345 });
    expect(parseMessage({ t: 'hash', tick: '60', h: 1 })).toBeNull();
    expect(parseMessage({ t: 'welcome', v: 1, to: 'u1', setup: { seed: 5, map: 'riverbed', factions: ['alien', 'human'] } })).not.toBeNull();
    expect(parseMessage({ t: 'welcome', v: 1, to: 'u1', setup: { seed: 5, map: 'moon', factions: ['alien', 'human'] } })).toBeNull();
    expect(parseMessage({ t: 'welcome', v: 1, to: 'u1/../x', setup: { seed: 5, map: 'riverbed', factions: ['alien', 'human'] } })).toBeNull();
    expect(parseMessage({ t: 'refuse', to: 'u1', why: 'full' })).not.toBeNull();
    expect(parseMessage({ t: 'eval', code: 'x' })).toBeNull();
    expect(parseMessage('turn')).toBeNull();
    expect(parseMessage(null)).toBeNull();
    expect(sanitizeCommand({ type: 'produce', player: 0, source: 3, kind: 'hum_tank' }, 1)).toEqual({ type: 'produce', player: 1, source: 3, kind: 'hum_tank' });
    expect(sanitizeCommand({ type: 'produce', source: 3, kind: '<img src=x>' }, 1)).toBeNull();
    expect(sanitizeCommand({ type: 'move', units: new Array(MAX_IDS + 1).fill(1), x: 0, y: 0 }, 1)).toBeNull();
    expect(sanitizeCommand({ type: 'move', units: [1], x: 1e9, y: 0 }, 1)).toBeNull();
    expect(sanitizeCommand({ type: 'repair', building: 4, on: 'yes' }, 1)).toBeNull();
    expect(sanitizeCommand({ type: 'superweapon', building: 4, x: 100, y: 200 }, 0)).toEqual({ type: 'superweapon', player: 0, building: 4, x: 100, y: 200 });
  });

  it('NET-1: room codes are six characters without look-alikes; typed codes are tidied', () => {
    expect(ROOM_CODE.test('ABC234')).toBe(true);
    for (const bad of ['ABC23', 'ABC2345', 'ABCI23', 'ABCO23', 'ABC123', 'ABC0Z3', 'abc234']) expect(ROOM_CODE.test(bad), bad).toBe(false);
    expect(normalizeCode(' abc-234 ')).toBe('ABC234');
    expect(normalizeCode('abc 2l4')).toBeNull();
  });

  it('NET-4: the waiting notice counts down to the win once the opponent has been silent a while', () => {
    expect(waitText(1500)).toBe('Waiting for your opponent');
    expect(waitText(10_000)).toContain(`${(GIVE_UP_MS - 10_000) / 1000} s`);
    expect(waitText(10_000, GIVE_UP_MS * 2)).toContain(`${(GIVE_UP_MS * 2 - 10_000) / 1000} s`);
  });

  it('NET-2: the simulation applies nothing from direct commands in an online match, only whole turns', () => {
    const cfg = skirmishConfig(3, { factions: ['human', 'alien'], map: 'crossroads' });
    let snap: Snapshot | null = null;
    const r = new SimRunner(cfg, (s) => (snap = s), 0);
    r.lockstep();
    r.advance(TICK_MS * 5);
    expect(snap!.tick).toBe(0); // waits for turn 0
    r.turn(0, []);
    r.advance(TICK_MS * 5);
    expect(snap!.tick).toBe(TURN_TICKS);
  });
});

/** A fake room: transports that deliver to everyone else in it, as Web PubSub does for a group. */
function room() {
  const members: { id: string; handler: ((m: NetMsg, from: string) => void) | null; kept: [NetMsg, string][] }[] = [];
  const join = (id: string): Transport & { sent: NetMsg[] } => {
    const me = { id, handler: null as ((m: NetMsg, from: string) => void) | null, kept: [] as [NetMsg, string][] };
    members.push(me);
    const sent: NetMsg[] = [];
    return {
      userId: id,
      sent,
      send(msg) {
        sent.push(msg);
        const data = parseMessage(JSON.parse(JSON.stringify(msg)));
        if (!data) return;
        for (const o of members) {
          if (o === me) continue;
          if (o.handler) o.handler(data, id);
          else o.kept.push([data, id]);
        }
      },
      setHandler(h) {
        me.handler = h;
        while (h && me.kept.length) {
          const [m, f] = me.kept.shift()!;
          h(m, f);
        }
      },
      onClose: null,
      close() {},
    };
  };
  return { join };
}

/** Timers driven by hand. */
function clock() {
  let now = 0;
  let id = 0;
  const jobs = new Map<number, { at: number; every: number; fn: () => void }>();
  const timers = {
    every: (fn: () => void, ms: number) => (jobs.set(++id, { at: now + ms, every: ms, fn }), id),
    after: (fn: () => void, ms: number) => (jobs.set(++id, { at: now + ms, every: 0, fn }), id),
    clearEvery: (i: unknown) => void jobs.delete(i as number),
    clearAfter: (i: unknown) => void jobs.delete(i as number),
  };
  const run = (ms: number): void => {
    const end = now + ms;
    for (;;) {
      const next = [...jobs.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at;
      const [k, j] = next;
      if (j.every) j.at += j.every;
      else jobs.delete(k);
      j.fn();
    }
    now = end;
  };
  return { timers, run };
}

describe('online rooms', () => {
  const setup = { seed: 42, map: 'highlands' as const, factions: ['alien', 'human'] as ['alien', 'human'] };

  it('NET-1: a guest joins a hosted room and both get the same match, host as player 0 and guest as player 1', async () => {
    const r = room();
    const h = r.join('uhost');
    const g = r.join('uguest');
    const host = hostRoom(h, 'ABC234', setup);
    const c = clock();
    const guest = joinRoom(g, 'ABC234', c.timers);
    const [hm, gm] = await Promise.all([host.match, guest.match]);
    expect(hm).toMatchObject({ me: 0, peer: 'uguest', setup, room: 'ABC234' });
    expect(gm).toMatchObject({ me: 1, peer: 'uhost', setup, room: 'ABC234' });
    expect(g.sent[0]).toEqual({ t: 'hello', v: NET_VERSION });
  });

  it('NET-1: the guest keeps asking until a host appears, and gives up when nobody hosts', async () => {
    const r = room();
    const g = r.join('uguest');
    const c = clock();
    const guest = joinRoom(g, 'ABC234', c.timers);
    c.run(HELLO_EVERY_MS * 3 + 10);
    expect(g.sent.filter((m) => m.t === 'hello').length).toBe(4);
    const h = r.join('uhost');
    const host = hostRoom(h, 'ABC234', setup);
    c.run(HELLO_EVERY_MS);
    await expect(guest.match).resolves.toMatchObject({ me: 1 });
    await expect(host.match).resolves.toMatchObject({ me: 0 });

    const lonely = joinRoom(room().join('ux'), 'QQQQQQ', c.timers);
    c.run(JOIN_TIMEOUT_MS + 1);
    await expect(lonely.match).rejects.toThrow(/Nobody is hosting/);
  });

  it('NET-1 NET-5: a third player is told the room is full; another version is told so', async () => {
    const r = room();
    const h = r.join('uhost');
    const host = hostRoom(h, 'ABC234', setup);
    const old = r.join('uold');
    old.send({ t: 'hello', v: NET_VERSION + 1 });
    expect(h.sent.at(-1)).toEqual({ t: 'refuse', to: 'uold', why: 'version' });
    const c = clock();
    const g = r.join('uguest');
    await joinRoom(g, 'ABC234', c.timers).match;
    const m = await host.match;
    // In the match only the opponent counts; a newcomer asking to join is refused, and the rest of what they send ignored.
    expect(fromPeer(m, { t: 'turn', n: 0, c: [] }, 'uguest')).toBe(true);
    expect(fromPeer(m, { t: 'hello', v: NET_VERSION }, 'ulate')).toBe(false);
    expect(h.sent.at(-1)).toEqual({ t: 'refuse', to: 'ulate', why: 'full' });
    expect(fromPeer(m, { t: 'turn', n: 0, c: [] }, 'ulate')).toBe(false);
    expect(fromPeer(m, { t: 'bye' }, 'ulate')).toBe(false);
    // The newcomer's own lobby reports it.
    const r2 = room();
    const late = joinRoom(r2.join('ulate'), 'ABC234', c.timers);
    const fakeHost = r2.join('uhost');
    fakeHost.send({ t: 'refuse', to: 'ulate', why: 'full' });
    await expect(late.match).rejects.toThrow(/already has two players/);
  });
});

describe('fitted input delay', () => {
  it('NET-2: two games with different input delays, changing mid-match, still apply the same turns and stay identical', () => {
    const m = match({ jitter: 60 });
    let lastOrder = -1;
    while (Math.min(...m.sides.map((s) => s.snap?.tick ?? 0)) < 800) {
      const t = m.sides[0]!.snap?.tick ?? 0;
      if (t === 100) m.sides[0]!.ls.setLatency(10); // one turn
      if (t === 300) m.sides[1]!.ls.setLatency(250); // four turns
      if (t === 500) m.sides[1]!.ls.setLatency(0);
      if (t !== lastOrder) {
        lastOrder = t;
        m.sides.forEach((s, me) => orders(s, me, t));
      }
      m.step(10);
      expect(m.now()).toBeLessThan(400_000);
    }
    const [a, b] = m.sides as [Side, Side];
    const n = Math.min(a.delivered.length, b.delivered.length);
    expect(n).toBeGreaterThan(350);
    expect(a.delivered.slice(0, n)).toEqual(b.delivered.slice(0, n));
    expect(a.desyncs.concat(b.desyncs)).toEqual([]);
  }, 60_000);
});
