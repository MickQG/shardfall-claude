import { describe, expect, it } from 'vitest';
import { AI, DIFFICULTIES, shardFields, type ShardField } from '../../src/ai/ai';
import { crawlTarget, fieldHaulers, fieldStock, inReach, minedFields, padDistance, servingRefinery, wantsCrawl, type MinedField } from '../../src/ai/expand';
import { buildingDef, unitDef } from '../../src/data/defs';
import { idealHaulers } from '../../src/data/haulers';
import { skirmishConfig } from '../../src/data/maps';
import { createGame, EXPLORED, FP, snapshot, submit, tick, type BuildingSnap, type Game } from '../../src/sim';

/**
 * Economy and expansion (AI-43, AI-44) on the redrawn Crossroads (MAP-10). Player 0's headquarters stands at 10,10; its
 * home fields are centred at 22.5,12.5 and 12.5,24.5, its natural field at 37.5,13.5 and the centre field at 48,48.
 */

const NATURAL = { x: 37.5, y: 13.5 };
const CENTRE = { x: 48, y: 48 };
const near = (f: ShardField, p: { x: number; y: number }): boolean => Math.hypot(f.cx - p.x, f.cy - p.y) < 1;

/** A one-row field of `n` tiles along y = 5 from x = 10 on a 40-wide map, each holding `amount`. */
function rowField(n: number, amount: number): { f: ShardField; shards: number[] } {
  const W = 40;
  const shards = new Array<number>(W * 20).fill(0);
  const tiles = [...Array(n)].map((_, i) => 5 * W + 10 + i);
  for (const t of tiles) shards[t] = amount;
  return { f: { tiles, cx: 10 + n / 2, cy: 5.5 }, shards };
}

const refinery = (tx: number, ty: number, pad?: [number, number]): BuildingSnap => ({ id: 1, owner: 0, kind: 'hum_refinery', tx, ty, hp: 900, queue: [], pad }) as unknown as BuildingSnap;

describe('AI-43: the ideal hauler count on each mined field', () => {
  it('AI-43: a field wants its ideal count (ECO-10) for its live tiles and pad distance, capped so each hauler’s share of what is left pays for it', () => {
    expect(fieldHaulers('hum_hauler', 21, 2, 63000, 400)).toBe(idealHaulers('hum_hauler', 21, 2));
    expect(fieldHaulers('ali_gorger', 44, 8, 132000, 350)).toBe(idealHaulers('ali_gorger', 44, 8));
    // Nearly used up: 1 300 left pays for three haulers of 400, not the ideal five.
    expect(fieldHaulers('hum_hauler', 21, 2, 1300, 400)).toBe(3);
    expect(fieldHaulers('hum_hauler', 21, 2, 300, 400)).toBe(0);
    expect(fieldHaulers('hum_hauler', 0, 2, 0, 400)).toBe(0);
  });

  it('AI-43: the distance runs from the serving refinery’s dock pad to the nearest tile still holding shards; size counts only live tiles', () => {
    const { f, shards } = rowField(7, 3000);
    const ref = refinery(4, 4, [7, 5]);
    expect(servingRefinery([ref], f)).toBe(ref);
    expect(padDistance(ref, f, shards, 40)).toBe(3);
    // The nearest two tiles mined out: the distance grows and the size shrinks.
    shards[5 * 40 + 10] = 0;
    shards[5 * 40 + 11] = 0;
    expect(padDistance(ref, f, shards, 40)).toBe(5);
    expect(fieldStock(shards, f)).toEqual({ left: 5 * 3000, tiles: 5 });
    // A refinery more than 9 tiles from the field's centre does not serve it.
    expect(servingRefinery([refinery(30, 15, [30, 14])], f)).toBeUndefined();
  });

  it('AI-43: its target is the sum over the fields it mines; a field without a refinery beside it wants none', () => {
    const { f, shards } = rowField(7, 3000);
    const far: ShardField = { tiles: [15 * 40 + 30], cx: 30.5, cy: 15.5 };
    shards[15 * 40 + 30] = 3000;
    const mined = minedFields([f, far], [21000, 3000], [refinery(4, 4, [7, 5])], shards, 40, 'hum_hauler', 400);
    expect(mined).toEqual([{ index: 0, want: idealHaulers('hum_hauler', 7, 3), low: false }]);
    // Below a quarter of its starting shards it is low (AI-44).
    for (const t of f.tiles) shards[t] = 600;
    expect(minedFields([f], [21000], [refinery(4, 4, [7, 5])], shards, 40, 'hum_hauler', 400)[0]!.low).toBe(true);
  });
});

describe('AI-44: crawling toward a new field', () => {
  const m = (index: number, want: number, low = false): MinedField => ({ index, want, low });

  it('AI-44: it crawls when every mined field has its ideal count, or any has less than a quarter of its shards left', () => {
    const loads = new Map([
      [0, 6],
      [1, 4],
    ]);
    const staffed = (x: MinedField): boolean => (loads.get(x.index) ?? 0) >= x.want;
    expect(wantsCrawl([m(0, 6), m(1, 5)], staffed)).toBe(false);
    expect(wantsCrawl([m(0, 6), m(1, 4)], staffed)).toBe(true);
    expect(wantsCrawl([m(0, 6), m(1, 5, true)], staffed)).toBe(true);
    expect(wantsCrawl([], staffed)).toBe(false);
  });

  it('AI-44: the target is the nearest safe field; with none safe, the one nearest the map centre', () => {
    const f = (cx: number, cy: number): ShardField => ({ tiles: [cy * 96 + cx], cx, cy });
    const natural = f(37, 13);
    const centre = f(48, 48);
    const enemy = f(58, 82);
    const all = [natural, centre, enemy];
    expect(crawlTarget(all, () => true, CENTRE)).toBe(natural);
    expect(crawlTarget(all, (x) => x !== natural, CENTRE)).toBe(centre);
    expect(crawlTarget(all, () => false, CENTRE)).toBe(centre);
    expect(crawlTarget([enemy], () => false, CENTRE)).toBe(enemy);
    expect(crawlTarget([], () => true, CENTRE)).toBeNull();
  });

  it('AI-44: a field is in reach when one of its buildings stands within build range less one of an explored tile still holding shards', () => {
    const { f } = rowField(13, 3000);
    const fog = new Uint8Array(40 * 20).fill(EXPLORED);
    const at = (tx: number): BuildingSnap => ({ ...refinery(tx, 5), kind: 'hum_reactor' }) as BuildingSnap;
    // A 2-wide reactor at x 4..5 is 5 tiles short of x = 10.
    expect(inReach(f, [at(4)], fog, 40)).toBe(true);
    expect(inReach(f, [at(3)], fog, 40)).toBe(false);
    expect(inReach(f, [at(4)], new Uint8Array(40 * 20), 40)).toBe(false);
  });
});

/** Let one AI play on its cadence for `ticks` while its opponent idles. */
function drive(g: Game, ai: AI, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    if (g.state.tick % ai.diff.thinkEvery === 0) for (const c of ai.think(snapshot(g, 0))) submit(g, c);
    tick(g);
  }
}

describe('AI-43, AI-44 in a skirmish on Crossroads', () => {
  it('AI-43, AI-44: with no enemy pressure it builds a refinery at its natural field by minute 9 and staffs it', () => {
    const cfg = skirmishConfig(1);
    const g = createGame(cfg);
    const ai = new AI(0, 'human', DIFFICULTIES.hard, cfg.map, 1, 'balanced');
    drive(g, ai, 20 * 60 * 9);
    const natural = shardFields(cfg.map).find((f) => near(f, NATURAL))!;
    const refineries = g.state.buildings.filter((b) => b.owner === 0 && buildingDef(b.kind).refinery);
    const serving = refineries.filter((b) => Math.hypot(b.tx + 1.5 - natural.cx, b.ty + 1 - natural.cy) <= 9);
    expect(serving.length).toBeGreaterThan(0);
    const haulers = g.state.units.filter((u) => u.owner === 0 && unitDef(u.kind).capacity !== undefined);
    // More than the old cap of eight, and some of them on the natural field.
    expect(haulers.length).toBeGreaterThan(8);
    const onNatural = haulers.filter((u) => natural.tiles.some((t) => Math.hypot((t % 96) + 0.5 - u.x / FP, Math.floor(t / 96) + 0.5 - u.y / FP) <= 8));
    expect(onNatural.length).toBeGreaterThanOrEqual(2);
  }, 30000);

  it('AI-44: it does not crawl toward a field with an enemy army on it while a safe one exists', () => {
    const cfg = skirmishConfig(1);
    // Its home field at 22.5,12.5 is all but mined out, so it wants to crawl at once; an enemy army sits on the natural
    // field, watched by one of its rifle squads.
    const home = shardFields(cfg.map).find((f) => near(f, { x: 22.5, y: 12.5 }))!;
    const shards = [...(cfg.map.shards ?? [])];
    for (const t of home.tiles) shards[t] = 100;
    const base = (enemy: boolean): Game =>
      createGame({
        ...cfg,
        map: { ...cfg.map, shards },
        players: [{ faction: 'human', credits: 3000 }, cfg.players![1]!],
        buildings: [
          ...cfg.buildings!,
          { owner: 0, kind: 'hum_refinery', tx: 13, ty: 19 },
          { owner: 0, kind: 'hum_reactor', tx: 6, ty: 6 },
          { owner: 0, kind: 'hum_barracks', tx: 6, ty: 10 },
          { owner: 0, kind: 'hum_factory', tx: 5, ty: 14 },
        ],
        units: [
          ...(cfg.units ?? []),
          { owner: 0, kind: 'hum_rifleman', tx: 32, ty: 13 },
          ...(enemy ? [0, 1, 2, 3].map((i) => ({ owner: 1, kind: 'ali_brute', tx: 36 + i, ty: 14 })) : []),
        ],
      });
    const target = (enemy: boolean): { cx: number; cy: number } | null => {
      const g = base(enemy);
      const ai = new AI(0, 'human', DIFFICULTIES.hard, cfg.map, 1, 'balanced');
      tick(g);
      ai.think(snapshot(g, 0));
      return ai.crawl;
    };
    const quiet = target(false)!;
    expect(near({ tiles: [], cx: quiet.cx, cy: quiet.cy }, NATURAL)).toBe(true);
    const held = target(true)!;
    expect(near({ tiles: [], cx: held.cx, cy: held.cy }, NATURAL)).toBe(false);
    expect(near({ tiles: [], cx: held.cx, cy: held.cy }, CENTRE)).toBe(true);
  });
});
