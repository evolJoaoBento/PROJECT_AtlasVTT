import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openOnlineSessionModal } = vi.hoisted(() => ({ openOnlineSessionModal: vi.fn() }));

vi.mock('../../../src/app/atlas-view', () => ({ ATLAS_VIEW_TYPE: 'atlas-vtt', AtlasView: class AtlasView {} }));
vi.mock('../../../src/app/online/ui/OnlineSessionModal', () => ({ openOnlineSessionModal }));

import { AtlasView } from '../../../src/app/atlas-view';
import { openOnlineSession } from '../../../src/app/online/ui/openOnlineSession';

function atlasView(isPlayerView = false): { view: AtlasView; setOnlinePanelOpen: ReturnType<typeof vi.fn> } {
  const setOnlinePanelOpen = vi.fn();
  const view = Object.assign(Object.create(AtlasView.prototype) as AtlasView, {
    leaf: {},
    atlasStore: { getState: () => ({ isPlayerView, setOnlinePanelOpen }) },
  });
  return { view, setOnlinePanelOpen };
}

function appWith(active: AtlasView | null, open: AtlasView[]): { app: never; revealLeaf: ReturnType<typeof vi.fn> } {
  const revealLeaf = vi.fn(() => Promise.resolve());
  const app = {
    workspace: {
      getActiveViewOfType: () => active,
      getLeavesOfType: () => open.map((view) => ({ view })),
      revealLeaf,
    },
  };
  return { app: app as never, revealLeaf };
}

describe('Online session… command', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // Review Focus
  it('opens the panel only in the active view, else the first open one, else the modal', () => {
    const first = atlasView();
    const second = atlasView();
    const active = appWith(second.view, [first.view, second.view]);
    openOnlineSession(active.app);
    expect(second.setOnlinePanelOpen).toHaveBeenCalledWith(true);
    expect(first.setOnlinePanelOpen).not.toHaveBeenCalled();
    expect(active.revealLeaf).not.toHaveBeenCalled();

    const inactive = appWith(null, [first.view, second.view]);
    openOnlineSession(inactive.app);
    expect(first.setOnlinePanelOpen).toHaveBeenCalledWith(true);
    expect(inactive.revealLeaf).toHaveBeenCalledWith(first.view.leaf);

    openOnlineSession(appWith(null, []).app);
    expect(openOnlineSessionModal).toHaveBeenCalledOnce();
  });

  it('opens the modal for a view that does not show GM panels', () => {
    const player = atlasView(true);
    openOnlineSession(appWith(player.view, [player.view]).app);
    expect(player.setOnlinePanelOpen).not.toHaveBeenCalled();
    expect(openOnlineSessionModal).toHaveBeenCalledOnce();
  });
});
