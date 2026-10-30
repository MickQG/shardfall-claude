import { BUILDING_DEFS, buildingDef } from '../data/defs';
import type { Snapshot } from '../sim';

export interface Alert {
  id: 'attack' | 'units' | 'structure' | 'unit' | 'power' | 'superweapon' | 'incoming';
  text: string;
  level: 'info' | 'warn' | 'bad';
  /** Tile position for a minimap ping, if any. */
  at?: { tx: number; ty: number };
}

/** Cooldowns in ticks, so an alert does not repeat every tick. */
const COOLDOWN: Record<Alert['id'], number> = { attack: 200, units: 300, structure: 40, unit: 100, power: 600, superweapon: 100, incoming: 200 };

/** Compares consecutive snapshots of one viewer and raises the alerts a player needs to hear about. */
export class AlertTracker {
  private hp = new Map<number, number>();
  private unitHp = new Map<number, number>();
  private ready = new Set<string>();
  private charged = new Set<number>();
  private unitCount = -1;
  private wasLow = false;
  private last = new Map<Alert['id'], number>();

  constructor(private viewer: number) {}

  private fire(out: Alert[], tick: number, a: Alert): void {
    if (tick - (this.last.get(a.id) ?? -1e9) < COOLDOWN[a.id]) return;
    this.last.set(a.id, tick);
    out.push(a);
  }

  update(s: Snapshot): Alert[] {
    const out: Alert[] = [];
    const t = s.tick;
    const me = this.viewer;
    const mine = s.buildings.filter((b) => b.owner === me);

    for (const b of mine) {
      const prev = this.hp.get(b.id);
      if (prev !== undefined && b.hp < prev) this.fire(out, t, { id: 'attack', text: 'Base under attack!', level: 'bad', at: { tx: b.tx, ty: b.ty } });
      this.hp.set(b.id, b.hp);
      const head = b.queue[0];
      const key = `${b.id}:${head?.kind}`;
      if (!head?.ready) for (const k of [...this.ready]) if (k.startsWith(`${b.id}:`)) this.ready.delete(k);
      if (head?.ready && BUILDING_DEFS[head.kind] && !this.ready.has(key)) {
        this.ready.add(key);
        this.fire(out, t, { id: 'structure', text: `${buildingDef(head.kind).name} ready: place it`, level: 'info', at: { tx: b.tx, ty: b.ty } });
      }
      const sw = buildingDef(b.kind).superweapon;
      if (sw) {
        if (b.charge >= 100 && !this.charged.has(b.id)) {
          this.charged.add(b.id);
          this.fire(out, t, { id: 'superweapon', text: `${buildingDef(b.kind).name} is charged`, level: 'info', at: { tx: b.tx, ty: b.ty } });
        } else if (b.charge < 100) this.charged.delete(b.id);
      }
    }
    for (const id of [...this.hp.keys()]) if (!mine.some((b) => b.id === id)) this.hp.delete(id);

    for (const u of s.units) {
      if (u.owner !== me) continue;
      const prev = this.unitHp.get(u.id);
      if (prev !== undefined && u.hp < prev) this.fire(out, t, { id: 'units', text: 'Units under attack', level: 'warn', at: { tx: Math.floor(u.x / 256), ty: Math.floor(u.y / 256) } });
      this.unitHp.set(u.id, u.hp);
    }
    const own = s.units.filter((u) => u.owner === me).length;
    if (this.unitCount >= 0 && own > this.unitCount) this.fire(out, t, { id: 'unit', text: 'Unit ready', level: 'info' });
    this.unitCount = own;

    const p = s.players[me];
    const low = !!p && p.powerIn > p.powerOut;
    if (low && !this.wasLow) this.fire(out, t, { id: 'power', text: 'Low power: production slowed', level: 'warn' });
    this.wasLow = low;

    for (const e of s.events) if (e.t === 'launch' && e.owner !== me) this.fire(out, t, { id: 'incoming', text: 'Enemy superweapon launched!', level: 'bad' });
    return out;
  }
}
