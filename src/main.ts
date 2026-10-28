import { demoMap } from './data/maps';
import { mountMap } from './render/mapView';
import { createGame, snapshot } from './sim';

const host = document.getElementById('app');
if (!host) throw new Error('missing #app');

const game = createGame({ seed: 1, map: demoMap() });
mountMap(host, snapshot(game)).then(() => {
  document.body.dataset.ready = 'true';
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
