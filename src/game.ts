import { DIFFICULTIES } from './ai/ai';
import { duelConfig, rushConfig, showcaseConfig, skirmishConfig } from './data/maps';
import { buildingDef, unitDef } from './data/defs';
import { AudioEngine } from './audio/engine';
import { soundFor } from './audio/plan';
import { SimClient } from './host/client';
import { centerOnTile, clampCamera, mapBounds, pan, zoomAt, type Camera } from './render/camera';
import { GameView, type PlacementPreview } from './render/gameView';
import type { WorldRenderer } from './render/worldRenderer';
import { interpolate } from './render/interp';
import { tileToScreen } from './render/iso';
import { canPlace, FP, TICKS_PER_SECOND, type Snapshot } from './sim';
import { AlertTracker } from './ui/alerts';
import { createHud, resultText, type ScoreView } from './ui/hud';
import { armyPath, scoreRows } from './ui/score';
import { amoveClick, attackMoveIds, centroid, combatUnitIds, DoubleTap, inputAllowed, KeyTap, minimapClick } from './ui/controls';
import { cursorCss, cursorFor, type CursorState } from './ui/cursor';
import { clampTile, Minimap, miniToTile } from './ui/minimap';
import { rallyLine } from './ui/rally';
import { effectsEnabled, loadSettings, saveSettings } from './ui/settings';
import { placementLive } from './ui/production';
import { FrameStats } from './ui/frameStats';
import { Sidebar } from './ui/sidebar';
import { hitTest, hoverKind, rightClickOrder, type HitContext } from './ui/hit';
import { boxSelect, Selection, selectKinds, selectSameKind, toScreenUnits } from './ui/selection';

const PLAYER = 0;
const host = document.getElementById('app');
if (!host) throw new Error('missing #app');

const params = new URLSearchParams(location.search);
const myFaction = params.get('faction') === 'alien' ? 'alien' : 'human';
const level = (['easy', 'medium', 'hard'] as const).find((d) => d === params.get('difficulty')) ?? 'medium';
const scenario = params.get('scenario');
const opts = { factions: [myFaction, myFaction === 'human' ? 'alien' : 'human'] as ['human' | 'alien', 'human' | 'alien'], bonuses: [0, DIFFICULTIES[level].bonus] as [number, number] };
const seed = Number(params.get('seed') ?? Date.now() % 100000);
const cfg = scenario === 'showcase' ? showcaseConfig(seed, Math.min(150, Number(params.get('army') ?? 0) || 0)) : scenario === 'duel' ? duelConfig(seed, opts) : scenario === 'rush' ? rushConfig(seed, opts) : skirmishConfig(seed, opts);
/** The three.js world view (ADR 0005, R3D-1): chosen once here, never part of the simulation. */
const use3d = params.get('renderer') === '3d';
const map = cfg.map;
const bounds = mapBounds(map.width, map.height);
// Scenarios are scripted fights without an AI opponent; a normal game has the AI play player 1.
const sim = new SimClient(cfg, scenario ? [] : [{ player: 1, difficulty: level }]);
// three.js loads only when the 3D view is asked for, so classic sessions do not download it.
const view: WorldRenderer = use3d ? new (await import('./render3d/view3d')).View3D() : new GameView();
const frameStats = new FrameStats();
const showFrameTime = use3d || scenario === 'showcase';
const selection = new Selection();
const hud = createHud();
const settings = loadSettings(safeStorage(), matchMedia('(prefers-reduced-motion: reduce)').matches);
const audio = new AudioEngine();
audio.setMuted(settings.muted);
audio.setVolume(settings.volume);
const alerts = new AlertTracker(PLAYER);
let paused = false;
let speedIdx = 1;
const SPEEDS = [0.5, 1, 2, 4];

function safeStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function topbar(): void {
  hud.setTop(`Shardfall · ×${SPEEDS[speedIdx]} · P pause · +/- speed · M ${settings.muted ? 'unmute' : 'mute'} · Q select combat · E select same kind · F attack-move · F2 quality: ${settings.quality}`);
}
topbar();

/** Whether an input reaches the game right now (CTL-16). */
const allowed = (input: string): boolean => inputAllowed(input, { paused, over: !!sim.curr?.over });

function setPaused(p: boolean): void {
  paused = p;
  sim.setPaused(p);
  hud.showPause(p, { resume: () => setPaused(false), quit: () => (location.search = '') });
}

let cam: Camera = { x: 0, y: 0, zoom: 1 };
const keys = new Set<string>();
let mouse = { x: -1, y: -1 };
let selectedBuilding: number | null = null;
let placing: { source: number; kind: string } | null = null;
let minimap: Minimap | null = null;
let targeting: { building: number } | null = null;
let amoveMode = false;
const qTap = new DoubleTap(350);
const eTap = new DoubleTap(350);
const groupTap = new KeyTap(350);
let resultShown = false;
let lastAlertTick = -1;

const EDGE = 12;
const PAN_SPEED = 900;

const tileFromScreen = (sx: number, sy: number): { x: number; y: number } => view.projector(cam).toGround(sx, sy);

const aliveOwn = (snap: Snapshot): Set<number> => new Set(snap.units.filter((u) => u.owner === PLAYER).map((u) => u.id));

function centerOn(tx: number, ty: number): void {
  cam = centerOnTile(cam, tx, ty, bounds);
}

function centerOnUnits(units: readonly { x: number; y: number }[]): void {
  const c = centroid(units);
  if (c) centerOn(c.x, c.y);
}

/** One picking context per query: units are interpolated to the same instant for hover, right-click and left-click. */
function hitContext(snap: Snapshot): HitContext {
  const proj = view.projector(cam);
  const alpha = (performance.now() - sim.currAt) / (1000 / TICKS_PER_SECOND);
  return {
    player: PLAYER,
    units: toScreenUnits(interpolate(sim.prev?.units ?? snap.units, snap.units, alpha), proj),
    buildings: snap.buildings,
    // The hit-test works in isometric pixels: map the ground point under the pointer back into them.
    toWorld: (sx, sy) => {
      const g = proj.toGround(sx, sy);
      return tileToScreen(g.x, g.y);
    },
    blocked: (tx, ty) => !!map.blocked?.[ty * map.width + tx],
    shardAt: (tx, ty) => (snap.shards[ty * snap.mapWidth + tx] ?? 0) > 0,
  };
}

function placementPreview(snap: Snapshot): PlacementPreview | null {
  if (!placing || mouse.x < 0 || !placementLive(placing, snap.buildings, PLAYER)) return null;
  const d = buildingDef(placing.kind);
  const t = tileFromScreen(mouse.x, mouse.y);
  const tx = Math.floor(t.x - d.w / 2 + 0.5);
  const ty = Math.floor(t.y - d.h / 2 + 0.5);
  const ok =
    !!snap.fog &&
    canPlace(
      {
        width: snap.mapWidth,
        height: snap.mapHeight,
        terrain: map.blocked,
        occupied: [...snap.buildings, ...snap.ghosts],
        own: snap.buildings.filter((b) => b.owner === PLAYER),
        fog: snap.fog,
      },
      placing.kind,
      tx,
      ty,
    );
  return { kind: placing.kind, tx, ty, ok };
}

const sidebar = new Sidebar({
  enabled: () => allowed('sidebar'),
  produce: (source, kind) => sim.send({ type: 'produce', player: PLAYER, source, kind }),
  cancel: (source, index) => sim.send({ type: 'cancel', player: PLAYER, source, index }),
  startPlacement: (source, kind) => {
    placing = { source, kind };
  },
  sell: (id) => sim.send({ type: 'sell', player: PLAYER, building: id }),
  repair: (id, on) => sim.send({ type: 'repair', player: PLAYER, building: id, on }),
  fire: (id) => {
    targeting = { building: id };
  },
  refused: (reason) => refuse(reason),
});

const FACTION_NAME = { human: 'Aegis Union', alien: 'Vrax Hive' } as const;
const FACTION_COLOR = { human: '#6fd3ff', alien: '#b6ff5c' } as const;

/** Score table and army graph for the result screen (SCR-3). */
function scoreView(snap: Snapshot): ScoreView {
  const stats = snap.stats ?? [];
  const names = snap.players.map((p, i) => `${FACTION_NAME[p.faction]}${i === PLAYER ? ' (you)' : ''}`);
  const max = Math.max(0, ...stats.flatMap((s) => s.army));
  return { ...scoreRows(stats, names, snap.tick), series: stats.map((s, i) => ({ color: FACTION_COLOR[snap.players[i]?.faction ?? 'human'], points: armyPath(s.army, max, 320, 120) })) };
}

/** Tell the player an action was refused (UI-3). */
function refuse(reason: string): void {
  hud.toast(reason, 'bad');
  audio.play('deny');
}

/** What the pointer is over and the current input mode, for choosing the cursor. */
function cursorState(): CursorState {
  const snap = sim.curr;
  const anySelected = selection.selected.length > 0;
  const combatSelected = !!snap && combatUnitIds(snap.units.filter((u) => selection.has(u.id)), PLAYER).length > 0;
  const mode: CursorState['mode'] = targeting ? 'targeting' : placing ? 'placing' : amoveMode ? 'amove' : 'normal';
  const hover: CursorState['hover'] = snap && mouse.x >= 0 ? hoverKind(hitTest(hitContext(snap), mouse.x, mouse.y), anySelected) : 'ground';
  const p = snap && mode === 'placing' ? placementPreview(snap) : null;
  const harvesterSelected = !!snap && snap.units.some((u) => selection.has(u.id) && unitDef(u.kind).capacity !== undefined);
  return { mode, combatSelected, harvesterSelected, anySelected, hover, placementOk: p?.ok };
}

function frame(prevTime: number): (t: number) => void {
  return (t) => {
    if (showFrameTime) frameStats.push(t - prevTime);
    const dt = Math.min(0.05, (t - prevTime) / 1000);
    prevTime = t;
    const v = view.viewport;
    let dx = 0;
    let dy = 0;
    if (keys.has('a') || keys.has('arrowleft') || (mouse.x >= 0 && mouse.x < EDGE)) dx -= 1;
    if (keys.has('d') || keys.has('arrowright') || (mouse.x > v.width - EDGE && mouse.x <= v.width)) dx += 1;
    if (keys.has('w') || keys.has('arrowup') || (mouse.y >= 0 && mouse.y < EDGE)) dy -= 1;
    if (keys.has('s') || keys.has('arrowdown') || (mouse.y > v.height - EDGE && mouse.y <= v.height)) dy += 1;
    if ((dx || dy) && allowed('w')) cam = pan(cam, dx * PAN_SPEED * dt, dy * PAN_SPEED * dt, bounds);

    for (const ev of sim.events.splice(0)) {
      view.spawn(ev, t);
      const s = soundFor(ev, PLAYER);
      audio.play(s.name, s.gain);
    }
    view.canvas.style.cursor = cursorCss(cursorFor(cursorState()));
    const curr = sim.curr;
    if (curr && curr.over && !resultShown) {
      resultShown = true;
      const r = resultText(curr.winner, PLAYER);
      hud.showResult(r.title, r.sub, r.color, curr.stats ? scoreView(curr) : undefined);
    }
    if (curr && sim.prev) {
      selection.prune(aliveOwn(curr));
      if (selectedBuilding !== null && !curr.buildings.some((b) => b.id === selectedBuilding)) selectedBuilding = null;
      if (placing && !placementLive(placing, curr.buildings, PLAYER)) placing = null;
      if (targeting && !curr.buildings.some((b) => b.id === targeting?.building && b.owner === PLAYER)) targeting = null;
      const alpha = (performance.now() - sim.currAt) / (1000 / TICKS_PER_SECOND);
      const ru = interpolate(sim.prev.units, curr.units, alpha);
      view.update(ru, cam, { selectedUnits: new Set(selection.selected), selectedBuilding, placement: placementPreview(curr), viewer: PLAYER, rally: selectedBuilding === null ? null : ((b) => (b ? rallyLine(b, selectedBuilding) : null))(curr.buildings.find((x) => x.id === selectedBuilding)), time: t, fx: effectsEnabled(settings) }, curr);
      if (curr.tick !== lastAlertTick) {
        lastAlertTick = curr.tick;
        for (const a of alerts.update(curr)) {
          hud.toast(a.text, a.level);
          audio.play(a.level === 'info' ? 'ready' : 'alert');
          if (a.at && minimap) minimap.ping(a.at.tx, a.at.ty, t, a.level === 'bad' ? '#ff5a4a' : '#ffd34a');
        }
      }
      sidebar.update(curr, selectedBuilding, t);

      const own = curr.units.filter((u) => selection.has(u.id));
      const kinds = new Map<string, number>();
      for (const u of own) kinds.set(unitDef(u.kind).name, (kinds.get(unitDef(u.kind).name) ?? 0) + 1);
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
      minimap.draw(curr, corners, t);
    }
    requestAnimationFrame(frame(t));
  };
}

function wireMinimap(mm: Minimap): void {
  const toTile = (e: MouseEvent): { x: number; y: number } => {
    const r = mm.canvas.getBoundingClientRect();
    const t = miniToTile(mm.layout, e.clientX - r.left, e.clientY - r.top);
    return clampTile(t.x, t.y, map.width, map.height);
  };
  let dragging = false;
  mm.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  mm.canvas.addEventListener('pointerdown', (e) => {
    const t = toTile(e);
    const x = Math.round(t.x * FP);
    const y = Math.round(t.y * FP);
    const action = minimapClick(e.button, { amove: amoveMode, targeting: targeting !== null });
    if (!allowed(action === 'camera' || action === 'disarm' ? 'minimap-camera' : 'minimap-order')) return;
    switch (action) {
      case 'cancel':
        targeting = null;
        return;
      case 'disarm':
        amoveMode = false;
        dragging = true;
        centerOn(t.x, t.y);
        return;
      case 'attackmove':
        if (sim.curr) sendAttackMove(sim.curr, x, y);
        amoveMode = false;
        return;
      case 'superweapon':
        if (targeting) sim.send({ type: 'superweapon', player: PLAYER, building: targeting.building, x, y });
        targeting = null;
        return;
      case 'order':
        order(t.x, t.y);
        return;
      case 'camera':
        dragging = true;
        centerOn(t.x, t.y);
    }
  });
  window.addEventListener('pointermove', (e) => {
    if (dragging) {
      const t = toTile(e);
      centerOn(t.x, t.y);
    }
  });
  window.addEventListener('pointerup', () => (dragging = false));
}

/** Attack-move the combat units in the selection to a fixed-point position (CTL-13); nothing is sent without any. */
function sendAttackMove(snap: Snapshot, x: number, y: number): void {
  const units = attackMoveIds(snap.units, selection.selected, PLAYER);
  if (units.length > 0) sim.send({ type: 'attackmove', player: PLAYER, units, x, y });
}

/** Context order for the selection at tile (tx, ty): rally for a building, harvest/move for units. */
function order(tx: number, ty: number): void {
  const snap = sim.curr;
  if (!snap) return;
  const ids = selection.selected;
  if (ids.length === 0) {
    if (selectedBuilding !== null) sim.send({ type: 'rally', player: PLAYER, building: selectedBuilding, x: Math.round(tx * FP), y: Math.round(ty * FP) });
    return;
  }
  const x = Math.round(tx * FP);
  const y = Math.round(ty * FP);
  const haulers = snap.units.filter((u) => ids.includes(u.id) && unitDef(u.kind).capacity !== undefined).map((u) => u.id);
  const onShards = (snap.shards[Math.floor(ty) * snap.mapWidth + Math.floor(tx)] ?? 0) > 0;
  const rest = ids.filter((id) => !haulers.includes(id));
  if (haulers.length) {
    if (onShards) sim.send({ type: 'harvest', player: PLAYER, units: haulers, x, y });
    else sim.send({ type: 'move', player: PLAYER, units: haulers, x, y });
  }
  if (rest.length) sim.send({ type: 'move', player: PLAYER, units: rest, x, y });
}

async function boot(): Promise<void> {
  const first = await new Promise<Snapshot>((resolve) => {
    const poll = (): void => (sim.curr ? resolve(sim.curr) : void setTimeout(poll, 10));
    poll();
  });
  await view.mount(host as HTMLElement, first, { blocked: map.blocked, shards: map.shards });
  if (scenario === 'showcase') {
    // Both armies march into each other so the fight and its effects can be seen.
    const army = (p: number): number[] => first.units.filter((u) => u.owner === p).map((u) => u.id);
    sim.send({ type: 'attackmove', player: 0, units: army(0), x: 30 * FP, y: 30 * FP });
    sim.send({ type: 'attackmove', player: 1, units: army(1), x: 5 * FP, y: 5 * FP });
  }
  if (showFrameTime) {
    const el = document.createElement('div');
    el.id = 'frametime';
    el.style.cssText = 'position:fixed;left:12px;top:52px;padding:4px 8px;border-radius:5px;background:rgba(8,12,17,.8);color:#9fe8ff;font:12px/1.3 ui-monospace,monospace;pointer-events:none;z-index:5';
    document.body.appendChild(el);
    setInterval(() => (el.textContent = `${use3d ? 'renderer 3d' : 'renderer classic'} · ${frameStats.label()}${view.readout ? ` · ${view.readout()}` : ''}`), 500);
  }
  const canvas = view.canvas;
  const hq = first.buildings.find((b) => b.owner === PLAYER && buildingDef(b.kind).hq);
  if (hq) centerOn(hq.tx + 1.5, hq.ty + 1.5);

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    audio.unlock();
    // S pans the map, so Ctrl + S must not reach the browser's save dialog.
    if (e.ctrlKey && k === 's') e.preventDefault();
    if (!allowed(k)) return;
    keys.add(k);
    if (k === 'escape') {
      if (placing || targeting || amoveMode) {
        placing = null;
        targeting = null;
        amoveMode = false;
      } else setPaused(!paused);
    }
    if (k === 'f' && !e.ctrlKey && !e.repeat && !placing && !targeting && sim.curr && combatUnitIds(sim.curr.units.filter((u) => selection.has(u.id)), PLAYER).length > 0) amoveMode = true;
    if (k === 'p') setPaused(!paused);
    if (k === 'm') {
      settings.muted = !settings.muted;
      audio.setMuted(settings.muted);
      saveSettings(safeStorage(), settings);
      topbar();
    }
    if (k === 'q' && !e.ctrlKey && !e.repeat && sim.curr) {
      const army = sim.curr.units.filter((u) => u.owner === PLAYER && combatUnitIds([u], PLAYER).length > 0);
      if (army.length > 0) {
        selectedBuilding = null;
        selection.set(army.map((u) => u.id));
        if (qTap.press(performance.now())) centerOnUnits(army);
      }
    }
    if (k === 'e' && !e.ctrlKey && !e.repeat && sim.curr) {
      const ids = selectKinds(sim.curr.units, selection.selected, PLAYER);
      if (ids.length > 0) {
        selectedBuilding = null;
        selection.set(ids);
        if (eTap.press(performance.now())) centerOnUnits(sim.curr.units.filter((u) => selection.has(u.id)));
      }
    }
    if (k === 'f2') {
      e.preventDefault();
      settings.quality = settings.quality === 'high' ? 'low' : 'high';
      saveSettings(safeStorage(), settings);
      topbar();
    }
    if (k === '+' || k === '=' || k === '-') {
      speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, speedIdx + (k === '-' ? -1 : 1)));
      sim.setSpeed(SPEEDS[speedIdx] as number);
      topbar();
    }
    if (/^[1-9]$/.test(k) && sim.curr) {
      const n = Number(k);
      if (e.ctrlKey) {
        selection.assignGroup(n);
        e.preventDefault();
      } else {
        const ids = selection.recallGroup(n, aliveOwn(sim.curr));
        selectedBuilding = null;
        if (!e.repeat && groupTap.press(k, performance.now())) centerOnUnits(sim.curr.units.filter((u) => ids.includes(u.id)));
      }
    } else if (k === 'x') {
      sim.send({ type: 'stop', player: PLAYER, units: selection.selected });
    } else if (k === ' ' && sim.curr) {
      centerOnUnits(sim.curr.units.filter((u) => selection.has(u.id)));
      e.preventDefault();
    } else if (k === 'h' && sim.curr) {
      const home = sim.curr.buildings.find((b) => b.owner === PLAYER && buildingDef(b.kind).hq);
      if (home) centerOn(home.tx + 1.5, home.ty + 1.5);
    }
  });
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  canvas.addEventListener('pointermove', (e) => (mouse = { x: e.offsetX, y: e.offsetY }));
  canvas.addEventListener('pointerleave', () => (mouse = { x: -1, y: -1 }));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (!allowed('wheel')) return;
      // Zoom about the screen centre, then shift so the ground point under the cursor stays put (R3D-4, both renderers).
      const before = view.projector(cam).toGround(e.offsetX, e.offsetY);
      const v = view.viewport;
      const zoomed = zoomAt(cam, v, v.width / 2, v.height / 2, e.deltaY < 0 ? 1.1 : 1 / 1.1, bounds);
      const after = view.projector(zoomed).toGround(e.offsetX, e.offsetY);
      const a = tileToScreen(before.x, before.y);
      const b = tileToScreen(after.x, after.y);
      cam = clampCamera({ ...zoomed, x: zoomed.x + a.x - b.x, y: zoomed.y + a.y - b.y }, bounds);
    },
    { passive: false },
  );

  // Left: click-select / place; double-click selects same kind; drag box-selects. Right: context order / cancel placement.
  let drag: { x0: number; y0: number } | null = null;
  let lastClick = { t: 0, id: -1 };
  canvas.addEventListener('pointerdown', (e) => {
    audio.unlock();
    audio.startMusic(seed);
    if (!allowed('click')) return;
    if (amoveMode) {
      amoveMode = false;
      if (amoveClick(e.button) === 'order' && sim.curr) {
        const t = tileFromScreen(e.offsetX, e.offsetY);
        sendAttackMove(sim.curr, Math.round(t.x * FP), Math.round(t.y * FP));
        return;
      }
      if (e.button !== 0) return;
    }
    if (e.button === 2) {
      if (placing || targeting) {
        placing = null;
        targeting = null;
        amoveMode = false;
        return;
      }
      const snap = sim.curr;
      if (snap && selection.selected.length > 0) {
        const combat = combatUnitIds(snap.units.filter((u) => selection.has(u.id)), PLAYER).length > 0;
        const o = rightClickOrder(hitTest(hitContext(snap), e.offsetX, e.offsetY), combat);
        if (o.kind === 'attack') {
          sim.send({ type: 'attack', player: PLAYER, units: selection.selected, target: o.target });
          return;
        }
      }
      const t = tileFromScreen(e.offsetX, e.offsetY);
      order(t.x, t.y);
    } else if (e.button === 0) {
      if (targeting) {
        const t = tileFromScreen(e.offsetX, e.offsetY);
        sim.send({ type: 'superweapon', player: PLAYER, building: targeting.building, x: Math.round(t.x * FP), y: Math.round(t.y * FP) });
        targeting = null;
        return;
      }
      if (placing && sim.curr) {
        const p = placementPreview(sim.curr);
        if (p?.ok) {
          sim.send({ type: 'place', player: PLAYER, source: placing.source, tx: p.tx, ty: p.ty });
          if (!e.shiftKey) placing = null;
        } else refuse('Cannot build there');
        return;
      }
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
    if (!allowed('click')) {
      drag = null;
      hud.selbox(null);
      return;
    }
    const r = canvas.getBoundingClientRect();
    const x1 = e.clientX - r.left;
    const y1 = e.clientY - r.top;
    const hc = hitContext(sim.curr);
    const su = hc.units;
    if (Math.hypot(x1 - drag.x0, y1 - drag.y0) > 5) {
      const ids = boxSelect(su, drag.x0, drag.y0, x1, y1, PLAYER);
      selectedBuilding = null;
      if (e.shiftKey) selection.add(ids);
      else selection.set(ids);
    } else {
      const hit = hitTest(hc, x1, y1);
      const id = hit.ownUnit;
      const now = performance.now();
      if (id !== null) {
        selectedBuilding = null;
        if (now - lastClick.t < 350 && lastClick.id === id) {
          const same = selectSameKind(su, id, PLAYER, view.viewport);
          if (e.shiftKey) selection.add(same);
          else selection.set(same);
        }
        else if (e.shiftKey) selection.toggle([id]);
        else selection.set([id]);
      } else {
        if (hit.ownBuilding !== null) {
          selection.clear();
          selectedBuilding = hit.ownBuilding;
        } else if (!e.shiftKey) {
          selection.clear();
          selectedBuilding = null;
        }
      }
      lastClick = { t: now, id: id ?? -1 };
    }
    drag = null;
    hud.selbox(null);
  });

  (window as unknown as { __shardfall: unknown }).__shardfall = {
    snapshot: () => sim.curr,
    camera: () => cam,
    selected: () => selection.selected,
    select: (ids: number[]) => {
      selectedBuilding = null;
      selection.set(ids);
    },
    selectedBuilding: () => selectedBuilding,
    modes: () => ({ placing: placing !== null, targeting: targeting !== null, amove: amoveMode }),
    placing: () => placing,
    send: (c: Parameters<SimClient['send']>[0]) => sim.send(c),
    setSpeed: (v: number) => sim.setSpeed(v),
    tileScreen: (tx: number, ty: number) => view.projector(cam).toScreen(tx, ty),
    screenPos: (id: number) => {
      if (!sim.curr) return null;
      const su = toScreenUnits(interpolate(sim.curr.units, sim.curr.units, 1), view.projector(cam)).find((u) => u.id === id);
      return su ? { x: su.sx, y: su.sy } : null;
    },
    buildingScreenPos: (id: number) => {
      const b = sim.curr?.buildings.find((x) => x.id === id);
      if (!b) return null;
      const d = buildingDef(b.kind);
      return view.projector(cam).toScreen(b.tx + d.w / 2, b.ty + d.h / 2, 10);
    },
  };
  const vig = document.createElement('div');
  vig.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 50%,transparent 55%,rgba(2,6,10,.55) 100%)';
  document.body.insertBefore(vig, document.getElementById('hud'));
  document.body.dataset.ready = 'true';
  requestAnimationFrame(frame(performance.now()));
}

void boot();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
