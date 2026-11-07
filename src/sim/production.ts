import { buildingDef, isBuildingKind, trainableAt, unitDef, type Faction } from '../data/defs';
import { centerOf, tileOf } from './fixed';
import { isBlocked } from './path';
import { canPlace, type Footprint } from './placement';
import { addBuilding, addUnit, buildingById, hasKinds, QUEUE_MAX, rebuildBlocked, type Building, type Player, type State } from './state';
import { evictFromBlocked, orderMove } from './movement';

const haulerOf = (f: Faction): string => (f === 'human' ? 'hum_hauler' : 'ali_gorger');

/** Whether `kind` may be queued by `owner` at `source` right now (tech tree, faction, credits, queue room). */
export function canQueue(s: State, owner: number, source: Building, kind: string): boolean {
  if (source.owner !== owner || source.queue.length >= QUEUE_MAX) return false;
  const faction = (s.players[owner] as { faction: Faction }).faction;
  if (isBuildingKind(kind)) {
    const d = buildingDef(kind);
    if (d.faction !== faction || d.hq || !buildingDef(source.kind).hq) return false;
    return hasKinds(s, owner, d.requires) && (s.players[owner]?.credits ?? 0) >= d.cost;
  }
  const d = unitDef(kind);
  if (d.faction !== faction || d.builtAt !== source.kind || !trainableAt(source.kind).includes(kind)) return false;
  if (d.hero && heroTaken(s, owner, kind)) return false;
  return hasKinds(s, owner, d.requires) && (s.players[owner]?.credits ?? 0) >= d.cost;
}

/** Whether a player already has hero `kind`, alive or in a production queue (HERO-1). */
export function heroTaken(s: State, owner: number, kind: string): boolean {
  return s.units.some((u) => u.owner === owner && u.kind === kind) || s.buildings.some((b) => b.owner === owner && b.queue.some((q) => q.kind === kind));
}

export function enqueue(s: State, owner: number, sourceId: number, kind: string): void {
  const src = buildingById(s, sourceId);
  if (!src || !canQueue(s, owner, src, kind)) return;
  const cost = isBuildingKind(kind) ? buildingDef(kind).cost : unitDef(kind).cost;
  const time = isBuildingKind(kind) ? buildingDef(kind).buildTime : unitDef(kind).buildTime;
  (s.players[owner] as { credits: number }).credits -= cost;
  src.queue.push({ kind, cost, progress: 0, total: time * 2, ready: false });
}

export function cancel(s: State, owner: number, sourceId: number, index: number): void {
  const src = buildingById(s, sourceId);
  if (!src || src.owner !== owner) return;
  const item = src.queue[index];
  if (!item) return;
  (s.players[owner] as { credits: number }).credits += item.cost;
  src.queue.splice(index, 1);
}

const footprints = (s: State): Footprint[] => s.buildings.map((b) => ({ kind: b.kind, tx: b.tx, ty: b.ty, pad: b.pad }));

export function placementOk(s: State, owner: number, kind: string, tx: number, ty: number): boolean {
  return canPlace(
    {
      width: s.grid.width,
      height: s.grid.height,
      terrain: s.cfg.map.blocked,
      occupied: footprints(s),
      own: s.buildings.filter((b) => b.owner === owner).map((b) => ({ kind: b.kind, tx: b.tx, ty: b.ty })),
      fog: s.fog[owner] as Uint8Array,
    },
    kind,
    tx,
    ty,
  );
}

export function place(s: State, owner: number, sourceId: number, tx: number, ty: number): void {
  const src = buildingById(s, sourceId);
  if (!src || src.owner !== owner) return;
  const head = src.queue[0];
  if (!head || !head.ready || !isBuildingKind(head.kind)) return;
  if (!placementOk(s, owner, head.kind, tx, ty)) return;
  src.queue.shift();
  const b = addBuilding(s, owner, head.kind, tx, ty);
  (s.players[owner] as Player).stats.buildingsBuilt++;
  evictFromBlocked(s);
  const d = buildingDef(b.kind);
  if (d.refinery) {
    const spawn = spawnTile(s, b);
    if (spawn !== undefined) {
      addUnit(s, owner, haulerOf((s.players[owner] as { faction: Faction }).faction), centerOf(spawn % s.grid.width), centerOf(Math.floor(spawn / s.grid.width)));
      (s.players[owner] as Player).stats.unitsBuilt++;
    }
  }
}

/** Free tile beside a building, nearest to its rally point (or its south side). */
export function spawnTile(s: State, b: Building): number | undefined {
  const d = buildingDef(b.kind);
  const g = s.grid;
  // Default exit faces the map centre, so mirrored bases behave identically.
  const cx = b.tx + d.w / 2;
  const cy = b.ty + d.h / 2;
  const wantX = b.rally ? tileOf(b.rally[0]) : Math.round(cx + Math.sign(g.width / 2 - cx) * (d.w / 2 + 1));
  const wantY = b.rally ? tileOf(b.rally[1]) : Math.round(cy + Math.sign(g.height / 2 - cy) * (d.h / 2 + 1));
  const flip = cx > g.width / 2;
  let best: number | undefined;
  let bd = Infinity;
  const w = d.w + 2;
  const h = d.h + 2;
  for (let iy = 0; iy < h; iy++) {
    for (let ix = 0; ix < w; ix++) {
      const x = b.tx - 1 + (flip ? w - 1 - ix : ix);
      const y = b.ty - 1 + (flip ? h - 1 - iy : iy);
      const onRing = x === b.tx - 1 || x === b.tx + d.w || y === b.ty - 1 || y === b.ty + d.h;
      if (!onRing || isBlocked(g, x, y)) continue;
      const dist = (x - wantX) ** 2 + (y - wantY) ** 2;
      if (dist < bd) {
        bd = dist;
        best = y * g.width + x;
      }
    }
  }
  return best;
}

export function sell(s: State, owner: number, id: number): void {
  const b = buildingById(s, id);
  if (!b || b.owner !== owner || buildingDef(b.kind).hq) return;
  (s.players[owner] as { credits: number }).credits += Math.floor(buildingDef(b.kind).cost / 2);
  // Queued items are refunded when the building goes away.
  for (const it of b.queue) (s.players[owner] as { credits: number }).credits += it.cost;
  removeBuilding(s, b);
}

export function removeBuilding(s: State, b: Building): void {
  s.buildings = s.buildings.filter((x) => x.id !== b.id);
  for (const u of s.units) if (u.target === b.id) u.target = -1;
  for (const o of s.buildings) if (o.target === b.id) o.target = -1;
  s.players.forEach((p) => p.ghosts.delete(b.id));
  s.pathQueue = s.pathQueue.filter((id) => s.units.some((u) => u.id === id));
  // A destroyed or sold building frees its tiles.
  rebuildBlocked(s);
}

export function setRepair(s: State, owner: number, id: number, on: boolean): void {
  const b = buildingById(s, id);
  if (b && b.owner === owner) b.repairing = on;
}

export function setRally(s: State, owner: number, id: number, x: number, y: number): void {
  const b = buildingById(s, id);
  if (b && b.owner === owner) b.rally = [x, y];
}

/** Advance production queues and repairs by one tick. */
/**
 * Keep every producer busy (PRD-14): a production building with an empty queue takes over the newest order that has
 * not started yet from a sibling of the same kind with a backlog (the longest one), so orders never wait behind each
 * other in one building while another stands idle, whatever order they were clicked in.
 */
function rebalance(s: State): void {
  for (const idle of s.buildings) {
    if (idle.queue.length > 0 || trainableAt(idle.kind).length === 0) continue;
    let donor: Building | undefined;
    for (const b of s.buildings) {
      if (b === idle || b.owner !== idle.owner || b.kind !== idle.kind || b.queue.length < 2) continue;
      const last = b.queue[b.queue.length - 1]!;
      if (last.progress > 0 || isBuildingKind(last.kind)) continue;
      if (!donor || b.queue.length > donor.queue.length) donor = b;
    }
    if (donor) idle.queue.push(donor.queue.pop()!);
  }
}

export function tickProduction(s: State): void {
  rebalance(s);
  for (const b of s.buildings) {
    const player = s.players[b.owner];
    if (!player) continue;
    const head = b.queue[0];
    if (head && !head.ready) {
      head.progress += player.powerIn > player.powerOut ? 1 : 2;
      if (head.progress >= head.total) {
        if (isBuildingKind(head.kind)) {
          head.ready = true;
        } else {
          const t = spawnTile(s, b);
          if (t !== undefined) {
            b.queue.shift();
            const u = addUnit(s, b.owner, head.kind, centerOf(t % s.grid.width), centerOf(Math.floor(t / s.grid.width)));
            player.stats.unitsBuilt++;
            if (b.rally) orderMove(s, u, tileOf(b.rally[1]) * s.grid.width + tileOf(b.rally[0]));
          } else {
            head.progress = head.total;
          }
        }
      }
    }
    if (b.repairing && s.tick % 10 === 0) {
      const d = buildingDef(b.kind);
      const costPer = Math.max(1, Math.ceil(d.cost / 100));
      if (b.hp >= d.hp) b.repairing = false;
      else if (player.credits >= costPer) {
        player.credits -= costPer;
        b.hp = Math.min(d.hp, b.hp + Math.ceil(d.hp / 50));
      } else b.repairing = false;
    }
  }
}
