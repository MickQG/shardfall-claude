'use strict';

const path = require('node:path');

/** The origin the desktop app serves the built game from. A custom scheme gives workers, fetch and module scripts a proper origin, unlike file://. */
const APP_ORIGIN = 'app://shardfall';

/**
 * Maps a request path on the app origin to a file inside `root`.
 * `/` is the game's index page. Anything that would leave `root` (dot segments, encoded separators, other drives) is rejected with null.
 */
function resolveAppPath(root, urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  // NUL bytes, drive letters and UNC-style double slashes are never part of a game asset path.
  if (p.includes('\0') || /^\/?[a-zA-Z]:/.test(p) || p.startsWith('//')) return null;
  p = p.split('?')[0].split('#')[0];
  if (p === '' || p === '/') p = '/index.html';
  const abs = path.resolve(root, '.' + (p.startsWith('/') ? p : '/' + p));
  const rel = path.relative(root, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

/** Whether a URL belongs to the game itself; everything else is opened in the user's browser instead of inside the app. */
function isInternalUrl(url) {
  return url === APP_ORIGIN || url.startsWith(APP_ORIGIN + '/');
}

/**
 * Content-Security-Policy for the game page (SEC-1), the same on the website and in the desktop app: code, workers and
 * data come only from the game's own origin; styles may be inline (the HUD sets them from code); images may be data or
 * blob URLs (cursors, generated textures); no plugins, and no other site may frame the page or receive its forms. The
 * one outside connection is the WebSocket to the game's own Azure Web PubSub service for online matches (NET-5).
 */
const PUBSUB_ORIGIN = 'wss://wps-shardfall.webpubsub.azure.com';
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${PUBSUB_ORIGIN}`,
  "media-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

module.exports = { APP_ORIGIN, CSP, PUBSUB_ORIGIN, resolveAppPath, isInternalUrl };
