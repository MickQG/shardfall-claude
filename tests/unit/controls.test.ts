import { describe, expect, it } from 'vitest';
import { combatUnitIds, DoubleTap } from '../../src/ui/controls';
import { rallyLine } from '../../src/ui/rally';
import { cursorCss, cursorFor, type CursorState } from '../../src/ui/cursor';
import { cancelPlan } from '../../src/ui/cancelPlan';

const units = [
  { id: 1, owner: 0, kind: 'hum_rifleman' },
  { id: 2, owner: 0, kind: 'hum_hauler' },
  { id: 3, owner: 1, kind: 'ali_skitter' },
  { id: 4, owner: 0, kind: 'hum_tank' },
  { id: 5, owner: 0, kind: 'hum_gunship' },
];

describe('select-all-combat', () => {
  it('CTL-6: selects own armed units only, leaving out harvesters and enemies', () => {
    expect(combatUnitIds(units, 0)).toEqual([1, 4, 5]);
  });
  it('CTL-6: yields nothing when the player has no combat units', () => {
    expect(combatUnitIds([{ id: 2, owner: 0, kind: 'hum_hauler' }], 0)).toEqual([]);
  });
  it('CTL-6: a second press inside the window is a double tap, a slow one is not', () => {
    const t = new DoubleTap(350);
    expect(t.press(1000)).toBe(false);
    expect(t.press(1200)).toBe(true);
    expect(t.press(1300)).toBe(false);
    expect(t.press(2000)).toBe(false);
  });
});

describe('rally line', () => {
  const b = { id: 7, owner: 0, kind: 'hum_barracks', tx: 10, ty: 10, rally: [20 * 256, 30 * 256] as [number, number] };
  it('CTL-9: a selected production building with a rally point draws a line from its centre to the rally tile', () => {
    expect(rallyLine(b, 7)).toEqual({ from: { tx: 11, ty: 11 }, to: { tx: 20, ty: 30 } });
  });
  it('CTL-9: no line when the building is not selected or has no explicit rally point', () => {
    expect(rallyLine(b, 8)).toBeNull();
    expect(rallyLine(b, null)).toBeNull();
    expect(rallyLine({ ...b, rally: null }, 7)).toBeNull();
  });
});

const base: CursorState = { mode: 'normal', combatSelected: false, harvesterSelected: false, anySelected: false, hover: 'ground' };

describe('cursor', () => {
  it('CUR-1: default, select, move, attack, attack-move, invalid and superweapon are all distinct states', () => {
    const ids = new Set([
      cursorFor(base),
      cursorFor({ ...base, hover: 'ownUnit' }),
      cursorFor({ ...base, anySelected: true }),
      cursorFor({ ...base, anySelected: true, combatSelected: true, hover: 'enemy' }),
      cursorFor({ ...base, mode: 'amove' }),
      cursorFor({ ...base, anySelected: true, harvesterSelected: true, hover: 'resource' }),
      cursorFor({ ...base, anySelected: true, hover: 'blocked' }),
      cursorFor({ ...base, mode: 'targeting' }),
    ]);
    expect(ids.size).toBe(8);
  });
  it('CUR-1: a harvester over a shard field shows the harvest cursor; other selections and nothing selected do not', () => {
    const over = { ...base, hover: 'resource' as const };
    expect(cursorFor({ ...over, anySelected: true, harvesterSelected: true })).toBe('harvest');
    expect(cursorFor({ ...over, anySelected: true, harvesterSelected: true, combatSelected: true })).toBe('harvest'); // a mixed group still harvests
    expect(cursorFor({ ...over, anySelected: true, combatSelected: true })).toBe('move'); // soldiers just walk there
    expect(cursorFor(over)).toBe('default');
    expect(cursorFor({ ...base, hover: 'enemy', anySelected: true, harvesterSelected: true })).not.toBe('harvest'); // harvesters cannot attack
  });
  it('CUR-1: the attack-move cursor shows only while attack-move is armed, never merely because units are selected', () => {
    expect(cursorFor({ ...base, anySelected: true, combatSelected: true })).not.toBe('attackmove');
    expect(cursorFor({ ...base, mode: 'amove', anySelected: true, combatSelected: true })).toBe('attackmove');
    expect(cursorFor({ ...base, mode: 'amove', hover: 'enemy', anySelected: true, combatSelected: true })).toBe('attackmove');
  });
  it('CUR-2: placement shows valid versus blocked', () => {
    expect(cursorFor({ ...base, mode: 'placing', placementOk: true })).toBe('place-ok');
    expect(cursorFor({ ...base, mode: 'placing', placementOk: false })).toBe('place-bad');
  });
  it('CUR-3: every cursor is an inline SVG data URI with a CSS fallback and needs no image file', () => {
    for (const id of ['default', 'select', 'move', 'attack', 'attackmove', 'harvest', 'invalid', 'place-ok', 'place-bad', 'superweapon'] as const) {
      const css = cursorCss(id);
      expect(css).toMatch(/^url\("data:image\/svg\+xml;utf8,.+"\) \d+ \d+, (default|pointer|crosshair|not-allowed|move)$/);
    }
  });
});

describe('cancel plan', () => {
  const q = (...k: string[]) => k.map((kind) => ({ kind }));
  it('PRD-10: cancelPlan picks the newest matching items, highest index first, up to the count', () => {
    expect(cancelPlan(q('a', 'b', 'a', 'a', 'b', 'a'), 'a', 2)).toEqual([5, 3]);
    expect(cancelPlan(q('a', 'b', 'a', 'a', 'b', 'a'), 'a', 5)).toEqual([5, 3, 2, 0]);
    expect(cancelPlan(q('a', 'b'), 'c', 5)).toEqual([]);
    expect(cancelPlan(q('a', 'a'), 'a', 1)).toEqual([1]);
    expect(cancelPlan(Array.from({ length: 20 }, () => ({ kind: 'a' })), 'a', 5)).toEqual([19, 18, 17, 16, 15]);
  });
});
