import { describe, expect, it } from 'vitest';
import { DIFFICULTIES } from '../../src/ai/ai';

describe('difficulty levels (AI-20, AI-28)', () => {
  it('AI-20: Hard reacts faster and gives more orders than the Hard before it, and has no field but the three AI-10 allows', () => {
    expect(DIFFICULTIES.hard.thinkEvery).toBeLessThan(10);
    expect(DIFFICULTIES.hard.maxCommands).toBeGreaterThan(10);
    expect(Object.keys(DIFFICULTIES.hard).sort()).toEqual(['bonus', 'maxCommands', 'name', 'thinkEvery']);
  });

  it('AI-28: Easy 60 ticks, 2 orders, -10%; Medium 24 ticks, 7 orders, 0%; Hard 8 ticks, 12 orders, +15%; the order Easy < Medium < Hard holds on every figure', () => {
    expect(DIFFICULTIES.easy).toEqual({ name: 'easy', thinkEvery: 60, maxCommands: 2, bonus: -10 });
    expect(DIFFICULTIES.medium).toEqual({ name: 'medium', thinkEvery: 24, maxCommands: 7, bonus: 0 });
    expect(DIFFICULTIES.hard).toEqual({ name: 'hard', thinkEvery: 8, maxCommands: 12, bonus: 15 });
    expect(DIFFICULTIES.easy.thinkEvery).toBeGreaterThan(DIFFICULTIES.medium.thinkEvery);
    expect(DIFFICULTIES.medium.thinkEvery).toBeGreaterThan(DIFFICULTIES.hard.thinkEvery);
    expect(DIFFICULTIES.easy.maxCommands).toBeLessThan(DIFFICULTIES.medium.maxCommands);
    expect(DIFFICULTIES.medium.maxCommands).toBeLessThan(DIFFICULTIES.hard.maxCommands);
    expect(DIFFICULTIES.easy.bonus).toBeLessThan(DIFFICULTIES.medium.bonus);
    expect(DIFFICULTIES.medium.bonus).toBeLessThan(DIFFICULTIES.hard.bonus);
  });
});
