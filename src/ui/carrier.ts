import { unitDef } from '../data/defs';
import { mayCarry, maxHpOf, squadAlive, type Command } from '../sim';

/**
 * The Field Mender's controls (CUR-6, CTL-22, UI-23): which selected squads can board, what a right-click on a Mender
 * does, which Menders R or the Unload button empties, and what the selection panel says about their passengers. Pure.
 */

type U = { id: number; owner: number; kind: string; cargo?: { id: number; kind: string; hp: number; rank: number } };

/** The selected squads of `player` that can board a carrier of kind `carrier` (SQD-3). */
export function boarders(units: readonly U[], selected: readonly number[], player: number, carrier: string): number[] {
  return units.filter((u) => u.owner === player && selected.includes(u.id) && mayCarry(carrier, u.kind)).map((u) => u.id);
}

/**
 * The board order a right-click on unit `over` gives (CUR-6): when it is one of the player's own carriers with room and the
 * selection holds squads that can board it, those squads board; otherwise null (the click is an ordinary one).
 */
export function boardOrder(units: readonly U[], selected: readonly number[], player: number, over: number | null): Extract<Command, { type: 'board' }> | null {
  if (over === null) return null;
  const c = units.find((u) => u.id === over);
  if (!c || c.owner !== player || !unitDef(c.kind).carries || c.cargo) return null;
  const ids = boarders(units, selected, player, c.kind).filter((id) => id !== c.id);
  return ids.length > 0 ? { type: 'board', player, units: ids, carrier: c.id } : null;
}

/** The selected carriers of `player` that carry a squad: what R and the Unload button empty (CTL-22, UI-23). */
export function unloadIds(units: readonly U[], selected: readonly number[], player: number): number[] {
  return units.filter((u) => u.owner === player && selected.includes(u.id) && u.cargo).map((u) => u.id);
}

/**
 * The selection panel's lines about passengers (UI-23): one per selected Field Mender of `player`, naming its squad and
 * the figures standing, or saying it is empty. Empty when no Mender is selected.
 */
export function cargoLines(units: readonly U[], selected: readonly number[], player: number): string[] {
  return units
    .filter((u) => u.owner === player && selected.includes(u.id) && unitDef(u.kind).carries)
    .map((u) => {
      const name = unitDef(u.kind).name;
      const r = u.cargo;
      if (!r) return `${name}: empty`;
      const d = unitDef(r.kind);
      return `${name}: ${d.name} squad inside (${squadAlive(r.kind, r.hp, maxHpOf(r.kind, r.rank))}/${d.squad ?? 1})`;
    });
}
