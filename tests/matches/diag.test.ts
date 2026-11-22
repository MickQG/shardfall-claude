import { describe, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { playMatches } from './pool';
import { DIFFICULTIES } from './levels';

describe('diag', () => {
  it('timelines', async () => {
    const games = [
      { seed: 1, map: 'highlands' as const, factions: ['alien', 'human'] as ['alien', 'human'] },
      { seed: 2, map: 'riverbed' as const, factions: ['human', 'alien'] as ['human', 'alien'] },
      { seed: 3, map: 'riverbed' as const, factions: ['human', 'alien'] as ['human', 'alien'] },
      { seed: 1, map: 'highlands' as const, factions: ['human', 'alien'] as ['human', 'alien'] },
    ].map((g) => ({ ...g, difficulties: [DIFFICULTIES.hard, DIFFICULTIES.hard] as [typeof DIFFICULTIES.hard, typeof DIFFICULTIES.hard], maxTicks: 20000 }));
    const rs = await playMatches(games);
    const out: string[] = [];
    rs.forEach((r, i) => {
      const g = games[i]!;
      out.push(`TL ${g.map} s${g.seed} ${g.factions.join('/')} winner ${String(r.winner)} t${r.ticks}`);
      for (const row of ((r as unknown as { timeline?: string[] }).timeline ?? [])) out.push(`TL   ${row}`);
    });
    process.stdout.write(out.join(String.fromCharCode(10)) + String.fromCharCode(10));
    const summary = process.env['GITHUB_STEP_SUMMARY'];
    if (summary) appendFileSync(summary, out.join(String.fromCharCode(10)));
  }, 1_200_000);
});
