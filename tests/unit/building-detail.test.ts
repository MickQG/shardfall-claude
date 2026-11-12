import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILDING_RIGS } from '../../src/render3d/buildings3d';
import type { Built } from '../../src/render3d/kit';
import type { RigDef, RigNode } from '../../src/render3d/rig';

/**
 * Buildings carry fine detail at a bounded cost (R3D-34). The baseline is each building as it was before the detail
 * pass: its drawn and shadow triangles, its bounds at rest (x, z and top, tiles), its team-painted pieces ('team' and
 * 'teamDark'), its small pieces and the kinds of its animated nodes.
 */
interface Baseline {
  tris: number;
  shadow: number;
  box: readonly [number, number, number, number, number];
  team: number;
  dark: number;
  small: number;
  anims: readonly string[];
}

const BASE: Record<string, Baseline> = {
  hum_hq: { tris: 1736, shadow: 424, box: [-1.47, 1.47, -1.47, 1.47, 2.537], team: 2, dark: 0, small: 33, anims: ['spin'] },
  hum_reactor: { tris: 1770, shadow: 486, box: [-0.97, 0.97, -0.97, 0.97, 1.12], team: 3, dark: 0, small: 7, anims: [] },
  hum_refinery: { tris: 1884, shadow: 448, box: [-1.47, 1.47, -0.97, 0.97, 1.35], team: 3, dark: 0, small: 13, anims: [] },
  hum_barracks: { tris: 916, shadow: 424, box: [-0.97, 0.97, -0.97, 0.97, 1.45], team: 2, dark: 0, small: 22, anims: [] },
  hum_factory: { tris: 1816, shadow: 596, box: [-1.47, 1.47, -1.47, 1.47, 1.4], team: 7, dark: 0, small: 21, anims: ['spin', 'spin'] },
  hum_turret: { tris: 1252, shadow: 200, box: [-0.44, 0.58, -0.44, 0.44, 0.545], team: 2, dark: 0, small: 14, anims: ['turret', 'barrel'] },
  hum_lab: { tris: 1960, shadow: 326, box: [-0.97, 0.97, -0.97, 0.97, 1.187], team: 1, dark: 0, small: 15, anims: ['spin', 'spin'] },
  hum_lance: { tris: 1740, shadow: 296, box: [-1.47, 1.47, -1.47, 1.47, 2.57], team: 2, dark: 0, small: 10, anims: ['spin'] },
  ali_hq: { tris: 6258, shadow: 2524, box: [-1.804, 1.778, -1.756, 1.827, 2.15], team: 1, dark: 17, small: 40, anims: ['breathe'] },
  ali_generator: { tris: 8218, shadow: 3442, box: [-1.192, 1.279, -1.168, 1.363, 0.737], team: 3, dark: 33, small: 97, anims: ['breathe'] },
  ali_extractor: { tris: 5398, shadow: 2356, box: [-1.707, 1.678, -1.166, 1.356, 1.134], team: 1, dark: 16, small: 45, anims: [] },
  ali_nest: { tris: 9708, shadow: 4054, box: [-1.192, 1.279, -1.168, 1.363, 0.935], team: 0, dark: 45, small: 129, anims: [] },
  ali_pit: { tris: 6096, shadow: 1892, box: [-1.823, 1.832, -1.656, 1.878, 1.116], team: 1, dark: 8, small: 36, anims: [] },
  ali_spire: { tris: 3046, shadow: 1284, box: [-0.82, 0.867, -0.874, 0.913, 1.378], team: 2, dark: 5, small: 25, anims: ['turret', 'barrel'] },
  ali_evolver: { tris: 3482, shadow: 1642, box: [-1.192, 1.279, -1.168, 1.363, 1.59], team: 1, dark: 6, small: 25, anims: ['breathe'] },
  ali_rift: { tris: 4644, shadow: 1956, box: [-1.804, 1.778, -1.756, 1.827, 2.029], team: 0, dark: 9, small: 31, anims: ['spin'] },
};

/** A piece is small when its longest side is under a quarter tile. */
const SMALL = 0.25;

interface Measure {
  tris: number;
  shadow: number;
  box: THREE.Box3;
  team: number;
  dark: number;
  small: number;
  anims: string[];
}

/** Every drawn node's shape built once, placed by the rest pose of the rig (node offsets and turns, no animation). */
function measure(def: RigDef): Measure {
  const built = new Map<string, { b: Built; team: number; dark: number; small: number }>();
  for (const [key, make] of Object.entries(def.shapes)) {
    const s = make();
    let small = 0;
    for (const p of s.pieces) {
      p.geo.computeBoundingBox();
      const v = p.geo.boundingBox!.getSize(new THREE.Vector3());
      if (Math.max(v.x, v.y, v.z) < SMALL) small++;
    }
    built.set(key, { b: s.build(0x3fa0ff), team: s.pieces.filter((p) => p.paint === 'team').length, dark: s.pieces.filter((p) => p.paint === 'teamDark').length, small });
  }
  const m: Measure = { tris: 0, shadow: 0, box: new THREE.Box3(), team: 0, dark: 0, small: 0, anims: [] };
  const visit = (n: RigNode, parent: THREE.Matrix4): void => {
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...(n.at ?? [0, 0, 0])), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(n.rot ?? [0, 0, 0]))), new THREE.Vector3(1, 1, 1));
    const world = parent.clone().multiply(local);
    if (n.anim) m.anims.push(n.anim.k);
    const d = n.geo ? built.get(n.geo) : undefined;
    if (d) {
      m.tris += d.b.triangles;
      m.shadow += d.b.shadowTriangles ?? 0;
      m.team += d.team;
      m.dark += d.dark;
      m.small += d.small;
      for (const g of [d.b.lit, d.b.glow]) {
        if (!g) continue;
        g.computeBoundingBox();
        m.box.union(g.boundingBox!.clone().applyMatrix4(world));
      }
    }
    for (const k of n.kids ?? []) visit(k, world);
  };
  visit(def.root, new THREE.Matrix4());
  return m;
}

const measured = new Map<string, Measure>();
const of = (kind: string): Measure => {
  let m = measured.get(kind);
  if (!m) measured.set(kind, (m = measure(BUILDING_RIGS[kind]!())));
  return m;
};

describe('building fine detail', () => {
  it('R3D-34: the baseline covers every building', () => {
    expect(Object.keys(BASE).sort()).toEqual(Object.keys(BUILDING_RIGS).sort());
  });

  it('R3D-34: no building is drawn with more than twice its earlier triangles or more than 6,000', () => {
    for (const [kind, b] of Object.entries(BASE)) {
      const m = of(kind);
      expect(m.tris, kind).toBeLessThanOrEqual(Math.min(2 * b.tris, 6000));
    }
  }, 30_000);

  it('R3D-34: shadows still come from the stand-in, which barely grows: the small new parts cast none (PERF-4)', () => {
    for (const [kind, b] of Object.entries(BASE)) {
      const m = of(kind);
      expect(m.shadow, kind).toBeLessThanOrEqual(b.shadow * 1.1);
      expect(m.shadow, kind).toBeLessThan(m.tris * 0.6);
    }
  }, 30_000);

  it('R3D-34: every building keeps its footprint and height, within a few percent', () => {
    for (const [kind, b] of Object.entries(BASE)) {
      const { box } = of(kind);
      const [x0, x1, z0, z1, top] = b.box;
      const near = (got: number, want: number, span: number): void => expect(Math.abs(got - want), `${kind} ${got.toFixed(3)} vs ${want}`).toBeLessThanOrEqual(Math.max(0.04, 0.03 * span));
      near(box.min.x, x0, x1 - x0);
      near(box.max.x, x1, x1 - x0);
      near(box.min.z, z0, z1 - z0);
      near(box.max.z, z1, z1 - z0);
      near(box.max.y, top, top);
    }
  }, 30_000);

  it('R3D-34: team-coloured parts are all still there', () => {
    for (const [kind, b] of Object.entries(BASE)) {
      const m = of(kind);
      expect(m.team, kind).toBe(b.team);
      expect(m.dark, kind).toBeGreaterThanOrEqual(Math.floor(b.dark * 0.8));
      expect(m.team + m.dark, kind).toBeGreaterThan(0);
    }
  }, 30_000);

  it('R3D-34: every building shows many small-scale features beyond its main masses', () => {
    for (const [kind, b] of Object.entries(BASE)) {
      const m = of(kind);
      expect(m.small, kind).toBeGreaterThanOrEqual(Math.max(24, b.small + 10));
    }
  }, 30_000);

  it('R3D-34: the detail does not move: no building gains an animated part', () => {
    for (const [kind, b] of Object.entries(BASE)) expect(of(kind).anims, kind).toEqual(b.anims);
  }, 30_000);
});
