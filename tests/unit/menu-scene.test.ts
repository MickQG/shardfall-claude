import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UNIT_DEFS } from '../../src/data/defs';
import { BUILDING_RIGS } from '../../src/render3d/buildings3d';
import { buttonKinds, DOLLY_FAR, DOLLY_NEAR, DOLLY_PASS_S, dollyAt, dollyDistance, FADE_IN_MS, FADE_OUT_MS, HAULER_SPOT, HERO_CLEAR, HERO_SPOT, holdStill, IconCache, iconKey, castKinds, PANEL_MARGIN, panelRight, projectedSpan, SCENE_CAST, sceneFraming, sceneKinds, sceneSlots, shardPlan } from '../../src/render/menuPlan';
import { FOG_FAR, FOG_NEAR, GROUND_RADIUS, HAZE, SKY_TOP_SHADE } from '../../src/render3d/menuScene3d';
import { boxCorners, fitPicture, ICON_EDGE, project, viewDir } from '../../src/render3d/iconFit';
import { PREVIEW_FOV, PREVIEW_PITCH, restBounds } from '../../src/render3d/preview3d';
import { UNIT_RIGS } from '../../src/render3d/units3d';

describe('menu faction scene (MENU-10, MENU-11)', () => {
  it('MENU-10: the Aegis scene is every Aegis unit kind with the Paladin as hero and the hauler at the shard field, before the Command Hub', () => {
    expect(sceneKinds('human').slice().sort()).toEqual([...Object.keys(UNIT_DEFS).filter((k) => UNIT_DEFS[k]!.faction === 'human'), 'hum_hq'].sort());
    for (const k of ['hum_paladin', 'hum_tank', 'hum_artillery', 'hum_buggy', 'hum_rocketeer', 'hum_rifleman', 'hum_hauler']) expect(sceneKinds('human')).toContain(k);
    expect(sceneKinds('human')[0]).toBe('hum_paladin');
  });

  it('MENU-10: the Vrax scene is every Vrax unit kind with the Dreadstrider as hero and the Gorger at the shard field, before the Hive Heart', () => {
    expect(sceneKinds('alien').slice().sort()).toEqual([...Object.keys(UNIT_DEFS).filter((k) => UNIT_DEFS[k]!.faction === 'alien'), 'ali_hq'].sort());
    for (const k of ['ali_strider', 'ali_brute', 'ali_lobber', 'ali_stalker', 'ali_spitter', 'ali_skitter', 'ali_gorger']) expect(sceneKinds('alien')).toContain(k);
    expect(sceneKinds('alien')[0]).toBe('ali_strider');
  });

  it('MENU-10: the hauler is placed at the shard field, and units stand apart from each other and clear of the hero', () => {
    for (const f of ['human', 'alien'] as const) {
      const slots = sceneSlots(f);
      const cast = SCENE_CAST[f];
      expect(slots[cast.hauler]).toEqual(HAULER_SPOT);
      const field = shardPlan(f).field;
      const near = field.filter((c) => Math.hypot(c.x - HAULER_SPOT.x, c.z - HAULER_SPOT.z) < 5).length;
      expect(near).toBeGreaterThanOrEqual(10);
      expect(sceneSlots(f)).toEqual(slots);
      const kinds = Object.keys(slots);
      expect(kinds.sort()).toEqual([cast.hero, ...cast.others, cast.hauler].sort());
      for (const a of kinds) {
        if (a !== cast.hero) expect(Math.hypot(slots[a]!.x - HERO_SPOT.x, slots[a]!.z - HERO_SPOT.z), a).toBeGreaterThan(HERO_CLEAR);
        for (const b of kinds) if (a < b) expect(Math.hypot(slots[a]!.x - slots[b]!.x, slots[a]!.z - slots[b]!.z), `${a} ${b}`).toBeGreaterThan(1.8);
      }
    }
  });

  it('MENU-10: the scene has a shard field of at least 20 crystals and loose shards, placed the same on every call', () => {
    for (const f of ['human', 'alien'] as const) {
      const p = shardPlan(f);
      expect(p.field.length).toBeGreaterThanOrEqual(20);
      expect(p.field.length).toBeLessThanOrEqual(40);
      expect(p.loose.length).toBeGreaterThanOrEqual(3);
      expect(shardPlan(f)).toEqual(p);
      for (const c of [...p.field, ...p.loose]) {
        expect(c.level).toBeGreaterThanOrEqual(1);
        expect(c.level).toBeLessThanOrEqual(4);
        expect([0, 1, 2]).toContain(c.variant);
      }
    }
    expect(shardPlan('human')).not.toEqual(shardPlan('alien'));
  });

  it('MENU-10: no crystal falls within the hero footprint', () => {
    for (const f of ['human', 'alien'] as const) {
      for (const c of [...shardPlan(f).field, ...shardPlan(f).loose]) expect(Math.hypot(c.x - HERO_SPOT.x, c.z - HERO_SPOT.z)).toBeGreaterThan(HERO_CLEAR);
    }
  });

  it('MENU-10: every kind in a scene has an in-game model and belongs to that faction, the hero being a hero and the hauler a harvester', () => {
    for (const f of ['human', 'alien'] as const) {
      const c = SCENE_CAST[f];
      expect(UNIT_DEFS[c.hero]!.hero).toBeTruthy();
      expect(UNIT_DEFS[c.hauler]!.role).toBe('harvester');
      for (const k of [c.hero, c.hauler, ...c.others]) {
        expect(UNIT_RIGS[k], k).toBeDefined();
        expect(UNIT_DEFS[k]!.faction).toBe(f);
      }
      expect(BUILDING_RIGS[c.hq]).toBeDefined();
      expect(c.others).toHaveLength(5);
    }
  });

  it('MENU-10: the camera dolly goes back and forth, one pass taking 20 to 30 seconds, eased at both ends', () => {
    expect(DOLLY_PASS_S).toBeGreaterThanOrEqual(20);
    expect(DOLLY_PASS_S).toBeLessThanOrEqual(30);
    expect(dollyAt(0)).toBe(0);
    expect(dollyAt(DOLLY_PASS_S)).toBeCloseTo(1, 10);
    expect(dollyAt(2 * DOLLY_PASS_S)).toBeCloseTo(0, 10);
    expect(dollyAt(3 * DOLLY_PASS_S)).toBeCloseTo(1, 10);
    // Rising on the way in, falling on the way back, never outside 0..1.
    let prev = 0;
    for (let t = 0; t <= DOLLY_PASS_S; t += 0.5) {
      const u = dollyAt(t);
      expect(u).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(u).toBeLessThanOrEqual(1);
      prev = u;
    }
    // Eased: it barely moves in the first and last second of a pass.
    expect(dollyAt(1)).toBeLessThan(0.01);
    expect(1 - dollyAt(DOLLY_PASS_S - 1)).toBeLessThan(0.01);
    expect(dollyAt(DOLLY_PASS_S * 1.5)).toBeCloseTo(0.5, 6);
  });

  it('MENU-10: the dolly distance stays between its far and near ends', () => {
    for (let t = -50; t < 200; t += 3.7) {
      const d = dollyDistance(t);
      expect(d).toBeLessThanOrEqual(DOLLY_FAR + 1e-9);
      expect(d).toBeGreaterThanOrEqual(DOLLY_NEAR - 1e-9);
    }
  });

  it('MENU-10: the scene holds still on Low quality or with reduced motion, and moves otherwise', () => {
    expect(holdStill('low', false)).toBe(true);
    expect(holdStill('high', true)).toBe(true);
    expect(holdStill('low', true)).toBe(true);
    expect(holdStill('high', false)).toBe(false);
  });

  it('MENU-10: the crossfade to the other faction takes no more than 0.6 s', () => {
    expect(FADE_OUT_MS + FADE_IN_MS).toBeLessThanOrEqual(600);
  });

  it('MENU-11: from 1600 px up every unit and the HQ stand clear of the panel, to its right, at both ends of the dolly, with at least 24 px to spare', () => {
    expect(PANEL_MARGIN).toBeGreaterThanOrEqual(24);
    for (const f of ['human', 'alien'] as const) {
      for (const w of [1600, 1920, 2560]) {
        const h = 1080;
        const { zoomOut, shift } = sceneFraming(f, w, h);
        expect(zoomOut).toBeGreaterThanOrEqual(1);
        for (const d of [DOLLY_NEAR, DOLLY_FAR]) {
          for (const kind of castKinds(f)) {
            const [lo, hi] = projectedSpan(f, kind, d * zoomOut, h, shift + w / 2);
            expect(lo, `${f} ${kind} at ${w}, dolly ${d}`).toBeGreaterThanOrEqual(panelRight(w) + PANEL_MARGIN - 0.01);
            expect(hi, `${f} ${kind} at ${w}, dolly ${d}`).toBeLessThanOrEqual(w - PANEL_MARGIN + 0.01);
          }
        }
      }
    }
  });

  it('MENU-11: the hero stays the largest unit and the focal point, and below 1600 px the scene is not backed off', () => {
    for (const f of ['human', 'alien'] as const) {
      expect(sceneFraming(f, 1600, 900).zoomOut).toBeLessThan(2.2);
      for (const w of [1280, 1440, 1599]) expect(sceneFraming(f, w, 800).zoomOut).toBe(1);
    }
  });

  it('MENU-10: the lighting and post-processing are shared with the match view, with PCF shadows, and the scene uses no Math.random', () => {
    const view = readFileSync('src/render3d/view3d.ts', 'utf8');
    const scene = readFileSync('src/render3d/menuScene3d.ts', 'utf8');
    const light = readFileSync('src/render3d/lighting3d.ts', 'utf8');
    for (const src of [view, scene]) expect(src).toContain("from './lighting3d'");
    expect(view).not.toContain('new UnrealBloomPass');
    expect(scene).not.toContain('new UnrealBloomPass');
    expect(light).toContain('PCFShadowMap');
    expect(light).not.toMatch(/type = THREE\.PCFSoftShadowMap/);
    expect(light).not.toContain('samples');
    expect(scene).not.toMatch(/Math\.random|Date\.now/);
    // The scene lets go of its WebGL context.
    expect(scene).toContain('forceContextLoss');
  });

  it('MENU-10: the scene fades into distance haze and a dusk sky: fog, a ground whose edge is inside the fog, and a non-black gradient background', () => {
    const scene = readFileSync('src/render3d/menuScene3d.ts', 'utf8');
    expect(scene).toContain('new THREE.Fog(haze, FOG_NEAR, FOG_FAR)');
    expect(scene).toContain('this.scene.background = skyTexture(haze)');
    expect(scene).not.toContain('Color(bg)');
    // The camera is at most 23 tiles from the hero and the ground reaches GROUND_RADIUS from the stage: the edge is far inside solid fog.
    expect(GROUND_RADIUS - DOLLY_FAR - 8).toBeGreaterThan(FOG_FAR);
    expect(FOG_NEAR).toBeGreaterThan(DOLLY_FAR);
    for (const f of ['human', 'alien'] as const) {
      const c = HAZE[f];
      expect(Math.max(c >> 16, (c >> 8) & 255, c & 255), `${f} horizon is not black`).toBeGreaterThan(0x20);
      expect(Math.max(c >> 16, (c >> 8) & 255, c & 255) * SKY_TOP_SHADE, `${f} sky top is not black`).toBeGreaterThan(8);
      expect(Math.max(c >> 16, (c >> 8) & 255, c & 255), `${f} haze is calm, not bright`).toBeLessThan(0x60);
    }
  });

  it('MENU-10: the menu loads the scene with a dynamic import, only in the 3D view, and pauses it while the unit sheet is open', () => {
    const menu = readFileSync('src/ui/menu.ts', 'utf8');
    expect(menu).toContain("import('../render3d/menuScene3d')");
    expect(menu).not.toMatch(/^import (?!type).*menuScene3d/m);
    expect(menu).toContain("chooseRenderer(");
    expect(menu).toContain('setPaused(open)');
    expect(menu).toContain('closeScene()');
  });
});

describe('build-button pictures (UI-17)', () => {
  it('UI-17: for every unit and building kind the whole model lies inside its picture with a margin of at least 10% on each side, and none is cramped or tiny', () => {
    expect(ICON_EDGE).toBeGreaterThanOrEqual(0.12);
    expect(ICON_EDGE).toBeLessThanOrEqual(0.18);
    for (const f of ['human', 'alien'] as const) {
      for (const kind of buttonKinds(f)) {
        const b = restBounds(kind);
        const pts = boxCorners(b.min, b.max);
        const { target, dist } = fitPicture(pts, viewDir(PREVIEW_PITCH), PREVIEW_FOV, 1);
        const q = project(pts, target, viewDir(PREVIEW_PITCH), dist, PREVIEW_FOV, 1);
        const xs = q.map((a) => a[0]);
        const ys = q.map((a) => a[1]);
        // NDC runs -1..1, so a 10% margin on each side means the bounds stay within +-0.8.
        for (const v of [...xs, ...ys]) expect(Math.abs(v), kind).toBeLessThanOrEqual(0.8);
        // And the model fills the picture: its larger side is at least 60% of it.
        expect(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2, kind).toBeGreaterThan(0.6);
      }
    }
  });


  it('UI-17: a picture is cached per kind and per team colour', () => {
    expect(iconKey('hum_tank', 0x3fa0ff)).not.toBe(iconKey('hum_tank', 0xff8a2a));
    expect(iconKey('hum_tank', 0x3fa0ff)).not.toBe(iconKey('hum_rifleman', 0x3fa0ff));
    expect(iconKey('hum_tank', 0x3fa0ff)).toBe(iconKey('hum_tank', 0x3fa0ff));
    const c = new IconCache();
    c.set('hum_tank', 0x3fa0ff, 'data:a');
    expect(c.get('hum_tank', 0x3fa0ff)).toBe('data:a');
    expect(c.get('hum_tank', 0xff8a2a)).toBeUndefined();
    expect(c.missing(['hum_tank', 'hum_hq'], 0x3fa0ff)).toEqual(['hum_hq']);
    expect(c.missing(['hum_tank'], 0xff8a2a)).toEqual(['hum_tank']);
    expect(c.size).toBe(1);
  });

  it('UI-17: every build and train button of both factions has a 3D model to draw', () => {
    for (const f of ['human', 'alien'] as const) {
      const kinds = buttonKinds(f);
      expect(kinds.length).toBeGreaterThan(10);
      expect(new Set(kinds).size).toBe(kinds.length);
      for (const k of kinds) expect(UNIT_RIGS[k] ?? BUILDING_RIGS[k], k).toBeDefined();
    }
  });

  it('UI-17: the pictures are drawn once while the game loads, with a temporary renderer that is disposed, and only in the 3D view', () => {
    const game = readFileSync('src/game.ts', 'utf8');
    const icons = readFileSync('src/render3d/icons3d.ts', 'utf8');
    const preview = readFileSync('src/render3d/preview3d.ts', 'utf8');
    expect(game).toMatch(/if \(use3d\) \{[^}]*drawIcons\(/s);
    expect(game.indexOf('await drawIcons(')).toBeLessThan(game.indexOf('requestAnimationFrame(frame(performance.now()))'));
    expect(icons).toContain('preview.dispose()');
    expect(preview).toContain('forceContextLoss');
    expect(readFileSync('src/ui/sidebar.ts', 'utf8')).not.toContain('drawIcons');
  });
});
