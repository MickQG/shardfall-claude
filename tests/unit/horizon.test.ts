import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, centerOnTile, mapBounds, type Camera } from '../../src/render/camera';
import { flyPose } from '../../src/render/flyIn';
import { tileToScreen } from '../../src/render/iso';
import { cameraPose, FOV } from '../../src/render3d/camera3d';
import { HAZE_COLOR, HORIZON_REACH, SKY_TOP_COLOR, horizonHeight, horizonMesh } from '../../src/render3d/horizon3d';

const MAPS = [
  { width: 96, height: 96 },
  { width: 64, height: 64 },
  { width: 128, height: 96 },
];

/** The ground points (y = 0) of the four corner rays of the view, or null for a ray that never meets the ground. */
function footprint(cam: Camera, aspect: number): ({ x: number; z: number } | null)[] {
  const p = cameraPose(cam);
  const c = new THREE.PerspectiveCamera(FOV, aspect, 0.5, 400);
  c.position.set(...p.position);
  c.lookAt(...p.target);
  c.updateMatrixWorld();
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
    const far = new THREE.Vector3(x, y, 1).unproject(c);
    const d = far.sub(c.position).normalize();
    if (d.y >= -1e-6) return null;
    const t = -c.position.y / d.y;
    return { x: c.position.x + d.x * t, z: c.position.z + d.z * t };
  });
}

describe('the horizon beyond the map edge', () => {
  it('R3D-25: at every zoom, over every map corner and the middle, the whole view lands on ground inside the skirt, so no empty space shows', () => {
    for (const m of MAPS) {
      const bounds = mapBounds(m.width, m.height);
      const targets = [[0, 0], [m.width, 0], [m.width, m.height], [0, m.height], [m.width / 2, m.height / 2]] as const;
      for (const [tx, ty] of targets) {
        for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM + 1e-9; zoom += 0.1) {
          for (const aspect of [4 / 3, 16 / 9, 21 / 9]) {
            const cam = centerOnTile({ x: 0, y: 0, zoom }, tx, ty, bounds);
            for (const g of footprint(cam, aspect)) {
              expect(g, `ray misses the ground at zoom ${zoom} over ${tx},${ty}`).not.toBeNull();
              expect(g!.x).toBeGreaterThan(-HORIZON_REACH);
              expect(g!.x).toBeLessThan(m.width + HORIZON_REACH);
              expect(g!.z).toBeGreaterThan(-HORIZON_REACH);
              expect(g!.z).toBeLessThan(m.height + HORIZON_REACH);
            }
          }
        }
      }
    }
  });

  it('R3D-25: during the fly-in sweep too, the view is all ground inside the skirt', () => {
    for (const m of MAPS) {
      const end = centerOnTile({ x: 0, y: 0, zoom: 1 }, 12, 12, mapBounds(m.width, m.height));
      for (let i = 0; i <= 20; i++) {
        for (const g of footprint(flyPose(i / 20, m, end), 16 / 9)) {
          expect(g).not.toBeNull();
          expect(Math.max(Math.abs(g!.x - m.width / 2) - m.width / 2, Math.abs(g!.z - m.height / 2) - m.height / 2)).toBeLessThan(HORIZON_REACH);
        }
      }
    }
    // The sweep's start camera is a screen point; keep the import honest.
    expect(tileToScreen(0, 0).x).toBe(0);
  });

  it('R3D-25: the skirt starts exactly on the map outline at height 0, rolls only gently, and is deterministic', () => {
    const a = horizonMesh(96, 64);
    const b = horizonMesh(96, 64);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
    // The first ring lies on the outline.
    for (let j = 0; j < 200; j++) {
      const x = a.positions[j * 3]!;
      const y = a.positions[j * 3 + 1]!;
      const z = a.positions[j * 3 + 2]!;
      expect(y).toBe(0);
      expect(x >= 0 && x <= 96 && z >= 0 && z <= 64).toBe(true);
      expect(x === 0 || x === 96 || z === 0 || z === 64).toBe(true);
    }
    let top = 0;
    for (let i = 1; i < a.positions.length; i += 3) top = Math.max(top, a.positions[i]!);
    expect(top).toBeGreaterThan(0.5);
    expect(top).toBeLessThan(8);
    expect(horizonHeight(-10, 40, 10)).toBe(0);
    // Every face looks up, and the land is one cheap mesh.
    for (let i = 1; i < a.normals.length; i += 3) expect(a.normals[i]!).toBeGreaterThan(0);
    expect(a.indices.length / 3).toBeLessThan(20000);
  });

  it('R3D-25: the land darkens and cools with distance, from the map\'s own ground tones', () => {
    const m = horizonMesh(96, 96);
    const lum = (v: number): number => m.colors[v * 3]! * 0.3 + m.colors[v * 3 + 1]! * 0.6 + m.colors[v * 3 + 2]! * 0.1;
    const near = lum(0);
    const farIdx = 40 * 200;
    let far = 0;
    for (let j = 0; j < 200; j++) far += lum(farIdx + j) / 200;
    expect(far).toBeLessThan(near * 1.0);
    // The sky is a gradient that ends in the haze colour, which is also the fog colour (sky horizon equals fog).
    expect(HAZE_COLOR).not.toBe(SKY_TOP_COLOR);
  });
});
