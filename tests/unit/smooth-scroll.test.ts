import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PAN_MAX_DT, PAN_SPEED, panStep } from '../../src/render/camera';
import { Instancer, SHADOW_LAYER } from '../../src/render3d/instancer';
import { castsShadow, Shape } from '../../src/render3d/kit';
import { snapShadowTarget, SUN_OFFSET } from '../../src/render3d/lighting3d';
import { ResolutionGovernor } from '../../src/render3d/resolution';
import { UNIT_RIGS } from '../../src/render3d/units3d';

describe('smooth scrolling and simple shadows', () => {
  it('PERF-3: a pan moves the view in proportion to the frame time, so equal frames move equally', () => {
    expect(panStep(16)).toBeCloseTo(PAN_SPEED * 0.016, 6);
    expect(panStep(32)).toBeCloseTo(2 * panStep(16), 6);
    expect(panStep(8) + panStep(8)).toBeCloseTo(panStep(16), 6);
  });

  it('PERF-3: a pan never counts a frame longer than the cap, and never moves backwards', () => {
    expect(panStep(60)).toBeCloseTo(PAN_SPEED * 0.06, 6);
    expect(panStep(5000)).toBeCloseTo(PAN_SPEED * PAN_MAX_DT, 6);
    expect(panStep(-10)).toBe(0);
  });

  it('PERF-3: the sun target snaps to the shadow map grid, within a texel or so, so shadow edges do not crawl while panning', () => {
    const texel = 44 / 2048;
    // Light-space axes, as the snap builds them.
    const [ox, oy, oz] = SUN_OFFSET;
    const bl = Math.hypot(ox, oy, oz);
    const [bx, by, bz] = [ox / bl, oy / bl, oz / bl];
    const rl = Math.hypot(bz, bx);
    const right = (x: number, z: number): number => (x * bz) / rl + (z * -bx) / rl;
    const up = (x: number, z: number): number => x * by * (-bx / rl) + z * -by * (bz / rl);
    for (const [x, z] of [[10.3, 20.7], [10.31, 20.7], [55.123, 4.9], [0, 0]] as const) {
      const s = snapShadowTarget(x, z, texel);
      expect(Math.abs(s.x - x)).toBeLessThan(texel * 3);
      expect(Math.abs(s.z - z)).toBeLessThan(texel * 3);
      expect(right(s.x, s.z) / texel).toBeCloseTo(Math.round(right(s.x, s.z) / texel), 4);
      expect(up(s.x, s.z) / texel).toBeCloseTo(Math.round(up(s.x, s.z) / texel), 4);
    }
    // Moving less than a texel never moves the snapped target by more than a texel, so a slow pan steps in whole texels.
    const a = snapShadowTarget(30, 30, texel);
    const b = snapShadowTarget(30 + texel / 4, 30, texel);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(texel * 2);
  });

  it('PERF-2 PERF-3: frames that alternate on time and missed (under 50 fps on average) still lower the resolution, one step at a time, never below the floor', () => {
    const g = new ResolutionGovernor(1);
    const seen: number[] = [];
    for (let i = 0; i < 600; i++) {
      if (g.step(16.7, 3, 15)) seen.push(g.ratio);
      if (g.step(33.3, 3, 15)) seen.push(g.ratio);
    }
    expect(seen[0]).toBeCloseTo(0.9); // the first drop comes within a few seconds, one step
    expect(g.ratio).toBe(0.85); // and it stops at the floor
    expect(Math.min(...seen)).toBe(0.85);
    expect(g.ratio).toBe(0.85);
  });

  it('PERF-3: a canvas resize is not part of a resolution change when post-processing is on (the composer scales up to a fixed canvas)', () => {
    // The governor only changes a number; the view keeps the canvas at the governor's maximum and moves the composer alone.
    const g = new ResolutionGovernor(1);
    const max = g.max;
    for (let i = 0; i < 200; i++) g.step(33.3, 3, 25);
    expect(g.ratio).toBeLessThan(max);
    expect(g.max).toBe(max);
  });

  it('PERF-4: small parts cast no shadow and thin rods none, larger parts do', () => {
    expect(castsShadow([0.05, 0.05, 0.05])).toBe(false);
    expect(castsShadow([0.09, 0.08, 0.07])).toBe(false);
    expect(castsShadow([0.5, 0.02, 0.02])).toBe(false);
    expect(castsShadow([0.5, 0.04, 0.04])).toBe(true);
    expect(castsShadow([0.4, 0.3, 0.2])).toBe(true);
  });

  it('PERF-4: a shape casts its shadow from a stand-in with fewer triangles, without the small pieces', () => {
    const shape = new Shape()
      .box(0.8, 0.3, 0.5, 0x888888)
      .cyl(0.2, 0.2, 0x888888, { at: [0, 0.3, 0], seg: 12 })
      .tube(0.03, 0.6, 0x444444, { at: [0.5, 0.3, 0] })
      .box(0.04, 0.04, 0.04, 0xff0000, { at: [0, 0.5, 0] });
    const b = shape.build(0xffffff);
    expect(b.shadow).toBeTruthy();
    expect(b.shadowTriangles!).toBeLessThan(b.triangles * 0.5);
    // The tiny box added nothing: a plain box (12) + a six-sided cylinder (6 sides x 4) + the barrel (6 sides x 4).
    expect(b.shadowTriangles!).toBeLessThanOrEqual(12 + 24 + 24);
    expect(Object.keys(b.shadow!.attributes)).toEqual(['position']);
  });

  it('PERF-4: every unit model has a shadow stand-in well under its drawn triangle count', () => {
    let drawn = 0;
    let shade = 0;
    for (const make of Object.values(UNIT_RIGS)) {
      for (const shape of Object.values(make().shapes)) {
        const b = shape().build(0xffffff);
        drawn += b.triangles;
        shade += b.shadowTriangles ?? 0;
        expect(b.shadowTriangles ?? 0).toBeLessThanOrEqual(b.triangles);
      }
    }
    expect(shade).toBeLessThan(drawn * 0.5);
  });

  it('PERF-4: a batch with a stand-in only receives shadows, and its stand-in on the shadow layer casts them from the same instances', () => {
    const scene = new THREE.Scene();
    const inst = new Instancer(scene);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const stand = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial();
    const m = new THREE.Matrix4();
    inst.begin();
    for (let i = 0; i < 40; i++) inst.push('k', geo, mat, true, m.makeTranslation(i, 0, 0), undefined, 0, stand); // past one growth
    inst.end();
    const meshes = scene.children.filter((c): c is THREE.InstancedMesh => (c as THREE.InstancedMesh).isInstancedMesh);
    const lit = meshes.find((x) => x.geometry === geo)!;
    const proxy = meshes.find((x) => x.geometry === stand)!;
    expect(lit.castShadow).toBe(false);
    expect(lit.receiveShadow).toBe(true);
    expect(proxy.castShadow).toBe(true);
    expect(proxy.layers.isEnabled(SHADOW_LAYER)).toBe(true);
    expect(proxy.layers.isEnabled(0)).toBe(false);
    expect(proxy.instanceMatrix).toBe(lit.instanceMatrix);
    expect(proxy.count).toBe(40);
    // Without a stand-in the batch casts for itself, as before.
    const scene2 = new THREE.Scene();
    const inst2 = new Instancer(scene2);
    inst2.begin();
    inst2.push('j', geo, mat, true, m);
    inst2.end();
    const alone = scene2.children[0] as THREE.InstancedMesh;
    expect(alone.castShadow).toBe(true);
  });
});
