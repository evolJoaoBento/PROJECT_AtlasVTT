# Online Sessions (Online Play, Piece 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a GM host an online session from Atlas that players join from a web page, with GM approval, presence and reconnection, and nothing else sent yet.

**Architecture:** A dependency-free protocol module and a transport interface sit under `src/app/online/`. `GmSession` (plugin-wide, one per vault) and `PlayerSession` speak the protocol over either `MemoryTransport` (tests) or `PeerTransport` (PeerJS, star topology, two data connections per player). `OnlineSessionService` wires the GM side into the plugin: settings, commands, a modal, join-request notices and a status bar item. A separate Vite build in `online-client/` is the join page.

**Tech Stack:** TypeScript, Obsidian API, zustand/vanilla, PeerJS 1.5.5, Vitest (jsdom), Vite.

**Spec:** `docs/superpowers/specs/2026-09-29-online-sessions-design.md`

## Global Constraints

- Protocol version `1`; envelope `{ v: 1, type, ...fields }`; unknown `type`s are ignored, a wrong `v` is refused with `denied { reason: 'version' }`.
- Player names: trimmed, inner whitespace collapsed, control characters removed, 1–40 characters; always rendered as text.
- Peer ids: 128 random bits, base64url, fresh per session.
- Limits: join message within 10 s of connecting; join requests expire after 2 min; ping every 5 s; no pong for 15 s marks a player gone; at most 12 admitted players; 3 invalid messages disconnect a peer; control messages over 256 KB are invalid.
- Reconnect backoff for players: 1, 2, 4, 8, 15 s, then every 15 s, giving up after 5 min in total.
- Only `src/app/online/transport/PeerTransport.ts` imports `peerjs`. `protocol.ts`, `ids.ts`, `joinLink.ts`, `PlayerSession.ts` and `transport/types.ts` import nothing from `obsidian`.
- Online play is off until the GM starts a session: nothing contacts the network before then.
- Default signaling: PeerJS cloud. Default ICE: `stun:stun.l.google.com:19302` plus any TURN servers in settings.
- Default player page URL: `https://evoljoaobento.github.io/atlas-vtt/`.
- Code style (CLAUDE.md): explicit return types, files under about 300 lines, SCSS with Obsidian variables, no `title` attributes, `aria-label` only for screen readers.

## Review Focus

- A player name that is only whitespace, or contains HTML, must be rejected or shown as plain text, never injected. Test in Task 1 (`normalizePlayerName`) and Task 7 (modal renders names with `setText`).
- Stopping the session while join requests are open must close their notices, and a late Allow must do nothing. Test in Task 3 (`allow` after `stop`) and Task 7 (notices hidden on stop).
- The same player opening a second tab must replace the first connection, not create a second player. Test in Task 3.
- A join link without an id, or with a broken fragment, must show "This link is incomplete", not crash. Test in Task 6 (`parseJoinFragment`).
- A taken peer id (`unavailable-id`) must be retried once with a new id; a signaling failure must surface as an error with its message. Test in Task 5.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/app/online/protocol.ts` | Message types, `encodeControl`, `decodeControl`, `normalizePlayerName`, limits. |
| `src/app/online/ids.ts` | `randomId()`: base64url random ids. |
| `src/app/online/transport/types.ts` | `HostTransport`, `ClientTransport`, `PeerLink`, `Channel`. |
| `src/app/online/transport/MemoryTransport.ts` | In-process transport for tests. |
| `src/app/online/transport/PeerTransport.ts` | PeerJS host and client. |
| `src/app/online/GmSession.ts` | GM side: admission, presence, ping, kick, cap, stop, handlers. |
| `src/app/online/PlayerSession.ts` | Player side: join, status, reconnect. |
| `src/app/online/joinLink.ts` | `buildJoinUrl`, `parseJoinFragment`. |
| `src/app/online/onlineSettings.ts` | `OnlineSettings` type, defaults, `parseTurnServers`, `formatTurnServers`, `peerServerOptions`. |
| `src/app/online/onlineSessionStore.ts` | zustand store with the session's public state. |
| `src/app/online/OnlineSessionService.ts` | Plugin-wide service: start, stop, allow, deny, kick. |
| `src/app/online/ui/joinRequestNotice.ts` | Persistent Allow/Deny notice. |
| `src/app/online/ui/OnlineSessionModal.ts` | The session modal. |
| `src/app/online/ui/online-session.scss` | Modal styles. |
| `src/app/online/registerOnline.ts` | Commands, status bar item, unload. |
| `src/app/settings/onlineSettingsSection.ts` | "Online play" settings rows. |
| `online-client/index.html`, `online-client/main.mts`, `online-client/style.css` | Join page. |
| `vite.online.config.mts` | Join page build. |
| `.github/workflows/online-client.yml` | Publish the join page to GitHub Pages. |

---

### Task 1: Protocol and ids

**Files:**
- Create: `src/app/online/protocol.ts`, `src/app/online/ids.ts`
- Test: `tests/unit/online/protocol.test.ts`

**Interfaces:**
- Produces:
  - `PROTOCOL_VERSION = 1`, `MAX_CONTROL_MESSAGE_BYTES = 262144`, `MAX_PLAYER_NAME_LENGTH = 40`
  - `type DenyReason = 'denied' | 'kicked' | 'full' | 'version' | 'ended'`
  - `interface PresencePlayer { playerId: string; name: string; connected: boolean }`
  - `type ControlMessage` (union below)
  - `type Decoded = { kind: 'message'; message: ControlMessage } | { kind: 'ignored' } | { kind: 'version' } | { kind: 'invalid'; reason: string }`
  - `encodeControl(message: ControlMessage): string`
  - `decodeControl(raw: unknown): Decoded`
  - `normalizePlayerName(name: unknown): string | null`
  - `randomId(bytes?: number): string`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/online/protocol.test.ts
import { describe, expect, it } from 'vitest';
import { decodeControl, encodeControl, normalizePlayerName, MAX_CONTROL_MESSAGE_BYTES } from '../../../src/app/online/protocol';
import { randomId } from '../../../src/app/online/ids';

describe('online protocol', () => {
  it('round-trips every message type', () => {
    const messages = [
      { v: 1, type: 'join', name: 'Anna', playerKey: 'k1', client: { kind: 'web', version: '0.5.0' } },
      { v: 1, type: 'admitted', playerId: 'p1', session: { title: 'Vault' } },
      { v: 1, type: 'denied', reason: 'kicked' },
      { v: 1, type: 'presence', players: [{ playerId: 'p1', name: 'Anna', connected: true }] },
      { v: 1, type: 'ping', t: 5 },
      { v: 1, type: 'pong', t: 5 },
      { v: 1, type: 'bye', reason: 'ended' },
    ] as const;
    for (const message of messages) {
      expect(decodeControl(encodeControl(message))).toEqual({ kind: 'message', message });
    }
  });

  it('refuses another protocol version', () => {
    expect(decodeControl(JSON.stringify({ v: 2, type: 'ping', t: 1 }))).toEqual({ kind: 'version' });
  });

  it('ignores types it does not know, for newer peers', () => {
    expect(decodeControl(JSON.stringify({ v: 1, type: 'snapshot', scene: {} }))).toEqual({ kind: 'ignored' });
  });

  it('rejects malformed input', () => {
    expect(decodeControl('not json').kind).toBe('invalid');
    expect(decodeControl(42).kind).toBe('invalid');
    expect(decodeControl(JSON.stringify({ v: 1, type: 'denied', reason: 'bored' })).kind).toBe('invalid');
    expect(decodeControl(JSON.stringify({ v: 1, type: 'join', name: 'A', playerKey: 7, client: { kind: 'web', version: '1' } })).kind).toBe('invalid');
    expect(decodeControl(JSON.stringify({ v: 1, type: 'presence', players: [{ playerId: 'p', name: 'A' }] })).kind).toBe('invalid');
  });

  it('rejects oversized messages', () => {
    const big = JSON.stringify({ v: 1, type: 'bye', reason: 'x'.repeat(MAX_CONTROL_MESSAGE_BYTES) });
    expect(decodeControl(big)).toEqual({ kind: 'invalid', reason: 'too-large' });
  });

  it('normalizes player names and refuses empty ones', () => {
    expect(normalizePlayerName('  Anna   the\tBold  ')).toBe('Anna the Bold');
    expect(normalizePlayerName('Bob\u0000\u0007')).toBe('Bob');
    expect(normalizePlayerName('   ')).toBeNull();
    expect(normalizePlayerName(12)).toBeNull();
    expect(normalizePlayerName('x'.repeat(41))).toBeNull();
    expect(normalizePlayerName('<b>Eve</b>')).toBe('<b>Eve</b>'); // kept as text; the UI never renders HTML
  });

  it('makes long unguessable ids', () => {
    const a = randomId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomId()).not.toBe(a);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/online/protocol.test.ts`
Expected: FAIL, "Failed to resolve import .../online/protocol".

- [ ] **Step 3: Write the implementation**

```ts
// src/app/online/ids.ts
/** A random id of `bytes` bytes (16 = 128 bits), base64url without padding. */
export function randomId(bytes = 16): string {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
```

```ts
// src/app/online/protocol.ts
/**
 * The online play wire format. Shared with the web player page, so this file
 * imports nothing: no Obsidian, no PIXI, no PeerJS.
 */
export const PROTOCOL_VERSION = 1;
export const MAX_CONTROL_MESSAGE_BYTES = 256 * 1024;
export const MAX_PLAYER_NAME_LENGTH = 40;

export type DenyReason = 'denied' | 'kicked' | 'full' | 'version' | 'ended';
const DENY_REASONS: readonly DenyReason[] = ['denied', 'kicked', 'full', 'version', 'ended'];

export interface PresencePlayer {
  playerId: string;
  name: string;
  connected: boolean;
}

export type ControlMessage =
  | { v: 1; type: 'join'; name: string; playerKey: string; client: { kind: 'web' | 'obsidian'; version: string } }
  | { v: 1; type: 'admitted'; playerId: string; session: { title: string } }
  | { v: 1; type: 'denied'; reason: DenyReason }
  | { v: 1; type: 'presence'; players: PresencePlayer[] }
  | { v: 1; type: 'ping'; t: number }
  | { v: 1; type: 'pong'; t: number }
  | { v: 1; type: 'bye'; reason: string };

export type Decoded =
  | { kind: 'message'; message: ControlMessage }
  | { kind: 'ignored' }
  | { kind: 'version' }
  | { kind: 'invalid'; reason: string };

type Fields = Record<string, unknown>;

const isString = (value: unknown, max = 1024): value is string => typeof value === 'string' && value.length <= max;
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isRecord = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Checks the fields of each known type; returns null when the shape is wrong. */
const VALIDATORS: Record<ControlMessage['type'], (m: Fields) => boolean> = {
  join: (m) => isString(m.name, 200) && isString(m.playerKey, 64) && m.playerKey.length > 0
    && isRecord(m.client) && (m.client.kind === 'web' || m.client.kind === 'obsidian') && isString(m.client.version, 32),
  admitted: (m) => isString(m.playerId, 64) && isRecord(m.session) && isString(m.session.title, 200),
  denied: (m) => DENY_REASONS.includes(m.reason as DenyReason),
  presence: (m) => Array.isArray(m.players) && m.players.length <= 64 && m.players.every((p) =>
    isRecord(p) && isString(p.playerId, 64) && isString(p.name, 200) && typeof p.connected === 'boolean'),
  ping: (m) => isNumber(m.t),
  pong: (m) => isNumber(m.t),
  bye: (m) => isString(m.reason, 200),
};

export function encodeControl(message: ControlMessage): string {
  return JSON.stringify(message);
}

export function decodeControl(raw: unknown): Decoded {
  if (typeof raw !== 'string') return { kind: 'invalid', reason: 'not-text' };
  if (raw.length > MAX_CONTROL_MESSAGE_BYTES) return { kind: 'invalid', reason: 'too-large' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', reason: 'not-json' };
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string') return { kind: 'invalid', reason: 'no-type' };
  if (parsed.v !== PROTOCOL_VERSION) return { kind: 'version' };
  const validate = VALIDATORS[parsed.type as ControlMessage['type']];
  if (!validate) return { kind: 'ignored' };
  return validate(parsed)
    ? { kind: 'message', message: parsed as unknown as ControlMessage }
    : { kind: 'invalid', reason: `bad-${parsed.type}` };
}

/** A player's display name, cleaned up; null when nothing usable is left or it is too long. */
export function normalizePlayerName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 && cleaned.length <= MAX_PLAYER_NAME_LENGTH ? cleaned : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/online/protocol.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/online/protocol.ts src/app/online/ids.ts tests/unit/online/protocol.test.ts
git commit -m "feat(online): wire protocol and random ids"
```

---

### Task 2: Transport interface and MemoryTransport

**Files:**
- Create: `src/app/online/transport/types.ts`, `src/app/online/transport/MemoryTransport.ts`
- Test: `tests/unit/online/memoryTransport.test.ts`

**Interfaces:**
- Produces:
  - `type Channel = 'control' | 'assets'`
  - `type Unsubscribe = () => void`
  - `interface PeerLink { readonly remoteId: string; send(channel: Channel, data: string | ArrayBuffer): void; onMessage(cb: (channel: Channel, data: unknown) => void): Unsubscribe; onClose(cb: () => void): Unsubscribe; close(): void }`
  - `interface HostTransport { readonly id: string; onConnection(cb: (link: PeerLink) => void): Unsubscribe; onError(cb: (error: TransportError) => void): Unsubscribe; close(): void }`
  - `interface ClientTransport { connect(hostId: string): Promise<PeerLink> }`
  - `interface TransportError { code: string; message: string }`
  - `class MemoryNetwork { host(id?: string): HostTransport; client(): ClientTransport }`; `connect` rejects with `{ code: 'unreachable' }` for an unknown or closed host.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/online/memoryTransport.test.ts
import { describe, expect, it } from 'vitest';
import { MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';
import type { PeerLink } from '../../../src/app/online/transport/types';

describe('MemoryTransport', () => {
  it('links a client to a host and carries messages both ways on both channels', async () => {
    const network = new MemoryNetwork();
    const host = network.host('gm');
    const hostLinks: PeerLink[] = [];
    host.onConnection((link) => hostLinks.push(link));

    const client = await network.client().connect('gm');
    expect(hostLinks).toHaveLength(1);

    const atHost: Array<[string, unknown]> = [];
    const atClient: Array<[string, unknown]> = [];
    hostLinks[0]!.onMessage((channel, data) => atHost.push([channel, data]));
    client.onMessage((channel, data) => atClient.push([channel, data]));

    client.send('control', 'hello');
    hostLinks[0]!.send('assets', new ArrayBuffer(4));
    expect(atHost).toEqual([['control', 'hello']]);
    expect(atClient[0]![0]).toBe('assets');
    expect(atClient[0]![1]).toBeInstanceOf(ArrayBuffer);
  });

  it('closes both ends once', async () => {
    const network = new MemoryNetwork();
    const host = network.host('gm');
    let hostLink: PeerLink | undefined;
    host.onConnection((link) => { hostLink = link; });
    const client = await network.client().connect('gm');
    let closes = 0;
    hostLink!.onClose(() => closes++);
    client.onClose(() => closes++);
    client.close();
    client.close();
    expect(closes).toBe(2);
    expect(() => client.send('control', 'late')).not.toThrow();
  });

  it('refuses an unknown or closed host', async () => {
    const network = new MemoryNetwork();
    await expect(network.client().connect('nobody')).rejects.toMatchObject({ code: 'unreachable' });
    const host = network.host('gm');
    host.close();
    await expect(network.client().connect('gm')).rejects.toMatchObject({ code: 'unreachable' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/online/memoryTransport.test.ts`
Expected: FAIL, import not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/online/transport/types.ts
/**
 * How the online sessions reach each other. The sessions only know these
 * interfaces; PeerJS (PeerTransport) and tests (MemoryTransport) provide them.
 */
export type Channel = 'control' | 'assets';
export type Unsubscribe = () => void;

export interface TransportError {
  /** `unavailable-id`, `unreachable`, `network`, `server-error`, `timeout`, … */
  code: string;
  message: string;
}

/** One player's connection, both channels. */
export interface PeerLink {
  readonly remoteId: string;
  /** Sending on a closed link does nothing. */
  send(channel: Channel, data: string | ArrayBuffer): void;
  onMessage(cb: (channel: Channel, data: unknown) => void): Unsubscribe;
  /** Called once, when either end closes. */
  onClose(cb: () => void): Unsubscribe;
  close(): void;
}

export interface HostTransport {
  readonly id: string;
  onConnection(cb: (link: PeerLink) => void): Unsubscribe;
  onError(cb: (error: TransportError) => void): Unsubscribe;
  close(): void;
}

export interface ClientTransport {
  connect(hostId: string): Promise<PeerLink>;
}
```

```ts
// src/app/online/transport/MemoryTransport.ts
import type { Channel, ClientTransport, HostTransport, PeerLink, TransportError, Unsubscribe } from './types';

type Listener<T extends unknown[]> = (...args: T) => void;

function listeners<T extends unknown[]>(): { add(cb: Listener<T>): Unsubscribe; emit(...args: T): void; clear(): void } {
  const set = new Set<Listener<T>>();
  return {
    add: (cb) => { set.add(cb); return () => set.delete(cb); },
    emit: (...args) => { for (const cb of [...set]) cb(...args); },
    clear: () => set.clear(),
  };
}

/** One end of an in-memory link; `peer` is the other end. */
class MemoryLink implements PeerLink {
  peer!: MemoryLink;
  private closed = false;
  private readonly messages = listeners<[Channel, unknown]>();
  private readonly closes = listeners<[]>();

  constructor(readonly remoteId: string) {}

  send(channel: Channel, data: string | ArrayBuffer): void {
    if (this.closed) return;
    this.peer.messages.emit(channel, data);
  }
  onMessage(cb: (channel: Channel, data: unknown) => void): Unsubscribe { return this.messages.add(cb); }
  onClose(cb: () => void): Unsubscribe { return this.closes.add(cb); }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.peer.close();
    this.closes.emit();
    this.messages.clear();
    this.closes.clear();
  }
}

class MemoryHost implements HostTransport {
  closed = false;
  readonly connections = listeners<[PeerLink]>();
  private readonly errors = listeners<[TransportError]>();
  constructor(readonly id: string, private readonly remove: () => void) {}
  onConnection(cb: (link: PeerLink) => void): Unsubscribe { return this.connections.add(cb); }
  onError(cb: (error: TransportError) => void): Unsubscribe { return this.errors.add(cb); }
  fail(error: TransportError): void { this.errors.emit(error); }
  close(): void { this.closed = true; this.remove(); }
}

/** Hosts and clients in one process, for tests. */
export class MemoryNetwork {
  private readonly hosts = new Map<string, MemoryHost>();
  private clients = 0;

  host(id = `host-${this.hosts.size + 1}`): MemoryHost {
    const host = new MemoryHost(id, () => this.hosts.delete(id));
    this.hosts.set(id, host);
    return host;
  }

  client(): ClientTransport {
    return {
      connect: async (hostId: string): Promise<PeerLink> => {
        const host = this.hosts.get(hostId);
        if (!host || host.closed) throw { code: 'unreachable', message: `No host ${hostId}` } satisfies TransportError;
        const clientEnd = new MemoryLink(hostId);
        const hostEnd = new MemoryLink(`client-${++this.clients}`);
        clientEnd.peer = hostEnd;
        hostEnd.peer = clientEnd;
        host.connections.emit(hostEnd);
        return clientEnd;
      },
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/online/memoryTransport.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/online/transport tests/unit/online/memoryTransport.test.ts
git commit -m "feat(online): transport interface and in-memory transport"
```

---

### Task 3: GmSession

**Files:**
- Create: `src/app/online/GmSession.ts`
- Test: `tests/unit/online/gmSession.test.ts`

**Interfaces:**
- Consumes: Task 1 (`decodeControl`, `encodeControl`, `normalizePlayerName`, `ControlMessage`, `PresencePlayer`), Task 1 `randomId`, Task 2 (`HostTransport`, `PeerLink`, `MemoryNetwork`).
- Produces:
  - `SESSION_LIMITS = { joinTimeoutMs: 10_000, requestTimeoutMs: 120_000, pingIntervalMs: 5_000, pingTimeoutMs: 15_000, maxPlayers: 12, maxInvalidMessages: 3 }`
  - `type PlayerStatus = 'pending' | 'admitted' | 'gone'`
  - `interface SessionPlayer { playerId: string; name: string; status: PlayerStatus }`
  - `interface SessionHandler { onAdmitted?(player: SessionPlayer): void; onMessage?(player: SessionPlayer, message: ControlMessage): void; onGone?(player: SessionPlayer): void }`
  - `interface GmSessionOptions { title: string; onJoinRequest(player: SessionPlayer): void; onRequestClosed(playerId: string): void; onPlayersChanged(players: SessionPlayer[]): void }`
  - `class GmSession { constructor(transport: HostTransport, options: GmSessionOptions); start(): void; allow(playerId: string): void; deny(playerId: string): void; kick(playerId: string): void; send(playerId: string, message: ControlMessage): void; use(handler: SessionHandler): () => void; getPlayers(): SessionPlayer[]; stop(): void }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/online/gmSession.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmSession, SESSION_LIMITS, type SessionPlayer } from '../../../src/app/online/GmSession';
import { MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import type { PeerLink } from '../../../src/app/online/transport/types';

const join = (name: string, playerKey: string): string =>
  encodeControl({ v: 1, type: 'join', name, playerKey, client: { kind: 'web', version: '0.5.0' } });

/** A connected player end that records what the GM sent it. */
async function player(network: MemoryNetwork): Promise<{ link: PeerLink; received: ControlMessage[]; closed: () => boolean }> {
  const link = await network.client().connect('gm');
  const received: ControlMessage[] = [];
  let isClosed = false;
  link.onMessage((channel, data) => {
    const decoded = decodeControl(data);
    if (channel === 'control' && decoded.kind === 'message') received.push(decoded.message);
  });
  link.onClose(() => { isClosed = true; });
  return { link, received, closed: () => isClosed };
}

function setup() {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const closedRequests: string[] = [];
  let players: SessionPlayer[] = [];
  const session = new GmSession(network.host('gm'), {
    title: 'Vault',
    onJoinRequest: (p) => requests.push(p),
    onRequestClosed: (id) => closedRequests.push(id),
    onPlayersChanged: (list) => { players = list; },
  });
  session.start();
  return { network, session, requests, closedRequests, players: () => players };
}

describe('GmSession', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('asks the GM, then admits and sends presence', async () => {
    const { network, session, requests } = setup();
    const anna = await player(network);
    anna.link.send('control', join('  Anna ', 'key-a'));
    expect(requests.map((r) => r.name)).toEqual(['Anna']);
    expect(anna.received).toEqual([]); // nothing before approval, not even presence

    session.allow(requests[0]!.playerId);
    expect(anna.received.map((m) => m.type)).toEqual(['admitted', 'presence']);
    expect(anna.received[1]).toMatchObject({ players: [{ name: 'Anna', connected: true }] });
  });

  it('denies and closes', async () => {
    const { network, session, requests, players } = setup();
    const eve = await player(network);
    eve.link.send('control', join('Eve', 'key-e'));
    session.deny(requests[0]!.playerId);
    expect(eve.received).toEqual([{ v: 1, type: 'denied', reason: 'denied' }]);
    expect(eve.closed()).toBe(true);
    expect(players()).toEqual([]);
  });

  it('expires an unanswered request', async () => {
    const { network, requests, closedRequests } = setup();
    const bob = await player(network);
    bob.link.send('control', join('Bob', 'key-b'));
    vi.advanceTimersByTime(SESSION_LIMITS.requestTimeoutMs + 1);
    expect(closedRequests).toEqual([requests[0]!.playerId]);
    expect(bob.closed()).toBe(true);
  });

  it('closes a connection that never joins', async () => {
    const { network } = setup();
    const silent = await player(network);
    vi.advanceTimersByTime(SESSION_LIMITS.joinTimeoutMs + 1);
    expect(silent.closed()).toBe(true);
  });

  it('lets an admitted player back in without asking after a drop', async () => {
    const { network, session, requests } = setup();
    const first = await player(network);
    first.link.send('control', join('Anna', 'key-a'));
    session.allow(requests[0]!.playerId);
    first.link.close();
    expect(session.getPlayers()[0]!.status).toBe('gone');

    const again = await player(network);
    again.link.send('control', join('Anna', 'key-a'));
    expect(requests).toHaveLength(1);
    expect(again.received[0]).toMatchObject({ type: 'admitted', playerId: requests[0]!.playerId });
  });

  it('replaces the older tab of the same player', async () => {
    const { network, session, requests } = setup();
    const tab1 = await player(network);
    tab1.link.send('control', join('Anna', 'key-a'));
    session.allow(requests[0]!.playerId);
    const tab2 = await player(network);
    tab2.link.send('control', join('Anna', 'key-a'));
    expect(tab1.received.at(-1)).toMatchObject({ type: 'bye' });
    expect(tab1.closed()).toBe(true);
    expect(session.getPlayers()).toHaveLength(1);
    expect(tab2.received[0]).toMatchObject({ type: 'admitted' });
  });

  it('kicks and forgets the player', async () => {
    const { network, session, requests } = setup();
    const anna = await player(network);
    anna.link.send('control', join('Anna', 'key-a'));
    session.allow(requests[0]!.playerId);
    session.kick(requests[0]!.playerId);
    expect(anna.received.at(-1)).toEqual({ v: 1, type: 'denied', reason: 'kicked' });
    const back = await player(network);
    back.link.send('control', join('Anna', 'key-a'));
    expect(requests).toHaveLength(2); // asked again
  });

  it('marks a silent player gone and pings the rest', async () => {
    const { network, session, requests } = setup();
    const anna = await player(network);
    anna.link.send('control', join('Anna', 'key-a'));
    session.allow(requests[0]!.playerId);
    vi.advanceTimersByTime(SESSION_LIMITS.pingIntervalMs + 1);
    expect(anna.received.some((m) => m.type === 'ping')).toBe(true);
    vi.advanceTimersByTime(SESSION_LIMITS.pingTimeoutMs + SESSION_LIMITS.pingIntervalMs);
    expect(session.getPlayers()[0]!.status).toBe('gone');
    expect(anna.closed()).toBe(true);
  });

  it('refuses players past the cap', async () => {
    const { network, session, requests } = setup();
    for (let i = 0; i < SESSION_LIMITS.maxPlayers; i++) {
      const p = await player(network);
      p.link.send('control', join(`P${i}`, `key-${i}`));
      session.allow(requests[i]!.playerId);
    }
    const late = await player(network);
    late.link.send('control', join('Late', 'key-late'));
    expect(late.received).toEqual([{ v: 1, type: 'denied', reason: 'full' }]);
  });

  it('disconnects a peer after three invalid messages, and refuses another version', async () => {
    const { network } = setup();
    const noisy = await player(network);
    noisy.link.send('control', 'x');
    noisy.link.send('control', '{}');
    expect(noisy.closed()).toBe(false);
    noisy.link.send('control', 'nope');
    expect(noisy.closed()).toBe(true);

    const old = await player(network);
    old.link.send('control', JSON.stringify({ v: 2, type: 'join' }));
    expect(old.received).toEqual([{ v: 1, type: 'denied', reason: 'version' }]);
    expect(old.closed()).toBe(true);
  });

  it('rejects a name that is only whitespace', async () => {
    const { network, requests } = setup();
    const blank = await player(network);
    blank.link.send('control', join('   ', 'key-x'));
    expect(requests).toEqual([]);
    expect(blank.received).toEqual([{ v: 1, type: 'denied', reason: 'denied' }]);
  });

  it('says goodbye on stop, and ignores a late allow', async () => {
    const { network, session, requests, closedRequests } = setup();
    const anna = await player(network);
    anna.link.send('control', join('Anna', 'key-a'));
    session.allow(requests[0]!.playerId);
    const bob = await player(network);
    bob.link.send('control', join('Bob', 'key-b'));
    session.stop();
    expect(anna.received.at(-1)).toEqual({ v: 1, type: 'bye', reason: 'ended' });
    expect(closedRequests).toContain(requests[1]!.playerId);
    session.allow(requests[1]!.playerId);
    expect(bob.received.some((m) => m.type === 'admitted')).toBe(false);
  });

  it('hands other messages to handlers', async () => {
    const { network, session, requests } = setup();
    const seen: string[] = [];
    session.use({ onMessage: (_p, m) => seen.push(m.type), onAdmitted: (p) => seen.push(`in:${p.name}`) });
    const anna = await player(network);
    anna.link.send('control', join('Anna', 'key-a'));
    session.allow(requests[0]!.playerId);
    anna.link.send('control', encodeControl({ v: 1, type: 'bye', reason: 'x' }));
    expect(seen).toEqual(['in:Anna']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/online/gmSession.test.ts`
Expected: FAIL, import not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/online/GmSession.ts
import { randomId } from './ids';
import { decodeControl, encodeControl, normalizePlayerName, type ControlMessage, type DenyReason, type PresencePlayer } from './protocol';
import type { HostTransport, PeerLink, Unsubscribe } from './transport/types';

export const SESSION_LIMITS = {
  joinTimeoutMs: 10_000,
  requestTimeoutMs: 120_000,
  pingIntervalMs: 5_000,
  pingTimeoutMs: 15_000,
  maxPlayers: 12,
  maxInvalidMessages: 3,
} as const;

export type PlayerStatus = 'pending' | 'admitted' | 'gone';

export interface SessionPlayer {
  playerId: string;
  name: string;
  status: PlayerStatus;
}

export interface SessionHandler {
  onAdmitted?(player: SessionPlayer): void;
  onMessage?(player: SessionPlayer, message: ControlMessage): void;
  onGone?(player: SessionPlayer): void;
}

export interface GmSessionOptions {
  title: string;
  /** A new player is waiting; answer with `allow` or `deny`. */
  onJoinRequest(player: SessionPlayer): void;
  /** A request is no longer open: answered, expired, withdrawn or the session stopped. */
  onRequestClosed(playerId: string): void;
  onPlayersChanged(players: SessionPlayer[]): void;
}

interface Entry {
  player: SessionPlayer;
  playerKey: string;
  link: PeerLink | null;
  lastPong: number;
  requestTimer: ReturnType<typeof setTimeout> | null;
}

/** Per connection, before and after it joins. */
interface LinkState {
  entry: Entry | null;
  invalid: number;
  joinTimer: ReturnType<typeof setTimeout> | null;
  unsubscribe: Unsubscribe[];
}

/**
 * The GM's side of an online session: who may join, who is here, and a hook
 * for later pieces to send and receive game messages. It never learns about maps.
 */
export class GmSession {
  private readonly entries = new Map<string, Entry>();
  private readonly links = new Map<PeerLink, LinkState>();
  private readonly handlers = new Set<SessionHandler>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopTransport: Unsubscribe | null = null;
  private stopped = false;

  constructor(private readonly transport: HostTransport, private readonly options: GmSessionOptions) {}

  start(): void {
    this.stopTransport = this.transport.onConnection((link) => this.accept(link));
    this.pingTimer = setInterval(() => this.pingAll(), SESSION_LIMITS.pingIntervalMs);
  }

  use(handler: SessionHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  getPlayers(): SessionPlayer[] {
    return [...this.entries.values()].map((entry) => ({ ...entry.player }));
  }

  allow(playerId: string): void {
    const entry = this.entries.get(playerId);
    if (this.stopped || !entry || entry.player.status !== 'pending' || !entry.link) return;
    this.closeRequest(entry);
    if (this.admittedCount() >= SESSION_LIMITS.maxPlayers) {
      this.refuse(entry.link, 'full');
      this.entries.delete(playerId);
      this.changed();
      return;
    }
    this.admit(entry);
  }

  deny(playerId: string): void {
    const entry = this.entries.get(playerId);
    if (!entry || entry.player.status !== 'pending') return;
    this.closeRequest(entry);
    this.entries.delete(playerId);
    if (entry.link) this.refuse(entry.link, 'denied');
    this.changed();
  }

  /** Removes a player; they will have to be approved again. */
  kick(playerId: string): void {
    const entry = this.entries.get(playerId);
    if (!entry) return;
    this.closeRequest(entry);
    this.entries.delete(playerId);
    if (entry.link) this.refuse(entry.link, 'kicked');
    this.changed();
    this.broadcastPresence();
  }

  send(playerId: string, message: ControlMessage): void {
    const entry = this.entries.get(playerId);
    if (entry?.player.status === 'admitted') entry.link?.send('control', encodeControl(message));
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.stopTransport?.();
    for (const entry of this.entries.values()) this.closeRequest(entry);
    for (const link of [...this.links.keys()]) {
      link.send('control', encodeControl({ v: 1, type: 'bye', reason: 'ended' }));
      link.close();
    }
    this.entries.clear();
    this.transport.close();
    this.changed();
  }

  // ── Connections ───────────────────────────────────────────

  private accept(link: PeerLink): void {
    if (this.stopped) {
      link.close();
      return;
    }
    const state: LinkState = { entry: null, invalid: 0, joinTimer: null, unsubscribe: [] };
    state.joinTimer = setTimeout(() => link.close(), SESSION_LIMITS.joinTimeoutMs);
    state.unsubscribe.push(
      link.onMessage((channel, data) => { if (channel === 'control') this.receive(link, state, data); }),
      link.onClose(() => this.linkClosed(link, state)),
    );
    this.links.set(link, state);
  }

  private receive(link: PeerLink, state: LinkState, data: unknown): void {
    const decoded = decodeControl(data);
    if (decoded.kind === 'ignored') return;
    if (decoded.kind === 'version') {
      this.refuse(link, 'version');
      return;
    }
    if (decoded.kind === 'invalid' || (!state.entry && decoded.message.type !== 'join')) {
      if (++state.invalid >= SESSION_LIMITS.maxInvalidMessages) link.close();
      return;
    }
    const message = decoded.message;
    if (message.type === 'join') {
      if (!state.entry) this.join(link, state, message);
      return;
    }
    const entry = state.entry;
    if (!entry || entry.player.status !== 'admitted') return;
    if (message.type === 'pong') entry.lastPong = Date.now();
    else if (message.type === 'ping') link.send('control', encodeControl({ v: 1, type: 'pong', t: message.t }));
    else if (message.type === 'bye') link.close();
    else for (const handler of this.handlers) handler.onMessage?.({ ...entry.player }, message);
  }

  private join(link: PeerLink, state: LinkState, message: Extract<ControlMessage, { type: 'join' }>): void {
    if (state.joinTimer) clearTimeout(state.joinTimer);
    state.joinTimer = null;
    const name = normalizePlayerName(message.name);
    if (!name) {
      this.refuse(link, 'denied');
      return;
    }

    const known = [...this.entries.values()].find((entry) => entry.playerKey === message.playerKey);
    if (known) {
      // Another tab of the same player, or a reconnect: the new link takes over.
      const older = known.link;
      known.link = link;
      known.player.name = name;
      state.entry = known;
      if (older && older !== link) {
        this.links.get(older)!.entry = null;
        older.send('control', encodeControl({ v: 1, type: 'bye', reason: 'replaced' }));
        older.close();
      }
      if (known.player.status === 'pending') {
        this.changed();
        return;
      }
      this.admit(known);
      return;
    }

    if (this.admittedCount() >= SESSION_LIMITS.maxPlayers) {
      this.refuse(link, 'full');
      return;
    }
    const entry: Entry = {
      player: { playerId: randomId(), name, status: 'pending' },
      playerKey: message.playerKey,
      link,
      lastPong: Date.now(),
      requestTimer: null,
    };
    entry.requestTimer = setTimeout(() => this.deny(entry.player.playerId), SESSION_LIMITS.requestTimeoutMs);
    state.entry = entry;
    this.entries.set(entry.player.playerId, entry);
    this.changed();
    this.options.onJoinRequest({ ...entry.player });
  }

  private admit(entry: Entry): void {
    entry.player.status = 'admitted';
    entry.lastPong = Date.now();
    entry.link?.send('control', encodeControl({
      v: 1, type: 'admitted', playerId: entry.player.playerId, session: { title: this.options.title },
    }));
    this.changed();
    this.broadcastPresence();
    for (const handler of this.handlers) handler.onAdmitted?.({ ...entry.player });
  }

  private linkClosed(link: PeerLink, state: LinkState): void {
    if (state.joinTimer) clearTimeout(state.joinTimer);
    state.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.links.delete(link);
    const entry = state.entry;
    if (!entry || entry.link !== link || this.stopped) return;
    entry.link = null;
    if (entry.player.status === 'pending') {
      this.closeRequest(entry);
      this.entries.delete(entry.player.playerId);
      this.changed();
      return;
    }
    entry.player.status = 'gone';
    this.changed();
    this.broadcastPresence();
    for (const handler of this.handlers) handler.onGone?.({ ...entry.player });
  }

  // ── Helpers ───────────────────────────────────────────────

  private pingAll(): void {
    const now = Date.now();
    for (const entry of this.entries.values()) {
      if (entry.player.status !== 'admitted' || !entry.link) continue;
      if (now - entry.lastPong > SESSION_LIMITS.pingTimeoutMs) entry.link.close();
      else entry.link.send('control', encodeControl({ v: 1, type: 'ping', t: now }));
    }
  }

  private broadcastPresence(): void {
    const players: PresencePlayer[] = [...this.entries.values()]
      .filter((entry) => entry.player.status !== 'pending')
      .map((entry) => ({ playerId: entry.player.playerId, name: entry.player.name, connected: entry.link !== null }));
    const message = encodeControl({ v: 1, type: 'presence', players });
    for (const entry of this.entries.values()) {
      if (entry.player.status === 'admitted') entry.link?.send('control', message);
    }
  }

  private refuse(link: PeerLink, reason: DenyReason): void {
    link.send('control', encodeControl({ v: 1, type: 'denied', reason }));
    link.close();
  }

  private closeRequest(entry: Entry): void {
    if (entry.requestTimer) clearTimeout(entry.requestTimer);
    if (entry.player.status === 'pending' && entry.requestTimer !== null) this.options.onRequestClosed(entry.player.playerId);
    entry.requestTimer = null;
  }

  private admittedCount(): number {
    return [...this.entries.values()].filter((entry) => entry.player.status === 'admitted').length;
  }

  private changed(): void {
    this.options.onPlayersChanged(this.getPlayers());
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/online/gmSession.test.ts`
Expected: PASS (13 tests). If "expires an unanswered request" fails because `deny` is called after `closeRequest` cleared the timer, check that `deny` calls `closeRequest` before deleting the entry (it must fire `onRequestClosed` exactly once).

- [ ] **Step 5: Commit**

```bash
git add src/app/online/GmSession.ts tests/unit/online/gmSession.test.ts
git commit -m "feat(online): GM session with admission, presence, ping and kick"
```

---

### Task 4: PlayerSession

**Files:**
- Create: `src/app/online/PlayerSession.ts`
- Test: `tests/unit/online/playerSession.test.ts`

**Interfaces:**
- Consumes: Task 1, Task 2 (`ClientTransport`, `PeerLink`), Task 3 (`GmSession`, for the tests).
- Produces:
  - `type PlayerStatus = 'connecting' | 'waiting' | 'admitted' | 'denied' | 'lost'`
  - `interface PlayerSessionState { status: PlayerStatus; playerId: string | null; title: string | null; players: PresencePlayer[]; reason: string | null }`
  - `RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000]`, `RECONNECT_GIVE_UP_MS = 300_000`
  - `interface PlayerSessionOptions { hostId: string; name: string; playerKey: string; clientVersion: string; transport: ClientTransport; onChange(state: PlayerSessionState): void }`
  - `class PlayerSession { constructor(options); start(): void; stop(): void; readonly state: PlayerSessionState }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/online/playerSession.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession, RECONNECT_GIVE_UP_MS, type PlayerSessionState } from '../../../src/app/online/PlayerSession';
import { MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';

function setup() {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const gm = new GmSession(network.host('gm'), {
    title: 'Vault', onJoinRequest: (p) => requests.push(p), onRequestClosed: () => {}, onPlayersChanged: () => {},
  });
  gm.start();
  const states: PlayerSessionState[] = [];
  const player = new PlayerSession({
    hostId: 'gm', name: 'Anna', playerKey: 'key-a', clientVersion: '0.5.0',
    transport: network.client(), onChange: (s) => states.push({ ...s }),
  });
  return { network, gm, requests, player, states, statuses: () => states.map((s) => s.status) };
}

const flush = (): Promise<void> => vi.advanceTimersByTimeAsync(0);

describe('PlayerSession', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('connects, waits, then is admitted with the player list', async () => {
    const { gm, requests, player, statuses, states } = setup();
    player.start();
    await flush();
    expect(statuses()).toEqual(['connecting', 'waiting']);
    gm.allow(requests[0]!.playerId);
    expect(player.state.status).toBe('admitted');
    expect(states.at(-1)).toMatchObject({ title: 'Vault', players: [{ name: 'Anna', connected: true }] });
  });

  it('stays denied and does not retry', async () => {
    const { gm, requests, player } = setup();
    player.start();
    await flush();
    gm.deny(requests[0]!.playerId);
    expect(player.state).toMatchObject({ status: 'denied', reason: 'denied' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(player.state.status).toBe('denied');
  });

  it('reconnects after a drop without asking the GM again', async () => {
    const { network, gm, requests, player } = setup();
    player.start();
    await flush();
    gm.allow(requests[0]!.playerId);
    // Drop the player's link from the GM side.
    const gmLinks = (gm as unknown as { links: Map<unknown, unknown> }).links;
    ([...gmLinks.keys()][0] as { close(): void }).close();
    expect(player.state.status).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(player.state.status).toBe('admitted');
    expect(requests).toHaveLength(1);
    expect(network).toBeDefined();
  });

  it('stops when the GM ends the session', async () => {
    const { gm, requests, player } = setup();
    player.start();
    await flush();
    gm.allow(requests[0]!.playerId);
    gm.stop(); // host gone: every reconnect fails
    expect(player.state).toMatchObject({ status: 'lost', reason: 'ended' });
  });

  it('reports an unreachable GM', async () => {
    const network = new MemoryNetwork();
    const player = new PlayerSession({
      hostId: 'nobody', name: 'Anna', playerKey: 'k', clientVersion: '1', transport: network.client(), onChange: () => {},
    });
    player.start();
    await flush();
    expect(player.state).toMatchObject({ status: 'lost', reason: 'unreachable' });
  });

  it('keeps retrying a dropped link until the give-up time', async () => {
    const network = new MemoryNetwork();
    const host = network.host('gm');
    const gm = new GmSession(host, { title: 'V', onJoinRequest: (p) => gm.allow(p.playerId), onRequestClosed: () => {}, onPlayersChanged: () => {} });
    gm.start();
    const player = new PlayerSession({ hostId: 'gm', name: 'A', playerKey: 'k', clientVersion: '1', transport: network.client(), onChange: () => {} });
    player.start();
    await flush();
    expect(player.state.status).toBe('admitted');
    host.close(); // unreachable from now on, but no bye was sent
    const gmLinks = (gm as unknown as { links: Map<unknown, unknown> }).links;
    ([...gmLinks.keys()][0] as { close(): void }).close();
    await vi.advanceTimersByTimeAsync(RECONNECT_GIVE_UP_MS - 1000);
    expect(player.state.status).toBe('connecting');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(player.state).toMatchObject({ status: 'lost', reason: 'unreachable' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/online/playerSession.test.ts`
Expected: FAIL, import not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/online/PlayerSession.ts
/**
 * The player's side of an online session: join a GM, wait for approval, keep
 * the player list, and reconnect after a drop. Shared with the web player page,
 * so it imports nothing from Obsidian.
 */
import { decodeControl, encodeControl, type PresencePlayer } from './protocol';
import type { ClientTransport, PeerLink } from './transport/types';

export type PlayerStatus = 'connecting' | 'waiting' | 'admitted' | 'denied' | 'lost';

export interface PlayerSessionState {
  status: PlayerStatus;
  playerId: string | null;
  title: string | null;
  players: PresencePlayer[];
  /** Why the session is denied or lost: a deny reason, `ended` or `unreachable`. */
  reason: string | null;
}

export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000] as const;
export const RECONNECT_GIVE_UP_MS = 300_000;

export interface PlayerSessionOptions {
  hostId: string;
  name: string;
  playerKey: string;
  clientVersion: string;
  transport: ClientTransport;
  onChange(state: PlayerSessionState): void;
}

export class PlayerSession {
  state: PlayerSessionState = { status: 'connecting', playerId: null, title: null, players: [], reason: null };
  private link: PeerLink | null = null;
  private finished = false;
  private wasAdmitted = false;
  private attempt = 0;
  private droppedAt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: PlayerSessionOptions) {}

  start(): void {
    void this.connect();
  }

  stop(): void {
    this.finished = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.link?.send('control', encodeControl({ v: 1, type: 'bye', reason: 'left' }));
    this.link?.close();
  }

  private async connect(): Promise<void> {
    this.update({ status: 'connecting' });
    let link: PeerLink;
    try {
      link = await this.options.transport.connect(this.options.hostId);
    } catch {
      this.dropped();
      return;
    }
    if (this.finished) {
      link.close();
      return;
    }
    this.link = link;
    link.onMessage((channel, data) => { if (channel === 'control') this.receive(link, data); });
    link.onClose(() => { if (this.link === link) { this.link = null; this.dropped(); } });
    link.send('control', encodeControl({
      v: 1, type: 'join', name: this.options.name, playerKey: this.options.playerKey,
      client: { kind: 'web', version: this.options.clientVersion },
    }));
    if (this.state.status === 'connecting') this.update({ status: 'waiting' });
  }

  private receive(link: PeerLink, data: unknown): void {
    const decoded = decodeControl(data);
    if (decoded.kind !== 'message') return;
    const message = decoded.message;
    switch (message.type) {
      case 'admitted':
        this.wasAdmitted = true;
        this.attempt = 0;
        this.update({ status: 'admitted', playerId: message.playerId, title: message.session.title, reason: null });
        break;
      case 'denied':
        this.finish('denied', message.reason);
        link.close();
        break;
      case 'presence':
        this.update({ players: message.players });
        break;
      case 'ping':
        link.send('control', encodeControl({ v: 1, type: 'pong', t: message.t }));
        break;
      case 'bye':
        // A newer tab of this player took over, or the GM ended the session.
        this.finish('lost', message.reason === 'replaced' ? 'replaced' : 'ended');
        link.close();
        break;
      default:
        break;
    }
  }

  /** The link closed or could not be made: retry if we were in, else stop. */
  private dropped(): void {
    if (this.finished) return;
    if (!this.wasAdmitted) {
      this.finish('lost', 'unreachable');
      return;
    }
    if (this.attempt === 0) this.droppedAt = Date.now();
    if (Date.now() - this.droppedAt >= RECONNECT_GIVE_UP_MS) {
      this.finish('lost', 'unreachable');
      return;
    }
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)]!;
    this.attempt++;
    this.update({ status: 'connecting' });
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }

  private finish(status: 'denied' | 'lost', reason: string): void {
    this.finished = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.update({ status, reason });
  }

  private update(partial: Partial<PlayerSessionState>): void {
    this.state = { ...this.state, ...partial };
    this.options.onChange(this.state);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/online/playerSession.test.ts`
Expected: PASS (6 tests). "stops when the GM ends the session" goes through the GM's `bye` (`reason: 'ended'`); the last case covers a silent drop and the five-minute give-up.

- [ ] **Step 5: Commit**

```bash
git add src/app/online/PlayerSession.ts tests/unit/online/playerSession.test.ts
git commit -m "feat(online): player session with reconnect"
```

---

### Task 5: PeerJS transport

**Files:**
- Modify: `package.json` (dependency `peerjs@1.5.5`)
- Create: `src/app/online/transport/PeerTransport.ts`
- Test: `tests/unit/online/peerTransport.test.ts`

**Interfaces:**
- Consumes: Task 1 `randomId`, Task 2 interfaces.
- Produces:
  - `interface PeerServerOptions { host?: string; port?: number; path?: string; key?: string; secure?: boolean; iceServers: RTCIceServer[] }`
  - `createPeerHost(options: PeerServerOptions): Promise<HostTransport>`: retries once with a new id on `unavailable-id`, rejects with a `TransportError` otherwise.
  - `createPeerClient(options: PeerServerOptions): ClientTransport`
  - `LINK_OPEN_TIMEOUT_MS = 15_000`

- [ ] **Step 1: Install PeerJS**

Run: `npm install peerjs@1.5.5`
Expected: `package.json` lists `"peerjs": "^1.5.5"` under dependencies.

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/online/peerTransport.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => void;

/** Just enough of PeerJS to drive the transport. */
class FakeEmitter {
  handlers = new Map<string, Handler[]>();
  on(event: string, handler: Handler): this { this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]); return this; }
  emit(event: string, ...args: unknown[]): void { (this.handlers.get(event) ?? []).forEach((h) => h(...args)); }
}

class FakeConnection extends FakeEmitter {
  sent: unknown[] = [];
  closed = false;
  constructor(public peer: string, public label: string, public metadata: unknown) { super(); }
  send(data: unknown): void { this.sent.push(data); }
  close(): void { if (!this.closed) { this.closed = true; this.emit('close'); } }
}

const peers: FakePeer[] = [];
class FakePeer extends FakeEmitter {
  destroyed = false;
  connections: FakeConnection[] = [];
  constructor(public id: string | undefined, public options: unknown) { super(); peers.push(this); }
  connect(peer: string, options: { label: string; metadata: unknown }): FakeConnection {
    const connection = new FakeConnection(peer, options.label, options.metadata);
    this.connections.push(connection);
    return connection;
  }
  destroy(): void { this.destroyed = true; }
}

vi.mock('peerjs', () => ({ Peer: FakePeer }));

const { createPeerHost, createPeerClient } = await import('../../../src/app/online/transport/PeerTransport');

afterEach(() => { peers.length = 0; });

describe('PeerTransport', () => {
  it('opens a host with a 128-bit id and pairs the two connections of a player', async () => {
    const pending = createPeerHost({ iceServers: [] });
    const peer = peers[0]!;
    expect(peer.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    peer.emit('open', peer.id);
    const host = await pending;

    const links: Array<{ remoteId: string }> = [];
    host.onConnection((link) => links.push(link));
    const control = new FakeConnection('p1', 'control', { linkId: 'L1' });
    const assets = new FakeConnection('p1', 'assets', { linkId: 'L1' });
    peer.emit('connection', control);
    peer.emit('connection', assets);
    control.emit('open');
    expect(links).toHaveLength(0);
    assets.emit('open');
    expect(links).toHaveLength(1);
    expect(links[0]!.remoteId).toBe('p1');
  });

  it('retries once with a new id when the id is taken', async () => {
    const pending = createPeerHost({ iceServers: [] });
    peers[0]!.emit('error', { type: 'unavailable-id', message: 'taken' });
    const second = peers[1]!;
    expect(second.id).not.toBe(peers[0]!.id);
    second.emit('open', second.id);
    await expect(pending).resolves.toMatchObject({ id: second.id });
  });

  it('reports a signaling failure', async () => {
    const pending = createPeerHost({ iceServers: [] });
    peers[0]!.emit('error', { type: 'server-error', message: 'Could not get an ID from the server.' });
    await expect(pending).rejects.toMatchObject({ code: 'server-error', message: 'Could not get an ID from the server.' });
  });

  it('connects a client with both channels and closes both together', async () => {
    const client = createPeerClient({ iceServers: [] });
    const pending = client.connect('gm-id');
    const peer = peers[0]!;
    peer.emit('open', 'me');
    const [control, assets] = peer.connections;
    expect(control!.label).toBe('control');
    expect(assets!.label).toBe('assets');
    expect(control!.metadata).toEqual(assets!.metadata);
    control!.emit('open');
    assets!.emit('open');
    const link = await pending;
    const received: unknown[] = [];
    link.onMessage((channel, data) => received.push([channel, data]));
    assets!.emit('data', 'chunk');
    expect(received).toEqual([['assets', 'chunk']]);
    let closed = 0;
    link.onClose(() => closed++);
    control!.close();
    expect(assets!.closed).toBe(true);
    expect(closed).toBe(1);
    expect(peer.destroyed).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/online/peerTransport.test.ts`
Expected: FAIL, import not found.

- [ ] **Step 4: Write the implementation**

```ts
// src/app/online/transport/PeerTransport.ts
import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import { randomId } from '../ids';
import type { Channel, ClientTransport, HostTransport, PeerLink, TransportError, Unsubscribe } from './types';

export interface PeerServerOptions {
  host?: string;
  port?: number;
  path?: string;
  key?: string;
  secure?: boolean;
  iceServers: RTCIceServer[];
}

export const LINK_OPEN_TIMEOUT_MS = 15_000;

function peerOptions(options: PeerServerOptions): PeerOptions {
  const { iceServers, ...server } = options;
  return { ...server, config: { iceServers } };
}

function asError(error: unknown): TransportError {
  const e = error as { type?: string; message?: string };
  return { code: e?.type ?? 'network', message: e?.message ?? String(error) };
}

/** A player's two data connections as one link. */
class PeerJsLink implements PeerLink {
  private closed = false;
  private readonly closeListeners = new Set<() => void>();

  constructor(readonly remoteId: string, private readonly channels: Record<Channel, DataConnection>, private readonly onClosed: () => void) {
    for (const connection of Object.values(channels)) {
      connection.on('close', () => this.close());
      connection.on('error', () => this.close());
    }
  }

  send(channel: Channel, data: string | ArrayBuffer): void {
    if (!this.closed) this.channels[channel].send(data);
  }

  onMessage(cb: (channel: Channel, data: unknown) => void): Unsubscribe {
    let active = true;
    (Object.keys(this.channels) as Channel[]).forEach((channel) => {
      this.channels[channel].on('data', (data: unknown) => { if (active) cb(channel, data); });
    });
    return () => { active = false; };
  }

  onClose(cb: () => void): Unsubscribe {
    this.closeListeners.add(cb);
    return () => this.closeListeners.delete(cb);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    Object.values(this.channels).forEach((connection) => connection.close());
    this.closeListeners.forEach((cb) => cb());
    this.closeListeners.clear();
    this.onClosed();
  }
}

/**
 * Hosts a session under a fresh id. A taken id is retried once with another;
 * any other failure before the id opens rejects.
 */
export async function createPeerHost(options: PeerServerOptions): Promise<HostTransport> {
  try {
    return await openHost(options);
  } catch (error) {
    if ((error as TransportError).code === 'unavailable-id') return openHost(options);
    throw error;
  }
}

function openHost(options: PeerServerOptions): Promise<HostTransport> {
  return new Promise((resolve, reject) => {
    const id = randomId();
    const peer = new Peer(id, peerOptions(options));
    const connectionListeners = new Set<(link: PeerLink) => void>();
    const errorListeners = new Set<(error: TransportError) => void>();
    const halves = new Map<string, { control?: DataConnection; assets?: DataConnection; timer: ReturnType<typeof setTimeout> }>();
    let open = false;

    peer.on('open', () => {
      open = true;
      resolve({
        id,
        onConnection: (cb) => { connectionListeners.add(cb); return () => connectionListeners.delete(cb); },
        onError: (cb) => { errorListeners.add(cb); return () => errorListeners.delete(cb); },
        close: () => peer.destroy(),
      });
    });

    peer.on('error', (error: unknown) => {
      const failure = asError(error);
      if (!open) {
        peer.destroy();
        reject(failure);
      } else {
        errorListeners.forEach((cb) => cb(failure));
      }
    });

    // Signaling dropped while hosting: established links keep working; get back on.
    peer.on('disconnected', () => { if (open) peer.reconnect(); });

    peer.on('connection', (connection: DataConnection) => {
      const linkId = (connection.metadata as { linkId?: unknown } | undefined)?.linkId;
      const label = connection.label;
      if (typeof linkId !== 'string' || (label !== 'control' && label !== 'assets')) {
        connection.close();
        return;
      }
      const pair = halves.get(linkId) ?? { timer: setTimeout(() => {
        const stale = halves.get(linkId);
        halves.delete(linkId);
        stale?.control?.close();
        stale?.assets?.close();
      }, LINK_OPEN_TIMEOUT_MS) };
      halves.set(linkId, pair);
      connection.on('open', () => {
        pair[label] = connection;
        if (pair.control && pair.assets) {
          clearTimeout(pair.timer);
          halves.delete(linkId);
          const link = new PeerJsLink(connection.peer, { control: pair.control, assets: pair.assets }, () => {});
          connectionListeners.forEach((cb) => cb(link));
        }
      });
    });
  });
}

/** Joins hosts through PeerJS; each link has its own peer, destroyed when the link closes. */
export function createPeerClient(options: PeerServerOptions): ClientTransport {
  return {
    connect: (hostId: string): Promise<PeerLink> => new Promise((resolve, reject) => {
      const peer = new Peer(peerOptions(options));
      const timer = setTimeout(() => { peer.destroy(); reject({ code: 'timeout', message: 'Timed out connecting to the GM' }); }, LINK_OPEN_TIMEOUT_MS);
      peer.on('error', (error: unknown) => { clearTimeout(timer); peer.destroy(); reject(asError(error)); });
      peer.on('open', () => {
        const metadata = { linkId: randomId(12) };
        const control = peer.connect(hostId, { label: 'control', metadata, reliable: true, serialization: 'raw' });
        const assets = peer.connect(hostId, { label: 'assets', metadata, reliable: true, serialization: 'raw' });
        let opened = 0;
        const onOpen = (): void => {
          if (++opened < 2) return;
          clearTimeout(timer);
          resolve(new PeerJsLink(hostId, { control, assets }, () => peer.destroy()));
        };
        control.on('open', onOpen);
        assets.on('open', onOpen);
      });
    }),
  };
}
```

Note for the client `new Peer(options)`: PeerJS 1.5 accepts `new Peer(options)` (the id is then assigned by the server). The fake in the test records `id` as the options object in that case; the test only checks the host id.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/online/peerTransport.test.ts`
Expected: PASS (4 tests). If TypeScript rejects `serialization: 'raw'`, check the PeerJS 1.5.5 `PeerConnectOption` type in `node_modules/peerjs/dist/types.d.ts`; `'raw'` is one of its `SerializationType` values.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/app/online/transport/PeerTransport.ts tests/unit/online/peerTransport.test.ts
git commit -m "feat(online): PeerJS transport with paired control and asset channels"
```

---

### Task 6: Online settings and join links

**Files:**
- Create: `src/app/online/onlineSettings.ts`, `src/app/online/joinLink.ts`, `src/app/settings/onlineSettingsSection.ts`
- Modify: `src/app/services/SettingsService.ts` (add `online` to `AtlasSettings`, defaults, `getOnlineSettings`, `setOnlineSettings`)
- Test: `tests/unit/online/onlineSettings.test.ts`, `tests/unit/online/joinLink.test.ts`

**Interfaces:**
- Consumes: Task 5 `PeerServerOptions`.
- Produces:
  - `interface TurnServer { urls: string; username: string; credential: string }`
  - `interface OnlineSettings { signaling: { mode: 'cloud' | 'custom'; host: string; port: number; path: string; key: string; secure: boolean }; turnServers: TurnServer[]; playerPageUrl: string }`
  - `DEFAULT_ONLINE_SETTINGS: OnlineSettings`, `DEFAULT_STUN = 'stun:stun.l.google.com:19302'`
  - `peerServerOptions(settings: OnlineSettings): PeerServerOptions`
  - `parseTurnServers(text: string): TurnServer[]` (one per line: `urls username credential`, blank lines and `#` comments skipped, lines not starting with `turn:`/`turns:` skipped)
  - `formatTurnServers(servers: TurnServer[]): string`
  - `buildJoinUrl(pageUrl: string, hostId: string, settings: OnlineSettings): string`
  - `type JoinTarget = { hostId: string; server: PeerServerOptions }`
  - `parseJoinFragment(hash: string): JoinTarget | null`
  - `SettingsService.getOnlineSettings(): OnlineSettings`, `SettingsService.setOnlineSettings(settings: Partial<OnlineSettings>): void`
  - `onlineSettingsSection(settings: SettingsService): AtlasSettingSection`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/online/onlineSettings.test.ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_ONLINE_SETTINGS, DEFAULT_STUN, formatTurnServers, parseTurnServers, peerServerOptions } from '../../../src/app/online/onlineSettings';

describe('online settings', () => {
  it('uses the PeerJS cloud and public STUN by default', () => {
    expect(peerServerOptions(DEFAULT_ONLINE_SETTINGS)).toEqual({ iceServers: [{ urls: DEFAULT_STUN }] });
  });

  it('points at a custom signaling server and adds TURN servers', () => {
    const options = peerServerOptions({
      ...DEFAULT_ONLINE_SETTINGS,
      signaling: { mode: 'custom', host: 'peer.example.org', port: 443, path: '/myapp', key: 'k', secure: true },
      turnServers: [{ urls: 'turn:relay.example.org:3478', username: 'u', credential: 'c' }],
    });
    expect(options).toEqual({
      host: 'peer.example.org', port: 443, path: '/myapp', key: 'k', secure: true,
      iceServers: [{ urls: DEFAULT_STUN }, { urls: 'turn:relay.example.org:3478', username: 'u', credential: 'c' }],
    });
  });

  it('reads TURN servers one per line and writes them back', () => {
    const text = '# relay\nturn:a.example:3478 alice secret\n\nturns:b.example:5349 bob pw\nhttp://nope x y\n';
    const servers = parseTurnServers(text);
    expect(servers).toEqual([
      { urls: 'turn:a.example:3478', username: 'alice', credential: 'secret' },
      { urls: 'turns:b.example:5349', username: 'bob', credential: 'pw' },
    ]);
    expect(parseTurnServers(formatTurnServers(servers))).toEqual(servers);
  });
});
```

```ts
// tests/unit/online/joinLink.test.ts
import { describe, expect, it } from 'vitest';
import { buildJoinUrl, parseJoinFragment } from '../../../src/app/online/joinLink';
import { DEFAULT_ONLINE_SETTINGS, DEFAULT_STUN } from '../../../src/app/online/onlineSettings';

describe('join links', () => {
  it('puts only the id in the fragment on the default server', () => {
    const url = buildJoinUrl('https://example.github.io/atlas-vtt/', 'abc_DEF-123', DEFAULT_ONLINE_SETTINGS);
    expect(url).toBe('https://example.github.io/atlas-vtt/#id=abc_DEF-123');
    expect(parseJoinFragment(new URL(url).hash)).toEqual({ hostId: 'abc_DEF-123', server: { iceServers: [{ urls: DEFAULT_STUN }] } });
  });

  it('carries a custom server and TURN relays, and reads them back', () => {
    const settings = {
      ...DEFAULT_ONLINE_SETTINGS,
      signaling: { mode: 'custom' as const, host: 'peer.example.org', port: 9000, path: '/', key: 'peerjs', secure: true },
      turnServers: [{ urls: 'turn:relay.example.org:3478', username: 'u', credential: 'c' }],
    };
    const url = buildJoinUrl('https://example.github.io/atlas-vtt#old', 'gm1', settings);
    expect(url.startsWith('https://example.github.io/atlas-vtt#id=gm1&signal=')).toBe(true);
    expect(parseJoinFragment(new URL(url).hash)).toEqual({
      hostId: 'gm1',
      server: {
        host: 'peer.example.org', port: 9000, path: '/', key: 'peerjs', secure: true,
        iceServers: [{ urls: DEFAULT_STUN }, { urls: 'turn:relay.example.org:3478', username: 'u', credential: 'c' }],
      },
    });
  });

  it('refuses incomplete or broken fragments', () => {
    expect(parseJoinFragment('')).toBeNull();
    expect(parseJoinFragment('#')).toBeNull();
    expect(parseJoinFragment('#id=')).toBeNull();
    expect(parseJoinFragment('#id=has spaces')).toBeNull();
    expect(parseJoinFragment('#id=ok&signal=%%%')).toBeNull();
    expect(parseJoinFragment('#id=ok&ice=bm90IGpzb24')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/online/onlineSettings.test.ts tests/unit/online/joinLink.test.ts`
Expected: FAIL, imports not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/online/onlineSettings.ts
import type { PeerServerOptions } from './transport/PeerTransport';

export interface TurnServer {
  urls: string;
  username: string;
  credential: string;
}

export interface OnlineSettings {
  signaling: { mode: 'cloud' | 'custom'; host: string; port: number; path: string; key: string; secure: boolean };
  turnServers: TurnServer[];
  /** Where join links point: the published `online-client/` page. */
  playerPageUrl: string;
}

export const DEFAULT_STUN = 'stun:stun.l.google.com:19302';

export const DEFAULT_ONLINE_SETTINGS: OnlineSettings = {
  signaling: { mode: 'cloud', host: '', port: 443, path: '/', key: 'peerjs', secure: true },
  turnServers: [],
  playerPageUrl: 'https://evoljoaobento.github.io/atlas-vtt/',
};

/** PeerJS options for these settings: the PeerJS cloud unless a custom server is set. */
export function peerServerOptions(settings: OnlineSettings): PeerServerOptions {
  const iceServers: RTCIceServer[] = [{ urls: DEFAULT_STUN }, ...settings.turnServers.map((server) => ({ ...server }))];
  if (settings.signaling.mode !== 'custom' || !settings.signaling.host) return { iceServers };
  const { host, port, path, key, secure } = settings.signaling;
  return { host, port, path, key, secure, iceServers };
}

/** One relay per line: `turn:host:port username credential`. */
export function parseTurnServers(text: string): TurnServer[] {
  return text.split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(/\s+/))
    .filter(([urls]) => /^turns?:/.test(urls ?? ''))
    .map(([urls = '', username = '', credential = '']) => ({ urls, username, credential }));
}

export function formatTurnServers(servers: TurnServer[]): string {
  return servers.map((server) => `${server.urls} ${server.username} ${server.credential}`).join('\n');
}
```

```ts
// src/app/online/joinLink.ts
/**
 * Join links: `<page>#id=<gm id>[&signal=…][&ice=…]`. Everything sits in the
 * fragment, which browsers never send to the page's host. Shared with the web
 * player page, so it imports no Obsidian code.
 */
import { DEFAULT_STUN, peerServerOptions, type OnlineSettings } from './onlineSettings';
import type { PeerServerOptions } from './transport/PeerTransport';

export interface JoinTarget {
  hostId: string;
  server: PeerServerOptions;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function toBase64Url(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): unknown {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
}

export function buildJoinUrl(pageUrl: string, hostId: string, settings: OnlineSettings): string {
  const base = pageUrl.split('#')[0];
  const { iceServers, ...server } = peerServerOptions(settings);
  const params = [`id=${hostId}`];
  if (Object.keys(server).length) params.push(`signal=${toBase64Url(server)}`);
  const relays = iceServers.filter((ice) => ice.urls !== DEFAULT_STUN);
  if (relays.length) params.push(`ice=${toBase64Url(relays)}`);
  return `${base}#${params.join('&')}`;
}

/** The GM and servers a join link names; null for an incomplete or broken link. */
export function parseJoinFragment(hash: string): JoinTarget | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const hostId = params.get('id') ?? '';
  if (!ID_PATTERN.test(hostId)) return null;
  try {
    const signal = params.get('signal');
    const ice = params.get('ice');
    const server = signal ? fromBase64Url(signal) as Omit<PeerServerOptions, 'iceServers'> : {};
    const relays = ice ? fromBase64Url(ice) as RTCIceServer[] : [];
    if (typeof server !== 'object' || server === null || !Array.isArray(relays)) return null;
    return { hostId, server: { ...server, iceServers: [{ urls: DEFAULT_STUN }, ...relays] } };
  } catch {
    return null;
  }
}
```

In `src/app/services/SettingsService.ts`:

```ts
// 1. import
import { DEFAULT_ONLINE_SETTINGS, type OnlineSettings } from '../online/onlineSettings';

// 2. in interface AtlasSettings, after `systemPresets`:
  /** Hosting online sessions; nothing here is used until a session starts. */
  online: OnlineSettings;

// 3. in DEFAULT_SETTINGS, after `systemPresets: [],`:
  online: DEFAULT_ONLINE_SETTINGS,

// 4. methods, next to getLocalPlayerViewSettings:
  getOnlineSettings(): OnlineSettings {
    const online = this.settings.online ?? DEFAULT_ONLINE_SETTINGS;
    return { ...online, signaling: { ...online.signaling }, turnServers: online.turnServers.map((server) => ({ ...server })) };
  }

  setOnlineSettings(settings: Partial<OnlineSettings>): void {
    this.settings.online = { ...this.getOnlineSettings(), ...settings };
    this.commit();
  }
```

```ts
// src/app/settings/onlineSettingsSection.ts
import type { SettingsService } from '../services/SettingsService';
import { formatTurnServers, parseTurnServers } from '../online/onlineSettings';
import type { AtlasSettingSection } from './settingSections';

export function onlineSettingsSection(settings: SettingsService): AtlasSettingSection {
  const signaling = (): ReturnType<SettingsService['getOnlineSettings']>['signaling'] => settings.getOnlineSettings().signaling;
  const setSignaling = (partial: Partial<ReturnType<typeof signaling>>): void =>
    settings.setOnlineSettings({ signaling: { ...signaling(), ...partial } });

  return {
    heading: 'Online play',
    rows: [
      {
        name: 'Signaling server',
        desc: 'Helps players find your session; no game data goes through it. The free PeerJS cloud works out of the box. Only used while a session is running.',
        aliases: ['peerjs', 'online', 'multiplayer', 'remote'],
        render: (setting) => {
          setting.addDropdown((dropdown) => dropdown
            .addOption('cloud', 'PeerJS cloud (free)')
            .addOption('custom', 'My own server')
            .setValue(signaling().mode)
            .onChange((value) => setSignaling({ mode: value === 'custom' ? 'custom' : 'cloud' })));
        },
      },
      {
        name: 'Own server address',
        desc: 'Host, port and path of your peerjs-server, used when "My own server" is chosen.',
        render: (setting) => {
          setting
            .addText((text) => text.setPlaceholder('peer.example.org').setValue(signaling().host).onChange((host) => setSignaling({ host: host.trim() })))
            .addText((text) => text.setPlaceholder('443').setValue(String(signaling().port)).onChange((port) => setSignaling({ port: Number(port) || 443 })))
            .addText((text) => text.setPlaceholder('/').setValue(signaling().path).onChange((path) => setSignaling({ path: path.trim() || '/' })));
        },
      },
      {
        name: 'Own server key and TLS',
        render: (setting) => {
          setting
            .addText((text) => text.setPlaceholder('peerjs').setValue(signaling().key).onChange((key) => setSignaling({ key: key.trim() || 'peerjs' })))
            .addToggle((toggle) => toggle.setValue(signaling().secure).onChange((secure) => setSignaling({ secure })));
        },
      },
      {
        name: 'Relay (TURN) servers',
        desc: 'For players whose network blocks direct connections. One per line: turn:host:port username password. Players receive these in the join link.',
        aliases: ['turn', 'relay', 'nat', 'firewall'],
        render: (setting) => {
          setting.addTextArea((area) => area
            .setPlaceholder('turn:relay.example.org:3478 user password')
            .setValue(formatTurnServers(settings.getOnlineSettings().turnServers))
            .onChange((text) => settings.setOnlineSettings({ turnServers: parseTurnServers(text) })));
        },
      },
      {
        name: 'Player page',
        desc: 'The web page players open to join. Change it if you publish the page yourself.',
        render: (setting) => {
          setting.addText((text) => text
            .setValue(settings.getOnlineSettings().playerPageUrl)
            .onChange((url) => settings.setOnlineSettings({ playerPageUrl: url.trim() })));
        },
      },
    ],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/online/onlineSettings.test.ts tests/unit/online/joinLink.test.ts && npx tsc --noEmit`
Expected: PASS (6 tests), no type errors. If `tests/mocks/obsidian.ts` lacks `addTextArea` on `Setting`, the section is not unit tested here; it is checked in Task 7's manual run.

- [ ] **Step 5: Commit**

```bash
git add src/app/online/onlineSettings.ts src/app/online/joinLink.ts src/app/settings/onlineSettingsSection.ts src/app/services/SettingsService.ts tests/unit/online/onlineSettings.test.ts tests/unit/online/joinLink.test.ts
git commit -m "feat(online): online settings and join links"
```

---

### Task 7: GM integration (service, notices, modal, status bar, commands)

**Files:**
- Create: `src/app/online/onlineSessionStore.ts`, `src/app/online/OnlineSessionService.ts`, `src/app/online/ui/joinRequestNotice.ts`, `src/app/online/ui/OnlineSessionModal.ts`, `src/app/online/ui/online-session.scss`, `src/app/online/registerOnline.ts`
- Modify: `main.ts` (create the service, add the settings section, register, stop on unload), `styles/main.scss` (import the SCSS), `src/app/react/components/ViewActionsMenu.tsx` (menu item)
- Test: `tests/unit/online/onlineSessionService.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 5, 6.
- Produces:
  - `interface OnlineSessionState { status: 'idle' | 'starting' | 'hosting' | 'error'; peerId: string | null; joinUrl: string | null; players: SessionPlayer[]; error: string | null }`
  - `onlineSessionStore: StoreApi<OnlineSessionState>`, `resetOnlineSessionStore(): void`
  - `class OnlineSessionService { static forApp(app: App): OnlineSessionService | undefined; constructor(app: App, settings: SettingsService, deps?: { createHost?: (options: PeerServerOptions) => Promise<HostTransport>; showRequest?: (player: SessionPlayer, answer: (allow: boolean) => void) => { hide(): void } }); start(): Promise<void>; stop(): void; allow(playerId: string): void; deny(playerId: string): void; kick(playerId: string): void; get session(): GmSession | null }`
  - `showJoinRequestNotice(player: SessionPlayer, answer: (allow: boolean) => void): { hide(): void }`
  - `openOnlineSessionModal(app: App): void`
  - `registerOnline(plugin: Plugin, service: OnlineSessionService): void`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/online/onlineSessionService.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnlineSessionService } from '../../../src/app/online/OnlineSessionService';
import { onlineSessionStore, resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import { MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';
import { DEFAULT_ONLINE_SETTINGS } from '../../../src/app/online/onlineSettings';
import { encodeControl } from '../../../src/app/online/protocol';

const app = { vault: { getName: () => 'My Vault' } } as never;
const settings = { getOnlineSettings: () => DEFAULT_ONLINE_SETTINGS } as never;

afterEach(() => { resetOnlineSessionStore(); vi.useRealTimers(); });

function service(network = new MemoryNetwork()) {
  const notices: Array<{ name: string; answer: (allow: boolean) => void; hidden: boolean }> = [];
  const svc = new OnlineSessionService(app, settings, {
    createHost: async () => network.host('gm-id'),
    showRequest: (player, answer) => {
      const notice = { name: player.name, answer, hidden: false };
      notices.push(notice);
      return { hide: () => { notice.hidden = true; } };
    },
  });
  return { svc, notices, network };
}

describe('OnlineSessionService', () => {
  it('starts hosting with a join link', async () => {
    const { svc } = service();
    await svc.start();
    expect(onlineSessionStore.getState()).toMatchObject({
      status: 'hosting', peerId: 'gm-id', joinUrl: 'https://evoljoaobento.github.io/atlas-vtt/#id=gm-id',
    });
  });

  it('shows a notice per join request and admits on Allow', async () => {
    const { svc, notices, network } = service();
    await svc.start();
    const link = await network.client().connect('gm-id');
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Anna', playerKey: 'k', client: { kind: 'web', version: '1' } }));
    expect(notices.map((n) => n.name)).toEqual(['Anna']);
    notices[0]!.answer(true);
    expect(notices[0]!.hidden).toBe(true);
    expect(onlineSessionStore.getState().players).toMatchObject([{ name: 'Anna', status: 'admitted' }]);
  });

  it('hides open notices when the session stops', async () => {
    const { svc, notices, network } = service();
    await svc.start();
    const link = await network.client().connect('gm-id');
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Bob', playerKey: 'k', client: { kind: 'web', version: '1' } }));
    svc.stop();
    expect(notices[0]!.hidden).toBe(true);
    expect(onlineSessionStore.getState()).toMatchObject({ status: 'idle', players: [], joinUrl: null });
  });

  it('reports a failure to start', async () => {
    const svc = new OnlineSessionService(app, settings, {
      createHost: async () => { throw { code: 'server-error', message: 'Could not reach the signaling server' }; },
      showRequest: () => ({ hide: () => {} }),
    });
    await svc.start();
    expect(onlineSessionStore.getState()).toMatchObject({ status: 'error', error: 'Could not reach the signaling server' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/online/onlineSessionService.test.ts`
Expected: FAIL, import not found.

- [ ] **Step 3: Write the store, service and notice**

```ts
// src/app/online/onlineSessionStore.ts
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { SessionPlayer } from './GmSession';

export interface OnlineSessionState {
  status: 'idle' | 'starting' | 'hosting' | 'error';
  peerId: string | null;
  joinUrl: string | null;
  players: SessionPlayer[];
  error: string | null;
}

const INITIAL_STATE: OnlineSessionState = { status: 'idle', peerId: null, joinUrl: null, players: [], error: null };

/** The online session as the GM's UI sees it, written by `OnlineSessionService`. */
export const onlineSessionStore: StoreApi<OnlineSessionState> = createStore<OnlineSessionState>(() => INITIAL_STATE);

export function resetOnlineSessionStore(): void {
  onlineSessionStore.setState(INITIAL_STATE);
}
```

```ts
// src/app/online/ui/joinRequestNotice.ts
import { Notice } from 'obsidian';
import type { SessionPlayer } from '../GmSession';

/** "Anna wants to join. Allow / Deny", until answered or hidden. The name is text, never HTML. */
export function showJoinRequestNotice(player: SessionPlayer, answer: (allow: boolean) => void): { hide(): void } {
  const fragment = document.createDocumentFragment();
  const body = fragment.createDiv({ cls: 'atlas-online-request' });
  body.createDiv({ cls: 'atlas-online-request__text' }).setText(`${player.name} wants to join your online session.`);
  const actions = body.createDiv({ cls: 'atlas-online-request__actions' });
  const notice = new Notice(fragment, 0);
  const reply = (allow: boolean) => (event: MouseEvent): void => {
    event.stopPropagation();
    answer(allow);
    notice.hide();
  };
  actions.createEl('button', { cls: 'mod-cta', text: 'Allow' }).addEventListener('click', reply(true));
  actions.createEl('button', { text: 'Deny' }).addEventListener('click', reply(false));
  return { hide: () => notice.hide() };
}
```

```ts
// src/app/online/OnlineSessionService.ts
import type { App } from 'obsidian';
import type { SettingsService } from '../services/SettingsService';
import { GmSession, type SessionPlayer } from './GmSession';
import { buildJoinUrl } from './joinLink';
import { onlineSessionStore, resetOnlineSessionStore } from './onlineSessionStore';
import { peerServerOptions } from './onlineSettings';
import { createPeerHost, type PeerServerOptions } from './transport/PeerTransport';
import type { HostTransport, TransportError } from './transport/types';
import { showJoinRequestNotice } from './ui/joinRequestNotice';

interface Deps {
  createHost?: (options: PeerServerOptions) => Promise<HostTransport>;
  showRequest?: (player: SessionPlayer, answer: (allow: boolean) => void) => { hide(): void };
}

/** Hosts one online session for the vault at a time; the UI reads `onlineSessionStore`. */
export class OnlineSessionService {
  private static instances = new WeakMap<App, OnlineSessionService>();
  static forApp(app: App): OnlineSessionService | undefined {
    return this.instances.get(app);
  }

  private current: GmSession | null = null;
  private readonly notices = new Map<string, { hide(): void }>();
  private readonly createHost: (options: PeerServerOptions) => Promise<HostTransport>;
  private readonly showRequest: NonNullable<Deps['showRequest']>;

  constructor(private readonly app: App, private readonly settings: SettingsService, deps: Deps = {}) {
    this.createHost = deps.createHost ?? createPeerHost;
    this.showRequest = deps.showRequest ?? showJoinRequestNotice;
    OnlineSessionService.instances.set(app, this);
  }

  get session(): GmSession | null {
    return this.current;
  }

  async start(): Promise<void> {
    if (this.current || onlineSessionStore.getState().status === 'starting') return;
    onlineSessionStore.setState({ status: 'starting', error: null });
    const online = this.settings.getOnlineSettings();
    let host: HostTransport;
    try {
      host = await this.createHost(peerServerOptions(online));
    } catch (error) {
      onlineSessionStore.setState({ status: 'error', error: (error as TransportError).message ?? String(error) });
      return;
    }
    const session = new GmSession(host, {
      title: this.app.vault.getName(),
      onJoinRequest: (player) => {
        this.notices.set(player.playerId, this.showRequest(player, (allow) => allow ? this.allow(player.playerId) : this.deny(player.playerId)));
      },
      onRequestClosed: (playerId) => {
        this.notices.get(playerId)?.hide();
        this.notices.delete(playerId);
      },
      onPlayersChanged: (players) => onlineSessionStore.setState({ players }),
    });
    host.onError((error) => onlineSessionStore.setState({ error: error.message }));
    session.start();
    this.current = session;
    onlineSessionStore.setState({
      status: 'hosting', peerId: host.id, joinUrl: buildJoinUrl(online.playerPageUrl, host.id, online), error: null,
    });
  }

  stop(): void {
    this.current?.stop();
    this.current = null;
    this.notices.forEach((notice) => notice.hide());
    this.notices.clear();
    resetOnlineSessionStore();
  }

  allow(playerId: string): void { this.current?.allow(playerId); }
  deny(playerId: string): void { this.current?.deny(playerId); }
  kick(playerId: string): void { this.current?.kick(playerId); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/online/onlineSessionService.test.ts`
Expected: PASS (4 tests). `Notice` comes from `tests/mocks/obsidian.ts`; the tests inject `showRequest`, so the real notice is not constructed.

- [ ] **Step 5: Write the modal, styles, status bar and commands**

```ts
// src/app/online/ui/OnlineSessionModal.ts
import { App, Modal, Notice, setIcon } from 'obsidian';
import { ATLAS_NATIVE_MODAL_CLASSES } from '../../ui/nativeModal';
import { OnlineSessionService } from '../OnlineSessionService';
import { onlineSessionStore, type OnlineSessionState } from '../onlineSessionStore';

const STATUS_TEXT: Record<OnlineSessionState['status'], string> = {
  idle: 'Not hosting. Start a session to get a link your players can open in a browser.',
  starting: 'Starting…',
  hosting: 'Hosting. Share the link; you approve each player who joins.',
  error: 'Could not start the session.',
};

/** Start or stop the online session, share its link, and manage players. */
export class OnlineSessionModal extends Modal {
  private unsubscribe: (() => void) | null = null;

  constructor(app: App, private readonly service: OnlineSessionService) {
    super(app);
    this.modalEl.addClasses([...ATLAS_NATIVE_MODAL_CLASSES, 'atlas-online-modal']);
  }

  onOpen(): void {
    this.titleEl.setText('Online session');
    this.render(onlineSessionStore.getState());
    this.unsubscribe = onlineSessionStore.subscribe((state) => this.render(state));
  }

  onClose(): void {
    this.unsubscribe?.();
    this.contentEl.empty();
  }

  private render(state: OnlineSessionState): void {
    const el = this.contentEl;
    el.empty();
    el.createEl('p', { cls: 'atlas-online-modal__status', text: STATUS_TEXT[state.status] });
    if (state.error) el.createEl('p', { cls: 'atlas-online-modal__error', text: state.error });

    if (state.status === 'hosting' && state.joinUrl) {
      const row = el.createDiv({ cls: 'atlas-online-modal__link' });
      row.createEl('input', { type: 'text', attr: { readonly: 'true', value: state.joinUrl, 'aria-label': 'Join link' } });
      const copy = row.createEl('button', { text: 'Copy link' });
      const url = state.joinUrl;
      copy.addEventListener('click', () => { void navigator.clipboard.writeText(url).then(() => new Notice('Join link copied')); });
    }

    const players = state.players;
    if (players.length) {
      const list = el.createEl('ul', { cls: 'atlas-online-modal__players' });
      for (const player of players) {
        const item = list.createEl('li', { cls: `atlas-online-modal__player atlas-online-modal__player--${player.status}` });
        const dot = item.createSpan({ cls: 'atlas-online-modal__dot' });
        setIcon(dot, player.status === 'pending' ? 'hourglass' : 'circle');
        item.createSpan({ cls: 'atlas-online-modal__name' }).setText(player.name);
        item.createSpan({ cls: 'atlas-online-modal__state', text: player.status === 'pending' ? 'wants to join' : player.status === 'gone' ? 'disconnected' : 'connected' });
        if (player.status === 'pending') {
          item.createEl('button', { cls: 'mod-cta', text: 'Allow' }).addEventListener('click', () => this.service.allow(player.playerId));
          item.createEl('button', { text: 'Deny' }).addEventListener('click', () => this.service.deny(player.playerId));
        } else {
          item.createEl('button', { text: 'Remove' }).addEventListener('click', () => this.service.kick(player.playerId));
        }
      }
    }

    const footer = el.createDiv({ cls: 'atlas-online-modal__footer' });
    if (state.status === 'hosting') {
      footer.createEl('button', { cls: 'mod-warning', text: 'Stop session' }).addEventListener('click', () => this.service.stop());
    } else {
      const start = footer.createEl('button', { cls: 'mod-cta', text: state.status === 'error' ? 'Try again' : 'Start session' });
      start.disabled = state.status === 'starting';
      start.addEventListener('click', () => void this.service.start());
    }
  }
}

export function openOnlineSessionModal(app: App): void {
  const service = OnlineSessionService.forApp(app);
  if (service) new OnlineSessionModal(app, service).open();
}
```

```scss
// src/app/online/ui/online-session.scss
@use '../../../../styles/tokens' as *;
@use '../../../../styles/mixins' as *;

.atlas-online-modal__status { @include atlas-help-text; margin: 0 0 $spacing-m; }
.atlas-online-modal__error { margin: 0 0 $spacing-m; color: var(--text-error); font-size: $font-ui-small; }

.atlas-online-modal__link {
  @include atlas-flex-row($gap: $spacing-s);
  margin-bottom: $spacing-m;
  input { @include atlas-text-input; flex: 1; font-family: var(--font-monospace); font-size: $font-ui-smaller; }
}

.atlas-online-modal__players {
  @include atlas-flex-col($gap: $spacing-xs);
  list-style: none;
  margin: 0 0 $spacing-m;
  padding: 0;
}

.atlas-online-modal__player {
  @include atlas-flex-row($gap: $spacing-s);
  padding: $spacing-xs $spacing-s;
  border-radius: $radius-m;
  background: var(--background-secondary);
}

.atlas-online-modal__dot { display: flex; color: var(--text-faint); svg { width: $icon-xs; height: $icon-xs; } }
.atlas-online-modal__player--admitted .atlas-online-modal__dot { color: var(--color-green); }
.atlas-online-modal__name { @include atlas-truncate; flex: 1; font-weight: $font-weight-medium; }
.atlas-online-modal__state { font-size: $font-ui-smaller; color: var(--text-muted); }
.atlas-online-modal__footer { display: flex; justify-content: flex-end; }

// The join request notice lives in Obsidian's notice container, outside any Atlas view.
.atlas-online-request { @include atlas-flex-col($gap: $spacing-s); }
.atlas-online-request__actions { @include atlas-flex-row($gap: $spacing-s); }
```

Note: `styles/main.scss` nests imports inside `.atlas-vtt-plugin`. The modal carries that class through `ATLAS_NATIVE_MODAL_CLASSES`, but notices do not. So import this file at the top level of `styles/main.scss` (outside the `.atlas-vtt-plugin { … }` block), after the tokens and mixins `@use` lines:

```scss
@import '../src/app/online/ui/online-session.scss';
```

```ts
// src/app/online/registerOnline.ts
import type { Plugin } from 'obsidian';
import { onlineSessionStore } from './onlineSessionStore';
import type { OnlineSessionService } from './OnlineSessionService';
import { openOnlineSessionModal } from './ui/OnlineSessionModal';

/** Commands, the status bar item, and stopping the session with the plugin. */
export function registerOnline(plugin: Plugin, service: OnlineSessionService): void {
  plugin.addCommand({ id: 'online-session', name: 'Online session…', callback: () => openOnlineSessionModal(plugin.app) });
  plugin.addCommand({
    id: 'stop-online-session',
    name: 'Stop online session',
    checkCallback: (checking) => {
      if (onlineSessionStore.getState().status !== 'hosting') return false;
      if (!checking) service.stop();
      return true;
    },
  });

  const item = plugin.addStatusBarItem();
  item.addClass('mod-clickable');
  item.addEventListener('click', () => openOnlineSessionModal(plugin.app));
  const render = (): void => {
    const state = onlineSessionStore.getState();
    const connected = state.players.filter((player) => player.status === 'admitted').length;
    const waiting = state.players.filter((player) => player.status === 'pending').length;
    item.toggle(state.status === 'hosting');
    item.setText(`Online · ${connected} ${connected === 1 ? 'player' : 'players'}${waiting ? ` · ${waiting} waiting` : ''}`);
  };
  render();
  plugin.register(onlineSessionStore.subscribe(render));
  plugin.register(() => service.stop());
}
```

In `main.ts`, after `await this.settingsService.initialize();`:

```ts
    const onlineSessions = new OnlineSessionService(this.app, this.settingsService);
    registerOnline(this, onlineSessions);
```

and add `onlineSettingsSection(this.settingsService),` to the settings sections list after `hotkeySettingsSection(...)`, with the imports:

```ts
import { OnlineSessionService } from './src/app/online/OnlineSessionService';
import { registerOnline } from './src/app/online/registerOnline';
import { onlineSettingsSection } from './src/app/settings/onlineSettingsSection';
```

In `src/app/react/components/ViewActionsMenu.tsx`, add to `entries` after "Move to new window":

```ts
      { type: 'item', label: 'Online session…', icon: 'radio-tower', onClick: () => openOnlineSessionModal(app) },
```

with `import { openOnlineSessionModal } from '../../online/ui/OnlineSessionModal';`.

- [ ] **Step 6: Build and check**

Run: `npx tsc --noEmit && npm run lint && npx vitest run tests/unit/online && npm run build`
Expected: no type or lint errors, all online tests pass, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/app/online main.ts styles/main.scss src/app/react/components/ViewActionsMenu.tsx tests/unit/online/onlineSessionService.test.ts
git commit -m "feat(online): host sessions from Atlas with join requests, a session modal and status"
```

---

### Task 8: Join page

**Files:**
- Create: `online-client/index.html`, `online-client/main.mts`, `online-client/style.css`, `vite.online.config.mts`, `.github/workflows/online-client.yml`
- Modify: `package.json` (script `build:online`), `tsconfig.json` (include `online-client/**/*.mts`), `eslint.config.mjs` (ignore `online-client/`), `.gitignore` (`dist-online/`)

**Interfaces:**
- Consumes: Task 4 `PlayerSession`, Task 5 `createPeerClient`, Task 6 `parseJoinFragment`, Task 1 `randomId`, `normalizePlayerName`.
- Produces: a static site in `dist-online/`.

- [ ] **Step 1: Write the page**

```html
<!-- online-client/index.html -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Atlas VTT · Join</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <main class="card">
    <h1>Join the table</h1>
    <form id="join" hidden>
      <label for="name">Your name</label>
      <input id="name" maxlength="40" autocomplete="nickname" required>
      <button type="submit">Join</button>
    </form>
    <p id="status" role="status"></p>
    <ul id="players" hidden></ul>
  </main>
  <footer>
    Atlas VTT online play · <a href="https://github.com/evolJoaoBento/atlas-vtt" target="_blank" rel="noopener">Source code (AGPL-3.0)</a>
  </footer>
  <script type="module" src="./main.mts"></script>
</body>
</html>
```

```ts
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
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = normalizePlayerName(nameInput.value);
    if (!name) {
      status.textContent = 'Enter a name of up to 40 characters.';
      return;
    }
    try { localStorage.setItem('atlas-online:name', name); } catch { /* private window */ }
    form.hidden = true;
    new PlayerSession({
      hostId: target.hostId,
      name,
      playerKey: stored('atlas-online:player-key', () => randomId()),
      clientVersion: VERSION,
      transport: createPeerClient(target.server),
      onChange: render,
    }).start();
  });
}
```

```css
/* online-client/style.css */
:root { color-scheme: light dark; --bg: #f6f6f7; --card: #fff; --text: #1f2328; --muted: #5a6068; --accent: #7c5cff; --border: #d8dbe0; }
@media (prefers-color-scheme: dark) { :root { --bg: #161719; --card: #202124; --text: #e8e8ea; --muted: #a0a4ab; --border: #33363b; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; gap: 16px; padding: 16px; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, sans-serif; }
.card { width: min(420px, 100%); padding: 24px; background: var(--card); border: 1px solid var(--border); border-radius: 16px; display: grid; gap: 12px; }
h1 { margin: 0; font-size: 20px; }
form { display: grid; gap: 8px; }
input { padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: inherit; font: inherit; }
button { padding: 10px 12px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
#status { margin: 0; color: var(--muted); }
#players { margin: 0; padding-left: 20px; }
footer { color: var(--muted); font-size: 13px; }
footer a { color: inherit; }
```

```ts
// vite.online.config.mts
import { defineConfig } from 'vite';

/** The web page players open to join an online session. */
export default defineConfig({
  root: 'online-client',
  base: './',
  build: { outDir: '../dist-online', emptyOutDir: true },
});
```

```yaml
# .github/workflows/online-client.yml
name: Publish the online player page
on:
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: '${{ steps.deployment.outputs.page_url }}' }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm run build:online
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist-online }
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Wire the build**

- `package.json` scripts: `"build:online": "vite build -c vite.online.config.mts"`
- `tsconfig.json` `include`: add `"online-client/**/*.mts"`
- `eslint.config.mjs` `globalIgnores`: add `"online-client/"` (web page, not plugin code; typed by `tsc`)
- `.gitignore`: add `dist-online/`

- [ ] **Step 3: Build and check**

Run: `npx tsc --noEmit && npm run build:online`
Expected: `dist-online/index.html` and one JS bundle; no type errors.

- [ ] **Step 4: Manual check (in-process)**

Run: `npx vite -c vite.online.config.mts` and open `http://localhost:5173/#id=`.
Expected: "This link is incomplete. Ask your GM for the join link again." With `#id=abc` it shows the name form; submitting shows "Connecting…" and, with nothing listening, the "Couldn't connect" message within 15 s.

- [ ] **Step 5: Commit**

```bash
git add online-client vite.online.config.mts .github/workflows/online-client.yml package.json tsconfig.json eslint.config.mjs .gitignore
git commit -m "feat(online): web join page for players"
```

---

### Task 9: Disclosure, notices and the end-to-end check

**Files:**
- Modify: `README.md`, `PRIVACY.md`, `scripts/preflight.js` (host allowlist), `THIRD_PARTY_NOTICES.md` (peerjs and its bundled dependencies), `changelog/Unreleased.md`

- [ ] **Step 1: README "Online play" section**

Add after the player view section of `README.md`:

```markdown
## Online play (preview)

Host a session from Atlas and your players join from a browser: run **Online session…**, share the link, and approve each player who joins. Nothing is sent before you start a session, and nothing but who is connected is sent yet; showing scenes to online players is coming.

- Connections are direct between your Atlas and each player (WebRTC), encrypted end to end.
- To find each other, Atlas and the player page use the free PeerJS signaling server (`0.peerjs.com`) and a public STUN server (`stun.l.google.com`). They see your and your players' IP addresses, never game data. You can use your own peerjs-server instead in **Settings → Online play**.
- Players on strict networks may need a relay (TURN) server, which you can add in the same settings.
- The player page is published from this repository's `online-client/` folder.
```

- [ ] **Step 2: PRIVACY.md**

Replace the offline sentence ("Atlas VTT works offline") with:

```markdown
Atlas VTT works offline. The only exception is online play, which you start yourself: while an online session runs, Atlas connects to a signaling server (the PeerJS cloud at `0.peerjs.com` unless you set your own), a STUN server (`stun.l.google.com`), any relay servers you add, and directly to the players you let in. The signaling and STUN servers see IP addresses and connection ids but no game data; data between you and your players is encrypted end to end. Stopping the session, or closing Obsidian, ends all of it.
```

- [ ] **Step 3: Preflight allowlist**

In `scripts/preflight.js`, add `peerjs\.com|stun\.l\.google\.com` to the `hosts` filter regex (they are disclosed in the README now).

- [ ] **Step 4: Third-party notices and changelog**

- Add a `### peerjs@1.5.5` entry (MIT, licence text from `node_modules/peerjs/LICENSE`) to `THIRD_PARTY_NOTICES.md` in alphabetical order, and entries for any new packages `npm ls --prod --all peerjs` shows under it that are not listed yet (for example `eventemitter3`, `peerjs-js-binarypack`, `webrtc-adapter`, `sdp`).
- `changelog/Unreleased.md`, under **New**:

```markdown
**Online Play (preview)**
- Host an online session: run **Online session…**, share the link, and approve each player who joins from their browser. You see who is connected, and can remove anyone.
```

- [ ] **Step 5: Full checks**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build && npm run changelog:generate && npm run preflight`
Expected: all pass. `npm test` may show the two known `worktreeTargets` failures (they fail on this machine without these changes). Preflight lists `WebSocket` among its scorecard warnings; that is expected (PeerJS signaling) and is disclosed.

- [ ] **Step 6: End-to-end manual check with real PeerJS**

1. Reload Atlas in Obsidian, run **Online session…**, press **Start session**. Expected: a join link, and the status bar shows "Online · 0 players".
2. Run `npx vite -c vite.online.config.mts --host` and open `http://<this machine's LAN IP>:5173/<fragment from the link>` in a browser, enter a name, press Join. Expected: a notice in Obsidian, "Name wants to join"; the page says "Waiting for the GM".
3. Allow. Expected: the page says "Connected to <vault>" and lists the player; the status bar shows "Online · 1 player".
4. Open the same link in a second browser (or a phone on mobile data). Expected: it joins after approval, both pages list both players. If the phone cannot connect, the page shows the relay hint.
5. Close one browser tab, reopen it and join again. Expected: no approval prompt.
6. Remove a player from the modal. Expected: their page says they were removed.
7. Stop session. Expected: every page says "The session ended".

- [ ] **Step 7: Commit**

```bash
git add README.md PRIVACY.md scripts/preflight.js THIRD_PARTY_NOTICES.md changelog/Unreleased.md src/app/changelog/releases.json
git commit -m "docs(online): disclose online play and its servers"
```
