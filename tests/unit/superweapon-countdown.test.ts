import { describe, expect, it } from 'vitest';
import { buildingDef } from '../../src/data/defs';
import { createGame, FP, snapshot, submit, tick, TICKS_PER_SECOND, type Game, type GameConfig, type MapDef, type Snapshot } from '../../src/sim';
import { AlertTracker } from '../../src/ui/alerts';
import { clock, countdownRows } from '../../src/ui/countdown';
import { superweaponRows } from '../../src/ui/feedback';

const W = 50;
const open = (): MapDef => ({ width: W, height: W, heights: new Array<number>(W * W).fill(0), blocked: new Array<number>(W * W).fill(0) });

/** Player 0 owns a powered Lance in one corner; player 1 a powered Rift Maw in the other, far out of sight. */
const setup = (powered1 = true): Game =>
  createGame({
    seed: 3,
    map: open(),
    buildings: [
      { owner: 0, kind: 'hum_hq', tx: 2, ty: 2 },
      { owner: 0, kind: 'hum_reactor', tx: 6, ty: 2 },
      { owner: 0, kind: 'hum_reactor', tx: 9, ty: 2 },
      { owner: 0, kind: 'hum_lance', tx: 2, ty: 6 },
      { owner: 1, kind: 'ali_hq', tx: 44, ty: 44 },
      ...((powered1
        ? [
            { owner: 1, kind: 'ali_generator', tx: 40, ty: 44 },
            { owner: 1, kind: 'ali_generator', tx: 40, ty: 41 },
          ]
        : []) as GameConfig['buildings'] & object),
      { owner: 1, kind: 'ali_rift', tx: 44, ty: 40 },
    ],
  });
const run = (g: Game, n: number): void => {
  for (let i = 0; i < n; i++) tick(g);
};
const rift = (g: Game) => g.state.buildings.find((b) => b.kind === 'ali_rift')!;

describe('superweapon countdown', () => {
  it('SW-1: every player sees every finished superweapon and the ticks until it is charged, the enemy one too, unseen under fog', () => {
    const g = setup();
    run(g, 10);
    const s = snapshot(g, 0);
    // The enemy weapon is out of sight: not in the buildings, but its timer is there.
    expect(s.buildings.some((b) => b.kind === 'ali_rift')).toBe(false);
    const enemy = s.superweapons.find((w) => w.owner === 1)!;
    const full = buildingDef('ali_rift').superweapon!.charge;
    expect(enemy).toMatchObject({ kind: 'ali_rift', paused: false });
    expect(enemy.left).toBe(full - rift(g).charge);
    expect(s.superweapons.find((w) => w.owner === 0)?.kind).toBe('hum_lance');
    run(g, 20);
    expect(snapshot(g, 0).superweapons.find((w) => w.owner === 1)!.left).toBe(enemy.left - 20);
    // Ready: 0 left.
    rift(g).charge = full;
    expect(snapshot(g, 0).superweapons.find((w) => w.owner === 1)!.left).toBe(0);
  });

  it('SW-1: an enemy weapon whose owner is low on power is paused, its timer frozen', () => {
    const g = setup(false);
    run(g, 10);
    const a = snapshot(g, 0).superweapons.find((w) => w.owner === 1)!;
    run(g, 20);
    const b = snapshot(g, 0).superweapons.find((w) => w.owner === 1)!;
    expect(b.paused).toBe(true);
    expect(b.left).toBe(a.left);
  });

  it('SW-1: the countdown box lists enemy weapons, then the viewer own, as m:ss, paused or READY; the console shows the own time', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(TICKS_PER_SECOND * 75)).toBe('1:15');
    expect(clock(1)).toBe('0:01');
    const snap = {
      tick: 100,
      viewer: 0,
      strikes: [],
      superweapons: [
        { id: 5, owner: 0, kind: 'hum_lance', left: 20 * 30, paused: false },
        { id: 9, owner: 1, kind: 'ali_rift', left: 20 * 125, paused: false },
        { id: 11, owner: 1, kind: 'ali_rift', left: 20 * 10, paused: true },
      ],
    } as unknown as Snapshot;
    const rows = countdownRows(snap);
    expect(rows.map((r) => [r.text, r.tone])).toEqual([
      ['Enemy Rift Maw · 2:05', 'enemy'],
      ['Enemy Rift Maw · 0:10 · paused', 'enemy'],
      [`Your ${buildingDef('hum_lance').name} · 0:30`, 'own'],
    ]);
    const ready = countdownRows({ ...snap, superweapons: [{ id: 9, owner: 1, kind: 'ali_rift', left: 0, paused: false }] } as Snapshot);
    expect(ready).toEqual([{ key: 'sw:9', text: 'Enemy Rift Maw · READY', tone: 'danger' }]);
    expect(countdownRows({ ...snap, superweapons: [] } as Snapshot)).toEqual([]);
    // The console panel adds the time left to its charging line.
    const [row] = superweaponRows([{ id: 5, kind: 'hum_lance', charge: 40 }], false, null, new Map([[5, 20 * 30]]));
    expect(row!.state).toBe('Charging 40% · 0:30');
  });

  it('SW-1: a finished enemy superweapon is announced once, seen or not', () => {
    const g = setup();
    run(g, 2);
    const alerts = new AlertTracker(0);
    const first = alerts.update(snapshot(g, 0));
    expect(first.filter((a) => a.id === 'detected').map((a) => a.text)).toEqual(['Enemy superweapon detected: Rift Maw']);
    run(g, 200);
    expect(alerts.update(snapshot(g, 0)).filter((a) => a.id === 'detected')).toEqual([]);
  });

  it('SW-2: a strike on its way is listed for everyone with its impact time and target; the target is marked for a viewer who sees it', () => {
    const g = setup();
    run(g, 2);
    rift(g).charge = buildingDef('ali_rift').superweapon!.charge;
    const x = 5 * FP + FP / 2;
    const y = 5 * FP + FP / 2;
    submit(g, { type: 'superweapon', player: 1, building: rift(g).id, x, y });
    const alerts = new AlertTracker(0);
    alerts.update(snapshot(g, 0));
    tick(g);
    const s = snapshot(g, 0);
    expect(s.strikes).toHaveLength(1);
    const k = s.strikes[0]!;
    expect(k).toMatchObject({ owner: 1, kind: 'ali_rift', x, y, r: buildingDef('ali_rift').superweapon!.radius });
    expect(k.left).toBeGreaterThan(0);
    // The launch site is out of sight but the target is in view: the launch reaches the viewer, marked unseen.
    const launch = s.events.find((e) => e.t === 'launch');
    expect(launch).toMatchObject({ unseen: true, tx: x, ty: y });
    // The launcher sees its own launch normally.
    expect(snapshot(g, 1).events.find((e) => e.t === 'launch')).not.toHaveProperty('unseen');
    expect(countdownRows(s)[0]).toMatchObject({ tone: 'danger', text: `Enemy Rift Maw strike · impact in ${Math.ceil(k.left / TICKS_PER_SECOND)}s` });
    expect(alerts.update(s).filter((a) => a.id === 'incoming')).toHaveLength(1);
    run(g, k.left + 1);
    expect(snapshot(g, 0).strikes).toEqual([]);
  });
});
