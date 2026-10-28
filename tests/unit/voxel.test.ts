import { describe, expect, it } from 'vitest';
import { bakeModel, faceIntensity, facingOf } from '../../src/render/voxel/bake';
import { box, createModel, cylinder, sphere, topLayer, voxelCount, type Material } from '../../src/render/voxel/model';

const GRAY: Material = { color: 0x8a96a3 };
const TEAM: Material = { color: 0xffffff, team: true };
const GLOW: Material = { color: 0x35e0a1, glow: true };
const METAL: Material = { color: 0x8a96a3, metal: true };

/** A grey slab with a team-coloured marker at its +x end, so rotation is visible. */
function marked() {
  const m = createModel(12, 8, 6, [GRAY, TEAM]);
  box(m, 1, 2, 0, 8, 4, 3, 1);
  box(m, 9, 3, 0, 2, 2, 3, 2);
  return m;
}

const px = (s: { pixels: Uint8ClampedArray; width: number }, x: number, y: number): [number, number, number, number] => {
  const i = (y * s.width + x) * 4;
  return [s.pixels[i]!, s.pixels[i + 1]!, s.pixels[i + 2]!, s.pixels[i + 3]!];
};

/** Mean x of the clearly team-coloured (red) pixels. */
function redCentroidX(s: { pixels: Uint8ClampedArray; width: number; height: number }): number {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      const [r, g, b, a] = px(s, x, y);
      if (a > 200 && r > 150 && g < 90 && b < 90) {
        sum += x;
        n++;
      }
    }
  }
  return n ? sum / n : NaN;
}

describe('voxel model', () => {
  it('VOX-1: primitives fill voxels, writes outside the grid are ignored, and the model reports its size', () => {
    const m = createModel(6, 6, 6, [GRAY]);
    box(m, 0, 0, 0, 2, 2, 2, 1);
    expect(voxelCount(m)).toBe(8);
    box(m, 4, 4, 4, 5, 5, 5, 1); // mostly outside: only the 2x2x2 corner fits
    expect(voxelCount(m)).toBe(16);
    box(m, -3, -3, -3, 2, 2, 2, 1); // entirely outside
    expect(voxelCount(m)).toBe(16);
    expect(topLayer(m)).toBe(5);
    expect(topLayer(createModel(3, 3, 3, [GRAY]))).toBe(-1);
  });

  it('VOX-1: cylinders and spheres produce rounded, non-empty shapes', () => {
    const c = createModel(9, 9, 6, [GRAY]);
    cylinder(c, 4.5, 4.5, 0, 3.5, 4, 1);
    expect(voxelCount(c)).toBeGreaterThan(40);
    expect(voxelCount(c)).toBeLessThan(9 * 9 * 4); // corners of the bounding box stay empty
    const s = createModel(9, 9, 9, [GRAY]);
    sphere(s, 4.5, 4.5, 4.5, 3.5, 1);
    expect(voxelCount(s)).toBeGreaterThan(60);
    expect(voxelCount(s)).toBeLessThan(9 * 9 * 9 * 0.7);
  });
});

describe('voxel baker', () => {
  it('VOX-2: the same model, team and facing bake to identical pixels', () => {
    const a = bakeModel(marked(), { team: 0xff2020, facing: 3, facings: 16 });
    const b = bakeModel(marked(), { team: 0xff2020, facing: 3, facings: 16 });
    expect(a.width).toBe(b.width);
    expect(Buffer.from(a.pixels).equals(Buffer.from(b.pixels))).toBe(true);
  });

  it('VOX-3: a tile-space heading maps to the nearest facing, 0 = +x', () => {
    expect(facingOf(1, 0, 16)).toBe(0);
    expect(facingOf(0, 1, 16)).toBe(4);
    expect(facingOf(-1, 0, 16)).toBe(8);
    expect(facingOf(0, -1, 16)).toBe(12);
    expect(facingOf(1, 1, 8)).toBe(1);
    expect(facingOf(0, 0, 16)).toBe(0);
  });

  it('VOX-3: facings turn the model; a full turn equals facing 0 and the marker swings from right to left', () => {
    const f0 = bakeModel(marked(), { team: 0xff2020, facing: 0, facings: 16 });
    const f4 = bakeModel(marked(), { team: 0xff2020, facing: 4, facings: 16 });
    const f16 = bakeModel(marked(), { team: 0xff2020, facing: 16, facings: 16 });
    expect(Buffer.from(f0.pixels).equals(Buffer.from(f4.pixels))).toBe(false);
    expect(Buffer.from(f0.pixels).equals(Buffer.from(f16.pixels))).toBe(true);
    expect(redCentroidX(f0)).toBeGreaterThan(f0.anchorX); // +x is screen right-down
    expect(redCentroidX(f4)).toBeLessThan(f4.anchorX); // +y is screen left-down
  });

  it('VOX-4: top faces are brighter than left faces, which are brighter than right faces', () => {
    const top = faceIntensity(0, 0, 1, 0);
    const left = faceIntensity(0, 1, 0, 0);
    const right = faceIntensity(1, 0, 0, 0);
    expect(top).toBeGreaterThan(left);
    expect(left).toBeGreaterThan(right);
    expect(right).toBeGreaterThan(0.2); // never pitch black
  });

  it('VOX-4: glow materials are unshaded, the team material takes the team colour, metal highlights its top', () => {
    const g = createModel(3, 3, 3, [GLOW]);
    box(g, 0, 0, 0, 3, 3, 3, 1);
    const gs = bakeModel(g, { team: 0, facing: 0, facings: 16 });
    const opaque: [number, number, number, number][] = [];
    for (let y = 0; y < gs.height; y++) for (let x = 0; x < gs.width; x++) if (px(gs, x, y)[3] === 255) opaque.push(px(gs, x, y));
    expect(opaque.length).toBeGreaterThan(50);
    for (const [r, gg, b] of opaque) expect([r, gg, b]).toEqual([0x35, 0xe0, 0xa1]);

    const t = createModel(3, 3, 3, [TEAM]);
    box(t, 0, 0, 0, 3, 3, 3, 1);
    expect(redCentroidX(bakeModel(t, { team: 0xff2020, facing: 0, facings: 16 }))).not.toBeNaN();

    const bright = (mat: Material): number => {
      const m = createModel(5, 5, 2, [mat]);
      box(m, 0, 0, 0, 5, 5, 2, 1);
      const s = bakeModel(m, { team: 0, facing: 0, facings: 16 });
      let best = 0;
      for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
        const p = px(s, x, y);
        if (p[3] === 255) best = Math.max(best, p[0] + p[1] + p[2]);
      }
      return best;
    };
    expect(bright(METAL)).toBeGreaterThan(bright(GRAY));
  });

  it('VOX-5: the background is transparent, the anchor is the same for every facing, and a soft shadow sits outside the model', () => {
    const sprites = [0, 3, 7, 11].map((facing) => bakeModel(marked(), { team: 0xff2020, facing, facings: 16 }));
    for (const s of sprites) {
      expect(px(s, 0, 0)[3]).toBe(0);
      expect(s.anchorX).toBe(sprites[0]!.anchorX);
      expect(s.anchorY).toBe(sprites[0]!.anchorY);
      expect(px(s, s.anchorX, s.anchorY - 6)[3]).toBe(255); // inside the model, above its ground centre
      let shadow = 0;
      for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
        const [r, g, b, a] = px(s, x, y);
        if (a > 20 && a < 160 && r === 0 && g === 0 && b === 0) shadow++;
      }
      expect(shadow).toBeGreaterThan(20);
    }
  });

  it('VOX-6: only visible outer faces are drawn', () => {
    const m = createModel(4, 4, 4, [GRAY]);
    box(m, 0, 0, 0, 4, 4, 4, 1);
    const s = bakeModel(m, { team: 0, facing: 0, facings: 16 });
    expect(s.faces).toBe(16 + 16 + 16); // top, +x side and +y side of a 4x4x4 block
    expect(bakeModel(m, { team: 0, facing: 4, facings: 16 }).faces).toBe(48);
    expect(s.faces).toBeLessThan(voxelCount(m) * 3);
  });

  it('VOX-6: layers above clipZ are not drawn, so a model can be revealed bottom-up', () => {
    const m = createModel(4, 4, 6, [GRAY]);
    box(m, 0, 0, 0, 4, 4, 6, 1);
    const full = bakeModel(m, { team: 0, facing: 0, facings: 16 });
    const half = bakeModel(m, { team: 0, facing: 0, facings: 16, clipZ: 3 });
    expect(half.faces).toBeLessThan(full.faces);
    expect(half.faces).toBe(16 + 3 * 4 + 3 * 4); // top at layer 3 plus three layers of two side faces
  });
});
