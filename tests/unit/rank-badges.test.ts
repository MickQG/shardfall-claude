import { describe, expect, it } from 'vitest';
import { MAX_RANK } from '../../src/sim';
import { BADGE_ACID, BADGE_EDGE, BADGE_GOLD, BADGE_SHAPES, badgeBob, badgePieces, CHEVRON_STEP, rankBadge, THORN_STEP } from '../../src/render/rank';

/** Bounding box of an outline. */
const box = (pts: readonly (readonly [number, number])[]) => ({
  w: Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])),
  h: Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1])),
  top: Math.max(...pts.map((p) => p[1])),
});

describe('VET-3: veterancy badges', () => {
  it('VET-3: Aegis units show one or two gold chevrons, then a gold star at the top rank; none at rank 0', () => {
    expect(MAX_RANK).toBe(3);
    expect(rankBadge(0, 'human')).toBeNull();
    expect(rankBadge(1, 'human')).toEqual({ kind: 'chevrons', count: 1, color: BADGE_GOLD });
    expect(rankBadge(2, 'human')).toEqual({ kind: 'chevrons', count: 2, color: BADGE_GOLD });
    expect(rankBadge(3, 'human')).toEqual({ kind: 'star', color: BADGE_GOLD });
  });

  it('VET-3: Vrax units show one or two acid-green thorns, then an acid-green eye at the top rank', () => {
    expect(rankBadge(0, 'alien')).toBeNull();
    expect(rankBadge(1, 'alien')).toEqual({ kind: 'thorns', count: 1, color: BADGE_ACID });
    expect(rankBadge(2, 'alien')).toEqual({ kind: 'thorns', count: 2, color: BADGE_ACID });
    expect(rankBadge(3, 'alien')).toEqual({ kind: 'eye', color: BADGE_ACID });
  });

  it('VET-3: chevrons stack upward, thorns stand side by side, the star stands alone and the eye has a dark slit pupil on top', () => {
    const two = badgePieces(rankBadge(2, 'human'));
    expect(two.map((p) => [p.shape, p.x, p.y])).toEqual([['chevron', 0, 0], ['chevron', 0, CHEVRON_STEP]]);
    const thorns = badgePieces(rankBadge(2, 'alien'));
    expect(thorns.map((p) => [p.shape, p.x, p.y])).toEqual([['thorn', -THORN_STEP / 2, 0], ['thorn', THORN_STEP / 2, 0]]);
    expect(badgePieces(rankBadge(3, 'human')).map((p) => p.shape)).toEqual(['star']);
    const eye = badgePieces(rankBadge(3, 'alien'));
    expect(eye.map((p) => p.shape)).toEqual(['eye', 'pupil']);
    expect(eye[1]).toMatchObject({ color: BADGE_EDGE, edge: false });
    // Every coloured piece gets a dark edge so it reads on any ground.
    for (const p of [...two, ...thorns, eye[0]!]) expect(p.edge).toBe(true);
    expect(badgePieces(null)).toEqual([]);
  });

  it('VET-3: the shapes are small, about one badge wide; the star has five points; the pupil is a slit inside the eye', () => {
    expect(box(BADGE_SHAPES.chevron).w).toBeCloseTo(1, 5);
    expect(box(BADGE_SHAPES.star).w).toBeLessThanOrEqual(1);
    expect(BADGE_SHAPES.star).toHaveLength(10);
    expect(box(BADGE_SHAPES.eye).w).toBeCloseTo(1, 5);
    expect(box(BADGE_SHAPES.eye).h).toBeLessThan(0.6);
    expect(box(BADGE_SHAPES.pupil).w).toBeLessThan(box(BADGE_SHAPES.pupil).h / 2);
    expect(box(BADGE_SHAPES.pupil).h).toBeLessThan(box(BADGE_SHAPES.eye).h);
    expect(box(BADGE_SHAPES.thorn).h).toBeGreaterThan(box(BADGE_SHAPES.thorn).w * 1.5);
  });

  it('VET-3: the badge bobs slowly, out of step between units, and holds still with reduced motion', () => {
    const at = (t: number, id = 1): number => badgeBob(t, id, true);
    const samples = Array.from({ length: 40 }, (_, i) => at(i * 100));
    expect(Math.max(...samples)).toBeGreaterThan(0.9);
    expect(Math.min(...samples)).toBeLessThan(-0.9);
    for (const v of samples) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    // Slow: a tenth of a second moves it little.
    expect(Math.abs(at(1000) - at(1100))).toBeLessThan(0.4);
    expect(at(500, 1)).not.toBeCloseTo(at(500, 2), 2);
    expect(badgeBob(500, 1, false)).toBe(0);
    expect(badgeBob(1234, 7, false)).toBe(0);
  });
});
