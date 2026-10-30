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
`;

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
    <button id="go">START</button>
    <div class="help">${HELP_TEXT}</div>`;
  document.body.appendChild(root);
  const pick: Pick = { faction: 'human', difficulty: 'medium' };
  const sync = (): void => {
    root.querySelectorAll<HTMLElement>('[data-faction]').forEach((e) => e.classList.toggle('sel', e.dataset.faction === pick.faction));
    root.querySelectorAll<HTMLElement>('[data-diff]').forEach((e) => e.classList.toggle('sel', e.dataset.diff === pick.difficulty));
  };
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-faction],[data-diff],#go') as HTMLElement | null;
    if (!t) return;
    if (t.dataset.faction) pick.faction = t.dataset.faction as Pick['faction'];
    else if (t.dataset.diff) pick.difficulty = t.dataset.diff as Pick['difficulty'];
    else if (t.id === 'go') location.search = `?faction=${pick.faction}&difficulty=${pick.difficulty}`;
    sync();
  });
  sync();
}
