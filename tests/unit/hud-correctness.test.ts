import { describe, expect, it } from 'vitest';
import { hpFraction } from '../../src/render/gfx';
import type { Snapshot } from '../../src/sim';
import { AlertTracker } from '../../src/ui/alerts';
import { resultText } from '../../src/ui/hud';
import { CONTROLS } from '../../src/ui/controlsHelp';
import { placementLive } from '../../src/ui/production';

describe('HUD correctness', () => {
  it('UI-2: the How to play page names F then right-click for attack-move and E for select-same-kind, not A', () => {
    const rows = CONTROLS.flatMap((g) => g.rows);
    expect(rows.find((r) => /attack-move/i.test(r.action))?.input).toBe('F, then right-click');
    expect(rows.find((r) => r.input === 'E')?.action).toMatch(/same kind|of the selected kind/);
    expect(rows.some((r) => r.input === 'A' && /attack-move/i.test(r.action))).toBe(false);
  });

  it('UI-6: placement stays armed only while its structure is ready at the head of an own building queue', () => {
    const hq = { id: 9, owner: 0, queue: [{ kind: 'hum_reactor', pct: 100, ready: true }] };
    expect(placementLive({ source: 9, kind: 'hum_reactor' }, [hq], 0)).toBe(true);
    expect(placementLive({ source: 9, kind: 'hum_reactor' }, [{ ...hq, queue: [] }], 0)).toBe(false); // cancelled
    expect(placementLive({ source: 9, kind: 'hum_reactor' }, [], 0)).toBe(false); // HQ lost
    expect(placementLive({ source: 9, kind: 'hum_reactor' }, [{ ...hq, queue: [{ kind: 'hum_reactor', ready: false }] }], 0)).toBe(false); // next one not ready
    expect(placementLive({ source: 9, kind: 'hum_reactor' }, [{ ...hq, owner: 1 }], 0)).toBe(false);
  });

  it('UI-7: health bars measure hit points against the unit kind maximum, however damaged the unit was when first seen', () => {
    expect(hpFraction(275, 'hum_tank')).toBe(0.5);
    expect(hpFraction(550, 'hum_tank')).toBe(1);
    expect(hpFraction(-5, 'hum_tank')).toBe(0);
  });

  it('UI-8: a draw says draw, a win says victory, a loss says defeat', () => {
    expect(resultText(null, 0)).toEqual({ title: 'DRAW', sub: 'No side is left standing.', color: '#ffd34a' });
    expect(resultText(0, 0).title).toBe('VICTORY');
    expect(resultText(1, 0)).toEqual({ title: 'DEFEAT', sub: 'Your base has fallen.', color: '#ff5a4a' });
  });

  it('ALR-2: "ready: place it" fires each time a structure becomes ready, not only the first time for that kind', () => {
    const snap = (tick: number, queue: { kind: string; pct: number; ready: boolean }[]): Snapshot =>
      ({ tick, viewer: 0, units: [], events: [], players: [{ faction: 'human', credits: 0, powerOut: 20, powerIn: 0 }], buildings: [{ id: 1, owner: 0, kind: 'hum_hq', tx: 0, ty: 0, hp: 1500, queue, repairing: false, rally: null, charge: 0 }] }) as unknown as Snapshot;
    const ready = [{ kind: 'hum_reactor', pct: 100, ready: true }];
    const t = new AlertTracker(0);
    expect(t.update(snap(0, [])).map((a) => a.id)).toEqual([]);
    expect(t.update(snap(10, ready)).map((a) => a.id)).toEqual(['structure']);
    expect(t.update(snap(20, ready)).map((a) => a.id)).toEqual([]); // still the same ready item
    t.update(snap(100, [])); // placed
    expect(t.update(snap(200, ready)).map((a) => a.id)).toEqual(['structure']);
  });
});
