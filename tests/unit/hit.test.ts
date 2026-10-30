import { describe, expect, it } from 'vitest';
import { cursorFor } from '../../src/ui/cursor';
import { hitTest, hoverKind, rightClickOrder, type HitContext } from '../../src/ui/hit';
import { tileToScreen } from '../../src/render/iso';

const at = (tx: number, ty: number): { sx: number; sy: number } => {
  const p = tileToScreen(tx, ty);
  return { sx: p.x, sy: p.y };
};

const ctx = (over: Partial<HitContext> = {}): HitContext => ({
  player: 0,
  units: [],
  buildings: [],
  toWorld: (sx, sy) => ({ x: sx, y: sy }),
  blocked: () => false,
  shardAt: () => false,
  ...over,
});

describe('hit-test', () => {
  it('CUR-4: reports the tile under the pointer and whether it is blocked terrain', () => {
    const p = at(30.5, 20.5);
    const h = hitTest(ctx({ blocked: (x, y) => x === 30 && y === 20 }), p.sx, p.sy);
    expect([h.tx, h.ty, h.blocked]).toEqual([30, 20, true]);
    expect(hitTest(ctx(), p.sx, p.sy).blocked).toBe(false);
  });

  it('CUR-4: finds own and enemy units separately, nearest first', () => {
    const p = at(10, 10);
    const units = [
      { id: 1, owner: 0, kind: 'hum_rifleman', sx: p.sx + 2, sy: p.sy },
      { id: 2, owner: 1, kind: 'ali_skitter', sx: p.sx - 3, sy: p.sy },
      { id: 3, owner: 1, kind: 'ali_skitter', sx: p.sx + 200, sy: p.sy },
    ];
    const h = hitTest(ctx({ units }), p.sx, p.sy);
    expect([h.ownUnit, h.enemyUnit]).toEqual([1, 2]);
  });

  it('CUR-4: finds the building whose footprint is under the pointer, own or enemy', () => {
    const buildings = [
      { id: 7, owner: 0, kind: 'hum_barracks', tx: 10, ty: 10 },
      { id: 8, owner: 1, kind: 'ali_nest', tx: 40, ty: 40 },
    ];
    const a = at(11, 11);
    const b = at(41, 41);
    expect(hitTest(ctx({ buildings }), a.sx, a.sy).ownBuilding).toBe(7);
    const hb = hitTest(ctx({ buildings }), b.sx, b.sy);
    expect([hb.enemyBuilding, hb.ownBuilding]).toEqual([8, null]);
  });

  it('CUR-4: right-click attacks an enemy unit, else an enemy building, else moves to the tile', () => {
    const base = hitTest(ctx(), ...(Object.values(at(5.5, 5.5)) as [number, number]));
    expect(rightClickOrder(base, true)).toEqual({ kind: 'move', tx: 5, ty: 5 });
    expect(rightClickOrder({ ...base, enemyBuilding: 8 }, true)).toEqual({ kind: 'attack', target: 8 });
    expect(rightClickOrder({ ...base, enemyBuilding: 8, enemyUnit: 2 }, true)).toEqual({ kind: 'attack', target: 2 });
    expect(rightClickOrder({ ...base, ownUnit: 1 }, true)).toEqual({ kind: 'move', tx: 5, ty: 5 });
  });

  it('CUR-4: the cursor and the right-click order always agree, even with an own unit overlapping an enemy', () => {
    const p = at(10, 10);
    const units = [
      { id: 1, owner: 0, kind: 'hum_tank', sx: p.sx, sy: p.sy },
      { id: 2, owner: 1, kind: 'ali_skitter', sx: p.sx + 4, sy: p.sy },
    ];
    for (const dx of [-30, -10, 0, 4, 10, 30]) {
      const h = hitTest(ctx({ units }), p.sx + dx, p.sy);
      const cursor = cursorFor({ mode: 'normal', combatSelected: true, harvesterSelected: false, anySelected: true, hover: hoverKind(h, true) });
      expect(cursor === 'attack').toBe(rightClickOrder(h, true).kind === 'attack');
    }
  });

  it('CUR-5: with only non-combat units selected, a right-click on an enemy moves there and the cursor says move', () => {
    const p = at(10, 10);
    const units = [{ id: 2, owner: 1, kind: 'ali_skitter', sx: p.sx, sy: p.sy }];
    const h = hitTest(ctx({ units }), p.sx, p.sy);
    expect(rightClickOrder(h, false)).toEqual({ kind: 'move', tx: h.tx, ty: h.ty });
    expect(rightClickOrder(h, true)).toEqual({ kind: 'attack', target: 2 });
    const cursor = cursorFor({ mode: 'normal', combatSelected: false, harvesterSelected: true, anySelected: true, hover: hoverKind(h, true) });
    expect(cursor).toBe('move');
  });

  it('CUR-4: with nothing selected, an own unit under the pointer is what a click would select', () => {
    const p = at(10, 10);
    const units = [
      { id: 1, owner: 0, kind: 'hum_tank', sx: p.sx, sy: p.sy },
      { id: 2, owner: 1, kind: 'ali_skitter', sx: p.sx + 4, sy: p.sy },
    ];
    expect(hoverKind(hitTest(ctx({ units }), p.sx, p.sy), false)).toBe('ownUnit');
    expect(hoverKind(hitTest(ctx({ units }), p.sx, p.sy), true)).toBe('enemy');
  });
});

describe('hit-test on resources', () => {
  it('CUR-4: reports shards under the pointer, and an enemy there still wins the hover', () => {
    const p = at(30.5, 20.5);
    const field = ctx({ shardAt: (x, y) => x === 30 && y === 20 });
    const h = hitTest(field, p.sx, p.sy);
    expect(h.resource).toBe(true);
    expect(hoverKind(h, true)).toBe('resource');
    expect(hoverKind(h, false)).toBe('resource');
    expect(hitTest(ctx(), p.sx, p.sy).resource).toBe(false);
    const withEnemy = hitTest({ ...field, units: [{ id: 5, owner: 1, kind: 'ali_skitter', sx: p.sx, sy: p.sy }] }, p.sx, p.sy);
    expect(hoverKind(withEnemy, true)).toBe('enemy');
  });
});

describe('hit-test on tall buildings', () => {
  it('VOX-14: the roof of a tall building selects it, even though it is above the footprint', () => {
    const buildings = [{ id: 9, owner: 0, kind: 'hum_lance', tx: 10, ty: 10 }];
    const roof = at(11.5, 11.5);
    expect(hitTest(ctx({ buildings }), roof.sx, roof.sy - 120).ownBuilding).toBe(9); // above the footprint's top corner
    expect(hitTest(ctx({ buildings }), roof.sx, roof.sy - 400).ownBuilding).toBeNull(); // well above the roof
  });

  it('VOX-14: where bodies overlap on screen the nearer building wins', () => {
    const buildings = [
      { id: 1, owner: 0, kind: 'hum_barracks', tx: 10, ty: 10 },
      { id: 2, owner: 1, kind: 'hum_lance', tx: 12, ty: 12 },
    ];
    const p = at(11, 11); // the barracks' centre, but the lance's tall body is drawn over it
    const h = hitTest(ctx({ buildings }), p.sx, p.sy);
    expect([h.enemyBuilding, h.ownBuilding]).toEqual([2, null]);
  });
});
