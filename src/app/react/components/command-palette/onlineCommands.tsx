import React from 'react';
import { Cast, Network, Power, Square } from 'lucide-react';
import { useStore } from 'zustand';
import { OnlineSessionService } from '../../../online/OnlineSessionService';
import {
  ONLINE_SECTION_TITLE, ONLINE_SESSION_LABEL, PRESENT_LABEL, STOP_PRESENTING_LABEL, STOP_SESSION_LABEL,
} from '../../../online/ui/onlineCopy';
import { presentViewToPlayers, stopPresenting } from '../../../services/presentToPlayers';
import { usePresentedTabId } from '../../hooks/usePresentedTabId';
import { useSceneTabStore } from '../../hooks/useSceneTabStore';
import { useAtlasUI } from '../../root/AtlasUIContext';
import { useAtlasStore } from '../../ViewStoreContext';
import { useOnlineSession, usePresenting } from '../online/useOnlineState';
import type { CommandOption } from './types';

/** The palette's last section; its options come last in the list too, so keyboard focus follows the drawn order. */
export const ONLINE_SECTION = { id: 'online', title: ONLINE_SECTION_TITLE } as const;

/** The online play commands that apply now. */
export function useOnlineCommands(onClose: () => void): CommandOption[] {
  const { app, view } = useAtlasUI();
  const setOnlinePanelOpen = useAtlasStore((state) => state.setOnlinePanelOpen);
  const hosting = useOnlineSession().status === 'hosting';
  const tabStore = useSceneTabStore();
  const activeTabId = useStore(tabStore, (state) => state.activeTabId);
  const presentedHere = usePresentedTabId(tabStore);
  // Not the summary: it follows the presented tokens, and the palette is always mounted.
  const presenting = usePresenting();

  const command = (id: string, icon: React.ReactNode, label: string, keywords: string[], run: () => void): CommandOption => ({
    id, icon, label, keywords, section: ONLINE_SECTION.id,
    action: () => {
      run();
      onClose();
    },
  });

  return [
    command('online-session', <Network />, ONLINE_SESSION_LABEL, ['online', 'players', 'join', 'link', 'host'], () => setOnlinePanelOpen(true)),
    ...(activeTabId && presentedHere !== activeTabId
      ? [command('present-to-players', <Cast />, PRESENT_LABEL, ['online', 'show', 'scene'], () => { void presentViewToPlayers(view); })]
      : []),
    ...(presenting ? [command('stop-presenting', <Square />, STOP_PRESENTING_LABEL, ['online', 'hide', 'scene'], stopPresenting)] : []),
    ...(hosting
      ? [command('stop-online-session', <Power />, STOP_SESSION_LABEL, ['online', 'end', 'host'], () => OnlineSessionService.forApp(app)?.stop())]
      : []),
  ];
}
