import { describe, expect, it } from 'vitest';
import { DIFFICULTIES } from '../../src/ai/ai';
import { playMatch } from '../../src/ai/harness';
import { checkPlan, generatePlan, generatedMap } from '../../src/data/mapgen';
import { MAP_SEED_MAX, MAP_SIZE, mapIdOf, mapSeedOf, mapStarts, resolveMapSeed, skirmishConfig, skirmishMap } from '../../src/data/maps';
import { NET_VERSION, parseMessage } from '../../src/net/protocol';
import { createGame, hash, snapshot } from '../../src/sim';
import { mapSeedLine, replayMapSearch } from '../../src/ui/score';
import { loadSettings, saveSettings } from '../../src/ui/settings';

const W = MAP_SIZE;
const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 3);

/** Each player's harvester spawn on a generated map: open ground inside their base. */
function homes(mapSeed: number): [[number, number], [number, number]] {
  const us = skirmishConfig(1, { map: 'generated', mapSeed }).units ?? [];
  const h = (o: number): [number, number] => {
    const u = us.find((x) => x.owner === o && (x.kind === 'hum_hauler' || x.kind === 'ali_gorger'))!;
    return [u.tx, u.ty];
  };
  return [h(0), h(1)];
}

describe('map generator', () => {
  it('MAP-7: the same seed always gives the same map, starts and first-tick state hash; other seeds give other maps', () => {
    for (const s of [0, 1, 99, 123456, MAP_SEED_MAX - 1]) {
      expect(skirmishMap('generated', s)).toEqual(skirmishMap('generated', s));
      expect(mapStarts('generated', s)).toEqual(mapStarts('generated', s));
      const a = createGame(skirmishConfig(5, { map: 'generated', mapSeed: s }));
      const b = createGame(skirmishConfig(5, { map: 'generated', mapSeed: s }));
      expect(hash(a)).toBe(hash(b));
    }
    const maps = new Set([1, 2, 3, 4, 5, 6].map((s) => skirmishMap('generated', s).blocked!.join('')));
    expect(maps.size).toBe(6);
    // Pinned on every machine: these numbers change only when the generator itself changes.
    const fingerprint = (s: number): number => skirmishMap('generated', s).blocked!.reduce((h, v, i) => (h * 31 + v * (i + 1)) >>> 0, 7);
    expect(fingerprint(1)).toMatchInlineSnapshot(`1912644619`);
  });

  it('MAP-8: every generated map is fair and playable', () => {
    for (const s of SEEDS) {
      const m = skirmishMap('generated', s);
      expect(m.width).toBe(W);
      expect(m.height).toBe(W);
      // Point-symmetric, as MAP-2.
      const asym = m.heights.findIndex((h, i) => h !== m.heights[W * W - 1 - i] || m.blocked![i] !== m.blocked![W * W - 1 - i] || m.shards![i] !== m.shards![W * W - 1 - i]);
      expect(asym, `seed ${s}: symmetric`).toBe(-1);
      // Only existing terrain: open ground, rock (levels 1 and 2) and water (blocked at level 0).
      expect(m.heights.every((h) => h === 0 || h === 1 || h === 2)).toBe(true);
      // One flood over open ground (4-way steps, stricter than the units' 8-way paths) from player 0's base.
      const seen = new Uint8Array(W * W);
      const [a, b] = homes(s);
      const queue = [a[1] * W + a[0]];
      seen[queue[0]!] = 1;
      for (let k = 0; k < queue.length; k++) {
        const i = queue[k]!;
        for (const j of [i % W > 0 ? i - 1 : -1, i % W < W - 1 ? i + 1 : -1, i - W, i + W]) {
          if (j < 0 || j >= W * W || seen[j] || m.blocked![j]) continue;
          seen[j] = 1;
          queue.push(j);
        }
      }
      expect(seen[b[1] * W + b[0]], `seed ${s}: starts connected`).toBe(1);
      let shardTiles = 0;
      const unreachable: number[] = [];
      m.shards!.forEach((v, i) => {
        if (v <= 0) return;
        shardTiles++;
        // Reachable from player 0, so from player 1 too (they are connected).
        if (!seen[i]) unreachable.push(i);
      });
      expect(unreachable, `seed ${s}: shard tiles out of reach`).toEqual([]);
      // Home fields and at least one more each side.
      expect(shardTiles).toBeGreaterThanOrEqual(4 * 13);
      // Starting forces on open ground.
      const cfg = skirmishConfig(1, { map: 'generated', mapSeed: s });
      const g = createGame(cfg);
      expect(snapshot(g).buildings).toHaveLength(6);
      for (const bd of g.state.buildings) expect(m.blocked![bd.ty * W + bd.tx]).toBe(0);
      // Water or a chokepoint between the bases (and everything above), as the generator checks it.
      expect(checkPlan(generatedMap(s).plan)).toEqual({ ok: true, why: '' });
    }
  }, 120_000);

  it('MAP-8: both AIs build their bases and fight on generated maps', () => {
    for (const s of [11, 2024, 777777]) {
      const r = playMatch({ seed: 3, factions: ['human', 'alien'], difficulties: [DIFFICULTIES.medium, DIFFICULTIES.medium], maxTicks: 20 * 60 * 7, map: 'generated', mapSeed: s });
      expect(r.ai[0].waves + r.ai[1].waves, `seed ${s}`).toBeGreaterThan(0);
      expect(r.orders[0]).toBeGreaterThan(50);
      expect(r.orders[1]).toBeGreaterThan(50);
    }
  }, 300_000);

  it('MAP-9: a seed whose map fails moves on to the next seed; the reported seed gives the same map', () => {
    const failing: number[] = [];
    for (let s = 0; failing.length < 2 && s < 5000; s++) if (!checkPlan(generatePlan(s)).ok) failing.push(s);
    expect(failing.length).toBe(2);
    for (const s of failing) {
      const r = resolveMapSeed(s);
      expect(r).toBeGreaterThan(s);
      for (let k = s + 1; k < r; k++) expect(checkPlan(generatePlan(k)).ok).toBe(false);
      expect(checkPlan(generatePlan(r)).ok).toBe(true);
      expect(resolveMapSeed(r)).toBe(r);
      expect(skirmishMap('generated', s)).toEqual(skirmishMap('generated', r));
    }
    // A passing seed is its own.
    for (const s of SEEDS) if (checkPlan(generatePlan(s)).ok) expect(resolveMapSeed(s)).toBe(s);
    // The sequence wraps after the last seed.
    expect(resolveMapSeed(MAP_SEED_MAX - 1)).toBeLessThan(MAP_SEED_MAX);
  });
});

describe('choosing, sharing and replaying a generated map', () => {
  const memory = (): Pick<Storage, 'getItem' | 'setItem'> => {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
  };

  it('MENU-6: the Generated choice and its seed are remembered; the address bar and seed box take only valid seeds', () => {
    const store = memory();
    expect(loadSettings(store).mapSeed).toBe(1);
    saveSettings(store, { ...loadSettings(store), map: 'generated', mapSeed: 4242 });
    expect(loadSettings(store).map).toBe('generated');
    expect(loadSettings(store).mapSeed).toBe(4242);
    store.setItem('shardfall.settings.v2', JSON.stringify({ map: 'generated', mapSeed: -5 }));
    expect(loadSettings(store).mapSeed).toBe(1);
    expect(mapIdOf('generated')).toBe('generated');
    expect(mapSeedOf('123')).toBe(123);
    for (const bad of ['', 'x', '1e5', '-1', '3.5', String(MAP_SEED_MAX), null]) expect(mapSeedOf(bad, 9)).toBe(9);
  });

  it('NET-6: the host sends its map seed with a generated map, and both players build the same game from it', () => {
    const setup = { seed: 8, map: 'generated', mapSeed: 31337, factions: ['human', 'alien'] };
    const msg = parseMessage({ t: 'welcome', v: NET_VERSION, to: 'u1', setup });
    expect(msg).toEqual({ t: 'welcome', v: NET_VERSION, to: 'u1', setup });
    // A generated map without a valid seed is refused.
    for (const mapSeed of [undefined, -1, 1.5, MAP_SEED_MAX, '5']) expect(parseMessage({ t: 'welcome', v: NET_VERSION, to: 'u1', setup: { ...setup, mapSeed } })).toBeNull();
    const host = createGame(skirmishConfig(setup.seed, { factions: ['human', 'alien'], bonuses: [0, 0], map: 'generated', mapSeed: setup.mapSeed }));
    const guest = createGame(skirmishConfig(setup.seed, { factions: ['human', 'alien'], bonuses: [0, 0], map: 'generated', mapSeed: msg?.t === 'welcome' ? msg.setup.mapSeed : -1 }));
    expect(hash(guest)).toBe(hash(host));
  });

  it('SCR-5: the result screen gives the map seed and replays the same map with the same settings', () => {
    expect(mapSeedLine(4242)).toBe('Map seed 4242.');
    expect(replayMapSearch({ faction: 'alien', difficulty: 'hard', personality: 'random', mapSeed: 4242 })).toBe('?faction=alien&difficulty=hard&personality=random&map=generated&mapseed=4242');
  });
});
