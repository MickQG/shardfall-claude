const CSS = `
#hud { position: fixed; inset: 0; pointer-events: none; font: 13px/1.3 system-ui, sans-serif; color: #dfe8e2; }
#hud .panel { position: absolute; background: rgba(8,12,17,.82); border: 1px solid #28405a; border-radius: 6px; padding: 8px 10px; pointer-events: auto; }
#hud #minimap-box { left: 12px; bottom: 12px; padding: 6px; }
#hud #minimap-box canvas { display: block; cursor: crosshair; }
#hud #info { left: 50%; bottom: 12px; transform: translateX(-50%); min-width: 240px; text-align: center; }
#hud #info.empty { display: none; }
#hud #topbar { left: 12px; top: 12px; }
#hud #selbox { position: fixed; border: 1px solid #7ff5cd; background: rgba(127,245,205,.12); display: none; pointer-events: none; }
`;

export interface Hud {
  minimapHost: HTMLElement;
  setInfo(lines: string[]): void;
  setTop(text: string): void;
  selbox(rect: { x0: number; y0: number; x1: number; y1: number } | null): void;
}

export function createHud(): Hud {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'hud';
  root.innerHTML = '<div id="topbar" class="panel">Shardfall</div><div id="minimap-box" class="panel"></div><div id="info" class="panel empty"></div><div id="selbox"></div>';
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
