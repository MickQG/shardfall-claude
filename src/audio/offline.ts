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
