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
    await vi.advanceTimersByTimeAsync(RECONNECT_GIVE_UP_MS - 1000);
    expect(player.state.status).toBe('connecting');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(player.state).toMatchObject({ status: 'lost', reason: 'unreachable' });
  });
});
