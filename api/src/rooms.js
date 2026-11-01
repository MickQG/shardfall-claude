'use strict';
const crypto = require('node:crypto');

/**
 * Room tickets for online matches (NET-1, NET-5). Pure helpers, no SDK: a ticket is a Web PubSub client URL with a
 * short-lived JWT, signed with the service's access key (HS256), that lets one user send to and receive from exactly
 * one room's group and nothing else.
 */

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const HUB = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;
/** How long a ticket can be used to connect, seconds. An open connection is not cut when it expires. */
const TICKET_SECONDS = 3600;

/** A new room code: six characters, no look-alikes, from a cryptographic random source. */
function newCode(randomInt = crypto.randomInt) {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

const validCode = (c) => typeof c === 'string' && CODE.test(c);

/** Endpoint and key from a Web PubSub connection string, or null if it is not one. */
function parseConnectionString(cs) {
  if (typeof cs !== 'string') return null;
  const parts = {};
  for (const kv of cs.split(';')) {
    const i = kv.indexOf('=');
    if (i > 0) parts[kv.slice(0, i).trim().toLowerCase()] = kv.slice(i + 1).trim();
  }
  let url;
  try {
    url = new URL(parts.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !parts.accesskey) return null;
  return { host: url.host, key: parts.accesskey };
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** An HS256 JWT. */
function sign(claims, key) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const mac = crypto.createHmac('sha256', key).update(`${head}.${body}`).digest();
  return `${head}.${body}.${b64url(mac)}`;
}

/**
 * The ticket for `userId` to room `code`: least privilege (NET-5), it can only publish to the room's group and is put
 * in it on connect; it cannot join or send to any other group.
 */
function ticket({ host, key }, hub, code, userId, nowSeconds) {
  if (!HUB.test(hub) || !validCode(code)) throw new Error('bad room');
  const group = `room-${code}`;
  const aud = `https://${host}/client/hubs/${hub}`;
  const token = sign({ aud, iat: nowSeconds, exp: nowSeconds + TICKET_SECONDS, sub: userId, role: [`webpubsub.sendToGroup.${group}`], 'webpubsub.group': [group] }, key);
  return { url: `wss://${host}/client/hubs/${hub}?access_token=${token}`, room: code, group, userId };
}

const newUserId = () => `u${crypto.randomBytes(9).toString('hex')}`;

module.exports = { ALPHABET, TICKET_SECONDS, newCode, validCode, parseConnectionString, sign, ticket, newUserId };
