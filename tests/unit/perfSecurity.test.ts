import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CSP } from '../../desktop/paths.cjs';
import { skirmishConfig } from '../../src/data/maps';
import { poseRig, rigTree, type RigDef } from '../../src/render3d/rig';
import { PR_MAX, PR_MIN, ResolutionGovernor } from '../../src/render3d/resolution';
import { POSE_MARGIN, SHADOW_EVERY, shadowEvery } from '../../src/render3d/view3d';
import { createGame, snapshot } from '../../src/sim';
import { seedOf } from '../../src/ui/params';

/** A stand-in 2D canvas that counts what is drawn on it. */
function fakeCanvas(): { canvas: unknown; calls: { fillRect: number } } {
  const calls = { fillRect: 0 };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k) => (k === 'fillRect' ? () => void calls.fillRect++ : k in t ? t[k as string] : () => undefined),
    set: (t, k, v) => ((t[k as string] = v), true),
  });
  return { canvas: { width: 0, height: 0, getContext: () => ctx }, calls };
}

describe('performance', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('PERF-1: the minimap redraws fog, buildings and shards a few times a second, and units every frame', async () => {
    const made: ReturnType<typeof fakeCanvas>[] = [];
    vi.stubGlobal('document', { createElement: () => (made.push(fakeCanvas()), made.at(-1)!.canvas) });
    const { Minimap } = await import('../../src/ui/minimap');
    const snap = snapshot(createGame(skirmishConfig()), 0);
    const mm = new Minimap(snap);
    const count = (): number => made.reduce((n, c) => n + c.calls.fillRect, 0);
    const baked = count(); // the terrain is baked once, in the constructor
    mm.draw(snap, [], 0);
    const first = count() - baked;
    const units = snap.units.length;
    // Later frames of the same tick, or within LAYER_MS, only draw the units.
    const before = count();
    mm.draw({ ...snap, tick: snap.tick + 1 }, [], Minimap.LAYER_MS - 1);
    expect(count() - before).toBe(units);
    const again = count();
    mm.draw({ ...snap, tick: snap.tick + 2 }, [], Minimap.LAYER_MS);
    expect(count() - again).toBe(first);
    // Without a new tick, the layer never redraws, however much time passes.
    const still = count();
    mm.draw({ ...snap, tick: snap.tick + 2 }, [], 10 * Minimap.LAYER_MS);
    expect(count() - still).toBe(units);
  });

  it('PERF-1: posing leaves unchanged rotations alone, so parts that hold still cost no quaternion rebuild', () => {
    const def: RigDef = {
      shapes: {},
      move: 'tracked',
      radius: 0.4,
      height: 0.5,
      root: { kids: [{ anim: { k: 'turret' } }, { anim: { k: 'body' } }] },
    };
    const tree = rigTree(def);
    const pose = { turret: 0.3, kick: 0, lunge: 0, pitch: 0.01, roll: 0, bob: 0, phase: 0, stride: 0, dist: 0, turnRate: 0, time: 0, reach: 0, walker: false };
    poseRig(tree, pose);
    const turret = tree.anims[0]!.obj;
    expect(turret.rotation.y).toBeCloseTo(-0.3);
    const spy = vi.spyOn(turret.quaternion, 'setFromEuler');
    const body = vi.spyOn(tree.anims[1]!.obj.quaternion, 'setFromEuler');
    poseRig(tree, pose);
    expect(spy).not.toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
    poseRig(tree, { ...pose, turret: 0.5 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(turret.rotation.y).toBeCloseTo(-0.5);
    expect(turret.quaternion.equals(new THREE.Quaternion().setFromEuler(turret.rotation))).toBe(true);
  });

  it('PERF-1: shadows redraw every other frame and units are posed only within a short reach of the view', () => {
    expect(SHADOW_EVERY).toBe(2);
    expect(POSE_MARGIN).toBeGreaterThanOrEqual(1);
    expect(POSE_MARGIN).toBeLessThanOrEqual(3);
  });

  it('PERF-2: resolution drops a step after sustained GPU-bound slow frames and recovers after a long run of on-time ones', () => {
    const g = new ResolutionGovernor(PR_MAX);
    expect(g.ratio).toBe(PR_MAX);
    // Slow frames with a busy CPU are not the GPU's fault: no change.
    for (let i = 0; i < 200; i++) expect(g.step(30, 25)).toBe(false);
    // Slow frames with a light CPU: one step down after about 1.5 s, then another.
    let changes = 0;
    for (let i = 0; i < 50; i++) if (g.step(30, 4)) changes++;
    expect(changes).toBe(1);
    expect(g.ratio).toBeCloseTo(PR_MAX - 0.1);
    for (let i = 0; i < 1000; i++) g.step(30, 4);
    expect(g.ratio).toBe(PR_MIN); // never below the floor
    // A single on-time frame does not undo it; eight seconds of them raise one step.
    expect(g.step(16.7, 4)).toBe(false);
    let raised = 0;
    for (let i = 0; i < 480; i++) if (g.step(16.7, 4)) raised++;
    expect(raised).toBe(1);
    expect(g.ratio).toBeCloseTo(PR_MIN + 0.1);
    // Hidden tabs and nonsense intervals are ignored.
    expect(g.step(5000, 1)).toBe(false);
    expect(g.step(Number.NaN, 1)).toBe(false);
    // A screen whose own pixel ratio is below the floor never goes above it.
    const low = new ResolutionGovernor(0.6);
    for (let i = 0; i < 2000; i++) low.step(30, 2);
    expect(low.ratio).toBe(0.6);
  });

  it('R3D-29: frames that hold 60 fps never lower the resolution, however long the GPU time reads', () => {
    const g = new ResolutionGovernor(PR_MAX);
    for (let i = 0; i < 3000; i++) expect(g.step(16.7, 3, 15)).toBe(false);
    expect(g.ratio).toBe(PR_MAX);
    expect(PR_MIN).toBe(0.85);
  });

  it('R3D-29: with a GPU reading, slow frames drop only when the GPU is the bottleneck, and a raise waits for headroom', () => {
    const g = new ResolutionGovernor(1);
    // Slow frames but the GPU is nearly idle (CPU-bound): no change, whatever the CPU heuristic would say.
    for (let i = 0; i < 300; i++) expect(g.step(30, 3, 5)).toBe(false);
    // Slow frames with the GPU taking most of the interval: one step after about 1.5 s.
    let changes = 0;
    for (let i = 0; i < 50; i++) if (g.step(30, 3, 25)) changes++;
    expect(changes).toBe(1);
    expect(g.ratio).toBeCloseTo(0.9);
    // On-time frames raise it back only when the predicted GPU time one step up fits.
    const h = new ResolutionGovernor(1, 0.9);
    for (let i = 0; i < 2000; i++) h.step(16.7, 3, 16);
    expect(h.ratio).toBe(0.9);
    let raised = 0;
    for (let i = 0; i < 600; i++) if (h.step(16.7, 3, 9)) raised++;
    expect(raised).toBe(1);
    expect(h.ratio).toBe(1);
  });

  it('R3D-29: shadows refresh less often only while the governor has lowered the resolution', () => {
    expect(shadowEvery(1, 1)).toBe(SHADOW_EVERY);
    expect(shadowEvery(0.95, 1)).toBe(SHADOW_EVERY + 1);
    expect(shadowEvery(PR_MIN, 1)).toBe(SHADOW_EVERY + 2);
  });
});

describe('security', () => {
  const swa = JSON.parse(readFileSync('public/staticwebapp.config.json', 'utf8')) as { globalHeaders: Record<string, string> };

  it('SEC-1 NET-5: the website and the desktop app send the same strict Content-Security-Policy', () => {
    const h = swa.globalHeaders;
    expect(h['Content-Security-Policy']).toBe(CSP);
    const dir = new Map(CSP.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k!, v]));
    expect(dir.get('default-src')).toEqual(["'self'"]);
    expect(dir.get('script-src')).toEqual(["'self'"]); // no inline scripts, no eval
    expect(dir.get('object-src')).toEqual(["'none'"]);
    expect(dir.get('frame-ancestors')).toEqual(["'none'"]);
    // NET-5: the only outside connection is the WebSocket to the game's own Web PubSub host.
    expect(dir.get('connect-src')).toEqual(["'self'", 'wss://wps-shardfall.webpubsub.azure.com']);
    expect(CSP).not.toMatch(/unsafe-eval|\*|https?:/);
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Referrer-Policy']).toBe('no-referrer');
    expect(h['Permissions-Policy']).toMatch(/camera=\(\).*microphone=\(\).*geolocation=\(\)/);
    expect(readFileSync('desktop/main.cjs', 'utf8')).toMatch(/'Content-Security-Policy': CSP/);
    // No source maps are published with the build.
    expect(readFileSync('vite.config.ts', 'utf8')).toMatch(/sourcemap: false/);
  });

  it('SEC-1: the game page has no inline script for the policy to block', () => {
    const html = readFileSync('index.html', 'utf8');
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) expect(tag).toMatch(/\bsrc=/);
    expect(html).not.toMatch(/\bon[a-z]+\s*=/i); // no inline event handlers
  });

  it('SEC-2 NET-5: the offline cache keeps only successful responses from the game itself, and drops old caches', async () => {
    const put = vi.fn();
    const deleted: string[] = [];
    const handlers: Record<string, (e: unknown) => void> = {};
    const caches = {
      keys: async () => ['shardfall-v1', 'shardfall-v2'],
      delete: async (k: string) => (deleted.push(k), true),
      open: async () => ({ put }),
      match: async () => undefined,
    };
    let net: Response = new Response('ok', { status: 200 });
    const ctx = {
      self: { addEventListener: (k: string, f: (e: unknown) => void) => (handlers[k] = f), location: { origin: 'https://game.example' }, skipWaiting: () => undefined, clients: { claim: async () => undefined } },
      caches,
      fetch: async () => net,
      URL,
      Promise,
      Response,
    };
    vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), ctx);
    const waits: Promise<unknown>[] = [];
    handlers.activate!({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    expect(deleted).toEqual(['shardfall-v1']);
    const go = async (url: string, method = 'GET'): Promise<boolean> => {
      let responded = false;
      const pending: Promise<unknown>[] = [];
      handlers.fetch!({ request: { url, method }, respondWith: (p: Promise<unknown>) => ((responded = true), pending.push(p)), waitUntil: (p: Promise<unknown>) => pending.push(p) });
      await Promise.all(pending);
      await Promise.all(pending);
      return responded;
    };
    // A good same-origin response is cached (Response.type is 'default' outside a browser, so pose as 'basic').
    net = Object.defineProperty(new Response('ok', { status: 200 }), 'type', { value: 'basic' });
    expect(await go('https://game.example/assets/a.js')).toBe(true);
    expect(put).toHaveBeenCalledTimes(1);
    // Errors are passed through but never cached.
    net = Object.defineProperty(new Response('no', { status: 404 }), 'type', { value: 'basic' });
    await go('https://game.example/missing');
    expect(put).toHaveBeenCalledTimes(1);
    // Other sites and non-GET requests are left to the browser.
    expect(await go('https://elsewhere.example/x.js')).toBe(false);
    expect(await go('https://game.example/api', 'POST')).toBe(false);
    // NET-5: the online-play API is never cached or answered from the cache.
    net = Object.defineProperty(new Response('{}', { status: 200 }), 'type', { value: 'basic' });
    expect(await go('https://game.example/api/negotiate')).toBe(false);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('SEC-3: a seed in the address bar is used only when it is a whole number of up to nine digits', () => {
    expect(seedOf('42', 7)).toBe(42);
    expect(seedOf('000123', 7)).toBe(123);
    expect(seedOf('999999999', 7)).toBe(999999999);
    for (const bad of [null, '', 'abc', '-1', '1.5', '1e9', '1234567890', ' 42', 'Infinity', '0x10']) expect(seedOf(bad, 7)).toBe(7);
  });

  it('SEC-4: CI runs with a read-only token and fails on high or critical vulnerabilities in shipped dependencies', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(ci).toMatch(/npm audit --omit=dev --audit-level=high/);
  });
});
