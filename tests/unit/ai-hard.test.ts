import { describe, expect, it } from 'vitest';
import { DIFFICULTIES } from '../../src/ai/ai';
import { skirmishConfig } from '../../src/data/maps';
import { createGame, tick } from '../../src/sim';

describe('difficulty levels (AI-20, AI-28)', () => {
  it('AI-20: Hard reacts faster and gives more orders than the Hard before it, and has no field but the three AI-10 allows', () => {
    expect(DIFFICULTIES.hard.thinkEvery).toBeLessThan(10);
    expect(DIFFICULTIES.hard.maxCommands).toBeGreaterThan(10);
    expect(Object.keys(DIFFICULTIES.hard).sort()).toEqual(['bonus', 'maxCommands', 'name', 'thinkEvery']);
  });

  it('AI-28: Easy 60 ticks, 2 orders, -10%; Medium 26 ticks, 7 orders, 0%; Hard 8 ticks, 12 orders, +15%; the order Easy < Medium < Hard holds on every figure', () => {
    expect(DIFFICULTIES.easy).toEqual({ name: 'easy', thinkEvery: 60, maxCommands: 2, bonus: -10 });
    expect(DIFFICULTIES.medium).toEqual({ name: 'medium', thinkEvery: 26, maxCommands: 7, bonus: 0 });
    expect(DIFFICULTIES.hard).toEqual({ name: 'hard', thinkEvery: 8, maxCommands: 12, bonus: 15 });
    expect(DIFFICULTIES.easy.thinkEvery).toBeGreaterThan(DIFFICULTIES.medium.thinkEvery);
    expect(DIFFICULTIES.medium.thinkEvery).toBeGreaterThan(DIFFICULTIES.hard.thinkEvery);
    expect(DIFFICULTIES.easy.maxCommands).toBeLessThan(DIFFICULTIES.medium.maxCommands);
    expect(DIFFICULTIES.medium.maxCommands).toBeLessThan(DIFFICULTIES.hard.maxCommands);
    expect(DIFFICULTIES.easy.bonus).toBeLessThan(DIFFICULTIES.medium.bonus);
    expect(DIFFICULTIES.medium.bonus).toBeLessThan(DIFFICULTIES.hard.bonus);
  });

  it('AI-28: the shard bonus is exact over the loads delivered, not rounded down on every tick of unloading', () => {
    // No AI plays, so the haulers work the same whatever the bonus: only what a load pays differs.
    const income = (bonus: number): number => {
      const g = createGame(skirmishConfig(1, { bonuses: [bonus, 0] }));
      const before = g.state.players[0]!.credits;
      for (let i = 0; i < 2400; i++) tick(g);
      return g.state.players[0]!.credits - before;
    };
    const base = income(0);
    expect(base).toBeGreaterThan(400);
    // Within a credit per load of the exact share (rounding down on every tick paid +10% for +15%, and +20% for +25%).
    const loads = Math.ceil(base / 200) + 1;
    for (const bonus of [15, 25, -10, 30]) {
      const got = income(bonus);
      expect(got, `bonus ${bonus}`).toBeLessThanOrEqual((base * (100 + bonus)) / 100 + 1); // a load still unloading may be a fraction ahead
      expect(got, `bonus ${bonus}`).toBeGreaterThanOrEqual((base * (100 + bonus)) / 100 - loads);
    }
  });
});
