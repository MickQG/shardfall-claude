import * as THREE from 'three';
import { buildingDef, unitDef } from '../data/defs';
import { FP, maxHpOf, squadAlive, type SimEvent, type Snapshot } from '../sim';
import type { Camera, Viewport } from '../render/camera';
import { OWNER_COLORS } from '../render/colors';
import type { ViewState } from '../render/gameView';
import type { MapLook } from '../render/worldRenderer';
import { hpFraction } from '../render/gfx';
import type { RenderUnit } from '../render/interp';
import type { Projector } from '../render/projector';
import { BUILDING_MODELS } from '../render/voxel/buildings';
import type { VoxelModel } from '../render/voxel/model';
import { UNIT_MODELS, type UnitModel } from '../render/voxel/models';
import { NEXT_BUILDING_MODELS, NEXT_UNIT_MODELS } from '../render/voxel/nextModels';
import { crystalLevel, crystalModel, propAt, propModel, rockVariant } from '../render/voxel/props';
import { cameraPose, FOV, PX_PER_UNIT } from './camera3d';
import { groundTexture, terrainMeshes, LEVEL_H } from './terrain3d';
import { voxelMesh, voxelSize, type MeshData } from './voxelMesh';

/** Squad figure offsets in tiles around the lead (R3D-3). */
const SQUAD = [[0, 0], [-0.2, 0.16], [0.2, 0.16], [0, 0.32], [-0.26, -0.06]] as const;
/** Air units fly this high (tiles). */
const AIR_Y = 0.85;
/** Pooled combat lights: a fixed count, so shaders never recompile. */
const LIGHT_POOL = 6;

let soft: THREE.Texture | null = null;

/** A soft round gradient shared by fire and smoke sprites. */
function softTexture(): THREE.Texture {
  if (soft) return soft;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  soft = new THREE.CanvasTexture(c);
  return soft;
}

const geometry = (d: MeshData & { uvs?: Float32Array }): THREE.BufferGeometry => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(d.colors, 3));
  if (d.uvs) g.setAttribute('uv', new THREE.BufferAttribute(d.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(d.indices, 1));
  g.computeBoundingSphere();
  return g;
};

interface Model3D {
  lit: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  height: number;
}

interface UnitObj {
  root: THREE.Group;
  figures: THREE.Group[];
  turret: THREE.Group | null;
  ring: THREE.Mesh;
  barBg: THREE.Sprite;
  barFg: THREE.Sprite;
  height: number;
  lastX: number;
  lastZ: number;
  heading: number;
  aim: number;
  aimHold: number;
}

interface BuildingObj {
  root: THREE.Group;
  body: THREE.Group;
  ring: THREE.LineLoop;
  born: number;
  height: number;
}

interface Fx {
  obj: THREE.Object3D;
  born: number;
  life: number;
  step: (k: number) => void;
}

/** The three.js world view (ADR 0005, `?renderer=3d`). Same contract as the classic GameView. */
export class View3D {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400);
  private sun = new THREE.DirectionalLight(0xffe2b8, 3.2);
  private models = new Map<string, Model3D>();
  private litMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.12 });
  private glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  private units = new Map<number, UnitObj>();
  private buildings = new Map<number, BuildingObj>();
  private crystals = new Map<number, { obj: THREE.Group; level: number }>();
  private fx: Fx[] = [];
  private lights: { light: THREE.PointLight; until: number; power: number; born: number }[] = [];
  private fogTex: THREE.DataTexture | null = null;
  private fogData: Uint8Array | null = null;
  private lastFogTick = -1;
  private lastShardTick = -1;
  private placement = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 1), new THREE.MeshBasicMaterial({ color: 0x3cff8a, transparent: true, opacity: 0.4, depthWrite: false }));
  private rally = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0x7ff5cd, dashSize: 0.3, gapSize: 0.2 }));
  private known = new Set<number>();
  private seeded = false;
  private mapW = 0;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  get viewport(): Viewport {
    const c = this.renderer.domElement;
    return { width: c.clientWidth || c.width, height: c.clientHeight || c.height };
  }

  async mount(host: HTMLElement, snap: Snapshot, look: MapLook = {}): Promise<void> {
    host.appendChild(this.renderer.domElement);
    const fit = (): void => {
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.renderer.setSize(host.clientWidth, host.clientHeight);
      this.camera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
      this.camera.updateProjectionMatrix();
    };
    fit();
    new ResizeObserver(fit).observe(host);
    this.mapW = snap.mapWidth;
    const s = this.scene;
    s.background = new THREE.Color(0x1a1f2e);
    s.fog = new THREE.Fog(0x2a2d44, 38, 90);
    // Late-afternoon light: a warm sun from the upper left of the screen, cool sky and ground bounce.
    s.add(new THREE.HemisphereLight(0xa8b8ff, 0x4a3e2c, 1.35));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -22;
    sc.right = 22;
    sc.top = 22;
    sc.bottom = -22;
    sc.near = 1;
    sc.far = 80;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    s.add(this.sun, this.sun.target);
    for (let i = 0; i < LIGHT_POOL; i++) {
      const light = new THREE.PointLight(0xffa050, 0, 6, 1.6);
      s.add(light);
      this.lights.push({ light, until: 0, power: 0, born: 0 });
    }
    this.buildTerrain(snap, look);
    this.buildProps(snap);
    this.placement.visible = false;
    this.rally.visible = false;
    s.add(this.placement, this.rally);
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
    const tex = groundTexture(input);
    const map = new THREE.DataTexture(tex.data, tex.width, tex.height);
    map.flipY = true;
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.anisotropy = 4;
    map.needsUpdate = true;
    const m = terrainMeshes(input);
    const ground = new THREE.Mesh(geometry(m.ground), new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 }));
    ground.receiveShadow = true;
    const cliffs = new THREE.Mesh(geometry(m.cliffs), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
    cliffs.receiveShadow = true;
    cliffs.castShadow = true;
    const water = new THREE.Mesh(geometry(m.water), new THREE.MeshStandardMaterial({ color: 0x1f5a78, roughness: 0.12, metalness: 0.25, transparent: true, opacity: 0.82 }));
    water.receiveShadow = true;
    this.scene.add(ground, cliffs, water);
    if (snap.fog) {
      // Fog of war: the same tile tops, darkened through a per-tile alpha texture (linear filtering softens the edges).
      this.fogData = new Uint8Array(W * snap.mapHeight * 4);
      this.fogTex = new THREE.DataTexture(this.fogData, W, snap.mapHeight);
      this.fogTex.flipY = true;
      this.fogTex.magFilter = THREE.LinearFilter;
      this.fogTex.minFilter = THREE.LinearFilter;
      const fogMat = new THREE.MeshBasicMaterial({ color: 0x0c0f22, alphaMap: this.fogTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const fog = new THREE.Mesh(geometry(m.ground), fogMat);
      fog.renderOrder = 10;
      const fogWalls = new THREE.Mesh(geometry(m.cliffs), new THREE.MeshBasicMaterial({ color: 0x0c0f22, transparent: true, opacity: 0, depthWrite: false }));
      this.scene.add(fog, fogWalls);
    }
  }

  /** Ground props from tile coordinates (the same choice as the classic view), as static meshes. */
  private buildProps(snap: Snapshot): void {
    const W = snap.mapWidth;
    const near = (x: number, y: number): boolean => snap.buildings.some((b) => Math.abs(b.tx - x) < 10 && Math.abs(b.ty - y) < 10);
    for (let y = 0; y < snap.mapHeight; y++) {
      for (let x = 0; x < W; x++) {
        if ((snap.heights[y * W + x] ?? 0) > 0) continue;
        const kind = propAt(x, y, !snap.shards[y * W + x] && !near(x, y));
        if (!kind) continue;
        const v = rockVariant(x, y) % 3;
        const g = this.instance(`prop_${kind}${v}`, () => propModel(kind, v), 0xffffff);
        g.position.set(x + 0.5, 0, y + 0.5);
        g.rotation.y = rockVariant(y, x) * 0.7;
        this.scene.add(g);
      }
    }
  }

  /** A shared-geometry group (lit and glow meshes) for a model in a team colour. */
  private instance(key: string, make: () => VoxelModel, team: number): THREE.Group {
    const k = `${key}|${team}`;
    let m = this.models.get(k);
    if (!m) {
      const v = voxelMesh(make(), team);
      m = { lit: geometry(v.lit), glow: geometry(v.glow), height: v.height };
      this.models.set(k, m);
    }
    const g = new THREE.Group();
    const lit = new THREE.Mesh(m.lit, this.litMat);
    lit.castShadow = true;
    lit.receiveShadow = true;
    g.add(lit, new THREE.Mesh(m.glow, this.glowMat));
    g.userData.height = m.height;
    return g;
  }

  private unitModel(kind: string): UnitModel {
    const make = NEXT_UNIT_MODELS[kind] ?? UNIT_MODELS[kind];
    if (!make) throw new Error(`no model for ${kind}`);
    return make();
  }

  private makeUnit(u: RenderUnit): UnitObj {
    const team = OWNER_COLORS[u.owner] ?? 0xffffff;
    const model = this.unitModel(u.kind);
    const d = unitDef(u.kind);
    const root = new THREE.Group();
    const figures: THREE.Group[] = [];
    let turret: THREE.Group | null = null;
    const size = d.squad ?? 1;
    for (let i = 0; i < size; i++) {
      const f = new THREE.Group();
      const hull = this.instance(`u_${u.kind}_h`, () => model.hull, team);
      f.add(hull);
      if (model.turret && i === 0) {
        const t = model.turret;
        turret = this.instance(`u_${u.kind}_t`, () => t.model, team);
        const vs = voxelSize(model.hull);
        turret.position.set(t.pivot.x * vs, t.pivot.z * vs, t.pivot.y * vs);
        f.add(turret);
      }
      const off = SQUAD[i] ?? [0, 0];
      f.position.set(off[0], 0, off[1]);
      root.add(f);
      figures.push(f);
    }
    const height = (figures[0]?.children[0]?.userData.height as number) ?? 0.4;
    const r = Math.max(0.28, Math.min(0.75, (Math.hypot(model.hull.sx, model.hull.sy) * voxelSize(model.hull)) / 2 + (size > 1 ? 0.25 : 0.05)));
    const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.86, r, 40), new THREE.MeshBasicMaterial({ color: team, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    ring.visible = false;
    const barBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x04130d, depthTest: false }));
    const barFg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x4cd964, depthTest: false }));
    barBg.scale.set(0.62, 0.09, 1);
    barFg.center.set(0, 0.5);
    barBg.renderOrder = barFg.renderOrder = 20;
    root.add(ring, barBg, barFg);
    if (d.air) root.position.y = AIR_Y;
    this.scene.add(root);
    return { root, figures, turret, ring, barBg, barFg, height: height + (d.air ? 0 : 0), lastX: u.tx, lastZ: u.ty, heading: 0, aim: 0, aimHold: 0 };
  }

  /** Turret aim from shot events, held briefly when the shooter has no target in view. */
  spawn(e: SimEvent, now: number): void {
    if (e.t === 'shot') {
      const sx = e.x / FP;
      const sz = e.y / FP;
      let best: UnitObj | null = null;
      let bd = 1.44;
      for (const o of this.units.values()) {
        const d = (o.lastX - sx) ** 2 + (o.lastZ - sz) ** 2;
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      if (best) {
        best.aim = Math.atan2(e.ty / FP - sz, e.tx / FP - sx);
        best.aimHold = now + 700;
      }
    }
    this.effect(e, now);
  }

  private light(x: number, y: number, z: number, color: number, power: number, life: number, now: number): void {
    const slot = this.lights.reduce((a, b) => (b.until < a.until ? b : a));
    slot.light.position.set(x, y, z);
    slot.light.color.setHex(color);
    slot.power = power;
    slot.born = now;
    slot.until = now + life;
  }

  private add(obj: THREE.Object3D, now: number, life: number, step: (k: number) => void): void {
    this.scene.add(obj);
    this.fx.push({ obj, born: now, life, step });
    step(0);
  }

  /** Combat effects (R3D-6): glowing tracers, muzzle and explosion lights, fireballs and smoke. */
  private effect(e: SimEvent, now: number): void {
    const P = (x: number, y: number): [number, number] => [x / FP, y / FP];
    if (e.t === 'shot') {
      const [ax, az] = P(e.x, e.y);
      const [bx, bz] = P(e.tx, e.ty);
      const ay = e.air ? AIR_Y : 0.3;
      const by = e.air ? AIR_Y : 0.25;
      const color = e.weapon === 'claw' ? 0xb6ff5c : e.weapon === 'rocket' ? 0xffa040 : e.weapon === 'blast' ? 0xffd070 : 0xfff0b0;
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz)]);
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, toneMapped: false });
      const line = new THREE.Line(g, mat);
      this.add(line, now, 110, (k) => (mat.opacity = 1 - k));
      this.light(ax, ay + 0.2, az, color, 3, 120, now);
      return;
    }
    if (e.t === 'boom' || e.t === 'die' || e.t === 'strike') {
      const [x, z] = P(e.x, e.y);
      const big = e.t === 'strike' ? 4 : e.t === 'die' ? (e.big ? 1.3 : 0.6) : 0.4 + e.r * 0.4;
      // Fireball: a soft additive glow that flashes white-hot, then cools to orange as it swells.
      const fireMat = new THREE.SpriteMaterial({ map: softTexture(), color: 0xfff0c0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const fire = new THREE.Sprite(fireMat);
      fire.position.set(x, 0.35, z);
      this.add(fire, now, 450 + big * 220, (k) => {
        fire.scale.setScalar(big * (0.8 + k * 1.6));
        fireMat.opacity = (1 - k) ** 1.4;
        fireMat.color.setHex(k < 0.25 ? 0xfff0c0 : k < 0.6 ? 0xffa040 : 0xff5a20);
      });
      // Smoke puffs drifting up and fading.
      for (let p = 0; p < 3; p++) {
        const smokeMat = new THREE.SpriteMaterial({ map: softTexture(), color: 0x34343a, transparent: true, depthWrite: false });
        const smoke = new THREE.Sprite(smokeMat);
        const ox = ((p * 37) % 7) / 10 - 0.3;
        smoke.position.set(x + ox * big, 0.4, z - ox * big * 0.5);
        this.add(smoke, now + p * 90, 1500 + big * 600, (k) => {
          smoke.scale.setScalar(big * (0.7 + k * 1.4));
          smoke.position.y = 0.4 + k * big * 1.4;
          smokeMat.opacity = 0.6 * (1 - k) * Math.min(1, k * 6);
        });
      }
      this.light(x, 0.8, z, 0xff8a40, 6 * big, 500 + big * 300, now);
    }
  }

  projector(cam: Camera): Projector {
    this.applyCamera(cam);
    const cameraRef = this.camera;
    const vp = this.viewport;
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    return {
      toScreen: (tx, ty, liftPx = 0) => {
        const v = new THREE.Vector3(tx, liftPx / PX_PER_UNIT, ty).project(cameraRef);
        return { x: ((v.x + 1) / 2) * vp.width, y: ((1 - v.y) / 2) * vp.height };
      },
      toGround: (sx, sy) => {
        ray.setFromCamera(new THREE.Vector2((sx / vp.width) * 2 - 1, 1 - (sy / vp.height) * 2), cameraRef);
        return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, y: hit.z } : { x: 0, y: 0 };
      },
    };
  }

  private applyCamera(cam: Camera): void {
    const p = cameraPose(cam);
    this.camera.position.set(...p.position);
    this.camera.lookAt(...p.target);
    this.camera.updateMatrixWorld();
    // The shadow follows the view, so it stays sharp wherever the camera looks.
    this.sun.position.set(p.target[0] - 14, 24, p.target[2] - 6);
    this.sun.target.position.set(p.target[0], 0, p.target[2]);
  }

  update(units: readonly RenderUnit[], cam: Camera, vs: ViewState, snap: Snapshot | null): void {
    this.applyCamera(cam);
    const t = vs.time;
    if (snap) {
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
    const byId = new Map(units.map((u) => [u.id, u]));
    const seen = new Set<number>();
    for (const u of units) {
      seen.add(u.id);
      let o = this.units.get(u.id);
      if (!o) {
        o = this.makeUnit(u);
        this.units.set(u.id, o);
      }
      o.root.position.x = u.tx;
      o.root.position.z = u.ty;
      const dx = u.tx - o.lastX;
      const dz = u.ty - o.lastZ;
      if (Math.abs(dx) + Math.abs(dz) > 0.002) o.heading = Math.atan2(dz, dx);
      o.lastX = u.tx;
      o.lastZ = u.ty;
      for (const f of o.figures) f.rotation.y = -o.heading;
      // Turrets track the current target (GFX-10), else a recently fired aim, else the hull.
      const tgt = u.target >= 0 ? byId.get(u.target) : undefined;
      const tb = !tgt && u.target >= 0 && snap ? snap.buildings.find((b) => b.id === u.target) : undefined;
      const aimAt = tgt ? Math.atan2(tgt.ty - u.ty, tgt.tx - u.tx) : tb ? Math.atan2(tb.ty + buildingDef(tb.kind).h / 2 - u.ty, tb.tx + buildingDef(tb.kind).w / 2 - u.tx) : t <= o.aimHold ? o.aim : o.heading;
      if (o.turret) o.turret.rotation.y = -(aimAt - o.heading);
      else if (tgt || tb) for (const f of o.figures) f.rotation.y = -aimAt;
      const max = maxHpOf(u.kind, u.rank);
      const alive = squadAlive(u.kind, u.hp, max);
      o.figures.forEach((f, i) => (f.visible = i < alive));
      const sel = vs.selectedUnits.has(u.id);
      o.ring.visible = sel;
      const frac = hpFraction(u.hp, u.kind, u.rank);
      const showBar = sel || frac < 1;
      o.barBg.visible = o.barFg.visible = showBar;
      if (showBar) {
        const y = o.height + 0.25;
        o.barBg.position.set(0, y, 0);
        o.barFg.position.set(-0.29, y, 0);
        o.barFg.scale.set(0.58 * frac, 0.06, 1);
        (o.barFg.material as THREE.SpriteMaterial).color.setHex(frac > 0.5 ? 0x4cd964 : frac > 0.25 ? 0xffcc00 : 0xff3b30);
      }
    }
    for (const [id, o] of this.units) {
      if (!seen.has(id)) {
        this.scene.remove(o.root);
        this.units.delete(id);
      }
    }
    // Placement ghost and rally line.
    if (vs.placement) {
      const d = buildingDef(vs.placement.kind);
      this.placement.visible = true;
      this.placement.scale.set(d.w, 1, d.h);
      this.placement.position.set(vs.placement.tx + d.w / 2, 0.04, vs.placement.ty + d.h / 2);
      (this.placement.material as THREE.MeshBasicMaterial).color.setHex(vs.placement.ok ? 0x3cff8a : 0xff4a4a);
    } else this.placement.visible = false;
    if (vs.rally) {
      const r = vs.rally;
      this.rally.geometry.setFromPoints([new THREE.Vector3(r.from.tx, 0.05, r.from.ty), new THREE.Vector3(r.to.tx, 0.05, r.to.ty)]);
      this.rally.computeLineDistances();
      this.rally.visible = true;
    } else this.rally.visible = false;
    // Effects and pooled lights.
    this.fx = this.fx.filter((f) => {
      const k = (t - f.born) / f.life;
      if (k >= 1) {
        this.scene.remove(f.obj);
        return false;
      }
      f.step(Math.max(0, k));
      return true;
    });
    for (const l of this.lights) l.light.intensity = t < l.until ? l.power * (1 - (t - l.born) / Math.max(1, l.until - l.born)) : 0;
    this.renderer.shadowMap.enabled = vs.fx.decor;
    this.renderer.render(this.scene, this.camera);
  }

  private syncBuildings(snap: Snapshot, vs: ViewState): void {
    const seen = new Set<number>();
    for (const b of [...snap.buildings, ...snap.ghosts]) {
      seen.add(b.id);
      let o = this.buildings.get(b.id);
      const d = buildingDef(b.kind);
      if (!o) {
        const team = OWNER_COLORS[b.owner] ?? 0xffffff;
        const make = NEXT_BUILDING_MODELS[b.kind] ?? BUILDING_MODELS[b.kind];
        if (!make) continue;
        const body = this.instance(`b_${b.kind}`, make, team);
        const root = new THREE.Group();
        root.add(body);
        root.position.set(b.tx + d.w / 2, (snap.heights[b.ty * this.mapW + b.tx] ?? 0) * LEVEL_H, b.ty + d.h / 2);
        const pts = [[-d.w / 2, -d.h / 2], [d.w / 2, -d.h / 2], [d.w / 2, d.h / 2], [-d.w / 2, d.h / 2]].map(([x, z]) => new THREE.Vector3(x, 0.05, z));
        const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x7ff5cd }));
        ring.visible = false;
        root.add(ring);
        this.scene.add(root);
        // Only the viewer's own new buildings rise from the ground (GFX-1).
        const born = this.seeded && b.owner === vs.viewer && !this.known.has(b.id) ? vs.time : -Infinity;
        o = { root, body, ring, born, height: body.userData.height as number };
        this.buildings.set(b.id, o);
        this.known.add(b.id);
      }
      const k = Math.min(1, (vs.time - o.born) / 1500);
      o.body.scale.y = Math.max(0.02, 1 - (1 - k) * (1 - k));
      o.ring.visible = vs.selectedBuilding === b.id;
    }
    this.seeded = true;
    for (const [id, o] of this.buildings) {
      if (!seen.has(id)) {
        this.scene.remove(o.root);
        this.buildings.delete(id);
      }
    }
  }

  private syncShards(snap: Snapshot): void {
    const W = snap.mapWidth;
    const live = new Set<number>();
    for (let i = 0; i < snap.shards.length; i++) {
      const level = crystalLevel(snap.shards[i] as number);
      if (level === 0) continue;
      live.add(i);
      let c = this.crystals.get(i);
      if (c && c.level !== level) {
        this.scene.remove(c.obj);
        c = undefined;
      }
      if (!c) {
        const obj = this.instance(`crystal${level}`, () => crystalModel(level), 0xffffff);
        const x = i % W;
        obj.position.set(x + 0.5, 0, (i - x) / W + 0.5);
        obj.rotation.y = rockVariant(x, i) * 0.9;
        this.scene.add(obj);
        this.crystals.set(i, { obj, level });
      }
    }
    for (const [i, c] of this.crystals) {
      if (!live.has(i)) {
        this.scene.remove(c.obj);
        this.crystals.delete(i);
      }
    }
  }
}
