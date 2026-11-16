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
import { MENDER_HATCH, MENDER_TIP } from '../../src/render3d/mender3d';
import { poseRig, previewDraws, rigTree, turretReach, type RigPose } from '../../src/render3d/rig';
import { UNIT_RIGS } from '../../src/render3d/units3d';
import { createGame, FP, snapshot, tick, type Command, type SimEvent, type UnitSnap } from '../../src/sim';
import { acknowledge } from '../../src/ui/acknowledge';
import { AlertTracker } from '../../src/ui/alerts';
import { boardOrder, boarders, cargoLines, unloadIds } from '../../src/ui/carrier';
import { CONTROLS } from '../../src/ui/controlsHelp';
import { cursorCss, cursorFor, type CursorState } from '../../src/ui/cursor';

const STILL: RigPose = { turret: 0, kick: 0, lunge: 0, pitch: 0, roll: 0, bob: 0, phase: 0, stride: 0, dist: 0, turnRate: 0, time: 0, reach: 0, walker: false };
const snapUnit = (id: number, owner: number, kind: string, x: number, y: number, extra: Partial<UnitSnap> = {}): UnitSnap => ({ id, owner, kind, x: x * FP + FP / 2, y: y * FP + FP / 2, hp: unitDef(kind).hp, dest: null, load: 0, rank: 0, target: -1, ...extra });

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

  it('R3D-38: the arm tip turns toward the aim, and stays above the hull and clear of the hatch all the way round', () => {
    const def = UNIT_RIGS.hum_mender!();
    const t = rigTree(def);
    const arm = t.drawn.find((d) => d.geo === 'arm')!;
    for (let a = -Math.PI; a < Math.PI; a += Math.PI / 8) {
      poseRig(t, { ...STILL, turret: a });
      t.root.updateMatrixWorld(true);
      const tip = new THREE.Vector3(...MENDER_TIP).applyMatrix4(arm.obj.matrixWorld);
      // Rigs turn by minus the yaw: a yaw `a` points the arm along (cos a, sin a) in x and z.
      const dir = Math.atan2(tip.z, tip.x - (-0.08));
      expect(Math.abs(Math.atan2(Math.sin(dir - a), Math.cos(dir - a)))).toBeLessThan(0.05);
      expect(tip.y).toBeGreaterThan(MENDER_HATCH[1] + 0.05);
    }
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
