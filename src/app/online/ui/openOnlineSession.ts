/**
 * "Online session…" and the status bar item: the online panel in an Atlas view, or
 * the Obsidian modal when no Atlas view can show it.
 */
import type { App } from 'obsidian';
import { AtlasView, ATLAS_VIEW_TYPE } from '../../atlas-view';
import { openOnlineSessionModal } from './OnlineSessionModal';

/** The active Atlas view, else the first open one; null when there is none or it hides GM panels. */
function panelView(app: App): AtlasView | null {
  const open = app.workspace.getLeavesOfType(ATLAS_VIEW_TYPE)
    .map((leaf) => leaf.view)
    .find((view): view is AtlasView => view instanceof AtlasView);
  const view = app.workspace.getActiveViewOfType(AtlasView) ?? open ?? null;
  return view && !view.atlasStore.getState().isPlayerView ? view : null;
}

export function openOnlineSession(app: App): void {
  const view = panelView(app);
  if (!view) {
    openOnlineSessionModal(app);
    return;
  }
  view.atlasStore.getState().setOnlinePanelOpen(true);
  if (app.workspace.getActiveViewOfType(AtlasView) !== view) void app.workspace.revealLeaf(view.leaf);
}
