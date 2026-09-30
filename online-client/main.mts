// online-client/main.mts
import { PlayerSession, type PlayerSessionState } from '../src/app/online/PlayerSession';
import { createPeerClient } from '../src/app/online/transport/PeerTransport';
import { parseJoinFragment } from '../src/app/online/joinLink';
import { normalizePlayerName } from '../src/app/online/protocol';
import { randomId } from '../src/app/online/ids';

const VERSION = '0.1.0';
const form = document.getElementById('join') as HTMLFormElement;
const nameInput = document.getElementById('name') as HTMLInputElement;
const status = document.getElementById('status') as HTMLParagraphElement;
const playerList = document.getElementById('players') as HTMLUListElement;

/** localStorage can throw in private windows; the page still works without it. */
function stored(key: string, fallback: () => string): string {
  try {
    const value = localStorage.getItem(key) ?? fallback();
    localStorage.setItem(key, value);
    return value;
  } catch {
    return fallback();
  }
}

const REASONS: Record<string, string> = {
  denied: 'The GM did not let you in.',
  kicked: 'The GM removed you from the session.',
  full: 'The session is full.',
  version: 'This page is out of date for your GM\'s Atlas. Ask them for a new link.',
  ended: 'The session ended.',
  replaced: 'You joined from another tab.',
  unreachable: 'Couldn\'t connect. Check the link, or your GM may need to add a relay server in Atlas settings.',
  'connection-lost': 'Lost the connection to your GM. Reload the page to try again.',
};

function render(state: PlayerSessionState): void {
  const text: Record<PlayerSessionState['status'], string> = {
    connecting: 'Connecting…',
    waiting: 'Waiting for the GM to let you in…',
    admitted: `Connected to ${state.title ?? 'the table'}. Waiting for the GM to show a scene.`,
    denied: REASONS[state.reason ?? 'denied'] ?? REASONS.denied!,
    lost: REASONS[state.reason ?? 'unreachable'] ?? REASONS.unreachable!,
  };
  status.textContent = text[state.status];
  playerList.hidden = state.status !== 'admitted';
  playerList.replaceChildren(...state.players.map((player) => {
    const item = document.createElement('li');
    item.textContent = player.connected ? player.name : `${player.name} (away)`;
    return item;
  }));
}

const target = parseJoinFragment(location.hash);
if (!target) {
  status.textContent = 'This link is incomplete. Ask your GM for the join link again.';
} else {
  form.hidden = false;
  nameInput.value = stored('atlas-online:name', () => '');
  let started = false;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (started) return;
    const name = normalizePlayerName(nameInput.value);
    if (!name) {
      status.textContent = 'Enter a name of up to 40 characters.';
      return;
    }
    try { localStorage.setItem('atlas-online:name', name); } catch { /* private window */ }
    started = true;
    form.hidden = true;
    new PlayerSession({
      hostId: target.hostId,
      name,
      // One key per GM session, so different GMs cannot recognise or pose as the same player.
      playerKey: stored(`atlas-online:player-key:${target.hostId}`, () => randomId()),
      clientVersion: VERSION,
      transport: createPeerClient(target.server),
      onChange: render,
    }).start();
  });
}
