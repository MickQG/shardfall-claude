import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AI, DIFFICULTIES } from '../../src/ai/ai';
import { BOARD_PATIENCE, MENDER_STUCK, MenderPlan, menderOf, mendersWanted } from '../../src/ai/menders';
import { SteamrollAI } from '../../src/ai/steamroll';
import { soundFor } from '../../src/audio/plan';
import { paletteOf, recipeFor, WORLD_SOUNDS } from '../../src/audio/recipes';
import { unitDef } from '../../src/data/defs';
import { skirmishConfig } from '../../src/data/maps';
import { UNIT_MODELS } from '../../src/render/voxel/models';
import { MENDER_BOOM, MENDER_HATCH, MENDER_JOINTS, MENDER_ROOF, MENDER_SCALE, MENDER_STICK, MENDER_SWIVEL, MENDER_TIP } from '../../src/render3d/mender3d';
import { poseRig, previewDraws, rigTree, turretReach, type RigPose } from '../../src/render3d/rig';
import { UNIT_RIGS } from '../../src/render3d/units3d';
import { createGame, FP, snapshot, tick, type Command, type SimEvent, type UnitSnap } from '../../src/sim';
import { acknowledge } from '../../src/ui/acknowledge';
import { AlertTracker } from '../../src/ui/alerts';
import { boardOrder, boarders, cargoLines, unloadIds } from '../../src/ui/carrier';
import { attackMoveIds, combatUnitIds } from '../../src/ui/controls';
import { CONTROLS } from '../../src/ui/controlsHelp';
import { rightClickOrder, type Hit } from '../../src/ui/hit';
import { boxSelect, type ScreenUnit } from '../../src/ui/selection';
import { cursorCss, cursorFor, type CursorState } from '../../src/ui/cursor';

const STILL: RigPose = { turret: 0, kick: 0, lunge: 0, pitch: 0, roll: 0, bob: 0, phase: 0, stride: 0, dist: 0, turnRate: 0, time: 0, reach: 0, walker: false };
const snapUnit = (id: number, owner: number, kind: string, x: number, y: number, extra: Partial<UnitSnap> = {}): UnitSnap => ({ id, owner, kind, x: x * FP + FP / 2, y: y * FP + FP / 2, hp: unitDef(kind).hp, dest: null, load: 0, rank: 0, target: -1, ...extra });

describe('SQD-7: the Field Mender is a combat unit for the controls', () => {
  const su = (id: number, kind: string, sx: number, sy: number): ScreenUnit => ({ id, owner: 0, kind, sx, sy });
  const field = [su(1, 'hum_mender', 100, 100), su(2, 'hum_tank', 110, 100), su(3, 'hum_rifleman', 120, 100), su(4, 'hum_hauler', 105, 110)];

  it('SQD-7: a box holding tanks and infantry keeps the Mender and leaves the hauler out; Q and attack-move include it', () => {
    expect(boxSelect(field, 90, 90, 130, 130, 0).sort()).toEqual([1, 2, 3]);
    // A Mender alone with a hauler is the combat unit of the box (CTL-2).
    expect(boxSelect([field[0]!, field[3]!], 90, 90, 130, 130, 0)).toEqual([1]);
    // Q selects the combat units (CTL-6); an attack-move reaches only those (CTL-13).
    expect(combatUnitIds(field, 0)).toEqual([1, 2, 3]);
    expect(attackMoveIds(field, [1, 4], 0)).toEqual([1]);
  });

  it('SQD-7: with only a Mender selected, an enemy under the pointer shows the attack cursor and a right-click attacks it', () => {
    const combat = combatUnitIds([snapUnit(1, 0, 'hum_mender', 5, 5)], 0).length > 0;
    expect(combat).toBe(true);
    expect(cursorFor({ mode: 'normal', combatSelected: combat, harvesterSelected: false, anySelected: true, hover: 'enemy' })).toBe('attack');
    const h: Hit = { ownUnit: null, enemyUnit: 9, ownBuilding: null, enemyBuilding: null, tx: 7, ty: 5, blocked: false, resource: false };
    expect(rightClickOrder(h, combat)).toEqual({ kind: 'attack', target: 9 });
  });
});

describe('CUR-6: the board cursor and right-click', () => {
  const base: CursorState = { mode: 'normal', combatSelected: true, harvesterSelected: false, anySelected: true, hover: 'carrier' };

  it('CUR-6: over a Field Mender with room, with squads that can board selected, the cursor is a distinct board cursor', () => {
    expect(cursorFor(base)).toBe('board');
    expect(cursorCss('board')).toContain('svg');
    for (const other of ['select', 'move', 'attack', 'harvest'] as const) expect(cursorCss('board')).not.toBe(cursorCss(other));
    // With nothing selected it is just something to select; the other cursors of CUR-1 are unchanged.
    expect(cursorFor({ ...base, anySelected: false })).toBe('select');
    expect(cursorFor({ ...base, hover: 'ownUnit' })).toBe('select');
    expect(cursorFor({ ...base, hover: 'enemy' })).toBe('attack');
    expect(cursorFor({ ...base, mode: 'amove' })).toBe('attackmove');
  });

  it('CUR-6: right-clicking an own Mender with room boards the selected Rifleman and Rocketeer squads only', () => {
    const units = [snapUnit(1, 0, 'hum_mender', 5, 5), snapUnit(2, 0, 'hum_rifleman', 7, 5), snapUnit(3, 0, 'hum_rocketeer', 8, 5), snapUnit(4, 0, 'hum_tank', 9, 5), snapUnit(5, 0, 'hum_paladin', 9, 9)];
    expect(boarders(units, [2, 3, 4, 5], 0, 'hum_mender')).toEqual([2, 3]);
    expect(boardOrder(units, [2, 3, 4, 5], 0, 1)).toEqual({ type: 'board', player: 0, units: [2, 3], carrier: 1 });
    // No squads selected, a full carrier, the enemy's carrier, nothing under the pointer, or not a carrier: no board order.
    expect(boardOrder(units, [4, 5], 0, 1)).toBeNull();
    const full = [{ ...units[0]!, cargo: { id: 9, kind: 'hum_rifleman', hp: 100, rank: 0 } }, ...units.slice(1)];
    expect(boardOrder(full, [2], 0, 1)).toBeNull();
    expect(boardOrder([snapUnit(1, 1, 'hum_mender', 5, 5), units[1]!], [2], 0, 1)).toBeNull();
    expect(boardOrder(units, [2], 0, null)).toBeNull();
    expect(boardOrder(units, [2], 0, 4)).toBeNull();
  });

  it('CUR-6: the board order is acknowledged with a marker on the Mender', () => {
    const a = acknowledge({ type: 'board', player: 0, units: [2], carrier: 1 }, 0, 0xffffff);
    expect(a).toMatchObject({ target: 1, at: null, units: [2] });
    expect(a?.color).not.toBeNull();
  });
});

describe('CTL-22, UI-23: unloading and the selection panel', () => {
  const units = [
    snapUnit(1, 0, 'hum_mender', 5, 5, { cargo: { id: 9, kind: 'hum_rocketeer', hp: 60, rank: 0 } }),
    snapUnit(2, 0, 'hum_mender', 6, 5),
    snapUnit(3, 0, 'hum_tank', 7, 5),
    snapUnit(4, 1, 'hum_mender', 8, 5, { cargo: { id: 10, kind: 'hum_rifleman', hp: 100, rank: 0 } }),
  ];

  it('CTL-22: R unloads every selected Mender that carries a squad; the help lists R and boarding; R was free', () => {
    expect(unloadIds(units, [1, 2, 3, 4], 0)).toEqual([1]);
    expect(unloadIds(units, [2, 3], 0)).toEqual([]);
    const rows = CONTROLS.flatMap((g) => g.rows);
    expect(rows.filter((r) => r.input === 'R')).toHaveLength(1);
    expect(rows.find((r) => r.input === 'R')?.action).toMatch(/Unload/);
    expect(rows.some((r) => /Field Mender/.test(r.input) && /board/i.test(r.action))).toBe(true);
    // No other control uses R.
    expect(rows.filter((r) => /(^|[^A-Za-z])R([^A-Za-z]|$)/.test(r.input))).toHaveLength(1);
  });

  it('UI-23: the panel names each selected Mender\'s squad and its figures, or that it is empty', () => {
    expect(cargoLines(units, [1, 2, 3], 0)).toEqual(['Field Mender: Rocketeer squad inside (2/3)', 'Field Mender: empty']);
    expect(cargoLines(units, [3], 0)).toEqual([]);
    expect(cargoLines(units, [4], 0)).toEqual([]); // not the enemy's
  });

  it('UI-23: unloading is an ordinary unload command, acknowledged without a marker', () => {
    expect(acknowledge({ type: 'unload', player: 0, units: [1] }, 0, 0xffffff)).toMatchObject({ color: null, units: [1] });
  });

  it('UI-23: a squad climbing in or out is not announced as a new unit', () => {
    const g = createGame({
      seed: 2,
      map: { width: 30, height: 30, heights: new Array<number>(900).fill(0) },
      units: [
        { owner: 0, kind: 'hum_mender', tx: 5, ty: 10 },
        { owner: 0, kind: 'hum_rifleman', tx: 6, ty: 10 },
      ],
    });
    const [m, r] = g.state.units;
    const alerts = new AlertTracker(0);
    const heard: string[] = [];
    const step = (n: number): void => {
      for (let i = 0; i < n; i++) {
        tick(g);
        heard.push(...alerts.update(snapshot(g, 0)).map((a) => a.id));
      }
    };
    step(1);
    g.state.pending.push({ type: 'board', player: 0, units: [r!.id], carrier: m!.id });
    step(100);
    expect(m!.cargo).toBe(r);
    g.state.pending.push({ type: 'unload', player: 0, units: [m!.id] });
    step(5);
    expect(m!.cargo).toBeNull();
    expect(heard).not.toContain('unit');
  });
});

describe('R3D-38: the Field Mender model', () => {
  it('R3D-38: a six-wheeled Aegis vehicle with a repair arm on a full swivel and a hatch light shown only while loaded', () => {
    const def = UNIT_RIGS.hum_mender!();
    const t = rigTree(def);
    expect(def.move).toBe('wheeled');
    expect(t.drawn.filter((d) => d.geo === 'wheel')).toHaveLength(6);
    expect(turretReach(def)).toBe(Infinity);
    expect(def.weapon).toBeUndefined();
    expect(t.muzzles).toHaveLength(0);
    const lamp = t.drawn.find((d) => d.geo === 'lamp')!;
    expect(lamp.cargo).toBe(true); // drawn only while carrying
    expect(t.drawn.filter((d) => d.geo !== 'lamp').every((d) => !d.cargo)).toBe(true);
    // Previews (unit sheet, build pictures, menu scene) show it empty, its hatch dark; every other model draws everything.
    expect(previewDraws(def, 'lamp')).toBe(false);
    expect(previewDraws(def, 'arm')).toBe(true);
    for (const [k, mk] of Object.entries(UNIT_RIGS)) if (k !== 'hum_mender') for (const d of rigTree(mk()).drawn) expect(previewDraws(mk(), d.geo), k).toBe(true);
    // Glowing parts: the hatch light and the emitter.
    expect(def.shapes.lamp!().build(0xff0000).glow).toBeTruthy();
  });

  /** World points of the arm's parts (swivel, boom, stick, tool head) and the tool tip and its pointing, in a pose. */
  const armAt = (pose: Partial<RigPose>) => {
    const def = UNIT_RIGS.hum_mender!();
    const t = rigTree(def);
    poseRig(t, { ...STILL, ...pose });
    t.root.updateMatrixWorld(true);
    const pts: THREE.Vector3[] = [];
    for (const d of t.drawn.filter((x) => ['arm', 'boom', 'stick', 'tool'].includes(x.geo))) {
      for (const p of def.shapes[d.geo]!().pieces) {
        const pos = p.geo.getAttribute('position');
        for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(d.obj.matrixWorld));
      }
    }
    const tool = t.drawn.find((d) => d.geo === 'tool')!;
    const tip = new THREE.Vector3(...MENDER_TIP).applyMatrix4(tool.obj.matrixWorld);
    const dir = new THREE.Vector3().setFromMatrixColumn(tool.obj.matrixWorld, 0).normalize();
    return { pts, tip, dir };
  };

  it('R3D-38: it is drawn at four fifths of its modelled size, smaller than a Bulwark tank', () => {
    const m = UNIT_RIGS.hum_mender!();
    const tank = UNIT_RIGS.hum_tank!();
    expect(m.scale).toBe(0.8);
    expect(MENDER_SCALE).toBe(0.8);
    // Footprint as drawn: the selection ring and the body's length.
    expect(m.radius).toBeLessThan(tank.radius * (tank.scale ?? 1));
    const len = (d: typeof m, shape: string): number => {
      const box = new THREE.Box3();
      for (const p of d.shapes[shape]!().pieces) box.expandByObject(new THREE.Mesh(p.geo));
      return (box.max.x - box.min.x) * (d.scale ?? 1);
    };
    expect(len(m, 'body')).toBeLessThan(len(tank, 'hull'));
  });

  it('R3D-38: a long crane arm (boom, stick and tool head) that rests folded flat on the roof', () => {
    // Clearly longer than a single short arm: boom, stick and tool head together reach close to a tile as drawn.
    expect((MENDER_BOOM + MENDER_STICK + MENDER_TIP[0]) * MENDER_SCALE).toBeGreaterThanOrEqual(0.9);
    for (const turret of [0, 1.2, -2.5]) {
      const { pts } = armAt({ turret, arm: 0 });
      // Folded: low over the roof, nothing above a hand's breadth of it or below it.
      for (const v of pts) {
        expect(v.y).toBeGreaterThan(MENDER_ROOF - 1e-6);
        expect(v.y).toBeLessThan(MENDER_ROOF + 0.26);
      }
    }
    // Facing ahead, it lies within the vehicle's length.
    for (const v of armAt({ arm: 0 }).pts) expect(Math.abs(v.x)).toBeLessThan(0.78);
  });

  it('R3D-38: unfolded, the arm swings toward the aim all the way round, reaches out, stays above the hull and clear of the hatch', () => {
    for (let a = -Math.PI; a < Math.PI; a += Math.PI / 8) {
      for (const aim of [-1, 0, 1]) {
        const { tip, pts, dir: d } = armAt({ turret: a, arm: 1, aim });
        // Rigs turn by minus the yaw: a yaw `a` points the arm along (cos a, sin a) in x and z. The tool head points
        // exactly that way; its tip sits a little to the side, as the stick hangs beside the boom.
        const off = (y: number): number => Math.abs(Math.atan2(Math.sin(y - a), Math.cos(y - a)));
        expect(off(Math.atan2(d.z, d.x))).toBeLessThan(1e-6);
        expect(off(Math.atan2(tip.z - MENDER_SWIVEL[2], tip.x - MENDER_SWIVEL[0]))).toBeLessThan(0.12);
        expect(Math.hypot(tip.x - MENDER_SWIVEL[0], tip.z - MENDER_SWIVEL[2])).toBeGreaterThan(0.6);
        expect(tip.y).toBeGreaterThan(MENDER_ROOF);
        for (const v of pts) expect(v.y).toBeGreaterThan(MENDER_HATCH[1] - 0.04);
      }
    }
    // Unfolded it stands well above the folded arm.
    expect(Math.max(...armAt({ arm: 1 }).pts.map((v) => v.y))).toBeGreaterThan(MENDER_ROOF + 0.45);
  });

  it('R3D-38: unfolded, the arm pitches its tool head down toward a vehicle below it, within its limits; folded it does not', () => {
    const level = armAt({ arm: 1, aim: 0 });
    const down = armAt({ arm: 1, aim: -0.25 });
    expect(down.tip.y).toBeLessThan(level.tip.y - 0.05);
    expect(Math.asin(down.dir.y)).toBeCloseTo(Math.asin(level.dir.y) - 0.25, 5);
    // Held within its limits.
    expect(Math.asin(armAt({ arm: 1, aim: -2 }).dir.y)).toBeCloseTo(Math.asin(level.dir.y) + MENDER_JOINTS.stick.lo, 5);
    // The tool points down at what it mends.
    expect(level.dir.y).toBeLessThan(-0.5);
    // Folded, the aim moves nothing.
    expect(armAt({ arm: 0, aim: -0.3 }).tip.distanceTo(armAt({ arm: 0 }).tip)).toBeLessThan(1e-9);
  });

  it('R3D-38: in the grounded style of R3D-35: no crew colours, no exhaust stack, team colour on it', () => {
    const def = UNIT_RIGS.hum_mender!();
    const crew = [0xb98a6a, 0x5c6a4e, 0x4a4f58];
    let team = false;
    for (const make of Object.values(def.shapes)) for (const p of make().pieces) {
      expect(crew).not.toContain(p.paint);
      if (p.paint === 'team') team = true;
    }
    expect(team).toBe(true);
  });

  it('R3D-38: the repair stream is drawn between the arm and the vehicle for as long as it is fed', () => {
    return import('../../src/render3d/fx3d').then(({ CombatFx }) => {
      const fx = new CombatFx();
      const streaks = (): number => (fx.root.children.find((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh).count;
      fx.update(0, 0.016);
      expect(streaks()).toBe(0);
      fx.repairStream(new THREE.Vector3(0, 0.8, 0), new THREE.Vector3(2, 0.3, 0), 10);
      fx.update(16, 0.016);
      expect(streaks()).toBeGreaterThan(0);
      fx.update(200, 0.016);
      expect(streaks()).toBe(0);
    });
  });

  it('R3D-38: welding sparks spray from the contact point continuously while it mends, at a steady rate, and a light flickers there', () => {
    return import('../../src/render3d/fx3d').then(({ CombatFx, WELD_SPARKS_PER_S, WELD_G }) => {
      const fx = new CombatFx();
      const at = new THREE.Vector3(2, 0.3, 0);
      const from = new THREE.Vector3(0, 0.9, 0);
      // Fed every frame for a second, at two frame rates: about as many sparks either way.
      const sprayed = (frameMs: number): number => {
        const f = new CombatFx();
        for (let t = 0; t <= 1000; t += frameMs) {
          f.repairStream(from, at, t, 7, t % 100 < frameMs);
          f.update(t, frameMs / 1000);
        }
        return f.particleCounts.glow;
      };
      expect(WELD_SPARKS_PER_S).toBeGreaterThanOrEqual(40);
      expect(WELD_G).toBeGreaterThan(0);
      const a = sprayed(16);
      const b = sprayed(33);
      expect(a).toBeGreaterThan(WELD_SPARKS_PER_S * 0.25);
      expect(Math.abs(a - b) / a).toBeLessThan(0.35);
      // The welding light: a pooled point light lights up at the contact point.
      fx.repairStream(from, at, 10, 7, true);
      fx.update(12, 0.016);
      const lights = fx.root.children.filter((c): c is THREE.PointLight => c instanceof THREE.PointLight);
      expect(lights.some((l) => l.intensity > 0 && l.position.distanceTo(at) < 0.4)).toBe(true);
    });
  });

  it('R3D-38: the classic view has a drawing of it, with its arm as a turret and a hatch light spot', () => {
    const m = UNIT_MODELS.hum_mender!();
    expect(m.turret).toBeDefined();
    expect(m.loadPivot).toBeDefined();
  });

  it('R3D-38: a passenger shot carries the passenger id, which the snapshot names as riding in the carrier', () => {
    const g = createGame({
      seed: 2,
      map: { width: 30, height: 30, heights: new Array<number>(900).fill(0) },
      units: [
        { owner: 0, kind: 'hum_mender', tx: 5, ty: 10 },
        { owner: 0, kind: 'hum_rifleman', tx: 6, ty: 10 },
        { owner: 1, kind: 'ali_brute', tx: 9, ty: 10 },
      ],
    });
    const [m, r, b] = g.state.units;
    b!.hp = 100000;
    b!.mode = 'move';
    g.state.pending.push({ type: 'board', player: 0, units: [r!.id], carrier: m!.id });
    const shots: SimEvent[] = [];
    for (let i = 0; i < 120; i++) {
      tick(g);
      shots.push(...g.state.events.filter((e) => e.t === 'shot' && e.owner === 0));
    }
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((e) => e.t === 'shot' && e.src === r!.id)).toBe(true);
    expect(snapshot(g, 0).units.find((u) => u.id === m!.id)?.cargo?.id).toBe(r!.id);
  });
});

describe('AUD-17: the Field Mender sounds', () => {
  it('AUD-17: mending plays a welding crackle and boarding or unloading a clunk, both layered Aegis recipes', () => {
    const mend: SimEvent = { t: 'mend', x: 0, y: 0, owner: 0, id: 1, to: 2 };
    expect(soundFor(mend, 0).name).toBe('weld');
    expect(soundFor({ t: 'board', x: 0, y: 0, owner: 0, id: 1, rider: 2, on: true }, 0).name).toBe('clunk');
    expect(soundFor({ t: 'board', x: 0, y: 0, owner: 0, id: 1, rider: 2, on: false }, 0).name).toBe('clunk');
    expect(soundFor(mend, 0).gain).toBeGreaterThan(soundFor(mend, 1).gain);
    for (const name of ['weld', 'clunk'] as const) {
      expect(WORLD_SOUNDS).toContain(name);
      const r = recipeFor(name, 'human')!;
      expect(r.layers.length).toBeGreaterThanOrEqual(2);
      expect(r.layers.some((l) => l.role === 'attack')).toBe(true);
      // Metallic: inharmonic ringing partials (AUD-6).
      expect(r.layers.some((l) => l.ratios?.some((x) => !Number.isInteger(x)))).toBe(true);
    }
    // The weld is a crackle: a run of sharp snaps.
    expect(recipeFor('weld', 'human')!.layers.filter((l) => l.role === 'attack').length).toBeGreaterThanOrEqual(3);
    expect(paletteOf('human').inharmonic).toBeGreaterThan(paletteOf('alien').inharmonic);
  });
});

describe('AI-29: the AI and its Field Menders', () => {
  const kind = 'hum_mender';

  it('AI-29: one Mender for every three tanks; the Vrax have none', () => {
    expect(menderOf('human')).toBe(kind);
    expect(menderOf('alien')).toBeNull();
    expect([0, 2, 3, 5, 6, 9].map((t) => mendersWanted(t, 0))).toEqual([0, 0, 1, 1, 2, 3]);
    expect(mendersWanted(6, 1)).toBe(1);
    expect(mendersWanted(6, 3)).toBe(0);
  });

  it('AI-29: an empty Mender takes the nearest Rocketeer squad of the army, and that squad leaves the army while it boards', () => {
    const plan = new MenderPlan(0, kind);
    const m = snapUnit(1, 0, kind, 10, 10);
    const near = snapUnit(2, 0, 'hum_rocketeer', 12, 10);
    const far = snapUnit(3, 0, 'hum_rocketeer', 20, 10);
    const rifle = snapUnit(4, 0, 'hum_rifleman', 11, 10);
    const army = [near, far, rifle];
    const t = plan.turn(100, [m, ...army], [], army, 64, true);
    expect(t.orders).toContainEqual({ type: 'board', player: 0, units: [2], carrier: 1 });
    expect(t.busy.has(2)).toBe(true);
    // Next turn: still boarding, no second order; given up after BOARD_PATIENCE and another squad is sent.
    const t2 = plan.turn(120, [m, ...army], [], army, 64, true);
    expect(t2.orders.some((o) => o.type === 'board')).toBe(false);
    expect(t2.busy.has(2)).toBe(true);
    const t3 = plan.turn(120 + BOARD_PATIENCE + 1, [m, ...army], [], army, 64, true);
    expect(t3.orders.filter((o) => o.type === 'board')).toHaveLength(1);
    // With loading switched off (a measurement rule), no squad is sent.
    expect(new MenderPlan(0, kind).turn(100, [m, ...army], [], army, 64, true, false).orders.some((o) => o.type === 'board')).toBe(false);
  });

  it('AI-29: below 15% health a Mender lets its squad out', () => {
    const plan = new MenderPlan(0, kind);
    const cargo = { id: 9, kind: 'hum_rocketeer', hp: 100, rank: 0 };
    const hurt = snapUnit(1, 0, kind, 10, 10, { hp: 50, cargo });
    expect(plan.turn(100, [hurt], [], [], 64, true).orders).toContainEqual({ type: 'unload', player: 0, units: [1] });
    const fine = snapUnit(1, 0, kind, 10, 10, { hp: 300, cargo });
    expect(new MenderPlan(0, kind).turn(100, [fine], [], [], 64, true).orders.some((o) => o.type === 'unload')).toBe(false);
  });

  it('AI-29: out of combat and stuck for 10 seconds a Mender lets its squad out; moving, parked or near enemies it does not', () => {
    const cargo = { id: 9, kind: 'hum_rocketeer', hp: 100, rank: 0 };
    const stuck = snapUnit(1, 0, kind, 10, 10, { cargo, dest: [30, 30] });
    const unloads = (plan: MenderPlan, at: number, m: UnitSnap, foes: UnitSnap[] = []): boolean => plan.turn(at, [m], foes, [], 64, true).orders.some((o) => o.type === 'unload');
    const a = new MenderPlan(0, kind);
    expect(unloads(a, 100, stuck)).toBe(false);
    expect(unloads(a, 100 + MENDER_STUCK - 1, stuck)).toBe(false);
    expect(unloads(a, 100 + MENDER_STUCK, stuck)).toBe(true);
    // Moving on: never stuck.
    const b = new MenderPlan(0, kind);
    for (let i = 0; i <= MENDER_STUCK; i += 20) expect(unloads(b, 100 + i, { ...stuck, x: stuck.x + i * 4 })).toBe(false);
    // Parked with no destination: not stuck.
    const c = new MenderPlan(0, kind);
    for (let i = 0; i <= MENDER_STUCK; i += 20) expect(unloads(c, 100 + i, { ...stuck, dest: null })).toBe(false);
    // In combat (an armed enemy near): it keeps its squad.
    const d = new MenderPlan(0, kind);
    const foe = snapUnit(50, 1, 'ali_brute', 14, 10);
    for (let i = 0; i <= MENDER_STUCK; i += 20) expect(unloads(d, 100 + i, stuck, [foe])).toBe(false);
  });

  it('AI-29: a tank below half health falls back to the nearest Mender and stays out of the army until mended to 90%', () => {
    const plan = new MenderPlan(0, kind);
    const near = snapUnit(1, 0, kind, 10, 10);
    const other = snapUnit(2, 0, kind, 40, 40);
    const hurt = snapUnit(3, 0, 'hum_tank', 20, 10, { hp: 200 });
    const ok = snapUnit(4, 0, 'hum_tank', 21, 10);
    const army = [hurt, ok];
    const t = plan.turn(100, [near, other, ...army], [], army, 64, true);
    expect(t.orders).toContainEqual({ type: 'move', player: 0, units: [3], x: near.x, y: near.y });
    expect(t.busy.has(3)).toBe(true);
    expect(t.busy.has(4)).toBe(false);
    expect(plan.fallingBack).toEqual([3]);
    // Mended to 90%: back in the army.
    const mended = { ...hurt, hp: 500 };
    const t2 = plan.turn(140, [near, other, mended, ok], [], [mended, ok], 64, true);
    expect(t2.busy.has(3)).toBe(false);
    // The steamroll opponent never falls back.
    expect(new MenderPlan(0, kind).turn(100, [near, ...army], [], army, 64, false).busy.size).toBe(0);
  });

  it('AI-29: Menders follow their tanks when far from them', () => {
    const plan = new MenderPlan(0, kind);
    const m = snapUnit(1, 0, kind, 5, 5);
    const tanks = [snapUnit(2, 0, 'hum_tank', 30, 30), snapUnit(3, 0, 'hum_tank', 32, 30)];
    const orders: Command[] = [];
    for (let at = 100; at < 160; at += 8) orders.push(...plan.turn(at, [m, ...tanks], [], tanks, 64, true).orders);
    expect(orders.some((o) => o.type === 'move' && o.units.includes(1) && Math.abs(o.x - 31 * FP - FP / 2) < 2 && Math.abs(o.y - 30 * FP - FP / 2) < 2)).toBe(true);
  });

  it('AI-29: on every difficulty the Aegis AI trains a Mender at its factory once it has three tanks, and the steamroll opponent too', () => {
    const cfg = skirmishConfig(6, { factions: ['human', 'alien'] });
    const spots = [...Array(20)].map((_, i) => ({ tx: 16 + (i % 6) * 4, ty: 4 + Math.floor(i / 6) * 4 }));
    const buildings = [
      ...cfg.buildings!.filter((b) => b.owner !== 0),
      { owner: 0, kind: 'hum_hq', tx: 10, ty: 10 },
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ owner: 0, kind: 'hum_reactor', ...spots[i]! })),
      ...[8, 9, 10].map((i) => ({ owner: 0, kind: 'hum_refinery', ...spots[i]! })),
      { owner: 0, kind: 'hum_barracks', ...spots[11]! },
      { owner: 0, kind: 'hum_factory', ...spots[12]! },
    ];
    const units = [
      ...(cfg.units ?? []).filter((u) => u.owner !== 0),
      ...[...Array(8)].map((_, i) => ({ owner: 0, kind: 'hum_hauler', tx: 12 + i, ty: 16 })),
      ...['hum_tank', 'hum_tank', 'hum_tank', 'hum_rocketeer'].map((k, i) => ({ owner: 0, kind: k, tx: 8 + i, ty: 20 })),
    ];
    const fresh = (): ReturnType<typeof createGame> => {
      const g = createGame({ ...cfg, players: [{ faction: 'human', credits: 6000 }, cfg.players![1]!], buildings, units });
      g.state.tick = 7000;
      return g;
    };
    /** Menders it orders within a minute of play (stopping at the first), its orders carried out (the enemy idle). */
    const ordered = (ai: AI, every: number, g = fresh()): number => {
      let n = 0;
      for (let i = 0; i < 1200 && n === 0; i++) {
        if (i % every === 0) {
          for (const c of ai.think(snapshot(g, 0))) {
            if (c.type === 'produce' && c.kind === kind) n++;
            g.state.pending.push(c);
          }
        }
        tick(g);
      }
      return n;
    };
    for (const d of Object.values(DIFFICULTIES)) expect(ordered(new AI(0, 'human', d, cfg.map, 6), d.thinkEvery), d.name).toBeGreaterThanOrEqual(1);
    expect(ordered(new SteamrollAI(0, 'human', cfg.map, 6), DIFFICULTIES.hard.thinkEvery)).toBeGreaterThanOrEqual(1);
    // Raider, with its fast and cheap army, trains none while it plays Raider.
    expect(ordered(new AI(0, 'human', DIFFICULTIES.hard, cfg.map, 6, 'raider'), DIFFICULTIES.hard.thinkEvery)).toBe(0);
    // For measurement, the rule can be switched off: then it trains none.
    expect(ordered(new AI(0, 'human', DIFFICULTIES.hard, cfg.map, 6, 'balanced', { rules: { menders: false } }), DIFFICULTIES.hard.thinkEvery)).toBe(0);
    // With a Mender already there is none to add for three tanks (it may add one for tanks it trains meanwhile).
    const g = fresh();
    const t = g.state.units.find((u) => u.owner === 0 && u.kind === 'hum_tank')!;
    g.state.units.push({ ...t, id: 9999, kind, x: t.x + 512, hp: unitDef(kind).hp, cargo: null, mend: -1, ride: -1, path: [] });
    const ai = new AI(0, 'human', DIFFICULTIES.hard, cfg.map, 6);
    expect(ai.think(snapshot(g, 0)).some((c) => c.type === 'produce' && c.kind === kind)).toBe(false);
  }, 60_000);
});
