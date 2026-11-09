import { AudioEngine } from './engine';
import { WORLD_SOUNDS } from './recipes';

/**
 * Renders a dense battle through the real engine graph into an OfflineAudioContext and reports the loudest sample
 * (AUD-12): `count` plays of every kind of sound, from both factions, at full level and spread over `seconds`,
 * with the per-name rate limit off so the voice budget and the limiter do all the work. For tests.
 */
export async function renderBurst(count = 200, seconds = 3): Promise<{ peak: number; started: number; dropped: number; requested: number }> {
  const rate = 44100;
  const ctx = new OfflineAudioContext(2, rate * seconds, rate);
  const engine = new AudioEngine();
  engine.attach(ctx);
  engine.limitRate = false;
  engine.setVolume(1);
  const steps = 40;
  const per = Math.ceil(count / steps);
  let n = 0;
  for (let k = 0; k < steps; k++) {
    void ctx.suspend((k * (seconds - 1)) / steps).then(() => {
      for (let j = 0; j < per && n < count; j++, n++) {
        const name = WORLD_SOUNDS[n % WORLD_SOUNDS.length] as (typeof WORLD_SOUNDS)[number];
        engine.play(name, 1, { faction: n % 2 ? 'alien' : 'human', size: 1 + (n % 3) * 0.5, pan: ((n * 37) % 21) / 10 - 1, near: 1 });
      }
      void ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i] as number));
  }
  return { peak, started: engine.stats.started, dropped: engine.stats.dropped, requested: n };
}

/**
 * Renders a few bars of the score through the real engine graph (AUD-13, AUD-16): the calm layer and, at `level` above zero,
 * the battle layer, with the faction theme. Reports the loudness after the first two seconds, once the layers have crossfaded.
 */
export async function renderMusic(level: number, musicOn = true, bars = 5): Promise<{ rms: number; peak: number }> {
  const rate = 22050;
  const seconds = bars * 4 * 0.55 + 1;
  const ctx = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);
  const engine = new AudioEngine();
  engine.attach(ctx);
  engine.setVolume(1);
  engine.setMusicOn(musicOn);
  engine.startMusic(3, false, 'human');
  engine.setBattleLevel(level);
  engine.pumpMusic(seconds);
  const buf = await ctx.startRendering();
  let sum = 0;
  let n = 0;
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const v = d[i] as number;
      peak = Math.max(peak, Math.abs(v));
      if (i >= rate * 2) {
        sum += v * v;
        n++;
      }
    }
  }
  return { rms: Math.sqrt(sum / Math.max(1, n)), peak };
}

/** In-place radix-2 FFT of `re`/`im` (length a power of two). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] as number, re[i] as number];
      [im[i], im[j]] = [im[j] as number, im[i] as number];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = (re[b] as number) * wr - (im[b] as number) * wi;
        const xi = (re[b] as number) * wi + (im[b] as number) * wr;
        re[b] = (re[a] as number) - xr;
        im[b] = (im[a] as number) - xi;
        re[a] = (re[a] as number) + xr;
        im[a] = (im[a] as number) + xi;
      }
    }
  }
}

/**
 * Renders the idle soundscape (AUD-8, AUD-10): the ambience beds and every movement loop at full count, no one-shot sounds,
 * for `seconds` through the real engine graph, and reports how much of its energy sits above 2 kHz, where hiss and static live.
 */
export async function renderSoundscape(seconds = 3): Promise<{ rms: number; peak: number; highRms: number; highFraction: number }> {
  const rate = 44100;
  const ctx = new OfflineAudioContext(1, rate * seconds, rate);
  const engine = new AudioEngine();
  engine.attach(ctx);
  engine.setVolume(1);
  engine.setMovement({ vehicle: 1, walker: 1, infantry: 1, swarm: 1 });
  engine.setAmbience({ water: 1, rumble: 1 });
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  // Skip the first half second, while the gains glide up; analyse a power-of-two window.
  const n = 1 << 17;
  const from = Math.min(Math.floor(rate * 0.5), d.length - n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const v = d[from + i] as number;
    peak = Math.max(peak, Math.abs(v));
    re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  fft(re, im);
  let total = 0;
  let high = 0;
  const cut = Math.round((2000 / rate) * n);
  for (let k = 1; k < n / 2; k++) {
    const p = (re[k] as number) ** 2 + (im[k] as number) ** 2;
    total += p;
    if (k >= cut) high += p;
  }
  // Hann window power gain 3/8; Parseval: mean square = 2 * sum(p over half) / n^2 / (3/8).
  const scale = 2 / (n * n * 0.375);
  return { rms: Math.sqrt(total * scale), peak, highRms: Math.sqrt(high * scale), highFraction: total > 0 ? high / total : 0 };
}
