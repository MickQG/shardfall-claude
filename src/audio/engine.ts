import { menuPlan, musicPlan, type Sound } from './plan';

type Name = Sound['name'] | 'alert' | 'ready' | 'click' | 'deny' | 'ack' | 'ackAttack';

/**
 * Procedural audio: every sound is synthesised from oscillators and filtered noise, so there are no audio assets.
 * Safe where audio does not exist (tests, blocked autoplay): every method silently does nothing.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private recent = new Map<string, number[]>();
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicBeat = 0;
  private plan: ReturnType<typeof musicPlan> = [];
  private nextBeatTime = 0;
  private bus: GainNode | null = null;
  muted = false;
  volume = 0.6;

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
      void this.ctx!.resume();
      this.apply();
    } catch {
      this.ctx = null;
    }
  }

  /** Open the audio context (once), with its master gain and noise buffer; false where audio does not exist. */
  private open(): boolean {
    if (typeof AudioContext === 'undefined') return false;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      let s = 1;
      for (let i = 0; i < len; i++) {
        s = (s * 16807) % 2147483647;
        d[i] = (s / 2147483647) * 2 - 1;
      }
    }
    return true;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.apply();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.apply();
  }

  private apply(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * 0.5, this.ctx.currentTime, 0.02);
  }

  private tone(freq: number, t0: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, dest?: AudioNode): void {
    const c = this.ctx;
    // Never queue sound on a context still waiting for the first click: it would all play at once when it resumes.
    if (!c || !this.master || c.state !== 'running') return;
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

  private burst(t0: number, dur: number, gain: number, lo: number, hi: number): void {
    const c = this.ctx;
    if (!c || !this.master || !this.noise || c.state !== 'running') return;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(hi, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, lo), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
  }

  /** Plays a named sound; rate-limited per name so a big fight is loud but not a wall of clicks. */
  play(name: Name, gain = 1): void {
    try {
      const c = this.ctx;
      if (!c || this.muted || c.state !== 'running') return;
      const now = c.currentTime;
      const r = (this.recent.get(name) ?? []).filter((t) => now - t < 0.12);
      if (r.length >= (name === 'zap' || name === 'slash' ? 3 : 2)) return;
      r.push(now);
      this.recent.set(name, r);
      const t = now + 0.001;
      switch (name) {
        case 'zap':
          this.tone(1400, t, 0.07, 'square', 0.06 * gain, 500);
          break;
        case 'laser':
          this.tone(1800, t, 0.12, 'sawtooth', 0.05 * gain, 400);
          break;
        case 'slash':
          this.burst(t, 0.08, 0.16 * gain, 1200, 5000);
          break;
        case 'rocket':
          this.burst(t, 0.25, 0.14 * gain, 300, 2500);
          this.tone(300, t, 0.2, 'sawtooth', 0.04 * gain, 120);
          break;
        case 'cannon':
          this.tone(110, t, 0.25, 'sine', 0.3 * gain, 45);
          this.burst(t, 0.2, 0.18 * gain, 200, 1500);
          break;
        case 'boom':
          this.burst(t, 0.45, 0.4 * gain, 80, 1800);
          this.tone(90, t, 0.4, 'sine', 0.3 * gain, 35);
          break;
        case 'crunch':
          // A short, low, gritty crunch: filtered noise over a dull thump.
          this.burst(t, 0.16, 0.3 * gain, 120, 900);
          this.tone(75, t, 0.12, 'triangle', 0.22 * gain, 40);
          break;
        case 'pop':
          this.burst(t, 0.18, 0.25 * gain, 200, 2500);
          break;
        case 'bigboom':
          this.burst(t, 0.9, 0.5 * gain, 60, 1500);
          this.tone(70, t, 0.8, 'sine', 0.45 * gain, 28);
          break;
        case 'sw_launch':
          this.tone(200, t, 1.2, 'sawtooth', 0.12 * gain, 1600);
          break;
        case 'sw_strike':
          this.burst(t, 1.6, 0.7 * gain, 40, 1200);
          this.tone(55, t, 1.5, 'sine', 0.6 * gain, 20);
          break;
        case 'alert':
          this.tone(880, t, 0.14, 'square', 0.1 * gain);
          this.tone(660, t + 0.16, 0.18, 'square', 0.1 * gain);
          break;
        case 'ready':
          this.tone(660, t, 0.1, 'triangle', 0.12 * gain);
          this.tone(990, t + 0.1, 0.16, 'triangle', 0.12 * gain);
          break;
        case 'click':
          this.tone(520, t, 0.04, 'triangle', 0.08 * gain);
          break;
        // Order acknowledgements (UI-14): a soft rising chirp; a sharper, lower double for orders to fight.
        case 'ack':
          this.tone(740, t, 0.05, 'triangle', 0.09 * gain);
          this.tone(1110, t + 0.045, 0.07, 'triangle', 0.08 * gain);
          break;
        case 'ackAttack':
          this.tone(440, t, 0.05, 'square', 0.06 * gain, 330);
          this.tone(660, t + 0.05, 0.08, 'square', 0.06 * gain);
          break;
        case 'deny':
          this.tone(220, t, 0.09, 'square', 0.08 * gain, 180);
          this.tone(165, t + 0.1, 0.14, 'square', 0.08 * gain, 130);
          break;
      }
    } catch {
      /* audio must never break the game */
    }
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
      bus.connect(lp).connect(this.master);
      this.bus = bus;
      const BEAT = 0.55;
      this.musicTimer = setInterval(() => {
        if (!this.ctx || this.muted) {
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
