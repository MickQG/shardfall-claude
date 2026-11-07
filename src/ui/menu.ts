import { MAP_SEED_MAX, MAPS, mapSeedOf, mapStarts, resolveMapSeed, skirmishMap, type MapId } from '../data/maps';
import { AudioEngine } from '../audio/engine';
import { thumbCanvas } from './mapThumb';
import { loadSettings, personalityChoiceOf, safeStorage, saveSettings, type PersonalityChoice, type Settings } from './settings';
import { setActiveMatch, type Match } from '../net/lobby';
import { mountOnlinePanel, ONLINE_CSS } from './onlinePanel';
import { createUnitSheet, FACTION_INFO } from './unitSheet';

/**
 * Main menu (MENU-1..3): a full-screen layout with a left rail (title, Single player, Multiplayer, Units, Settings) and
 * a panel for the chosen mode on the right, over a slowly drifting backdrop. Multiplayer is shown as work in progress.
 */
const CSS = `
#menu { position: fixed; inset: 0; display: grid; grid-template-columns: minmax(240px, 300px) 1fr; color: #dfe8e2; font: 15px/1.45 system-ui, 'Segoe UI', sans-serif; background: #070b10; overflow: hidden; }
#menu .bg { position: absolute; inset: -20%; pointer-events: none; background:
  radial-gradient(40% 35% at 20% 30%, #0f3a3355, transparent 70%), radial-gradient(35% 30% at 80% 70%, #1d2f6655, transparent 70%),
  radial-gradient(30% 25% at 65% 20%, #3a1f4a44, transparent 70%); animation: menu-drift 26s ease-in-out infinite alternate; }
#menu .grid { position: absolute; inset: 0; pointer-events: none; opacity: .18; background-image: linear-gradient(#2a4a5a 1px, transparent 1px), linear-gradient(90deg, #2a4a5a 1px, transparent 1px); background-size: 48px 48px; mask-image: radial-gradient(ellipse at 60% 60%, #000 20%, transparent 75%); }
@keyframes menu-drift { from { transform: translate(-3%, -2%) rotate(0deg); } to { transform: translate(3%, 2%) rotate(4deg); } }
@media (prefers-reduced-motion: reduce) { #menu .bg { animation: none; } }
#menu .rail { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 40px 22px 24px; background: linear-gradient(90deg, rgba(5,9,13,.92), rgba(5,9,13,.7)); border-right: 1px solid #1c2e3e; overflow: auto; }
#menu h1 { margin: 0; font-size: 31px; letter-spacing: .2em; white-space: nowrap; font-weight: 800; color: #7ff5cd; text-shadow: 0 0 22px #35e0a199; }
#menu .tag { color: #7f93a6; letter-spacing: .14em; text-transform: uppercase; font-size: 11px; margin: 2px 0 26px; }
#menu .nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 12px 14px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: #b6c7d6; font: inherit; font-weight: 600; font-size: 16px; text-align: left; cursor: pointer; letter-spacing: .04em; }
#menu .nav:hover, #menu .nav:focus-visible { background: #0f1b26; color: #dfe8e2; outline: none; }
#menu .nav.sel { background: linear-gradient(90deg, #123329, #0f1b26); border-color: #2b6b55; color: #7ff5cd; }
#menu .nav.wip { color: #8a98a6; }
#menu .badge { font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; padding: 4px 7px; border-radius: 999px; background: #3a2f12; color: #ffcf6a; border: 1px solid #6b5520; }
#menu #music-btn { align-self: flex-start; margin-top: 14px; padding: 7px 12px; border-radius: 8px; border: 1px solid #22384c; background: transparent; color: #8aa0b4; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
#menu #music-btn:hover, #menu #music-btn:focus-visible { color: #dfe8e2; border-color: #35506a; outline: none; }
#menu .rail .help { margin-top: auto; padding-top: 18px; color: #5f7386; font-size: 11.5px; line-height: 1.5; }
#menu .main { position: relative; overflow: auto; padding: 40px clamp(20px, 4vw, 56px) 28px; }
#menu section { display: none; flex-direction: column; gap: 18px; max-width: 980px; }
#menu section.on { display: flex; }
#menu h2 { margin: 6px 0 0; font-size: 12.5px; letter-spacing: .18em; text-transform: uppercase; color: #8aa0b4; font-weight: 700; }
#menu .faction { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
#menu .card { position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-start; text-align: left; color: inherit; font: inherit; cursor: pointer; padding: 20px 20px 18px; border-radius: 12px; border: 1px solid #22384c; background: linear-gradient(160deg, rgba(16,28,40,.92), rgba(8,13,19,.92)); transition: transform .14s, border-color .14s, box-shadow .14s; }
#menu .card::after { content: ''; position: absolute; right: -40px; top: -40px; width: 160px; height: 160px; border-radius: 50%; background: radial-gradient(circle, var(--c) 0%, transparent 70%); opacity: .14; }
#menu .card:hover { transform: translateY(-2px); border-color: #35506a; }
#menu .card.sel { border-color: var(--c); box-shadow: 0 0 0 1px var(--c), 0 12px 32px -12px var(--c); }
#menu .card h3 { margin: 0 0 2px; font-size: 22px; color: var(--c); }
#menu .card .sub { font-size: 11.5px; letter-spacing: .12em; text-transform: uppercase; color: #8aa0b4; margin-bottom: 10px; }
#menu .card p { margin: 0; color: #b6c7d6; font-size: 13.5px; }
#menu .card .hero { margin-top: 10px; font-size: 12.5px; color: #b6c7d6; }
#menu .card .hero { white-space: nowrap; }
@media (max-width: 480px) { #menu .card { padding: 16px 12px 14px; } #menu .card .hero { font-size: 11px; letter-spacing: -.01em; } }
#menu .card .hero b { color: var(--c); }
#menu .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
#menu .row .seg { align-self: auto; }
#menu .row .seg[aria-label="Personality"] button { padding: 10px 14px; }
#menu #units-btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 10px; border: 1px solid #2b6b55; background: rgba(18,51,41,.55); color: #7ff5cd; font: inherit; font-weight: 600; font-size: 14px; cursor: pointer; }
#menu #units-btn:hover, #menu #units-btn:focus-visible { background: #123329; border-color: #3f9a7a; outline: none; }
#menu #units-btn svg { width: 18px; height: 18px; }
#menu .seg { display: inline-flex; align-self: flex-start; border: 1px solid #22384c; border-radius: 10px; overflow: hidden; background: rgba(8,13,19,.85); }
#menu .seg button { padding: 10px 22px; border: 0; background: transparent; color: #b6c7d6; font: inherit; font-weight: 600; font-size: 14px; cursor: pointer; }
#menu .seg button + button { border-left: 1px solid #22384c; }
#menu .seg button.sel { background: #123329; color: #7ff5cd; }
#menu .maps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
#menu .map { display: flex; flex-direction: column; justify-content: flex-start; text-align: left; color: inherit; font: inherit; cursor: pointer; padding: 12px; border-radius: 12px; border: 1px solid #22384c; background: rgba(8,13,19,.88); transition: border-color .14s, transform .14s; }
#menu .map:hover { transform: translateY(-2px); border-color: #35506a; }
#menu .map.sel { border-color: #7ff5cd; box-shadow: 0 0 0 1px #7ff5cd; }
#menu .map .thumb { height: 92px; display: flex; align-items: center; justify-content: center; overflow: hidden; margin-bottom: 8px; }
#menu .map canvas { width: 62px; height: 62px; image-rendering: pixelated; transform: rotate(45deg); border-radius: 3px; box-shadow: 0 0 0 1px #2a4052; }
#menu .map b { display: block; font-size: 15px; }
#menu .map span { font-size: 12.5px; color: #8aa0b4; }
#menu .map .gen { display: flex; gap: 6px; margin-top: 8px; align-items: center; }
#menu .map .gen input { width: 0; flex: 1; min-width: 0; padding: 5px 7px; border-radius: 6px; border: 1px solid #22384c; background: #0b141c; color: #dfe8e2; font: inherit; font-size: 13px; font-variant-numeric: tabular-nums; }
#menu .map .gen button { padding: 5px 9px; border-radius: 6px; border: 1px solid #2b6b55; background: rgba(18,51,41,.55); color: #7ff5cd; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
#menu .actions { display: flex; align-items: center; gap: 14px; margin-top: 6px; }
#menu #go { padding: 15px 56px; font: inherit; font-weight: 800; font-size: 18px; letter-spacing: .16em; border-radius: 10px; border: 0; cursor: pointer; background: linear-gradient(#35e0a1, #1fa57a); color: #04130d; box-shadow: 0 10px 28px -10px #35e0a1; }
#menu #go:hover, #menu #go:focus-visible { filter: brightness(1.1); outline: none; }
#menu .note { color: #6f8090; font-size: 12.5px; }
#menu .field { display: flex; align-items: center; gap: 16px; padding: 14px 16px; border-radius: 10px; border: 1px solid #22384c; background: rgba(8,13,19,.85); max-width: 640px; }
#menu .field label { flex: 1; color: #dfe8e2; }
#menu .field small { display: block; color: #7f93a6; font-size: 12px; }
#menu input[type=range] { width: 200px; accent-color: #35e0a1; }
#menu input[type=checkbox] { width: 20px; height: 20px; accent-color: #35e0a1; }
@media (max-width: 1100px) { #menu .maps { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 860px) { #menu { display: block; overflow: auto; } #menu .rail { overflow: visible; border-right: 0; border-bottom: 1px solid #1c2e3e; padding: 24px 16px 12px; } #menu .rail .help { display: none; } #menu .main { overflow: visible; padding: 20px 16px 28px; } #menu .faction, #menu .maps { grid-template-columns: 1fr; } }
`;

/** Controls summary on the main menu; names the current bindings. */
export const HELP_TEXT =
  'Left-click select · drag to box-select · right-click move/attack · F then right-click attack-move · E select same kind · Q select army · X stop · Ctrl+1-9 groups · WASD/edges scroll · wheel zoom. Harvest shards, build up the tech tree, destroy the enemy base.';

type Pick = { faction: 'human' | 'alien'; difficulty: 'easy' | 'medium' | 'hard'; personality: PersonalityChoice };
type Mode = 'single' | 'multi' | 'settings';

/** The Aegis card's hero line (MENU-7): short enough to sit on one row of the card. */
export const HUMAN_HERO_LINE = 'Paladin, a giant assault walker with cannons and missiles.';

const FACTIONS = [
  { id: 'human', sub: 'Humans · armour and firepower', text: 'Structured combined arms: rifle squads, rocketeers, tanks and artillery behind pulse turrets.', hero: HUMAN_HERO_LINE },
  { id: 'alien', sub: 'Aliens · speed and regeneration', text: 'Fast, organic swarms: skitterers, spitters and brutes that heal between fights.', hero: 'Dreadstrider, a towering six-legged walker with an acid cannon' },
] as const;

export function showMenu(): void {
  const style = document.createElement('style');
  style.textContent = CSS + ONLINE_CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'menu';
  const factionCards = FACTIONS.map((f) => {
    const info = FACTION_INFO[f.id];
    return `<button class="card" data-faction="${f.id}" style="--c:${info.color}"><h3>${info.name}</h3><div class="sub">${f.sub}</div><p>${f.text}</p><div class="hero">Hero: <b>${f.hero}</b></div></button>`;
  }).join('');
  root.innerHTML = `
    <div class="bg"></div><div class="grid"></div>
    <nav class="rail" aria-label="Main menu">
      <h1>SHARDFALL</h1>
      <div class="tag">Real-time strategy · Aegis vs Vrax</div>
      <button class="nav" data-mode="single">Single player</button>
      <button class="nav" data-mode="multi">Multiplayer <span class="badge" id="mp-badge" hidden>Unavailable</span></button>
      <button class="nav" id="info-btn" aria-label="Unit info">Units</button>
      <button class="nav" data-mode="settings">Settings</button>
      <button id="music-btn" aria-label="Music" aria-pressed="false"></button>
      <div class="help">${HELP_TEXT}</div>
    </nav>
    <div class="main">
      <section data-panel="single">
        <h2>Choose your faction</h2>
        <div class="faction">${factionCards}</div>
        <h2>Opponent</h2>
        <div class="row"><div class="seg" role="group" aria-label="Opponent"><button data-diff="easy">Easy</button><button data-diff="medium">Medium</button><button data-diff="hard">Hard</button></div><div class="seg" role="group" aria-label="Personality" title="How the opponent plays: revealed when the game ends"><button data-pers="random">Random</button><button data-pers="raider">Raider</button><button data-pers="balanced">Balanced</button><button data-pers="doomsday">Doomsday</button></div><button id="units-btn" aria-label="View units"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2 3 7l9 5 9-5-9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>View units</button></div>
        <h2>Map</h2>
        <div class="maps">${MAPS.map((m) => `<button class="map" data-map="${m.id}"><div class="thumb"></div><b>${m.name}</b><span>${m.blurb}</span></button>`).join('')}<div class="map" data-map="generated" role="button" tabindex="0"><div class="thumb"></div><b>Generated</b><span>A new fair map from a seed: reroll it or enter a seed to replay one.</span><div class="gen"><input id="map-seed" inputmode="numeric" aria-label="Map seed" maxlength="6"><button id="reroll" title="A new random map">Reroll</button></div></div></div>
        <div class="actions"><button id="go">START</button><span class="note">Enter to start</span></div>
      </section>
      <section data-panel="multi">
        <h2>Multiplayer</h2>
        <div id="mp"></div>
      </section>
      <section data-panel="settings">
        <h2>Settings</h2>
        <div class="field"><label>Graphics quality<small>High adds bloom, shadows, particles and decor</small></label><div class="seg"><button data-quality="high">High</button><button data-quality="low">Low</button></div></div>
        <div class="field"><label for="set-volume">Volume</label><input id="set-volume" type="range" min="0" max="100" step="5"></div>
        <div class="field"><label for="set-mute">Mute sound</label><input id="set-mute" type="checkbox"></div>
        <p class="note">Saved on this device. Reduced motion follows your system setting.</p>
      </section>
    </div>`;
  document.body.appendChild(root);
  // Map thumbnails, drawn from the maps themselves.
  root.querySelectorAll<HTMLElement>('[data-map]:not([data-map="generated"])').forEach((b) => b.querySelector('.thumb')?.appendChild(thumbCanvas(skirmishMap(b.dataset.map as MapId), mapStarts(b.dataset.map as MapId))));
  // Listeners on the window end with the menu, so none is left behind when an online match starts in this page.
  const life = new AbortController();
  const sheet = createUnitSheet(life.signal);
  let settings: Settings = loadSettings(safeStorage());
  const save = (patch: Partial<Settings>): void => {
    settings = { ...loadSettings(safeStorage()), ...patch };
    saveSettings(safeStorage(), settings);
  };
  // Menu music (AUD-4): browsers block autoplay, so it starts on the first click or key press; Mute (or M) is remembered.
  const music = new AudioEngine();
  music.setMuted(settings.muted);
  music.setVolume(settings.volume);
  const musicSeed = Date.now() % 100000;
  const musicBtn = root.querySelector<HTMLButtonElement>('#music-btn')!;
  const showMuted = (): void => {
    musicBtn.textContent = settings.muted ? 'Music: off' : 'Music: on';
    musicBtn.setAttribute('aria-pressed', String(!settings.muted));
    const box = root.querySelector<HTMLInputElement>('#set-mute');
    if (box) box.checked = settings.muted;
  };
  const setMuted = (m: boolean): void => {
    save({ muted: m });
    music.setMuted(m);
    showMuted();
  };
  const beginMusic = (): void => {
    music.unlock();
    music.startMusic(musicSeed, true);
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
  const volume = root.querySelector<HTMLInputElement>('#set-volume')!;
  const mute = root.querySelector<HTMLInputElement>('#set-mute')!;
  volume.value = String(Math.round(settings.volume * 100));
  mute.checked = settings.muted;
  volume.addEventListener('input', () => save({ volume: Number(volume.value) / 100 }));
  mute.addEventListener('change', () => setMuted(mute.checked));
  volume.addEventListener('input', () => music.setVolume(Number(volume.value) / 100));
  musicBtn.addEventListener('click', () => setMuted(!settings.muted));
  const sync = (): void => {
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

  const start = (): void => {
    music.stopMusic(0.8);
    location.search = `?faction=${pick.faction}&difficulty=${pick.difficulty}&personality=${pick.personality}&map=${pick.map}${pick.map === 'generated' ? `&mapseed=${pick.mapSeed}` : ''}`;
  };
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-mode],[data-faction],[data-diff],[data-pers],[data-map],[data-quality],#go,#info-btn,#units-btn,#reroll') as HTMLElement | null;
    if (!t) return;
    if (t.id === 'info-btn' || t.id === 'units-btn') return sheet.open(pick.faction);
    if (t.id === 'go') return start();
    if (t.id === 'reroll') return useSeed(crypto.getRandomValues(new Uint32Array(1))[0]! % MAP_SEED_MAX);
    if (t.dataset.mode) mode = t.dataset.mode as Mode;
    else if (t.dataset.faction) {
      pick.faction = t.dataset.faction as Pick['faction'];
      online.refresh();
    }
    else if (t.dataset.diff) pick.difficulty = t.dataset.diff as Pick['difficulty'];
    else if (t.dataset.pers) {
      pick.personality = personalityChoiceOf(t.dataset.pers);
      save({ personality: pick.personality });
    }
    else if (t.dataset.quality) save({ quality: t.dataset.quality === 'low' ? 'low' : 'high' });
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
