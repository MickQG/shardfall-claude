const params = new URLSearchParams(location.search);

// A start screen until a faction has been chosen; the choice travels in the URL so a game is a shareable link.
if (params.get('faction')) void import('./game');
else void import('./ui/menu').then((m) => m.showMenu());

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
