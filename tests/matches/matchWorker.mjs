// Starts a match-pool lane (pool.ts): registers tsx so the worker can load the TypeScript game code.
import { register } from 'tsx/esm/api';

register();
await import('./matchWorker.ts');
