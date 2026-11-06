import { hostRoom, joinRoom, type Match, type Pending } from '../net/lobby';
import { normalizeCode, type Faction, type MapName } from '../net/protocol';
import { connectRoom, multiplayerStatus, negotiate, type Transport } from '../net/transport';

/**
 * The Multiplayer panel of the main menu (MENU-2, NET-1): host a room with the faction and map picked on the Single
 * player panel and share its code, or join a friend's room with theirs. When both are in, the match starts.
 */

export const ONLINE_CSS = `
#menu .mp [hidden] { display: none !important; }
#menu .mp { display: flex; flex-direction: column; gap: 16px; max-width: 760px; }
#menu .mp-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
#menu .mp-card { display: flex; flex-direction: column; gap: 10px; padding: 20px; border-radius: 12px; border: 1px solid #22384c; background: linear-gradient(160deg, rgba(16,28,40,.92), rgba(8,13,19,.92)); }
#menu .mp-card h3 { margin: 0; font-size: 19px; color: #7ff5cd; }
#menu .mp-card p { margin: 0; color: #b6c7d6; font-size: 13.5px; }
#menu .mp-card b { color: #dfe8e2; }
#menu .mp button.act { align-self: flex-start; padding: 11px 22px; border-radius: 10px; border: 0; cursor: pointer; font: inherit; font-weight: 700; letter-spacing: .06em; background: linear-gradient(#35e0a1, #1fa57a); color: #04130d; }
#menu .mp button.act:disabled { opacity: .45; cursor: default; }
#menu .mp button.ghost { padding: 10px 18px; border-radius: 10px; border: 1px solid #28405a; background: #101c27; color: #dfe8e2; font: inherit; font-weight: 600; cursor: pointer; }
#menu .mp input { width: 9ch; padding: 10px 12px; border-radius: 10px; border: 1px solid #28405a; background: #0b1218; color: #dfe8e2; font: 600 20px/1 ui-monospace, monospace; letter-spacing: .2em; text-transform: uppercase; }
#menu .mp .joinrow { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
#menu .mp-wait { padding: 22px; border-radius: 12px; border: 1px solid #2b6b55; background: rgba(18,51,41,.35); display: flex; flex-direction: column; gap: 12px; }
#menu .mp-code { font: 800 44px/1 ui-monospace, monospace; letter-spacing: .3em; color: #7ff5cd; }
#menu .mp-status { color: #b6c7d6; }
#menu .mp-status::after { content: ''; display: inline-block; width: 1.2em; text-align: left; animation: mp-dots 1.2s steps(4) infinite; }
@keyframes mp-dots { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; } }
#menu .mp-err { margin: 0; color: #ff9a8a; min-height: 1.4em; }
#menu .mp-off { padding: 18px 20px; border-radius: 12px; border: 1px dashed #6b5520; background: rgba(28,22,8,.55); color: #c9bfa4; }
@media (max-width: 860px) { #menu .mp-cards { grid-template-columns: 1fr; } }
`;

const NAMES = { human: 'Aegis Union', alien: 'Vrax Hive' } as const;
const MAP_NAMES = { crossroads: 'Crossroads', riverbed: 'Riverbed', highlands: 'Highlands', generated: 'Generated' } as const;

export interface OnlinePanelDeps {
  pick(): { faction: Faction; map: MapName; mapSeed: number };
  /** A fresh random seed for a hosted match. */
  seed(): number;
  start(m: Match): void;
  status?: typeof multiplayerStatus;
  ticket?: typeof negotiate;
  connect?: (t: Awaited<ReturnType<typeof negotiate>>) => Promise<Transport>;
}

export function mountOnlinePanel(el: HTMLElement, badge: HTMLElement, deps: OnlinePanelDeps): { refresh(): void } {
  el.innerHTML = `<div class="mp">
    <div class="mp-off" hidden></div>
    <div class="mp-cards">
      <div class="mp-card"><h3>Host a match</h3><p>You play <b data-mp="faction"></b> on <b data-mp="map"></b>, as picked on the Single player page. Your friend plays the other faction.</p><button class="act" id="mp-host">Create room</button></div>
      <div class="mp-card"><h3>Join a match</h3><p>Type the room code your friend gives you.</p><div class="joinrow"><input id="mp-code" maxlength="7" autocomplete="off" spellcheck="false" aria-label="Room code" placeholder="ABC234"><button class="act" id="mp-join">Join</button></div></div>
    </div>
    <div class="mp-wait" hidden><div>Room code</div><div class="mp-code" id="mp-room"></div><div class="mp-status" id="mp-status"></div><div class="joinrow"><button class="ghost" id="mp-copy" hidden>Copy code</button><button class="ghost" id="mp-cancel">Cancel</button></div></div>
    <p class="mp-err" id="mp-err" role="alert"></p>
    <p class="note">One versus one against a friend over the internet. Online matches run at normal speed and cannot be paused.</p>
  </div>`;
  const q = <T extends HTMLElement>(s: string): T => el.querySelector<T>(s)!;
  const off = q('.mp-off');
  const cards = q('.mp-cards');
  const wait = q('.mp-wait');
  const err = q('#mp-err');
  const code = q<HTMLInputElement>('#mp-code');
  const hostBtn = q<HTMLButtonElement>('#mp-host');
  const joinBtn = q<HTMLButtonElement>('#mp-join');
  const copyBtn = q<HTMLButtonElement>('#mp-copy');
  let pending: Pending | null = null;
  let transport: Transport | null = null;
  let busy = false;

  const refresh = (): void => {
    const p = deps.pick();
    q('[data-mp="faction"]').textContent = NAMES[p.faction];
    q('[data-mp="map"]').textContent = p.map === 'generated' ? `${MAP_NAMES.generated} (seed ${p.mapSeed})` : MAP_NAMES[p.map];
  };
  const show = (waiting: boolean, room = '', status = ''): void => {
    cards.hidden = waiting;
    wait.hidden = !waiting;
    q('#mp-room').textContent = room;
    q('#mp-status').textContent = status;
    copyBtn.hidden = !room;
  };
  const reset = (message = ''): void => {
    pending?.cancel();
    pending = null;
    transport?.close();
    transport = null;
    busy = false;
    show(false);
    err.textContent = message;
  };
  const begin = async (room: string | null): Promise<void> => {
    if (busy) return;
    busy = true;
    err.textContent = '';
    show(true, room ?? '', 'Connecting');
    try {
      const ticket = await (deps.ticket ?? negotiate)(room);
      if (!busy) return;
      transport = await (deps.connect ?? connectRoom)(ticket);
      if (!busy) {
        transport.close();
        return;
      }
      transport.onClose = () => reset('The connection to the game server was lost.');
      if (room === null) {
        const p = deps.pick();
        show(true, ticket.room, 'Waiting for your friend to join');
        pending = hostRoom(transport, ticket.room, { seed: deps.seed(), map: p.map, ...(p.map === 'generated' ? { mapSeed: p.mapSeed } : {}), factions: [p.faction, p.faction === 'human' ? 'alien' : 'human'] });
      } else {
        show(true, ticket.room, 'Joining');
        pending = joinRoom(transport, ticket.room);
      }
      const match = await pending.match;
      transport.onClose = null;
      q('#mp-status').textContent = 'Starting';
      deps.start(match);
    } catch (e) {
      if (e instanceof Error && e.message === 'cancelled') return;
      reset(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  hostBtn.addEventListener('click', () => void begin(null));
  const join = (): void => {
    const c = normalizeCode(code.value);
    if (!c) {
      err.textContent = 'A room code is six letters and numbers, like ABC234.';
      return;
    }
    void begin(c);
  };
  joinBtn.addEventListener('click', join);
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join();
    e.stopPropagation();
  });
  q('#mp-cancel').addEventListener('click', () => reset());
  copyBtn.addEventListener('click', () => {
    const room = q('#mp-room').textContent ?? '';
    navigator.clipboard?.writeText(room).then(
      () => (copyBtn.textContent = 'Copied'),
      () => undefined,
    );
  });

  // Online play needs the website's game server; say so plainly where it is missing (NET-1).
  hostBtn.disabled = joinBtn.disabled = true;
  void (deps.status ?? multiplayerStatus)().then((s) => {
    hostBtn.disabled = joinBtn.disabled = !s.available;
    off.hidden = s.available;
    off.textContent = s.reason;
    cards.hidden = !s.available;
    badge.hidden = s.available;
  });
  refresh();
  return { refresh };
}
