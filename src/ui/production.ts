import { unitDef } from '../data/defs';
import { QUEUE_MAX } from '../sim';

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
 * Which own building a unit order goes to: the selected building when it trains that kind, otherwise the producer with
 * the shortest queue, ties going to the least work left. Null when no producer has room.
 */
export function trainSource(buildings: readonly Producer[], kind: string, selected: number | null): number | null {
  const producers = buildings.filter((b) => b.kind === unitDef(kind).builtAt && b.queue.length < QUEUE_MAX);
  const chosen = producers.find((b) => b.id === selected);
  if (chosen) return chosen.id;
  let best: Producer | undefined;
  for (const b of producers) {
    if (!best || b.queue.length < best.queue.length || (b.queue.length === best.queue.length && workLeft(b) < workLeft(best))) best = b;
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

/** Whether one more `kind` can be queued right now: prerequisites owned, affordable, and a producer with room. */
export function queueable(kind: string, buildings: readonly Producer[], ownedKinds: readonly string[], credits: number, selected: number | null): boolean {
  const d = unitDef(kind);
  return [d.builtAt, ...d.requires].every((k) => ownedKinds.includes(k)) && credits >= d.cost && trainSource(buildings, kind, selected) !== null;
}
