import { tipOf } from './controlsHelp';
import { ensureTheme, wordmarkSvg, type SkinId } from './theme';

/** Frames the game view draws before the game is released (UI-12): the first one may still be compiling shaders. */
export const READY_FRAMES = 2;
/**
 * The longest the built game waits for those frames (UI-12): a background tab draws none, and the game (online, both
 * players' game) must not wait for the player to come back to it.
 */
export const READY_TIMEOUT_MS = 3000;

/**
 * The loading screen (UI-12): shown from the moment the game page opens until the battlefield is built and drawn, so the
 * player never faces a black screen while the game waits for them at its first tick. `done` fades it out.
 */
export function showLoading(text = 'Preparing the battlefield…', faction: SkinId = 'human', tip: string = tipOf(Date.now())): { done(): void } {
  ensureTheme();
  const el = document.createElement('div');
  el.id = 'loading';
  el.className = 'skin';
  el.dataset.faction = faction;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.style.cssText =
    'position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:24px;box-sizing:border-box;background:radial-gradient(ellipse at 50% 45%,var(--panel-top) 0%,var(--void) 70%);color:var(--ink);font:600 15px/1.3 var(--font-body);transition:opacity .35s ease-out';
  el.innerHTML =
    `<div style="width:min(300px,80vw)">${wordmarkSvg()}</div>` +
    '<div class="spin" style="width:38px;height:38px;border-radius:50%;border:3px solid var(--edge);border-top-color:var(--accent);animation:loadspin 0.9s linear infinite"></div>' +
    '<div class="msg" style="color:var(--ink-dim)"></div>' +
    '<div class="tip frame" style="max-width:min(520px,90vw);padding:10px 16px;font-weight:500;text-align:center;border-radius:var(--r-s);clip-path:var(--clip-s)"></div>' +
    '<style>@keyframes loadspin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){#loading .spin{animation:none}}</style>';
  (el.querySelector('.msg') as HTMLElement).textContent = text;
  (el.querySelector('.tip') as HTMLElement).textContent = `Tip: ${tip}`;
  document.body.appendChild(el);
  let gone = false;
  return {
    done() {
      if (gone) return;
      gone = true;
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      setTimeout(() => el.remove(), 400);
    },
  };
}

/**
 * Resolves once the browser has drawn `frames` more frames or `ms` have passed, whichever comes first (UI-12). `raf` and
 * `wait` stand in for requestAnimationFrame and setTimeout in tests.
 */
export function readyToStart(
  frames: number,
  ms: number,
  raf: (cb: () => void) => void = (cb) => void requestAnimationFrame(cb),
  wait: (cb: () => void, ms: number) => void = (cb, t) => void setTimeout(cb, t),
): Promise<'drawn' | 'timeout'> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (why: 'drawn' | 'timeout'): void => {
      if (done) return;
      done = true;
      resolve(why);
    };
    const step = (k: number): void => raf(() => (k <= 1 ? finish('drawn') : step(k - 1)));
    step(frames);
    wait(() => finish('timeout'), ms);
  });
}

