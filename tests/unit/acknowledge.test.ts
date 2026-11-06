import { describe, expect, it } from 'vitest';
import { FP, type Command } from '../../src/sim';
import { ACK_COLORS, ACK_MS, acknowledge, Acks, FLASH_MS } from '../../src/ui/acknowledge';

const TEAM = 0x3fa0ff;
const P = 0;
const at = (x: number, y: number) => ({ x: x * FP, y: y * FP });

describe('order acknowledgement', () => {
  it('UI-13: every mouse order gets a ground marker at the ordered point, coloured by order; non-map commands get none', () => {
    const t = 1000;
    expect(acknowledge({ type: 'move', player: P, units: [1, 2], ...at(10, 12) }, t, TEAM)).toMatchObject({ at: { x: 10, y: 12 }, color: ACK_COLORS.move, units: [1, 2], born: t });
    expect(acknowledge({ type: 'harvest', player: P, units: [3], ...at(4.5, 6) }, t, TEAM)).toMatchObject({ at: { x: 4.5, y: 6 }, color: ACK_COLORS.harvest });
    expect(acknowledge({ type: 'attackmove', player: P, units: [1], ...at(2, 3) }, t, TEAM)?.color).toBe(ACK_COLORS.attack);
    expect(acknowledge({ type: 'superweapon', player: P, building: 9, ...at(20, 20) }, t, TEAM)).toMatchObject({ color: ACK_COLORS.attack, units: [] });
    // A rally point in the player's own colour.
    expect(acknowledge({ type: 'rally', player: P, building: 7, ...at(5, 5) }, t, TEAM)).toMatchObject({ at: { x: 5, y: 5 }, color: TEAM });
    // A building being placed: the marker sits over the middle of its footprint and covers it.
    const place = acknowledge({ type: 'place', player: P, source: 7, tx: 10, ty: 20 }, t, TEAM, { w: 3, h: 2 });
    expect(place).toMatchObject({ at: { x: 11.5, y: 21 }, color: ACK_COLORS.place });
    expect(place!.r).toBeGreaterThanOrEqual(1.5);
    // An attack: no ground point, the marker rides on the target.
    expect(acknowledge({ type: 'attack', player: P, units: [1], target: 42 }, t, TEAM)).toMatchObject({ at: null, target: 42, color: ACK_COLORS.attack });
    // Not orders on the map.
    for (const c of [
      { type: 'produce', player: P, source: 7, kind: 'hum_rifleman' },
      { type: 'cancel', player: P, source: 7, index: 0 },
      { type: 'sell', player: P, building: 7 },
      { type: 'repair', player: P, building: 7, on: true },
    ] as Command[])
      expect(acknowledge(c, t, TEAM)).toBeNull();
  });

  it('UI-13: a marker shrinks and fades over 0.6 s; an attack marker follows its target and is dropped when the target is gone', () => {
    const acks = new Acks();
    acks.add(acknowledge({ type: 'move', player: P, units: [1], ...at(10, 10) }, 0, TEAM)!);
    const start = acks.markers(0, () => null);
    expect(start).toHaveLength(1);
    expect(start[0]).toMatchObject({ x: 10, y: 10, k: 0, color: ACK_COLORS.move });
    const mid = acks.markers(ACK_MS / 2, () => null)[0]!;
    expect(mid.r).toBeLessThan(start[0]!.r);
    expect(mid.k).toBeCloseTo(0.5);
    expect(acks.markers(ACK_MS, () => null)).toEqual([]);

    const chase = new Acks();
    chase.add(acknowledge({ type: 'attack', player: P, units: [1], target: 42 }, 0, TEAM)!);
    let where: { x: number; y: number } | null = { x: 3, y: 4 };
    expect(chase.markers(100, (id) => (id === 42 ? where : null))[0]).toMatchObject({ x: 3, y: 4 });
    where = { x: 5, y: 4 };
    expect(chase.markers(200, (id) => (id === 42 ? where : null))[0]).toMatchObject({ x: 5, y: 4 });
    where = null;
    expect(chase.markers(300, () => where)).toEqual([]);
  });

  it('UI-14: orders play the order sound, orders to fight the attack sound; a keyboard stop plays it without a marker', () => {
    expect(acknowledge({ type: 'move', player: P, units: [1], ...at(1, 1) }, 0, TEAM)?.sound).toBe('order');
    expect(acknowledge({ type: 'harvest', player: P, units: [1], ...at(1, 1) }, 0, TEAM)?.sound).toBe('order');
    expect(acknowledge({ type: 'rally', player: P, building: 1, ...at(1, 1) }, 0, TEAM)?.sound).toBe('order');
    expect(acknowledge({ type: 'place', player: P, source: 1, tx: 1, ty: 1 }, 0, TEAM)?.sound).toBe('order');
    expect(acknowledge({ type: 'attack', player: P, units: [1], target: 2 }, 0, TEAM)?.sound).toBe('attack');
    expect(acknowledge({ type: 'attackmove', player: P, units: [1], ...at(1, 1) }, 0, TEAM)?.sound).toBe('attack');
    expect(acknowledge({ type: 'superweapon', player: P, building: 1, ...at(1, 1) }, 0, TEAM)?.sound).toBe('attack');
    const stop = acknowledge({ type: 'stop', player: P, units: [1, 2] }, 0, TEAM)!;
    expect(stop).toMatchObject({ sound: 'order', color: null, units: [1, 2] });
    const acks = new Acks();
    acks.add(stop);
    expect(acks.markers(10, () => null)).toEqual([]);
  });

  it('UI-15: the ordered units flash at full strength at the order, fading out over 0.35 s; other units do not', () => {
    const acks = new Acks();
    acks.add(acknowledge({ type: 'move', player: P, units: [1, 2], ...at(5, 5) }, 1000, TEAM)!);
    expect(acks.flashing(1000)).toEqual(new Map([[1, 1], [2, 1]]));
    const half = acks.flashing(1000 + FLASH_MS / 2);
    expect(half.get(1)).toBeCloseTo(0.5);
    expect(half.has(3)).toBe(false);
    expect(acks.flashing(1000 + FLASH_MS).size).toBe(0);
    // A second order to one of them restarts its flash.
    acks.add(acknowledge({ type: 'stop', player: P, units: [2] }, 1200, TEAM)!);
    expect(acks.flashing(1200).get(2)).toBe(1);
  });
});
