import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildingDef } from '../../src/data/defs';
import { showcaseConfig } from '../../src/data/maps';
import { isoProjector } from '../../src/render/projector';
import { cliffRgb, groundRgb } from '../../src/render/terrainNext';
import { cameraPose, FOV, PITCH_RISE } from '../../src/render3d/camera3d';
import { LEVEL_H, terrainMeshes } from '../../src/render3d/terrain3d';
import { createGame, hash, tick } from '../../src/sim';
import { FrameStats } from '../../src/ui/frameStats';

describe('showcase scenario and terrain colours', () => {
  it('NXT-2: both bases, squads and tanks, plateaus, water and shards; deterministic; crowds on free tiles only', () => {
    const c = showcaseConfig(1);
    const kinds = (owner: number): string[] => [...(c.buildings ?? []), ...(c.units ?? [])].filter((e) => e.owner === owner).map((e) => e.kind);
    expect(kinds(0)).toEqual(expect.arrayContaining(['hum_hq', 'hum_factory', 'hum_rifleman', 'hum_tank']));
    expect(kinds(1)).toEqual(expect.arrayContaining(['ali_hq', 'ali_pit', 'ali_skitter', 'ali_brute']));
    expect(Math.max(...c.map.heights)).toBe(2);
    expect(c.map.heights.some((h, i) => h === 0 && c.map.blocked?.[i])).toBe(true);
    const run = (): number => {
      const g = createGame(showcaseConfig(7));
      for (let i = 0; i < 100; i++) tick(g);
      return hash(g);
    };
    expect(run()).toBe(run());
    const big = showcaseConfig(1, 150);
    const tiles = big.units!.map((u) => u.ty * big.map.width + u.tx);
    expect(new Set(tiles).size).toBe(tiles.length);
    expect(tiles.every((i) => !big.map.blocked?.[i])).toBe(true);
    const footprint = new Set<number>();
    for (const bd of big.buildings ?? []) {
      const d = buildingDef(bd.kind);
      for (let y = bd.ty; y < bd.ty + d.h; y++) for (let x = bd.tx; x < bd.tx + d.w; x++) footprint.add(y * big.map.width + x);
    }
    expect(tiles.some((i) => footprint.has(i))).toBe(false);
  });

  it('NXT-3: ground colour depends only on tile coordinates; sunward cliffs are brighter; water is blue', () => {
    const ctx = { level: 0, water: false, shade: 0, shore: 0, shards: false };
    expect(groundRgb(5, 9, 0.3, 0.6, ctx)).toEqual(groundRgb(5, 9, 0.3, 0.6, ctx));
    expect(groundRgb(5, 9, 0.3, 0.6, ctx)).not.toEqual(groundRgb(40, 2, 0.3, 0.6, ctx));
    const lum = (c: number[]): number => c[0]! + c[1]! + c[2]!;
    expect(lum(cliffRgb(3, 4, 5, true))).toBeGreaterThan(lum(cliffRgb(3, 4, 5, false)));
    const water = groundRgb(2, 2, 0.5, 0.5, { ...ctx, water: true });
    expect(water[2]).toBeGreaterThan(water[0]);
  });
});

describe('3D terrain', () => {
  it('R3D-2: tile tops sit at their level, cliffs drop to every lower neighbour, blocked low tiles get water', () => {
    // 3x3 map: a level-1 tile in the middle, a blocked low tile in a corner.
    const heights = [0, 0, 0, 0, 1, 0, 0, 0, 0];
    const t = { width: 3, height: 3, heights, blocked: (x: number, y: number) => (x === 2 && y === 2) || heights[y * 3 + x]! > 0, shards: () => false };
    const m = terrainMeshes(t);
    // Ground and water cover their tiles exactly (edges near a contour wave, R3D-14, but the area is kept).
    const area = (d: { positions: Float32Array; indices: Uint32Array }): number => {
      let a = 0;
      for (let i = 0; i < d.indices.length; i += 3) {
        const [p, q, r] = [d.indices[i]!, d.indices[i + 1]!, d.indices[i + 2]!].map((k) => [d.positions[k * 3]!, d.positions[k * 3 + 2]!]);
        a += Math.abs((q![0]! - p![0]!) * (r![1]! - p![1]!) - (r![0]! - p![0]!) * (q![1]! - p![1]!)) / 2;
      }
      return a;
    };
    expect(area(m.ground)).toBeCloseTo(9, 6);
    const ys = new Set<number>();
    for (let i = 1; i < m.ground.positions.length; i += 3) ys.add(Math.round(m.ground.positions[i]! * 1000) / 1000);
    expect([...ys].sort()).toEqual([0, LEVEL_H]);
    expect(m.cliffs.indices.length).toBeGreaterThan(0);
    // One water tile: opaque in its middle, fading out at its shore, never more than a sliver beyond it (R3D-14).
    const wv = m.water;
    let top = 0;
    for (let i = 0; i < wv.positions.length / 3; i++) {
      const a = wv.colors[i * 4 + 3]!;
      top = Math.max(top, a);
      if (a > 0.01) {
        expect(wv.positions[i * 3]!).toBeGreaterThan(2 - 0.5);
        expect(wv.positions[i * 3 + 2]!).toBeGreaterThan(2 - 0.5);
      }
    }
    expect(top).toBeGreaterThan(0.9);
    expect(area(wv)).toBeGreaterThan(0.3);
    expect(terrainMeshes(t).ground.positions).toEqual(m.ground.positions); // pure
    // Walls face out of the plateau: each triangle's winding agrees with its stored normal.
    const c = m.cliffs;
    for (let i = 0; i < c.indices.length; i += 3) {
      const [p0, p1, p2] = [c.indices[i]!, c.indices[i + 1]!, c.indices[i + 2]!].map((k) => new THREE.Vector3(c.positions[k * 3], c.positions[k * 3 + 1], c.positions[k * 3 + 2]));
      const n = new THREE.Vector3().subVectors(p1!, p0!).cross(new THREE.Vector3().subVectors(p2!, p0!));
      expect(n.dot(new THREE.Vector3(c.normals[c.indices[i]! * 3], c.normals[c.indices[i]! * 3 + 1], c.normals[c.indices[i]! * 3 + 2]))).toBeGreaterThan(0);
    }
  });
});

describe('3D camera and projection', () => {
  it('R3D-4: the camera looks at the tile under the screen centre along the isometric heading, closer when zoomed in', () => {
    const p = cameraPose({ x: 0, y: 16 * 20, zoom: 1 }); // iso point of tile (10, 10)
    expect(p.target[0]).toBeCloseTo(10);
    expect(p.target[2]).toBeCloseTo(10);
    expect(p.position[0] - p.target[0]).toBeCloseTo(p.position[2] - p.target[2]); // 45 degree heading
    expect(p.position[1] / Math.hypot(p.position[0] - 10, p.position[2] - 10)).toBeCloseTo(PITCH_RISE / Math.SQRT2);
    expect((Math.atan(PITCH_RISE / Math.SQRT2) * 180) / Math.PI).toBeCloseTo(41.5, 0);
    const near = cameraPose({ x: 0, y: 320, zoom: 2 });
    expect(Math.hypot(near.position[0] - 10, near.position[1], near.position[2] - 10)).toBeLessThan(Math.hypot(p.position[0] - 10, p.position[1], p.position[2] - 10));
  });

  it('R3D-5: a projector maps a tile to the screen and back to the same ground tile', () => {
    const iso = isoProjector({ x: 40, y: 300, zoom: 1.3 }, { width: 1280, height: 720 });
    const s = iso.toScreen(12.5, 7.25);
    const g = iso.toGround(s.x, s.y);
    expect(g.x).toBeCloseTo(12.5);
    expect(g.y).toBeCloseTo(7.25);
    // The same round trip through a 3D camera at the pose the view uses.
    const pose = cameraPose({ x: 0, y: 320, zoom: 1 });
    const cam = new THREE.PerspectiveCamera(FOV, 1280 / 720, 0.5, 400);
    cam.position.set(...pose.position);
    cam.lookAt(...pose.target);
    cam.updateMatrixWorld();
    const v = new THREE.Vector3(12.5, 0, 7.25).project(cam);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(v.x, v.y), cam);
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())!;
    expect(hit.x).toBeCloseTo(12.5, 3);
    expect(hit.z).toBeCloseTo(7.25, 3);
  });
});

describe('frame-time readout', () => {
  it('NXT-6: reports fps, average and worst frame over a rolling window', () => {
    const f = new FrameStats(4);
    for (const ms of [10, 20, 30, 40, 50]) f.push(ms);
    expect(f.avg).toBe(35);
    expect(f.worst).toBe(50);
    expect(f.label()).toBe('29 fps · avg 35.0 ms · worst 50.0 ms');
  });
});
