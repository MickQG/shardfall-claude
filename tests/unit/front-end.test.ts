import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../../src/audio/engine';
import { BASICS, CONTROLS, controlsHtml, tipOf, topBarText } from '../../src/ui/controlsHelp';
import { defaultSettings, loadSettings, saveSettings } from '../../src/ui/settings';
import { CONTRAST_PAIRS, contrast, FONT_BODY, FONT_HEAD, SKINS, themeCss, tokenOf, wordmarkSvg, type SkinId } from '../../src/ui/theme';

const store = (init: Record<string, string> = {}): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; mem: Map<string, string> } => {
  const mem = new Map(Object.entries(init));
  return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), mem };
};

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));

describe('front-end and HUD', () => {
  it('MENU-8: the wordmark is flat inline SVG named Shardfall, with a two-polygon emblem and two clipped text copies, no gradient or filter', () => {
    const svg = wordmarkSvg();
    expect(svg).toMatch(/^<svg[^>]*role="img"[^>]*aria-label="Shardfall"/);
    expect((svg.match(/<polygon /g) ?? []).length - (svg.match(/<clipPath[^>]*><polygon /g) ?? []).length).toBe(2);
    expect((svg.match(/<text /g) ?? []).length).toBe(2);
    expect((svg.match(/<clipPath /g) ?? []).length).toBe(2);
    expect((svg.match(/clip-path="url\(#/g) ?? []).length).toBe(2);
    expect(svg).toContain('SHARD');
    expect(svg).not.toMatch(/linearGradient|radialGradient|filter|stroke/i);
    expect(svg).toContain('var(--font-head)');
    expect(svg).not.toMatch(/<image|href=|url\(['"]?data:/);
    expect(wordmarkSvg('a')).toContain('id="a-up"');
    expect(wordmarkSvg('a')).not.toContain('id="wm-up"');
  });

  it('MENU-9: headings use the condensed stack, body text the Segoe stack, and the build adds no font files', () => {
    expect(FONT_HEAD).toBe("'Bahnschrift', 'DIN Condensed', 'DIN Alternate', 'Roboto Condensed', 'Arial Narrow', sans-serif");
    expect(FONT_BODY).toBe("'Bahnschrift', 'Segoe UI', system-ui, sans-serif");
    expect(themeCss()).toContain('font-stretch: 87.5%');
    expect(themeCss()).not.toContain('@font-face');
    for (const dir of ['src', 'public']) expect(files(dir).filter((f) => /\.(woff2?|ttf|otf|eot)$/i.test(f))).toEqual([]);
  });

  it('MENU-11: the menu panel is a translucent glass column with a maximum width', () => {
    for (const skin of ['human', 'alien'] as const) expect(SKINS[skin]['--glass']).toMatch(/rgba\(.*,\s*\.[0-9]+\)/);
  });

  it('MENU-12 UI-16: both skins set the same tokens, and each carries its faction identity', () => {
    expect(Object.keys(SKINS.alien).sort()).toEqual(Object.keys(SKINS.human).sort());
    expect(SKINS.human['--accent']).toBe('#6fd3ff');
    expect(SKINS.alien['--accent']).toBe('#b6ff5c');
    expect(SKINS.alien['--accent-2']).toBe('#e0a43a');
    // Aegis: chamfered corners and a 1 px top bevel; Vrax: asymmetric rounding and a faint inner glow.
    expect(SKINS.human['--clip']).toContain('polygon(10px 0');
    expect(SKINS.human['--frame-shadow']).toBe('inset 0 1px 0 var(--edge-hi)');
    expect(SKINS.alien['--r']).toBe('18px 6px 18px 6px');
    expect(SKINS.alien['--frame-shadow']).toBe('inset 0 0 14px rgba(182,255,92,.10)');
    expect(SKINS.human['--edge']).toBe('#3d5b76');
    expect(SKINS.alien['--edge-hi']).toBe('#8c9a4a');
    // The theme scopes each skin by the data-faction attribute of a skinned root.
    expect(themeCss()).toContain('.skin[data-faction="human"]');
    expect(themeCss()).toContain('.skin[data-faction="alien"]');
  });

  it('MENU-12 UI-16: no glow in the skins or the theme has a shadow alpha above 0.3', () => {
    const css = themeCss() + Object.values(SKINS).flatMap((s) => Object.values(s)).join(' ');
    for (const m of css.matchAll(/(?:box-shadow|text-shadow|--frame-shadow)[^;]*rgba\([^)]*,\s*(\.?[0-9.]+)\)/g)) expect(Number(m[1])).toBeLessThanOrEqual(0.3);
  });

  it('MENU-14: the controls table covers every binding and the basics are six points, from one source', () => {
    const inputs = CONTROLS.flatMap((g) => g.rows.map((r) => r.input)).join(' | ');
    for (const key of ['Left-click', 'Drag', 'Right-click', 'F, then right-click', 'E', 'Q', 'Z', 'X', 'Ctrl + 1-9', 'W A S D', 'Mouse wheel', 'P', '+ / -', 'M', 'F2', 'Esc', 'F1']) expect(inputs, key).toContain(key);
    expect(BASICS).toHaveLength(6);
    expect(BASICS.join(' ')).toMatch(/shards[\s\S]*power[\s\S]*tiers[\s\S]*[Hh]eroes[\s\S]*[Ss]uperweapons[\s\S]*win/i);
    expect(controlsHtml().match(/<td class="keys">/g)).toHaveLength(CONTROLS.flatMap((g) => g.rows).length);
  });

  it('MENU-15: settings v3 adds music on and music volume; settings saved before keep mute and volume with Music on at the default volume', () => {
    expect(defaultSettings()).toMatchObject({ musicOn: true, musicVolume: 0.6, muted: false, volume: 0.6 });
    const v2 = store({ 'shardfall.settings.v2': JSON.stringify({ quality: 'low', muted: true, volume: 0.25 }) });
    expect(loadSettings(v2)).toMatchObject({ quality: 'low', muted: true, volume: 0.25, musicOn: true, musicVolume: 0.6 });
    const v1 = store({ 'shardfall.settings.v1': JSON.stringify({ muted: true, volume: 0.3 }) });
    expect(loadSettings(v1)).toMatchObject({ quality: 'high', muted: true, volume: 0.3, musicOn: true, musicVolume: 0.6 });
    const v3 = store();
    saveSettings(v3, { ...defaultSettings(), musicOn: false, musicVolume: 0.2, volume: 0.9 });
    expect([...v3.mem.keys()]).toEqual(['shardfall.settings.v3']);
    expect(loadSettings(v3)).toMatchObject({ musicOn: false, musicVolume: 0.2, volume: 0.9 });
    expect(loadSettings(store({ 'shardfall.settings.v3': JSON.stringify({ musicOn: 'yes', musicVolume: 4 }) }))).toMatchObject({ musicOn: true, musicVolume: 0.6 });
  });

  it('MENU-15 AUD-3: the music controls never throw where audio does not exist', () => {
    const e = new AudioEngine();
    expect(() => {
      e.setMusicOn(false);
      e.setMusicVolume(5);
      e.unlock();
      e.startMusic(2, true);
      e.setMusicOn(true);
      e.stopMusic();
    }).not.toThrow();
    expect(e.musicVolume).toBe(1);
    expect(e.musicOn).toBe(true);
  });

  it('UI-18: the top bar names F1 Help and the speed, or the room code online, and no other keys', () => {
    expect(topBarText({ speed: 0.8 })).toBe('F1 Help · ×0.8');
    expect(topBarText({ speed: 0.8, room: 'ABC234' })).toBe('F1 Help · room ABC234');
    expect(topBarText({ speed: 2 })).not.toMatch(/Esc|pause|mute|F2|quality/i);
  });

  it('UI-19: the loading tip is always one of the Basics', () => {
    for (const n of [0, 1, 5, 6, 12345, -3, 1.7e12]) expect(BASICS).toContain(tipOf(n));
    expect(new Set([0, 1, 2, 3, 4, 5].map(tipOf)).size).toBe(6);
  });

  it('UI-21: every menu and HUD text colour reaches 4.5:1 (3:1 for large headings) on its background, in both skins', () => {
    expect(CONTRAST_PAIRS.length).toBeGreaterThan(20);
    for (const skin of ['human', 'alien'] as SkinId[]) {
      for (const p of CONTRAST_PAIRS) {
        const ratio = contrast(tokenOf(skin, p.fg), tokenOf(skin, p.bg));
        expect(ratio, `${skin}: ${p.fg} on ${p.bg}`).toBeGreaterThanOrEqual(p.large ? 3 : 4.5);
      }
    }
    // The helper follows WCAG: black on white is 21:1, equal colours 1:1.
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#6fd3ff', '#6fd3ff')).toBeCloseTo(1, 5);
  });
});
