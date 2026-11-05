import type { CountdownRow } from './countdown';
const CSS = `
#hud { position: fixed; inset: 0; pointer-events: none; font: 13px/1.3 system-ui, sans-serif; color: #dfe8e2; }
#hud .panel { position: absolute; background: rgba(8,12,17,.82); border: 1px solid #28405a; border-radius: 6px; padding: 8px 10px; pointer-events: auto; }
#hud #minimap-box { left: 12px; bottom: 12px; padding: 6px; }
#hud #minimap-box canvas { display: block; cursor: crosshair; }
#hud #info { left: 50%; bottom: 12px; transform: translateX(-50%); min-width: 240px; text-align: center; }
#hud #info.empty { display: none; }
#hud #topbar { left: 12px; top: 12px; }
#hud #result { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; gap: 14px; background: rgba(4,8,12,.72); pointer-events: auto; text-align: center; }
#hud #result h1 { margin: 0; font-size: 64px; letter-spacing: .2em; text-shadow: 0 0 24px currentColor; }
#hud #result .score { background: rgba(8,12,17,.9); border: 1px solid #28405a; border-radius: 8px; padding: 12px 16px; max-width: calc(100vw - 32px); box-sizing: border-box; }
#hud #result table { border-collapse: collapse; font-size: 13px; margin: 0 auto; }
#hud #result th, #hud #result td { padding: 3px 12px; text-align: right; font-variant-numeric: tabular-nums; }
#hud #result th:first-child, #hud #result td:first-child { text-align: left; color: #9fb4c6; }
#hud #result .chart { display: block; margin: 10px auto 0; width: 320px; max-width: 100%; height: auto; }
#hud #result .len { color: #9fb4c6; font-size: 12px; margin-top: 6px; }
#hud #result .actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
#hud #result button { font: inherit; font-size: 16px; padding: 10px 22px; border-radius: 6px; border: 1px solid #7ff5cd; background: #11202c; color: #dfe8e2; cursor: pointer; }
#hud #topmid { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; align-items: center; pointer-events: none; max-width: calc(100vw - 32px); }
#hud #countdown { display: none; flex-direction: column; gap: 3px; padding: 6px 12px; border-radius: 6px; background: rgba(8,12,17,.86); border: 1px solid #28405a; font-weight: 600; font-variant-numeric: tabular-nums; text-align: center; }
#hud #countdown.on { display: flex; }
#hud #countdown .own { color: #bffbe6; }
#hud #countdown .enemy { color: #ff9a8a; }
#hud #countdown .danger { color: #ff5a4a; animation: swpulse 1s ease-in-out infinite; }
@keyframes swpulse { 50% { opacity: .55; } }
#hud #toasts { margin-top: 32px; display: flex; flex-direction: column; gap: 6px; align-items: center; pointer-events: none; }
#hud .toast { padding: 6px 14px; border-radius: 6px; background: rgba(8,12,17,.9); border: 1px solid #28405a; font-weight: 600; animation: toastin .25s ease-out; }
#hud .toast.warn { border-color: #ffd34a; color: #ffe08a; }
#hud .toast.bad { border-color: #ff5a4a; color: #ff9a8a; }
#hud .toast.info { border-color: #7ff5cd; color: #bffbe6; }
@keyframes toastin { from { opacity: 0; transform: translateY(-8px); } }
#hud #pause { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; gap: 12px; background: rgba(4,8,12,.7); pointer-events: auto; }
#hud #pause h2 { margin: 0 0 6px; font-size: 40px; letter-spacing: .25em; color: #7ff5cd; }
#hud #pause button { font: inherit; font-size: 15px; padding: 9px 22px; border-radius: 6px; border: 1px solid #7ff5cd; background: #11202c; color: #dfe8e2; cursor: pointer; min-width: 180px; }
#hud #selbox { position: fixed; border: 1px solid #7ff5cd; background: rgba(127,245,205,.12); display: none; pointer-events: none; }
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
  return `<div class="score"><table>${head}${body}</table><svg class="chart" viewBox="0 -4 320 128" role="img" aria-label="Army value over time"><line x1="0" y1="120" x2="320" y2="120" stroke="#28405a"/>${lines}</svg><div class="len">Army value over time · game length ${esc(s.length)}</div></div>`;
}

export interface Hud {
  minimapHost: HTMLElement;
  setInfo(lines: string[]): void;
  setTop(text: string): void;
  selbox(rect: { x0: number; y0: number; x1: number; y1: number } | null): void;
  showResult(title: string, sub: string, color: string, score?: ScoreView): void;
  toast(text: string, level: 'info' | 'warn' | 'bad'): void;
  /** The superweapon countdown box at the top of the map view (SW-1); empty hides it. */
  setCountdown(rows: readonly CountdownRow[]): void;
  showPause(show: boolean, actions?: { resume: () => void; quit: () => void }): void;
}

export function createHud(): Hud {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'hud';
  root.innerHTML = '<div id="topbar" class="panel">Shardfall</div><div id="minimap-box" class="panel"></div><div id="info" class="panel empty"></div><div id="selbox"></div><div id="topmid"><div id="countdown" role="status" aria-live="polite"></div><div id="toasts"></div></div><div id="pause"><h2>PAUSED</h2><button id="resume">Resume (P)</button><button id="quit">Quit to menu</button></div><div id="result"><h1></h1><div class="sub"></div><div class="actions"><button id="again">Play again</button><button id="menu-btn">Main menu</button></div></div>';
  document.body.appendChild(root);
  const q = (sel: string): HTMLElement => root.querySelector(sel) as HTMLElement;
  const info = q('#info');
  const box = q('#selbox');
  const countdown = q('#countdown');
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
    showResult(title, sub, color, score) {
      const el = q('#result');
      el.style.display = 'flex';
      el.querySelector('.score')?.remove();
      if (score) (el.querySelector('.sub') as HTMLElement).insertAdjacentHTML('afterend', scoreHtml(score));
      (el.querySelector('h1') as HTMLElement).textContent = title;
      (el.querySelector('h1') as HTMLElement).style.color = color;
      (el.querySelector('.sub') as HTMLElement).textContent = sub;
      (el.querySelector('#again') as HTMLElement).onclick = () => location.reload();
      (el.querySelector('#menu-btn') as HTMLElement).onclick = () => (location.search = '');
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
