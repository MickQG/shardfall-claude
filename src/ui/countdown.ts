import { buildingDef } from '../data/defs';
import { TICKS_PER_SECOND, type Snapshot } from '../sim';

/** Ticks as a game clock: m:ss. */
export function clock(ticks: number): string {
  const s = Math.ceil(Math.max(0, ticks) / TICKS_PER_SECOND);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** One line of the superweapon countdown box at the top of the map view (SW-1, SW-2). */
export interface CountdownRow {
  /** Stable key for the row. */
  key: string;
  text: string;
  /** own: the viewer's weapon; enemy: an enemy weapon; danger: an enemy strike on its way or an enemy weapon ready. */
  tone: 'own' | 'enemy' | 'danger';
}

/**
 * The countdown box (SW-1, SW-2): strikes on their way first, then every enemy superweapon, then the viewer's own, each
 * with the time until it is charged (frozen and marked paused while its owner is low on power). Pure.
 */
export function countdownRows(s: Snapshot): CountdownRow[] {
  const me = s.viewer;
  const mine = (owner: number): boolean => me !== null && owner === me;
  const name = (kind: string): string => buildingDef(kind).name;
  const strikes: CountdownRow[] = s.strikes.map((k, i) => ({
    key: `strike:${i}:${k.owner}:${s.tick + k.left}`,
    text: `${mine(k.owner) ? 'Your' : 'Enemy'} ${name(k.kind)} strike · impact in ${Math.ceil(k.left / TICKS_PER_SECOND)}s`,
    tone: mine(k.owner) ? 'own' : 'danger',
  }));
  const weapons = [...s.superweapons]
    .sort((a, b) => Number(mine(a.owner)) - Number(mine(b.owner)) || a.id - b.id)
    .map((w): CountdownRow => {
      const own = mine(w.owner);
      const state = w.left === 0 ? 'READY' : w.paused ? `${clock(w.left)} · paused` : clock(w.left);
      return { key: `sw:${w.id}`, text: `${own ? 'Your' : 'Enemy'} ${name(w.kind)} · ${state}`, tone: own ? 'own' : w.left === 0 ? 'danger' : 'enemy' };
    });
  return [...strikes, ...weapons];
}
