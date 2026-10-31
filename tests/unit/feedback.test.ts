import { describe, expect, it } from 'vitest';
import { buildingDef } from '../../src/data/defs';
import { fireState, queueRefusal, rallyHint, SellConfirm, superweaponRows } from '../../src/ui/feedback';

const owned = ['hum_hq', 'hum_reactor', 'hum_refinery', 'hum_barracks', 'hum_factory'];

describe('refusal feedback', () => {
  it('UI-3: names why an item cannot be queued: missing building first, then credits, then room', () => {
    expect(queueRefusal('hum_artillery', owned, 0, true)).toBe('Requires Tech Lab');
    expect(queueRefusal('hum_tank', owned, 799, true)).toBe('Not enough credits');
    expect(queueRefusal('hum_tank', owned, 5000, false)).toBe('Queue full');
    expect(queueRefusal('hum_tank', owned, 800, true)).toBeNull();
    expect(queueRefusal('hum_lab', owned, 1100, true)).toBeNull();
    expect(queueRefusal('hum_lance', owned, 9999, true)).toBe('Requires Tech Lab');
  });

  it('UI-3 UI-5: the Fire button says why it cannot fire, low power included', () => {
    expect(fireState(40, false)).toEqual({ ready: false, label: 'Charging 40%' });
    expect(fireState(100, true)).toEqual({ ready: false, label: 'Low power' });
    expect(fireState(100, false)).toEqual({ ready: true, label: 'Fire superweapon' });
  });
});

describe('sell and rally', () => {
  it('UI-4: the first Sell click arms a three-second confirmation and the second sells', () => {
    const s = new SellConfirm(3000);
    expect(s.click(7, 1000)).toBe('confirm');
    expect(s.armed(7, 2000)).toBe(true);
    expect(s.click(7, 2500)).toBe('sell');
    expect(s.armed(7, 2600)).toBe(false);
  });

  it('UI-4: the confirmation lapses after three seconds and belongs to one building', () => {
    const s = new SellConfirm(3000);
    s.click(7, 1000);
    expect(s.armed(8, 1100)).toBe(false);
    expect(s.click(8, 1100)).toBe('confirm');
    expect(s.armed(7, 1200)).toBe(false);
    expect(s.armed(8, 4200)).toBe(false);
    expect(s.click(8, 4200)).toBe('confirm');
  });

  it('UI-4: only buildings that train units show the rally hint', () => {
    expect(rallyHint('hum_barracks')).toBe(true);
    expect(rallyHint('ali_pit')).toBe(true);
    expect(rallyHint('hum_reactor')).toBe(false);
    expect(rallyHint('hum_hq')).toBe(false);
  });
});

describe('superweapon panel', () => {
  it('UI-9: one row per own superweapon with its charge, state and fire button, armed while targeting', () => {
    const mine = [{ id: 1, kind: 'hum_hq', charge: 0 }, { id: 7, kind: 'hum_lance', charge: 45 }];
    const [charging] = superweaponRows(mine, false, null);
    expect(superweaponRows(mine, false, null)).toHaveLength(1); // only superweapons
    expect(charging).toMatchObject({ id: 7, name: 'Orbital Lance', pct: 45, ready: false, armed: false, state: 'Charging 45%', button: '45%', why: 'Charging 45%' });
    const ready = superweaponRows([{ id: 7, kind: 'hum_lance', charge: 100 }], false, null)[0]!;
    expect(ready).toMatchObject({ ready: true, armed: false, state: 'Ready to fire', button: 'FIRE', why: '' });
    expect(superweaponRows([{ id: 7, kind: 'hum_lance', charge: 100 }], true, null)[0]).toMatchObject({ ready: false, state: 'Low power', why: 'Low power' });
    const armed = superweaponRows([{ id: 7, kind: 'hum_lance', charge: 100 }], false, 7)[0]!;
    expect(armed).toMatchObject({ armed: true, button: 'CANCEL' });
    expect(armed.state).toBe('Pick a target on the map');
    expect(superweaponRows([{ id: 9, kind: 'ali_rift', charge: 100 }], false, null)[0]!.name).toBe(buildingDef('ali_rift').name);
    expect(superweaponRows([], false, null)).toEqual([]);
  });
});
