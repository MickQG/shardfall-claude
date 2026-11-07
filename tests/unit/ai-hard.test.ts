import { describe, expect, it } from 'vitest';
import { DIFFICULTIES } from '../../src/ai/ai';

describe('harder Hard (AI-20)', () => {
  it('AI-20: Hard is stricter than before, the order Easy < Medium < Hard holds, Easy and Medium are unchanged', () => {
    expect(DIFFICULTIES.easy).toEqual({ name: 'easy', thinkEvery: 80, maxCommands: 2, bonus: -20 });
    expect(DIFFICULTIES.medium).toEqual({ name: 'medium', thinkEvery: 30, maxCommands: 5, bonus: 0 });
    expect(DIFFICULTIES.hard.thinkEvery).toBeLessThan(10);
    expect(DIFFICULTIES.hard.maxCommands).toBeGreaterThan(10);
    expect(DIFFICULTIES.hard.bonus).toBeGreaterThanOrEqual(30);
    expect(DIFFICULTIES.easy.thinkEvery).toBeGreaterThan(DIFFICULTIES.medium.thinkEvery);
    expect(DIFFICULTIES.medium.thinkEvery).toBeGreaterThan(DIFFICULTIES.hard.thinkEvery);
    expect(DIFFICULTIES.easy.maxCommands).toBeLessThan(DIFFICULTIES.medium.maxCommands);
    expect(DIFFICULTIES.medium.maxCommands).toBeLessThan(DIFFICULTIES.hard.maxCommands);
    expect(Object.keys(DIFFICULTIES.hard).sort()).toEqual(['bonus', 'maxCommands', 'name', 'thinkEvery']);
  });
});
