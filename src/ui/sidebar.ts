import { buildingDef, hqOf, structuresOf, UNIT_DEFS, unitDef, type Faction } from '../data/defs';
import { cancelPlan } from './cancelPlan';
import { fireState, queueRefusal, rallyHint, SellConfirm, superweaponRows } from './feedback';
import { newestQueued, trainSource } from './production';
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
#sidebar .sw { border-color: #5a3f2c; }
#sidebar .sw-row { display: grid; grid-template-columns: 1fr auto; gap: 3px 8px; align-items: center; }
#sidebar .sw-row + .sw-row { margin-top: 8px; }
#sidebar .sw-name { font-weight: 600; }
#sidebar .sw-state { font-size: 11px; color: #9fb4c6; }
#sidebar .sw-bar { grid-column: 1 / -1; height: 5px; background: #1a2733; border-radius: 3px; overflow: hidden; }
#sidebar .sw-bar > i { display: block; height: 100%; background: linear-gradient(90deg, #a0582a, #ff9a3a); }
#sidebar button.fire { grid-row: 1 / span 2; grid-column: 2; min-width: 66px; padding: 9px 10px; border-radius: 5px; border: 1px solid #4a3a30; background: #20160f; color: #b0907a; font: 700 12px/1 system-ui, sans-serif; letter-spacing: .1em; cursor: not-allowed; }
#sidebar .sw-row.ready .sw-bar > i { background: #ffd34a; }
#sidebar .sw-row.ready button.fire { cursor: pointer; color: #1a0d05; background: linear-gradient(#ffe27a, #ff8a3a); border-color: #ffd34a; animation: swpulse .8s infinite alternate; }
#sidebar .sw.alien .sw-row.ready .sw-bar > i { background: #b6ff5c; }
#sidebar .sw.alien .sw-row.ready button.fire { background: linear-gradient(#e2ff9a, #6ad02a); border-color: #b6ff5c; animation-name: swpulse-g; }
#sidebar .sw-row.armed button.fire { cursor: pointer; background: #3a1010; color: #ff9a8a; border-color: #ff5a4a; animation: none; }
#sidebar .sw-row.armed .sw-state { color: #ff9a8a; }
@keyframes swpulse { from { box-shadow: 0 0 4px #ff8a3a66; } to { box-shadow: 0 0 16px #ffb04add; } }
@keyframes swpulse-g { from { box-shadow: 0 0 4px #6ad02a66; } to { box-shadow: 0 0 16px #b6ff5cdd; } }
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
  /** Why the item is unavailable, shown when it is clicked anyway. */
  why: string;
}

interface ItemRef {
  el: HTMLButtonElement;
  n: HTMLElement;
  c: HTMLElement;
  q: HTMLElement;
  p: HTMLElement;
}

export interface SidebarActions {
  /** Whether the sidebar accepts clicks right now (not while paused or after the game ends). */
  enabled(): boolean;
  produce(source: number, kind: string): void;
  cancel(source: number, index: number): void;
  startPlacement(source: number, kind: string): void;
  sell(id: number): void;
  repair(id: number, on: boolean): void;
  fire(id: number): void;
  /** An action was refused; tell the player why. */
  refused(reason: string): void;
}

const own = (snap: Snapshot): BuildingSnap[] => snap.buildings.filter((b) => b.owner === snap.viewer);

function missing(snap: Snapshot, requires: readonly string[]): string[] {
  const have = new Set(own(snap).map((b) => b.kind));
  return requires.filter((r) => !have.has(r));
}

/** How many items a Ctrl-click queues. */
export const BULK_QUEUE = 5;

export class Sidebar {
  private root = document.createElement('div');
  private resEl: HTMLElement;
  private buildEl: HTMLElement;
  private trainEl: HTMLElement;
  private selEl: HTMLElement;
  private swEl: HTMLElement;
  private swRows: HTMLElement;
  private swRefs = new Map<number, { row: HTMLElement; name: HTMLElement; state: HTMLElement; bar: HTMLElement; btn: HTMLButtonElement }>();
  private queues = new Map<number, { kind: string }[]>();
  private mine: BuildingSnap[] = [];
  private selected: number | null = null;
  private lastKey = '';
  private selKey = 'init';
  private lastAt = 0;
  private sellConfirm = new SellConfirm(3000);

  constructor(private actions: SidebarActions) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.id = 'sidebar';
    this.root.innerHTML = '<div class="box" id="sb-res"></div><div class="box sw" id="sb-sw" style="display:none"><h4>Superweapon</h4><div id="sb-sw-rows"></div></div><div class="scroll"><div class="box" id="sb-sel" style="display:none"></div><div class="box"><h4>Structures</h4><div class="list" id="sb-build"></div></div><div class="box"><h4>Units</h4><div class="list" id="sb-train"></div></div></div>';
    document.body.appendChild(this.root);
    this.resEl = this.root.querySelector('#sb-res') as HTMLElement;
    this.buildEl = this.root.querySelector('#sb-build') as HTMLElement;
    this.trainEl = this.root.querySelector('#sb-train') as HTMLElement;
    this.selEl = this.root.querySelector('#sb-sel') as HTMLElement;
    this.swEl = this.root.querySelector('#sb-sw') as HTMLElement;
    this.swRows = this.root.querySelector('#sb-sw-rows') as HTMLElement;
    this.root.addEventListener('click', (e) => this.onClick(e, false));
    this.root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.onClick(e, true);
    });
  }

  /** Queues one item, or five with Ctrl held; the sim ignores any that do not fit or cannot be afforded. */
  private queue(src: number, kind: string, bulk: boolean): void {
    for (let i = 0; i < (bulk ? BULK_QUEUE : 1); i++) this.actions.produce(src, kind);
  }

  /** Queues one unit, or five with Ctrl held, each to the producer that would finish it soonest (PRD-11). */
  private train(kind: string, bulk: boolean): void {
    const plan = this.mine.map((b) => ({ ...b, queue: [...b.queue] }));
    for (let i = 0; i < (bulk ? BULK_QUEUE : 1); i++) {
      const src = trainSource(plan, kind, this.selected);
      if (src === null) return;
      this.actions.produce(src, kind);
      plan.find((b) => b.id === src)?.queue.push({ kind, pct: 0, ready: false });
    }
  }

  /** Cancels the newest queued unit of a kind across all buildings, or five with Ctrl held (PRD-12). */
  private untrain(kind: string, bulk: boolean): void {
    const plan = this.mine.map((b) => ({ ...b, queue: [...b.queue] }));
    for (let i = 0; i < (bulk ? BULK_QUEUE : 1); i++) {
      const q = newestQueued(plan, kind);
      if (!q) return;
      this.actions.cancel(q.source, q.index);
      plan.find((b) => b.id === q.source)?.queue.splice(q.index, 1);
    }
  }

  private onClick(e: MouseEvent, right: boolean): void {
    const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!el || !this.actions.enabled()) return;
    const a = el.dataset.act;
    const kind = el.dataset.kind ?? '';
    const src = Number(el.dataset.src ?? -1);
    const idx = Number(el.dataset.idx ?? -1);
    if (right) {
      // Cancelling is always allowed, even when the item is disabled (full queue, unaffordable, locked).
      if (a === 'train') this.untrain(kind, e.ctrlKey);
      else if (idx >= 0 && a === 'build') for (const i of cancelPlan(this.queues.get(src) ?? [], kind, e.ctrlKey ? BULK_QUEUE : 1)) this.actions.cancel(src, i);
      return;
    }
    if (el.classList.contains('off')) {
      if (el.dataset.why) this.actions.refused(el.dataset.why);
      return;
    }
    if (a === 'build') {
      if (el.classList.contains('ready')) this.actions.startPlacement(src, kind);
      else this.queue(src, kind, e.ctrlKey);
    } else if (a === 'train') this.train(kind, e.ctrlKey);
    else if (a === 'sell') {
      if (this.sellConfirm.click(src, performance.now()) === 'sell') this.actions.sell(src);
      this.selKey = 'stale';
      this.lastKey = '';
    }
    else if (a === 'repair') this.actions.repair(src, el.dataset.on === '1');
    else if (a === 'fire') this.actions.fire(src);
  }

  update(snap: Snapshot, selectedBuilding: number | null, now: number, targeting: number | null = null): void {
    const me = snap.viewer;
    if (me === null) return;
    const player = snap.players[me];
    if (!player) return;
    const mine = own(snap);
    this.mine = mine;
    this.selected = selectedBuilding;
    this.queues = new Map(mine.map((b) => [b.id, b.queue.map((q) => ({ kind: q.kind }))]));
    const armed = selectedBuilding !== null && this.sellConfirm.armed(selectedBuilding, now);
    const key = JSON.stringify([player.credits, player.powerOut, player.powerIn, mine.map((b) => [b.id, b.kind, b.hp, b.repairing, b.charge, b.queue.map((q) => [q.kind, q.pct, q.ready])]), selectedBuilding, armed, targeting]);
    if (key === this.lastKey || now - this.lastAt < 120) return;
    this.lastKey = key;
    this.lastAt = now;

    const low = player.powerIn > player.powerOut;
    const pct = Math.min(100, Math.round((player.powerIn / Math.max(1, player.powerOut)) * 100));
    this.resEl.innerHTML = `<div class="res"><span>Shards</span><span class="cr">◈ ${player.credits}</span></div><div class="power ${low ? 'low' : ''}"><i style="width:${pct}%"></i></div><div class="power-label ${low ? 'low' : ''}"><span>Power ${player.powerIn}/${player.powerOut}</span><span>${low ? 'LOW POWER' : 'OK'}</span></div>`;

    this.renderBuild(snap, player.faction, player.credits, mine);
    this.renderTrain(snap, player.faction, player.credits, mine);
    this.renderSelection(mine, selectedBuilding, low, armed);
    this.renderSuperweapons(mine, low, targeting, player.faction);
  }

  /** The superweapon panel (UI-9): always in view while the player owns one, with a fire button once it is ready. */
  private renderSuperweapons(mine: BuildingSnap[], low: boolean, targeting: number | null, faction: Faction): void {
    const rows = superweaponRows(mine, low, targeting);
    this.swEl.style.display = rows.length ? 'block' : 'none';
    this.swEl.classList.toggle('alien', faction === 'alien');
    const seen = new Set<number>();
    for (const r of rows) {
      seen.add(r.id);
      let ref = this.swRefs.get(r.id);
      if (!ref) {
        // Built once per weapon and updated in place, so a click is never lost to a re-render.
        const row = document.createElement('div');
        row.className = 'sw-row';
        row.innerHTML = '<span class="sw-name"></span><button class="fire" data-act="fire"></button><span class="sw-state"></span><div class="sw-bar"><i></i></div>';
        this.swRows.appendChild(row);
        ref = { row, name: row.querySelector('.sw-name') as HTMLElement, state: row.querySelector('.sw-state') as HTMLElement, bar: row.querySelector('.sw-bar > i') as HTMLElement, btn: row.querySelector('button') as HTMLButtonElement };
        ref.btn.dataset.src = String(r.id);
        this.swRefs.set(r.id, ref);
      }
      ref.name.textContent = r.name;
      if (ref.state.textContent !== r.state) ref.state.textContent = r.state;
      if (ref.btn.textContent !== r.button) ref.btn.textContent = r.button;
      ref.bar.style.width = `${r.pct}%`;
      ref.row.classList.toggle('ready', r.ready && !r.armed);
      ref.row.classList.toggle('armed', r.armed);
      ref.btn.classList.toggle('off', !r.ready && !r.armed);
      ref.btn.dataset.why = r.why;
      ref.btn.title = r.armed ? 'Cancel targeting (or right-click the map)' : r.ready ? 'Fire: then click the target' : r.why;
    }
    for (const [id, ref] of this.swRefs) {
      if (seen.has(id)) continue;
      ref.row.remove();
      this.swRefs.delete(id);
    }
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
    r.el.dataset.why = a.why;
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
        const placeable = !!q && q.ready && idx === 0;
        const off = !placeable && (!hq || miss.length > 0 || credits < d.cost || full);
        const why = off ? (!hq ? `Requires ${buildingDef(hqOf(faction)).name}` : (queueRefusal(kind, mine.map((b) => b.kind), credits, !full) ?? 'Unavailable')) : '';
        const title = miss.length ? `Requires ${miss.map((m) => buildingDef(m).name).join(', ')}` : `${d.name}: power ${d.power > 0 ? '+' : ''}${d.power}`;
        this.item(this.buildEl, { act: 'build', kind, src: hq?.id ?? -1, idx, name: d.name, cost: d.cost, off, ready: placeable, pct: q ? q.pct : 0, count: hq ? hq.queue.filter((x) => x.kind === kind).length : 0, title, why });
    }
  }

  private renderTrain(snap: Snapshot, faction: Faction, credits: number, mine: BuildingSnap[]): void {
    for (const kind of Object.keys(UNIT_DEFS).filter((k) => unitDef(k).faction === faction)) {
      {
        const d = unitDef(kind);
        const producers = mine.filter((b) => b.kind === d.builtAt);
        const miss = missing(snap, [d.builtAt, ...d.requires]);
        const queued = producers.flatMap((b) => b.queue.map((q, i) => ({ b, q, i }))).filter((x) => x.q.kind === kind);
        const lead = queued.reduce<(typeof queued)[number] | undefined>((best, x) => (!best || x.q.pct > best.q.pct ? x : best), undefined);
        const why = queueRefusal(kind, mine.map((b) => b.kind), credits, trainSource(mine, kind, this.selected) !== null) ?? '';
        const off = why !== '';
        const title = miss.length ? `Requires ${miss.map((m) => buildingDef(m).name).join(', ')}` : `${d.name}: ${d.hp} HP`;
        this.item(this.trainEl, { act: 'train', kind, src: -1, idx: -1, name: d.name, cost: d.cost, off, ready: false, pct: lead ? lead.q.pct : 0, count: queued.length, title, why });
      }
    }
  }

  private renderSelection(mine: BuildingSnap[], selectedBuilding: number | null, low: boolean, sellArmed: boolean): void {
    const b = selectedBuilding === null ? undefined : mine.find((x) => x.id === selectedBuilding);
    const selKey = b ? `${b.id}:${b.hp}:${b.repairing}:${b.charge}:${low}:${sellArmed}` : '';
    if (selKey === this.selKey) return; // keep the buttons stable unless something visible changed
    this.selKey = selKey;
    if (!b) {
      this.selEl.style.display = 'none';
      return;
    }
    const d = buildingDef(b.kind);
    this.selEl.style.display = 'block';
    const sellable = !d.hq;
    const fs = fireState(b.charge, low);
    const fire = d.superweapon ? `<button class="act${fs.ready ? '' : ' off'}" data-act="fire" data-src="${b.id}" data-why="${fs.label}" ${fs.ready ? '' : 'style="opacity:.4"'}>${fs.label}</button>` : '';
    const sell = sellable ? `<button class="act" data-act="sell" data-src="${b.id}" ${sellArmed ? 'style="border-color:#ff5a4a;color:#ff9a8a"' : ''}>${sellArmed ? 'Confirm sell?' : 'Sell'}</button>` : '';
    const rally = rallyHint(b.kind) ? '<div style="margin-top:6px;color:#7f93a6">Right-click ground to set rally</div>' : '';
    this.selEl.innerHTML = `<div class="sel-name">${d.name}</div><div style="color:#9fb4c6;margin-bottom:6px">HP ${b.hp}/${d.hp}${d.superweapon ? ` · charge ${b.charge}%` : ''}</div>${fire}${sell}<button class="act" data-act="repair" data-src="${b.id}" data-on="${b.repairing ? 0 : 1}">${b.repairing ? 'Stop repair' : 'Repair'}</button>${rally}`;
  }
}
