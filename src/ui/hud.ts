import type { CountdownRow } from './countdown';
import { controlsHtml } from './controlsHelp';
import { leaveOnPurpose } from './leaveGuard';
import { ensureTheme, type SkinId } from './theme';
const CSS = `
#hud { position: fixed; inset: 0; pointer-events: none; font: 13px/1.3 var(--font-body); color: var(--ink); }
#hud .panel { position: absolute; background: var(--panel); border: 1px solid var(--edge); border-radius: var(--r-s); clip-path: var(--clip-s); box-shadow: var(--frame-shadow); padding: 8px 10px; pointer-events: auto; }
#hud #minimap-box { left: 12px; bottom: 12px; padding: 8px; }
#hud #minimap-box canvas { display: block; cursor: crosshair; }
#hud #info { left: 50%; bottom: 12px; transform: translateX(-50%); min-width: 240px; text-align: center; }
#hud #info.empty { display: none; }
#hud #topbar { left: 12px; top: 12px; font-family: var(--font-head); font-stretch: 87.5%; letter-spacing: .1em; text-transform: uppercase; font-size: 14px; font-weight: 600; }
#hud #topbar b { color: var(--accent); font-weight: 700; }
#hud #result { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; gap: 14px; background: rgba(4,8,12,.72); pointer-events: auto; text-align: center; }
#hud #result h1 { margin: 0; font-size: 64px; letter-spacing: .2em; text-shadow: 0 2px 0 rgba(0,0,0,.3); }
#hud #result .sub { max-width: min(640px, calc(100vw - 32px)); color: var(--ink); }
#hud #result .score { background: var(--panel); border: 1px solid var(--edge); border-radius: var(--r); clip-path: var(--clip); box-shadow: var(--frame-shadow); padding: 14px 18px; max-width: calc(100vw - 32px); box-sizing: border-box; }
#hud #result table { border-collapse: collapse; font-size: 13px; margin: 0 auto; }
#hud #result th, #hud #result td { padding: 3px 12px; text-align: right; font-variant-numeric: tabular-nums; }
#hud #result th { font-family: var(--font-head); font-stretch: 87.5%; letter-spacing: .1em; text-transform: uppercase; }
#hud #result th:first-child, #hud #result td:first-child { text-align: left; color: var(--ink-dim); }
#hud #result .chart { display: block; margin: 10px auto 0; width: 320px; max-width: 100%; height: auto; }
#hud #result .len { color: var(--ink-dim); font-size: 12px; margin-top: 6px; }
#hud #result .actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
#hud button.btn, #hud #result button, #hud #pause button { font-family: var(--font-head); font-stretch: 87.5%; text-transform: uppercase; letter-spacing: .12em; font-size: 16px; padding: 10px 22px; border-radius: var(--r-s); clip-path: var(--clip-s); border: 1px solid var(--accent); background: var(--sel-bg); color: var(--ink); cursor: pointer; }
#hud #result button:hover, #hud #pause button:hover, #hud button.btn:hover { background: var(--accent); color: var(--accent-ink); }
#hud #topmid { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; align-items: center; pointer-events: none; max-width: calc(100vw - 32px); }
#hud #countdown { display: none; flex-direction: column; gap: 3px; padding: 6px 14px; border-radius: var(--r-s); clip-path: var(--clip-s); background: var(--panel); border: 1px solid var(--edge); box-shadow: var(--frame-shadow); font-weight: 600; font-variant-numeric: tabular-nums; text-align: center; }
#hud #countdown.on { display: flex; }
#hud #countdown .own { color: var(--good); }
#hud #countdown .enemy { color: var(--warn); }
#hud #countdown .danger { color: var(--bad); animation: swpulse 1.6s ease-in-out infinite; }
@keyframes swpulse { 50% { opacity: .7; } }
@media (prefers-reduced-motion: reduce) { #hud #countdown .danger { animation: none; } #hud .toast { animation: none; } }
#hud #toasts { margin-top: 32px; display: flex; flex-direction: column; gap: 6px; align-items: center; pointer-events: none; }
#hud .toast { padding: 6px 14px; border-radius: var(--r-s); clip-path: var(--clip-s); background: var(--panel); border: 1px solid var(--edge); box-shadow: var(--frame-shadow); font-weight: 600; animation: toastin .25s ease-out; }
#hud .toast.warn { border-color: var(--warn); color: var(--warn); }
#hud .toast.bad { border-color: var(--bad); color: var(--bad); }
#hud .toast.info { border-color: var(--accent); color: var(--accent); }
@keyframes toastin { from { opacity: 0; transform: translateY(-8px); } }
#hud #pause { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; gap: 12px; background: rgba(4,8,12,.7); pointer-events: auto; }
#hud #pause h2 { margin: 0 0 6px; font-size: 40px; letter-spacing: .25em; color: var(--accent); }
#hud #pause button { min-width: 180px; font-size: 15px; padding: 9px 22px; }
#hud #selbox { position: fixed; border: 1px solid var(--accent); background: rgba(127,245,205,.12); display: none; pointer-events: none; }
#hud[data-faction="human"] #selbox { background: rgba(111,211,255,.12); }
#hud[data-faction="alien"] #selbox { background: rgba(182,255,92,.12); }
#hud #help { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; pointer-events: none; }
#hud #help.on { display: flex; }
#hud #help .sheet { position: relative; width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 64px); overflow: auto; box-sizing: border-box; padding: 20px 24px 22px; background: var(--panel); border: 1px solid var(--edge); border-radius: var(--r); clip-path: var(--clip); box-shadow: var(--frame-shadow); pointer-events: auto; }
#hud #help h2 { margin: 0 0 6px; font-size: 20px; letter-spacing: .18em; color: var(--accent); }
#hud #help .close { position: absolute; right: 14px; top: 14px; padding: 4px 12px; font-size: 13px; }
#hud #help table.controls { border-collapse: collapse; width: 100%; font-size: 13px; }
#hud #help table.controls th { text-align: left; padding: 12px 0 4px; font-family: var(--font-head); font-stretch: 87.5%; text-transform: uppercase; letter-spacing: .16em; font-size: 13px; color: var(--accent-2); border-bottom: 1px solid var(--edge); }
#hud #help table.controls td { padding: 3px 12px 3px 0; vertical-align: top; }
#hud #help table.controls td.keys { white-space: nowrap; color: var(--accent); font-weight: 600; width: 1%; padding-right: 20px; }
`;

/** Title, line and colour of the end-of-game screen for `player`; `winner` null is a draw. */
export function resultText(winner: number | null, player: number): { title: string; sub: string; color: string } {
  if (winner === null) return { title: 'DRAW', sub: 'No side is left standing.', color: '#ffd34a' };
  return winner === player ? { title: 'VICTORY', sub: 'The enemy base has fallen.', color: '#7ff5cd' } : { title: 'DEFEAT', sub: 'Your base has fallen.', color: '#ff5a4a' };
}

/** What the result screen shows below the title (SCR-3). */
export interface ScoreView {
  header: string[];
  rows: string[][];
  length: string;
  /** One army-value line per player: polyline points on a 320 by 120 chart. */
  series: { color: string; points: string }[];
}

const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function scoreHtml(s: ScoreView): string {
  // Column headings take their side's line colour, so the chart needs no separate legend.
  const head = `<tr>${s.header.map((h, i) => `<th${i > 0 && s.series[i - 1] ? ` style="color:${s.series[i - 1]?.color}"` : ''}>${esc(h)}</th>`).join('')}</tr>`;
  const body = s.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  const lines = s.series.map((l) => `<polyline points="${l.points}" fill="none" stroke="${l.color}" stroke-width="2" stroke-linejoin="round"/>`).join('');
  return `<div class="score"><table>${head}${body}</table><svg class="chart" viewBox="0 -4 320 128" role="img" aria-label="Army value over time"><line x1="0" y1="120" x2="320" y2="120" stroke="var(--edge)"/>${lines}</svg><div class="len">Army value over time · game length ${esc(s.length)}</div></div>`;
}

export interface Hud {
  minimapHost: HTMLElement;
  setInfo(lines: string[]): void;
  setTop(text: string): void;
  /** The F1 controls overlay (UI-18). */
  showHelp(show: boolean): void;
  helpOpen(): boolean;
  selbox(rect: { x0: number; y0: number; x1: number; y1: number } | null): void;
  showResult(title: string, sub: string, color: string, score?: ScoreView): void;
  toast(text: string, level: 'info' | 'warn' | 'bad'): void;
  /** The superweapon countdown box at the top of the map view (SW-1); empty hides it. */
  setCountdown(rows: readonly CountdownRow[]): void;
  showPause(show: boolean, actions?: { resume: () => void; quit: () => void }): void;
}

export function createHud(faction: SkinId = 'human'): Hud {
  ensureTheme();
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'hud';
  root.className = 'skin';
  root.dataset.faction = faction;
  root.innerHTML = '<div id="topbar" class="panel">F1 Help</div><div id="minimap-box" class="panel"></div><div id="info" class="panel empty"></div><div id="selbox"></div><div id="topmid"><div id="countdown" role="status" aria-live="polite"></div><div id="toasts"></div></div><div id="pause"><h2>PAUSED</h2><button id="resume">Resume (P)</button><button id="fullscreen">Full screen (F11)</button><button id="quit">Quit to menu</button></div><div id="help" role="dialog" aria-label="Controls"><div class="sheet"><h2 class="hdr">Controls</h2><button class="btn close" id="help-close">F1 or Esc: close</button>' + controlsHtml() + '</div></div><div id="result"><h1></h1><div class="sub"></div><div class="actions"><button id="again">Play again</button><button id="menu-btn">Main menu</button></div></div>';
  document.body.appendChild(root);
  const q = (sel: string): HTMLElement => root.querySelector(sel) as HTMLElement;
  const info = q('#info');
  const box = q('#selbox');
  const countdown = q('#countdown');
  const help = q('#help');
  (help.querySelector('#help-close') as HTMLElement).onclick = () => help.classList.remove('on');
  let countdownKey = '';
  return {
    setCountdown(rows) {
      const key = rows.map((r) => `${r.tone}|${r.text}`).join('/');
      if (key === countdownKey) return;
      countdownKey = key;
      countdown.classList.toggle('on', rows.length > 0);
      countdown.innerHTML = rows.map((r) => `<div class="${r.tone}">${esc(r.text)}</div>`).join('');
    },
    minimapHost: q('#minimap-box'),
    setInfo(lines) {
      info.classList.toggle('empty', lines.length === 0);
      info.textContent = lines.join('\n');
      info.style.whiteSpace = 'pre-line';
    },
    setTop(text) {
      q('#topbar').textContent = text;
    },
    showHelp(show) {
      help.classList.toggle('on', show);
    },
    helpOpen: () => help.classList.contains('on'),
    showResult(title, sub, color, score) {
      const el = q('#result');
      el.style.display = 'flex';
      el.querySelector('.score')?.remove();
      if (score) (el.querySelector('.sub') as HTMLElement).insertAdjacentHTML('afterend', scoreHtml(score));
      (el.querySelector('h1') as HTMLElement).textContent = title;
      (el.querySelector('h1') as HTMLElement).style.color = color;
      (el.querySelector('.sub') as HTMLElement).textContent = sub;
      (el.querySelector('#again') as HTMLElement).onclick = () => leaveOnPurpose(() => location.reload());
      (el.querySelector('#menu-btn') as HTMLElement).onclick = () => leaveOnPurpose(() => (location.search = ''));
    },
    toast(text, level) {
      const t = q('#toasts');
      const el = document.createElement('div');
      el.className = `toast ${level}`;
      el.textContent = text;
      t.appendChild(el);
      while (t.children.length > 4) t.firstChild?.remove();
      setTimeout(() => el.remove(), 4200);
    },
    showPause(show, actions) {
      const p = q('#pause');
      p.style.display = show ? 'flex' : 'none';
      if (show && actions) {
        (p.querySelector('#resume') as HTMLElement).onclick = actions.resume;
        (p.querySelector('#quit') as HTMLElement).onclick = actions.quit;
      }
    },
    selbox(r) {
      if (!r) {
        box.style.display = 'none';
        return;
      }
      box.style.display = 'block';
      box.style.left = `${Math.min(r.x0, r.x1)}px`;
      box.style.top = `${Math.min(r.y0, r.y1)}px`;
      box.style.width = `${Math.abs(r.x1 - r.x0)}px`;
      box.style.height = `${Math.abs(r.y1 - r.y0)}px`;
    },
  };
}
