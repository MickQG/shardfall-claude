import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI, DIFFICULTIES, PERSONALITIES, resolvePersonality } from '../../src/ai/ai';
import { playMatch } from '../../src/ai/harness';
import { kitOf } from '../../src/ai/kit';
import { crusherOf, rifleOf, STEAMROLL_DIFFICULTY, STEAMROLL_MASS, STEAMROLL_OPENING_CRUSHERS, STEAMROLL_TUNING, SteamrollAI } from '../../src/ai/steamroll';
import { UNIT_DEFS, unitDef, type Faction } from '../../src/data/defs';
import { skirmishConfig } from '../../src/data/maps';
import { createGame, snapshot, submit, tick, type Command, type Game } from '../../src/sim';

const LONG = 600_000;
const FACTIONS = ['human', 'alien'] as const;
const heroOf = (f: Faction): string => (f === 'human' ? 'hum_paladin' : 'ali_strider');

/**
 * Player 0's base on seed 6 with a barracks, two factories (or `factories`) and a lab already standing (and three refineries, power to spare), plus
 * any extra units of its own, next to its HQ.
 */
function builtBase(faction: Faction, credits: number, extra: { kind: string; dx: number; dy: number }[] = [], factories = 2): { g: Game; map: ReturnType<typeof skirmishConfig>['map'] } {
  const cfg = skirmishConfig(6, { factions: faction === 'human' ? ['human', 'alien'] : ['alien', 'human'] });
  const k = kitOf(faction);
  const hq = cfg.buildings!.find((b) => b.owner === 0 && b.kind === k.hq)!;
  const at = (kind: string, dx: number, dy: number) => ({ owner: 0, kind, tx: hq.tx + dx, ty: hq.ty + dy });
  const power = [[4, 0], [6, 0], [4, 2], [6, 2], [8, 0], [8, 2]].map(([x, y]) => at(k.power, x!, y!));
  const g = createGame({
    ...cfg,
    players: [{ faction, credits }, cfg.players![1]!],
    buildings: [...cfg.buildings!, ...power, at(k.barracks, 0, 4), at(k.factory, 3, 4), ...(factories > 1 ? [at(k.factory, 3, 8)] : []), at(k.lab, 7, 4), at(k.refinery, 7, 8), at(k.refinery, 11, 8)],
    units: [...(cfg.units ?? []), ...extra.map((u) => ({ owner: 0, kind: u.kind, tx: hq.tx + u.dx, ty: hq.ty + u.dy }))],
  });
  return { g, map: cfg.map };
}

/** Let one AI play on its cadence for `ticks` (its opponent idles); returns what it ordered. */
function drive(g: Game, ai: AI, ticks: number, each?: () => void): Command[] {
  const log: Command[] = [];
  for (let i = 0; i < ticks; i++) {
    if (g.state.tick % ai.diff.thinkEvery === 0) {
      for (const c of ai.think(snapshot(g, ai.player))) {
        submit(g, c);
        log.push(c);
      }
      each?.();
    }
    tick(g);
  }
  return log;
}

const isUnit = (kind: string): boolean => kind in UNIT_DEFS;
const produced = (cmds: readonly Command[]): string[] => cmds.flatMap((c) => (c.type === 'produce' ? [c.kind] : []));

describe('the steamroll opponent', () => {
  it('HAR-5: is not a personality: Random never draws it, the menu does not offer it, and it plays at Hard speed', () => {
    expect(PERSONALITIES as readonly string[]).not.toContain('steamroll');
    for (let seed = 0; seed < 2000; seed++) {
      for (const choice of ['random', null, 'steamroll', 'Steamroll']) {
        const p: string = resolvePersonality(choice, seed);
        expect(p).not.toBe('steamroll');
        expect(PERSONALITIES as readonly string[]).toContain(p);
      }
    }
    // Nothing in the user interface names it.
    const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
    for (const f of files('src/ui')) expect(readFileSync(f, 'utf8').toLowerCase(), f).not.toContain('steamroll');
    expect(STEAMROLL_DIFFICULTY.thinkEvery).toBe(DIFFICULTIES.hard.thinkEvery);
    expect(STEAMROLL_DIFFICULTY.maxCommands).toBe(DIFFICULTIES.hard.maxCommands);
    expect(STEAMROLL_TUNING).toEqual({ opening: true, spend: true, mass: STEAMROLL_MASS, bonus: STEAMROLL_DIFFICULTY.bonus });
    expect(crusherOf('human')).toBe('hum_tank');
    expect(crusherOf('alien')).toBe('ali_brute');
    expect(rifleOf('human')).toBe('hum_rifleman');
    expect(rifleOf('alien')).toBe('ali_skitter');
  });

  it('HAR-5: with a barracks, factory and lab standing it orders rifle squads only until its first four crushers stand, then only crushers, haulers and its hero', () => {
    for (const faction of FACTIONS) {
      const k = kitOf(faction);
      const allowed = new Set([crusherOf(faction), k.hauler, heroOf(faction)]);
      // Its eight haulers are all there (three refineries), so both factories train combat units.
      const haulers = [...Array(8)].map((_, i) => ({ kind: k.hauler, dx: 10 + i, dy: 15 }));
      // No crushers yet: rifle squads from the barracks, for home defence.
      const opening = builtBase(faction, 20000, haulers);
      const first = produced(new SteamrollAI(0, faction, opening.map, 6).think(snapshot(opening.g, 0))).filter(isUnit);
      expect(first, faction).toContain(rifleOf(faction));
      for (const u of first) expect(allowed.has(u) || u === rifleOf(faction), `${faction}: ${u}`).toBe(true);
      // Four crushers: no more infantry, even once they are gone.
      const crushers = [...Array(STEAMROLL_OPENING_CRUSHERS)].map((_, i) => ({ kind: crusherOf(faction), dx: 10 + 2 * i, dy: 18 }));
      const { g, map } = builtBase(faction, 20000, [...haulers, ...crushers]);
      const ai = new SteamrollAI(0, faction, map, 6);
      const cmds = ai.think(snapshot(g, 0));
      expect(ai.massed, faction).toBe(true);
      const units = produced(cmds).filter(isUnit);
      for (const u of units) expect(allowed.has(u), `${faction}: ${u}`).toBe(true);
      expect(units, faction).toContain(crusherOf(faction));
      expect(units, faction).toContain(heroOf(faction));
      g.state.units = g.state.units.filter((u) => u.kind !== crusherOf(faction));
      expect(produced(ai.think(snapshot(g, 0))), faction).not.toContain(rifleOf(faction));
      // The ordinary AI on the same base trains from its barracks as well.
      const plain = produced(new AI(0, faction, DIFFICULTIES.hard, map, 6).think(snapshot(builtBase(faction, 20000, haulers).g, 0)));
      expect(plain.some((kind) => isUnit(kind) && !allowed.has(kind)), faction).toBe(true);
    }
  });

  it('HAR-5: adds a factory where the AI adds a second barracks', () => {
    for (const faction of FACTIONS) {
      const k = kitOf(faction);
      const { g, map } = builtBase(faction, 2000);
      // The AI adds a barracks once its barracks is busy (AI-22).
      const barracks = g.state.buildings.find((b) => b.owner === 0 && b.kind === k.barracks)!;
      barracks.queue = [{ kind: rifleOf(faction), cost: unitDef(rifleOf(faction)).cost, progress: 0, total: 1000, ready: false }];
      expect(produced(new AI(0, faction, DIFFICULTIES.hard, map, 6).think(snapshot(g, 0))), faction).toContain(k.barracks);
      barracks.queue = [];
      const steam = produced(new SteamrollAI(0, faction, map, 6).think(snapshot(g, 0)));
      expect(steam, faction).toContain(k.factory);
      expect(steam, faction).not.toContain(k.barracks);
    }
  });

  it('HAR-5: adds its second factory straight after the first, where the AI does not', () => {
    for (const faction of FACTIONS) {
      const k = kitOf(faction);
      const { g, map } = builtBase(faction, 1000, [], 1);
      expect(produced(new AI(0, faction, DIFFICULTIES.hard, map, 6).think(snapshot(g, 0))), faction).not.toContain(k.factory);
      expect(produced(new SteamrollAI(0, faction, map, 6).think(snapshot(g, 0))), faction).toContain(k.factory);
    }
  });

  it('HAR-5: over a rich game it never orders a superweapon or a second barracks, and trains only crushers, haulers, its hero and opening rifles', () => {
    for (const faction of FACTIONS) {
      const k = kitOf(faction);
      const allowed = new Set([crusherOf(faction), k.hauler, heroOf(faction), rifleOf(faction)]);
      const cfg = skirmishConfig(4, { factions: faction === 'human' ? ['human', 'alien'] : ['alien', 'human'], credits: 30000 });
      const g = createGame(cfg);
      const ai = new SteamrollAI(0, faction, cfg.map, 4);
      const kinds = produced(drive(g, ai, 9000));
      expect(kinds.filter((x) => x === k.superweapon), faction).toEqual([]);
      expect(kinds.filter((x) => x === k.barracks).length, faction).toBe(1);
      expect(kinds, faction).toContain(k.lab);
      expect(kinds.filter((x) => x === k.factory).length, faction).toBeGreaterThanOrEqual(2);
      const units = kinds.filter(isUnit);
      for (const u of units) expect(allowed.has(u), `${faction}: ${u}`).toBe(true);
      expect(units, faction).toContain(heroOf(faction));
      expect(ai.stats.produced.at + ai.stats.produced.art + ai.stats.produced.air + ai.stats.produced.scout, faction).toBe(0);
      expect(ai.stats.steamroll?.massedAt, faction).toBeGreaterThan(0);
      expect(ai.stats.steamroll?.infantryAfter, faction).toBe(0);
      expect(ai.stats.produced.tank, faction).toBeGreaterThan(0);
    }
  }, LONG);

  it('HAR-5: does not pull back a beaten wave where the ordinary AI does', () => {
    const run = (make: (map: ReturnType<typeof skirmishConfig>['map']) => AI): AI => {
      const tanks = [...Array(8)].map((_, i) => ({ kind: 'hum_tank', dx: 5 + (i % 4), dy: 11 + Math.floor(i / 4) }));
      const { g, map } = builtBase('human', 0, tanks);
      // Long enough without a wave that the AI attacks on what it knows of the map (its stalemate rule, AI-11).
      g.state.tick = 7200;
      const ai = make(map);
      let hurt = -1;
      drive(g, ai, 1500, () => {
        if (hurt < 0 && ai.stats.waves > 0) {
          hurt = g.state.tick;
          // The wave is cut to a third of its strength, nothing in sight.
          for (const u of g.state.units) if (u.owner === 0 && u.kind === 'hum_tank') u.hp = Math.floor(unitDef(u.kind).hp / 3);
        }
      });
      expect(hurt).toBeGreaterThan(0);
      return ai;
    };
    const plain = run((map) => new AI(0, 'human', STEAMROLL_DIFFICULTY, map, 6));
    expect(plain.stats.retreats).toBeGreaterThan(0);
    const steam = run((map) => new SteamrollAI(0, 'human', map, 6));
    expect(steam.stats.waves).toBeGreaterThan(0);
    expect(steam.stats.retreats).toBe(0);
  }, LONG);

  it('HAR-5: waits for a mass of crushers before a wave, where the ordinary AI sets out with fewer', () => {
    const run = (make: (map: ReturnType<typeof skirmishConfig>['map']) => AI): AI => {
      const tanks = [...Array(STEAMROLL_MASS - 1)].map((_, i) => ({ kind: 'hum_tank', dx: 5 + (i % 4), dy: 11 + Math.floor(i / 4) }));
      const { g, map } = builtBase('human', 0, tanks);
      // Long enough without a wave that the AI attacks on what it knows of the map (its stalemate rule, AI-11).
      g.state.tick = 7200;
      const ai = make(map);
      drive(g, ai, 1200);
      return ai;
    };
    expect(run((map) => new AI(0, 'human', STEAMROLL_DIFFICULTY, map, 6)).stats.waves).toBeGreaterThan(0);
    const steam = run((map) => new SteamrollAI(0, 'human', map, 6));
    expect(steam.stats.produced.tank).toBe(0);
    expect(steam.stats.waves).toBe(0);
  }, LONG);

  it('HAR-5: a match against it is the same game from the same seeds and settings, and the AIs of other matches are unchanged', () => {
    const o = { seed: 2, factions: ['alien', 'human'] as [Faction, Faction], difficulties: [DIFFICULTIES.hard, STEAMROLL_DIFFICULTY] as [typeof DIFFICULTIES.hard, typeof STEAMROLL_DIFFICULTY], maxTicks: 4000 };
    const a = playMatch({ ...o, opponents: ['ai', 'steamroll'] });
    const b = playMatch({ ...o, opponents: ['ai', 'steamroll'] });
    expect(a.hash).toBe(b.hash);
    expect(a.ai).toEqual(b.ai);
    expect(a.ai[1].retreats).toBe(0);
    // Saying 'ai' for both seats is the default match.
    const plain = { ...o, difficulties: [DIFFICULTIES.hard, DIFFICULTIES.hard] as [typeof DIFFICULTIES.hard, typeof DIFFICULTIES.hard] };
    expect(playMatch({ ...plain, opponents: ['ai', 'ai'] }).hash).toBe(playMatch(plain).hash);
  }, LONG);
});
