/** What the button sounds need from the audio engine. */
interface ButtonSounds {
  play(name: 'hover' | 'click'): void;
}

/** Everything a pointer can press in the menu and the HUD. */
export const BUTTON_SELECTOR = 'button, [data-mode], [data-faction], [data-diff], [data-pers], [data-map], [data-quality], #go';

/**
 * UI sounds (AUD-11): a quiet tick when the pointer enters a button and a short click when it is pressed. One delegated
 * pair of listeners on `root` serves every button, however it is created. A disabled or refused (`off`) button is
 * silent here: a refusal has its own sound.
 */
export function wireUiSounds(root: EventTarget, audio: ButtonSounds, signal?: AbortSignal, selector = BUTTON_SELECTOR): void {
  const find = (t: EventTarget | null): HTMLElement | null => {
    const el = t instanceof Element ? (t.closest(selector) as HTMLElement | null) : null;
    // The menu root carries the skin's data-faction: it is not a button.
    if (!el || el === root || (el as HTMLButtonElement).disabled || el.classList.contains('off')) return null;
    return el;
  };
  root.addEventListener(
    'pointerover',
    (e) => {
      const el = find(e.target);
      // Moving between children of one button is not entering it again.
      if (el && find((e as PointerEvent).relatedTarget) !== el) audio.play('hover');
    },
    { signal },
  );
  root.addEventListener('click', (e) => find(e.target) && audio.play('click'), { signal });
}
