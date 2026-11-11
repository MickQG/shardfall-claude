import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ELEV_READY, ELEV_UP_MS, MAX_ELEV_WAIT, SETTLE_DRIVE, elevationReady, restingSettle, settleStep, slew } from '../../src/render3d/motion';
import { WATER } from '../../src/render3d/noiseNormal';

const read = (f: string): string => readFileSync(join(__dirname, '../..', f), 'utf8');

describe('calm water (R3D-11)', () => {
  it('R3D-11: the waves drift, at no more than two thirds of their old speed', () => {
    expect(WATER.driftX).toBeLessThanOrEqual((0.000018 * 2) / 3);
    expect(WATER.driftY).toBeLessThanOrEqual((0.000011 * 2) / 3);
    expect(WATER.driftX).toBeGreaterThan(0.000018 / 3);
  });
  it('R3D-11: the waves show and sparkle a little, less than the old glossy surface', () => {
    // Old values: roughness 0.08, metalness 0.3, normal scale 0.45. Flat water (0.5, 0.08, 0.16) was rejected by the owner.
    expect(WATER.roughness).toBeGreaterThan(0.08);
    expect(WATER.roughness).toBeLessThan(0.4);
    expect(WATER.metalness).toBeLessThan(0.3);
    expect(WATER.normalScale).toBeLessThan(0.45);
    expect(WATER.normalScale).toBeGreaterThan(0.25);
  });
  it('R3D-11: the water is built from these numbers whatever the quality preset', () => {
    const src = read('src/render3d/view3d.ts');
    expect(src).toContain('roughness: WATER.roughness');
    expect(src).toContain('WATER.driftX');
  });
});

describe('the hauler settles as it stops (R3D-30)', () => {
  const run = (speed: (i: number) => number, frames: number, quiet = false): number[] => {
    let s = restingSettle();
    const out: number[] = [];
    for (let i = 0; i < frames; i++) {
      s = settleStep(s, speed(i), 1 / 60, quiet);
      out.push(s.pitch);
    }
    return out;
  };
  it('R3D-30: a steady speed never dips', () => {
    expect(Math.max(...run(() => 1.2, 300).map(Math.abs))).toBe(0);
    expect(Math.max(...run(() => 0, 300).map(Math.abs))).toBe(0);
  });
  it('R3D-30: after a stop the nose dips a few degrees once, then decays to rest within a second without bouncing on', () => {
    const p = run((i) => (i < 60 ? 1.2 : 0), 180);
    const dip = Math.min(...p);
    expect(dip).toBeLessThan(-0.015);
    expect(dip).toBeGreaterThan(-0.07);
    expect(p.indexOf(dip)).toBeGreaterThan(60);
    expect(Math.max(...p)).toBeLessThan(0.004);
    expect(Math.abs(p[120]!)).toBeLessThan(0.004);
    expect(Math.abs(p[179]!)).toBeLessThan(0.0005);
  });
  it('R3D-30: it dips for each stop and not while mining or docking', () => {
    const two = run((i) => (i < 30 ? 1 : i < 150 ? 0 : i < 180 ? 1 : 0), 400);
    expect(Math.min(...two.slice(30, 150))).toBeLessThan(-0.015);
    expect(Math.min(...two.slice(180))).toBeLessThan(-0.015);
    expect(Math.min(...run((i) => (i < 60 ? 1.2 : 0), 180, true))).toBe(0);
    expect(SETTLE_DRIVE).toBeGreaterThan(0);
  });
});

describe('the Hammer waits for its barrel (R3D-32)', () => {
  it('R3D-32: a howitzer shot shows only once the barrel is raised, or after a bounded wait', () => {
    expect(elevationReady(true, 0, 0)).toBe(false);
    expect(elevationReady(true, 0.5, 100)).toBe(false);
    expect(elevationReady(true, 1, 0)).toBe(true);
    expect(elevationReady(true, 0.2, MAX_ELEV_WAIT)).toBe(true);
    expect(elevationReady(false, 0, 0)).toBe(true);
  });
  it('R3D-32: a barrel rising from its lock is ready before the wait runs out, so the hold is not the cap', () => {
    let e = 0;
    let ms = 0;
    while (e < ELEV_READY && ms < 2000) {
      e = slew(e, 1, 1 / 60, ELEV_UP_MS, 1000);
      ms += 1000 / 60;
    }
    expect(ms).toBeLessThan(MAX_ELEV_WAIT);
    expect(elevationReady(true, e, 0)).toBe(true);
  });
  it('R3D-32: both the match and the unit sheet hold the shot for the elevation', () => {
    expect(read('src/render3d/view3d.ts')).toContain("elevationReady(p.src.def.weapon === 'howitzer'");
    expect(read('src/render3d/preview3d.ts')).toContain("elevationReady(def.weapon === 'howitzer'");
  });
});

describe('no text selection (UI-22)', () => {
  const html = read('index.html');
  it('UI-22: the page is unselectable, with the prefixed form; typed fields, the map seed and the score seed line stay selectable', () => {
    expect(html).toContain('body { user-select: none; -webkit-user-select: none; }');
    expect(html).toMatch(/input, textarea,[^{]*#map-seed[^{]*#result \.sub \{ user-select: text; -webkit-user-select: text; \}/);
  });
  it('UI-22: nothing else in the sources switches selection back on', () => {
    for (const f of ['src/ui/hud.ts', 'src/ui/sidebar.ts', 'src/ui/menu.ts', 'src/ui/theme.ts', 'src/game.ts']) {
      expect(read(f), f).not.toMatch(/user-select:\s*(text|auto|all)/);
    }
  });
});
