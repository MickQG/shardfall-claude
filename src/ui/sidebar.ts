import { buildingDef, structuresOf, UNIT_DEFS, unitDef, type Faction } from '../data/defs';
import { QUEUE_MAX, type BuildingSnap, type Snapshot } from '../sim';

const CSS = `
#sidebar { position: fixed; right: 12px; top: 12px; bottom: 12px; width: 232px; display: flex; flex-direction: column; gap: 8px; pointer-events: none; font: 12px/1.25 system-ui, sans-serif; color: #dfe8e2; }
#sidebar .box { background: rgba(8,12,17,.86); border: 1px solid #28405a; border-radius: 6px; padding: 8px; pointer-events: auto; }
#sidebar .res { display: flex; justify-content: space-between; align-items: center; font-size: 14px; font-weight: 600; }
#sidebar .res .cr { color: #7ff5cd; }
#sidebar .power { height: 6px; background: #1a2733; border-radius: 3px; margin-top: 6px; overflow: hidden; }
#sidebar .power > i { display: block; height: 100%; background: #4cd964; }
#sidebar .power.low > i { background: #ff5a4a; }
#sidebar .power-label { display: flex; justify-content: space-between; font-size: 11px; color: #9fb4c6; margin-top: 3px; }
#sidebar .power-label.low { color: #ff8a7a; }
#sidebar h4 { margin: 0 0 6px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #8fa7bd; }
#sidebar .list { overflow-y: auto; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
#sidebar .scroll { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
#sidebar button.item { position: relative; text-align: left; background: #14202c; color: inherit; border: 1px solid #2c4560; border-radius: 5px; padding: 5px 6px; cursor: pointer; overflow: hidden; font: inherit; }
#sidebar button.item:hover:not(.off) { border-color: #7ff5cd; }
#sidebar button.item.off { opacity: .45; cursor: not-allowed; }
#sidebar button.item.ready { border-color: #ffd34a; box-shadow: 0 0 8px #ffd34a88; animation: pulse 1s infinite alternate; }
#sidebar button.item .n { display: block; font-weight: 600; }
#sidebar button.item .c { color: #7ff5cd; font-size: 11px; }
#sidebar button.item .q { position: absolute; right: 5px; top: 4px; font-size: 11px; color: #ffd34a; }
#sidebar button.item .p { position: absolute; left: 0; bottom: 0; height: 3px; background: #7ff5cd; }
#sidebar button.act { background: #1b2c3d; color: inherit; border: 1px solid #3a5a7a; border-radius: 4px; padding: 4px 8px; cursor: pointer; font: inherit; margin-right: 6px; }
#sidebar button.act:hover { border-color: #7ff5cd; }
#sidebar .sel-name { font-weight: 600; margin-bottom: 4px; }
@keyframes pulse { from { box-shadow: 0 0 4px #ffd34a66; } to { box-shadow: 0 0 12px #ffd34acc; } }
`;

interface ItemData {
  act: string;
  kind: string;
  src: number;
  idx: number;
  name: string;
  cost: number;
  off: boolean;
  ready: boolean;
  pct: number;
  count: number;
  title: string;
}

interface ItemRef {
  el: HTMLButtonElement;
  n: HTMLElement;
  c: HTMLElement;
  q: HTMLElement;
  p: HTMLElement;
}

export interface SidebarActions {
  produce(source: number, kind: string): void;
  cancel(source: number, index: number): void;
  startPlacement(source: number, kind: string): void;
  sell(id: number): void;
  repair(id: number, on: boolean): void;
}

const own = (snap: Snapshot): BuildingSnap[] => snap.buildings.filter((b) => b.owner === snap.viewer);

function missing(snap: Snapshot, requires: readonly string[]): string[] {
  const have = new Set(own(snap).map((b) => b.kind));
  return requires.filter((r) => !have.has(r));
}

export class Sidebar {
  private root = document.createElement('div');
  private resEl: HTMLElement;
  private buildEl: HTMLElement;
  private trainEl: HTMLElement;
  private selEl: HTMLElement;
  private lastKey = '';
  private selKey = 'init';
  private lastAt = 0;

  constructor(private actions: SidebarActions) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.id = 'sidebar';
    this.root.innerHTML = '<div class="box" id="sb-res"></div><div class="scroll"><div class="box" id="sb-sel" style="display:none"></div><div class="box"><h4>Structures</h4><div class="list" id="sb-build"></div></div><div class="box"><h4>Units</h4><div class="list" id="sb-train"></div></div></div>';
    document.body.appendChild(this.root);
    this.resEl = this.root.querySelector('#sb-res') as HTMLElement;
    this.buildEl = this.root.querySelector('#sb-build') as HTMLElement;
    this.trainEl = this.root.querySelector('#sb-train') as HTMLElement;
    this.selEl = this.root.querySelector('#sb-sel') as HTMLElement;
    this.root.addEventListener('click', (e) => this.onClick(e, false));
    this.root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.onClick(e, true);
    });
  }

  private onClick(e: MouseEvent, right: boolean): void {
    const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!el || el.classList.contains('off')) return;
    const a = el.dataset.act;
    const kind = el.dataset.kind ?? '';
    const src = Number(el.dataset.src ?? -1);
    const idx = Number(el.dataset.idx ?? -1);
    if (right) {
      if (idx >= 0 && (a === 'build' || a === 'train')) this.actions.cancel(src, idx);
      return;
    }
    if (a === 'build') {
      if (el.classList.contains('ready')) this.actions.startPlacement(src, kind);
      else this.actions.produce(src, kind);
    } else if (a === 'train') this.actions.produce(src, kind);
    else if (a === 'sell') this.actions.sell(src);
    else if (a === 'repair') this.actions.repair(src, el.dataset.on === '1');
  }

  update(snap: Snapshot, selectedBuilding: number | null, now: number): void {
    const me = snap.viewer;
    if (me === null) return;
    const player = snap.players[me];
    if (!player) return;
    const mine = own(snap);
    const key = JSON.stringify([player.credits, player.powerOut, player.powerIn, mine.map((b) => [b.id, b.kind, b.hp, b.repairing, b.queue.map((q) => [q.kind, q.pct, q.ready])]), selectedBuilding]);
    if (key === this.lastKey || now - this.lastAt < 120) return;
    this.lastKey = key;
    this.lastAt = now;

    const low = player.powerIn > player.powerOut;
    const pct = Math.min(100, Math.round((player.powerIn / Math.max(1, player.powerOut)) * 100));
    this.resEl.innerHTML = `<div class="res"><span>Shards</span><span class="cr">◈ ${player.credits}</span></div><div class="power ${low ? 'low' : ''}"><i style="width:${pct}%"></i></div><div class="power-label ${low ? 'low' : ''}"><span>Power ${player.powerIn}/${player.powerOut}</span><span>${low ? 'LOW POWER' : 'OK'}</span></div>`;

    this.renderBuild(snap, player.faction, player.credits, mine);
    this.renderTrain(snap, player.faction, player.credits, mine);
    this.renderSelection(mine, selectedBuilding);
  }

  private refs = new Map<string, ItemRef>();

  /** Create the button once per list/kind, then update it in place so clicks are never lost to a re-render. */
  private item(list: HTMLElement, a: ItemData): void {
    const id = `${list.id}:${a.kind}`;
    let r = this.refs.get(id);
    if (!r) {
      const el = document.createElement('button');
      el.className = 'item';
      el.innerHTML = '<span class="n"></span><span class="c"></span><span class="q"></span><span class="p"></span>';
      list.appendChild(el);
      r = { el, n: el.querySelector('.n') as HTMLElement, c: el.querySelector('.c') as HTMLElement, q: el.querySelector('.q') as HTMLElement, p: el.querySelector('.p') as HTMLElement };
      r.n.textContent = a.name;
      r.c.textContent = `◈ ${a.cost}`;
      el.dataset.kind = a.kind;
      this.refs.set(id, r);
    }
    r.el.dataset.act = a.act;
    r.el.dataset.src = String(a.src);
    r.el.dataset.idx = String(a.idx);
    r.el.title = a.title;
    r.el.classList.toggle('off', a.off);
    r.el.classList.toggle('ready', a.ready);
    const q = a.ready ? 'PLACE' : a.count > 0 ? `×${a.count}` : '';
    if (r.q.textContent !== q) r.q.textContent = q;
    r.p.style.width = `${a.pct}%`;
  }

  private renderBuild(snap: Snapshot, faction: Faction, credits: number, mine: BuildingSnap[]): void {
    const hq = mine.find((b) => buildingDef(b.kind).hq);
    for (const kind of structuresOf(faction)) {
        const d = buildingDef(kind);
        const miss = missing(snap, d.requires);
        const idx = hq ? hq.queue.findIndex((q) => q.kind === kind) : -1;
        const q = idx >= 0 && hq ? hq.queue[idx] : undefined;
        const full = !!hq && hq.queue.length >= QUEUE_MAX;
        const off = !hq || (miss.length > 0 && !q) || (credits < d.cost && !q) || (full && !q);
        const title = miss.length ? `Requires ${miss.map((m) => buildingDef(m).name).join(', ')}` : `${d.name}: power ${d.power > 0 ? '+' : ''}${d.power}`;
        this.item(this.buildEl, { act: 'build', kind, src: hq?.id ?? -1, idx, name: d.name, cost: d.cost, off, ready: !!q && q.ready && idx === 0, pct: q ? q.pct : 0, count: hq ? hq.queue.filter((x) => x.kind === kind).length : 0, title });
    }
  }

  private renderTrain(snap: Snapshot, faction: Faction, credits: number, mine: BuildingSnap[]): void {
    for (const kind of Object.keys(UNIT_DEFS).filter((k) => unitDef(k).faction === faction)) {
      {
        const d = unitDef(kind);
        const producers = mine.filter((b) => b.kind === d.builtAt);
        const src = producers.reduce<BuildingSnap | undefined>((best, b) => (!best || b.queue.length < best.queue.length ? b : best), undefined);
        const miss = missing(snap, [d.builtAt, ...d.requires]);
        const queued = producers.flatMap((b) => b.queue.map((q, i) => ({ b, q, i }))).filter((x) => x.q.kind === kind);
        const first = queued[0];
        const off = !src || miss.length > 0 || credits < d.cost || src.queue.length >= QUEUE_MAX;
        const title = miss.length ? `Requires ${miss.map((m) => buildingDef(m).name).join(', ')}` : `${d.name}: ${d.hp} HP`;
        this.item(this.trainEl, { act: 'train', kind, src: first ? first.b.id : (src?.id ?? -1), idx: first ? first.i : -1, name: d.name, cost: d.cost, off, ready: false, pct: first ? first.q.pct : 0, count: queued.length, title });
      }
    }
  }

  private renderSelection(mine: BuildingSnap[], selectedBuilding: number | null): void {
    const b = selectedBuilding === null ? undefined : mine.find((x) => x.id === selectedBuilding);
    const selKey = b ? `${b.id}:${b.hp}:${b.repairing}:${b.charge}` : '';
    if (selKey === this.selKey) return; // keep the buttons stable unless something visible changed
    this.selKey = selKey;
    if (!b) {
      this.selEl.style.display = 'none';
      return;
    }
    const d = buildingDef(b.kind);
    this.selEl.style.display = 'block';
    const sellable = !d.hq;
    this.selEl.innerHTML = `<div class="sel-name">${d.name}</div><div style="color:#9fb4c6;margin-bottom:6px">HP ${b.hp}/${d.hp}${d.superweapon ? ` · charge ${b.charge}%` : ''}</div>${sellable ? `<button class="act" data-act="sell" data-src="${b.id}">Sell</button>` : ''}<button class="act" data-act="repair" data-src="${b.id}" data-on="${b.repairing ? 0 : 1}">${b.repairing ? 'Stop repair' : 'Repair'}</button><div style="margin-top:6px;color:#7f93a6">Right-click ground to set rally</div>`;
  }
}
