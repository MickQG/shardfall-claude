import { parentPort } from 'node:worker_threads';
import { playMatch, type MatchOptions } from '../../src/ai/harness';

/** One lane of the match pool (pool.ts): plays each match it is sent and sends back the result. */
parentPort?.on('message', (o: MatchOptions) => parentPort?.postMessage(playMatch(o)));
