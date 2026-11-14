import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { buildingDef } from '../../src/data/defs';
import { BUILDING_RIGS, DOCK_RIGS, dockFrame, dockModelYaw, dockYaw } from '../../src/render3d/buildings3d';
import { poseRig, rigTree, type RigDef, type RigPose } from '../../src/render3d/rig';
import { UNIT_RIGS } from '../../src/render3d/units3d';

const STILL: RigPose = { turret: 0, kick: 0, lunge: 0, pitch: 0, roll: 0, bob: 0, phase: 0, stride: 0, dist: 0, turnRate: 0, time: 0, reach: 0, walker: false };

/** How far a unit's parts may reach into a building or its dock, tiles (R3D-22). */
const REACH = 0.03;
/** A refinery at tile (10, 20) with its pad on each side in turn, as the dock tests place it. */
const PADS: [number, number][] = [[13, 21], [9, 20], [11, 22], [11, 19]];

interface Solid {
  name: string;
  hull: ConvexHull;
  box: THREE.Box3;
}

/** Every distinct vertex of a model's drawn pieces in world space (under `root`, already placed), unless drawn in a cargo node. */
function worldPieces(def: RigDef, tree: ReturnType<typeof rigTree>): { name: string; pts: THREE.Vector3[] }[] {
  tree.root.updateMatrixWorld(true);
  const out: { name: string; pts: THREE.Vector3[] }[] = [];
  for (const d of tree.drawn) {
    if (d.cargo) continue;
    def.shapes[d.geo]!().pieces.forEach((p, k) => {
      const pos = p.geo.getAttribute('position');
      const seen = new Map<string, THREE.Vector3>();
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(d.obj.matrixWorld);
        seen.set(`${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`, v);
      }
      out.push({ name: `${d.geo}#${k}`, pts: [...seen.values()] });
    });
  }
  return out;
}

/** The solid pieces of a placed model: those with a real thickness, as convex hulls (the measure `aim-clipping.test.ts` uses). */
function solidsOf(def: RigDef, tree: ReturnType<typeof rigTree>, label: string): Solid[] {
  const solids: Solid[] = [];
  for (const p of worldPieces(def, tree)) {
    const box = new THREE.Box3().setFromPoints(p.pts);
    const size = box.getSize(new THREE.Vector3());
    if (Math.min(size.x, size.y, size.z) <= 0.004 || Math.max(size.x, size.y, size.z) < 0.05 || p.pts.length < 4) continue;
    solids.push({ name: `${label}:${p.name}`, hull: new ConvexHull().setFromPoints(p.pts), box: box.expandByScalar(REACH * 2) });
  }
  return solids;
}

/** How deep the deepest point of `pts` sits inside any of `solids`, and which pieces. */
function deepest(pts: { name: string; pts: THREE.Vector3[] }[], solids: Solid[]): { depth: number; where: string } {
  let depth = 0;
  let where = '';
  for (const piece of pts) {
    for (const v of piece.pts) {
      for (const s of solids) {
        if (!s.box.containsPoint(v)) continue;
        let inside = Infinity;
        for (const f of s.hull.faces) {
          const d = f.normal.dot(v) - f.constant;
          if (d > 0) {
            inside = 0;
            break;
          }
          inside = Math.min(inside, -d);
        }
        if (inside > depth) {
          depth = inside;
          where = `${piece.name} into ${s.name}`;
        }
      }
    }
  }
  return { depth, where };
}

/** Place a refinery and its dock with `unit` standing on the pad as the view does, posed at `pose`; the deepest reach of the unit into them. */
function clearance(building: string, unit: string, pad: [number, number], pose: Partial<RigPose>): { depth: number; where: string } {
  const bd = buildingDef(building);
  const frame = dockFrame({ kind: building, tx: 10, ty: 20, pad }, bd.w, bd.h)!;
  const world = new THREE.Group();
  const place = (def: RigDef, x: number, z: number, yaw: number) => {
    const tree = rigTree(def);
    tree.root.position.set(x, 0, z);
    tree.root.rotation.y = yaw;
    tree.root.scale.setScalar(def.scale ?? 1);
    world.add(tree.root);
    return tree;
  };
  const bDef = BUILDING_RIGS[building]!();
  const bTree = place(bDef, 10 + bd.w / 2, 20 + bd.h / 2, 0);
  const dDef = DOCK_RIGS[building]!();
  const dTree = place(dDef, frame.x, frame.z, dockModelYaw(frame));
  const uDef = UNIT_RIGS[unit]!();
  const heading = dockYaw(unit, building, frame, frame.x, frame.z)!;
  const uTree = place(uDef, frame.x, frame.z, -heading);
  poseRig(uTree, { ...STILL, walker: uDef.move === 'walker', head: 0, ...pose });
  world.updateMatrixWorld(true);
  const solids = [...solidsOf(bDef, bTree, 'refinery'), ...solidsOf(dDef, dTree, 'dock')];
  return deepest(worldPieces(uDef, uTree), solids);
}

describe('R3D-22: the Shard Hauler at the Aegis refinery', () => {
  const POSES = [0, 0.25, 0.5, 0.75, 1];

  it('R3D-22: resting on the pad, tipping and fully tipped, no part of the Shard Hauler pushes into the refinery or its dock by more than 0.03 tiles, on every side of the building', () => {
    const problems: string[] = [];
    for (const pad of PADS) {
      for (const tip of POSES) {
        const { depth, where } = clearance('hum_refinery', 'hum_hauler', pad, { tip, load: 1 - 0.7 * tip });
        if (process.env.CLR_OUT) appendFileSync(process.env.CLR_OUT, `hauler pad ${pad} tip ${tip}: ${depth.toFixed(3)} ${where}
`);
        if (depth > REACH) problems.push(`pad ${pad} tip ${tip}: ${depth.toFixed(3)} (${where})`);
      }
    }
    expect(problems).toEqual([]);
  }, 120_000);

  it('R3D-22: the receiving trough is low and wide against the wall: under the tipped hopper and its hatch, and between the wheels', () => {
    const dock = DOCK_RIGS.hum_refinery!();
    const tree = rigTree(dock);
    tree.root.updateMatrixWorld(true);
    // The trough is every solid dock piece against the wall (x below -0.2 in the dock's own frame).
    const box = new THREE.Box3();
    for (const p of worldPieces(dock, tree)) {
      const b = new THREE.Box3().setFromPoints(p.pts);
      if (b.max.x < -0.2 && b.getSize(new THREE.Vector3()).z > 0.3) box.union(b);
    }
    const size = box.getSize(new THREE.Vector3());
    expect(size.y, 'low').toBeLessThanOrEqual(0.26);
    expect(size.z, 'wide').toBeGreaterThanOrEqual(0.45);
    expect(box.min.x).toBeGreaterThan(-0.6); // against the wall, its pipe just through it
    expect(box.min.x).toBeLessThan(-0.45);
    // The hauler's tipped hopper and hatch stay above it.
    const hauler = UNIT_RIGS.hum_hauler!();
    const t = rigTree(hauler);
    poseRig(t, { ...STILL, tip: 1 });
    t.root.updateMatrixWorld(true);
    for (const geo of ['hopper', 'hatch']) {
      const d = t.drawn.find((n) => n.geo === geo)!;
      let low = Infinity;
      for (const p of hauler.shapes[geo]!().pieces) {
        const pos = p.geo.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(d.obj.matrixWorld);
          if (v.x < -0.28) low = Math.min(low, v.y);
        }
      }
      expect(low, `${geo} over the trough`).toBeGreaterThanOrEqual(box.max.y - REACH);
    }
  });

  it('R3D-22: the Gorger at the Vrax extractor is measured the same way (reported, nothing changed on the Vrax side)', () => {
    const lines: string[] = [];
    for (const pad of PADS) {
      for (const tip of POSES) {
        const { depth, where } = clearance('ali_extractor', 'ali_gorger', pad, { tip, load: 1 - 0.7 * tip });
        lines.push(`pad ${pad} tip ${tip}: ${depth.toFixed(3)} ${where}`);
      }
    }
    if (process.env.CLR_OUT) appendFileSync(process.env.CLR_OUT, lines.map((l) => `gorger ${l}
`).join(''));
    // Written for the report: the worst reach on any side, and where.
    const worst = lines.map((l) => Number(l.split(': ')[1]!.split(' ')[0])).reduce((a, b) => Math.max(a, b), 0);
    process.env.GORGER_CLEARANCE_REPORT = lines.join('\n');
    expect(worst).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
