# Online Play Polish A (the GM's Online Controls Inside Atlas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The GM runs online play from inside an Atlas map view. A toolbar button opens a floating online panel, the four online actions are in Atlas's command palette, and while a session runs the scene tab's eye presents to online players only.

**Architecture:**
- **No session changes.** The panel reads `onlineSessionStore` and the plugin's `presentedScene`, and it calls `OnlineSessionService` (`start`, `stop`, `allow`, `deny`, `kick`), `presentViewToPlayers` / `stopPresenting` and the session's `TokenControl`, the same assignment API the token context menu uses. `GmSession`, the protocol, the transport and the join page are not touched.
- **Per-view open state.** `isOnlinePanelOpen` / `setOnlinePanelOpen` join the per-view, non-persisted `uiSlice`. The toolbar button, the palette entry and the Obsidian command all set it.
- **Pure helpers outside React** (`src/app/online/ui/`):
  - `presentedSceneSummary.ts` gives the presented tab, its name and its character tokens, and reports no characters while the scene is held or its map loads.
  - `tokenPickerMenu.ts` builds the picker's context-menu entries and checks again at click time.
  - `openOnlineSession.ts` picks the view for the Obsidian command, or falls back to the existing modal.
  - `onlineCopy.ts` holds the copy.
- **React** (`src/app/react/components/online/`):
  - `OnlinePanel`, `OnlinePlayerList` and `OnlinePresenting` make up the panel.
  - `onlineToolbarItem` is the main-toolbar control.
  - `useOnlineState` holds the hooks.
- **Eye button.** `src/app/react/tabPresenting.ts` decides what the eye does: online players only while hosting, the player window otherwise. While hosting it also offers **Open player window** in a context menu. `presentTabToPlayers` (`services/presentToPlayers.ts`) switches to the clicked tab before presenting it.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), React 18 with `useSyncExternalStore`, zustand 5 (vanilla `onlineSessionStore`, per-view Immer store), framer-motion (dialog motion), Radix dropdown (Atlas context menu), SCSS, Vitest 4 + jsdom + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-01-online-gm-polish-design.md` (binding). It builds on pieces 1 to 5, whose plans are in `docs/superpowers/plans/` (latest: `2026-10-01-online-token-moves.md`). The repo's `CLAUDE.md` "UI Design Principles" are binding too.

## Global Constraints

- **Copy, exactly as the spec writes it.** All of it is sentence case, and lives in `src/app/online/ui/onlineCopy.ts` (except **Controlled by**, which is `CONTROLLED_BY_LABEL` in `controlledByMenu.ts`):
  - the Obsidian command **Online session…** (unchanged id `online-session`);
  - the toolbar button and palette entry **Online session**;
  - **Start online session**, **Allow**, **Deny**, **Controlled by**, **Remove player**;
  - **Present to players**, **Stop presenting**, **Stop online session**, **Open player window**;
  - the palette section title "Online play".
  - New labels are sentence case even where neighbouring toolbar labels ("Loot Roller") are Title Case.
- **Toolbar** (CLAUDE.md "Main toolbar"):
  - the control is a `ToolButton` with lucide's `Network` icon;
  - it has a `PRIORITY` entry `online: 60` in `MainToolbar.tsx` and a `menuEntry` for **More tools**;
  - it is pinned while its panel is open;
  - it shows a dot while hosting, and a count badge of waiting join requests instead of the dot when there are any;
  - clicking it toggles the panel.
- **Panel** (CLAUDE.md "UI Design Principles"):
  - `atlas-elevated-surface`, `atlas-panel-radius($radius-2xl)`, a header with `atlas-close-header` ending in `CloseButton`, and `useDialogWindowVariants` motion inside `AnimatePresence`, as the loot roller has;
  - uniform padding (each container's gap equals its padding);
  - inner elements use `$radius-l`;
  - SCSS only: no new Tailwind classes, no `title` attributes, and tooltips only through `LabelTooltip`.
- **Panel contents.**
  - Not hosting: **Start online session** and one line on what it does.
  - Hosting, top to bottom:
    - the status;
    - the join link with a copy button;
    - waiting players with **Allow** and **Deny**;
    - players with their controlled tokens as chips, a **Controlled by** picker and **Remove player**;
    - the presented scene's name with **Present to players** / **Stop presenting**;
    - **Stop online session**.
- **Obsidian command.** **Online session…** opens the panel in the active Atlas view. With no Atlas view that can show it, it opens the existing `OnlineSessionModal`, which stays for that case.
- **Command palette.**
  - An "Online play" section, last, with:
    - **Online session**, always;
    - **Present to players**, when this view has an open scene that is not the presented one;
    - **Stop presenting**, while a scene is presented;
    - **Stop online session**, while hosting.
  - No new palette tab.
- **Eye button.**
  - While hosting, it presents the clicked tab with `presentViewToPlayers` (after switching to it) and never opens the local window. Its label reads "Present to players".
  - Its context menu offers **Open player window** (today's `presentTabInPlayerWindow`).
  - Without a session, nothing changes.
- **Non-goals.** Do not add player-side tools or change session behaviour, the protocol or the join page.
- **Code style.**
  - Explicit return types.
  - `window.setTimeout` in `src`.
  - No inline `eslint-disable` and no `@ts-expect-error`.
  - Every new file stays under 200 lines.
  - `MainToolbar.tsx` stays under 270 lines, and `CommandPalette.tsx` grows by at most 4 lines.
- **Changelog.** `changelog/Unreleased.md` has CRLF line endings: keep them. Then regenerate `src/app/changelog/releases.json` (`npm run changelog:generate`).

## Review Focus

- **The presented scene is held, or its map is loading.** The GM is on another tab, so the view's store holds a different map. The GM expects the picker and the chips never to offer that other map's characters, and a hint saying to switch back. Test in Task 1: `does not offer the characters of another map while the presented scene is held`.
- **A player is removed (or the session stops) after the picker opened.** The Atlas context menu's top-level items are a snapshot. The GM expects a late pick to do nothing rather than assign a token to a player the session no longer knows. Test in Task 1: `ignores a pick for a player removed after the picker opened`.
- **The session stops elsewhere while the panel is open** (status bar, the Obsidian command, plugin unload). The GM expects the panel to fall back to **Start online session** and its picker menu to close. Test in Task 1: `falls back to the start view and closes its picker when the session stops elsewhere`.
- **Two Atlas views, or a view that cannot show GM panels.** The GM expects **Online session…** to open the panel only in the active view, or in the first open one when none is active, and the modal when the target is a player view. Test in Task 1: `opens the panel only in the active view, else the first open one, else the modal`.
- **The eye on a tab that is not the active one, while hosting.** `presentViewToPlayers` alone presents whatever tab is active. The GM expects the clicked tab to become active and be presented. Test in Task 2: `switches to the clicked tab before presenting it`.

The spec's own tests are in the owning tasks too:
- Task 1 covers what the panel shows (not hosting, starting, failed start, hosting with no players, waiting players, players with tokens, presented and not presented), that its actions call the service, the toolbar dot, badge, priority, pin and menu entry, and the command.
- Task 2 covers each palette entry's condition and action, and the eye with and without a session, including its context menu.

## Rulings on spec ambiguities

1. **Status.**
   - The store has no "reconnecting" state: `PeerTransport` reconnects to signaling silently, and `error` is cleared only by the next player change. The spec forbids session changes, so while hosting the panel shows "Connected" and, when `error` is set, the error text under it. That covers signaling hiccups and the relay-too-long warning.
   - A failed start (`status: 'error'`) shows the error in the start view, with **Start online session** enabled again.
   - `starting` shows a disabled "Starting…".
2. **Placement.**
   - The panel floats at the top right of the map view, below the scene tabs, where the loot roller first opens. It has no drag or resize.
   - Its open state is per view and not saved in the map file (`uiSlice`).
3. **Toolbar.**
   - Priority 60, between draw (65) and palette (55): a session control the GM reaches for during play, but less often than tools.
   - It pins while open, as the spec says, although other floating panels do not pin.
   - The waiting badge replaces the dot.
   - The tooltip subtitle reads "Hosting" or "N waiting to join". The badge carries a visually hidden "N waiting to join".
4. **Picker.**
   - **Controlled by** on each player opens the Atlas context menu. It lists the presented scene's character tokens, the same set the token menu offers **Controlled by** on, with a check for each one the player controls.
   - The menu closes after each pick, because top-level menu entries do not refresh.
   - A pick is checked again at click time: still hosting, same `TokenControl`, player still known and not pending, token still in the scene.
   - With no characters, the menu shows a disabled "No characters in the presented scene".
5. **Chips and hints.**
   - Chips name the player's tokens found in the presented scene.
   - While nothing is presented, the picker is disabled and the list says "Present a scene to give players tokens."
   - While the scene is held or loading, the list says "Switch back to {scene} to change tokens.".
6. **Disconnected players** (`status: 'gone'`) keep their tokens, so they are listed with "Disconnected", their chips, the picker and **Remove player**. Pending players appear only under "Waiting to join".
7. **Presenting in the panel.**
   - "Players see {scene}." or "Players see no scene.".
   - **Present to players** shows when this view's active tab is not the presented one, and presents this view.
   - **Stop presenting** shows while anything is presented.
8. **Command target.**
   - The command opens the panel in the active Atlas view, else in the first open Atlas view (revealed), else the modal. A view whose store has `isPlayerView` (where UIRoot hides GM panels) gets the modal.
   - The status bar item and the map's **More options** → **Online session…** entry (`ViewActionsMenu`) use the same opener.
9. **Palette.**
   - The online entries are appended after the settings entries, and their section comes last, so keyboard focus (which indexes the flat list) matches the drawn order.
   - **Present to players** does not require a session, as the spec says.
10. **Eye.**
    - While hosting the label is "Present to players" unless the tab is already presented, which keeps "{scene} is shown to players".
    - The context menu is offered only while hosting. Without a session, right-click is untouched.
    - `SceneSwitcher` shares `presentTab`, so its eye follows the same rule.
11. **Join-request notices** are unchanged and appear whether the panel is open or closed.

---

### Task 1: Online panel, toolbar button and the Obsidian command

**Files:**
- Create: `src/app/online/ui/onlineCopy.ts`, `src/app/online/ui/presentedSceneSummary.ts`, `src/app/online/ui/tokenPickerMenu.ts`, `src/app/online/ui/openOnlineSession.ts`
- Create: `src/app/react/components/online/useOnlineState.ts`, `onlineToolbarItem.tsx`, `OnlinePanel.tsx`, `OnlinePlayerList.tsx`, `OnlinePresenting.tsx`, `online-panel.scss`
- Modify: `src/app/stores/uiSlice.ts` (whole file), `src/app/storeFactory.ts:292,301` (two type lines), `src/app/packages/components/MainToolbar.tsx`, `src/app/react/UIRoot.tsx`, `src/app/online/registerOnline.ts` (whole file), `src/app/react/components/ViewActionsMenu.tsx:6,41`, `styles/main.scss:82`
- Test: `tests/unit/onlinePanel.test.tsx`, `tests/unit/onlineToolbarItem.test.tsx`, `tests/unit/online/openOnlineSession.test.ts`, `tests/unit/mainToolbar.text-tool.test.tsx` (one case)

**Interfaces:**
- Consumes (existing):
  - `onlineSessionStore` / `OnlineSessionState` (`status`, `joinUrl`, `players`, `error`, `tokenControl`);
  - `OnlineSessionService.forApp(app)` with `start(): Promise<void>`, `stop()`, `allow(id)`, `deny(id)` and `kick(id)`;
  - `TokenControl` (`controls`, `tokensOf`, `set`, `onChange`);
  - `presentedScene` (`current`, `isHeld`, `subscribe`), `usePresentedTabId`, `useSceneTabStore`;
  - `presentViewToPlayers(view)` and `stopPresenting()`;
  - `useContextMenu()` with `{ open(entries, {x, y}), close() }`;
  - `CONTROLLED_BY_LABEL`, `openOnlineSessionModal(app)`, `ToolButton`, `ResponsiveToolbarItem`.
- Produces (Task 2 relies on these):
  - `onlineCopy.ts`: `ONLINE_SESSION_LABEL`, `START_SESSION_LABEL`, `STOP_SESSION_LABEL`, `PRESENT_LABEL`, `STOP_PRESENTING_LABEL`, `REMOVE_PLAYER_LABEL`, `OPEN_PLAYER_WINDOW_LABEL` and `ONLINE_SECTION_TITLE`, all `string` constants.
  - `useOnlineState.ts`: `useOnlineSession(): OnlineSessionState`, `usePresentedSceneSummary(): PresentedSceneSummary`, `usePresenting(): boolean` and `useTokenControlVersion(control: TokenControl | null): void`.
  - `presentedSceneSummary.ts`: `interface PresentedSceneSummary { tabId: string | null; name: string | null; characters: readonly PresentedCharacter[]; assignable: boolean }`, `readPresentedScene()` and `subscribePresentedScene(onChange)`.
  - The store: `isOnlinePanelOpen: boolean` and `setOnlinePanelOpen(open: boolean): void`.
  - `openOnlineSession(app: App): void`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/onlineToolbarItem.test.tsx`:

```tsx
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../src/app/packages/components/primitives/tooltip';
import { onlineToolbarItem } from '../../src/app/react/components/online/onlineToolbarItem';
import type { SessionPlayer } from '../../src/app/online/GmSession';

const anna: SessionPlayer = { playerId: 'p1', name: 'Anna', status: 'admitted' };
const bob: SessionPlayer = { playerId: 'p2', name: 'Bob', status: 'pending' };
const cy: SessionPlayer = { playerId: 'p3', name: 'Cy', status: 'pending' };

function renderItem(element: React.ReactNode): HTMLElement {
  return render(<TooltipProvider>{element}</TooltipProvider>).container;
}

describe('online toolbar item', () => {
  it('shows no mark while no session runs', () => {
    const item = onlineToolbarItem({ priority: 60, session: { status: 'idle', players: [] }, open: false, onToggle: vi.fn() });
    const container = renderItem(item.element);
    expect(container.querySelector('.atlas-online-tool__dot')).toBeNull();
    expect(container.querySelector('.atlas-online-tool__badge')).toBeNull();
  });

  it('shows a dot while hosting, and the number of waiting players instead when there are any', () => {
    const hosting = onlineToolbarItem({ priority: 60, session: { status: 'hosting', players: [anna] }, open: false, onToggle: vi.fn() });
    const quiet = renderItem(hosting.element);
    expect(quiet.querySelector('.atlas-online-tool__dot')).not.toBeNull();
    expect(quiet.querySelector('.atlas-online-tool__badge')).toBeNull();

    const waiting = onlineToolbarItem({ priority: 60, session: { status: 'hosting', players: [anna, bob, cy] }, open: false, onToggle: vi.fn() });
    const busy = renderItem(waiting.element);
    expect(busy.querySelector('.atlas-online-tool__dot')).toBeNull();
    expect(busy.querySelector('.atlas-online-tool__badge')?.textContent).toContain('2');
    expect(screen.getByText('2 waiting to join')).toBeTruthy();
  });

  it('toggles the panel, pins while it is open and offers a More tools entry', () => {
    const onToggle = vi.fn();
    const closed = onlineToolbarItem({ priority: 60, session: { status: 'idle', players: [] }, open: false, onToggle });
    expect(closed).toMatchObject({ id: 'online', priority: 60, pinned: false });
    expect(closed.menuEntry).toMatchObject({ label: 'Online session', isActive: false });
    closed.menuEntry.onSelect();
    renderItem(closed.element);
    fireEvent.click(screen.getByRole('button', { name: 'Online session' }));
    expect(onToggle).toHaveBeenCalledTimes(2);

    const open = onlineToolbarItem({ priority: 60, session: { status: 'idle', players: [] }, open: true, onToggle });
    expect(open.pinned).toBe(true);
    expect(open.menuEntry.isActive).toBe(true);
  });
});
```

Create `tests/unit/onlinePanel.test.tsx`:

```tsx
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { createStore } from 'zustand/vanilla';

const { service, presentViewToPlayers, stopPresenting, menu, ui } = vi.hoisted(() => ({
  service: { start: vi.fn(() => Promise.resolve()), stop: vi.fn(), allow: vi.fn(), deny: vi.fn(), kick: vi.fn() },
  presentViewToPlayers: vi.fn(() => Promise.resolve()),
  stopPresenting: vi.fn(),
  menu: { open: vi.fn(), close: vi.fn() },
  ui: { view: null as unknown },
}));

vi.mock('../../src/app/online/OnlineSessionService', () => ({ OnlineSessionService: { forApp: () => service } }));
vi.mock('../../src/app/services/presentToPlayers', () => ({ presentViewToPlayers, stopPresenting }));
vi.mock('../../src/app/react/root/ContextMenuContext', () => ({ useContextMenu: () => menu }));
vi.mock('../../src/app/react/root/AtlasUIContext', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/app/react/root/AtlasUIContext')>(),
  useAtlasUI: () => ({ app: {}, view: ui.view }),
}));

import { ViewStoreProvider } from '../../src/app/react/ViewStoreContext';
import { OnlinePanel } from '../../src/app/react/components/online/OnlinePanel';
import { TokenControl } from '../../src/app/online/control/TokenControl';
import type { SessionPlayer } from '../../src/app/online/GmSession';
import { onlineSessionStore, resetOnlineSessionStore } from '../../src/app/online/onlineSessionStore';
import type { ContextMenuEntry } from '../../src/app/react/root/ContextMenuContext';
import { presentedScene, type PresentedView } from '../../src/app/services/PresentedScene';
import { createTabMetaStore } from '../../src/app/stores/tabMetaStore';

type Item = Extract<ContextMenuEntry, { type: 'item' }>;

const TOKENS = {
  hero: { id: 'hero', kind: 'character', name: 'Hero' },
  goblin: { id: 'goblin', kind: 'character', name: '', statblockName: 'Goblin' },
  crate: { id: 'crate', kind: 'token' },
};

/** A map view showing Tavern; `ui.view` is that view, so the panel presents it. */
function mapView(): { presented: PresentedView; tavern: string; tabMetaStore: ReturnType<typeof createTabMetaStore> } {
  const tabMetaStore = createTabMetaStore();
  const tavern = tabMetaStore.getState().addTab('Tavern.atlasmap', 'Tavern');
  tabMetaStore.getState().setActiveTab(tavern);
  const atlasStore = createStore(() => ({ isMapLoading: false, objects: { tokens: TOKENS } }));
  ui.view = { tabMetaStore, atlasStore };
  return { presented: { tabMetaStore, atlasStore, register: () => {} } as unknown as PresentedView, tavern, tabMetaStore };
}

function hosting(players: SessionPlayer[] = []): TokenControl {
  const control = new TokenControl();
  onlineSessionStore.setState({ status: 'hosting', joinUrl: 'https://example.org/join/#abc', players, tokenControl: control, error: null });
  return control;
}

function renderPanel(): { setOnlinePanelOpen: ReturnType<typeof vi.fn> } {
  const setOnlinePanelOpen = vi.fn();
  const store = create(() => ({ isOnlinePanelOpen: true, setOnlinePanelOpen }));
  render(<ViewStoreProvider store={store as never}><OnlinePanel /></ViewStoreProvider>);
  return { setOnlinePanelOpen };
}

const anna: SessionPlayer = { playerId: 'p1', name: 'Anna', status: 'admitted' };
const dan: SessionPlayer = { playerId: 'p4', name: 'Dan', status: 'gone' };

function pickerEntries(): Item[] {
  const call = menu.open.mock.calls.at(-1);
  if (!call) throw new Error('the picker did not open');
  return call[0] as Item[];
}

beforeEach(() => {
  vi.clearAllMocks();
  mapView();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => Promise.resolve()) } });
});
afterEach(() => {
  cleanup();
  resetOnlineSessionStore();
  presentedScene.clear();
});

describe('online panel', () => {
  it('offers to start a session while not hosting', () => {
    renderPanel();
    expect(screen.getByText(/Start a session to get a link/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start online session' }));
    expect(service.start).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Stop online session' })).toBeNull();
  });

  it('waits while starting and shows a failed start with the button back', () => {
    onlineSessionStore.setState({ status: 'starting' });
    renderPanel();
    expect((screen.getByRole('button', { name: 'Starting…' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => { onlineSessionStore.setState({ status: 'error', error: 'Timed out reaching the signaling server' }); });
    expect(screen.getByRole('alert').textContent).toBe('Timed out reaching the signaling server');
    expect((screen.getByRole('button', { name: 'Start online session' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the status, the link and no players yet while hosting, and stops the session', () => {
    hosting();
    renderPanel();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Join link' }) as HTMLInputElement).value).toBe('https://example.org/join/#abc');
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.org/join/#abc');
    expect(screen.getByText('No players yet. Share the link to invite them.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop online session' }));
    expect(service.stop).toHaveBeenCalledOnce();
  });

  it('shows a hosting error under the status', () => {
    hosting();
    act(() => { onlineSessionStore.setState({ error: 'Lost the signaling server' }); });
    renderPanel();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Lost the signaling server');
  });

  it('lets the GM allow or deny waiting players', () => {
    hosting([{ playerId: 'p2', name: 'Bob', status: 'pending' }]);
    renderPanel();
    const bob = within(screen.getByRole('listitem', { name: 'Bob' }));
    fireEvent.click(bob.getByRole('button', { name: 'Allow' }));
    fireEvent.click(bob.getByRole('button', { name: 'Deny' }));
    expect(service.allow).toHaveBeenCalledWith('p2');
    expect(service.deny).toHaveBeenCalledWith('p2');
  });

  it('lists players with their tokens, a Controlled by picker and removal', () => {
    const { presented, tavern } = mapView();
    const control = hosting([anna, dan]);
    control.set('hero', 'p1', true);
    act(() => { presentedScene.present(presented, tavern); });
    renderPanel();

    const row = within(screen.getByRole('listitem', { name: 'Anna' }));
    expect(row.getByText('Hero')).toBeTruthy();
    fireEvent.click(row.getByRole('button', { name: 'Controlled by' }));
    expect(pickerEntries().map(({ label, checked }) => ({ label, checked }))).toEqual([
      { label: 'Hero', checked: true },
      { label: 'Goblin', checked: false },
    ]);
    act(() => { pickerEntries()[1]!.onClick(); });
    expect(control.tokensOf('p1')).toEqual(['hero', 'goblin']);
    expect(row.getByText('Goblin')).toBeTruthy();

    fireEvent.click(row.getByRole('button', { name: 'Remove player' }));
    expect(service.kick).toHaveBeenCalledWith('p1');
    expect(within(screen.getByRole('listitem', { name: 'Dan' })).getByText('Disconnected')).toBeTruthy();
  });

  it('presents this view or stops presenting', () => {
    const { presented, tavern } = mapView();
    hosting();
    renderPanel();
    expect(screen.getByText('Players see no scene.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop presenting' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Present to players' }));
    expect(presentViewToPlayers).toHaveBeenCalledWith(ui.view);

    act(() => { presentedScene.present(presented, tavern); });
    expect(screen.getByText('Players see Tavern.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Present to players' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop presenting' }));
    expect(stopPresenting).toHaveBeenCalledOnce();
  });

  it('closes with its close button', () => {
    const { setOnlinePanelOpen } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Close online session' }));
    expect(setOnlinePanelOpen).toHaveBeenCalledWith(false);
  });

  // Review Focus
  it('does not offer the characters of another map while the presented scene is held', () => {
    const { presented, tavern, tabMetaStore } = mapView();
    const control = hosting([anna]);
    control.set('hero', 'p1', true);
    act(() => { presentedScene.present(presented, tavern); });
    renderPanel();
    const row = within(screen.getByRole('listitem', { name: 'Anna' }));
    expect(row.getByText('Hero')).toBeTruthy();

    act(() => {
      const caves = tabMetaStore.getState().addTab('Caves.atlasmap', 'Caves');
      tabMetaStore.getState().setActiveTab(caves);
    });
    expect(presentedScene.isHeld()).toBe(true);
    expect((row.getByRole('button', { name: 'Controlled by' }) as HTMLButtonElement).disabled).toBe(true);
    expect(row.queryByText('Hero')).toBeNull();
    expect(screen.getByText('Switch back to Tavern to change tokens.')).toBeTruthy();
  });

  it('ignores a pick for a player removed after the picker opened', () => {
    const { presented, tavern } = mapView();
    const control = hosting([anna]);
    act(() => { presentedScene.present(presented, tavern); });
    renderPanel();
    fireEvent.click(within(screen.getByRole('listitem', { name: 'Anna' })).getByRole('button', { name: 'Controlled by' }));
    const entries = pickerEntries();
    act(() => { onlineSessionStore.setState({ players: [] }); });
    entries[0]!.onClick();
    expect(control.tokensOf('p1')).toEqual([]);
  });

  it('falls back to the start view and closes its picker when the session stops elsewhere', () => {
    hosting([anna]);
    renderPanel();
    act(() => { resetOnlineSessionStore(); });
    expect(screen.getByRole('button', { name: 'Start online session' })).toBeTruthy();
    expect(screen.queryByRole('listitem', { name: 'Anna' })).toBeNull();
    expect(menu.close).toHaveBeenCalled();
  });

  it('asks for a presented scene before tokens can be given', () => {
    hosting([anna]);
    renderPanel();
    expect(screen.getByText('Present a scene to give players tokens.')).toBeTruthy();
    expect((within(screen.getByRole('listitem', { name: 'Anna' })).getByRole('button', { name: 'Controlled by' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

Create `tests/unit/online/openOnlineSession.test.ts`:

```ts
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
```

In `tests/unit/mainToolbar.text-tool.test.tsx`:
- change the first import line to `import { fireEvent, render, screen } from '@testing-library/react';`;
- add `const setOnlinePanelOpen = vi.fn();` after `const setInitiativeTrackerOpen = vi.fn();`;
- add `isOnlinePanelOpen: false,` and `setOnlinePanelOpen,` to `storeState` after `setLootRollerOpen: vi.fn(),`;
- add this case at the end of the `describe` block:

```tsx
  it('opens the online session panel from its button', () => {
    render(<MainToolbar viewId="view-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Online session' }));

    expect(setOnlinePanelOpen).toHaveBeenCalledWith(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/onlineToolbarItem.test.tsx tests/unit/onlinePanel.test.tsx tests/unit/online/openOnlineSession.test.ts tests/unit/mainToolbar.text-tool.test.tsx`
Expected: FAIL. The new suites cannot resolve `onlineToolbarItem`, `OnlinePanel` and `openOnlineSession`, and the toolbar case finds no "Online session" button.

- [ ] **Step 3: Copy, store state and the pure helpers**

Create `src/app/online/ui/onlineCopy.ts`:

```ts
/** The GM's online play copy, shared by the panel, the toolbar, the palette and the eye button. */
export const ONLINE_SESSION_LABEL = 'Online session';
export const START_SESSION_LABEL = 'Start online session';
export const STOP_SESSION_LABEL = 'Stop online session';
export const PRESENT_LABEL = 'Present to players';
export const STOP_PRESENTING_LABEL = 'Stop presenting';
export const REMOVE_PLAYER_LABEL = 'Remove player';
export const OPEN_PLAYER_WINDOW_LABEL = 'Open player window';
export const ONLINE_SECTION_TITLE = 'Online play';
```

Replace `src/app/stores/uiSlice.ts` with:

```ts
/**
 * UI Visibility State Slice
 * Manages ephemeral per-view UI panel visibility so that multiple Atlas views
 * (e.g. two maps side-by-side) have independent panel states.
 *
 * NOT persisted — the partialize whitelist in storeFactory.ts excludes these.
 */

/** State fields added to ViewAtlasState */
export interface UISlice {
  // Panel visibility
  isGridSettingsOpen: boolean;
  isDMDashboardOpen: boolean;
  isGridAlignmentOpen: boolean;
  isDiceLogOpen: boolean;
  isAssetManagerOpen: boolean;
  assetManagerInitialTab?: 'scenes' | 'maps' | 'encounters' | 'tokens' | undefined;
  isCommandPaletteOpen: boolean;
  isDiceTrayOpen: boolean;
  /** The online session panel (GM only). */
  isOnlinePanelOpen: boolean;

  // Actions
  setGridSettingsOpen: (open: boolean) => void;
  setDMDashboardOpen: (open: boolean) => void;
  setGridAlignmentOpen: (open: boolean) => void;
  setDiceLogOpen: (open: boolean) => void;
  openAssetManager: (tab?: UISlice['assetManagerInitialTab']) => void;
  closeAssetManager: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setDiceTrayOpen: (open: boolean) => void;
  setOnlinePanelOpen: (open: boolean) => void;
}

/** Default state — all panels closed */
export function createInitialUIState(): Pick<
  UISlice,
  | 'isGridSettingsOpen'
  | 'isDMDashboardOpen'
  | 'isGridAlignmentOpen'
  | 'isDiceLogOpen'
  | 'isAssetManagerOpen'
  | 'assetManagerInitialTab'
  | 'isCommandPaletteOpen'
  | 'isDiceTrayOpen'
  | 'isOnlinePanelOpen'
> {
  return {
    isGridSettingsOpen: false,
    isDMDashboardOpen: false,
    isGridAlignmentOpen: false,
    isDiceLogOpen: false,
    isAssetManagerOpen: false,
    assetManagerInitialTab: undefined,
    isCommandPaletteOpen: false,
    isDiceTrayOpen: false,
    isOnlinePanelOpen: false,
  };
}

/** Action creators — `set` comes from the immer middleware in the store */
export function createUIActions(
  set: (fn: (draft: UISlice) => void) => void,
): Pick<
  UISlice,
  | 'setGridSettingsOpen'
  | 'setDMDashboardOpen'
  | 'setGridAlignmentOpen'
  | 'setDiceLogOpen'
  | 'openAssetManager'
  | 'closeAssetManager'
  | 'setCommandPaletteOpen'
  | 'setDiceTrayOpen'
  | 'setOnlinePanelOpen'
> {
  return {
    setGridSettingsOpen: (open) => set((draft) => { draft.isGridSettingsOpen = open; }),
    setDMDashboardOpen: (open) => set((draft) => { draft.isDMDashboardOpen = open; }),
    setGridAlignmentOpen: (open) => set((draft) => { draft.isGridAlignmentOpen = open; }),
    setDiceLogOpen: (open) => set((draft) => { draft.isDiceLogOpen = open; }),
    openAssetManager: (tab) => set((draft) => {
      draft.isAssetManagerOpen = true;
      draft.assetManagerInitialTab = tab;
    }),
    closeAssetManager: () => set((draft) => {
      draft.isAssetManagerOpen = false;
      draft.assetManagerInitialTab = undefined;
    }),
    setCommandPaletteOpen: (open) => set((draft) => { draft.isCommandPaletteOpen = open; }),
    setDiceTrayOpen: (open) => set((draft) => { draft.isDiceTrayOpen = open; }),
    setOnlinePanelOpen: (open) => set((draft) => { draft.isOnlinePanelOpen = open; }),
  };
}
```

In `src/app/storeFactory.ts`, in the "Per-view UI visibility" block of `ViewAtlasState`:
- after `  isDiceTrayOpen: UISlice['isDiceTrayOpen'];` add `  isOnlinePanelOpen: UISlice['isOnlinePanelOpen'];`;
- after `  setDiceTrayOpen: UISlice['setDiceTrayOpen'];` add `  setOnlinePanelOpen: UISlice['setOnlinePanelOpen'];`.

`partialize` is a whitelist, so the new field is not saved.

Create `src/app/online/ui/presentedSceneSummary.ts`:

```ts
/**
 * The presented scene as the GM's online panel and palette see it: its tab, its name
 * and its character tokens. While the scene is held (the GM shows another tab) or its
 * map is loading, the view's store holds another map, so no characters are offered.
 * Read through `useSyncExternalStore`: `readPresentedScene` returns the same object
 * until something it reads changes.
 */
import { presentedScene, type PresentedSceneInfo } from '../../services/PresentedScene';
import type { Character, TokenEntity } from '../../types';

export interface PresentedCharacter {
  id: string;
  name: string;
}

export interface PresentedSceneSummary {
  /** The presented tab; null while nothing is presented. */
  tabId: string | null;
  /** The presented tab's name; null while nothing is presented. */
  name: string | null;
  /** The presented scene's character tokens; empty while it cannot be assigned from. */
  characters: readonly PresentedCharacter[];
  /** False while nothing is presented, the scene is held or its map loads. */
  assignable: boolean;
}

const NOTHING: PresentedSceneSummary = { tabId: null, name: null, characters: [], assignable: false };

interface Cached {
  scene: PresentedSceneInfo;
  assignable: boolean;
  tokens: Record<string, TokenEntity> | null;
  tabs: unknown;
  value: PresentedSceneSummary;
}
let cached: Cached | null = null;

/** A character's name as the panel lists it, like the nameplate's fallback. */
export function characterName(token: Character): string {
  return token.name || token.statblockName || 'Unnamed character';
}

function charactersOf(tokens: Record<string, TokenEntity>): PresentedCharacter[] {
  return Object.values(tokens)
    .filter((token): token is Character => token.kind === 'character')
    .map((token) => ({ id: token.id, name: characterName(token) }));
}

export function readPresentedScene(): PresentedSceneSummary {
  const scene = presentedScene.current();
  if (!scene) return NOTHING;
  const state = scene.store.getState();
  const assignable = !presentedScene.isHeld() && !state.isMapLoading;
  const tokens = assignable ? state.objects.tokens : null;
  const tabs = scene.view.tabMetaStore.getState().tabs;
  if (cached && cached.scene === scene && cached.assignable === assignable && cached.tokens === tokens && cached.tabs === tabs) {
    return cached.value;
  }
  const value: PresentedSceneSummary = {
    tabId: scene.tabId,
    name: tabs.find((tab) => tab.id === scene.tabId)?.displayName ?? null,
    characters: tokens ? charactersOf(tokens) : [],
    assignable,
  };
  cached = { scene, assignable, tokens, tabs, value };
  return value;
}

/** Calls `onChange` when the presented scene, its tokens, its loading or its tab names change. */
export function subscribePresentedScene(onChange: () => void): () => void {
  const watch = (scene: PresentedSceneInfo | null): (() => void) => {
    if (!scene) return () => undefined;
    const stopStore = scene.store.subscribe(onChange);
    const stopTabs = scene.view.tabMetaStore.subscribe(onChange);
    return () => {
      stopStore();
      stopTabs();
    };
  };
  let stopScene = watch(presentedScene.current());
  const changed = (): void => {
    stopScene();
    stopScene = watch(presentedScene.current());
    onChange();
  };
  const stopPresented = presentedScene.subscribe({ presented: changed, held: changed, cleared: changed });
  return () => {
    stopPresented();
    stopScene();
  };
}
```

Create `src/app/online/ui/tokenPickerMenu.ts`:

```ts
/**
 * The entries of a player's "Controlled by" picker in the online panel: the presented
 * scene's characters, checked where the player controls them. Assignments go through
 * the session's `TokenControl`, as in the token context menu.
 */
import type { ContextMenuEntry } from '../../react/root/ContextMenuContext';
import type { TokenControl } from '../control/TokenControl';
import { onlineSessionStore } from '../onlineSessionStore';
import { readPresentedScene, type PresentedCharacter } from './presentedSceneSummary';

export const NO_CHARACTERS_LABEL = 'No characters in the presented scene';

export function tokenPickerEntries(control: TokenControl, playerId: string, characters: readonly PresentedCharacter[]): ContextMenuEntry[] {
  if (characters.length === 0) {
    return [{ type: 'item', label: NO_CHARACTERS_LABEL, disabled: true, onClick: () => undefined }];
  }
  return characters.map((character): ContextMenuEntry => ({
    type: 'item',
    label: character.name,
    checked: control.controls(playerId, character.id),
    onClick: () => {
      if (!stillAssignable(control, playerId, character.id)) return;
      control.set(character.id, playerId, !control.controls(playerId, character.id));
    },
  }));
}

/** The menu is a snapshot: the session may have stopped, the player left or the token gone since it opened. */
function stillAssignable(control: TokenControl, playerId: string, tokenId: string): boolean {
  const { status, tokenControl, players } = onlineSessionStore.getState();
  if (status !== 'hosting' || tokenControl !== control) return false;
  if (!players.some((player) => player.playerId === playerId && player.status !== 'pending')) return false;
  return readPresentedScene().characters.some((character) => character.id === tokenId);
}
```

Create `src/app/online/ui/openOnlineSession.ts`:

```ts
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
```

Replace `src/app/online/registerOnline.ts` with:

```ts
import type { Plugin } from 'obsidian';
import { onlineSessionStore } from './onlineSessionStore';
import type { OnlineSessionService } from './OnlineSessionService';
import { openOnlineSession } from './ui/openOnlineSession';

/** Commands, the status bar item, and stopping the session with the plugin. */
export function registerOnline(plugin: Plugin, service: OnlineSessionService): void {
  plugin.addCommand({ id: 'online-session', name: 'Online session…', callback: () => openOnlineSession(plugin.app) });
  plugin.addCommand({
    id: 'stop-online-session',
    name: 'Stop online session',
    checkCallback: (checking) => {
      if (onlineSessionStore.getState().status !== 'hosting') return false;
      if (!checking) service.stop();
      return true;
    },
  });

  const item = plugin.addStatusBarItem();
  item.addClass('mod-clickable');
  item.addEventListener('click', () => openOnlineSession(plugin.app));
  const render = (): void => {
    const state = onlineSessionStore.getState();
    const connected = state.players.filter((player) => player.status === 'admitted').length;
    const waiting = state.players.filter((player) => player.status === 'pending').length;
    item.toggle(state.status === 'hosting');
    item.setText(`Online · ${connected} ${connected === 1 ? 'player' : 'players'}${waiting ? ` · ${waiting} waiting` : ''}`);
  };
  render();
  plugin.register(onlineSessionStore.subscribe(render));
  plugin.register(() => service.stop());
}
```

In `src/app/react/components/ViewActionsMenu.tsx`:
- replace `import { openOnlineSessionModal } from '../../online/ui/OnlineSessionModal';` with `import { openOnlineSession } from '../../online/ui/openOnlineSession';`;
- in the entry `{ type: 'item', label: 'Online session…', icon: 'radio-tower', onClick: () => openOnlineSessionModal(app) },` replace `openOnlineSessionModal(app)` with `openOnlineSession(app)`.

- [ ] **Step 4: Hooks and the toolbar item**

Create `src/app/react/components/online/useOnlineState.ts`:

```ts
import { useEffect, useReducer, useSyncExternalStore } from 'react';
import type { TokenControl } from '../../../online/control/TokenControl';
import { onlineSessionStore, type OnlineSessionState } from '../../../online/onlineSessionStore';
import { readPresentedScene, subscribePresentedScene, type PresentedSceneSummary } from '../../../online/ui/presentedSceneSummary';
import { presentedScene } from '../../../services/PresentedScene';

const subscribePresenting = (onChange: () => void): (() => void) =>
  presentedScene.subscribe({ presented: onChange, held: onChange, cleared: onChange });
const isPresenting = (): boolean => presentedScene.current() !== null;

/** The online session as the GM's UI sees it. */
export function useOnlineSession(): OnlineSessionState {
  return useSyncExternalStore(onlineSessionStore.subscribe, onlineSessionStore.getState);
}

/** The presented scene: its tab, name and characters. */
export function usePresentedSceneSummary(): PresentedSceneSummary {
  return useSyncExternalStore(subscribePresentedScene, readPresentedScene);
}

/**
 * Whether any scene is presented. Cheaper than the summary, which follows the presented
 * store's tokens (every frame of a token drag): for the always-mounted command palette.
 */
export function usePresenting(): boolean {
  return useSyncExternalStore(subscribePresenting, isPresenting);
}

/** Renders again whenever the session's token assignments change. */
export function useTokenControlVersion(control: TokenControl | null): void {
  const [, refresh] = useReducer((version: number) => version + 1, 0);
  useEffect(() => control?.onChange(() => refresh()), [control]);
}
```

Create `src/app/react/components/online/onlineToolbarItem.tsx`:

```tsx
import React from 'react';
import { Network } from 'lucide-react';
import { ToolButton } from '../../../packages/components/primitives/ToolButton';
import type { ResponsiveToolbarItem } from '../../../packages/components/toolbar/toolbarTypes';
import type { OnlineSessionState } from '../../../online/onlineSessionStore';
import { ONLINE_SESSION_LABEL } from '../../../online/ui/onlineCopy';

interface OnlineToolbarItemOptions {
  /** From `PRIORITY` in MainToolbar.tsx. */
  priority: number;
  session: Pick<OnlineSessionState, 'status' | 'players'>;
  /** Whether this view's online panel is open; the button stays in the bar meanwhile. */
  open: boolean;
  onToggle: () => void;
}

/** The main toolbar's online session button: a dot while hosting, the number of waiting players instead when there are any. */
export function onlineToolbarItem({ priority, session, open, onToggle }: OnlineToolbarItemOptions): ResponsiveToolbarItem {
  const hosting = session.status === 'hosting';
  const waiting = hosting ? session.players.filter((player) => player.status === 'pending').length : 0;
  const waitingText = `${waiting} waiting to join`;
  const subtitle = waiting > 0 ? waitingText : hosting ? 'Hosting' : null;
  return {
    id: 'online',
    priority,
    pinned: open,
    element: (
      <div className="atlas-online-tool">
        <ToolButton icon={Network} label={ONLINE_SESSION_LABEL} isActive={open} onClick={onToggle} {...(subtitle ? { subtitle } : {})} />
        {waiting > 0 ? (
          <span className="atlas-online-tool__badge">
            <span aria-hidden="true">{waiting}</span>
            <span className="atlas-online-tool__hidden-text">{waitingText}</span>
          </span>
        ) : hosting && <span className="atlas-online-tool__dot" aria-hidden="true" />}
      </div>
    ),
    menuEntry: { icon: Network, label: ONLINE_SESSION_LABEL, isActive: open, onSelect: onToggle },
  };
}
```

In `src/app/packages/components/MainToolbar.tsx`:
- add the import `import { onlineToolbarItem } from "../../react/components/online/onlineToolbarItem"` and `import { useOnlineSession } from "../../react/components/online/useOnlineState"` after the `CoinIcon` import;
- in `PRIORITY`, add `  online: 60,` between `draw: 65,` and `palette: 55,`;
- after `const setLootRollerOpen = useAtlasStore(s => s.setLootRollerOpen)` add:

```tsx
  const isOnlinePanelOpen = useAtlasStore(s => s.isOnlinePanelOpen)
  const setOnlinePanelOpen = useAtlasStore(s => s.setOnlinePanelOpen)
  const onlineSession = useOnlineSession()
```

- in `items`, replace the line that is exactly `    ...(dm ? [` (the one that opens the loot, assets and palette group; the other `...(dm ? [` lines continue on the same line) with:

```tsx
    ...(dm ? [
      onlineToolbarItem({
        priority: PRIORITY.online,
        session: onlineSession,
        open: isOnlinePanelOpen,
        onToggle: () => setOnlinePanelOpen(!isOnlinePanelOpen),
      }),
```

(the three `buttonItem(...)` lines and the closing `] : []),` stay as they are).

- [ ] **Step 5: The panel**

Create `src/app/react/components/online/OnlinePanel.tsx`:

```tsx
import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Copy, Network } from 'lucide-react';
import { Notice } from 'obsidian';
import { Button } from '../../../packages/components/primitives/button';
import { CloseButton } from '../../../packages/components/primitives/CloseButton';
import { useDialogWindowVariants } from '../../../packages/components/primitives/dialogMotion';
import { LabelTooltip } from '../../../packages/components/primitives/tooltip';
import { OnlineSessionService } from '../../../online/OnlineSessionService';
import type { OnlineSessionState } from '../../../online/onlineSessionStore';
import { ONLINE_SESSION_LABEL, START_SESSION_LABEL, STOP_SESSION_LABEL } from '../../../online/ui/onlineCopy';
import { useAtlasUI } from '../../root/AtlasUIContext';
import { useAtlasStore } from '../../ViewStoreContext';
import { OnlinePlayerList } from './OnlinePlayerList';
import { OnlinePresenting } from './OnlinePresenting';
import { useOnlineSession } from './useOnlineState';

export const START_HELP = 'Start a session to get a link your players can open in a browser. You approve each player who joins.';

/** The online session panel of a map view; shown for the GM while it is open. */
export function OnlinePanel(): React.ReactElement {
  const open = useAtlasStore((state) => state.isOnlinePanelOpen);
  return <AnimatePresence>{open && <OnlinePanelWindow key="online-panel" />}</AnimatePresence>;
}

function OnlinePanelWindow(): React.ReactElement {
  const { app } = useAtlasUI();
  const setOpen = useAtlasStore((state) => state.setOnlinePanelOpen);
  const windowVariants = useDialogWindowVariants();
  const session = useOnlineSession();
  const service = OnlineSessionService.forApp(app);

  return (
    <motion.section
      className="atlas-online-panel"
      variants={windowVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      aria-label={ONLINE_SESSION_LABEL}
    >
      <header className="atlas-online-panel__header">
        <span className="atlas-online-panel__icon"><Network /></span>
        <h2 className="atlas-online-panel__title">{ONLINE_SESSION_LABEL}</h2>
        <CloseButton onClick={() => setOpen(false)} aria-label="Close online session" />
      </header>
      <div className="atlas-online-panel__body">
        {session.status === 'hosting' && service
          ? <HostingView session={session} service={service} />
          : <StartView session={session} service={service} />}
      </div>
    </motion.section>
  );
}

function StartView({ session, service }: { session: OnlineSessionState; service: OnlineSessionService | undefined }): React.ReactElement {
  const starting = session.status === 'starting';
  return (
    <section className="atlas-online-panel__section">
      <p className="atlas-online-panel__help">{START_HELP}</p>
      {session.status === 'error' && session.error && (
        <p className="atlas-online-panel__error" role="alert">{session.error}</p>
      )}
      <div className="atlas-online-panel__footer">
        <Button variant="default" disabled={starting || !service} onClick={() => { void service?.start(); }}>
          {starting ? 'Starting…' : START_SESSION_LABEL}
        </Button>
      </div>
    </section>
  );
}

function HostingView({ session, service }: { session: OnlineSessionState; service: OnlineSessionService }): React.ReactElement {
  const url = session.joinUrl;
  return (
    <>
      <section className="atlas-online-panel__section" aria-label="Session status">
        <p className="atlas-online-panel__status">
          <span className="atlas-online-panel__dot" aria-hidden="true" />
          Connected
        </p>
        {session.error && <p className="atlas-online-panel__error" role="status">{session.error}</p>}
        {url && (
          <div className="atlas-online-panel__link">
            <input type="text" readOnly value={url} aria-label="Join link" onFocus={(event) => event.currentTarget.select()} />
            <LabelTooltip label="Copy link">
              <Button variant="ghost" size="icon" onClick={() => copyJoinLink(url)}>
                <Copy />
              </Button>
            </LabelTooltip>
          </div>
        )}
      </section>
      <OnlinePlayerList players={session.players} control={session.tokenControl} service={service} />
      <OnlinePresenting />
      <div className="atlas-online-panel__footer">
        <Button variant="destructive" onClick={() => service.stop()}>{STOP_SESSION_LABEL}</Button>
      </div>
    </>
  );
}

function copyJoinLink(url: string): void {
  void navigator.clipboard.writeText(url).then(
    () => new Notice('Join link copied'),
    () => new Notice('Could not copy the join link'),
  );
}
```

Create `src/app/react/components/online/OnlinePlayerList.tsx`:

```tsx
import React, { useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '../../../packages/components/primitives/button';
import type { TokenControl } from '../../../online/control/TokenControl';
import type { SessionPlayer } from '../../../online/GmSession';
import type { OnlineSessionService } from '../../../online/OnlineSessionService';
import { CONTROLLED_BY_LABEL } from '../../../online/ui/controlledByMenu';
import { REMOVE_PLAYER_LABEL } from '../../../online/ui/onlineCopy';
import type { PresentedSceneSummary } from '../../../online/ui/presentedSceneSummary';
import { tokenPickerEntries } from '../../../online/ui/tokenPickerMenu';
import { useContextMenu } from '../../root/ContextMenuContext';
import { usePresentedSceneSummary, useTokenControlVersion } from './useOnlineState';

interface OnlinePlayerListProps {
  players: readonly SessionPlayer[];
  control: TokenControl | null;
  service: Pick<OnlineSessionService, 'allow' | 'deny' | 'kick'>;
}

/** Why tokens cannot be given right now; null when they can. */
function assignHint(scene: PresentedSceneSummary): string | null {
  if (scene.tabId === null) return 'Present a scene to give players tokens.';
  if (!scene.assignable) return `Switch back to ${scene.name ?? 'the presented scene'} to change tokens.`;
  return null;
}

/** Players waiting to join, and the players in the session with their tokens. */
export function OnlinePlayerList({ players, control, service }: OnlinePlayerListProps): React.ReactElement {
  const { open, close } = useContextMenu();
  const scene = usePresentedSceneSummary();
  useTokenControlVersion(control);
  // The picker belongs to this list: it closes when the session stops or the panel closes.
  useEffect(() => close, [close]);

  const waiting = players.filter((player) => player.status === 'pending');
  const joined = players.filter((player) => player.status !== 'pending');
  const names = new Map(scene.characters.map((character) => [character.id, character.name]));
  const hint = assignHint(scene);

  const pick = (player: SessionPlayer, anchor: HTMLElement): void => {
    if (!control) return;
    const rect = anchor.getBoundingClientRect();
    open(tokenPickerEntries(control, player.playerId, scene.characters), { x: rect.left, y: rect.bottom });
  };

  return (
    <>
      {waiting.length > 0 && (
        <section className="atlas-online-panel__section" aria-label="Waiting to join">
          <h3 className="atlas-online-panel__heading">Waiting to join</h3>
          <ul className="atlas-online-panel__players">
            {waiting.map((player) => (
              <li key={player.playerId} className="atlas-online-panel__player" aria-label={player.name}>
                <div className="atlas-online-panel__player-row">
                  <span className="atlas-online-panel__name">{player.name}</span>
                  <Button variant="default" size="sm" onClick={() => service.allow(player.playerId)}>Allow</Button>
                  <Button variant="outline" size="sm" onClick={() => service.deny(player.playerId)}>Deny</Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="atlas-online-panel__section" aria-label="Players">
        <h3 className="atlas-online-panel__heading">Players</h3>
        {joined.length === 0 ? (
          <p className="atlas-online-panel__help">No players yet. Share the link to invite them.</p>
        ) : (
          <ul className="atlas-online-panel__players">
            {joined.map((player) => {
              const tokens = control
                ? control.tokensOf(player.playerId).flatMap((id) => {
                  const name = names.get(id);
                  return name ? [{ id, name }] : [];
                })
                : [];
              return (
                <li key={player.playerId} className="atlas-online-panel__player" aria-label={player.name}>
                  <div className="atlas-online-panel__player-row">
                    <span className="atlas-online-panel__name">{player.name}</span>
                    {player.status === 'gone' && <span className="atlas-online-panel__note">Disconnected</span>}
                  </div>
                  {tokens.length > 0 && (
                    <ul className="atlas-online-panel__chips" aria-label={`Tokens of ${player.name}`}>
                      {tokens.map((token) => <li key={token.id} className="atlas-online-panel__chip">{token.name}</li>)}
                    </ul>
                  )}
                  <div className="atlas-online-panel__actions">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-haspopup="menu"
                      disabled={!control || !scene.assignable}
                      onClick={(event) => pick(player, event.currentTarget)}
                    >
                      {CONTROLLED_BY_LABEL}
                      <ChevronDown />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => service.kick(player.playerId)}>{REMOVE_PLAYER_LABEL}</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {joined.length > 0 && hint && <p className="atlas-online-panel__help">{hint}</p>}
      </section>
    </>
  );
}
```

Note: when there are no joined players, the hint is not shown. The test `asks for a presented scene before tokens can be given` has Anna admitted, so it sees the hint.

Create `src/app/react/components/online/OnlinePresenting.tsx`:

```tsx
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
```

Create `src/app/react/components/online/online-panel.scss`:

```scss
// ═══════════════════════════════════════════════════════════════════════════
// Online session panel — floating window of the map view (GM only), and the
// marks on its toolbar button. Imported inside the `.atlas-vtt-plugin` scope
// of styles/main.scss.
// ═══════════════════════════════════════════════════════════════════════════

@use '../../../../../styles/tokens' as *;
@use '../../../../../styles/mixins' as *;

$online-panel-width: 360px;
$online-panel-top: 64px; // below the scene tabs, where the loot roller first opens
$online-panel-padding: $spacing-m;
$online-mark-size: 8px;
$online-badge-size: 16px;

.atlas-online-panel {
  @include atlas-elevated-surface;
  @include atlas-panel-radius($radius-2xl);
  position: absolute;
  top: $online-panel-top;
  right: $spacing-m;
  z-index: 45;
  display: flex;
  flex-direction: column;
  width: $online-panel-width;
  max-width: calc(100% - 2 * #{$spacing-m});
  max-height: calc(100% - #{$online-panel-top} - #{$spacing-m});
  overflow: hidden;
  pointer-events: auto;
  color: var(--text-normal);
  font-size: $font-ui-small;
  transform-origin: top center;
}

.atlas-online-panel__header {
  @include atlas-flex-row($spacing-s);
  @include atlas-close-header($spacing-m);
  flex-shrink: 0;
  border-bottom: $border-width-s solid var(--divider-color);
}

.atlas-online-panel__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: $button-height-s;
  height: $button-height-s;
  flex-shrink: 0;
  border-radius: $radius-m;
  @include atlas-corner-shape;
  color: var(--color-blue);
  background: color-mix(in oklch, var(--color-blue) 16%, transparent);

  svg {
    width: $icon-s;
    height: $icon-s;
  }
}

.atlas-online-panel__title {
  flex: 1;
  margin: 0;
  font-size: $font-ui-medium;
  font-weight: $font-weight-semibold;
  line-height: 1.2;
}

.atlas-online-panel__body {
  @include atlas-flex-col($online-panel-padding);
  @include atlas-scrollbar;
  min-height: 0;
  padding: $online-panel-padding;
  overflow-y: auto;
}

.atlas-online-panel__section {
  @include atlas-flex-col($spacing-s);
  margin: 0;
}

.atlas-online-panel__heading {
  margin: 0;
  font-size: $font-ui-smaller;
  font-weight: $font-weight-semibold;
  color: var(--text-muted);
}

.atlas-online-panel__help {
  @include atlas-help-text;
  margin: 0;
}

.atlas-online-panel__error {
  margin: 0;
  color: var(--text-error);
  font-size: $font-ui-small;
}

.atlas-online-panel__status {
  @include atlas-flex-row($spacing-s);
  margin: 0;
  font-weight: $font-weight-medium;
}

.atlas-online-panel__dot {
  width: $online-mark-size;
  height: $online-mark-size;
  flex-shrink: 0;
  border-radius: $radius-full;
  background: var(--color-green);
}

.atlas-online-panel__link {
  @include atlas-flex-row($spacing-s);

  input {
    @include atlas-text-input;
    flex: 1;
    min-width: 0;
    font-family: var(--font-monospace);
    font-size: $font-ui-smaller;
  }
}

.atlas-online-panel__players {
  @include atlas-flex-col($spacing-s);
  margin: 0;
  padding: 0;
  list-style: none;
}

.atlas-online-panel__player {
  @include atlas-flex-col($spacing-s);
  padding: $spacing-s;
  border-radius: $radius-l;
  @include atlas-corner-shape;
  background: var(--background-secondary);
}

.atlas-online-panel__player-row {
  @include atlas-flex-row($spacing-s);
}

.atlas-online-panel__name {
  @include atlas-truncate;
  flex: 1;
  font-weight: $font-weight-medium;
}

.atlas-online-panel__note {
  font-size: $font-ui-smaller;
  color: var(--text-muted);
}

.atlas-online-panel__chips {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-xs;
  margin: 0;
  padding: 0;
  list-style: none;
}

.atlas-online-panel__chip {
  padding: $spacing-xs;
  border-radius: $radius-s;
  background: var(--background-modifier-hover);
  font-size: $font-ui-smaller;
  line-height: 1;
}

.atlas-online-panel__actions {
  @include atlas-flex-row($spacing-s);
  flex-wrap: wrap;
}

.atlas-online-panel__footer {
  display: flex;
  justify-content: flex-end;
}

// ── Toolbar button marks ──────────────────────────────────────────────────
.atlas-online-tool {
  position: relative;
  display: flex;
  align-items: center;
}

.atlas-online-tool__dot {
  position: absolute;
  top: $spacing-xs;
  right: $spacing-xs;
  width: $online-mark-size;
  height: $online-mark-size;
  border-radius: $radius-full;
  background: var(--color-green);
  pointer-events: none;
}

// A pill: fixed height, and it widens with the count, hence the inline padding only.
.atlas-online-tool__badge {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: $online-badge-size;
  height: $online-badge-size;
  padding: 0 $spacing-xs;
  border-radius: $radius-full;
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  font-size: $font-ui-smaller;
  font-weight: $font-weight-semibold;
  line-height: 1;
  pointer-events: none;
}

.atlas-online-tool__hidden-text {
  @include atlas-visually-hidden;
}
```

In `styles/main.scss`, after `  @import '../src/app/react/components/loot/player-loot.scss';` add `  @import '../src/app/react/components/online/online-panel.scss';`.

In `src/app/react/UIRoot.tsx`:
- after `import { LootRoller } from './components/loot/LootRollerPanel';` add `import { OnlinePanel } from './components/online/OnlinePanel';`;
- after `          {!isPlayerView && <LootRoller />}` add:

```tsx

          {/* Online session panel - floating window, DM only */}
          {!isPlayerView && <OnlinePanel />}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/onlineToolbarItem.test.tsx tests/unit/onlinePanel.test.tsx tests/unit/online/openOnlineSession.test.ts tests/unit/mainToolbar.text-tool.test.tsx tests/unit/responsiveToolbar.test.tsx tests/unit/online`
Expected: PASS.

Run: `npx tsc --noEmit && npx eslint src/app/online src/app/react/components/online src/app/stores/uiSlice.ts src/app/packages/components/MainToolbar.tsx src/app/react/UIRoot.tsx src/app/react/components/ViewActionsMenu.tsx --max-warnings 0 --suppressions-location eslint.suppressions.json`
Expected: both exit 0.

Run: `wc -l src/app/react/components/online/* src/app/online/ui/*.ts src/app/packages/components/MainToolbar.tsx`
Expected: every new file is under 200 lines, and `MainToolbar.tsx` is under 270.

Run: `npx vitest run && npm run lint`
Expected: both exit 0. The panel now mounts in `UIRoot` and the button in `MainToolbar`, so any other suite that renders them must still pass (and the new test files are linted).

- [ ] **Step 7: Commit**

```bash
git add src/app/online/ui/onlineCopy.ts src/app/online/ui/presentedSceneSummary.ts src/app/online/ui/tokenPickerMenu.ts src/app/online/ui/openOnlineSession.ts src/app/online/registerOnline.ts src/app/react/components/ViewActionsMenu.tsx src/app/react/components/online src/app/stores/uiSlice.ts src/app/storeFactory.ts src/app/packages/components/MainToolbar.tsx src/app/react/UIRoot.tsx styles/main.scss tests/unit/onlineToolbarItem.test.tsx tests/unit/onlinePanel.test.tsx tests/unit/online/openOnlineSession.test.ts tests/unit/mainToolbar.text-tool.test.tsx
git commit -m "feat(online): the online session panel and its toolbar button

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q6CPZpZ7Wn79w7u8cBLtRr"
```

---

### Task 2: Command palette, eye button, docs and full checks

**Files:**
- Create: `src/app/react/components/command-palette/onlineCommands.tsx`, `src/app/react/tabPresenting.ts`
- Modify: `src/app/react/components/CommandPalette.tsx` (one import, one hook line, one spread, one section), `src/app/services/presentToPlayers.ts` (one function), `src/app/react/components/SceneTabBar.tsx` (whole file), `src/app/react/UIRoot.tsx` (import, `presentTab`, one prop)
- Modify: `README.md` (section "Online play (preview)"), `changelog/Unreleased.md`, `src/app/changelog/releases.json` (generated)
- Test: `tests/unit/commandPalette.online.test.tsx`, `tests/unit/presentTabToPlayers.test.ts`, `tests/unit/tabPresenting.test.ts`, `tests/unit/sceneTabBar.online.test.tsx`
- Test (mocks only): `tests/unit/commandPalette.actions.test.tsx`, `tests/unit/commandPalette.panelToggles.test.tsx`

**Interfaces:**
- Consumes from Task 1:
  - `ONLINE_SESSION_LABEL`, `PRESENT_LABEL`, `STOP_PRESENTING_LABEL`, `STOP_SESSION_LABEL`, `OPEN_PLAYER_WINDOW_LABEL`, `ONLINE_SECTION_TITLE` (`src/app/online/ui/onlineCopy.ts`);
  - `useOnlineSession()` and `usePresenting()` (`src/app/react/components/online/useOnlineState.ts`);
  - the store's `setOnlinePanelOpen(open: boolean)`.
- Consumes (existing): `presentViewToPlayers(view: unknown): Promise<void>`, `stopPresenting(): void`, `presentTabInPlayerWindow(app, view, tabId): Promise<void>`, `openContextMenuGlobal(entries, position)`, `OnlineSessionService.forApp(app)?.stop()` and `AtlasView.switchToTab(tabId): Promise<void>`.
- Produces:
  - `presentTabToPlayers(view: AtlasView, tabId: string): Promise<void>`;
  - `presentTab(app: App, view: AtlasView, tabId: string): void`;
  - `openPresentMenu(app: App, view: AtlasView, tabId: string, position: { x: number; y: number }): boolean`;
  - `SceneTabBar` prop `onPresentTabMenu?: (tabId: string, position: { x: number; y: number }) => boolean`;
  - `useOnlineCommands(onClose: () => void): CommandOption[]` and `ONLINE_SECTION`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/presentTabToPlayers.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

vi.mock('../../src/app/atlas-view', () => ({ AtlasView: class AtlasView {} }));

import { AtlasView } from '../../src/app/atlas-view';
import { presentedScene } from '../../src/app/services/PresentedScene';
import { presentTabToPlayers } from '../../src/app/services/presentToPlayers';
import { createTabMetaStore } from '../../src/app/stores/tabMetaStore';

function mapView(switches: boolean): { view: AtlasView & { switchToTab: ReturnType<typeof vi.fn> }; caves: string } {
  const tabMetaStore = createTabMetaStore();
  const tavern = tabMetaStore.getState().addTab('Tavern.atlasmap', 'Tavern');
  const caves = tabMetaStore.getState().addTab('Caves.atlasmap', 'Caves');
  tabMetaStore.getState().setActiveTab(tavern);
  const view = Object.assign(Object.create(AtlasView.prototype) as AtlasView, {
    tabMetaStore,
    atlasStore: createStore(() => ({ isMapLoading: false })),
    isClosed: false,
    register: () => {},
    switchToTab: vi.fn(async (tabId: string) => { if (switches) tabMetaStore.getState().setActiveTab(tabId); }),
  });
  return { view, caves };
}

describe('presentTabToPlayers', () => {
  afterEach(() => { presentedScene.clear(); });

  // Review Focus
  it('switches to the clicked tab before presenting it', async () => {
    const { view, caves } = mapView(true);
    await presentTabToPlayers(view, caves);
    expect(view.switchToTab).toHaveBeenCalledWith(caves);
    expect(presentedScene.current()?.tabId).toBe(caves);
    expect(presentedScene.isHeld()).toBe(false);
  });

  it('presents nothing when the switch did not land on the tab', async () => {
    const { view, caves } = mapView(false);
    await presentTabToPlayers(view, caves);
    expect(presentedScene.current()).toBeNull();
  });
});
```

Create `tests/unit/tabPresenting.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { presentTabInPlayerWindow, presentTabToPlayers, openContextMenuGlobal } = vi.hoisted(() => ({
  presentTabInPlayerWindow: vi.fn(() => Promise.resolve()),
  presentTabToPlayers: vi.fn(() => Promise.resolve()),
  openContextMenuGlobal: vi.fn(),
}));

vi.mock('../../src/app/services/PlayerWindowPresenter', () => ({ presentTabInPlayerWindow }));
vi.mock('../../src/app/services/presentToPlayers', () => ({ presentTabToPlayers }));
vi.mock('../../src/app/react/root/ContextMenuContext', () => ({ openContextMenuGlobal }));

import { onlineSessionStore, resetOnlineSessionStore } from '../../src/app/online/onlineSessionStore';
import { openPresentMenu, presentTab } from '../../src/app/react/tabPresenting';
import type { ContextMenuEntry } from '../../src/app/react/root/ContextMenuContext';

const app = {} as never;
const view = {} as never;

describe('the eye button', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { resetOnlineSessionStore(); });

  it('presents in the player window and offers no menu without a session', () => {
    presentTab(app, view, 't1');
    expect(presentTabInPlayerWindow).toHaveBeenCalledWith(app, view, 't1');
    expect(presentTabToPlayers).not.toHaveBeenCalled();
    expect(openPresentMenu(app, view, 't1', { x: 1, y: 2 })).toBe(false);
    expect(openContextMenuGlobal).not.toHaveBeenCalled();
  });

  it('presents to online players only while hosting, with the player window in its menu', () => {
    onlineSessionStore.setState({ status: 'hosting' });
    presentTab(app, view, 't1');
    expect(presentTabToPlayers).toHaveBeenCalledWith(view, 't1');
    expect(presentTabInPlayerWindow).not.toHaveBeenCalled();

    expect(openPresentMenu(app, view, 't1', { x: 1, y: 2 })).toBe(true);
    const [entries, position] = openContextMenuGlobal.mock.calls[0] as [ContextMenuEntry[], { x: number; y: number }];
    expect(position).toEqual({ x: 1, y: 2 });
    expect(entries).toHaveLength(1);
    const entry = entries[0] as Extract<ContextMenuEntry, { type: 'item' }>;
    expect(entry.label).toBe('Open player window');
    entry.onClick();
    expect(presentTabInPlayerWindow).toHaveBeenCalledWith(app, view, 't1');
  });
});
```

Create `tests/unit/sceneTabBar.online.test.tsx`:

```tsx
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

it('reads "Present to players" while hosting, with its own context menu', () => {
  onlineSessionStore.setState({ status: 'hosting' });
  const onPresentTabMenu = vi.fn(() => true);
  const { tavern, onPresentTab } = renderBar(onPresentTabMenu);
  const eye = screen.getByRole('button', { name: 'Present to players' });
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
```

Create `tests/unit/commandPalette.online.test.tsx`:

```tsx
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
```

In both `tests/unit/commandPalette.actions.test.tsx` and `tests/unit/commandPalette.panelToggles.test.tsx`, add these two lines after the line `vi.mock('../../src/app/services/PlayerWindowPresenter', ...);`, so the palette's online entries load neither `AtlasView` nor PeerJS:

```tsx
vi.mock('../../src/app/services/presentToPlayers', () => ({ presentViewToPlayers: vi.fn(), stopPresenting: vi.fn() }));
vi.mock('../../src/app/online/OnlineSessionService', () => ({ OnlineSessionService: { forApp: () => undefined } }));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/presentTabToPlayers.test.ts tests/unit/tabPresenting.test.ts tests/unit/sceneTabBar.online.test.tsx tests/unit/commandPalette.online.test.tsx`
Expected: FAIL.
- `presentTabToPlayers` is not exported.
- `tabPresenting` cannot be resolved.
- No button is named "Present to players".
- The palette has no "Online play" section.

- [ ] **Step 3: presentTabToPlayers and the eye's behaviour**

In `src/app/services/presentToPlayers.ts`, add after `presentActiveTabToPlayers`:

```ts
/**
 * Switch `view` to the scene tab `tabId`, then present it to online players without
 * opening the local player window: the scene tab's eye while a session runs.
 */
export async function presentTabToPlayers(view: AtlasView, tabId: string): Promise<void> {
  await view.switchToTab(tabId);
  if (view.isClosed || view.tabMetaStore.getState().activeTabId !== tabId) return;
  await presentViewToPlayers(view);
}
```

Create `src/app/react/tabPresenting.ts`:

```ts
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
```

Replace `src/app/react/components/SceneTabBar.tsx` with:

```tsx
import React, { useState } from 'react';
import { ChevronDown, Eye, Plus, X } from 'lucide-react';
import { useStore } from 'zustand';
import { cn } from '../../../utils/cn';
import { useSceneTabStore } from '../hooks/useSceneTabStore';
import { useTabStripOverflow } from '../hooks/useTabStripOverflow';
import { usePresentedTabId } from '../hooks/usePresentedTabId';
import { useOnlineSession } from './online/useOnlineState';
import { PRESENT_LABEL } from '../../online/ui/onlineCopy';
import type { SceneTab } from '../../types/sceneTabTypes';
import { LabelTooltip, TooltipProvider } from '../../packages/components/primitives/tooltip';
import './scene-tab-bar.scss';

type MenuPosition = { x: number; y: number };

interface SceneTabBarProps {
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onAddTab: () => void;
  onPresentTab: (tabId: string) => void;
  /** The eye's context menu; returns false when it offers none, so the right-click is left alone. */
  onPresentTabMenu?: ((tabId: string, position: MenuPosition) => boolean) | undefined;
  /** Lists every open map; offered while the tabs do not fit the bar. */
  onShowAllTabs: () => void;
}

interface TabActionButtonProps {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  /** When defined the button is a toggle and stays visible while active. */
  isActive?: boolean;
  onClick: () => void;
  /** Returns true when it opened a menu of its own. */
  onContextMenu?: ((position: MenuPosition) => boolean) | undefined;
}

/** Icon button inside a tab; keeps its events from activating or closing the tab. */
function TabActionButton({ icon: Icon, label, isActive, onClick, onContextMenu }: TabActionButtonProps): React.ReactElement {
  return (
    <LabelTooltip side="bottom" label={label}>
      <button
        type="button"
        className={cn('atlas-scene-tab__action', isActive && 'atlas-scene-tab__action--active')}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onContextMenu={(e) => {
          if (!onContextMenu?.({ x: e.clientX, y: e.clientY })) return;
          e.preventDefault();
          e.stopPropagation();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        aria-pressed={isActive}
      >
        <Icon size={12} />
      </button>
    </LabelTooltip>
  );
}

export function SceneTabBar({ onSwitchTab, onCloseTab, onAddTab, onPresentTab, onPresentTabMenu, onShowAllTabs }: SceneTabBarProps): React.ReactElement | null {
  const store = useSceneTabStore();

  const tabs = useStore(store, (s) => s.tabs);
  const activeTabId = useStore(store, (s) => s.activeTabId);
  const presentedTabId = usePresentedTabId(store);
  const hosting = useOnlineSession().status === 'hosting';
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const { overflows, hiddenBefore, hiddenAfter } = useTabStripOverflow(strip, activeTabId);

  if (tabs.length === 0) return null;

  const presentLabel = (tab: SceneTab, isPresented: boolean): string => {
    if (isPresented) return `${tab.displayName} is shown to players`;
    return hosting ? PRESENT_LABEL : `Show ${tab.displayName} on the player view`;
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="atlas-scene-tab-bar">
        <div
          ref={setStrip}
          role="tablist"
          aria-label="Open maps"
          className={cn(
            'atlas-scene-tab-bar__strip',
            hiddenBefore && 'atlas-scene-tab-bar__strip--hidden-before',
            hiddenAfter && 'atlas-scene-tab-bar__strip--hidden-after',
          )}
        >
          {tabs.map((tab: SceneTab) => {
            const isActive = tab.id === activeTabId;
            const isPresented = tab.id === presentedTabId;
            const stateClass = isActive
              ? 'atlas-scene-tab--active'
              : tab.isLoaded
                ? 'atlas-scene-tab--loaded'
                : 'atlas-scene-tab--sleeping';

            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                tabIndex={0}
                className={`atlas-scene-tab ${stateClass}`}
                onClick={() => onSwitchTab(tab.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSwitchTab(tab.id);
                  }
                }}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    onCloseTab(tab.id);
                  }
                }}
              >
                <LabelTooltip side="bottom" label={tab.filePath}>
                  <span className="atlas-scene-tab__name">{tab.displayName}</span>
                </LabelTooltip>
                {tab.isDirty && <span className="atlas-scene-tab__dirty" />}
                <TabActionButton
                  icon={Eye}
                  label={presentLabel(tab, isPresented)}
                  isActive={isPresented}
                  onClick={() => onPresentTab(tab.id)}
                  onContextMenu={onPresentTabMenu && ((position) => onPresentTabMenu(tab.id, position))}
                />
                <TabActionButton icon={X} label={`Close ${tab.displayName}`} onClick={() => onCloseTab(tab.id)} />
              </div>
            );
          })}
        </div>
        {overflows && (
          <LabelTooltip side="bottom" label="All open maps">
            <button
              type="button"
              className="atlas-scene-tab atlas-scene-tab-bar__button"
              aria-haspopup="dialog"
              onClick={onShowAllTabs}
            >
              <ChevronDown size={14} />
            </button>
          </LabelTooltip>
        )}
        <LabelTooltip side="bottom" label="Open scene">
          <button
            type="button"
            className="atlas-scene-tab atlas-scene-tab-bar__button atlas-scene-tab-bar__add"
            onClick={onAddTab}
          >
            <Plus size={14} />
          </button>
        </LabelTooltip>
      </div>
    </TooltipProvider>
  );
}
```

In `src/app/react/UIRoot.tsx`:
- replace `import { presentTabInPlayerWindow } from '../services/PlayerWindowPresenter';` with `import { openPresentMenu, presentTab as presentTabFor } from './tabPresenting';`;
- replace the `presentTab` function with:

```tsx
  // While an online session runs the eye presents to online players only; its menu opens the player window.
  const presentTab = (tabId: string): void => {
    if (view) presentTabFor(app, view, tabId);
  };
  const presentTabMenu = (tabId: string, position: { x: number; y: number }): boolean =>
    view ? openPresentMenu(app, view, tabId, position) : false;
```

- in the `<SceneTabBar ...>` props, after `onPresentTab={presentTab}` add `onPresentTabMenu={presentTabMenu}`. `SceneSwitcher` keeps `onPresentTab={presentTab}`.

- [ ] **Step 4: The palette's online entries**

Create `src/app/react/components/command-palette/onlineCommands.tsx`:

```tsx
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
```

In `src/app/react/components/CommandPalette.tsx`:
- after `import { isSettingsPanelId, type CommandOption, type SettingsPanelId } from './command-palette/types';` add `import { ONLINE_SECTION, useOnlineCommands } from './command-palette/onlineCommands';`;
- after `  const setLootRollerOpen = useAtlasStore(state => state.setLootRollerOpen);` add `  const onlineCommands = useOnlineCommands(onClose);`;
- in `commandOptions`, the array ends with the `local-player-view-settings` option and `  ];`. Insert `    ...onlineCommands,` on its own line just before that `  ];` (the line before `  // Derive rows from current state so open-menu toggles stay in sync.`);
- in `sections`, after `    { id: 'settings', title: 'Settings' },` add `    ONLINE_SECTION,`.

No tab is added: the tab cycle stays All, Tools, Mode, Settings.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/presentTabToPlayers.test.ts tests/unit/tabPresenting.test.ts tests/unit/sceneTabBar.online.test.tsx tests/unit/sceneTabBar.presented.test.tsx tests/unit/sceneTabBar.overflow.test.tsx tests/unit/sceneSwitcher.test.tsx tests/unit/commandPalette.online.test.tsx tests/unit/commandPalette.actions.test.tsx tests/unit/commandPalette.panelToggles.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit the code**

```bash
git add src/app/services/presentToPlayers.ts src/app/react/tabPresenting.ts src/app/react/components/SceneTabBar.tsx src/app/react/UIRoot.tsx src/app/react/components/command-palette/onlineCommands.tsx src/app/react/components/CommandPalette.tsx tests/unit/presentTabToPlayers.test.ts tests/unit/tabPresenting.test.ts tests/unit/sceneTabBar.online.test.tsx tests/unit/commandPalette.online.test.tsx tests/unit/commandPalette.actions.test.tsx tests/unit/commandPalette.panelToggles.test.tsx
git commit -m "feat(online): online play in the command palette and on the scene tab's eye

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q6CPZpZ7Wn79w7u8cBLtRr"
```

- [ ] **Step 7: README and changelog**

In `README.md`, section "## Online play (preview)", insert this paragraph after the first paragraph (the one ending "Run **Stop online session** to end the session."):

```markdown
In a map view, the **Online session** button in the toolbar opens the online panel; **Online session…** opens it too. The panel shows the join link with a copy button, players waiting to join with **Allow** and **Deny**, each player's tokens with **Controlled by** to change them and **Remove player**, the presented scene with **Present to players** or **Stop presenting**, and **Stop online session**. The same actions are in Atlas's command palette under Online play. While a session runs, a scene tab's eye button presents that scene to online players without opening the player window; right-click it and pick **Open player window** to open the player window too.
```

`changelog/Unreleased.md` has CRLF line endings: keep them. In the **Online Play (preview)** list, insert this bullet before the one that starts "- **Log online play events**":

```markdown
- Run online play from the map: the **Online session** button in the toolbar opens a panel with the join link, players waiting to join, each player's tokens (change them with **Controlled by**), the presented scene and **Stop online session**. The button shows a dot while you host and how many players wait to join. The command palette lists the same actions under Online play, and while a session runs a scene tab's eye shows the scene to online players only; right-click it for **Open player window**.
```

Run: `file changelog/Unreleased.md && npm run changelog:generate && npm run changelog:check`
Expected: `file` still reports "with CRLF line terminators". The generator rewrites `src/app/changelog/releases.json`, and the check exits 0.

- [ ] **Step 8: Full checks**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run build:ci && npm run changelog:check`
Expected: each exits 0.

Run: `wc -l src/app/react/components/online/* src/app/online/ui/*.ts src/app/react/tabPresenting.ts src/app/react/components/command-palette/onlineCommands.tsx src/app/react/components/SceneTabBar.tsx src/app/packages/components/MainToolbar.tsx src/app/react/components/CommandPalette.tsx`
Expected:
- every new file is under 200 lines;
- `SceneTabBar.tsx` is under 170;
- `MainToolbar.tsx` is under 270;
- `CommandPalette.tsx` is at most 947 (943 before).

Run: `git diff --stat main -- src/app/online/GmSession.ts src/app/online/OnlineSessionService.ts src/app/online/protocol.ts src/app/online/transport online-client`
Expected: no output (no session, protocol, transport or join page changes).

- [ ] **Step 9: Commit the docs**

```bash
git add README.md changelog/Unreleased.md src/app/changelog/releases.json
git commit -m "docs(online): the GM's online controls inside Atlas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q6CPZpZ7Wn79w7u8cBLtRr"
```

- [ ] **Step 10: Manual test (by the user; the controller hands over these steps)**

Build and reload: run `npm run build` (it copies the plugin to the vault), then `npm run obsidian:reload`.

1. **Start from the toolbar.**
   - Open a scene. The toolbar has an **Online session** button (network icon).
   - Click it: the panel rises in at the top right, below the scene tabs, with **Start online session** and one line on what it does.
   - Click **Start online session**: "Starting…", then "Connected", the join link and **Stop online session**. The toolbar button shows a green dot, and its tooltip reads "Hosting".
2. **Narrow window.** Make the window narrow until tools move into **More tools**. With the panel open, the online button stays in the bar. Close the panel: it can move into **More tools**, where **Online session** opens it again.
3. **Allow a player.**
   - Open the link in a browser and ask to join. The button's dot becomes a "1" badge, the panel lists the player under "Waiting to join", and the join notice still appears.
   - Close the panel and repeat with a second browser: the notice appears with the panel closed too.
   - Click **Allow** in the panel: the player moves to "Players", and the badge goes back to a dot.
4. **Assign a token in the panel.**
   - The player's row says "Present a scene to give players tokens." Present the scene with the panel's **Present to players**: "Players see {scene}.".
   - Click **Controlled by**: a menu lists the scene's character tokens. Pick one: the menu closes, a chip with its name appears, and on the player's page the token gets its ring and can be dragged.
   - Open **Controlled by** again: that token is ticked. Pick it again to take it away.
   - Right-click the token on the map: its **Controlled by** submenu agrees with the panel.
5. **Held scene.** Switch the view to another scene tab. The player's chips disappear, **Controlled by** is disabled and the panel says "Switch back to {scene} to change tokens.". Switch back: the chip and the picker return.
6. **Present with the eye.**
   - With the session running, hover a scene tab's eye: "Present to players". Click the eye of another tab: Atlas switches to it, players see it, and no player window opens.
   - Right-click the eye: a menu with **Open player window**. Pick it: the player window opens showing that scene.
7. **Command palette.**
   - Open Atlas's command palette. "Online play" lists **Online session**, **Stop presenting** and **Stop online session**, and **Present to players** when the active tab is not the presented one.
   - **Online session** opens the panel and closes the palette.
8. **Obsidian command.**
   - With the panel closed, run **Online session…** from Obsidian's command palette: the panel opens in the active map view.
   - Close every Atlas view and run it again: the Obsidian modal opens.
   - Click the status bar's "Online · 1 player": the same opener runs.
9. **Stop.**
   - With the panel open, click **Remove player**: the player's page shows the removal.
   - Then stop the session with the panel's **Stop online session** (or the Obsidian command **Stop online session**): the panel goes back to **Start online session**, the dot leaves the button, the eye reads "Show {scene} on the player view" again, and right-clicking it shows no menu.

---

## Spec coverage

| Spec requirement | Task |
| --- | --- |
| Toolbar `ToolButton`, network icon, `PRIORITY`, `menuEntry`, pinned while open | 1 (Steps 1, 4) |
| Dot while hosting, badge with waiting count, click toggles | 1 (Steps 1, 4) |
| Panel with the loot roller's treatment, reading the store and calling the service | 1 (Step 5) |
| Not hosting: **Start online session** and one line | 1 |
| Hosting: status, link with copy, Allow/Deny, players with chips, **Controlled by**, **Remove player**, presented scene with Present/Stop, **Stop online session** | 1 |
| Join notices still appear with the panel closed | unchanged code; manual step 3 |
| **Online session…** opens the panel, else the modal | 1 (`openOnlineSession`) |
| Palette "Online play": four entries with their conditions | 2 (Steps 1, 4) |
| Eye presents with `presentViewToPlayers` while hosting, label "Present to players" | 2 (Step 3) |
| Eye context menu **Open player window**; unchanged without a session | 2 (Step 3) |
| Manual test | 2 (Step 10) |
| README, changelog | 2 (Step 7) |
