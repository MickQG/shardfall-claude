import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { ROOM_CODE } from '../../src/net/protocol';

interface Rooms {
  ALPHABET: string;
  TICKET_SECONDS: number;
  newCode(randomInt?: (n: number) => number): string;
  validCode(c: unknown): boolean;
  parseConnectionString(cs: unknown): { host: string; key: string } | null;
  ticket(svc: { host: string; key: string }, hub: string, code: string, userId: string, now: number): { url: string; room: string; group: string; userId: string };
  newUserId(): string;
}
const rooms = createRequire(import.meta.url)('../../api/src/rooms.js') as Rooms;

const KEY = 'c2VjcmV0LWtleS1mb3ItdGVzdHMtb25seQ==';
const SVC = { host: 'example.webpubsub.azure.com', key: KEY };
const decode = (part: string): Record<string, unknown> => JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as Record<string, unknown>;

describe('room tickets (server function)', () => {
  it('NET-1: room codes come from the same six-character alphabet the game accepts', () => {
    expect(rooms.ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
    for (let i = 0; i < 200; i++) expect(ROOM_CODE.test(rooms.newCode())).toBe(true);
    expect(rooms.validCode('ABC234')).toBe(true);
    for (const bad of ['abc234', 'ABC23', 'ABC1O0', 42, null, 'ABC234 ', '../../x']) expect(rooms.validCode(bad)).toBe(false);
    expect(rooms.newUserId()).toMatch(/^u[0-9a-f]{18}$/);
    expect(rooms.newUserId()).not.toBe(rooms.newUserId());
  });

  it('NET-5: a ticket is a signed, one-hour token that only lets its user publish to and be in one room group', () => {
    const t = rooms.ticket(SVC, 'shardfall', 'ABC234', 'u0123', 1_000_000);
    expect(t).toMatchObject({ room: 'ABC234', group: 'room-ABC234', userId: 'u0123' });
    expect(t.url.startsWith('wss://example.webpubsub.azure.com/client/hubs/shardfall?access_token=')).toBe(true);
    const token = new URL(t.url).searchParams.get('access_token')!;
    const [head, body, sig] = token.split('.') as [string, string, string];
    expect(decode(head)).toEqual({ alg: 'HS256', typ: 'JWT' });
    const claims = decode(body);
    expect(claims).toEqual({
      aud: 'https://example.webpubsub.azure.com/client/hubs/shardfall',
      iat: 1_000_000,
      exp: 1_000_000 + 3600,
      sub: 'u0123',
      role: ['webpubsub.sendToGroup.room-ABC234'],
      'webpubsub.group': ['room-ABC234'],
    });
    // No broad roles: it cannot join or send to other groups.
    expect(JSON.stringify(claims)).not.toMatch(/joinLeaveGroup|sendToGroups|\*/);
    // Signed with the access key (HS256).
    const expected = createHmac('sha256', KEY).update(`${head}.${body}`).digest('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    expect(sig).toBe(expected);
    expect(() => rooms.ticket(SVC, 'shardfall', 'room-x', 'u1', 0)).toThrow();
    expect(() => rooms.ticket(SVC, 'hub/../x', 'ABC234', 'u1', 0)).toThrow();
  });

  it('NET-5: the connection string is read from settings and must name an https endpoint and a key', () => {
    expect(rooms.parseConnectionString(`Endpoint=https://example.webpubsub.azure.com;AccessKey=${KEY};Version=1.0;`)).toEqual(SVC);
    expect(rooms.parseConnectionString('Endpoint=http://example.webpubsub.azure.com;AccessKey=abc;')).toBeNull();
    expect(rooms.parseConnectionString('Endpoint=https://example.webpubsub.azure.com;')).toBeNull();
    expect(rooms.parseConnectionString(undefined)).toBeNull();
    // The function reads it from app settings, never from the repository.
    const fn = readFileSync('api/src/functions/negotiate.js', 'utf8');
    expect(fn).toContain('process.env.WEBPUBSUB_CONNECTION_STRING');
    expect(fn).not.toMatch(/AccessKey=/);
    expect(readFileSync('api/package.json', 'utf8')).toMatch(/"@azure\/functions": "\d+\.\d+\.\d+"/); // pinned
  });
});
