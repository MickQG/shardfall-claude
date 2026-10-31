import { describe, expect, it } from 'vitest';
import { MAP_SIZE, skirmishConfig, skirmishMap, STARTS } from '../../src/data/maps';
import { createGame, snapshot } from '../../src/sim';
import { findPath } from '../../src/sim/path';

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
    const a: [number, number] = [STARTS[0].tx + 5, STARTS[0].ty + 5];
    const b: [number, number] = [STARTS[1].tx - 2, STARTS[1].ty - 2];
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
    for (const s of STARTS) for (let y = s.ty - 8; y <= s.ty + 8; y++) for (let x = s.tx - 8; x <= s.tx + 8; x++) expect(water(y * W + x)).toBe(false);
    for (const b of skirmishConfig().buildings ?? []) expect(water(b.ty * W + b.tx)).toBe(false);
  });
});
