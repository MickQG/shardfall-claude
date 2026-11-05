import { describe, expect, it } from 'vitest';
import { MAPS, mapStarts, skirmishMap } from '../../src/data/maps';
import { THUMB, thumbPixels } from '../../src/ui/mapThumb';

describe('map thumbnails', () => {
  it('MENU-1: a map card thumbnail shows ground, rock, water, shard fields and both starts, one pixel per tile', () => {
    for (const { id } of MAPS) {
      const m = skirmishMap(id);
      const px = thumbPixels(m, mapStarts(id));
      expect(px.length).toBe(m.width * m.height * 4);
      const at = (i: number): number[] => [px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!];
      const count = (c: readonly number[]): number => {
        let n = 0;
        for (let i = 0; i < m.width * m.height; i++) if (at(i).every((v, k) => v === c[k])) n++;
        return n;
      };
      expect(count(THUMB.ground)).toBeGreaterThan(m.width * m.height * 0.5);
      expect(count(THUMB.shards)).toBeGreaterThan(20);
      expect(count(THUMB.water)).toBeGreaterThan(10);
      expect(count(THUMB.rock1) + count(THUMB.rock2)).toBeGreaterThan(20);
      for (const s of mapStarts(id)) expect(at(s.ty * m.width + s.tx)).toEqual([...THUMB.start]);
      for (let i = 0; i < m.width * m.height; i++) expect(px[i * 4 + 3]).toBe(255);
    }
    // Different maps look different.
    expect(thumbPixels(skirmishMap('riverbed'), mapStarts('riverbed'))).not.toEqual(thumbPixels(skirmishMap('highlands'), mapStarts('highlands')));
  });
});
