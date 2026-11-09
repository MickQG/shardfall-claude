import { DIFFICULTIES, resolvePersonality } from './ai/ai';
import { brawlConfig, duelConfig, mapIdOf, mapSeedOf, resolveMapSeed, rushConfig, showcaseConfig, skirmishConfig } from './data/maps';
import { buildingDef, unitDef } from './data/defs';
import { AudioEngine } from './audio/engine';
import { BattleIntensity } from './audio/intensity';
import { worldSoundFor, type SoundWho } from './audio/plan';
import { AckGate, mostNumerousKind, panGain, ShotTagger } from './audio/recipes';
import { SimClient } from './host/client';
import { activeMatch } from './net/lobby';
import { OnlineWatch } from './net/watch';
import { centerOnTile, clampCamera, mapBounds, pan, zoomAt, type Camera } from './render/camera';
import { GameView, type PlacementPreview } from './render/gameView';
import type { WorldRenderer } from './render/worldRenderer';
import { interpolate, type RenderUnit } from './render/interp';
import { tileToScreen } from './render/iso';
import { canPlace, FP, type SimEvent, type Snapshot } from './sim';
import { ONLINE_SPEED, stepSpeed, tickMsAt } from './host/speed';
import { AlertTracker } from './ui/alerts';
import { countdownRows } from './ui/countdown';
import { tipOf, topBarText } from './ui/controlsHelp';
import { READY_FRAMES, READY_TIMEOUT_MS, readyToStart, showLoading } from './ui/loading';
import { createHud, resultText, type ScoreView } from './ui/hud';
import { armyPath, mapSeedLine, opponentLine, replayMapSearch, scoreRows } from './ui/score';
import { amoveClick, attackMoveIds, centroid, combatUnitIds, DoubleTap, inputAllowed, KeyTap, minimapClick } from './ui/controls';
import { cursorCss, cursorFor, type CursorState } from './ui/cursor';
import { clampTile, Minimap, miniToTile } from './ui/minimap';
import { rallyLine } from './ui/rally';
import { acknowledge, Acks, type Acknowledgement } from './ui/acknowledge';
import { OWNER_COLORS } from './render/colors';
import type { Command } from './sim';
import { seedOf } from './ui/params';
import { effectsEnabled, loadSettings, personalityChoiceOf, safeStorage, saveSettings } from './ui/settings';
import { placementLive } from './ui/production';
import { FrameStats } from './ui/frameStats';
import { Sidebar } from './ui/sidebar';
import { Soundscape } from './ui/soundscape';
import { wireUiSounds } from './ui/uiSounds';
import { hitTest, hoverKind, rightClickOrder, type HitContext } from './ui/hit';
import { FLY_HUD_CSS, FlyIn, flyEnabled, flyPose, smootherstep } from './render/flyIn';
import { chooseRenderer, probeGpu } from './render/chooseRenderer';
import { buttonKinds } from './render/menuPlan';
import { drawIcons } from './render3d/icons3d';
import { boxSelect, Selection, selectKinds, selectSameKind, toScreenUnits } from './ui/selection';

const host = document.getElementById('app');
if (!host) throw new Error('missing #app');
// Up at once, before three.js loads and the battlefield is built: never a black screen (UI-12).
const params = new URLSearchParams(location.search);
const loading = showLoading('Preparing the battlefield…', params.get('faction') === 'alien' ? 'alien' : 'human', tipOf(Date.now()));
// An online match (NET-1) is handed over by the menu in this page; a reloaded online page has lost its connection, so
// it goes back to the menu.
const match = activeMatch();
if (params.has('online') && !match) {
  location.replace(location.pathname);
  await new Promise(() => undefined);
}
/** This browser's seat: player 0 alone or as host, player 1 as an online guest. */
const PLAYER = match?.me ?? 0;
const myFaction = params.get('faction') === 'alien' ? 'alien' : 'human';
const level = (['easy', 'medium', 'hard'] as const).find((d) => d === params.get('difficulty')) ?? 'medium';
const scenario = params.get('scenario');
const opts = { factions: [myFaction, myFaction === 'human' ? 'alien' : 'human'] as ['human' | 'alien', 'human' | 'alien'], bonuses: [0, DIFFICULTIES[level].bonus] as [number, number], map: mapIdOf(params.get('map')), mapSeed: resolveMapSeed(mapSeedOf(params.get('mapseed'), 1)) };
const seed = seedOf(params.get('seed'), Date.now() % 100000);
/** The AI opponent's personality (AI-12): picked in the menu, or drawn from the game seed for Random (MENU-5). */
const personality = resolvePersonality(params.get('personality'), seed);
const cfg = match
  ? skirmishConfig(match.setup.seed, { factions: match.setup.factions, bonuses: [0, 0], map: match.setup.map, mapSeed: match.setup.mapSeed })
  : scenario === 'showcase' ? showcaseConfig(seed, Math.min(150, Number(params.get('army') ?? 0) || 0), myFaction) : scenario === 'brawl' ? brawlConfig(seed, Math.min(100, Number(params.get('army') ?? 0) || 100), myFaction) : scenario === 'duel' ? duelConfig(seed, opts) : scenario === 'rush' ? rushConfig(seed, opts) : skirmishConfig(seed, opts);
/** The world view (ADR 0005, R3D-1), chosen once here and never part of the simulation. */
const use3d = chooseRenderer(params.get('renderer'), probeGpu()) === '3d';
const map = cfg.map;
const bounds = mapBounds(map.width, map.height);
// Scenarios are scripted fights without an AI opponent; a normal game has the AI play player 1; an online match has
// the two players in lockstep (NET-2).
const watch = match ? new OnlineWatch(match, { end: (why, tick) => endOnline(why, tick) }) : null;
// Held at its first tick until the view is drawn and the controls are live (UI-12).
const sim = new SimClient(cfg, scenario || match ? [] : [{ player: 1, difficulty: level, personality }], { viewer: PLAYER, net: watch?.link, hold: true });
watch?.attach(sim);
// three.js loads only for the 3D view, so classic sessions do not download it.
const view: WorldRenderer = use3d ? new (await import('./render3d/view3d')).View3D() : new GameView();
const frameStats = new FrameStats();
// The frame-time readout is for the showcase and for measuring (`?fps`), not for normal games.
const showFrameTime = scenario === 'showcase' || scenario === 'brawl' || params.has('fps');
const selection = new Selection();
const hud = createHud(myFaction);
const settings = loadSettings(safeStorage(), matchMedia('(prefers-reduced-motion: reduce)').matches);
const audio = new AudioEngine();
audio.setMuted(settings.muted);
audio.setVolume(settings.volume);
audio.setMusicOn(settings.musicOn);
audio.setMusicVolume(settings.musicVolume);
// Continuous sound (AUD-8, AUD-10), explosion factions (AUD-6), the acknowledgement limit (AUD-7) and button sounds (AUD-11).
const soundscape = new Soundscape(map, audio);
// How hard the player is fighting drives the music's battle layer (AUD-13).
const fighting = new BattleIntensity();
let fightTick = -1;
const tagger = new ShotTagger();
const ackGate = new AckGate(150);
wireUiSounds(document, audio);
const alerts = new AlertTracker(PLAYER);
let paused = false;
/** Game speed (UX-3): the player's last choice, ×0.8 by default; online always ×0.8. */
let speed = match ? ONLINE_SPEED : settings.speed;
if (!match) sim.setSpeed(speed);

/** The top bar (UI-18): the F1 hint and the speed, or online the room code. */
function topbar(): void {
  hud.setTop(topBarText({ room: match?.room, speed }));
}
topbar();

/**
 * The fly-in (CAM-4..8): the match opens with it, and until it ends game time is held and no command is accepted (CAM-5).
 * It is only the camera and a hold: the simulation is released afterwards exactly as before (UI-12).
 */
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fly = new FlyIn({ online: !!match, reducedMotion, classic: !use3d, enabled: flyEnabled(params.get('flyin')) });
/** The fly-in is playing: from the moment the battlefield is shown until it ends or is skipped. */
let flying = true;
/** The battlefield is on screen and the fly-in clock is running. */
let flyStarted = false;
let flyStartedAt = 0;
/** A test hook: draw the fly-in at this fraction of its length and do not end it (for screenshots); null plays it normally. */
let flyHold: number | null = null;
/** The camera drawn this frame: the sweep's pose during the fly-in, otherwise the player's camera. */
let drawCam: Camera = { x: 0, y: 0, zoom: 1 };
// The HUD stays hidden until the fly-in ends, then fades in (CAM-5); a reduced-motion or classic fly-in fades the view in from black (CAM-8).
document.body.classList.add('flyin');
const flyStyle = document.createElement('style');
flyStyle.textContent = FLY_HUD_CSS;
document.head.appendChild(flyStyle);
const flyFade = document.createElement('div');
flyFade.id = 'flyfade';
flyFade.style.cssText = 'position:fixed;inset:0;z-index:20;background:#000;pointer-events:none;opacity:1';
// Only the fade needs it: the sweep draws no overlay at all, which keeps its frames cheap.
if (fly.mode === 'fade') document.body.appendChild(flyFade);
/** Whether an input reaches the game right now (CTL-16). */
const allowed = (input: string): boolean => !flying && inputAllowed(input, { paused, over: !!sim.curr?.over });

function setPaused(p: boolean): void {
  paused = p;
  sim.setPaused(p);
  hud.showPause(p, { resume: () => setPaused(false), quit: () => (location.search = '') });
  // An online match cannot be paused (NET-2): this is only a menu, and the game goes on behind it.
  if (match) {
    const box = document.getElementById('pause');
    const h = box?.querySelector('h2');
    if (h) h.textContent = 'GAME MENU · THE MATCH GOES ON';
    const resume = box?.querySelector('#resume');
    if (resume) resume.textContent = 'Back to the game (Esc)';
  }
}

/** An online match ended outside the simulation (NET-3, NET-4): the opponent left, the link dropped, or a desync. */
function endOnline(why: 'left' | 'timeout' | 'lost' | 'desync', tick = 0): void {
  if (resultShown) return;
  resultShown = true;
  setPaused(false);
  const r =
    why === 'desync'
      ? { title: 'OUT OF SYNC', sub: `The two games stopped matching (tick ${tick}), so this match cannot go on.`, color: '#ffcf6a' }
      : why === 'lost'
        ? { title: 'CONNECTION LOST', sub: 'You were cut off from the game server.', color: '#ffcf6a' }
        : { title: 'VICTORY', sub: why === 'left' ? 'Your opponent left the match.' : 'Your opponent lost their connection.', color: '#7ff5cd' };
  hud.showResult(r.title, r.sub, r.color);
  const again = document.getElementById('again');
  if (again) again.hidden = true;
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
/** Where an attacked unit or building is drawn now (tiles), so its acknowledgement ring follows it (UI-13). */
function locate(id: number, units: readonly RenderUnit[], snap: Snapshot): { x: number; y: number } | null {
  const u = units.find((x) => x.id === id);
  if (u) return { x: u.tx, y: u.ty };
  const b = snap.buildings.find((x) => x.id === id);
  if (!b) return null;
  const d = buildingDef(b.kind);
  return { x: b.tx + d.w / 2, y: b.ty + d.h / 2 };
}

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
  const alpha = (performance.now() - sim.currAt) / tickMsAt(speed);
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
  // The fire button arms targeting; pressed again (or right-click) it cancels (UI-9).
  fire: (id) => {
    targeting = targeting?.building === id ? null : { building: id };
  },
  refused: (reason) => refuse(reason),
}, myFaction);

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

/**
 * Play the world sounds of a tick's events (AUD-5, AUD-6, AUD-9): each in its faction's palette, panned and softened by
 * where it is on screen. The player's own units fighting out of view feed the distant rumble (AUD-10).
 */
function playEvents(events: readonly SimEvent[], snap: Snapshot | null): void {
  const proj = view.projector(cam);
  const vp = view.viewport;
  let kinds: Map<number, string> | null = null;
  const who: SoundWho = {
    kindOf: (id) => {
      if (!snap) return undefined;
      if (!kinds) {
        kinds = new Map();
        for (const u of snap.units) kinds.set(u.id, u.kind);
        for (const b of snap.buildings) kinds.set(b.id, b.kind);
      }
      return kinds.get(id);
    },
    factionOf: (o) => snap?.players[o]?.faction ?? myFaction,
    boomFaction: (x, y) => tagger.near(x, y, myFaction),
  };
  let away = 0;
  for (const ev of events) {
    const s = worldSoundFor(ev, PLAYER, who);
    if (ev.t === 'shot') tagger.note(ev.tx / FP, ev.ty / FP, s.faction);
    const p = proj.toScreen(s.at.x, s.at.y);
    const pg = panGain(p.x, p.y, vp.width, vp.height);
    audio.play(s.name, s.gain, { faction: s.faction, size: s.size, pan: pg.pan, near: pg.gain });
    if (ev.t === 'shot' && ev.owner === PLAYER) fighting.noteDamage(ev.src, performance.now());
    if (ev.t === 'die' && ev.owner === PLAYER) fighting.noteDamage(ev.id, performance.now());
    // A superweapon launch or strike gets a musical stinger over the score (AUD-15).
    if (ev.t === 'launch' || ev.t === 'strike') audio.stinger(ev.t, seed);
    if ((ev.t === 'shot' || ev.t === 'die') && ev.owner === PLAYER && (p.x < 0 || p.y < 0 || p.x > vp.width || p.y > vp.height)) away++;
  }
  if (away > 0) soundscape.noteOffscreenFight(away);
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

    // The fly-in (CAM-4, CAM-8): its sweep is drawn instead of the player's camera; the player's camera is untouched, so the sweep ends exactly there.
    drawCam = cam;
    if (flying) {
      const p = flyHold ?? fly.progress(performance.now());
      if (flyStarted && p >= 1) endFly();
      else if (fly.mode === 'sweep') drawCam = flyPose(p, map, cam, v.width / Math.max(1, v.height));
      else flyFade.style.opacity = String(1 - smootherstep(p));
    }
    const events = sim.events.splice(0);
    for (const ev of events) view.spawn(ev, t);
    if (events.length > 0) playEvents(events, sim.curr);
    view.canvas.style.cursor = cursorCss(cursorFor(cursorState()));
    const curr = sim.curr;
    if (curr && curr.over && !resultShown) {
      resultShown = true;
      const r = resultText(curr.winner, PLAYER);
      // Against the AI, the result names how it played (SCR-4); the game never shows it before the end.
      const vsAi = !scenario && !match;
      hud.showResult(r.title, vsAi ? `${r.sub} ${opponentLine(personality, level)}` : r.sub, r.color, curr.stats ? scoreView(curr) : undefined);
      // Online, "Play again" would need a new room: only the menu is offered.
      const again = document.getElementById('again');
      if (again && match) again.hidden = true;
      // On a generated map (SCR-5): its seed, and a new single player game on the same map with the same settings.
      const mapSeed = match ? match.setup.mapSeed : !scenario && opts.map === 'generated' ? opts.mapSeed : undefined;
      if (again && mapSeed !== undefined) {
        const sub = document.querySelector<HTMLElement>('#result .sub');
        if (sub) sub.textContent = `${sub.textContent ?? ''} ${mapSeedLine(mapSeed)}`;
        again.hidden = false;
        again.textContent = 'Play this map again';
        again.onclick = () => (location.search = replayMapSearch({ faction: myFaction, difficulty: level, personality: personalityChoiceOf(params.get('personality')), mapSeed }));
      }
      watch?.finished(curr.tick);
    }
    if (curr && sim.prev) {
      selection.prune(aliveOwn(curr));
      if (selectedBuilding !== null && !curr.buildings.some((b) => b.id === selectedBuilding)) selectedBuilding = null;
      if (placing && !placementLive(placing, curr.buildings, PLAYER)) placing = null;
      if (targeting && !curr.buildings.some((b) => b.id === targeting?.building && b.owner === PLAYER)) targeting = null;
      const alpha = (performance.now() - sim.currAt) / tickMsAt(speed);
      const ru = interpolate(sim.prev.units, curr.units, alpha);
      audio.lean = settings.quality === 'low';
      view.update(ru, drawCam, { selectedUnits: new Set(selection.selected), selectedBuilding, placement: placementPreview(curr), viewer: PLAYER, rally: selectedBuilding === null ? null : ((b) => (b ? rallyLine(b, selectedBuilding) : null))(curr.buildings.find((x) => x.id === selectedBuilding)), time: t, fx: effectsEnabled(settings), acks: acks.markers(performance.now(), (id) => locate(id, ru, curr)), flash: acks.flashing(performance.now()) }, curr);
      if (curr.tick !== lastAlertTick) {
        lastAlertTick = curr.tick;
        for (const a of alerts.update(curr)) {
          hud.toast(a.text, a.level);
          audio.play(a.id === 'structure' ? 'built' : a.level === 'info' ? 'ready' : 'alert');
          if (a.at && minimap) minimap.ping(a.at.tx, a.at.ty, t, a.level === 'bad' ? '#ff5a4a' : '#ffd34a');
        }
      }
      // Selecting own units answers with the sound of the most numerous kind (AUD-7); the world's loops and ambience follow the camera (AUD-8, AUD-10).
      const sel = selection.selected;
      if (sel.some((id) => !prevSelected.has(id))) ackSound(sel, 'select');
      prevSelected = new Set(sel);
      soundscape.update(sim.prev, curr, view.projector(cam), v, t);
      if (curr.tick !== fightTick) {
        fightTick = curr.tick;
        fighting.observe(curr.units, curr.buildings, PLAYER, t);
      }
      audio.setBattleLevel(fighting.step(t));
      sidebar.update(curr, selectedBuilding, t, targeting?.building ?? null);
      hud.setCountdown(countdownRows(curr));

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
        if (sim.curr) sendAttackMove(sim.curr, x, y, true);
        amoveMode = false;
        return;
      case 'superweapon':
        if (targeting) give({ type: 'superweapon', player: PLAYER, building: targeting.building, x, y }, true);
        targeting = null;
        return;
      case 'order':
        order(t.x, t.y, true);
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

/** The live order acknowledgements (UI-13..15): markers, ring flashes and their sounds, on this player's screen only. */
const acks = new Acks();

/**
 * Acknowledge a command the moment it is given (UI-13..15): marker, sound and ring flash, long before an online turn
 * plays it. `mini` marks an order given on the minimap, which pings there too.
 */
function acknowledgeCmd(cmd: Command, mini = false, foot?: { w: number; h: number }): void {
  const a: Acknowledgement | null = acknowledge(cmd, performance.now(), OWNER_COLORS[PLAYER] ?? 0x7ff5cd, foot);
  if (!a) return;
  acks.add(a);
  // A command to units answers with their kind's sound (AUD-7, replacing the generic order sounds of UI-14, which stay for orders no unit takes).
  if (!ackSound(a.units, 'command') && a.units.length === 0 && ackGate.allow(performance.now())) audio.play(a.sound === 'attack' ? 'ackAttack' : 'ack');
  if (mini && a.at && a.color !== null && minimap) minimap.ping(a.at.x, a.at.y, a.born, `#${a.color.toString(16).padStart(6, '0')}`);
}

/** Units selected last frame, to hear when the selection gains one (AUD-7). */
let prevSelected = new Set<number>();

/**
 * The acknowledgement sound for `ids` (AUD-7): the kind with the most own units among them, at most once every 150 ms.
 * Returns whether a kind was found.
 */
function ackSound(ids: readonly number[], mode: 'select' | 'command'): boolean {
  const snap = sim.curr;
  if (!snap || ids.length === 0) return false;
  const set = new Set(ids);
  const kind = mostNumerousKind(snap.units.filter((u) => u.owner === PLAYER && set.has(u.id)).map((u) => u.kind));
  if (!kind) return false;
  if (ackGate.allow(performance.now())) audio.ack(kind, mode);
  return true;
}

/** Send a command and acknowledge it at once. */
function give(cmd: Command, mini = false, foot?: { w: number; h: number }): void {
  sim.send(cmd);
  acknowledgeCmd(cmd, mini, foot);
}

/** Attack-move the combat units in the selection to a fixed-point position (CTL-13); nothing is sent without any. */
function sendAttackMove(snap: Snapshot, x: number, y: number, mini = false): void {
  const units = attackMoveIds(snap.units, selection.selected, PLAYER);
  if (units.length > 0) give({ type: 'attackmove', player: PLAYER, units, x, y }, mini);
}

/** Context order for the selection at tile (tx, ty): rally for a building, harvest/move for units. */
function order(tx: number, ty: number, mini = false): void {
  const snap = sim.curr;
  if (!snap) return;
  const ids = selection.selected;
  if (ids.length === 0) {
    if (selectedBuilding !== null) give({ type: 'rally', player: PLAYER, building: selectedBuilding, x: Math.round(tx * FP), y: Math.round(ty * FP) }, mini);
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
  // One acknowledgement for the whole selection: a harvest marker when haulers were sent to shards.
  acknowledgeCmd({ type: haulers.length && onShards ? 'harvest' : 'move', player: PLAYER, units: ids, x, y }, mini);
}

/** The fly-in is over (CAM-5, CAM-6): the HUD fades in, commands are accepted, and the game is released to run its first tick (UI-12). */
function endFly(): void {
  if (!flying) return;
  flying = false;
  document.body.classList.remove('flyin');
  document.body.dataset.fly = 'done';
  // How long the fly-in really held the game, ms by the page clock (for tests).
  document.body.dataset.flyMs = String(Math.round(performance.now() - flyStartedAt));
  flyFade.style.opacity = '0';
  setTimeout(() => flyFade.remove(), 800);
  // The tick the game had reached when it was released: 0, as it waited (UI-12).
  document.body.dataset.startTick = String(sim.curr?.tick ?? -1);
  sim.start();
  document.body.dataset.ready = 'true';
}

async function boot(): Promise<void> {
  const first = await new Promise<Snapshot>((resolve) => {
    const poll = (): void => (sim.curr ? resolve(sim.curr) : void setTimeout(poll, 10));
    poll();
  });
  await view.mount(host as HTMLElement, first, { blocked: map.blocked, shards: map.shards });
  // Pictures for the build and train buttons, from the 3D models in the player's colour (UI-17): drawn once, here, inside
  // the loading screen, with a temporary renderer that is disposed at once. The classic view keeps text-only buttons.
  if (use3d) {
    const t0 = performance.now();
    sidebar.setIcons(await drawIcons(buttonKinds(myFaction), PLAYER));
    document.body.dataset.iconMs = String(Math.round(performance.now() - t0));
  }
  if (scenario === 'showcase' || scenario === 'brawl') {
    // Both armies march into each other's base so the fight and its effects can be seen, whichever side is watched.
    const army = (p: number): number[] => first.units.filter((u) => u.owner === p).map((u) => u.id);
    for (const p of [0, 1]) {
      const hq = first.buildings.find((b) => b.owner === 1 - p && buildingDef(b.kind).hq);
      if (hq) sim.send({ type: 'attackmove', player: p, units: army(p), x: (hq.tx + 2) * FP, y: (hq.ty + 2) * FP });
    }
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
  // The brawl is fought in the middle of the map, so the camera starts there (R3D-29).
  if (scenario === 'brawl') centerOn(first.mapWidth / 2, first.mapHeight / 2 + 1);

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    audio.unlock();
    // During the fly-in a key only skips it, where that is allowed (CAM-5, CAM-6).
    if (flying) {
      if (fly.skip(performance.now())) endFly();
      return;
    }
    // S pans the map, so Ctrl + S must not reach the browser's save dialog.
    if (e.ctrlKey && k === 's') e.preventDefault();
    // F1 shows the controls overlay and never the browser's own help; Esc closes the overlay before it does anything else (UI-18).
    if (k === 'f1') {
      e.preventDefault();
      hud.showHelp(!hud.helpOpen());
      return;
    }
    if (k === 'escape' && hud.helpOpen()) {
      hud.showHelp(false);
      return;
    }
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
    if (k === 'p') {
      if (match) hud.toast('Online matches cannot be paused', 'info');
      else setPaused(!paused);
    }
    if (k === 'm') {
      settings.muted = !settings.muted;
      audio.setMuted(settings.muted);
      saveSettings(safeStorage(), settings);
      hud.toast(settings.muted ? 'Sound muted' : 'Sound on', 'info');
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
      hud.toast(`Graphics quality: ${settings.quality}`, 'info');
    }
    if ((k === '+' || k === '=' || k === '-') && match) hud.toast('Online matches run at normal speed', 'info');
    else if (k === '+' || k === '=' || k === '-') {
      speed = stepSpeed(speed, k === '-' ? -1 : 1);
      sim.setSpeed(speed);
      settings.speed = speed;
      saveSettings(safeStorage(), settings);
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
    } else if (k === 'z') {
      if (selection.selected.length > 0) give({ type: 'stop', player: PLAYER, units: selection.selected });
    } else if (k === 'x') {
      if (selection.selected.length > 0) give({ type: 'scatter', player: PLAYER, units: selection.selected });
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
    audio.startMusic(seed, false, myFaction);
    if (flying) {
      if (fly.skip(performance.now())) endFly();
      return;
    }
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
          give({ type: 'attack', player: PLAYER, units: selection.selected, target: o.target });
          return;
        }
      }
      const t = tileFromScreen(e.offsetX, e.offsetY);
      order(t.x, t.y);
    } else if (e.button === 0) {
      if (targeting) {
        const t = tileFromScreen(e.offsetX, e.offsetY);
        give({ type: 'superweapon', player: PLAYER, building: targeting.building, x: Math.round(t.x * FP), y: Math.round(t.y * FP) });
        targeting = null;
        return;
      }
      if (placing && sim.curr) {
        const p = placementPreview(sim.curr);
        if (p?.ok) {
          const d = buildingDef(p.kind);
          give({ type: 'place', player: PLAYER, source: placing.source, tx: p.tx, ty: p.ty }, false, { w: d.w, h: d.h });
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
    // Canvas coordinates: the game frame may be centred between side bars on wide screens (UI-10).
    hud.selbox(Math.hypot(e.clientX - r.left - drag.x0, e.clientY - r.top - drag.y0) > 5 ? { x0: drag.x0, y0: drag.y0, x1: e.clientX - r.left, y1: e.clientY - r.top } : null);
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
    /** Frame rate and the renderer's draws, triangles, CPU time, live particles and debris, for tests and measurement (R3D-29). */
    renderStats: () => ({ fps: frameStats.fps, ...(view.stats?.() ?? { cpuMs: 0, draws: 0, tris: 0, particles: { smoke: 0, glow: 0 }, debris: 0 }) }),
    /** Sound counts (AUD-7, AUD-11) and the last movement and ambience mix (AUD-8, AUD-10), for tests. */
    audio: () => ({ ...audio.stats, mix: soundscape.last }),
    /** Renders a dense battle offline through the real engine graph and returns its peak sample (AUD-12). */
    audioBurst: (n?: number) => import('./audio/offline').then((m) => m.renderBurst(n)),
    /** Renders the score offline through the real engine graph at a battle level and returns its loudness (AUD-13, AUD-16). */
    audioMusic: (level: number, musicOn = true) => import('./audio/offline').then((m) => m.renderMusic(level, musicOn)),
    /** Renders the idle soundscape offline and returns its energy above 2 kHz (AUD-8, AUD-10). */
    audioSoundscape: (seconds?: number) => import('./audio/offline').then((m) => m.renderSoundscape(seconds)),
    camera: () => cam,
    flyHold: (t: number | null) => (flyHold = t),
    /** The fly-in (CAM-4..8): its mode, whether it is still playing, how far it is, and the camera drawn now. */
    fly: () => ({ mode: fly.mode, flying, progress: fly.progress(performance.now()), cam: drawCam, fade: flyFade.isConnected ? Number(flyFade.style.opacity) : 0 }),
    selected: () => selection.selected,
    select: (ids: number[]) => {
      selectedBuilding = null;
      selection.set(ids);
    },
    selectedBuilding: () => selectedBuilding,
    modes: () => ({ placing: placing !== null, targeting: targeting !== null, amove: amoveMode }),
    placing: () => placing,
    send: (c: Parameters<SimClient['send']>[0]) => sim.send(c),
    /** Live order acknowledgements (UI-13, UI-15): markers on the ground and the units whose rings flash. */
    acks: () => {
      const now = performance.now();
      const snap = sim.curr;
      const units = snap ? interpolate(snap.units, snap.units, 1) : [];
      return { markers: snap ? acks.markers(now, (id) => locate(id, units, snap)) : [], flashing: [...acks.flashing(now).keys()], last: acks.last, now };
    },
    setSpeed: (v: number) => {
      speed = v;
      sim.setSpeed(v);
    },
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
  // Open the audio device now, suspended, so the first click does not stall a frame doing it.
  audio.prepare();
  requestAnimationFrame(frame(performance.now()));
  // The game begins only once the battlefield has been drawn and the controls are wired up (UI-12).
  // A background tab draws no frames: after a few seconds the game starts anyway (UI-12).
  await readyToStart(READY_FRAMES, READY_TIMEOUT_MS);
  // The battlefield is drawn: the fly-in begins, and the game stays at its first tick until it ends (CAM-5). Online, both
  // players hold for the same FLY_MS before releasing, and lockstep then starts when both have (CAM-6).
  flyStarted = true;
  flyStartedAt = performance.now();
  fly.start(flyStartedAt);
  document.body.dataset.fly = fly.mode;
  loading.done();
  if (fly.finished(performance.now())) endFly();
  else {
    // A background tab draws no frames: the clock still runs out (UI-12 applies to the fly-in too).
    const watchdog = setInterval(() => {
      if (!flying) clearInterval(watchdog);
      else if (flyHold === null && fly.finished(performance.now())) {
        clearInterval(watchdog);
        endFly();
      }
    }, 200);
  }
}

void boot();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
