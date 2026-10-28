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
#hud #result button { font: inherit; font-size: 16px; padding: 10px 22px; border-radius: 6px; border: 1px solid #7ff5cd; background: #11202c; color: #dfe8e2; cursor: pointer; }
#hud #toasts { position: absolute; top: 56px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 6px; align-items: center; pointer-events: none; }
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

export interface Hud {
  minimapHost: HTMLElement;
  setInfo(lines: string[]): void;
  setTop(text: string): void;
  selbox(rect: { x0: number; y0: number; x1: number; y1: number } | null): void;
  showResult(title: string, sub: string, color: string): void;
  toast(text: string, level: 'info' | 'warn' | 'bad'): void;
  showPause(show: boolean, actions?: { resume: () => void; quit: () => void }): void;
}

export function createHud(): Hud {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'hud';
  root.innerHTML = '<div id="topbar" class="panel">Shardfall</div><div id="minimap-box" class="panel"></div><div id="info" class="panel empty"></div><div id="selbox"></div><div id="toasts"></div><div id="pause"><h2>PAUSED</h2><button id="resume">Resume (P)</button><button id="quit">Quit to menu</button></div><div id="result"><h1></h1><div class="sub"></div><button id="again">Play again</button></div>';
  document.body.appendChild(root);
  const q = (sel: string): HTMLElement => root.querySelector(sel) as HTMLElement;
  const info = q('#info');
  const box = q('#selbox');
  return {
    minimapHost: q('#minimap-box'),
    setInfo(lines) {
      info.classList.toggle('empty', lines.length === 0);
      info.textContent = lines.join('\n');
      info.style.whiteSpace = 'pre-line';
    },
    setTop(text) {
      q('#topbar').textContent = text;
    },
    showResult(title, sub, color) {
      const el = q('#result');
      el.style.display = 'flex';
      (el.querySelector('h1') as HTMLElement).textContent = title;
      (el.querySelector('h1') as HTMLElement).style.color = color;
      (el.querySelector('.sub') as HTMLElement).textContent = sub;
      (el.querySelector('#again') as HTMLElement).onclick = () => location.reload();
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
