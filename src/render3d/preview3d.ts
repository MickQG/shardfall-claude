import * as THREE from 'three';
import { UNIT_DEFS, type UnitDef } from '../data/defs';
import { OWNER_COLORS } from '../render/colors';
import { FP, TICKS_PER_SECOND } from '../sim';
import { CombatFx } from './fx3d';
import { bodyPose, ELEV_DOWN_MS, ELEV_UP_MS, elevTarget, HEAD_MS, rideMotion, slew, missileLaunchAt, podOpen, salvoOf, POD_OPEN_MS, follow, heroHeave, gaitPhase, gunYaw, readyToFire, restingMotion, stepMotion, turnToward, turretOnBody, TURRET_RATE, walkerFacing, type Follow, type MotionState } from './motion';
import { poseRig, recoil, rigTree, turretReach, type RigDef, type RigTree } from './rig';
import { newMember, stepSquad, type Member } from './squad3d';
import { BUILDING_RIGS } from './buildings3d';
import { UNIT_RIGS } from './units3d';
import { modelMaterials } from './surface3d';
import { extremePoints, fitPicture, viewDir, type V3 } from './iconFit';

/**
 * Unit previews for the unit sheet (INF-6, INF-8): one small three.js scene that shows a unit's in-game model on a
 * plinth, turning slowly and cycling between moving and working, plus still pictures of every model for the sheet's
 * list. One WebGL context serves both. Render-only; nothing here touches the sim.
 *
 * The unit moves the way it does in a match: a virtual position travels a weaving path at the unit's real speed and
 * the game's own code turns that into motion (the follow spring, hull turning, squat, banking and gait from
 * `motion.ts`, squad members from `squad3d.ts`), while the plinth keeps the unit in the middle like a treadmill.
 * Armed units then fire with the game's muzzle flashes and shots (`fx3d.ts`); harvesters mine and unload instead.
 */

/** Camera field of view, degrees, and its elevation above the plinth, radians. */
export const PREVIEW_FOV = 30;
export const PREVIEW_PITCH = 0.42;
/** Turntable speed, radians per second. */
export const SPIN = 0.45;
/** The yaw a unit starts the sheet's turn at: its front three-quarter faces the camera (the camera stands at azimuth about 0.76), so a hauler's cargo bed and a Gorger's claws show from the first moment. */
export const START_YAW = -0.2;
/** One cycle, ms: moving, coming to a stop, then working (firing, or mining and unloading). */
export const MOVE_MS = 3400;
export const SETTLE_MS = 500;
export const MINE_MS = 2400;
export const CYCLE_MS = 7600;
/** How long a harvester tips out its load, ms (the rest of its unload beat the bed settles back). */
export const UNLOAD_MS = 900;

/**
 * Camera distance that fits a sphere of `radius` in view, `margin` times its size, through the narrower of the vertical
 * and horizontal fields of view of a canvas `aspect` wide (pure).
 */
export function fitDistance(radius: number, aspect = 1, margin = 1.12, fovDeg = PREVIEW_FOV): number {
  const v = (fovDeg * Math.PI) / 180;
  const h = 2 * Math.atan(Math.tan(v / 2) * aspect);
  return (radius * margin) / Math.sin(Math.min(v, h) / 2);
}

export type PreviewAct = 'move' | 'settle' | 'fire' | 'mine' | 'unload';

/**
 * What a preview shows at time `t` (ms since it opened), pure: it moves along a weaving course (`steer`, the
 * direction of travel in radians), stops, then works. Armed units fire; harvesters, which have no weapon, mine and
 * then unload. `into` is how long the current beat has run, ms.
 */
export function previewBeat(t: number, harvester: boolean): { act: PreviewAct; into: number; steer: number } {
  const c = ((t % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
  if (c < MOVE_MS) return { act: 'move', into: c, steer: 0.55 * Math.sin((2 * Math.PI * c) / MOVE_MS) };
  if (c < MOVE_MS + SETTLE_MS) return { act: 'settle', into: c - MOVE_MS, steer: 0 };
  const w = c - MOVE_MS - SETTLE_MS;
  if (!harvester) return { act: 'fire', into: w, steer: 0 };
  return w < MINE_MS ? { act: 'mine', into: w, steer: 0 } : { act: 'unload', into: w - MINE_MS, steer: 0 };
}

/** A unit's speed in a match, tiles per second (its definition's speed is fixed-point units per tick). */
export const tilesPerSecond = (speed: number): number => (speed * TICKS_PER_SECOND) / FP;

/**
 * The preview's travel pace as a share of match speed (INF-6). The close-up camera makes match speed look hurried, so
 * the unit strolls at under half of it; the gait, turning and body motion still come from the game's own code.
 */
export const PREVIEW_PACE = 0.42;

/** Time between a unit's shots in a match, ms (its weapon cooldown), but at least 450 ms so each one reads. */
export const shotEvery = (d: UnitDef): number => Math.max(450, ((d.weapon?.cooldown ?? 20) * 1000) / TICKS_PER_SECOND);

/** Formation of squad figures on the plinth (tiles), first figure in front. */
const SQUAD_SLOTS: readonly (readonly [number, number])[] = [
  [0.22, 0],
  [-0.18, -0.3],
  [-0.18, 0.3],
  [-0.5, 0],
];

interface Model {
  kind: string;
  group: THREE.Group;
  trees: RigTree[];
  def: RigDef;
  radius: number;
  centreY: number;
}

/** A playing preview's state: the same quantities the game keeps for a unit on the map (view3d's UnitObj). */
interface Live {
  /** The virtual position the unit travels to, and its drawn (spring-followed) position, tiles. */
  tx: number;
  tz: number;
  follow: Follow;
  motion: MotionState;
  members: Member[];
  figureYaw: number;
  turretYaw: number;
  aim: number;
  lastFire: number[];
  lunge: number;
  nextShot: number;
  muzzleTurn: number;
  pending: { at: number; figure: number }[];
  /** The Paladin's pods in the preview (HERO-8): when the salvo started and the missiles still to leave, ms. */
  podSince: number;
  missiles: number[];
  load: number;
  tip: number;
  drum: number;
  /** Harvest head lowered / feeding, and the howitzer's barrel elevation, 0..1 (R3D-30..32). */
  work: number;
  elev: number;
  act: PreviewAct | '';
}

const SEED = 11;

export class UnitPreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(PREVIEW_FOV, 1, 0.05, 100);
  private mats = modelMaterials();
  private metal = this.mats.metal;
  private organic = this.mats.organic;
  private glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  private plinth: THREE.Mesh;
  private rim: THREE.Mesh;
  private geos = new Map<string, { lit: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null }>();
  private model: Model | null = null;
  private live: HTMLCanvasElement | null = null;
  private raf = 0;
  private start = 0;
  private last = 0;
  private owner = 0;
  private state: Live | null = null;
  /** The game's combat and harvest effects (R3D-9, R3D-19), drawn in the preview's scene. */
  private fx = new CombatFx();
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(new THREE.HemisphereLight(0xc4d6ff, 0x2a2620, 1.1));
    const key = new THREE.DirectionalLight(0xffe6c4, 2.6);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -3;
    key.shadow.camera.right = key.shadow.camera.top = 3;
    key.shadow.bias = -0.0005;
    this.scene.add(key);
    const back = new THREE.DirectionalLight(0x8fd8ff, 1.3);
    back.position.set(-4, 3, -5);
    this.scene.add(back);
    this.plinth = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.04, 0.08, 64), new THREE.MeshStandardMaterial({ color: 0x16202a, roughness: 0.7, metalness: 0.3 }));
    this.plinth.position.y = -0.04;
    this.plinth.receiveShadow = true;
    this.scene.add(this.plinth);
    this.rim = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.018, 96), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, toneMapped: false, side: THREE.DoubleSide }));
    this.rim.rotation.x = -Math.PI / 2;
    this.rim.position.y = 0.002;
    this.scene.add(this.rim);
    this.scene.add(this.fx.root);
  }

  /** Whether a WebGL context could be created (INF-8: the sheet works without pictures otherwise). */
  static create(): UnitPreview | null {
    try {
      return new UnitPreview();
    } catch {
      return null;
    }
  }

  private geo(kind: string, def: RigDef, name: string, team: number): { lit: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null } {
    const k = `${kind}/${name}|${team}`;
    let g = this.geos.get(k);
    if (!g) {
      const make = def.shapes[name];
      g = make ? make().build(team) : { lit: null, glow: null };
      this.geos.set(k, g);
    }
    return g;
  }

  private build(kind: string, owner: number): Model {
    const make = UNIT_RIGS[kind] ?? BUILDING_RIGS[kind];
    if (!make) throw new Error(`no 3D model for ${kind}`);
    const def = make();
    const team = OWNER_COLORS[owner] ?? 0xffffff;
    const group = new THREE.Group();
    const n = UNIT_DEFS[kind]?.squad ?? 1;
    const trees: RigTree[] = [];
    for (let i = 0; i < n; i++) {
      const tree = rigTree(def);
      for (const d of tree.drawn) {
        const g = this.geo(kind, def, d.geo, team);
        if (g.lit) {
          const m = new THREE.Mesh(g.lit, def.organic ? this.organic : this.metal);
          m.castShadow = true;
          m.receiveShadow = true;
          d.obj.add(m);
        }
        if (g.glow) d.obj.add(new THREE.Mesh(g.glow, this.glow));
      }
      const slot = n > 1 ? (SQUAD_SLOTS[i] ?? [0, 0]) : [0, 0];
      tree.root.position.set(slot[0]!, 0, slot[1]!);
      tree.root.scale.setScalar(def.scale ?? 1);
      group.add(tree.root);
      trees.push(tree);
    }
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    // Squad members wander up to SQUAD_SPREAD (0.45 tiles) from the squad's spot, so leave room for that.
    const radius = Math.max(0.35, Math.hypot(size.x, size.z) / 2, size.y * 0.6, n > 1 ? 0.75 : 0);
    return { kind, group, trees, def, radius, centreY: Math.max(0.15, size.y * 0.45) };
  }

  private show(m: Model, owner: number): void {
    if (this.model) this.scene.remove(this.model.group);
    this.model = m;
    this.scene.add(m.group);
    const r = m.radius;
    this.plinth.scale.set(r * 1.25, 1, r * 1.25);
    this.rim.scale.set(r * 1.25, r * 1.25, 1);
    (this.rim.material as THREE.MeshBasicMaterial).color.setHex(OWNER_COLORS[owner] ?? 0xffffff);
  }

  /** Point the camera at the model so it fills a canvas `aspect` wide. */
  private frame(aspect: number, margin: number): void {
    const m = this.model;
    if (!m) return;
    const fit = this.pictureFit;
    if (fit) {
      // A button picture (UI-17): aimed and backed off to fit the model's own bounds.
      const dir = viewDir(PREVIEW_PITCH);
      this.camera.position.set(fit.target[0] + dir[0] * fit.dist, fit.target[1] + dir[1] * fit.dist, fit.target[2] + dir[2] * fit.dist);
      this.camera.lookAt(fit.target[0], fit.target[1], fit.target[2]);
      this.camera.near = fit.dist / 20;
      this.camera.far = fit.dist * 6;
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
      return;
    }
    const d = fitDistance(m.radius, aspect, margin);
    this.camera.position.set(Math.cos(PREVIEW_PITCH) * d * 0.72, m.centreY + Math.sin(PREVIEW_PITCH) * d, Math.cos(PREVIEW_PITCH) * d * 0.69);
    this.camera.lookAt(0, m.centreY, 0);
    this.camera.near = d / 20;
    this.camera.far = d * 6;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** A point `fwd` tiles ahead of the unit (along `angle`), `up` above the plinth, in the scene (into `out`). */
  private ahead(angle: number, fwd: number, up: number, out: THREE.Vector3): THREE.Vector3 {
    const m = this.model;
    out.set(Math.cos(angle) * fwd, up, Math.sin(angle) * fwd);
    return m ? m.group.localToWorld(out) : out;
  }

  /** A still pose for pictures and reduced motion: standing in formation, turret a little to the side, bed full. */
  private poseStill(): void {
    const m = this.model;
    if (!m) return;
    const n = m.trees.length;
    m.trees.forEach((tree, i) => {
      const slot = n > 1 ? (SQUAD_SLOTS[i] ?? [0, 0]) : [0, 0];
      tree.root.position.set(slot[0]!, 0, slot[1]!);
      tree.root.rotation.set(0, 0, 0);
      poseRig(tree, { turret: 0.3, kick: 0, lunge: 0, pitch: 0, roll: 0, bob: 0, phase: i * 1.7, stride: 0, dist: 0, turnRate: 0, time: 0, reach: m.def.radius * 0.25, walker: m.def.move === 'walker', crouch: n > 1 ? i % 2 : 0, load: 1 });
    });
  }

  /**
   * Advance a playing preview one frame (`now` ms on the page clock, `t` ms since it opened, `dt` s), as the game
   * advances a unit on the map: travel, hull and turret, squad members, firing or harvesting, then the rig's pose.
   */
  private step(now: number, t: number, dt: number): void {
    const m = this.model;
    const s = this.state;
    if (!m || !s) return;
    const d = UNIT_DEFS[m.kind];
    const def = m.def;
    const harvester = (d?.capacity ?? 0) > 0;
    const beat = previewBeat(t, harvester);
    if (beat.act !== s.act) {
      if (beat.act === 'fire') s.nextShot = now + 250;
      s.act = beat.act;
    }
    // Travel: the virtual position runs at the unit's match speed; the drawn one follows it as on the map (R3D-10).
    if (beat.act === 'move') {
      const v = tilesPerSecond(d?.speed ?? 30) * PREVIEW_PACE * dt;
      s.tx += Math.cos(beat.steer) * v;
      s.tz += Math.sin(beat.steer) * v;
    }
    const px = s.follow.x;
    const pz = s.follow.z;
    follow(s.follow, s.tx, s.tz, dt);
    s.motion = stepMotion(s.motion, s.follow.x - px, s.follow.z - pz, dt, def.turn ?? 4, def.walk?.blend);
    const mo = s.motion;
    // Working: the aim sweeps a little either side of the hull, as if picking targets.
    const firing = beat.act === 'fire';
    s.aim = mo.heading + 0.45 * Math.sin(now / 900);
    s.turretYaw = turnToward(s.turretYaw, firing ? s.aim : mo.heading, TURRET_RATE * dt);
    const squad = s.members.length > 0;
    if (squad) {
      stepSquad(s.members, { x: s.follow.x, z: s.follow.z, vx: s.follow.vx, vz: s.follow.vz, heading: mo.heading, aiming: firing, aim: s.aim, alive: s.members.length, t: now, dt, seed: SEED, free: () => true });
    } else if (def.move === 'walker') s.figureYaw = turnToward(s.figureYaw, walkerFacing(firing, s.aim, mo.heading), 8 * dt);
    // Shots, as the game fires them: once the turret is on target, every standing figure a beat apart (R3D-9).
    if (firing && def.weapon && now >= s.nextShot) {
      // As in a match (AIM-1): a turret or a lone walker's body must point at the aim before the shot leaves.
      const reach = turretReach(def);
      const turreted = reach > 0 || (!squad && def.move === 'walker');
      const body = !squad && def.move === 'walker' ? s.figureYaw : mo.heading;
      if (readyToFire(turreted, gunYaw(body, s.turretYaw, reach), s.aim, now - s.nextShot)) {
        for (let i = 0; i < m.trees.length; i++) s.pending.push({ at: now + i * 55, figure: i });
        if (def.weapon === 'claw') s.lunge = now;
        s.nextShot = now + (d ? shotEvery(d) : 1000);
      }
    }
    // A howitzer raises its barrel while it has a target or has fired lately (R3D-32).
    if (def.weapon === 'howitzer') s.elev = slew(s.elev, elevTarget(firing, now - Math.max(-1e9, ...s.lastFire)), dt, ELEV_UP_MS, ELEV_DOWN_MS);
    // Harvesting (R3D-19): the cutter turns and the bed fills, then the bed tips and empties.
    if (harvester) {
      const organic = !!def.organic;
      const mining = beat.act === 'mine';
      const unloading = beat.act === 'unload' && beat.into < UNLOAD_MS;
      s.tip += ((unloading ? 1 : 0) - s.tip) * Math.min(1, dt * (unloading ? 9 : 3));
      s.work = slew(s.work, mining ? 1 : 0, dt, HEAD_MS, HEAD_MS);
      const h = mo.heading;
      if (mining) {
        s.drum += dt * 14;
        s.load = Math.min(1, s.load + (dt * 1000) / MINE_MS);
        if (organic && now - s.lunge > 700) s.lunge = now; // a chomp
        this.fx.harvest(1, organic ? this.ahead(h, 0.75, 0.06, this.v) : this.ahead(h, 1.0, 0.1, this.v), organic ? this.ahead(h, 0.55, 0.32, this.v2) : this.ahead(h, -0.1, 0.7, this.v2), organic, false, now);
      } else if (unloading) {
        s.load = Math.max(0, s.load - (dt * 1000) / UNLOAD_MS);
        if (s.tip > 0.3) this.fx.harvest(1, organic ? this.ahead(h, 0.6, 0.3, this.v) : this.ahead(h, -0.85, 0.5, this.v), organic ? this.ahead(h, 0.95, 0.05, this.v2) : this.ahead(h, -1.35, 0.05, this.v2), organic, true, now);
      }
    }
    // The rig, posed exactly as poseUnit poses it in a match.
    const walker = def.move === 'walker';
    m.trees.forEach((tree, i) => {
      const mm = squad ? s.members[i]! : null;
      const fm = mm ? mm.motion : mo;
      if (mm) {
        tree.root.position.set(mm.x - s.follow.x, 0, mm.z - s.follow.z);
        tree.root.rotation.set(0, -mm.yaw, 0);
      } else {
        tree.root.position.set(0, 0, 0);
        tree.root.rotation.set(0, -(walker ? s.figureYaw : mo.heading), 0);
      }
      const phase = gaitPhase(fm.dist, def.stride ?? 1) + i * 1.7 + SEED;
      const pose = bodyPose(def.move, fm, phase, now, SEED + i, mm ? undefined : def.walk);
      if (def.ride) {
        const ride = rideMotion(def.ride, fm.stride, now, SEED + i);
        pose.pitch += ride.pitch;
        pose.roll += ride.roll;
        pose.bob += ride.bob;
      }
      const heave = heroHeave(def.weapon, now - (s.lastFire[i] ?? -1e9));
      poseRig(tree, {
        turret: turretOnBody(s.turretYaw, !mm && walker ? s.figureYaw : mo.heading),
        kick: recoil(now - (s.lastFire[i] ?? -1e9)),
        lunge: now - s.lunge < 260 ? Math.sin(((now - s.lunge) / 260) * Math.PI) : 0,
        pitch: pose.pitch + heave.pitch,
        roll: pose.roll,
        bob: pose.bob + heave.bob,
        phase,
        stride: fm.stride,
        dist: fm.dist,
        turnRate: fm.turnRate,
        time: now,
        reach: def.radius * 0.25,
        walker,
        crouch: mm?.crouch ?? 0,
        load: harvester ? s.load : 1,
        tip: s.tip,
        drum: s.drum,
        head: s.work,
        feed: s.work,
        elev: s.elev,
        pod: UNIT_DEFS[m.kind]?.weapon2 ? podOpen(now - s.podSince, salvoOf(m.kind, 1000 / TICKS_PER_SECOND)) : 0,
      });
    });
    m.group.rotation.y = START_YAW + (t / 1000) * SPIN;
    m.group.updateMatrixWorld(true);
    this.firePending(now);
    this.fx.update(now, dt);
  }

  /** Fire the shots now due from their figures' muzzles, with the game's flash and shot (R3D-9). */
  private firePending(now: number): void {
    const m = this.model;
    const s = this.state;
    if (!m || !s || !m.def.weapon) return;
    const look = m.def.weapon;
    const w = UNIT_DEFS[m.kind]?.weapon;
    const flight = ((w?.flight ?? 0) * 1000) / TICKS_PER_SECOND;
    const melee = look === 'claw';
    s.pending = s.pending.filter((p) => {
      if (p.at > now) return true;
      const tree = m.trees[p.figure];
      if (!tree) return false;
      // Shots fly out to the weapon's real range, off the plinth, as at a target in a match; claws strike just ahead.
      const reach = melee ? m.def.radius + 0.3 : Math.max(m.radius * 2, w?.range ?? 5);
      const to = this.ahead(s.aim, reach, 0.05, new THREE.Vector3());
      const muzzle = tree.muzzles.length ? tree.muzzles[s.muzzleTurn++ % tree.muzzles.length] : undefined;
      if (muzzle) {
        muzzle.getWorldPosition(this.v);
        this.v2.setFromMatrixColumn(muzzle.matrixWorld, 0).normalize();
        // The shot goes where the barrel points (AIM-1): out along its line to the weapon's range, down to the ground.
        if (!melee) {
          const flat = Math.hypot(this.v2.x, this.v2.z) || 1;
          to.set(this.v.x + (this.v2.x / flat) * reach, to.y, this.v.z + (this.v2.z / flat) * reach);
        }
        this.fx.muzzle(look, this.v, this.v2, now);
        this.fx.shot(look, this.v, to, flight, now);
      } else this.fx.shot(look, tree.root.getWorldPosition(this.v).setY(0.3), to, flight, now);
      s.lastFire[p.figure] = now;
      const pod = UNIT_DEFS[m.kind]?.weapon2;
      if (pod && now - s.podSince > (pod.cooldown * 1000) / TICKS_PER_SECOND) {
        // The pods open and send their salvo up out of the tubes with the cannon's shot (HERO-8, same as in a match).
        const v = salvoOf(m.kind, 1000 / TICKS_PER_SECOND);
        s.podSince = now;
        s.missiles = Array.from({ length: v.count }, (_, i) => now + missileLaunchAt(v, i));
      }
      return false;
    });
    this.fireMissiles(now);
  }

  /** Launch the salvo missiles that are due from the tube mouths of the pods, one pod after the other (HERO-8). */
  private fireMissiles(now: number): void {
    const m = this.model;
    const s = this.state;
    if (!m || !s || s.missiles.length === 0) return;
    const w = UNIT_DEFS[m.kind]?.weapon2;
    const tree = m.trees[0];
    if (!w || !tree) return;
    const pods = tree.drawn.filter((d) => d.geo === 'pod');
    const flightMs = Math.max(80, ((w.flight ?? 1) * 1000) / TICKS_PER_SECOND - POD_OPEN_MS);
    const later: number[] = [];
    for (const at of s.missiles) {
      if (at > now) {
        later.push(at);
        continue;
      }
      const pod = pods[s.muzzleTurn++ % Math.max(1, pods.length)];
      if (!pod) continue;
      this.v.set(0.3, 0, 0);
      pod.obj.localToWorld(this.v);
      pod.obj.getWorldPosition(this.v2);
      this.v2.negate().add(this.v).normalize();
      const to = this.ahead(s.aim, Math.max(m.radius * 2, w.range), 0.05, new THREE.Vector3());
      this.fx.muzzle('missile', this.v, this.v2, now);
      this.fx.shot('missile', this.v, to, flightMs - (now - at), now);
    }
    s.missiles = later;
  }

  /** Set while a button picture is drawn: the camera's aim and distance (UI-17). */
  private pictureFit: { target: V3; dist: number } | null = null;

  private draw(canvas: HTMLCanvasElement, margin = 1.32): void {
    const w = Math.max(1, canvas.clientWidth || canvas.width);
    const h = Math.max(1, canvas.clientHeight || canvas.height);
    const pr = this.renderer.getPixelRatio();
    if (this.renderer.domElement.width !== Math.round(w * pr) || this.renderer.domElement.height !== Math.round(h * pr)) this.renderer.setSize(w, h, false);
    this.frame(w / h, margin);
    this.fx.setScale((h * pr) / (2 * Math.tan((PREVIEW_FOV * Math.PI) / 360)));
    this.renderer.render(this.scene, this.camera);
    const g = canvas.getContext('2d');
    if (!g) return;
    if (canvas.width !== Math.round(w * pr) || canvas.height !== Math.round(h * pr)) {
      canvas.width = Math.round(w * pr);
      canvas.height = Math.round(h * pr);
    }
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(this.renderer.domElement, 0, 0, canvas.width, canvas.height);
  }

  /** A still picture of a unit (INF-6) or a building (UI-17), three-quarter view, as a PNG data URL of `w` by `h` CSS pixels. With no `margin` the whole model is fitted with ICON_EDGE clear on its tighter sides, with no plinth; a `margin` is the older sphere fit. */
  picture(kind: string, owner: number, w: number, h: number, margin?: number): string {
    const keep = this.model;
    const keepOwner = this.owner;
    const m = this.build(kind, owner);
    this.show(m, owner);
    this.poseStill();
    m.group.rotation.y = -0.35;
    this.fx.root.visible = false;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    this.renderer.setPixelRatio(1);
    if (margin === undefined) {
      m.group.updateMatrixWorld(true);
      // No plinth or ring in these pictures, and the fit uses the model's visible vertices only (never a hidden object or a box around it).
      this.plinth.visible = false;
      this.rim.visible = false;
      this.pictureFit = fitPicture(fitPoints(m.group), viewDir(PREVIEW_PITCH), PREVIEW_FOV, w / h);
    }
    try {
      this.draw(c, margin ?? 1);
    } finally {
      this.pictureFit = null;
      this.plinth.visible = true;
      this.rim.visible = true;
    }
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.fx.root.visible = true;
    this.scene.remove(m.group);
    this.model = null;
    if (keep) this.show(keep, keepOwner);
    return c.toDataURL('image/png');
  }

  /** Show `kind` animated in `canvas` until `stop` (INF-6). */
  play(kind: string, owner: number, canvas: HTMLCanvasElement): void {
    this.stop();
    this.live = canvas;
    this.owner = owner;
    const m = this.build(kind, owner);
    this.show(m, owner);
    const n = m.trees.length;
    this.state = {
      tx: 0,
      tz: 0,
      follow: { x: 0, z: 0, vx: 0, vz: 0 },
      motion: restingMotion(0),
      members: n > 1 ? m.trees.map((_, i) => newMember({ x: 0, z: 0, heading: 0, seed: SEED }, i, n)) : [],
      figureYaw: 0,
      turretYaw: 0,
      aim: 0,
      lastFire: [],
      lunge: -1e9,
      nextShot: Infinity,
      muzzleTurn: 0,
      pending: [],
      podSince: -1e9,
      missiles: [],
      load: 0,
      tip: 0,
      drum: 0,
      work: 0,
      elev: 0,
      act: '',
    };
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const frame = (now: number): void => {
      if (!this.live) return;
      if (!this.start) this.start = this.last = now;
      if (reduce) {
        this.poseStill();
        m.group.rotation.y = -0.35;
      } else this.step(now, now - this.start, Math.min(0.05, (now - this.last) / 1000));
      this.last = now;
      this.draw(this.live);
      this.raf = requestAnimationFrame(frame);
    };
    this.start = 0;
    this.raf = requestAnimationFrame(frame);
  }


  stop(): void {
    cancelAnimationFrame(this.raf);
    this.live = null;
  }

  /** Free the models and the WebGL context (a temporary preview that drew its pictures, UI-17). */
  dispose(): void {
    this.stop();
    for (const g of this.geos.values()) {
      g.lit?.dispose();
      g.glow?.dispose();
    }
    this.geos.clear();
    this.plinth.geometry.dispose();
    this.rim.geometry.dispose();
    for (const m of [this.metal, this.organic, this.glow]) m.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

/**
 * The points a button picture is fitted to (UI-17): the extreme vertices, in world space, of every visible mesh under `root`.
 * Objects that are hidden, or sit under a hidden parent, and anything that is not a mesh (sprites, helpers, lights) count for nothing.
 */
export function fitPoints(root: THREE.Object3D): V3[] {
  root.updateMatrixWorld(true);
  const xyz: number[] = [];
  const v = new THREE.Vector3();
  root.traverseVisible((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      xyz.push(v.x, v.y, v.z);
    }
  });
  return extremePoints(xyz);
}

/** A kind's fit points at rest, tiles (squads in their preview formation), for the button-picture fit's test (UI-17). Needs no GPU. */
export function restFitPoints(kind: string): V3[] {
  const make = UNIT_RIGS[kind] ?? BUILDING_RIGS[kind];
  if (!make) throw new Error(`no 3D model for ${kind}`);
  const def = make();
  const n = UNIT_DEFS[kind]?.squad ?? 1;
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial();
  for (let i = 0; i < n; i++) {
    const tree = rigTree(def);
    for (const d of tree.drawn) {
      const b = def.shapes[d.geo]?.().build(0xffffff);
      for (const g of [b?.lit, b?.glow]) if (g) d.obj.add(new THREE.Mesh(g, mat));
    }
    const slot = n > 1 ? (SQUAD_SLOTS[i] ?? [0, 0]) : [0, 0];
    tree.root.position.set(slot[0]!, 0, slot[1]!);
    tree.root.scale.setScalar(def.scale ?? 1);
    group.add(tree.root);
  }
  group.rotation.y = -0.35;
  return fitPoints(group);
}
