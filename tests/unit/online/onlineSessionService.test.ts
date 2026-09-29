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
  const host = network.host('gm-id');
  const notices: Array<{ name: string; answer: (allow: boolean) => void; hidden: boolean }> = [];
  const svc = new OnlineSessionService(app, settings, {
    createHost: async () => host,
    showRequest: (player, answer) => {
      const notice = { name: player.name, answer, hidden: false };
      notices.push(notice);
      return { hide: () => { notice.hidden = true; } };
    },
  });
  return { svc, notices, network, host };
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

  it('keeps hosting when the signaling server hiccups, and clears the note on the next player change', async () => {
    const { svc, host, network } = service();
    await svc.start();
    host.fail({ code: 'network', message: 'Lost connection to the signaling server' });
    expect(onlineSessionStore.getState()).toMatchObject({ status: 'hosting', error: 'Lost connection to the signaling server' });
    const link = await network.client().connect('gm-id');
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Cy', playerKey: 'k', client: { kind: 'web', version: '1' } }));
    expect(onlineSessionStore.getState()).toMatchObject({ status: 'hosting', error: null });
  });

  it('keeps hosting but warns when the relay settings are too long for a link', async () => {
    const turnServers = Array.from({ length: 9 }, (_, i) => ({ urls: `turn:t${i}.example.com:3478`, username: 'u', credential: 'c' }));
    const svc = new OnlineSessionService(app, { getOnlineSettings: () => ({ ...DEFAULT_ONLINE_SETTINGS, turnServers }) } as never, {
      createHost: async () => new MemoryNetwork().host('gm-id'),
      showRequest: () => ({ hide: () => {} }),
    });
    await svc.start();
    expect(onlineSessionStore.getState()).toMatchObject({
      status: 'hosting', error: 'Your relay (TURN) settings are too long for a join link — remove some.',
    });
  });
});
