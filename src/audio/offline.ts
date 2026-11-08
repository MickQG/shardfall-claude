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
