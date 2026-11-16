import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type Personality } from '../../src/ai/ai';
import { DIFFICULTIES } from './levels';
import { aiRules, rulesLine } from './aiRules';
import { playMatches } from './pool';

describe('AI artillery in full matches', () => {
  it('AI-19: against an infantry-heavy opponent artillery is a clearly larger share of the army value', async () => {
    const sides = [[1, 'human', 'alien'], [1, 'alien', 'human'], [2, 'human', 'alien']] as const;
    // Balanced against Raider (infantry-heavy), Medium against Medium, fourteen minutes.
    const rs = await playMatches(sides.map(([seed, a, b]) => ({ seed, factions: [a, b] as ['human' | 'alien', 'human' | 'alien'], difficulties: [DIFFICULTIES.medium, DIFFICULTIES.medium] as [typeof DIFFICULTIES.medium, typeof DIFFICULTIES.medium], maxTicks: 20 * 60 * 14, personalities: ['balanced', 'raider'] as [Personality, Personality], rules: aiRules() })));
    const share = rs.map((r) => {
      const p = r.ai[0].produced;
      const v = [p.inf * 90, p.at * 235, p.tank * 815, p.art * 850, p.hero * 2000, p.scout * 235];
      return v[3]! / Math.max(1, v.reduce((a, b) => a + b, 0));
    });
    // The measurement, for balance work (HAR-6): each game's sides, artillery share and what each AI trained, by role.
    const lines = [
      `AI-19 artillery share, Balanced (player 0) against Raider, Medium, ${rulesLine()}`,
      ...rs.map((r, i) => {
        const [seed, a, b] = sides[i]!;
        return `seed ${seed} ${a} vs ${b}: share ${share[i]!.toFixed(3)}; produced ${JSON.stringify(r.ai[0].produced)} against ${JSON.stringify(r.ai[1].produced)}`;
      }),
    ];
    // Written straight to stdout: the runner holds back console.log output of a passing test.
    process.stdout.write(`${lines.join('\n')}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
    // Before AI-19 this was exactly 0 in all three games (measured on main); now about 0.18.
    for (const s of share) expect(s).toBeGreaterThan(0.08);
    expect(share.reduce((a, b) => a + b, 0) / share.length).toBeGreaterThan(0.12);
  }, 1_500_000);
});
