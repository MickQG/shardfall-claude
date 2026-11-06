import { describe, expect, it } from 'vitest';
import { unitCards, type UnitCard } from '../../src/ui/unitInfo';

const card = (faction: 'human' | 'alien', name: string): UnitCard => {
  const c = unitCards(faction).find((x) => x.name === name);
  if (!c) throw new Error(`no card ${name}`);
  return c;
};

describe('unit info cards', () => {
  it('INF-1: one card per unit kind of the chosen faction', () => {
    expect(unitCards('human').map((c) => c.name)).toEqual(['Shard Hauler', 'Rifleman', 'Rocketeer', 'Scout Buggy', 'Bulwark Tank', 'Hammer Artillery', 'Paladin']);
    expect(unitCards('alien').map((c) => c.name)).toEqual(['Gorger', 'Skitterer', 'Spitter', 'Stalker', 'Brute', 'Lobber', 'Dreadstrider']);
  });

  it('INF-2: words, not numbers, for toughness, speed and range; cost, role, air and regeneration', () => {
    expect(card('human', 'Rocketeer')).toMatchObject({ cost: 250, role: 'Anti-armour', toughness: 'Fragile', speed: 'Slow', range: 'Medium', hitsAir: true, regenerates: false });
    expect(card('human', 'Paladin')).toMatchObject({ role: 'Hero tank', toughness: 'Very tough', speed: 'Slow', range: 'Medium', hitsAir: true, regenerates: true });
    expect(card('human', 'Hammer Artillery')).toMatchObject({ toughness: 'Sturdy', speed: 'Slow', range: 'Long', hitsAir: false });
    expect(card('alien', 'Brute')).toMatchObject({ role: 'Tank', toughness: 'Very tough', speed: 'Average', range: 'Melee', hitsAir: false, regenerates: true });
  });

  it('INF-3: strong against lists armour classes taking full damage or more, with the enemy kinds in each', () => {
    expect(card('human', 'Rocketeer').strong).toEqual([{ armour: 'Heavy', units: ['Gorger', 'Brute', 'Lobber', 'Dreadstrider'] }]);
    expect(card('human', 'Paladin').strong).toEqual([{ armour: 'Heavy', units: ['Gorger', 'Brute', 'Lobber', 'Dreadstrider'] }]);
    expect(card('alien', 'Dreadstrider')).toMatchObject({ role: 'Hero tank', toughness: 'Very tough', hitsAir: true, regenerates: true });
    expect(card('human', 'Hammer Artillery').strong).toEqual([{ armour: 'Buildings', units: [] }]);
    expect(card('alien', 'Brute').strong).toEqual([{ armour: 'Light', units: ['Rifleman', 'Rocketeer', 'Scout Buggy'] }]);
  });

  it('INF-3: a unit without a weapon says it cannot attack', () => {
    expect(card('human', 'Shard Hauler')).toMatchObject({ canAttack: false, strong: [] });
    expect(card('human', 'Rifleman').canAttack).toBe(true);
  });

  it('INF-4: weak against lists enemy kinds that can hit it for full damage or more', () => {
    expect(card('human', 'Rocketeer').weak).toEqual(['Skitterer', 'Stalker', 'Brute']);
    expect(card('human', 'Paladin').weak).toEqual(['Spitter', 'Dreadstrider']);
    expect(card('alien', 'Dreadstrider').weak).toEqual(['Rocketeer', 'Bulwark Tank', 'Paladin']);
    expect(card('human', 'Shard Hauler').weak).toEqual(['Spitter', 'Dreadstrider']);
    expect(card('alien', 'Brute').weak).toEqual(['Rocketeer', 'Bulwark Tank', 'Paladin']);
  });

  it('INF-5: cards are a pure function of the definitions', () => {
    expect(unitCards('human')).toEqual(unitCards('human'));
  });
});
