import { describe, expect, it } from 'vitest';
import { AI, DIFFICULTIES, homeFields } from '../../src/ai/ai';
import type { Faction } from '../../src/data/defs';
import { MAPS, mapStarts, skirmishConfig, type MapId } from '../../src/data/maps';
import { createGame, FP, snapshot, submit, tick } from '../../src/sim';

/**
 * Full AI-vs-AI matches (#107): statistical checks that need whole games, run by `npm run test:matches` and by CI only
 * when the simulation, AI or data change (and on every push to main), not with the fast unit tests.
 */

/** A side that lost this many haulers to the enemy on one home field from minute 4 on had that field overrun. */
const OVERRUN_LOSSES = 2;

/**
 * Distinct haulers each player had on each of its two home fields between minutes 5 and 6 of a Medium game. There is
 * no window to look at, and the result is a reason instead, when the game ended (one side eliminated) before minute 6,
 * or when the enemy's army overran a home field from minute 4 on: the AI keeps its haulers off a field with an enemy
 * army on it, so such a field says nothing about how the AI shares its haulers out.
 */
function fieldUse(map: MapId, seed: number, factions: [Faction, Faction]): number[][] | 'over before minute 6' | 'a home field was overrun' {
  const cfg = skirmishConfig(seed, { map, factions });
  const g = createGame(cfg);
  const ais = [0, 1].map((p) => new AI(p, factions[p]!, DIFFICULTIES.medium, cfg.map, seed));
  const starts = mapStarts(map);
  const fields = starts.map((s) => homeFields(cfg.map, s).map((f) => new Set(f.tiles)));
  const on = fields.map((fs) => fs.map(() => new Set<number>()));
  const W = cfg.map.width;
  // Haulers standing on one of their own home fields last tick, by id: [owner, field]. One gone the next tick was killed there.
  let standing = new Map<number, [number, number]>();
  const lost = fields.map((fs) => fs.map(() => 0));
  for (let t = 0; t < 20 * 60 * 6; t++) {
    for (const [p, ai] of ais.entries()) if ((t + p * 7) % ai.diff.thinkEvery === 0) for (const c of ai.think(snapshot(g, p))) submit(g, c);
    tick(g);
    if (g.state.over) return 'over before minute 6';
    if (t < 20 * 60 * 4) continue;
    const now = new Map<number, [number, number]>();
    const alive = new Set<number>();
    for (const u of g.state.units) {
      if (u.kind !== 'hum_hauler' && u.kind !== 'ali_gorger') continue;
      alive.add(u.id);
      const i = Math.floor(u.y / FP) * W + Math.floor(u.x / FP);
      fields[u.owner]!.forEach((f, k) => {
        if (!f.has(i)) return;
        now.set(u.id, [u.owner, k]);
        if (t >= 20 * 60 * 5 && t % 10 === 0) on[u.owner]![k]!.add(u.id);
      });
    }
    for (const [id, [owner, k]] of standing) if (!alive.has(id)) lost[owner]![k]!++;
    standing = now;
  }
  if (lost.some((fs) => fs.some((n) => n >= OVERRUN_LOSSES))) return 'a home field was overrun';
  return on.map((fs) => fs.map((s) => s.size));
}

/** Matches per map and side, and the seeds tried in order for them: those with no window to judge are passed over. */
const MATCHES = 2;
const SEEDS = [1, 2, 3, 4, 5, 6];

/**
 * Shards gathered per hauler per minute between minutes 5 and 6 in the match below. Measured per hauler so that it
 * judges how well haulers work, not how many the AI happened to build in that one game: total income was 16590 before
 * haulers kept to their field (#125) and the floor was 16000, 3.5 percent below; when orders were made prompt (SIM-10)
 * the game played out differently, with fewer haulers (12 instead of 14) earning 1323 a minute each, against 1326
 * before. The floor keeps the same 3.5 percent below that rate.
 */
const BASELINE_RATE = 1280;

describe('AI economy in full matches', () => {
  it('AI-18: by minute 5 the AI works both home fields, each with at least two haulers, on every map and from both sides', () => {
    const rows: string[] = [];
    let ok = true;
    for (const { id: map } of MAPS)
      for (const factions of [['human', 'alien'], ['alien', 'human']] as [Faction, Faction][]) {
        // A game won by a rush before minute 6, or with a home field overrun, has no window to judge; the next seed
        // stands in, so every map and side still gets MATCHES games that reach it.
        let played = 0;
        for (const seed of SEEDS) {
          if (played === MATCHES) break;
          const use = fieldUse(map, seed, factions);
          rows.push(`${map} s${seed} ${factions[0]}: ${typeof use === 'string' ? use : JSON.stringify(use)}`);
          if (typeof use === 'string') continue;
          played++;
          for (const p of use) for (const n of p) if (n < 2) ok = false;
        }
        if (played < MATCHES) ok = false;
      }
    console.log(`AI-18 haulers per home field, per side\n${rows.join('\n')}`);
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
    let haulerTicks = 0;
    for (let t = 0; t < 20 * 60 * 6; t++) {
      for (const [p, ai] of ais.entries()) if ((t + p * 7) % ai.diff.thinkEvery === 0) for (const c of ai.think(snapshot(g, p))) submit(g, c);
      tick(g);
      if (t === 20 * 60 * 5) at5 = g.state.players.reduce((a, p) => a + p.stats.shardsGathered, 0);
      if (t <= 20 * 60 * 5) continue;
      haulerTicks += g.state.units.filter((u) => u.kind === 'hum_hauler' || u.kind === 'ali_gorger').length;
      if (t % 10) continue;
      for (const u of g.state.units) {
        if (u.kind !== 'hum_hauler' && u.kind !== 'ali_gorger') continue;
        const i = Math.floor(u.y / FP) * W + Math.floor(u.x / FP);
        const k = fields[u.owner]!.findIndex((f) => f.has(i));
        if (k >= 0) (seen.get(u.id) ?? seen.set(u.id, new Set()).get(u.id)!).add(k);
      }
    }
    const income = g.state.players.reduce((a, p) => a + p.stats.shardsGathered, 0) - at5;
    const rate = Math.round((income * 20 * 60) / haulerTicks);
    const split = [...seen.values()].filter((s) => s.size > 1).length;
    console.log('ECO-8 income', income, 'per hauler-minute', rate, 'haulers', seen.size, 'switchers', split);
    expect(seen.size).toBeGreaterThanOrEqual(4);
    expect(split, 'haulers seen on both home fields').toBeLessThanOrEqual(Math.floor(seen.size / 4));
    expect(rate).toBeGreaterThanOrEqual(BASELINE_RATE);
  }, 300_000);
});
