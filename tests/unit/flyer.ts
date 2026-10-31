import { UNIT_DEFS, type UnitDef } from '../../src/data/defs';

/**
 * A test-only aircraft. Neither faction fields one since the heroes replaced the Gunship and the Wasp (HERO-1, HERO-2),
 * but the rules for aircraft (CMB-2, CMB-11) still hold, so tests exercise them with this stand-in.
 */
export const FLYER = 'test_flyer';
const def: UnitDef = {
  faction: 'alien', name: 'Test Flyer', speed: 70, hp: 170, radius: 84, vision: 9, cost: 900, buildTime: 520, builtAt: 'ali_pit', requires: ['ali_evolver'], armor: 'air', air: true, role: 'air',
  weapon: { damage: 10, range: 3.5, cooldown: 7, type: 'pierce', antiAir: true, antiGround: true },
};
(UNIT_DEFS as Record<string, UnitDef>)[FLYER] = def;
