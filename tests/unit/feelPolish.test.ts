import { describe, expect, it } from 'vitest';
import { showcaseConfig } from '../../src/data/maps';
import { DASH_GAP, DASH_SPEED, DROP_MS, flagDrop, MAX_DASHES, PULSE_MS, rallyDashes, ringScale } from '../../src/render3d/rally3d';
import { buildingBar, damageSmoke, jolt, JOLT_MS } from '../../src/render3d/view3d';
import { createGame } from '../../src/sim';

describe('damaged buildings', () => {
  it('R3D-20: a building shows its health bar while selected and whenever it is below half health', () => {
    expect(buildingBar(1, false)).toBe(false);
    expect(buildingBar(0.5, false)).toBe(false);
    expect(buildingBar(0.49, false)).toBe(true);
    expect(buildingBar(0.1, false)).toBe(true);
    expect(buildingBar(1, true)).toBe(true);
  });

  it('R3D-20: below half health a building jolts when hit, harder the weaker it is, and settles quickly', () => {
    const size = (age: number, hp: number): number => {
      let m = 0;
      for (let a = age; a < age + 40; a += 2) {
        const j = jolt(a, hp, 3);
        m = Math.max(m, Math.hypot(j.dx, j.dz));
      }
      return m;
    };
    expect(size(0, 0.6)).toBe(0); // above half: no jolt
    expect(size(0, 0.45)).toBeGreaterThan(0.01);
    expect(size(0, 0.1)).toBeGreaterThan(size(0, 0.45));
    expect(size(0, 0.1)).toBeLessThan(0.1); // a shudder, not a jump
    expect(jolt(JOLT_MS, 0.1, 3)).toEqual({ dx: 0, dz: 0, tilt: 0 });
    expect(jolt(-5, 0.1, 3)).toEqual({ dx: 0, dz: 0, tilt: 0 });
    expect(JOLT_MS).toBeLessThanOrEqual(400);
  });

  it('R3D-20: smoke from two thirds and fire from one third, thickening, growing and puffing faster as it weakens', () => {
    expect(damageSmoke(0.8).plumes).toBe(0);
    const at = [0.66, 0.55, 0.45, 0.33, 0.1].map(damageSmoke);
    expect(at.map((s) => s.plumes)).toEqual([1, 1, 2, 3, 3]);
    expect(at.map((s) => s.fire)).toEqual([false, false, false, true, true]);
    for (let i = 1; i < at.length; i++) {
      expect(at[i]!.scale).toBeGreaterThan(at[i - 1]!.scale);
      expect(at[i]!.every).toBeLessThanOrEqual(at[i - 1]!.every);
    }
    // Heavier than the old single 0.9-sized puff every 110 ms.
    expect(at[0]!.scale).toBeGreaterThan(0.9);
    expect(at[0]!.every).toBeLessThan(110);
  });
});

describe('rally point marker', () => {
  const from = { x: 10, z: 10 };
  const to = { x: 16, z: 18 }; // 10 tiles away

  it('R3D-21: dashes run from the building toward the flag, stop short of it, and march toward it', () => {
    const d0 = rallyDashes(from, to, 0);
    expect(d0.length).toBeGreaterThan(20);
    const dist = (p: { x: number; z: number }, q: { x: number; z: number }): number => Math.hypot(p.x - q.x, p.z - q.z);
    for (const d of d0) {
      expect(dist(d, to)).toBeGreaterThanOrEqual(0.3 - 1e-9);
      expect(Math.abs((d.x - from.x) * (to.z - from.z) - (d.z - from.z) * (to.x - from.x))).toBeLessThan(1e-6); // on the line
    }
    // A moment later every dash is closer to the flag (they march toward it), by DASH_SPEED tiles a second.
    const dt = 100;
    const d1 = rallyDashes(from, to, dt);
    const nearest = (ds: { x: number; z: number }[]): number => Math.min(...ds.map((d) => dist(d, from)));
    expect(nearest(d1) - nearest(d0)).toBeCloseTo((DASH_SPEED * dt) / 1000, 5);
    expect(DASH_GAP).toBeGreaterThan(0.2);
    // A very long line is capped, keeping the dashes nearest the flag.
    const far = rallyDashes({ x: 0, z: 0 }, { x: 90, z: 90 }, 0);
    expect(far).toHaveLength(MAX_DASHES);
    expect(Math.min(...far.map((d) => dist(d, { x: 90, z: 90 })))).toBeLessThan(0.3 + DASH_GAP);
    expect(rallyDashes(from, { x: 10.1, z: 10 }, 0)).toEqual([]);
  });

  it('R3D-21: when the rally point moves the flag drops in and the ring pulses wide, then breathes gently', () => {
    expect(flagDrop(0)).toBeGreaterThan(1);
    expect(flagDrop(DROP_MS / 2)).toBeLessThan(flagDrop(0));
    expect(flagDrop(DROP_MS)).toBe(0);
    expect(flagDrop(1e9)).toBe(0);
    expect(ringScale(0, 0)).toBeGreaterThan(2);
    for (let t = 0; t < 4000; t += 97) {
      const s = ringScale(PULSE_MS + 1, t);
      expect(s).toBeGreaterThan(0.85);
      expect(s).toBeLessThan(1.15);
    }
  });
});

describe('showcase from the Vrax side', () => {
  it('NXT-2: with faction=alien the same battle is watched from the hive: player 0 is the Vrax, everything else mirrors', () => {
    const h = showcaseConfig(1, 20);
    const a = showcaseConfig(1, 20, 'alien');
    expect(showcaseConfig(1, 20, 'human')).toEqual(h);
    expect(a.players!.map((p) => p.faction)).toEqual(['alien', 'human']);
    expect(a.map).toEqual(h.map);
    expect(a.units!.map((u) => ({ ...u, owner: 1 - u.owner }))).toEqual(h.units);
    expect(a.buildings!.map((b) => ({ ...b, owner: 1 - b.owner }))).toEqual(h.buildings);
    for (const u of a.units!) expect(u.kind.startsWith(u.owner === 0 ? 'ali_' : 'hum_')).toBe(true);
    expect(createGame(a).state.buildings.find((b) => b.owner === 0 && b.kind === 'ali_hq')).toBeTruthy();
  });
});
