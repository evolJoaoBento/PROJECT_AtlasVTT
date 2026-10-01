import React from 'react';
import { useStore } from 'zustand';
import { Button } from '../../../packages/components/primitives/button';
import { PRESENT_LABEL, STOP_PRESENTING_LABEL } from '../../../online/ui/onlineCopy';
import { presentViewToPlayers, stopPresenting } from '../../../services/presentToPlayers';
import { usePresentedTabId } from '../../hooks/usePresentedTabId';
import { useSceneTabStore } from '../../hooks/useSceneTabStore';
import { useAtlasUI } from '../../root/AtlasUIContext';
import { usePresentedSceneSummary } from './useOnlineState';

/** What players see, presenting this view's scene, and stopping. */
export function OnlinePresenting(): React.ReactElement {
  const { view } = useAtlasUI();
  const tabStore = useSceneTabStore();
  const activeTabId = useStore(tabStore, (state) => state.activeTabId);
  const presentedHere = usePresentedTabId(tabStore);
  const { tabId, name } = usePresentedSceneSummary();

  return (
    <section className="atlas-online-panel__section" aria-label="Presented scene">
      <p className="atlas-online-panel__help">{tabId ? `Players see ${name ?? 'a scene'}.` : 'Players see no scene.'}</p>
      <div className="atlas-online-panel__actions">
        {activeTabId && presentedHere !== activeTabId && (
          <Button variant="outline" size="sm" onClick={() => { void presentViewToPlayers(view); }}>{PRESENT_LABEL}</Button>
        )}
        {tabId && <Button variant="outline" size="sm" onClick={stopPresenting}>{STOP_PRESENTING_LABEL}</Button>}
      </div>
    </section>
  );
}
