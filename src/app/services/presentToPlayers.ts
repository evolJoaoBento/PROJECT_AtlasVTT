import { Notice, type App } from 'obsidian';
import { AtlasView } from '../atlas-view';
import { presentedScene, whenMapLoaded } from './PresentedScene';

/**
 * Present the scene `view` shows to online players, without opening the local
 * player window. An open player window follows it (`PlayerWindowPresenter`).
 */
export async function presentViewToPlayers(view: unknown): Promise<void> {
  const tabId = view instanceof AtlasView ? view.tabMetaStore.getState().activeTabId : null;
  if (!(view instanceof AtlasView) || !tabId) {
    new Notice('Open a scene to present it to players');
    return;
  }
  await whenMapLoaded(view.atlasStore);
  if (view.isClosed || view.tabMetaStore.getState().activeTabId !== tabId) return;
  presentedScene.present(view, tabId);
  const name = view.tabMetaStore.getState().tabs.find((tab) => tab.id === tabId)?.displayName;
  new Notice(`Players see ${name ?? 'this scene'}`);
}

export function presentActiveTabToPlayers(app: App): Promise<void> {
  return presentViewToPlayers(app.workspace.getActiveViewOfType(AtlasView));
}

/** Players keep the last scene they saw in the local window; online players see none. */
export function stopPresenting(): void {
  if (!presentedScene.current()) return;
  presentedScene.clear();
  new Notice('Players no longer see a scene');
}
