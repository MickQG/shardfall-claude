import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { UNIT_DEFS } from '../../src/data/defs';
import { BUILDING_RIGS } from '../../src/render3d/buildings3d';
import { buttonKinds, cameraAngle, castKinds, FADE_IN_MS, FADE_OUT_MS, FIELD_ANGLE, FIELD_ARC, FIELD_INNER, footprintOf, HERO_CLEAR, HQ_SPOT, holdStill, IconCache, iconKey, ORBIT_PERIOD_S, ORBIT_SAMPLES, orbitAngleAt, PANEL_MARGIN, panelRight, projectedSpan, RING_RADIUS, SCENE_CAST, sceneFraming, sceneKinds, sceneSlots, shardPlan, STILL_ANGLE } from '../../src/render/menuPlan';
import { CAMERA_MAX_DIST, FOG_FAR, FOG_NEAR, GROUND_RADIUS, HAZE, SKY_TOP_SHADE } from '../../src/render3d/menuScene3d';
import { fitPicture, ICON_EDGE, project, viewDir } from '../../src/render3d/iconFit';
import { fitPoints, PREVIEW_FOV, PREVIEW_PITCH, restFitPoints } from '../../src/render3d/preview3d';
import { UNIT_RIGS } from '../../src/render3d/units3d';

const heroAngle = (): number => {
  const s = sceneSlots('human')[SCENE_CAST.human.hero]!;
  return Math.atan2(s.z - HQ_SPOT.z, s.x - HQ_SPOT.x);
};

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

  it('MENU-10: the units stand in a ring around the HQ, hero included, the hauler at the shard field, spaced at least 2.5 tiles apart and clear of the HQ and the field', () => {
    for (const f of ['human', 'alien'] as const) {
      const cast = SCENE_CAST[f];
      const slots = sceneSlots(f);
      expect(sceneSlots(f)).toEqual(slots);
      const kinds = Object.keys(slots);
      expect(kinds.slice().sort()).toEqual([cast.hero, ...cast.others, cast.hauler].sort());
      const angleOf = (k: string): number => Math.atan2(slots[k]!.z - HQ_SPOT.z, slots[k]!.x - HQ_SPOT.x);
      const dAng = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
      // The hauler works the field: at its centre, with crystals all around it.
      expect(dAng(angleOf(cast.hauler), FIELD_ANGLE)).toBeLessThan(0.01);
      const field = shardPlan(f).field;
      expect(field.filter((c) => Math.hypot(c.x - slots[cast.hauler]!.x, c.z - slots[cast.hauler]!.z) < 4).length).toBeGreaterThanOrEqual(10);
      for (const k of kinds) {
        const r = Math.hypot(slots[k]!.x - HQ_SPOT.x, slots[k]!.z - HQ_SPOT.z);
        expect(r, k).toBeGreaterThan(4.3);
        expect(r, k).toBeLessThan(6.2);
        // Units face outward.
        expect(dAng(slots[k]!.heading, angleOf(k)), k).toBeLessThan(0.01);
        // Clear of the HQ footprint.
        expect(r - footprintOf(k), k).toBeGreaterThan(footprintOf(cast.hq) - 0.6);
        // Everyone but the hauler stands outside the field's arc.
        if (k !== cast.hauler) expect(dAng(angleOf(k), FIELD_ANGLE), k).toBeGreaterThan(FIELD_ARC / 2);
      }
      // Adjacent units around the ring (by angle) are at least 2.5 tiles apart.
      const ring = kinds.slice().sort((a, b) => angleOf(a) - angleOf(b));
      let minChord = Infinity;
      ring.forEach((a, i) => {
        const b = ring[(i + 1) % ring.length]!;
        minChord = Math.min(minChord, Math.hypot(slots[a]!.x - slots[b]!.x, slots[a]!.z - slots[b]!.z));
      });
      expect(minChord).toBeGreaterThanOrEqual(2.5);
      expect(RING_RADIUS).toBeGreaterThanOrEqual(4.5);
      expect(RING_RADIUS).toBeLessThanOrEqual(6);
      expect(FIELD_ARC * (180 / Math.PI)).toBeGreaterThanOrEqual(80);
      expect(FIELD_ARC * (180 / Math.PI)).toBeLessThanOrEqual(100);
      expect(FIELD_INNER).toBeGreaterThan(footprintOf(cast.hq));
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
      for (const c of [...shardPlan(f).field, ...shardPlan(f).loose]) expect(Math.hypot(c.x - sceneSlots(f)[SCENE_CAST[f].hero]!.x, c.z - sceneSlots(f)[SCENE_CAST[f].hero]!.z)).toBeGreaterThan(HERO_CLEAR);
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

  it('MENU-10: the camera circles the HQ once every 60 to 90 seconds at a constant angular speed and a constant heading change rate', () => {
    expect(ORBIT_PERIOD_S).toBeGreaterThanOrEqual(60);
    expect(ORBIT_PERIOD_S).toBeLessThanOrEqual(90);
    expect(orbitAngleAt(ORBIT_PERIOD_S) - orbitAngleAt(0)).toBeCloseTo(Math.PI * 2, 10);
    const rate = orbitAngleAt(1) - orbitAngleAt(0);
    expect(rate).toBeGreaterThan(0);
    for (let t = -30; t < 200; t += 3.3) expect(orbitAngleAt(t + 1) - orbitAngleAt(t)).toBeCloseTo(rate, 10);
    // The heading change (the camera's facing, opposite its position) turns at the same constant rate.
    for (let t = 0; t < 100; t += 7) {
      const h0 = Math.atan2(-Math.sin(orbitAngleAt(t)), -Math.cos(orbitAngleAt(t)));
      const h1 = Math.atan2(-Math.sin(orbitAngleAt(t + 0.5)), -Math.cos(orbitAngleAt(t + 0.5)));
      expect(Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)) / 0.5).toBeCloseTo(rate, 8);
    }
  });

  it('MENU-10: the scene holds still on Low quality or with reduced motion, and moves otherwise', () => {
    expect(holdStill('low', false)).toBe(true);
    expect(holdStill('high', true)).toBe(true);
    expect(holdStill('low', true)).toBe(true);
    expect(holdStill('high', false)).toBe(false);
    // Holding still, the camera stays at one flattering angle (hero in front) whatever the time; moving, it turns.
    for (const t of [0, 10, 100]) expect(cameraAngle(t, true)).toBe(STILL_ANGLE);
    expect(cameraAngle(10, false)).not.toBe(cameraAngle(0, false));
    expect(Math.abs(Math.sin(STILL_ANGLE - heroAngle())), 'hero stands in front of the camera').toBeLessThan(0.35);
  });

  it('MENU-10: the crossfade to the other faction takes no more than 0.6 s', () => {
    expect(FADE_OUT_MS + FADE_IN_MS).toBeLessThanOrEqual(600);
  });

  it('MENU-11: at 1920 and 2560 px wide, at 12 angles around the orbit, every unit stands right of the panel edge plus 16 px and inside the screen', () => {
    expect(PANEL_MARGIN).toBeGreaterThanOrEqual(16);
    for (const f of ['human', 'alien'] as const) {
      for (const [w, h] of [[1920, 1080], [2560, 1080]] as const) {
        const { dist, shift } = sceneFraming(f, w, h);
        expect(dist).toBeLessThanOrEqual(CAMERA_MAX_DIST);
        for (let i = 0; i < ORBIT_SAMPLES; i++) {
          for (const kind of castKinds(f)) {
            const [lo, hi] = projectedSpan(f, kind, (i / ORBIT_SAMPLES) * Math.PI * 2, dist, h);
            expect(lo + shift + w / 2, `${f} ${kind} at ${w}, angle ${i}`).toBeGreaterThanOrEqual(panelRight(w) + 16 - 0.01);
            expect(hi + shift + w / 2, `${f} ${kind} at ${w}, angle ${i}`).toBeLessThanOrEqual(w);
          }
        }
      }
    }
  });

  it('MENU-11: at 1600 px wide the HQ centre projects into the free strip right of the panel, and below 1600 px the scene is not framed to it', () => {
    for (const f of ['human', 'alien'] as const) {
      for (const [w, h] of [[1600, 900], [1680, 1050]] as const) {
        const { dist, shift } = sceneFraming(f, w, h);
        const [lo, hi] = projectedSpan(f, SCENE_CAST[f].hq, 0, dist, h);
        const centre = (lo + hi) / 2 + shift + w / 2;
        expect(centre, `${f} ${w}`).toBeGreaterThan(panelRight(w));
        expect(centre, `${f} ${w}`).toBeLessThan(w);
        expect(centre).toBeCloseTo((panelRight(w) + PANEL_MARGIN + w - PANEL_MARGIN) / 2, 0);
        expect(dist).toBeLessThanOrEqual(CAMERA_MAX_DIST);
      }
      // Below 1600 px the scene shows through the glass: a fixed distance for the height and the HQ right of centre.
      const narrow = sceneFraming(f, 1280, 720);
      expect(narrow.dist).toBeCloseTo(720 * 0.0323, 6);
      expect(narrow.shift).toBeGreaterThan(0);
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
    // The camera is at most CAMERA_MAX_DIST tiles from the HQ and the ground reaches GROUND_RADIUS from the stage: the edge is far inside solid fog.
    expect(GROUND_RADIUS - CAMERA_MAX_DIST - 8).toBeGreaterThan(FOG_FAR);
    expect(FOG_NEAR).toBeGreaterThan(CAMERA_MAX_DIST);
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
  it('UI-17: for every unit and building kind the whole model lies inside its picture with a margin of 3 to 9% on each side, and none is cramped or tiny', () => {
    expect(ICON_EDGE).toBeGreaterThanOrEqual(0.05);
    expect(ICON_EDGE).toBeLessThanOrEqual(0.06);
    for (const f of ['human', 'alien'] as const) {
      for (const kind of buttonKinds(f)) {
        const pts = restFitPoints(kind);
        const { target, dist } = fitPicture(pts, viewDir(PREVIEW_PITCH), PREVIEW_FOV, 1);
        const q = project(pts, target, viewDir(PREVIEW_PITCH), dist, PREVIEW_FOV, 1);
        const xs = q.map((a) => a[0]);
        const ys = q.map((a) => a[1]);
        // NDC runs -1..1, so a margin m of the picture is (1 - |v|) / 2: never under 3% on any side (not cramped)...
        for (const v of [...xs, ...ys]) expect((1 - Math.abs(v)) / 2, kind).toBeGreaterThanOrEqual(0.03);
        // ...and the model's tightest side is within 9% of the edge (not tiny).
        expect((1 - Math.max(...[...xs, ...ys].map(Math.abs))) / 2, kind).toBeLessThanOrEqual(0.09);
      }
    }
  }, 60_000);

  it('UI-17: the fit sees only visible meshes: hidden objects, objects under a hidden parent and sprites do not widen it', () => {
    const root = new THREE.Group();
    const box = (s: number, x = 0): THREE.Mesh => new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshBasicMaterial()).translateX(x);
    root.add(box(1));
    const hidden = box(40, 30);
    hidden.visible = false;
    const parent = new THREE.Group();
    parent.visible = false;
    parent.add(box(40, -30));
    root.add(hidden, parent, new THREE.Sprite(new THREE.SpriteMaterial()).translateX(50));
    const pts = fitPoints(root);
    expect(Math.max(...pts.map((p) => Math.abs(p[0])))).toBeCloseTo(0.5, 6);
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
