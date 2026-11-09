import { describe, expect, it } from 'vitest';
import { UNIT_DEFS } from '../../src/data/defs';
import { brawlConfig } from '../../src/data/maps';
import { chunkCount, chunkVisible, DEBRIS_CAP, Debris, newChunk, stepChunk } from '../../src/render3d/debris3d';
import { BUDGET, GpuParticleLayer, particleFade, particlePosition, ParticleRing, STRIDE, WIND } from '../../src/render3d/gpuParticles';

describe('GPU particles (R3D-26)', () => {
  it('R3D-26: the kinematics give the closed form of drag, gravity, buoyancy and wind', () => {
    // No drag, no gravity: straight line.
    expect(particlePosition([1, 2, 3], [1, 0, -1], 0, 0, 2)).toEqual([3, 2, 1]);
    // Gravity without drag is a parabola: y = y0 + vy t - g t^2 / 2.
    const p = particlePosition([0, 5, 0], [0, 3, 0], 0, 10, 1);
    expect(p[1]).toBeCloseTo(5 + 3 - 5, 6);
    // Drag: the displacement tends to v / k.
    const far = particlePosition([0, 9, 0], [4, 0, 0], 2, 0, 50);
    expect(far[0]).toBeCloseTo(2, 4);
    // Matches a small-step integration of dv/dt = -k v - g.
    let x = 0;
    let y = 4;
    let vx = 3;
    let vy = 2;
    const k = 1.3;
    const g = -0.45;
    const dt = 1e-4;
    for (let t = 0; t < 1.5; t += dt) {
      vx += -k * vx * dt;
      vy += (-k * vy - g) * dt;
      x += vx * dt;
      y += vy * dt;
    }
    const a = particlePosition([0, 4, 0], [3, 2, 0], k, g, 1.5);
    expect(a[0]).toBeCloseTo(x, 2);
    expect(a[1]).toBeCloseTo(y, 2);
    // Buoyancy (negative gravity) lifts a still particle; smoke drifts with the wind; nothing sinks below the ground.
    expect(particlePosition([0, 1, 0], [0, 0, 0], 0.5, -0.4, 2)[1]).toBeGreaterThan(1);
    expect(particlePosition([0, 1, 0], [0, 0, 0], 0, 0, 2, 1)[0]).toBeCloseTo(0.5 * WIND.x * 4, 6);
    expect(particlePosition([0, 0.05, 0], [0, -5, 0], 0, 0, 3)[1]).toBe(0.01);
    expect(particleFade(0)).toBe(0);
    expect(particleFade(0.5)).toBeGreaterThan(particleFade(0.95));
  });

  it('R3D-26: the ring keeps a fixed budget, overwrites the oldest and reports the ranges to upload', () => {
    const r = new ParticleRing(8);
    for (let i = 0; i < 5; i++) expect(r.next(i, 1000)).toBe(i);
    expect(r.filled).toBe(5);
    expect(r.takeDirty()).toBe(1);
    expect([r.rangeStart(0), r.rangeLength(0)]).toEqual([0, 5]);
    expect(r.takeDirty()).toBe(0);
    for (let i = 0; i < 5; i++) r.next(10 + i, 1000);
    // Slots 5, 6, 7 then 0 and 1 again: the oldest were overwritten, the count stays at the budget.
    expect(r.filled).toBe(8);
    expect(r.takeDirty()).toBe(2);
    expect([r.rangeStart(0), r.rangeLength(0), r.rangeStart(1), r.rangeLength(1)]).toEqual([5, 3, 0, 2]);
    // Live estimate: dead ones drop out, and it never exceeds the budget.
    expect(r.live(500)).toBe(8);
    expect(r.live(5000)).toBe(0);
    r.setCapacity(4);
    expect(r.filled).toBe(4);
    expect(BUDGET.low.smoke).toBeLessThan(BUDGET.high.smoke);
    expect(BUDGET.high).toEqual({ smoke: 8192, glow: 4096 });
  });

  it('R3D-26: a layer writes a particle into its buffer without any per-particle update and never grows past its cap', () => {
    const layer = new GpuParticleLayer(16, false);
    for (let i = 0; i < 40; i++) layer.emit({ x: i, y: 1, z: 0, life: 1000, size0: 0.1, size1: 0.3, color0: 0xffffff, alpha: 0.5 }, i * 10);
    layer.update(400);
    expect(layer.points.geometry.drawRange.count).toBe(16);
    const data = (layer.points.geometry.getAttribute('position') as unknown as { data: { array: Float32Array } }).data.array;
    expect(data.length).toBe(16 * STRIDE);
    // The last 16 emitted (x = 24..39) are what is left in the buffer.
    const xs = Array.from({ length: 16 }, (_, i) => data[i * STRIDE]!).sort((a, b) => a - b);
    expect(xs[0]).toBe(24);
    expect(xs[15]).toBe(39);
    expect(layer.live(400)).toBeLessThanOrEqual(16);
  });
});

describe('Debris (R3D-27)', () => {
  it('R3D-27: a chunk arcs, bounces once or twice, settles and the pool fades it within 4 s', () => {
    const c = newChunk();
    Object.assign(c, { active: true, y: 0.5, vx: 2, vy: 6, vz: 1, scale: 0.2, wx: 5, wy: 3, wz: 1, life: 3300 });
    let peak = c.y;
    let settledAt = -1;
    for (let i = 0; i < 240; i++) {
      stepChunk(c, 1 / 60, 0);
      peak = Math.max(peak, c.y);
      if (c.settled && settledAt < 0) settledAt = i / 60;
    }
    expect(peak).toBeGreaterThan(1.5);
    expect(c.bounces).toBeGreaterThanOrEqual(1);
    expect(c.bounces).toBeLessThanOrEqual(3);
    expect(settledAt).toBeGreaterThan(0);
    expect(settledAt).toBeLessThan(2.5);
    expect(c.y).toBeCloseTo(0.2 * 0.4, 6);
    expect(c.vx).toBe(0);
    expect(chunkVisible(0, 3300)).toBe(1);
    expect(chunkVisible(3300, 3300)).toBe(0);
    expect(chunkVisible(3000, 3300)).toBeLessThan(1);
  });

  it('R3D-27: throws are seeded by id, sized by what died, and the pool stays within its cap, reusing the oldest', () => {
    for (let id = 1; id < 40; id++) {
      expect(chunkCount('vehicle', id, 0.4)).toBeGreaterThanOrEqual(4);
      expect(chunkCount('vehicle', id, 0.4)).toBeLessThanOrEqual(7);
      expect(chunkCount('building', id, 3)).toBeGreaterThanOrEqual(8);
      expect(chunkCount('building', id, 6)).toBeLessThanOrEqual(14);
    }
    const at = { x: 5, y: 0, z: 5 };
    const a = new Debris();
    const b = new Debris();
    a.spawn('vehicle', at, 7, 0.4, 0x4488ff, 0);
    b.spawn('vehicle', at, 7, 0.4, 0x4488ff, 0);
    a.update(100, 0.016);
    b.update(100, 0.016);
    expect(a.active).toBe(b.active);
    expect(a.active).toBe(chunkCount('vehicle', 7, 0.4));
    // Spam far more deaths than the pool holds.
    const d = new Debris();
    for (let i = 0; i < 60; i++) d.spawn('building', at, i, 4, 0xff0000, i);
    d.update(100, 0.016);
    expect(d.active).toBe(DEBRIS_CAP.high);
    d.setQuality(false);
    d.update(200, 0.016);
    expect(d.active).toBeLessThanOrEqual(DEBRIS_CAP.low);
    // Everything is gone within 4 s of the last throw.
    for (let t = 200; t < 5000; t += 16) d.update(t, 0.016);
    expect(d.active).toBe(0);
    const e = new Debris();
    e.groundAt = () => 0.5;
    e.spawn('vehicle', { x: 1, y: 0.5, z: 1 }, 3, 0.4, 0x123456, 0);
    for (let t = 0; t < 3000; t += 16) e.update(t, 0.016);
    expect(e.thrown).toBe(chunkCount('vehicle', 3, 0.4));
  });
});

describe('Brawl scenario (R3D-29)', () => {
  it('R3D-29: the brawl has about 200 mixed units, both factions, on free tiles close enough to be in contact', () => {
    const c = brawlConfig(1);
    const units = c.units ?? [];
    expect(units.length).toBe(200);
    for (const owner of [0, 1]) expect(units.filter((u) => u.owner === owner).length).toBe(100);
    const factions = new Set(units.map((u) => UNIT_DEFS[u.kind]!.faction));
    expect(factions).toEqual(new Set(['human', 'alien']));
    expect(new Set(units.map((u) => u.kind)).size).toBeGreaterThanOrEqual(10);
    const tiles = new Set(units.map((u) => `${u.tx},${u.ty}`));
    expect(tiles.size).toBe(200);
    for (const u of units) expect(c.map.blocked?.[u.ty * c.map.width + u.tx]).toBeFalsy();
    const mean = (o: number, k: 'tx' | 'ty'): number => units.filter((u) => u.owner === o).reduce((s, u) => s + u[k], 0) / 100;
    expect(Math.hypot(mean(0, 'tx') - mean(1, 'tx'), mean(0, 'ty') - mean(1, 'ty'))).toBeLessThan(10);
    expect(brawlConfig(1)).toEqual(c);
  });
});
