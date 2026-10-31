import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { showcaseConfig } from '../../src/data/maps';
import { isoProjector } from '../../src/render/projector';
import { cliffRgb, groundRgb } from '../../src/render/terrainNext';
import { box, createModel } from '../../src/render/voxel/model';
import { cameraPose, FOV, PITCH_RISE } from '../../src/render3d/camera3d';
import { LEVEL_H, terrainMeshes } from '../../src/render3d/terrain3d';
import { voxelMesh } from '../../src/render3d/voxelMesh';
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
    expect(m.ground.positions.length / 3).toBe(9 * 4);
    const ys = new Set<number>();
    for (let i = 1; i < m.ground.positions.length; i += 3) ys.add(Math.round(m.ground.positions[i]! * 1000) / 1000);
    expect([...ys].sort()).toEqual([0, LEVEL_H]);
    expect(m.cliffs.indices.length).toBeGreaterThan(0);
    expect(m.water.positions.length / 3).toBe(4); // one water tile
    expect(terrainMeshes(t).ground.positions).toEqual(m.ground.positions); // pure
  });
});

describe('voxel models in 3D', () => {
  it('R3D-3: a solid block becomes six merged faces, team material takes the team colour, glow is split out', () => {
    const m = createModel(4, 3, 2, [{ color: 0xff0000 }, { color: 0, team: true }, { color: 0x00ff00, glow: true }]);
    box(m, 0, 0, 0, 4, 3, 2, 1);
    const one = voxelMesh(m, 0x0000ff);
    expect(one.quads).toBe(6);
    expect(one.glow.indices.length).toBe(0);
    box(m, 0, 0, 1, 4, 3, 1, 2); // top layer in team colour
    box(m, 1, 1, 1, 1, 1, 1, 3); // one glowing voxel
    const mixed = voxelMesh(m, 0x0000ff);
    const cols = mixed.lit.colors;
    let blue = false;
    for (let i = 0; i < cols.length; i += 3) if (cols[i] === 0 && cols[i + 2] === 1) blue = true;
    expect(blue).toBe(true);
    expect(mixed.glow.indices.length).toBeGreaterThan(0);
  });

  it('R3D-3: every face winds outward (its triangle normal agrees with the stored normal)', () => {
    const m = createModel(3, 3, 3, [{ color: 0xffffff }]);
    box(m, 0, 0, 0, 3, 3, 1, 1);
    box(m, 1, 1, 1, 1, 1, 2, 1);
    const d = voxelMesh(m, 0).lit;
    for (let t = 0; t < d.indices.length; t += 3) {
      const [a, b, c] = [d.indices[t]!, d.indices[t + 1]!, d.indices[t + 2]!].map((i) => new THREE.Vector3(d.positions[i * 3], d.positions[i * 3 + 1], d.positions[i * 3 + 2]));
      const n = new THREE.Vector3().subVectors(b!, a!).cross(new THREE.Vector3().subVectors(c!, a!));
      const stored = new THREE.Vector3(d.normals[d.indices[t]! * 3], d.normals[d.indices[t]! * 3 + 1], d.normals[d.indices[t]! * 3 + 2]);
      expect(n.dot(stored)).toBeGreaterThan(0);
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
