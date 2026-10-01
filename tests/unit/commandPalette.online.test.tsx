import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { createStore } from 'zustand/vanilla';

const { ui, service, presentViewToPlayers, stopPresenting } = vi.hoisted(() => ({
  ui: { view: {} as unknown },
  service: { stop: vi.fn() },
  presentViewToPlayers: vi.fn(() => Promise.resolve()),
  stopPresenting: vi.fn(),
}));

vi.mock('../../src/app/react/root/AtlasUIContext', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/app/react/root/AtlasUIContext')>(),
  useAtlasUI: () => ({ app: {}, view: ui.view }),
}));
vi.mock('../../src/app/services/PlayerWindowService', () => ({ PlayerWindowService: {} }));
vi.mock('../../src/app/services/PlayerWindowPresenter', () => ({ presentActiveTabInPlayerWindow: vi.fn() }));
vi.mock('../../src/app/services/presentToPlayers', () => ({ presentViewToPlayers, stopPresenting }));
vi.mock('../../src/app/online/OnlineSessionService', () => ({ OnlineSessionService: { forApp: () => service } }));
vi.mock('../../src/app/react/components/command-palette/GridSettingsPanel', () => ({ GridSettingsPanel: () => null }));
vi.mock('../../src/app/react/components/command-palette/TokenSettingsPanel', () => ({ TokenSettingsPanel: () => null }));
vi.mock('../../src/app/react/components/command-palette/WidgetSettingsPanel', () => ({ WidgetSettingsPanel: () => null }));
vi.mock('../../src/app/react/components/command-palette/LocalPlayerViewSettingsPanel', () => ({ LocalPlayerViewSettingsPanel: () => null }));

import { ViewStoreProvider } from '../../src/app/react/ViewStoreContext';
import { CommandPalette } from '../../src/app/react/components/CommandPalette';
import { onlineSessionStore, resetOnlineSessionStore } from '../../src/app/online/onlineSessionStore';
import { presentedScene, type PresentedView } from '../../src/app/services/PresentedScene';
import { createTabMetaStore } from '../../src/app/stores/tabMetaStore';

function openScene(): { presented: PresentedView; tavern: string } {
  const tabMetaStore = createTabMetaStore();
  const tavern = tabMetaStore.getState().addTab('Tavern.atlasmap', 'Tavern');
  tabMetaStore.getState().setActiveTab(tavern);
  const atlasStore = createStore(() => ({ isMapLoading: false, objects: { tokens: {} } }));
  ui.view = { tabMetaStore, atlasStore };
  return { presented: { tabMetaStore, atlasStore, register: () => {} } as unknown as PresentedView, tavern };
}

function renderPalette(): { store: { getState: () => { isOnlinePanelOpen: boolean } }; onClose: ReturnType<typeof vi.fn> } {
  const store = create<{ isOnlinePanelOpen: boolean; setOnlinePanelOpen: (open: boolean) => void }>((set) => ({
    isOnlinePanelOpen: false,
    setOnlinePanelOpen: (open) => set({ isOnlinePanelOpen: open }),
  }));
  const onClose = vi.fn();
  render(<ViewStoreProvider store={store as never}><CommandPalette isOpen onClose={onClose} /></ViewStoreProvider>);
  return { store, onClose };
}

const option = (label: string): HTMLElement | null => screen.queryByRole('button', { name: new RegExp(`^${label}`) });

describe('Online play in the command palette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ui.view = {};
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  });
  afterEach(() => {
    cleanup();
    resetOnlineSessionStore();
    presentedScene.clear();
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  it('always offers the online session panel, in its own section', () => {
    const { store, onClose } = renderPalette();
    expect(screen.getByText('Online play')).toBeTruthy();
    expect(option('Present to players')).toBeNull();
    expect(option('Stop presenting')).toBeNull();
    expect(option('Stop online session')).toBeNull();
    fireEvent.click(option('Online session')!);
    expect(store.getState().isOnlinePanelOpen).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('offers Present to players for an open scene not presented, and Stop presenting while one is', () => {
    const { presented, tavern } = openScene();
    renderPalette();
    fireEvent.click(option('Present to players')!);
    expect(presentViewToPlayers).toHaveBeenCalledWith(ui.view);

    act(() => { presentedScene.present(presented, tavern); });
    expect(option('Present to players')).toBeNull();
    fireEvent.click(option('Stop presenting')!);
    expect(stopPresenting).toHaveBeenCalledOnce();
  });

  it('offers Stop online session while hosting', () => {
    onlineSessionStore.setState({ status: 'hosting' });
    renderPalette();
    fireEvent.click(option('Stop online session')!);
    expect(service.stop).toHaveBeenCalledOnce();
  });
});
