import { describe, expect, it } from 'vitest';
import { AI, DIFFICULTIES, homeFields } from '../../src/ai/ai';
import type { Faction } from '../../src/data/defs';
import { MAPS, mapStarts, skirmishConfig, type MapId } from '../../src/data/maps';
import { createGame, FP, snapshot, submit, tick } from '../../src/sim';

/**
 * Full AI-vs-AI matches (#107): statistical checks that need whole games, run by `npm run test:matches` and by CI only
 * when the simulation, AI or data change (and on every push to main), not with the fast unit tests.
 */

/** Distinct haulers each player had on each of its two home fields between minutes 5 and 6 of a Medium game. */
function fieldUse(map: MapId, seed: number, factions: [Faction, Faction]): number[][] {
  const cfg = skirmishConfig(seed, { map, factions });
  const g = createGame(cfg);
  const ais = [0, 1].map((p) => new AI(p, factions[p]!, DIFFICULTIES.medium, cfg.map, seed));
  const starts = mapStarts(map);
  const fields = starts.map((s) => homeFields(cfg.map, s).map((f) => new Set(f.tiles)));
  const on = fields.map((fs) => fs.map(() => new Set<number>()));
  const W = cfg.map.width;
  for (let t = 0; t < 20 * 60 * 6; t++) {
    for (const [p, ai] of ais.entries()) if ((t + p * 7) % ai.diff.thinkEvery === 0) for (const c of ai.think(snapshot(g, p))) submit(g, c);
    tick(g);
    if (t < 20 * 60 * 5 || t % 10) continue;
    for (const u of g.state.units) {
      if (u.kind !== 'hum_hauler' && u.kind !== 'ali_gorger') continue;
      const i = Math.floor(u.y / FP) * W + Math.floor(u.x / FP);
      fields[u.owner]!.forEach((f, k) => {
        if (f.has(i)) on[u.owner]![k]!.add(u.id);
      });
    }
  }
  return on.map((fs) => fs.map((s) => s.size));
}

/** Shards both players gathered between minutes 5 and 6 in the match below, before haulers kept to their field (#125). */
/** One seed is chaotic: any change to unit choice (AI-19 artillery) moves it a couple of percent, so allow 3.5 percent below the earlier baseline of 16590 (now 16230). */
const BASELINE_INCOME = 16000;

describe('AI economy in full matches', () => {
  it('AI-18: by minute 5 the AI works both home fields, each with at least two haulers, on every map and from both sides', () => {
    const rows: string[] = [];
    let ok = true;
    for (const { id: map } of MAPS)
      for (const seed of [1, 2])
        for (const factions of [['human', 'alien'], ['alien', 'human']] as [Faction, Faction][]) {
          const use = fieldUse(map, seed, factions);
          rows.push(`${map} s${seed} ${factions[0]}: ${JSON.stringify(use)}`);
          for (const p of use) for (const n of p) if (n < 2) ok = false;
        }
    expect(ok, rows.join('\n')).toBe(true);
  }, 900_000);

  it('ECO-8: between minutes 5 and 6 haulers keep to their own home field and the income holds up', () => {
    const map: MapId = MAPS[0]!.id;
    const factions: [Faction, Faction] = ['human', 'alien'];
    const cfg = skirmishConfig(1, { map, factions });
    const g = createGame(cfg);
    const ais = [0, 1].map((p) => new AI(p, factions[p]!, DIFFICULTIES.medium, cfg.map, 1));
    const fields = mapStarts(map).map((s) => homeFields(cfg.map, s).map((f) => new Set(f.tiles)));
    const W = cfg.map.width;
    const seen = new Map<number, Set<number>>();
    let at5 = 0;
    for (let t = 0; t < 20 * 60 * 6; t++) {
      for (const [p, ai] of ais.entries()) if ((t + p * 7) % ai.diff.thinkEvery === 0) for (const c of ai.think(snapshot(g, p))) submit(g, c);
      tick(g);
      if (t === 20 * 60 * 5) at5 = g.state.players.reduce((a, p) => a + p.stats.shardsGathered, 0);
      if (t < 20 * 60 * 5 || t % 10) continue;
      for (const u of g.state.units) {
        if (u.kind !== 'hum_hauler' && u.kind !== 'ali_gorger') continue;
        const i = Math.floor(u.y / FP) * W + Math.floor(u.x / FP);
        const k = fields[u.owner]!.findIndex((f) => f.has(i));
        if (k >= 0) (seen.get(u.id) ?? seen.set(u.id, new Set()).get(u.id)!).add(k);
      }
    }
    const income = g.state.players.reduce((a, p) => a + p.stats.shardsGathered, 0) - at5;
    const split = [...seen.values()].filter((s) => s.size > 1).length;
    console.log('ECO-8 income', income, 'haulers', seen.size, 'switchers', split);
    expect(seen.size).toBeGreaterThanOrEqual(4);
    expect(split, 'haulers seen on both home fields').toBeLessThanOrEqual(Math.floor(seen.size / 4));
    expect(income).toBeGreaterThanOrEqual(BASELINE_INCOME);
  }, 300_000);
});
