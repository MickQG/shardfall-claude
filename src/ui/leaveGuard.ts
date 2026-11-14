/**
 * Leaving a match by accident (CTL-19), full screen with the keyboard kept (CTL-20) and remembered (CTL-21), and the
 * browser shortcuts the game cancels (CTL-10). The decisions are pure; game.ts wires them to the page.
 */

export interface LeaveState {
  /** The battlefield has been shown. */
  shown: boolean;
  /** The result screen shows. */
  over: boolean;
  online: boolean;
  /** The fly-in is playing: the game is already held. */
  flying: boolean;
  /** The desktop app (Electron): no dialog, and an unanswered one makes the window impossible to close. */
  desktop: boolean;
  /** The player is leaving through one of the game's own buttons. */
  leaving: boolean;
}

/** Whether to ask the browser to confirm the page going away, and whether the game is paused first (CTL-19). */
export function leaveGuard(s: LeaveState): { confirm: boolean; pause: boolean } {
  const confirm = s.shown && !s.over && !s.desktop && !s.leaving;
  return { confirm, pause: confirm && !s.online && !s.flying };
}

/** The desktop app is served from the `app:` protocol (see multiplayerStatus). */
export const isDesktop = (protocol: string): boolean => protocol === 'app:';

let leaving = false;
/** Whether the player is on the way out through the game's own buttons. */
export const isLeaving = (): boolean => leaving;
/** Leave on purpose (Quit to menu, Play again, ...): switches the guard off, then navigates. */
export function leaveOnPurpose(go: () => void): void {
  leaving = true;
  go();
}

/** What happened to full screen, for the remembered choice (CTL-21). */
export type FullscreenEvent = 'entered' | 'left' | 'unloading';

/** The remembered full screen choice after an event: entering sets it, the player leaving clears it, a navigation dropping it leaves it (CTL-21). */
export function nextFullscreenChoice(choice: boolean, ev: FullscreenEvent): boolean {
  return ev === 'entered' ? true : ev === 'left' ? false : choice;
}

/**
 * Whether a key press or click should put the player back in full screen (CTL-21). A press on the full screen button
 * itself does not: its click toggles, and a restore just before it would turn "enter" into "leave".
 */
export function shouldRestoreFullscreen(o: { choice: boolean; desktop: boolean; supported: boolean; inFullscreen: boolean; onButton?: boolean }): boolean {
  return o.choice && !o.desktop && o.supported && !o.inFullscreen && !o.onButton;
}

/** Browser shortcuts the game cancels while it has focus: Ctrl+S, D and A (they pan, CTL-10); under keyboard lock also Ctrl+W, T and N (CTL-20). */
export function blockedBrowserKey(e: { ctrlKey: boolean; key: string }, locked: boolean): boolean {
  if (!e.ctrlKey) return false;
  const k = e.key.toLowerCase();
  return k === 's' || k === 'd' || k === 'a' || (locked && (k === 'w' || k === 't' || k === 'n'));
}
