import * as THREE from 'three';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { UNIT_DEFS } from '../data/defs';
import { OWNER_COLORS } from '../render/colors';
import { BUILDING_RIGS, crystalShape } from './buildings3d';
import { addEnvironment, configureRenderer, configureSunShadow, createComposer, glowLevels, matchLights } from './lighting3d';
import { aimPoint, cameraAngle, FADE_IN_MS, FADE_OUT_MS, HQ_SPOT, SCENE_CAST, SCENE_FOV, SCENE_PITCH, sceneFraming, sceneSlots, shardPlan, TARGET_HEIGHT, type SceneFaction, type SceneSlot } from '../render/menuPlan';
import { bodyPose, restingMotion } from './motion';
import { Instancer } from './instancer';
import { PR_MAX } from './resolution';
import { poseRig, rigTree, type RigDef, type RigPose, type RigTree } from './rig';
import { newMember, rand, stepSquad, type Member } from './squad3d';
import { UNIT_RIGS } from './units3d';

/**
 * The live faction scene behind the menu (MENU-10, MENU-11): the picked faction's hero and every other unit kind standing in
 * a ring around its HQ on a patch of ground, in the in-game models with render-only idle motion, lit like a match (late
 * afternoon sun, cool ambient light, bloom). The camera circles the HQ slowly and close, one turn every 75 s, so each unit in turn stands large in front. Loaded with a dynamic import so
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
const FOV = SCENE_FOV;
const PITCH = SCENE_PITCH;
/** The sun is lower than a match's, for long shadows. */
const SUN_AT: readonly [number, number, number] = [-10, 8, 7];
/** Distance haze and the horizon of the dusk sky, per faction: calm, close to a match's fog (0x2a2d44). */
export const HAZE: Record<SceneFaction, number> = { human: 0x28304a, alien: 0x3a3042 };
/** The sky above the horizon: the haze colour darkened toward the top. */
export const SKY_TOP_SHADE = 0.35;
/** The farthest the camera stands from the HQ (a wide screen backs it off), tiles. Fog starts behind the stage and has swallowed the ground well before its edge. */
export const CAMERA_MAX_DIST = 30;
export const FOG_NEAR = 34;
export const FOG_FAR = 80;
export const GROUND_RADIUS = 160;
const GROUND: Record<SceneFaction, readonly [number, number, number]> = { human: [92, 90, 72], alien: [84, 70, 72] };

/** One mining cycle of the hauler, ms (as the unit sheet's preview). */
const MINE_MS = 2400;
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
  /** The hauler: mines the shard field (cutter turning, bed filling, a chomp for the Gorger). */
  working?: boolean;
}

/** A vertical gradient from `horizon` (bottom) to a darker `top`, for the sky. */
function skyTexture(horizon: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d')!;
  const base = new THREE.Color(horizon);
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, `#${base.clone().multiplyScalar(SKY_TOP_SHADE).getHexString()}`);
  grad.addColorStop(1, `#${base.getHexString()}`);
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
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
  t.repeat.set(27, 27);
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
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 160);
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
  private crystalGeo = new Map<string, { lit?: THREE.BufferGeometry | null; glow?: THREE.BufferGeometry | null }>();
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
  /** How far the camera stands from the HQ so the ring clears the panel (MENU-11), tiles. */
  private dist = 30;
  /** A camera angle forced by a test (radians), or null to follow the orbit. */
  private forced: number | null = null;

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
    // One shadow map: the ring of units and the shard field are about 24 tiles across.
    configureSunShadow(sun, 12, 1024, 40);
    this.scene.add(hemi, sun, sun.target, this.stage);
    addEnvironment(this.scene, this.renderer);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(GROUND_RADIUS, 64).rotateX(-Math.PI / 2), this.groundMat);
    ground.receiveShadow = true;
    this.geos.push(ground.geometry);
    this.scene.add(ground);
    this.composer = createComposer(this.renderer, this.scene, this.camera);
    this.build(this.faction);
    // A test hook: dispatch `shardfall-orbit` with an angle in `detail` (radians), or null to follow the orbit again.
    this.canvas.addEventListener('shardfall-orbit', (e) => {
      this.forced = (e as CustomEvent<number | null>).detail;
      this.draw(this.time);
    });
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
    const haze = HAZE[f];
    (this.scene.background as THREE.Texture | null)?.dispose();
    this.scene.background = skyTexture(haze);
    this.scene.fog = new THREE.Fog(haze, FOG_NEAR, FOG_FAR);
    this.groundMat.map?.dispose();
    this.groundMat.map = groundTexture(GROUND[f]);
    this.groundMat.needsUpdate = true;
    const cast = SCENE_CAST[f];
    const slots = sceneSlots(f);
    const add = (kind: string, s: SceneSlot, i: number): Figure | null => {
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
    add(cast.hq, { x: HQ_SPOT.x, z: HQ_SPOT.z, heading: 0 }, 9);
    add(cast.hero, slots[cast.hero]!, 0);
    cast.others.forEach((k, i) => add(k, slots[k]!, i + 1));
    const hauler = add(cast.hauler, slots[cast.hauler]!, 8);
    if (hauler) hauler.working = true;
    // The shard field beside the HQ and loose crystals in front: the match's crystal models and material, instanced.
    const inst = new Instancer(this.stage);
    inst.begin();
    const plan = shardPlan(f);
    for (const c of [...plan.field, ...plan.loose]) {
      const key = `crystal/${c.level}v${c.variant}`;
      let b = this.crystalGeo.get(key);
      if (!b) {
        b = crystalShape(c.level, c.variant * 31 + c.level).build(0);
        this.crystalGeo.set(key, b);
        for (const g of [b.lit, b.glow]) if (g) this.geos.push(g);
      }
      const m = new THREE.Matrix4().makeRotationY(c.yaw).setPosition(c.x, 0, c.z);
      if (b.lit) inst.push(`${key}|L`, b.lit, this.crystal, true, m);
      if (b.glow) inst.push(`${key}|G`, b.glow, this.glow, false, m);
    }
    inst.end();
    this.crystalGeo.clear();
    this.target.set(HQ_SPOT.x, TARGET_HEIGHT, HQ_SPOT.z);
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
        const work = f.working ? { load: ((now + f.seed * 97) % MINE_MS) / MINE_MS, drum: (now / 1000) * 14, lunge: def.organic ? Math.max(0, Math.sin((now / 700) * Math.PI * 2)) : 0 } : null;
        poseRig(tree, { ...STILL, turret: 0.3 * Math.sin(now / 2600 + f.seed), pitch: pose.pitch, roll: pose.roll, bob: pose.bob, time: now, reach: def.radius * 0.25, walker, crouch: mm?.crouch ?? 0, phase: i * 1.7, ...work });
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
    this.frameGroup();
    if (this.still || this.paused) this.draw(this.time);
  }

  /** Frame the whole group in the free strip right of the panel from 1600 px up (MENU-11): back off and shift the picture right. */
  private frameGroup(): void {
    const { dist, shift } = sceneFraming(this.w, this.h);
    this.dist = Math.min(CAMERA_MAX_DIST, dist);
    this.camera.setViewOffset(this.w, this.h, -shift, 0, this.w, this.h);
    this.camera.updateProjectionMatrix();
  }

  /** Place the camera `t` seconds into the orbit (or at the fixed angle while holding still) and draw. */
  private draw(t: number): void {
    if (this.gone) return;
    const a = this.forced ?? cameraAngle(t, this.still);
    const d = this.dist;
    const cp = Math.cos(PITCH);
    // Aim between the HQ and the unit nearest the camera, so that unit stands large in the middle with the HQ behind it.
    const aim = aimPoint(this.faction, a);
    this.target.set(aim.x, TARGET_HEIGHT, aim.z);
    this.camera.position.set(this.target.x + Math.cos(a) * cp * d, this.target.y + Math.sin(PITCH) * d, this.target.z + Math.sin(a) * cp * d);
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
      this.frameGroup();
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
    (this.scene.background as THREE.Texture | null)?.dispose();
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
