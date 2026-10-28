import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS, UNIT_DEFS } from '../../src/data/defs';
import { damageTint, revealLine, shadeCube } from '../../src/render/gfx';
import { crystalLevel, crystalModel, propAt, propModel, rockModel, rockVariant } from '../../src/render/voxel/props';
import { BUILDING_MODELS, buildingHeightPx } from '../../src/render/voxel/buildings';
import { bakeModel, faceIntensity, facingOf } from '../../src/render/voxel/bake';
import { composeUnit } from '../../src/render/voxel/compose';
import { UNIT_MODELS } from '../../src/render/voxel/models';
import { SpriteCache } from '../../src/render/voxel/spriteCache';
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

/** Bounding box of pixels at least half opaque. */
function bbox(s: { pixels: Uint8ClampedArray; width: number; height: number }): { w: number; h: number; maxY: number } {
  let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) if (px(s, x, y)[3] > 200) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, maxY: y1 };
}

describe('voxel scale and hovering', () => {
  it('VOX-7: half-size voxels in twice the count bake to the same on-screen size', () => {
    const a = createModel(8, 8, 8, [GRAY]);
    box(a, 0, 0, 0, 8, 8, 8, 1);
    const b = createModel(16, 16, 16, [GRAY], 0.5);
    box(b, 0, 0, 0, 16, 16, 16, 1);
    const ba = bbox(bakeModel(a, { team: 0, facing: 0, facings: 16 }));
    const bb = bbox(bakeModel(b, { team: 0, facing: 0, facings: 16 }));
    expect(Math.abs(ba.w - bb.w)).toBeLessThanOrEqual(2);
    expect(Math.abs(ba.h - bb.h)).toBeLessThanOrEqual(2);
  });

  it('VOX-8: a hovering model casts a shadow that sits below it, detached', () => {
    const m = createModel(6, 6, 12, [GRAY]);
    box(m, 1, 1, 8, 4, 4, 2, 1);
    const s = bakeModel(m, { team: 0, facing: 0, facings: 16 });
    let minShadowY = Infinity;
    for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
      const [r, g, b, a] = px(s, x, y);
      if (a > 20 && a < 160 && r === 0 && g === 0 && b === 0) minShadowY = Math.min(minShadowY, y);
    }
    expect(minShadowY).toBeLessThan(Infinity);
    expect(minShadowY).toBeGreaterThan(bbox(s).maxY);
  });
});

describe('unit roster', () => {
  const facings = 16;
  const silhouette = (kind: string): string => {
    const layers = composeUnit(UNIT_MODELS[kind]!(), 0x3fa0ff, 2, 2, facings);
    // Position-independent mask hash: bake size plus coverage count per row of the hull.
    const s = layers[0]!.sprite;
    const rows: number[] = [];
    for (let y = 0; y < s.height; y++) {
      let n = 0;
      for (let x = 0; x < s.width; x++) if (px(s, x, y)[3] > 128) n++;
      rows.push(n);
    }
    return `${s.width}x${s.height}:${rows.join(',')}`;
  };

  it('VOX-9: every unit kind has a model, each with a distinct silhouette that bakes in all facings with its anchor inside', () => {
    const kinds = Object.keys(UNIT_DEFS);
    expect(Object.keys(UNIT_MODELS).sort()).toEqual([...kinds].sort());
    expect(new Set(kinds.map(silhouette)).size).toBe(kinds.length);
    for (const k of kinds) {
      const u = UNIT_MODELS[k]!();
      expect(voxelCount(u.hull)).toBeGreaterThan(60);
      for (let f = 0; f < facings; f += 5) {
        const s = bakeModel(u.hull, { team: 0x3fa0ff, facing: f, facings });
        expect(s.anchorX).toBeGreaterThan(0);
        expect(s.anchorX).toBeLessThan(s.width);
        expect(s.anchorY).toBeGreaterThan(0);
        expect(s.anchorY).toBeLessThan(s.height);
      }
    }
  });

  it('VOX-10: the turret turns independently of the hull and its pivot turns with the hull', () => {
    const tank = UNIT_MODELS['hum_tank']!();
    const a = composeUnit(tank, 0x3fa0ff, 0, 0, facings);
    const b = composeUnit(tank, 0x3fa0ff, 0, 6, facings);
    const c = composeUnit(tank, 0x3fa0ff, 4, 0, facings);
    expect(a).toHaveLength(2);
    expect(Buffer.from(a[0]!.sprite.pixels).equals(Buffer.from(b[0]!.sprite.pixels))).toBe(true); // same hull
    expect(Buffer.from(a[1]!.sprite.pixels).equals(Buffer.from(b[1]!.sprite.pixels))).toBe(false); // different aim
    expect([a[1]!.dx, a[1]!.dy]).not.toEqual([c[1]!.dx, c[1]!.dy]); // the pivot moved with the hull
    expect(composeUnit(UNIT_MODELS['hum_rifleman']!(), 0x3fa0ff, 0, 0, facings)).toHaveLength(1);
  });
});

describe('sprite cache', () => {
  it('VOX-11: a facing is baked once per kind, team colour and part, then reused', () => {
    let made = 0;
    const cache = new SpriteCache(() => {
      made++;
      return {} as never;
    });
    const a = cache.hull('hum_tank', 0x3fa0ff, 3);
    expect(cache.hull('hum_tank', 0x3fa0ff, 3)).toBe(a);
    expect(made).toBe(1);
    cache.hull('hum_tank', 0x3fa0ff, 4);
    cache.hull('hum_tank', 0xff8a2a, 3); // another team colour is another sprite
    expect(made).toBe(3);
    expect(cache.turret('hum_tank', 0x3fa0ff, 3)).not.toBeNull();
    expect(cache.turret('hum_rifleman', 0x3fa0ff, 3)).toBeNull(); // no turret, nothing baked
    expect(made).toBe(4);
    expect(cache.size).toBe(4);
  });
});

describe('building models', () => {
  const kinds = Object.keys(BUILDING_DEFS);

  it('VOX-12: every building kind has a model exactly as big as its tile footprint, with a distinct silhouette', () => {
    expect(Object.keys(BUILDING_MODELS).sort()).toEqual([...kinds].sort());
    const seen = new Set<string>();
    for (const k of kinds) {
      const d = BUILDING_DEFS[k]!;
      const m = BUILDING_MODELS[k]!();
      expect([m.sx, m.sy, m.scale], k).toEqual([d.w * 16, d.h * 16, 0.5]);
      expect(voxelCount(m), k).toBeGreaterThan(300);
      const s = bakeModel(m, { team: 0x3fa0ff, facing: 0, facings: 1 });
      expect(s.anchorX).toBeGreaterThan(0);
      let rows = '';
      for (let y = 0; y < s.height; y++) {
        let n = 0;
        for (let x = 0; x < s.width; x++) if (px(s, x, y)[3] > 128) n++;
        rows += n + ',';
      }
      seen.add(`${s.width}x${s.height}:${rows}`);
    }
    expect(seen.size).toBe(kinds.length);
  });

  it('VOX-12: the roof height comes from the model, so superweapons stand tallest and a turret is short', () => {
    expect(buildingHeightPx('hum_lance')).toBeGreaterThan(buildingHeightPx('hum_hq'));
    expect(buildingHeightPx('ali_rift')).toBeGreaterThan(buildingHeightPx('ali_hq'));
    expect(buildingHeightPx('hum_turret')).toBeLessThan(buildingHeightPx('hum_barracks') + 10);
    const hq = BUILDING_MODELS['hum_hq']!();
    expect(buildingHeightPx('hum_hq')).toBe((topLayer(hq) + 1) * 4 * hq.scale);
  });

  it('VOX-13: the reveal line rises from the base to above the roof, and damage darkens the tint', () => {
    expect(revealLine(0, 200, 40)).toBe(200);
    expect(revealLine(1, 200, 40)).toBe(40);
    expect(revealLine(0.5, 200, 40)).toBe(120);
    const lum = (c: number): number => (c >> 16) + ((c >> 8) & 255) + (c & 255);
    expect(damageTint('intact')).toBe(0xffffff);
    expect(lum(damageTint('damaged'))).toBeLessThan(lum(damageTint('intact')));
    expect(lum(damageTint('critical'))).toBeLessThan(lum(damageTint('damaged')));
  });
});

describe('terrain props', () => {
  it('VOX-15: crystal level follows the amount left, in four steps, and each level is a bigger cluster', () => {
    expect([0, 1, 200, 201, 800, 801, 2000, 2001, 5000].map(crystalLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
    const counts = [1, 2, 3, 4].map((l) => voxelCount(crystalModel(l)));
    expect(counts[0]).toBeGreaterThan(30);
    for (let i = 1; i < 4; i++) expect(counts[i]!).toBeGreaterThan(counts[i - 1]!);
    expect(crystalModel(4).materials.some((m) => m.glow)).toBe(true);
  });

  it('VOX-16: a rock chunk is chosen from coordinates only, is taller on higher ground, and variants differ', () => {
    expect(rockVariant(12, 30)).toBe(rockVariant(12, 30));
    const variants = new Set<number>();
    for (let i = 0; i < 60; i++) variants.add(rockVariant(i * 3, i * 7));
    expect(variants.size).toBeGreaterThanOrEqual(3);
    expect(topLayer(rockModel(0, 2))).toBeGreaterThan(topLayer(rockModel(0, 1)));
    expect(Buffer.from(rockModel(0, 1).cells).equals(Buffer.from(rockModel(1, 1).cells))).toBe(false);
    expect(Buffer.from(rockModel(2, 1).cells).equals(Buffer.from(rockModel(2, 1).cells))).toBe(true);
    const m = rockModel(1, 1);
    expect([m.sx, m.sy]).toEqual([16, 16]); // exactly one tile
  });

  it('VOX-17: props appear on a few percent of free ground, from coordinates alone, and never on occupied tiles', () => {
    let n = 0;
    const kinds = new Set<string>();
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        expect(propAt(x, y, false)).toBeNull();
        const p = propAt(x, y, true);
        expect(propAt(x, y, true)).toBe(p);
        if (p) {
          n++;
          kinds.add(p);
        }
      }
    }
    expect(n / (96 * 96)).toBeGreaterThan(0.015);
    expect(n / (96 * 96)).toBeLessThan(0.07);
    expect(kinds.size).toBe(3);
    for (const k of kinds) expect(voxelCount(propModel(k as never, 1))).toBeGreaterThan(8);
  });

  it('VOX-18: a debris cube has a lit top, a darker left and a darkest right face', () => {
    const lum = (c: number): number => (c >> 16) + ((c >> 8) & 255) + (c & 255);
    const c = shadeCube(0xcc8844);
    expect(lum(c.top)).toBeGreaterThan(lum(c.left));
    expect(lum(c.left)).toBeGreaterThan(lum(c.right));
    expect(shadeCube(0xcc8844)).toEqual(c);
  });
});
