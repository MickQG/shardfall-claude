import { demoMap, demoUnits } from './data/maps';
import { SimClient } from './host/client';
import { mapBounds, pan, screenToWorld, zoomAt, type Camera } from './render/camera';
import { GameView } from './render/gameView';
import { interpolate } from './render/interp';
import { screenToTile, tileToScreen } from './render/iso';
import { FP, TICKS_PER_SECOND } from './sim';

const host = document.getElementById('app');
if (!host) throw new Error('missing #app');

const map = demoMap();
const bounds = mapBounds(map.width, map.height);
const sim = new SimClient({ seed: 1, map, units: demoUnits() });
const view = new GameView();

const start = tileToScreen(12, 12);
let cam: Camera = { x: start.x, y: start.y, zoom: 1 };
const keys = new Set<string>();
let mouse = { x: -1, y: -1 };

const EDGE = 12;
const PAN_SPEED = 900;

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

    if (sim.curr && sim.prev) {
      const alpha = (performance.now() - sim.currAt) / (1000 / TICKS_PER_SECOND);
      view.update(interpolate(sim.prev.units, sim.curr.units, alpha), cam);
    }
    requestAnimationFrame(frame(t));
  };
}

async function boot(): Promise<void> {
  const first = await new Promise<import('./sim').Snapshot>((resolve) => {
    const poll = (): void => (sim.curr ? resolve(sim.curr) : void setTimeout(poll, 10));
    poll();
  });
  await view.mount(host as HTMLElement, first);
  const canvas = view.app.canvas;

  window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
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
  // Demo order (selection arrives in M3): right-click sends all of player 0's units.
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 2 || !sim.curr) return;
    const w = screenToWorld(cam, view.viewport, e.offsetX, e.offsetY);
    const t = screenToTile(w.x, w.y);
    const mine = sim.curr.units.filter((u) => u.owner === 0).map((u) => u.id);
    sim.send({ type: 'move', player: 0, units: mine, x: Math.round(t.x * FP), y: Math.round(t.y * FP) });
  });

  (window as unknown as { __shardfall: unknown }).__shardfall = { snapshot: () => sim.curr, camera: () => cam };
  document.body.dataset.ready = 'true';
  requestAnimationFrame(frame(performance.now()));
}

void boot();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
