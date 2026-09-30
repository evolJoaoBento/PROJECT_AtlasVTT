// tests/unit/online/sceneBroadcaster.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession } from '../../../src/app/online/PlayerSession';
import { decodeControl, encodeControl, MAX_CONTROL_MESSAGE_BYTES, type ControlMessage } from '../../../src/app/online/protocol';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { FOG_TRUNCATED_NOTICE, SCENE_TICK_MS, SCENE_TOO_LARGE_NOTICE, SceneBroadcaster } from '../../../src/app/online/scene/SceneBroadcaster';
import { patchMessage, snapshotMessages, splitParts } from '../../../src/app/online/scene/sceneMessages';
import { MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';
import type { PeerLink } from '../../../src/app/online/transport/types';
import { PresentedScene, type PresentedView } from '../../../src/app/services/PresentedScene';
import type { ViewAtlasState } from '../../../src/app/storeFactory';
import { createTabMetaStore } from '../../../src/app/stores/tabMetaStore';
import type { Character, DrawingStroke } from '../../../src/app/types';
import type { FogOperation } from '../../../src/app/types/fogTypes';
import { createDefaultInitiativeState } from '../../../src/app/types/initiativeTypes';
import { fogRect, playerScene } from './sceneFixtures';

type SceneState = Pick<ViewAtlasState,
  'background' | 'grid' | 'objects' | 'widgetSettings' | 'widgetValues' | 'initiative' | 'initiativeTrackerOpen' | 'isMapLoading'
> & { camera: { x: number; y: number; scale: number } };

function character(id: string, x: number, overrides: Partial<Character> = {}): Character {
  return { id, kind: 'character', x, y: 140, imagePath: `art/${id}.png`, name: id, hp: { current: 7, max: 10 }, ...overrides };
}

function sceneState(tokens: Record<string, Character>, fog: Record<string, FogOperation> = {}): SceneState {
  return {
    background: 'maps/tavern.png',
    grid: { enabled: true, visible: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5 },
    objects: { tokens, fog, pins: {}, texts: {}, drawings: {}, walls: {}, lights: {}, audios: {} },
    widgetSettings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 },
    widgetValues: {},
    initiative: createDefaultInitiativeState(),
    initiativeTrackerOpen: false,
    isMapLoading: false,
    camera: { x: 0, y: 0, scale: 1 },
  };
}

/** Zigzag brush strokes that survive simplification (5 px teeth): about 57 KB each on the wire. */
function bigFog(count: number): Record<string, FogOperation> {
  const fog: Record<string, FogOperation> = {};
  for (let op = 0; op < count; op++) {
    const points = Array.from({ length: 3000 }, (_, i) => ({
      x: (i % 400) * 10,
      y: op * 400 + Math.floor(i / 400) * 40 + (i % 2) * 5,
    }));
    fog[`big${op}`] = { id: `big${op}`, kind: 'fog', type: 'brush', timestamp: 100 + op, isErasing: false, brushRadius: 30, points };
  }
  return fog;
}

/** Zigzag pen strokes that survive simplification: about 19 KB each on the wire. */
function manyDrawings(count: number): Record<string, DrawingStroke> {
  const drawings: Record<string, DrawingStroke> = {};
  for (let index = 0; index < count; index++) {
    const points = Array.from({ length: 1000 }, (_, i) => ({ x: (i % 200) * 10, y: index * 100 + Math.floor(i / 200) * 20 + (i % 2) * 5 }));
    drawings[`ink${index}`] = { id: `ink${index}`, kind: 'drawing', timestamp: index, type: 'pen', points, color: '#aa0000', width: 3, opacity: 1 };
  }
  return drawings;
}

interface FakeView {
  view: PresentedView;
  store: StoreApi<SceneState>;
  tabs: ReturnType<typeof createTabMetaStore>;
  tavern: string;
  dungeon: string;
}

function fakeView(state: SceneState): FakeView {
  const tabs = createTabMetaStore();
  const store = createStore<SceneState>(() => state);
  const tavern = tabs.getState().addTab('maps/tavern.atlasmap', 'Tavern');
  const dungeon = tabs.getState().addTab('maps/dungeon.atlasmap', 'Dungeon');
  tabs.getState().setActiveTab(tavern);
  const view = { tabMetaStore: tabs, atlasStore: store as unknown as StoreApi<ViewAtlasState>, register: () => {} } as unknown as PresentedView;
  return { view, store, tabs, tavern, dungeon };
}

function moveToken(store: StoreApi<SceneState>, id: string, x: number): void {
  store.setState((state) => ({
    objects: { ...state.objects, tokens: { ...state.objects.tokens, [id]: { ...state.objects.tokens[id]!, x } } },
  }));
}

const DEFAULT_RULES: PlayerViewRules = {
  showGrid: true, showTokenHP: false, showTokenStress: false, showTokenNameplates: false, showWidgets: true, showInitiative: true,
};

interface Harness {
  network: MemoryNetwork;
  gm: GmSession;
  requests: SessionPlayer[];
  presented: PresentedScene;
  broadcaster: SceneBroadcaster;
  notices: string[];
  setRules(next: Partial<PlayerViewRules>): void;
}

function setup(options: { start?: boolean } = {}): Harness {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const gm = new GmSession(network.host('gm'), {
    title: 'Vault', onJoinRequest: (p) => requests.push(p), onRequestClosed: () => {}, onPlayersChanged: () => {},
  });
  gm.start();
  let rules = { ...DEFAULT_RULES };
  const listeners = new Set<() => void>();
  const settings = {
    getLocalPlayerViewSettings: (): PlayerViewRules => rules,
    onChange: (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const presented = new PresentedScene();
  const notices: string[] = [];
  const broadcaster = new SceneBroadcaster({ session: gm, presented, settings, notify: (message) => notices.push(message) });
  if (options.start !== false) broadcaster.start();
  const setRules = (next: Partial<PlayerViewRules>): void => {
    rules = { ...rules, ...next };
    listeners.forEach((listener) => listener());
  };
  return { network, gm, requests, presented, broadcaster, notices, setRules };
}

/** A player through `PlayerSession`, admitted by the GM. */
async function join(h: Harness, playerKey = 'key-a'): Promise<PlayerSession> {
  const before = h.requests.length;
  const player = new PlayerSession({
    hostId: 'gm', name: 'Anna', playerKey, clientVersion: '1', transport: h.network.client(), onChange: () => {},
  });
  player.start();
  await vi.advanceTimersByTimeAsync(0);
  if (h.requests.length > before) h.gm.allow(h.requests.at(-1)!.playerId);
  return player;
}

/** A player end that records every message and its size. */
async function rawPlayer(h: Harness, playerKey: string): Promise<{ link: PeerLink; received: ControlMessage[]; sizes: number[] }> {
  const link = await h.network.client().connect('gm');
  const received: ControlMessage[] = [];
  const sizes: number[] = [];
  link.onMessage((channel, data) => {
    if (channel !== 'control' || typeof data !== 'string') return;
    sizes.push(new TextEncoder().encode(data).length);
    const decoded = decodeControl(data);
    if (decoded.kind === 'message') received.push(decoded.message);
  });
  link.send('control', encodeControl({ v: 1, type: 'join', name: 'Raw', playerKey, client: { kind: 'web', version: '1' } }));
  h.gm.allow(h.requests.at(-1)!.playerId);
  return { link, received, sizes };
}

const sceneTypes = (messages: ControlMessage[]): string[] =>
  messages.filter((message) => message.type.startsWith('scene-')).map((message) => message.type);
const tick = (): Promise<void> => vi.advanceTimersByTimeAsync(SCENE_TICK_MS);

describe('scene messages', () => {
  it('splits records into parts under the budget, in replay order', () => {
    const fog = { b: fogRect(2), a: fogRect(1), c: fogRect(3) };
    const parts = splitParts(fog, (op) => op.order, 200);
    expect(parts.map((part) => Object.keys(part))).toEqual([['a', 'b'], ['c']]);
    expect(splitParts({}, () => 0)).toEqual([]);
  });

  it('refuses snapshots and patches over the message limit', () => {
    const huge = 'x'.repeat(300 * 1024);
    const scene = playerScene({ widgets: [{ id: 'w', type: 'counter', label: huge, icon: '', value: 0 }] });
    expect(snapshotMessages(scene)).toBeNull();
    expect(snapshotMessages(playerScene())?.map((message) => message.type)).toEqual(['scene-snapshot', 'scene-fog', 'scene-drawings']);
    expect(patchMessage({ set: { widgets: scene.widgets }, upsert: {}, remove: {} })).toBeNull();
  });
});

describe('SceneBroadcaster', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends a snapshot on admission and patches after', async () => {
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const player = await join(h);
    expect(player.scene?.tokens.hero?.x).toBe(140);
    expect(player.scene).toEqual(h.broadcaster.currentProjection());

    moveToken(store, 'hero', 300);
    expect(player.scene?.tokens.hero?.x).toBe(140);
    await tick();
    expect(player.scene?.tokens.hero?.x).toBe(300);
    expect(player.scene).toEqual(h.broadcaster.currentProjection());
  });

  it('batches changes into one patch per tick and sends nothing for an empty diff', async () => {
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot']);

    moveToken(store, 'hero', 200);
    moveToken(store, 'hero', 250);
    moveToken(store, 'hero', 300);
    await tick();
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-patch']);

    store.setState({ camera: { x: 50, y: 50, scale: 2 } });
    moveToken(store, 'hero', 310);
    moveToken(store, 'hero', 300);
    await tick();
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-patch']);
    expect(raw.received.filter((message) => 'seq' in message).map((message) => (message as { seq: number }).seq)).toEqual([1, 2]);
  });

  it('sends HP to players when the GM turns it on mid-session', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const player = await join(h);
    expect(player.scene?.tokens.hero?.hp).toBeNull();
    h.setRules({ showTokenHP: true });
    await tick();
    expect(player.scene?.tokens.hero?.hp).toEqual({ current: 7, max: 10 });
  });

  it('removes a token the GM hides', async () => {
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140), orc: character('orc', 400) }));
    h.presented.present(view, tavern);
    const player = await join(h);
    store.setState((state) => ({
      objects: { ...state.objects, tokens: { ...state.objects.tokens, orc: { ...state.objects.tokens.orc!, isHidden: true } } },
    }));
    await tick();
    expect(Object.keys(player.scene?.tokens ?? {})).toEqual(['hero']);
  });

  it('clears the scene when presenting stops', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const player = await join(h);
    h.presented.clear();
    expect(player.scene).toBeNull();
  });

  it('answers a resync with a snapshot', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    raw.link.send('control', encodeControl({ v: 1, type: 'scene-resync', seq: 1 }));
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-snapshot']);
  });

  it('splits a large fog into parts under the message limit', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }, bigFog(12)));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    const snapshot = raw.received.find((message) => message.type === 'scene-snapshot');
    expect(snapshot && 'fogParts' in snapshot ? snapshot.fogParts : 0).toBeGreaterThan(1);
    expect(Math.max(...raw.sizes)).toBeLessThanOrEqual(MAX_CONTROL_MESSAGE_BYTES);
    const player = await join(h);
    expect(Object.keys(player.scene?.fog ?? {})).toHaveLength(12);
    expect(player.scene).toEqual(h.broadcaster.currentProjection());
  });

  it('sends a scene with many drawings in parts', async () => {
    const h = setup();
    const state = sceneState({ hero: character('hero', 140) });
    state.objects.drawings = manyDrawings(30);
    const { view, tavern } = fakeView(state);
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    const snapshot = raw.received.find((message) => message.type === 'scene-snapshot');
    expect(snapshot && 'drawingParts' in snapshot ? snapshot.drawingParts : 0).toBeGreaterThan(1);
    expect(sceneTypes(raw.received)).toContain('scene-drawings');
    expect(Math.max(...raw.sizes)).toBeLessThanOrEqual(MAX_CONTROL_MESSAGE_BYTES);
    const player = await join(h);
    expect(Object.keys(player.scene?.drawings ?? {})).toHaveLength(30);
    expect(player.scene).toEqual(h.broadcaster.currentProjection());
  });

  it('clears the scene and tells the GM once when it is too large to send', async () => {
    const tokens = Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`t${i}`, character(`t${i}`, i)]));
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState(tokens));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    expect(sceneTypes(raw.received)).toEqual(['scene-clear']);
    moveToken(store, 't0', 50);
    await tick();
    expect(sceneTypes(raw.received)).toEqual(['scene-clear', 'scene-clear']);
    expect(h.notices).toEqual([SCENE_TOO_LARGE_NOTICE]);
    expect(Math.max(...raw.sizes)).toBeLessThanOrEqual(MAX_CONTROL_MESSAGE_BYTES);
  });

  it('sends a snapshot instead of a patch that would exceed the limit', async () => {
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    store.setState((state) => ({ objects: { ...state.objects, fog: bigFog(12) } }));
    await tick();
    const types = sceneTypes(raw.received);
    expect(types).not.toContain('scene-patch');
    expect(types.filter((type) => type === 'scene-snapshot')).toHaveLength(2);
    expect(Math.max(...raw.sizes)).toBeLessThanOrEqual(MAX_CONTROL_MESSAGE_BYTES);
  });

  it('gives a second tab of the same player the scene', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    await join(h, 'key-a');
    const secondTab = await join(h, 'key-a');
    expect(secondTab.scene).toEqual(h.broadcaster.currentProjection());
  });

  it('keeps sending the held scene while the GM browses another tab', async () => {
    const h = setup();
    const { view, store, tabs, tavern, dungeon } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    const heldId = h.broadcaster.currentProjection()?.sceneId;

    tabs.getState().setActiveTab(dungeon);
    store.setState({ isMapLoading: true });
    store.setState(sceneState({ villain: character('villain', 600) }));
    h.setRules({ showTokenHP: true });
    await tick();
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot']);

    const late = await join(h, 'key-late');
    expect(Object.keys(late.scene?.tokens ?? {})).toEqual(['hero']);
    expect(late.scene?.tokens.hero?.hp).toBeNull();
    raw.link.send('control', encodeControl({ v: 1, type: 'scene-resync', seq: 1 }));
    const resent = raw.received.at(-1);
    expect(resent?.type === 'scene-snapshot' ? Object.keys(resent.scene.tokens) : []).toEqual(['hero']);
    expect(resent?.type === 'scene-snapshot' ? resent.scene.sceneId : null).toBe(heldId);

    store.setState({ isMapLoading: true });
    tabs.getState().setActiveTab(tavern);
    store.setState({ ...sceneState({ hero: character('hero', 140) }), isMapLoading: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(late.scene?.sceneId).toBe(heldId);
    expect(late.scene?.tokens.hero?.hp).toEqual({ current: 7, max: 10 });
  });

  it('sends a scene presented before the session started', async () => {
    const h = setup({ start: false });
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    h.broadcaster.start();
    const player = await join(h);
    expect(player.scene?.tokens.hero).toBeDefined();
  });

  it('answers admission with a clear when nothing is presented', async () => {
    const h = setup();
    const raw = await rawPlayer(h, 'raw');
    expect(sceneTypes(raw.received)).toEqual(['scene-clear']);
    raw.link.send('control', encodeControl({ v: 1, type: 'scene-resync', seq: 1 }));
    expect(sceneTypes(raw.received)).toEqual(['scene-clear', 'scene-clear']);
  });

  it('clears a stale scene on a player who reconnects after presenting stopped', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const player = await join(h);
    expect(player.scene).not.toBeNull();
    const gmLinks = (h.gm as unknown as { links: Map<unknown, unknown> }).links;
    ([...gmLinks.keys()][0] as { close(): void }).close();
    h.presented.clear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(player.state.status).toBe('admitted');
    expect(player.scene).toBeNull();
  });

  it('replaces the scene with a new sceneId when the GM presents another', async () => {
    const h = setup();
    const first = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(first.view, first.tavern);
    const player = await join(h);
    const firstId = player.scene?.sceneId;
    const second = fakeView(sceneState({ dragon: character('dragon', 500) }));
    h.presented.present(second.view, second.tavern);
    expect(player.scene?.sceneId).not.toBe(firstId);
    expect(Object.keys(player.scene?.tokens ?? {})).toEqual(['dragon']);
  });

  it('sends nothing while the map loads, then a snapshot', async () => {
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    store.setState({ isMapLoading: true });
    moveToken(store, 'hero', 500);
    await tick();
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot']);
    store.setState({ isMapLoading: false });
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-snapshot']);
  });

  it('ignores scene data sent by players', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    const other = await join(h, 'key-other');
    const before = other.scene;
    raw.link.send('control', encodeControl({ v: 1, type: 'scene-clear', seq: 5 }));
    raw.link.send('control', encodeControl({ v: 1, type: 'scene-patch', seq: 6, set: { grid: null }, upsert: {}, remove: { tokens: ['hero'] } }));
    await tick();
    expect(other.scene).toEqual(before);
    expect(h.broadcaster.currentProjection()?.tokens.hero).toBeDefined();
  });

  it('stops listening when stopped', async () => {
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    h.broadcaster.stop();
    moveToken(store, 'hero', 500);
    h.presented.clear();
    await tick();
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot']);
  });

  it('coverage follows the fog players receive, and the GM is told once when fog is dropped', async () => {
    const h = setup();
    const longId = 'x'.repeat(200);
    const fog: Record<string, FogOperation> = { ...bigFog(1), [longId]: { ...bigFog(1).big0!, id: longId } };
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140) }, fog));
    h.presented.present(view, tavern);
    await rawPlayer(h, 'raw');
    expect(h.notices).toEqual([FOG_TRUNCATED_NOTICE]);
    store.setState((state) => ({ objects: { ...state.objects, fog: { ...fog } } }));
    await tick();
    expect(h.notices).toEqual([FOG_TRUNCATED_NOTICE]);
  });

  it('does not tell the GM about fog when every operation is sent', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }, bigFog(2)));
    h.presented.present(view, tavern);
    await rawPlayer(h, 'raw');
    expect(h.notices).toEqual([]);
  });

  it('answers a resync with a clear after presenting stopped', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    h.presented.clear();
    raw.link.send('control', encodeControl({ v: 1, type: 'scene-resync', seq: 1 }));
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-clear', 'scene-clear']);
  });
});
