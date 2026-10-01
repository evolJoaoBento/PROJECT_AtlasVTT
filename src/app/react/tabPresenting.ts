/**
 * What a scene tab's eye button does. While an online session runs it presents the
 * tab to online players only, and its context menu opens the local player window;
 * without a session it opens the player window, as before.
 */
import type { App } from 'obsidian';
import type { AtlasView } from '../atlas-view';
import { onlineSessionStore } from '../online/onlineSessionStore';
import { OPEN_PLAYER_WINDOW_LABEL } from '../online/ui/onlineCopy';
import { presentTabInPlayerWindow } from '../services/PlayerWindowPresenter';
import { presentTabToPlayers } from '../services/presentToPlayers';
import { openContextMenuGlobal, type ContextMenuEntry } from './root/ContextMenuContext';

const hosting = (): boolean => onlineSessionStore.getState().status === 'hosting';

export function presentTab(app: App, view: AtlasView, tabId: string): void {
  if (hosting()) void presentTabToPlayers(view, tabId);
  else void presentTabInPlayerWindow(app, view, tabId);
}

/** Opens the eye's context menu while hosting and returns true; without a session it does nothing and returns false. */
export function openPresentMenu(app: App, view: AtlasView, tabId: string, position: { x: number; y: number }): boolean {
  if (!hosting()) return false;
  const entries: ContextMenuEntry[] = [
    { type: 'item', label: OPEN_PLAYER_WINDOW_LABEL, icon: 'monitor-up', onClick: () => presentTabInPlayerWindow(app, view, tabId) },
  ];
  openContextMenuGlobal(entries, position);
  return true;
}
