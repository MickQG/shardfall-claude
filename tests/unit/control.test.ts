import { describe, expect, it } from 'vitest';
import { createGame, EXPLORED, FP, hash, snapshot, submit, tick, VISIBLE, type MapDef, type UnitSpawn } from '../../src/sim';
import { miniToTile, tileToMini, type MiniLayout } from '../../src/ui/minimap';
import { boxSelect, pickUnit, Selection, selectKinds, selectSameKind, type ScreenUnit } from '../../src/ui/selection';

const open = (w: number, h: number): MapDef => ({ width: w, height: h, heights: new Array<number>(w * h).fill(0) });
const idx = (w: number, x: number, y: number): number => y * w + x;

describe('fog of war', () => {
  const spawns: UnitSpawn[] = [
    { owner: 0, kind: 'hum_rifleman', tx: 5, ty: 5 }, // vision 7
    { owner: 1, kind: 'hum_rifleman', tx: 40, ty: 40 },
  ];

  it('FOG-1: only tiles within vision of own units are known at start', () => {
    const g = createGame({ seed: 1, map: open(50, 50), units: spawns });
    const f = snapshot(g, 0).fog!;
    expect(f[idx(50, 5, 5)]! & VISIBLE).toBeTruthy();
    expect(f[idx(50, 10, 5)]! & VISIBLE).toBeTruthy();
    expect(f[idx(50, 20, 20)]).toBe(0);
    expect(f[idx(50, 40, 40)]).toBe(0);
  });

  it('FOG-2: vision is circular; tiles left behind stay explored but not visible', () => {
    const g = createGame({ seed: 1, map: open(50, 50), units: spawns });
    const f0 = snapshot(g, 0).fog!;
    expect(f0[idx(50, 5 + 7, 5)]! & VISIBLE).toBeTruthy(); // on the radius
    expect(f0[idx(50, 5 + 6, 5 + 6)]! & VISIBLE).toBeFalsy(); // corner outside the circle
    submit(g, { type: 'move', player: 0, units: [1], x: 30 * FP, y: 5 * FP });
    for (let i = 0; i < 300; i++) tick(g);
    const f = snapshot(g, 0).fog!;
    expect(f[idx(50, 5, 5)]).toBe(EXPLORED); // explored, not visible
    expect(f[idx(50, 30, 5)]! & VISIBLE).toBeTruthy();
    expect(f[idx(50, 20, 5)]! & EXPLORED).toBeTruthy(); // revealed on the way
    expect(f[idx(50, 20, 40)]).toBe(0);
  });

  it('FOG-3: a player snapshot hides enemy units on unseen tiles; god view lists everyone', () => {
    const g = createGame({ seed: 1, map: open(50, 50), units: spawns });
    expect(snapshot(g, 0).units.map((u) => u.id)).toEqual([1]);
    expect(snapshot(g, 1).units.map((u) => u.id)).toEqual([2]);
    expect(snapshot(g).units.map((u) => u.id)).toEqual([1, 2]);
    // Move player 0 next to the enemy; now they see the enemy.
    submit(g, { type: 'move', player: 0, units: [1], x: 36 * FP, y: 40 * FP });
    let seen = false;
    for (let i = 0; i < 2500 && !seen; i++) {
      tick(g);
      seen = snapshot(g, 0).units.some((u) => u.id === 2);
    }
    expect(seen).toBe(true); // the enemy appears as soon as it enters vision
    expect(snapshot(g, 1).units.some((u) => u.id === 1) || g.state.units.every((u) => u.id !== 1)).toBe(true);
  });

  it('FOG-4: fog state is part of the state hash', () => {
    const a = createGame({ seed: 1, map: open(50, 50), units: spawns });
    const b = createGame({ seed: 1, map: open(50, 50), units: spawns });
    expect(hash(a)).toBe(hash(b));
    b.state.fog[0]![idx(50, 30, 30)] = EXPLORED;
    expect(hash(a)).not.toBe(hash(b));
  });
});

describe('commands', () => {
  it('CMD-1: stop clears the order of owned units and ignores foreign units', () => {
    const g = createGame({
      seed: 1,
      map: open(40, 10),
      units: [
        { owner: 0, kind: 'hum_rifleman', tx: 2, ty: 5 },
        { owner: 1, kind: 'hum_rifleman', tx: 2, ty: 8 },
      ],
    });
    submit(g, { type: 'move', player: 0, units: [1], x: 35 * FP, y: 5 * FP });
    submit(g, { type: 'move', player: 1, units: [2], x: 35 * FP, y: 8 * FP });
    for (let i = 0; i < 10; i++) tick(g);
    submit(g, { type: 'stop', player: 0, units: [1, 2] });
    tick(g);
    const x1 = snapshot(g).units[0]!.x;
    const x2 = snapshot(g).units[1]!.x;
    expect(snapshot(g).units[0]!.dest).toBeNull();
    for (let i = 0; i < 20; i++) tick(g);
    expect(snapshot(g).units[0]!.x).toBe(x1);
    expect(snapshot(g).units[1]!.x).toBeGreaterThan(x2);
  });
});

describe('selection', () => {
  const su = (id: number, owner: number, kind: string, sx: number, sy: number): ScreenUnit => ({ id, owner, kind, sx, sy });
  const units = [su(1, 0, 'hum_rifleman', 100, 100), su(2, 0, 'hum_rifleman', 110, 104), su(3, 1, 'hum_rifleman', 105, 100), su(4, 0, 'hum_buggy', 300, 200), su(5, 0, 'hum_rifleman', 5000, 5000)];
  const vp = { width: 1280, height: 720 };

  it('CTL-1: click selects the nearest own unit in the pick radius and never an enemy', () => {
    expect(pickUnit(units, 101, 101, 0)).toBe(1);
    expect(pickUnit(units, 108, 104, 0)).toBe(2);
    expect(pickUnit(units, 105, 100, 0)).not.toBe(3); // enemy underneath is ignored
    expect(pickUnit(units, 600, 600, 0)).toBeNull();
  });

  it('CTL-2: box select picks own units inside the rectangle; shift-box adds, shift-click toggles', () => {
    expect(boxSelect(units, 90, 90, 120, 110, 0)).toEqual([1, 2]);
    expect(boxSelect(units, 120, 110, 90, 90, 0)).toEqual([1, 2]); // any drag direction
    const s = new Selection();
    s.set([1, 2]);
    s.add([2, 4]);
    expect(s.selected.sort()).toEqual([1, 2, 4]);
    s.toggle([2]);
    expect(s.selected.sort()).toEqual([1, 4]);
  });

  it('CTL-2: a box holding any combat unit leaves out the non-combat units in it; a box of only haulers keeps them', () => {
    const mixed = [su(1, 0, 'hum_rifleman', 100, 100), su(6, 0, 'hum_hauler', 105, 105), su(7, 0, 'hum_hauler', 300, 300)];
    expect(boxSelect(mixed, 90, 90, 120, 120, 0)).toEqual([1]);
    expect(boxSelect(mixed, 290, 290, 310, 310, 0)).toEqual([7]);
    expect(boxSelect(mixed, 90, 90, 310, 310, 0)).toEqual([1]);
  });

  it('CTL-11: E selects every own unit of the selected kinds across the whole map', () => {
    expect(selectKinds(units, [1], 0).sort()).toEqual([1, 2, 5]); // 5 is off-screen but included; 3 is an enemy
    expect(selectKinds(units, [1, 4], 0).sort()).toEqual([1, 2, 4, 5]);
    expect(selectKinds(units, [], 0)).toEqual([]);
    expect(selectKinds(units, [3], 0)).toEqual([]); // enemy ids never seed a selection
  });

  it('CTL-12: shift + double-click adds the on-screen units of that kind to the selection', () => {
    const s = new Selection();
    s.set([4]);
    s.add(selectSameKind(units, 1, 0, vp));
    expect(s.selected.sort()).toEqual([1, 2, 4]);
  });

  it('CTL-3: double-click selects all own units of that kind that are on screen', () => {
    expect(selectSameKind(units, 1, 0, vp).sort()).toEqual([1, 2]); // 5 is off-screen, 3 is an enemy
  });

  it('CTL-4: control groups are assigned and recalled, dropping dead units', () => {
    const s = new Selection();
    s.set([1, 2, 4]);
    s.assignGroup(3);
    s.clear();
    expect(s.selected).toEqual([]);
    expect(s.recallGroup(3, new Set([1, 2, 4])).sort()).toEqual([1, 2, 4]);
    expect(s.recallGroup(3, new Set([1, 4])).sort()).toEqual([1, 4]);
    expect(s.selected.sort()).toEqual([1, 4]);
    expect(s.recallGroup(7, new Set([1]))).toEqual([]);
  });
});

describe('minimap', () => {
  const l: MiniLayout = { width: 220, height: 110, mapW: 96, mapH: 96 };

  it('MAP-1: tiles round-trip through minimap pixels and a click resolves to the right tile', () => {
    for (const [x, y] of [[0, 0], [95, 95], [10, 80], [47.5, 12.25]] as const) {
      const p = tileToMini(l, x, y);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(l.width);
      const t = miniToTile(l, p.x, p.y);
      expect(t.x).toBeCloseTo(x, 9);
      expect(t.y).toBeCloseTo(y, 9);
    }
    const centre = miniToTile(l, l.width / 2, l.height / 2);
    expect(centre.x).toBeCloseTo(48, 6);
    expect(centre.y).toBeCloseTo(48, 6);
  });
});

