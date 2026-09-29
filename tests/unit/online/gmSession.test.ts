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
