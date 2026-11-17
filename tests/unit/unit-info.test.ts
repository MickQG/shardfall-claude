import { describe, expect, it } from 'vitest';
import { unitCards, type UnitCard } from '../../src/ui/unitInfo';

const card = (faction: 'human' | 'alien', name: string): UnitCard => {
  const c = unitCards(faction).find((x) => x.name === name);
  if (!c) throw new Error(`no card ${name}`);
  return c;
};

describe('unit info cards', () => {
  it('INF-1: one card per unit kind of the chosen faction', () => {
    expect(unitCards('human').map((c) => c.name)).toEqual(['Shard Hauler', 'Rifleman', 'Rocketeer', 'Scout Buggy', 'Bulwark Tank', 'Hammer Artillery', 'Field Mender', 'Paladin']);
    expect(unitCards('alien').map((c) => c.name)).toEqual(['Gorger', 'Skitterer', 'Spitter', 'Stalker', 'Brute', 'Lobber', 'Glare Skimmer', 'Dreadstrider']);
  });

  it('INF-2: words, not numbers, for toughness, speed and range; cost, role, air and regeneration', () => {
    expect(card('human', 'Rocketeer')).toMatchObject({ cost: 250, role: 'Anti-armour', toughness: 'Fragile', speed: 'Slow', range: 'Medium', hitsAir: true, regenerates: false });
    expect(card('human', 'Paladin')).toMatchObject({ role: 'Hero tank', toughness: 'Very tough', speed: 'Slow', range: 'Medium', hitsAir: true, regenerates: true });
    expect(card('human', 'Hammer Artillery')).toMatchObject({ toughness: 'Sturdy', speed: 'Slow', range: 'Long', hitsAir: false });
    expect(card('alien', 'Brute')).toMatchObject({ role: 'Tank', toughness: 'Very tough', speed: 'Average', range: 'Melee', hitsAir: false, regenerates: true });
  });

  it('INF-3: strong against lists armour classes taking full damage or more, with the enemy kinds in each', () => {
    expect(card('human', 'Rocketeer').strong).toEqual([{ armour: 'Heavy', units: ['Gorger', 'Brute', 'Lobber', 'Glare Skimmer', 'Dreadstrider'] }]);
    expect(card('human', 'Paladin').strong).toEqual([{ armour: 'Heavy', units: ['Gorger', 'Brute', 'Lobber', 'Glare Skimmer', 'Dreadstrider'] }]);
    expect(card('alien', 'Dreadstrider')).toMatchObject({ role: 'Hero tank', toughness: 'Very tough', hitsAir: true, regenerates: true });
    expect(card('human', 'Hammer Artillery').strong).toEqual([{ armour: 'Buildings', units: [] }]);
    expect(card('alien', 'Brute').strong).toEqual([{ armour: 'Light', units: ['Rifleman', 'Rocketeer', 'Scout Buggy'] }]);
  });

  it('INF-3: a unit without a weapon says it cannot attack', () => {
    expect(card('human', 'Shard Hauler')).toMatchObject({ canAttack: false, strong: [] });
    expect(card('human', 'Rifleman').canAttack).toBe(true);
  });

  it('INF-3, R3D-38: an unarmed support unit says what it does instead: the Field Mender repairs and carries a squad', () => {
    expect(card('human', 'Field Mender')).toMatchObject({ canAttack: false, strong: [], work: 'Repairs vehicles within 3 tiles; carries one infantry squad' });
    expect(card('human', 'Shard Hauler').work).toBeNull();
    expect(card('human', 'Bulwark Tank').work).toBeNull();
  });

  it('INF-4: weak against lists enemy kinds that can hit it for full damage or more', () => {
    expect(card('human', 'Rocketeer').weak).toEqual(['Skitterer', 'Stalker', 'Brute']);
    expect(card('human', 'Paladin').weak).toEqual(['Spitter', 'Glare Skimmer', 'Dreadstrider']);
    expect(card('alien', 'Dreadstrider').weak).toEqual(['Rocketeer', 'Bulwark Tank', 'Paladin']);
    expect(card('human', 'Shard Hauler').weak).toEqual(['Spitter', 'Glare Skimmer', 'Dreadstrider']);
    expect(card('alien', 'Brute').weak).toEqual(['Rocketeer', 'Bulwark Tank', 'Paladin']);
  });

  it('SKM-1, INF-2, INF-3, INF-4: the Glare Skimmer card: a very tough, long-range anti-armour unit, strong against heavy armour, ground only', () => {
    expect(card('alien', 'Glare Skimmer')).toMatchObject({ cost: 950, role: 'Anti-armour', toughness: 'Very tough', speed: 'Average', range: 'Long', hitsAir: false, regenerates: true, canAttack: true });
    expect(card('alien', 'Glare Skimmer').strong).toEqual([{ armour: 'Heavy', units: ['Shard Hauler', 'Bulwark Tank', 'Hammer Artillery', 'Field Mender', 'Paladin'] }]);
    expect(card('alien', 'Glare Skimmer').weak).toEqual(['Rocketeer', 'Paladin']);
  });

  it('INF-4, SKM-4: a unit that fires on the move is not weak against an enemy it out-ranges and hurts: it kites it', () => {
    // The Skimmer's lance (range 8, 160% to heavy) out-ranges the Bulwark's rockets (6) while it skims away.
    expect(card('alien', 'Glare Skimmer').weak).not.toContain('Bulwark Tank');
    // The Paladin's missile salvo reaches 9 tiles, past the lance: still a threat. Rocketeers are light: the lance barely hurts them.
    expect(card('alien', 'Glare Skimmer').weak).toEqual(expect.arrayContaining(['Paladin', 'Rocketeer']));
    // Units that do not fire on the move keep the plain rule.
    expect(card('alien', 'Brute').weak).toContain('Bulwark Tank');
  });

  it('INF-5: cards are a pure function of the definitions', () => {
    expect(unitCards('human')).toEqual(unitCards('human'));
  });
});
