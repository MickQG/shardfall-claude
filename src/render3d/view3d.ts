import * as THREE from 'three';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { buildingDef, UNIT_DEFS, unitDef } from '../data/defs';
import { FP, maxHpOf, squadAlive, TICKS_PER_SECOND, type SimEvent, type Snapshot } from '../sim';
import type { Camera, Viewport } from '../render/camera';
import { OWNER_COLORS } from '../render/colors';
import type { ViewState } from '../render/gameView';
import type { MapLook } from '../render/worldRenderer';
import { hpFraction } from '../render/gfx';
import type { RenderUnit } from '../render/interp';
import type { Projector } from '../render/projector';
import { crystalLevel, propAt, rockVariant } from '../render/voxel/props';
import { BUILDING_RIGS, crystalShape, DOCK_RIGS, dockFrame, dockModelYaw, dockYaw, grassShape, propShape, reedShape } from './buildings3d';
import { cameraPose, FOV, PX_PER_UNIT } from './camera3d';
import { CombatFx } from './fx3d';
import { Debris } from './debris3d';
import { Instancer, SHADOW_LAYER } from './instancer';
import type { Built, Shape } from './kit';
import { angleDiff, bodyPose, elevationReady, restingSettle, settleStep, type Settle, ELEV_DOWN_MS, ELEV_UP_MS, elevTarget, HAULER_PUFF_ACCEL, HAULER_PUFF_MS, HEAD_MS, rideMotion, slew, podOpen, POD_OPEN_MS, salvoOf, heroHeave, flightAfterWait, follow, gaitPhase, gunYaw, readyToFire, restingMotion, stepMotion, TURRET_RATE, turnToward, turretOnBody, walkerFacing, type Follow, type MotionState } from './motion';
import { newMember, stepSquad, type Member } from './squad3d';
import { poseRig, recoil, rigTree, turretReach, type RigDef, type RigPose, type RigTree } from './rig';
import { HAZE_COLOR, horizonMesh, skyTexture } from './horizon3d';
import { contourWarp, EDGE_AMP, groundTexture, LEVEL_H, scatter, terrainMeshes, type MeshData, type Warp } from './terrain3d';
import { UNIT_RIGS } from './units3d';
import { DEFAULT_TARGET, scatterKind, shotScatter, wallEnd, type Offset, type ScatterKind, type ScatterTarget } from './scatter';
import { BREAK_FIRST_MS, pieceAt, planBreakup, type Piece, type PieceStart } from './breakup';
import { applySurface, modelMaterials, setSurface } from './surface3d';
import { noiseNormalMap, WATER } from './noiseNormal';
import { unexploredMask } from './unexplored';
import { RallyMarker } from './rally3d';
import { GpuTimer } from './gpuTimer';
import { FinishPass } from './postChain3d';
import { PR_MAX, PR_MAX_LOW, PR_MIN, ResolutionGovernor } from './resolution';
import { addEnvironment, canvasMsaa, postMode, configureRenderer, configureSunShadow, createComposer, GLOW, glowLevels, HIVE_GLOW, matchLights, snapShadowTarget, SUN_OFFSET } from './lighting3d';

/**
 * How damage shows on a building at health fraction `hp` (R3D-18): soot darkens it steadily; below half it throws
 * sparks (every `sparkEvery` ms, faster as it weakens); below a third it sags (`lean`, radians) and its power flickers.
 * Pure.
 */
export function damageLook(hp: number, t: number, seed: number): { tint: number; lean: number; sparkEvery: number } {
  const dmg = Math.max(0, Math.min(1, 1 - hp));
  let tint = 1 - 0.45 * dmg ** 1.2;
  if (hp < 0.33 && Math.sin(t * 0.011 + seed * 1.7) > 0.94) tint *= 0.65;
  return { tint, lean: hp < 0.33 ? (0.33 - hp) * 0.12 : 0, sparkEvery: hp < 0.5 ? 400 + 2000 * hp : 0 };
}

/** Whether a building shows its health bar (R3D-20): while selected, and whenever it is below half health. */
export const buildingBar = (hpFrac: number, selected: boolean): boolean => selected || hpFrac < 0.5;

/**
 * Smoke and fire on a damaged building (R3D-20): none above two thirds (GFX-2), then plumes that thicken, grow and
 * puff faster as it weakens (one, two below half, three below a third), with fire below a third. `every` is ms between
 * puffs; `scale` sizes them.
 */
export function damageSmoke(hpFrac: number): { plumes: number; every: number; scale: number; fire: boolean } {
  if (hpFrac > 0.66) return { plumes: 0, every: 0, scale: 0, fire: false };
  const w = Math.min(1, (0.66 - hpFrac) / 0.66);
  return { plumes: hpFrac <= 0.33 ? 3 : hpFrac < 0.5 ? 2 : 1, every: Math.round(100 - 40 * w), scale: 1.1 + 1.1 * w, fire: hpFrac <= 0.33 };
}

export { GLOW, glowLevels, HIVE_GLOW };
/** Extra reach beyond the view, tiles, within which units are still posed (PERF-1). */
export const POSE_MARGIN = 2;

/** Distance fog, tiles from the camera at zoom 1 (it scales out as the camera pulls back, R3D-25). */
const FOG_NEAR = 34;
const FOG_FAR = 86;
/** The sun's shadow box reaches this many tiles either side of the view's centre, drawn into a map this many texels wide. */
const SUN_HALF = 22;
const SUN_MAP = 2048;
/** Frames per redraw of the sun's shadow map (PERF-1). */
export const SHADOW_EVERY = 2;
/**
 * Shadow redraw cadence under GPU pressure (R3D-29): when the governor has had to lower the resolution the sun's shadows
 * refresh every third frame, and at its floor every fourth, so the ground shadows trail units by at most 4 frames.
 */
export function shadowEvery(ratio: number, max: number): number {
  const floor = Math.min(PR_MIN, max);
  if (ratio >= max - 0.001) return SHADOW_EVERY;
  return ratio <= floor + 0.03 ? SHADOW_EVERY + 2 : SHADOW_EVERY + 1;
}


/** An aircraft's dive from the sky to the ground, ms, and how far its momentum carries it on, tiles (R3D-12). */
export const CRASH_MS = 520;
const CRASH_CARRY = 0.8;

/** How long a fallen squad member stays before it has sunk away, ms (R3D-15). */
const FALLEN_MS = 2600;
/** Air units fly this high (tiles). */
export const AIR_Y = 0.85;
/** Units are drawn when their bounding circle (plus a shadow margin) touches the view. */
const CULL_MARGIN = 1.6;

const geometry = (d: MeshData & { uvs?: Float32Array }): THREE.BufferGeometry => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(d.colors, d.colors.length === d.positions.length ? 3 : 4));
  if (d.uvs) g.setAttribute('uv', new THREE.BufferAttribute(d.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(d.indices, 1));
  g.computeBoundingSphere();
  return g;
};

/** One drawn part of a rig instance, resolved once: its geometry, material and batch keys. */
interface Part {
  obj: THREE.Object3D;
  /** Under a cargo node: drawn only while carrying. */
  cargo: boolean;
  lit: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
  /** Low-detail stand-in the part's shadow is cast from (PERF-4). */
  shade: THREE.BufferGeometry | null;
  litKey: string;
  glowKey: string;
  mat: THREE.Material;
  /** Unlit glowing parts: Vrax buildings use a softer glow than everything else (R3D-12). */
  glowMat: THREE.Material;
}

/** A live rig with its parts resolved to batches. */
interface RigInst extends RigTree {
  parts: Part[];
}

interface UnitObj {
  kind: string;
  def: RigDef;
  team: number;
  /** Positioned at the unit; each figure is a child. */
  root: THREE.Group;
  figures: RigInst[];
  /** Selection ring radius. */
  ringR: number;
  /** Frame this unit's matrices were last brought up to date. */
  drawn: number;
  motion: MotionState;
  /** Drawn position, smoothed toward the simulation's (R3D-10); `x`, `z` mirror it. */
  follow: Follow;
  x: number;
  z: number;
  groundY: number;
  /** Squads: each member's own movement (R3D-15), and members who fell, kept until they have sunk away. */
  members: Member[];
  fallen: { i: number; t0: number; side: number; x: number; z: number }[];
  /** World yaw the weapon points at, and until when a shot holds it. */
  aim: number;
  aimHold: number;
  turretYaw: number;
  /** Has a gun that must face the target before it fires: on a turret, or fixed to a lone walker's body (AIM-1). */
  turreted: boolean;
  /** How far its turret swivels on the body either way, radians (Infinity: all round; 0: none). */
  reach: number;
  figureYaw: number[];
  /** Faced by the simulation (HERO-5) rather than by the renderer's own turning. */
  simFacing?: boolean;
  lastFire: number[];
  /** When the missile pods last started to open (HERO-7). */
  podSince: number;
  muzzleTurn: number;
  lunge: number;
  load: number;
  /** When the load last rose (mining) and fell (unloading), ms (R3D-19). */
  mineAt: number;
  unloadAt: number;
  /** Shards it can carry (0 for non-harvesters). */
  capacity: number;
  /** Docked on a refinery's pad and turned to its intake, so the offload plays (R3D-22). */
  docked: boolean;
  /** How far the bed is tipped (or the belly squeezes), 0..1, and the cutter drum's angle (R3D-19). */
  tip: number;
  drum: number;
  /** How far into its work a harvester is, 0..1, eased over 0.4 s: the hauler's head is lowered, the gorger feeds (R3D-30, R3D-31). */
  work: number;
  /** The howitzer's barrel elevation, 0 in its travel lock .. 1 raised (R3D-32), and when the hauler last puffed exhaust. */
  elev: number;
  /** The hauler's stop settle (R3D-30). */
  settle: Settle;
  lastPuff: number;
  alive: number;
  seed: number;
  dying: { t0: number; mode: 'wreck' | 'fall' | 'crash' | 'break' | 'crush'; side: number; boomed: boolean; pieces?: { pivot: THREE.Group; plan: Piece }[] } | null;
  lastDust: number;
  lastBurn: number;
}

interface BuildingObj {
  kind: string;
  team: number;
  def: RigDef;
  rig: RigInst;
  root: THREE.Group;
  ring: THREE.LineLoop;
  born: number;
  x: number;
  z: number;
  y: number;
  hpFrac: number;
  aim: number;
  aimHold: number;
  turretYaw: number;
  turreted: boolean;
  lastFire: number;
  muzzleTurn: number;
  dying: number | null;
  lastSmoke: number;
  /** When the next spark or ichor spurt flies from a badly damaged building. */
  nextSpark: number;
  drawn: number;
  /** A refinery's dock, drawn on its pad beside the building (R3D-22). */
  dock: { rig: RigInst; root: THREE.Group } | null;
}

interface PendingShot {
  at: number;
  src: UnitObj | BuildingObj | null;
  figure: number;
  e: Extract<SimEvent, { t: 'shot' }>;
  look: RigDef['weapon'];
  to: THREE.Vector3;
}

/** A crystal or prop: a fixed placement of one model. */
interface Static {
  x: number;
  y: number;
  z: number;
  m: THREE.Matrix4;
  /** Resolved on first draw. */
  b?: Built;
  litKey?: string;
  glowKey?: string;
  level?: number;
  variant?: number;
}

const isUnit = (o: UnitObj | BuildingObj): o is UnitObj => 'figures' in o;

/** A rig pose with nothing moving (buildings fill in their turret, recoil and clock). */
const STILL: RigPose = { turret: 0, kick: 0, lunge: 0, pitch: 0, roll: 0, bob: 0, phase: 0, stride: 0, dist: 0, turnRate: 0, time: 0, reach: 0, walker: false };

/** The three.js world view (ADR 0005, `?renderer=3d`). Same contract as the classic GameView. */
export class View3D {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400);
  private lights = matchLights();
  private sun = this.lights.sun;
  private hemi = this.lights.hemi;
  private built = new Map<string, Built>();
  private modelMats = modelMaterials();
  private metalMat = this.modelMats.metal;
  private organicMat = this.modelMats.organic;
  private propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.02 });
  private crystalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.25, emissive: 0x0c3a34 });
  // The view starts with bloom on (`bloomOn`), so the glows start at their bloom levels; applyQuality changes them.
  private glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color().setScalar(glowLevels(true).glow) });
  /** Vrax buildings are covered in bioluminescence, with their own brightness. */
  private hiveGlowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color().setScalar(glowLevels(true).hive) });
  /** Everything standing on unexplored tiles fades into the fog's darkness (R3D-17). */
  private unexplored = unexploredMask();
  private inst: Instancer;
  private fx = new CombatFx();
  /** Chunks thrown by destroyed vehicles and buildings (R3D-27). */
  private debris = new Debris();
  /** Shard-field tiles, where vehicles kick up no dust (R3D-26). */
  private shardTiles: ArrayLike<number> | null = null;
  private units = new Map<number, UnitObj>();
  private buildings = new Map<number, BuildingObj>();
  private crystals: Static[] = [];
  private props: (Static & { key: string; make: () => Shape })[] = [];
  private pending: PendingShot[] = [];
  /** Missiles of a Paladin's salvo waiting to leave their pods (HERO-7). */
  private missiles: { at: number; src: UnitObj; side: number; to: THREE.Vector3; flightMs: number; elite: boolean }[] = [];
  private missileTurn = 0;
  /** Shots each shooter has fired so far, by id: picks where each lands on its target (AIM-3). Render state only. */
  private shotCount = new Map<number, number>();
  /** The target measured for the shot being spawned, and its scatter (reused, AIM-3). */
  private scatterT: ScatterTarget = { ...DEFAULT_TARGET };
  private scatterO: Offset = { x: 0, y: 0, z: 0 };
  /** The building measured as that target, if it is one. */
  private scatterB: BuildingObj | null = null;
  private fogTex: THREE.DataTexture | null = null;
  private fogData: Uint8Array | null = null;
  private waterNormal: THREE.Texture | null = null;
  private scatterGroup = new THREE.Group();
  private shadowsOn = true;
  private bloomOn = true;
  /** Whether the canvas is multisampled (a match started on Low), which decides how Low reaches it (PERF-5). */
  private msaa = false;
  private detailOn = true;
  /** Low renders at no more than 1 device pixel per CSS pixel: a third fewer pixels than High's 1.25. */
  private lowRes = false;
  private prepMs = 0;
  private proj: { key: string; p: Projector } | null = null;
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hit = new THREE.Vector3();
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  private lastFogTick = -1;
  private lastShardTick = -1;
  private lastTick = -1;
  private lastTickAt = 0;
  /** Measured simulation tick length (game speed changes it), for projectile flight times. */
  private msPerTick = 1000 / TICKS_PER_SECOND;
  private lastTime = 0;
  private placement = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 1), new THREE.MeshBasicMaterial({ color: 0x3cff8a, transparent: true, opacity: 0.4, depthWrite: false }));
  /** Rally point flag, ring and marching line (R3D-21). */
  private rally = new RallyMarker();
  private known = new Set<number>();
  private seeded = false;
  private mapW = 0;
  private mapH = 0;
  private heights: readonly number[] = [];
  /** The terrain's organic-contour warp (R3D-14): where a point of the tile grid is drawn. */
  private warp: Warp = () => [0, 0];
  /** The same warp without its cache, for per-frame lookups at arbitrary points. */
  private liveWarp: Warp = () => [0, 0];
  private blocked: MapLook['blocked'] | null = null;
  private fallTint = new THREE.Color();
  private composer: EffectComposer | null = null;
  private tint = new THREE.Color();
  private frame = 0;
  private camRight = new THREE.Vector3();
  private ringGeo = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2);
  private ringMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false });
  /** Order acknowledgement rings (UI-13); its opacity fades with the newest marker (they rarely overlap in time). */
  private ackMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
  private ackEdge = new THREE.RingGeometry(0.8, 1.06, 40).rotateX(-Math.PI / 2);
  private ackDot = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
  private white = new THREE.Color(1, 1, 1);
  private barGeo = new THREE.PlaneGeometry(1, 1);
  private barFgGeo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
  private barMat = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
  private uiM = new THREE.Matrix4();
  private uiS = new THREE.Vector3();
  private uiP = new THREE.Vector3();
  private uiC = new THREE.Color();
  private uiQ = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private host: HTMLElement | null = null;
  private size: Viewport = { width: 1, height: 1 };
  private warmGroup = new THREE.Group();
  private cpuMs = 0;
  /** Adaptive resolution (PERF-2); created on the first fit, when the device pixel ratio is known. */
  private res: ResolutionGovernor | null = null;
  private gpuTimer: GpuTimer;

  /**
   * `msaa`: multisample the canvas, for a match that starts on Low (its only edge smoothing). On High the last pass is
   * FXAA drawing one full-screen quad, which multisampling cannot smooth further, so the canvas is not multisampled and
   * its samples and resolve cost nothing (PERF-5). A switch of preset mid-match keeps the canvas it started with.
   */
  constructor(opts: { msaa?: boolean } = {}) {
    // Panels, wear and creases on units and buildings, from the shader alone (R3D-23); compiled with the rest in prewarm.
    applySurface(this.metalMat, 'metal');
    applySurface(this.organicMat, 'organic');
    this.msaa = canvasMsaa(opts.msaa === true);
    this.renderer = new THREE.WebGLRenderer({ antialias: this.msaa, powerPreference: 'high-performance' });
    configureRenderer(this.renderer);
    // The sun's shadows are redrawn every other frame (PERF-1): at 60 fps a shadow trailing its unit by one frame is invisible.
    this.renderer.shadowMap.autoUpdate = false;
    // The shadow stand-ins live on their own layer, which the camera never draws. The shadow pass takes its layer test from
    // the camera too, and runs after the scene's draw list is built, so the layer is switched on for that call alone (PERF-4).
    const drawShadows = this.renderer.shadowMap.render.bind(this.renderer.shadowMap);
    this.renderer.shadowMap.render = (lights, scene, camera): void => {
      camera.layers.enable(SHADOW_LAYER);
      drawShadows(lights, scene, camera);
      camera.layers.disable(SHADOW_LAYER);
    };
    // Count a whole frame (shadows, scene and post-processing passes), not just the last pass.
    this.renderer.info.autoReset = false;
    this.inst = new Instancer(this.scene);
    this.gpuTimer = new GpuTimer(this.renderer.getContext());
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /**
   * Size the canvas and buffers: at most 1.25 device pixels per CSS pixel (sharp, and affordable on integrated GPUs),
   * lowered while the GPU cannot keep up (PERF-2).
   */
  private fit(): void {
    const host = this.host;
    if (!host) return;
    const max = Math.min(this.lowRes ? PR_MAX_LOW : PR_MAX, window.devicePixelRatio || 1);
    if (!this.res || this.res.max !== max) this.res = new ResolutionGovernor(max);
    const pr = this.res.ratio;
    // With post-processing, the canvas keeps its full size and only the composer's buffers follow the governor: resizing
    // the canvas costs a frame or two (PERF-3), reallocating offscreen buffers does not. The last pass scales up to the canvas.
    const post = this.viaComposer();
    this.renderer.setPixelRatio(post ? this.res.max : pr);
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    this.size = { width: host.clientWidth || 1, height: host.clientHeight || 1 };
    this.composer?.setPixelRatio(pr);
    this.composer?.setSize(host.clientWidth, host.clientHeight);
    this.camera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
    this.camera.updateProjectionMatrix();
    this.fx.setScale((host.clientHeight * pr) / (2 * Math.tan((FOV * Math.PI) / 360)));
  }

  /** Whether frames go through the post chain (with or without bloom) rather than straight to the canvas (PERF-5). */
  private viaComposer(): boolean {
    return this.composer !== null && postMode(this.bloomOn, this.msaa) !== 'direct';
  }

  /** The canvas size in CSS pixels, measured on resize (reading layout every frame is costly). */
  get viewport(): Viewport {
    return this.size;
  }

  async mount(host: HTMLElement, snap: Snapshot, look: MapLook = {}): Promise<void> {
    host.appendChild(this.renderer.domElement);
    this.composer = createComposer(this.renderer, this.scene, this.camera);
    this.host = host;
    this.fit();
    new ResizeObserver(() => this.fit()).observe(host);
    this.mapW = snap.mapWidth;
    this.mapH = snap.mapHeight;
    this.heights = snap.heights;
    const s = this.scene;
    // The sky gradient ends in the haze colour the distant land fades into (R3D-25).
    s.background = skyTexture();
    s.fog = new THREE.Fog(HAZE_COLOR, FOG_NEAR, FOG_FAR);
    addEnvironment(s, this.renderer);
    s.add(this.hemi);
    configureSunShadow(this.sun, SUN_HALF, SUN_MAP);
    s.add(this.sun, this.sun.target, this.fx.root, this.debris.root, this.scatterGroup);
    this.buildTerrain(snap, look);
    this.buildProps(snap, look);
    this.syncShards(snap);
    this.placement.visible = false;
    s.add(this.placement, this.rally.root);
    this.prewarm();
  }

  /**
   * Build every model for both team colours and compile every shader program (instanced lit and glowing parts, their
   * shadows, particles, streaks, bloom) before the first frame, so a unit's first appearance or the first explosion
   * never stalls the game.
   */
  private prewarm(): void {
    for (const team of OWNER_COLORS) {
      for (const [kind, make] of [...Object.entries(UNIT_RIGS), ...Object.entries(BUILDING_RIGS)]) {
        const def = make();
        for (const [geo, shape] of Object.entries(def.shapes)) this.shapeGeo(`${kind}/${geo}`, shape, team);
      }
    }
    for (let level = 1; level <= 4; level++) for (let v = 0; v < 3; v++) this.shapeGeo(`crystal/${level}v${v}`, () => crystalShape(level, v * 31 + level), 0);
    for (const p of this.props) this.shapeGeo(p.key, p.make, 0);
    // Stand-ins for every material that appears later (instanced parts, health bars, rings, lines), hidden under the
    // map and kept for good: they make `compileAll` cover programs that units and effects only need later.
    const warm = this.warmGroup;
    const geo = new THREE.BoxGeometry(0.001, 0.001, 0.001);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position!.count * 3).fill(1), 3));
    for (const [mat, shadow] of [[this.metalMat, true], [this.organicMat, true], [this.propMat, true], [this.crystalMat, true], [this.glowMat, false], [this.hiveGlowMat, false], [this.ringMat, false], [this.ackMat, false], [this.barMat, false]] as const) {
      const m = new THREE.InstancedMesh(geo, mat, 1);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      m.castShadow = m.receiveShadow = shadow;
      m.frustumCulled = false;
      warm.add(m);
    }
    warm.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0.001, 0, 0)]), new THREE.LineBasicMaterial()));
    warm.position.set(0, -50, 0);
    this.scene.add(warm);
    this.camera.position.set(10, 20, 10);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.compileAll();
    // Draw every prebuilt model once (hidden under the map), so its vertex buffers reach the GPU now rather than the
    // first time the camera finds an army.
    const upload = new THREE.Group();
    upload.position.set(0, -50, 0);
    for (const [key, b] of this.built) {
      const organic = key.startsWith('ali_');
      for (const [geo, mat] of [[b.lit, key.startsWith('crystal') ? this.crystalMat : key.startsWith('prop') ? this.propMat : organic ? this.organicMat : this.metalMat], [b.glow, this.glowMat]] as const) {
        if (!geo) continue;
        const m = new THREE.InstancedMesh(geo, mat, 1);
        m.setColorAt(0, new THREE.Color(1, 1, 1));
        m.scale.setScalar(0.001);
        m.frustumCulled = false;
        upload.add(m);
      }
      if (b.shadow) {
        const sm = new THREE.InstancedMesh(b.shadow, new THREE.MeshBasicMaterial(), 1);
        sm.layers.set(SHADOW_LAYER);
        sm.castShadow = true;
        sm.scale.setScalar(0.001);
        sm.frustumCulled = false;
        upload.add(sm);
      }
    }
    this.scene.add(upload);
    this.renderShadows();
    if (this.composer) this.composer.render(0.016);
    else this.renderer.render(this.scene, this.camera);
    this.scene.remove(upload);
    for (const m of upload.children) (m as THREE.InstancedMesh).dispose();
    // Wait for the GPU to finish all of that here, while loading, rather than stalling the first frames of play.
    this.renderer.getContext().finish();
  }

  /** Ask for the sun's shadow map to be redrawn in the next render (from the shadow stand-ins, PERF-4). */
  private renderShadows(): void {
    this.renderer.shadowMap.needsUpdate = true;
  }

  /**
   * Compile every program the current preset needs (objects in view or not, effects included) for the path it renders
   * through, then draw one frame that way for the shadow and post-processing programs. Runs at startup and when the
   * preset changes, so the stall happens once, there, instead of at a unit's first appearance or first explosion.
   */
  private compileAll(): void {
    this.fx.warm(true);
    this.debris.warm(true);
    this.rally.warm(true); // its programs too, or the first rally point would stall a frame
    this.renderShadows();
    if (this.viaComposer() && this.composer) {
      this.renderer.setRenderTarget(this.composer.readBuffer);
      this.renderer.compile(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      this.composer.render(0.016);
    } else {
      this.renderer.compile(this.scene, this.camera);
      this.renderer.render(this.scene, this.camera);
    }
    this.fx.warm(false);
    this.debris.warm(false);
    this.rally.warm(false);
  }

  private buildTerrain(snap: Snapshot, look: MapLook): void {
    const W = snap.mapWidth;
    const input = {
      width: W,
      height: snap.mapHeight,
      heights: snap.heights,
      blocked: (x: number, y: number) => !!look.blocked?.[y * W + x],
      shards: (x: number, y: number) => (look.shards?.[y * W + x] ?? 0) > 0,
    };
    this.warp = contourWarp(input);
    this.blocked = look.blocked ?? null;
    this.liveWarp = contourWarp(input, false);
    this.fx.groundAt = (x, z) => this.groundAt(x, z);
    this.debris.groundAt = (x, z) => this.groundAt(x, z);
    this.shardTiles = look.shards ?? null;
    const tex = groundTexture(input);
    const map = new THREE.DataTexture(tex.data, tex.width, tex.height);
    map.flipY = true;
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.anisotropy = 4;
    map.needsUpdate = true;
    // Fine relief that catches the low sun (R3D-11): a tiling normal map, about three tiles per repeat.
    const relief = noiseNormalMap(128, 8, 5, 1);
    relief.repeat.set(W / 3, snap.mapHeight / 3);
    const m = terrainMeshes(input);
    const ground = new THREE.Mesh(geometry(m.ground), new THREE.MeshStandardMaterial({ map, normalMap: relief, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.93, metalness: 0 }));
    ground.receiveShadow = true;
    const cliffMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, flatShading: true });
    const cliffs = new THREE.Mesh(geometry(m.cliffs), cliffMat);
    cliffs.receiveShadow = true;
    cliffs.castShadow = true;
    // Calm water (R3D-11): slowly drifting, broad ripples under a soft sheen, no glints.
    this.waterNormal = noiseNormalMap(128, WATER.noiseFreq, WATER.noiseStrength, 2);
    this.waterNormal.repeat.set(W / WATER.tilesPerRepeat, snap.mapHeight / WATER.tilesPerRepeat);
    const water = new THREE.Mesh(geometry(m.water), new THREE.MeshStandardMaterial({ color: 0x2a6a8a, vertexColors: true, depthWrite: false, roughness: WATER.roughness, metalness: WATER.metalness, transparent: true, opacity: 0.82, normalMap: this.waterNormal, normalScale: new THREE.Vector2(WATER.normalScale, WATER.normalScale) }));
    water.receiveShadow = true;
    // The land beyond the map edge (R3D-25): scenery, one mesh, no shadows, no fog of war, never picked.
    const horizon = new THREE.Mesh(geometry(horizonMesh(W, snap.mapHeight, snap.heights)), new THREE.MeshBasicMaterial({ vertexColors: true }));
    horizon.matrixAutoUpdate = false;
    horizon.frustumCulled = false;
    this.scene.add(horizon, ground, cliffs, water);
    // Cliffs, water, props, plants and crystals on unexplored tiles fade into the fog's darkness (R3D-17).
    for (const mat of [cliffMat, water.material, this.propMat, this.crystalMat, this.glowMat, this.hiveGlowMat, this.debris.material]) this.unexplored.apply(mat);
    this.fx.useHide(this.unexplored.uniforms);
    if (snap.fog) {
      // Fog of war: the same tile tops, darkened through a per-tile alpha texture (linear filtering softens the edges).
      this.fogData = new Uint8Array(W * snap.mapHeight * 4);
      this.fogTex = new THREE.DataTexture(this.fogData, W, snap.mapHeight);
      this.fogTex.flipY = true;
      this.fogTex.magFilter = THREE.LinearFilter;
      this.fogTex.minFilter = THREE.LinearFilter;
      this.unexplored.use(this.fogTex, W, snap.mapHeight);
      const fogMat = new THREE.MeshBasicMaterial({ color: 0x0c0f22, alphaMap: this.fogTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const fog = new THREE.Mesh(geometry(m.ground), fogMat);
      fog.renderOrder = 10;
      this.scene.add(fog);
    }
  }

  /** Props (the classic view's choice of tiles) and scattered grass, stones and flora (R3D-11). */
  private buildProps(snap: Snapshot, look: MapLook): void {
    const W = snap.mapWidth;
    const near = (x: number, y: number): boolean => snap.buildings.some((b) => Math.abs(b.tx - x) < 10 && Math.abs(b.ty - y) < 10);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let y = 0; y < snap.mapHeight; y++) {
      for (let x = 0; x < W; x++) {
        if ((snap.heights[y * W + x] ?? 0) > 0) continue;
        const kind = propAt(x, y, !snap.shards[y * W + x] && !near(x, y));
        if (!kind) continue;
        const v = rockVariant(x, y) % 3;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rockVariant(y, x) * 0.7);
        const d = this.warp(x + 0.5, y + 0.5);
        const px = x + 0.5 + d[0];
        const pz = y + 0.5 + d[1];
        this.props.push({ key: `prop/${kind}${v}`, make: () => propShape(kind, v), m: new THREE.Matrix4().compose(new THREE.Vector3(px, 0, pz), q.clone(), new THREE.Vector3(1, 1, 1)), x: px, y: 0, z: pz });
      }
    }
    // Scatter in 16x16-tile chunks, each one instanced mesh per kind, so the view culls whole chunks.
    const items = scatter({ width: W, height: snap.mapHeight, heights: snap.heights, blocked: (x, y) => !!look.blocked?.[y * W + x], shards: (x, y) => (look.shards?.[y * W + x] ?? 0) > 0 }, (x, y) => !near(x, y) || (x + y) % 3 === 0);
    const chunks = new Map<string, typeof items>();
    for (const it of items) {
      const key = `${Math.floor(it.x / 16)},${Math.floor(it.z / 16)}|${it.kind}${it.variant}`;
      const list = chunks.get(key) ?? [];
      list.push(it);
      chunks.set(key, list);
    }
    const geos = new Map<string, Built>();
    const white = new THREE.Color(1, 1, 1);
    for (const [key, list] of chunks) {
      const kv = key.split('|')[1] as string;
      let b = geos.get(kv);
      if (!b) {
        const it = list[0]!;
        const make = (): Shape => {
          if (it.kind === 'grass') return grassShape(it.variant, [0x5d7a3a, 0x6f8a44, 0x4f6a34][it.variant % 3] as number);
          if (it.kind === 'flora') return propShape('sprout', it.variant);
          if (it.kind === 'reed') return reedShape(it.variant);
          return propShape('pebbles', it.variant); // stones, and boulders scaled up
        };
        b = make().build(0xffffff);
        geos.set(kv, b);
      }
      for (const [geo, mat, shadow] of [[b.lit, this.propMat, false], [b.glow, this.glowMat, false]] as const) {
        if (!geo) continue;
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach((it, i) => {
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot);
          m.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.scale, it.scale, it.scale));
          im.setMatrixAt(i, m);
          // Instance colours, like the dynamic batches, so materials they share never switch shader variants.
          im.setColorAt(i, white);
        });
        im.receiveShadow = true;
        im.castShadow = shadow;
        im.computeBoundingSphere();
        this.scatterGroup.add(im);
      }
    }
  }

  private syncShards(snap: Snapshot): void {
    const W = snap.mapWidth;
    this.crystals = [];
    for (let i = 0; i < snap.shards.length; i++) {
      const level = crystalLevel(snap.shards[i] ?? 0);
      if (level === 0) continue;
      const x = i % W;
      const y = Math.floor(i / W);
      const h = (snap.heights[i] ?? 0) * LEVEL_H;
      // Off-centre within the tile (and on the warped ground), so a field does not read as a grid (R3D-14).
      const jx = x + 0.5 + ((rockVariant(x * 3 + 1, y) % 7) / 6 - 0.5) * 0.36;
      const jz = y + 0.5 + ((rockVariant(x, y * 3 + 2) % 7) / 6 - 0.5) * 0.36;
      const d = this.warp(jx, jz);
      const m = new THREE.Matrix4().makeRotationY(rockVariant(y, x) * 1.3).setPosition(jx + d[0], h, jz + d[1]);
      this.crystals.push({ x: jx + d[0], z: jz + d[1], y: h, level, variant: rockVariant(x, y) % 3, m });
    }
  }

  /** Merged geometry of one shape in one team colour, built once. */
  private shapeGeo(key: string, make: () => Shape, team: number): Built {
    const k = `${key}|${team}`;
    let b = this.built.get(k);
    if (!b) {
      b = make().build(team);
      this.built.set(k, b);
    }
    return b;
  }

  private instantiate(def: RigDef, kind: string, team: number): RigInst {
    const tree = rigTree(def);
    const mat = def.organic ? this.organicMat : this.metalMat;
    const glowMat = kind.startsWith('ali_') && BUILDING_RIGS[kind] ? this.hiveGlowMat : this.glowMat;
    const parts: Part[] = [];
    for (const d of tree.drawn) {
      const shape = def.shapes[d.geo];
      if (!shape) continue;
      const key = `${kind}/${d.geo}`;
      const b = this.shapeGeo(key, shape, team);
      parts.push({ obj: d.obj, cargo: d.cargo, lit: b.lit, glow: b.glow, shade: b.shadow ?? null, litKey: `${key}|${team}|L`, glowKey: `${key}|${team}|G`, mat, glowMat });
    }
    return { ...tree, parts };
  }

  private makeUnit(u: RenderUnit): UnitObj {
    const team = OWNER_COLORS[u.owner] ?? 0xffffff;
    const make = UNIT_RIGS[u.kind];
    if (!make) throw new Error(`no 3D model for ${u.kind}`);
    const def = make();
    const d = unitDef(u.kind);
    const root = new THREE.Group();
    const size = d.squad ?? 1;
    const figures: RigInst[] = [];
    for (let i = 0; i < size; i++) {
      const f = this.instantiate(def, u.kind, team);
      f.root.scale.setScalar(def.scale ?? 1);
      root.add(f.root);
      figures.push(f);
    }
    // Armies start facing each other across the map.
    const heading = u.owner === 0 ? Math.PI / 4 : (-3 * Math.PI) / 4;
    const seed = (u.id * 7919) % 1000;
    const members = size > 1 ? figures.map((_, i) => newMember({ x: u.tx, z: u.ty, heading, seed }, i, size)) : [];
    return {
      kind: u.kind,
      def,
      team,
      root,
      figures,
      ringR: def.radius * (size > 1 ? 1 : 0.62),
      drawn: -1,
      motion: restingMotion(heading),
      follow: { x: u.tx, z: u.ty, vx: 0, vz: 0 },
      members,
      fallen: [],
      x: u.tx,
      z: u.ty,
      groundY: this.groundAt(u.tx, u.ty),
      aim: heading,
      aimHold: 0,
      turretYaw: heading,
      turreted: figures[0]!.anims.some((a) => a.anim.k === 'turret') || (size <= 1 && def.move === 'walker' && !!def.weapon),
      reach: turretReach(def),
      figureYaw: figures.map(() => heading),
      lastFire: figures.map(() => -1e9),
      podSince: -1e9,
      muzzleTurn: 0,
      lunge: -1e9,
      load: u.load,
      mineAt: -1e9,
      unloadAt: -1e9,
      docked: false,
      capacity: d.capacity ?? 0,
      tip: 0,
      drum: 0,
      work: 0,
      elev: 0,
      settle: restingSettle(),
      lastPuff: 0,
      alive: size,
      seed,
      dying: null,
      lastDust: 0,
      lastBurn: 0,
    };
  }

  /** Height of the drawn ground at (x, z): the level of the tile whose warped top lies there. */
  private groundAt(x: number, z: number): number {
    // Every tile the warp could have moved here is at one level: no need to undo the warp.
    const lv = (px: number, pz: number): number => this.heights[Math.max(0, Math.min(this.mapH - 1, Math.floor(pz))) * this.mapW + Math.max(0, Math.min(this.mapW - 1, Math.floor(px)))] ?? 0;
    const a = lv(x - EDGE_AMP, z - EDGE_AMP);
    if (a === lv(x + EDGE_AMP, z - EDGE_AMP) && a === lv(x - EDGE_AMP, z + EDGE_AMP) && a === lv(x + EDGE_AMP, z + EDGE_AMP)) return a * LEVEL_H;
    const d = this.liveWarp(x, z);
    const tx = Math.max(0, Math.min(this.mapW - 1, Math.floor(x - d[0])));
    const tz = Math.max(0, Math.min(this.mapH - 1, Math.floor(z - d[1])));
    return (this.heights[tz * this.mapW + tx] ?? 0) * LEVEL_H;
  }

  /** Simulation events: shots aim and fire from the shooter's muzzle (R3D-9); deaths leave wrecks (R3D-12). */
  spawn(e: SimEvent, now: number): void {
    const P = (x: number, y: number): [number, number] => [x / FP, y / FP];
    if (e.t === 'shot') {
      const src = this.units.get(e.src) ?? this.buildings.get(e.src) ?? null;
      const [sx, sz] = P(e.x, e.y);
      const [tx, tz] = P(e.tx, e.ty);
      // Each shot ends at its own point on the target (AIM-3): the target is measured once here, and the shooter's
      // shot count picks the point, so a replayed fight scatters the same way.
      const base = this.measureTarget(tx, tz, e.air);
      const shot = this.shotCount.get(e.src) ?? 0;
      this.shotCount.set(e.src, shot + 1);
      const dx = tx - sx;
      const dz = tz - sz;
      if (e.weapon === 'missile' && src && isUnit(src)) {
        // A salvo (HERO-7): the pods open, then each missile leaves its pod a beat after the last and arcs to its landing.
        if (!e.delay) src.podSince = now;
        const lead = POD_OPEN_MS;
        const to = this.shotEnd(e.src, shot, 0, scatterKind('missile'), tx, base, tz, dx, dz);
        this.missiles.push({ at: now + lead + (e.delay ?? 0) * this.msPerTick, src, side: this.missileTurn++ % 2, to, flightMs: Math.max(80, e.flight * this.msPerTick - lead), elite: e.elite === true });
        return;
      }
      if (src) {
        // The gun still turns to the middle of the target (AIM-1); only where the shot ends is scattered.
        src.aim = Math.atan2(dz, dx);
        src.aimHold = now + 900;
      }
      const look = src?.def.weapon ?? (e.weapon === 'claw' || e.weapon === 'bite' ? 'claw' : e.weapon === 'rocket' ? 'rocket' : e.weapon === 'blast' ? 'howitzer' : 'rifle');
      // A sim splash weapon fired by something drawn with a body look still lands where its damage does.
      const kind = e.weapon === 'blast' ? scatterKind('howitzer') : e.weapon === 'claw' || e.weapon === 'bite' ? scatterKind('claw') : scatterKind(look);
      if (src && isUnit(src)) {
        // Every standing squad member fires from its own weapon, a beat apart, at its own point.
        for (let i = 0; i < src.alive; i++) this.pending.push({ at: now + i * 55, src, figure: i, e, look, to: this.shotEnd(e.src, shot, i, kind, tx, base, tz, dx, dz) });
        if (look === 'claw') src.lunge = now;
      } else this.pending.push({ at: now, src, figure: 0, e, look, to: this.shotEnd(e.src, shot, 0, kind, tx, base, tz, dx, dz) });
      return;
    }
    if (e.t === 'boom') {
      const [x, z] = P(e.x, e.y);
      this.fx.splash(new THREE.Vector3(x, this.groundAt(x, z), z), e.r, now);
      return;
    }
    if (e.t === 'launch') {
      // The superweapon fires from its building, and its target is marked until the strike lands (R3D-16).
      const [x, z] = P(e.x, e.y);
      const [tx, tz] = P(e.tx, e.ty);
      const b = [...this.buildings.values()].find((o) => o.kind === e.kind && Math.hypot(o.x - x, o.z - z) < 2);
      // A launch site out of sight (SW-2) is not shown: only the target is marked.
      const from = e.unseen ? null : new THREE.Vector3(x, b ? b.y : this.groundAt(x, z), z);
      const radius = buildingDef(e.kind).superweapon?.radius ?? 3;
      if (b && !e.unseen) b.lastFire = now;
      this.fx.superweaponLaunch(from, b ? b.def.height : 1.2, new THREE.Vector3(tx, this.groundAt(tx, tz), tz), radius, e.delay * this.msPerTick, !e.kind.startsWith('ali_'), now);
      return;
    }
    if (e.t === 'strike') {
      const [x, z] = P(e.x, e.y);
      this.fx.superweaponStrike(new THREE.Vector3(x, this.groundAt(x, z), z), e.r, !e.kind.startsWith('ali_'), now);
      return;
    }
    if (e.t === 'die') {
      const [x, z] = P(e.x, e.y);
      const at = new THREE.Vector3(x, this.groundAt(x, z), z);
      const u = this.units.get(e.id);
      if (u && !u.dying) {
        const mode = u.def.move === 'air' ? 'crash' : u.def.move === 'walker' ? 'fall' : 'wreck';
        u.dying = { t0: now, mode, side: e.id % 2 ? 1 : -1, boomed: mode !== 'crash' };
        // Run over by a heavy vehicle or a hero (BAL-2, BAL-10): flattened into the ground with dust or ichor.
        if (e.crushed) {
          u.dying.mode = 'crush';
          this.fx.crushed(at, !!u.def.organic, now);
          // A vehicle or walker flattened by a hero (BAL-10) also bursts.
          if (e.big) this.fx.explosion(at.clone().setY(at.y + 0.15), 0.5, now);
          return;
        }
        // A hero goes down in a long, violent death of its own (HERO-3).
        if (e.kind && UNIT_DEFS[e.kind]?.hero) {
          u.dying.mode = 'break';
          u.dying.pieces = this.breakApart(u, e.id);
          this.fx.heroDeath(at, !!u.def.organic, u.def.height * (u.def.scale ?? 1), now);
          return;
        }
        if (mode === 'fall') this.fx.splatter(at.setY(at.y + 0.15), !!u.def.organic, now);
        // Vehicles and big organic bodies throw chunks; infantry and raiders just fall (R3D-27).
        const role = (e.kind ? UNIT_DEFS[e.kind] : undefined)?.role;
        if (mode === 'wreck') this.debris.spawn('vehicle', at, e.id, u.def.radius, u.team, now);
        else if (mode === 'fall' && (role === 'tank' || role === 'artillery' || role === 'harvester' || role === 'scout')) this.debris.spawn('organic', at, e.id, u.def.radius, u.team, now);
        if (mode === 'wreck') this.fx.explosion(at.setY(at.y + 0.2), e.big ? 0.75 : 0.5, now);
        if (mode === 'fall' && e.big) this.fx.explosion(at, 0.45, now, 0x80e020);
        return;
      }
      const b = this.buildings.get(e.id);
      if (b && b.dying === null) {
        b.dying = now;
        const d = buildingDef(b.kind);
        for (let i = 0; i < 5; i++) {
          const off = new THREE.Vector3(((i * 0.37) % 1) * d.w - d.w / 2, 0.4 + (i % 2) * 0.4, ((i * 0.61) % 1) * d.h - d.h / 2);
          this.fx.explosion(new THREE.Vector3(b.x, b.y, b.z).add(off), 0.9 + (i === 0 ? 0.6 : 0), now + i * 140);
        }
        this.debris.spawn('building', { x: b.x, y: b.y, z: b.z }, e.id, (d.w + d.h) / 2, b.team, now);
        this.fx.shake = Math.max(this.fx.shake, 0.12);
        return;
      }
      this.fx.explosion(at, e.big ? 1.1 : 0.5, now);
    }
  }

  /**
   * The target at a shot's aim point, measured into `this.scatterT` (AIM-3): a building whose footprint holds the point,
   * else the nearest drawn unit within reach (an aircraft for an air shot), else a small default. Returns the target's
   * base height; the aim point is `scatterT.aimY` above it: a building's middle, a unit's chest, an aircraft's body.
   */
  private measureTarget(x: number, z: number, air: boolean): number {
    const t = this.scatterT;
    t.air = air;
    this.scatterB = null;
    if (!air) {
      for (const b of this.buildings.values()) {
        const d = buildingDef(b.kind);
        if (Math.abs(x - b.x) <= d.w / 2 && Math.abs(z - b.z) <= d.h / 2) {
          this.scatterB = b;
          t.halfX = d.w / 2;
          t.halfZ = d.h / 2;
          t.height = b.def.height;
          t.aimY = Math.min(0.7, b.def.height * 0.4);
          return b.y;
        }
      }
    }
    let best: UnitObj | null = null;
    let bestD = Infinity;
    for (const u of this.units.values()) {
      if ((u.def.move === 'air') !== air) continue;
      const dd = Math.hypot(u.x - x, u.z - z);
      if (dd < bestD && dd <= u.ringR + 0.6) {
        best = u;
        bestD = dd;
      }
    }
    const h = best ? best.def.height * (best.def.scale ?? 1) : DEFAULT_TARGET.height;
    t.halfX = t.halfZ = best ? best.ringR : DEFAULT_TARGET.halfX;
    t.height = h;
    if (air) {
      t.aimY = 0;
      return AIR_Y + 0.05;
    }
    t.aimY = Math.min(0.2, h * 0.6);
    return this.groundAt(x, z);
  }

  /** Where shot `shot` from `src` (squad figure `figure`) ends: the aim point `base` + `scatterT.aimY`, scattered (AIM-3). */
  private shotEnd(src: number, shot: number, figure: number, kind: ScatterKind, x: number, base: number, z: number, dirX: number, dirZ: number): THREE.Vector3 {
    const t = this.scatterT;
    const o = shotScatter(src, shot, figure, t, kind, this.scatterO, dirX, dirZ);
    let ex = x + o.x;
    let ez = z + o.z;
    let ey = base + t.aimY + o.y;
    const b = this.scatterB;
    if (b && kind === 'body') {
      // On a building the shot ends on the face toward the shooter, not inside the model (AIM-3).
      const w = wallEnd(x - dirX, z - dirZ, ex, ez, b.x, b.z, t.halfX, t.halfZ, o);
      ex = w.x;
      ez = w.z;
    }
    // Never below the ground, even where it rises under the scattered point.
    if (!t.air) ey = Math.max(ey, this.groundAt(ex, ez) + 0.03);
    return new THREE.Vector3(ex, ey, ez);
  }

  /** Fire queued shots from the muzzles, now that this frame's rig matrices are current (R3D-9). */
  private firePending(now: number): void {
    const later: PendingShot[] = [];
    for (const p of this.pending) {
      if (p.at > now) {
        later.push(p);
        continue;
      }
      // A turret fires once it is on target (R3D-9); the shell then flies that much faster, so it lands with the damage.
      const late = now - p.at;
      // A howitzer's shell, flash and recoil wait for its barrel to finish rising (R3D-32); the shell's flight is shortened by the wait.
      if (p.src && (!readyToFire(p.src.turreted, this.gunYawOf(p.src, p.figure), p.src.aim, late) || (isUnit(p.src) && !elevationReady(p.src.def.weapon === 'howitzer', p.src.elev, late)))) {
        later.push(p);
        continue;
      }
      const look = p.look ?? 'rifle';
      const flight = flightAfterWait(p.e.flight * this.msPerTick, late);
      const muzzle = this.muzzleOf(p.src, p.figure);
      // The shooter may not have been drawn this frame (off screen), so bring its matrices up to date first.
      if (p.src && p.src.drawn !== this.frame) {
        p.src.root.updateMatrixWorld(true);
        p.src.drawn = this.frame;
      }
      if (muzzle) {
        muzzle.getWorldPosition(this.v);
        this.v2.setFromMatrixColumn(muzzle.matrixWorld, 0).normalize();
        this.fx.muzzle(look, this.v, this.v2, now);
        this.fx.shot(look, this.v, p.to, flight, now, p.e.elite === true);
      } else {
        // The shooter is not drawn (out of sight): start at its position.
        const from = new THREE.Vector3(p.e.x / FP, this.groundAt(p.e.x / FP, p.e.y / FP) + 0.3, p.e.y / FP);
        this.fx.shot(look, from, p.to, flight, now, p.e.elite === true);
      }
      if (p.src) {
        if (isUnit(p.src)) p.src.lastFire[p.figure] = now;
        else p.src.lastFire = now;
      }
    }
    this.pending = later;
    this.fireMissiles(now);
  }

  /** Launch the salvo missiles that are due, each from its own pod (HERO-7). */
  private fireMissiles(now: number): void {
    if (this.missiles.length === 0) return;
    const later: typeof this.missiles = [];
    for (const m of this.missiles) {
      if (m.at > now) {
        later.push(m);
        continue;
      }
      const rig = m.src.figures[0];
      const pods = rig ? rig.drawn.filter((d) => d.geo === 'pod') : [];
      const pod = pods[m.side % Math.max(1, pods.length)];
      if (m.src.drawn !== this.frame) {
        m.src.root.updateMatrixWorld(true);
        m.src.drawn = this.frame;
      }
      if (pod) {
        // The missile leaves the tube mouths, along the tubes' own (upward) line (HERO-8).
        this.v.set(0.3, 0, 0);
        pod.obj.localToWorld(this.v);
        pod.obj.getWorldPosition(this.v2);
        this.v2.negate().add(this.v).normalize();
        this.fx.muzzle('missile', this.v, this.v2, now);
        this.fx.shot('missile', this.v, m.to, m.flightMs - (now - m.at), now, m.elite);
      } else {
        const from = new THREE.Vector3(m.src.x, this.groundAt(m.src.x, m.src.z) + 1, m.src.z);
        this.fx.shot('missile', from, m.to, m.flightMs - (now - m.at), now, m.elite);
      }
    }
    this.missiles = later;
  }

  /** The world yaw a shooter's gun points along (AIM-1): its turret on its body, or the body itself. */
  private gunYawOf(src: UnitObj | BuildingObj, figure: number): number {
    if (!isUnit(src)) return src.turretYaw;
    const body = src.def.move === 'walker' && src.members.length === 0 ? (src.figureYaw[figure] ?? src.motion.heading) : src.motion.heading;
    return gunYaw(body, src.turretYaw, src.reach);
  }

  private muzzleOf(src: UnitObj | BuildingObj | null, figure: number): THREE.Object3D | null {
    if (!src) return null;
    const rig = isUnit(src) ? src.figures[figure] ?? src.figures[0] : src.rig;
    if (!rig || rig.muzzles.length === 0) return null;
    src.muzzleTurn++;
    return rig.muzzles[src.muzzleTurn % rig.muzzles.length] ?? null;
  }

  /** A projector for `cam`, reused while the camera and viewport stay the same. */
  projector(cam: Camera): Projector {
    const vp = this.viewport;
    const key = `${cam.x}|${cam.y}|${cam.zoom}|${cam.rise ?? ''}|${vp.width}|${vp.height}`;
    if (this.proj?.key === key) return this.proj.p;
    // A separate camera at the asked-for pose, so projecting never moves the one being rendered.
    const cameraRef = this.camera.clone();
    const pose = cameraPose(cam);
    cameraRef.aspect = vp.width / Math.max(1, vp.height);
    cameraRef.updateProjectionMatrix();
    cameraRef.position.set(...pose.position);
    cameraRef.lookAt(...pose.target);
    cameraRef.updateMatrixWorld();
    const { ray, ground: plane, hit } = this;
    const p: Projector = {
      toScreen: (tx, ty, liftPx = 0) => {
        const v = new THREE.Vector3(tx, liftPx / PX_PER_UNIT, ty).project(cameraRef);
        return { x: ((v.x + 1) / 2) * vp.width, y: ((1 - v.y) / 2) * vp.height };
      },
      toGround: (sx, sy) => {
        ray.setFromCamera(new THREE.Vector2((sx / vp.width) * 2 - 1, 1 - (sy / vp.height) * 2), cameraRef);
        return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, y: hit.z } : { x: 0, y: 0 };
      },
    };
    this.proj = { key, p };
    return p;
  }

  private applyCamera(cam: Camera, t: number): void {
    const p = cameraPose(cam);
    this.camera.position.set(...p.position);
    // Explosions shake the view a little (never the projector used for picking).
    const s = this.fx.shake;
    if (s > 0) this.camera.position.add(this.v.set(Math.sin(t * 0.061) * s, Math.sin(t * 0.047 + 1) * s * 0.6, Math.cos(t * 0.053) * s));
    this.camera.lookAt(...p.target);
    this.camera.updateMatrixWorld();
    // The shadow follows the view, so it stays sharp wherever the camera looks.
    // Sun from -X and +Z, as in the classic bake: walls facing screen-left are lit, those facing screen-right shaded.
    // The target snaps to the shadow map's texel grid, so a panning view never makes shadow edges crawl (PERF-3).
    const snap = snapShadowTarget(p.target[0], p.target[2], (2 * SUN_HALF) / SUN_MAP);
    this.sun.position.set(snap.x + SUN_OFFSET[0], SUN_OFFSET[1], snap.z + SUN_OFFSET[2]);
    this.sun.target.position.set(snap.x, 0, snap.z);
    this.projView.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
  }

  private inView(x: number, y: number, z: number, r: number): boolean {
    this.sphere.center.set(x, y, z);
    this.sphere.radius = r + CULL_MARGIN;
    return this.frustum.intersectsSphere(this.sphere);
  }

  update(units: readonly RenderUnit[], cam: Camera, vs: ViewState, snap: Snapshot | null): void {
    const t = vs.time;
    const dt = Math.min(0.1, Math.max(0, (t - (this.lastTime || t)) / 1000));
    this.lastTime = t;
    this.fx.quality = { rich: vs.fx.particles };
    this.applyCamera(cam, t);
    // The distance fog follows the camera out as it pulls back, so the whole map stays clear (CAM-4) and only the land beyond fades into haze (R3D-25).
    if (this.scene.fog instanceof THREE.Fog) {
      const k = Math.max(1, 1 / cam.zoom);
      this.scene.fog.near = FOG_NEAR * k;
      this.scene.fog.far = FOG_FAR * k;
    }
    if (snap) {
      if (snap.tick !== this.lastTick) {
        if (this.lastTick >= 0 && snap.tick > this.lastTick) {
          const per = (t - this.lastTickAt) / (snap.tick - this.lastTick);
          if (per > 5 && per < 500) this.msPerTick += (per - this.msPerTick) * 0.2;
        }
        this.lastTick = snap.tick;
        this.lastTickAt = t;
      }
      if (this.fogTex && this.fogData && snap.fog && snap.tick !== this.lastFogTick) {
        for (let i = 0; i < snap.fog.length; i++) this.fogData[i * 4 + 1] = snap.fog[i]! & 2 ? 0 : snap.fog[i]! & 1 ? 120 : 245;
        this.fogTex.needsUpdate = true;
        this.lastFogTick = snap.tick;
      }
      if (snap.tick !== this.lastShardTick && snap.tick % 4 === 0) {
        this.syncShards(snap);
        this.lastShardTick = snap.tick;
      }
      this.syncBuildings(snap, vs);
    }
    const cpu0 = performance.now();
    this.renderer.info.reset();
    this.frame++;
    this.camRight.setFromMatrixColumn(this.camera.matrixWorld, 0);
    if (this.waterNormal) this.waterNormal.offset.set((t * WATER.driftX) % 1, (t * WATER.driftY) % 1);
    this.inst.begin();
    this.animateUnits(units, vs, snap, t, dt);
    this.animateBuildings(vs, t, dt);
    this.firePending(t);
    this.drawStatics();
    this.drawAcks(vs);
    this.inst.end();
    // Placement ghost and rally line.
    if (vs.placement) {
      const d = buildingDef(vs.placement.kind);
      this.placement.visible = true;
      this.placement.scale.set(d.w, 1, d.h);
      this.placement.position.set(vs.placement.tx + d.w / 2, 0.04, vs.placement.ty + d.h / 2);
      (this.placement.material as THREE.MeshBasicMaterial).color.setHex(vs.placement.ok ? 0x3cff8a : 0xff4a4a);
    } else this.placement.visible = false;
    // The rally point is a tile: the flag stands at its centre.
    const r = vs.rally;
    this.rally.update(r ? { from: r.from, to: { tx: r.to.tx + 0.5, ty: r.to.ty + 0.5 } } : null, OWNER_COLORS[vs.viewer] ?? 0x7ff5cd, t, (x, z) => this.groundAt(x, z));
    this.fx.update(t, dt);
    this.debris.setQuality(vs.fx.particles);
    this.debris.update(t, dt);
    this.applyQuality(vs);
    if (this.frame % (this.res ? shadowEvery(this.res.ratio, this.res.max) : SHADOW_EVERY) === 0) this.renderShadows();
    // The governor needs the CPU's own work, not the time render() spends blocked behind a busy GPU.
    const prep = performance.now() - cpu0;
    this.prepMs += (prep - this.prepMs) * 0.05;
    this.gpuTimer.begin();
    if (this.viaComposer() && this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.gpuTimer.end();
    this.gpuTimer.poll();
    this.cpuMs += (performance.now() - cpu0 - this.cpuMs) * 0.05;
    if (this.res?.step(dt * 1000, this.prepMs, this.gpuTimer.ms)) this.fit();
  }

  /** Render figures for tests and measurement (R3D-29): draws, triangles, CPU time, live particles and debris. */
  stats(): { cpuMs: number; draws: number; tris: number; particles: { smoke: number; glow: number }; debris: number; pr: number; gpuMs: number | null } {
    const i = this.renderer.info.render;
    return { cpuMs: this.cpuMs, draws: i.calls, tris: i.triangles, particles: this.fx.particleCounts, debris: this.debris.active, pr: this.res?.ratio ?? 0, gpuMs: this.gpuTimer.ms };
  }

  /** Draw calls of the last frame and the smoothed CPU time of an update, for the frame-time readout. */
  readout(): string {
    return `${this.renderer.info.render.calls} draws · ${Math.round(this.renderer.info.render.triangles / 1000)}k tris · cpu ${this.cpuMs.toFixed(1)} ms · px ${this.res?.ratio ?? 1}`;
  }

  /** The quality preset (R3D-12): shadows, bloom and decor follow it; programs rebuild when shadows change. */
  private applyQuality(vs: ViewState): void {
    this.scatterGroup.visible = vs.fx.decor;
    let changed = vs.fx.bloom !== this.bloomOn || vs.fx.decor !== this.shadowsOn;
    // High quality is bloom, so it also stands for the other costly extras: surface detail and point lights.
    if (vs.fx.bloom !== this.detailOn) {
      this.detailOn = vs.fx.bloom;
      setSurface(this.metalMat, 'metal', this.detailOn);
      setSurface(this.organicMat, 'organic', this.detailOn);
      this.metalMat.needsUpdate = this.organicMat.needsUpdate = true;
      this.fx.setLights(this.detailOn);
      this.lowRes = !this.detailOn;
      this.fit();
      changed = true;
    }
    if (vs.fx.bloom !== this.bloomOn) {
      this.bloomOn = vs.fx.bloom;
      // Without bloom the chain only tone maps and smooths edges, unless the canvas is multisampled (PERF-5).
      for (const p of this.composer?.passes ?? []) if (p instanceof FinishPass) p.setGlow(this.bloomOn);
      this.fit(); // the canvas follows whether post-processing is on
      // Glowing parts are brighter than white with bloom, so the bloom pass picks them up; plain white without.
      const lv = glowLevels(this.bloomOn);
      this.glowMat.color.setScalar(lv.glow);
      this.hiveGlowMat.color.setScalar(lv.hive);
    }
    if (vs.fx.decor !== this.shadowsOn) {
      this.shadowsOn = vs.fx.decor;
      this.sun.castShadow = vs.fx.decor;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) mat.needsUpdate = true;
      });
    }
    if (changed) this.compileAll();
  }

  private ringAt(x: number, y: number, z: number, r: number, team: number, flash = 0): void {
    this.uiM.compose(this.uiP.set(x, y, z), this.uiQ, this.uiS.set(r, 1, r));
    this.inst.push('ui/ring', this.ringGeo, this.ringMat, false, this.uiM, this.uiC.setHex(team).lerp(this.white, flash * 0.8), 3);
  }

  /** Order acknowledgement markers (UI-13): a ring and a centre dot on the ground, shrinking and fading. */
  private drawAcks(vs: ViewState): void {
    let fade = 0;
    for (const m of vs.acks ?? []) {
      fade = Math.max(fade, 1 - m.k);
      if (!this.inView(m.x, 0, m.y, m.r)) continue;
      const y = this.groundAt(m.x, m.y) + 0.06;
      // A dark edge under a bright ring, so it reads on light ground as well as dark.
      this.uiM.compose(this.uiP.set(m.x, y, m.y), this.uiQ, this.uiS.set(m.r, 1, m.r));
      this.inst.push('ui/ackEdge', this.ackEdge, this.ackMat, false, this.uiM, this.uiC.setRGB(0.012, 0.05, 0.035), 4);
      this.uiP.y += 0.005;
      this.uiM.compose(this.uiP, this.uiQ, this.uiS.set(m.r, 1, m.r));
      this.inst.push('ui/ack', this.ringGeo, this.ackMat, false, this.uiM, this.uiC.setHex(m.color), 5);
      this.uiM.compose(this.uiP, this.uiQ, this.uiS.set(m.r * 0.22, 1, m.r * 0.22));
      this.inst.push('ui/ackDot', this.ackDot, this.ackMat, false, this.uiM, this.uiC.setHex(m.color), 5);
    }
    this.ackMat.opacity = 0.95 * fade;
  }

  /** A health bar facing the camera: a dark back and a coloured fill from the left. */
  private barAt(x: number, y: number, z: number, frac: number, width = 0.62): void {
    const q = this.camera.quaternion;
    const inner = width - 0.04;
    this.uiM.compose(this.uiP.set(x, y, z), q, this.uiS.set(width, 0.07, 1));
    this.inst.push('ui/barBg', this.barGeo, this.barMat, false, this.uiM, this.uiC.setRGB(0.012, 0.03, 0.02), 20);
    this.uiP.addScaledVector(this.camRight, -inner / 2);
    this.uiM.compose(this.uiP, q, this.uiS.set(inner * Math.max(0, frac), 0.045, 1));
    this.inst.push('ui/barFg', this.barFgGeo, this.barMat, false, this.uiM, this.uiC.setHex(frac > 0.5 ? 0x4cd964 : frac > 0.25 ? 0xffcc00 : 0xff3b30), 21);
  }

  /** Queue a rig's parts; its world matrices must be current (the caller updates its root). */
  private drawRig(rig: RigInst, tint: THREE.Color, load: number): void {
    for (const p of rig.parts) {
      if (p.cargo && load <= 0) continue;
      if (p.lit) this.inst.push(p.litKey, p.lit, p.mat, true, p.obj.matrixWorld, tint, 0, p.shade);
      if (p.glow) this.inst.push(p.glowKey, p.glow, p.glowMat, false, p.obj.matrixWorld, tint);
    }
  }

  private animateUnits(units: readonly RenderUnit[], vs: ViewState, snap: Snapshot | null, t: number, dt: number): void {
    const byId = new Map(units.map((u) => [u.id, u]));
    const seen = new Set<number>();
    for (const u of units) {
      seen.add(u.id);
      let o = this.units.get(u.id);
      if (!o) {
        o = this.makeUnit(u);
        this.units.set(u.id, o);
      }
      const def = o.def;
      const air = def.move === 'air';
      // The drawn position rides a spring toward the simulation's, so uneven snapshots never show as jitter (R3D-10).
      follow(o.follow, u.tx, u.ty, dt);
      o.motion = stepMotion(o.motion, o.follow.x - o.x, o.follow.z - o.z, dt, def.turn ?? 4, def.walk?.blend);
      // A unit the simulation turns (a hero, HERO-5) faces exactly where the simulation says, however it is moving.
      o.simFacing = u.yaw !== undefined;
      if (u.yaw !== undefined) o.motion = { ...o.motion, heading: u.yaw };
      o.x = o.follow.x;
      o.z = o.follow.z;
      // Docked on a pad (R3D-22): turn to the refinery's intake, then offload once facing it.
      o.docked = false;
      const dockAt = u.dock !== undefined && snap ? snap.buildings.find((b) => b.id === u.dock) : undefined;
      if (dockAt) {
        const bd = buildingDef(dockAt.kind);
        const frame = dockFrame(dockAt, bd.w, bd.h);
        const want = frame ? dockYaw(u.kind, dockAt.kind, frame, o.x, o.z) : undefined;
        if (want !== undefined) {
          o.motion = { ...o.motion, heading: turnToward(o.motion.heading, want, (def.turn ?? 4) * dt) };
          o.docked = Math.abs(angleDiff(o.motion.heading, want)) < 0.25;
        }
      }
      // Harvesters (R3D-19): a rising load means mining, a falling one unloading.
      if (u.load > o.load) o.mineAt = t;
      else if (u.load < o.load) o.unloadAt = t;
      o.load = u.load;
      o.groundY += (this.groundAt(o.x, o.z) - o.groundY) * Math.min(1, dt * 10);
      const max = maxHpOf(u.kind, u.rank);
      this.setAlive(o, squadAlive(u.kind, u.hp, max), t);
      // Aim: the current target (GFX-10), else a recently fired direction, else straight ahead.
      const tgt = u.target >= 0 ? byId.get(u.target) : undefined;
      const tb = !tgt && u.target >= 0 && snap ? snap.buildings.find((b) => b.id === u.target) : undefined;
      if (tgt) o.aim = Math.atan2(tgt.ty - o.z, tgt.tx - o.x);
      else if (tb) o.aim = Math.atan2(tb.ty + buildingDef(tb.kind).h / 2 - o.z, tb.tx + buildingDef(tb.kind).w / 2 - o.x);
      const aiming = !!tgt || !!tb || t <= o.aimHold;
      o.turretYaw = turnToward(o.turretYaw, aiming ? o.aim : o.motion.heading, TURRET_RATE * dt);
      this.poseUnit(o, aiming, t, dt);
      // UI: selection ring on the ground, health bar over the model (both instanced, R3D-13).
      const sel = vs.selectedUnits.has(u.id);
      const frac = hpFraction(u.hp, u.kind, u.rank);
      if ((sel || frac < 1) && this.inView(o.x, o.groundY, o.z, 0.5)) {
        // The ordered units' rings flash white and wide for a moment (UI-15).
        const fl = vs.flash?.get(u.id) ?? 0;
        if (sel) this.ringAt(o.x, o.groundY + 0.03, o.z, o.ringR * (1 + 0.35 * fl), o.team, fl);
        this.barAt(o.x, o.groundY + def.height * (def.scale ?? 1) + (air ? AIR_Y : 0) + 0.22, o.z, frac);
      }
      // Dust behind moving vehicles (R3D-12).
      if ((def.move === 'tracked' || def.move === 'wheeled') && o.motion.speed > 0.4 && t - o.lastDust > 70 && this.inView(o.x, 0, o.z, 1) && !(this.shardTiles?.[Math.floor(o.z) * this.mapW + Math.floor(o.x)])) {
        o.lastDust = t;
        const h = o.motion.heading;
        this.fx.dust(this.v.set(o.x - Math.cos(h) * def.radius * 0.6, 0, o.z - Math.sin(h) * def.radius * 0.6), def.radius * 1.2, t);
      }
      if (o.capacity > 0) this.harvestFx(u.id, o, t, dt);
      // The hauler's stack puffs dark smoke as it throttles up (R3D-30), now and then.
      if (o.kind === 'hum_hauler' && o.motion.accel > HAULER_PUFF_ACCEL && t - o.lastPuff > HAULER_PUFF_MS && this.inView(o.x, 0, o.z, 1)) {
        o.lastPuff = t;
        const h = o.motion.heading;
        this.fx.burn(this.v.set(o.x + Math.cos(h) * 0.14 - Math.sin(h) * 0.3, o.groundY + 0.72, o.z + Math.sin(h) * 0.14 + Math.cos(h) * 0.3), false, 0.22, t);
      }
      if (this.inView(o.x, o.root.position.y, o.z, def.radius + (o.members.length ? 0.5 : 0))) this.drawUnit(o, this.tint.setRGB(1, 1, 1), t);
    }
    for (const [id, o] of this.units) {
      if (seen.has(id)) continue;
      if (o.dying && this.animateDeath(o, t)) {
        if (this.inView(o.x, 0, o.z, o.def.radius + (o.dying.mode === 'break' ? 3 : 0.5))) this.drawUnit(o, this.tint, t);
        continue;
      }
      // Gone (dead and finished, or out of sight); model geometry stays cached.
      this.units.delete(id);
      // A dead shooter fires no more (one out of sight keeps its count, so its scatter carries on when it returns).
      if (o.dying) this.shotCount.delete(id);
    }
  }

  private drawUnit(o: UnitObj, tint: THREE.Color, t: number): void {
    // Fallen squad members stay where they dropped, topple and sink away (R3D-15).
    if (o.fallen.length) o.fallen = o.fallen.filter((d) => t - d.t0 < FALLEN_MS && d.i >= o.alive);
    for (const d of o.fallen) {
      const f = o.figures[d.i]!;
      const age = t - d.t0;
      const k = Math.min(1, age / 380);
      const sink = Math.max(0, (age - (FALLEN_MS - 1200)) / 1200) * o.def.height * 0.9;
      f.root.position.set(d.x - o.root.position.x, o.groundY - o.root.position.y - sink, d.z - o.root.position.z);
      f.root.rotation.x = d.side * (Math.PI / 2) * k * k;
    }
    o.root.updateMatrixWorld(true); // also brings every figure's parts up to date
    o.drawn = this.frame;
    o.figures.forEach((f, i) => {
      if (i < o.alive) this.drawRig(f, tint, o.load);
    });
    for (const d of o.fallen) this.drawRig(o.figures[d.i]!, this.fallTint.setScalar(1 - 0.5 * Math.min(1, (t - d.t0) / 600)), o.load);
  }

  /**
   * A squad's standing count changed: members who fell stay behind where they stood, members who return (regrowth)
   * appear in place, and everyone re-forms (R3D-15).
   */
  private setAlive(o: UnitObj, alive: number, t: number): void {
    if (alive === o.alive) return;
    if (o.members.length) {
      for (let i = alive; i < o.alive; i++) {
        const m = o.members[i]!;
        o.fallen.push({ i, t0: t, side: (o.seed + i) % 2 ? 1 : -1, x: m.x, z: m.z });
      }
      for (let i = o.alive; i < alive; i++) {
        o.members[i] = newMember({ x: o.x, z: o.z, heading: o.motion.heading, seed: o.seed }, i, o.members.length);
        o.figures[i]!.root.rotation.x = 0;
      }
      for (const m of o.members) m.next = 0;
    }
    o.alive = alive;
  }

  /**
   * A harvester at work (R3D-19). While its load rises it mines: the hauler's cutter drum turns and throws chips into
   * its bed, the gorger chomps at the ground. While its load falls it unloads: the hauler tips its bed and crystals
   * tumble out of the back into the intake, the gorger squeezes its belly and spills a glowing mass at its maw.
   */
  private harvestFx(id: number, o: UnitObj, t: number, dt: number): void {
    const organic = o.kind.startsWith('ali_');
    const fx = Math.cos(o.motion.heading);
    const fz = Math.sin(o.motion.heading);
    const mining = t - o.mineAt < 300;
    // Unloading takes about a second, so the bed snaps up and stays up a moment after the last crystals leave.
    // The simulation says when it is docked and unloading (R3D-22); the bed stays up until it drives off.
    const unloading = !mining && o.docked;
    o.tip += ((unloading ? 1 : 0) - o.tip) * Math.min(1, dt * (unloading ? 9 : 3));
    o.work = slew(o.work, mining ? 1 : 0, dt, HEAD_MS, HEAD_MS);
    if (mining) o.drum += dt * 14;
    if (mining && organic && t - o.lunge > 700) o.lunge = t; // a chomp
    const g = o.groundY;
    if (mining) {
      const from = organic ? this.v.set(o.x + fx * 0.75, g + 0.06, o.z + fz * 0.75) : this.v.set(o.x + fx * 1.0, g + 0.1, o.z + fz * 1.0);
      const into = organic ? this.v2.set(o.x + fx * 0.55, g + 0.32, o.z + fz * 0.55) : this.v2.set(o.x - fx * 0.1, g + 0.7, o.z - fz * 0.1);
      this.fx.harvest(id, from, into, organic, false, t);
    } else if (unloading && t - o.unloadAt < 300 && o.tip > 0.3) {
      const from = organic ? this.v.set(o.x + fx * 0.6, g + 0.3, o.z + fz * 0.6) : this.v.set(o.x - fx * 0.85, g + 0.5, o.z - fz * 0.85);
      const onto = organic ? this.v2.set(o.x + fx * 0.95, g + 0.05, o.z + fz * 0.95) : this.v2.set(o.x - fx * 1.35, g + 0.05, o.z - fz * 1.35);
      this.fx.harvest(id, from, onto, organic, true, t);
    }
  }

  /** Whether the drawn ground at (x, z) is water. */
  private waterAt(x: number, z: number): boolean {
    const d = this.liveWarp(x, z);
    const tx = Math.floor(x - d[0]);
    const tz = Math.floor(z - d[1]);
    if (tx < 0 || tz < 0 || tx >= this.mapW || tz >= this.mapH) return true;
    return (this.heights[tz * this.mapW + tx] ?? 0) === 0 && !!this.blocked?.[tz * this.mapW + tx];
  }

  /** Pose a living unit: hull heading, body pose, gait, wheels, turret, recoil and lunge (R3D-10). */
  private poseUnit(o: UnitObj, aiming: boolean, t: number, dt: number): void {
    const def = o.def;
    const m = o.motion;
    const air = def.move === 'air';
    o.root.position.set(o.x, o.groundY + (air ? AIR_Y : 0), o.z);
    const squad = o.members.length > 0;
    // Squads: every member walks on its own around the squad's position, in world axes (R3D-15).
    o.root.rotation.set(0, squad ? 0 : -m.heading, 0);
    if (squad) {
      const y = this.groundAt(o.x, o.z);
      stepSquad(o.members, {
        x: o.x,
        z: o.z,
        vx: o.follow.vx,
        vz: o.follow.vz,
        heading: m.heading,
        aiming,
        aim: o.aim,
        alive: o.alive,
        t,
        dt,
        seed: o.seed,
        free: (x, z) => Math.abs(this.groundAt(x, z) - y) < 1e-6 && !this.waterAt(x, z),
      });
    }
    // Parts are posed only for units in or near the view (PERF-1); their walk and aim go on off screen, so nothing jumps.
    const posed = this.inView(o.x, o.root.position.y, o.z, def.radius + POSE_MARGIN);
    // A howitzer raises its barrel while it has a target or has fired lately, and lowers it into the lock otherwise (R3D-32).
    // The hauler's nose dips once as it stops and the suspension settles; not while it mines or docks (R3D-30).
    if (o.kind === 'hum_hauler') o.settle = settleStep(o.settle, m.speed, dt, o.docked || o.work > 0.05);
    if (def.weapon === 'howitzer') o.elev = slew(o.elev, elevTarget(aiming, t - Math.max(...o.lastFire)), dt, ELEV_UP_MS, ELEV_DOWN_MS);
    o.figures.forEach((f, i) => {
      if (i >= o.alive) return;
      const mm = squad ? o.members[i]! : null;
      const mo = mm ? mm.motion : m;
      if (!posed) {
        if (!mm && def.move === 'walker') o.figureYaw[i] = o.simFacing ? m.heading : turnToward(o.figureYaw[i] ?? m.heading, walkerFacing(aiming, o.aim, m.heading), 8 * dt);
        return;
      }
      if (mm) {
        f.root.position.set(mm.x - o.x, 0, mm.z - o.z);
        f.root.rotation.set(0, -mm.yaw, 0);
      } else if (def.move === 'walker') {
        // A lone walker faces its target when shooting, walking or not, so its guns point where the shots go (AIM-1).
        // A hero's body turns only as the simulation turns it (HERO-5).
        o.figureYaw[i] = o.simFacing ? m.heading : turnToward(o.figureYaw[i] ?? m.heading, walkerFacing(aiming, o.aim, m.heading), 8 * dt);
        f.root.rotation.y = -((o.figureYaw[i] as number) - m.heading);
      }
      const phase = gaitPhase(mo.dist, def.stride ?? 1) + i * 1.7 + o.seed;
      const pose = bodyPose(def.move, mo, phase, t, o.seed + i, mm ? undefined : def.walk);
      if (o.kind === 'hum_hauler') pose.pitch += o.settle.pitch;
      if (def.ride) {
        const ride = rideMotion(def.ride, mo.stride, t, o.seed + i);
        pose.pitch += ride.pitch;
        pose.roll += ride.roll;
        pose.bob += ride.bob;
      }
      // A hero's whole body heaves with each heavy shot (HERO-4).
      const heave = heroHeave(def.weapon, t - (o.lastFire[i] ?? -1e9));
      poseRig(f, {
        // The turret turns on the body it sits on: a lone walker's body already faces the aim (AIM-1).
        turret: turretOnBody(o.turretYaw, !mm && def.move === 'walker' ? (o.figureYaw[i] ?? m.heading) : m.heading),
        kick: recoil(t - (o.lastFire[i] ?? -1e9)),
        lunge: t - o.lunge < 260 ? Math.sin(((t - o.lunge) / 260) * Math.PI) : 0,
        pitch: pose.pitch + heave.pitch,
        roll: pose.roll,
        bob: pose.bob + heave.bob,
        phase,
        stride: mo.stride,
        dist: mo.dist,
        turnRate: mo.turnRate,
        time: t,
        reach: def.radius * 0.25,
        walker: def.move === 'walker',
        crouch: mm?.crouch ?? 0,
        load: o.capacity > 0 ? o.load / o.capacity : 1,
        tip: o.tip,
        drum: o.drum,
        head: o.work,
        feed: o.work,
        elev: o.elev,
        pod: podOpen(t - o.podSince, salvoOf(o.kind, this.msPerTick)),
      });
    });
  }

  /**
   * Split a dying hero into its parts (HERO-3): each drawn part moves under a pivot at its centre, directly under the
   * unit's root (ground at y 0, Y up), so it can be thrown and spun on its own. Returns the pieces and their flights.
   */
  private breakApart(o: UnitObj, seed: number): { pivot: THREE.Group; plan: Piece }[] {
    o.root.updateMatrixWorld(true);
    const toRoot = new THREE.Matrix4().copy(o.root.matrixWorld).invert();
    const pivots: THREE.Group[] = [];
    const starts: PieceStart[] = [];
    for (const f of o.figures) {
      for (const part of f.parts) {
        const geo = part.lit ?? part.glow;
        if (!geo) continue;
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        const sphere = geo.boundingSphere!;
        const world = part.obj.matrixWorld;
        const c = sphere.center.clone().applyMatrix4(world).applyMatrix4(toRoot);
        const pivot = new THREE.Group();
        pivot.position.copy(c);
        o.root.add(pivot);
        pivot.updateMatrixWorld(true);
        // Keeps the part exactly where it is on screen; parts under an already-moved part are moved after it.
        pivot.attach(part.obj);
        pivots.push(pivot);
        starts.push({ x: c.x, y: c.y, z: c.z, size: sphere.radius * world.getMaxScaleOnAxis() });
      }
    }
    const plans = planBreakup(starts, seed);
    return pivots.map((pivot, i) => ({ pivot, plan: plans[i]! }));
  }

  /** Advance a death; false once it is over (R3D-12). Leaves the unit's tint in `this.tint`. */
  private animateDeath(o: UnitObj, t: number): boolean {
    const d = o.dying!;
    const age = t - d.t0;
    const rich = this.fx.quality.rich;
    const life = d.mode === 'fall' || d.mode === 'crush' ? 2600 : d.mode === 'break' ? (rich ? 9000 : 5000) : rich ? 9000 : 3500;
    if (age > life) return false;
    if (d.mode === 'break') {
      // A hero blown apart (HERO-3): parts thrown out with the blasts, landing, scorched, and sinking away at the end.
      const sink = Math.max(0, (age - (life - 2500)) / 2500) * 0.6;
      for (const b of d.pieces ?? []) {
        const p = pieceAt(b.plan, age);
        b.pivot.position.set(p.x, p.y - sink, p.z);
        b.pivot.quaternion.setFromAxisAngle(this.v.set(b.plan.ax, b.plan.ay, b.plan.az), p.angle);
      }
      this.tint.setScalar(age < BREAK_FIRST_MS ? 1 : Math.max(0.22, 1 - ((age - BREAK_FIRST_MS) / 1500) * 0.78));
      return true;
    }
    if (d.mode === 'crash') {
      // Dive out of the sky nose first, spinning and trailing fire, carried on by its momentum (R3D-12).
      const k = Math.min(1, age / CRASH_MS);
      const h = o.motion.heading;
      const carry = CRASH_CARRY * (1 - (1 - k) ** 2);
      o.root.position.set(o.x + Math.cos(h) * carry, o.groundY + AIR_Y * (1 - k * k) - (k >= 1 ? 0.04 : 0), o.z + Math.sin(h) * carry);
      // The spin winds down as it falls and stops dead on impact: a wreck does not turn on the ground.
      o.root.rotation.set(d.side * 0.55 * k, -h - d.side * 2.4 * (1 - (1 - k) ** 2), -0.6 * k);
      if (k < 1 && t - o.lastBurn > 30) {
        o.lastBurn = t;
        this.fx.burn(this.v.copy(o.root.position).setY(o.root.position.y + 0.1), true, 0.7, t);
      }
      if (k >= 1 && !d.boomed) {
        d.boomed = true;
        this.fx.explosion(this.v.set(o.root.position.x, o.groundY + 0.15, o.root.position.z), 1, t);
        this.fx.shake = Math.max(this.fx.shake, 0.06);
      }
      if (k >= 1) {
        // Then a burning wreck that sinks away at the end, like a vehicle's.
        const life = this.fx.quality.rich ? 9000 : 3500;
        o.root.position.y -= Math.max(0, (age - (life - 2500)) / 2500) * o.def.height;
        if (t - o.lastBurn > 150 && age < life - 1500) {
          o.lastBurn = t;
          this.fx.burn(this.v.set(o.root.position.x, o.groundY + 0.2, o.root.position.z), age < 4000, o.def.radius, t);
        }
      }
      this.tint.setScalar(0.25);
      return true;
    }
    if (d.mode === 'crush') {
      // Flattened at once (BAL-2): the figures squash flat and spread a little, darken, then sink away.
      const k = Math.min(1, age / 120);
      o.figures.forEach((f, i) => {
        if (i < o.alive) f.root.scale.set(1 + 0.3 * k, 1 - 0.88 * k, 1 + 0.3 * k);
      });
      const sink = Math.max(0, (age - 1600) / 1000);
      o.root.position.y = o.groundY - sink * o.def.height * 0.3;
      this.tint.setScalar(1 - 0.6 * k);
      return true;
    }
    if (d.mode === 'fall') {
      // Topple sideways, then sink into the ground.
      const k = Math.min(1, age / 380);
      o.figures.forEach((f, i) => {
        if (i < o.alive) f.root.rotation.x = d.side * (Math.PI / 2) * k * k;
      });
      const sink = Math.max(0, (age - 1400) / 1200);
      o.root.position.y = o.groundY - sink * o.def.height * 0.9;
      this.tint.setScalar(1 - 0.5 * Math.min(1, age / 600));
      return true;
    }
    // Vehicles: a blackened, burning hulk that sinks away at the end.
    const sink = Math.max(0, (age - (life - 2500)) / 2500);
    o.root.position.y = o.groundY - sink * o.def.height;
    if (t - o.lastBurn > 150 && age < life - 1500) {
      o.lastBurn = t;
      this.fx.burn(this.v.set(o.x, o.groundY + o.def.height * 0.6, o.z), age < 4000, o.def.radius, t);
    }
    this.tint.setScalar(0.2);
    return true;
  }

  private syncBuildings(snap: Snapshot, vs: ViewState): void {
    const seen = new Set<number>();
    for (const b of [...snap.buildings, ...snap.ghosts]) {
      seen.add(b.id);
      let o = this.buildings.get(b.id);
      const d = buildingDef(b.kind);
      if (!o) {
        const make = BUILDING_RIGS[b.kind];
        if (!make) continue;
        const def = make();
        const rig = this.instantiate(def, b.kind, OWNER_COLORS[b.owner] ?? 0xffffff);
        const root = new THREE.Group();
        const x = b.tx + d.w / 2;
        const z = b.ty + d.h / 2;
        const y = (snap.heights[b.ty * this.mapW + b.tx] ?? 0) * LEVEL_H;
        root.position.set(x, y, z);
        root.add(rig.root);
        // A refinery's dock stands on the pad the simulation chose, facing out of the building (ECO-7, R3D-22).
        const frame = dockFrame(b, d.w, d.h);
        const dockMake = DOCK_RIGS[b.kind];
        let dock: BuildingObj['dock'] = null;
        if (frame && dockMake) {
          const dockRig = this.instantiate(dockMake(), `${b.kind}_dock`, OWNER_COLORS[b.owner] ?? 0xffffff);
          const dockRoot = new THREE.Group();
          dockRoot.position.set(frame.x, (snap.heights[Math.floor(frame.z) * this.mapW + Math.floor(frame.x)] ?? 0) * LEVEL_H, frame.z);
          dockRoot.rotation.y = dockModelYaw(frame);
          dockRoot.add(dockRig.root);
          dock = { rig: dockRig, root: dockRoot };
        }
        const pts = [[-d.w / 2, -d.h / 2], [d.w / 2, -d.h / 2], [d.w / 2, d.h / 2], [-d.w / 2, d.h / 2]].map(([px, pz]) => new THREE.Vector3(px, 0.05, pz));
        const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x7ff5cd }));
        ring.visible = false;
        ring.position.set(x, y, z);
        this.scene.add(ring);
        // Only the viewer's own new buildings rise from the ground (GFX-1).
        const born = this.seeded && b.owner === vs.viewer && !this.known.has(b.id) ? vs.time : -Infinity;
        const yaw = b.owner === 0 ? Math.PI / 4 : (-3 * Math.PI) / 4;
        o = { kind: b.kind, team: OWNER_COLORS[b.owner] ?? 0xffffff, def, rig, root, ring, born, x, z, y, hpFrac: 1, aim: yaw, aimHold: 0, turretYaw: yaw, turreted: rig.anims.some((a) => a.anim.k === 'turret'), lastFire: -1e9, muzzleTurn: 0, dying: null, lastSmoke: 0, nextSpark: 0, drawn: -1, dock };
        this.buildings.set(b.id, o);
        this.known.add(b.id);
      }
      o.hpFrac = b.hp / Math.max(1, d.hp);
      o.ring.visible = vs.selectedBuilding === b.id;
    }
    this.seeded = true;
    for (const [id, o] of this.buildings) {
      if (seen.has(id)) continue;
      if (o.dying !== null && vs.time - o.dying < 2600) continue;
      this.scene.remove(o.ring);
      o.ring.geometry.dispose();
      (o.ring.material as THREE.Material).dispose();
      this.buildings.delete(id);
      if (o.dying !== null) this.shotCount.delete(id);
    }
  }

  private animateBuildings(vs: ViewState, t: number, dt: number): void {
    const rich = vs.fx.particles;
    for (const [id, o] of this.buildings) {
      const def = o.def;
      const k = Math.min(1, (t - o.born) / 1500);
      let tint = 1;
      o.root.scale.y = Math.max(0.02, 1 - (1 - k) * (1 - k));
      if (o.dying !== null) {
        // Collapse: sink and blacken while fires burn (R3D-12).
        const a = Math.min(1, (t - o.dying) / 2400);
        o.root.position.y = o.y - a * a * def.height * 0.9;
        tint = 1 - 0.75 * Math.min(1, a * 3);
        if (t - o.lastSmoke > 70) {
          o.lastSmoke = t;
          this.fx.burn(this.v.set(o.x, o.y + def.height * (1 - a) * 0.6, o.z), true, def.radius * 0.9, t);
        }
      }
      // Damage shows on the building itself (R3D-18): soot darkens it as it loses health, and a wrecked one sags and
      // its power flickers.
      const look = damageLook(o.hpFrac, t, o.root.id);
      if (o.dying === null) {
        tint *= look.tint;
        o.root.rotation.set(look.lean * (o.root.id % 2 ? 1 : -1), 0, look.lean * (o.root.id % 3 ? 0.6 : -0.6));
      }
      if (t > o.aimHold) o.aim += 0.4 * dt; // idle turrets sweep slowly
      o.turretYaw = turnToward(o.turretYaw, o.aim, TURRET_RATE * dt);
      poseRig(o.rig, { ...STILL, turret: o.turretYaw, kick: recoil(t - o.lastFire), time: t });
      const visible = this.inView(o.x, o.y + def.height / 2, o.z, def.radius + def.height / 2);
      if (visible) {
        o.root.updateMatrixWorld(true);
        o.drawn = this.frame;
        this.drawRig(o.rig, this.tint.setScalar(tint), 1);
      }
      if (o.dock && this.inView(o.dock.root.position.x, o.y, o.dock.root.position.z, 1)) {
        o.dock.root.scale.y = o.root.scale.y;
        if (o.dying === null) o.dock.root.position.y = o.y;
        else o.dock.root.position.y = o.root.position.y;
        o.dock.root.updateMatrixWorld(true);
        this.drawRig(o.dock.rig, this.tint.setScalar(tint), 1);
      }
      if (!visible || o.dying !== null || k < 1) continue;
      // Health bar while selected or below half health (R3D-20), sized to the building.
      if (buildingBar(o.hpFrac, vs.selectedBuilding === id)) {
        const bd = buildingDef(o.kind);
        this.barAt(o.x, o.y + def.height + 0.35, o.z, o.hpFrac, Math.min(1.8, 0.45 * Math.max(bd.w, bd.h)));
      }
      // Damage: smoke below two thirds, fire below one third (GFX-2 thresholds), heavier as it weakens (R3D-20); vents
      // steam on the high preset.
      const sm = damageSmoke(o.hpFrac);
      if (sm.plumes > 0 && t - o.lastSmoke > sm.every) {
        o.lastSmoke = t;
        const bd = buildingDef(o.kind);
        for (let p = 0; p < sm.plumes; p++) {
          // Plumes rise from fixed spots across the roof, different for every building.
          const ox = (((o.root.id * 13 + p * 7) % 10) / 10 - 0.5) * bd.w * 0.6;
          const oz = (((o.root.id * 7 + p * 11) % 10) / 10 - 0.5) * bd.h * 0.6;
          this.fx.buildingDamage(this.v.set(o.x + ox, o.y + def.height * (0.5 + 0.1 * p), o.z + oz), sm.fire && p < 2, sm.scale, t);
        }
      } else if (sm.plumes === 0 && rich && def.vents && t - o.lastSmoke > 110) {
        o.lastSmoke = t;
        for (const v of def.vents) this.fx.steam(this.v.set(o.x + v[0], o.y + v[1], o.z + v[2]), t);
      }
      // Below half health, sparks (Aegis) or spurts of ichor (Vrax) fly from its damaged upper works, more often as it
      // weakens.
      if (look.sparkEvery > 0 && t >= o.nextSpark) {
        const bd = buildingDef(o.kind);
        const r = (o.root.id * 7919 + Math.floor(t)) % 997;
        this.fx.sparks(this.v.set(o.x + ((r % 10) / 10 - 0.5) * bd.w * 0.7, o.y + def.height * (0.5 + ((r >> 3) % 5) / 10), o.z + (((r >> 5) % 10) / 10 - 0.5) * bd.h * 0.7), o.kind.startsWith('ali_'), t);
        o.nextSpark = t + look.sparkEvery * (0.6 + ((r >> 2) % 9) / 10);
      }
    }
  }

  private drawStatics(): void {
    for (const c of this.crystals) {
      if (!this.inView(c.x, c.y, c.z, 0.5)) continue;
      if (!c.b) {
        const level = c.level ?? 1;
        const variant = c.variant ?? 0;
        const key = `crystal/${level}v${variant}`;
        c.b = this.shapeGeo(key, () => crystalShape(level, variant * 31 + level), 0);
        c.litKey = `${key}|L`;
        c.glowKey = `${key}|G`;
      }
      if (c.b.lit) this.inst.push(c.litKey!, c.b.lit, this.crystalMat, true, c.m, undefined, 0, c.b.shadow ?? null);
      if (c.b.glow) this.inst.push(c.glowKey!, c.b.glow, this.glowMat, false, c.m);
    }
    for (const p of this.props) {
      if (!this.inView(p.x, 0, p.z, 0.6)) continue;
      if (!p.b) {
        p.b = this.shapeGeo(p.key, p.make, 0);
        p.litKey = `${p.key}|L`;
        p.glowKey = `${p.key}|G`;
      }
      if (p.b.lit) this.inst.push(p.litKey!, p.b.lit, this.propMat, true, p.m, undefined, 0, p.b.shadow ?? null);
      if (p.b.glow) this.inst.push(p.glowKey!, p.b.glow, this.glowMat, false, p.m);
    }
  }
}
