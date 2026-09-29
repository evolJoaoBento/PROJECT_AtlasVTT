# Online play, piece 1: sessions and connection

Date: 2026-09-29. Status: design, awaiting review.

## Context

Atlas VTT is offline: players see the game on a local second screen (the
player window, which copies the GM's canvas with GM-only layers hidden). This
is the first of six pieces that let players join over the internet and move
their own tokens:

1. **Sessions and connection** (this spec): hosting, joining, admission,
   presence, reconnection, and the protocol envelope the rest builds on.
2. Player-visible state sync: `projectForPlayers`, a snapshot on join, deltas after.
3. Asset streaming: map and token images on demand, on their own channel.
4. Web player client: the player view rendered in a browser.
5. Players moving their own tokens: ownership, GM-validated actions.
6. Later: an Obsidian player client speaking the same protocol.

## Goals

- The GM starts an online session from Atlas and gets a join link to share.
- A player opens the link in a browser, enters a name, and waits while the GM
  approves; the GM sees who is waiting, who is connected, and can remove anyone.
- Connections survive short drops without the GM approving again.
- No hosting cost: signaling uses the public PeerJS server by default and can
  point at a self-hosted one; no relay is needed on most networks.
- Every later piece plugs into the session without changing it.

## Non-goals (this piece)

- Sending any map state, images or dice rolls (pieces 2 and 3).
- A player view that renders the map (piece 4).
- Player actions (piece 5).
- Mesh topologies, voice or video, chat.

## Decisions

| Question | Decision |
| --- | --- |
| Transport | PeerJS data connections, star topology: players connect only to the GM. |
| Channels | Two per player: `control` (reliable, ordered; control and state) and `assets` (reliable; binary, piece 3). |
| Signaling | PeerJS cloud (`0.peerjs.com`) by default; host, port, path, key and TLS configurable for a self-hosted `peerjs-server`. |
| NAT traversal | PeerJS's default STUN; optional TURN servers in settings. |
| Admission | Unguessable link, then the GM approves each join. |
| Scene players see | The presented scene, as in the local player window (used from piece 2 on). |
| Player page | Static build in this repo (`online-client/`), hosted e.g. on GitHub Pages; its URL is a setting. |
| Join link | `<player page URL>#<gm-peer-id>`: the id is in the fragment, so it never reaches the page's host. |

## Architecture

All new code lives under `src/app/online/`, plus a separate web build under
`online-client/`. Nothing in this piece touches the map store or renderers.

### Protocol (`online/protocol.ts`)

The only module the web client shares with the plugin, so it imports nothing
from Obsidian, PIXI or PeerJS.

Every control message is JSON: `{ v: 1, type: string, ...fields }`. Decoding
checks `v`, `type` and each field's shape; anything else is rejected and
logged. A peer that sends three invalid messages is disconnected.

Messages in this piece:

| Type | Direction | Fields |
| --- | --- | --- |
| `join` | player → GM | `name` (1–40 chars), `playerKey` (random id the browser keeps), `client` (`{ kind: 'web', version }`) |
| `admitted` | GM → player | `playerId` (the GM's id for this player), `session` (`{ title }`) |
| `denied` | GM → player | `reason`: `denied`, `kicked`, `full`, `version`, `ended` |
| `presence` | GM → all admitted | `players`: `{ playerId, name, connected }[]` |
| `ping` / `pong` | both | `t` (sender's clock) |
| `bye` | both | `reason` |

Later pieces add `snapshot`, `patch` and `action` on `control`, and
`asset-request` plus binary chunks on `assets`. A version bump is only needed
for incompatible changes: unknown `type`s are ignored, not rejected, so an
older player page keeps working with a newer GM where it can.

### Transport (`online/transport/`)

```ts
interface HostTransport {
  readonly id: string;                         // the GM's peer id
  onConnection(cb: (link: PeerLink) => void): Unsubscribe;
  onError(cb: (error: TransportError) => void): Unsubscribe;
  close(): void;
}
interface PeerLink {                           // one player, both channels
  readonly remoteId: string;
  send(channel: 'control' | 'assets', data: string | ArrayBuffer): void;
  onMessage(cb: (channel, data) => void): Unsubscribe;
  onClose(cb: () => void): Unsubscribe;
  close(): void;
}
```

- `PeerTransport` wraps PeerJS. The host opens with a fresh id of 128 random
  bits (base64url). It builds its config from the online settings, including
  `iceServers` = STUN plus any TURN entries. A player's `PeerLink` exists once both
  its `control` and `assets` data connections are open, matched by a `linkId`
  sent in the connection metadata.
- `MemoryTransport` links a host and clients in one process for tests.
- Only `PeerTransport` imports PeerJS; the rest of the code depends on the
  interfaces.

### GM session (`online/GmSession.ts`)

One per vault while hosting, created by the plugin (not per map view), so
switching or closing map tabs does not drop players.

- State is published through a small zustand store (`onlineSessionStore`), the
  way `playerWindowStore` publishes the local window:
  `{ status: 'idle' | 'starting' | 'hosting' | 'error', peerId, joinUrl, players, pending, error }`.
- Players: `{ playerId, name, playerKey, status: 'pending' | 'admitted' | 'gone', link }`.
- Flow:
  1. A link opens; the session waits up to 10 s for `join`, else closes it.
  2. `join` with a known `playerKey` whose player is `gone` (a reconnect) is
     admitted again at once. Otherwise the player becomes `pending` and the GM
     is asked.
  3. On Allow: `admitted` to the player, `presence` to everyone. On Deny:
     `denied`, then close. Unanswered requests expire after 2 minutes.
  4. `ping` every 5 s; no `pong` in 15 s marks the player `gone` and closes the link.
  5. Kick: `denied { reason: 'kicked' }`, close, and forget the `playerKey`,
     so the player has to be approved again.
- A hook for later pieces: `session.use(handler)`, where a handler gets
  `onAdmitted(player)`, `onMessage(player, message)` and `onGone(player)`.
  Pieces 2, 3 and 5 are handlers; the session itself never learns about maps.
- A session has at most 12 admitted players; more get `denied { reason: 'full' }`.
- Stopping sends `bye` to everyone, closes the transport, and clears state.
  Unloading the plugin stops the session.

### Player session (`online/PlayerSession.ts`)

Shared by the web client (and piece 6). It connects to a GM id, sends `join`,
and exposes `{ status: 'connecting' | 'waiting' | 'admitted' | 'denied' | 'lost', players, reason }`.
When a connection drops after admission, it retries with backoff (1, 2, 4, 8,
15 s, then every 15 s for 5 minutes) using the same `playerKey`, so the GM is
not asked again. It does not retry after a denial or a `bye`.

### Settings

A new "Online play" group in Atlas settings, stored in `AtlasSettings.online`:

- **Signaling server:** `PeerJS cloud (free)` or `Custom`, with host, port,
  path, key and secure.
- **TURN servers:** a list of `{ urls, username, credential }`, empty by default.
- **Player page URL:** where join links point. The default is the fork's
  GitHub Pages address, `https://evoljoaobento.github.io/atlas-vtt/`, published
  from `online-client/` by a workflow in this repo.

### GM UI

- **Start / stop online session:** a command, and a button beside the player
  window controls in the view actions menu.
- **Online panel:** a popover from that button showing the join link (Copy),
  pending requests with Allow and Deny, connected and dropped players with Kick,
  and Stop session. It is built from existing primitives (panel radius, close
  button, `ToolButton`) per CLAUDE.md.
- **Join requests:** a persistent notice ("Anna wants to join — Allow / Deny")
  appears whatever view is focused, and it stays in the panel until answered.
- **Status:** a status bar item while hosting ("Online · 3 players").

### Join page (`online-client/`)

A separate Vite build, published as static files. In this piece it asks for a
name, remembers it and a random `playerKey` in `localStorage`, joins, shows
"Waiting for the GM", then "Connected" with the player list. On failure it
explains itself: denied, removed, session full or ended, a version mismatch,
or unreachable ("Couldn't connect. Your GM may need to add a relay server in
Atlas settings."). It links the source code, as the AGPL requires for a
network-facing modified version. Piece 4 turns it into the player view.

## Errors and edge cases

- **Signaling unreachable or id taken:** status `error`, with the message and a
  Retry button. A taken id is retried once with a new id.
- **Obsidian goes offline while hosting:** PeerJS reconnects to signaling;
  established player links keep working without it.
- **A player's browser closes:** no `pong`, so the player is marked `gone` and
  rejoins without approval if they come back.
- **The GM closes Obsidian:** players see "The session ended", and the
  `playerKey` approvals are gone.
- **Duplicate tab with the same `playerKey`:** the newer link replaces the
  older one, which gets `bye`.
- **Oversized or malformed messages:** control messages over 256 KB and invalid
  JSON count as invalid messages.

## Security and privacy

- The peer id is 128 random bits and fresh for every session; the join link
  carries it only in the URL fragment.
- Nothing is sent before the GM approves a player, not even presence.
- Player names are displayed as text, never as HTML.
- The PeerJS signaling server sees the GM's and players' IP addresses and peer
  ids, but no game data: data connections are end-to-end DTLS.
- `README.md` and `PRIVACY.md` gain an "Online play" section: it is off by
  default, what is sent, the PeerJS cloud host (`0.peerjs.com`), STUN servers,
  and optional TURN. The preflight host allowlist and README disclosure are
  updated to match. Hosting stays opt-in: starting a session is the only thing
  that contacts the network.

## Testing

- **Protocol:** encode/decode round trips; invalid versions, types and fields
  are rejected; unknown types are ignored.
- **GM session, over `MemoryTransport`:** join → pending → allow → admitted plus
  presence; deny; request timeout; reconnect with a known key; kick forgets the
  key; ping timeout marks the player gone; the 12-player cap; stop sends `bye`;
  three invalid messages disconnect.
- **Player session, over `MemoryTransport`:** the status sequence, and retry
  with backoff after a drop but not after a denial.
- **PeerTransport:** a manual check between the GM in Obsidian and the join page
  in two browsers, on one network and across networks (phone on mobile data).
- `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`, and
  `npm run preflight` (host disclosure).

## Open questions for later pieces

- Fog with dynamic vision may need a raster mask rather than the reveal list (piece 2).
- Asset ids: hash of content vs random per session (piece 3).
- Whether the player page should be served from the plugin's GitHub Pages or
  the upstream's, if the maintainer adopts the feature.
