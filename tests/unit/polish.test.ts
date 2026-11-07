import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../../src/audio/engine';
import { CHORD_ROOTS, menuPlan, musicPlan, SCALE_TONES, semitonesFromA, soundFor } from '../../src/audio/plan';
import { UNIT_DEFS } from '../../src/data/defs';
import { skirmishConfig } from '../../src/data/maps';
import { SimRunner, TICK_MS } from '../../src/host/runner';
import { UNIT_MODELS } from '../../src/render/voxel/models';
import { createGame, snapshot, submit, tick, type SimEvent } from '../../src/sim';
import { AlertTracker } from '../../src/ui/alerts';
import { HUMAN_HERO_LINE } from '../../src/ui/menu';
import { defaultSettings, effectsEnabled, loadSettings, saveSettings } from '../../src/ui/settings';

describe('visuals and settings', () => {
  it('VIS-1: every unit kind has its own distinct drawing', () => {
    const kinds = Object.keys(UNIT_DEFS);
    for (const k of kinds) expect(UNIT_MODELS[k], `model for ${k}`).toBeDefined();
    expect(Object.keys(UNIT_MODELS).sort()).toEqual([...kinds].sort());
  });

  it('VIS-2: quality and reduced motion control the effects; settings persist and survive broken storage', () => {
    const hi = defaultSettings(false);
    expect(effectsEnabled(hi)).toEqual({ bloom: true, particles: true, shake: true, decor: true });
    expect(effectsEnabled({ ...hi, quality: 'low' })).toEqual({ bloom: false, particles: false, shake: true, decor: false });
    // Reduced motion keeps the high preset and only stops camera shake.
    expect(defaultSettings(true).quality).toBe('high');
    expect(effectsEnabled(defaultSettings(true))).toEqual({ bloom: true, particles: true, shake: false, decor: true });

    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveSettings(store, { ...hi, quality: 'low', muted: true, volume: 0.2 });
    expect(loadSettings(store, false)).toMatchObject({ quality: 'low', muted: true, volume: 0.2 });
    expect(loadSettings(store, true).reducedMotion).toBe(true); // the system preference wins

    // Settings saved by version 1 keep their sound choices but start on high quality again.
    const v1 = new Map<string, string>([['shardfall.settings.v1', JSON.stringify({ quality: 'low', muted: true, volume: 0.3 })]]);
    expect(loadSettings({ getItem: (k) => v1.get(k) ?? null, setItem: () => undefined }, false)).toMatchObject({ quality: 'high', muted: true, volume: 0.3 });
    expect(loadSettings(null)).toEqual(defaultSettings(false));
    expect(loadSettings({ getItem: () => 'not json', setItem: () => undefined })).toEqual(defaultSettings(false));
    expect(loadSettings({ getItem: () => JSON.stringify({ quality: 'ultra', volume: 9 }), setItem: () => undefined })).toEqual(defaultSettings(false));
    const throwing = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('blocked');
      },
    };
    expect(loadSettings(throwing)).toEqual(defaultSettings(false));
    expect(() => saveSettings(throwing, hi)).not.toThrow();
  });
});

describe('audio', () => {
  it('AUD-1: simulation events map to the right sounds; own fire is louder than enemy fire', () => {
    const shot = (weapon: string, owner: number): SimEvent => ({ t: 'shot', x: 0, y: 0, tx: 0, ty: 0, weapon, owner, air: false, flight: 0, src: 1 });
    expect(soundFor(shot('pierce', 0), 0).name).toBe('zap');
    expect(soundFor(shot('rocket', 0), 0).name).toBe('rocket');
    expect(soundFor(shot('blast', 0), 0).name).toBe('cannon');
    expect(soundFor(shot('claw', 0), 0).name).toBe('slash');
    expect(soundFor(shot('pierce', 0), 0).gain).toBeGreaterThan(soundFor(shot('pierce', 1), 0).gain);
    expect(soundFor({ t: 'die', x: 0, y: 0, big: true, owner: 1, id: 2, kind: 'hum_tank' }, 0).name).toBe('bigboom');
    expect(soundFor({ t: 'die', x: 0, y: 0, big: false, owner: 1, id: 3, kind: 'hum_rifleman' }, 0).name).toBe('pop');
    expect(soundFor({ t: 'boom', x: 0, y: 0, r: 1.5 }, 0).name).toBe('boom');
    expect(soundFor({ t: 'launch', x: 0, y: 0, tx: 0, ty: 0, owner: 1, kind: 'x', delay: 60 }, 0).name).toBe('sw_launch');
    expect(soundFor({ t: 'strike', x: 0, y: 0, owner: 1, kind: '', r: 4 }, 0).name).toBe('sw_strike');
  });

  it('AUD-2: the generated score is deterministic per seed and every note belongs to its chord key', () => {
    const a = musicPlan(7, 16);
    expect(musicPlan(7, 16)).toEqual(a);
    expect(musicPlan(8, 16)).not.toEqual(a);
    expect(a.length).toBeGreaterThan(40);
    const scale = new Set(SCALE_TONES);
    for (const n of a) {
      const pc = ((Math.round(semitonesFromA(n.freq)) % 12) + 12) % 12;
      // Each note is a scale tone, or the fifth, relative to at least one chord root of the loop.
      const inKey = CHORD_ROOTS.some((r) => scale.has((((pc - r) % 12) + 12) % 12) || (((pc - r) % 12) + 12) % 12 === 7);
      expect(inKey, `note ${n.freq.toFixed(1)} Hz out of key`).toBe(true);
      expect(n.beat).toBeGreaterThanOrEqual(0);
      expect(n.dur).toBeGreaterThan(0);
    }
  });

  it('AUD-4: the menu score is deterministic per seed, in key, and differs from the in-match score', () => {
    const a = menuPlan(7, 16);
    expect(menuPlan(7, 16)).toEqual(a);
    expect(menuPlan(8, 16)).not.toEqual(a);
    expect(a).not.toEqual(musicPlan(7, 16));
    const scale = new Set(SCALE_TONES);
    for (const n of a) {
      const pc = ((Math.round(semitonesFromA(n.freq)) % 12) + 12) % 12;
      expect(CHORD_ROOTS.some((r) => scale.has((((pc - r) % 12) + 12) % 12) || (((pc - r) % 12) + 12) % 12 === 7)).toBe(true);
    }
  });

  it('AUD-4: the menu mute is saved and read back; the menu engine does not throw without audio', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveSettings(store, { ...loadSettings(store), muted: true });
    expect(loadSettings(store).muted).toBe(true);
    const e = new AudioEngine();
    expect(() => {
      e.setMuted(true);
      e.unlock();
      e.startMusic(3, true);
      e.stopMusic(0.8);
      e.stopMusic();
    }).not.toThrow();
  });

  it('MENU-7: the Aegis hero line is the short one', () => {
    expect(HUMAN_HERO_LINE).toBe('Paladin, a giant assault walker with cannons and missiles.');
  });

  it('AUD-3: the audio engine is safe where no audio exists', () => {
    const e = new AudioEngine();
    expect(() => {
      e.unlock();
      e.setMuted(true);
      e.setVolume(2);
      e.play('boom');
      e.play('alert', 3);
      e.startMusic(1);
      e.stopMusic();
    }).not.toThrow();
    expect(e.volume).toBe(1);
    expect(e.muted).toBe(true);
  });
});

describe('alerts and pacing', () => {
  const run = (g: ReturnType<typeof createGame>, n: number): void => {
    for (let i = 0; i < n; i++) tick(g);
  };

  it('ALR-1: alerts fire for attacks, ready structures, low power and charged superweapons, with cooldowns', () => {
    const base0 = skirmishConfig(1);
    // A power-hungry lab, so that losing the reactor really does leave the base short of power.
    const g = createGame({ ...base0, buildings: [...base0.buildings!, { owner: 0, kind: 'hum_lab', tx: 20, ty: 14 }] });
    const tracker = new AlertTracker(0);
    expect(tracker.update(snapshot(g, 0))).toEqual([]); // first look: nothing has changed yet

    // Base under attack, once per cooldown.
    const reactor = g.state.buildings.find((b) => b.owner === 0 && b.kind === 'hum_reactor')!;
    reactor.hp -= 50;
    run(g, 1);
    expect(tracker.update(snapshot(g, 0)).map((a) => a.id)).toContain('attack');
    reactor.hp -= 50;
    run(g, 1);
    expect(tracker.update(snapshot(g, 0)).map((a) => a.id)).not.toContain('attack'); // cooling down
    run(g, 250);
    reactor.hp -= 50;
    expect(tracker.update(snapshot(g, 0)).map((a) => a.id)).toContain('attack');

    // A finished structure is announced.
    const hq = g.state.buildings.find((b) => b.owner === 0 && b.kind === 'hum_hq')!;
    submit(g, { type: 'produce', player: 0, source: hq.id, kind: 'hum_barracks' });
    const seen: string[] = [];
    for (let i = 0; i < 420; i++) {
      tick(g);
      seen.push(...tracker.update(snapshot(g, 0)).map((a) => a.id));
    }
    expect(seen).toContain('structure');

    // Low power.
    g.state.buildings = g.state.buildings.filter((b) => !(b.owner === 0 && b.kind === 'hum_reactor'));
    run(g, 2);
    expect(tracker.update(snapshot(g, 0)).map((a) => a.id)).toContain('power');

    // Superweapon charged.
    const base = skirmishConfig(1);
    const g2 = createGame({ ...base, buildings: [...base.buildings!, { owner: 0, kind: 'hum_lance', tx: 20, ty: 14 }] });
    const t2 = new AlertTracker(0);
    t2.update(snapshot(g2, 0));
    g2.state.buildings.find((b) => b.kind === 'hum_lance')!.charge = 20 * 240;
    run(g2, 1);
    expect(t2.update(snapshot(g2, 0)).map((a) => a.id)).toContain('superweapon');
  });

  it('UX-1: a paused game does not advance, and speed scales how fast it runs', () => {
    const cfg = skirmishConfig(1);
    const ticksFor = (speed: number, paused: boolean): number => {
      const r = new SimRunner(cfg, () => undefined, 0);
      r.speed = speed;
      r.paused = paused;
      let n = 0;
      for (let t = 0; t < 1000; t += 16) n += r.advance(16);
      return n;
    };
    expect(ticksFor(1, true)).toBe(0);
    const normal = ticksFor(1, false);
    expect(normal).toBeGreaterThan(15);
    expect(ticksFor(2, false)).toBeGreaterThan(normal * 1.7);
    expect(Math.abs(normal - 1000 / TICK_MS)).toBeLessThanOrEqual(2);
  });
});
