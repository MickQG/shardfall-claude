import { describe, expect, it } from 'vitest';
import { AI, DIFFICULTIES, infantryNeeded, PERSONALITIES, RAIDER_OPENING_END, resolvePersonality, SUPERWEAPON_ARMY, SUPERWEAPON_HAULERS, type Personality } from '../../src/ai/ai';
import { inLengthTarget, lengthReport, playMatch } from '../../src/ai/harness';
import { skirmishConfig } from '../../src/data/maps';
import { createGame, snapshot, submit, tick, type Command } from '../../src/sim';
import { opponentLine } from '../../src/ui/score';
import { loadSettings, saveSettings } from '../../src/ui/settings';

const LONG = 600_000;

/** A built-up human Doomsday base (lab, two barracks and factories, three refineries, power to spare) on seed 6. */
const doomBase = (credits: number, extra: { kind: string; dx: number; dy: number }[] = [], lance = false) => {
  const cfg = skirmishConfig(6, { factions: ['human', 'alien'] });
  const hq = cfg.buildings!.find((b) => b.owner === 0 && b.kind === 'hum_hq')!;
  const at = (kind: string, dx: number, dy: number) => ({ owner: 0, kind, tx: hq.tx + dx, ty: hq.ty + dy });
  const reactors = [[4, 0], [6, 0], [4, 2], [6, 2], [8, 0], [8, 2], [10, 0], [10, 2]].map(([x, y]) => at('hum_reactor', x!, y!));
  const g = createGame({
    ...cfg,
    players: [{ faction: 'human', credits }, cfg.players![1]!],
    buildings: [...cfg.buildings!, ...reactors, at('hum_barracks', 0, 4), at('hum_barracks', 0, 7), at('hum_factory', 3, 4), at('hum_factory', 3, 8), at('hum_lab', 7, 4), at('hum_refinery', 7, 8), at('hum_refinery', 11, 8), at('hum_refinery', 11, 4), ...(lance ? [at('hum_lance', 0, 11)] : [])],
    units: [...(cfg.units ?? []), ...extra.map((u) => ({ owner: 0, kind: u.kind, tx: hq.tx + u.dx, ty: hq.ty + u.dy }))],
  });
  return { cfg, g };
};

describe('AI personalities', () => {
  it('AI-12: three personalities; any other choice is drawn from the game seed; every difficulty plays every personality', () => {
    expect(PERSONALITIES).toEqual(['raider', 'balanced', 'doomsday']);
    for (const p of PERSONALITIES) expect(resolvePersonality(p, 123)).toBe(p);
    const drawn = new Set<Personality>();
    for (let seed = 0; seed < 40; seed++) {
      const a = resolvePersonality('random', seed);
      expect(resolvePersonality(null, seed)).toBe(a);
      expect(PERSONALITIES).toContain(a);
      drawn.add(a);
    }
    expect(drawn.size).toBe(3);
    for (const d of Object.values(DIFFICULTIES)) {
      for (const p of PERSONALITIES) {
        const r = playMatch({ seed: 2, factions: ['human', 'alien'], difficulties: [d, DIFFICULTIES.medium], maxTicks: 1500, personalities: [p, 'balanced'] });
        expect(r.orders[0]).toBeGreaterThan(0);
      }
    }
  }, LONG);

  it('AI-12: the personality is part of the match settings: the same seeds and settings give the same game', () => {
    const o = { seed: 3, factions: ['alien', 'human'] as ['alien', 'human'], difficulties: [DIFFICULTIES.hard, DIFFICULTIES.medium] as [typeof DIFFICULTIES.hard, typeof DIFFICULTIES.medium], maxTicks: 6000 };
    const a = playMatch({ ...o, personalities: ['raider', 'doomsday'] });
    const b = playMatch({ ...o, personalities: ['raider', 'doomsday'] });
    expect(a.hash).toBe(b.hash);
    expect(a.ai).toEqual(b.ai);
    expect(playMatch({ ...o, personalities: ['balanced', 'doomsday'] }).hash).not.toBe(a.hash);
  }, LONG);

  it('AI-13: Balanced plays exactly as the AI without a personality', () => {
    const o = { seed: 4, factions: ['human', 'alien'] as ['human', 'alien'], difficulties: [DIFFICULTIES.medium, DIFFICULTIES.hard] as [typeof DIFFICULTIES.medium, typeof DIFFICULTIES.hard], maxTicks: 6000 };
    const plain = playMatch(o);
    const balanced = playMatch({ ...o, personalities: ['balanced', 'balanced'] });
    expect(balanced.hash).toBe(plain.hash);
    expect(balanced.orders).toEqual(plain.orders);
  }, LONG);
});

describe('commit, then adapt', () => {
  it('AI-16: Raider plays as Balanced after eight minutes', () => {
    const cfg = skirmishConfig(5, { factions: ['alien', 'human'] });
    const g = createGame(cfg);
    const ai = new AI(0, 'alien', DIFFICULTIES.medium, cfg.map, 5, 'raider');
    expect(ai.plan).toBe('raider');
    for (let t = 0; t <= RAIDER_OPENING_END + 40; t++) {
      if (t % 30 === 0) for (const c of ai.think(snapshot(g, 0))) submit(g, c);
      tick(g);
    }
    expect(ai.personality).toBe('raider');
    expect(ai.plan).toBe('balanced');
  }, LONG);

  it('AI-16: Doomsday has no fallback: it keeps its plan when its superweapon is lost', () => {
    const { cfg, g } = doomBase(20000, [], true);
    expect(g.state.buildings.some((b) => b.kind === 'hum_lance')).toBe(true);
    const ai = new AI(0, 'human', DIFFICULTIES.hard, cfg.map, 6, 'doomsday');
    ai.think(snapshot(g, 0));
    expect(ai.plan).toBe('doomsday');
    g.state.buildings = g.state.buildings.filter((b) => b.kind !== 'hum_lance');
    ai.think(snapshot(g, 0));
    expect(ai.plan).toBe('doomsday');
  });
});

describe('Doomsday, the tech personality', () => {
  it('AI-15: keeps at least two rifle squads, and at least half as many as the enemy infantry squads it has seen', () => {
    expect(infantryNeeded({ air: 0, heavy: 0, light: 0, squads: 0, total: 0 })).toBe(2);
    expect(infantryNeeded({ air: 0, heavy: 0, light: 1, squads: 1, total: 10 })).toBe(5);
    expect(infantryNeeded({ air: 0, heavy: 0.5, light: 0.5, squads: 0.5, total: 12 })).toBe(3);
  });

  it('AI-15: goes for its superweapon only with a strong army and working economy, never just because it is rich', () => {
    const lanceOrdered = (cmds: Command[]): boolean => cmds.some((c) => c.type === 'produce' && c.kind === 'hum_lance');
    // Rich, but no army to speak of: no superweapon.
    const poor = doomBase(3000);
    const ai = new AI(0, 'human', DIFFICULTIES.hard, poor.cfg.map, 6, 'doomsday');
    expect(lanceOrdered(ai.think(snapshot(poor.g, 0)))).toBe(false);
    // A strong army (eight tanks, worth 6400) and five haulers: it orders the superweapon.
    const army = [...Array(8)].map((_, i) => ({ kind: 'hum_tank', dx: 14 + (i % 4), dy: 12 + Math.floor(i / 4) }));
    const haulers = [...Array(4)].map((_, i) => ({ kind: 'hum_hauler', dx: 13 + i, dy: 15 }));
    const strong = doomBase(3000, [...army, ...haulers]);
    const ai2 = new AI(0, 'human', DIFFICULTIES.hard, strong.cfg.map, 6, 'doomsday');
    expect(lanceOrdered(ai2.think(snapshot(strong.g, 0)))).toBe(true);
    expect(SUPERWEAPON_ARMY).toBe(5000);
    expect(SUPERWEAPON_HAULERS).toBe(5);
    // Balanced is unchanged: it does not wait for an army before its superweapon.
    const bal = new AI(0, 'human', DIFFICULTIES.hard, poor.cfg.map, 6, 'balanced');
    expect(lanceOrdered(bal.think(snapshot(doomBase(3000).g, 0)))).toBe(true);
  });
});

describe('choosing and revealing the personality', () => {
  const memory = (): Pick<Storage, 'getItem' | 'setItem'> => {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
  };

  it('MENU-5: the menu choice is Random by default, remembered on the device, and anything unknown reads as Random', () => {
    const store = memory();
    expect(loadSettings(store).personality).toBe('random');
    saveSettings(store, { ...loadSettings(store), personality: 'raider' });
    expect(loadSettings(store).personality).toBe('raider');
    store.setItem('shardfall.settings.v3', JSON.stringify({ personality: 'berserker' }));
    expect(loadSettings(store).personality).toBe('random');
    // Random resolves from the game seed, so both ends of a replay agree.
    expect(resolvePersonality('random', 77)).toBe(resolvePersonality('random', 77));
  });

  it('SCR-4: the result screen names the opponent personality and difficulty', () => {
    expect(opponentLine('doomsday', 'hard')).toBe('Your opponent played Doomsday on Hard.');
    expect(opponentLine('raider', 'easy')).toContain('Raider');
  });

  it('HAR-4: the match-length report gives median, shortest and longest in minutes and checks the 12 to 20 minute target', () => {
    const r = lengthReport([20 * 60 * 10, 20 * 60 * 14, 20 * 60 * 30, 20 * 60 * 16]);
    expect(r).toEqual({ median: 15, min: 10, max: 30, n: 4 });
    expect(lengthReport([])).toEqual({ median: 0, min: 0, max: 0, n: 0 });
    expect(inLengthTarget(15)).toBe(true);
    expect(inLengthTarget(11.9)).toBe(false);
    expect(inLengthTarget(20.5)).toBe(false);
  });
});
