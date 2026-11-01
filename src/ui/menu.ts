import { MAPS, skirmishMap, type MapId } from '../data/maps';
import { thumbCanvas } from './mapThumb';
import { loadSettings, safeStorage, saveSettings, type Settings } from './settings';
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
#menu .card .hero b { color: var(--c); }
#menu .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
#menu .row .seg { align-self: auto; }
#menu #units-btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 10px; border: 1px solid #2b6b55; background: rgba(18,51,41,.55); color: #7ff5cd; font: inherit; font-weight: 600; font-size: 14px; cursor: pointer; }
#menu #units-btn:hover, #menu #units-btn:focus-visible { background: #123329; border-color: #3f9a7a; outline: none; }
#menu #units-btn svg { width: 18px; height: 18px; }
#menu .seg { display: inline-flex; align-self: flex-start; border: 1px solid #22384c; border-radius: 10px; overflow: hidden; background: rgba(8,13,19,.85); }
#menu .seg button { padding: 10px 22px; border: 0; background: transparent; color: #b6c7d6; font: inherit; font-weight: 600; font-size: 14px; cursor: pointer; }
#menu .seg button + button { border-left: 1px solid #22384c; }
#menu .seg button.sel { background: #123329; color: #7ff5cd; }
#menu .maps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
#menu .map { display: flex; flex-direction: column; justify-content: flex-start; text-align: left; color: inherit; font: inherit; cursor: pointer; padding: 12px; border-radius: 12px; border: 1px solid #22384c; background: rgba(8,13,19,.88); transition: border-color .14s, transform .14s; }
#menu .map:hover { transform: translateY(-2px); border-color: #35506a; }
#menu .map.sel { border-color: #7ff5cd; box-shadow: 0 0 0 1px #7ff5cd; }
#menu .map .thumb { height: 92px; display: flex; align-items: center; justify-content: center; overflow: hidden; margin-bottom: 8px; }
#menu .map canvas { width: 62px; height: 62px; image-rendering: pixelated; transform: rotate(45deg); border-radius: 3px; box-shadow: 0 0 0 1px #2a4052; }
#menu .map b { display: block; font-size: 15px; }
#menu .map span { font-size: 12.5px; color: #8aa0b4; }
#menu .actions { display: flex; align-items: center; gap: 14px; margin-top: 6px; }
#menu #go { padding: 15px 56px; font: inherit; font-weight: 800; font-size: 18px; letter-spacing: .16em; border-radius: 10px; border: 0; cursor: pointer; background: linear-gradient(#35e0a1, #1fa57a); color: #04130d; box-shadow: 0 10px 28px -10px #35e0a1; }
#menu #go:hover, #menu #go:focus-visible { filter: brightness(1.1); outline: none; }
#menu .note { color: #6f8090; font-size: 12.5px; }
#menu .field { display: flex; align-items: center; gap: 16px; padding: 14px 16px; border-radius: 10px; border: 1px solid #22384c; background: rgba(8,13,19,.85); max-width: 640px; }
#menu .field label { flex: 1; color: #dfe8e2; }
#menu .field small { display: block; color: #7f93a6; font-size: 12px; }
#menu input[type=range] { width: 200px; accent-color: #35e0a1; }
#menu input[type=checkbox] { width: 20px; height: 20px; accent-color: #35e0a1; }
@media (max-width: 860px) { #menu { display: block; overflow: auto; } #menu .rail { overflow: visible; border-right: 0; border-bottom: 1px solid #1c2e3e; padding: 24px 16px 12px; } #menu .rail .help { display: none; } #menu .main { overflow: visible; padding: 20px 16px 28px; } #menu .faction, #menu .maps { grid-template-columns: 1fr; } }
`;

/** Controls summary on the main menu; names the current bindings. */
export const HELP_TEXT =
  'Left-click select · drag to box-select · right-click move/attack · F then right-click attack-move · E select same kind · Q select army · X stop · Ctrl+1-9 groups · WASD/edges scroll · wheel zoom. Harvest shards, build up the tech tree, destroy the enemy base.';

type Pick = { faction: 'human' | 'alien'; difficulty: 'easy' | 'medium' | 'hard' };
type Mode = 'single' | 'multi' | 'settings';

const FACTIONS = [
  { id: 'human', sub: 'Humans · armour and firepower', text: 'Structured combined arms: rifle squads, rocketeers, tanks and artillery behind pulse turrets.', hero: 'Paladin, a giant four-legged assault walker whose cannons and missiles hit ground and air' },
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
      <div class="help">${HELP_TEXT}</div>
    </nav>
    <div class="main">
      <section data-panel="single">
        <h2>Choose your faction</h2>
        <div class="faction">${factionCards}</div>
        <h2>Opponent</h2>
        <div class="row"><div class="seg" role="group" aria-label="Opponent"><button data-diff="easy">Easy</button><button data-diff="medium">Medium</button><button data-diff="hard">Hard</button></div><button id="units-btn" aria-label="View units"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2 3 7l9 5 9-5-9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>View units</button></div>
        <h2>Map</h2>
        <div class="maps">${MAPS.map((m) => `<button class="map" data-map="${m.id}"><div class="thumb"></div><b>${m.name}</b><span>${m.blurb}</span></button>`).join('')}</div>
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
  root.querySelectorAll<HTMLElement>('[data-map]').forEach((b) => b.querySelector('.thumb')?.appendChild(thumbCanvas(skirmishMap(b.dataset.map as MapId))));
  // Listeners on the window end with the menu, so none is left behind when an online match starts in this page.
  const life = new AbortController();
  const sheet = createUnitSheet(life.signal);
  let settings: Settings = loadSettings(safeStorage());
  const save = (patch: Partial<Settings>): void => {
    settings = { ...loadSettings(safeStorage()), ...patch };
    saveSettings(safeStorage(), settings);
  };
  const pick: Pick & { map: MapId } = { faction: 'human', difficulty: 'medium', map: settings.map };
  let mode: Mode = 'single';
  const volume = root.querySelector<HTMLInputElement>('#set-volume')!;
  const mute = root.querySelector<HTMLInputElement>('#set-mute')!;
  volume.value = String(Math.round(settings.volume * 100));
  mute.checked = settings.muted;
  volume.addEventListener('input', () => save({ volume: Number(volume.value) / 100 }));
  mute.addEventListener('change', () => save({ muted: mute.checked }));
  const sync = (): void => {
    root.querySelectorAll<HTMLElement>('[data-mode]').forEach((e) => e.classList.toggle('sel', e.dataset.mode === mode));
    root.querySelectorAll<HTMLElement>('[data-panel]').forEach((e) => e.classList.toggle('on', e.dataset.panel === mode));
    root.querySelectorAll<HTMLElement>('[data-faction]').forEach((e) => e.classList.toggle('sel', e.dataset.faction === pick.faction));
    root.querySelectorAll<HTMLElement>('[data-diff]').forEach((e) => e.classList.toggle('sel', e.dataset.diff === pick.difficulty));
    root.querySelectorAll<HTMLElement>('[data-map]').forEach((e) => e.classList.toggle('sel', e.dataset.map === pick.map));
    root.querySelectorAll<HTMLElement>('[data-quality]').forEach((e) => e.classList.toggle('sel', e.dataset.quality === settings.quality));
  };
  // An online match starts in this page, keeping its connection: the menu goes and the game loads (NET-1).
  const startOnline = (m: Match): void => {
    setActiveMatch(m);
    life.abort();
    sheet.close();
    root.remove();
    document.getElementById('unit-info')?.remove();
    style.remove();
    history.replaceState(null, '', `?faction=${m.setup.factions[m.me]}&map=${m.setup.map}&online=${m.room}`);
    void import('../game');
  };
  const online = mountOnlinePanel(root.querySelector<HTMLElement>('#mp')!, root.querySelector<HTMLElement>('#mp-badge')!, {
    pick: () => ({ faction: pick.faction, map: pick.map }),
    seed: () => (crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000_000),
    start: startOnline,
  });

  const start = (): void => {
    location.search = `?faction=${pick.faction}&difficulty=${pick.difficulty}&map=${pick.map}`;
  };
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-mode],[data-faction],[data-diff],[data-map],[data-quality],#go,#info-btn,#units-btn') as HTMLElement | null;
    if (!t) return;
    if (t.id === 'info-btn' || t.id === 'units-btn') return sheet.open(pick.faction);
    if (t.id === 'go') return start();
    if (t.dataset.mode) mode = t.dataset.mode as Mode;
    else if (t.dataset.faction) {
      pick.faction = t.dataset.faction as Pick['faction'];
      online.refresh();
    }
    else if (t.dataset.diff) pick.difficulty = t.dataset.diff as Pick['difficulty'];
    else if (t.dataset.quality) save({ quality: t.dataset.quality === 'low' ? 'low' : 'high' });
    else if (t.dataset.map) {
      pick.map = MAPS.find((m) => m.id === t.dataset.map)?.id ?? pick.map;
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
