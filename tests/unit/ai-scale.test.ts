import { describe, expect, it } from 'vitest';
import { AI, DIFFICULTIES, FIELD_INTEL, GROWTH_MAX, GROWTH_SPARE, GUARD_R, RAIDER_OPENING_END, shardFields, type Personality } from '../../src/ai/ai';
import { buildingDef } from '../../src/data/defs';
import { skirmishConfig } from '../../src/data/maps';
import { createGame, EXPLORED, FP, snapshot, submit, tick, VISIBLE, type Command, type Game } from '../../src/sim';

/**
 * Economy and production scale (AI-22), on Crossroads: a human base at the top-left start with power to spare, a
 * barracks, a factory, a lab and a refinery on each home field. The further field nearest it is the big middle field
 * (44 tiles, centre 48,48), far out of placement reach; the next is the field at 61.5,31.5.
 */
type Spawn = { owner: number; kind: string; tx: number; ty: number };
const W = 96;
const MIDDLE = { cx: 48, cy: 48 };
const EAST = { cx: 61.5, cy: 31.5 };

const BASE: Spawn[] = [
  ...[
    [3, 3],
    [5, 3],
    [3, 5],
    [5, 5],
    [3, 7],
    [5, 7],
  ].map(([tx, ty]) => ({ owner: 0, kind: 'hum_reactor', tx: tx!, ty: ty! })),
  { owner: 0, kind: 'hum_barracks', tx: 3, ty: 10 },
  { owner: 0, kind: 'hum_factory', tx: 3, ty: 13 },
  { owner: 0, kind: 'hum_lab', tx: 6, ty: 11 },
  { owner: 0, kind: 'hum_refinery', tx: 11, ty: 20 },
];
/** A reactor out toward the middle field, from which a refinery beside it is in placement reach. */
const FORWARD: Spawn = { owner: 0, kind: 'hum_reactor', tx: 40, ty: 40 };

/** The same thing for the other player, as the mirror image across the map centre (MAP-4). */
const mirror = (s: Spawn): Spawn => {
  const d = buildingDef(s.kind);
  return { owner: 1, kind: s.kind, tx: W - d.w - s.tx, ty: W - d.h - s.ty };
};

interface Scene {
  extra?: Spawn[];
  /** Haulers in all, the one the start gives included. */
  haulers: number;
  credits?: number;
  personality?: Personality;
  /** Both players get the base, as mirror images, and an AI each (human against human). */
  both?: boolean;
  without?: string[];
}

function scene(o: Scene): { g: Game; ais: AI[] } {
  const factions: ['human', 'human'] | ['human', 'alien'] = o.both ? ['human', 'human'] : ['human', 'alien'];
  const cfg = skirmishConfig(3, { factions });
  const own = [...BASE, ...(o.extra ?? [])].filter((s) => !(o.without ?? []).includes(s.kind));
  // The start gives one hauler already.
  const haulers = Array.from({ length: o.haulers - 1 }, (_, i) => ({ owner: 0, kind: 'hum_hauler', tx: 22 + (i % 6), ty: 19 + Math.floor(i / 6) }));
  const g = createGame({
    ...cfg,
    players: [
      { faction: 'human', credits: o.credits ?? 5000 },
      { faction: factions[1], credits: o.credits ?? 5000 },
    ],
    buildings: [...cfg.buildings!, ...own, ...(o.both ? own.map(mirror) : [])],
    units: [...(cfg.units ?? []), ...haulers, ...(o.both ? haulers.map((h) => ({ ...h, owner: 1, tx: W - 1 - h.tx, ty: W - 1 - h.ty })) : [])],
  });
  for (const f of g.state.fog) f.fill(EXPLORED);
  const ais = (o.both ? [0, 1] : [0]).map((p) => new AI(p, 'human', DIFFICULTIES.hard, cfg.map, 3, o.personality ?? 'balanced'));
  return { g, ais };
}

const hqOf = (g: Game, p = 0) => g.state.buildings.find((b) => b.owner === p && b.kind === 'hum_hq')!;
const structuresOrdered = (g: Game, cmds: Command[], p = 0): string[] => cmds.flatMap((c) => (c.type === 'produce' && c.source === hqOf(g, p).id ? [c.kind] : []));
/** Puts a finished `kind` at the head of the HQ queue, ready to place. */
const ready = (g: Game, kind: string, p = 0): void => {
  hqOf(g, p).queue = [{ kind, cost: buildingDef(kind).cost, progress: 1000, total: 1000, ready: true }];
};
const placed = (cmds: Command[]): { tx: number; ty: number } | undefined => {
  const c = cmds.find((x) => x.type === 'place');
  return c && c.type === 'place' ? { tx: c.tx, ty: c.ty } : undefined;
};
const centreOf = (kind: string, s: { tx: number; ty: number }): [number, number] => [s.tx + buildingDef(kind).w / 2, s.ty + buildingDef(kind).h / 2];
/** Distance from a point to the nearest shard tile of the field centred at `f`. */
const gapTo = (g: Game, f: { cx: number; cy: number }, x: number, y: number): number => {
  const field = shardFields(g.state.cfg.map).find((s) => Math.abs(s.cx - f.cx) < 0.6 && Math.abs(s.cy - f.cy) < 0.6)!;
  return Math.min(...field.tiles.map((t) => Math.hypot((t % W) + 0.5 - x, Math.floor(t / W) + 0.5 - y)));
};
const nearestBuilding = (g: Game, f: { cx: number; cy: number }, p = 0): number =>
  Math.min(...g.state.buildings.filter((b) => b.owner === p).map((b) => gapTo(g, f, ...centreOf(b.kind, b))));

/** Steps of the crawl toward the middle field, for one or both players: where each ready reactor went, until a refinery is wanted. */
function crawl(both: boolean): { steps: { tx: number; ty: number }[][]; refinery: ({ tx: number; ty: number } | undefined)[]; g: Game } {
  const { g, ais } = scene({ haulers: 5, both });
  const steps: { tx: number; ty: number }[][] = ais.map(() => []);
  const refinery: ({ tx: number; ty: number } | undefined)[] = [];
  for (let i = 0; i < 10; i++) {
    const wants = ais.map((ai) => structuresOrdered(g, ai.think(snapshot(g, ai.player)), ai.player));
    if (wants.every((w) => w.includes('hum_refinery'))) {
      for (const ai of ais) ready(g, 'hum_refinery', ai.player);
      const cmds = ais.map((ai) => ai.think(snapshot(g, ai.player)));
      for (const c of cmds) refinery.push(placed(c));
      break;
    }
    for (const ai of ais) ready(g, 'hum_reactor', ai.player);
    const cmds = ais.map((ai) => ai.think(snapshot(g, ai.player)));
    for (const [p, c] of cmds.entries()) {
      const at = placed(c);
      expect(at, `step ${i} of player ${p}`).toBeDefined();
      steps[p]!.push(at!);
      for (const x of c) if (x.type === 'place') submit(g, x);
    }
    tick(g);
    for (const f of g.state.fog) f.fill(EXPLORED);
  }
  return { steps, refinery, g };
}

describe('further fields (AI-22)', () => {
  it('AI-22: takes a third field once both home fields have a refinery and it has five haulers, not before', () => {
    const want = (haulers: number, extra: Spawn[] = [FORWARD], without: string[] = []): string[] => {
      const { g, ais } = scene({ haulers, extra, without });
      return structuresOrdered(g, ais[0]!.think(snapshot(g, 0)));
    };
    expect(want(5)).toEqual(['hum_refinery']);
    expect(want(4)).not.toContain('hum_refinery');
    // With one home field still without a refinery, the refinery goes there (AI-18), not to the middle field.
    const { g, ais } = scene({ haulers: 5, extra: [FORWARD], without: ['hum_refinery'] });
    expect(structuresOrdered(g, ais[0]!.think(snapshot(g, 0)))).toEqual(['hum_refinery']);
    ready(g, 'hum_refinery');
    const home = placed(ais[0]!.think(snapshot(g, 0)))!;
    expect(Math.hypot(...centreOf('hum_refinery', home).map((v, i) => v - [12.5, 24.5][i]!) as [number, number])).toBeLessThanOrEqual(9);
    // Both home fields served: the refinery goes beside the middle field.
    const s = scene({ haulers: 5, extra: [FORWARD] });
    ready(s.g, 'hum_refinery');
    const mid = placed(s.ais[0]!.think(snapshot(s.g, 0)))!;
    expect(Math.hypot(centreOf('hum_refinery', mid)[0] - MIDDLE.cx, centreOf('hum_refinery', mid)[1] - MIDDLE.cy)).toBeLessThanOrEqual(9);
  });

  it('AI-22: skips a field with an enemy army seen on it in the last minute, and takes it again once the sighting is older', () => {
    const step = (enemies: boolean, later = 0): { tx: number; ty: number } => {
      const { g, ais } = scene({ haulers: 5 });
      const ai = ais[0]!;
      if (enemies) {
        g.state.units.push(...[0, 1, 2].map((i) => ({ ...g.state.units.find((u) => u.owner === 1)!, id: 9000 + i, kind: 'ali_brute', x: (47 + i) * FP + FP / 2, y: 48 * FP + FP / 2, hp: 760 })));
        for (const f of g.state.fog) f.fill(EXPLORED | VISIBLE);
        ai.think(snapshot(g, 0));
        for (const f of g.state.fog) f.fill(EXPLORED);
        g.state.tick += later;
      }
      ready(g, 'hum_reactor');
      return placed(ai.think(snapshot(g, 0)))!;
    };
    const free = step(false);
    const seen = step(true, FIELD_INTEL / 2);
    const old = step(true, FIELD_INTEL + 20);
    // Unhindered, the step goes toward the middle field; with an army seen on it lately, toward the next field instead.
    expect(gapTo2(free, MIDDLE)).toBeLessThan(gapTo2(free, EAST));
    expect(gapTo2(seen, EAST)).toBeLessThan(gapTo2(free, EAST));
    expect(old).toEqual(free);
  });

  it('AI-22: builds toward a field out of reach, one step at a time, and places the refinery beside it once in reach', () => {
    const { steps, refinery, g } = crawl(false);
    const mine = steps[0]!;
    expect(mine.length).toBeGreaterThanOrEqual(2);
    // Every step nearer the field, never on shards.
    let before = Infinity;
    for (const s of mine) {
      const d = gapTo(g, MIDDLE, ...centreOf('hum_reactor', s));
      expect(d).toBeLessThan(before);
      before = d;
      for (let y = s.ty; y < s.ty + 2; y++) for (let x = s.tx; x < s.tx + 2; x++) expect(g.state.shards[y * W + x]).toBe(0);
    }
    // From nearly forty tiles out to placement reach of the field.
    expect(nearestBuilding(g, MIDDLE)).toBeLessThan(20);
    const r = refinery[0]!;
    expect(r).toBeDefined();
    const [rx, ry] = centreOf('hum_refinery', r);
    expect(Math.hypot(rx - MIDDLE.cx, ry - MIDDLE.cy)).toBeLessThanOrEqual(9);
  });

  it('AI-22: placement stays mirror-symmetric for the two players on a symmetric map (MAP-4)', () => {
    const { steps, refinery } = crawl(true);
    expect(steps[0]!.length).toBeGreaterThanOrEqual(2);
    expect(steps[1]!.length).toBe(steps[0]!.length);
    for (const [i, s] of steps[0]!.entries()) expect(steps[1]![i]).toEqual({ tx: W - 2 - s.tx, ty: W - 2 - s.ty });
    expect(refinery[1]).toEqual({ tx: W - 3 - refinery[0]!.tx, ty: W - 2 - refinery[0]!.ty });
  });

  it('AI-22: stops building toward a field while an enemy army is seen on the way', () => {
    const { g, ais } = scene({ haulers: 5 });
    g.state.units.push(...[0, 1, 2].map((i) => ({ ...g.state.units.find((u) => u.owner === 1)!, id: 9100 + i, kind: 'ali_brute', x: (32 + i) * FP + FP / 2, y: 32 * FP + FP / 2, hp: 760 })));
    for (const f of g.state.fog) f.fill(EXPLORED | VISIBLE);
    ready(g, 'hum_reactor');
    const at = placed(ais[0]!.think(snapshot(g, 0)))!;
    // The compact base: no nearer the middle field than the buildings it has.
    expect(gapTo(g, MIDDLE, ...centreOf('hum_reactor', at))).toBeGreaterThanOrEqual(nearestBuilding(g, MIDDLE) - 2);
  });

  it('AI-22: keeps a turret by each refinery outside its base', () => {
    const outpost: Spawn = { owner: 0, kind: 'hum_refinery', tx: 41, ty: 46 };
    const want = (extra: Spawn[]): { g: Game; ai: AI; kinds: string[] } => {
      const { g, ais } = scene({ haulers: 4, extra: [...extra, { owner: 0, kind: 'hum_lance', tx: 7, ty: 17 }], credits: 1000 });
      return { g, ai: ais[0]!, kinds: structuresOrdered(g, ais[0]!.think(snapshot(g, 0))) };
    };
    expect(want([FORWARD, outpost]).kinds).toEqual(['hum_turret']);
    expect(want([FORWARD]).kinds).not.toContain('hum_turret');
    const { g, ai } = want([FORWARD, outpost]);
    ready(g, 'hum_turret');
    const t = placed(ai.think(snapshot(g, 0)))!;
    const [x, y] = centreOf('hum_turret', t);
    const dx = Math.max(outpost.tx - x, 0, x - (outpost.tx + 3));
    const dy = Math.max(outpost.ty - y, 0, y - (outpost.ty + 2));
    expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(GUARD_R);
    // With its turret, it wants none.
    expect(want([FORWARD, outpost, { owner: 0, kind: 'hum_turret', tx: 44, ty: 44 }]).kinds).not.toContain('hum_turret');
  });
});

/** Distance from a placed reactor's centre to a field centre. */
const gapTo2 = (s: { tx: number; ty: number }, f: { cx: number; cy: number }): number => Math.hypot(s.tx + 1 - f.cx, s.ty + 1 - f.cy);

describe('haulers and production (AI-22)', () => {
  const haulerOrdered = (haulers: number, extra: Spawn[] = []): boolean => {
    const { g, ais } = scene({ haulers, extra: [{ owner: 0, kind: 'hum_lance', tx: 7, ty: 17 }, ...extra] });
    const factory = g.state.buildings.find((b) => b.owner === 0 && b.kind === 'hum_factory')!;
    return ais[0]!.think(snapshot(g, 0)).some((c) => c.type === 'produce' && c.source === factory.id && c.kind === 'hum_hauler');
  };

  it('AI-22: three haulers for each refinery, four at a field of more than thirty tiles, beyond eight in total', () => {
    // Two home refineries on 21-tile fields: six.
    expect(haulerOrdered(5)).toBe(true);
    expect(haulerOrdered(6)).toBe(false);
    // And one beside the 44-tile middle field: ten, past the old cap of eight.
    const mid: Spawn[] = [FORWARD, { owner: 0, kind: 'hum_refinery', tx: 41, ty: 46 }];
    expect(haulerOrdered(9, mid)).toBe(true);
    expect(haulerOrdered(10, mid)).toBe(false);
  });

  const growth = (o: { barracks: number; factories: number; busy: ('hum_barracks' | 'hum_factory')[]; credits: number }): string[] => {
    const extra: Spawn[] = [{ owner: 0, kind: 'hum_lance', tx: 7, ty: 17 }];
    for (let i = 1; i < o.barracks; i++) extra.push({ owner: 0, kind: 'hum_barracks', tx: 1 + 3 * (i - 1), ty: 0 });
    for (let i = 1; i < o.factories; i++) extra.push({ owner: 0, kind: 'hum_factory', tx: 1 + 4 * (i - 1), ty: 30 });
    const { g, ais } = scene({ haulers: 4, extra, credits: o.credits });
    for (const b of g.state.buildings) if (b.owner === 0 && o.busy.includes(b.kind as 'hum_barracks')) b.queue = [{ kind: 'hum_rifleman', cost: 100, progress: 0, total: 240, ready: false }];
    return structuresOrdered(g, ais[0]!.think(snapshot(g, 0)));
  };

  it('AI-22: adds a barracks or factory when every one is busy and it can pay with 500 to spare; not otherwise, never beyond five', () => {
    const both: ('hum_barracks' | 'hum_factory')[] = ['hum_barracks', 'hum_factory'];
    const fc = buildingDef('hum_factory').cost + GROWTH_SPARE;
    const bc = buildingDef('hum_barracks').cost + GROWTH_SPARE;
    expect(growth({ barracks: 1, factories: 1, busy: both, credits: fc })).toEqual(['hum_factory']);
    expect(growth({ barracks: 1, factories: 1, busy: both, credits: fc - 1 })).toEqual(['hum_barracks']);
    expect(growth({ barracks: 1, factories: 1, busy: both, credits: bc - 1 })).toEqual([]);
    // One idle: only the other kind grows.
    expect(growth({ barracks: 1, factories: 1, busy: ['hum_barracks'], credits: fc })).toEqual(['hum_barracks']);
    expect(growth({ barracks: 1, factories: 1, busy: [], credits: fc })).toEqual([]);
    // Never beyond five of each.
    const five = growth({ barracks: GROWTH_MAX, factories: GROWTH_MAX, busy: both, credits: 1700 });
    expect(five).not.toContain('hum_barracks');
    expect(five).not.toContain('hum_factory');
    expect(growth({ barracks: GROWTH_MAX, factories: GROWTH_MAX - 1, busy: both, credits: 1700 })).toEqual(['hum_factory']);
  });

  it('AI-22: Doomsday still builds its lab and second factory first (AI-15)', () => {
    const first = (personality: Personality, without: string[], credits: number): string[] => {
      const { g, ais } = scene({ haulers: 5, extra: [FORWARD], personality, without, credits });
      return structuresOrdered(g, ais[0]!.think(snapshot(g, 0)));
    };
    expect(first('doomsday', ['hum_lab'], 5000)).toEqual(['hum_lab']);
    expect(first('doomsday', [], 1500)).toEqual(['hum_factory']);
    expect(first('balanced', [], 1500)).toEqual(['hum_refinery']);
  });

  it('AI-22: Raider takes no further field during its opening (AI-14, AI-16)', () => {
    const order = (tickAt: number): string[] => {
      // Two turrets, as many as its build order wants by then.
      const turrets: Spawn[] = [{ owner: 0, kind: 'hum_turret', tx: 8, ty: 3 }, { owner: 0, kind: 'hum_turret', tx: 8, ty: 6 }];
      const { g, ais } = scene({ haulers: 5, extra: [FORWARD, ...turrets], personality: 'raider', credits: 1000 });
      g.state.tick = tickAt;
      return structuresOrdered(g, ais[0]!.think(snapshot(g, 0)));
    };
    expect(order(0)).not.toContain('hum_refinery');
    expect(order(RAIDER_OPENING_END)).toEqual(['hum_refinery']);
  });
});
