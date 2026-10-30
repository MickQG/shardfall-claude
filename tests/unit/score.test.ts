import { describe, expect, it } from 'vitest';
import { skirmishConfig } from '../../src/data/maps';
import { createGame, hash, snapshot, STATS_EVERY, submit, tick, type Game } from '../../src/sim';
import { armyPath, scoreRows } from '../../src/ui/score';

const run = (g: Game, n: number): void => {
  for (let i = 0; i < n; i++) tick(g);
};

describe('score statistics', () => {
  it('SCR-1: counts units built and lost, buildings lost and shards gathered per player', () => {
    const base = skirmishConfig(1);
    const g = createGame({ ...base, buildings: [...base.buildings!, { owner: 0, kind: 'hum_barracks', tx: 20, ty: 14 }] });
    const barracks = g.state.buildings.find((b) => b.owner === 0 && b.kind === 'hum_barracks')!;
    submit(g, { type: 'produce', player: 0, source: barracks.id, kind: 'hum_rifleman' });
    run(g, 300);
    expect(g.state.players[0]!.stats.unitsBuilt).toBe(1);
    expect(g.state.players[1]!.stats.unitsBuilt).toBe(0); // starting forces do not count
    // Shards gathered equal the credits earned when nothing else is bought.
    const before = { credits: g.state.players[1]!.credits, gathered: g.state.players[1]!.stats.shardsGathered };
    run(g, 600);
    expect(g.state.players[1]!.stats.shardsGathered - before.gathered).toBe(g.state.players[1]!.credits - before.credits);
    expect(g.state.players[1]!.stats.shardsGathered).toBeGreaterThan(0);

    const victim = g.state.units.find((u) => u.owner === 1)!;
    victim.hp = 0;
    const reactor = g.state.buildings.find((b) => b.owner === 1 && b.kind !== 'ali_hq')!;
    reactor.hp = 0;
    run(g, 1);
    expect(g.state.players[1]!.stats.unitsLost).toBe(1);
    expect(g.state.players[1]!.stats.buildingsLost).toBe(1);
    expect(g.state.players[0]!.stats.unitsLost).toBe(0);
  });

  it('SCR-1: samples each army value every ten seconds, and the counts are part of the state hash', () => {
    const g = createGame(skirmishConfig(2));
    run(g, STATS_EVERY * 2 + 1);
    expect(g.state.players[0]!.stats.army).toHaveLength(3);
    expect(g.state.players[0]!.stats.army[0]).toBeGreaterThan(0);
    const h = hash(g);
    g.state.players[0]!.stats.unitsLost += 1;
    expect(hash(g)).not.toBe(h);
  });

  it('SCR-2: a player sees the statistics only once the game is over; the god view always does', () => {
    const g = createGame(skirmishConfig(3));
    run(g, 2);
    expect(snapshot(g, 0).stats).toBeNull();
    expect(snapshot(g).stats).toHaveLength(2);
    g.state.buildings = g.state.buildings.filter((b) => b.owner !== 1);
    run(g, 1);
    const end = snapshot(g, 0);
    expect(end.over).toBe(true);
    expect(end.stats?.map((s) => s.unitsBuilt)).toEqual([0, 0]);
  });
});

describe('score screen', () => {
  const stats = [
    { unitsBuilt: 12, unitsLost: 4, buildingsBuilt: 5, buildingsLost: 1, shardsGathered: 6400, army: [0, 1000, 3000] },
    { unitsBuilt: 9, unitsLost: 9, buildingsBuilt: 4, buildingsLost: 7, shardsGathered: 5100, army: [0, 1500, 500] },
  ];

  it('SCR-3: the table lists both sides, with units destroyed taken from the other side\'s losses, and the game length', () => {
    const t = scoreRows(stats, ['Aegis Union', 'Vrax Hive'], 20 * 754);
    expect(t.header).toEqual(['', 'Aegis Union', 'Vrax Hive']);
    expect(t.rows).toEqual([
      ['Units built', '12', '9'],
      ['Units lost', '4', '9'],
      ['Units destroyed', '9', '4'],
      ['Buildings built', '5', '4'],
      ['Buildings lost', '1', '7'],
      ['Shards gathered', '6400', '5100'],
    ]);
    expect(t.length).toBe('12:34');
  });

  it('SCR-3: the army graph scales every side to the same axes', () => {
    expect(armyPath([0, 1000, 3000], 3000, 200, 100)).toBe('0,100 100,67 200,0');
    expect(armyPath([0, 1500, 500], 3000, 200, 100)).toBe('0,100 100,50 200,83');
    expect(armyPath([5], 0, 200, 100)).toBe('0,100 200,100');
  });
});
