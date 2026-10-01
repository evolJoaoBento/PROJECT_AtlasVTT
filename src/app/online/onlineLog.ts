/**
 * Diagnostics for online play, behind Settings → Online play → Log online play events
 * (on the join page: `localStorage['atlas-online:log'] = 'on'`). Writes with
 * `console.debug`, which the developer console shows under "Verbose". The switch is
 * read on every event, so it works mid-session. Shared with the web page: no Obsidian imports.
 */
import type { PresentedSceneInfo } from '../services/PresentedScene';
import type { ControlMessage } from './protocol';
import type { PresentedSceneSource, SceneSession } from './scene/sceneSources';

export type LogDetails = Record<string, string | number | boolean | null>;
export type LogWriter = (...parts: unknown[]) => void;

export interface OnlineLog {
  isEnabled(): boolean;
  event(name: string, details?: LogDetails): void;
}

export function createOnlineLog(isEnabled: () => boolean, write: LogWriter = (...parts) => console.debug(...parts)): OnlineLog {
  return {
    isEnabled,
    event: (name, details = {}) => {
      if (isEnabled()) write('[Atlas online]', name, details);
    },
  };
}

/** Where the current call came from: a few frames of the stack, for events whose cause is the question. */
export function callerStack(): string {
  return (new Error().stack ?? '').split('\n').slice(2, 10).map((line) => line.trim()).join(' | ');
}

/** What a sent message is about, without its scene data. */
function sendDetails(playerId: string, message: ControlMessage): LogDetails {
  const details: LogDetails = { playerId };
  if ('seq' in message) details.seq = message.seq;
  switch (message.type) {
    case 'scene-snapshot':
      return {
        ...details, sceneId: message.scene.sceneId, tokens: Object.keys(message.scene.tokens).length,
        fogParts: message.fogParts, drawingParts: message.drawingParts,
      };
    case 'scene-camera':
      return {
        ...details, sceneId: message.sceneId, centerX: message.centerX, centerY: message.centerY, width: message.width, height: message.height,
      };
    case 'scene-clear':
      return { ...details, stack: callerStack() };
    default:
      return details;
  }
}

/** The session the broadcaster and the camera sender send through, logging every message. */
export function loggedSession(session: SceneSession, log: OnlineLog): SceneSession {
  return {
    use: (handler) => session.use(handler),
    getPlayers: () => session.getPlayers(),
    send: (playerId, message) => {
      if (log.isEnabled()) log.event(`send ${message.type}`, sendDetails(playerId, message));
      session.send(playerId, message);
    },
  };
}

/**
 * Logs every presented-scene event with the caller's stack and a number per presentation
 * (a new number for the same tab means `present` ran again), and, while a scene is
 * presented, its view's tab changes and map loading.
 */
export function logPresentedScene(presented: PresentedSceneSource, log: OnlineLog): () => void {
  const ids = new WeakMap<PresentedSceneInfo, number>();
  let nextId = 0;
  const idOf = (scene: PresentedSceneInfo): number => {
    let id = ids.get(scene);
    if (id === undefined) {
      id = ++nextId;
      ids.set(scene, id);
    }
    return id;
  };
  const describe = (scene: PresentedSceneInfo): LogDetails => ({
    presentation: idOf(scene), tab: scene.tabId, activeTab: scene.view.tabMetaStore.getState().activeTabId,
    loading: scene.store.getState().isMapLoading, held: presented.isHeld(),
  });
  const when = (write: () => void): void => {
    if (log.isEnabled()) write();
  };

  let watched: PresentedSceneInfo | null = null;
  let stopWatching: (() => void) | null = null;
  const watch = (scene: PresentedSceneInfo | null): void => {
    if (scene === watched) return;
    stopWatching?.();
    stopWatching = null;
    watched = scene;
    if (!scene) return;
    const stopTabs = scene.view.tabMetaStore.subscribe((state) => when(() => log.event('tabs changed', {
      presentation: idOf(scene), presentedTab: scene.tabId, activeTab: state.activeTabId,
      presentedTabExists: state.tabs.some((tab) => tab.id === scene.tabId), tabs: state.tabs.length,
    })));
    let loading = scene.store.getState().isMapLoading;
    const stopStore = scene.store.subscribe((state) => {
      if (state.isMapLoading === loading) return;
      loading = state.isMapLoading;
      when(() => log.event('map loading', { presentation: idOf(scene), loading }));
    });
    stopWatching = () => {
      stopTabs();
      stopStore();
    };
  };

  const stop = presented.subscribe({
    presented: (scene, resumed) => {
      when(() => log.event('presented', { ...describe(scene), resumed, stack: callerStack() }));
      watch(scene);
    },
    held: (scene) => {
      when(() => log.event('held', { ...describe(scene), stack: callerStack() }));
      watch(scene);
    },
    cleared: (previous) => {
      when(() => log.event('cleared', { presentation: idOf(previous), tab: previous.tabId, stack: callerStack() }));
      watch(null);
    },
    viewClosed: () => when(() => log.event('view closed')),
  });
  watch(presented.current());
  return () => {
    stop();
    watch(null);
  };
}
