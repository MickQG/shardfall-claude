import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI, DIFFICULTIES, PERSONALITIES, resolvePersonality, shardFields } from '../../src/ai/ai';
import { playMatch } from '../../src/ai/harness';
import { kitOf } from '../../src/ai/kit';
import { antiArmourOf, crusherOf, rifleOf, STEAMROLL_DIFFICULTY, STEAMROLL_TUNING, SteamrollAI, type SteamrollTuning } from '../../src/ai/steamroll';
import { buildingDef, UNIT_DEFS, unitDef, type Faction } from '../../src/data/defs';
import { skirmishConfig } from '../../src/data/maps';
import { createGame, snapshot, submit, tick, type Command, type Game } from '../../src/sim';

const LONG = 600_000;
const FACTIONS = ['human', 'alien'] as const;
/** It stays home whatever its army: for watching its build and economy. */
const HOME: Partial<SteamrollTuning> = { launch: Infinity };

/**
 * Player 0's base on seed 6 with a barracks, a factory and power to spare, plus any extra units of its own, next to its
 * HQ.
 */
function builtBase(faction: Faction, credits: number, extra: { kind: string; dx: number; dy: number }[] = []): { g: Game; map: ReturnType<typeof skirmishConfig>['map'] } {
  const cfg = skirmishConfig(6, { factions: faction === 'human' ? ['human', 'alien'] : ['alien', 'human'] });
  const k = kitOf(faction);
  const hq = cfg.buildings!.find((b) => b.owner === 0 && b.kind === k.hq)!;
  const at = (kind: string, dx: number, dy: number) => ({ owner: 0, kind, tx: hq.tx + dx, ty: hq.ty + dy });
  const power = [[4, 0], [6, 0], [4, 2], [6, 2]].map(([x, y]) => at(k.power, x!, y!));
  const g = createGame({
    ...cfg,
    players: [{ faction, credits }, cfg.players![1]!],
    buildings: [...cfg.buildings!, ...power, at(k.barracks, 0, 4), at(k.factory, 3, 4), at(k.refinery, 7, 8)],
    units: [...(cfg.units ?? []), ...extra.map((u) => ({ owner: 0, kind: u.kind, tx: hq.tx + u.dx, ty: hq.ty + u.dy }))],
  });
  return { g, map: cfg.map };
}

/** A fresh skirmish on Crossroads (seed 1) with player 0's faction; its opponent idles. */
function fresh(faction: Faction, credits?: number): { g: Game; map: ReturnType<typeof skirmishConfig>['map'] } {
  const cfg = skirmishConfig(1, { factions: faction === 'human' ? ['human', 'alien'] : ['alien', 'human'], credits });
  return { g: createGame(cfg), map: cfg.map };
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
  it('HAR-5: is not a personality: Random never draws it, the menu does not offer it, and it plays at Hard speed with no bonus', () => {
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
    expect(STEAMROLL_TUNING.bonus).toBe(0);
    expect(STEAMROLL_TUNING.antiArmour).toBeCloseTo(0.55);
    expect(crusherOf('human')).toBe('hum_tank');
    expect(crusherOf('alien')).toBe('ali_brute');
    expect(rifleOf('human')).toBe('hum_rifleman');
    expect(rifleOf('alien')).toBe('ali_skitter');
    expect(antiArmourOf('human')).toBe('hum_rocketeer');
    expect(antiArmourOf('alien')).toBe('ali_spitter');
  });

  it('HAR-5: opens with a refinery, a barracks training rifle squads, then a factory whose first unit is a crusher and next two are haulers', () => {
    for (const faction of FACTIONS) {
      const k = kitOf(faction);
      const { g, map } = fresh(faction);
      const ai = new SteamrollAI(0, faction, map, 1, { ...STEAMROLL_TUNING, ...HOME });
      const cmds = drive(g, ai, 4000);
      const hq = g.state.buildings.find((b) => b.owner === 0 && b.kind === k.hq)!;
      const structures = cmds.flatMap((c) => (c.type === 'produce' && c.source === hq.id ? [c.kind] : []));
      // Power whenever it runs short; otherwise refinery, barracks, factory, in that order.
      expect(structures.filter((x) => x !== k.power).slice(0, 3), faction).toEqual([k.refinery, k.barracks, k.factory]);
      const units = produced(cmds).filter(isUnit);
      const firstFactoryUnit = units.findIndex((u) => unitDef(u).builtAt === k.factory);
      // Before its factory, its barracks trains rifle squads only.
      expect(new Set(units.slice(0, firstFactoryUnit)), faction).toEqual(new Set([rifleOf(faction)]));
      expect(units.filter((u) => unitDef(u).builtAt === k.factory).slice(0, 3), faction).toEqual([crusherOf(faction), k.hauler, k.hauler]);
    }
  }, LONG);

  it('HAR-5: trains only rifle squads, anti-armour squads, crushers and haulers, about 55% anti-armour from its barracks once it has a factory', () => {
    for (const faction of FACTIONS) {
      const k = kitOf(faction);
      const { g, map } = fresh(faction);
      const ai = new SteamrollAI(0, faction, map, 1, { ...STEAMROLL_TUNING, ...HOME });
      const units = produced(drive(g, ai, 7200)).filter(isUnit);
      expect(new Set(units), faction).toEqual(new Set([rifleOf(faction), antiArmourOf(faction), crusherOf(faction), k.hauler]));
      const squads = units.slice(units.indexOf(antiArmourOf(faction))).filter((u) => u === rifleOf(faction) || u === antiArmourOf(faction));
      const share = squads.filter((u) => u === antiArmourOf(faction)).length / squads.length;
      expect(squads.length, faction).toBeGreaterThan(30);
      expect(share, faction).toBeGreaterThan(0.5);
      expect(share, faction).toBeLessThan(0.6);
      expect(ai.stats.produced.tank, faction).toBeGreaterThan(5);
    }
  }, LONG);

  it('HAR-5: grows to several barracks and factories instead of hoarding credits, and never builds a lab, turret or superweapon, or trains its hero', () => {
    for (const faction of FACTIONS) {
      const k = kitOf(faction);
      // Rich: it can afford everything, so only its rules hold it back.
      const { g, map } = fresh(faction, 30000);
      const ai = new SteamrollAI(0, faction, map, 1, { ...STEAMROLL_TUNING, ...HOME });
      const kinds = produced(drive(g, ai, 9000));
      for (const x of [k.lab, k.turret, k.superweapon]) expect(kinds, faction).not.toContain(x);
      expect(ai.stats.produced.hero + ai.stats.produced.art + ai.stats.produced.air + ai.stats.produced.scout, faction).toBe(0);
      const sr = ai.stats.steamroll!;
      expect(sr.peakBarracks, faction).toBe(STEAMROLL_TUNING.barracks);
      expect(sr.peakFactories, faction).toBe(STEAMROLL_TUNING.factories);

      // At the starting credits it adds barracks and factories as money allows, and does not sit on its credits.
      const plain = fresh(faction);
      const steady = new SteamrollAI(0, faction, plain.map, 1, { ...STEAMROLL_TUNING, ...HOME });
      const credits: number[] = [];
      drive(plain.g, steady, 7200, () => {
        if (plain.g.state.tick % 1200 < steady.diff.thinkEvery && plain.g.state.tick >= 2400) credits.push(plain.g.state.players[0]!.credits);
      });
      expect(steady.stats.steamroll!.peakBarracks + steady.stats.steamroll!.peakFactories, faction).toBeGreaterThanOrEqual(6);
      for (const c of credits) expect(c, faction).toBeLessThan(3500);
    }
  }, LONG);

  it('HAR-5: mines three fields, crawling with its buildings to the one beyond normal placement range, with more than eight haulers', () => {
    for (const faction of FACTIONS) {
      const { g, map } = fresh(faction);
      const ai = new SteamrollAI(0, faction, map, 1, { ...STEAMROLL_TUNING, ...HOME });
      drive(g, ai, 7200);
      const sr = ai.stats.steamroll!;
      expect(sr.peakRefineries, faction).toBe(3);
      expect(sr.peakHaulers, faction).toBeGreaterThan(8);
      // Its third refinery is at Crossroads' middle field, far beyond where the AI places refineries (24 tiles from its HQ).
      const hq = g.state.buildings.find((b) => b.owner === 0 && buildingDef(b.kind).hq)!;
      const middle = shardFields(map).find((f) => f.tiles.length > 30)!;
      const refinery = g.state.buildings.find((b) => b.owner === 0 && buildingDef(b.kind).refinery && Math.hypot(b.tx + 1.5 - middle.cx, b.ty + 1 - middle.cy) <= 9);
      expect(refinery, faction).toBeDefined();
      expect(Math.hypot(refinery!.tx - hq.tx, refinery!.ty - hq.ty), faction).toBeGreaterThan(30);
      // The ordinary AI stops at eight haulers.
      const plain = fresh(faction);
      const other = new AI(0, faction, DIFFICULTIES.hard, plain.map, 1);
      let most = 0;
      drive(plain.g, other, 7200, () => (most = Math.max(most, plain.g.state.units.filter((u) => u.owner === 0 && u.kind === kitOf(faction).hauler).length)));
      expect(most, faction).toBeLessThanOrEqual(8);
    }
  }, LONG);

  it('HAR-5: launches no attack below its launch size, and one with its whole army above it', () => {
    const tanks = [...Array(8)].map((_, i) => ({ kind: 'hum_tank', dx: 5 + (i % 4), dy: 11 + Math.floor(i / 4) }));
    // The tanks and the three starting rifle squads: 8 * 800 + 3 * 100 credits.
    const run = (tuning: Partial<SteamrollTuning>): { ai: SteamrollAI; cmds: Command[]; army: number[] } => {
      const { g, map } = builtBase('human', 0, tanks);
      // No hauler, so no income: the army stays as it is.
      g.state.units = g.state.units.filter((u) => u.owner !== 0 || unitDef(u.kind).capacity === undefined);
      const ai = new SteamrollAI(0, 'human', map, 6, { ...STEAMROLL_TUNING, ...tuning });
      const army = g.state.units.filter((u) => u.owner === 0 && unitDef(u.kind).weapon && unitDef(u.kind).capacity === undefined).map((u) => u.id);
      return { ai, cmds: drive(g, ai, 2000), army };
    };
    expect(run({ launch: 6800, crushers: 6 }).ai.stats.waves).toBe(0);
    expect(run({ launch: 6000, crushers: 9 }).ai.stats.waves).toBe(0);
    const { ai, cmds, army } = run({ launch: 6000, crushers: 8 });
    expect(ai.stats.waves).toBe(1);
    const at = ai.stats.steamroll!.launches[0]!;
    expect(at.value).toBeGreaterThanOrEqual(6000);
    expect(at.crushers).toBe(8);
    // The launch order sends every unit of the army.
    expect(cmds.some((c) => c.type === 'attackmove' && army.every((id) => c.units.includes(id)))).toBe(true);
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
    const steam = run((map) => new SteamrollAI(0, 'human', map, 6, { ...STEAMROLL_TUNING, launch: 3000, crushers: 4 }));
    expect(steam.stats.waves).toBeGreaterThan(0);
    expect(steam.stats.retreats).toBe(0);
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
