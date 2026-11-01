import * as THREE from 'three';
import { UNIT_DEFS } from '../data/defs';
import { OWNER_COLORS } from '../render/colors';
import { gaitPhase } from './motion';
import { poseRig, rigTree, type RigDef, type RigPose, type RigTree } from './rig';
import { UNIT_RIGS } from './units3d';

/**
 * Unit previews for the unit sheet (INF-6, INF-8): one small three.js scene that shows a unit's in-game model on a
 * plinth, turning slowly and cycling between walking (or rolling) and firing, plus still pictures of every model for
 * the sheet's list. One WebGL context serves both. Render-only; nothing here touches the sim.
 */

/** Camera field of view, degrees, and its elevation above the plinth, radians. */
export const PREVIEW_FOV = 30;
export const PREVIEW_PITCH = 0.42;
/** Turntable speed, radians per second, and the length of one walk-then-fire cycle, ms. */
export const SPIN = 0.45;
export const CYCLE_MS = 5200;

/**
 * Camera distance that fits a sphere of `radius` in view, `margin` times its size, through the narrower of the vertical
 * and horizontal fields of view of a canvas `aspect` wide (pure).
 */
export function fitDistance(radius: number, aspect = 1, margin = 1.12, fovDeg = PREVIEW_FOV): number {
  const v = (fovDeg * Math.PI) / 180;
  const h = 2 * Math.atan(Math.tan(v / 2) * aspect);
  return (radius * margin) / Math.sin(Math.min(v, h) / 2);
}

/**
 * What a preview shows at time `t` (ms since it opened): the first half of each cycle the unit walks or rolls on the
 * spot, the second half it stands and fires every 700 ms, its turret sweeping a little (pure).
 */
export function previewAction(t: number): { moving: boolean; sinceShot: number } {
  const c = t % CYCLE_MS;
  if (c < CYCLE_MS / 2) return { moving: true, sinceShot: 1e9 };
  return { moving: false, sinceShot: (c - CYCLE_MS / 2) % 700 };
}

/** Formation of squad figures on the plinth (tiles), first figure in front. */
const SQUAD_SLOTS: readonly (readonly [number, number])[] = [
  [0.22, 0],
  [-0.18, -0.3],
  [-0.18, 0.3],
  [-0.5, 0],
];

interface Model {
  group: THREE.Group;
  trees: RigTree[];
  def: RigDef;
  radius: number;
  centreY: number;
}

export class UnitPreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(PREVIEW_FOV, 1, 0.05, 100);
  private metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.38 });
  private organic = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.05 });
  private glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  private plinth: THREE.Mesh;
  private rim: THREE.Mesh;
  private geos = new Map<string, { lit: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null }>();
  private model: Model | null = null;
  private live: HTMLCanvasElement | null = null;
  private raf = 0;
  private start = 0;
  private last = 0;
  private dist = 0;
  private modelSpeed = 30;
  private owner = 0;

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
    const make = UNIT_RIGS[kind];
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
    const radius = Math.max(0.35, Math.hypot(size.x, size.z) / 2, size.y * 0.6);
    return { group, trees, def, radius, centreY: Math.max(0.15, size.y * 0.45) };
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
    const d = fitDistance(m.radius, aspect, margin);
    this.camera.position.set(Math.cos(PREVIEW_PITCH) * d * 0.72, m.centreY + Math.sin(PREVIEW_PITCH) * d, Math.cos(PREVIEW_PITCH) * d * 0.69);
    this.camera.lookAt(0, m.centreY, 0);
    this.camera.near = d / 20;
    this.camera.far = d * 6;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private pose(t: number, dt: number): void {
    const m = this.model;
    if (!m) return;
    const act = previewAction(t);
    // About as fast as the unit moves in a game, so a Skitterer scurries and a Brute plods.
    if (act.moving) this.dist += (dt / 1000) * (this.modelSpeed / 28);
    const walker = m.def.move === 'walker';
    m.trees.forEach((tree, i) => {
      const phase = gaitPhase(this.dist, m.def.stride ?? 1) + i * 1.7;
      const kick = act.sinceShot < 1e8 ? Math.max(0, 1 - Math.abs(act.sinceShot - 30) / 150) : 0;
      const p: RigPose = {
        turret: act.moving ? 0 : 0.35 * Math.sin(t / 900),
        kick,
        lunge: !m.def.weapon || m.def.weapon === 'claw' || m.def.weapon === 'sting' ? kick * 0.6 : 0,
        pitch: walker && act.moving ? 0.03 : 0,
        roll: walker && act.moving ? 0.01 * Math.sin(phase) : 0,
        bob: walker && act.moving ? 0.006 * Math.abs(Math.sin(phase)) : 0,
        phase,
        stride: act.moving ? 1 : 0,
        dist: this.dist,
        turnRate: 0,
        time: t,
        reach: m.def.radius * 0.25,
        walker,
        crouch: act.moving ? 0 : i % 2,
        load: 1,
      };
      poseRig(tree, p);
    });
    m.group.rotation.y = -0.6 + (t / 1000) * SPIN;
  }

  private draw(canvas: HTMLCanvasElement, margin = 1.32): void {
    const w = Math.max(1, canvas.clientWidth || canvas.width);
    const h = Math.max(1, canvas.clientHeight || canvas.height);
    const pr = this.renderer.getPixelRatio();
    if (this.renderer.domElement.width !== Math.round(w * pr) || this.renderer.domElement.height !== Math.round(h * pr)) this.renderer.setSize(w, h, false);
    this.frame(w / h, margin);
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

  /** A still picture of a unit (INF-6), three-quarter view, as a PNG data URL of `w` by `h` CSS pixels. */
  picture(kind: string, owner: number, w: number, h: number): string {
    const keep = this.model;
    const keepOwner = this.owner;
    const m = this.build(kind, owner);
    this.show(m, owner);
    this.pose(CYCLE_MS * 0.75, 0);
    m.group.rotation.y = -0.35;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    this.renderer.setPixelRatio(1);
    this.draw(c, 0.86);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene.remove(m.group);
    this.model = null;
    if (keep) this.show(keep, keepOwner);
    return c.toDataURL('image/png');
  }

  /** Show `kind` animated in `canvas` until `stop` (INF-6). */
  play(kind: string, owner: number, canvas: HTMLCanvasElement): void {
    this.stop();
    this.live = canvas;
    this.dist = 0;
    this.owner = owner;
    this.show(this.build(kind, owner), owner);
    this.modelSpeed = UNIT_DEFS[kind]?.speed ?? 30;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const frame = (now: number): void => {
      if (!this.live) return;
      if (!this.start) this.start = this.last = now;
      const t = reduce ? CYCLE_MS * 0.6 : now - this.start;
      this.pose(t, reduce ? 0 : Math.min(50, now - this.last));
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
}
