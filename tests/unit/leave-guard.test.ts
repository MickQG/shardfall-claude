import { describe, expect, it } from 'vitest';
import { blockedBrowserKey, isDesktop, leaveGuard, nextFullscreenChoice, shouldRestoreFullscreen, type LeaveState } from '../../src/ui/leaveGuard';
import { defaultSettings, loadSettings, saveSettings } from '../../src/ui/settings';
import { controlsHtml } from '../../src/ui/controlsHelp';

const running: LeaveState = { shown: true, over: false, online: false, flying: false, desktop: false, leaving: false };

describe('leaving a running match (CTL-19)', () => {
  it('CTL-19: a single-player match in play asks for confirmation and is paused', () => {
    expect(leaveGuard(running)).toEqual({ confirm: true, pause: true });
  });
  it('CTL-19: during the fly-in it asks for confirmation and pauses nothing more', () => {
    expect(leaveGuard({ ...running, flying: true })).toEqual({ confirm: true, pause: false });
  });
  it('CTL-19: an online match asks for confirmation and is never paused (NET-2)', () => {
    expect(leaveGuard({ ...running, online: true })).toEqual({ confirm: true, pause: false });
  });
  it('CTL-19: nothing is asked before the battlefield is shown, after the result shows, when leaving on purpose, or in the desktop app', () => {
    const none = { confirm: false, pause: false };
    expect(leaveGuard({ ...running, shown: false })).toEqual(none);
    expect(leaveGuard({ ...running, over: true })).toEqual(none);
    expect(leaveGuard({ ...running, leaving: true })).toEqual(none);
    expect(leaveGuard({ ...running, desktop: true })).toEqual(none);
    expect(leaveGuard({ ...running, online: true, desktop: true })).toEqual(none);
  });
  it('CTL-19: the desktop app is told apart by its protocol', () => {
    expect(isDesktop('app:')).toBe(true);
    expect(isDesktop('https:')).toBe(false);
    expect(isDesktop('http:')).toBe(false);
  });
});

describe('full screen (CTL-20, CTL-21)', () => {
  it('CTL-21: entering full screen is remembered, the player leaving it is forgotten, a navigation dropping it changes nothing', () => {
    expect(nextFullscreenChoice(false, 'entered')).toBe(true);
    expect(nextFullscreenChoice(true, 'left')).toBe(false);
    expect(nextFullscreenChoice(true, 'unloading')).toBe(true);
    expect(nextFullscreenChoice(false, 'unloading')).toBe(false);
  });
  it('CTL-21: a remembered choice puts the player back on the first key press or click, only where it can work', () => {
    const ok = { choice: true, desktop: false, supported: true, inFullscreen: false };
    expect(shouldRestoreFullscreen(ok)).toBe(true);
    expect(shouldRestoreFullscreen({ ...ok, choice: false })).toBe(false);
    expect(shouldRestoreFullscreen({ ...ok, desktop: true })).toBe(false);
    expect(shouldRestoreFullscreen({ ...ok, supported: false })).toBe(false);
    expect(shouldRestoreFullscreen({ ...ok, inFullscreen: true })).toBe(false);
  });
  it('CTL-21: a press on the full screen button does not restore first, so its click enters full screen instead of leaving it', () => {
    const ok = { choice: true, desktop: false, supported: true, inFullscreen: false };
    expect(shouldRestoreFullscreen({ ...ok, onButton: true })).toBe(false);
    expect(shouldRestoreFullscreen({ ...ok, onButton: false })).toBe(true);
  });
  it('CTL-21: the choice is stored with the other settings and is off by default', () => {
    expect(defaultSettings().fullscreen).toBe(false);
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveSettings(store, { ...defaultSettings(), fullscreen: true });
    expect(loadSettings(store).fullscreen).toBe(true);
  });
  it('CTL-20: Ctrl + W, T and N are the game\'s only under keyboard lock; the controls overlay lists F11', () => {
    for (const key of ['w', 't', 'n']) {
      expect(blockedBrowserKey({ ctrlKey: true, key }, true)).toBe(true);
      expect(blockedBrowserKey({ ctrlKey: true, key }, false)).toBe(false);
    }
    expect(controlsHtml()).toContain('F11');
  });
});

describe('browser shortcuts the game cancels (CTL-10)', () => {
  it('CTL-10: Ctrl + S, D and A are cancelled with or without keyboard lock', () => {
    for (const key of ['s', 'd', 'a', 'S', 'D', 'A']) {
      expect(blockedBrowserKey({ ctrlKey: true, key }, false)).toBe(true);
      expect(blockedBrowserKey({ ctrlKey: true, key }, true)).toBe(true);
    }
  });
  it('CTL-10: the same keys without Ctrl, and other Ctrl keys, are left alone', () => {
    for (const key of ['s', 'd', 'a', 'w']) expect(blockedBrowserKey({ ctrlKey: false, key }, true)).toBe(false);
    expect(blockedBrowserKey({ ctrlKey: true, key: '1' }, false)).toBe(false);
  });
});
