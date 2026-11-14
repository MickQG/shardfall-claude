import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { poseRig, rigTree, type RigPose } from '../../src/render3d/rig';
import { UNIT_RIGS } from '../../src/render3d/units3d';

const STILL: RigPose = { turret: 0, kick: 0, lunge: 0, pitch: 0, roll: 0, bob: 0, phase: 0, stride: 0, dist: 0, turnRate: 0, time: 0, reach: 0, walker: false };

/** How finely surfaces are sampled, model units: a measured gap overstates the true one by up to about this. */
const SPACING = 0.015;
/** Two pieces are joined when their surfaces come this close, tiles. */
const GAP = 0.03;

/** Points spread over every triangle of a piece (corners, edges and an interior grid no coarser than SPACING), moved by `m`. */
function surface(geo: THREE.BufferGeometry, m: THREE.Matrix4): number[] {
  const out: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const pos = geo.getAttribute('position');
  const idx = geo.getIndex();
  const n = idx ? idx.count : pos.count;
  for (let i = 0; i < n; i += 3) {
    const at = (k: number): number => (idx ? idx.getX(i + k) : i + k);
    a.fromBufferAttribute(pos, at(0)).applyMatrix4(m);
    b.fromBufferAttribute(pos, at(1)).applyMatrix4(m);
    c.fromBufferAttribute(pos, at(2)).applyMatrix4(m);
    const steps = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / SPACING));
    for (let u = 0; u <= steps; u++) {
      for (let v = 0; u + v <= steps; v++) {
        const wa = (steps - u - v) / steps;
        out.push(a.x * wa + b.x * (u / steps) + c.x * (v / steps), a.y * wa + b.y * (u / steps) + c.y * (v / steps), a.z * wa + b.z * (u / steps) + c.z * (v / steps));
      }
    }
  }
  return out;
}

/**
 * The pieces of a model at rest that hang in the air: not joined, directly or through other pieces, to the largest
 * connected body of the model. Each is named by its part, its number within the part and where its middle is. The load
 * is left out (an empty hopper has none to rest on anything).
 */
function loosePieces(kind: string): string[] {
  const def = UNIT_RIGS[kind]!();
  const t = rigTree(def);
  poseRig(t, STILL);
  t.root.updateMatrixWorld(true);
  const g = GAP / (def.scale ?? 1);
  const labels: string[] = [];
  const points: number[][] = [];
  for (const d of t.drawn) {
    if (d.cargo) continue;
    def.shapes[d.geo]!().pieces.forEach((p, k) => {
      const pts = surface(p.geo, d.obj.matrixWorld);
      const mid = new THREE.Box3().setFromArray(pts).getCenter(new THREE.Vector3());
      labels.push(`${d.geo} #${k} at (${mid.x.toFixed(2)}, ${mid.y.toFixed(2)}, ${mid.z.toFixed(2)})`);
      points.push(pts);
    });
  }
  const parent = labels.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  // Every point goes into a grid of cells GAP wide, so any two points within GAP lie in the same or neighbouring cells.
  // Cells are found through a hash of their integer coordinates; a clash only adds candidates, and every candidate is measured.
  const cell = (x: number): number => Math.floor(x / g);
  const hash = (x: number, y: number, z: number): number => (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  // Each cell keeps its points by piece, so pieces already known to be joined are passed over without measuring.
  const cells = new Map<number, { piece: number; pts: number[] }[]>();
  points.forEach((pts, piece) => {
    for (let k = 0; k < pts.length; k += 3) {
      const key = hash(cell(pts[k]!), cell(pts[k + 1]!), cell(pts[k + 2]!));
      let list = cells.get(key);
      if (!list) cells.set(key, (list = []));
      let own = list[list.length - 1];
      if (!own || own.piece !== piece) list.push((own = { piece, pts: [] }));
      own.pts.push(pts[k]!, pts[k + 1]!, pts[k + 2]!);
    }
  });
  const g2 = g * g;
  let groups = labels.length;
  for (let piece = 0; piece < points.length && groups > 1; piece++) {
    const pts = points[piece]!;
    for (let k = 0; k < pts.length; k += 3) {
      const x = pts[k]!;
      const y = pts[k + 1]!;
      const z = pts[k + 2]!;
      const cx = cell(x);
      const cy = cell(y);
      const cz = cell(z);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const list = cells.get(hash(cx + dx, cy + dy, cz + dz));
            if (!list) continue;
            for (const other of list) {
              if (other.piece === piece || find(other.piece) === find(piece)) continue;
              const o = other.pts;
              for (let j = 0; j < o.length; j += 3) {
                const ex = o[j]! - x;
                const ey = o[j + 1]! - y;
                const ez = o[j + 2]! - z;
                if (ex * ex + ey * ey + ez * ez > g2) continue;
                parent[find(other.piece)] = find(piece);
                groups--;
                break;
              }
            }
          }
        }
      }
    }
  }
  const size = new Map<number, number>();
  labels.forEach((_, i) => size.set(find(i), (size.get(find(i)) ?? 0) + 1));
  const body = [...size.entries()].sort((p, q) => q[1] - p[1])[0]![0];
  return labels.filter((_, i) => find(i) !== body);
}

describe('restyled models have no loose pieces', () => {
  for (const [kind, name] of [['hum_hauler', 'Shard Hauler'], ['hum_tank', 'Bulwark Tank'], ['hum_artillery', 'Hammer Artillery'], ['ali_brute', 'Brute']] as const) {
    it(`R3D-35 R3D-37: no piece of the ${name} hangs in the air: at rest every piece is joined to the rest of the model within 0.03 tiles`, () => {
      expect(loosePieces(kind)).toEqual([]);
    }, 30_000);
  }
});
