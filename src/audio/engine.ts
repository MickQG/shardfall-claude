import type { Faction } from '../data/defs';
import { menuPlan, musicPlan } from './plan';
import { ackRecipe, allocateVoice, MOVE_CLASSES, MOVE_LOOPS, recipeFor, sizeMods, Variation, type AmbienceMix, type FilterSpec, type Layer, type MoveClass, type Recipe, type SoundName, type VoiceInfo } from './recipes';

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
  private noise: AudioBuffer | null = null;
  private recent = new Map<string, number[]>();
  private voices: Voice[] = [];
  private loops = new Map<MoveClass, Loop>();
  private ambience: { wind: GainNode; water: GainNode; rumble: GainNode } | null = null;
  private vary = new Variation(0x5eed);
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicBeat = 0;
  private plan: ReturnType<typeof musicPlan> = [];
  private nextBeatTime = 0;
  private bus: GainNode | null = null;
  muted = false;
  volume = 0.6;
  musicOn = true;
  musicVolume = 0.6;
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
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    const clip = ctx.createWaveShaper();
    clip.curve = limiterCurve() as Float32Array<ArrayBuffer>;
    this.master.connect(limiter).connect(clip).connect(ctx.destination);
    this.musicOut = ctx.createGain();
    this.musicOut.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
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

  private apply(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * 0.5, this.ctx.currentTime, 0.02);
    // The default music volume (0.6) keeps the score at the level it always had.
    if (this.musicOut && this.ctx) this.musicOut.gain.setTargetAtTime(this.musicOn ? this.musicVolume / 0.6 : 0, this.ctx.currentTime, 0.02);
  }

  /** A single enveloped oscillator note: the music uses it. */
  private tone(freq: number, t0: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, dest?: AudioNode): void {
    const c = this.ctx;
    if (!c || !this.master || !this.live()) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.01, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest ?? this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
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
      if (recipe) this.render(`${o.faction ?? 'ui'}:${name}`, recipe, gain, o, name === 'zap' || name === 'slash' || name === 'pop' ? 3 : 2);
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
  private render(key: string, recipe: Recipe, gain: number, o: PlayOpts, perWindow: number): void {
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
    const t0 = now + 0.001 + v.delay;
    const vg = c.createGain();
    vg.gain.value = loud;
    let pan: StereoPannerNode | null = null;
    if (typeof c.createStereoPanner === 'function') {
      pan = c.createStereoPanner();
      pan.pan.value = clamp1(o.pan ?? 0);
      vg.connect(pan).connect(this.sfx);
    } else vg.connect(this.sfx);
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
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = spec.filter.type;
    f.frequency.value = spec.filter.f;
    f.Q.value = spec.filter.q;
    // The gait: the noise bed is pulsed at the class's rate.
    const amp = c.createGain();
    amp.gain.value = 1 - spec.depth / 2;
    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = spec.rate;
    lg.gain.value = spec.depth / 2;
    lfo.connect(lg).connect(amp.gain);
    const g = c.createGain();
    g.gain.value = 0;
    src.connect(f).connect(amp).connect(g).connect(this.sfx as GainNode);
    src.start(0, this.vary.float() * 0.5);
    lfo.start();
    const loop: Loop = { gain: g, nodes: [src, lfo], quietSince: null };
    this.loops.set(cls, loop);
    return loop;
  }

  /**
   * Ambience (AUD-10): wind always, lapping water and a distant rumble at the levels in `mix`. The beds are filtered
   * noise with slow modulation, started on first use and kept running.
   */
  setAmbience(mix: Readonly<AmbienceMix>): void {
    try {
      const c = this.ctx;
      if (!c || !this.live()) return;
      if (!this.ambience) this.ambience = this.startAmbience();
      const now = c.currentTime;
      this.ambience.wind.gain.setTargetAtTime(mix.wind * 0.05, now, 0.5);
      this.ambience.water.gain.setTargetAtTime(mix.water * 0.06, now, 0.5);
      this.ambience.rumble.gain.setTargetAtTime(mix.rumble * 0.16, now, 0.6);
    } catch {
      /* audio must never break the game */
    }
  }

  private startAmbience(): { wind: GainNode; water: GainNode; rumble: GainNode } {
    const c = this.ctx as BaseAudioContext;
    /** A noise bed through one filter, its level and filter swayed by slow oscillators. */
    const bed = (type: BiquadFilterType, f: number, q: number, sway: { rate: number; amp: number; filter?: number }): GainNode => {
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const fl = c.createBiquadFilter();
      fl.type = type;
      fl.frequency.value = f;
      fl.Q.value = q;
      const amp = c.createGain();
      amp.gain.value = 1 - sway.amp;
      const lfo = c.createOscillator();
      lfo.frequency.value = sway.rate;
      const lg = c.createGain();
      lg.gain.value = sway.amp;
      lfo.connect(lg).connect(amp.gain);
      if (sway.filter) {
        const fg = c.createGain();
        fg.gain.value = sway.filter;
        lfo.connect(fg).connect(fl.frequency);
      }
      const out = c.createGain();
      out.gain.value = 0;
      src.connect(fl).connect(amp).connect(out).connect(this.sfx as GainNode);
      src.start(0, this.vary.float() * 0.5);
      lfo.start();
      return out;
    };
    return {
      wind: bed('bandpass', 450, 0.6, { rate: 0.07, amp: 0.45, filter: 180 }),
      water: bed('bandpass', 1100, 1.4, { rate: 0.33, amp: 0.7, filter: 150 }),
      rumble: bed('lowpass', 80, 1, { rate: 0.5, amp: 0.3 }),
    };
  }

  /** Starts the generative ambient score; `menu` plays the main-menu score instead (AUD-4). */
  startMusic(seed: number, menu = false): void {
    try {
      const c = this.ctx;
      if (!c || !this.master || this.musicTimer !== null) return;
      this.plan = menu ? menuPlan(seed, 64) : musicPlan(seed, 64);
      this.musicBeat = 0;
      this.nextBeatTime = c.currentTime + 0.2;
      const bus = c.createGain();
      bus.gain.value = 0.35;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      bus.connect(lp).connect(this.musicOut ?? this.master);
      this.bus = bus;
      const BEAT = 0.55;
      this.musicTimer = setInterval(() => {
        if (!this.ctx || this.muted || !this.musicOn) {
          this.nextBeatTime = (this.ctx?.currentTime ?? 0) + 0.2;
          return;
        }
        while (this.nextBeatTime < this.ctx.currentTime + 0.6) {
          const b = this.musicBeat % (64 * 4);
          for (const n of this.plan) {
            if (n.beat >= b && n.beat < b + 0.5) {
              const t = this.nextBeatTime + (n.beat - b) * BEAT;
              const dur = n.dur * BEAT;
              if (n.voice === 'pad') this.tone(n.freq, t, dur * 1.1, 'sine', 0.05, undefined, bus);
              else if (n.voice === 'bass') this.tone(n.freq, t, dur, 'triangle', 0.09, undefined, bus);
              else this.tone(n.freq, t, dur * 1.4, 'triangle', 0.035, undefined, bus);
            }
          }
          this.musicBeat += 0.5;
          this.nextBeatTime += 0.5 * BEAT;
        }
      }, 120);
    } catch {
      this.musicTimer = null;
    }
  }

  /** Stops the score; with `fadeSec` the music fades out first (AUD-4) and the notes already queued die away with it. */
  stopMusic(fadeSec = 0): void {
    const timer = this.musicTimer;
    this.musicTimer = null;
    if (timer === null) return;
    try {
      if (fadeSec > 0 && this.bus && this.ctx) {
        this.bus.gain.setTargetAtTime(0, this.ctx.currentTime, fadeSec / 3);
        setTimeout(() => clearInterval(timer), fadeSec * 1000);
        return;
      }
    } catch {
      /* fall through to an immediate stop */
    }
    clearInterval(timer);
  }
}
