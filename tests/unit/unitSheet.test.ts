import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UNIT_DEFS } from '../../src/data/defs';
import { CYCLE_MS, fitDistance, previewAction } from '../../src/render3d/preview3d';
import { UNIT_RIGS } from '../../src/render3d/units3d';
import { firepower, statFill, statMax, unitCards, unitStats } from '../../src/ui/unitInfo';
import { factsHtml } from '../../src/ui/unitSheet';

const card = (faction: 'human' | 'alien', name: string) => {
  const c = unitCards(faction).find((x) => x.name === name);
  if (!c) throw new Error(`no card ${name}`);
  return c;
};

describe('unit sheet', () => {
  it('INF-6: every unit kind has an in-game 3D model to show, and the sheet names where it is trained and what it needs', () => {
    for (const kind of Object.keys(UNIT_DEFS).filter((k) => k.startsWith('hum_') || k.startsWith('ali_'))) expect(UNIT_RIGS[kind], kind).toBeDefined();
    expect(card('human', 'Paladin')).toMatchObject({ trainedAt: 'Motor Pool', needs: ['Tech Lab'] });
    expect(card('human', 'Rifleman')).toMatchObject({ trainedAt: 'Garrison', needs: [] });
    expect(card('alien', 'Brute').trainedAt).toBe('Brood Pit');
  });

  it('INF-6: the preview alternates moving and firing within each cycle, and the camera fits the model in any canvas shape', () => {
    expect(previewAction(100)).toEqual({ moving: true, sinceShot: 1e9 });
    expect(previewAction(CYCLE_MS / 2 + 50)).toEqual({ moving: false, sinceShot: 50 });
    expect(previewAction(CYCLE_MS / 2 + 760).sinceShot).toBe(60);
    expect(previewAction(CYCLE_MS + 100)).toEqual(previewAction(100));
    // A tall, narrow canvas needs the camera further back than a square one; a wide one no further than square.
    expect(fitDistance(1, 0.6)).toBeGreaterThan(fitDistance(1, 1));
    expect(fitDistance(1, 2)).toBeCloseTo(fitDistance(1, 1));
    expect(fitDistance(2, 1)).toBeCloseTo(2 * fitDistance(1, 1));
  });

  it('INF-7: health, speed, range and firepower come from the definitions; firepower counts squad figures', () => {
    const rifle = UNIT_DEFS.hum_rifleman!;
    expect(firepower(rifle)).toBeCloseTo(((rifle.weapon!.damage * 3 * 20) / rifle.weapon!.cooldown), 1);
    expect(unitStats(UNIT_DEFS.hum_paladin!)).toEqual({ health: 3000, speed: 32, range: 7, firepower: 57.5 });
    expect(card('human', 'Shard Hauler').stats).toMatchObject({ range: 0, firepower: 0 });
  });

  it('INF-7: bars fill by the square root of the share of the largest value across both factions', () => {
    const max = statMax();
    expect(max.health).toBe(3000);
    expect(statFill(3000, 3000)).toBe(1);
    expect(statFill(750, 3000)).toBeCloseTo(0.5);
    expect(statFill(0, 3000)).toBe(0);
    const html = factsHtml(card('human', 'Paladin'), max);
    expect(html).toContain('Paladin');
    expect(html).toContain('width:100.0%');
    expect(html).toContain('57.5/s');
    expect(html).toContain('Trained at:</b> Motor Pool · needs Tech Lab');
    expect(factsHtml(card('human', 'Shard Hauler'), max)).toContain('Cannot attack');
  });

  it('INF-8: the menu loads no 3D code; the sheet imports the preview only on demand', () => {
    for (const f of ['src/ui/menu.ts', 'src/ui/unitSheet.ts', 'src/ui/unitInfo.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/from 'three'/);
      expect(src).not.toMatch(/^import [^t].*render3d/m);
    }
    expect(readFileSync('src/ui/unitSheet.ts', 'utf8')).toContain("import('../render3d/preview3d')");
  });
});
