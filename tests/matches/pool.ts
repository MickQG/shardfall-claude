import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { MatchOptions, MatchResult } from '../../src/ai/harness';

/**
 * Plays independent full matches on every core at once (#107): each match is deterministic and self-contained, so the
 * results are exactly those of playing them one after another, in the same order.
 */
export async function playMatches(list: readonly MatchOptions[]): Promise<MatchResult[]> {
  const out: MatchResult[] = new Array(list.length);
  let next = 0;
  const lanes = Math.max(1, Math.min(list.length, availableParallelism()));
  const lane = async (): Promise<void> => {
    const w = new Worker(new URL('./matchWorker.mjs', import.meta.url));
    try {
      while (next < list.length) {
        const i = next++;
        out[i] = await new Promise<MatchResult>((resolve, reject) => {
          w.once('message', resolve);
          w.once('error', reject);
          w.postMessage(list[i]);
        });
        w.removeAllListeners('error');
      }
    } finally {
      await w.terminate();
    }
  };
  await Promise.all(Array.from({ length: lanes }, lane));
  return out;
}
