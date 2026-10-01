import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AtlasUIContext } from '../../src/app/react/root/AtlasUIContext';
import { SceneTabBar } from '../../src/app/react/components/SceneTabBar';
import { onlineSessionStore, resetOnlineSessionStore } from '../../src/app/online/onlineSessionStore';
import { createTabMetaStore } from '../../src/app/stores/tabMetaStore';

class StubResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetOnlineSessionStore();
});

function renderBar(onPresentTabMenu: (tabId: string, position: { x: number; y: number }) => boolean): { tavern: string; onPresentTab: ReturnType<typeof vi.fn> } {
  const tabMetaStore = createTabMetaStore();
  const tavern = tabMetaStore.getState().addTab('Tavern.atlasmap', 'Tavern');
  tabMetaStore.getState().setActiveTab(tavern);
  const onPresentTab = vi.fn();
  const value = { app: {}, view: { viewId: 'map', tabMetaStore }, pixiApp: null, renderer: null } as never;
  render(<AtlasUIContext.Provider value={value}>
    <SceneTabBar onSwitchTab={vi.fn()} onCloseTab={vi.fn()} onAddTab={vi.fn()} onPresentTab={onPresentTab} onPresentTabMenu={onPresentTabMenu} onShowAllTabs={vi.fn()} />
  </AtlasUIContext.Provider>);
  return { tavern, onPresentTab };
}

it('names the scene in "Present {scene} to players" while hosting, with its own context menu', () => {
  onlineSessionStore.setState({ status: 'hosting' });
  const onPresentTabMenu = vi.fn(() => true);
  const { tavern, onPresentTab } = renderBar(onPresentTabMenu);
  const eye = screen.getByRole('button', { name: 'Present Tavern to players' });
  fireEvent.click(eye);
  expect(onPresentTab).toHaveBeenCalledWith(tavern);
  expect(fireEvent.contextMenu(eye, { clientX: 10, clientY: 20 })).toBe(false);
  expect(onPresentTabMenu).toHaveBeenCalledWith(tavern, { x: 10, y: 20 });
});

it('keeps the player view label and leaves right-click alone without a session', () => {
  const onPresentTabMenu = vi.fn(() => false);
  renderBar(onPresentTabMenu);
  const eye = screen.getByRole('button', { name: 'Show Tavern on the player view' });
  expect(fireEvent.contextMenu(eye, { clientX: 10, clientY: 20 })).toBe(true);
});
