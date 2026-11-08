import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mapBounds, centerOnTile, type Camera } from '../../src/render/camera';
import { FLY_HUD_CSS, FLY_MS, FlyIn, flyEnabled, flyMode, flyPose, smootherstep } from '../../src/render/flyIn';
import { Lockstep } from '../../src/net/lockstep';
import { cameraPose, FOV } from '../../src/render3d/camera3d';

/** The camera a match starts with today: centred on the player's base at zoom 1. */
const startCam = (w: number, h: number, tx: number, ty: number): Camera => centerOnTile({ x: 0, y: 0, zoom: 1 }, tx, ty, mapBounds(w, h));
const MAPS = [
  { width: 96, height: 96 },
  { width: 64, height: 64 },
  { width: 128, height: 96 },
];

describe('the fly-in camera sweep', () => {
  it('CAM-4: at the start the whole map is in view of a 16:9 screen', () => {
    for (const m of MAPS) {
      const end = startCam(m.width, m.height, 12, 12);
      const p = cameraPose(flyPose(0, m, end));
      const cam = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.5, 400);
      cam.position.set(...p.position);
      cam.lookAt(...p.target);
      cam.updateMatrixWorld();
      for (const [x, z] of [[0, 0], [m.width, 0], [m.width, m.height], [0, m.height]] as const) {
        const v = new THREE.Vector3(x, 0, z).project(cam);
        expect(Math.abs(v.x), `corner ${x},${z} x`).toBeLessThanOrEqual(1);
        expect(Math.abs(v.y), `corner ${x},${z} y`).toBeLessThanOrEqual(1);
        expect(v.z).toBeLessThan(1);
      }
    }
  });

  it('CAM-4: at the end the camera is exactly where a match starts today', () => {
    for (const m of MAPS) {
      const end = startCam(m.width, m.height, 14.5, 80.5);
      expect(flyPose(1, m, end)).toEqual(end);
      expect(flyPose(1, m, end).rise).toBeUndefined();
    }
  });

  it('CAM-4: it eases in and out, with no speed at either end, and moves steadily down in between', () => {
    const m = MAPS[0]!;
    const end = startCam(m.width, m.height, 14.5, 80.5);
    const eps = 1e-4;
    const speed = (t: number): number => {
      const a = flyPose(t, m, end);
      const b = flyPose(t + eps, m, end);
      return Math.hypot((b.x - a.x) / eps, (b.y - a.y) / eps, Math.log(b.zoom / a.zoom) / eps, ((b.rise ?? 1.25) - (a.rise ?? 1.25)) / eps);
    };
    const mid = speed(0.5);
    expect(speed(0)).toBeLessThan(mid * 0.001);
    expect(speed(1 - eps)).toBeLessThan(mid * 0.001);
    expect(smootherstep(0.5)).toBeCloseTo(0.5, 10);
    let z = 0;
    for (let i = 0; i <= 20; i++) {
      const c = flyPose(i / 20, m, end);
      expect(c.zoom).toBeGreaterThanOrEqual(z);
      z = c.zoom;
    }
  });

  it('CAM-4: the heading never changes, so the minimap and the controls keep their orientation', () => {
    const m = MAPS[0]!;
    const end = startCam(m.width, m.height, 14.5, 80.5);
    for (let i = 0; i <= 20; i++) {
      const p = cameraPose(flyPose(i / 20, m, end));
      // The camera always sits along the same diagonal from what it looks at: equal offsets in X and Z.
      expect(p.position[0] - p.target[0]).toBeCloseTo(p.position[2] - p.target[2], 9);
      expect(p.position[0] - p.target[0]).toBeGreaterThan(0);
    }
  });
});

describe('the hold at the start of a match', () => {
  const sp = { online: false, reducedMotion: false, classic: false };

  it('CAM-5: before the fly-in ends, game time does not run and no command is accepted', () => {
    const f = new FlyIn(sp);
    expect(f.finished(0)).toBe(false); // not even started: the game waits for the battlefield
    f.start(1000);
    for (const t of [1000, 2000, 4999]) expect(f.finished(t)).toBe(false);
    expect(f.finished(1000 + FLY_MS)).toBe(true);
  });

  it('CAM-6: in single-player any key or click skips straight to the end', () => {
    const f = new FlyIn(sp);
    expect(f.skip(0)).toBe(false); // nothing to skip before the battlefield is shown
    f.start(0);
    expect(f.skip(1)).toBe(true);
    expect(f.finished(10)).toBe(true);
    expect(f.progress(10)).toBe(1);
  });

  it('CAM-6: online it cannot be skipped and lasts exactly FLY_MS on every machine, whatever the renderer', () => {
    const ends = [
      { reducedMotion: false, classic: false },
      { reducedMotion: false, classic: true },
      { reducedMotion: true, classic: false },
    ].map((r) => {
      const f = new FlyIn({ online: true, ...r });
      f.start(500);
      expect(f.skippable).toBe(false);
      expect(f.skip(1)).toBe(false);
      expect(f.finished(500 + FLY_MS - 1)).toBe(false);
      expect(f.finished(500 + FLY_MS)).toBe(true);
      return f.ms;
    });
    expect(new Set(ends)).toEqual(new Set([FLY_MS]));
  });

  it('CAM-6: both players release their game after the same hold, and lockstep then starts when both have', () => {
    // Each side announces its first turns only when its fly-in ends (`start`), and the game runs only once both have.
    const out: Record<'a' | 'b', unknown[]> = { a: [], b: [] };
    const delivered: number[] = [];
    const a: Lockstep = new Lockstep(0, { send: (m) => out.a.push(m), deliver: (n) => delivered.push(n), desync: () => undefined });
    const b: Lockstep = new Lockstep(1, { send: (m) => out.b.push(m), deliver: () => undefined, desync: () => undefined });
    expect(out.a).toHaveLength(0); // held through the fly-in: nothing announced, nothing delivered
    a.start();
    for (const m of out.a) b.receive(m as never);
    expect(delivered).toEqual([]); // the slower player has not finished its fly-in yet
    b.start();
    for (const m of out.b) a.receive(m as never);
    expect(delivered.length).toBeGreaterThan(0);
  });

  it('CAM-8: reduced motion or the classic view fades in over the same time instead of sweeping, and single-player can still skip', () => {
    expect(flyMode({ reducedMotion: false, classic: false })).toBe('sweep');
    for (const o of [{ reducedMotion: true, classic: false }, { reducedMotion: false, classic: true }, { reducedMotion: true, classic: true }]) {
      expect(flyMode(o)).toBe('fade');
      const f = new FlyIn({ online: false, ...o });
      expect(f.ms).toBe(FLY_MS);
      f.start(0);
      expect(f.finished(FLY_MS - 1)).toBe(false);
      expect(f.finished(FLY_MS)).toBe(true);
      const g = new FlyIn({ online: false, ...o });
      g.start(0);
      expect(g.skip(1)).toBe(true);
      expect(g.finished(1)).toBe(true);
    }
  });

  it('CAM-4: the fly-in is on unless a test or development session switches it off with ?flyin=0', () => {
    expect(flyEnabled(null)).toBe(true);
    expect(flyEnabled('1')).toBe(true);
    expect(flyEnabled('0')).toBe(false);
    const f = new FlyIn({ ...sp, enabled: false });
    expect(f.finished(0)).toBe(true);
  });

  it('CAM-4: the HUD is taken out of painting during the fly-in, not only made transparent, so the sweep stays smooth', () => {
    const hidden = FLY_HUD_CSS.slice(FLY_HUD_CSS.indexOf('body.flyin'));
    expect(hidden).toContain('opacity:0!important');
    expect(hidden).toContain('visibility:hidden!important');
    // and it still fades in when the class is removed
    expect(FLY_HUD_CSS).toContain('transition:opacity');
  });
});
