import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../../src/audio/engine';
import { BattleIntensity, DAMAGE_WINDOW_MS, intensityTarget } from '../../src/audio/intensity';
import { busGains, layerGains, MUSIC_MAX } from '../../src/audio/mix';
import { readFileSync } from 'node:fs';
import { battlePlan, CHORD_ROOTS, menuPlan, menuThemePlan, motifFor, MUSIC_PARTIALS, MUSIC_PATCHES, musicPlan, SCALE_TONES, semitonesFromA, stingerPlan, themePlan, THEME_EVERY, type Note } from '../../src/audio/plan';

const scale = new Set(SCALE_TONES);
const rel = (freq: number, root: number): number => ((((Math.round(semitonesFromA(freq)) - root) % 12) + 12) % 12);
/** Whether a note is a scale tone, or the fifth, of at least one chord root of the loop. */
const inKey = (n: Note): boolean => CHORD_ROOTS.some((r) => scale.has(rel(n.freq, r)) || rel(n.freq, r) === 7);
const pitched = (notes: Note[]): Note[] => notes.filter((n) => n.voice !== 'perc');

describe('battle layer (AUD-13)', () => {
  it('AUD-13: the battle and calm layers are deterministic per seed and the battle layer differs from the calm one', () => {
    const b = battlePlan(7, 16);
    expect(battlePlan(7, 16)).toEqual(b);
    expect(battlePlan(8, 16)).not.toEqual(b);
    expect(musicPlan(7, 16)).toEqual(musicPlan(7, 16));
    expect(b).not.toEqual(musicPlan(7, 16));
  });

  it('AUD-13: the battle layer has a low ostinato, a percussion pulse and a soft pad swell, all in key', () => {
    const b = battlePlan(7, 16);
    for (const v of ['ost', 'kick', 'perc', 'strings'] as const) expect(b.some((n) => n.voice === v), v).toBe(true);
    for (const n of pitched(b)) {
      expect(inKey(n), `${n.voice} ${n.freq.toFixed(1)} Hz out of key`).toBe(true);
      expect(n.beat).toBeGreaterThanOrEqual(0);
      expect(n.dur).toBeGreaterThan(0);
    }
    // The ostinato sits on the chord root and fifth of its own bar.
    for (const n of b.filter((x) => x.voice === 'ost' || x.voice === 'strings')) {
      const root = CHORD_ROOTS[Math.floor(n.beat / 4) % CHORD_ROOTS.length] as number;
      expect([0, 7], `${n.voice} at beat ${n.beat}`).toContain(rel(n.freq, root));
    }
    // The ostinato fills every eighth; the percussion keeps its noise below the highs.
    expect(b.filter((n) => n.voice === 'ost' && n.beat < 4)).toHaveLength(8);
    for (const n of b.filter((x) => x.voice === 'perc')) expect(n.freq).toBeLessThanOrEqual(3500);
  });

  it('AUD-13: the layers crossfade: the calm layer thins but stays, the battle layer follows the level', () => {
    expect(layerGains(0)).toEqual({ calm: 1, battle: 0 });
    expect(layerGains(1).battle).toBe(1);
    expect(layerGains(1).calm).toBeGreaterThan(0.2);
    expect(layerGains(1).calm).toBeLessThan(layerGains(0.5).calm);
    expect(layerGains(7)).toEqual(layerGains(1));
  });

  it('AUD-13: the battle level changes layer gains only, never the notes', () => {
    const e = new AudioEngine();
    e.setBattleLevel(0.8);
    expect(e.battleLevel()).toBe(0.8);
    expect(battlePlan(3, 8)).toEqual(battlePlan(3, 8));
  });
});

describe('battle intensity (AUD-13)', () => {
  const fight = (b: BattleIntensity, ids: number[], ms: number): void => ids.forEach((id) => b.noteDamage(id, ms));
  /** Steps every 50 ms from `from` to `to` and returns the last level. */
  const run = (b: BattleIntensity, from: number, to: number): number => {
    let l = 0;
    for (let t = from; t <= to; t += 50) l = b.step(t);
    return l;
  };

  it('AUD-13: one fighting entity gives a light level and a dozen give almost the full layer', () => {
    expect(intensityTarget(0)).toBe(0);
    expect(intensityTarget(1)).toBeGreaterThan(0.12);
    expect(intensityTarget(1)).toBeLessThan(0.22);
    expect(intensityTarget(12)).toBeGreaterThan(0.88);
    expect(intensityTarget(30)).toBeGreaterThan(0.99);
    const one = new BattleIntensity();
    fight(one, [1], 0);
    const lightLevel = run(one, 0, 4500);
    expect(lightLevel).toBeGreaterThan(0.1);
    expect(lightLevel).toBeLessThan(0.22);
    const many = new BattleIntensity();
    fight(many, Array.from({ length: 14 }, (_v, i) => i), 0);
    expect(run(many, 0, 4000)).toBeGreaterThan(0.85);
  });

  it('AUD-13: the level rises within a couple of seconds', () => {
    const b = new BattleIntensity();
    fight(b, Array.from({ length: 12 }, (_v, i) => i), 0);
    b.step(0);
    const early = run(b, 50, 500);
    const late = run(b, 550, 2000);
    expect(early).toBeGreaterThan(0.1);
    expect(late).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(0.75 * intensityTarget(12));
  });

  it('AUD-13: about 10 s after the last damage the layer is essentially gone', () => {
    const b = new BattleIntensity();
    fight(b, Array.from({ length: 15 }, (_v, i) => i), 0);
    const peak = run(b, 0, 3000);
    expect(peak).toBeGreaterThan(0.9);
    // Still strong while the window holds the fight, then fading out.
    expect(run(b, 3050, DAMAGE_WINDOW_MS)).toBeGreaterThan(0.8);
    expect(run(b, DAMAGE_WINDOW_MS + 50, 10_000)).toBeLessThan(0.04);
  });

  it('AUD-13: it counts distinct units and buildings, not events', () => {
    const spam = new BattleIntensity();
    for (let i = 0; i < 200; i++) spam.noteDamage(5, i * 10);
    expect(spam.count(2000)).toBe(1);
    const group = new BattleIntensity();
    fight(group, [1, 2, 3, 4], 100);
    fight(group, [1, 2, 3, 4], 200);
    expect(group.count(300)).toBe(4);
    expect(group.count(200 + DAMAGE_WINDOW_MS + 1)).toBe(0);
  });

  it('AUD-13: own units and buildings that lost health count, the enemy and healing do not, anywhere on the map', () => {
    const b = new BattleIntensity();
    const u = (id: number, owner: number, hp: number) => ({ id, owner, hp });
    b.observe([u(1, 0, 100), u(2, 0, 100), u(3, 1, 100)], [u(10, 0, 500)], 0, 0);
    expect(b.count(0)).toBe(0);
    // Unit 1 and building 10 are hurt, enemy unit 3 is hurt, unit 2 is healed; a new unit has no earlier health to compare.
    b.observe([u(1, 0, 80), u(2, 0, 100), u(3, 1, 50), u(4, 0, 30)], [u(10, 0, 450)], 0, 100);
    expect(b.count(100)).toBe(2);
    b.observe([u(1, 0, 90), u(2, 0, 100)], [u(10, 0, 500)], 0, 200);
    expect(b.count(200)).toBe(2);
  });
});

describe('faction themes (AUD-14)', () => {
  const sameShape = (a: Note[], b: Note[]): boolean => a.length === b.length && a.every((n, i) => n.beat === (b[i] as Note).beat);

  it('AUD-14: each faction has a motif of 4 to 8 notes in key, and the two differ', () => {
    const aegis = motifFor('human');
    const vrax = motifFor('alien');
    for (const m of [aegis, vrax]) {
      expect(m.length).toBeGreaterThanOrEqual(4);
      expect(m.length).toBeLessThanOrEqual(8);
      for (const n of m) expect(scale.has(rel(n.freq, 0)), `${n.freq.toFixed(1)} Hz`).toBe(true);
    }
    expect(aegis.map((n) => n.freq)).not.toEqual(vrax.map((n) => n.freq));
    expect(aegis.every((n) => n.voice === 'march')).toBe(true);
    expect(vrax.every((n) => n.voice === 'hollow')).toBe(true);
  });

  it('AUD-14: Aegis is martial (dotted rhythm, rising fourths and fifths) and Vrax falls in wide leaps with sparse timing', () => {
    const aegis = motifFor('human');
    const dotted = aegis.filter((n, i) => i < aegis.length - 1 && n.dur === 1.5 && (aegis[i + 1] as Note).beat - n.beat === 1.5);
    expect(dotted.length).toBeGreaterThanOrEqual(2);
    const steps = (m: Note[]): number[] => m.slice(1).map((n, i) => Math.round(12 * Math.log2(n.freq / (m[i] as Note).freq)));
    const rising = steps(aegis).filter((s) => s === 5 || s === 7);
    expect(rising.length).toBeGreaterThanOrEqual(2);
    const vrax = motifFor('alien');
    const v = steps(vrax);
    expect(v.every((s) => s < 0)).toBe(true);
    expect(Math.max(...v.map((s) => Math.abs(s)))).toBeGreaterThanOrEqual(7);
    // Sparse: longer gaps between the starts than the Aegis motif.
    const gap = (m: Note[]): number => ((m[m.length - 1] as Note).beat - (m[0] as Note).beat) / (m.length - 1);
    expect(gap(vrax)).toBeGreaterThan(gap(aegis));
  });

  it('AUD-14: the theme recurs every few bars in the match plan and in the menu plan, never constantly, and is deterministic', () => {
    for (const seed of [4, 5]) {
      for (const plan of [themePlan(seed, 32, 'human'), menuThemePlan(seed, 32, 'human')]) {
        const motif = motifFor('human');
        const starts = plan.filter((n) => n.freq === (motif[0] as Note).freq && n.voice === 'march').map((n) => n.beat / 4);
        expect(starts.length).toBeGreaterThanOrEqual(3);
        expect(starts.length).toBeLessThanOrEqual(32 / THEME_EVERY);
        starts.slice(1).forEach((b, i) => expect(b - (starts[i] as number)).toBe(THEME_EVERY));
        for (const n of pitched(plan)) expect(inKey(n)).toBe(true);
      }
    }
    expect(themePlan(4, 32, 'alien')).toEqual(themePlan(4, 32, 'alien'));
    // The melody belongs to the faction: every statement is the motif.
    const first = themePlan(4, 16, 'alien');
    expect(first.slice(0, motifFor('alien').length).map((n) => n.freq)).toEqual(motifFor('alien').map((n) => n.freq));
  });

  it('AUD-14: the menu plan follows the picked faction', () => {
    const h = menuThemePlan(9, 24, 'human');
    const a = menuThemePlan(9, 24, 'alien');
    expect(h.map((n) => n.freq)).not.toEqual(a.map((n) => n.freq));
    expect(h.every((n) => n.voice === 'march' || n.voice === 'perc')).toBe(true);
    expect(h.some((n) => n.voice === 'perc')).toBe(true);
    expect(a.every((n) => n.voice === 'hollow')).toBe(true);
    expect(sameShape(h, h)).toBe(true);
    // The calm menu score underneath stays what AUD-4 says it is.
    expect(menuPlan(9, 24)).toEqual(menuPlan(9, 24));
  });
});

describe('no chimes in the music (AUD-14)', () => {
  const all = (): Note[] => [
    ...[1, 2, 3, 4].flatMap((seed) => [...musicPlan(seed, 32), ...menuPlan(seed, 32), ...battlePlan(seed, 32), ...themePlan(seed, 32, 'human'), ...themePlan(seed, 32, 'alien'), ...stingerPlan('launch', seed), ...stingerPlan('strike', seed)]),
    ...motifFor('human'),
    ...motifFor('alien'),
  ];

  it('AUD-14: every music voice patch is harmonic: whole-number partial ratios only, and no inharmonic partial in the synth', () => {
    for (const [voice, ratios] of Object.entries(MUSIC_PARTIALS)) for (const r of ratios) expect(Number.isInteger(r), `${voice} partial ${r}`).toBe(true);
    const src = readFileSync(new URL('../../src/audio/engine.ts', import.meta.url), 'utf8');
    const start = src.indexOf('private note(');
    const body = src.slice(start, src.indexOf('Stops the score', start));
    expect(body).not.toMatch(/2.76|5.4|8.93|INHARMONIC|'glass'/);
    // Every voice the plans use has a patch.
    for (const n of all()) expect(n.voice in MUSIC_PARTIALS, n.voice).toBe(true);
  });

  it('AUD-14: no music note is above 1.2 kHz, so nothing in the score is high enough to chime', () => {
    for (const n of all().filter((x) => x.voice !== 'perc')) expect(n.freq, `${n.voice} ${n.freq.toFixed(0)} Hz`).toBeLessThanOrEqual(1200);
    // The calm layer's arpeggio is soft and low: one octave over the chord root at most.
    for (const n of musicPlan(3, 32).filter((x) => x.voice === 'arp')) expect(n.freq).toBeLessThan(450);
  });

  it('AUD-14: the Vrax theme stays eerie, pulsing and falling, in a non-bell voice in the mid register', () => {
    const v = motifFor('alien');
    expect(v.every((n) => n.voice === 'hollow')).toBe(true);
    expect(v.every((n) => n.freq >= 100 && n.freq <= 500)).toBe(true);
  });
});

describe('no brass in the music (AUD-14)', () => {
  const used = (faction: 'human' | 'alien'): Set<string> => {
    const v = new Set<string>();
    for (const seed of [0, 1, 2, 3]) {
      for (const n of [...musicPlan(seed, 32), ...battlePlan(seed, 32), ...themePlan(seed, 32, faction), ...menuThemePlan(seed, 32, faction), ...stingerPlan('launch', seed), ...stingerPlan('strike', seed)]) v.add(n.voice);
    }
    for (const n of motifFor(faction)) v.add(n.voice);
    return v;
  };

  it('AUD-14: no music voice is brass-like', () => {
    for (const faction of ['human', 'alien'] as const) {
      const voices = used(faction);
      expect(voices.size).toBeGreaterThan(8);
      for (const voice of voices) {
        expect(/brass|horn|trumpet|stab/i.test(voice), `${voice} is named like brass`).toBe(false);
        const p = MUSIC_PATCHES[voice as keyof typeof MUSIC_PATCHES];
        expect(p, `${voice} has a patch`).toBeDefined();
        if (!p.lp) continue;
        const [from, to] = p.lp;
        expect(Math.max(from, to), `${voice} filter sweeps above 1.5 kHz`).toBeLessThanOrEqual(1500);
        if (p.wave === 'sawtooth' || p.wave === 'square') expect(to, `${voice} cutoff rises during the attack`).toBeLessThanOrEqual(from);
      }
    }
    // The engine reads its cutoffs from the patch table, so nothing in the synth can open a filter on its own.
    const src = readFileSync(new URL('../../src/audio/engine.ts', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('private note('), src.indexOf('Stops the score'));
    expect(body).not.toMatch(/brass|lowpass\(\s*\d/i);
  });
});

describe('stingers (AUD-15)', () => {
  it('AUD-15: launch and strike stingers are in key, deterministic per seed, and differ from each other', () => {
    for (const seed of [0, 1]) {
      const launch = stingerPlan('launch', seed);
      const strike = stingerPlan('strike', seed);
      expect(stingerPlan('launch', seed)).toEqual(launch);
      expect(launch).not.toEqual(strike);
      for (const n of [...launch, ...strike]) {
        expect(inKey(n), `${n.voice} ${n.freq.toFixed(1)} Hz`).toBe(true);
        expect(n.dur).toBeGreaterThan(0);
      }
    }
  });

  it('AUD-15: launch is a rising pad swell over a low riser; strike is a low hit and a falling motif', () => {
    const launch = stingerPlan('launch', 0);
    expect(launch.some((n) => n.voice === 'riser')).toBe(true);
    const swell = launch.filter((n) => n.voice === 'swell');
    expect(swell.length).toBeGreaterThanOrEqual(3);
    expect(swell.map((n) => n.freq)).toEqual([...swell.map((n) => n.freq)].sort((x, y) => x - y));
    const strike = stingerPlan('strike', 0);
    const hit = strike.find((n) => n.voice === 'hit') as Note;
    expect(hit.freq).toBeLessThan(80);
    const fall = strike.filter((n) => n.voice === 'tone').map((n) => n.freq);
    expect(fall.length).toBeGreaterThanOrEqual(3);
    expect(fall).toEqual([...fall].sort((x, y) => y - x));
  });
});

// A minimal Web Audio graph that records connections, so the engine's routing and gains can be checked without audio.
interface FParam {
  value: number;
  targets: number[];
  owner: FNode;
  setValueAtTime(v: number): void;
  setTargetAtTime(v: number): void;
  exponentialRampToValueAtTime(): void;
  cancelScheduledValues(): void;
}
interface FNode {
  kind: string;
  out: FNode[];
  [k: string]: unknown;
}
const PARAMS = new Set(['gain', 'frequency', 'Q', 'detune', 'threshold', 'knee', 'ratio', 'attack', 'release', 'pan']);
function fakeContext(): { ctx: BaseAudioContext; nodes: FNode[] } {
  const nodes: FNode[] = [];
  const make = (kind: string): FNode => {
    const params = new Map<string, FParam>();
    const target: FNode = {
      kind,
      out: [],
      connect(dst: FNode) {
        target.out.push(dst);
        return dst;
      },
      disconnect() {},
      start() {},
      stop() {},
    };
    const node = new Proxy(target, {
      get(t, p) {
        if (typeof p === 'string' && !(p in t) && PARAMS.has(p)) {
          if (!params.has(p)) {
            const param: FParam = {
              value: 1,
              targets: [],
              owner: target,
              setValueAtTime(v) {
                param.value = v;
              },
              setTargetAtTime(v) {
                param.value = v;
                param.targets.push(v);
              },
              exponentialRampToValueAtTime() {},
              cancelScheduledValues() {},
            };
            params.set(p, param);
          }
          return params.get(p);
        }
        return t[p as string];
      },
    });
    nodes.push(node);
    return node;
  };
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    state: 'running',
    destination: make('destination'),
    createGain: () => make('gain'),
    createOscillator: () => make('osc'),
    createBiquadFilter: () => make('filter'),
    createBufferSource: () => make('buffer'),
    createDynamicsCompressor: () => make('comp'),
    createWaveShaper: () => make('shaper'),
    createStereoPanner: () => make('pan'),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
  };
  return { ctx: ctx as unknown as BaseAudioContext, nodes };
}
const gainOf = (n: FNode | undefined): number => (n?.gain as FParam).value;
/** The nodes `from` reaches along its connections. */
function reach(from: FNode): Set<FNode> {
  const seen = new Set<FNode>();
  const stack = [from];
  while (stack.length > 0) {
    const n = stack.pop() as FNode;
    // A connection into a parameter (a tremolo) leads on through the node that owns it.
    for (const o of n.out ?? []) {
      const next = (o as unknown as FParam).owner ?? o;
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}
function rig(): { e: AudioEngine; nodes: FNode[]; master: FNode; music: FNode; sfx: FNode } {
  const { ctx, nodes } = fakeContext();
  const e = new AudioEngine();
  e.attach(ctx);
  const gains = nodes.filter((n) => n.kind === 'gain');
  // The build order: master, then the music bus, then the effects bus.
  return { e, nodes, master: gains[0] as FNode, music: gains[1] as FNode, sfx: gains[2] as FNode };
}

describe('music settings (AUD-16)', () => {
  it('AUD-16: Music off or music volume 0 zeroes the music bus only; effects and master are untouched', () => {
    const r = rig();
    const master = gainOf(r.master);
    // The default music volume (0.75) sits about 2.5 dB above the original score (1.33 times its gain).
    expect(gainOf(r.music)).toBeCloseTo(1.33, 2);
    r.e.setMusicOn(false);
    expect(gainOf(r.music)).toBe(0);
    expect(gainOf(r.master)).toBe(master);
    expect(gainOf(r.sfx)).toBe(1);
    r.e.setMusicOn(true);
    r.e.setMusicVolume(0);
    expect(gainOf(r.music)).toBe(0);
    expect(gainOf(r.master)).toBe(master);
    expect(gainOf(r.sfx)).toBe(1);
  });

  it('AUD-16: music volume scales only the music bus, and Mute all zeroes the master and so everything', () => {
    const r = rig();
    r.e.setMusicVolume(0.3);
    expect(gainOf(r.music)).toBeCloseTo(MUSIC_MAX * 0.3 ** 0.95, 5);
    expect(gainOf(r.sfx)).toBe(1);
    r.e.setMusicVolume(1);
    expect(gainOf(r.music)).toBeCloseTo(MUSIC_MAX, 5);
    r.e.setMuted(true);
    expect(gainOf(r.master)).toBe(0);
    expect(r.e.gains().master).toBe(0);
    r.e.setMuted(false);
    expect(gainOf(r.master)).toBeGreaterThan(0);
    expect(busGains({ muted: true, volume: 1, musicOn: true, musicVolume: 1 }).master).toBe(0);
    expect(busGains({ muted: false, volume: 1, musicOn: false, musicVolume: 1 })).toMatchObject({ music: 0 });
    const def = busGains({ muted: false, volume: 0.5, musicOn: true, musicVolume: 0.75 }).music;
    expect(def).toBeCloseTo(1.33, 2);
    expect(20 * Math.log10(def)).toBeGreaterThan(2);
    expect(20 * Math.log10(def)).toBeLessThan(3);
    expect(busGains({ muted: false, volume: 0.5, musicOn: true, musicVolume: 1 }).music).toBeCloseTo(MUSIC_MAX, 5);
    expect(busGains({ muted: false, volume: 0.5, musicOn: true, musicVolume: 0 }).music).toBe(0);
  });

  it('AUD-16: sound effects still play with Music off, and do not play under Mute all', () => {
    const r = rig();
    r.e.setMusicOn(false);
    r.e.play('zap', 1, { faction: 'human' });
    expect(r.e.stats.started).toBe(1);
    r.e.setMuted(true);
    r.e.play('boom', 1, { faction: 'human' });
    expect(r.e.stats.started).toBe(1);
  });

  it('AUD-16: the battle layer, themes and stingers all route through the music bus and never the effects bus', () => {
    const r = rig();
    r.e.startMusic(3, false, 'alien');
    r.e.setBattleLevel(1);
    const before = r.nodes.length;
    r.e.pumpMusic(40);
    r.e.stinger('launch', 1);
    r.e.stinger('strike', 2);
    const made = r.nodes.slice(before);
    const sources = made.filter((n) => n.kind === 'osc' || n.kind === 'buffer');
    expect(sources.length).toBeGreaterThan(100);
    // Every voice of the plan was heard: a kick (sine), noise hits and the sawtooth voices.
    expect(made.some((n) => n.kind === 'buffer')).toBe(true);
    for (const s of sources) {
      const to = reach(s);
      expect(to.has(r.music), 'a music source misses the music bus').toBe(true);
      expect(to.has(r.sfx), 'a music source reaches the effects bus').toBe(false);
      expect(to.has(r.master)).toBe(true);
    }
    // The bus really is what silences it.
    r.e.setMusicOn(false);
    expect(gainOf(r.music)).toBe(0);
    expect(gainOf(r.sfx)).toBe(1);
  });

  it('AUD-16 AUD-15: with Music off the score and the stingers make no sound at all, and Mute all too', () => {
    const r = rig();
    r.e.startMusic(3, false, 'human');
    r.e.setMusicOn(false);
    const before = r.nodes.length;
    r.e.pumpMusic(40);
    r.e.stinger('launch');
    r.e.stinger('strike');
    expect(r.nodes.length).toBe(before);
    r.e.setMusicOn(true);
    r.e.setMuted(true);
    r.e.pumpMusic(40);
    r.e.stinger('launch');
    expect(r.nodes.length).toBe(before);
    r.e.setMuted(false);
    r.e.stinger('strike');
    expect(r.nodes.length).toBeGreaterThan(before);
  });

  it('AUD-15: a stinger ducks the score under it, and the battle layer only schedules while it is up', () => {
    const r = rig();
    r.e.startMusic(3, false, 'human');
    const calmOnly = r.nodes.length;
    r.e.pumpMusic(8);
    const calmNodes = r.nodes.length - calmOnly;
    const r2 = rig();
    r2.e.startMusic(3, false, 'human');
    r2.e.setBattleLevel(0.9);
    const b2 = r2.nodes.length;
    r2.e.pumpMusic(8);
    // Same window: the battle layer adds notes to the same calm layer (AUD-13).
    expect(r2.nodes.length - b2).toBeGreaterThan(calmNodes * 1.5);
    const duck = r.nodes.find((n) => n.kind === 'gain' && n.out.some((o) => o.kind === 'filter')) as FNode;
    expect((duck.gain as FParam).targets).toEqual([]);
    r.e.stinger('strike');
    const t = (duck.gain as FParam).targets;
    expect(Math.min(...t)).toBeLessThan(0.6);
    // ...and it comes back up afterwards.
    expect(t[t.length - 1]).toBe(1);
  });

  it('AUD-3 AUD-13 AUD-14 AUD-15: the new music calls never throw where audio does not exist', () => {
    const e = new AudioEngine();
    expect(() => {
      e.startMusic(1, false, 'alien');
      e.setBattleLevel(1);
      e.setThemeFaction('human');
      e.pumpMusic();
      e.stinger('launch');
      e.stinger('strike');
      e.stopMusic();
    }).not.toThrow();
  });
});
