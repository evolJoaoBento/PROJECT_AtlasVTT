import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { OnlineSessionService } from '../../../src/app/online/OnlineSessionService';
import { onlineSessionStore, resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import { MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';
import { DEFAULT_ONLINE_SETTINGS } from '../../../src/app/online/onlineSettings';
import { decodeControl, encodeControl } from '../../../src/app/online/protocol';
import { PresentedScene } from '../../../src/app/services/PresentedScene';
import { createTabMetaStore } from '../../../src/app/stores/tabMetaStore';
import { createDefaultInitiativeState } from '../../../src/app/types/initiativeTypes';

const app = { vault: { getName: () => 'My Vault' } } as never;
const settings = {
  getOnlineSettings: () => DEFAULT_ONLINE_SETTINGS,
  getLocalPlayerViewSettings: () => ({
    showGrid: true, showTokenHP: false, showTokenStress: false, showTokenNameplates: false, showWidgets: true, showInitiative: true,
  }),
  onChange: () => () => {},
} as never;

afterEach(() => { resetOnlineSessionStore(); vi.useRealTimers(); });

function service(network = new MemoryNetwork(), presented = new PresentedScene()) {
  const host = network.host('gm-id');
  const notices: Array<{ name: string; answer: (allow: boolean) => void; hidden: boolean }> = [];
  const svc = new OnlineSessionService(app, settings, {
    createHost: async () => host,
    presented,
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
      status: 'hosting', peerId: 'gm-id', joinUrl: 'https://evoljoaobento.github.io/atlas-vtt/#id=gm-id', error: null,
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
    const svc = new OnlineSessionService(app, { ...(settings as object), getOnlineSettings: () => ({ ...DEFAULT_ONLINE_SETTINGS, turnServers }) } as never, {
      createHost: async () => new MemoryNetwork().host('gm-id'),
      showRequest: () => ({ hide: () => {} }),
    });
    await svc.start();
    expect(onlineSessionStore.getState()).toMatchObject({
      status: 'hosting', error: 'Your relay (TURN) settings are too long for a join link — remove some.',
    });
  });

  it('ends in error and closes the host when the player page address is invalid', async () => {
    const host = new MemoryNetwork().host('gm-id');
    const closeSpy = vi.spyOn(host, 'close');
    const svc = new OnlineSessionService(app, { getOnlineSettings: () => ({ ...DEFAULT_ONLINE_SETTINGS, playerPageUrl: 'foo' }) } as never, {
      createHost: async () => host,
      showRequest: () => ({ hide: () => {} }),
    });
    await expect(svc.start()).resolves.toBeUndefined();
    expect(onlineSessionStore.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('valid web address') });
    expect(closeSpy).toHaveBeenCalled();
    expect(svc.session).toBeNull();
  });

  it('stops the session and reports the error when the scene broadcaster cannot start', async () => {
    const network = new MemoryNetwork();
    const host = network.host('gm-id');
    const closeSpy = vi.spyOn(host, 'close');
    const presented = new PresentedScene();
    vi.spyOn(presented, 'subscribe').mockImplementation(() => { throw new Error('no scene source'); });
    const svc = new OnlineSessionService(app, settings, { createHost: async () => host, presented, showRequest: () => ({ hide: () => {} }) });
    await expect(svc.start()).resolves.toBeUndefined();
    expect(onlineSessionStore.getState()).toMatchObject({ status: 'error', error: 'no scene source' });
    expect(svc.session).toBeNull();
    expect(closeSpy).toHaveBeenCalled();
    await expect(network.client().connect('gm-id')).rejects.toBeDefined();
    host.fail({ code: 'network', message: 'late' });
    expect(onlineSessionStore.getState().error).toBe('no scene source');
  });

  it('ignores signaling errors after stop', async () => {
    const { svc, host } = service();
    await svc.start();
    svc.stop();
    host.fail({ code: 'network', message: 'late' });
    expect(onlineSessionStore.getState()).toMatchObject({ status: 'idle', error: null });
  });

  it('closes a late host when stopped while starting', async () => {
    const host = new MemoryNetwork().host('gm-id');
    const closeSpy = vi.spyOn(host, 'close');
    let resolve!: (h: typeof host) => void;
    const svc = new OnlineSessionService(app, settings, {
      createHost: () => new Promise((r) => { resolve = r; }),
      showRequest: () => ({ hide: () => {} }),
    });
    const started = svc.start();
    svc.stop();
    resolve(host);
    await started;
    expect(closeSpy).toHaveBeenCalled();
    expect(onlineSessionStore.getState().status).toBe('idle');
    expect(svc.session).toBeNull();
  });

  it('does not report a late failure after stop', async () => {
    let reject!: (e: unknown) => void;
    const svc = new OnlineSessionService(app, settings, {
      createHost: () => new Promise((_, r) => { reject = r; }),
      showRequest: () => ({ hide: () => {} }),
    });
    const started = svc.start();
    svc.stop();
    reject(null);
    await started;
    expect(onlineSessionStore.getState().status).toBe('idle');
  });

  it('sends the presented scene to joining players, even one presented before the session started', async () => {
    const presented = new PresentedScene();
    const tabs = createTabMetaStore();
    const tabId = tabs.getState().addTab('maps/tavern.atlasmap', 'Tavern');
    const store = createStore(() => ({
      background: null, grid: null, isMapLoading: false, widgetValues: {}, initiativeTrackerOpen: false,
      initiative: createDefaultInitiativeState(),
      widgetSettings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 },
      objects: {
        tokens: { t: { id: 't', kind: 'token', x: 10, y: 10, imagePath: 'a.png' } },
        fog: {}, pins: {}, texts: {}, drawings: {}, walls: {}, lights: {}, audios: {},
      },
    }));
    presented.present({ tabMetaStore: tabs, atlasStore: store, register: () => {} } as never, tabId);
    const { svc, notices, network } = service(new MemoryNetwork(), presented);
    await svc.start();
    const link = await network.client().connect('gm-id');
    const received: string[] = [];
    link.onMessage((_channel, data) => {
      const decoded = decodeControl(data);
      if (decoded.kind === 'message') received.push(decoded.message.type);
    });
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Anna', playerKey: 'k', client: { kind: 'web', version: '1' } }));
    notices[0]!.answer(true);
    expect(received).toContain('scene-snapshot');
    svc.stop();
    presented.clear();
    expect(received.filter((type) => type === 'scene-clear')).toEqual([]);
  });
});
