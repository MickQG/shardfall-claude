/** Full screen with Keyboard Lock (CTL-20). Everything is feature-detected; the lock is Chromium only. */

interface KeyboardLockApi {
  lock(keyCodes?: string[]): Promise<void>;
  unlock(): void;
}
const keyboardApi = (): KeyboardLockApi | undefined => (navigator as Navigator & { keyboard?: KeyboardLockApi }).keyboard;

export const fullscreenSupported = (): boolean => document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === 'function';
export const inFullscreen = (): boolean => document.fullscreenElement !== null;

/** Hands every key to the page (no argument, so Esc reaches the game too). A refusal is harmless: CTL-19 still protects. */
export function lockKeyboard(): void {
  try {
    void keyboardApi()
      ?.lock()
      ?.catch(() => undefined);
  } catch {
    /* not supported */
  }
}
export function unlockKeyboard(): void {
  try {
    keyboardApi()?.unlock();
  } catch {
    /* not supported */
  }
}

/** Enters full screen and takes the keyboard; needs a key press or click. */
export async function enterFullscreen(): Promise<void> {
  if (!fullscreenSupported() || inFullscreen()) return;
  try {
    await document.documentElement.requestFullscreen();
    lockKeyboard();
  } catch {
    /* refused: no user gesture, or blocked */
  }
}

export async function leaveFullscreen(): Promise<void> {
  unlockKeyboard();
  if (!inFullscreen()) return;
  try {
    await document.exitFullscreen();
  } catch {
    /* already out */
  }
}
