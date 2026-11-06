import { describe, expect, it } from 'vitest';
import { AI, DIFFICULTIES, PERSONALITIES, RAIDER_OPENING_END, resolvePersonality, type Personality } from '../../src/ai/ai';
import { inLengthTarget, lengthReport, playMatch } from '../../src/ai/harness';
import { skirmishConfig } from '../../src/data/maps';
import { createGame, snapshot, submit, tick, type Command } from '../../src/sim';
import { opponentLine } from '../../src/ui/score';
import { loadSettings, saveSettings } from '../../src/ui/settings';

const LONG = 600_000;

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

  it('AI-16: Doomsday that loses its superweapon plays as Balanced, and rebuilds the superweapon first', () => {
    const cfg = skirmishConfig(6, { factions: ['human', 'alien'] });
    const hq = cfg.buildings!.find((b) => b.owner === 0 && b.kind === 'hum_hq')!;
    const at = (kind: string, dx: number, dy: number) => ({ owner: 0, kind, tx: hq.tx + dx, ty: hq.ty + dy });
    const g = createGame({
      ...cfg,
      players: [{ faction: 'human', credits: 20000 }, cfg.players![1]!],
      buildings: [...cfg.buildings!, at('hum_reactor', 4, 0), at('hum_reactor', 6, 0), at('hum_reactor', 4, 2), at('hum_reactor', 6, 2), at('hum_barracks', 0, 4), at('hum_factory', 3, 4), at('hum_lab', 7, 4), at('hum_refinery', 4, 7), at('hum_refinery', 8, 7), at('hum_lance', 0, 7)],
    });
    const ai = new AI(0, 'human', DIFFICULTIES.hard, cfg.map, 6, 'doomsday');
    ai.think(snapshot(g, 0));
    expect(ai.plan).toBe('doomsday');
    g.state.buildings = g.state.buildings.filter((b) => b.kind !== 'hum_lance');
    const cmds: Command[] = ai.think(snapshot(g, 0));
    expect(ai.plan).toBe('balanced');
    expect(cmds.some((c) => c.type === 'produce' && c.kind === 'hum_lance')).toBe(true);
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
    store.setItem('shardfall.settings.v2', JSON.stringify({ personality: 'berserker' }));
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
