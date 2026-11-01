import type { UnitPreview } from '../render3d/preview3d';
import { statFill, statMax, unitCards, type UnitCard, type UnitStats } from './unitInfo';

/**
 * The unit sheet (INF-1..8): faction tabs, a list of the faction's units with a picture of each one's 3D model, and a
 * detail pane for the chosen unit with its model turning on a plinth, its strengths and weaknesses, where it is trained
 * and bars for its numbers. The three.js preview loads only when the sheet first opens.
 */

type Faction = 'human' | 'alien';

export const FACTION_INFO = { human: { name: 'Aegis Union', color: '#6fd3ff', owner: 0 }, alien: { name: 'Vrax Hive', color: '#b6ff5c', owner: 1 } } as const;

const CSS = `
#unit-info { position: fixed; inset: 0; z-index: 20; display: none; align-items: center; justify-content: center; background: rgba(3,6,10,.82); backdrop-filter: blur(3px); padding: 20px 16px; box-sizing: border-box; color: #dfe8e2; font: 14px/1.45 system-ui, 'Segoe UI', sans-serif; }
#unit-info.open { display: flex; }
#unit-info .sheet { width: min(1080px, 100%); height: min(680px, 100%); display: flex; flex-direction: column; background: linear-gradient(160deg, #0d151d, #080c11); border: 1px solid #28405a; border-radius: 14px; box-shadow: 0 30px 80px -20px #000, 0 0 0 1px #0b1a24; overflow: hidden; }
#unit-info header { display: flex; align-items: center; gap: 18px; padding: 14px 18px; border-bottom: 1px solid #1c2e3e; }
#unit-info header h2 { margin: 0; font-size: 13px; letter-spacing: .2em; text-transform: uppercase; color: #8aa0b4; }
#unit-info .tabs { display: inline-flex; border: 1px solid #22384c; border-radius: 10px; overflow: hidden; }
#unit-info .tabs button { padding: 8px 18px; border: 0; background: transparent; color: #b6c7d6; font: inherit; font-weight: 600; cursor: pointer; }
#unit-info .tabs button + button { border-left: 1px solid #22384c; }
#unit-info .tabs button.sel { background: color-mix(in srgb, var(--c) 18%, #0b1015); color: var(--c); }
#unit-info .close { margin-left: auto; width: 36px; height: 36px; border: 1px solid #28405a; background: #101c27; color: inherit; border-radius: 8px; cursor: pointer; font: inherit; font-size: 18px; line-height: 1; }
#unit-info .close:hover { border-color: #3d5e7c; }
#unit-info .body { flex: 1; min-height: 0; display: grid; grid-template-columns: 300px 1fr; }
#unit-info .list { margin: 0; padding: 10px; list-style: none; overflow: auto; border-right: 1px solid #1c2e3e; display: flex; flex-direction: column; gap: 6px; }
#unit-info .u { width: 100%; display: grid; grid-template-columns: 72px 1fr auto; align-items: center; gap: 10px; padding: 6px 10px 6px 6px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
#unit-info .u:hover { background: #0f1b26; }
#unit-info .u:focus-visible, #unit-info .tabs button:focus-visible, #unit-info .close:focus-visible { outline: 2px solid var(--c); outline-offset: 1px; }
#unit-info .u.sel { background: color-mix(in srgb, var(--c) 10%, #0d1720); border-color: color-mix(in srgb, var(--c) 55%, transparent); }
#unit-info .pic { width: 72px; height: 54px; border-radius: 7px; background: radial-gradient(ellipse at 50% 70%, #1a2836, #0a1016); display: flex; align-items: center; justify-content: center; overflow: hidden; }
#unit-info .pic img { width: 72px; height: 54px; }
#unit-info .u b { display: block; font-size: 14.5px; }
#unit-info .u small { color: #8aa0b4; font-size: 12px; }
#unit-info .u .cost { color: #ffd479; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
#unit-info .detail { min-width: 0; display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); }
#unit-info .stage { position: relative; min-height: 0; background: radial-gradient(ellipse at 50% 62%, color-mix(in srgb, var(--c) 12%, #121c26) 0%, #070b10 70%); }
#unit-info .stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
#unit-info .stage .hint { position: absolute; left: 14px; bottom: 10px; font-size: 11.5px; color: #5f7386; letter-spacing: .06em; }
#unit-info .noview[hidden] { display: none; }
#unit-info .noview { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #5f7386; }
#unit-info .facts { min-width: 0; overflow: auto; padding: 20px 22px; display: flex; flex-direction: column; gap: 12px; border-left: 1px solid #1c2e3e; }
#unit-info .facts h3 { margin: 0; font-size: 26px; line-height: 1.1; color: var(--c); }
#unit-info .role { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: #8aa0b4; }
#unit-info .role .cost { color: #ffd479; }
#unit-info .tags { display: flex; flex-wrap: wrap; gap: 5px; }
#unit-info .tags span { font-size: 12px; padding: 3px 9px; border-radius: 999px; background: #14202c; color: #b6c7d6; border: 1px solid #1f3142; }
#unit-info .bars { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 7px 10px; font-size: 12.5px; }
#unit-info .bars span { color: #8aa0b4; }
#unit-info .bar { height: 7px; border-radius: 99px; background: #14202c; overflow: hidden; }
#unit-info .bar i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, color-mix(in srgb, var(--c) 55%, #0b1015), var(--c)); }
#unit-info .bars em { font-style: normal; color: #dfe8e2; font-variant-numeric: tabular-nums; text-align: right; }
#unit-info .facts p { margin: 0; font-size: 13px; color: #b6c7d6; }
#unit-info .facts p b { color: #dfe8e2; font-weight: 600; }
#unit-info .keys { margin-top: auto; font-size: 11.5px; color: #5f7386; }
@media (max-width: 860px) {
  #unit-info { padding: 0; }
  #unit-info .sheet { height: 100%; border-radius: 0; }
  #unit-info header { flex-wrap: wrap; gap: 10px; }
  #unit-info .body { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  #unit-info .list { flex-direction: row; overflow-x: auto; border-right: 0; border-bottom: 1px solid #1c2e3e; }
  #unit-info .list li { flex: 0 0 auto; }
  #unit-info .u { grid-template-columns: 64px; gap: 4px; justify-items: center; text-align: center; }
  #unit-info .u small, #unit-info .u .cost { display: none; }
  #unit-info .u b { font-size: 12px; }
  #unit-info .detail { grid-template-columns: 1fr; overflow: auto; }
  #unit-info .stage { min-height: 240px; }
  #unit-info .facts { border-left: 0; overflow: visible; }
}
`;

const STAT_ROWS: readonly [keyof UnitStats, string, (v: number) => string][] = [
  ['health', 'Health', (v) => `${v}`],
  ['speed', 'Speed', (v) => `${v}`],
  ['range', 'Range', (v) => (v ? `${v} tiles` : '—')],
  ['firepower', 'Firepower', (v) => (v ? `${v}/s` : '—')],
];

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** The detail pane's facts for one unit (INF-2..4, INF-6, INF-7). */
export function factsHtml(c: UnitCard, max: UnitStats = statMax()): string {
  const tags = [c.toughness, c.speed, c.range ? `${c.range} range` : 'Unarmed', c.canAttack ? (c.hitsAir ? 'Hits air' : 'Ground only') : '', c.regenerates ? 'Regenerates' : ''].filter(Boolean);
  const strong = c.canAttack ? (c.strong.length ? c.strong.map((s) => (s.units.length ? `${s.armour} (${s.units.join(', ')})` : s.armour)).join('; ') : 'Nothing in particular') : 'Cannot attack';
  const bars = STAT_ROWS.map(([k, label, fmt]) => `<span>${label}</span><div class="bar"><i style="width:${(statFill(c.stats[k], max[k]) * 100).toFixed(1)}%"></i></div><em>${fmt(c.stats[k])}</em>`).join('');
  const where = `${c.trainedAt}${c.needs.length ? ` · needs ${c.needs.join(', ')}` : ''}`;
  return `<h3>${esc(c.name)}</h3><div class="role">${esc(c.role)} · <span class="cost">◈ ${c.cost}</span></div><div class="tags">${tags.map((t) => `<span>${t}</span>`).join('')}</div><div class="bars">${bars}</div><p><b>Strong against:</b> ${esc(strong)}</p><p><b>Weak against:</b> ${esc(c.weak.length ? c.weak.join(', ') : 'Nothing in particular')}</p><p><b>Trained at:</b> ${esc(where)}</p>`;
}

export interface UnitSheet {
  open(faction: Faction): void;
  close(): void;
  isOpen(): boolean;
}

export function createUnitSheet(signal?: AbortSignal): UnitSheet {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'unit-info';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Units');
  document.body.appendChild(el);

  let faction: Faction = 'human';
  let cards: UnitCard[] = [];
  let index = 0;
  let preview: UnitPreview | null | undefined; // undefined: not loaded yet; null: no WebGL (INF-8)
  let loading: Promise<void> | null = null;
  const pictures = new Map<string, string>();
  const max = statMax();

  const load = (): Promise<void> =>
    (loading ??= import('../render3d/preview3d')
      .then((m) => {
        preview = m.UnitPreview.create();
      })
      .catch(() => {
        preview = null;
      }));

  const render = (): void => {
    const f = FACTION_INFO[faction];
    cards = unitCards(faction);
    el.innerHTML = `<div class="sheet" style="--c:${f.color}">
      <header><h2>Units</h2><div class="tabs" role="tablist">${(['human', 'alien'] as const).map((k) => `<button role="tab" data-tab="${k}" aria-selected="${k === faction}" class="${k === faction ? 'sel' : ''}">${FACTION_INFO[k].name}</button>`).join('')}</div><button class="close" data-close aria-label="Close">✕</button></header>
      <div class="body"><ul class="list" aria-label="${f.name} units">${cards.map((c, i) => `<li><button class="u" data-unit="${i}"><span class="pic"></span><span><b>${esc(c.name)}</b><small>${esc(c.role)}</small></span><span class="cost">◈ ${c.cost}</span></button></li>`).join('')}</ul>
      <div class="detail"><div class="stage"><canvas aria-label="3D model"></canvas><div class="noview" hidden>3D preview unavailable</div><div class="hint">In-game model</div></div><div class="facts" aria-live="polite"></div></div></div></div>`;
    select(Math.min(index, cards.length - 1));
    void load().then(() => {
      if (!el.classList.contains('open')) return;
      fillPictures();
      play();
    });
  };

  const fillPictures = (): void => {
    const owner = FACTION_INFO[faction].owner;
    el.querySelectorAll<HTMLElement>('[data-unit]').forEach((b) => {
      const c = cards[Number(b.dataset.unit)];
      const pic = b.querySelector('.pic');
      if (!c || !pic || !preview) return;
      let src = pictures.get(c.kind);
      if (!src) {
        src = preview.picture(c.kind, owner, 144, 108);
        pictures.set(c.kind, src);
      }
      pic.innerHTML = `<img alt="" src="${src}">`;
    });
  };

  const play = (): void => {
    const canvas = el.querySelector<HTMLCanvasElement>('.stage canvas');
    const c = cards[index];
    const none = el.querySelector<HTMLElement>('.noview');
    if (none) none.hidden = preview !== null;
    if (!canvas || !c || !preview) return;
    preview.play(c.kind, FACTION_INFO[faction].owner, canvas);
  };

  const select = (i: number): void => {
    index = (i + cards.length) % cards.length;
    el.querySelectorAll<HTMLElement>('[data-unit]').forEach((b) => {
      const on = Number(b.dataset.unit) === index;
      b.classList.toggle('sel', on);
      b.setAttribute('aria-current', String(on));
    });
    el.querySelector('.u.sel')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const facts = el.querySelector('.facts');
    const c = cards[index];
    if (facts && c) facts.innerHTML = `${factsHtml(c, max)}<div class="keys">↑ ↓ choose a unit · ← → switch faction · Esc closes</div>`;
    if (preview) play();
  };

  const sheet: UnitSheet = {
    open(f) {
      faction = f;
      index = 0;
      el.classList.add('open');
      render();
      el.querySelector<HTMLElement>('.u.sel')?.focus();
    },
    close() {
      preview?.stop();
      el.classList.remove('open');
    },
    isOpen: () => el.classList.contains('open'),
  };

  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === el || t.closest('[data-close]')) return sheet.close();
    const tab = t.closest<HTMLElement>('[data-tab]');
    if (tab) {
      faction = tab.dataset.tab as Faction;
      index = 0;
      return render();
    }
    const u = t.closest<HTMLElement>('[data-unit]');
    if (u) select(Number(u.dataset.unit));
  });
  window.addEventListener(
    'keydown',
    (e) => {
      if (!sheet.isOpen()) return;
      if (e.key === 'Escape') sheet.close();
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        select(index + (e.key === 'ArrowDown' ? 1 : -1));
        el.querySelector<HTMLElement>('.u.sel')?.focus();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        faction = faction === 'human' ? 'alien' : 'human';
        index = 0;
        render();
        el.querySelector<HTMLElement>('.u.sel')?.focus();
      } else return;
      e.preventDefault();
    },
    { signal },
  );
  return sheet;
}
