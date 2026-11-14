import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { poseRig, rigTree, type RigDef, type RigPose, type RigTree } from '../../src/render3d/rig';
import { UNIT_RIGS } from '../../src/render3d/units3d';

const STILL: RigPose = { turret: 0, kick: 0, lunge: 0, pitch: 0, roll: 0, bob: 0, phase: 0, stride: 0, dist: 0, turnRate: 0, time: 0, reach: 0, walker: false };
const CYAN = 0x6fe2ff;
const VEHICLES = ['hum_hauler', 'hum_tank', 'hum_artillery'] as const;

/** The triangles of a model and of its shadow stand-in, each shape counted as many times as the rig draws it, and its distinct shapes (draw calls). */
function totals(kind: string): { triangles: number; shadow: number; shapes: number } {
  const def = UNIT_RIGS[kind]!();
  let triangles = 0;
  let shadow = 0;
  const shapes = new Set<string>();
  for (const d of rigTree(def).drawn) {
    const b = def.shapes[d.geo]!().build(0xff0000);
    triangles += b.triangles;
    shadow += b.shadowTriangles ?? 0;
    shapes.add(d.geo);
  }
  return { triangles, shadow, shapes: shapes.size };
}

/** World box of the drawn parts of a posed rig (optionally only the given shapes), and the world points of its muzzles. */
function measure(def: RigDef, t: RigTree, pose: Partial<RigPose> = {}, only?: readonly string[]): { box: THREE.Box3; muzzles: THREE.Vector3[] } {
  poseRig(t, { ...STILL, ...pose });
  t.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const d of t.drawn) {
    if (d.cargo || (only && !only.includes(d.geo))) continue;
    for (const p of def.shapes[d.geo]!().pieces) {
      const pos = p.geo.getAttribute('position');
      for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(d.obj.matrixWorld));
    }
  }
  return { box, muzzles: t.muzzles.map((m) => new THREE.Vector3().setFromMatrixPosition(m.matrixWorld)) };
}

/** Bounding box of one piece in its shape's own frame. */
const boxOf = (p: { geo: THREE.BufferGeometry }): THREE.Box3 => {
  p.geo.computeBoundingBox();
  return p.geo.boundingBox!.clone();
};

describe('PERF-7: the restyled vehicles stay within a triangle limit', () => {
  // Pre-restyle counts (origin/main before #170), measured the same way as `totals`: triangles of the drawn model and of its shadow stand-in, and distinct shapes.
  const BEFORE = {
    hum_tank: { triangles: 2504, shadow: 524, shapes: 5 },
    hum_artillery: { triangles: 4412, shadow: 816, shapes: 6 },
    hum_hauler: { triangles: 5872, shadow: 2188, shapes: 8 },
  } as const;

  it('PERF-7: the Bulwark Tank, which fills the 200-unit brawl, uses no more triangles than before, for the model and for its shadow stand-in, and no more draw calls', () => {
    const now = totals('hum_tank');
    expect(now.triangles).toBeLessThanOrEqual(BEFORE.hum_tank.triangles);
    expect(now.shadow).toBeLessThanOrEqual(BEFORE.hum_tank.shadow);
    expect(now.shapes).toBeLessThanOrEqual(BEFORE.hum_tank.shapes);
  });

  it('PERF-7: the Shard Hauler and the Hammer Artillery, of which few are on screen, use at most twice as many triangles as before, in the model and its shadow, with no more draw calls', () => {
    for (const kind of ['hum_hauler', 'hum_artillery'] as const) {
      const now = totals(kind);
      expect(now.triangles, kind).toBeLessThanOrEqual(2 * BEFORE[kind].triangles);
      expect(now.shadow, kind).toBeLessThanOrEqual(2 * BEFORE[kind].shadow);
      expect(now.shapes, kind).toBeLessThanOrEqual(BEFORE[kind].shapes);
    }
  });
});

describe('R3D-35: the Aegis vehicles are grounded science fiction in one family', () => {
  it('R3D-35: no vehicle has an exhaust stack, exposed hydraulic ram, stowage, smoke discharger, camouflage blotch or visible crew', () => {
    const crew = [0xb98a6a, 0x5c6a4e, 0x4a4f58]; // skin and the troopers' cloth
    const camo = [0x93855a, 0x4f5d3a]; // the old tank's tan and olive blocks
    for (const kind of VEHICLES) {
      const def = UNIT_RIGS[kind]!();
      for (const [name, make] of Object.entries(def.shapes)) {
        for (const p of make().pieces) {
          const size = boxOf(p).getSize(new THREE.Vector3());
          expect(p.size, `${kind}/${name}: no slanted rods (rams, struts)`).toBeUndefined();
          // A stack is a tall thin vertical cylinder; a smoke discharger or exhaust is a short thin cylinder on the hull.
          if (p.geo.type === 'CylinderGeometry' && !p.glow) {
            expect(size.y > 0.25 && size.x < 0.1 && size.z < 0.1, `${kind}/${name}: a stack`).toBe(false);
            expect(Math.max(size.x, size.y, size.z) < 0.09 && Math.min(size.x, size.y, size.z) < 0.04 && size.y > size.x, `${kind}/${name}: a small tube`).toBe(false);
          }
          expect(crew, `${kind}/${name}: crew`).not.toContain(p.paint);
          expect(camo, `${kind}/${name}: camouflage`).not.toContain(p.paint);
        }
      }
    }
  });

  it('R3D-35: each vehicle carries small cyan-lit details, and its lit parts are glowing pieces (no new material)', () => {
    for (const kind of VEHICLES) {
      const def = UNIT_RIGS[kind]!();
      const lit = Object.values(def.shapes).flatMap((make) => make().pieces.filter((p) => p.glow && p.paint === CYAN));
      expect(lit.length, kind).toBeGreaterThanOrEqual(3);
    }
  });

  it('R3D-35: each vehicle keeps its footprint and overall size, within a tenth, and its muzzle points where they were', () => {
    // Pre-restyle sizes (x length, z width) at rest and the muzzle points, tiles, measured on origin/main before #170. The hauler's tail is
    // drawn in so that it stops in front of the refinery's intake (R3D-22), which is why it is a little shorter.
    const before = {
      hum_tank: { x: 1.465, z: 0.77 },
      hum_artillery: { x: 2.013, z: 0.848 },
      hum_hauler: { x: 2.041, z: 0.83 },
    } as const;
    for (const kind of VEHICLES) {
      const def = UNIT_RIGS[kind]!();
      const { box } = measure(def, rigTree(def));
      const size = box.getSize(new THREE.Vector3());
      expect(size.x / before[kind].x, `${kind} length`).toBeGreaterThan(kind === 'hum_hauler' ? 0.88 : 0.93);
      expect(size.x / before[kind].x, `${kind} length`).toBeLessThan(1.1);
      expect(size.z / before[kind].z, `${kind} width`).toBeGreaterThan(0.93);
      expect(size.z / before[kind].z, `${kind} width`).toBeLessThan(1.1);
      expect(box.min.y, kind).toBeGreaterThan(-0.02);
    }
    const tank = UNIT_RIGS.hum_tank!();
    const at = measure(tank, rigTree(tank)).muzzles;
    expect(at).toHaveLength(1);
    expect(at[0]!.distanceTo(new THREE.Vector3(0.86, 0.36, 0))).toBeLessThan(0.01);
    const arty = UNIT_RIGS.hum_artillery!();
    const tree = rigTree(arty);
    expect(measure(arty, tree, { elev: 0 }).muzzles[0]!.distanceTo(new THREE.Vector3(1.239, 0.54, 0))).toBeLessThan(0.01);
    expect(measure(arty, tree, { elev: 1 }).muzzles[0]!.distanceTo(new THREE.Vector3(0.986, 1.217, 0))).toBeLessThan(0.01);
    expect(UNIT_RIGS.hum_hauler!().root.kids!.length).toBeGreaterThan(0);
    expect(rigTree(UNIT_RIGS.hum_hauler!()).muzzles).toHaveLength(0);
  });

  it('R3D-35: the team colour stays on the same parts: the tank on its skirts and turret plate, the artillery on its skirt stripes and turret strip, the hauler on its cab roof, hopper bands and belts', () => {
    const teamIn = (kind: string, shape: string): number => UNIT_RIGS[kind]!().shapes[shape]!().pieces.filter((p) => p.paint === 'team').length;
    expect(teamIn('hum_tank', 'hull')).toBe(2);
    expect(teamIn('hum_tank', 'turret')).toBe(1);
    expect(teamIn('hum_artillery', 'hull')).toBe(2);
    expect(teamIn('hum_artillery', 'turret')).toBeGreaterThanOrEqual(1);
    expect(teamIn('hum_hauler', 'body')).toBeGreaterThanOrEqual(3);
    expect(teamIn('hum_hauler', 'hopper')).toBe(2);
  });

  it('R3D-35: none of the three looks more advanced than the Paladin: no hovering, no legs, wheels or tracks on the ground, a plain painted hull', () => {
    for (const kind of VEHICLES) {
      const def = UNIT_RIGS[kind]!();
      expect(['wheeled', 'tracked'], kind).toContain(def.move);
      const t = rigTree(def);
      expect(t.anims.filter((a) => a.anim.k === 'step' || a.anim.k === 'gait'), kind).toHaveLength(0);
      expect(t.anims.filter((a) => a.anim.k === 'wheel').length, kind).toBeGreaterThanOrEqual(6);
      const { box } = measure(def, t);
      expect(box.min.y, `${kind} stands on the ground`).toBeLessThan(0.02);
    }
  });
});

describe('R3D-36: the Bulwark Tank', () => {
  const def = UNIT_RIGS.hum_tank!();
  const hull = def.shapes.hull!().pieces;
  const turret = def.shapes.turret!().pieces;
  const barrel = def.shapes.barrel!().pieces;

  it('R3D-36: it is low and wide, with full-length team-coloured skirts over its tracks so only the lower run of each track shows', () => {
    const t = rigTree(def);
    const { box } = measure(def, t);
    const size = box.getSize(new THREE.Vector3());
    expect(size.y).toBeLessThan(0.7); // low: hull and turret, with only a short blade antenna above them
    expect(size.z).toBeGreaterThan(0.75); // wide
    // Skirts: two team slabs along the hull's whole length, outside the tracks and covering their upper part.
    const skirts = hull.filter((p) => p.paint === 'team');
    expect(skirts).toHaveLength(2);
    const trackBox = measure(def, t, {}, ['track']).box;
    for (const p of skirts) {
      const b = boxOf(p);
      expect(b.getSize(new THREE.Vector3()).x, 'full length').toBeGreaterThan(1.1);
      expect(Math.abs(b.getCenter(new THREE.Vector3()).z), 'outside the track').toBeGreaterThan(trackBox.max.z - 0.03);
      expect(b.min.y, 'hangs down over the track').toBeLessThan(trackBox.min.y + 0.12);
      expect(b.max.y, 'covers the top of the track').toBeGreaterThan(trackBox.max.y + 0.08);
    }
    // The road wheels still turn below the skirts: five a side.
    expect(t.anims.filter((a) => a.anim.k === 'wheel')).toHaveLength(10);
  });

  it('R3D-36: a flat wedge turret with no hatches sits mid-hull, with a team plate, a sensor blister, a short blade antenna and no cupola', () => {
    const t = rigTree(def);
    const turretNode = t.drawn.find((d) => d.geo === 'turret')!;
    expect(Math.abs(turretNode.obj.position.x), 'mid-hull').toBeLessThan(0.15);
    // Flat: its body, antenna aside, stands barely above its base.
    const bodyTop = Math.max(...turret.map(boxOf).filter((b) => b.getSize(new THREE.Vector3()).z > 0.03).map((b) => b.max.y));
    expect(bodyTop, 'flat').toBeLessThan(0.25);
    // A wedge: its roof rises toward the tail (taller behind than in front).
    const roof = turret.map(boxOf).filter((b) => b.max.y > 0.1);
    expect(roof.length).toBeGreaterThan(0);
    // No hatches or cupola: nothing round and upright on the turret at all, only a dome-shaped sensor blister.
    expect(turret.filter((p) => p.geo.type === 'CylinderGeometry')).toHaveLength(0);
    expect(turret.filter((p) => p.geo.type === 'SphereGeometry')).toHaveLength(1);
    expect(turret.filter((p) => p.paint === 'team')).toHaveLength(1);
    // The blade antenna: thin, flat and short.
    const blade = turret.map(boxOf).filter((b) => {
      const s = b.getSize(new THREE.Vector3());
      return s.y > 0.1 && s.y < 0.22 && s.z < 0.03 && s.x < 0.04;
    });
    expect(blade).toHaveLength(1);
  });

  it('R3D-36: one heavy cannon: a thick barrel in a ribbed accelerator sleeve with a cyan-lit breech, and one muzzle', () => {
    const t = rigTree(def);
    expect(t.drawn.filter((d) => d.geo === 'barrel')).toHaveLength(1);
    expect(t.muzzles).toHaveLength(1);
    const tubes = barrel.filter((p) => p.geo.type === 'CylinderGeometry');
    // The thick barrel: wider than the old 0.056, and long.
    const thick = tubes.map(boxOf).filter((b) => b.getSize(new THREE.Vector3()).x > 0.4);
    expect(thick.length).toBeGreaterThanOrEqual(1);
    expect(thick[0]!.getSize(new THREE.Vector3()).z).toBeGreaterThan(0.07);
    // The sleeve: at least four collars wider than the barrel along it, and lit gaps between them.
    const collars = tubes.map(boxOf).filter((b) => {
      const s = b.getSize(new THREE.Vector3());
      return s.x < 0.1 && s.z > 0.09;
    });
    expect(collars.length).toBeGreaterThanOrEqual(4);
    expect(barrel.filter((p) => p.glow && p.paint === CYAN).length).toBeGreaterThanOrEqual(4); // three lit gaps and the breech
    // The breech is lit at the cannon's back end.
    const breech = barrel.filter((p) => p.glow).map(boxOf).filter((b) => b.max.x < 0.1);
    expect(breech.length).toBeGreaterThanOrEqual(1);
    // No muzzle brake box or fume extractor of the old gun; the muzzle collar ends at the muzzle point.
    const end = Math.max(...barrel.map((p) => boxOf(p).max.x));
    expect(end).toBeGreaterThan(0.58);
    expect(end).toBeLessThan(0.64);
  });

  it('R3D-36: a lit power vent sits at the rear of the hull, and the paint is clean green panels', () => {
    const vent = hull.filter((p) => p.glow).map(boxOf).filter((b) => b.max.x < -0.4);
    expect(vent.length).toBeGreaterThanOrEqual(1);
    for (const p of [...hull, ...turret, ...barrel]) {
      if (p.glow || p.paint === 'team' || typeof p.paint !== 'number') continue;
      const c = new THREE.Color(p.paint);
      // No tan or brown camouflage: nothing redder than green among the tank's own paints.
      expect(c.r, p.paint.toString(16)).toBeLessThanOrEqual(c.g + 0.02);
    }
  });
});

describe('R3D-32: the Hammer Artillery as a long-barrelled coil gun', () => {
  const def = UNIT_RIGS.hum_artillery!();
  const hull = def.shapes.hull!().pieces;
  const turret = def.shapes.turret!().pieces;
  const barrel = def.shapes.barrel!().pieces;

  it('R3D-32: the barrel is long and round, of moderate thickness, out of a rounded breech housing, with a few wide-spaced cyan-lit coil rings, no muzzle brake and no hazard bands', () => {
    // One long round tube: a cylinder most of the barrel's length, thicker than the old thin rails but no fatter than the tank's cannon.
    const tubes = barrel.filter((p) => p.geo.type === 'CylinderGeometry' && !p.glow).map(boxOf);
    const long = tubes.filter((b) => b.getSize(new THREE.Vector3()).x > 0.7);
    expect(long).toHaveLength(1);
    const tube = long[0]!.getSize(new THREE.Vector3());
    expect(Math.abs(tube.z - tube.y), 'round: as wide as it is tall (a many-sided cylinder)').toBeLessThan(0.005);
    expect(tube.y, 'moderate thickness').toBeGreaterThan(0.06);
    expect(tube.y, 'moderate thickness').toBeLessThan(0.09);
    // Slimmer and longer than the Bulwark Tank's cannon.
    const cannon = UNIT_RIGS.hum_tank!().shapes.barrel!().pieces.filter((p) => p.geo.type === 'CylinderGeometry').map(boxOf).find((b) => b.getSize(new THREE.Vector3()).x > 0.4)!;
    const c = cannon.getSize(new THREE.Vector3());
    expect(tube.x).toBeGreaterThan(c.x * 1.4);
    expect(tube.y).toBeLessThanOrEqual(c.y + 1e-6);
    // No box section at all: nothing long and square along the barrel (the old rails, frame and muzzle block).
    expect(barrel.filter((p) => p.geo.type !== 'CylinderGeometry' && boxOf(p).getSize(new THREE.Vector3()).x > 0.2)).toHaveLength(0);
    // The rounded breech housing where it leaves the turret: a fat round piece at the barrel's root with a round nose.
    const breech = tubes.filter((b) => b.max.x < 0.35 && b.getSize(new THREE.Vector3()).y > 0.12);
    expect(breech.length).toBeGreaterThanOrEqual(1);
    expect(barrel.filter((p) => p.geo.type === 'SphereGeometry').map(boxOf).filter((b) => b.max.x < 0.4)).toHaveLength(1);
    // A few lit coil rings, wider than the tube and wide-spaced (unlike the tank's close-ribbed sleeve), and a lit band on the breech.
    const rings = barrel.filter((p) => p.glow && p.paint === CYAN && p.geo.type === 'CylinderGeometry').map((p) => boxOf(p).getCenter(new THREE.Vector3()).x).filter((x) => x > 0.4).sort((a, b) => a - b);
    expect(rings.length).toBeGreaterThanOrEqual(3);
    expect(rings.length).toBeLessThanOrEqual(4);
    for (let k = 1; k < rings.length; k++) expect(rings[k]! - rings[k - 1]!).toBeGreaterThan(0.15);
    expect(barrel.filter((p) => p.glow && p.paint === CYAN).map(boxOf).filter((b) => b.max.x < 0.35)).not.toHaveLength(0);
    // A clean muzzle: the barrel ends in one plain collar at the muzzle point, no brake.
    const end = Math.max(...barrel.map((p) => boxOf(p).max.x));
    expect(end).toBeGreaterThan(1.12);
    expect(end).toBeLessThan(1.17);
    expect(barrel.map(boxOf).filter((b) => b.min.x > 1.05)).toHaveLength(1);
    // No hazard-yellow band anywhere on the piece.
    for (const make of Object.values(def.shapes)) for (const p of make().pieces) expect([0xf2c53a, 0xe0aa2c], 'hazard band').not.toContain(p.paint);
  });

  it('R3D-32: sealed pale faceted shells: armoured skirts over the tracks with the road wheels showing below, a sensor array and a capacitor housing on the turret', () => {
    const t = rigTree(def);
    // Skirts: two long pale slabs outside the tracks whose lower edge is above the wheels' axles, so the wheels' lower part shows.
    const skirts = hull.map(boxOf).filter((b) => b.getSize(new THREE.Vector3()).x > 1.4 && Math.abs(b.getCenter(new THREE.Vector3()).z) > 0.37 && b.getSize(new THREE.Vector3()).z < 0.06);
    expect(skirts.length).toBeGreaterThanOrEqual(2);
    const wheel = t.anims.find((a) => a.anim.k === 'wheel')!;
    for (const s of skirts) expect(s.min.y).toBeGreaterThan(wheel.pos.y + 0.005);
    // The sensor array: a panel on the roof with at least three cyan lenses; the capacitor housing at the rear with lit cells.
    const roofLenses = turret.filter((p) => p.glow && p.paint === CYAN).map(boxOf).filter((b) => b.min.y > 0.38);
    expect(roofLenses.length).toBeGreaterThanOrEqual(3);
    const housing = turret.map(boxOf).filter((b) => b.max.x < -0.37 && b.getSize(new THREE.Vector3()).y > 0.15 && b.getSize(new THREE.Vector3()).z > 0.3);
    expect(housing.length).toBeGreaterThanOrEqual(1);
    const cells = turret.filter((p) => p.glow && p.paint === CYAN).map(boxOf).filter((b) => b.max.x < -0.44 && b.getSize(new THREE.Vector3()).y > 0.1);
    expect(cells.length).toBeGreaterThanOrEqual(3);
    // Pale panels: its own paint is paler than the tank's (and none is a warm or green tint).
    for (const p of [...hull, ...turret]) {
      if (p.glow || p.paint === 'team' || typeof p.paint !== 'number') continue;
      const c = new THREE.Color(p.paint);
      expect(c.g, p.paint.toString(16)).toBeLessThanOrEqual(c.b + 0.05);
    }
  });
});

describe('R3D-23: the vehicle paints are clean solid panels', () => {
  it('R3D-23: the tank wears green panels, the artillery pale ones, the buggy warm ones, each with a handful of solid colours and no camouflage blotches', () => {
    const colours = (kind: string): Set<number> => new Set(Object.values(UNIT_RIGS[kind]!().shapes).flatMap((make) => make().pieces.filter((p) => !p.glow && typeof p.paint === 'number').map((p) => p.paint as number)));
    const hue = (n: number): 'warm' | 'green' | 'cool' | 'neutral' => {
      const c = new THREE.Color(n);
      if (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 0.06) return 'neutral';
      if (c.r > c.g && c.r > c.b) return 'warm';
      return c.g >= c.b ? 'green' : 'cool';
    };
    // The tank: dark steel and greens (no warm tan or brown), the sensor blister's tint aside.
    for (const n of colours('hum_tank')) expect(hue(n), n.toString(16)).not.toBe('warm');
    // The artillery: cool pale greys.
    for (const n of colours('hum_artillery')) expect(hue(n), n.toString(16)).not.toBe('warm');
    // The tank's own panel colours are three greens at most, not a patchwork.
    const greens = [...colours('hum_tank')].filter((n) => hue(n) === 'green');
    expect(greens.length).toBeLessThanOrEqual(4);
  });
});
