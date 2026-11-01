'use strict';
const { app } = require('@azure/functions');
const { newCode, newUserId, parseConnectionString, ticket, validCode } = require('../rooms');

/**
 * GET /api/negotiate: whether online play is configured here. POST /api/negotiate with `{}` makes a new room, with
 * `{ "room": "ABC234" }` joins one; either returns a ticket for that room only (NET-1, NET-5). The Web PubSub
 * connection string comes from the app setting WEBPUBSUB_CONNECTION_STRING and never leaves the server.
 */
const json = (status, body) => ({ status, jsonBody: body, headers: { 'cache-control': 'no-store' } });

app.http('negotiate', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'negotiate',
  handler: async (request) => {
    const service = parseConnectionString(process.env.WEBPUBSUB_CONNECTION_STRING);
    const hub = process.env.WEBPUBSUB_HUB || 'shardfall';
    if (request.method === 'GET') return json(200, { available: !!service });
    if (!service) return json(503, { error: 'not configured' });
    const text = await request.text();
    if (text.length > 256) return json(400, { error: 'bad request' });
    let body = {};
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        return json(400, { error: 'bad request' });
      }
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json(400, { error: 'bad request' });
    const room = body.room === undefined ? newCode() : body.room;
    if (!validCode(room)) return json(400, { error: 'bad room code' });
    return json(200, ticket(service, hub, room, newUserId(), Math.floor(Date.now() / 1000)));
  },
});
