import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * A stand-in for Azure Web PubSub inside the browser: WebSocket connections to the game's Web PubSub host are relayed
 * between the pages of one browser context through a BroadcastChannel, with the same message envelope the real
 * service uses (json.webpubsub.azure.v1: sendToGroup in, group "message" events with fromUserId out). Everything above
 * the socket (tickets, lobby, lockstep, desync checks, the game) is the real code.
 */
function fakePubSub(): void {
  const Real = window.WebSocket;
  class FakeSocket extends EventTarget {
    readyState = 0;
    protocol = '';
    onopen: ((e: Event) => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onclose: ((e: CloseEvent) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    private bc: BroadcastChannel;
    private user: string;
    private group: string;
    constructor(url: string, protocol?: string | string[]) {
      super();
      const u = new URL(url);
      this.user = u.searchParams.get('fake_user') ?? '';
      this.group = u.searchParams.get('fake_group') ?? '';
      this.protocol = String(protocol ?? '');
      this.bc = new BroadcastChannel('fake-pubsub');
      this.bc.onmessage = (e: MessageEvent<{ group: string; from: string; data: unknown }>) => {
        if (this.readyState !== 1 || e.data.group !== this.group || e.data.from === this.user) return;
        this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'message', from: 'group', group: e.data.group, dataType: 'json', data: e.data.data, fromUserId: e.data.from }) }));
      };
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.(new Event('open'));
      }, 30);
    }
    send(text: string): void {
      const m = JSON.parse(text) as { type: string; group: string; data: unknown; noEcho?: boolean };
      if (m.type === 'sendToGroup' && m.group === this.group) this.bc.postMessage({ group: m.group, from: this.user, data: m.data });
    }
    close(code = 1000): void {
      this.readyState = 3;
      this.bc.close();
      this.onclose?.(new CloseEvent('close', { code }));
    }
  }
  (window as unknown as { WebSocket: unknown }).WebSocket = function (url: string, protocol?: string | string[]) {
    return url.startsWith('wss://wps-shardfall.webpubsub.azure.com/') ? new FakeSocket(url, protocol) : new Real(url, protocol);
  };
}

async function online(context: BrowserContext): Promise<void> {
  await context.addInitScript(fakePubSub);
  let n = 0;
  await context.route('**/api/negotiate', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { available: true } });
    const body = (req.postDataJSON() ?? {}) as { room?: string };
    const room = body.room ?? 'ABC234';
    const userId = `u${++n}`;
    const group = `room-${room}`;
    return route.fulfill({ json: { url: `wss://wps-shardfall.webpubsub.azure.com/client/hubs/shardfall?access_token=x&fake_user=${userId}&fake_group=${group}`, room, group, userId } });
  });
}

type Hook = { snapshot(): { tick: number; units: { id: number; owner: number; x: number; y: number }[] } | null; send(c: unknown): void };
const tick = (p: Page): Promise<number> => p.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.snapshot()?.tick ?? 0);

test('NET-1 NET-2 NET-3 NET-4: two players host and join a room, play the same match in lockstep, and the stayer wins when the other leaves', async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  await online(context);
  const a = await context.newPage();
  const b = await context.newPage();
  const errors: string[] = [];
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(String(e)));

  // Host: Vrax on Riverbed.
  await a.goto('/');
  await a.locator('#menu [data-faction="alien"]').click();
  await a.locator('#menu [data-map="riverbed"]').click();
  await a.locator('#menu [data-mode="multi"]').click();
  await expect(a.locator('#menu [data-mp="faction"]')).toHaveText('Vrax Hive');
  await a.locator('#mp-host').click();
  await expect(a.locator('#mp-room')).toHaveText('ABC234');
  await expect(a.locator('#mp-status')).toContainText('Waiting for your friend');

  // Guest: types the code untidily.
  await b.goto('/');
  await b.locator('#menu [data-mode="multi"]').click();
  await b.locator('#mp-code').fill('abc-234');
  await b.locator('#mp-join').click();

  for (const p of [a, b]) await p.waitForSelector('body[data-ready="true"]', { timeout: 90_000 });
  await expect(a).toHaveURL(/faction=alien.*map=riverbed.*online=ABC234/);
  await expect(b).toHaveURL(/faction=human.*map=riverbed.*online=ABC234/);
  for (const p of [a, b]) await expect(p.locator('#topbar')).toContainText('online · room ABC234');

  // Each side orders its own units; the orders travel in lockstep turns.
  const order = async (p: Page, me: number): Promise<{ id: number; x: number; y: number }> =>
    p.evaluate((me) => {
      const h = (window as unknown as { __shardfall: Hook }).__shardfall;
      const u = h.snapshot()!.units.find((x) => x.owner === me)!;
      h.send({ type: 'move', player: me, units: [u.id], x: 18 * 256, y: 18 * 256 });
      return { id: u.id, x: u.x, y: u.y };
    }, me);
  const ua = await order(a, 0);
  const ub = await order(b, 1);
  // Both games advance together past several checksums (every 3 s) without going out of sync.
  await expect.poll(() => tick(a), { timeout: 60_000 }).toBeGreaterThan(260);
  await expect.poll(() => tick(b), { timeout: 60_000 }).toBeGreaterThan(260);
  expect(Math.abs((await tick(a)) - (await tick(b)))).toBeLessThan(40);
  for (const p of [a, b]) await expect(p.locator('#result')).toBeHidden();
  const moved = (p: Page, u: { id: number; x: number; y: number }): Promise<boolean> =>
    p.evaluate((u) => {
      const now = (window as unknown as { __shardfall: Hook }).__shardfall.snapshot()!.units.find((x) => x.id === u.id);
      return !!now && (now.x !== u.x || now.y !== u.y);
    }, u);
  expect(await moved(a, ua)).toBe(true);
  expect(await moved(b, ub)).toBe(true);
  // An online match cannot be paused.
  await a.keyboard.press('p');
  await expect(a.locator('#hud .toast').last()).toHaveText('Online matches cannot be paused');
  const before = await tick(a);
  await expect.poll(() => tick(a)).toBeGreaterThan(before + 20);

  // The guest quits to the menu: the host is told and wins.
  await b.keyboard.press('Escape');
  await expect(b.locator('#pause h2')).toContainText('THE MATCH GOES ON');
  await b.locator('#quit').click();
  await expect(a.locator('#result h1')).toHaveText('VICTORY', { timeout: 45_000 });
  await expect(a.locator('#result')).toContainText('opponent');
  await expect(a.locator('#again')).toBeHidden();
  expect(errors).toEqual([]);
  await context.close();
});
