/**
 * The one source of the controls table and the basics (MENU-14): How to play, the F1 overlay (UI-18) and the
 * loading-screen tip (UI-19) all read it. Every binding here is one the game handles (src/game.ts, src/ui/controls.ts).
 */
export interface ControlRow {
  /** The mouse action or key, e.g. "F, then right-click". */
  input: string;
  action: string;
}
export interface ControlGroup {
  title: string;
  rows: readonly ControlRow[];
}

export const CONTROLS: readonly ControlGroup[] = [
  {
    title: 'Mouse',
    rows: [
      { input: 'Left-click', action: 'Select a unit or building' },
      { input: 'Drag', action: 'Box-select your units' },
      { input: 'Shift + click', action: 'Add to or remove from the selection' },
      { input: 'Double-click a unit', action: 'Select every unit of its kind on screen' },
      { input: 'Right-click', action: 'Move, attack or gather; with a building selected, set its rally point' },
      { input: 'F, then right-click', action: 'Attack-move (left-click or Esc cancels)' },
      { input: 'Minimap click', action: 'Left moves the camera, right gives an order' },
    ],
  },
  {
    title: 'Selection and orders',
    rows: [
      { input: 'E', action: 'Select every unit of the selected kind (twice: centre on them)' },
      { input: 'Q', action: 'Select your army (twice: centre on it)' },
      { input: 'Ctrl + 1-9', action: 'Save the selection as a group; 1-9 recalls it (twice: centre)' },
      { input: 'Z', action: 'Stop' },
      { input: 'X', action: 'Scatter' },
    ],
  },
  {
    title: 'Building',
    rows: [
      { input: 'Click a build button', action: 'Queue it; click a finished structure again to place it' },
      { input: 'Ctrl + click', action: 'Queue five' },
      { input: 'Right-click a button', action: 'Cancel one (Ctrl: five)' },
    ],
  },
  {
    title: 'Camera',
    rows: [
      { input: 'W A S D, arrows, screen edges', action: 'Scroll the map' },
      { input: 'Mouse wheel', action: 'Zoom' },
      { input: 'Space', action: 'Centre on the selection' },
      { input: 'H', action: 'Go to your base' },
    ],
  },
  {
    title: 'Game',
    rows: [
      { input: 'F1', action: 'Show or hide this help' },
      { input: 'Esc', action: 'Cancel placing, targeting or attack-move; otherwise the game menu' },
      { input: 'P', action: 'Pause (single-player)' },
      { input: '+ / -', action: 'Game speed (single-player)' },
      { input: 'M', action: 'Mute all sound' },
      { input: 'F2', action: 'Graphics quality, High or Low' },
      { input: 'F11', action: 'Full screen (keeps Ctrl + W from closing the tab)' },
    ],
  },
];

/** The six basics (MENU-14). */
export const BASICS: readonly string[] = [
  'Shards are your credits: build a base, then send haulers to gather them and bring them home.',
  'Buildings and weapons run on the power grid: keep production above demand, or everything slows down.',
  'Build up the tiers: new structures unlock stronger units, so expand your tech as your income grows.',
  'Heroes are your strongest units: protect them, and use them to break the enemy line.',
  'Superweapons charge up and then devastate an area: build one, and watch for the enemy countdown.',
  'You win by destroying every enemy structure; lose your own and the match is over.',
];

/** The top bar text (UI-18): the F1 hint, then the game speed or, online, the room code. */
export function topBarText(o: { room?: string; speed: number }): string {
  return o.room ? `F1 Help · room ${o.room}` : `F1 Help · ×${o.speed}`;
}

/** The loading tip: one of the basics, chosen by `n` (UI-19). */
export const tipOf = (n: number): string => BASICS[((Math.floor(n) % BASICS.length) + BASICS.length) % BASICS.length]!;

const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The Controls table as HTML. */
export function controlsHtml(): string {
  return `<table class="controls"><tbody>${CONTROLS.map((g) => `<tr class="grp"><th colspan="2">${esc(g.title)}</th></tr>${g.rows.map((r) => `<tr><td class="keys">${esc(r.input)}</td><td>${esc(r.action)}</td></tr>`).join('')}`).join('')}</tbody></table>`;
}

/** The Basics as an ordered list. */
export const basicsHtml = (): string => `<ol class="basics">${BASICS.map((b) => `<li>${esc(b)}</li>`).join('')}</ol>`;
