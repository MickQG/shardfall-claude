import { describe, expect, it } from 'vitest';
import { buildingDef } from '../../src/data/defs';
import { DEFAULT_MAP, MAP_SIZE, MAPS, mapIdOf, mapStarts, skirmishConfig, skirmishMap, type MapId } from '../../src/data/maps';
import { createGame, snapshot } from '../../src/sim';
import { findPath } from '../../src/sim/path';

/** Each player's harvester spawn on a map: open ground inside their base, the end points for reachability. */
const homes = (id: MapId = DEFAULT_MAP): [[number, number], [number, number]] => {
  const us = skirmishConfig(1, { map: id }).units ?? [];
  const h = (o: number): [number, number] => {
    const u = us.find((x) => x.owner === o && (x.kind === 'hum_hauler' || x.kind === 'ali_gorger'))!;
    return [u.tx, u.ty];
  };
  return [h(0), h(1)];
};

describe('skirmish map', () => {
  const m = skirmishMap();
  const W = MAP_SIZE;
  const grid = { width: W, height: W, blocked: Uint8Array.from(m.blocked!) };

  it('MAP-2: is point-symmetric, connects both starts, and every shard field is reachable from both', () => {
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const j = (W - 1 - y) * W + (W - 1 - x);
        expect(m.blocked![i]).toBe(m.blocked![j]);
        expect(m.shards![i]).toBe(m.shards![j]);
        expect(m.heights[i]).toBe(m.heights[j]);
      }
    }
    const reach = (from: [number, number], to: [number, number]): boolean => {
      const p = findPath(grid, from[0], from[1], to[0], to[1]);
      return p.length > 0 && p.at(-1) === to[1] * W + to[0];
    };
    const [a, b] = homes();
    expect(reach(a, b)).toBe(true);
    const fieldTiles: [number, number][] = [];
    m.shards!.forEach((v, i) => {
      if (v > 0 && (i % W) % 2 === 0 && Math.floor(i / W) % 2 === 0) fieldTiles.push([i % W, Math.floor(i / W)]);
    });
    expect(fieldTiles.length).toBeGreaterThan(10);
    for (const f of fieldTiles) {
      expect(m.blocked![f[1] * W + f[0]]).toBe(0);
      expect(reach(a, f)).toBe(true);
      expect(reach(b, f)).toBe(true);
    }
  });

  it('MAP-2: starting forces are on free tiles and each player starts with a working economy', () => {
    const cfg = skirmishConfig();
    const g = createGame(cfg);
    const s = snapshot(g);
    expect(s.buildings.filter((x) => x.owner === 0)).toHaveLength(3);
    expect(s.buildings.filter((x) => x.owner === 1)).toHaveLength(3);
    for (const bd of g.state.buildings) expect(m.blocked![bd.ty * W + bd.tx]).toBe(0);
    expect(s.players[0]!.powerOut).toBeGreaterThanOrEqual(s.players[0]!.powerIn);
    expect(s.players[1]!.powerOut).toBeGreaterThanOrEqual(s.players[1]!.powerIn);
  });
});

describe('skirmish water', () => {
  it('MAP-3: the map has mirrored ponds and lakes that keep clear of starts, starting buildings and shard fields', () => {
    const m = skirmishMap();
    const W = MAP_SIZE;
    const water = (i: number): boolean => !!m.blocked![i] && m.heights[i] === 0;
    let n = 0;
    for (let i = 0; i < W * W; i++) {
      if (!water(i)) continue;
      n++;
      expect(water((W - 1 - Math.floor(i / W)) * W + (W - 1 - (i % W)))).toBe(true); // mirrored
      expect(m.shards![i]).toBe(0);
    }
    expect(n).toBeGreaterThan(120);
    // Every lake body is separate and none is within reach of a base: no water within 8 tiles of either start.
    for (const s of mapStarts()) for (let y = s.ty - 8; y <= s.ty + 8; y++) for (let x = s.tx - 8; x <= s.tx + 8; x++) expect(water(y * W + x)).toBe(false);
    for (const b of skirmishConfig().buildings ?? []) expect(water(b.ty * W + b.tx)).toBe(false);
  });
});

describe('Crossroads lanes (MAP-10)', () => {
  const W = MAP_SIZE;
  const m = skirmishMap('crossroads');
  const [a, b] = homes('crossroads');
  /** Distance from each tile to the nearest blocked tile (the map edge counts as blocked): about half a lane's width. */
  const clearance = ((): Float32Array => {
    const blocked: number[] = [];
    m.blocked!.forEach((v, i) => v && blocked.push(i));
    return Float32Array.from({ length: W * W }, (_, i) => {
      const x = i % W;
      const y = Math.floor(i / W);
      let d = Math.min(x + 1, y + 1, W - x, W - y);
      for (const j of blocked) d = Math.min(d, Math.hypot(x - (j % W), y - Math.floor(j / W)));
      return d;
    });
  })();
  // p = x - y is the side of the road between the bases (0 on it), q = x + y how far along it (95 at the centre).
  type Shut = (p: number, q: number) => boolean;
  const mid: Shut = (p, q) => q >= 62 && q <= 128 && Math.abs(p) <= 22;
  const east: Shut = (p, q) => q >= 62 && q <= 128 && p > 22 && p <= 44;
  const west: Shut = (p, q) => q >= 62 && q <= 128 && p < -22 && p >= -44;
  const lanes = [mid, east, west];
  /** Whether the bases are joined by ground at least `width` tiles wide everywhere (a corridor `w` wide leaves its middle tile (w + 1) / 2 from either wall), with the tiles `shut` closed. */
  const joined = (width: number, shut: Shut = () => false): boolean => {
    const ok = (i: number): boolean => !m.blocked![i] && clearance[i]! >= (width + 1) / 2 - 1e-9 && !shut((i % W) - Math.floor(i / W), (i % W) + Math.floor(i / W));
    const seen = new Uint8Array(W * W);
    const todo = [a[1] * W + a[0]];
    seen[todo[0]!] = 1;
    while (todo.length) {
      const i = todo.pop()!;
      if (i === b[1] * W + b[0]) return true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const nx = (i % W) + dx;
        const ny = Math.floor(i / W) + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
        const j = ny * W + nx;
        if (!seen[j] && ok(j)) {
          seen[j] = 1;
          todo.push(j);
        }
      }
    }
    return false;
  };

  it('MAP-10: the centre field holds at least 380000 shards on flat open ground', () => {
    // The centre field is the connected patch of shards around the map's middle.
    const seen = new Set<number>();
    const todo = [47 * W + 47];
    let total = 0;
    while (todo.length) {
      const i = todo.pop()!;
      if (seen.has(i) || !m.shards![i]) continue;
      seen.add(i);
      total += m.shards![i]!;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (((i % W) + dx) >= 0 && ((i % W) + dx) < W) todo.push(i + dy * W + dx);
    }
    expect(total).toBeGreaterThanOrEqual(380000);
    // Open all round it (the walls start further out), and no raised ground close by.
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const d = Math.hypot(x - 47.5, y - 47.5);
        if (d <= 6) expect(m.blocked![y * W + x], `${x},${y} blocked`).toBe(0);
        if (d <= 6) expect(m.heights[y * W + x]).toBe(0);
      }
  });

  it('MAP-10: three lanes cross between the bases, and walls and lakes close everything else', () => {
    expect(joined(1)).toBe(true);
    // Shut all three lanes across the middle of the map and the bases are cut off: nothing else gets through.
    expect(joined(1, (p, q) => q >= 90 && q <= 100 && Math.abs(p) <= 60)).toBe(false);
    // Any two lanes shut, the third alone joins the bases; and any one shut, the other two still do.
    for (const keep of lanes) expect(joined(1, (p, q) => lanes.some((lane) => lane !== keep && lane(p, q))), 'one lane open').toBe(true);
    for (const shut of lanes) expect(joined(1, shut), 'one lane shut').toBe(true);
  });


  it('MAP-10: the middle lane is at least 8 tiles wide and each side lane at least 4', () => {
    expect(joined(8, (p, q) => east(p, q) || west(p, q))).toBe(true);
    expect(joined(4, (p, q) => mid(p, q) || west(p, q))).toBe(true);
    expect(joined(4, (p, q) => mid(p, q) || east(p, q))).toBe(true);
  });

  it('MAP-10: a side lane is a real alternative to the middle one, not a huge detour', () => {
    const length = (shut: Shut): number => {
      const blocked = Uint8Array.from(m.blocked!, (v, i) => (v || shut((i % W) - Math.floor(i / W), (i % W) + Math.floor(i / W)) ? 1 : 0));
      return findPath({ width: W, height: W, blocked }, a[0], a[1], b[0], b[1]).length;
    };
    const direct = length(() => false);
    expect(direct).toBeGreaterThan(60);
    // The shortest way, through the middle lane, runs over the centre field.
    const road = findPath({ width: W, height: W, blocked: Uint8Array.from(m.blocked!) }, a[0], a[1], b[0], b[1]);
    expect(road.some((i) => m.shards![i] && Math.hypot((i % W) - 47.5, Math.floor(i / W) - 47.5) <= 5)).toBe(true);
    expect(length((p, q) => mid(p, q) || west(p, q))).toBeLessThanOrEqual(direct * 1.4);
    expect(length((p, q) => mid(p, q) || east(p, q))).toBeLessThanOrEqual(direct * 1.4);
  });

  it('MAP-10: each base has a natural field of about a home field where its side lane starts, and a pond on its outer flank', () => {
    // Separate the shard patches (8-way connected).
    const patch = new Int32Array(W * W).fill(-1);
    const fields: { tiles: number[]; shards: number }[] = [];
    for (let s = 0; s < W * W; s++) {
      if (!m.shards![s] || patch[s]! >= 0) continue;
      const f = { tiles: [] as number[], shards: 0 };
      const todo = [s];
      patch[s] = fields.length;
      while (todo.length) {
        const i = todo.pop()!;
        f.tiles.push(i);
        f.shards += m.shards![i]!;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const x = (i % W) + dx;
            const y = Math.floor(i / W) + dy;
            const j = y * W + x;
            if (x >= 0 && y >= 0 && x < W && y < W && m.shards![j] && patch[j]! < 0) {
              patch[j] = fields.length;
              todo.push(j);
            }
          }
      }
      fields.push(f);
    }
    // Two home fields and a natural field per base, and the centre field.
    expect(fields).toHaveLength(7);
    const centre = fields.reduce((best, f) => (f.shards > best.shards ? f : best));
    const small = fields.filter((f) => f !== centre);
    for (const f of small) expect(f.tiles.length).toBeGreaterThanOrEqual(15);
    for (const f of small) expect(f.tiles.length).toBeLessThanOrEqual(30);
    const at = (f: { tiles: number[] }): [number, number] => [f.tiles.reduce((s, i) => s + (i % W), 0) / f.tiles.length, f.tiles.reduce((s, i) => s + Math.floor(i / W), 0) / f.tiles.length];
    for (const start of mapStarts('crossroads')) {
      const hq: [number, number] = [start.tx + 1, start.ty + 1];
      const near = small.map((f) => ({ f, d: Math.hypot(at(f)[0] - hq[0], at(f)[1] - hq[1]) })).sort((x, y) => x.d - y.d);
      // The two nearest are its home fields; the third is its natural field, farther out but still near the base, at the
      // start of a side lane (a lane's side of the road between the bases is 21 to 30 tiles off it).
      const natural = near[2]!;
      expect(natural.d, 'beyond the home fields').toBeGreaterThan(near[1]!.d);
      expect(natural.d, 'still near the base').toBeLessThan(36);
      expect(Math.abs(at(natural.f)[0] - at(natural.f)[1]), 'at a side lane').toBeGreaterThan(21);
      expect(Math.abs(at(natural.f)[0] - at(natural.f)[1]), 'at a side lane').toBeLessThan(30);
      expect(natural.f.shards, 'about a home field').toBeGreaterThan(40000);
      expect(natural.f.shards, 'about a home field').toBeLessThan(90000);
    }
    // The ponds of MAP-3 stay on each base's outer flank.
    for (const [x, y] of [[5, 34], [36, 4], [90, 61], [59, 91]] as const) {
      expect(m.blocked![y * W + x]).toBe(1);
      expect(m.heights[y * W + x]).toBe(0);
    }
  });
});

describe('every skirmish map', () => {
  const W = MAP_SIZE;
  const reachOn = (blocked: ArrayLike<number>) => {
    const grid = { width: W, height: W, blocked: Uint8Array.from(blocked) };
    return (from: [number, number], to: [number, number]): boolean => {
      const p = findPath(grid, from[0], from[1], to[0], to[1]);
      return p.length > 0 && p.at(-1) === to[1] * W + to[0];
    };
  };
  it('MAP-4: the menu offers three maps, Crossroads first and by default; unknown ids fall back to it', () => {
    expect(MAPS.map((m) => m.id)).toEqual(['crossroads', 'riverbed', 'highlands']);
    expect(DEFAULT_MAP).toBe('crossroads');
    expect(mapIdOf('riverbed')).toBe('riverbed');
    for (const bad of [null, undefined, '', 'CROSSROADS', '../x', '<img>', 42]) expect(mapIdOf(bad)).toBe('crossroads');
    expect(skirmishMap()).toEqual(skirmishMap('crossroads'));
    expect(skirmishConfig(1, { map: 'highlands' }).map).toEqual(skirmishMap('highlands'));
  });

  for (const { id } of MAPS) {
    it(`MAP-4: ${id} is point-symmetric, connects both starts, and every shard field is reachable from both`, () => {
      const m = skirmishMap(id);
      for (let i = 0; i < W * W; i++) {
        const j = W * W - 1 - i;
        expect(m.blocked![i]).toBe(m.blocked![j]);
        expect(m.shards![i]).toBe(m.shards![j]);
        expect(m.heights[i]).toBe(m.heights[j]);
        if (m.heights[i]) expect(m.blocked![i]).toBe(1); // raised ground is rock
      }
      const reach = reachOn(m.blocked!);
      const [a, b] = homes(id);
      expect(reach(a, b)).toBe(true);
      let fields = 0;
      m.shards!.forEach((v, i) => {
        if (!v) return;
        fields++;
        expect(m.blocked![i]).toBe(0);
        if ((i % W) % 2 === 0 && Math.floor(i / W) % 2 === 0) {
          expect(reach(a, [i % W, Math.floor(i / W)])).toBe(true);
          expect(reach(b, [i % W, Math.floor(i / W)])).toBe(true);
        }
      });
      expect(fields).toBeGreaterThan(60);
    });

    it(`MAP-4: on ${id} the starting forces stand on open ground, with no water within 8 tiles of a start`, () => {
      const m = skirmishMap(id);
      const cfg = skirmishConfig(1, { map: id });
      const g = createGame(cfg);
      expect(g.state.buildings).toHaveLength(6);
      expect(g.state.units.length).toBe((cfg.units ?? []).length);
      for (const bd of cfg.buildings ?? []) {
        const d = buildingDef(bd.kind);
        for (let y = bd.ty; y < bd.ty + d.h; y++) for (let x = bd.tx; x < bd.tx + d.w; x++) expect(m.blocked![y * W + x]).toBe(0);
      }
      for (const u of cfg.units ?? []) expect(m.blocked![u.ty * W + u.tx]).toBe(0);
      for (const s of mapStarts(id)) for (let y = s.ty - 8; y <= s.ty + 8; y++) for (let x = s.tx - 8; x <= s.tx + 8; x++) expect(m.blocked![y * W + x] && !m.heights[y * W + x]).toBeFalsy();
      // No starting building overlaps another, and each base has shards within 14 tiles of its HQ.
      const tiles = new Set<number>();
      for (const bd of cfg.buildings ?? []) {
        const d = buildingDef(bd.kind);
        for (let y = bd.ty; y < bd.ty + d.h; y++)
          for (let x = bd.tx; x < bd.tx + d.w; x++) {
            expect(tiles.has(y * W + x)).toBe(false);
            tiles.add(y * W + x);
          }
      }
      for (const s of mapStarts(id)) {
        let near = 0;
        for (let i = 0; i < W * W; i++) if (m.shards![i] && Math.hypot((i % W) - s.tx - 1, Math.floor(i / W) - s.ty - 1) <= 14) near++;
        expect(near).toBeGreaterThanOrEqual(20);
      }
    });

    it(`MAP-4: ${id} is fair: both bases are as far from each other and from every shard field by road`, () => {
      const m = skirmishMap(id);
      const grid = { width: W, height: W, blocked: Uint8Array.from(m.blocked!) };
      const [a, b] = homes(id);
      const road = (from: [number, number], to: [number, number]): number => findPath(grid, from[0], from[1], to[0], to[1]).length;
      expect(Math.abs(road(a, b) - road(b, a))).toBeLessThanOrEqual(1);
      const fieldRoads = (from: [number, number], mirror: boolean): number[] => {
        const out: number[] = [];
        for (let i = 0; i < W * W; i += 7) {
          if (!m.shards![i]) continue;
          const t: [number, number] = [i % W, Math.floor(i / W)];
          out.push(road(from, mirror ? [W - 1 - t[0], W - 1 - t[1]] : t));
        }
        return out;
      };
      const mine = fieldRoads(a, false);
      const theirs = fieldRoads(b, true);
      mine.forEach((d, k) => expect(Math.abs(d - theirs[k]!)).toBeLessThanOrEqual(2));
    });
  }

  /** A tile's place in the isometric view, relative to the map centre: x to the right (east), y down (south). */
  const screen = (tx: number, ty: number): [number, number] => [tx - ty, tx + ty - (W - 1)];

  it('MAP-5: on Riverbed the bases sit at the middle of the north-east and south-west edges, either side of the river', () => {
    const [p0, p1] = mapStarts('riverbed').map((s) => screen(s.tx + 1, s.ty + 1)) as [[number, number], [number, number]];
    // The north-east edge runs from the top corner to the right one; its middle is up and to the right of the centre.
    expect(p0[0]).toBeGreaterThan(25);
    expect(p0[1]).toBeLessThan(-25);
    expect(Math.abs(p0[0] + p0[1])).toBeLessThanOrEqual(6);
    expect([p1[0] + p0[0], p1[1] + p0[1]]).toEqual([0, 0]);
    // The river runs along the anti-diagonal (across 0); the bases are on opposite banks.
    expect(Math.sign(p0[1])).toBe(-Math.sign(p1[1]));
  });

  it('MAP-5: on Riverbed a river parts the bases, crossed only at the centre bridge and two fords', () => {
    const m = skirmishMap('riverbed');
    const [a, b] = homes('riverbed');
    let water = 0;
    for (let i = 0; i < W * W; i++) if (m.blocked![i] && !m.heights[i]) water++;
    expect(water).toBeGreaterThan(300);
    // Close the three crossings (the bridge and both fords): the bases are cut off from each other.
    const closed = Array.from(m.blocked!);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        const along = x - y;
        const across = x + y - (W - 1);
        if (Math.abs(across) <= 8 && (Math.abs(along) <= 7 || Math.abs(Math.abs(along) - 44) <= 5)) closed[y * W + x] = 1;
      }
    expect(reachOn(m.blocked!)(a, b)).toBe(true);
    expect(reachOn(closed)(a, b)).toBe(false);
    // The richest field is on the centre bridge.
    const c = 47 * W + 47;
    expect(m.shards![c]).toBe(Math.max(...m.shards!));
  });

  it('MAP-6: on Highlands the bases face each other east and west, at the left and right corners', () => {
    const [p0, p1] = mapStarts('highlands').map((s) => screen(s.tx + 1, s.ty + 1)) as [[number, number], [number, number]];
    expect(p0[0]).toBeGreaterThan(60);
    expect(Math.abs(p0[1])).toBeLessThanOrEqual(4);
    expect([p1[0] + p0[0], p1[1] + p0[1]]).toEqual([0, 0]);
  });

  it('MAP-6: on Highlands a ridge ring walls in the basin, entered only by its four passes and two corner gaps, with the richest fields inside', () => {
    const m = skirmishMap('highlands');
    const [a] = homes('highlands');
    const inner: [number, number] = [40, 47];
    expect(reachOn(m.blocked!)(a, inner)).toBe(true);
    // Close the four passes (strips along the axes through the centre, out at the ring): the basin is sealed.
    // Openings: passes 0-3 on the axes through the centre, and gaps 4-5 at the two grid corners that face the bases (the
    // map is turned, so those are the corners off the main diagonal). `half(k)` is how far either side of opening k's axis to close it.
    const close = (half: (k: number) => number): number[] => {
      const closed = Array.from(m.blocked!);
      for (let y = 0; y < W; y++)
        for (let x = 0; x < W; x++) {
          const dx = x - 47.5;
          const dy = y - 47.5;
          const r = Math.max(Math.abs(dx), Math.abs(dy)); // the ring is a square
          if (r <= 14 || r >= 26) continue;
          const corner = Math.min(Math.abs(dx), Math.abs(dy)) > 9;
          const k = corner ? (dx * dy < 0 ? (dx < 0 ? 4 : 5) : -1) : Math.abs(dx) < Math.abs(dy) ? (dy < 0 ? 0 : 2) : dx > 0 ? 1 : 3;
          if (k < 0) continue;
          const off = corner ? Math.abs(dx + dy) / Math.SQRT2 : Math.min(Math.abs(dx), Math.abs(dy));
          if (off <= half(k)) closed[y * W + x] = 1;
        }
      return closed;
    };
    expect(reachOn(close(() => 12))(a, inner)).toBe(false);
    // Each opening on its own lets armies through, and is at least three tiles wide: with the others sealed and a
    // two-tile strip closed down its own axis, the basin can still be reached.
    for (let k = 0; k < 6; k++) expect(reachOn(close((j) => (j === k ? 1 : 12)))(a, inner), `opening ${k}`).toBe(true);
    let best = 0;
    let bestAt = -1;
    m.shards!.forEach((v, i) => {
      if (v > best) [best, bestAt] = [v, i];
    });
    expect(Math.hypot((bestAt % W) - 47.5, Math.floor(bestAt / W) - 47.5)).toBeLessThan(16);
  });
});

describe('fair starts for the AI', () => {
  it('MAP-4 ECO-7: on every map two identical AIs open with mirror-image bases, dock pads included, so neither start is favoured by tie-breaking', async () => {
    const { AI, DIFFICULTIES } = await import('../../src/ai/ai');
    const { buildingDef: def } = await import('../../src/data/defs');
    const { submit, tick } = await import('../../src/sim');
    for (const { id } of MAPS) {
      const cfg = skirmishConfig(1, { map: id, factions: ['human', 'human'] });
      const g = createGame(cfg);
      const ais = [0, 1].map((p) => new AI(p, 'human', DIFFICULTIES.hard, cfg.map, 1));
      for (let t = 0; t < 1200; t++) {
        if (t % 10 === 0) for (const p of [0, 1]) for (const c of ais[p]!.think(snapshot(g, p))) submit(g, c);
        tick(g);
      }
      const W = MAP_SIZE;
      const key = (b: { kind: string; tx: number; ty: number }, mirror: boolean): string => {
        const d = def(b.kind);
        return mirror ? `${b.kind}@${W - b.tx - d.w},${W - b.ty - d.h}` : `${b.kind}@${b.tx},${b.ty}`;
      };
      const mine = g.state.buildings.filter((b) => b.owner === 0).map((b) => key(b, false)).sort();
      const theirs = g.state.buildings.filter((b) => b.owner === 1).map((b) => key(b, true)).sort();
      expect(mine.length, id).toBeGreaterThan(3);
      expect(theirs, id).toEqual(mine);
      // Refineries' dock pads mirror too (ECO-7).
      const pads = (owner: number, mirror: boolean): string[] =>
        g.state.buildings.filter((b) => b.owner === owner && b.pad).map((b) => (mirror ? `${W - 1 - b.pad![0]},${W - 1 - b.pad![1]}` : `${b.pad![0]},${b.pad![1]}`)).sort();
      expect(pads(1, true), `${id} pads`).toEqual(pads(0, false));
    }
  }, 60_000);
});
