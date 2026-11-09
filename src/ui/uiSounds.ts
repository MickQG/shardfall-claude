/** What the button sounds need from the audio engine. */
interface ButtonSounds {
  play(name: 'hover' | 'click'): void;
}

/** Everything a pointer can press in the menu and the HUD: a real button, or an element that says it is one. */
export const BUTTON_SELECTOR = 'button, [role="button"]';

/**
 * UI sounds (AUD-11): a quiet tick the moment the pointer moves onto a button that can be used now, and a short click when
 * such a button is pressed. One delegated pair of listeners on `root` serves every button, however it is created.
 * Moving off a button, across a background or between the parts of a button is silent, and so is a disabled or
 * refused (`off`) button: a refusal has its own sound.
 */
export function wireUiSounds(root: EventTarget, audio: ButtonSounds, signal?: AbortSignal, selector = BUTTON_SELECTOR): void {
  const find = (t: EventTarget | null): HTMLElement | null => {
    const el = t instanceof Element ? (t.closest(selector) as HTMLElement | null) : null;
    if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('off')) return null;
    return el;
  };
  // The element the pointer was last seen over. Chromium sends `pointerrawupdate` the moment the mouse moves, while
  // `pointerover` waits for the next frame (median 7 ms, often 20 ms), so the raw update sounds the hover first and the
  // `pointerover` that follows for the same element is skipped; other browsers use `pointerover` alone.
  let over: Element | null = null;
  const moveTo = (t: EventTarget | null, from?: EventTarget | null): void => {
    const el = t instanceof Element ? t : null;
    if (el === over) return;
    const prev = from !== undefined ? from : over;
    over = el;
    const btn = find(el);
    // Only coming onto the button from outside it: not from its parts, and not from a button inside it.
    if (btn && !btn.contains(prev as Node | null)) audio.play('hover');
  };
  root.addEventListener('pointerrawupdate', (e) => moveTo(e.target), { signal });
  root.addEventListener('pointerover', (e) => moveTo(e.target, (e as PointerEvent).relatedTarget), { signal });
  root.addEventListener('click', (e) => find(e.target) && audio.play('click'), { signal });
}
