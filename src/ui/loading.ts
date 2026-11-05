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
export function showLoading(text = 'Preparing the battlefield…'): { done(): void } {
  const el = document.createElement('div');
  el.id = 'loading';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.style.cssText =
    'position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:radial-gradient(ellipse at 50% 45%,#13202b 0%,#0b1015 70%);color:#dfe8e2;font:600 15px/1.3 system-ui,sans-serif;transition:opacity .35s ease-out';
  el.innerHTML =
    '<div style="font-size:34px;letter-spacing:.3em;color:#7ff5cd;text-shadow:0 0 18px rgba(127,245,205,.45)">SHARDFALL</div>' +
    '<div class="spin" style="width:38px;height:38px;border-radius:50%;border:3px solid #28405a;border-top-color:#7ff5cd;animation:loadspin 0.9s linear infinite"></div>' +
    '<div class="msg" style="color:#9fb4c6"></div>' +
    '<style>@keyframes loadspin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){#loading .spin{animation:none}}</style>';
  (el.querySelector('.msg') as HTMLElement).textContent = text;
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

