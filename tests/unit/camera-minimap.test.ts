import { describe, expect, it } from 'vitest';
import { centerOnTile, mapBounds } from '../../src/render/camera';
import { tileToScreen } from '../../src/render/iso';
import { centroid, inputAllowed, KeyTap, minimapClick } from '../../src/ui/controls';
import { clampTile } from '../../src/ui/minimap';
import { Selection } from '../../src/ui/selection';

describe('camera and minimap', () => {
  const b = mapBounds(96, 96);

  it('CAM-3: centring on any tile keeps the view inside the map bounds', () => {
    const mid = centerOnTile({ x: 0, y: 0, zoom: 1 }, 48, 48, b);
    const p = tileToScreen(48, 48);
    expect(mid).toEqual({ x: p.x, y: p.y, zoom: 1 });
    for (const [tx, ty] of [[-40, -40], [200, -5], [-10, 300], [500, 500]] as const) {
      const c = centerOnTile({ x: 0, y: 0, zoom: 1.2 }, tx, ty, b);
      expect(c.x).toBeGreaterThanOrEqual(b.minX);
      expect(c.x).toBeLessThanOrEqual(b.maxX);
      expect(c.y).toBeGreaterThanOrEqual(b.minY);
      expect(c.y).toBeLessThanOrEqual(b.maxY);
      expect(c.zoom).toBe(1.2);
    }
  });

  it('CAM-3: minimap order targets are clamped to tiles on the map', () => {
    expect(clampTile(-3, 50.5, 96, 96)).toEqual({ x: 0, y: 50.5 });
    expect(clampTile(120, -1, 96, 96)).toEqual({ x: 95.5, y: 0 });
    expect(clampTile(10, 10, 96, 96)).toEqual({ x: 10, y: 10 });
  });

  it('CTL-14: an armed attack-move or superweapon fires at a minimap click with the same buttons as the main view; otherwise left moves the camera and right orders', () => {
    expect(minimapClick(2, { amove: true, targeting: false })).toBe('attackmove');
    expect(minimapClick(0, { amove: true, targeting: false })).toBe('disarm'); // left disarms, as on the main view
    expect(minimapClick(0, { amove: false, targeting: true })).toBe('superweapon');
    expect(minimapClick(2, { amove: false, targeting: true })).toBe('cancel'); // right cancels, as on the main view
    expect(minimapClick(0, { amove: false, targeting: false })).toBe('camera');
    expect(minimapClick(2, { amove: false, targeting: false })).toBe('order');
  });

  it('CTL-15: Space centres on the middle of the selection', () => {
    expect(centroid([{ x: 0, y: 0 }, { x: 512, y: 256 }])).toEqual({ x: 1, y: 0.5 });
    expect(centroid([])).toBeNull();
  });

  it('CTL-15: pressing the same group key twice quickly is a double press; another key in between is not', () => {
    const t = new KeyTap(350);
    expect(t.press('1', 0)).toBe(false);
    expect(t.press('1', 200)).toBe(true);
    expect(t.press('2', 300)).toBe(false);
    expect(t.press('1', 400)).toBe(false);
    expect(t.press('1', 1000)).toBe(false);
  });

  it('CTL-15: assigning a group with nothing selected leaves the group unchanged', () => {
    const s = new Selection();
    s.set([1, 2]);
    s.assignGroup(4);
    s.clear();
    s.assignGroup(4);
    expect(s.recallGroup(4, new Set([1, 2])).sort()).toEqual([1, 2]);
  });
});

describe('input while paused or over', () => {
  const run = { paused: false, over: false };
  const paused = { paused: true, over: false };
  const over = { paused: false, over: true };

  it('CTL-16: paused accepts only camera input (including Space and H), Escape and P', () => {
    for (const k of ['w', 'a', 's', 'd', 'arrowup', 'arrowleft', ' ', 'h', 'wheel', 'minimap-camera', 'escape', 'p']) expect(inputAllowed(k, paused)).toBe(true);
    for (const k of ['q', 'e', 'f', 'x', '1', 'm', '+', 'click', 'sidebar', 'minimap-order']) expect(inputAllowed(k, paused)).toBe(false);
  });

  it('CTL-16: after the game is over nothing reaches the game; while running everything does', () => {
    for (const k of ['w', 'escape', 'p', 'q', 'click', 'sidebar', 'wheel']) {
      expect(inputAllowed(k, over)).toBe(false);
      expect(inputAllowed(k, run)).toBe(true);
    }
  });
});
