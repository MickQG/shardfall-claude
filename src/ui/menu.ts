import { MAP_SEED_MAX, MAPS, mapSeedOf, mapStarts, resolveMapSeed, skirmishMap, type MapId } from '../data/maps';
import { AudioEngine } from '../audio/engine';
import { wireUiSounds } from './uiSounds';
import { thumbCanvas } from './mapThumb';
import { loadSettings, personalityChoiceOf, safeStorage, saveSettings, type PersonalityChoice, type Settings } from './settings';
import { setActiveMatch, type Match } from '../net/lobby';
import { mountOnlinePanel, ONLINE_CSS } from './onlinePanel';
import { createUnitSheet, FACTION_INFO } from './unitSheet';
import { basicsHtml, controlsHtml } from './controlsHelp';
import { ensureTheme, wordmarkSvg } from './theme';
import { fitSize } from './fitText';
import { chooseRenderer, probeGpu } from '../render/chooseRenderer';
import { holdStill } from '../render/menuPlan';
import type { MenuScene } from '../render3d/menuScene3d';

/**
 * Main menu (MENU-1..3, MENU-8..15): a full-screen layout with a left rail (wordmark, Single player, Multiplayer, Units,
 * How to play, Settings) and a translucent panel for the chosen mode, over a slowly drifting backdrop. The `.scene`
 * element behind the rail and panel is the mount point for the live 3D faction scene (MENU-10). The menu wears the
 * picked faction's skin (MENU-12). Multiplayer is shown as work in progress.
 */
const CSS = `
#menu { position: fixed; inset: 0; display: grid; grid-template-columns: minmax(240px, 300px) 1fr; color: var(--ink); font: 15px/1.45 var(--font-body); background: var(--void); overflow: hidden; overflow: clip; }
#menu .bg { position: absolute; inset: -20%; pointer-events: none; background:
  radial-gradient(40% 35% at 20% 30%, #0f3a3355, transparent 70%), radial-gradient(35% 30% at 80% 70%, #1d2f6655, transparent 70%),
  radial-gradient(30% 25% at 65% 20%, #3a1f4a44, transparent 70%); animation: menu-drift 26s ease-in-out infinite alternate; }
#menu[data-faction="alien"] .bg { background: radial-gradient(40% 35% at 20% 30%, #3a4a1255, transparent 70%), radial-gradient(35% 30% at 80% 70%, #4a2f1255, transparent 70%), radial-gradient(30% 25% at 65% 20%, #2a3a1244, transparent 70%); }
#menu .grid { position: absolute; inset: 0; pointer-events: none; opacity: .18; background-image: linear-gradient(var(--edge) 1px, transparent 1px), linear-gradient(90deg, var(--edge) 1px, transparent 1px); background-size: 48px 48px; mask-image: radial-gradient(ellipse at 60% 60%, #000 20%, transparent 75%); }
#menu .scene { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
#menu.scene3d .bg, #menu.scene3d .grid { display: none; }
@keyframes menu-drift { from { transform: translate(-3%, -2%) rotate(0deg); } to { transform: translate(3%, 2%) rotate(4deg); } }
@keyframes panel-in { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
#menu .rail { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 36px 22px 24px; background: linear-gradient(90deg, rgba(5,9,13,.92), rgba(5,9,13,.7)); border-right: 1px solid var(--edge); overflow: auto; }
#menu h1 { margin: 0; line-height: 0; }
#menu h1 .wordmark { display: block; width: 100%; max-width: 252px; height: auto; }
#menu .tag { font-family: var(--font-head); font-stretch: 87.5%; color: var(--ink-dim); letter-spacing: .16em; text-transform: uppercase; font-size: 12px; margin: 6px 0 24px; }
#menu .nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 11px 14px; border: 1px solid transparent; border-radius: var(--r-s); clip-path: var(--clip-s); background: transparent; color: var(--ink-dim); font-family: var(--font-head); font-stretch: 87.5%; text-transform: uppercase; font-weight: 700; font-size: 17px; text-align: left; cursor: pointer; letter-spacing: .1em; }
#menu .nav:hover, #menu .nav:focus-visible { background: var(--field); color: var(--ink); outline: none; }
#menu .nav:focus-visible { border-color: var(--edge-hi); }
#menu .nav.sel { background: var(--sel-bg); border-color: var(--edge); color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
#menu .badge { font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; padding: 4px 7px; border-radius: 999px; background: var(--badge-bg); color: var(--warn); border: 1px solid var(--edge); }
#menu .main { position: relative; overflow: auto; padding: 36px clamp(20px, 4vw, 56px) 28px; }
#menu .panel { max-width: 860px; box-sizing: border-box; padding: 24px 26px 28px; background: var(--glass); border: 1px solid var(--edge); border-radius: var(--r); clip-path: var(--clip); box-shadow: var(--frame-shadow); }
#menu section { display: none; flex-direction: column; gap: 18px; }
#menu section.on { display: flex; animation: panel-in .2s ease-out both; }
#menu h2 { margin: 6px 0 0; font-size: 14px; letter-spacing: .18em; color: var(--ink-dim); font-weight: 700; }
#menu h3.grp { margin: 10px 0 -4px; font-size: 14px; letter-spacing: .16em; color: var(--accent-2); }
#menu .faction { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
#menu .card { position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-start; text-align: left; color: inherit; font: inherit; cursor: pointer; padding: 20px 20px 18px; border-radius: var(--r); clip-path: var(--clip); border: 1px solid var(--edge); background: var(--panel); box-shadow: var(--frame-shadow); transition: border-color .14s; }
#menu .card::after { content: ''; position: absolute; right: -40px; top: -40px; width: 160px; height: 160px; border-radius: 50%; background: radial-gradient(circle, var(--c) 0%, transparent 70%); opacity: .12; }
#menu .card:hover { border-color: var(--edge-hi); }
/* The Aegis card is angular and lightly technical (MENU-12): the two original chamfers, thin brackets in the other two corners and a small tech label. Flat, no glow. */
#menu .card[data-faction="human"] { --clip: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px); }
#menu .card[data-faction="human"]::after { display: none; }
#menu .card .trim { position: absolute; inset: 7px; pointer-events: none; opacity: .6; --b: var(--c);
  background:
    linear-gradient(var(--b), var(--b)) 100% 0 / 12px 1px no-repeat, linear-gradient(var(--b), var(--b)) 100% 0 / 1px 12px no-repeat,
    linear-gradient(var(--b), var(--b)) 0 100% / 12px 1px no-repeat, linear-gradient(var(--b), var(--b)) 0 100% / 1px 12px no-repeat; }
#menu .card.sel .trim { opacity: 1; }
#menu .card .tag { position: absolute; right: 18px; top: 11px; font-family: var(--font-head); font-stretch: 87.5%; font-size: 9.5px; letter-spacing: .16em; text-transform: uppercase; color: var(--ink-dim); opacity: .85; white-space: nowrap; pointer-events: none; }
@container (max-width: 250px) { #menu .card .tag { display: none; } }
#menu .card.sel { border-color: var(--c); box-shadow: inset 0 0 0 1px var(--c); }
#menu .card h3 { margin: 0 0 2px; font-size: 25px; letter-spacing: .08em; color: var(--c); }
#menu .card .sub { font-family: var(--font-head); font-stretch: 87.5%; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-dim); margin-bottom: 10px; }
#menu .card p { margin: 0; color: var(--ink); font-size: 13.5px; }
#menu .card { container-type: inline-size; padding-left: 16px; padding-right: 16px; }
#menu .card .hero { margin-top: 10px; font: 600 clamp(11px, 3.5cqw, 12px)/1.3 var(--font-head); font-stretch: 87.5%; letter-spacing: .01em; white-space: nowrap; color: var(--ink); }
@media (max-width: 1100px) { #menu .card .hero { font-size: 12px; white-space: normal; } }
@media (max-width: 480px) { #menu .card { padding: 16px 12px 14px; } }
#menu .card .hero b { color: var(--c); }
#menu .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
#menu .row .seg { align-self: auto; }
#menu .row .seg[aria-label="Personality"] button { padding: 10px 11px; }
#menu #units-btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: var(--r-s); clip-path: var(--clip-s); border: 1px solid var(--edge); background: var(--sel-bg); color: var(--accent); font: inherit; font-weight: 600; font-size: 14px; cursor: pointer; }
#menu #units-btn:hover, #menu #units-btn:focus-visible { border-color: var(--accent); outline: none; }
#menu #units-btn svg { width: 18px; height: 18px; }
#menu .seg { display: inline-flex; align-self: flex-start; border: 1px solid var(--edge); border-radius: var(--r-s); clip-path: var(--clip-s); overflow: hidden; background: var(--field); }
#menu .seg button { padding: 10px 18px; border: 0; background: transparent; color: var(--ink); font: inherit; font-weight: 600; font-size: 14px; cursor: pointer; }
#menu .seg button + button { border-left: 1px solid var(--edge); }
#menu .seg button:hover { background: var(--sel-bg); }
#menu .seg button.sel { background: var(--sel-bg); color: var(--accent); }
#menu .maps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
#menu .map { display: flex; flex-direction: column; justify-content: flex-start; text-align: left; color: inherit; font: inherit; cursor: pointer; padding: 12px; border-radius: var(--r-s); clip-path: var(--clip-s); border: 1px solid var(--edge); background: var(--field); transition: border-color .14s; }
#menu .map:hover { border-color: var(--edge-hi); }
#menu .map.sel { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
#menu .map .thumb { height: 92px; display: flex; align-items: center; justify-content: center; overflow: hidden; margin-bottom: 8px; }
#menu .map canvas { width: 62px; height: 62px; image-rendering: pixelated; transform: rotate(45deg); border-radius: 3px; box-shadow: 0 0 0 1px var(--edge); }
#menu .map b { display: block; font-size: 15px; }
#menu .map span { font-size: 12.5px; color: var(--ink-dim); }
#menu .map .gen { display: flex; gap: 6px; margin-top: 8px; align-items: center; }
#menu .map .gen input { width: 0; flex: 1; min-width: 0; padding: 5px 7px; border-radius: 6px; border: 1px solid var(--edge); background: var(--void); color: var(--ink); font: inherit; font-size: 13px; font-variant-numeric: tabular-nums; }
#menu .map .gen button { padding: 5px 9px; border-radius: 6px; border: 1px solid var(--edge); background: var(--sel-bg); color: var(--accent); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
#menu .actions { display: flex; align-items: center; gap: 14px; margin-top: 6px; }
#menu #go { padding: 14px 56px; font-family: var(--font-head); font-stretch: 87.5%; font-weight: 800; font-size: 22px; letter-spacing: .2em; border-radius: var(--r-s); clip-path: var(--clip-s); border: 0; cursor: pointer; background: var(--btn-bg); color: var(--accent-ink); }
#menu #go:hover, #menu #go:focus-visible { filter: brightness(1.08); outline: none; }
#menu .note { color: var(--ink-dim); font-size: 12.5px; }
#menu .field { display: flex; align-items: center; gap: 16px; padding: 14px 16px; border-radius: var(--r-s); clip-path: var(--clip-s); border: 1px solid var(--edge); background: var(--field); max-width: 640px; }
#menu .field label { flex: 1; color: var(--ink); }
#menu .field small { display: block; color: var(--ink-dim); font-size: 12px; }
#menu input[type=range] { width: 200px; accent-color: var(--accent); }
#menu input[type=checkbox] { width: 20px; height: 20px; accent-color: var(--accent); }
#menu table.controls { border-collapse: collapse; width: 100%; font-size: 14px; }
#menu table.controls th { text-align: left; padding: 14px 0 6px; font-family: var(--font-head); font-stretch: 87.5%; text-transform: uppercase; letter-spacing: .16em; font-size: 14px; color: var(--accent-2); border-bottom: 1px solid var(--edge); }
#menu table.controls td { padding: 5px 12px 5px 0; vertical-align: top; }
#menu table.controls td.keys { white-space: nowrap; color: var(--accent); font-weight: 600; width: 1%; padding-right: 22px; }
#menu ol.basics { margin: 0; padding-left: 22px; display: flex; flex-direction: column; gap: 8px; max-width: 70ch; }
#menu ol.basics li::marker { color: var(--accent); font-weight: 700; }
#menu .fade { position: fixed; inset: 0; z-index: 5; background: #000; opacity: 0; pointer-events: none; transition: opacity .35s ease-in; }
#menu.leaving .fade { opacity: 1; pointer-events: auto; }
@media (prefers-reduced-motion: reduce) { #menu .bg { animation: none; } #menu section.on { animation: none; } #menu .fade { transition: none; } }
@media (max-width: 1100px) { #menu .maps { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 860px) { #menu { display: block; overflow: auto; } #menu .rail { overflow: visible; border-right: 0; border-bottom: 1px solid var(--edge); padding: 24px 16px 12px; } #menu .main { overflow: visible; padding: 20px 16px 28px; } #menu .panel { padding: 18px 14px 22px; } #menu .faction, #menu .maps { grid-template-columns: 1fr; } }
`;

type Pick = { faction: 'human' | 'alien'; difficulty: 'easy' | 'medium' | 'hard'; personality: PersonalityChoice };
type Mode = 'single' | 'multi' | 'howto' | 'settings';

/** How long START fades the menu to black before the game loads (MENU-13). */
const LEAVE_MS = 380;

/** The Aegis card's hero line (MENU-7): short enough to sit on one row of the card. */
export const HUMAN_HERO_LINE = 'Paladin, a giant assault walker with cannons and missiles.';

const FACTIONS = [
  { id: 'human', sub: 'Humans · armour and firepower', text: 'Structured combined arms: rifle squads, rocketeers, tanks and artillery behind pulse turrets.', hero: HUMAN_HERO_LINE },
  { id: 'alien', sub: 'Aliens · speed and regeneration', text: 'Fast, organic swarms: skitterers, spitters and brutes that heal between fights.', hero: 'Dreadstrider, a towering six-legged walker with an acid cannon.' },
] as const;

/** One-row rule (MENU-7): at 1100 px and wider the hero line does not wrap, so it shrinks until it fits its card, whatever face the device has. */
export function fitHeroLines(root: HTMLElement): void {
  const wide = matchMedia('(min-width: 1101px)').matches;
  root.querySelectorAll<HTMLElement>('.card .hero').forEach((el) => {
    el.style.fontSize = '';
    if (!wide) return;
    el.style.fontSize = `${fitSize((px) => {
      el.style.fontSize = `${px}px`;
      return el.scrollWidth;
    }, el.clientWidth)}px`;
  });
}

export function showMenu(): void {
  ensureTheme();
  const style = document.createElement('style');
  style.textContent = CSS + ONLINE_CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'menu';
  root.className = 'skin';
  root.dataset.faction = 'human';
  const factionCards = FACTIONS.map((f) => {
    const info = FACTION_INFO[f.id];
    const tech = f.id === 'human' ? '<i class="trim" aria-hidden="true"></i><span class="tag" aria-hidden="true">AEG-01 // Combined arms</span>' : '';
    return `<button class="card skin" data-faction="${f.id}" style="--c:${info.color}">${tech}<h3>${info.name}</h3><div class="sub">${f.sub}</div><p>${f.text}</p><div class="hero">Hero: <b>${f.hero}</b></div></button>`;
  }).join('');
  root.innerHTML = `
    <div class="bg"></div><div class="grid"></div><div class="scene"></div>
    <nav class="rail" aria-label="Main menu">
      <h1>${wordmarkSvg()}</h1>
      <div class="tag">Real-time strategy · Aegis vs Vrax</div>
      <button class="nav" data-mode="single">Single player</button>
      <button class="nav" data-mode="multi">Multiplayer <span class="badge" id="mp-badge" hidden>Unavailable</span></button>
      <button class="nav" id="info-btn" aria-label="Unit info">Units</button>
      <button class="nav" data-mode="howto">How to play</button>
      <button class="nav" data-mode="settings">Settings</button>
    </nav>
    <div class="main"><div class="panel">
      <section data-panel="single">
        <h2 class="hdr">Choose your faction</h2>
        <div class="faction">${factionCards}</div>
        <h2 class="hdr">Opponent</h2>
        <div class="row"><div class="seg" role="group" aria-label="Opponent"><button data-diff="easy">Easy</button><button data-diff="medium">Medium</button><button data-diff="hard">Hard</button></div><div class="seg" role="group" aria-label="Personality" title="How the opponent plays: revealed when the game ends"><button data-pers="random">Random</button><button data-pers="raider">Raider</button><button data-pers="balanced">Balanced</button><button data-pers="doomsday">Doomsday</button></div><button id="units-btn" aria-label="View units"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2 3 7l9 5 9-5-9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>View units</button></div>
        <h2 class="hdr">Map</h2>
        <div class="maps">${MAPS.map((m) => `<button class="map" data-map="${m.id}"><div class="thumb"></div><b>${m.name}</b><span>${m.blurb}</span></button>`).join('')}<div class="map" data-map="generated" role="button" tabindex="0"><div class="thumb"></div><b>Generated</b><span>A new fair map from a seed: reroll it or enter a seed to replay one.</span><div class="gen"><input id="map-seed" inputmode="numeric" aria-label="Map seed" maxlength="6"><button id="reroll" title="A new random map">Reroll</button></div></div></div>
        <div class="actions"><button id="go">START</button><span class="note">Enter to start</span></div>
      </section>
      <section data-panel="multi">
        <h2 class="hdr">Multiplayer</h2>
        <div id="mp"></div>
      </section>
      <section data-panel="howto">
        <h2 class="hdr">How to play</h2>
        <h3 class="grp">Controls</h3>
        <div data-howto="controls">${controlsHtml()}</div>
        <h3 class="grp">Basics</h3>
        <div data-howto="basics">${basicsHtml()}</div>
      </section>
      <section data-panel="settings">
        <h2 class="hdr">Settings</h2>
        <div class="field"><label>Graphics quality<small>High adds bloom, shadows, particles and decor</small></label><div class="seg"><button data-quality="high">High</button><button data-quality="low">Low</button></div></div>
        <div role="group" aria-label="Sound" data-group="sound" style="display:contents">
          <h3 class="grp">Sound</h3>
          <div class="field"><label for="set-mute">Mute all</label><input id="set-mute" type="checkbox"></div>
          <div class="field"><label for="set-volume">Master volume</label><input id="set-volume" type="range" min="0" max="100" step="5"></div>
        </div>
        <div role="group" aria-label="Music" data-group="music" style="display:contents">
          <h3 class="grp">Music</h3>
          <div class="field"><label for="set-music">Music on<small>Sound effects stay on when music is off</small></label><input id="set-music" type="checkbox"></div>
          <div class="field"><label for="set-music-volume">Music volume</label><input id="set-music-volume" type="range" min="0" max="100" step="5"></div>
        </div>
        <p class="note">Saved on this device. M mutes all sound. Reduced motion follows your system setting.</p>
      </section>
    </div></div>
    <div class="fade"></div>`;
  document.body.appendChild(root);
  // Map thumbnails, drawn from the maps themselves.
  root.querySelectorAll<HTMLElement>('[data-map]:not([data-map="generated"])').forEach((b) => b.querySelector('.thumb')?.appendChild(thumbCanvas(skirmishMap(b.dataset.map as MapId), mapStarts(b.dataset.map as MapId))));
  // Listeners on the window end with the menu, so none is left behind when an online match starts in this page.
  const life = new AbortController();
  let scene: MenuScene | null = null;
  fitHeroLines(root);
  window.addEventListener('resize', () => fitHeroLines(root), { signal: life.signal });
  void document.fonts?.ready.then(() => fitHeroLines(root));
  const sheet = createUnitSheet(life.signal, (open) => scene?.setPaused(open));
  let settings: Settings = loadSettings(safeStorage());
  const save = (patch: Partial<Settings>): void => {
    settings = { ...loadSettings(safeStorage()), ...patch };
    saveSettings(safeStorage(), settings);
  };
  // Menu music (AUD-4): browsers block autoplay, so it starts on the first click or key press. Mute all, Master volume,
  // Music on and Music volume (MENU-15) are remembered; M toggles Mute all.
  const music = new AudioEngine();
  music.setMuted(settings.muted);
  music.setVolume(settings.volume);
  music.setMusicOn(settings.musicOn);
  music.setMusicVolume(settings.musicVolume);
  // Hovering and clicking menu buttons (AUD-11).
  wireUiSounds(root, music, life.signal);
  const musicSeed = Date.now() % 100000;
  const muteBox = root.querySelector<HTMLInputElement>('#set-mute')!;
  const showMuted = (): void => {
    muteBox.checked = settings.muted;
  };
  const setMuted = (m: boolean): void => {
    save({ muted: m });
    music.setMuted(m);
    showMuted();
  };
  const beginMusic = (): void => {
    music.unlock();
    music.startMusic(musicSeed, true, pick.faction);
  };
  window.addEventListener('pointerdown', beginMusic, { signal: life.signal, once: true });
  window.addEventListener('keydown', beginMusic, { signal: life.signal, once: true });
  showMuted();
  const pick: Pick & { map: MapId; mapSeed: number } = { faction: 'human', difficulty: 'medium', personality: settings.personality, map: settings.map, mapSeed: resolveMapSeed(settings.mapSeed) };
  // The Generated card (MENU-6): its thumbnail and seed box follow the current map seed, which is always one that
  // produces a map (MAP-9).
  const seedBox = root.querySelector<HTMLInputElement>('#map-seed')!;
  const genThumb = root.querySelector<HTMLElement>('[data-map="generated"] .thumb')!;
  const showSeed = (): void => {
    seedBox.value = String(pick.mapSeed);
    genThumb.replaceChildren(thumbCanvas(skirmishMap('generated', pick.mapSeed), mapStarts('generated', pick.mapSeed)));
  };
  const useSeed = (raw: number): void => {
    pick.mapSeed = resolveMapSeed(raw);
    pick.map = 'generated';
    save({ map: pick.map, mapSeed: pick.mapSeed });
    showSeed();
    online.refresh();
    sync();
  };
  showSeed();
  seedBox.addEventListener('change', () => useSeed(mapSeedOf(seedBox.value, pick.mapSeed)));
  let mode: Mode = 'single';
  // The live faction scene (MENU-10): in the 3D view only, loaded after the menu is up so three.js never delays it.
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let sceneClosed = false;
  const closeScene = (): void => {
    sceneClosed = true;
    scene?.dispose();
    scene = null;
    document.body.dataset.menuScene = 'off';
  };
  if (chooseRenderer(new URLSearchParams(location.search).get('renderer'), probeGpu()) === '3d') {
    void import('../render3d/menuScene3d')
      .then((m) => {
        if (sceneClosed) return;
        scene = m.mountMenuScene(root.querySelector<HTMLElement>('.scene')!, { faction: pick.faction, still: holdStill(settings.quality, reduceMotion), onReady: () => root.classList.add('scene3d') });
        document.body.dataset.menuScene = 'on';
        if (sheet.isOpen()) scene.setPaused(true);
      })
      .catch(() => undefined); // no scene: the drifting backdrop stays
  }
  const volume = root.querySelector<HTMLInputElement>('#set-volume')!;
  const musicBox = root.querySelector<HTMLInputElement>('#set-music')!;
  const musicVol = root.querySelector<HTMLInputElement>('#set-music-volume')!;
  volume.value = String(Math.round(settings.volume * 100));
  musicVol.value = String(Math.round(settings.musicVolume * 100));
  musicBox.checked = settings.musicOn;
  muteBox.addEventListener('change', () => setMuted(muteBox.checked));
  volume.addEventListener('input', () => {
    save({ volume: Number(volume.value) / 100 });
    music.setVolume(Number(volume.value) / 100);
  });
  musicBox.addEventListener('change', () => {
    save({ musicOn: musicBox.checked });
    music.setMusicOn(musicBox.checked);
  });
  musicVol.addEventListener('input', () => {
    save({ musicVolume: Number(musicVol.value) / 100 });
    music.setMusicVolume(Number(musicVol.value) / 100);
  });
  const sync = (): void => {
    // The skin follows the picked faction card (MENU-12).
    root.dataset.faction = pick.faction;
    root.querySelectorAll<HTMLElement>('[data-mode]').forEach((e) => e.classList.toggle('sel', e.dataset.mode === mode));
    root.querySelectorAll<HTMLElement>('[data-panel]').forEach((e) => e.classList.toggle('on', e.dataset.panel === mode));
    root.querySelectorAll<HTMLElement>('[data-faction]').forEach((e) => e.classList.toggle('sel', e.dataset.faction === pick.faction));
    root.querySelectorAll<HTMLElement>('[data-diff]').forEach((e) => e.classList.toggle('sel', e.dataset.diff === pick.difficulty));
    root.querySelectorAll<HTMLElement>('[data-pers]').forEach((e) => e.classList.toggle('sel', e.dataset.pers === pick.personality));
    root.querySelectorAll<HTMLElement>('[data-map]').forEach((e) => e.classList.toggle('sel', e.dataset.map === pick.map));
    root.querySelectorAll<HTMLElement>('[data-quality]').forEach((e) => e.classList.toggle('sel', e.dataset.quality === settings.quality));
  };
  // An online match starts in this page, keeping its connection: the menu goes and the game loads (NET-1).
  const startOnline = (m: Match): void => {
    setActiveMatch(m);
    music.stopMusic(0.8);
    life.abort();
    closeScene();
    sheet.close();
    root.remove();
    document.getElementById('unit-info')?.remove();
    style.remove();
    history.replaceState(null, '', `?faction=${m.setup.factions[m.me]}&map=${m.setup.map}${m.setup.mapSeed !== undefined ? `&mapseed=${m.setup.mapSeed}` : ''}&online=${m.room}`);
    void import('../game');
  };
  const online = mountOnlinePanel(root.querySelector<HTMLElement>('#mp')!, root.querySelector<HTMLElement>('#mp-badge')!, {
    pick: () => ({ faction: pick.faction, map: pick.map, mapSeed: pick.mapSeed }),
    seed: () => (crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000_000),
    start: startOnline,
  });

  // START fades the menu to black before the game loads; with reduced motion it goes at once (MENU-13).
  let starting = false;
  const start = (): void => {
    if (starting) return;
    starting = true;
    music.stopMusic(0.8);
    const search = `?faction=${pick.faction}&difficulty=${pick.difficulty}&personality=${pick.personality}&map=${pick.map}${pick.map === 'generated' ? `&mapseed=${pick.mapSeed}` : ''}`;
    if (reduceMotion) {
      closeScene();
      location.search = search;
      return;
    }
    root.classList.add('leaving');
    // The scene stops and lets go of its WebGL context under the black fade, just before the game loads.
    setTimeout(() => {
      closeScene();
      location.search = search;
    }, LEAVE_MS);
  };
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-mode],[data-faction],[data-diff],[data-pers],[data-map],[data-quality],#go,#info-btn,#units-btn,#reroll') as HTMLElement | null;
    // The menu root carries the skin's data-faction: a click on bare menu is not a pick.
    if (!t || t === root || starting) return;
    if (t.id === 'info-btn' || t.id === 'units-btn') return sheet.open(pick.faction);
    if (t.id === 'go') return start();
    if (t.id === 'reroll') return useSeed(crypto.getRandomValues(new Uint32Array(1))[0]! % MAP_SEED_MAX);
    if (t.dataset.mode) mode = t.dataset.mode as Mode;
    else if (t.dataset.faction) {
      pick.faction = t.dataset.faction as Pick['faction'];
      scene?.setFaction(pick.faction);
      music.setThemeFaction(pick.faction);
      online.refresh();
    }
    else if (t.dataset.diff) pick.difficulty = t.dataset.diff as Pick['difficulty'];
    else if (t.dataset.pers) {
      pick.personality = personalityChoiceOf(t.dataset.pers);
      save({ personality: pick.personality });
    }
    else if (t.dataset.quality) {
      save({ quality: t.dataset.quality === 'low' ? 'low' : 'high' });
      scene?.setStill(holdStill(settings.quality, reduceMotion));
    }
    else if (t.dataset.map) {
      pick.map = t.dataset.map === 'generated' ? 'generated' : (MAPS.find((m) => m.id === t.dataset.map)?.id ?? pick.map);
      save({ map: pick.map });
      online.refresh();
    }
    sync();
  });
  // Keyboard: Up and Down move through the rail and Enter starts a single-player game; the unit sheet has its own keys.
  const navs = [...root.querySelectorAll<HTMLButtonElement>('.rail .nav')];
  window.addEventListener(
    'keydown',
    (e) => {
      if (sheet.isOpen() || e.target instanceof HTMLInputElement) return;
      if (e.key === 'm' || e.key === 'M') setMuted(!settings.muted);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const i = navs.indexOf(document.activeElement as HTMLButtonElement);
        const next = navs[(i + (e.key === 'ArrowDown' ? 1 : navs.length - 1)) % navs.length] ?? navs[0]!;
        next.focus();
        if (next.dataset.mode) {
          mode = next.dataset.mode as Mode;
          sync();
        }
        e.preventDefault();
      } else if (e.key === 'Enter' && mode === 'single' && !(document.activeElement instanceof HTMLButtonElement && document.activeElement.closest('.rail'))) {
        start();
      }
    },
    { signal: life.signal },
  );
  sync();
}
