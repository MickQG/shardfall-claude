import * as THREE from 'three';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { UNIT_DEFS } from '../data/defs';
import { OWNER_COLORS } from '../render/colors';
import { BUILDING_RIGS, crystalShape } from './buildings3d';
import { addEnvironment, configureRenderer, configureSunShadow, createComposer, glowLevels, matchLights } from './lighting3d';
import { dollyDistance, FADE_IN_MS, FADE_OUT_MS, heroShift, SCENE_CAST, type SceneFaction } from '../render/menuPlan';
import { bodyPose, restingMotion } from './motion';
import { PR_MAX } from './resolution';
import { poseRig, rigTree, type RigDef, type RigPose, type RigTree } from './rig';
import { newMember, rand, stepSquad, type Member } from './squad3d';
import { UNIT_RIGS } from './units3d';

/**
 * The live faction scene behind the menu (MENU-10, MENU-11): the picked faction's hero and three other units standing in
 * front of its HQ on a patch of ground, in the in-game models with render-only idle motion, lit like a match (late
 * afternoon sun, cool ambient light, bloom). The camera dollies slowly back and forth. Loaded with a dynamic import so
 * the menu appears before three.js arrives. Render-only: no sim, no unseeded randomness (a seeded hash makes the ground and the
 * idle wander), nothing is read from the game.
 */

export interface MenuSceneOptions {
  faction: SceneFaction;
  /** Draw once and hold still (Low quality, or reduced motion). */
  still: boolean;
  /** Called after the first frame is drawn, so the menu can retire its backdrop. */
  onReady?: () => void;
}

export interface MenuScene {
  readonly canvas: HTMLCanvasElement;
  /** Show the other faction: a crossfade of at most 0.6 s (or at once while holding still). */
  setFaction(f: SceneFaction): void;
  /** Hold still (draw once) or animate. */
  setStill(still: boolean): void;
  /** Pause while the unit sheet covers the scene. */
  setPaused(paused: boolean): void;
  /** Stop drawing, free everything and release the WebGL context. */
  dispose(): void;
}

const SEED = 4242;
const FOV = 32;
const PITCH = 0.3;
const AZIMUTH = 0.38;
/** The sun is lower than a match's, for long shadows. */
const SUN_AT: readonly [number, number, number] = [-10, 8, 7];
const BACKDROP: Record<SceneFaction, number> = { human: 0x0a131c, alien: 0x14120b };
const GROUND: Record<SceneFaction, readonly [number, number, number]> = { human: [92, 90, 72], alien: [84, 70, 72] };

/** Where each member of a scene stands (tiles; x right, z toward the camera), and which way it faces (radians, 0 = +x). */
interface Slot {
  x: number;
  z: number;
  heading: number;
}
const FACE = Math.PI / 2 - 0.4;
const SLOTS: Record<SceneFaction, { hero: Slot; others: Slot[]; hq: Slot }> = {
  human: {
    hero: { x: 1.4, z: 1.2, heading: FACE },
    others: [
      { x: -0.9, z: 2.4, heading: FACE + 0.35 },
      { x: -2.6, z: 0.6, heading: FACE + 0.6 },
      { x: 3.8, z: 2.0, heading: FACE - 0.5 },
    ],
    hq: { x: 0.6, z: -4.2, heading: 0 },
  },
  alien: {
    hero: { x: 1.4, z: 1.2, heading: FACE },
    others: [
      { x: -1.0, z: 2.4, heading: FACE + 0.35 },
      { x: -2.8, z: 0.4, heading: FACE + 0.6 },
      { x: 3.8, z: 2.2, heading: FACE - 0.5 },
    ],
    hq: { x: 0.6, z: -4.4, heading: 0 },
  },
};

const STILL: RigPose = { turret: 0, kick: 0, lunge: 0, pitch: 0, roll: 0, bob: 0, phase: 0, stride: 0, dist: 0, turnRate: 0, time: 0, reach: 0, walker: false };

interface Figure {
  def: RigDef;
  trees: RigTree[];
  members: Member[];
  group: THREE.Group;
  heading: number;
  x: number;
  z: number;
  seed: number;
  building: boolean;
}

/** A ground texture of fine, seeded speckle around `rgb`. */
function groundTexture(rgb: readonly [number, number, number]): THREE.DataTexture {
  const n = 128;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = 0.82 + 0.36 * (0.6 * rand(SEED, x, y) + 0.4 * rand(SEED + 1, x >> 2, y >> 2));
      const o = (y * n + x) * 4;
      data[o] = Math.min(255, rgb[0] * v);
      data[o + 1] = Math.min(255, rgb[1] * v);
      data[o + 2] = Math.min(255, rgb[2] * v);
      data[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(9, 9);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

class Scene3d implements MenuScene {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 90);
  private composer: EffectComposer;
  private metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.38 });
  private organic = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.05 });
  private crystal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.25, emissive: 0x0c3a34 });
  private glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color().setScalar(glowLevels(true).glow) });
  private hiveGlow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color().setScalar(glowLevels(true).hive) });
  private groundMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  private sun: THREE.DirectionalLight;
  private stage = new THREE.Group();
  /** Geometry owned by the ground (index 0) and by the current stage. */
  private geos: THREE.BufferGeometry[] = [];
  private figures: Figure[] = [];
  private target = new THREE.Vector3();
  private faction: SceneFaction;
  private still: boolean;
  private paused = false;
  private raf = 0;
  private t0 = 0;
  private last = 0;
  private time = 0;
  private swap = 0;
  private timer = 0;
  private gone = false;
  private ro: ResizeObserver;
  private w = 0;
  private h = 0;

  constructor(private host: HTMLElement, o: MenuSceneOptions) {
    this.faction = o.faction;
    this.still = o.still;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    configureRenderer(this.renderer);
    this.renderer.toneMappingExposure = 1.1;
    this.canvas = this.renderer.domElement;
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity .45s ease-out';
    host.appendChild(this.canvas);
    const { sun, hemi } = matchLights();
    this.sun = sun;
    sun.color.setHex(0xffcf9c);
    sun.intensity = 2.7;
    hemi.intensity = 0.8;
    // One small shadow map: the stage is about 16 tiles across.
    configureSunShadow(sun, 9, 1024, 40);
    this.scene.add(hemi, sun, sun.target, this.stage);
    addEnvironment(this.scene, this.renderer);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 48).rotateX(-Math.PI / 2), this.groundMat);
    ground.receiveShadow = true;
    this.geos.push(ground.geometry);
    this.scene.add(ground);
    this.composer = createComposer(this.renderer, this.scene, this.camera);
    this.build(this.faction);
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(host);
    this.fit();
    // Draw the first frame (the shaders compile now), then show it.
    this.draw(0);
    o.onReady?.();
    requestAnimationFrame(() => {
      if (!this.gone) this.canvas.style.opacity = '1';
    });
    if (!this.still) this.loop();
  }

  private clearStage(): void {
    this.stage.clear();
    for (const g of this.geos.splice(1)) g.dispose();
    this.figures = [];
  }

  /** Add a model's parts under its tree's nodes, as the preview and the match do. */
  private dress(def: RigDef, tree: RigTree, hive: boolean): void {
    const team = OWNER_COLORS[0] ?? 0xffffff;
    const lit = def.organic ? this.organic : this.metal;
    for (const d of tree.drawn) {
      const make = def.shapes[d.geo];
      if (!make) continue;
      const b = make().build(team);
      if (b.lit) {
        const m = new THREE.Mesh(b.lit, lit);
        m.castShadow = m.receiveShadow = true;
        d.obj.add(m);
        this.geos.push(b.lit);
      }
      if (b.glow) {
        d.obj.add(new THREE.Mesh(b.glow, hive ? this.hiveGlow : this.glow));
        this.geos.push(b.glow);
      }
    }
  }

  private build(f: SceneFaction): void {
    this.clearStage();
    this.canvas.dataset.faction = f;
    const bg = BACKDROP[f];
    this.scene.background = new THREE.Color(bg);
    this.scene.fog = new THREE.Fog(bg, 26, 52);
    this.groundMat.map?.dispose();
    this.groundMat.map = groundTexture(GROUND[f]);
    this.groundMat.needsUpdate = true;
    const cast = SCENE_CAST[f];
    const slots = SLOTS[f];
    const add = (kind: string, s: Slot, i: number): Figure | null => {
      const building = !!BUILDING_RIGS[kind];
      const make = UNIT_RIGS[kind] ?? BUILDING_RIGS[kind];
      if (!make) return null;
      const def = make();
      const n = building ? 1 : (UNIT_DEFS[kind]?.squad ?? 1);
      const group = new THREE.Group();
      const trees: RigTree[] = [];
      for (let k = 0; k < n; k++) {
        const tree = rigTree(def);
        this.dress(def, tree, building && kind.startsWith('ali_'));
        tree.root.scale.setScalar(def.scale ?? 1);
        group.add(tree.root);
        trees.push(tree);
      }
      group.position.set(s.x, 0, s.z);
      this.stage.add(group);
      const seed = SEED + i * 17;
      const members = n > 1 ? trees.map((_, k) => newMember({ x: s.x, z: s.z, heading: s.heading, seed }, k, n)) : [];
      const fig: Figure = { def, trees, members, group, heading: s.heading, x: s.x, z: s.z, seed, building };
      this.figures.push(fig);
      return fig;
    };
    add(cast.hq, slots.hq, 9);
    const hero = add(cast.hero, slots.hero, 0);
    cast.others.forEach((k, i) => add(k, slots.others[i]!, i + 1));
    // A few shard crystals on the ground (the in-game decor), at fixed spots.
    for (const [x, z, level, v] of [[-5.5, -1.5, 3, 1], [5.8, -2.2, 2, 2], [-6.5, 3.5, 2, 3], [7.5, 1.5, 3, 4]] as const) {
      const b = crystalShape(level, v * 31 + level).build(0);
      const g = new THREE.Group();
      for (const geo of [b.lit, b.glow]) {
        if (!geo) continue;
        const m = new THREE.Mesh(geo, geo === b.lit ? this.crystal : this.glow);
        m.castShadow = geo === b.lit;
        g.add(m);
        this.geos.push(geo);
      }
      g.position.set(x, 0, z);
      g.scale.setScalar(1.3);
      this.stage.add(g);
    }
    const hh = hero ? hero.def.height * (hero.def.scale ?? 1) : 1.5;
    this.target.set(slots.hero.x, hh * 0.5, slots.hero.z);
    this.pose(0, 0.016);
  }

  /** Idle motion for every figure at `now` ms: breathing and sway from the game's own body model, squads that wander. */
  private pose(now: number, dt: number): void {
    for (const f of this.figures) {
      const def = f.def;
      const walker = def.move === 'walker';
      const squad = f.members.length > 0;
      if (squad) stepSquad(f.members, { x: f.x, z: f.z, vx: 0, vz: 0, heading: f.heading, aiming: false, aim: f.heading, alive: f.members.length, t: now, dt, seed: f.seed, free: () => true });
      f.trees.forEach((tree, i) => {
        const mm = squad ? f.members[i]! : null;
        const m = mm ? mm.motion : restingMotion(f.heading);
        if (mm) {
          tree.root.position.set(mm.x - f.x, 0, mm.z - f.z);
          tree.root.rotation.set(0, -mm.yaw, 0);
        } else {
          tree.root.position.set(0, 0, 0);
          tree.root.rotation.set(0, -f.heading, 0);
        }
        if (f.building) {
          poseRig(tree, { ...STILL, time: now });
          return;
        }
        const pose = bodyPose(def.move, m, 0, now, f.seed + i, mm ? undefined : def.walk);
        poseRig(tree, { ...STILL, turret: 0.3 * Math.sin(now / 2600 + f.seed), pitch: pose.pitch, roll: pose.roll, bob: pose.bob, time: now, reach: def.radius * 0.25, walker, crouch: mm?.crouch ?? 0, phase: i * 1.7 });
      });
    }
  }

  private fit(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    const pr = Math.min(PR_MAX, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // The hero sits clear of the panel, to its right, from 1600 px up (MENU-11): shift the picture right.
    this.camera.setViewOffset(w, h, -heroShift(w), 0, w, h);
    this.camera.updateProjectionMatrix();
    if (this.still || this.paused) this.draw(this.time);
  }

  /** Place the camera `t` seconds into the dolly and draw. */
  private draw(t: number): void {
    if (this.gone) return;
    const d = dollyDistance(t);
    const cp = Math.cos(PITCH);
    this.camera.position.set(this.target.x + Math.sin(AZIMUTH) * cp * d, this.target.y + Math.sin(PITCH) * d + 0.4, this.target.z + Math.cos(AZIMUTH) * cp * d);
    this.camera.lookAt(this.target);
    this.sun.position.set(this.target.x + SUN_AT[0], SUN_AT[1], this.target.z + SUN_AT[2]);
    this.sun.target.position.set(this.target.x, 0, this.target.z);
    this.composer.render();
  }

  private loop(): void {
    cancelAnimationFrame(this.raf);
    if (this.gone || this.still || this.paused) return;
    this.last = 0;
    this.t0 = 0;
    const frame = (now: number): void => {
      if (this.gone || this.still || this.paused) return;
      if (!this.t0) this.t0 = now - this.time * 1000;
      const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
      this.last = now;
      this.time = (now - this.t0) / 1000;
      this.pose(now, dt);
      this.draw(this.time);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  setFaction(f: SceneFaction): void {
    if (f === this.faction || this.gone) return;
    this.faction = f;
    const token = ++this.swap;
    clearTimeout(this.timer);
    const apply = (): void => {
      if (this.gone || token !== this.swap) return;
      this.build(f);
      this.draw(this.time);
      this.canvas.style.opacity = '1';
    };
    // Held still, or the unit sheet is up: swap at once. Otherwise fade out, swap, fade in (MENU-10: within 0.6 s).
    if (this.still || this.paused) {
      apply();
      return;
    }
    this.canvas.style.transition = `opacity ${FADE_OUT_MS}ms ease-in`;
    this.canvas.style.opacity = '0';
    this.timer = window.setTimeout(() => {
      this.canvas.style.transition = `opacity ${FADE_IN_MS}ms ease-out`;
      apply();
    }, FADE_OUT_MS);
  }

  setStill(still: boolean): void {
    if (still === this.still || this.gone) return;
    this.still = still;
    if (still) {
      cancelAnimationFrame(this.raf);
      this.draw(this.time);
    } else this.loop();
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused || this.gone) return;
    this.paused = paused;
    if (paused) cancelAnimationFrame(this.raf);
    else this.loop();
  }

  dispose(): void {
    if (this.gone) return;
    this.gone = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.ro.disconnect();
    this.clearStage();
    for (const g of this.geos) g.dispose();
    this.groundMat.map?.dispose();
    for (const m of [this.metal, this.organic, this.crystal, this.glow, this.hiveGlow, this.groundMat]) m.dispose();
    this.scene.environment?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}

/** Mount the faction scene in `host`. Throws if WebGL is unavailable; the caller then keeps the drifting backdrop. */
export function mountMenuScene(host: HTMLElement, o: MenuSceneOptions): MenuScene {
  return new Scene3d(host, o);
}
