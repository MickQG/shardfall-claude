import { unitDef } from '../data/defs';
import { QUEUE_MAX } from '../sim';
import { queueRefusal } from './feedback';

interface Producer {
  id: number;
  kind: string;
  queue: readonly { kind: string; pct: number }[];
}

/** Ticks of work left in a queue, counting the head's progress. */
function workLeft(p: Producer): number {
  return p.queue.reduce((sum, q) => sum + (unitDef(q.kind).buildTime * (100 - q.pct)) / 100, 0);
}

/**
 * Which own building a unit order goes to (PRD-11): the producer of that kind that would finish it soonest (the least
 * build time queued), ties going to the shorter queue, then the earlier building, so every producer keeps working.
 * Which building is selected does not matter. Null when no producer has room.
 */
export function trainSource(buildings: readonly Producer[], kind: string): number | null {
  const producers = buildings.filter((b) => b.kind === unitDef(kind).builtAt && b.queue.length < QUEUE_MAX);
  let best: Producer | undefined;
  for (const b of producers) {
    if (!best) {
      best = b;
      continue;
    }
    const w = workLeft(b);
    const bw = workLeft(best);
    if (w < bw || (w === bw && b.queue.length < best.queue.length)) best = b;
  }
  return best ? best.id : null;
}

/** The newest queued copy of `kind` across buildings: the furthest back in its queue, then the least progressed. */
export function newestQueued(buildings: readonly Producer[], kind: string): { source: number; index: number } | null {
  let best: { source: number; index: number; pct: number } | null = null;
  for (const b of buildings) {
    for (let index = 0; index < b.queue.length; index++) {
      const q = b.queue[index] as { kind: string; pct: number };
      if (q.kind !== kind) continue;
      if (!best || index > best.index || (index === best.index && q.pct < best.pct)) best = { source: b.id, index, pct: q.pct };
    }
  }
  return best ? { source: best.source, index: best.index } : null;
}

/** Whether placement mode for `placing` is still meaningful: its source is owned and holds that structure ready at the head. */
export function placementLive(placing: { source: number; kind: string }, buildings: readonly { id: number; owner: number; queue: readonly { kind: string; ready: boolean }[] }[], player: number): boolean {
  const head = buildings.find((b) => b.id === placing.source && b.owner === player)?.queue[0];
  return !!head && head.kind === placing.kind && head.ready;
}

/** Whether one more `kind` can be queued right now: prerequisites owned, affordable, and a producer with room. */
export function queueable(kind: string, buildings: readonly Producer[], ownedKinds: readonly string[], credits: number): boolean {
  return queueRefusal(kind, ownedKinds, credits, trainSource(buildings, kind) !== null) === null;
}
