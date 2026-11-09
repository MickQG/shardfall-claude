import type { Faction } from '../data/defs';
import { battlePlan, menuPlan, MUSIC_PATCHES, menuThemePlan, musicPlan, stingerPlan, themePlan, type Note } from './plan';
import { busGains, layerGains } from './mix';
import { ackRecipe, allocateVoice, MOVE_CLASSES, MOVE_LOOPS, moveLoopSamples, recipeFor, sizeMods, Variation, type AmbienceMix, type FilterSpec, type Layer, type MoveClass, type Recipe, type SoundName, type VoiceInfo } from './recipes';

type Name = SoundName;

/** Where and how a world sound plays (AUD-5, AUD-6, AUD-9). */
export interface PlayOpts {
  /** The palette: Aegis (human) or Vrax (alien). */
  faction?: Faction;
  /** Relative size of an explosion (1 = a normal shell). */
  size?: number;
  /** Stereo pan, -1 (left) to +1 (right). */
  pan?: number;
  /** Distance falloff, 0..1 (1 = in the middle of the screen). */
  near?: number;
}

interface Voice extends VoiceInfo {
  gain: GainNode;
  sources: AudioScheduledSourceNode[];
}

interface Loop {
  gain: GainNode;
  nodes: AudioScheduledSourceNode[];
  /** Since when the loop has been silent, context time, or null while it sounds. */
  quietSince: number | null;
}

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));
/** Seconds of silence before a movement loop is torn down. */
const LOOP_IDLE = 4;

/** A soft knee just below full scale: nothing leaves the engine above 1.0, however many sounds pile up (AUD-12). */
/** The limiter's settings (AUD-12): threshold, dB, and ratio, with a hard knee. */
const LIMIT_DB = -6;
const LIMIT_RATIO = 20;
/**
 * The make-up gain a DynamicsCompressor applies to everything it passes (Web Audio: the reciprocal of its gain at full
 * scale, to the power 0.6). Hover and click skip the limiter (AUD-11), so they take this gain themselves and keep their level.
 */
export const LIMITER_MAKEUP = (1 / 10 ** ((LIMIT_DB - LIMIT_DB / LIMIT_RATIO) / 20)) ** 0.6;
/** The UI sounds that answer the pointer itself and so must start at once (AUD-11). */
const INSTANT: ReadonlySet<string> = new Set(['hover', 'click']);

function limiterCurve(): Float32Array {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    c[i] = Math.sign(x) * (a < 0.9 ? a : 0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1));
  }
  return c;
}

/**
 * Procedural audio: every sound is synthesised from oscillators and filtered noise, so there are no audio assets.
 * Safe where audio does not exist (tests, blocked autoplay): every method silently does nothing.
 */
export class AudioEngine {
  private ctx: BaseAudioContext | null = null;
  /** True for an offline context (tests render a battle to a buffer): it is never "running" in the live sense. */
  private offline = false;
  private master: GainNode | null = null;
  /** The music bus under the master (MENU-15): music on/off and music volume act here, so sound effects are not touched. */
  private musicOut: GainNode | null = null;
  /** The effects bus under the master, beside the music bus: every world, UI, movement and ambience sound goes through it. */
  private sfx: GainNode | null = null;
  /** Hover and click (AUD-11): straight to the speakers after Master volume, past the limiter and its look-ahead, so they sound the instant the pointer arrives. */
  private uiOut: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private recent = new Map<string, number[]>();
  private voices: Voice[] = [];
  private loops = new Map<MoveClass, Loop>();
  private ambience: { water: GainNode; rumble: GainNode } | null = null;
  private vary = new Variation(0x5eed);
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicLive = false;
  private musicMenu = false;
  private musicBeat = 0;
  private nextBeatTime = 0;
  /** The score by half-beat slot: calm layer, battle layer (AUD-13) and the faction theme (AUD-14). */
  private calm = new Map<number, Note[]>();
  private battle = new Map<number, Note[]>();
  private theme = new Map<number, Note[]>();
  private themeFaction: Faction = 'human';
  private pendingTheme: Faction | null = null;
  private musicSeed = 0;
  private bus: GainNode | null = null;
  private calmBus: GainNode | null = null;
  private battleBus: GainNode | null = null;
  /** Ducks the score under a stinger (AUD-15). */
  private duck: GainNode | null = null;
  private stingerBus: GainNode | null = null;
  private level = 0;
  private appliedLevel = -1;
  muted = false;
  volume = 0.6;
  musicOn = true;
  musicVolume = 0.75;
  /** Turn off the per-name rate limit (a test that wants the densest possible battle). */
  limitRate = true;
  /** Counts for tests: plays asked for by key, started, and dropped by the voice budget. */
  stats = { requested: {} as Record<string, number>, started: 0, dropped: 0 };

  /**
   * Set up audio ahead of time, suspended: opening the audio device takes the main thread a noticeable moment, so it
   * happens while the game loads rather than on the player's first click.
   */
  prepare(): void {
    try {
      this.open();
    } catch {
      this.ctx = null;
    }
  }

  /** Call from a user gesture: browsers keep audio suspended until then. */
  unlock(): void {
    try {
      if (!this.open()) return;
      void (this.ctx as AudioContext).resume();
      this.apply();
    } catch {
      this.ctx = null;
    }
  }

  /** Use a given context (an OfflineAudioContext, to render a battle to a buffer in a test) instead of opening one. */
  attach(ctx: BaseAudioContext): void {
    this.offline = true;
    this.build(ctx);
    this.apply();
  }

  /** Open the audio context (once), with its master chain and noise buffer; false where audio does not exist. */
  private open(): boolean {
    if (typeof AudioContext === 'undefined') return false;
    if (!this.ctx) this.build(new AudioContext());
    return true;
  }

  /**
   * The graph: effects bus and music bus into the master gain, then a limiter (a fast, high-ratio compressor with its
   * threshold at -6 dB) and a soft clip, then the speakers (AUD-12).
   */
  private build(ctx: BaseAudioContext): void {
    this.ctx = ctx;
    this.master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = LIMIT_DB;
    limiter.knee.value = 0;
    limiter.ratio.value = LIMIT_RATIO;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    const clip = ctx.createWaveShaper();
    clip.curve = limiterCurve() as Float32Array<ArrayBuffer>;
    this.master.connect(limiter).connect(clip).connect(ctx.destination);
    this.musicOut = ctx.createGain();
    this.musicOut.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.uiOut = ctx.createGain();
    this.uiOut.gain.value = LIMITER_MAKEUP;
    this.uiOut.connect(ctx.destination);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let s = 1;
    for (let i = 0; i < len; i++) {
      s = (s * 16807) % 2147483647;
      d[i] = (s / 2147483647) * 2 - 1;
    }
  }

  /** Whether sound can be scheduled right now: a context still waiting for the first click would play it all at once on resume. */
  private live(): boolean {
    const c = this.ctx;
    return !!c && !!this.master && !!this.sfx && (this.offline || c.state === 'running');
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.apply();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.apply();
  }

  setMusicOn(on: boolean): void {
    this.musicOn = on;
    this.apply();
  }

  setMusicVolume(v: number): void {
    this.musicVolume = Math.max(0, Math.min(1, v));
    this.apply();
  }

  /** The gains the buses are set to (AUD-16), for tests and the debug hook. */
  gains(): { master: number; music: number } {
    return busGains(this);
  }

  private apply(): void {
    if (!this.ctx) return;
    const g = busGains(this);
    // Mute all and Master volume act on the master (everything); Music off and Music volume act on the music bus only.
    if (this.master) this.master.gain.setTargetAtTime(g.master, this.ctx.currentTime, 0.02);
    if (this.musicOut) this.musicOut.gain.setTargetAtTime(g.music, this.ctx.currentTime, 0.02);
    // The UI path skips the limiter, so it takes the limiter's make-up gain too and sounds as loud as before.
    if (this.uiOut) this.uiOut.gain.setTargetAtTime(g.master * LIMITER_MAKEUP, this.ctx.currentTime, 0.02);
  }

  private count(key: string): void {
    this.stats.requested[key] = (this.stats.requested[key] ?? 0) + 1;
  }

  /**
   * Plays a named sound; rate-limited per name so a big fight is loud but not a wall of clicks. World sounds take the
   * faction palette, size, pan and distance falloff in `o` (AUD-5, AUD-6, AUD-9).
   */
  play(name: Name, gain = 1, o: PlayOpts = {}): void {
    try {
      this.count(name);
      const recipe = recipeFor(name, o.faction);
      if (recipe) this.render(`${o.faction ?? 'ui'}:${name}`, recipe, gain, o, name === 'zap' || name === 'slash' || name === 'pop' ? 3 : 2, INSTANT.has(name));
    } catch {
      /* audio must never break the game */
    }
  }

  /** The non-voice acknowledgement of a unit kind (AUD-7): a short "select" or a different "command" sound. */
  ack(kind: string, mode: 'select' | 'command', gain = 1): void {
    try {
      this.count(`ack:${mode}:${kind}`);
      const recipe = ackRecipe(kind, mode);
      if (recipe) this.render(`ack:${mode}:${kind}`, recipe, gain, {}, 1);
    } catch {
      /* audio must never break the game */
    }
  }

  /** Builds one play of a recipe: rate limit, voice budget, variation, then the nodes. */
  private render(key: string, recipe: Recipe, gain: number, o: PlayOpts, perWindow: number, instant = false): void {
    const c = this.ctx;
    if (!c || this.muted || !this.live() || !this.sfx) return;
    const now = c.currentTime;
    if (this.limitRate) {
      const r = (this.recent.get(key) ?? []).filter((t) => now - t < 0.12);
      if (r.length >= perWindow) {
        this.recent.set(key, r);
        return;
      }
      r.push(now);
      this.recent.set(key, r);
    }
    const v = this.vary.next(key);
    const sm = sizeMods(o.size ?? 1);
    const level = gain * sm.gain * v.gain;
    const loud = level * (o.near ?? 1);
    // The voice budget (AUD-12): at most 24 at once; when full the quietest or farthest goes first.
    this.voices = this.voices.filter((x) => x.end > now);
    const al = allocateVoice(this.voices, loud, now);
    if (al.kind === 'drop') {
      this.stats.dropped++;
      return;
    }
    if (al.kind === 'steal') {
      const [victim] = this.voices.splice(al.index, 1);
      if (victim) this.silence(victim, now);
    }
    // Hover and click start now, with no variation delay, and skip the limiter's look-ahead (AUD-11).
    const t0 = instant ? now : now + 0.001 + v.delay;
    const out = instant && this.uiOut ? this.uiOut : this.sfx;
    const vg = c.createGain();
    vg.gain.value = loud;
    let pan: StereoPannerNode | null = null;
    if (typeof c.createStereoPanner === 'function') {
      pan = c.createStereoPanner();
      pan.pan.value = clamp1(o.pan ?? 0);
      vg.connect(pan).connect(out);
    } else vg.connect(out);
    const sources: AudioScheduledSourceNode[] = [];
    let end = t0;
    let last: AudioScheduledSourceNode | null = null;
    for (const l of recipe.layers) {
      const e = this.layer(l, t0, v.pitch * sm.pitch, sm.time, vg, sources);
      if (e > end) {
        end = e;
        last = sources[sources.length - 1] ?? last;
      }
    }
    // Let go of the whole chain when its last sound has died away.
    if (last) {
      last.onended = () => {
        vg.disconnect();
        pan?.disconnect();
      };
    }
    this.voices.push({ end, loud, gain: vg, sources });
    this.stats.started++;
  }

  /** Cuts a voice short (a steal) without a click: a quick fade, then its sources stop. */
  private silence(v: Voice, now: number): void {
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0, now, 0.008);
      for (const s of v.sources) s.stop(now + 0.05);
    } catch {
      /* already stopped */
    }
  }

  /** One layer of a recipe as nodes; returns when it ends. */
  private layer(l: Layer, t0: number, pitch: number, time: number, out: AudioNode, sources: AudioScheduledSourceNode[]): number {
    const c = this.ctx as BaseAudioContext;
    const at = t0 + l.at * time;
    const dur = l.dur * time;
    const stop = at + dur + 0.02;
    // The amplitude envelope: a fast attack to the peak, then an exponential decay.
    const env = c.createGain();
    const a = Math.min(l.attack ?? 0.004, dur / 3);
    // Narrow bandpass noise is thin: lift it so a recipe's level means the sound heard, not the signal before filtering.
    const f0 = l.filters?.[0];
    const boost = l.src === 'noise' && f0?.type === 'bandpass' ? Math.max(1, Math.min(5, 0.25 * Math.sqrt(c.sampleRate / 2 / (f0.f / f0.q)))) : 1;
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(l.gain * boost, at + a);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    let tail: AudioNode = env;
    if (l.trill) {
      const tg = c.createGain();
      tg.gain.value = 0.5;
      const lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = l.trill;
      lg.gain.value = 0.5;
      lfo.connect(lg).connect(tg.gain);
      lfo.start(at);
      lfo.stop(stop);
      sources.push(lfo);
      env.connect(tg);
      tail = tg;
    }
    tail.connect(out);
    // The signal path into the envelope: the source through its filters (in parallel when there are several).
    const head = (src: AudioNode): void => {
      if (!l.filters || l.filters.length === 0) {
        src.connect(env);
        return;
      }
      for (const f of l.filters) src.connect(this.filter(f, at, dur, pitch)).connect(env);
    };
    if (l.src === 'noise') {
      const s = c.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      head(s);
      s.start(at, this.vary.float() * 0.5);
      s.stop(stop);
      sources.push(s);
    } else {
      const ratios = l.ratios ?? [1];
      const total = ratios.reduce((sum, _r, i) => sum + 1 / (1 + 0.8 * i), 0);
      let wob: GainNode | null = null;
      if (l.wobble) {
        const lfo = c.createOscillator();
        wob = c.createGain();
        lfo.frequency.value = l.wobble.rate;
        wob.gain.value = l.wobble.depth * pitch;
        lfo.connect(wob);
        lfo.start(at);
        lfo.stop(stop);
        sources.push(lfo);
      }
      ratios.forEach((r, i) => {
        const o = c.createOscillator();
        o.type = l.wave ?? 'sine';
        const f = (l.freq ?? 440) * r * pitch;
        o.frequency.setValueAtTime(f, at);
        if (l.to !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, l.to * r * pitch), at + dur);
        wob?.connect(o.frequency);
        const pg = c.createGain();
        pg.gain.value = 1 / (1 + 0.8 * i) / total;
        o.connect(pg);
        head(pg);
        o.start(at);
        o.stop(stop);
        sources.push(o);
      });
    }
    return stop;
  }

  private filter(f: FilterSpec, at: number, dur: number, pitch: number): BiquadFilterNode {
    const c = this.ctx as BaseAudioContext;
    const n = c.createBiquadFilter();
    n.type = f.type;
    n.Q.value = f.q;
    n.frequency.setValueAtTime(f.f * pitch, at);
    if (f.to !== undefined) n.frequency.exponentialRampToValueAtTime(Math.max(20, f.to * pitch), at + dur);
    return n;
  }

  /**
   * Movement loops (AUD-8): one looping voice per class, whose level is `mix[class]` (0..1). A class with nothing
   * moving fades to silence and is torn down after a few seconds; there are no per-unit nodes.
   */
  setMovement(mix: Readonly<Record<MoveClass, number>>): void {
    try {
      const c = this.ctx;
      if (!c || !this.live()) return;
      const now = c.currentTime;
      for (const cls of MOVE_CLASSES) {
        const level = (mix[cls] ?? 0) * MOVE_LOOPS[cls].level;
        let loop = this.loops.get(cls);
        if (!loop && level < 0.001) continue;
        if (!loop) loop = this.startLoop(cls);
        loop.gain.gain.setTargetAtTime(level, now, 0.2);
        if (level >= 0.001) loop.quietSince = null;
        else if (loop.quietSince === null) loop.quietSince = now;
        else if (now - loop.quietSince > LOOP_IDLE) {
          for (const n of loop.nodes) n.stop();
          loop.gain.disconnect();
          this.loops.delete(cls);
        }
      }
    } catch {
      /* audio must never break the game */
    }
  }

  private startLoop(cls: MoveClass): Loop {
    const c = this.ctx as BaseAudioContext;
    const spec = MOVE_LOOPS[cls];
    // The loop is a generated sample of thumps, rumble or patters (never noise), kept below the hiss band by a low-pass.
    const samples = moveLoopSamples(cls, c.sampleRate);
    const buf = c.createBuffer(1, samples.length, c.sampleRate);
    buf.getChannelData(0).set(samples);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = spec.filter.type;
    f.frequency.value = spec.filter.f;
    f.Q.value = spec.filter.q;
    const g = c.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.sfx as GainNode);
    src.start(0, this.vary.float() * spec.period);
    const loop: Loop = { gain: g, nodes: [src], quietSince: null };
    this.loops.set(cls, loop);
    return loop;
  }

  /**
   * Ambience (AUD-10): lapping water and a distant rumble at the levels in `mix`. Both are low, slowly swaying beds (nothing
   * above about 800 Hz, and no wind), started on first use and kept running.
   */
  setAmbience(mix: Readonly<AmbienceMix>): void {
    try {
      const c = this.ctx;
      if (!c || !this.live()) return;
      if (!this.ambience) this.ambience = this.startAmbience();
      const now = c.currentTime;
      this.ambience.water.gain.setTargetAtTime(mix.water * 0.035, now, 0.5);
      this.ambience.rumble.gain.setTargetAtTime(mix.rumble * 0.055, now, 0.6);
    } catch {
      /* audio must never break the game */
    }
  }

  private startAmbience(): { water: GainNode; rumble: GainNode } {
    const c = this.ctx as BaseAudioContext;
    /** A noise bed through two cascaded low-passes (so nothing above `f` survives), its level swayed by a slow oscillator. */
    const bed = (f: number, sway: { rate: number; amp: number }): GainNode => {
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const l1 = c.createBiquadFilter();
      l1.type = 'lowpass';
      l1.frequency.value = f;
      l1.Q.value = 0.7;
      const l2 = c.createBiquadFilter();
      l2.type = 'lowpass';
      l2.frequency.value = f;
      l2.Q.value = 0.7;
      const amp = c.createGain();
      amp.gain.value = 1 - sway.amp;
      const lfo = c.createOscillator();
      lfo.frequency.value = sway.rate;
      const lg = c.createGain();
      lg.gain.value = sway.amp;
      lfo.connect(lg).connect(amp.gain);
      const out = c.createGain();
      out.gain.value = 0;
      src.connect(l1).connect(l2).connect(amp).connect(out).connect(this.sfx as GainNode);
      src.start(0, this.vary.float() * 0.5);
      lfo.start();
      return out;
    };
    return { water: bed(500, { rate: 0.3, amp: 0.7 }), rumble: bed(70, { rate: 0.5, amp: 0.3 }) };
  }

  /**
   * Starts the generative score: a calm layer and a battle layer on one beat grid, with the faction's theme woven in
   * (AUD-13, AUD-14). `menu` plays the main-menu score instead (AUD-4), which has no battle layer. Every note goes through
   * the music bus (AUD-16).
   */
  startMusic(seed: number, menu = false, faction: Faction = 'human'): void {
    try {
      const c = this.ctx;
      if (!c || !this.master || this.musicLive) return;
      this.musicLive = true;
      this.musicSeed = seed;
      this.calm = bucket(menu ? menuPlan(seed, 64) : musicPlan(seed, 64));
      this.battle = menu ? new Map() : bucket(battlePlan(seed, 64));
      this.themeFaction = faction;
      this.pendingTheme = null;
      this.theme = bucket(menu ? menuThemePlan(seed, 64, faction) : themePlan(seed, 64, faction));
      this.musicMenu = menu;
      this.musicBeat = 0;
      this.nextBeatTime = c.currentTime + 0.2;
      // calm, battle and theme -> bus -> duck -> lowpass -> music bus.
      const out = this.musicOut ?? this.master;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      lp.connect(out);
      const duck = c.createGain();
      duck.connect(lp);
      const bus = c.createGain();
      bus.gain.value = 0.35;
      bus.connect(duck);
      const calm = c.createGain();
      calm.connect(bus);
      const battle = c.createGain();
      battle.gain.value = 0;
      battle.connect(bus);
      this.bus = bus;
      this.duck = duck;
      this.calmBus = calm;
      this.battleBus = battle;
      this.level = 0;
      this.appliedLevel = -1;
      this.setBattleLevel(0);
      // An offline context is driven by `pumpMusic` directly.
      if (!this.offline) this.musicTimer = setInterval(() => this.pumpMusic(), 120);
    } catch {
      this.musicLive = false;
      this.musicTimer = null;
    }
  }

  /** The battle layer's strength, 0..1 (AUD-13): the calm layer thins and the battle layer swells with it. Only gains change, never notes. */
  setBattleLevel(level: number): void {
    try {
      const c = this.ctx;
      this.level = Math.max(0, Math.min(1, level));
      if (!c || !this.calmBus || !this.battleBus || Math.abs(this.level - this.appliedLevel) < 0.004) return;
      this.appliedLevel = this.level;
      const g = layerGains(this.level);
      this.calmBus.gain.setTargetAtTime(g.calm, c.currentTime, 0.4);
      this.battleBus.gain.setTargetAtTime(g.battle, c.currentTime, 0.25);
    } catch {
      /* audio must never break the game */
    }
  }

  /** The battle level last asked for, for tests. */
  battleLevel(): number {
    return this.level;
  }

  /** Switches the faction theme (AUD-14); the new theme takes over at the next bar. */
  setThemeFaction(faction: Faction): void {
    if (!this.musicLive) return;
    this.pendingTheme = faction === this.themeFaction ? null : faction;
  }

  /** Schedules the score that falls inside the next `horizon` seconds of context time. */
  pumpMusic(horizon = 0.6): void {
    try {
      const c = this.ctx;
      if (!c || !this.musicLive || !this.calmBus || !this.battleBus || !this.bus) return;
      if (this.muted || busGains(this).music === 0 || !this.live()) {
        this.nextBeatTime = c.currentTime + 0.2;
        return;
      }
      while (this.nextBeatTime < c.currentTime + horizon) {
        const slot = Math.round(this.musicBeat * 2) % 512;
        // A theme change waits for the bar line, so a motif in flight is never cut.
        if (slot % 8 === 0 && this.pendingTheme) {
          this.themeFaction = this.pendingTheme;
          this.pendingTheme = null;
          this.theme = bucket(this.musicMenu ? menuThemePlan(this.musicSeed, 64, this.themeFaction) : themePlan(this.musicSeed, 64, this.themeFaction));
        }
        const t = this.nextBeatTime;
        for (const n of this.calm.get(slot) ?? []) this.note(n, t, n.dur * BEAT, this.calmBus);
        for (const n of this.theme.get(slot) ?? []) this.note(n, t, n.dur * BEAT, this.bus);
        if (this.level > 0.01) for (const n of this.battle.get(slot) ?? []) this.note(n, t, n.dur * BEAT, this.battleBus);
        this.musicBeat += 0.5;
        this.nextBeatTime += 0.5 * BEAT;
      }
    } catch {
      /* audio must never break the game */
    }
  }

  /**
   * A musical stinger over the score (AUD-15) for a superweapon `launch` or `strike`: it plays on the music bus, so Music
   * off silences it, and the score ducks briefly under it.
   */
  stinger(kind: 'launch' | 'strike', seed = 0): void {
    try {
      const c = this.ctx;
      if (!c || this.muted || busGains(this).music === 0 || !this.live() || !this.musicOut) return;
      if (!this.stingerBus) {
        this.stingerBus = c.createGain();
        this.stingerBus.gain.value = 0.5;
        this.stingerBus.connect(this.musicOut);
      }
      const now = c.currentTime;
      const t0 = now + 0.03;
      let end = 0;
      for (const n of stingerPlan(kind, seed)) {
        this.note(n, t0 + n.beat * BEAT, n.dur * BEAT, this.stingerBus);
        end = Math.max(end, (n.beat + n.dur) * BEAT);
      }
      if (this.duck) {
        this.duck.gain.cancelScheduledValues(now);
        this.duck.gain.setTargetAtTime(0.35, now, 0.04);
        this.duck.gain.setTargetAtTime(1, now + end * 0.6, 0.6);
      }
    } catch {
      /* audio must never break the game */
    }
  }

  /** One note of the score as nodes, into `dest`: each voice is a small synth patch. */
  private note(n: Note, t: number, dur: number, dest: AudioNode): void {
    const c = this.ctx as BaseAudioContext;
    const f = n.freq;
    /** An amplitude envelope into `to`: a rise to `peak` over `atk`, then an exponential fall to the end. */
    const env = (peak: number, atk: number, to: AudioNode): GainNode => {
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + Math.min(atk, dur * 0.9));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(to);
      return g;
    };
    const osc = (type: OscillatorType, freq: number, to: AudioNode, slideTo?: number, slideTime = dur): OscillatorNode => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + slideTime);
      o.connect(to);
      o.start(t);
      o.stop(t + dur + 0.05);
      return o;
    };
    /** A lowpass whose cutoff sweeps from `a` to `b` over `over` seconds: a quick filter envelope. */
    const lowpass = (a: number, b: number, over: number, q: number, to: AudioNode): BiquadFilterNode => {
      const l = c.createBiquadFilter();
      l.type = 'lowpass';
      l.Q.value = q;
      l.frequency.setValueAtTime(a, t);
      l.frequency.exponentialRampToValueAtTime(b, t + Math.max(0.02, Math.min(over, dur)));
      l.connect(to);
      return l;
    };
    switch (n.voice) {
      case 'pad':
        osc('sine', f, env(0.05, 0.01, dest), undefined, dur * 1.1);
        break;
      case 'bass':
        osc('triangle', f, env(0.09, 0.01, dest));
        break;
      case 'arp':
        // A soft, low, muted pluck: a sawtooth whose cutoff closes quickly, so it never rings.
        osc('sawtooth', f, lowpass(...MUSIC_PATCHES.arp.lp!, dur, 0.7, env(0.04, 0.02, dest)));
        break;
      case 'ost':
        // A driving low pulse: a sawtooth with its cutoff closing on each eighth.
        osc('sawtooth', f, lowpass(...MUSIC_PATCHES.ost.lp!, dur, 1, env(0.085, 0.008, dest)));
        break;
      case 'kick':
        osc('sine', 120, env(0.2, 0.004, dest), 42, 0.14);
        break;
      case 'perc': {
        // Noise hits, bandpassed well below the highs and short.
        const s = c.createBufferSource();
        s.buffer = this.noise;
        s.loop = true;
        const b = c.createBiquadFilter();
        b.type = 'bandpass';
        b.frequency.value = f;
        b.Q.value = 0.8;
        s.connect(b).connect(env(f > 2000 ? 0.07 : 0.1, 0.003, dest));
        s.start(t, this.vary.float() * 0.5);
        s.stop(t + dur + 0.05);
        break;
      }
      case 'strings': {
        // A soft, sustained pad swell: two triangles, a slow attack and a gentle low-pass, no bright transient.
        const g = env(0.035, dur * 0.4, dest);
        const l = lowpass(...MUSIC_PATCHES.strings.lp!, dur * 0.5, 0.7, g);
        osc('triangle', f, l);
        osc('triangle', f, l).detune.value = 7;
        break;
      }
      case 'march': {
        // Aegis: a low, muted square pulse with a short percussive envelope and a closing low-pass.
        const g = env(0.05, 0.01, dest);
        const l = lowpass(...MUSIC_PATCHES.march.lp!, dur, 0.7, g);
        osc('square', f, l);
        break;
      }
      case 'hollow': {
        // Vrax: a dark, hollow square pad (odd harmonics, filtered) pulsed by a slow tremolo, in a mid register.
        const g = env(0.07, 0.08, dest);
        const trem = c.createGain();
        trem.gain.value = 0.5;
        trem.connect(g);
        const lfo = c.createOscillator();
        const lg = c.createGain();
        lfo.frequency.value = 5;
        lg.gain.value = 0.5;
        lfo.connect(lg).connect(trem.gain);
        lfo.start(t);
        lfo.stop(t + dur + 0.05);
        const l = lowpass(...MUSIC_PATCHES.hollow.lp!, dur, 1.2, trem);
        osc('square', f, l);
        const d = osc('square', f, l);
        d.detune.value = 11;
        break;
      }
      case 'swell':
        // A rising pad swell: a triangle with a long attack and a gentle, dark low-pass.
        osc('triangle', f, lowpass(...MUSIC_PATCHES.swell.lp!, dur * 0.9, 0.7, env(0.09, dur * 0.85, dest)));
        break;
      case 'riser':
        // A low riser: a sine gliding up an octave, in key.
        osc('sine', f, env(0.12, dur * 0.8, dest), f * 2, dur * 0.9);
        break;
      case 'tone': {
        // A falling tone figure: a low-passed triangle with a soft attack.
        const g = env(0.08, 0.03, dest);
        osc('triangle', f, lowpass(...MUSIC_PATCHES.tone.lp!, dur, 0.7, g));
        break;
      }
      case 'hit': {
        // A low hit: a falling sine and a dull noise thud.
        osc('sine', 90, env(0.4, 0.005, dest), 32, dur * 0.8);
        const s = c.createBufferSource();
        s.buffer = this.noise;
        s.loop = true;
        const l = c.createBiquadFilter();
        l.type = 'lowpass';
        l.frequency.value = 320;
        s.connect(l).connect(env(0.35, 0.004, dest));
        s.start(t, this.vary.float() * 0.5);
        s.stop(t + 0.5);
        break;
      }
    }
  }

  /** Stops the score; with `fadeSec` the music fades out first (AUD-4) and the notes already queued die away with it. */
  stopMusic(fadeSec = 0): void {
    if (!this.musicLive) return;
    this.musicLive = false;
    const timer = this.musicTimer;
    this.musicTimer = null;
    try {
      if (fadeSec > 0 && this.bus && this.ctx) {
        this.bus.gain.setTargetAtTime(0, this.ctx.currentTime, fadeSec / 3);
        if (timer !== null) setTimeout(() => clearInterval(timer), fadeSec * 1000);
        return;
      }
    } catch {
      /* fall through to an immediate stop */
    }
    if (timer !== null) clearInterval(timer);
  }
}

/** The seconds of one beat of the score. */
const BEAT = 0.55;

/** Notes grouped by half-beat slot, so the scheduler looks up what starts now instead of scanning the plan. */
function bucket(plan: readonly Note[]): Map<number, Note[]> {
  const m = new Map<number, Note[]>();
  for (const n of plan) {
    const k = Math.floor(n.beat * 2) % 512;
    const l = m.get(k);
    if (l) l.push(n);
    else m.set(k, [n]);
  }
  return m;
}
