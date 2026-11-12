import { describe, expect, it } from 'vitest';
import { AREA_SCATTER, BODY_SPREAD, scatterKind, shotScatter, WALL_MARGIN, wallEnd, type Offset, type ScatterTarget } from '../../src/render3d/scatter';
import type { WeaponLook } from '../../src/render3d/rig';

const tank: ScatterTarget = { halfX: 0.45, halfZ: 0.45, height: 0.6, aimY: 0.2, air: false };
const depot: ScatterTarget = { halfX: 1.5, halfZ: 1, height: 1.4, aimY: 0.56, air: false };
const flyer: ScatterTarget = { halfX: 0.4, halfZ: 0.4, height: 0.4, aimY: 0, air: true };
const near = (o: Offset, x: number, z: number): void => {
  expect(o.x).toBeCloseTo(x, 9);
  expect(o.z).toBeCloseTo(z, 9);
};
const at = (shooter: number, shot: number, figure: number, t: ScatterTarget, look: WeaponLook | 'superweapon' = 'rifle', dx = 0, dz = 0): Offset =>
  shotScatter(shooter, shot, figure, t, scatterKind(look), { x: 0, y: 0, z: 0 }, dx, dz);

describe('shot scatter (AIM-3)', () => {
  it('AIM-3: the same shooter, shot and figure always land on the same point', () => {
    for (let s = 0; s < 20; s++) expect(at(17, s, 2, tank)).toEqual(at(17, s, 2, tank));
    // Reusing the output object leaves nothing behind from the last call.
    const out = { x: 9, y: 9, z: 9 };
    expect(shotScatter(17, 3, 0, tank, 'body', out)).toEqual(at(17, 3, 0, tank));
  });

  it('AIM-3: shots on a unit stay within 60% of its radius and on its body, never below the ground', () => {
    for (let id = 1; id < 40; id++) {
      for (let s = 0; s < 60; s++) {
        for (const [dx, dz] of [[0, 0], [1, 0], [-0.3, 0.8]] as const) {
          const o = at(id, s, s % 4, tank, 'mg', dx, dz);
          expect(Math.hypot(o.x, o.z)).toBeLessThanOrEqual(BODY_SPREAD * tank.halfX + 1e-9);
          const y = tank.aimY + o.y;
          expect(y).toBeGreaterThan(0);
          expect(y).toBeLessThan(tank.height);
        }
      }
    }
  });

  it('AIM-3: shots on a building stay within 60% of its half-width and half-depth and over part of its height', () => {
    for (let s = 0; s < 300; s++) {
      const o = at(5, s, 0, depot, 'cannon');
      expect(Math.abs(o.x)).toBeLessThanOrEqual(BODY_SPREAD * depot.halfX + 1e-9);
      expect(Math.abs(o.z)).toBeLessThanOrEqual(BODY_SPREAD * depot.halfZ + 1e-9);
      const y = depot.aimY + o.y;
      expect(y).toBeGreaterThan(0.1 * depot.height);
      expect(y).toBeLessThan(0.75 * depot.height);
    }
  });

  it('AIM-3: shots on an aircraft scatter above and below its flight height, within its body', () => {
    let up = 0;
    let down = 0;
    for (let s = 0; s < 100; s++) {
      const o = at(8, s, 0, flyer, 'pulse');
      expect(Math.hypot(o.x, o.z)).toBeLessThanOrEqual(BODY_SPREAD * flyer.halfX + 1e-9);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(flyer.height / 4 + 1e-9);
      if (o.y > 0) up++;
      else down++;
    }
    expect(up).toBeGreaterThan(20);
    expect(down).toBeGreaterThan(20);
  });

  it('AIM-3: successive shots land on different points and spread over the body rather than clumping', () => {
    const pts = Array.from({ length: 16 }, (_, s) => at(42, s, 0, tank));
    for (let s = 1; s < pts.length; s++) {
      const a = pts[s - 1]!;
      const b = pts[s]!;
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(0.05);
    }
    // Every quarter of the disc is hit within 16 shots.
    const quads = new Set(pts.map((p) => (p.x >= 0 ? 1 : 0) + (p.z >= 0 ? 2 : 0)));
    expect(quads.size).toBe(4);
    // Mean distance from the middle is near that of an even disc (2/3 of the spread radius).
    const mean = pts.reduce((m, p) => m + Math.hypot(p.x, p.z), 0) / pts.length;
    expect(mean).toBeGreaterThan(0.45 * BODY_SPREAD * tank.halfX);
    expect(mean).toBeLessThan(0.85 * BODY_SPREAD * tank.halfX);
  });

  it('AIM-3: each member of a squad, and each shooter, lands on its own point', () => {
    for (let s = 0; s < 10; s++) {
      const figs = [0, 1, 2, 3].map((f) => at(9, s, f, tank));
      for (let i = 0; i < figs.length; i++) for (let j = i + 1; j < figs.length; j++) expect(Math.hypot(figs[i]!.x - figs[j]!.x, figs[i]!.z - figs[j]!.z)).toBeGreaterThan(1e-3);
      expect(at(9, s, 0, tank)).not.toEqual(at(10, s, 0, tank));
    }
  });

  it('AIM-3: melee attacks and superweapon strikes are not scattered', () => {
    expect(scatterKind('claw')).toBe('none');
    expect(scatterKind('superweapon')).toBe('none');
    for (let s = 0; s < 20; s++) {
      expect(at(3, s, s % 3, depot, 'claw')).toEqual({ x: 0, y: 0, z: 0 });
      expect(at(3, s, 0, tank, 'superweapon')).toEqual({ x: 0, y: 0, z: 0 });
    }
  });

  it('AIM-3: an area blast moves no more than a fifth of a tile, on the ground', () => {
    for (const look of ['howitzer', 'heroCannon', 'heroAcid', 'missile'] as const) {
      expect(scatterKind(look)).toBe('area');
      let moved = 0;
      for (let s = 0; s < 100; s++) {
        const o = at(77, s, 0, depot, look);
        expect(Math.hypot(o.x, o.z)).toBeLessThanOrEqual(AREA_SCATTER + 1e-9);
        expect(o.y).toBe(0);
        moved = Math.max(moved, Math.hypot(o.x, o.z));
      }
      expect(moved).toBeGreaterThan(0.1);
    }
    // On a small target the blast stays within its body too.
    const small: ScatterTarget = { halfX: 0.15, halfZ: 0.15, height: 0.3, aimY: 0.18, air: false };
    for (let s = 0; s < 50; s++) expect(Math.hypot(at(1, s, 0, small, 'howitzer').x, at(1, s, 0, small, 'howitzer').z)).toBeLessThanOrEqual(BODY_SPREAD * 0.15 + 1e-9);
  });

  it('AIM-3: a shot at a building ends on the face toward the shooter, from each side and a diagonal', () => {
    // Footprint centred on (10, 20), 3 wide and 2 deep.
    const end = (sx: number, sz: number, px: number, pz: number): Offset => wallEnd(sx, sz, px, pz, 10, 20, 1.5, 1, { x: 0, y: 7, z: 0 });
    const m = WALL_MARGIN;
    near(end(0, 20.3, 10.2, 20.3), 8.5 + m, 20.3); // from the west
    near(end(20, 19.8, 9.9, 19.8), 11.5 - m, 19.8); // from the east
    near(end(10.4, 10, 10.4, 20.1), 10.4, 19 + m); // from the north
    near(end(9.7, 30, 9.7, 19.9), 9.7, 21 - m); // from the south
    // A diagonal enters through whichever wall it meets first, on the line to the scattered point.
    const d = end(5, 15, 10, 20);
    expect(d.x).toBeCloseTo(9 + m, 9);
    expect(d.z).toBeCloseTo(19 + m, 9);
    // The y is left alone.
    expect(d.y).toBe(7);
  });

  it('AIM-3: a shooter on or inside a building footprint keeps the scattered point', () => {
    expect(wallEnd(10, 20, 10.5, 20.4, 10, 20, 1.5, 1, { x: 0, y: 0, z: 0 })).toMatchObject({ x: 10.5, z: 20.4 });
    expect(wallEnd(8.5, 20, 10.5, 20.4, 10, 20, 1.5, 1, { x: 0, y: 0, z: 0 })).toMatchObject({ x: 10.5, z: 20.4 });
  });

  it('AIM-3: building shots always end on or inside the footprint and above the ground, and walk across the face', () => {
    const hits: number[] = [];
    for (let s = 0; s < 200; s++) {
      for (const [sx, sz] of [[0, 20], [10, 40], [25, 5], [10, 20.5]] as const) {
        const o = at(31, s, 0, depot, 'cannon', 10 - sx, 20 - sz);
        const w = wallEnd(sx, sz, 10 + o.x, 20 + o.z, 10, 20, depot.halfX, depot.halfZ, { x: 0, y: 0, z: 0 });
        expect(Math.abs(w.x - 10)).toBeLessThanOrEqual(depot.halfX + 1e-9);
        expect(Math.abs(w.z - 20)).toBeLessThanOrEqual(depot.halfZ + 1e-9);
        expect(depot.aimY + o.y).toBeGreaterThan(0);
        if (sx === 0) hits.push(w.z);
      }
    }
    // From the west, successive shots land at many points along the west face.
    expect(Math.max(...hits) - Math.min(...hits)).toBeGreaterThan(0.8);
  });

  it('AIM-3: a body shot spreads less along the line of fire, so tracers end on the near face', () => {
    let along = 0;
    let across = 0;
    for (let s = 0; s < 200; s++) {
      const o = at(12, s, 0, tank, 'rifle', 1, 0);
      along = Math.max(along, Math.abs(o.x));
      across = Math.max(across, Math.abs(o.z));
    }
    expect(along).toBeLessThanOrEqual(0.5 * BODY_SPREAD * tank.halfX + 1e-9);
    expect(across).toBeGreaterThan(0.8 * BODY_SPREAD * tank.halfX);
  });
});
