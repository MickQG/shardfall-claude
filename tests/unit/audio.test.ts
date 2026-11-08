import { describe, expect, it } from 'vitest';
import { UNIT_DEFS } from '../../src/data/defs';
import { AudioEngine } from '../../src/audio/engine';
import { worldSoundFor, type SoundWho } from '../../src/audio/plan';
import {
  ACK_KINDS,
  ackRecipe,
  AckGate,
  allocateVoice,
  ambienceMix,
  explosionSize,
  MAX_VOICES,
  mostNumerousKind,
  movementMix,
  moveClass,
  moveLoopSamples,
  MOVE_LOOPS,
  MOVE_CLASSES,
  paletteOf,
  panGain,
  recipeFor,
  ShotTagger,
  sizeMods,
  stepFight,
  UI_SOUNDS,
  Variation,
  WATER_FULL,
  WORLD_SOUNDS,
  type VoiceInfo,
} from '../../src/audio/recipes';
import { FP, type SimEvent, type UnitSnap } from '../../src/sim';
import { movingUnits, Soundscape, waterPoints } from '../../src/ui/soundscape';
import { wireUiSounds } from '../../src/ui/uiSounds';

describe('sound effects: layers and variation', () => {
  it('AUD-5: every weapon, explosion and death sound of both factions has at least two layers, an attack and a body or tail', () => {
    for (const faction of ['human', 'alien'] as const) {
      for (const name of WORLD_SOUNDS) {
        const r = recipeFor(name, faction)!;
        expect(r, `${faction} ${name}`).toBeDefined();
        expect(r.layers.length, `${faction} ${name}`).toBeGreaterThanOrEqual(2);
        expect(r.layers.some((l) => l.role === 'attack'), `${faction} ${name} attack`).toBe(true);
        expect(r.layers.some((l) => l.role === 'body' || l.role === 'tail'), `${faction} ${name} body`).toBe(true);
      }
    }
  });

  it('AUD-5: variation is deterministic per seed, stays within 8% of the pitch, and never repeats the same parameters twice in a row', () => {
    const run = (seed: number): { pitch: number; delay: number; gain: number }[] => {
      const v = new Variation(seed);
      return Array.from({ length: 200 }, () => v.next('zap'));
    };
    const a = run(11);
    expect(run(11)).toEqual(a);
    expect(run(12)).not.toEqual(a);
    for (let i = 0; i < a.length; i++) {
      const p = a[i]!;
      expect(Math.abs(p.pitch - 1)).toBeLessThanOrEqual(0.08);
      expect(p.delay).toBeGreaterThanOrEqual(0);
      expect(p.delay).toBeLessThan(0.02);
      if (i > 0) {
        expect(Math.abs(p.pitch - a[i - 1]!.pitch)).toBeGreaterThanOrEqual(0.01);
        expect(p).not.toEqual(a[i - 1]);
      }
    }
    // The variation spans a real range, not a hair.
    const ps = a.map((x) => x.pitch);
    expect(Math.max(...ps) - Math.min(...ps)).toBeGreaterThan(0.08);
  });

  it('AUD-5: explosions scale with size, and the death of a big unit has weight (a low sub thump and a long debris tail)', () => {
    expect(explosionSize(3)).toBeGreaterThan(explosionSize(1));
    expect(sizeMods(2).time).toBeGreaterThan(sizeMods(1).time);
    expect(sizeMods(2).pitch).toBeLessThan(sizeMods(1).pitch);
    expect(sizeMods(2).gain).toBeGreaterThan(sizeMods(1).gain);
    for (const faction of ['human', 'alien'] as const) {
      const big = recipeFor('bigboom', faction)!;
      const small = recipeFor('pop', faction)!;
      const sub = big.layers.find((l) => l.src === 'osc' && l.wave === 'sine' && (l.freq ?? 1e9) <= 80)!;
      expect(sub, faction).toBeDefined();
      expect(sub.dur).toBeGreaterThanOrEqual(0.9);
      const length = (r: typeof big): number => Math.max(...r.layers.map((l) => l.at + l.dur));
      expect(length(big)).toBeGreaterThan(length(small) * 3);
      expect(big.layers.some((l) => l.src === 'noise' && l.role === 'tail' && l.dur >= 1)).toBe(true);
    }
  });

  it('AUD-5 AUD-6: an event becomes a sound of the shooter\'s faction, and an explosion takes the faction of the nearest shell', () => {
    const who: SoundWho = {
      kindOf: (id) => (id === 1 ? 'ali_skitter' : id === 2 ? 'hum_tank' : undefined),
      factionOf: () => 'human',
      boomFaction: (x, y) => tagger.near(x, y, 'human'),
    };
    const tagger = new ShotTagger();
    const shot = (src: number): SimEvent => ({ t: 'shot', x: 5 * FP, y: 6 * FP, tx: 9 * FP, ty: 9 * FP, weapon: 'claw', owner: 1, air: false, flight: 0, src });
    expect(worldSoundFor(shot(1), 0, who)).toMatchObject({ faction: 'alien', name: 'slash', at: { x: 5, y: 6 } });
    expect(worldSoundFor(shot(2), 0, who).faction).toBe('human');
    tagger.note(9, 9, 'alien');
    expect(worldSoundFor({ t: 'boom', x: 9 * FP, y: 9 * FP, r: 3 }, 0, who)).toMatchObject({ faction: 'alien', name: 'boom' });
    expect(worldSoundFor({ t: 'boom', x: 30 * FP, y: 30 * FP, r: 1 }, 0, who).faction).toBe('human');
    expect(worldSoundFor({ t: 'boom', x: 0, y: 0, r: 3 }, 0, who).size).toBeGreaterThan(worldSoundFor({ t: 'boom', x: 0, y: 0, r: 1 }, 0, who).size);
    expect(worldSoundFor({ t: 'die', x: 0, y: 0, big: true, owner: 1, id: 2, kind: 'ali_brute' }, 0, who).faction).toBe('alien');
  });
});

describe('faction palettes', () => {
  it('AUD-6: Aegis is metallic (inharmonic ringing partials, high-Q bandpass, hard clicks) and Vrax is organic (formant noise, low clicks, gurgles)', () => {
    const a = paletteOf('human');
    const v = paletteOf('alien');
    expect(a.inharmonic).toBeGreaterThanOrEqual(WORLD_SOUNDS.length);
    expect(v.inharmonic).toBe(0);
    expect(a.ringing).toBeGreaterThan(0);
    expect(v.ringing).toBe(0);
    expect(v.formantNoise).toBeGreaterThanOrEqual(WORLD_SOUNDS.length - 1);
    expect(a.formantNoise).toBe(0);
    expect(v.lowClicks).toBeGreaterThanOrEqual(WORLD_SOUNDS.length);
    expect(a.lowClicks).toBe(0);
    for (const name of WORLD_SOUNDS) {
      const ha = recipeFor(name, 'human')!;
      const va = recipeFor(name, 'alien')!;
      expect(ha, name).not.toEqual(va);
      expect(ha.layers.some((l) => l.ratios?.some((r) => !Number.isInteger(r))), `Aegis ${name} rings`).toBe(true);
      expect(va.layers.some((l) => l.wobble || l.trill || (l.src === 'noise' && (l.filters?.length ?? 0) >= 2)), `Vrax ${name} is wet`).toBe(true);
    }
  });
});

describe('acknowledgement sounds', () => {
  it('AUD-7: every unit kind of both factions has a select sound and a different command sound, and no two kinds sound alike', () => {
    for (const kind of Object.keys(UNIT_DEFS)) expect(ACK_KINDS, kind).toContain(kind);
    const seen = new Set<string>();
    for (const kind of ACK_KINDS) {
      const s = ackRecipe(kind, 'select')!;
      const c = ackRecipe(kind, 'command')!;
      expect(s.layers.length).toBeGreaterThanOrEqual(2);
      expect(c.layers.length).toBeGreaterThanOrEqual(2);
      expect(s).not.toEqual(c);
      // Short: a select under a quarter second, a command under a third.
      expect(Math.max(...s.layers.map((l) => l.at + l.dur))).toBeLessThan(0.25);
      expect(Math.max(...c.layers.map((l) => l.at + l.dur))).toBeLessThan(0.34);
      for (const r of [s, c]) {
        const key = JSON.stringify(r);
        expect(seen.has(key), `${kind} is unique`).toBe(false);
        seen.add(key);
      }
    }
    expect(ackRecipe('hum_nothing', 'select')).toBeUndefined();
  });

  it('AUD-7: Aegis answers with radio blips and relay clicks, Vrax with clicks, chitters and wet trills', () => {
    const rifle = ackRecipe('hum_rifleman', 'command')!;
    expect(rifle.layers.some((l) => l.ratios?.some((r) => !Number.isInteger(r)))).toBe(true);
    expect(rifle.layers.some((l) => l.src === 'noise' && l.filters?.[0]?.type === 'highpass')).toBe(true);
    const skit = ackRecipe('ali_skitter', 'select')!;
    expect(skit.layers.some((l) => l.trill)).toBe(true);
    expect(skit.layers.some((l) => l.src === 'noise' && (l.filters?.length ?? 0) >= 2)).toBe(true);
    expect(ackRecipe('ali_skitter', 'command')!.layers.some((l) => l.wobble)).toBe(true);
  });

  it('AUD-7: the kind used is the most numerous in the selection', () => {
    expect(mostNumerousKind(['hum_tank', 'hum_rifleman', 'hum_rifleman', 'hum_tank', 'hum_rifleman'])).toBe('hum_rifleman');
    expect(mostNumerousKind(['ali_brute'])).toBe('ali_brute');
    expect(mostNumerousKind(['hum_tank', 'hum_buggy'])).toBe('hum_tank');
    expect(mostNumerousKind([])).toBeNull();
  });

  it('AUD-7: at most one acknowledgement every 150 ms', () => {
    const g = new AckGate(150);
    expect(g.allow(1000)).toBe(true);
    expect(g.allow(1100)).toBe(false);
    expect(g.allow(1149)).toBe(false);
    expect(g.allow(1150)).toBe(true);
    expect(g.allow(1160)).toBe(false);
  });
});

describe('movement loops', () => {
  const at = (kind: string, sx: number, sy: number): { kind: string; sx: number; sy: number } => ({ kind, sx, sy });

  it('AUD-8: every unit kind has a movement class: vehicles, walkers and heroes, infantry, Vrax swarms', () => {
    for (const kind of Object.keys(UNIT_DEFS)) expect(moveClass(kind), kind).not.toBeNull();
    expect(moveClass('hum_tank')).toBe('vehicle');
    expect(moveClass('hum_paladin')).toBe('walker');
    expect(moveClass('ali_strider')).toBe('walker');
    expect(moveClass('hum_rifleman')).toBe('infantry');
    expect(moveClass('ali_skitter')).toBe('swarm');
  });

  it('AUD-8: a class\'s loop level rises with how many of its units move near the middle, and is zero when none do', () => {
    const none = movementMix([], 1000, 600);
    for (const c of MOVE_CLASSES) expect(none[c]).toBe(0);
    const one = movementMix([at('hum_tank', 500, 300)], 1000, 600);
    const five = movementMix(Array.from({ length: 5 }, () => at('hum_tank', 500, 300)), 1000, 600);
    const fifty = movementMix(Array.from({ length: 50 }, () => at('hum_tank', 500, 300)), 1000, 600);
    expect(one.vehicle).toBeGreaterThan(0);
    expect(five.vehicle).toBeGreaterThan(one.vehicle);
    expect(fifty.vehicle).toBeGreaterThan(five.vehicle);
    expect(fifty.vehicle).toBeLessThanOrEqual(1);
    // Only that class sounds.
    expect(one.walker + one.infantry + one.swarm).toBe(0);
    // Near the middle counts for more than the edge; off screen counts for nothing.
    expect(movementMix([at('hum_tank', 500, 300)], 1000, 600).vehicle).toBeGreaterThan(movementMix([at('hum_tank', 980, 590)], 1000, 600).vehicle);
    expect(movementMix([at('hum_tank', -50, 300), at('hum_tank', 500, 900)], 1000, 600).vehicle).toBe(0);
    // Kinds with no class make no sound.
    expect(movementMix([at('nothing', 500, 300)], 1000, 600)).toEqual(none);
  });

  it('AUD-8: movement loops are generated low and soft (rumble, thumps, patters), seamless, and carry no energy in the hiss band', () => {
    const rate = 44100;
    for (const c of MOVE_CLASSES) {
      const d = moveLoopSamples(c, rate);
      expect(d.length, c).toBe(Math.round(MOVE_LOOPS[c].period * rate));
      expect(MOVE_LOOPS[c].filter.type, c).toBe('lowpass');
      expect(MOVE_LOOPS[c].filter.f, c).toBeLessThanOrEqual(800);
      let peak = 0;
      let sum = 0;
      let diff = 0;
      for (let i = 0; i < d.length; i++) {
        const v = d[i] as number;
        peak = Math.max(peak, Math.abs(v));
        sum += v * v;
        diff += (v - (d[Math.max(0, i - 1)] as number)) ** 2;
      }
      expect(peak, c).toBeGreaterThan(0.05);
      expect(peak, c).toBeLessThanOrEqual(1);
      // A first difference measures the energy in the highs: smooth low tones keep it far below the signal's own.
      expect(diff / sum, `${c} is smooth, not hissy`).toBeLessThan(0.05);
    }
    // Vehicles rumble below 300 Hz, so the vehicle filter sits there.
    expect(MOVE_LOOPS.vehicle.filter.f).toBeLessThanOrEqual(300);
  });

  it('AUD-8: moving units come from successive snapshots (their position changed)', () => {
    const u = (id: number, x: number, y: number): UnitSnap => ({ id, owner: 0, kind: 'hum_tank', x, y, hp: 1, rank: 0, target: -1, dest: null, load: 0 });
    const moved = movingUnits([u(1, 0, 0), u(2, 5, 5), u(3, 9, 9)], [u(1, 0, 0), u(2, 6, 5), u(3, 9, 8), u(4, 1, 1)]);
    expect(moved.map((x) => x.id)).toEqual([2, 3]);
    expect(movingUnits([], [u(1, 1, 1)])).toEqual([]);
  });
});

describe('position on screen', () => {
  it('AUD-9: pan runs from -1 at the left edge to +1 at the right and gain falls with distance from the middle', () => {
    expect(panGain(0, 300, 1000, 600).pan).toBe(-1);
    expect(panGain(1000, 300, 1000, 600).pan).toBe(1);
    expect(panGain(500, 300, 1000, 600).pan).toBe(0);
    expect(panGain(250, 300, 1000, 600).pan).toBeCloseTo(-0.5, 5);
    expect(panGain(5000, 300, 1000, 600).pan).toBe(1);
    expect(panGain(500, 300, 1000, 600).gain).toBe(1);
    const mid = panGain(750, 300, 1000, 600).gain;
    const edge = panGain(1000, 300, 1000, 600).gain;
    const corner = panGain(1000, 600, 1000, 600).gain;
    expect(mid).toBeLessThan(1);
    expect(edge).toBeLessThan(mid);
    expect(corner).toBeLessThan(edge);
    expect(panGain(-4000, -4000, 1000, 600).gain).toBeGreaterThan(0);
    // Symmetric left and right.
    expect(panGain(100, 300, 1000, 600).gain).toBeCloseTo(panGain(900, 300, 1000, 600).gain, 8);
  });
});

describe('ambience', () => {
  it('AUD-10: there is no wind bed; water follows how much is on screen, and rumble follows the off-screen fight', () => {
    expect(ambienceMix(0, 0)).toEqual({ water: 0, rumble: 0 });
    expect(ambienceMix(WATER_FULL / 2, 0).water).toBeCloseTo(0.5, 5);
    expect(ambienceMix(WATER_FULL * 5, 0).water).toBe(1);
    expect(ambienceMix(0, 0.6).rumble).toBeCloseTo(0.6, 5);
    expect(ambienceMix(0, 4).rumble).toBe(1);
    expect('wind' in ambienceMix(0, 0)).toBe(false);
  });

  it('AUD-10: the off-screen fight level rises with the player\'s units fighting out of view and dies away within seconds', () => {
    let f = 0;
    f = stepFight(f, 0.1, 2);
    expect(f).toBeGreaterThan(0.4);
    const peak = stepFight(f, 0.1, 10);
    expect(peak).toBe(1);
    let g = peak;
    for (let i = 0; i < 100; i++) g = stepFight(g, 0.1, 0);
    expect(g).toBeLessThan(0.05);
  });

  it('AUD-10: the soundscape drives the loops and beds from snapshots, the camera and the water on screen', () => {
    const calls: { movement: Record<string, number>; ambience: { water: number; rumble: number } }[] = [];
    const bed = {
      setMovement: (m: Record<string, number>) => calls.push({ movement: m, ambience: { water: 0, rumble: 0 } }),
      setAmbience: (a: { water: number; rumble: number }) => (calls[calls.length - 1]!.ambience = a),
    };
    const W = 40;
    const heights = new Array(W * W).fill(0) as number[];
    const blocked = new Array(W * W).fill(0) as number[];
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) blocked[y * W + x] = 1;
    const pts = waterPoints({ width: W, height: W, heights, blocked });
    expect(pts.length).toBe(100);
    expect(waterPoints({ width: W, height: W, heights }).length).toBe(0);
    heights[10 * W + 10] = 1;
    expect(waterPoints({ width: W, height: W, heights, blocked }).length).toBe(99);

    const sc = new Soundscape({ width: W, height: W, heights, blocked }, bed);
    const snap = (tick: number, x: number): never => ({ tick, units: [{ id: 1, owner: 0, kind: 'hum_tank', x: x * FP, y: 5 * FP, hp: 1, rank: 0, target: -1, dest: null, load: 0 }] }) as never;
    // The camera shows tiles 0..40 over 400 px: a tile is 10 px wide.
    const proj = { toScreen: (tx: number, ty: number) => ({ x: tx * 10, y: ty * 10 }), toGround: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }) };
    sc.update(snap(1, 20), snap(2, 20.5), proj, { width: 400, height: 400 } as never, 0);
    const first = calls[0]!;
    expect(first.movement.vehicle).toBeGreaterThan(0);
    expect(first.ambience.water).toBe(1);
    // Too soon for another update.
    sc.update(snap(1, 20), snap(2, 20.5), proj, { width: 400, height: 400 } as never, 50);
    expect(calls.length).toBe(1);
    // The camera has moved off the lake, and the tank stands still: no water, no loop; a fight off-screen rumbles.
    const away = { ...proj, toScreen: (tx: number, ty: number) => ({ x: tx * 10 + 2000, y: ty * 10 }) };
    sc.noteOffscreenFight(3);
    sc.update(snap(2, 20.5), snap(3, 20.5), away, { width: 400, height: 400 } as never, 200);
    const last = calls[calls.length - 1]!;
    expect(last.movement.vehicle).toBe(0);
    expect(last.ambience.water).toBe(0);
    expect(last.ambience.rumble).toBeGreaterThan(0.5);
  });
});

describe('UI sounds', () => {
  it('AUD-11: hover, click, construction finished, unit ready and refused sounds exist, are short and quiet, and play through the same engine', () => {
    for (const n of ['hover', 'click', 'built', 'ready', 'deny', 'alert'] as const) {
      expect(UI_SOUNDS).toContain(n);
      const r = recipeFor(n)!;
      expect(r.layers.length).toBeGreaterThanOrEqual(2);
    }
    const length = (n: Parameters<typeof recipeFor>[0]): number => Math.max(...recipeFor(n)!.layers.map((l) => l.at + l.dur));
    const peak = (n: Parameters<typeof recipeFor>[0]): number => Math.max(...recipeFor(n)!.layers.map((l) => l.gain));
    // Hover and click are short and soft, softer than the alerts that matter.
    expect(length('hover')).toBeLessThan(0.05);
    expect(length('click')).toBeLessThan(0.08);
    expect(peak('hover')).toBeLessThan(peak('click'));
    expect(peak('click')).toBeLessThan(peak('ready'));
    // Built and ready differ.
    expect(recipeFor('built')).not.toEqual(recipeFor('ready'));
    // Safe where audio does not exist, muted or not.
    const e = new AudioEngine();
    expect(() => {
      for (const n of UI_SOUNDS) e.play(n);
      e.ack('hum_tank', 'select');
      e.setMovement({ vehicle: 1, walker: 1, infantry: 1, swarm: 1 });
      e.setAmbience({ water: 1, rumble: 1 });
    }).not.toThrow();
    expect(e.stats.requested.hover).toBe(1);
    expect(e.stats.started).toBe(0);
  });

  it('AUD-11: buttons play hover once on entering and click on pressing, and a refused or disabled one stays silent', () => {
    const handlers = new Map<string, (e: unknown) => void>();
    const root = { addEventListener: (t: string, h: (e: unknown) => void) => handlers.set(t, h) } as unknown as EventTarget;
    const played: string[] = [];
    wireUiSounds(root, { play: (n) => played.push(n) });
    const Elem = globalThis.Element;
    // A tiny DOM stand-in: elements that know their closest button.
    class Fake {
      constructor(
        public btn: Fake | null,
        public cls: string[] = [],
        public disabled = false,
      ) {}
      closest(): Fake | null {
        return this.btn ?? null;
      }
      classList = { contains: (c: string): boolean => this.cls.includes(c) };
    }
    if (typeof Elem === 'undefined') {
      (globalThis as unknown as { Element: unknown }).Element = Fake;
    }
    const E = globalThis.Element as unknown as typeof Fake;
    try {
      const b = new Fake(null);
      b.btn = b;
      const child = new E(b) as unknown as Fake;
      const off = new Fake(null, ['off']);
      off.btn = off;
      handlers.get('pointerover')!({ target: b, relatedTarget: null });
      handlers.get('pointerover')!({ target: child, relatedTarget: b });
      handlers.get('pointerover')!({ target: off, relatedTarget: null });
      handlers.get('click')!({ target: b });
      handlers.get('click')!({ target: off });
      expect(played).toEqual(['hover', 'click']);
    } finally {
      if (typeof Elem === 'undefined') delete (globalThis as unknown as { Element?: unknown }).Element;
    }
  });
});

describe('the voice budget and the limiter', () => {
  const v = (end: number, loud: number): VoiceInfo => ({ end, loud });

  it('AUD-12: at most 24 sounds play at once; the new one is dropped if it is no louder than all that play', () => {
    expect(MAX_VOICES).toBe(24);
    const few = Array.from({ length: 23 }, (_, i) => v(10, 0.5 + i * 0.01));
    expect(allocateVoice(few, 0.01, 0)).toEqual({ kind: 'play' });
    const full = Array.from({ length: 24 }, (_, i) => v(10, 0.5 + i * 0.01));
    expect(allocateVoice(full, 0.4, 0)).toEqual({ kind: 'drop' });
    expect(allocateVoice(full, 0.5, 0)).toEqual({ kind: 'drop' });
  });

  it('AUD-12: when full, a louder (nearer) sound steals the quietest, and sounds that have ended make room', () => {
    const full = Array.from({ length: 24 }, (_, i) => v(10, 0.5 + i * 0.01));
    full[7] = v(10, 0.1);
    expect(allocateVoice(full, 0.2, 0)).toEqual({ kind: 'steal', index: 7 });
    // A sound that already ended is not counted.
    full[3] = v(0.5, 0.9);
    expect(allocateVoice(full, 0.01, 1)).toEqual({ kind: 'play' });
    // Never more than 24: simulate a 200-sound battle by repeating the allocation.
    let live: VoiceInfo[] = [];
    for (let i = 0; i < 200; i++) {
      const loud = ((i * 37) % 100) / 100;
      const a = allocateVoice(live, loud, 0);
      if (a.kind === 'play') live.push(v(5, loud));
      else if (a.kind === 'steal') live = live.map((x, j) => (j === a.index ? v(5, loud) : x));
      expect(live.length).toBeLessThanOrEqual(24);
    }
    expect(live.length).toBe(24);
    // The survivors are the loudest it met.
    expect(Math.min(...live.map((x) => x.loud))).toBeGreaterThan(0.6);
  });

  it('AUD-12: the engine is safe where no audio exists, with a limiter on its master (checked in the browser by the e2e)', () => {
    const e = new AudioEngine();
    expect(() => {
      for (let i = 0; i < 300; i++) e.play('boom', 1, { faction: 'alien', size: 2, pan: 1, near: 1 });
    }).not.toThrow();
  });
});
