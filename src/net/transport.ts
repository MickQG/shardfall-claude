import { MAX_MESSAGE_CHARS, parseMessage, type NetMsg } from './protocol';

/** A room connection: messages to and from the other people in the room (NET-1, NET-5). */
export interface Transport {
  /** This connection's user id, set by the server in its signed token. */
  readonly userId: string;
  send(msg: NetMsg): void;
  /** Valid messages from others, with the sender's user id. Messages that arrive while unset are kept and replayed. */
  setHandler(h: ((msg: NetMsg, from: string) => void) | null): void;
  onClose: ((why: string) => void) | null;
  close(): void;
}

/** What the server hands out for one room (NET-1): where to connect, as whom, and the room's group. */
export interface RoomTicket {
  url: string;
  room: string;
  group: string;
  userId: string;
}

/** The WebSocket subprotocol of Azure Web PubSub that lets clients publish to a group directly. */
export const SUBPROTOCOL = 'json.webpubsub.azure.v1';
const CONNECT_MS = 10_000;
const MAX_KEPT = 512;

type SocketCtor = new (url: string, protocols?: string | string[]) => WebSocket;

/**
 * Connect to a room over Azure Web PubSub (NET-1). Only group messages from other users of the same group, carrying
 * JSON that passes `parseMessage`, reach the handler; everything else is dropped (NET-5).
 */
export function connectRoom(ticket: RoomTicket, Socket: SocketCtor = WebSocket): Promise<Transport> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new Socket(ticket.url, SUBPROTOCOL);
    } catch (e) {
      reject(e instanceof Error ? e : new Error('Could not connect'));
      return;
    }
    let handler: ((msg: NetMsg, from: string) => void) | null = null;
    const kept: [NetMsg, string][] = [];
    let open = false;
    const timer = setTimeout(() => {
      if (!open) {
        ws.close();
        reject(new Error('The game server did not answer'));
      }
    }, CONNECT_MS);
    const t: Transport = {
      userId: ticket.userId,
      send(msg) {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'sendToGroup', group: ticket.group, dataType: 'json', data: msg, noEcho: true }));
      },
      setHandler(h) {
        handler = h;
        while (handler && kept.length) {
          const [m, from] = kept.shift()!;
          handler(m, from);
        }
      },
      onClose: null,
      close() {
        ws.close(1000);
      },
    };
    ws.onopen = () => {
      open = true;
      clearTimeout(timer);
      resolve(t);
    };
    ws.onerror = () => {
      if (!open) {
        clearTimeout(timer);
        reject(new Error('Could not connect to the game server'));
      }
    };
    ws.onclose = (e) => {
      if (open) t.onClose?.(e.code === 1000 ? 'closed' : 'lost');
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data.length > MAX_MESSAGE_CHARS) return;
      let env: unknown;
      try {
        env = JSON.parse(e.data);
      } catch {
        return;
      }
      if (typeof env !== 'object' || env === null) return;
      const m = env as { type?: unknown; from?: unknown; group?: unknown; dataType?: unknown; fromUserId?: unknown; data?: unknown };
      if (m.type !== 'message' || m.from !== 'group' || m.group !== ticket.group || m.dataType !== 'json') return;
      if (typeof m.fromUserId !== 'string' || m.fromUserId === ticket.userId) return;
      const msg = parseMessage(m.data);
      if (!msg) return;
      if (handler) handler(msg, m.fromUserId);
      else if (kept.length < MAX_KEPT) kept.push([msg, m.fromUserId]);
    };
  });
}

/** Whether online play can work here, and if not, why (NET-1). */
export async function multiplayerStatus(fetcher: typeof fetch = fetch): Promise<{ available: boolean; reason: string }> {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return { available: false, reason: 'Online play is available on the website, not in the desktop app.' };
  try {
    const r = await fetcher('/api/negotiate', { method: 'GET', headers: { accept: 'application/json' } });
    if (!r.ok) return { available: false, reason: 'Online play is not available on this server.' };
    const body = (await r.json()) as { available?: unknown };
    return body.available === true ? { available: true, reason: '' } : { available: false, reason: 'Online play is not configured on this server yet.' };
  } catch {
    return { available: false, reason: 'Online play is not available right now.' };
  }
}

/** Ask the server for a ticket to a new room (`room` null) or to the room with that code (NET-1). */
export async function negotiate(room: string | null, fetcher: typeof fetch = fetch): Promise<RoomTicket> {
  const r = await fetcher('/api/negotiate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(room ? { room } : {}) });
  if (!r.ok) throw new Error(r.status === 400 ? 'That room code is not valid.' : 'The game server is not available right now.');
  const b = (await r.json()) as Partial<RoomTicket>;
  if (typeof b.url !== 'string' || !b.url.startsWith('wss://') || typeof b.room !== 'string' || typeof b.group !== 'string' || typeof b.userId !== 'string') throw new Error('The game server sent an unexpected answer.');
  return { url: b.url, room: b.room, group: b.group, userId: b.userId };
}
