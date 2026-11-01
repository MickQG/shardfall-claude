import { describe, expect, it } from 'vitest';
import { createGame, hash, snapshot, submit, tick, type Game, type GameConfig } from '../../src/sim';

const W = 48;
const cfg = (): GameConfig => ({
  seed: 1,
  map: { width: W, height: W, heights: new Array<number>(W * W).fill(0), blocked: new Array<number>(W * W).fill(0) },
  players: [
    { faction: 'human', credits: 5000 },
    { faction: 'alien', credits: 0 },
  ],
  buildings: [
    { owner: 0, kind: 'hum_hq', tx: 5, ty: 5 },
    { owner: 0, kind: 'hum_reactor', tx: 9, ty: 5 },
    { owner: 0, kind: 'hum_barracks', tx: 5, ty: 10 },
    { owner: 0, kind: 'hum_barracks', tx: 10, ty: 10 },
    { owner: 0, kind: 'hum_factory', tx: 15, ty: 15 },
    { owner: 1, kind: 'ali_hq', tx: 38, ty: 38 },
  ],
});
const garrisons = (g: Game) => snapshot(g, 0).buildings.filter((b) => b.kind === 'hum_barracks');
const ORDERS = ['hum_rifleman', 'hum_rifleman', 'hum_rifleman', 'hum_rocketeer', 'hum_rocketeer'];

describe('busy producers', () => {
  it('PRD-14: orders piled on one Garrison are shared with an idle sibling, so both build at once', () => {
    const g = createGame(cfg());
    const a = garrisons(g)[0]!.id;
    for (const kind of ORDERS) submit(g, { type: 'produce', player: 0, source: a, kind });
    let both = 0;
    let done = -1;
    for (let t = 0; t < 900 && done < 0; t++) {
      tick(g);
      const [x, y] = garrisons(g);
      if (x!.queue.length > 0 && y!.queue.length > 0) both++;
      if (g.state.units.filter((u) => u.owner === 0).length === ORDERS.length) done = t;
    }
    expect(both).toBeGreaterThan(250); // both Garrisons work side by side for most of it
    // About half the time of one Garrison building all five one after the other.
    const serial = createGame({ ...cfg(), buildings: cfg().buildings!.filter((b, i) => i !== 3) });
    const only = garrisons(serial)[0]!.id;
    for (const kind of ORDERS) submit(serial, { type: 'produce', player: 0, source: only, kind });
    let serialDone = -1;
    for (let t = 0; t < 2000 && serialDone < 0; t++) {
      tick(serial);
      if (serial.state.units.filter((u) => u.owner === 0).length === ORDERS.length) serialDone = t;
    }
    expect(done).toBeGreaterThan(0);
    expect(done).toBeLessThan(serialDone * 0.7);
  });

  it('PRD-14: orders already in progress stay put, and the sharing is deterministic', () => {
    const run = (): { first: string[]; h: number } => {
      const g = createGame(cfg());
      const a = garrisons(g)[0]!.id;
      for (const kind of ORDERS) submit(g, { type: 'produce', player: 0, source: a, kind });
      tick(g);
      const first = garrisons(g).map((b) => b.queue.map((q) => q.kind).join(','));
      for (let i = 0; i < 300; i++) tick(g);
      return { first, h: hash(g) };
    };
    const r = run();
    // The first Garrison keeps the order it started; the idle one took the newest waiting order.
    expect(r.first[0]!.startsWith('hum_rifleman')).toBe(true);
    expect(r.first[1]).toBe('hum_rocketeer');
    expect(run()).toEqual(r);
  });
});
