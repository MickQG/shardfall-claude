import { unitCards } from './unitInfo';

const CSS = `
#menu { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; color: #dfe8e2; font: 15px/1.4 system-ui, sans-serif;
  background: radial-gradient(ellipse at 50% 120%, #0f3a33 0%, #0b1015 60%); overflow: auto; padding: 24px; box-sizing: border-box; }
#menu h1 { margin: 0; font-size: clamp(40px, 9vw, 88px); letter-spacing: .28em; text-indent: .28em; font-weight: 800; color: #7ff5cd; text-shadow: 0 0 28px #35e0a1aa, 0 0 2px #fff; }
#menu .tag { color: #9fb4c6; margin-top: -10px; letter-spacing: .12em; text-transform: uppercase; font-size: 12px; text-align: center; }
#menu .cards { display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; }
#menu .card { width: 260px; background: rgba(10,18,26,.85); border: 2px solid #28405a; border-radius: 10px; padding: 16px; cursor: pointer; text-align: left; color: inherit; font: inherit; transition: transform .12s, border-color .12s, box-shadow .12s; }
#menu .card:hover { transform: translateY(-2px); }
#menu .card.sel { border-color: var(--c); box-shadow: 0 0 22px var(--c); }
#menu .card h2 { margin: 0 0 4px; font-size: 20px; color: var(--c); }
#menu .card p { margin: 0; color: #b6c7d6; font-size: 13px; }
#menu .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: center; }
#menu .row label { color: #9fb4c6; }
#menu .pill { padding: 8px 18px; border-radius: 999px; border: 1px solid #28405a; background: #101c27; color: inherit; cursor: pointer; font: inherit; }
#menu .pill.sel { border-color: #7ff5cd; background: #123329; color: #7ff5cd; }
#menu #go { padding: 14px 44px; font-size: 18px; font-weight: 700; letter-spacing: .1em; border-radius: 8px; border: 0; cursor: pointer; background: linear-gradient(#35e0a1, #1fa57a); color: #04130d; }
#menu #go:hover { filter: brightness(1.1); }
#menu .help { max-width: 640px; text-align: center; color: #7f93a6; font-size: 12.5px; }
#menu #info-btn { width: 34px; height: 34px; border-radius: 50%; border: 1px solid #28405a; background: #101c27; color: #7ff5cd; font: 600 17px/1 Georgia, serif; cursor: pointer; }
#menu #info-btn:hover { border-color: #7ff5cd; }
#unit-info { position: fixed; inset: 0; display: none; align-items: flex-start; justify-content: center; background: rgba(4,8,12,.8); overflow: auto; padding: 24px 16px; box-sizing: border-box; color: #dfe8e2; font: 14px/1.4 system-ui, sans-serif; }
#unit-info.open { display: flex; }
#unit-info .sheet { width: min(980px, 100%); background: #0b1015; border: 1px solid #28405a; border-radius: 10px; padding: 18px; box-sizing: border-box; }
#unit-info header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; gap: 12px; }
#unit-info h2 { margin: 0; font-size: 20px; color: var(--c); }
#unit-info .close { border: 1px solid #28405a; background: #101c27; color: inherit; border-radius: 6px; padding: 6px 14px; cursor: pointer; font: inherit; }
#unit-info .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
#unit-info .u { background: rgba(10,18,26,.9); border: 1px solid #28405a; border-radius: 8px; padding: 12px; }
#unit-info .u h3 { margin: 0; font-size: 15px; }
#unit-info .u .role { color: var(--c); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; margin: 2px 0 8px; }
#unit-info .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
#unit-info .tags span { font-size: 11.5px; padding: 2px 7px; border-radius: 999px; background: #14202c; color: #b6c7d6; }
#unit-info .u p { margin: 4px 0 0; font-size: 12.5px; color: #b6c7d6; }
#unit-info .u b { color: #dfe8e2; font-weight: 600; }
`;

const FACTION_INFO = { human: { name: 'Aegis Union', color: '#6fd3ff' }, alien: { name: 'Vrax Hive', color: '#b6ff5c' } } as const;

/** HTML for the unit info sheet of one faction (INF-1..4). */
function infoSheet(faction: 'human' | 'alien'): string {
  const f = FACTION_INFO[faction];
  const cards = unitCards(faction)
    .map((c) => {
      const tags = [c.toughness, c.speed, c.range ? `${c.range} range` : 'Unarmed', c.canAttack ? (c.hitsAir ? 'Hits air' : 'Ground only') : '', c.regenerates ? 'Regenerates' : ''].filter(Boolean);
      const strong = c.canAttack ? (c.strong.length ? c.strong.map((s) => (s.units.length ? `${s.armour} (${s.units.join(', ')})` : s.armour)).join('; ') : 'Nothing in particular') : 'Cannot attack';
      return `<div class="u"><h3>${c.name}</h3><div class="role">${c.role} · ◈ ${c.cost}</div><div class="tags">${tags.map((t) => `<span>${t}</span>`).join('')}</div><p><b>Strong against:</b> ${strong}</p><p><b>Weak against:</b> ${c.weak.length ? c.weak.join(', ') : 'Nothing in particular'}</p></div>`;
    })
    .join('');
  return `<div class="sheet" style="--c:${f.color}"><header><h2>${f.name} units</h2><button class="close" data-close>Close</button></header><div class="grid">${cards}</div></div>`;
}

/** Controls summary on the main menu; names the current bindings. */
export const HELP_TEXT =
  'Left-click select · drag to box-select · right-click move/attack · F then right-click attack-move · E select same kind · Q select army · X stop · Ctrl+1-9 groups · WASD/edges scroll · wheel zoom. Harvest shards, build up the tech tree, destroy the enemy base.';

type Pick = { faction: 'human' | 'alien'; difficulty: 'easy' | 'medium' | 'hard' };

export function showMenu(): void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'menu';
  root.innerHTML = `
    <h1>SHARDFALL</h1>
    <div class="tag">An original isometric RTS · skirmish against the AI</div>
    <div class="cards">
      <button class="card" data-faction="human" style="--c:#6fd3ff"><h2>Aegis Union</h2><p>Humans. Armoured, structured, combined arms: tanks, rocketeers, artillery and gunships behind pulse turrets.</p></button>
      <button class="card" data-faction="alien" style="--c:#b6ff5c"><h2>Vrax Hive</h2><p>Aliens. Fast, organic and regenerating: skitterers, brutes and spitters that heal between fights.</p></button>
    </div>
    <div class="row"><label>Opponent</label>
      <button class="pill" data-diff="easy">Easy</button><button class="pill" data-diff="medium">Medium</button><button class="pill" data-diff="hard">Hard</button></div>
    <div class="row"><button id="go">START</button><button id="info-btn" title="Unit info" aria-label="Unit info">i</button></div>
    <div class="help">${HELP_TEXT}</div>`;
  document.body.appendChild(root);
  const info = document.createElement('div');
  info.id = 'unit-info';
  document.body.appendChild(info);
  const pick: Pick = { faction: 'human', difficulty: 'medium' };
  const showInfo = (open: boolean): void => {
    if (open) info.innerHTML = infoSheet(pick.faction);
    info.classList.toggle('open', open);
  };
  info.addEventListener('click', (e) => {
    if (e.target === info || (e.target as HTMLElement).closest('[data-close]')) showInfo(false);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') showInfo(false);
  });
  const sync = (): void => {
    root.querySelectorAll<HTMLElement>('[data-faction]').forEach((e) => e.classList.toggle('sel', e.dataset.faction === pick.faction));
    root.querySelectorAll<HTMLElement>('[data-diff]').forEach((e) => e.classList.toggle('sel', e.dataset.diff === pick.difficulty));
  };
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-faction],[data-diff],#go,#info-btn') as HTMLElement | null;
    if (!t) return;
    if (t.id === 'info-btn') return showInfo(true);
    if (t.dataset.faction) pick.faction = t.dataset.faction as Pick['faction'];
    else if (t.dataset.diff) pick.difficulty = t.dataset.diff as Pick['difficulty'];
    else if (t.id === 'go') location.search = `?faction=${pick.faction}&difficulty=${pick.difficulty}`;
    sync();
  });
  sync();
}
