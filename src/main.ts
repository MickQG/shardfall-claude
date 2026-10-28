import { demoMap, demoUnits } from './data/maps';
import { SimClient } from './host/client';
import { mapBounds, pan, screenToWorld, zoomAt, type Camera } from './render/camera';
import { GameView } from './render/gameView';
import { interpolate } from './render/interp';
import { screenToTile, tileToScreen } from './render/iso';
import { FP, TICKS_PER_SECOND, type Snapshot } from './sim';
import { createHud } from './ui/hud';
import { Minimap, miniToTile } from './ui/minimap';
import { boxSelect, pickUnit, Selection, selectSameKind, toScreenUnits } from './ui/selection';

const PLAYER = 0;
const host = document.getElementById('app');
if (!host) throw new Error('missing #app');

const map = demoMap();
const bounds = mapBounds(map.width, map.height);
const sim = new SimClient({ seed: 1, map, units: demoUnits() });
const view = new GameView();
const selection = new Selection();
const hud = createHud();

const start = tileToScreen(12, 12);
let cam: Camera = { x: start.x, y: start.y, zoom: 1 };
const keys = new Set<string>();
let mouse = { x: -1, y: -1 };

const EDGE = 12;
const PAN_SPEED = 900;

const tileFromScreen = (sx: number, sy: number): { x: number; y: number } => {
  const w = screenToWorld(cam, view.viewport, sx, sy);
  return screenToTile(w.x, w.y);
};

const aliveOwn = (snap: Snapshot): Set<number> => new Set(snap.units.filter((u) => u.owner === PLAYER).map((u) => u.id));

function centerOn(tx: number, ty: number): void {
  const p = tileToScreen(tx, ty);
  cam = { ...cam, x: p.x, y: p.y };
}

let minimap: Minimap | null = null;

function frame(prevTime: number): (t: number) => void {
  return (t) => {
    const dt = Math.min(0.05, (t - prevTime) / 1000);
    prevTime = t;
    const v = view.viewport;
    let dx = 0;
    let dy = 0;
    if (keys.has('a') || keys.has('arrowleft') || (mouse.x >= 0 && mouse.x < EDGE)) dx -= 1;
    if (keys.has('d') || keys.has('arrowright') || mouse.x > v.width - EDGE) dx += 1;
    if (keys.has('w') || keys.has('arrowup') || (mouse.y >= 0 && mouse.y < EDGE)) dy -= 1;
    if (keys.has('s') || keys.has('arrowdown') || mouse.y > v.height - EDGE) dy += 1;
    if (dx || dy) cam = pan(cam, dx * PAN_SPEED * dt, dy * PAN_SPEED * dt, bounds);

    const curr = sim.curr;
    if (curr && sim.prev) {
      selection.prune(aliveOwn(curr));
      const alpha = (performance.now() - sim.currAt) / (1000 / TICKS_PER_SECOND);
      const ru = interpolate(sim.prev.units, curr.units, alpha);
      view.update(ru, cam, new Set(selection.selected), curr);

      const own = curr.units.filter((u) => selection.has(u.id));
      const kinds = new Map<string, number>();
      for (const u of own) kinds.set(u.kind, (kinds.get(u.kind) ?? 0) + 1);
      hud.setInfo(own.length ? [`${own.length} selected`, [...kinds].map(([k, n]) => `${n}× ${k}`).join(', ')] : []);

      if (!minimap) {
        minimap = new Minimap(curr);
        hud.minimapHost.appendChild(minimap.canvas);
        wireMinimap(minimap);
      }
      const corners = [
        [0, 0],
        [v.width, 0],
        [v.width, v.height],
        [0, v.height],
      ].map(([x, y]) => tileFromScreen(x as number, y as number));
      minimap.draw(curr, corners);
    }
    requestAnimationFrame(frame(t));
  };
}

function wireMinimap(mm: Minimap): void {
  const toTile = (e: MouseEvent): { x: number; y: number } => {
    const r = mm.canvas.getBoundingClientRect();
    return miniToTile(mm.layout, e.clientX - r.left, e.clientY - r.top);
  };
  let dragging = false;
  mm.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  mm.canvas.addEventListener('pointerdown', (e) => {
    const t = toTile(e);
    if (e.button === 2) {
      sendMove(t.x, t.y);
      return;
    }
    dragging = true;
    centerOn(t.x, t.y);
  });
  window.addEventListener('pointermove', (e) => {
    if (dragging) {
      const t = toTile(e);
      centerOn(t.x, t.y);
    }
  });
  window.addEventListener('pointerup', () => (dragging = false));
}

function sendMove(tx: number, ty: number): void {
  const ids = selection.selected;
  if (ids.length === 0) return;
  sim.send({ type: 'move', player: PLAYER, units: ids, x: Math.round(tx * FP), y: Math.round(ty * FP) });
}

async function boot(): Promise<void> {
  const first = await new Promise<Snapshot>((resolve) => {
    const poll = (): void => (sim.curr ? resolve(sim.curr) : void setTimeout(poll, 10));
    poll();
  });
  await view.mount(host as HTMLElement, first);
  const canvas = view.app.canvas;

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys.add(k);
    if (/^[1-9]$/.test(k) && sim.curr) {
      const n = Number(k);
      if (e.ctrlKey) {
        selection.assignGroup(n);
        e.preventDefault();
      } else {
        const ids = selection.recallGroup(n, aliveOwn(sim.curr));
        const first = sim.curr.units.find((u) => u.id === ids[0]);
        if (first && e.repeat) centerOn(first.x / FP, first.y / FP);
      }
    } else if (k === 'x') {
      sim.send({ type: 'stop', player: PLAYER, units: selection.selected });
    } else if (k === ' ' && sim.curr) {
      const own = sim.curr.units.filter((u) => selection.has(u.id));
      if (own[0]) centerOn(own[0].x / FP, own[0].y / FP);
      e.preventDefault();
    } else if (k === 'h' && sim.curr) {
      const base = sim.curr.units.find((u) => u.owner === PLAYER);
      if (base) centerOn(base.x / FP, base.y / FP);
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  canvas.addEventListener('pointermove', (e) => (mouse = { x: e.offsetX, y: e.offsetY }));
  canvas.addEventListener('pointerleave', () => (mouse = { x: -1, y: -1 }));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      cam = zoomAt(cam, view.viewport, e.offsetX, e.offsetY, e.deltaY < 0 ? 1.1 : 1 / 1.1, bounds);
    },
    { passive: false },
  );

  // Left button: click-select, double-click select-same-kind, drag box-select. Right: move order.
  let drag: { x0: number; y0: number } | null = null;
  let lastClick = { t: 0, id: -1 };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 2) {
      const t = tileFromScreen(e.offsetX, e.offsetY);
      sendMove(t.x, t.y);
    } else if (e.button === 0) {
      drag = { x0: e.offsetX, y0: e.offsetY };
    }
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = canvas.getBoundingClientRect();
    hud.selbox(Math.hypot(e.clientX - r.left - drag.x0, e.clientY - r.top - drag.y0) > 5 ? { x0: drag.x0 + r.left, y0: drag.y0 + r.top, x1: e.clientX, y1: e.clientY } : null);
  });
  window.addEventListener('pointerup', (e) => {
    if (!drag || e.button !== 0 || !sim.curr || !sim.prev) return;
    const r = canvas.getBoundingClientRect();
    const x1 = e.clientX - r.left;
    const y1 = e.clientY - r.top;
    const alpha = (performance.now() - sim.currAt) / (1000 / TICKS_PER_SECOND);
    const su = toScreenUnits(interpolate(sim.prev.units, sim.curr.units, alpha), cam, view.viewport);
    if (Math.hypot(x1 - drag.x0, y1 - drag.y0) > 5) {
      const ids = boxSelect(su, drag.x0, drag.y0, x1, y1, PLAYER);
      if (e.shiftKey) selection.toggle(ids);
      else selection.set(ids);
    } else {
      const id = pickUnit(su, x1, y1, PLAYER);
      const now = performance.now();
      if (id === null) {
        if (!e.shiftKey) selection.clear();
      } else if (now - lastClick.t < 350 && lastClick.id === id) {
        selection.set(selectSameKind(su, id, PLAYER, view.viewport));
      } else if (e.shiftKey) selection.toggle([id]);
      else selection.set([id]);
      lastClick = { t: now, id: id ?? -1 };
    }
    drag = null;
    hud.selbox(null);
  });

  (window as unknown as { __shardfall: unknown }).__shardfall = {
    snapshot: () => sim.curr,
    camera: () => cam,
    selected: () => selection.selected,
    screenPos: (id: number) => {
      if (!sim.curr || !sim.prev) return null;
      const su = toScreenUnits(interpolate(sim.curr.units, sim.curr.units, 1), cam, view.viewport).find((u) => u.id === id);
      return su ? { x: su.sx, y: su.sy } : null;
    },
  };
  document.body.dataset.ready = 'true';
  requestAnimationFrame(frame(performance.now()));
}

void boot();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
