# Online Scene Sync (Online Play, Piece 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send the presented scene to every admitted online player, filtered to exactly what the local player window shows, keep it current within about 100 ms, and draw a live preview of it on the join page.

**Architecture:** A pure projection (`projectForPlayers`) turns the presented view store into a `PlayerScene` wire object, using a coarse fog-coverage bitmap to drop anything completely under fog and an `AssetRegistry` to replace vault paths with random ids. `PresentedScene` (one per plugin) knows which scene is presented, held or cleared; the local player window and a new `SceneBroadcaster` (a `GmSession` handler) both follow it. The broadcaster sends snapshots (fog split into parts) and 50 ms-batched per-record patches with a per-player `seq`; the player side's `PlayerSceneMirror` applies them, resyncs on gaps, and feeds a 2D canvas preview on the join page.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), zustand (vanilla stores), Obsidian API, Vitest (jsdom, no canvas), Vite (join page build).

**Spec:** `docs/superpowers/specs/2026-09-30-online-scene-sync-design.md` (builds on `docs/superpowers/specs/2026-09-29-online-sessions-design.md` and `docs/superpowers/plans/2026-09-29-online-sessions.md`).

## Global Constraints

- Control channel, protocol version `1` (`PROTOCOL_VERSION`), envelope `{ v: 1, type, ...fields }`. New types: `scene-snapshot`, `scene-fog`, `scene-drawings`, `scene-patch`, `scene-clear` (GM → player) and `scene-resync` (player → GM). Every one is validated on both sides; unknown types stay ignored.
- Changes are batched and sent at most every **50 ms** (`SCENE_TICK_MS = 50`); they should reach players within about 100 ms. An empty diff sends nothing.
- Fog coverage: one cell per **8 world pixels** (`FOG_CELL_SIZE = 8`). Coverage is conservative: an object is sent unless it is completely covered.
- Fog operation and drawing points are simplified to **1 world pixel** (`SIMPLIFY_TOLERANCE = 1`).
- No message exceeds **256 KB** (`MAX_CONTROL_MESSAGE_BYTES = 256 * 1024`): a snapshot carries neither fog nor drawings; they follow in `scene-fog` and `scene-drawings` parts (`seq`, `part`, `records`), counted by the snapshot's `fogParts` and `drawingParts`. A patch that would exceed the limit is replaced by a snapshot. If the snapshot without fog and drawings still exceeds it, players get `scene-clear` and the GM gets one Notice: "This scene is too large to send to online players."
- `seq` increases by one per message to a player. A player that sees a gap, or a patch before a snapshot, discards it and sends `scene-resync` with the last `seq` it applied. Invalid scene messages on the player side are ignored and followed by a `scene-resync`, at most once per second (`RESYNC_MIN_INTERVAL_MS = 1000`).
- Snapshots go out on `onAdmitted` (including a new tab replacing an old one), on `presented`, and on resume. `cleared` sends `scene-clear`. Everyone admitted gets the same messages: one projection per scene, not per player.
- Online players follow the existing `localPlayerView` settings: `showGrid`, `showTokenHP`, `showTokenStress`, `showTokenNameplates`, `showWidgets`, `showInitiative`.
- Asset ids are random per online session and stable within it. Vault paths never leave the GM's machine.
- `projectForPlayers` copies named fields into new objects and never spreads GM records.
- Never sent: hidden tokens (`isHidden`), pins and hex links, notes and statblock paths, `dmNotePath`, pinned note previews, loot state, the dice log, walls, lights and audio (`WALLS_AND_LIGHTING_ENABLED = false`), vision radii, tags, player-character links, and anything completely under fog.
- One presented scene per vault, for the local window and online players. Existing present commands keep their behaviour (they also open the local window). New command and view-actions item: **Present to players** (no local window) and **Stop presenting**.
- Shared with the web page, so no imports from `obsidian`, PIXI, PeerJS or React: `src/app/online/protocol.ts`, `src/app/online/PlayerSession.ts`, everything in `src/app/online/scene/` that the page imports (`sceneTypes.ts`, `sceneValidation.ts`, `sceneDiff.ts`, `PlayerSceneMirror.ts`) and `src/app/online/preview/`.
- `src/app/online/GmSession.ts` (317 lines) is not modified: the broadcaster plugs in through `session.use`.
- Wire fields are `T | null`, never optional, because `exactOptionalPropertyTypes` is on and JSON drops `undefined`. Every block of code in this plan compiles under `strict`, `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.
- Code style (CLAUDE.md, CONTRIBUTING.md, ESLint): explicit return types; files under about 300 lines; `window.setTimeout` / `window.clearTimeout` / `window.requestAnimationFrame` in `src` (`obsidianmd/prefer-window-timers`); sentence-case UI text (`obsidianmd/ui/sentence-case`); no inline `eslint-disable` (`noInlineConfig`); no `title` attributes; player-facing changes in `changelog/Unreleased.md`.
- Tests live in `tests/unit/online/` (Vitest, jsdom, no real canvas), except tests of existing non-online modules, which sit next to their current tests in `tests/unit/`. Rasterisers and drawing logic are pure TypeScript; the join page's canvas drawing is a thin untested layer over tested pure functions.

## Review Focus

- **A held scene is never projected again.** While the GM browses another tab, the presented store holds that other map. A settings change, an admission or a `scene-resync` during the hold must reuse the last projection sent (same `sceneId`, same tokens); if nothing was sent yet, players get `scene-clear`. Test in Task 8 (`keeps sending the held scene while the GM browses another tab`).
- **A scene presented before the session starts reaches joiners.** The broadcaster only hears `presented` events, so it must read the current presentation when it starts. Test in Task 8 (`sends a scene presented before the session started`) and Task 8's service test.
- **Nothing presented is answered with `scene-clear`.** On admission and on `scene-resync` with nothing to show, a player who reconnects after the GM stopped presenting must drop the stale scene. Test in Task 8 (`clears a stale scene on a player who reconnects after presenting stopped`).
- **Messy GM data still passes the player's validator.** Older or hand-edited map files hold string HP, `NaN` coordinates, missing font sizes and `null` points; one bad value would make every snapshot invalid and loop the player on resyncs. Test in Task 4 (`projects messy map data into messages players accept`).
- **A GM record with an unknown new field never leaks.** A future Atlas field on a token, text, drawing, fog operation, widget or initiative entry must not appear in the projection. Test in Task 4 (`never sends a GM-only or unknown field`).
- **A scene with many drawings still reaches players.** A freehand stroke is 1–4 KB even simplified, so 60–100 strokes would push a single snapshot past 256 KB; drawings travel in `scene-drawings` parts and the player shows the scene once every part arrived. Test in Task 8 (`sends a scene with many drawings in parts`) and Task 6 (`waits for the drawing parts too`).

The spec's other likely failures have tests too: a token half under fog is still sent (Task 4), a patch before its snapshot triggers a resync (Task 6), HP toggled mid-session reaches players (Task 8), presenting a different scene replaces the old one with a new `sceneId` (Task 8).

## Decisions made while planning

The spec leaves these open; each task repeats the one it needs.

1. **Background size.** `PresentedScene` reads `view.renderer?.getBackgroundSprite()` (`PixiRendererOrchestrator.getBackgroundSprite()`, public) when the broadcaster projects: its `width`/`height`, or 0 × 0 when there is no sprite, it is destroyed or has no width. The background sits at the world origin, as `GridAlignmentController.getMapBounds` assumes.
2. **`map.cellSize` added to the wire shape.** `PlayerToken.size` is in cells, but `grid` is null when `showGrid` is off, so the page could not size tokens. `map` carries `cellSize` (the grid size in world pixels, 70 by default); it reveals nothing the map image does not.
3. **Text box estimate.** Width = longest line × font size × 0.6, height = lines × font size × 1.25 (or the stored `width`/`height`), plus padding on each side, times `scale`, centred on `(x, y)` (texts are anchored at their centre, `TextRenderer`). A rotated text uses a square of the box's diagonal.
4. **Point simplification.** Iterative Ramer–Douglas–Peucker at 1 world pixel, then coordinates rounded to 0.1 px; at most 5 000 points per shape (the tolerance doubles until it fits), which keeps any one fog operation under a fog part's budget.
5. **Map loading.** `PresentedScene` and the broadcaster read `isMapLoading` from the view store. A held scene resumes only once the store reports loading finished, re-checked after the wait because `performSceneLoad` sets it right after the tab switch. The broadcaster ignores store writes while loading and sends a snapshot when loading ends.
6. **One `PresentedScene` per plugin.** A module singleton `presentedScene`, like `playerWindowStore` (the plugin is per vault). The class is exported for tests.
7. **Local window and presenting.** The local window's hold/resume/release now follows `PresentedScene`. Closing the local window does not stop presenting to online players. **Stop presenting** holds the local window's last frame and releases the view (`releaseSource`), as closing the presented view does today. "Present to players" re-targets an open local window. The scene tab bar's "presented" marker follows `PresentedScene` (`usePresentedTabId`), so a scene presented only to online players shows it too.
8. **Fog coverage bitmap.** It spans the painted operations' bounds; cells double in size beyond 4 000 000 cells. Paint fogs only cells it covers whole; erase clears every cell it touches (lassos: cells crossed by an edge count as touched, found by exact grid traversal).
9. **Oversized snapshot (controller ruling).** Fog and drawings both travel in parts after the snapshot. If what remains (map, grid, tokens, texts, widgets, initiative) still exceeds the limit, players get `scene-clear` instead of a stale or partial scene, the GM sees the Notice "This scene is too large to send to online players." once per presentation, and later changes retry a snapshot rather than a patch. The broadcaster takes a `notify(message)` option; `OnlineSessionService` passes one that shows an Obsidian `Notice`, so the broadcaster imports nothing from Obsidian.
10. **Replay order.** Fog operations and drawings are ordered by timestamp (`order` on the wire), then by id, on both sides.
11. **Token footprint.** A square of `max(1, 2 × size − 1)` cells × grid size (`tokenDiameterInCells`), centred on the token.
12. **Initiative entries.** `id, tokenId, initiative, name, hp, isActive`; no image, stress, statblock or defeated flag; `isActive` only while combat runs.
13. **Developer-tools check.** The join page sets `window.atlasScene` to the scene it holds, so the manual test can confirm a fogged token is absent from its data.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/app/online/scene/sceneTypes.ts` | Wire types (`PlayerScene` and parts), limits, value lists, `sortedByOrder`. Shared. |
| `src/app/online/scene/sceneValidation.ts` | Bounded validators for scene messages (own keys, safe ids). Shared. |
| `src/app/online/protocol.ts` (modify) | The five scene message types and their validators. |
| `src/app/online/scene/coerce.ts` | Coerces GM values of any shape into wire values. |
| `src/app/online/scene/simplifyPoints.ts` | RDP simplification and `wirePoints`. |
| `src/app/online/scene/FogCoverage.ts` | Pure fog rasteriser and `isCovered`. |
| `src/app/online/scene/AssetRegistry.ts` | Vault path → random asset id, per session. |
| `src/app/online/scene/objectBounds.ts` | Token, text and drawing bounds for coverage checks. |
| `src/app/online/scene/playerViewRules.ts` | The six player view settings the projection follows. |
| `src/app/online/scene/projectRecords.ts` | Fog, text and drawing projection; projection memo. |
| `src/app/online/scene/projectPanels.ts` | Widget and initiative projection. |
| `src/app/online/scene/projectForPlayers.ts` | The projection: tokens, grid, map, and assembly. |
| `src/app/online/scene/sceneDiff.ts` | `diffScenes`, `applyPatch`, `sameValue`. Shared. |
| `src/app/online/scene/PlayerSceneMirror.ts` | Player side: applies scene messages, resyncs. Shared. |
| `src/app/online/PlayerSession.ts` (modify) | Routes scene messages to its mirror; `onScene`. |
| `src/app/services/PresentedScene.ts` | Which scene is presented, held or cleared; `whenMapLoaded`. |
| `src/app/services/presentToPlayers.ts` | "Present to players" and "Stop presenting" actions. |
| `src/app/services/PlayerWindowPresenter.ts` (modify) | The local window follows `PresentedScene`. |
| `src/app/plugin/registerCommands.ts` (modify) | The two new commands. |
| `src/app/react/components/ViewActionsMenu.tsx` (modify) | The two new menu items. |
| `src/app/react/hooks/usePresentedTabId.ts` | The presented tab of a view, for the scene tab bar. |
| `src/app/react/components/SceneTabBar.tsx` (modify) | The "presented" marker follows `PresentedScene`. |
| `main.ts` (modify) | Clears the presented scene on unload. |
| `src/app/online/scene/sceneMessages.ts` | Snapshot with fog and drawing parts, patch size check. |
| `src/app/online/scene/SceneBroadcaster.ts` | GM side: snapshots, 50 ms patches, clear, resync. |
| `src/app/online/OnlineSessionService.ts` (modify) | Starts and stops the broadcaster with the session. |
| `src/app/online/preview/previewLayout.ts` | World bounds of a scene and the fit transform. Shared. |
| `src/app/online/preview/previewShapes.ts` | Grid lines, fog shapes, ink, labels, token markers. Shared. |
| `src/app/online/preview/sceneSummary.ts` | Widget and initiative text lines. Shared. |
| `online-client/preview.mts` | Thin canvas layer drawing the shapes. |
| `online-client/index.html`, `online-client/main.mts`, `online-client/style.css` (modify) | Preview canvas, widget and initiative lists. |
| `README.md`, `changelog/Unreleased.md` (modify) | Player-facing documentation. |

Tests: `tests/unit/online/sceneFixtures.ts` (shared fixtures), `sceneProtocol.test.ts`, `fogCoverage.test.ts`, `projectParts.test.ts`, `projectForPlayers.test.ts`, `sceneDiff.test.ts`, `playerSceneMirror.test.ts`, `playerSessionScene.test.ts`, `sceneBroadcaster.test.ts`, `onlineSessionService.test.ts` (modify), `scenePreview.test.ts`; `tests/unit/presentedScene.test.ts`, `tests/unit/presentToPlayers.test.ts`, `tests/unit/sceneTabBar.presented.test.tsx`, `tests/unit/playerWindowPresenter.test.ts` (modify).

Task order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10. Tasks 5–7 do not depend on each other's code; Task 8 needs 4, 5 and 7; Task 9 needs 6.

---
### Task 1: Scene wire types, validation and protocol messages

**Files:**
- Create: `src/app/online/scene/sceneTypes.ts`, `src/app/online/scene/sceneValidation.ts`
- Modify: `src/app/online/protocol.ts` (header comment and imports, `ControlMessage` union, `VALIDATORS`)
- Create: `tests/unit/online/sceneFixtures.ts`
- Test: `tests/unit/online/sceneProtocol.test.ts`

**Interfaces:**
- Consumes: `protocol.ts` as it is (`ControlMessage`, `VALIDATORS`, `decodeControl`, `encodeControl`).
- Produces (all from `sceneTypes.ts` unless noted):
  - `interface ScenePoint { x: number; y: number }`, `interface MapSize { width: number; height: number }`
  - `interface PlayerMap { asset: string | null; width: number; height: number; cellSize: number }`
  - `PLAYER_GRID_TYPES = ['square', 'hex-horizontal', 'hex-vertical'] as const` / `type PlayerGridType`; `PLAYER_GRID_LINES = ['solid', 'dashed', 'dotted'] as const` / `type PlayerGridLine`; `PLAYER_HEX_NUMBERS = ['column-row', 'sequential'] as const` / `type PlayerHexNumbers`
  - `interface PlayerGrid { type: PlayerGridType; size: number; offsetX: number; offsetY: number; color: string | null; opacity: number; lineType: PlayerGridLine; lineWidth: number; hexNumbers: PlayerHexNumbers | null; hexNumberOpacity: number | null }`
  - `interface PlayerResource { current: number; max: number }`, `interface PlayerCondition { id: string; value: number | null }`
  - `interface PlayerToken { x: number; y: number; size: number; rotation: number; layer: number; image: string | null; ring: string | null; conditions: PlayerCondition[]; name: string | null; hp: PlayerResource | null; stress: PlayerResource | null }`
  - `type PlayerFogOp = { type: 'brush'; erase: boolean; order: number; radius: number; points: ScenePoint[] } | { type: 'lasso'; erase: boolean; order: number; points: ScenePoint[] } | { type: 'rectangle'; erase: boolean; order: number; x: number; y: number; width: number; height: number }`
  - `PLAYER_TEXT_ALIGNS = ['left', 'center', 'right'] as const` / `type PlayerTextAlign`; `interface PlayerText { x; y; text: string; fontSize; fontFamily: string; color: string; backgroundColor: string | null; padding; borderRadius; opacity; width: number | null; height: number | null; align: PlayerTextAlign; bold: boolean; italic: boolean; rotation; scale }` (unmarked fields are `number`)
  - `PLAYER_DRAWING_TYPES = ['pen', 'eraser', 'line', 'rectangle', 'circle', 'icon'] as const` / `type PlayerDrawingType`; `interface PlayerDrawing { type: PlayerDrawingType; order: number; points: ScenePoint[]; color: string; width: number; opacity: number; icon: string | null }`
  - `PLAYER_WIDGET_TYPES = ['counter', 'clock', 'timer'] as const` / `type PlayerWidgetType`; `interface PlayerWidget { id: string; type: PlayerWidgetType; label: string; icon: string; value: number }`
  - `interface PlayerInitiativeEntry { id: string; tokenId: string; initiative: number; name: string | null; hp: PlayerResource | null; isActive: boolean }`, `interface PlayerInitiative { round: number; active: boolean; entries: PlayerInitiativeEntry[] }`
  - `interface PlayerScene { sceneId: string; map: PlayerMap; grid: PlayerGrid | null; tokens: Record<string, PlayerToken>; fog: Record<string, PlayerFogOp>; texts: Record<string, PlayerText>; drawings: Record<string, PlayerDrawing>; widgets: PlayerWidget[]; initiative: PlayerInitiative | null }`
  - `type PlayerSceneBody = Omit<PlayerScene, 'fog' | 'drawings'>`
  - `SCENE_RECORD_KEYS = ['tokens', 'fog', 'texts', 'drawings'] as const` / `type SceneRecordKey`; `SCENE_FIELD_KEYS = ['map', 'grid', 'widgets', 'initiative'] as const` / `type SceneFieldKey`
  - `interface ScenePatchBody { set: Partial<Pick<PlayerScene, SceneFieldKey>>; upsert: Partial<Pick<PlayerScene, SceneRecordKey>>; remove: Partial<Record<SceneRecordKey, string[]>> }`
  - `SCENE_LIMITS = { idLength: 128, stringLength: 512, textLength: 10_000, points: 5_000, records: 10_000, conditions: 64, widgets: 64, initiativeEntries: 200 } as const`
  - `sortedByOrder<T>(records: Readonly<Record<string, T>>, orderOf: (record: T) => number): Array<[string, T]>`
  - `sceneValidation.ts`: `isSceneId(value: unknown): value is string`, `isSceneSeq(value: unknown): value is number` (safe integer ≥ 1), `isLastSeq(value: unknown): value is number` (safe integer ≥ 0), `isSceneCount(value: unknown): value is number` (integer 0 to 10 000), `isPlayerSceneBody(value: unknown): boolean`, `isFogRecords(value: unknown): boolean`, `isDrawingRecords(value: unknown): boolean`, `isScenePatchBody(message: Record<string, unknown>): boolean`
  - `protocol.ts` `ControlMessage` gains:
    - `{ v: 1; type: 'scene-snapshot'; seq: number; scene: PlayerSceneBody; fogParts: number; drawingParts: number }`
    - `{ v: 1; type: 'scene-fog'; seq: number; part: number; records: Record<string, PlayerFogOp> }`
    - `{ v: 1; type: 'scene-drawings'; seq: number; part: number; records: Record<string, PlayerDrawing> }`
    - `{ v: 1; type: 'scene-patch'; seq: number; set: ScenePatchBody['set']; upsert: ScenePatchBody['upsert']; remove: ScenePatchBody['remove'] }`
    - `{ v: 1; type: 'scene-clear'; seq: number }`
    - `{ v: 1; type: 'scene-resync'; seq: number }`
  - A scene message that fails its check decodes as `{ kind: 'invalid', reason: 'bad-scene-…' }` (for example `bad-scene-patch`); Task 6 relies on the `bad-scene-` prefix.
  - Test fixtures in `tests/unit/online/sceneFixtures.ts`: `playerToken(overrides?: Partial<PlayerToken>): PlayerToken`, `fogRect(order: number, overrides?): PlayerFogOp`, `playerScene(overrides?: Partial<PlayerScene>): PlayerScene`, `sceneBody(scene: PlayerScene): PlayerSceneBody`.

- [ ] **Step 1: Write the shared test fixtures**

```ts
// tests/unit/online/sceneFixtures.ts
import type { PlayerFogOp, PlayerScene, PlayerSceneBody, PlayerToken } from '../../../src/app/online/scene/sceneTypes';

export function playerToken(overrides: Partial<PlayerToken> = {}): PlayerToken {
  return {
    x: 100, y: 100, size: 1, rotation: 0, layer: 0, image: 'asset-1', ring: '#ffffff',
    conditions: [], name: null, hp: null, stress: null, ...overrides,
  };
}

export function fogRect(order: number, overrides: Partial<Extract<PlayerFogOp, { type: 'rectangle' }>> = {}): PlayerFogOp {
  return { type: 'rectangle', erase: false, order, x: 0, y: 0, width: 100, height: 100, ...overrides };
}

export function playerScene(overrides: Partial<PlayerScene> = {}): PlayerScene {
  return {
    sceneId: 'scene-1',
    map: { asset: 'map-asset', width: 1000, height: 800, cellSize: 70 },
    grid: {
      type: 'square', size: 70, offsetX: 0, offsetY: 0, color: null, opacity: 0.5,
      lineType: 'solid', lineWidth: 1, hexNumbers: null, hexNumberOpacity: null,
    },
    tokens: { t1: playerToken() },
    fog: { f1: fogRect(1) },
    texts: {
      x1: {
        x: 50, y: 50, text: 'Tavern', fontSize: 24, fontFamily: 'serif', color: '#000000', backgroundColor: null,
        padding: 4, borderRadius: 0, opacity: 1, width: null, height: null, align: 'center',
        bold: false, italic: false, rotation: 0, scale: 1,
      },
    },
    drawings: {
      d1: { type: 'pen', order: 1, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: '#ff0000', width: 4, opacity: 1, icon: null },
    },
    widgets: [{ id: 'w1', type: 'counter', label: 'Torches', icon: 'flame', value: 3 }],
    initiative: { round: 1, active: true, entries: [{ id: 'e1', tokenId: 't1', initiative: 15, name: null, hp: null, isActive: true }] },
    ...overrides,
  };
}

/** The scene as a snapshot carries it: everything but the fog and the drawings. */
export function sceneBody(scene: PlayerScene): PlayerSceneBody {
  const { fog: _fog, drawings: _drawings, ...body } = scene;
  return body;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/online/sceneProtocol.test.ts
import { describe, expect, it } from 'vitest';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { SCENE_LIMITS, sortedByOrder } from '../../../src/app/online/scene/sceneTypes';
import { fogRect, playerScene, playerToken, sceneBody } from './sceneFixtures';

const decodeRaw = (value: unknown): ReturnType<typeof decodeControl> => decodeControl(JSON.stringify(value));

describe('scene messages', () => {
  it('round-trips every scene message type', () => {
    const scene = playerScene();
    const messages: ControlMessage[] = [
      { v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 1, drawingParts: 1 },
      { v: 1, type: 'scene-fog', seq: 2, part: 0, records: scene.fog },
      { v: 1, type: 'scene-drawings', seq: 3, part: 0, records: scene.drawings },
      {
        v: 1, type: 'scene-patch', seq: 3,
        set: { grid: null, widgets: [] },
        upsert: { tokens: { t2: playerToken({ x: 5 }) }, fog: { f2: fogRect(2, { erase: true }) } },
        remove: { texts: ['x1'] },
      },
      { v: 1, type: 'scene-clear', seq: 4 },
      { v: 1, type: 'scene-resync', seq: 0 },
    ];
    for (const message of messages) {
      expect(decodeControl(encodeControl(message))).toEqual({ kind: 'message', message });
    }
  });

  it('accepts every fog operation shape and rejects broken ones', () => {
    const records = {
      brush: { type: 'brush', erase: false, order: 1, radius: 20, points: [{ x: 0, y: 0 }] },
      lasso: { type: 'lasso', erase: true, order: 2, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }] },
      rect: fogRect(3),
    };
    expect(decodeRaw({ v: 1, type: 'scene-fog', seq: 1, part: 0, records }).kind).toBe('message');
    const broken = [
      { type: 'brush', erase: false, order: 1, radius: 20, points: [] },
      { type: 'brush', erase: false, order: 1, radius: 0, points: [{ x: 0, y: 0 }] },
      { type: 'lasso', erase: false, order: 1, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
      { type: 'rectangle', erase: false, order: 1, x: 0, y: 0, width: 'wide', height: 5 },
      { type: 'circle', erase: false, order: 1 },
    ];
    for (const op of broken) {
      expect(decodeRaw({ v: 1, type: 'scene-fog', seq: 1, part: 0, records: { a: op } }))
        .toEqual({ kind: 'invalid', reason: 'bad-scene-fog' });
    }
  });

  it('checks drawing parts like fog parts', () => {
    const drawings = playerScene().drawings;
    expect(decodeRaw({ v: 1, type: 'scene-drawings', seq: 1, part: 0, records: drawings }).kind).toBe('message');
    const bad = { d: { type: 'pen', order: 1, points: [], color: '#000000', width: 1, opacity: 1, icon: null } };
    expect(decodeRaw({ v: 1, type: 'scene-drawings', seq: 1, part: 0, records: bad }))
      .toEqual({ kind: 'invalid', reason: 'bad-scene-drawings' });
  });

  it('rejects a snapshot with a malformed record or a missing field', () => {
    const body = sceneBody(playerScene());
    const badToken = { ...body, tokens: { t1: { ...playerToken(), hp: { current: 'lots', max: 10 } } } };
    expect(decodeRaw({ v: 1, type: 'scene-snapshot', seq: 1, scene: badToken, fogParts: 0, drawingParts: 0 }))
      .toEqual({ kind: 'invalid', reason: 'bad-scene-snapshot' });
    expect(decodeRaw({ v: 1, type: 'scene-snapshot', seq: 1, scene: body, fogParts: 0 }).kind).toBe('invalid');
    const { grid: _grid, ...withoutGrid } = body;
    expect(decodeRaw({ v: 1, type: 'scene-snapshot', seq: 1, scene: withoutGrid, fogParts: 0, drawingParts: 0 }).kind).toBe('invalid');
  });

  it('refuses record ids that assignment would treat specially', () => {
    const raw = `{"v":1,"type":"scene-fog","seq":1,"part":0,"records":{"__proto__":${JSON.stringify(fogRect(1))}}}`;
    expect(decodeControl(raw)).toEqual({ kind: 'invalid', reason: 'bad-scene-fog' });
    const patch = { v: 1, type: 'scene-patch', seq: 2, set: {}, upsert: {}, remove: { tokens: ['constructor'] } };
    expect(decodeRaw(patch)).toEqual({ kind: 'invalid', reason: 'bad-scene-patch' });
  });

  it('bounds sequence numbers and sizes', () => {
    expect(decodeRaw({ v: 1, type: 'scene-clear', seq: 0 }).kind).toBe('invalid');
    expect(decodeRaw({ v: 1, type: 'scene-clear', seq: 1.5 }).kind).toBe('invalid');
    expect(decodeRaw({ v: 1, type: 'scene-resync', seq: -1 }).kind).toBe('invalid');
    const points = Array.from({ length: SCENE_LIMITS.points + 1 }, (_, i) => ({ x: i, y: 0 }));
    const op = { type: 'brush', erase: false, order: 1, radius: 5, points };
    expect(decodeRaw({ v: 1, type: 'scene-fog', seq: 1, part: 0, records: { a: op } }).kind).toBe('invalid');
  });

  it('checks only the patch fields it knows, so newer GMs can add fields', () => {
    const patch = { v: 1, type: 'scene-patch', seq: 2, set: { lighting: { any: 'thing' } }, upsert: { walls: {} }, remove: {} };
    expect(decodeRaw(patch).kind).toBe('message');
    const badUpsert = { v: 1, type: 'scene-patch', seq: 2, set: {}, upsert: { tokens: { t1: { x: 1 } } }, remove: {} };
    expect(decodeRaw(badUpsert)).toEqual({ kind: 'invalid', reason: 'bad-scene-patch' });
    const badSet = { v: 1, type: 'scene-patch', seq: 2, set: { map: { asset: null } }, upsert: {}, remove: {} };
    expect(decodeRaw(badSet)).toEqual({ kind: 'invalid', reason: 'bad-scene-patch' });
  });

  it('orders fog and drawings by order, then by id', () => {
    const records = { b: { order: 1 }, a: { order: 1 }, c: { order: 0 } };
    expect(sortedByOrder(records, (record) => record.order).map(([id]) => id)).toEqual(['c', 'a', 'b']);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/online/sceneProtocol.test.ts`
Expected: FAIL with `Failed to resolve import "../../../src/app/online/scene/sceneTypes"`.

- [ ] **Step 4: Write the wire types**

```ts
// src/app/online/scene/sceneTypes.ts
/**
 * What online players receive of the presented scene. Shared with the web
 * player page, so this file imports nothing. Every field is `T | null`, never
 * optional: JSON drops `undefined`, and both sides compare by value.
 */
export interface ScenePoint {
  x: number;
  y: number;
}

export interface MapSize {
  width: number;
  height: number;
}

export interface PlayerMap {
  /** The background as an asset id; null without one. */
  asset: string | null;
  /** The loaded background's size in world pixels; 0 × 0 without one. */
  width: number;
  height: number;
  /** Grid cell size in world pixels, sent even when the grid is hidden so tokens keep their size. */
  cellSize: number;
}

export const PLAYER_GRID_TYPES = ['square', 'hex-horizontal', 'hex-vertical'] as const;
export type PlayerGridType = typeof PLAYER_GRID_TYPES[number];
export const PLAYER_GRID_LINES = ['solid', 'dashed', 'dotted'] as const;
export type PlayerGridLine = typeof PLAYER_GRID_LINES[number];
export const PLAYER_HEX_NUMBERS = ['column-row', 'sequential'] as const;
export type PlayerHexNumbers = typeof PLAYER_HEX_NUMBERS[number];

export interface PlayerGrid {
  type: PlayerGridType;
  size: number;
  offsetX: number;
  offsetY: number;
  color: string | null;
  opacity: number;
  lineType: PlayerGridLine;
  lineWidth: number;
  hexNumbers: PlayerHexNumbers | null;
  hexNumberOpacity: number | null;
}

export interface PlayerResource {
  current: number;
  max: number;
}

export interface PlayerCondition {
  id: string;
  /** The number of a valued condition; null when the token stores none. */
  value: number | null;
}

export interface PlayerToken {
  x: number;
  y: number;
  /** Size in cells, as `BaseToken.size`. */
  size: number;
  rotation: number;
  layer: number;
  image: string | null;
  /** Ring colour; null when the token shows no ring. */
  ring: string | null;
  conditions: PlayerCondition[];
  name: string | null;
  hp: PlayerResource | null;
  stress: PlayerResource | null;
}

/** A fog operation with its drag offset applied and its points simplified. */
export type PlayerFogOp =
  | { type: 'brush'; erase: boolean; order: number; radius: number; points: ScenePoint[] }
  | { type: 'lasso'; erase: boolean; order: number; points: ScenePoint[] }
  | { type: 'rectangle'; erase: boolean; order: number; x: number; y: number; width: number; height: number };

export const PLAYER_TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export type PlayerTextAlign = typeof PLAYER_TEXT_ALIGNS[number];

export interface PlayerText {
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  backgroundColor: string | null;
  padding: number;
  borderRadius: number;
  opacity: number;
  width: number | null;
  height: number | null;
  align: PlayerTextAlign;
  bold: boolean;
  italic: boolean;
  rotation: number;
  scale: number;
}

export const PLAYER_DRAWING_TYPES = ['pen', 'eraser', 'line', 'rectangle', 'circle', 'icon'] as const;
export type PlayerDrawingType = typeof PLAYER_DRAWING_TYPES[number];

export interface PlayerDrawing {
  type: PlayerDrawingType;
  order: number;
  points: ScenePoint[];
  color: string;
  width: number;
  opacity: number;
  icon: string | null;
}

export const PLAYER_WIDGET_TYPES = ['counter', 'clock', 'timer'] as const;
export type PlayerWidgetType = typeof PLAYER_WIDGET_TYPES[number];

export interface PlayerWidget {
  id: string;
  type: PlayerWidgetType;
  label: string;
  icon: string;
  /** Counters and clocks: the count; timers: the remaining seconds. */
  value: number;
}

export interface PlayerInitiativeEntry {
  id: string;
  tokenId: string;
  initiative: number;
  name: string | null;
  hp: PlayerResource | null;
  isActive: boolean;
}

export interface PlayerInitiative {
  round: number;
  /** Whether combat is running. */
  active: boolean;
  entries: PlayerInitiativeEntry[];
}

export interface PlayerScene {
  /** Random per presentation: a new presentation or scene gets a new id. */
  sceneId: string;
  map: PlayerMap;
  grid: PlayerGrid | null;
  tokens: Record<string, PlayerToken>;
  fog: Record<string, PlayerFogOp>;
  texts: Record<string, PlayerText>;
  drawings: Record<string, PlayerDrawing>;
  widgets: PlayerWidget[];
  initiative: PlayerInitiative | null;
}

/** A snapshot's scene: everything but the fog and the drawings, which follow in parts. */
export type PlayerSceneBody = Omit<PlayerScene, 'fog' | 'drawings'>;

/** Fields diffed per record, by id. */
export const SCENE_RECORD_KEYS = ['tokens', 'fog', 'texts', 'drawings'] as const;
export type SceneRecordKey = typeof SCENE_RECORD_KEYS[number];
/** Fields replaced as a whole when they differ. */
export const SCENE_FIELD_KEYS = ['map', 'grid', 'widgets', 'initiative'] as const;
export type SceneFieldKey = typeof SCENE_FIELD_KEYS[number];

export interface ScenePatchBody {
  set: Partial<Pick<PlayerScene, SceneFieldKey>>;
  upsert: Partial<Pick<PlayerScene, SceneRecordKey>>;
  remove: Partial<Record<SceneRecordKey, string[]>>;
}

/** Bounds both sides hold scene data to; the projection clips to them so its output always validates. */
export const SCENE_LIMITS = {
  idLength: 128,
  stringLength: 512,
  textLength: 10_000,
  /** Keeps one fog operation well under a fog part's budget. */
  points: 5_000,
  records: 10_000,
  conditions: 64,
  widgets: 64,
  initiativeEntries: 200,
} as const;

/** Records in replay order: by `orderOf`, then by id, so both sides agree on ties. */
export function sortedByOrder<T>(records: Readonly<Record<string, T>>, orderOf: (record: T) => number): Array<[string, T]> {
  return Object.entries(records).sort(([idA, a], [idB, b]) => {
    const byOrder = orderOf(a) - orderOf(b);
    if (byOrder !== 0) return byOrder;
    return idA < idB ? -1 : idA > idB ? 1 : 0;
  });
}
```

- [ ] **Step 5: Write the validators**

```ts
// src/app/online/scene/sceneValidation.ts
/**
 * Checks for scene messages. Shared with the web player page, so this file
 * imports only the wire types. Records are read by their own keys only, and
 * ids that assignment treats specially are refused, so applying a validated
 * patch can never reach an object's prototype.
 */
import {
  PLAYER_DRAWING_TYPES, PLAYER_GRID_LINES, PLAYER_GRID_TYPES, PLAYER_HEX_NUMBERS, PLAYER_TEXT_ALIGNS, PLAYER_WIDGET_TYPES,
  SCENE_FIELD_KEYS, SCENE_LIMITS, SCENE_RECORD_KEYS, type SceneFieldKey, type SceneRecordKey,
} from './sceneTypes';

type Fields = Record<string, unknown>;
type Check = (value: unknown) => boolean;

const FORBIDDEN_IDS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function isPositive(value: unknown): value is number {
  return isNumber(value) && value > 0;
}
function isText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}
function isString(value: unknown): value is string {
  return isText(value, SCENE_LIMITS.stringLength);
}
function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}
function nullable(check: Check): Check {
  return (value) => value === null || check(value);
}
function oneOf(values: readonly string[]): Check {
  return (value) => typeof value === 'string' && values.includes(value);
}

/** A record key or entity id: short, and never one assignment treats specially. */
export function isSceneId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= SCENE_LIMITS.idLength && !FORBIDDEN_IDS.has(value);
}
export function isSceneSeq(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}
/** The `seq` a player last applied: 0 before its first message. */
export function isLastSeq(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
export function isSceneCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= SCENE_LIMITS.records;
}

function isPoint(value: unknown): boolean {
  return isFields(value) && isNumber(value.x) && isNumber(value.y);
}
function isPoints(value: unknown, min: number): boolean {
  return Array.isArray(value) && value.length >= min && value.length <= SCENE_LIMITS.points
    && value.every((point) => isPoint(point));
}
function isResource(value: unknown): boolean {
  return isFields(value) && isNumber(value.current) && isNumber(value.max);
}
function isCondition(value: unknown): boolean {
  return isFields(value) && isText(value.id, SCENE_LIMITS.idLength) && (value.value === null || isNumber(value.value));
}

function isPlayerMap(value: unknown): boolean {
  return isFields(value) && nullable(isString)(value.asset) && isNumber(value.width) && isNumber(value.height)
    && isPositive(value.cellSize);
}

function isPlayerGrid(value: unknown): boolean {
  return isFields(value) && oneOf(PLAYER_GRID_TYPES)(value.type) && isPositive(value.size)
    && isNumber(value.offsetX) && isNumber(value.offsetY) && nullable(isString)(value.color) && isNumber(value.opacity)
    && oneOf(PLAYER_GRID_LINES)(value.lineType) && isNumber(value.lineWidth)
    && nullable(oneOf(PLAYER_HEX_NUMBERS))(value.hexNumbers) && nullable(isNumber)(value.hexNumberOpacity);
}

function isPlayerToken(value: unknown): boolean {
  return isFields(value) && isNumber(value.x) && isNumber(value.y) && isNumber(value.size) && isNumber(value.rotation)
    && isNumber(value.layer) && nullable(isString)(value.image) && nullable(isString)(value.ring)
    && Array.isArray(value.conditions) && value.conditions.length <= SCENE_LIMITS.conditions
    && value.conditions.every((condition) => isCondition(condition))
    && nullable(isString)(value.name) && nullable(isResource)(value.hp) && nullable(isResource)(value.stress);
}

function isPlayerFogOp(value: unknown): boolean {
  if (!isFields(value) || !isBoolean(value.erase) || !isNumber(value.order)) return false;
  switch (value.type) {
    case 'brush': return isPositive(value.radius) && isPoints(value.points, 1);
    case 'lasso': return isPoints(value.points, 3);
    case 'rectangle': return isNumber(value.x) && isNumber(value.y) && isNumber(value.width) && isNumber(value.height);
    default: return false;
  }
}

function isPlayerText(value: unknown): boolean {
  return isFields(value) && isNumber(value.x) && isNumber(value.y) && isText(value.text, SCENE_LIMITS.textLength)
    && isNumber(value.fontSize) && isString(value.fontFamily) && isString(value.color)
    && nullable(isString)(value.backgroundColor) && isNumber(value.padding) && isNumber(value.borderRadius)
    && isNumber(value.opacity) && nullable(isNumber)(value.width) && nullable(isNumber)(value.height)
    && oneOf(PLAYER_TEXT_ALIGNS)(value.align) && isBoolean(value.bold) && isBoolean(value.italic)
    && isNumber(value.rotation) && isNumber(value.scale);
}

function isPlayerDrawing(value: unknown): boolean {
  return isFields(value) && oneOf(PLAYER_DRAWING_TYPES)(value.type) && isNumber(value.order) && isPoints(value.points, 1)
    && isString(value.color) && isNumber(value.width) && isNumber(value.opacity) && nullable(isString)(value.icon);
}

function isPlayerWidget(value: unknown): boolean {
  return isFields(value) && isText(value.id, SCENE_LIMITS.idLength) && oneOf(PLAYER_WIDGET_TYPES)(value.type)
    && isString(value.label) && isString(value.icon) && isNumber(value.value);
}
function isPlayerWidgets(value: unknown): boolean {
  return Array.isArray(value) && value.length <= SCENE_LIMITS.widgets && value.every((widget) => isPlayerWidget(widget));
}

function isInitiativeEntry(value: unknown): boolean {
  return isFields(value) && isText(value.id, SCENE_LIMITS.idLength) && isText(value.tokenId, SCENE_LIMITS.idLength)
    && isNumber(value.initiative) && nullable(isString)(value.name) && nullable(isResource)(value.hp)
    && isBoolean(value.isActive);
}
function isPlayerInitiative(value: unknown): boolean {
  return isFields(value) && isNumber(value.round) && isBoolean(value.active) && Array.isArray(value.entries)
    && value.entries.length <= SCENE_LIMITS.initiativeEntries && value.entries.every((entry) => isInitiativeEntry(entry));
}

function isRecordOf(value: unknown, check: Check): boolean {
  if (!isFields(value)) return false;
  const ids = Object.keys(value);
  return ids.length <= SCENE_LIMITS.records && ids.every((id) => isSceneId(id) && check(value[id]));
}
function isIdList(value: unknown): boolean {
  return Array.isArray(value) && value.length <= SCENE_LIMITS.records && value.every((id) => isSceneId(id));
}

const FIELD_CHECKS: Record<SceneFieldKey, Check> = {
  map: isPlayerMap,
  grid: nullable(isPlayerGrid),
  widgets: isPlayerWidgets,
  initiative: nullable(isPlayerInitiative),
};
const RECORD_CHECKS: Record<SceneRecordKey, Check> = {
  tokens: isPlayerToken,
  fog: isPlayerFogOp,
  texts: isPlayerText,
  drawings: isPlayerDrawing,
};

/** A snapshot's scene: fog and drawings come in their own parts. */
export function isPlayerSceneBody(value: unknown): boolean {
  return isFields(value) && isSceneId(value.sceneId)
    && SCENE_FIELD_KEYS.every((key) => Object.hasOwn(value, key) && FIELD_CHECKS[key](value[key]))
    && isRecordOf(value.tokens, isPlayerToken) && isRecordOf(value.texts, isPlayerText);
}

export function isFogRecords(value: unknown): boolean {
  return isRecordOf(value, isPlayerFogOp);
}

export function isDrawingRecords(value: unknown): boolean {
  return isRecordOf(value, isPlayerDrawing);
}

/** `set`, `upsert` and `remove` of a patch; fields a newer GM adds are ignored, not refused. */
export function isScenePatchBody(message: Fields): boolean {
  const { set, upsert, remove } = message;
  if (!isFields(set) || !isFields(upsert) || !isFields(remove)) return false;
  return SCENE_FIELD_KEYS.every((key) => !Object.hasOwn(set, key) || FIELD_CHECKS[key](set[key]))
    && SCENE_RECORD_KEYS.every((key) => !Object.hasOwn(upsert, key) || isRecordOf(upsert[key], RECORD_CHECKS[key]))
    && SCENE_RECORD_KEYS.every((key) => !Object.hasOwn(remove, key) || isIdList(remove[key]));
}
```

- [ ] **Step 6: Add the messages to the protocol**

In `src/app/online/protocol.ts`, replace the header comment (lines 1–4) with the comment and imports below, keeping `export const PROTOCOL_VERSION = 1;` and everything after it:

```ts
/**
 * The online play wire format. Shared with the web player page, so this file
 * imports nothing but the scene wire format beside it: no Obsidian, no PIXI, no PeerJS.
 */
import type { PlayerDrawing, PlayerFogOp, PlayerSceneBody, ScenePatchBody } from './scene/sceneTypes';
import {
  isDrawingRecords, isFogRecords, isLastSeq, isPlayerSceneBody, isSceneCount, isScenePatchBody, isSceneSeq,
} from './scene/sceneValidation';
```

Replace the last member of the `ControlMessage` union, `| { v: 1; type: 'bye'; reason: string };`, with:

```ts
  | { v: 1; type: 'bye'; reason: string }
  | { v: 1; type: 'scene-snapshot'; seq: number; scene: PlayerSceneBody; fogParts: number; drawingParts: number }
  | { v: 1; type: 'scene-fog'; seq: number; part: number; records: Record<string, PlayerFogOp> }
  | { v: 1; type: 'scene-drawings'; seq: number; part: number; records: Record<string, PlayerDrawing> }
  | {
    v: 1; type: 'scene-patch'; seq: number;
    set: ScenePatchBody['set']; upsert: ScenePatchBody['upsert']; remove: ScenePatchBody['remove'];
  }
  | { v: 1; type: 'scene-clear'; seq: number }
  | { v: 1; type: 'scene-resync'; seq: number };
```

In `VALIDATORS`, after `bye: (m) => isString(m.reason, 200),` add:

```ts
  'scene-snapshot': (m) => isSceneSeq(m.seq) && isSceneCount(m.fogParts) && isSceneCount(m.drawingParts)
    && isPlayerSceneBody(m.scene),
  'scene-fog': (m) => isSceneSeq(m.seq) && isSceneCount(m.part) && isFogRecords(m.records),
  'scene-drawings': (m) => isSceneSeq(m.seq) && isSceneCount(m.part) && isDrawingRecords(m.records),
  'scene-patch': (m) => isSceneSeq(m.seq) && isScenePatchBody(m),
  'scene-clear': (m) => isSceneSeq(m.seq),
  'scene-resync': (m) => isLastSeq(m.seq),
```

`decodeControl` already reports a failed check as `bad-${type}`; nothing else changes. `GmSession` hands every non-session message to its handlers and `PlayerSession`'s `switch` has a `default`, so neither needs a change here.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/online/sceneProtocol.test.ts tests/unit/online/protocol.test.ts`
Expected: PASS (8 tests in `sceneProtocol.test.ts`; every existing test in `protocol.test.ts` still passes).

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0 with no output.

- [ ] **Step 9: Commit**

```bash
git add src/app/online/scene/sceneTypes.ts src/app/online/scene/sceneValidation.ts src/app/online/protocol.ts tests/unit/online/sceneFixtures.ts tests/unit/online/sceneProtocol.test.ts
git commit -m "feat(online): scene wire types and validated scene messages"
```

---

### Task 2: Value coercion, point simplification and fog coverage

**Files:**
- Create: `src/app/online/scene/coerce.ts`, `src/app/online/scene/simplifyPoints.ts`, `src/app/online/scene/FogCoverage.ts`
- Test: `tests/unit/online/fogCoverage.test.ts`

**Interfaces:**
- Consumes (Task 1): `SCENE_LIMITS`, `ScenePoint`, `PlayerResource`, `sortedByOrder` from `sceneTypes.ts`. Existing: `FogOperation` (`src/app/types/fogTypes.ts`), `calculateOperationBounds(op: FogOperation): FogBounds` (`src/app/pixi/fog/fogRenderUtils.ts`, imports only types, so it is safe here).
- Produces:
  - `coerce.ts`: `finiteOr(value: unknown, fallback: number): number` (numbers and numeric strings), `finiteOrNull(value: unknown): number | null`, `positiveOr(value: unknown, fallback: number): number`, `positiveOrNull(value: unknown): number | null`, `unitOr(value: unknown, fallback: number): number` (clamped to 0–1), `textOr(value: unknown, fallback: string, max?: number): string`, `textOrNull(value: unknown, max?: number): string | null` (empty string → null), `oneOf<T extends string>(values: readonly T[], value: unknown, fallback: T): T`, `resourceOrNull(value: unknown): PlayerResource | null`, `hpOrNull(value: unknown): PlayerResource | null` (max > 0 only)
  - `simplifyPoints.ts`: `SIMPLIFY_TOLERANCE = 1`, `distanceSqToSegment(point: ScenePoint, a: ScenePoint, b: ScenePoint): number`, `simplifyPoints(points: readonly ScenePoint[], tolerance: number): ScenePoint[]`, `finitePoints(points: unknown, offsetX?: number, offsetY?: number): ScenePoint[]`, `wirePoints(points: unknown, offsetX?: number, offsetY?: number): ScenePoint[]`
  - `FogCoverage.ts`: `FOG_CELL_SIZE = 8`, `MAX_FOG_CELLS = 4_000_000`, `interface WorldBounds { x: number; y: number; width: number; height: number }`, `class FogCoverage { static readonly EMPTY: FogCoverage; static fromOperations(fog: Readonly<Record<string, FogOperation>>): FogCoverage; isCovered(bounds: WorldBounds): boolean; readonly cellSize: number }`

Decisions (from the plan header): the bitmap spans the painted operations' bounds, and cells double beyond 4 000 000; paint fogs only cells it covers whole, erase clears every cell it touches; lasso fill uses nonzero winding like the canvas, and cells an edge crosses (exact grid traversal) are never fogged by paint and always cleared by erase; operations replay by timestamp, then id; `op.offsetX`/`offsetY` shift every shape; a query partly outside the bitmap is not covered. Simplification is iterative Ramer–Douglas–Peucker, then 0.1 px rounding, at most 5 000 points.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/online/fogCoverage.test.ts
import { describe, expect, it } from 'vitest';
import type { FogBrushStroke, FogLassoFill, FogOperation, FogRectangleFill } from '../../../src/app/types/fogTypes';
import { finiteOr, hpOrNull, oneOf, positiveOr, resourceOrNull, textOr, textOrNull, unitOr } from '../../../src/app/online/scene/coerce';
import { FOG_CELL_SIZE, FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import { SCENE_LIMITS } from '../../../src/app/online/scene/sceneTypes';
import { simplifyPoints, wirePoints } from '../../../src/app/online/scene/simplifyPoints';

let clock = 1;
const next = (): number => clock++;

function rect(x: number, y: number, width: number, height: number, extra: Partial<FogRectangleFill> = {}): FogRectangleFill {
  const timestamp = next();
  return { id: `r${timestamp}`, kind: 'fog', type: 'rectangle', timestamp, isErasing: false, x, y, width, height, ...extra };
}
function brush(points: Array<{ x: number; y: number }>, brushRadius: number, extra: Partial<FogBrushStroke> = {}): FogBrushStroke {
  const timestamp = next();
  return { id: `b${timestamp}`, kind: 'fog', type: 'brush', timestamp, isErasing: false, points, brushRadius, ...extra };
}
function lasso(points: Array<{ x: number; y: number }>, extra: Partial<FogLassoFill> = {}): FogLassoFill {
  const timestamp = next();
  return { id: `l${timestamp}`, kind: 'fog', type: 'lasso', timestamp, isErasing: false, points, ...extra };
}
const coverageOf = (...ops: FogOperation[]): FogCoverage =>
  FogCoverage.fromOperations(Object.fromEntries(ops.map((op) => [op.id, op])));
const box = (x: number, y: number, width: number, height: number): { x: number; y: number; width: number; height: number } =>
  ({ x, y, width, height });

describe('coerce', () => {
  it('reads numbers, numeric strings and fallbacks', () => {
    expect(finiteOr('5', 0)).toBe(5);
    expect(finiteOr('lots', 0)).toBe(0);
    expect(finiteOr(Number.NaN, 7)).toBe(7);
    expect(positiveOr(-1, 70)).toBe(70);
    expect(unitOr(3, 1)).toBe(1);
    expect(textOr(5, 'none')).toBe('none');
    expect(textOr('x'.repeat(600), '')).toHaveLength(SCENE_LIMITS.stringLength);
    expect(textOrNull('')).toBeNull();
    expect(oneOf(['a', 'b'] as const, 'c', 'a')).toBe('a');
    expect(resourceOrNull({ current: '7', max: 10 })).toEqual({ current: 7, max: 10 });
    expect(resourceOrNull('7')).toBeNull();
    expect(hpOrNull({ current: 3, max: 0 })).toBeNull();
  });
});

describe('simplifyPoints', () => {
  it('drops points within the tolerance and keeps corners', () => {
    const line = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplifyPoints(line, 1)).toEqual([{ x: 0, y: 0 }, { x: 99, y: 0 }]);
    const corner = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 100, y: 100 }];
    expect(simplifyPoints(corner, 1)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    const shaky = [{ x: 0, y: 0 }, { x: 10, y: 0.4 }, { x: 20, y: -0.4 }, { x: 30, y: 0 }];
    expect(simplifyPoints(shaky, 1)).toHaveLength(2);
    const bumpy = [{ x: 0, y: 0 }, { x: 10, y: 3 }, { x: 20, y: 0 }];
    expect(simplifyPoints(bumpy, 1)).toHaveLength(3);
  });

  it('prepares points for the wire: finite, offset, rounded and bounded', () => {
    expect(wirePoints([{ x: 1.234, y: 2 }, null, { x: Number.NaN, y: 1 }, { x: 5.55, y: 'a' }], 10, 0))
      .toEqual([{ x: 11.2, y: 2 }]);
    expect(wirePoints('not points')).toEqual([]);
    const zigzag = Array.from({ length: 6000 }, (_, i) => ({ x: i, y: (i % 2) * 3 }));
    const sent = wirePoints(zigzag);
    expect(sent.length).toBeLessThanOrEqual(SCENE_LIMITS.points);
    expect(sent.length).toBeGreaterThanOrEqual(2);
  });
});

describe('FogCoverage', () => {
  it('covers nothing without fog, or with erasing only', () => {
    expect(FogCoverage.fromOperations({}).isCovered(box(0, 0, 10, 10))).toBe(false);
    expect(coverageOf(rect(0, 0, 100, 100, { isErasing: true })).isCovered(box(10, 10, 10, 10))).toBe(false);
  });

  it('covers what lies wholly inside a painted rectangle, not what peeks out', () => {
    const coverage = coverageOf(rect(0, 0, 400, 400));
    expect(coverage.isCovered(box(100, 100, 70, 70))).toBe(true);
    expect(coverage.isCovered(box(360, 100, 70, 70))).toBe(false);
    expect(coverage.isCovered(box(-20, 100, 70, 70))).toBe(false);
  });

  it('covers along a brush stroke within its radius', () => {
    const coverage = coverageOf(brush([{ x: 0, y: 100 }, { x: 400, y: 100 }], 50));
    expect(coverage.isCovered(box(50, 80, 300, 40))).toBe(true);
    expect(coverage.isCovered(box(50, 52, 20, 20))).toBe(false);
    const dab = coverageOf(brush([{ x: 200, y: 200 }], 40));
    expect(dab.isCovered(box(190, 190, 20, 20))).toBe(true);
    expect(dab.isCovered(box(165, 165, 20, 20))).toBe(false);
  });

  it('fills lassos by their inside, including concave ones', () => {
    const square = coverageOf(lasso([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }]));
    expect(square.isCovered(box(20, 20, 100, 100))).toBe(true);
    expect(square.isCovered(box(150, 150, 100, 100))).toBe(false);
    const u = coverageOf(lasso([
      { x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 200, y: 300 },
      { x: 200, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 300 }, { x: 0, y: 300 },
    ]));
    expect(u.isCovered(box(120, 150, 60, 60))).toBe(false);
    expect(u.isCovered(box(20, 150, 60, 60))).toBe(true);
  });

  it('replays erases in timestamp order', () => {
    const erased = coverageOf(rect(0, 0, 400, 400), rect(100, 100, 100, 100, { isErasing: true }));
    expect(erased.isCovered(box(120, 120, 50, 50))).toBe(false);
    expect(erased.isCovered(box(300, 300, 50, 50))).toBe(true);
    const paintedLater = coverageOf(
      rect(100, 100, 100, 100, { isErasing: true, timestamp: 1, id: 'erase' }),
      rect(0, 0, 400, 400, { timestamp: 2, id: 'paint' }),
    );
    expect(paintedLater.isCovered(box(120, 120, 50, 50))).toBe(true);
  });

  it('breaks timestamp ties by id', () => {
    const coverage = coverageOf(
      rect(0, 0, 400, 400, { isErasing: true, timestamp: 5, id: 'b' }),
      rect(0, 0, 400, 400, { timestamp: 5, id: 'a' }),
    );
    expect(coverage.isCovered(box(100, 100, 50, 50))).toBe(false);
  });

  it('clears every cell an erase touches', () => {
    const coverage = coverageOf(rect(0, 0, 400, 400), brush([{ x: 200, y: 200 }], 3, { isErasing: true }));
    expect(coverage.isCovered(box(196, 196, 8, 8))).toBe(false);
    expect(coverage.isCovered(box(100, 100, 40, 40))).toBe(true);
  });

  it('applies drag offsets', () => {
    const coverage = coverageOf(rect(0, 0, 100, 100, { offsetX: 500, offsetY: 0 }));
    expect(coverage.isCovered(box(520, 20, 50, 50))).toBe(true);
    expect(coverage.isCovered(box(20, 20, 50, 50))).toBe(false);
  });

  it('coarsens its cells for a huge fogged area', () => {
    const coverage = coverageOf(rect(0, 0, 100_000, 100_000));
    expect(coverage.cellSize).toBeGreaterThan(FOG_CELL_SIZE);
    expect(coverage.isCovered(box(50_000, 50_000, 100, 100))).toBe(true);
  });

  it('ignores operations with broken geometry', () => {
    const broken = rect(Number.NaN, 0, 100, 100);
    const coverage = coverageOf(broken, rect(0, 0, 200, 200));
    expect(coverage.isCovered(box(50, 50, 50, 50))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/online/fogCoverage.test.ts`
Expected: FAIL with `Failed to resolve import "../../../src/app/online/scene/coerce"`.

- [ ] **Step 3: Write the coercion helpers**

```ts
// src/app/online/scene/coerce.ts
/**
 * Wire values from GM records. Older or hand-edited map files may hold any
 * shape (a string HP, a missing font size, NaN), and one bad value would make
 * a whole snapshot invalid for players, so the projection reads values through these.
 */
import { SCENE_LIMITS, type PlayerResource } from './sceneTypes';

/** A finite number, from a number or a numeric string; else `fallback`. */
export function finiteOr(value: unknown, fallback: number): number {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : fallback;
}

export function finiteOrNull(value: unknown): number | null {
  const number = finiteOr(value, Number.NaN);
  return Number.isFinite(number) ? number : null;
}

export function positiveOr(value: unknown, fallback: number): number {
  const number = finiteOr(value, Number.NaN);
  return number > 0 ? number : fallback;
}

export function positiveOrNull(value: unknown): number | null {
  const number = finiteOr(value, Number.NaN);
  return number > 0 ? number : null;
}

/** A number from 0 to 1, such as an opacity. */
export function unitOr(value: unknown, fallback: number): number {
  return Math.min(1, Math.max(0, finiteOr(value, fallback)));
}

export function textOr(value: unknown, fallback: string, max: number = SCENE_LIMITS.stringLength): string {
  return typeof value === 'string' ? value.slice(0, max) : fallback;
}

/** A non-empty string, clipped; else null. */
export function textOrNull(value: unknown, max: number = SCENE_LIMITS.stringLength): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : null;
}

export function oneOf<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** `{ current, max }` with both finite; else null. */
export function resourceOrNull(value: unknown): PlayerResource | null {
  if (typeof value !== 'object' || value === null) return null;
  const { current, max } = value as { current?: unknown; max?: unknown };
  const currentValue = finiteOr(current, Number.NaN);
  const maxValue = finiteOr(max, Number.NaN);
  return Number.isFinite(currentValue) && Number.isFinite(maxValue) ? { current: currentValue, max: maxValue } : null;
}

/** Hit points as the player window shows them: only with a maximum above 0. */
export function hpOrNull(value: unknown): PlayerResource | null {
  const resource = resourceOrNull(value);
  return resource && resource.max > 0 ? resource : null;
}
```

- [ ] **Step 4: Write the point simplification**

```ts
// src/app/online/scene/simplifyPoints.ts
import { SCENE_LIMITS, type ScenePoint } from './sceneTypes';

/** Fog and drawing points are simplified to this many world pixels. */
export const SIMPLIFY_TOLERANCE = 1;

export function distanceSqToSegment(point: ScenePoint, a: ScenePoint, b: ScenePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  const ex = point.x - a.x - t * dx;
  const ey = point.y - a.y - t * dy;
  return ex * ex + ey * ey;
}

/**
 * Ramer–Douglas–Peucker: keeps the points that lie more than `tolerance` from
 * the line through the points kept around them. Iterative, so a long stroke
 * cannot overflow the stack.
 */
export function simplifyPoints(points: readonly ScenePoint[], tolerance: number): ScenePoint[] {
  const last = points.length - 1;
  if (last < 2) return points.map((point) => ({ x: point.x, y: point.y }));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[last] = 1;
  const toleranceSq = tolerance * tolerance;
  const spans: Array<[number, number]> = [[0, last]];
  for (let span = spans.pop(); span; span = spans.pop()) {
    const [start, end] = span;
    const a = points[start]!;
    const b = points[end]!;
    let farthest = -1;
    let farthestSq = toleranceSq;
    for (let index = start + 1; index < end; index++) {
      const distanceSq = distanceSqToSegment(points[index]!, a, b);
      if (distanceSq > farthestSq) {
        farthestSq = distanceSq;
        farthest = index;
      }
    }
    if (farthest === -1) continue;
    keep[farthest] = 1;
    spans.push([start, farthest], [farthest, end]);
  }
  return points.filter((_, index) => keep[index] === 1).map((point) => ({ x: point.x, y: point.y }));
}

/** The finite points of a GM point list of any shape, moved by the offset. */
export function finitePoints(points: unknown, offsetX = 0, offsetY = 0): ScenePoint[] {
  if (!Array.isArray(points)) return [];
  const result: ScenePoint[] = [];
  for (const point of points as unknown[]) {
    if (typeof point !== 'object' || point === null) continue;
    const { x, y } = point as { x?: unknown; y?: unknown };
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    const moved = { x: x + offsetX, y: y + offsetY };
    if (Number.isFinite(moved.x) && Number.isFinite(moved.y)) result.push(moved);
  }
  return result;
}

const roundToTenth = (value: number): number => Math.round(value * 10) / 10;

/**
 * Points ready to send: finite, moved by the offset, simplified to 1 world
 * pixel, rounded to 0.1 px and at most `SCENE_LIMITS.points` of them (the
 * tolerance doubles until they fit).
 */
export function wirePoints(points: unknown, offsetX = 0, offsetY = 0): ScenePoint[] {
  const finite = finitePoints(points, offsetX, offsetY);
  let tolerance = SIMPLIFY_TOLERANCE;
  let simplified = simplifyPoints(finite, tolerance);
  while (simplified.length > SCENE_LIMITS.points) {
    tolerance *= 2;
    simplified = simplifyPoints(finite, tolerance);
  }
  return simplified.map((point) => ({ x: roundToTenth(point.x), y: roundToTenth(point.y) }));
}
```

- [ ] **Step 5: Write the fog coverage**

```ts
// src/app/online/scene/FogCoverage.ts
/**
 * Where the fog of war lies, coarsely, to decide what players may receive.
 * Replays the fog operations like `FogCanvasCompositor` (in order, erase
 * clearing) onto one cell per 8 world pixels. It is conservative: paint fogs
 * only cells it covers whole and erase clears every cell it touches, so an
 * object counts as covered only when no part of it can show.
 */
import { calculateOperationBounds } from '../../pixi/fog/fogRenderUtils';
import type { FogOperation } from '../../types/fogTypes';
import { finiteOr } from './coerce';
import { sortedByOrder, type ScenePoint } from './sceneTypes';
import { distanceSqToSegment, finitePoints } from './simplifyPoints';

export const FOG_CELL_SIZE = 8;
/** Beyond this many cells the cell size doubles, so a huge fogged area stays cheap. */
export const MAX_FOG_CELLS = 4_000_000;

export interface WorldBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FOGGED = 1;
const CLEAR = 0;

export class FogCoverage {
  static readonly EMPTY: FogCoverage = new FogCoverage(new Uint8Array(0), 0, 0, 0, 0, FOG_CELL_SIZE);

  private constructor(
    private readonly cells: Uint8Array,
    private readonly cols: number,
    private readonly rows: number,
    private readonly originX: number,
    private readonly originY: number,
    readonly cellSize: number,
  ) {}

  static fromOperations(fog: Readonly<Record<string, FogOperation>>): FogCoverage {
    const ops = sortedByOrder(fog, (op) => finiteOr(op.timestamp, 0)).map(([, op]) => op);
    const bounds = paintedBounds(ops);
    if (!bounds) return FogCoverage.EMPTY;
    let cellSize = FOG_CELL_SIZE;
    while ((bounds.width / cellSize + 2) * (bounds.height / cellSize + 2) > MAX_FOG_CELLS) cellSize *= 2;
    const originX = Math.floor(bounds.x / cellSize) * cellSize;
    const originY = Math.floor(bounds.y / cellSize) * cellSize;
    const cols = Math.ceil((bounds.x + bounds.width - originX) / cellSize) + 1;
    const rows = Math.ceil((bounds.y + bounds.height - originY) / cellSize) + 1;
    const coverage = new FogCoverage(new Uint8Array(cols * rows), cols, rows, originX, originY, cellSize);
    for (const op of ops) coverage.apply(op);
    return coverage;
  }

  /** True when every cell under `bounds` is fogged; anything reaching outside the fogged area is not covered. */
  isCovered(bounds: WorldBounds): boolean {
    const right = bounds.x + Math.max(0, bounds.width);
    const bottom = bounds.y + Math.max(0, bounds.height);
    if (this.cells.length === 0 || ![bounds.x, bounds.y, right, bottom].every(Number.isFinite)) return false;
    const c0 = this.col(bounds.x);
    const r0 = this.row(bounds.y);
    const c1 = Math.max(c0, Math.ceil((right - this.originX) / this.cellSize) - 1);
    const r1 = Math.max(r0, Math.ceil((bottom - this.originY) / this.cellSize) - 1);
    if (c0 < 0 || r0 < 0 || c1 >= this.cols || r1 >= this.rows) return false;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        if (this.cells[row * this.cols + col] !== FOGGED) return false;
      }
    }
    return true;
  }

  private col(x: number): number {
    return Math.floor((x - this.originX) / this.cellSize);
  }

  private row(y: number): number {
    return Math.floor((y - this.originY) / this.cellSize);
  }

  private apply(op: FogOperation): void {
    const dx = finiteOr(op.offsetX, 0);
    const dy = finiteOr(op.offsetY, 0);
    const value = op.isErasing ? CLEAR : FOGGED;
    if (op.type === 'rectangle') {
      this.fillRect(finiteOr(op.x, Number.NaN) + dx, finiteOr(op.y, Number.NaN) + dy,
        finiteOr(op.width, Number.NaN), finiteOr(op.height, Number.NaN), value);
    } else if (op.type === 'brush') {
      this.fillBrush(finitePoints(op.points, dx, dy), finiteOr(op.brushRadius, 0), value);
    } else if (op.type === 'lasso') {
      this.fillLasso(finitePoints(op.points, dx, dy), value);
    }
  }

  private forCells(c0: number, c1: number, r0: number, r1: number, visit: (index: number, left: number, top: number) => void): void {
    const lastRow = Math.min(this.rows - 1, r1);
    const lastCol = Math.min(this.cols - 1, c1);
    for (let row = Math.max(0, r0); row <= lastRow; row++) {
      for (let col = Math.max(0, c0); col <= lastCol; col++) {
        visit(row * this.cols + col, this.originX + col * this.cellSize, this.originY + row * this.cellSize);
      }
    }
  }

  /** Paint fogs the cells the rectangle covers whole; erase clears every cell it overlaps. */
  private fillRect(x: number, y: number, width: number, height: number, value: number): void {
    const left = Math.min(x, x + width);
    const right = Math.max(x, x + width);
    const top = Math.min(y, y + height);
    const bottom = Math.max(y, y + height);
    if (![left, right, top, bottom].every(Number.isFinite)) return;
    const size = this.cellSize;
    const whole = value === FOGGED;
    const c0 = whole ? Math.ceil((left - this.originX) / size) : this.col(left);
    const c1 = whole ? Math.floor((right - this.originX) / size) - 1 : Math.ceil((right - this.originX) / size) - 1;
    const r0 = whole ? Math.ceil((top - this.originY) / size) : this.row(top);
    const r1 = whole ? Math.floor((bottom - this.originY) / size) - 1 : Math.ceil((bottom - this.originY) / size) - 1;
    this.forCells(c0, c1, r0, r1, (index) => { this.cells[index] = value; });
  }

  /**
   * Round-capped segments: paint fogs a cell whose four corners lie within the
   * radius of one segment; erase clears a cell whose centre lies within the
   * radius plus half a cell diagonal of any segment.
   */
  private fillBrush(points: ScenePoint[], radius: number, value: number): void {
    const first = points[0];
    if (!first || !(radius > 0)) return;
    const size = this.cellSize;
    const radiusSq = radius * radius;
    const reach = radius + (size * Math.SQRT2) / 2;
    const reachSq = reach * reach;
    const segments: Array<[ScenePoint, ScenePoint]> = points.length === 1
      ? [[first, first]]
      : points.slice(1).map((point, index): [ScenePoint, ScenePoint] => [points[index]!, point]);
    for (const [a, b] of segments) {
      // Row by row, only the cells near the segment: a long diagonal stroke never scans its whole bounding box.
      const lastRow = Math.min(this.rows - 1, this.row(Math.max(a.y, b.y) + reach));
      for (let row = Math.max(0, this.row(Math.min(a.y, b.y) - reach)); row <= lastRow; row++) {
        const rowTop = this.originY + row * size;
        const span = segmentXSpan(a, b, rowTop - reach, rowTop + size + reach);
        if (!span) continue;
        this.forCells(this.col(span[0] - reach), this.col(span[1] + reach), row, row, (index, left, top) => {
          if (value === FOGGED) {
            if (cellInsideCapsule(left, top, size, a, b, radiusSq)) this.cells[index] = FOGGED;
          } else if (distanceSqToSegment({ x: left + size / 2, y: top + size / 2 }, a, b) <= reachSq) {
            this.cells[index] = CLEAR;
          }
        });
      }
    }
  }

  /**
   * Cells whose centre lies inside the polygon (nonzero winding, as the canvas
   * fills it). Cells an edge crosses are never fogged by paint and always
   * cleared by erase.
   */
  private fillLasso(points: ScenePoint[], value: number): void {
    if (points.length < 3) return;
    const size = this.cellSize;
    const crossed = new Set<number>();
    let top = Infinity;
    let bottom = -Infinity;
    for (let index = 0; index < points.length; index++) {
      const a = points[index]!;
      const b = points[(index + 1) % points.length]!;
      top = Math.min(top, a.y);
      bottom = Math.max(bottom, a.y);
      traverseCells(
        (a.x - this.originX) / size, (a.y - this.originY) / size,
        (b.x - this.originX) / size, (b.y - this.originY) / size,
        (col, row) => {
          if (col >= 0 && row >= 0 && col < this.cols && row < this.rows) crossed.add(row * this.cols + col);
        },
      );
    }
    const lastRow = Math.min(this.rows - 1, this.row(bottom));
    for (let row = Math.max(0, this.row(top)); row <= lastRow; row++) {
      const y = this.originY + (row + 0.5) * size;
      for (const [from, to] of insideSpans(points, y)) {
        const c0 = Math.max(0, Math.ceil((from - this.originX) / size - 0.5));
        const c1 = Math.min(this.cols - 1, Math.floor((to - this.originX) / size - 0.5));
        for (let col = c0; col <= c1; col++) {
          const index = row * this.cols + col;
          if (value === CLEAR || !crossed.has(index)) this.cells[index] = value;
        }
      }
    }
    if (value === CLEAR) for (const index of crossed) this.cells[index] = CLEAR;
  }
}

/** The x range of segment ab where its y lies within [low, high]; null when it never does. */
function segmentXSpan(a: ScenePoint, b: ScenePoint, low: number, high: number): [number, number] | null {
  if (a.y === b.y) return a.y >= low && a.y <= high ? [Math.min(a.x, b.x), Math.max(a.x, b.x)] : null;
  const tLow = (low - a.y) / (b.y - a.y);
  const tHigh = (high - a.y) / (b.y - a.y);
  const t0 = Math.max(0, Math.min(tLow, tHigh));
  const t1 = Math.min(1, Math.max(tLow, tHigh));
  if (t0 > t1) return null;
  const x0 = a.x + (b.x - a.x) * t0;
  const x1 = a.x + (b.x - a.x) * t1;
  return [Math.min(x0, x1), Math.max(x0, x1)];
}

function cellInsideCapsule(left: number, top: number, size: number, a: ScenePoint, b: ScenePoint, radiusSq: number): boolean {
  return distanceSqToSegment({ x: left, y: top }, a, b) <= radiusSq
    && distanceSqToSegment({ x: left + size, y: top }, a, b) <= radiusSq
    && distanceSqToSegment({ x: left, y: top + size }, a, b) <= radiusSq
    && distanceSqToSegment({ x: left + size, y: top + size }, a, b) <= radiusSq;
}

/** The x ranges of a horizontal line at `y` that lie inside the polygon, by nonzero winding. */
function insideSpans(points: readonly ScenePoint[], y: number): Array<[number, number]> {
  const crossings: Array<{ x: number; winding: number }> = [];
  for (let index = 0; index < points.length; index++) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    if ((a.y <= y) === (b.y <= y)) continue;
    crossings.push({ x: a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x), winding: b.y > a.y ? 1 : -1 });
  }
  crossings.sort((p, q) => p.x - q.x);
  const spans: Array<[number, number]> = [];
  let winding = 0;
  for (let index = 0; index < crossings.length - 1; index++) {
    winding += crossings[index]!.winding;
    if (winding !== 0) spans.push([crossings[index]!.x, crossings[index + 1]!.x]);
  }
  return spans;
}

/** Every cell a segment passes through, in cell coordinates (Amanatides and Woo). */
function traverseCells(ax: number, ay: number, bx: number, by: number, visit: (col: number, row: number) => void): void {
  let col = Math.floor(ax);
  let row = Math.floor(ay);
  const dx = bx - ax;
  const dy = by - ay;
  const stepCol = dx > 0 ? 1 : -1;
  const stepRow = dy > 0 ? 1 : -1;
  const deltaCol = dx === 0 ? Infinity : Math.abs(1 / dx);
  const deltaRow = dy === 0 ? Infinity : Math.abs(1 / dy);
  let nextCol = dx === 0 ? Infinity : (dx > 0 ? col + 1 - ax : ax - col) * deltaCol;
  let nextRow = dy === 0 ? Infinity : (dy > 0 ? row + 1 - ay : ay - row) * deltaRow;
  visit(col, row);
  for (let steps = Math.abs(Math.floor(bx) - col) + Math.abs(Math.floor(by) - row); steps > 0; steps--) {
    if (nextCol < nextRow) {
      col += stepCol;
      nextCol += deltaCol;
    } else {
      row += stepRow;
      nextRow += deltaRow;
    }
    visit(col, row);
  }
}

/** The area the painting operations reach; erasing outside it changes nothing. */
function paintedBounds(ops: readonly FogOperation[]): WorldBounds | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const op of ops) {
    if (op.isErasing) continue;
    const bounds = calculateOperationBounds(op);
    const xs = [bounds.x, bounds.x + bounds.width];
    const ys = [bounds.y, bounds.y + bounds.height];
    if (![...xs, ...ys].every(Number.isFinite)) continue;
    left = Math.min(left, ...xs);
    right = Math.max(right, ...xs);
    top = Math.min(top, ...ys);
    bottom = Math.max(bottom, ...ys);
  }
  return left < right && top < bottom ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/unit/online/fogCoverage.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 7: Type-check and lint the new files**

Run: `npx tsc --noEmit && npx eslint src/app/online/scene --max-warnings 0`
Expected: both exit 0 with no findings.

- [ ] **Step 8: Commit**

```bash
git add src/app/online/scene/coerce.ts src/app/online/scene/simplifyPoints.ts src/app/online/scene/FogCoverage.ts tests/unit/online/fogCoverage.test.ts
git commit -m "feat(online): fog coverage rasteriser and point simplification"
```

---

### Task 3: Asset ids, object bounds, and the record and panel projections

**Files:**
- Create: `src/app/online/scene/AssetRegistry.ts`, `src/app/online/scene/objectBounds.ts`, `src/app/online/scene/playerViewRules.ts`, `src/app/online/scene/projectRecords.ts`, `src/app/online/scene/projectPanels.ts`
- Test: `tests/unit/online/projectParts.test.ts`

**Interfaces:**
- Consumes: Task 1 (`sceneTypes.ts`: `PlayerFogOp`, `PlayerText`, `PlayerDrawing`, `PlayerWidget`, `PlayerInitiative`, `ScenePoint`, `SCENE_LIMITS`, `PLAYER_TEXT_ALIGNS`, `PLAYER_DRAWING_TYPES`, `PLAYER_WIDGET_TYPES`; `sceneValidation.ts`: `isSceneId`), Task 2 (`coerce.ts` helpers, `wirePoints`, `FogCoverage`, `WorldBounds`), `randomId(bytes?: number): string` (`src/app/online/ids.ts`). Existing: `tokenDiameterInCells(sizeInCells: number): number` (`pixi/token-renderer/tokenSizing.ts`, no imports), `isWidgetOn(settings, widget): boolean` (`utils/widgetActivation.ts`), `isSteppedWidget(widget): widget is SteppedWidget` and `readCounterValue(state: Pick<ViewAtlasState, 'widgetValues'>, widget: SteppedWidget): number` (`utils/counterWidget.ts`), `AtlasSettings['localPlayerView']` (`services/SettingsService.ts`, type only), `ViewAtlasState` (`storeFactory.ts`, type only), `TextElement`, `DrawingStroke` (`types.ts`), `FogOperation` (`types/fogTypes.ts`).
- Produces:
  - `AssetRegistry.ts`: `class AssetRegistry { idFor(path: string | null | undefined): string | null }`
  - `objectBounds.ts`: `DEFAULT_GRID_SIZE = 70`, `DEFAULT_FONT_SIZE = 16`, `TEXT_CHAR_WIDTH = 0.6`, `TEXT_LINE_HEIGHT = 1.25`, `tokenBounds(token: { x: number; y: number; size: number }, gridSize: number): WorldBounds`, `textBounds(text: TextElement): WorldBounds`, `drawingBounds(drawing: Pick<PlayerDrawing, 'points' | 'width'>): WorldBounds`
  - `playerViewRules.ts`: `PLAYER_VIEW_RULE_KEYS` (the six setting names), `type PlayerViewRules = Pick<AtlasSettings['localPlayerView'], 'showGrid' | 'showTokenHP' | 'showTokenStress' | 'showTokenNameplates' | 'showWidgets' | 'showInitiative'>`, `pickPlayerViewRules(settings: PlayerViewRules): PlayerViewRules`, `samePlayerViewRules(a: PlayerViewRules, b: PlayerViewRules): boolean`
  - `projectRecords.ts`: `interface ProjectionMemo { fog: WeakMap<FogOperation, PlayerFogOp | null>; drawings: WeakMap<DrawingStroke, PlayerDrawing | null> }`, `createProjectionMemo(): ProjectionMemo`, `projectRecord<G, P>(records: Readonly<Record<string, G>> | undefined, project: (record: G) => P | null): Record<string, P>`, `projectFogOp(op: FogOperation): PlayerFogOp | null`, `projectFog(fog: Readonly<Record<string, FogOperation>> | undefined, memo: ProjectionMemo): Record<string, PlayerFogOp>`, `projectText(text: TextElement, coverage: FogCoverage): PlayerText | null`, `projectTexts(texts: Readonly<Record<string, TextElement>> | undefined, coverage: FogCoverage): Record<string, PlayerText>`, `projectDrawingShape(stroke: DrawingStroke): PlayerDrawing | null`, `projectDrawings(drawings: Readonly<Record<string, DrawingStroke>> | undefined, coverage: FogCoverage, memo: ProjectionMemo): Record<string, PlayerDrawing>`
  - `projectPanels.ts`: `projectWidgets(state: Pick<ViewAtlasState, 'widgetSettings' | 'widgetValues'>, rules: PlayerViewRules): PlayerWidget[]`, `projectInitiative(state: Pick<ViewAtlasState, 'initiative' | 'initiativeTrackerOpen'>, visibleTokenIds: ReadonlySet<string>, rules: PlayerViewRules): PlayerInitiative | null`

Rules implemented here (spec table): texts dropped when completely under fog, bounds estimated as in plan decision 3; drawings' points simplified to 1 px and dropped when completely under fog, bounds = bounds of the points expanded by the full `width` on each side (conservative); every fog operation sent, offset baked in, points simplified; widgets only with `showWidgets` and `widgetSettings.globalVisible`, each widget on in the scene (`isWidgetOn`) and `visibleToPlayers`, sorted by `order` as `PlayerWidgetBar` does, value from `widgetValues` for counters and clocks; initiative only with `showInitiative` and the tracker open, entries of tokens not in `visibleTokenIds` dropped (the caller passes the ids of projected tokens, so hidden and fogged tokens are gone), name only with `showTokenNameplates`, HP only with `showTokenHP` and max > 0, never stress or statblock. Every object is built field by field; GM records are never spread.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/online/projectParts.test.ts
import { describe, expect, it } from 'vitest';
import type { DrawingStroke, TextElement } from '../../../src/app/types';
import type { FogOperation } from '../../../src/app/types/fogTypes';
import type { AnyWidget } from '../../../src/app/types/widgetTypes';
import type { InitiativeEntry } from '../../../src/app/types/initiativeTypes';
import { createDefaultInitiativeState } from '../../../src/app/types/initiativeTypes';
import { AssetRegistry } from '../../../src/app/online/scene/AssetRegistry';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import { drawingBounds, textBounds, tokenBounds } from '../../../src/app/online/scene/objectBounds';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { pickPlayerViewRules, samePlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { createProjectionMemo, projectDrawings, projectFog, projectFogOp, projectTexts } from '../../../src/app/online/scene/projectRecords';
import { projectInitiative, projectWidgets } from '../../../src/app/online/scene/projectPanels';

const ALL_ON: PlayerViewRules = {
  showGrid: true, showTokenHP: true, showTokenStress: true, showTokenNameplates: true, showWidgets: true, showInitiative: true,
};
const ALL_OFF: PlayerViewRules = {
  showGrid: false, showTokenHP: false, showTokenStress: false, showTokenNameplates: false, showWidgets: false, showInitiative: false,
};

const fogBlock = (x: number, y: number, width: number, height: number): FogCoverage => FogCoverage.fromOperations({
  f: { id: 'f', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x, y, width, height },
});

function text(overrides: Partial<TextElement> = {}): TextElement {
  return { id: 'x', kind: 'text', x: 500, y: 500, text: 'Hello', fontSize: 20, fontFamily: 'serif', color: '#111111', ...overrides };
}
function stroke(overrides: Partial<DrawingStroke> = {}): DrawingStroke {
  return {
    id: 'd', kind: 'drawing', timestamp: 3, type: 'pen', color: '#ff0000', width: 4, opacity: 1,
    points: [{ x: 500, y: 500 }, { x: 510, y: 500 }, { x: 520, y: 500 }], ...overrides,
  };
}
function widget(overrides: Partial<AnyWidget> & { id: string }): AnyWidget {
  return { type: 'counter', label: 'Torches', icon: 'flame', visible: true, visibleToPlayers: true, value: 1, order: 0, ...overrides } as AnyWidget;
}
function entry(overrides: Partial<InitiativeEntry> & { id: string; tokenId: string }): InitiativeEntry {
  return {
    name: 'Goblin', initiative: 12, initiativeModifier: 1, hp: { current: 5, max: 7 }, stress: { current: 1, max: 6 },
    imagePath: 'atlas-vtt/assets/goblin.png', statblockPath: 'Bestiary/Goblin.md',
    isActive: false, isDefeated: false, isNPC: true, order: 0, ...overrides,
  };
}

describe('AssetRegistry', () => {
  it('gives each vault path one random id for the session', () => {
    const assets = new AssetRegistry();
    const id = assets.idFor('atlas-vtt/assets/secret-lair.png');
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(assets.idFor('atlas-vtt/assets/secret-lair.png')).toBe(id);
    expect(assets.idFor('atlas-vtt/assets/other.png')).not.toBe(id);
    expect(new AssetRegistry().idFor('atlas-vtt/assets/secret-lair.png')).not.toBe(id);
    expect(assets.idFor(null)).toBeNull();
    expect(assets.idFor('')).toBeNull();
  });
});

describe('object bounds', () => {
  it('measures token footprints, estimated text boxes and drawings', () => {
    expect(tokenBounds({ x: 100, y: 100, size: 1 }, 70)).toEqual({ x: 65, y: 65, width: 70, height: 70 });
    expect(tokenBounds({ x: 0, y: 0, size: 2 }, 70)).toEqual({ x: -105, y: -105, width: 210, height: 210 });
    expect(textBounds(text({ x: 0, y: 0, padding: 5 }))).toEqual({ x: -35, y: -17.5, width: 70, height: 35 });
    const rotated = textBounds(text({ x: 0, y: 0, rotation: 45 }));
    expect(rotated.width).toBeCloseTo(Math.hypot(60, 25));
    expect(drawingBounds({ points: [{ x: 10, y: 10 }, { x: 30, y: 20 }], width: 4 })).toEqual({ x: 6, y: 6, width: 28, height: 18 });
  });
});

describe('player view rules', () => {
  it('keeps the six settings the projection follows', () => {
    const settings = { ...ALL_ON, showToolbar: true, showDiceRolls: true } as PlayerViewRules;
    expect(pickPlayerViewRules(settings)).toEqual(ALL_ON);
    expect(samePlayerViewRules(ALL_ON, { ...ALL_ON })).toBe(true);
    expect(samePlayerViewRules(ALL_ON, { ...ALL_ON, showTokenHP: false })).toBe(false);
  });
});

describe('fog projection', () => {
  it('bakes offsets in, simplifies points and keeps erase and order', () => {
    const op: FogOperation = {
      id: 'b', kind: 'fog', type: 'brush', timestamp: 7, isErasing: true, brushRadius: 25, offsetX: 10, offsetY: -5,
      points: Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 })),
    };
    expect(projectFogOp(op)).toEqual({ type: 'brush', erase: true, order: 7, radius: 25, points: [{ x: 10, y: -5 }, { x: 59, y: -5 }] });
    const rect: FogOperation = { id: 'r', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: 0, y: 0, width: 5, height: 5, offsetX: 3 };
    expect(projectFogOp(rect)).toEqual({ type: 'rectangle', erase: false, order: 1, x: 3, y: 0, width: 5, height: 5 });
  });

  it('drops operations it cannot send and reuses projections of unchanged records', () => {
    const lasso: FogOperation = { id: 'l', kind: 'fog', type: 'lasso', timestamp: 1, isErasing: false, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
    const broken: FogOperation = { id: 'r', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: Number.NaN, y: 0, width: 5, height: 5 };
    expect(projectFogOp(lasso)).toBeNull();
    expect(projectFogOp(broken)).toBeNull();
    const kept: FogOperation = { id: 'k', kind: 'fog', type: 'rectangle', timestamp: 2, isErasing: false, x: 0, y: 0, width: 5, height: 5 };
    const memo = createProjectionMemo();
    const first = projectFog({ l: lasso, k: kept }, memo);
    expect(Object.keys(first)).toEqual(['k']);
    expect(projectFog({ l: lasso, k: kept }, memo).k).toBe(first.k);
  });
});

describe('text and drawing projection', () => {
  it('drops texts completely under fog and keeps those peeking out', () => {
    const coverage = fogBlock(0, 0, 1000, 1000);
    const texts = projectTexts({ hidden: text(), peeking: text({ x: 990 }) }, coverage);
    expect(Object.keys(texts)).toEqual(['peeking']);
  });

  it('fills in values older map files lack', () => {
    const messy = { ...text(), fontSize: undefined, align: 'justify', opacity: '0.5', text: 42 } as unknown as TextElement;
    expect(projectTexts({ messy }, FogCoverage.EMPTY).messy).toMatchObject({ fontSize: 16, align: 'center', opacity: 0.5, text: '' });
  });

  it('simplifies drawings and drops those completely under fog', () => {
    const memo = createProjectionMemo();
    const clear = projectDrawings({ d: stroke() }, FogCoverage.EMPTY, memo);
    expect(clear.d).toEqual({ type: 'pen', order: 3, points: [{ x: 500, y: 500 }, { x: 520, y: 500 }], color: '#ff0000', width: 4, opacity: 1, icon: null });
    expect(projectDrawings({ d: stroke() }, fogBlock(0, 0, 1000, 1000), memo)).toEqual({});
    const icon = projectDrawings({ i: stroke({ type: 'icon', icon: 'skull', points: [{ x: 5, y: 5 }] }) }, FogCoverage.EMPTY, memo);
    expect(icon.i?.icon).toBe('skull');
  });
});

describe('widget projection', () => {
  const settings = {
    widgets: {
      torches: widget({ id: 'torches', order: 2 }),
      clock: widget({ id: 'clock', type: 'clock', label: 'Doom', segments: 6, order: 1 } as Partial<AnyWidget> & { id: string }),
      timer: widget({ id: 'timer', type: 'timer', label: 'Torch', value: 300, duration: 3600, direction: 'down', order: 3 } as Partial<AnyWidget> & { id: string }),
      secret: widget({ id: 'secret', label: 'Ambush', visibleToPlayers: false }),
      off: widget({ id: 'off', label: 'Off here' }),
    },
    offWidgets: ['off'],
    globalVisible: true,
    position: 'top' as const,
    scale: 1,
  };

  it('lists the visible widgets in order with their current values', () => {
    const widgets = projectWidgets({ widgetSettings: settings, widgetValues: { torches: 4, clock: 2 } }, ALL_ON);
    expect(widgets).toEqual([
      { id: 'clock', type: 'clock', label: 'Doom', icon: 'flame', value: 2 },
      { id: 'torches', type: 'counter', label: 'Torches', icon: 'flame', value: 4 },
      { id: 'timer', type: 'timer', label: 'Torch', icon: 'flame', value: 300 },
    ]);
  });

  it('sends none when widgets are hidden from players', () => {
    expect(projectWidgets({ widgetSettings: settings, widgetValues: {} }, ALL_OFF)).toEqual([]);
    expect(projectWidgets({ widgetSettings: { ...settings, globalVisible: false }, widgetValues: {} }, ALL_ON)).toEqual([]);
  });
});

describe('initiative projection', () => {
  const initiative = {
    ...createDefaultInitiativeState(),
    isActive: true,
    round: 3,
    entries: [
      entry({ id: 'e2', tokenId: 'orc', name: 'Orc', order: 1, isActive: true }),
      entry({ id: 'e1', tokenId: 'goblin', order: 0 }),
      entry({ id: 'e3', tokenId: 'hidden-lich', name: 'Lich', order: 2 }),
    ],
  };
  const visible = new Set(['goblin', 'orc']);

  it('lists entries of visible tokens with names and HP as the settings allow', () => {
    const projected = projectInitiative({ initiative, initiativeTrackerOpen: true }, visible, ALL_ON);
    expect(projected).toEqual({
      round: 3, active: true,
      entries: [
        { id: 'e1', tokenId: 'goblin', initiative: 12, name: 'Goblin', hp: { current: 5, max: 7 }, isActive: false },
        { id: 'e2', tokenId: 'orc', initiative: 12, name: 'Orc', hp: { current: 5, max: 7 }, isActive: true },
      ],
    });
    expect(JSON.stringify(projected)).not.toMatch(/stress|statblock|imagePath|Lich/);
    const plain = projectInitiative({ initiative, initiativeTrackerOpen: true }, visible, { ...ALL_ON, showTokenNameplates: false, showTokenHP: false });
    expect(plain?.entries[0]).toMatchObject({ name: null, hp: null });
  });

  it('sends no tracker when it is closed or hidden, and no turn outside combat', () => {
    expect(projectInitiative({ initiative, initiativeTrackerOpen: false }, visible, ALL_ON)).toBeNull();
    expect(projectInitiative({ initiative, initiativeTrackerOpen: true }, visible, ALL_OFF)).toBeNull();
    const idle = projectInitiative({ initiative: { ...initiative, isActive: false }, initiativeTrackerOpen: true }, visible, ALL_ON);
    expect(idle?.entries.every((line) => !line.isActive)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/online/projectParts.test.ts`
Expected: FAIL with `Failed to resolve import "../../../src/app/online/scene/AssetRegistry"`.

- [ ] **Step 3: Write the asset registry**

```ts
// src/app/online/scene/AssetRegistry.ts
import { randomId } from '../ids';

/**
 * Vault paths as opaque asset ids, per online session: random, so they reveal
 * no file or folder names, and stable within the session so players can cache
 * images by id (piece 3 serves them). Paths never leave the GM's machine.
 */
export class AssetRegistry {
  private readonly ids = new Map<string, string>();

  idFor(path: string | null | undefined): string | null {
    if (typeof path !== 'string' || path.length === 0) return null;
    let id = this.ids.get(path);
    if (!id) {
      id = randomId();
      this.ids.set(path, id);
    }
    return id;
  }
}
```

- [ ] **Step 4: Write the object bounds**

```ts
// src/app/online/scene/objectBounds.ts
/** World-space bounds of scene objects, to test them against the fog coverage. */
import { tokenDiameterInCells } from '../../pixi/token-renderer/tokenSizing';
import type { TextElement } from '../../types';
import { finiteOr, positiveOr, positiveOrNull, textOr } from './coerce';
import type { WorldBounds } from './FogCoverage';
import type { PlayerDrawing } from './sceneTypes';

export const DEFAULT_GRID_SIZE = 70;
export const DEFAULT_FONT_SIZE = 16;
/** Average glyph width and line height in font sizes: the GM side estimates text boxes, it does not measure them. */
export const TEXT_CHAR_WIDTH = 0.6;
export const TEXT_LINE_HEIGHT = 1.25;

/** A token's footprint: its cells (at least one) times the grid size, centred on the token. */
export function tokenBounds(token: { x: number; y: number; size: number }, gridSize: number): WorldBounds {
  const side = Math.max(1, tokenDiameterInCells(token.size)) * gridSize;
  return { x: token.x - side / 2, y: token.y - side / 2, width: side, height: side };
}

/**
 * A text's estimated box, centred on its position like `TextRenderer` draws it.
 * A rotated text gets a square of the box's diagonal, which holds it at any angle.
 */
export function textBounds(text: TextElement): WorldBounds {
  const fontSize = positiveOr(text.fontSize, DEFAULT_FONT_SIZE);
  const padding = Math.max(0, finiteOr(text.padding, 0));
  const scale = positiveOr(text.scale, 1);
  const lines = textOr(text.text, '').split('\n');
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 1);
  const width = ((positiveOrNull(text.width) ?? longest * fontSize * TEXT_CHAR_WIDTH) + 2 * padding) * scale;
  const height = ((positiveOrNull(text.height) ?? lines.length * fontSize * TEXT_LINE_HEIGHT) + 2 * padding) * scale;
  const rotated = finiteOr(text.rotation, 0) % 360 !== 0;
  const boxWidth = rotated ? Math.hypot(width, height) : width;
  const boxHeight = rotated ? boxWidth : height;
  const x = finiteOr(text.x, 0);
  const y = finiteOr(text.y, 0);
  return { x: x - boxWidth / 2, y: y - boxHeight / 2, width: boxWidth, height: boxHeight };
}

/** The bounds of a drawing's points, grown by its full width on every side. */
export function drawingBounds(drawing: Pick<PlayerDrawing, 'points' | 'width'>): WorldBounds {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const point of drawing.points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  const pad = drawing.width;
  return { x: left - pad, y: top - pad, width: right - left + 2 * pad, height: bottom - top + 2 * pad };
}
```

- [ ] **Step 5: Write the player view rules**

```ts
// src/app/online/scene/playerViewRules.ts
import type { AtlasSettings } from '../../services/SettingsService';

/** The `localPlayerView` settings online players follow. */
export const PLAYER_VIEW_RULE_KEYS = [
  'showGrid', 'showTokenHP', 'showTokenStress', 'showTokenNameplates', 'showWidgets', 'showInitiative',
] as const;

export type PlayerViewRules = Pick<AtlasSettings['localPlayerView'], typeof PLAYER_VIEW_RULE_KEYS[number]>;

/** Only the six rules, each strictly true or false. */
export function pickPlayerViewRules(settings: PlayerViewRules): PlayerViewRules {
  return {
    showGrid: settings.showGrid === true,
    showTokenHP: settings.showTokenHP === true,
    showTokenStress: settings.showTokenStress === true,
    showTokenNameplates: settings.showTokenNameplates === true,
    showWidgets: settings.showWidgets === true,
    showInitiative: settings.showInitiative === true,
  };
}

export function samePlayerViewRules(a: PlayerViewRules, b: PlayerViewRules): boolean {
  return PLAYER_VIEW_RULE_KEYS.every((key) => a[key] === b[key]);
}
```

- [ ] **Step 6: Write the record projections**

```ts
// src/app/online/scene/projectRecords.ts
/**
 * Fog operations, texts and drawings as players receive them. Every object is
 * built field by field from the GM record, never spread, so a field this file
 * does not name never leaves the GM's machine.
 */
import type { DrawingStroke, TextElement } from '../../types';
import type { FogOperation } from '../../types/fogTypes';
import { finiteOr, oneOf, positiveOr, positiveOrNull, textOr, textOrNull, unitOr } from './coerce';
import type { FogCoverage } from './FogCoverage';
import { DEFAULT_FONT_SIZE, drawingBounds, textBounds } from './objectBounds';
import {
  PLAYER_DRAWING_TYPES, PLAYER_TEXT_ALIGNS, SCENE_LIMITS, type PlayerDrawing, type PlayerFogOp, type PlayerText,
} from './sceneTypes';
import { isSceneId } from './sceneValidation';
import { wirePoints } from './simplifyPoints';

/**
 * Projections by GM record. Immer keeps unchanged records, so their projections
 * are reused and their points are not simplified again on every change.
 */
export interface ProjectionMemo {
  fog: WeakMap<FogOperation, PlayerFogOp | null>;
  drawings: WeakMap<DrawingStroke, PlayerDrawing | null>;
}

export function createProjectionMemo(): ProjectionMemo {
  return { fog: new WeakMap(), drawings: new WeakMap() };
}

function memoized<K extends object, V>(memo: WeakMap<K, V>, key: K, project: (key: K) => V): V {
  if (memo.has(key)) return memo.get(key) as V;
  const value = project(key);
  memo.set(key, value);
  return value;
}

/** Up to `SCENE_LIMITS.records` records with safe ids, each projected; `null` drops a record. */
export function projectRecord<G, P>(records: Readonly<Record<string, G>> | undefined, project: (record: G) => P | null): Record<string, P> {
  const result: Record<string, P> = {};
  let count = 0;
  for (const [id, record] of Object.entries(records ?? {})) {
    if (count >= SCENE_LIMITS.records) break;
    if (!isSceneId(id) || typeof record !== 'object' || record === null) continue;
    const projected = project(record);
    if (projected === null) continue;
    result[id] = projected;
    count++;
  }
  return result;
}

/** A fog operation with its drag offset applied; null when it has nothing to draw. */
export function projectFogOp(op: FogOperation): PlayerFogOp | null {
  const dx = finiteOr(op.offsetX, 0);
  const dy = finiteOr(op.offsetY, 0);
  // Truthy erases, as on the GM canvas and in `FogCoverage`.
  const erase = Boolean(op.isErasing);
  const order = finiteOr(op.timestamp, 0);
  switch (op.type) {
    case 'rectangle': {
      const x = finiteOr(op.x, Number.NaN) + dx;
      const y = finiteOr(op.y, Number.NaN) + dy;
      const width = finiteOr(op.width, Number.NaN);
      const height = finiteOr(op.height, Number.NaN);
      return [x, y, width, height].every(Number.isFinite) ? { type: 'rectangle', erase, order, x, y, width, height } : null;
    }
    case 'brush': {
      const points = wirePoints(op.points, dx, dy);
      return points.length > 0 ? { type: 'brush', erase, order, radius: positiveOr(op.brushRadius, 1), points } : null;
    }
    case 'lasso': {
      const points = wirePoints(op.points, dx, dy);
      return points.length >= 3 ? { type: 'lasso', erase, order, points } : null;
    }
    default:
      return null;
  }
}

export function projectFog(fog: Readonly<Record<string, FogOperation>> | undefined, memo: ProjectionMemo): Record<string, PlayerFogOp> {
  return projectRecord(fog, (op) => memoized(memo.fog, op, projectFogOp));
}

/** A text players may see; null when it is completely under fog or has no position. */
export function projectText(text: TextElement, coverage: FogCoverage): PlayerText | null {
  const x = finiteOr(text.x, Number.NaN);
  const y = finiteOr(text.y, Number.NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y) || coverage.isCovered(textBounds(text))) return null;
  return {
    x,
    y,
    text: textOr(text.text, '', SCENE_LIMITS.textLength),
    fontSize: positiveOr(text.fontSize, DEFAULT_FONT_SIZE),
    fontFamily: textOr(text.fontFamily, 'sans-serif'),
    color: textOr(text.color, '#000000'),
    backgroundColor: textOrNull(text.backgroundColor),
    padding: Math.max(0, finiteOr(text.padding, 0)),
    borderRadius: Math.max(0, finiteOr(text.borderRadius, 0)),
    opacity: unitOr(text.opacity, 1),
    width: positiveOrNull(text.width),
    height: positiveOrNull(text.height),
    align: oneOf(PLAYER_TEXT_ALIGNS, text.align, 'center'),
    bold: text.bold === true,
    italic: text.italic === true,
    rotation: finiteOr(text.rotation, 0),
    scale: positiveOr(text.scale, 1),
  };
}

export function projectTexts(texts: Readonly<Record<string, TextElement>> | undefined, coverage: FogCoverage): Record<string, PlayerText> {
  return projectRecord(texts, (text) => projectText(text, coverage));
}

/** A drawing's shape with its points simplified; null without points. Fog is checked by the caller. */
export function projectDrawingShape(stroke: DrawingStroke): PlayerDrawing | null {
  const points = wirePoints(stroke.points);
  if (points.length === 0) return null;
  const type = oneOf(PLAYER_DRAWING_TYPES, stroke.type, 'pen');
  return {
    type,
    order: finiteOr(stroke.timestamp, 0),
    points,
    color: textOr(stroke.color, '#000000'),
    width: positiveOr(stroke.width, 1),
    opacity: unitOr(stroke.opacity, 1),
    icon: type === 'icon' ? textOrNull(stroke.icon) : null,
  };
}

export function projectDrawings(
  drawings: Readonly<Record<string, DrawingStroke>> | undefined,
  coverage: FogCoverage,
  memo: ProjectionMemo,
): Record<string, PlayerDrawing> {
  return projectRecord(drawings, (stroke) => {
    const drawing = memoized(memo.drawings, stroke, projectDrawingShape);
    return drawing && !coverage.isCovered(drawingBounds(drawing)) ? drawing : null;
  });
}
```

- [ ] **Step 7: Write the widget and initiative projections**

```ts
// src/app/online/scene/projectPanels.ts
/**
 * The widget bar and initiative tracker as players receive them, following the
 * same rules as `PlayerWidgetBar` and `PlayerInitiativePanel` in the local window.
 */
import type { ViewAtlasState } from '../../storeFactory';
import { isSteppedWidget, readCounterValue } from '../../utils/counterWidget';
import { isWidgetOn } from '../../utils/widgetActivation';
import { finiteOr, hpOrNull, oneOf, textOr, textOrNull } from './coerce';
import type { PlayerViewRules } from './playerViewRules';
import { PLAYER_WIDGET_TYPES, SCENE_LIMITS, type PlayerInitiative, type PlayerWidget } from './sceneTypes';
import { isSceneId } from './sceneValidation';

type WidgetState = Pick<ViewAtlasState, 'widgetSettings' | 'widgetValues'>;
type InitiativeState = Pick<ViewAtlasState, 'initiative' | 'initiativeTrackerOpen'>;

export function projectWidgets(state: WidgetState, rules: PlayerViewRules): PlayerWidget[] {
  const settings = state.widgetSettings;
  if (!rules.showWidgets || !settings?.globalVisible) return [];
  return Object.values(settings.widgets ?? {})
    .filter((widget) => typeof widget === 'object' && widget !== null && isSceneId(widget.id)
      && isWidgetOn(settings, widget) && widget.visibleToPlayers === true)
    .sort((a, b) => finiteOr(a.order, 0) - finiteOr(b.order, 0))
    .slice(0, SCENE_LIMITS.widgets)
    .map((widget) => ({
      id: widget.id,
      type: oneOf(PLAYER_WIDGET_TYPES, widget.type, 'counter'),
      label: textOr(widget.label, ''),
      icon: textOr(widget.icon, ''),
      value: finiteOr(isSteppedWidget(widget) ? readCounterValue(state, widget) : widget.value, 0),
    }));
}

/** `visibleTokenIds`: the tokens players receive, so entries of hidden and fogged tokens are dropped. */
export function projectInitiative(
  state: InitiativeState,
  visibleTokenIds: ReadonlySet<string>,
  rules: PlayerViewRules,
): PlayerInitiative | null {
  const initiative = state.initiative;
  if (!rules.showInitiative || !state.initiativeTrackerOpen || !initiative) return null;
  const combat = initiative.isActive === true;
  const entries = (Array.isArray(initiative.entries) ? initiative.entries : [])
    .filter((entry) => typeof entry === 'object' && entry !== null && isSceneId(entry.id) && visibleTokenIds.has(entry.tokenId))
    .sort((a, b) => finiteOr(a.order, 0) - finiteOr(b.order, 0))
    .slice(0, SCENE_LIMITS.initiativeEntries)
    .map((entry) => ({
      id: entry.id,
      tokenId: entry.tokenId,
      initiative: finiteOr(entry.initiative, 0),
      name: rules.showTokenNameplates ? textOrNull(entry.name) : null,
      hp: rules.showTokenHP ? hpOrNull(entry.hp) : null,
      isActive: combat && entry.isActive === true,
    }));
  return { round: finiteOr(initiative.round, 0), active: combat, entries };
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/unit/online/projectParts.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 9: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/online/scene --max-warnings 0`
Expected: both exit 0 with no findings.

- [ ] **Step 10: Commit**

```bash
git add src/app/online/scene/AssetRegistry.ts src/app/online/scene/objectBounds.ts src/app/online/scene/playerViewRules.ts src/app/online/scene/projectRecords.ts src/app/online/scene/projectPanels.ts tests/unit/online/projectParts.test.ts
git commit -m "feat(online): asset ids and the fog, text, drawing, widget and initiative projections"
```

---

### Task 4: `projectForPlayers`: tokens, grid, map and the whole scene

**Files:**
- Create: `src/app/online/scene/projectForPlayers.ts`
- Test: `tests/unit/online/projectForPlayers.test.ts`

**Interfaces:**
- Consumes: Task 1 (`PlayerScene`, `PlayerToken`, `PlayerGrid`, `PlayerMap`, `PlayerCondition`, `MapSize`, `SCENE_LIMITS`, `PLAYER_GRID_TYPES`, `PLAYER_GRID_LINES`), Task 2 (`FogCoverage`, coerce helpers), Task 3 (`AssetRegistry`, `tokenBounds`, `DEFAULT_GRID_SIZE`, `PlayerViewRules`, `ProjectionMemo`, `projectRecord`, `projectFog`, `projectTexts`, `projectDrawings`, `projectWidgets`, `projectInitiative`). Existing: `tokenHp(token)` / `tokenStress(token)` (`pixi/token-renderer/tokenResources.ts`, type-only imports), `isHexNumberFormat(value): value is HexNumberFormat` and `DEFAULT_HEX_NUMBER_OPACITY` (`grid/hexNumbering.ts`), `GridState` (`services/MapPersistence.ts`, type only), `ViewAtlasState` (type only), `TokenEntity`, `Character` (`types.ts`). For tests: `decodeControl`, `encodeControl` (`protocol.ts`), `createDefaultInitiativeState()`.
- Produces:
  - `type ProjectedState = Pick<ViewAtlasState, 'background' | 'grid' | 'objects' | 'widgetSettings' | 'widgetValues' | 'initiative' | 'initiativeTrackerOpen'>`
  - `interface ProjectionContext { sceneId: string; rules: PlayerViewRules; coverage: FogCoverage; assets: AssetRegistry; mapSize: MapSize; memo: ProjectionMemo }`
  - `projectForPlayers(state: ProjectedState, context: ProjectionContext): PlayerScene`

Rules implemented here (spec table and "never sent"): hidden tokens (`isHidden`) and tokens whose footprint is completely under fog are dropped; a token peeking out is sent. `name` only with `showTokenNameplates` on character tokens (the name, else the statblock name, else "Unknown Creature" when a statblock is linked, as `TokenUIRenderer` shows); `hp` only with `showTokenHP` on character tokens whose max is above 0; `stress` only with `showTokenStress` on character tokens. `ring` is null when `showRing` is false, else the ring colour (white by default). `image` and `map.asset` are asset ids. `grid` is null when `showGrid` is off, the grid is missing, `enabled === false` or `visible === false`. `map.cellSize` is the grid size (70 by default) even when the grid is hidden (plan decision 2); `map.width`/`height` come from `context.mapSize`. Pins, walls, lights, audio, notes, the dice log, pinned previews and loot are never read.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/online/projectForPlayers.test.ts
import { describe, expect, it } from 'vitest';
import type { Character, Token } from '../../../src/app/types';
import type { FogOperation } from '../../../src/app/types/fogTypes';
import { createDefaultInitiativeState } from '../../../src/app/types/initiativeTypes';
import { decodeControl, encodeControl } from '../../../src/app/online/protocol';
import { AssetRegistry } from '../../../src/app/online/scene/AssetRegistry';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { projectForPlayers, type ProjectedState, type ProjectionContext } from '../../../src/app/online/scene/projectForPlayers';
import { createProjectionMemo } from '../../../src/app/online/scene/projectRecords';

const ALL_ON: PlayerViewRules = {
  showGrid: true, showTokenHP: true, showTokenStress: true, showTokenNameplates: true, showWidgets: true, showInitiative: true,
};
const ALL_OFF: PlayerViewRules = {
  showGrid: false, showTokenHP: false, showTokenStress: false, showTokenNameplates: false, showWidgets: false, showInitiative: false,
};

function gmState(overrides: Partial<ProjectedState> = {}): ProjectedState {
  return {
    background: 'atlas-vtt/assets/lair.png',
    grid: { enabled: true, visible: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5, lineType: 'solid', lineWidth: 1 },
    objects: { tokens: {}, fog: {}, pins: {}, texts: {}, drawings: {}, walls: {}, lights: {}, audios: {} },
    widgetSettings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 },
    widgetValues: {},
    initiative: createDefaultInitiativeState(),
    initiativeTrackerOpen: false,
    ...overrides,
  };
}
function withTokens(tokens: Record<string, Token | Character>, extra: Partial<ProjectedState['objects']> = {}): ProjectedState {
  const state = gmState();
  return { ...state, objects: { ...state.objects, tokens, ...extra } };
}
function context(overrides: Partial<ProjectionContext> = {}): ProjectionContext {
  return {
    sceneId: 'scene-1', rules: ALL_ON, coverage: FogCoverage.EMPTY, assets: new AssetRegistry(),
    mapSize: { width: 1000, height: 800 }, memo: createProjectionMemo(), ...overrides,
  };
}
function hero(overrides: Partial<Character> = {}): Character {
  return {
    id: 'hero', kind: 'character', x: 140, y: 140, imagePath: 'atlas-vtt/assets/hero.png', name: 'Anna',
    hp: { current: 7, max: 10 }, stress: 2, maxStress: 6, ringColor: '#3366ff', conditions: ['prone'], ...overrides,
  };
}
const fogOver = (x: number, y: number, width: number, height: number): FogCoverage => FogCoverage.fromOperations({
  f: { id: 'f', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x, y, width, height } satisfies FogOperation,
});

function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, into));
  else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      into.add(key);
      keysOf(item, into);
    }
  }
  return into;
}

describe('projectForPlayers', () => {
  it('sends visible tokens with the fields players may see', () => {
    const scene = projectForPlayers(withTokens({ hero: hero() }), context());
    expect(scene.tokens.hero).toEqual({
      x: 140, y: 140, size: 1, rotation: 0, layer: 0, image: expect.any(String), ring: '#3366ff',
      conditions: [{ id: 'prone', value: null }], name: 'Anna', hp: { current: 7, max: 10 }, stress: { current: 2, max: 6 },
    });
    expect(scene.tokens.hero?.image).not.toContain('hero');
  });

  it('drops hidden tokens', () => {
    const scene = projectForPlayers(withTokens({ hero: hero(), ghost: hero({ id: 'ghost', isHidden: true }) }), context());
    expect(Object.keys(scene.tokens)).toEqual(['hero']);
  });

  it('follows the name, HP and stress settings', () => {
    const scene = projectForPlayers(withTokens({ hero: hero() }), context({ rules: ALL_OFF }));
    expect(scene.tokens.hero).toMatchObject({ name: null, hp: null, stress: null });
    const noMax = projectForPlayers(withTokens({ hero: hero({ hp: { current: 3, max: 0 } }) }), context());
    expect(noMax.tokens.hero?.hp).toBeNull();
    const statblock = projectForPlayers(withTokens({ hero: hero({ name: '', statblockName: 'Goblin boss', statblockPath: 'b.md' }) }), context());
    expect(statblock.tokens.hero?.name).toBe('Goblin boss');
  });

  it('never gives a plain token a name, HP or stress, and drops a hidden ring', () => {
    const plain: Token = { id: 'rock', kind: 'token', x: 0, y: 0, imagePath: 'rock.png', showRing: false };
    expect(projectForPlayers(withTokens({ rock: plain }), context()).tokens.rock).toMatchObject({ name: null, hp: null, stress: null, ring: null });
    const white: Token = { id: 'rock', kind: 'token', x: 0, y: 0, imagePath: 'rock.png' };
    expect(projectForPlayers(withTokens({ rock: white }), context()).tokens.rock?.ring).toBe('#ffffff');
  });

  it('drops a token completely under fog and sends one half under it', () => {
    const coverage = fogOver(0, 0, 500, 500);
    const hiddenByFog = hero({ id: 'a', x: 200, y: 200 });
    const halfUnder = hero({ id: 'b', x: 500, y: 200 });
    const scene = projectForPlayers(withTokens({ a: hiddenByFog, b: halfUnder }), context({ coverage }));
    expect(Object.keys(scene.tokens)).toEqual(['b']);
  });

  it('gives each image one asset id and the map its size', () => {
    const assets = new AssetRegistry();
    const scene = projectForPlayers(withTokens({ hero: hero(), twin: hero({ id: 'twin' }) }), context({ assets }));
    expect(scene.tokens.twin?.image).toBe(scene.tokens.hero?.image);
    expect(scene.map).toEqual({ asset: assets.idFor('atlas-vtt/assets/lair.png'), width: 1000, height: 800, cellSize: 70 });
    const bare = projectForPlayers(gmState({ background: null, grid: null }), context({ mapSize: { width: 0, height: 0 } }));
    expect(bare.map).toEqual({ asset: null, width: 0, height: 0, cellSize: 70 });
  });

  it('sends the grid only when it is shown', () => {
    expect(projectForPlayers(gmState(), context()).grid).toEqual({
      type: 'square', size: 70, offsetX: 0, offsetY: 0, color: null, opacity: 0.5,
      lineType: 'solid', lineWidth: 1, hexNumbers: null, hexNumberOpacity: null,
    });
    expect(projectForPlayers(gmState(), context({ rules: { ...ALL_ON, showGrid: false } })).grid).toBeNull();
    const hidden = gmState({ grid: { enabled: true, visible: false, size: 70, offsetX: 0, offsetY: 0, opacity: 1 } });
    expect(projectForPlayers(hidden, context()).grid).toBeNull();
    const off = gmState({ grid: { enabled: false, size: 70, offsetX: 0, offsetY: 0, opacity: 1 } });
    expect(projectForPlayers(off, context()).grid).toBeNull();
    expect(projectForPlayers(hidden, context()).map.cellSize).toBe(70);
    const hex = gmState({ grid: { enabled: true, type: 'hex-vertical', size: 60, offsetX: 3, offsetY: 4, opacity: 1, hexNumbers: 'column-row' } });
    expect(projectForPlayers(hex, context()).grid).toMatchObject({ type: 'hex-vertical', size: 60, hexNumbers: 'column-row', hexNumberOpacity: 0.8 });
  });

  it('lists initiative only for tokens players receive', () => {
    const initiative = {
      ...createDefaultInitiativeState(),
      entries: [
        { id: 'e1', tokenId: 'hero', name: 'Anna', initiative: 15, initiativeModifier: 0, hp: { current: 7, max: 10 }, imagePath: '', isActive: false, isDefeated: false, isNPC: false, order: 0 },
        { id: 'e2', tokenId: 'ghost', name: 'Ghost', initiative: 9, initiativeModifier: 0, hp: { current: 1, max: 1 }, imagePath: '', isActive: false, isDefeated: false, isNPC: true, order: 1 },
      ],
    };
    const state = { ...withTokens({ hero: hero(), ghost: hero({ id: 'ghost', isHidden: true }) }), initiative, initiativeTrackerOpen: true };
    expect(projectForPlayers(state, context()).initiative?.entries.map((entry) => entry.tokenId)).toEqual(['hero']);
  });

  it('never sends a GM-only or unknown field', () => {
    const secretHero = {
      ...hero({
        notePath: 'SECRET/notes/villain.md', statblockPath: 'SECRET/bestiary/villain.md', statblockName: 'SECRET-statblock',
        tags: ['SECRET-tag'], playerLinked: true, playerId: 'SECRET-player', playerCharacterId: 'SECRET-character',
        hasVision: true, visionInnerRadius: 11, visionOuterRadius: 22, instanceNumber: 3, showNameplate: true,
        hope: 2, difficulty: 'SECRET-cr', maxHpOverridden: true, maxStressOverridden: true,
        statblockResources: { mana: { current: 1, max: 2 } }, conditionValues: { prone: 2 },
      }),
      futureField: 'SECRET-future',
    };
    const state = {
      ...gmState({ background: 'SECRET/maps/lair.png' }),
      objects: {
        tokens: { hero: secretHero, hidden: hero({ id: 'hidden', name: 'SECRET-hidden', isHidden: true }) },
        fog: { f: { id: 'f', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: 900, y: 900, width: 5, height: 5, futureField: 'SECRET-future' } },
        pins: { p: { id: 'p', kind: 'pin', x: 1, y: 1, notePath: 'SECRET/pin.md', gmOnly: true, hex: true } },
        texts: { t: { id: 't', kind: 'text', x: 50, y: 50, text: 'Sign', fontSize: 12, fontFamily: 'serif', color: '#000000', futureField: 'SECRET-future' } },
        drawings: { d: { id: 'd', kind: 'drawing', timestamp: 1, type: 'pen', points: [{ x: 1, y: 1 }], color: '#000000', width: 2, opacity: 1, futureField: 'SECRET-future' } },
        walls: { w: { id: 'w', label: 'SECRET-wall' } },
        lights: { l: { id: 'l', label: 'SECRET-light' } },
        audios: { a: { id: 'a', filePath: 'SECRET/music.mp3' } },
      },
      widgetSettings: {
        widgets: {
          w1: { id: 'w1', type: 'counter', label: 'Torches', icon: 'flame', visible: true, visibleToPlayers: true, value: 1, order: 0, color: '#ff0000', futureField: 'SECRET-future' },
          w2: { id: 'w2', type: 'counter', label: 'SECRET-widget', icon: 'flame', visible: true, visibleToPlayers: false, value: 1, order: 1 },
        },
        globalVisible: true, position: 'top', scale: 1,
      },
      initiative: {
        ...createDefaultInitiativeState(),
        entries: [{
          id: 'e1', tokenId: 'hero', name: 'Anna', initiative: 15, initiativeModifier: 0, hp: { current: 7, max: 10 },
          stress: { current: 1, max: 6 }, imagePath: 'SECRET/art.png', statblockPath: 'SECRET/statblock.md',
          isActive: false, isDefeated: false, isNPC: false, order: 0, futureField: 'SECRET-future',
        }],
      },
      initiativeTrackerOpen: true,
      dmNotePath: 'SECRET/dm.md',
      diceLog: [{ formula: 'SECRET-roll' }],
      pinnedNotePreviews: { x: { notePath: 'SECRET/preview.md' } },
      lootRoller: { open: true, table: 'SECRET-loot' },
    } as unknown as ProjectedState;

    const scene = projectForPlayers(state, context());
    const json = JSON.stringify(scene);
    expect(json).not.toContain('SECRET');
    const neverSent = [
      'isHidden', 'notePath', 'statblockPath', 'statblockName', 'tags', 'playerLinked', 'playerId', 'playerCharacterId',
      'hasVision', 'visionInnerRadius', 'visionOuterRadius', 'instanceNumber', 'showNameplate', 'hope', 'difficulty',
      'maxHpOverridden', 'maxStressOverridden', 'statblockResources', 'conditionValues', 'imagePath', 'kind', 'futureField',
      'pins', 'gmOnly', 'hex', 'walls', 'lights', 'audios', 'dmNotePath', 'diceLog', 'pinnedNotePreviews', 'lootRoller',
      'visibleToPlayers', 'visible', 'initiativeModifier', 'isDefeated', 'isNPC', 'timestamp', 'offsetX', 'isErasing', 'color',
    ];
    const keys = keysOf({ ...scene, grid: null, texts: {}, drawings: {} });
    for (const key of neverSent) expect(keys.has(key), key).toBe(false);
    expect(scene.initiative?.entries[0]).not.toHaveProperty('stress');
  });

  it('projects messy map data into messages players accept', () => {
    const messyHero = hero({ hp: { current: '7', max: '10' } as unknown as { current: number; max: number }, rotation: Number.NaN, size: -2 });
    const lost = hero({ id: 'lost', x: Number.NaN });
    const sneaky = { ...hero({ id: 'sneaky' }), isHidden: 1 } as unknown as Character;
    const state = {
      ...withTokens({ hero: messyHero, lost, sneaky }),
      grid: { enabled: true, size: 'big', offsetX: null, offsetY: 4, opacity: 7, lineType: 'wavy' },
      objects: {
        ...withTokens({ hero: messyHero, lost, sneaky }).objects,
        texts: { t: { id: 't', kind: 'text', x: 5, y: 5, text: null, fontFamily: 3, color: null } },
        drawings: { d: { id: 'd', kind: 'drawing', type: 'spray', points: [null, { x: 1, y: 'a' }, { x: 2, y: 2 }], width: -1 } },
        fog: { f: { id: 'f', kind: 'fog', type: 'brush', timestamp: 'late', isErasing: 1, points: [{ x: 0, y: 0 }], brushRadius: 'wide' } },
      },
      widgetSettings: { widgets: { w: { id: 'w', type: 'dial', label: 5, visible: true, visibleToPlayers: true, value: 'x', order: 0 } }, globalVisible: true, position: 'top', scale: 1 },
    } as unknown as ProjectedState;

    const scene = projectForPlayers(state, context());
    expect(Object.keys(scene.tokens)).toEqual(['hero']);
    expect(scene.tokens.hero).toMatchObject({ hp: { current: 7, max: 10 }, rotation: 0, size: 1 });
    const { fog, drawings, ...body } = scene;
    const snapshot = decodeControl(encodeControl({ v: 1, type: 'scene-snapshot', seq: 1, scene: body, fogParts: 1, drawingParts: 1 }));
    const fogPart = decodeControl(encodeControl({ v: 1, type: 'scene-fog', seq: 2, part: 0, records: fog }));
    const drawingPart = decodeControl(encodeControl({ v: 1, type: 'scene-drawings', seq: 3, part: 0, records: drawings }));
    expect(snapshot.kind).toBe('message');
    expect(fogPart.kind).toBe('message');
    expect(drawingPart.kind).toBe('message');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/online/projectForPlayers.test.ts`
Expected: FAIL with `Failed to resolve import "../../../src/app/online/scene/projectForPlayers"`.

- [ ] **Step 3: Write the projection**

```ts
// src/app/online/scene/projectForPlayers.ts
/**
 * The only place that decides what leaves the GM's machine: the presented
 * scene as online players may see it, exactly what the local player window
 * shows and nothing more. Every sent object is built field by field from the
 * GM's records, never spread, so anything this code does not name, including
 * fields a later Atlas adds, is left out.
 */
import { DEFAULT_HEX_NUMBER_OPACITY, isHexNumberFormat } from '../../grid/hexNumbering';
import { tokenHp, tokenStress } from '../../pixi/token-renderer/tokenResources';
import type { GridState } from '../../services/MapPersistence';
import type { ViewAtlasState } from '../../storeFactory';
import type { Character, TokenEntity } from '../../types';
import type { AssetRegistry } from './AssetRegistry';
import { finiteOr, finiteOrNull, hpOrNull, oneOf, positiveOr, resourceOrNull, textOr, textOrNull, unitOr } from './coerce';
import type { FogCoverage } from './FogCoverage';
import { DEFAULT_GRID_SIZE, tokenBounds } from './objectBounds';
import type { PlayerViewRules } from './playerViewRules';
import { projectInitiative, projectWidgets } from './projectPanels';
import { projectDrawings, projectFog, projectRecord, projectTexts, type ProjectionMemo } from './projectRecords';
import {
  PLAYER_GRID_LINES, PLAYER_GRID_TYPES, SCENE_LIMITS,
  type MapSize, type PlayerCondition, type PlayerGrid, type PlayerMap, type PlayerScene, type PlayerToken,
} from './sceneTypes';

export type ProjectedState = Pick<
  ViewAtlasState,
  'background' | 'grid' | 'objects' | 'widgetSettings' | 'widgetValues' | 'initiative' | 'initiativeTrackerOpen'
>;

export interface ProjectionContext {
  sceneId: string;
  rules: PlayerViewRules;
  /** Rebuilt by the caller only when the fog operations change. */
  coverage: FogCoverage;
  assets: AssetRegistry;
  mapSize: MapSize;
  memo: ProjectionMemo;
}

const DEFAULT_RING = '#ffffff';
const DEFAULT_GRID_OPACITY = 0.7;

export function projectForPlayers(state: ProjectedState, context: ProjectionContext): PlayerScene {
  const objects = state.objects;
  const cellSize = positiveOr(state.grid?.size, DEFAULT_GRID_SIZE);
  const tokens = projectRecord(objects?.tokens, (token) => projectToken(token, context, cellSize));
  return {
    sceneId: context.sceneId,
    map: projectMap(state.background, cellSize, context),
    grid: projectGrid(state.grid, context.rules),
    tokens,
    fog: projectFog(objects?.fog, context.memo),
    texts: projectTexts(objects?.texts, context.coverage),
    drawings: projectDrawings(objects?.drawings, context.coverage, context.memo),
    widgets: projectWidgets(state, context.rules),
    initiative: projectInitiative(state, new Set(Object.keys(tokens)), context.rules),
  };
}

function projectMap(background: string | null, cellSize: number, context: ProjectionContext): PlayerMap {
  return {
    asset: context.assets.idFor(background),
    width: Math.max(0, finiteOr(context.mapSize.width, 0)),
    height: Math.max(0, finiteOr(context.mapSize.height, 0)),
    cellSize,
  };
}

function projectGrid(grid: GridState | null, rules: PlayerViewRules): PlayerGrid | null {
  if (!rules.showGrid || !grid || grid.enabled === false || grid.visible === false) return null;
  const hexNumbers = isHexNumberFormat(grid.hexNumbers) ? grid.hexNumbers : null;
  return {
    type: oneOf(PLAYER_GRID_TYPES, grid.type, 'square'),
    size: positiveOr(grid.size, DEFAULT_GRID_SIZE),
    offsetX: finiteOr(grid.offsetX, 0),
    offsetY: finiteOr(grid.offsetY, 0),
    color: textOrNull(grid.color),
    opacity: unitOr(grid.opacity, DEFAULT_GRID_OPACITY),
    lineType: oneOf(PLAYER_GRID_LINES, grid.lineType, 'solid'),
    lineWidth: positiveOr(grid.lineWidth, 1),
    hexNumbers,
    hexNumberOpacity: hexNumbers ? unitOr(grid.hexNumberOpacity, DEFAULT_HEX_NUMBER_OPACITY) : null,
  };
}

function projectToken(token: TokenEntity, context: ProjectionContext, cellSize: number): PlayerToken | null {
  // Any truthy value hides, as in the local window (`playerSafeFrame`, `PlayerInitiativePanel`).
  if (token.isHidden) return null;
  const x = finiteOr(token.x, Number.NaN);
  const y = finiteOr(token.y, Number.NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const size = positiveOr(token.size, 1);
  if (context.coverage.isCovered(tokenBounds({ x, y, size }, cellSize))) return null;
  const character = token.kind === 'character' ? token : null;
  const { rules } = context;
  return {
    x,
    y,
    size,
    rotation: finiteOr(token.rotation, 0),
    layer: finiteOr(token.layer, 0),
    image: context.assets.idFor(token.imagePath),
    ring: token.showRing === false ? null : textOr(token.ringColor, DEFAULT_RING),
    conditions: projectConditions(token),
    name: character && rules.showTokenNameplates ? displayName(character) : null,
    hp: character && rules.showTokenHP ? hpOrNull(tokenHp(character)) : null,
    stress: character && rules.showTokenStress ? resourceOrNull(tokenStress(character)) : null,
  };
}

/** The nameplate text `TokenUIRenderer` shows: the name, the statblock's name, or a placeholder for a statblock. */
function displayName(token: Character): string | null {
  return textOrNull(token.name) ?? textOrNull(token.statblockName) ?? (token.statblockPath ? 'Unknown Creature' : null);
}

function projectConditions(token: TokenEntity): PlayerCondition[] {
  const ids: unknown[] = Array.isArray(token.conditions) ? token.conditions : [];
  const values: Record<string, unknown> = typeof token.conditionValues === 'object' && token.conditionValues !== null
    ? token.conditionValues
    : {};
  return ids
    .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= SCENE_LIMITS.idLength)
    .slice(0, SCENE_LIMITS.conditions)
    .map((id) => ({ id, value: Object.hasOwn(values, id) ? finiteOrNull(values[id]) : null }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/online/projectForPlayers.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/online/scene --max-warnings 0`
Expected: both exit 0 with no findings.

- [ ] **Step 6: Commit**

```bash
git add src/app/online/scene/projectForPlayers.ts tests/unit/online/projectForPlayers.test.ts
git commit -m "feat(online): project the presented scene for players"
```

---

### Task 5: Scene diff and patch apply

**Files:**
- Create: `src/app/online/scene/sceneDiff.ts`
- Test: `tests/unit/online/sceneDiff.test.ts`

**Interfaces:**
- Consumes (Task 1): `PlayerScene`, `ScenePatchBody`, `SCENE_FIELD_KEYS`, `SCENE_RECORD_KEYS`; fixtures `playerScene`, `playerToken`, `fogRect`.
- Produces:
  - `sameValue(a: unknown, b: unknown): boolean` (deep equality of JSON values)
  - `diffScenes(previous: PlayerScene, next: PlayerScene): ScenePatchBody | null` (per record: upserts and removals by id, compared by value; `map`, `grid`, `widgets`, `initiative` replaced when they differ; `null` when nothing changed). It assumes both have the same `sceneId`; the broadcaster sends a snapshot for a new scene.
  - `applyPatch(scene: PlayerScene, patch: ScenePatchBody): PlayerScene` (a new object; the input is untouched; fields it does not know are ignored). Shared with the join page: imports only `sceneTypes.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/online/sceneDiff.test.ts
import { describe, expect, it } from 'vitest';
import { applyPatch, diffScenes, sameValue } from '../../../src/app/online/scene/sceneDiff';
import type { ScenePatchBody } from '../../../src/app/online/scene/sceneTypes';
import { fogRect, playerScene, playerToken } from './sceneFixtures';

describe('sameValue', () => {
  it('compares JSON values deeply', () => {
    expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameValue([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(sameValue(null, {})).toBe(false);
  });
});

describe('diffScenes', () => {
  it('finds nothing between equal scenes, even rebuilt ones', () => {
    expect(diffScenes(playerScene(), playerScene())).toBeNull();
  });

  it('upserts a moved token and nothing else', () => {
    const next = playerScene({ tokens: { t1: playerToken({ x: 300 }) } });
    expect(diffScenes(playerScene(), next)).toEqual({ set: {}, upsert: { tokens: { t1: playerToken({ x: 300 }) } }, remove: {} });
  });

  it('removes and adds records by id', () => {
    const next = playerScene({ fog: { f2: fogRect(2, { erase: true }) }, drawings: {} });
    expect(diffScenes(playerScene(), next)).toEqual({
      set: {},
      upsert: { fog: { f2: fogRect(2, { erase: true }) } },
      remove: { fog: ['f1'], drawings: ['d1'] },
    });
  });

  it('replaces top-level fields that differ', () => {
    const next = playerScene({ grid: null, widgets: [{ id: 'w1', type: 'counter', label: 'Torches', icon: 'flame', value: 4 }] });
    expect(diffScenes(playerScene(), next)).toEqual({
      set: { grid: null, widgets: [{ id: 'w1', type: 'counter', label: 'Torches', icon: 'flame', value: 4 }] },
      upsert: {},
      remove: {},
    });
  });
});

describe('applyPatch', () => {
  it('turns the previous scene into the next one', () => {
    const previous = playerScene();
    const next = playerScene({
      map: { asset: null, width: 0, height: 0, cellSize: 50 },
      tokens: { t1: playerToken({ hp: { current: 3, max: 9 } }), t2: playerToken({ x: 7 }) },
      texts: {},
      initiative: null,
    });
    const patch = diffScenes(previous, next);
    expect(patch).not.toBeNull();
    expect(applyPatch(previous, patch!)).toEqual(next);
  });

  it('leaves its input untouched and ignores fields it does not know', () => {
    const previous = playerScene();
    const before = JSON.parse(JSON.stringify(previous)) as typeof previous;
    const patch = {
      set: { lighting: 'dim' },
      upsert: { walls: { w: {} }, tokens: { t9: playerToken() } },
      remove: { tokens: ['t1'] },
    } as unknown as ScenePatchBody;
    const next = applyPatch(previous, patch);
    expect(previous).toEqual(before);
    expect(Object.keys(next.tokens)).toEqual(['t9']);
    expect(next).not.toHaveProperty('lighting');
    expect(next).not.toHaveProperty('walls');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/online/sceneDiff.test.ts`
Expected: FAIL with `Failed to resolve import "../../../src/app/online/scene/sceneDiff"`.

- [ ] **Step 3: Write the diff**

```ts
// src/app/online/scene/sceneDiff.ts
/**
 * Differences between two projections of one scene, and applying them.
 * Shared with the web player page, so this file imports only the wire types.
 */
import { SCENE_FIELD_KEYS, SCENE_RECORD_KEYS, type PlayerScene, type ScenePatchBody } from './sceneTypes';

type AnyRecord = Record<string, unknown>;

/** Deep equality of JSON values. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => sameValue(item, b[index]));
  }
  const left = a as AnyRecord;
  const right = b as AnyRecord;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}

function diffRecord(before: AnyRecord, after: AnyRecord): { upsert: AnyRecord; remove: string[] } {
  const upsert: AnyRecord = {};
  for (const id of Object.keys(after)) {
    if (!Object.hasOwn(before, id) || !sameValue(before[id], after[id])) upsert[id] = after[id];
  }
  const remove = Object.keys(before).filter((id) => !Object.hasOwn(after, id));
  return { upsert, remove };
}

/** What changed from `previous` to `next`, two projections of the same scene; null when nothing did. */
export function diffScenes(previous: PlayerScene, next: PlayerScene): ScenePatchBody | null {
  const patch: ScenePatchBody = { set: {}, upsert: {}, remove: {} };
  let changed = false;
  for (const key of SCENE_FIELD_KEYS) {
    if (sameValue(previous[key], next[key])) continue;
    (patch.set as AnyRecord)[key] = next[key];
    changed = true;
  }
  for (const key of SCENE_RECORD_KEYS) {
    const { upsert, remove } = diffRecord(previous[key], next[key]);
    if (Object.keys(upsert).length > 0) {
      (patch.upsert as AnyRecord)[key] = upsert;
      changed = true;
    }
    if (remove.length > 0) {
      patch.remove[key] = remove;
      changed = true;
    }
  }
  return changed ? patch : null;
}

/** `scene` with `patch` applied, as a new object. Fields the patch carries that this version does not know are ignored. */
export function applyPatch(scene: PlayerScene, patch: ScenePatchBody): PlayerScene {
  const next = { ...scene } as unknown as AnyRecord;
  for (const key of SCENE_FIELD_KEYS) {
    if (Object.hasOwn(patch.set, key)) next[key] = (patch.set as AnyRecord)[key];
  }
  for (const key of SCENE_RECORD_KEYS) {
    const upsert = Object.hasOwn(patch.upsert, key) ? (patch.upsert as AnyRecord)[key] as AnyRecord : null;
    const remove = Object.hasOwn(patch.remove, key) ? patch.remove[key] ?? [] : [];
    if (!upsert && remove.length === 0) continue;
    const record: AnyRecord = { ...(next[key] as AnyRecord) };
    for (const id of remove) delete record[id];
    if (upsert) for (const id of Object.keys(upsert)) record[id] = upsert[id];
    next[key] = record;
  }
  return next as unknown as PlayerScene;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/online/sceneDiff.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0 with no output.

- [ ] **Step 6: Commit**

```bash
git add src/app/online/scene/sceneDiff.ts tests/unit/online/sceneDiff.test.ts
git commit -m "feat(online): diff scene projections and apply patches"
```

---

### Task 6: `PlayerSceneMirror` and routing scene messages in `PlayerSession`

**Files:**
- Create: `src/app/online/scene/PlayerSceneMirror.ts`
- Modify: `src/app/online/PlayerSession.ts` (imports, `PlayerSessionOptions`, constructor, `scene` getter, `stop`, `receive`, `finish`)
- Test: `tests/unit/online/playerSceneMirror.test.ts`, `tests/unit/online/playerSessionScene.test.ts`

**Interfaces:**
- Consumes: Task 1 (`ControlMessage` scene members, `bad-scene-` invalid reasons, fixtures), Task 5 (`applyPatch`). Existing: `PlayerSession`, `GmSession` (`use`, `send`, `allow`), `MemoryNetwork`.
- Produces:
  - `PlayerSceneMirror.ts`: `RESYNC_MIN_INTERVAL_MS = 1000`, `type SceneMessage = Extract<ControlMessage, { type: 'scene-snapshot' | 'scene-fog' | 'scene-drawings' | 'scene-patch' | 'scene-clear' }>`, `interface PlayerSceneMirrorOptions { sendResync(seq: number): void; onChange(scene: PlayerScene | null): void }`, `class PlayerSceneMirror { constructor(options: PlayerSceneMirrorOptions); get scene(): PlayerScene | null; receive(message: SceneMessage): void; invalid(): void; dispose(): void }`
  - `PlayerSessionOptions.onScene?(scene: PlayerScene | null): void` and `PlayerSession.scene: PlayerScene | null` (getter). Task 9's join page uses both.

Rules: a snapshot is accepted at any `seq` and shown once all its `fogParts` fog parts and `drawingParts` drawing parts arrived, each kind in order from part 0 and never beyond its count; a part, a patch or anything else must carry `lastSeq + 1`, else it is discarded and a `scene-resync` with the last applied `seq` (0 before any) is sent; a patch before any snapshot is discarded the same way; while waiting for a snapshot the player keeps the scene it has; `scene-clear` is applied at any `seq`. Resyncs, including those after invalid scene messages, are sent at most once per second: one asked for sooner is sent when the second is up. A snapshot or clear cancels a pending resync.

- [ ] **Step 1: Write the failing mirror test**

```ts
// tests/unit/online/playerSceneMirror.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerSceneMirror, RESYNC_MIN_INTERVAL_MS } from '../../../src/app/online/scene/PlayerSceneMirror';
import type { PlayerScene } from '../../../src/app/online/scene/sceneTypes';
import { fogRect, playerScene, playerToken, sceneBody } from './sceneFixtures';

function setup(): { mirror: PlayerSceneMirror; resyncs: number[]; changes: Array<PlayerScene | null> } {
  const resyncs: number[] = [];
  const changes: Array<PlayerScene | null> = [];
  const mirror = new PlayerSceneMirror({ sendResync: (seq) => resyncs.push(seq), onChange: (scene) => changes.push(scene) });
  return { mirror, resyncs, changes };
}

const scene = playerScene({ fog: { f1: fogRect(1), f2: fogRect(2, { erase: true }) } });

describe('PlayerSceneMirror', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows a snapshot once all its fog and drawing parts arrived', () => {
    const { mirror, changes } = setup();
    mirror.receive({ v: 1, type: 'scene-snapshot', seq: 4, scene: sceneBody(scene), fogParts: 2, drawingParts: 1 });
    mirror.receive({ v: 1, type: 'scene-fog', seq: 5, part: 0, records: { f1: fogRect(1) } });
    mirror.receive({ v: 1, type: 'scene-drawings', seq: 6, part: 0, records: scene.drawings });
    expect(changes).toEqual([]);
    mirror.receive({ v: 1, type: 'scene-fog', seq: 7, part: 1, records: { f2: fogRect(2, { erase: true }) } });
    expect(mirror.scene).toEqual(scene);
    expect(changes).toHaveLength(1);
  });

  it('waits for the drawing parts too', () => {
    const { mirror, changes } = setup();
    mirror.receive({ v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 0, drawingParts: 1 });
    expect(mirror.scene).toBeNull();
    mirror.receive({ v: 1, type: 'scene-drawings', seq: 2, part: 0, records: scene.drawings });
    expect(mirror.scene?.drawings).toEqual(scene.drawings);
    expect(changes).toHaveLength(1);
  });

  it('shows a snapshot without parts at once and applies patches in order', () => {
    const { mirror, changes } = setup();
    mirror.receive({ v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 0, drawingParts: 0 });
    expect(mirror.scene?.fog).toEqual({});
    expect(mirror.scene?.drawings).toEqual({});
    mirror.receive({ v: 1, type: 'scene-patch', seq: 2, set: {}, upsert: { tokens: { t1: playerToken({ x: 400 }) } }, remove: {} });
    expect(mirror.scene?.tokens.t1?.x).toBe(400);
    expect(changes).toHaveLength(2);
  });

  it('discards a patch before any snapshot and asks for one', () => {
    const { mirror, resyncs } = setup();
    mirror.receive({ v: 1, type: 'scene-patch', seq: 1, set: {}, upsert: {}, remove: { tokens: ['t1'] } });
    expect(mirror.scene).toBeNull();
    expect(resyncs).toEqual([0]);
  });

  it('discards a patch after a gap and keeps the scene it has', () => {
    const { mirror, resyncs } = setup();
    mirror.receive({ v: 1, type: 'scene-snapshot', seq: 3, scene: sceneBody(scene), fogParts: 0, drawingParts: 0 });
    mirror.receive({ v: 1, type: 'scene-patch', seq: 5, set: {}, upsert: {}, remove: { tokens: ['t1'] } });
    expect(mirror.scene?.tokens.t1).toBeDefined();
    expect(resyncs).toEqual([3]);
  });

  it('asks again when a part is missing, out of order or beyond its count', () => {
    const missing = setup();
    missing.mirror.receive({ v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 2, drawingParts: 0 });
    missing.mirror.receive({ v: 1, type: 'scene-fog', seq: 2, part: 1, records: {} });
    expect(missing.mirror.scene).toBeNull();
    expect(missing.resyncs).toEqual([1]);
    const extra = setup();
    extra.mirror.receive({ v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 0, drawingParts: 0 });
    extra.mirror.receive({ v: 1, type: 'scene-drawings', seq: 2, part: 0, records: {} });
    expect(extra.resyncs).toEqual([1]);
  });

  it('asks for a resync at most once per second', () => {
    const { mirror, resyncs } = setup();
    mirror.invalid();
    mirror.invalid();
    mirror.invalid();
    expect(resyncs).toEqual([0]);
    vi.advanceTimersByTime(RESYNC_MIN_INTERVAL_MS - 1);
    expect(resyncs).toEqual([0]);
    vi.advanceTimersByTime(1);
    expect(resyncs).toEqual([0, 0]);
  });

  it('drops a pending resync when a snapshot arrives', () => {
    const { mirror, resyncs } = setup();
    mirror.invalid();
    mirror.invalid();
    mirror.receive({ v: 1, type: 'scene-snapshot', seq: 9, scene: sceneBody(scene), fogParts: 0, drawingParts: 0 });
    vi.advanceTimersByTime(RESYNC_MIN_INTERVAL_MS);
    expect(resyncs).toEqual([0]);
  });

  it('clears the scene at any seq', () => {
    const { mirror, changes } = setup();
    mirror.receive({ v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 0, drawingParts: 0 });
    mirror.receive({ v: 1, type: 'scene-clear', seq: 7 });
    expect(mirror.scene).toBeNull();
    expect(changes.at(-1)).toBeNull();
    mirror.receive({ v: 1, type: 'scene-patch', seq: 8, set: {}, upsert: {}, remove: {} });
    expect(mirror.scene).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/online/playerSceneMirror.test.ts`
Expected: FAIL with `Failed to resolve import "../../../src/app/online/scene/PlayerSceneMirror"`.

- [ ] **Step 3: Write the mirror**

```ts
// src/app/online/scene/PlayerSceneMirror.ts
/**
 * The player's copy of the presented scene, built from scene messages. Shared
 * with the web player page, so it imports nothing from Obsidian. A snapshot is
 * shown once all its fog and drawing parts arrived. A message that does not
 * follow the last one, or a patch before any snapshot, is discarded and
 * answered with a `scene-resync`; the GM replies with a snapshot.
 */
import type { ControlMessage } from '../protocol';
import { applyPatch } from './sceneDiff';
import type { PlayerDrawing, PlayerFogOp, PlayerScene, PlayerSceneBody } from './sceneTypes';

export const RESYNC_MIN_INTERVAL_MS = 1000;

export type SceneMessage = Extract<
  ControlMessage,
  { type: 'scene-snapshot' | 'scene-fog' | 'scene-drawings' | 'scene-patch' | 'scene-clear' }
>;
type PartMessage = Extract<SceneMessage, { type: 'scene-fog' | 'scene-drawings' }>;

export interface PlayerSceneMirrorOptions {
  /** Ask the GM for a snapshot; `seq` is the last message applied, 0 before any. */
  sendResync(seq: number): void;
  onChange(scene: PlayerScene | null): void;
}

interface PendingSnapshot {
  body: PlayerSceneBody;
  fogParts: number;
  drawingParts: number;
  fogReceived: number;
  drawingsReceived: number;
  fog: Record<string, PlayerFogOp>;
  drawings: Record<string, PlayerDrawing>;
}

export class PlayerSceneMirror {
  private current: PlayerScene | null = null;
  private pending: PendingSnapshot | null = null;
  private lastSeq = 0;
  private lastResyncAt = Number.NEGATIVE_INFINITY;
  private resyncTimer: number | null = null;

  constructor(private readonly options: PlayerSceneMirrorOptions) {}

  get scene(): PlayerScene | null {
    return this.current;
  }

  receive(message: SceneMessage): void {
    switch (message.type) {
      case 'scene-snapshot':
        this.cancelResync();
        this.lastSeq = message.seq;
        this.pending = {
          body: message.scene, fogParts: message.fogParts, drawingParts: message.drawingParts,
          fogReceived: 0, drawingsReceived: 0, fog: {}, drawings: {},
        };
        this.commitIfComplete();
        break;
      case 'scene-fog':
      case 'scene-drawings':
        this.receivePart(message);
        break;
      case 'scene-patch':
        if (!this.current || this.pending || message.seq !== this.lastSeq + 1) {
          this.lost();
          break;
        }
        this.lastSeq = message.seq;
        this.current = applyPatch(this.current, message);
        this.options.onChange(this.current);
        break;
      case 'scene-clear': {
        this.cancelResync();
        this.lastSeq = message.seq;
        const hadScene = this.current !== null || this.pending !== null;
        this.current = null;
        this.pending = null;
        if (hadScene) this.options.onChange(null);
        break;
      }
    }
  }

  /** A scene message failed validation: ask for a snapshot, at most once per second. */
  invalid(): void {
    this.requestResync();
  }

  dispose(): void {
    this.cancelResync();
  }

  /** Fog and drawing parts each arrive in order, numbered from 0, and never beyond the snapshot's count. */
  private receivePart(message: PartMessage): void {
    const pending = this.pending;
    const isFog = message.type === 'scene-fog';
    const expected = pending ? (isFog ? pending.fogReceived : pending.drawingsReceived) : -1;
    const total = pending ? (isFog ? pending.fogParts : pending.drawingParts) : 0;
    if (!pending || message.seq !== this.lastSeq + 1 || message.part !== expected || expected >= total) {
      this.lost();
      return;
    }
    this.lastSeq = message.seq;
    if (message.type === 'scene-fog') {
      for (const [id, op] of Object.entries(message.records)) pending.fog[id] = op;
      pending.fogReceived++;
    } else {
      for (const [id, drawing] of Object.entries(message.records)) pending.drawings[id] = drawing;
      pending.drawingsReceived++;
    }
    this.commitIfComplete();
  }

  private commitIfComplete(): void {
    const pending = this.pending;
    if (!pending || pending.fogReceived < pending.fogParts || pending.drawingsReceived < pending.drawingParts) return;
    this.pending = null;
    this.current = { ...pending.body, fog: pending.fog, drawings: pending.drawings };
    this.options.onChange(this.current);
  }

  /** A message did not follow the last one: drop it and any half-received snapshot, keep the scene shown. */
  private lost(): void {
    this.pending = null;
    this.requestResync();
  }

  private requestResync(): void {
    if (this.resyncTimer !== null) return;
    const wait = this.lastResyncAt + RESYNC_MIN_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      this.sendResync();
      return;
    }
    this.resyncTimer = window.setTimeout(() => {
      this.resyncTimer = null;
      this.sendResync();
    }, wait);
  }

  private sendResync(): void {
    this.lastResyncAt = Date.now();
    this.options.sendResync(this.lastSeq);
  }

  private cancelResync(): void {
    if (this.resyncTimer !== null) window.clearTimeout(this.resyncTimer);
    this.resyncTimer = null;
  }
}
```

- [ ] **Step 4: Run the mirror test to verify it passes**

Run: `npx vitest run tests/unit/online/playerSceneMirror.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Write the failing session test**

```ts
// tests/unit/online/playerSessionScene.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession } from '../../../src/app/online/PlayerSession';
import type { ControlMessage } from '../../../src/app/online/protocol';
import { RESYNC_MIN_INTERVAL_MS } from '../../../src/app/online/scene/PlayerSceneMirror';
import type { PlayerScene } from '../../../src/app/online/scene/sceneTypes';
import { MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';
import { playerScene, playerToken, sceneBody } from './sceneFixtures';

interface Harness {
  gm: GmSession;
  player: PlayerSession;
  playerId: string;
  fromPlayer: ControlMessage[];
  scenes: Array<PlayerScene | null>;
}

async function admittedPlayer(): Promise<Harness> {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const gm = new GmSession(network.host('gm'), {
    title: 'Vault', onJoinRequest: (p) => requests.push(p), onRequestClosed: () => {}, onPlayersChanged: () => {},
  });
  gm.start();
  const fromPlayer: ControlMessage[] = [];
  gm.use({ onMessage: (_player, message) => fromPlayer.push(message) });
  const scenes: Array<PlayerScene | null> = [];
  const player = new PlayerSession({
    hostId: 'gm', name: 'Anna', playerKey: 'key-a', clientVersion: '1', transport: network.client(),
    onChange: () => {}, onScene: (scene) => scenes.push(scene),
  });
  player.start();
  await vi.advanceTimersByTimeAsync(0);
  const playerId = requests[0]!.playerId;
  gm.allow(playerId);
  return { gm, player, playerId, fromPlayer, scenes };
}

describe('PlayerSession scenes', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows the snapshot and patches the GM sends', async () => {
    const { gm, player, playerId, scenes } = await admittedPlayer();
    const scene = playerScene();
    gm.send(playerId, { v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 1, drawingParts: 1 });
    gm.send(playerId, { v: 1, type: 'scene-fog', seq: 2, part: 0, records: scene.fog });
    gm.send(playerId, { v: 1, type: 'scene-drawings', seq: 3, part: 0, records: scene.drawings });
    expect(scenes.at(-1)).toEqual(scene);
    gm.send(playerId, { v: 1, type: 'scene-patch', seq: 4, set: {}, upsert: { tokens: { t1: playerToken({ x: 300 }) } }, remove: {} });
    expect(player.scene?.tokens.t1?.x).toBe(300);
  });

  it('asks the GM for a snapshot after a gap', async () => {
    const { gm, player, playerId, fromPlayer } = await admittedPlayer();
    gm.send(playerId, { v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(playerScene()), fogParts: 0, drawingParts: 0 });
    gm.send(playerId, { v: 1, type: 'scene-patch', seq: 3, set: {}, upsert: {}, remove: { tokens: ['t1'] } });
    expect(player.scene?.tokens.t1).toBeDefined();
    expect(fromPlayer).toEqual([{ v: 1, type: 'scene-resync', seq: 1 }]);
  });

  it('answers invalid scene messages with a resync, at most once per second', async () => {
    const { gm, playerId, fromPlayer } = await admittedPlayer();
    const broken = { v: 1, type: 'scene-patch', seq: 1, set: {}, upsert: { tokens: { t1: { x: 'left' } } }, remove: {} } as unknown as ControlMessage;
    gm.send(playerId, broken);
    gm.send(playerId, broken);
    expect(fromPlayer).toEqual([{ v: 1, type: 'scene-resync', seq: 0 }]);
    await vi.advanceTimersByTimeAsync(RESYNC_MIN_INTERVAL_MS);
    expect(fromPlayer).toHaveLength(2);
  });

  it('shows nothing once the GM clears the scene', async () => {
    const { gm, player, playerId, scenes } = await admittedPlayer();
    gm.send(playerId, { v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(playerScene()), fogParts: 0, drawingParts: 0 });
    gm.send(playerId, { v: 1, type: 'scene-clear', seq: 2 });
    expect(player.scene).toBeNull();
    expect(scenes.at(-1)).toBeNull();
  });
});
```

- [ ] **Step 6: Run the session test to verify it fails**

Run: `npx vitest run tests/unit/online/playerSessionScene.test.ts`
Expected: FAIL: `onScene` is never called (`expected undefined to deeply equal …`) and `player.scene` is `undefined`.

- [ ] **Step 7: Route scene messages in `PlayerSession`**

In `src/app/online/PlayerSession.ts`:

Add after the existing imports:

```ts
import { PlayerSceneMirror } from './scene/PlayerSceneMirror';
import type { PlayerScene } from './scene/sceneTypes';
```

Add to `PlayerSessionOptions`, after `onChange(state: PlayerSessionState): void;`:

```ts
  /** The presented scene changed: a snapshot or patch applied, or null when the GM shows none. */
  onScene?(scene: PlayerScene | null): void;
```

Add a field after `private retryTimer: number | null = null;` and replace `constructor(private readonly options: PlayerSessionOptions) {}` with:

```ts
  private readonly mirror: PlayerSceneMirror;

  constructor(private readonly options: PlayerSessionOptions) {
    this.mirror = new PlayerSceneMirror({
      sendResync: (seq) => this.link?.send('control', encodeControl({ v: 1, type: 'scene-resync', seq })),
      onChange: (scene) => this.options.onScene?.(scene),
    });
  }

  /** The presented scene as this player has it; null while the GM shows none. */
  get scene(): PlayerScene | null {
    return this.mirror.scene;
  }
```

In `stop()`, after `this.retryTimer = null;` add:

```ts
    this.mirror.dispose();
```

In `receive(link, data)`, replace

```ts
    const decoded = decodeControl(data);
    if (decoded.kind !== 'message') return;
```

with

```ts
    const decoded = decodeControl(data);
    if (decoded.kind === 'invalid' && decoded.reason.startsWith('bad-scene-')) this.mirror.invalid();
    if (decoded.kind !== 'message') return;
```

and add these cases before `default:` in its `switch`:

```ts
      case 'scene-snapshot':
      case 'scene-fog':
      case 'scene-drawings':
      case 'scene-patch':
      case 'scene-clear':
        this.mirror.receive(message);
        break;
```

In `finish(status, reason)`, after `this.retryTimer = null;` add:

```ts
    this.mirror.dispose();
```

- [ ] **Step 8: Run the online tests to verify they pass**

Run: `npx vitest run tests/unit/online`
Expected: PASS, including the 4 new tests in `playerSessionScene.test.ts` and the unchanged `playerSession.test.ts`.

- [ ] **Step 9: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/online --max-warnings 0`
Expected: both exit 0 with no findings.

- [ ] **Step 10: Commit**

```bash
git add src/app/online/scene/PlayerSceneMirror.ts src/app/online/PlayerSession.ts tests/unit/online/playerSceneMirror.test.ts tests/unit/online/playerSessionScene.test.ts
git commit -m "feat(online): mirror the presented scene on the player side"
```

---

### Task 7: `PresentedScene`, the local window following it, and "Present to players"

**Files:**
- Create: `src/app/services/PresentedScene.ts`, `src/app/services/presentToPlayers.ts`
- Create: `src/app/react/hooks/usePresentedTabId.ts`
- Modify: `src/app/services/PlayerWindowPresenter.ts` (whole file below), `src/app/plugin/registerCommands.ts` (imports, `registerPlayerViewCommands`), `src/app/react/components/ViewActionsMenu.tsx` (imports, menu entries), `src/app/react/components/SceneTabBar.tsx` (presented marker), `main.ts` (import, `onunload`)
- Test: `tests/unit/presentedScene.test.ts`, `tests/unit/presentToPlayers.test.ts`, `tests/unit/sceneTabBar.presented.test.tsx`; modify `tests/unit/playerWindowPresenter.test.ts` (reset in `beforeEach`, one new test)

**Interfaces:**
- Consumes: `MapSize` (Task 1). Existing: `TabMetaStore` (`stores/tabMetaStore.ts`), `ViewAtlasState` (type), `AtlasView` (`tabMetaStore`, `atlasStore`, `register`, `renderer` getter returning `PixiRendererOrchestrator | null` with public `getBackgroundSprite(): Sprite | null`), `PlayerWindowService` (`getInstance`, `isWindowOpen`, `presentCanvas(source, tabId, filePath?)`, `holdCurrentFrame()`, `releaseHeldFrame(source)`, `releaseSource(store)`), `playerWindowStore`.
- Produces:
  - `PresentedScene.ts`:
    - `interface PresentedView { readonly tabMetaStore: TabMetaStore; readonly atlasStore: StoreApi<ViewAtlasState>; register(callback: () => void): void; readonly renderer?: { getBackgroundSprite(): { width: number; height: number; destroyed: boolean } | null } | null }`
    - `interface PresentedSceneInfo { readonly view: PresentedView; readonly tabId: string; readonly store: StoreApi<ViewAtlasState>; mapSize(): MapSize }`
    - `interface PresentedSceneListener { presented?(scene: PresentedSceneInfo, resumed: boolean): void; held?(scene: PresentedSceneInfo): void; cleared?(previous: PresentedSceneInfo): void }`
    - `whenMapLoaded(store: StoreApi<ViewAtlasState>): Promise<void>`
    - `loadedMapSize(view: PresentedView): MapSize`
    - `presentedTabIdIn(scene: PresentedSceneInfo | null, tabStore: TabMetaStore): string | null`
    - `class PresentedScene { current(): PresentedSceneInfo | null; isHeld(): boolean; subscribe(listener: PresentedSceneListener): () => void; present(view: PresentedView, tabId: string): void; clear(): void }`
    - `const presentedScene: PresentedScene` (one per plugin, like `playerWindowStore`)
  - `presentToPlayers.ts`: `presentViewToPlayers(view: unknown): Promise<void>`, `presentActiveTabToPlayers(app: App): Promise<void>`, `stopPresenting(): void`
  - `usePresentedTabId(tabStore: TabMetaStore): string | null` (`src/app/react/hooks/usePresentedTabId.ts`); the scene tab bar marks that tab as presented.
  - Commands `present-to-players` ("Present to players") and `stop-presenting` ("Stop presenting", available only while a scene is presented); view-actions items "Present to players" and, while presenting, "Stop presenting".

Behaviour (spec "Presenting", plan decisions 1, 5, 6, 7): `present(view, tabId)` is called once the caller has waited for the map to load; it emits `presented(scene, false)`, or `held(scene)` when the view shows another tab. Switching the view to another tab emits `held` once. Switching back resumes only when `isMapLoading` is false, checked again after the wait, then emits `presented(scene, true)`. `cleared(previous)` fires on `clear()`, when the presented view closes (`view.register`, once per view), and when the presented tab is removed from the view (tab closed or scene deleted). The existing present commands keep their behaviour: `presentTabInPlayerWindow` still switches, waits for a rendered frame, opens or re-targets the local window, then calls `presentedScene.present`. The local window follows the presented scene: `held` holds its frame, `presented` with `resumed` releases the hold, `presented` of another tab re-targets an open window, `cleared` releases the view (`releaseSource`). The scene tab bar's "presented" marker follows `PresentedScene` instead of `playerWindowStore`, so it also shows a scene presented only to online players. `tests/unit/playerWindowPresenter.test.ts` pins that nothing else changes: it must pass with only the reset added.

- [ ] **Step 1: Write the failing `PresentedScene` test**

```ts
// tests/unit/presentedScene.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { createTabMetaStore } from '../../src/app/stores/tabMetaStore';
import { PresentedScene, type PresentedView } from '../../src/app/services/PresentedScene';

interface FakeView {
  view: PresentedView;
  tabs: ReturnType<typeof createTabMetaStore>;
  store: ReturnType<typeof createStore<{ isMapLoading: boolean }>>;
  register: ReturnType<typeof vi.fn>;
  close(): void;
  tavern: string;
  dungeon: string;
}

function fakeView(renderer?: PresentedView['renderer']): FakeView {
  const tabs = createTabMetaStore();
  const store = createStore<{ isMapLoading: boolean }>(() => ({ isMapLoading: false }));
  const closers: Array<() => void> = [];
  const register = vi.fn((callback: () => void) => { closers.push(callback); });
  const tavern = tabs.getState().addTab('maps/tavern.atlasmap', 'Tavern');
  const dungeon = tabs.getState().addTab('maps/dungeon.atlasmap', 'Dungeon');
  tabs.getState().setActiveTab(tavern);
  const view = { tabMetaStore: tabs, atlasStore: store, register, ...(renderer !== undefined ? { renderer } : {}) } as unknown as PresentedView;
  return { view, tabs, store, register, close: () => closers.forEach((callback) => callback()), tavern, dungeon };
}

function record(scene: PresentedScene): string[] {
  const events: string[] = [];
  scene.subscribe({
    presented: (info, resumed) => events.push(`${resumed ? 'resumed' : 'presented'}:${info.tabId}`),
    held: (info) => events.push(`held:${info.tabId}`),
    cleared: (info) => events.push(`cleared:${info.tabId}`),
  });
  return events;
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('PresentedScene', () => {
  it('presents a tab of a view', () => {
    const scene = new PresentedScene();
    const events = record(scene);
    const { view, tavern, store } = fakeView();
    scene.present(view, tavern);
    expect(events).toEqual([`presented:${tavern}`]);
    expect(scene.current()).toMatchObject({ view, tabId: tavern, store });
    expect(scene.isHeld()).toBe(false);
  });

  it('holds once while the GM browses other tabs', () => {
    const scene = new PresentedScene();
    const events = record(scene);
    const { view, tabs, tavern, dungeon } = fakeView();
    scene.present(view, tavern);
    tabs.getState().setActiveTab(dungeon);
    tabs.getState().markTabDirty(dungeon, true);
    expect(events).toEqual([`presented:${tavern}`, `held:${tavern}`]);
    expect(scene.isHeld()).toBe(true);
  });

  it('resumes once the presented tab is back and its map has loaded', async () => {
    const scene = new PresentedScene();
    const events = record(scene);
    const { view, tabs, store, tavern, dungeon } = fakeView();
    scene.present(view, tavern);
    tabs.getState().setActiveTab(dungeon);
    store.setState({ isMapLoading: true });
    tabs.getState().setActiveTab(tavern);
    await flush();
    expect(events.at(-1)).toBe(`held:${tavern}`);
    store.setState({ isMapLoading: false });
    await flush();
    expect(events.at(-1)).toBe(`resumed:${tavern}`);
    expect(scene.isHeld()).toBe(false);
  });

  it('waits for a load that starts right after switching back', async () => {
    const scene = new PresentedScene();
    const events = record(scene);
    const { view, tabs, store, tavern, dungeon } = fakeView();
    scene.present(view, tavern);
    tabs.getState().setActiveTab(dungeon);
    tabs.getState().setActiveTab(tavern);
    store.setState({ isMapLoading: true });
    await flush();
    expect(events.at(-1)).toBe(`held:${tavern}`);
    store.setState({ isMapLoading: false });
    await flush();
    expect(events.at(-1)).toBe(`resumed:${tavern}`);
  });

  it('clears when the presented view closes, and ignores it afterwards', () => {
    const scene = new PresentedScene();
    const events = record(scene);
    const { view, tabs, close, tavern, dungeon } = fakeView();
    scene.present(view, tavern);
    close();
    expect(events).toEqual([`presented:${tavern}`, `cleared:${tavern}`]);
    expect(scene.current()).toBeNull();
    tabs.getState().setActiveTab(dungeon);
    expect(events).toHaveLength(2);
  });

  it('clears when the presented tab is closed', () => {
    const scene = new PresentedScene();
    const events = record(scene);
    const { view, tabs, tavern } = fakeView();
    scene.present(view, tavern);
    tabs.getState().removeTab(tavern);
    expect(events.at(-1)).toBe(`cleared:${tavern}`);
  });

  it('replaces the presented scene and registers each view once', () => {
    const scene = new PresentedScene();
    const events = record(scene);
    const first = fakeView();
    const second = fakeView();
    scene.present(first.view, first.tavern);
    scene.present(first.view, first.tavern);
    scene.present(second.view, second.tavern);
    expect(first.register).toHaveBeenCalledTimes(1);
    first.tabs.getState().setActiveTab(first.dungeon);
    first.close();
    expect(events).toEqual([`presented:${first.tavern}`, `presented:${first.tavern}`, `presented:${second.tavern}`]);
    expect(scene.current()?.view).toBe(second.view);
  });

  it('starts held when the view shows another tab', () => {
    const scene = new PresentedScene();
    const events = record(scene);
    const { view, dungeon } = fakeView();
    scene.present(view, dungeon);
    expect(events).toEqual([`held:${dungeon}`]);
  });

  it('reads the map size from the loaded background', () => {
    const scene = new PresentedScene();
    const plain = fakeView();
    scene.present(plain.view, plain.tavern);
    expect(scene.current()?.mapSize()).toEqual({ width: 0, height: 0 });
    const sprite = { width: 1000, height: 500, destroyed: false };
    const withMap = fakeView({ getBackgroundSprite: () => sprite });
    scene.present(withMap.view, withMap.tavern);
    expect(scene.current()?.mapSize()).toEqual({ width: 1000, height: 500 });
    sprite.destroyed = true;
    expect(scene.current()?.mapSize()).toEqual({ width: 0, height: 0 });
  });

  it('does nothing when cleared with nothing presented', () => {
    const scene = new PresentedScene();
    const events = record(scene);
    scene.clear();
    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/presentedScene.test.ts`
Expected: FAIL with `Failed to resolve import "../../src/app/services/PresentedScene"`.

- [ ] **Step 3: Write `PresentedScene`**

```ts
// src/app/services/PresentedScene.ts
import type { StoreApi } from 'zustand';
import type { MapSize } from '../online/scene/sceneTypes';
import type { ViewAtlasState } from '../storeFactory';
import type { TabMetaStore } from '../stores/tabMetaStore';

interface BackgroundSprite {
  width: number;
  height: number;
  destroyed: boolean;
}

/** What `PresentedScene` needs of an Atlas view; `AtlasView` provides it. */
export interface PresentedView {
  readonly tabMetaStore: TabMetaStore;
  readonly atlasStore: StoreApi<ViewAtlasState>;
  register(callback: () => void): void;
  readonly renderer?: { getBackgroundSprite(): BackgroundSprite | null } | null;
}

export interface PresentedSceneInfo {
  readonly view: PresentedView;
  readonly tabId: string;
  /** The view store holding the scene; all tabs of a view share it. */
  readonly store: StoreApi<ViewAtlasState>;
  /** The loaded background's size in world pixels; 0 × 0 without one. */
  mapSize(): MapSize;
}

export interface PresentedSceneListener {
  /** `resumed` is false for a new presentation, true when a held scene is shown again after loading. */
  presented?(scene: PresentedSceneInfo, resumed: boolean): void;
  /** The GM switched the presented view to another tab; players keep the last scene they saw. */
  held?(scene: PresentedSceneInfo): void;
  /** Nothing is presented any more: stopped, the view closed, or its tab was closed. */
  cleared?(previous: PresentedSceneInfo): void;
}

/** Resolves once the store is not loading a map. */
export function whenMapLoaded(store: StoreApi<ViewAtlasState>): Promise<void> {
  if (!store.getState().isMapLoading) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = store.subscribe((state) => {
      if (state.isMapLoading) return;
      unsubscribe();
      resolve();
    });
  });
}

/** The background's size, read from the renderer; 0 × 0 while none is loaded. */
export function loadedMapSize(view: PresentedView): MapSize {
  const sprite = view.renderer?.getBackgroundSprite() ?? null;
  if (!sprite || sprite.destroyed || !(sprite.width > 0) || !(sprite.height > 0)) return { width: 0, height: 0 };
  return { width: sprite.width, height: sprite.height };
}

/**
 * Which scene players see: one for the local player window and online players.
 * While the GM shows the presented view another tab the scene is held, since
 * the view's store then holds that other map; once the presented tab is active
 * again and its map has loaded, the scene is presented again (`resumed`).
 */
export class PresentedScene {
  private scene: PresentedSceneInfo | null = null;
  private held = false;
  /** Invalidates resume waits that a later tab change made stale. */
  private resumeToken = 0;
  private stopWatching: (() => void) | null = null;
  private readonly listeners = new Set<PresentedSceneListener>();
  private readonly viewsClearingOnClose = new WeakSet<PresentedView>();

  current(): PresentedSceneInfo | null {
    return this.scene;
  }

  isHeld(): boolean {
    return this.scene !== null && this.held;
  }

  subscribe(listener: PresentedSceneListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Present `tabId` of `view`. The caller has waited for its map to load. */
  present(view: PresentedView, tabId: string): void {
    this.stopWatching?.();
    const scene: PresentedSceneInfo = { view, tabId, store: view.atlasStore, mapSize: () => loadedMapSize(view) };
    this.scene = scene;
    this.held = view.tabMetaStore.getState().activeTabId !== tabId;
    this.resumeToken++;
    this.clearOnClose(view);
    this.stopWatching = view.tabMetaStore.subscribe((state) => {
      this.tabsChanged(scene, state.activeTabId, state.tabs.some((tab) => tab.id === tabId));
    });
    if (this.held) this.emit((listener) => listener.held?.(scene));
    else this.emit((listener) => listener.presented?.(scene, false));
  }

  clear(): void {
    const previous = this.scene;
    if (!previous) return;
    this.stopWatching?.();
    this.stopWatching = null;
    this.scene = null;
    this.held = false;
    this.resumeToken++;
    this.emit((listener) => listener.cleared?.(previous));
  }

  private tabsChanged(scene: PresentedSceneInfo, activeTabId: string | null, tabExists: boolean): void {
    if (this.scene !== scene) return;
    if (!tabExists) {
      this.clear();
      return;
    }
    if (activeTabId !== scene.tabId) {
      this.resumeToken++;
      if (this.held) return;
      this.held = true;
      this.emit((listener) => listener.held?.(scene));
      return;
    }
    if (this.held) this.resumeWhenLoaded(scene, ++this.resumeToken);
  }

  /** Views switch the active tab before loading its map, so loading is checked again after each wait. */
  private resumeWhenLoaded(scene: PresentedSceneInfo, token: number): void {
    void whenMapLoaded(scene.store).then(() => {
      if (this.scene !== scene || !this.held || token !== this.resumeToken) return;
      if (scene.store.getState().isMapLoading) {
        this.resumeWhenLoaded(scene, token);
        return;
      }
      if (scene.view.tabMetaStore.getState().activeTabId !== scene.tabId) return;
      this.held = false;
      this.emit((listener) => listener.presented?.(scene, true));
    });
  }

  private clearOnClose(view: PresentedView): void {
    if (this.viewsClearingOnClose.has(view)) return;
    this.viewsClearingOnClose.add(view);
    // A closed view must not stay reachable from the presented scene.
    view.register(() => {
      if (this.scene?.view === view) this.clear();
    });
  }

  private emit(notify: (listener: PresentedSceneListener) => void): void {
    for (const listener of [...this.listeners]) notify(listener);
  }
}

/** The plugin's presented scene; like `playerWindowStore`, one per plugin and so per vault. */
export const presentedScene = new PresentedScene();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/presentedScene.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Make the local window follow the presented scene**

Replace `src/app/services/PlayerWindowPresenter.ts` with:

```ts
import { App, Notice } from 'obsidian';
import type { LocalPlayerView } from '../local-player-view';
import { AtlasView, ATLAS_VIEW_TYPE } from '../atlas-view';
import { playerWindowStore } from '../stores/playerWindowStore';
import type { SceneTab } from '../types/sceneTabTypes';
import { PlayerWindowService, type PlayerFrameSource } from './PlayerWindowService';
import { getRenderedFrames } from '../pixi/RenderScheduler';
import { presentedScene, whenMapLoaded } from './PresentedScene';

/** Set once the player window follows the presented scene; it starts with the first presentation through it. */
let followingPresentedScene = false;

/** Present the active view's current scene tab, opening the player window if needed. */
export async function presentActiveTabInPlayerWindow(app: App): Promise<void> {
  const view = app.workspace.getActiveViewOfType(AtlasView);
  const activeTabId = view?.tabMetaStore.getState().activeTabId ?? null;
  if (!view || !activeTabId) {
    new Notice('No active map to send to the player view');
    return;
  }
  await presentTabInPlayerWindow(app, view, activeTabId);
}

/**
 * Switch `view` to the scene tab `tabId`, wait until it is rendered, then show it
 * to players. Opens the player window when it is not open yet. From then on the
 * player window keeps showing this tab while the DM browses other tabs.
 */
export async function presentTabInPlayerWindow(app: App, view: AtlasView, tabId: string): Promise<void> {
  const tab = findTab(view, tabId);
  if (!tab) return;

  await view.switchToTab(tabId);
  if (view.tabMetaStore.getState().activeTabId !== tabId) return;

  const source = await waitForRenderedFrameSource(view);
  if (!source) {
    new Notice('No map canvas found. Please ensure a map is loaded.');
    return;
  }

  const service =
    PlayerWindowService.getInstance() ??
    new PlayerWindowService(app, view.atlasStore, view.serviceManager.getSettingsService());
  if (service.isWindowOpen()) {
    service.presentCanvas(source, tabId, tab.filePath);
  } else {
    await service.openPlayerWindow(source, tabId, tab.filePath);
  }
  followPresentedScene();
  presentedScene.present(view, tabId);
  new Notice(`Player view shows ${tab.displayName}`);
}

/** Reconnect a restored workspace leaf without opening another popout. */
export async function restorePlayerWindow(app: App, player: LocalPlayerView): Promise<void> {
  if (player.isClosed || PlayerWindowService.getInstance()?.ownsView(player)) return;
  const session = player.getState();
  const leaves = app.workspace.getLeavesOfType(ATLAS_VIEW_TYPE);
  // Prefer the exact scene tab; fall back to its path if tab IDs changed.
  let sourceView: AtlasView | undefined;
  let sourceTab: SceneTab | undefined;
  for (const leaf of leaves) {
    // revealLeaf also loads deferred views on supported Obsidian versions.
    if (!(leaf.view instanceof AtlasView)) await app.workspace.revealLeaf(leaf);
    if (!(leaf.view instanceof AtlasView)) continue;
    const tabs = leaf.view.tabMetaStore.getState().tabs;
    const tab = tabs.find((entry) => entry.id === session.tabId) ?? tabs.find((entry) => entry.filePath === session.filePath);
    if (tab) { sourceView = leaf.view; sourceTab = tab; break; }
  }
  if (!sourceView || !sourceTab) {
    player.contentEl.setText('Open the presented scene and send it to the player view to reconnect.');
    return;
  }
  const previousTabId = sourceView.tabMetaStore.getState().activeTabId;
  await whenMapLoaded(sourceView.atlasStore);
  if (player.isClosed) return;
  await sourceView.switchToTab(sourceTab.id);
  if (sourceView.tabMetaStore.getState().activeTabId !== sourceTab.id) {
    player.contentEl.setText('The presented scene could not be loaded. Send a scene to reconnect.');
    return;
  }
  const source = await waitForRenderedFrameSource(sourceView);
  if (!source || player.isClosed) return;
  const service = PlayerWindowService.getInstance() ?? new PlayerWindowService(
    app, sourceView.atlasStore, sourceView.serviceManager.getSettingsService(),
  );
  const viewport = sourceView.serviceManager.getRendererService().getViewport();
  // A frozen camera is rendered on its own, so only a live presentation moves the DM viewport.
  if (session.camera && viewport && !session.frozen) {
    viewport.setZoom(session.camera.scale);
    viewport.moveCenter(session.camera.centerX, session.camera.centerY);
  }
  // Freeze before attaching so the first mirrored frame already uses the saved camera.
  if (session.frozen) service.freezeCamera(session.camera ?? source.getCamera?.());
  service.attachToView(player, source, sourceTab.id);
  followPresentedScene();
  presentedScene.present(sourceView, sourceTab.id);
  if (previousTabId && previousTabId !== sourceTab.id) await sourceView.switchToTab(previousTabId);
}

/**
 * The player window shows the presented scene: it holds its frame while the DM
 * browses other tabs, resumes when the presented tab is back, follows a scene
 * presented elsewhere ("Present to players") and lets go of a view that closes.
 */
function followPresentedScene(): void {
  if (followingPresentedScene) return;
  followingPresentedScene = true;
  presentedScene.subscribe({
    presented: (scene, resumed) => {
      if (scene.view instanceof AtlasView) void showPresentedScene(scene.view, scene.tabId, resumed);
    },
    held: () => PlayerWindowService.getInstance()?.holdCurrentFrame(),
    // Closing the presented map must not leave its renderer and store reachable from the player window
    cleared: (previous) => PlayerWindowService.getInstance()?.releaseSource(previous.store),
  });
}

/** Show the presented scene in an open player window: a held one coming back, or one presented elsewhere. */
async function showPresentedScene(view: AtlasView, tabId: string, resumed: boolean): Promise<void> {
  if (!PlayerWindowService.getInstance()?.isWindowOpen()) return;
  if (!resumed && playerWindowStore.getState().presentedTabId === tabId) return;
  const source = await waitForRenderedFrameSource(view);
  const service = PlayerWindowService.getInstance();
  if (!source || !service || view.tabMetaStore.getState().activeTabId !== tabId) return;
  if (presentedScene.current()?.tabId !== tabId) return;
  if (resumed) service.releaseHeldFrame(source);
  else service.presentCanvas(source, tabId, findTab(view, tabId)?.filePath);
}

function findTab(view: AtlasView, tabId: string): SceneTab | undefined {
  return view.tabMetaStore.getState().tabs.find((tab) => tab.id === tabId);
}

/** Resolve the view's frame source after the current scene load has finished and been drawn. */
async function waitForRenderedFrameSource(view: AtlasView): Promise<PlayerFrameSource | null> {
  await whenMapLoaded(view.atlasStore);
  await nextAnimationFrames(2);
  const renderer = view.serviceManager.getRendererService().getRenderer();
  const canvas = renderer?.getAppInstance()?.canvas;
  if (!renderer || !canvas?.instanceOf(HTMLCanvasElement)) return null;
  return {
    canvas,
    store: view.atlasStore,
    withPlayerSafeFrame: (capture, settings, camera) => renderer.withPlayerSafeFrame(capture, settings, camera),
    getRenderedFrames: () => getRenderedFrames(renderer.getAppInstance()),
    getCamera: () => {
      const viewport = view.serviceManager.getRendererService().getViewport();
      return viewport ? { centerX: viewport.center.x, centerY: viewport.center.y, scale: viewport.scale.x } : undefined;
    },
  };
}

function nextAnimationFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (remaining: number): void => {
      if (remaining === 0) {
        resolve();
        return;
      }
      window.requestAnimationFrame(() => step(remaining - 1));
    };
    step(count);
  });
}
```

What was removed: `watchPresentedTab`, `resumePresentedTab`, `viewsReleasingOnClose`, `stopWatchingPresentedTab`, `watchedView` and the private `waitForMapLoaded` (now `whenMapLoaded` in `PresentedScene.ts`). Their jobs (hold on tab switch, resume after load, release on view close, register once per view) now live in `PresentedScene` and `followPresentedScene`.

- [ ] **Step 6: Update the presenter test**

In `tests/unit/playerWindowPresenter.test.ts`, add after the existing imports of `PlayerWindowPresenter` and `AtlasView`:

```ts
import { presentedScene } from '../../src/app/services/PresentedScene';
```

In `beforeEach`, add `presentedScene.clear();` directly before `Object.values(serviceMock).forEach((fn) => fn.mockClear());`, so the singleton starts empty and the mock calls it causes are cleared.

Add this test at the end of the `describe` block:

```ts
  test('follows a scene presented to online players while the window is open', async () => {
    const { view, canvas } = createFakeView();
    const tavern = view.tabMetaStore.getState().addTab('maps/tavern.md', 'Tavern');
    const dungeon = view.tabMetaStore.getState().addTab('maps/dungeon.md', 'Dungeon');
    serviceMock.isWindowOpen.mockReturnValue(true);

    await presentTabInPlayerWindow({} as any, view, tavern);
    view.tabMetaStore.getState().setActiveTab(dungeon);
    presentedScene.present(view, dungeon);
    await flush();

    expect(serviceMock.presentCanvas).toHaveBeenLastCalledWith(frameSourceFor(canvas), dungeon);
    expect(playerWindowStore.getState().presentedTabId).toBe(dungeon);
  });
```

- [ ] **Step 7: Run the presenter tests to verify behaviour is unchanged**

Run: `npx vitest run tests/unit/playerWindowPresenter.test.ts tests/unit/presentedScene.test.ts tests/unit/localPlayerView.test.ts tests/unit/playerWindowReload.test.ts`
Expected: PASS: the six existing presenter tests unchanged, plus the new one.

- [ ] **Step 8: Write the failing "Present to players" test**

```ts
// tests/unit/presentToPlayers.test.ts
import type { Command, Plugin } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { createTabMetaStore } from '../../src/app/stores/tabMetaStore';

vi.mock('../../src/app/atlas-view', () => ({ AtlasView: class AtlasView {}, ATLAS_VIEW_TYPE: 'atlas-vtt' }));
vi.mock('../../src/app/dashboard-view', () => ({ DASHBOARD_VIEW_TYPE: 'dashboard' }));
vi.mock('../../src/app/services/PlayerWindowPresenter', () => ({ presentActiveTabInPlayerWindow: vi.fn() }));
vi.mock('../../src/app/services/TokenStatblockLinkService', () => ({ TokenStatblockLinkService: {} }));
vi.mock('../../src/app/plugin/cleanupMissingAssets', () => ({ cleanupMissingAssets: vi.fn() }));

import { AtlasView } from '../../src/app/atlas-view';
import { registerCommands, type CommandDependencies } from '../../src/app/plugin/registerCommands';
import { presentedScene } from '../../src/app/services/PresentedScene';
import { presentActiveTabToPlayers, presentViewToPlayers, stopPresenting } from '../../src/app/services/presentToPlayers';

function fakeView(): { view: object; tabId: string; store: ReturnType<typeof createStore<{ isMapLoading: boolean }>> } {
  const tabMetaStore = createTabMetaStore();
  const store = createStore<{ isMapLoading: boolean }>(() => ({ isMapLoading: false }));
  const view = { tabMetaStore, atlasStore: store, register: vi.fn() };
  Object.setPrototypeOf(view, AtlasView.prototype);
  const tabId = tabMetaStore.getState().addTab('maps/tavern.atlasmap', 'Tavern');
  return { view, tabId, store };
}

function fakeApp(view: object | null): { workspace: { getActiveViewOfType: () => object | null; openPopoutLeaf: ReturnType<typeof vi.fn> } } {
  return { workspace: { getActiveViewOfType: () => view, openPopoutLeaf: vi.fn() } };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('Present to players', () => {
  beforeEach(() => { presentedScene.clear(); });

  it('presents the active scene without opening the player window', async () => {
    const { view, tabId } = fakeView();
    const app = fakeApp(view);
    await presentActiveTabToPlayers(app as never);
    expect(presentedScene.current()).toMatchObject({ view, tabId });
    expect(app.workspace.openPopoutLeaf).not.toHaveBeenCalled();
  });

  it('waits for the scene to finish loading', async () => {
    const { view, tabId, store } = fakeView();
    store.setState({ isMapLoading: true });
    const presenting = presentViewToPlayers(view);
    await flush();
    expect(presentedScene.current()).toBeNull();
    store.setState({ isMapLoading: false });
    await presenting;
    expect(presentedScene.current()?.tabId).toBe(tabId);
  });

  it('does nothing without an open scene', async () => {
    await presentActiveTabToPlayers(fakeApp(null) as never);
    await presentViewToPlayers({ not: 'a view' });
    expect(presentedScene.current()).toBeNull();
  });

  it('stops presenting', async () => {
    const { view } = fakeView();
    await presentViewToPlayers(view);
    stopPresenting();
    expect(presentedScene.current()).toBeNull();
  });

  it('adds the commands, with Stop presenting only while a scene is presented', async () => {
    const { view, tabId } = fakeView();
    const commands: Command[] = [];
    const plugin = {
      app: fakeApp(view),
      addCommand: (command: Command) => commands.push(command),
      addRibbonIcon: vi.fn(),
    } as unknown as Plugin;
    registerCommands(plugin, {} as CommandDependencies);
    const present = commands.find((command) => command.id === 'present-to-players');
    const stop = commands.find((command) => command.id === 'stop-presenting');
    expect(present?.name).toBe('Present to players');
    expect(stop?.checkCallback?.(true)).toBe(false);
    present?.callback?.();
    await flush();
    expect(presentedScene.current()?.tabId).toBe(tabId);
    expect(stop?.checkCallback?.(true)).toBe(true);
    stop?.checkCallback?.(false);
    expect(presentedScene.current()).toBeNull();
  });
});
```

- [ ] **Step 9: Run the test to verify it fails**

Run: `npx vitest run tests/unit/presentToPlayers.test.ts`
Expected: FAIL with `Failed to resolve import "../../src/app/services/presentToPlayers"`.

- [ ] **Step 10: Write the actions**

```ts
// src/app/services/presentToPlayers.ts
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
  if (view.tabMetaStore.getState().activeTabId !== tabId) return;
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
```

- [ ] **Step 11: Add the commands**

In `src/app/plugin/registerCommands.ts`, add to the imports:

```ts
import { presentedScene } from '../services/PresentedScene';
import { presentActiveTabToPlayers, stopPresenting } from '../services/presentToPlayers';
```

In `registerPlayerViewCommands`, directly after the `send-map-to-player-view` command, add:

```ts
  plugin.addCommand({
    id: 'present-to-players',
    name: 'Present to players',
    callback: () => void presentActiveTabToPlayers(plugin.app),
  });

  plugin.addCommand({
    id: 'stop-presenting',
    name: 'Stop presenting',
    checkCallback: (checking) => {
      if (!presentedScene.current()) return false;
      if (!checking) stopPresenting();
      return true;
    },
  });
```

- [ ] **Step 12: Add the view-actions items**

In `src/app/react/components/ViewActionsMenu.tsx`, add to the imports:

```ts
import { presentedScene } from '../../services/PresentedScene';
import { presentViewToPlayers, stopPresenting } from '../../services/presentToPlayers';
```

Replace

```ts
      { type: 'item', label: 'Online session…', icon: 'radio-tower', onClick: () => openOnlineSessionModal(app) },
    ];
```

with

```ts
      { type: 'item', label: 'Online session…', icon: 'radio-tower', onClick: () => openOnlineSessionModal(app) },
      { type: 'item', label: 'Present to players', icon: 'cast', onClick: () => presentViewToPlayers(activeLeaf.view) },
    ];
    if (presentedScene.current()) {
      entries.push({ type: 'item', label: 'Stop presenting', icon: 'square', onClick: stopPresenting });
    }
```

`onClick` returns the promise, which the context menu logs if it rejects (`runEntryAction`).

- [ ] **Step 13: Clear the presented scene on unload**

In `main.ts`, add the import next to the other service imports:

```ts
import { presentedScene } from './src/app/services/PresentedScene';
```

In `onunload()`, directly before `PlayerWindowService.getInstance()?.destroy(false);`, add:

```ts
    presentedScene.clear();
```

- [ ] **Step 14: Write the failing tab bar test**

```tsx
// tests/unit/sceneTabBar.presented.test.tsx
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { AtlasUIContext } from '../../src/app/react/root/AtlasUIContext';
import { SceneTabBar } from '../../src/app/react/components/SceneTabBar';
import { presentedScene, type PresentedView } from '../../src/app/services/PresentedScene';
import { createTabMetaStore } from '../../src/app/stores/tabMetaStore';

class StubResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
  presentedScene.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  presentedScene.clear();
});

it('marks the tab presented to players, whether or not the player window is open', () => {
  const tabMetaStore = createTabMetaStore();
  const tavern = tabMetaStore.getState().addTab('Tavern.atlasmap', 'Tavern');
  tabMetaStore.getState().addTab('Caves.atlasmap', 'Caves');
  tabMetaStore.getState().setActiveTab(tavern);
  const value = { app: {}, view: { viewId: 'map', tabMetaStore }, pixiApp: null, renderer: null } as never;
  const { container } = render(<AtlasUIContext.Provider value={value}>
    <SceneTabBar onSwitchTab={vi.fn()} onCloseTab={vi.fn()} onAddTab={vi.fn()} onPresentTab={vi.fn()} onShowAllTabs={vi.fn()} />
  </AtlasUIContext.Provider>);
  const pressed = (): number => container.querySelectorAll('[aria-pressed="true"]').length;
  expect(pressed()).toBe(0);

  const view = { tabMetaStore, atlasStore: createStore(() => ({ isMapLoading: false })), register: () => {} } as unknown as PresentedView;
  act(() => { presentedScene.present(view, tavern); });
  expect(pressed()).toBe(1);

  const elsewhere = createTabMetaStore();
  const otherTab = elsewhere.getState().addTab('Other.atlasmap', 'Other');
  act(() => { presentedScene.present({ ...view, tabMetaStore: elsewhere } as PresentedView, otherTab); });
  expect(pressed()).toBe(0);

  act(() => { presentedScene.present(view, tavern); });
  act(() => { presentedScene.clear(); });
  expect(pressed()).toBe(0);
});
```

- [ ] **Step 15: Run the test to verify it fails**

Run: `npx vitest run tests/unit/sceneTabBar.presented.test.tsx`
Expected: FAIL: `expected 0 to be 1` (the marker still reads only the player window's store).

- [ ] **Step 16: Make the marker follow `PresentedScene`**

Add to `src/app/services/PresentedScene.ts`, after `loadedMapSize`:

```ts
/** The presented tab when it belongs to the view whose tabs `tabStore` holds; else null. */
export function presentedTabIdIn(scene: PresentedSceneInfo | null, tabStore: TabMetaStore): string | null {
  return scene && scene.view.tabMetaStore === tabStore ? scene.tabId : null;
}
```

Create the hook:

```ts
// src/app/react/hooks/usePresentedTabId.ts
import { useCallback, useSyncExternalStore } from 'react';
import { presentedScene, presentedTabIdIn } from '../../services/PresentedScene';
import type { TabMetaStore } from '../../stores/tabMetaStore';

/** The tab of this view that players see (local window or online), or null. */
export function usePresentedTabId(tabStore: TabMetaStore): string | null {
  const subscribe = useCallback(
    (onChange: () => void): (() => void) => presentedScene.subscribe({ presented: onChange, held: onChange, cleared: onChange }),
    [],
  );
  return useSyncExternalStore(subscribe, () => presentedTabIdIn(presentedScene.current(), tabStore));
}
```

In `src/app/react/components/SceneTabBar.tsx`:
- Replace `import { playerWindowStore } from '../../stores/playerWindowStore';` with `import { usePresentedTabId } from '../hooks/usePresentedTabId';`.
- Replace the two lines

```tsx
  const presentedTabId = useStore(playerWindowStore, (s) => s.presentedTabId);
  const isPlayerWindowOpen = useStore(playerWindowStore, (s) => s.isOpen);
```

with

```tsx
  const presentedTabId = usePresentedTabId(store);
```

- Replace `const isPresented = isPlayerWindowOpen && tab.id === presentedTabId;` with `const isPresented = tab.id === presentedTabId;`.
- Replace the label `` `${tab.displayName} is shown on the player view` `` with `` `${tab.displayName} is shown to players` `` (the other label, `` `Show ${tab.displayName} on the player view` ``, stays: the button still opens the local window).

`useStore` stays imported (the bar still reads `tabs` and `activeTabId` with it).

- [ ] **Step 17: Run the tests to verify they pass**

Run: `npx vitest run`
Expected: PASS for the whole suite, including the 5 new tests in `presentToPlayers.test.ts`, the new `sceneTabBar.presented.test.tsx` and the unchanged `sceneTabBar.overflow.test.tsx`. Run all of it, not a subset: `ViewActionsMenu` (rendered by `UIRoot`), `SceneTabBar` and `registerCommands` gain imports (`presentToPlayers` → `atlas-view`, `PresentedScene`), and a test that imports them without mocking `atlas-view` would fail only here.

- [ ] **Step 18: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0; `npm run lint` reports no warnings (sentence case holds for "Present to players", "Stop presenting", "Open a scene to present it to players", "Players see …", "Players no longer see a scene", "… is shown to players").

- [ ] **Step 19: Commit**

```bash
git add src/app/services/PresentedScene.ts src/app/services/presentToPlayers.ts src/app/services/PlayerWindowPresenter.ts src/app/plugin/registerCommands.ts src/app/react/components/ViewActionsMenu.tsx src/app/react/components/SceneTabBar.tsx src/app/react/hooks/usePresentedTabId.ts main.ts tests/unit/presentedScene.test.ts tests/unit/presentToPlayers.test.ts tests/unit/sceneTabBar.presented.test.tsx tests/unit/playerWindowPresenter.test.ts
git commit -m "feat: one presented scene for the player window and online players, with Present to players"
```

---

### Task 8: `SceneBroadcaster`, fog parts, and starting it with the session

**Files:**
- Create: `src/app/online/scene/sceneMessages.ts`, `src/app/online/scene/SceneBroadcaster.ts`
- Modify: `src/app/online/OnlineSessionService.ts` (imports, `Deps`, fields, constructor, `host`, `stop`)
- Test: `tests/unit/online/sceneBroadcaster.test.ts`; modify `tests/unit/online/onlineSessionService.test.ts` (settings fake, `service()` helper, one new test)

**Interfaces:**
- Consumes: Task 1 (`ControlMessage` scene members, `MAX_CONTROL_MESSAGE_BYTES`, `sortedByOrder`, `PlayerScene`, `PlayerFogOp`, `ScenePatchBody`), Task 2 (`FogCoverage`), Task 3 (`AssetRegistry`, `PlayerViewRules`, `pickPlayerViewRules`, `samePlayerViewRules`, `createProjectionMemo`, `ProjectionMemo`), Task 4 (`projectForPlayers`), Task 5 (`diffScenes`), Task 6 (`PlayerSession.scene`, used by the tests), Task 7 (`PresentedScene`, `PresentedSceneInfo`, `PresentedSceneListener`, `presentedScene`). Existing: `SessionHandler`, `SessionPlayer`, `GmSession` (`use`, `send`, `getPlayers`), `randomId`, `SettingsService` (`getLocalPlayerViewSettings()`, `onChange(listener)`).
- Produces:
  - `sceneMessages.ts`: `type SceneOutgoing` (a scene message without its `seq`: `scene-snapshot`, `scene-fog`, `scene-drawings`, `scene-patch` or `scene-clear`), `MESSAGE_BUDGET_BYTES = MAX_CONTROL_MESSAGE_BYTES - 64`, `PART_BUDGET_BYTES = 192 * 1024`, `byteLength(value: unknown): number` (UTF-8 bytes of its JSON), `splitParts<T>(records: Readonly<Record<string, T>>, orderOf: (record: T) => number, budget?: number): Array<Record<string, T>>`, `snapshotMessages(scene: PlayerScene): SceneOutgoing[] | null` (snapshot without fog and drawings, then `scene-fog` and `scene-drawings` parts; null when a message would exceed the limit), `patchMessage(patch: ScenePatchBody): SceneOutgoing | null` (null when it would exceed the limit)
  - `SceneBroadcaster.ts`: `SCENE_TICK_MS = 50`, `interface SceneSession { use(handler: SessionHandler): () => void; send(playerId: string, message: ControlMessage): void; getPlayers(): SessionPlayer[] }`, `interface PresentedSceneSource { current(): PresentedSceneInfo | null; isHeld(): boolean; subscribe(listener: PresentedSceneListener): () => void }`, `interface PlayerViewSettingsSource { getLocalPlayerViewSettings(): PlayerViewRules; onChange(listener: () => void): () => void }`, `interface SceneBroadcasterOptions { session: SceneSession; presented: PresentedSceneSource; settings: PlayerViewSettingsSource; notify(message: string): void }`, `SCENE_TOO_LARGE_NOTICE = 'This scene is too large to send to online players.'`, `class SceneBroadcaster implements SessionHandler { constructor(options: SceneBroadcasterOptions); start(): void; stop(): void; currentProjection(): PlayerScene | null; onAdmitted(player: SessionPlayer): void; onMessage(player: SessionPlayer, message: ControlMessage): void }`
  - `OnlineSessionService` `Deps` gains `presented?: PresentedSceneSource` (defaults to `presentedScene`).

Behaviour (spec "Sync", "Errors and edge cases", plan decisions 5, 9 and Review Focus):
- **Snapshot** to everyone admitted on `presented` (a new presentation gets a new random `sceneId`; a resumed one keeps its id), and to one player on `onAdmitted` (which also fires for a new tab replacing an old one) and on its `scene-resync`. The snapshot carries neither fog nor drawings: they follow in `scene-fog` and `scene-drawings` parts of at most 192 KB each, in replay order. If a message would still exceed 256 KB minus 64 bytes of envelope (the rest of the scene alone is too large), the player gets `scene-clear` instead, the GM gets `notify(SCENE_TOO_LARGE_NOTICE)` once per presentation, and the next change retries a snapshot, not a patch.
- **Admission, resync and held scenes** reuse the last projection sent, never a new one: while held, the store may hold another map. With nothing sent (nothing presented, cleared, or still loading), the player gets `scene-clear`.
- **Patches**: the broadcaster subscribes to the presented store and to settings changes. A change to a field the projection reads (`background`, `grid`, `objects`, `widgetSettings`, `widgetValues`, `initiative`, `initiativeTrackerOpen`) or to one of the six rules starts one 50 ms timer; when it fires, the scene is projected, diffed against the last projection sent, and the patch (if any) sent to everyone admitted. An empty diff sends nothing. A patch over the limit is replaced by a snapshot to everyone.
- **Loading**: while `isMapLoading`, store writes are ignored and a pending tick is cancelled; when loading ends, everyone gets a snapshot.
- **Held**: stop following the store (players keep what they have). **Cleared**: forget the projection and send `scene-clear` to everyone admitted.
- **Start**: if a scene is presented and not held when the broadcaster starts, it is treated as presented.
- **Players' messages**: only `scene-resync` is acted on; scene data from players is ignored.
- Fog coverage is rebuilt only when `objects.fog` changes (reference); asset ids come from one `AssetRegistry` per broadcaster, so per online session.
- `seq` is per player, starting at 1 and increasing by one per scene message sent to that player.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/online/sceneBroadcaster.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession } from '../../../src/app/online/PlayerSession';
import { decodeControl, encodeControl, MAX_CONTROL_MESSAGE_BYTES, type ControlMessage } from '../../../src/app/online/protocol';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { SCENE_TICK_MS, SCENE_TOO_LARGE_NOTICE, SceneBroadcaster } from '../../../src/app/online/scene/SceneBroadcaster';
import { patchMessage, snapshotMessages, splitParts } from '../../../src/app/online/scene/sceneMessages';
import { MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';
import type { PeerLink } from '../../../src/app/online/transport/types';
import { PresentedScene, type PresentedView } from '../../../src/app/services/PresentedScene';
import type { ViewAtlasState } from '../../../src/app/storeFactory';
import { createTabMetaStore } from '../../../src/app/stores/tabMetaStore';
import type { Character, DrawingStroke } from '../../../src/app/types';
import type { FogOperation } from '../../../src/app/types/fogTypes';
import { createDefaultInitiativeState } from '../../../src/app/types/initiativeTypes';
import { fogRect, playerScene } from './sceneFixtures';

type SceneState = Pick<ViewAtlasState,
  'background' | 'grid' | 'objects' | 'widgetSettings' | 'widgetValues' | 'initiative' | 'initiativeTrackerOpen' | 'isMapLoading'
> & { camera: { x: number; y: number; scale: number } };

function character(id: string, x: number, overrides: Partial<Character> = {}): Character {
  return { id, kind: 'character', x, y: 140, imagePath: `art/${id}.png`, name: id, hp: { current: 7, max: 10 }, ...overrides };
}

function sceneState(tokens: Record<string, Character>, fog: Record<string, FogOperation> = {}): SceneState {
  return {
    background: 'maps/tavern.png',
    grid: { enabled: true, visible: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5 },
    objects: { tokens, fog, pins: {}, texts: {}, drawings: {}, walls: {}, lights: {}, audios: {} },
    widgetSettings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 },
    widgetValues: {},
    initiative: createDefaultInitiativeState(),
    initiativeTrackerOpen: false,
    isMapLoading: false,
    camera: { x: 0, y: 0, scale: 1 },
  };
}

/** Zigzag brush strokes that survive simplification (5 px teeth): about 57 KB each on the wire. */
function bigFog(count: number): Record<string, FogOperation> {
  const fog: Record<string, FogOperation> = {};
  for (let op = 0; op < count; op++) {
    const points = Array.from({ length: 3000 }, (_, i) => ({
      x: (i % 400) * 10,
      y: op * 400 + Math.floor(i / 400) * 40 + (i % 2) * 5,
    }));
    fog[`big${op}`] = { id: `big${op}`, kind: 'fog', type: 'brush', timestamp: 100 + op, isErasing: false, brushRadius: 30, points };
  }
  return fog;
}

/** Zigzag pen strokes that survive simplification: about 19 KB each on the wire. */
function manyDrawings(count: number): Record<string, DrawingStroke> {
  const drawings: Record<string, DrawingStroke> = {};
  for (let index = 0; index < count; index++) {
    const points = Array.from({ length: 1000 }, (_, i) => ({ x: (i % 200) * 10, y: index * 100 + Math.floor(i / 200) * 20 + (i % 2) * 5 }));
    drawings[`ink${index}`] = { id: `ink${index}`, kind: 'drawing', timestamp: index, type: 'pen', points, color: '#aa0000', width: 3, opacity: 1 };
  }
  return drawings;
}

interface FakeView {
  view: PresentedView;
  store: StoreApi<SceneState>;
  tabs: ReturnType<typeof createTabMetaStore>;
  tavern: string;
  dungeon: string;
}

function fakeView(state: SceneState): FakeView {
  const tabs = createTabMetaStore();
  const store = createStore<SceneState>(() => state);
  const tavern = tabs.getState().addTab('maps/tavern.atlasmap', 'Tavern');
  const dungeon = tabs.getState().addTab('maps/dungeon.atlasmap', 'Dungeon');
  tabs.getState().setActiveTab(tavern);
  const view = { tabMetaStore: tabs, atlasStore: store as unknown as StoreApi<ViewAtlasState>, register: () => {} } as unknown as PresentedView;
  return { view, store, tabs, tavern, dungeon };
}

function moveToken(store: StoreApi<SceneState>, id: string, x: number): void {
  store.setState((state) => ({
    objects: { ...state.objects, tokens: { ...state.objects.tokens, [id]: { ...state.objects.tokens[id]!, x } } },
  }));
}

const DEFAULT_RULES: PlayerViewRules = {
  showGrid: true, showTokenHP: false, showTokenStress: false, showTokenNameplates: false, showWidgets: true, showInitiative: true,
};

interface Harness {
  network: MemoryNetwork;
  gm: GmSession;
  requests: SessionPlayer[];
  presented: PresentedScene;
  broadcaster: SceneBroadcaster;
  notices: string[];
  setRules(next: Partial<PlayerViewRules>): void;
}

function setup(options: { start?: boolean } = {}): Harness {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const gm = new GmSession(network.host('gm'), {
    title: 'Vault', onJoinRequest: (p) => requests.push(p), onRequestClosed: () => {}, onPlayersChanged: () => {},
  });
  gm.start();
  let rules = { ...DEFAULT_RULES };
  const listeners = new Set<() => void>();
  const settings = {
    getLocalPlayerViewSettings: (): PlayerViewRules => rules,
    onChange: (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const presented = new PresentedScene();
  const notices: string[] = [];
  const broadcaster = new SceneBroadcaster({ session: gm, presented, settings, notify: (message) => notices.push(message) });
  if (options.start !== false) broadcaster.start();
  const setRules = (next: Partial<PlayerViewRules>): void => {
    rules = { ...rules, ...next };
    listeners.forEach((listener) => listener());
  };
  return { network, gm, requests, presented, broadcaster, notices, setRules };
}

/** A player through `PlayerSession`, admitted by the GM. */
async function join(h: Harness, playerKey = 'key-a'): Promise<PlayerSession> {
  const before = h.requests.length;
  const player = new PlayerSession({
    hostId: 'gm', name: 'Anna', playerKey, clientVersion: '1', transport: h.network.client(), onChange: () => {},
  });
  player.start();
  await vi.advanceTimersByTimeAsync(0);
  if (h.requests.length > before) h.gm.allow(h.requests.at(-1)!.playerId);
  return player;
}

/** A player end that records every message and its size. */
async function rawPlayer(h: Harness, playerKey: string): Promise<{ link: PeerLink; received: ControlMessage[]; sizes: number[] }> {
  const link = await h.network.client().connect('gm');
  const received: ControlMessage[] = [];
  const sizes: number[] = [];
  link.onMessage((channel, data) => {
    if (channel !== 'control' || typeof data !== 'string') return;
    sizes.push(new TextEncoder().encode(data).length);
    const decoded = decodeControl(data);
    if (decoded.kind === 'message') received.push(decoded.message);
  });
  link.send('control', encodeControl({ v: 1, type: 'join', name: 'Raw', playerKey, client: { kind: 'web', version: '1' } }));
  h.gm.allow(h.requests.at(-1)!.playerId);
  return { link, received, sizes };
}

const sceneTypes = (messages: ControlMessage[]): string[] =>
  messages.filter((message) => message.type.startsWith('scene-')).map((message) => message.type);
const tick = (): Promise<void> => vi.advanceTimersByTimeAsync(SCENE_TICK_MS);

describe('scene messages', () => {
  it('splits records into parts under the budget, in replay order', () => {
    const fog = { b: fogRect(2), a: fogRect(1), c: fogRect(3) };
    const parts = splitParts(fog, (op) => op.order, 200);
    expect(parts.map((part) => Object.keys(part))).toEqual([['a', 'b'], ['c']]);
    expect(splitParts({}, () => 0)).toEqual([]);
  });

  it('refuses snapshots and patches over the message limit', () => {
    const huge = 'x'.repeat(300 * 1024);
    const scene = playerScene({ widgets: [{ id: 'w', type: 'counter', label: huge, icon: '', value: 0 }] });
    expect(snapshotMessages(scene)).toBeNull();
    expect(snapshotMessages(playerScene())?.map((message) => message.type)).toEqual(['scene-snapshot', 'scene-fog', 'scene-drawings']);
    expect(patchMessage({ set: { widgets: scene.widgets }, upsert: {}, remove: {} })).toBeNull();
  });
});

describe('SceneBroadcaster', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends a snapshot on admission and patches after', async () => {
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const player = await join(h);
    expect(player.scene?.tokens.hero?.x).toBe(140);
    expect(player.scene).toEqual(h.broadcaster.currentProjection());

    moveToken(store, 'hero', 300);
    expect(player.scene?.tokens.hero?.x).toBe(140);
    await tick();
    expect(player.scene?.tokens.hero?.x).toBe(300);
    expect(player.scene).toEqual(h.broadcaster.currentProjection());
  });

  it('batches changes into one patch per tick and sends nothing for an empty diff', async () => {
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot']);

    moveToken(store, 'hero', 200);
    moveToken(store, 'hero', 250);
    moveToken(store, 'hero', 300);
    await tick();
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-patch']);

    store.setState({ camera: { x: 50, y: 50, scale: 2 } });
    moveToken(store, 'hero', 310);
    moveToken(store, 'hero', 300);
    await tick();
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-patch']);
    expect(raw.received.filter((message) => 'seq' in message).map((message) => (message as { seq: number }).seq)).toEqual([1, 2]);
  });

  it('sends HP to players when the GM turns it on mid-session', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const player = await join(h);
    expect(player.scene?.tokens.hero?.hp).toBeNull();
    h.setRules({ showTokenHP: true });
    await tick();
    expect(player.scene?.tokens.hero?.hp).toEqual({ current: 7, max: 10 });
  });

  it('removes a token the GM hides', async () => {
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140), orc: character('orc', 400) }));
    h.presented.present(view, tavern);
    const player = await join(h);
    store.setState((state) => ({
      objects: { ...state.objects, tokens: { ...state.objects.tokens, orc: { ...state.objects.tokens.orc!, isHidden: true } } },
    }));
    await tick();
    expect(Object.keys(player.scene?.tokens ?? {})).toEqual(['hero']);
  });

  it('clears the scene when presenting stops', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const player = await join(h);
    h.presented.clear();
    expect(player.scene).toBeNull();
  });

  it('answers a resync with a snapshot', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    raw.link.send('control', encodeControl({ v: 1, type: 'scene-resync', seq: 1 }));
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-snapshot']);
  });

  it('splits a large fog into parts under the message limit', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }, bigFog(12)));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    const snapshot = raw.received.find((message) => message.type === 'scene-snapshot');
    expect(snapshot && 'fogParts' in snapshot ? snapshot.fogParts : 0).toBeGreaterThan(1);
    expect(Math.max(...raw.sizes)).toBeLessThanOrEqual(MAX_CONTROL_MESSAGE_BYTES);
    const player = await join(h);
    expect(Object.keys(player.scene?.fog ?? {})).toHaveLength(12);
    expect(player.scene).toEqual(h.broadcaster.currentProjection());
  });

  it('sends a scene with many drawings in parts', async () => {
    const h = setup();
    const state = sceneState({ hero: character('hero', 140) });
    state.objects.drawings = manyDrawings(30);
    const { view, tavern } = fakeView(state);
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    const snapshot = raw.received.find((message) => message.type === 'scene-snapshot');
    expect(snapshot && 'drawingParts' in snapshot ? snapshot.drawingParts : 0).toBeGreaterThan(1);
    expect(sceneTypes(raw.received)).toContain('scene-drawings');
    expect(Math.max(...raw.sizes)).toBeLessThanOrEqual(MAX_CONTROL_MESSAGE_BYTES);
    const player = await join(h);
    expect(Object.keys(player.scene?.drawings ?? {})).toHaveLength(30);
    expect(player.scene).toEqual(h.broadcaster.currentProjection());
  });

  it('clears the scene and tells the GM once when it is too large to send', async () => {
    const tokens = Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`t${i}`, character(`t${i}`, i)]));
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState(tokens));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    expect(sceneTypes(raw.received)).toEqual(['scene-clear']);
    moveToken(store, 't0', 50);
    await tick();
    expect(sceneTypes(raw.received)).toEqual(['scene-clear', 'scene-clear']);
    expect(h.notices).toEqual([SCENE_TOO_LARGE_NOTICE]);
    expect(Math.max(...raw.sizes)).toBeLessThanOrEqual(MAX_CONTROL_MESSAGE_BYTES);
  });

  it('sends a snapshot instead of a patch that would exceed the limit', async () => {
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    store.setState((state) => ({ objects: { ...state.objects, fog: bigFog(12) } }));
    await tick();
    const types = sceneTypes(raw.received);
    expect(types).not.toContain('scene-patch');
    expect(types.filter((type) => type === 'scene-snapshot')).toHaveLength(2);
    expect(Math.max(...raw.sizes)).toBeLessThanOrEqual(MAX_CONTROL_MESSAGE_BYTES);
  });

  it('gives a second tab of the same player the scene', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    await join(h, 'key-a');
    const secondTab = await join(h, 'key-a');
    expect(secondTab.scene).toEqual(h.broadcaster.currentProjection());
  });

  it('keeps sending the held scene while the GM browses another tab', async () => {
    const h = setup();
    const { view, store, tabs, tavern, dungeon } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    const heldId = h.broadcaster.currentProjection()?.sceneId;

    tabs.getState().setActiveTab(dungeon);
    store.setState({ isMapLoading: true });
    store.setState(sceneState({ villain: character('villain', 600) }));
    h.setRules({ showTokenHP: true });
    await tick();
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot']);

    const late = await join(h, 'key-late');
    expect(Object.keys(late.scene?.tokens ?? {})).toEqual(['hero']);
    expect(late.scene?.tokens.hero?.hp).toBeNull();
    raw.link.send('control', encodeControl({ v: 1, type: 'scene-resync', seq: 1 }));
    const resent = raw.received.at(-1);
    expect(resent?.type === 'scene-snapshot' ? Object.keys(resent.scene.tokens) : []).toEqual(['hero']);
    expect(resent?.type === 'scene-snapshot' ? resent.scene.sceneId : null).toBe(heldId);

    store.setState({ isMapLoading: true });
    tabs.getState().setActiveTab(tavern);
    store.setState({ ...sceneState({ hero: character('hero', 140) }), isMapLoading: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(late.scene?.sceneId).toBe(heldId);
    expect(late.scene?.tokens.hero?.hp).toEqual({ current: 7, max: 10 });
  });

  it('sends a scene presented before the session started', async () => {
    const h = setup({ start: false });
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    h.broadcaster.start();
    const player = await join(h);
    expect(player.scene?.tokens.hero).toBeDefined();
  });

  it('answers admission with a clear when nothing is presented', async () => {
    const h = setup();
    const raw = await rawPlayer(h, 'raw');
    expect(sceneTypes(raw.received)).toEqual(['scene-clear']);
    raw.link.send('control', encodeControl({ v: 1, type: 'scene-resync', seq: 1 }));
    expect(sceneTypes(raw.received)).toEqual(['scene-clear', 'scene-clear']);
  });

  it('clears a stale scene on a player who reconnects after presenting stopped', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const player = await join(h);
    expect(player.scene).not.toBeNull();
    const gmLinks = (h.gm as unknown as { links: Map<unknown, unknown> }).links;
    ([...gmLinks.keys()][0] as { close(): void }).close();
    h.presented.clear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(player.state.status).toBe('admitted');
    expect(player.scene).toBeNull();
  });

  it('replaces the scene with a new sceneId when the GM presents another', async () => {
    const h = setup();
    const first = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(first.view, first.tavern);
    const player = await join(h);
    const firstId = player.scene?.sceneId;
    const second = fakeView(sceneState({ dragon: character('dragon', 500) }));
    h.presented.present(second.view, second.tavern);
    expect(player.scene?.sceneId).not.toBe(firstId);
    expect(Object.keys(player.scene?.tokens ?? {})).toEqual(['dragon']);
  });

  it('sends nothing while the map loads, then a snapshot', async () => {
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    store.setState({ isMapLoading: true });
    moveToken(store, 'hero', 500);
    await tick();
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot']);
    store.setState({ isMapLoading: false });
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-snapshot']);
  });

  it('ignores scene data sent by players', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    const other = await join(h, 'key-other');
    const before = other.scene;
    raw.link.send('control', encodeControl({ v: 1, type: 'scene-clear', seq: 5 }));
    raw.link.send('control', encodeControl({ v: 1, type: 'scene-patch', seq: 6, set: { grid: null }, upsert: {}, remove: { tokens: ['hero'] } }));
    await tick();
    expect(other.scene).toEqual(before);
    expect(h.broadcaster.currentProjection()?.tokens.hero).toBeDefined();
  });

  it('stops listening when stopped', async () => {
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    h.broadcaster.stop();
    moveToken(store, 'hero', 500);
    h.presented.clear();
    await tick();
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/online/sceneBroadcaster.test.ts`
Expected: FAIL with `Failed to resolve import "../../../src/app/online/scene/SceneBroadcaster"`.

- [ ] **Step 3: Write the message helpers**

```ts
// src/app/online/scene/sceneMessages.ts
/** Scene messages before each player's `seq` is set, kept under the control channel's size limit. */
import { MAX_CONTROL_MESSAGE_BYTES, type ControlMessage } from '../protocol';
import { sortedByOrder, type PlayerScene, type ScenePatchBody } from './sceneTypes';

type SceneMessage = Extract<
  ControlMessage,
  { type: 'scene-snapshot' | 'scene-fog' | 'scene-drawings' | 'scene-patch' | 'scene-clear' }
>;
type Unsequenced<M> = M extends unknown ? Omit<M, 'seq'> : never;

/** A scene message without its per-player `seq`. */
export type SceneOutgoing = Unsequenced<SceneMessage>;

/** Room left in every message for its `seq`. */
const ENVELOPE_BYTES = 64;
export const MESSAGE_BUDGET_BYTES = MAX_CONTROL_MESSAGE_BYTES - ENVELOPE_BYTES;
/** One fog or drawing part's records; a single record (at most 5 000 points) stays well under it. */
export const PART_BUDGET_BYTES = 192 * 1024;

const encoder = new TextEncoder();

/** UTF-8 size of `value` as JSON, as the player's decoder measures it. */
export function byteLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/** Records in replay order, split into parts of at most `budget` bytes. */
export function splitParts<T>(
  records: Readonly<Record<string, T>>,
  orderOf: (record: T) => number,
  budget: number = PART_BUDGET_BYTES,
): Array<Record<string, T>> {
  const parts: Array<Record<string, T>> = [];
  let part: Record<string, T> = {};
  let size = 0;
  let count = 0;
  for (const [id, record] of sortedByOrder(records, orderOf)) {
    const recordSize = byteLength(record) + byteLength(id) + 2;
    if (count > 0 && size + recordSize > budget) {
      parts.push(part);
      part = {};
      size = 0;
      count = 0;
    }
    part[id] = record;
    size += recordSize;
    count++;
  }
  if (count > 0) parts.push(part);
  return parts;
}

/**
 * A snapshot without fog and drawings, then their parts; null when any message
 * would exceed the limit (in practice: the rest of the scene alone is too large).
 */
export function snapshotMessages(scene: PlayerScene): SceneOutgoing[] | null {
  const { fog, drawings, ...body } = scene;
  const fogParts = splitParts(fog, (op) => op.order);
  const drawingParts = splitParts(drawings, (drawing) => drawing.order);
  const messages: SceneOutgoing[] = [
    { v: 1, type: 'scene-snapshot', scene: body, fogParts: fogParts.length, drawingParts: drawingParts.length },
    ...fogParts.map((records, part): SceneOutgoing => ({ v: 1, type: 'scene-fog', part, records })),
    ...drawingParts.map((records, part): SceneOutgoing => ({ v: 1, type: 'scene-drawings', part, records })),
  ];
  return messages.every((message) => byteLength(message) <= MESSAGE_BUDGET_BYTES) ? messages : null;
}

/** A patch message; null when it would exceed the limit, so a snapshot is sent instead. */
export function patchMessage(patch: ScenePatchBody): SceneOutgoing | null {
  const message: SceneOutgoing = { v: 1, type: 'scene-patch', set: patch.set, upsert: patch.upsert, remove: patch.remove };
  return byteLength(message) <= MESSAGE_BUDGET_BYTES ? message : null;
}
```

- [ ] **Step 4: Write the broadcaster**

```ts
// src/app/online/scene/SceneBroadcaster.ts
/**
 * Sends the presented scene to every admitted player: a snapshot on
 * presenting, on resume, on admission and on a player's resync; patches at
 * most every 50 ms in between; `scene-clear` when presenting stops. There is
 * one projection per scene and everyone gets the same messages. It plugs into
 * `GmSession` through `session.use`, so the session never learns about maps.
 */
import type { SessionHandler, SessionPlayer } from '../GmSession';
import { randomId } from '../ids';
import type { ControlMessage } from '../protocol';
import type { PresentedSceneInfo, PresentedSceneListener } from '../../services/PresentedScene';
import type { ViewAtlasState } from '../../storeFactory';
import type { FogOperation } from '../../types/fogTypes';
import { AssetRegistry } from './AssetRegistry';
import { FogCoverage } from './FogCoverage';
import { pickPlayerViewRules, samePlayerViewRules, type PlayerViewRules } from './playerViewRules';
import { projectForPlayers } from './projectForPlayers';
import { createProjectionMemo, type ProjectionMemo } from './projectRecords';
import { diffScenes } from './sceneDiff';
import { patchMessage, snapshotMessages, type SceneOutgoing } from './sceneMessages';
import type { PlayerScene } from './sceneTypes';

/** Changes are batched and sent at most this often. */
export const SCENE_TICK_MS = 50;

export interface SceneSession {
  use(handler: SessionHandler): () => void;
  send(playerId: string, message: ControlMessage): void;
  getPlayers(): SessionPlayer[];
}

export interface PresentedSceneSource {
  current(): PresentedSceneInfo | null;
  isHeld(): boolean;
  subscribe(listener: PresentedSceneListener): () => void;
}

export interface PlayerViewSettingsSource {
  getLocalPlayerViewSettings(): PlayerViewRules;
  onChange(listener: () => void): () => void;
}

export interface SceneBroadcasterOptions {
  session: SceneSession;
  presented: PresentedSceneSource;
  settings: PlayerViewSettingsSource;
  /** Tells the GM something; `OnlineSessionService` shows an Obsidian notice. */
  notify(message: string): void;
}

export const SCENE_TOO_LARGE_NOTICE = 'This scene is too large to send to online players.';

type Slice = readonly unknown[];

/** The store fields the projection reads; changes elsewhere (camera, selection, tools) send nothing. */
function sliceOf(state: ViewAtlasState): Slice {
  return [
    state.background, state.grid, state.objects, state.widgetSettings,
    state.widgetValues, state.initiative, state.initiativeTrackerOpen,
  ];
}

function sameSlice(a: Slice, b: Slice): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** The presented scene while it is shown (not held). */
interface LiveScene {
  readonly scene: PresentedSceneInfo;
  readonly sceneId: string;
  loading: boolean;
  slice: Slice | null;
  readonly unsubscribe: () => void;
}

export class SceneBroadcaster implements SessionHandler {
  private readonly assets = new AssetRegistry();
  private readonly seqs = new Map<string, number>();
  private readonly stops: Array<() => void> = [];
  private memo: ProjectionMemo = createProjectionMemo();
  private rules: PlayerViewRules;
  private live: LiveScene | null = null;
  private sceneId: string | null = null;
  /** What players have: the last projection sent. Held scenes keep it; nothing re-projects it. */
  private lastSent: PlayerScene | null = null;
  private snapshot: { scene: PlayerScene; messages: SceneOutgoing[] | null } | null = null;
  private fogCoverage: { fog: Readonly<Record<string, FogOperation>>; coverage: FogCoverage } | null = null;
  private tickTimer: number | null = null;
  /** The presentation whose oversize the GM was told about, so the notice shows once. */
  private noticeShownFor: string | null = null;

  constructor(private readonly options: SceneBroadcasterOptions) {
    this.rules = pickPlayerViewRules(options.settings.getLocalPlayerViewSettings());
  }

  start(): void {
    const { session, presented, settings } = this.options;
    this.stops.push(
      session.use(this),
      presented.subscribe({
        presented: (scene, resumed) => this.showScene(scene, resumed),
        held: () => this.detach(),
        cleared: () => this.clearScene(),
      }),
      settings.onChange(() => this.settingsChanged()),
    );
    const current = presented.current();
    if (current && !presented.isHeld()) this.showScene(current, false);
  }

  stop(): void {
    this.detach();
    this.stops.splice(0).forEach((stop) => stop());
  }

  /** The scene players have now; null when none was sent or it was cleared. */
  currentProjection(): PlayerScene | null {
    return this.lastSent;
  }

  /** Also fires when a newer tab of a player replaces an older one: always a full snapshot. */
  onAdmitted(player: SessionPlayer): void {
    this.sendCurrent(player.playerId);
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    // Players never send scene data; a resync is the only scene message the GM acts on.
    if (message.type === 'scene-resync') this.sendCurrent(player.playerId);
  }

  private showScene(scene: PresentedSceneInfo, resumed: boolean): void {
    this.detach();
    const sceneId = resumed && this.sceneId !== null ? this.sceneId : randomId();
    if (sceneId !== this.sceneId) this.memo = createProjectionMemo();
    this.sceneId = sceneId;
    const live: LiveScene = {
      scene,
      sceneId,
      loading: scene.store.getState().isMapLoading,
      slice: null,
      unsubscribe: scene.store.subscribe((state) => this.storeChanged(live, state)),
    };
    this.live = live;
    if (!live.loading) this.broadcastSnapshot(live);
  }

  private storeChanged(live: LiveScene, state: ViewAtlasState): void {
    if (this.live !== live) return;
    if (state.isMapLoading) {
      // Writes made by loading are not edits: nothing is sent until the map is ready.
      live.loading = true;
      this.cancelTick();
      return;
    }
    if (live.loading) {
      live.loading = false;
      this.broadcastSnapshot(live);
      return;
    }
    if (live.slice && sameSlice(live.slice, sliceOf(state))) return;
    this.scheduleTick();
  }

  private settingsChanged(): void {
    const rules = pickPlayerViewRules(this.options.settings.getLocalPlayerViewSettings());
    if (samePlayerViewRules(rules, this.rules)) return;
    this.rules = rules;
    // A held scene is not projected again; it gets the new rules when it resumes.
    if (this.live && !this.live.loading) this.scheduleTick();
  }

  private detach(): void {
    this.cancelTick();
    this.live?.unsubscribe();
    this.live = null;
  }

  private clearScene(): void {
    this.detach();
    this.sceneId = null;
    this.lastSent = null;
    this.snapshot = null;
    for (const playerId of this.admitted()) this.sendSequenced(playerId, { v: 1, type: 'scene-clear' });
  }

  private scheduleTick(): void {
    if (this.tickTimer !== null) return;
    this.tickTimer = window.setTimeout(() => {
      this.tickTimer = null;
      this.tick();
    }, SCENE_TICK_MS);
  }

  private cancelTick(): void {
    if (this.tickTimer !== null) window.clearTimeout(this.tickTimer);
    this.tickTimer = null;
  }

  private tick(): void {
    const live = this.live;
    if (!live || live.loading) return;
    const previous = this.lastSent;
    // Players who got a clear instead of an oversized scene need a snapshot, not a patch.
    if (!previous || previous.sceneId !== live.sceneId || this.snapshotFailed(previous)) {
      this.broadcastSnapshot(live);
      return;
    }
    const next = this.project(live);
    const patch = diffScenes(previous, next);
    if (!patch) return;
    this.lastSent = next;
    const message = patchMessage(patch);
    for (const playerId of this.admitted()) {
      if (message) this.sendSequenced(playerId, message);
      else this.sendSnapshot(playerId);
    }
  }

  private broadcastSnapshot(live: LiveScene): void {
    this.cancelTick();
    this.lastSent = this.project(live);
    for (const playerId of this.admitted()) this.sendSnapshot(playerId);
  }

  private project(live: LiveScene): PlayerScene {
    const state = live.scene.store.getState();
    live.slice = sliceOf(state);
    return projectForPlayers(state, {
      sceneId: live.sceneId,
      rules: this.rules,
      coverage: this.coverageOf(state.objects?.fog ?? {}),
      assets: this.assets,
      mapSize: live.scene.mapSize(),
      memo: this.memo,
    });
  }

  /** Rebuilt only when the fog operations change. */
  private coverageOf(fog: Readonly<Record<string, FogOperation>>): FogCoverage {
    if (this.fogCoverage?.fog !== fog) this.fogCoverage = { fog, coverage: FogCoverage.fromOperations(fog) };
    return this.fogCoverage.coverage;
  }

  /** What players have, or a clear when they have nothing: never a new projection. */
  private sendCurrent(playerId: string): void {
    if (this.lastSent) this.sendSnapshot(playerId);
    else this.sendSequenced(playerId, { v: 1, type: 'scene-clear' });
  }

  /** A scene too large to send reaches players as a clear, never as a stale or partial scene. */
  private sendSnapshot(playerId: string): void {
    const scene = this.lastSent;
    if (!scene) return;
    const messages = this.snapshotOf(scene);
    if (!messages) {
      this.sendSequenced(playerId, { v: 1, type: 'scene-clear' });
      return;
    }
    for (const message of messages) this.sendSequenced(playerId, message);
  }

  private snapshotOf(scene: PlayerScene): SceneOutgoing[] | null {
    if (this.snapshot?.scene !== scene) {
      this.snapshot = { scene, messages: snapshotMessages(scene) };
      if (!this.snapshot.messages && this.noticeShownFor !== scene.sceneId) {
        this.noticeShownFor = scene.sceneId;
        this.options.notify(SCENE_TOO_LARGE_NOTICE);
      }
    }
    return this.snapshot.messages;
  }

  /** Whether the snapshot of `scene` was tried and was too large. */
  private snapshotFailed(scene: PlayerScene): boolean {
    return this.snapshot?.scene === scene && this.snapshot.messages === null;
  }

  private sendSequenced(playerId: string, message: SceneOutgoing): void {
    const seq = (this.seqs.get(playerId) ?? 0) + 1;
    this.seqs.set(playerId, seq);
    this.options.session.send(playerId, { ...message, seq } as ControlMessage);
  }

  private admitted(): string[] {
    return this.options.session.getPlayers()
      .filter((player) => player.status === 'admitted')
      .map((player) => player.playerId);
  }
}
```

- [ ] **Step 5: Run the broadcaster test to verify it passes**

Run: `npx vitest run tests/unit/online/sceneBroadcaster.test.ts`
Expected: PASS (21 tests).

- [ ] **Step 6: Start the broadcaster with the session**

In `src/app/online/OnlineSessionService.ts`:

Replace `import type { App } from 'obsidian';` with `import { Notice, type App } from 'obsidian';`, and add to the imports:

```ts
import { presentedScene } from '../services/PresentedScene';
import { SceneBroadcaster, type PresentedSceneSource } from './scene/SceneBroadcaster';
```

Extend `Deps`:

```ts
interface Deps {
  createHost?: (options: PeerServerOptions) => Promise<HostTransport>;
  showRequest?: (player: SessionPlayer, answer: (allow: boolean) => void) => { hide(): void };
  /** Which scene players see; the plugin's `presentedScene` unless a test passes its own. */
  presented?: PresentedSceneSource;
}
```

Add fields after `private current: GmSession | null = null;`:

```ts
  private broadcaster: SceneBroadcaster | null = null;
  private readonly presented: PresentedSceneSource;
```

In the constructor, after `this.showRequest = deps.showRequest ?? showJoinRequestNotice;` add:

```ts
    this.presented = deps.presented ?? presentedScene;
```

In `host(generation)`, replace

```ts
    session.start();
    this.current = session;
```

with

```ts
    session.start();
    // Sends the presented scene, including one presented before the session started.
    this.broadcaster = new SceneBroadcaster({
      session, presented: this.presented, settings: this.settings, notify: (message) => new Notice(message),
    });
    this.broadcaster.start();
    this.current = session;
```

In `stop()`, directly before `this.current?.stop();` add:

```ts
    this.broadcaster?.stop();
    this.broadcaster = null;
```

`SettingsService` satisfies `PlayerViewSettingsSource`: `getLocalPlayerViewSettings()` returns the whole `localPlayerView` (a superset of the six rules) and `onChange(listener: SettingsListener)` accepts a listener that ignores its argument.

- [ ] **Step 7: Update the service test**

In `tests/unit/online/onlineSessionService.test.ts`:

Add to the imports:

```ts
import { createStore } from 'zustand/vanilla';
import { decodeControl } from '../../../src/app/online/protocol';
import { PresentedScene } from '../../../src/app/services/PresentedScene';
import { createTabMetaStore } from '../../../src/app/stores/tabMetaStore';
import { createDefaultInitiativeState } from '../../../src/app/types/initiativeTypes';
```

(`encodeControl` is already imported from the same module; merge the two into `import { decodeControl, encodeControl } from '../../../src/app/online/protocol';`.)

Replace the `settings` fake with:

```ts
const settings = {
  getOnlineSettings: () => DEFAULT_ONLINE_SETTINGS,
  getLocalPlayerViewSettings: () => ({
    showGrid: true, showTokenHP: false, showTokenStress: false, showTokenNameplates: false, showWidgets: true, showInitiative: true,
  }),
  onChange: () => () => {},
} as never;
```

Replace the first two lines of the `service` helper,

```ts
function service(network = new MemoryNetwork()) {
  const host = network.host('gm-id');
```

with

```ts
function service(network = new MemoryNetwork(), presented = new PresentedScene()) {
  const host = network.host('gm-id');
```

and add `presented,` to the options passed to `new OnlineSessionService(app, settings, { … })` in it, after `createHost: async () => host,`.

Add this test at the end of the `describe` block:

```ts
  it('sends the presented scene to joining players, even one presented before the session started', async () => {
    const presented = new PresentedScene();
    const tabs = createTabMetaStore();
    const tabId = tabs.getState().addTab('maps/tavern.atlasmap', 'Tavern');
    const store = createStore(() => ({
      background: null, grid: null, isMapLoading: false, widgetValues: {}, initiativeTrackerOpen: false,
      initiative: createDefaultInitiativeState(),
      widgetSettings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 },
      objects: {
        tokens: { t: { id: 't', kind: 'token', x: 10, y: 10, imagePath: 'a.png' } },
        fog: {}, pins: {}, texts: {}, drawings: {}, walls: {}, lights: {}, audios: {},
      },
    }));
    presented.present({ tabMetaStore: tabs, atlasStore: store, register: () => {} } as never, tabId);
    const { svc, notices, network } = service(new MemoryNetwork(), presented);
    await svc.start();
    const link = await network.client().connect('gm-id');
    const received: string[] = [];
    link.onMessage((_channel, data) => {
      const decoded = decodeControl(data);
      if (decoded.kind === 'message') received.push(decoded.message.type);
    });
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Anna', playerKey: 'k', client: { kind: 'web', version: '1' } }));
    notices[0]!.answer(true);
    expect(received).toContain('scene-snapshot');
    svc.stop();
    presented.clear();
    expect(received.filter((type) => type === 'scene-clear')).toEqual([]);
  });
```

- [ ] **Step 8: Run the online tests to verify they pass**

Run: `npx vitest run`
Expected: PASS for the whole suite, including the 21 broadcaster tests and the new service test. `OnlineSessionService` now imports the broadcaster and the projection, so every test that loads it must still pass.

- [ ] **Step 9: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0 with no warnings.

- [ ] **Step 10: Commit**

```bash
git add src/app/online/scene/sceneMessages.ts src/app/online/scene/SceneBroadcaster.ts src/app/online/OnlineSessionService.ts tests/unit/online/sceneBroadcaster.test.ts tests/unit/online/onlineSessionService.test.ts
git commit -m "feat(online): send the presented scene to players, batched every 50 ms"
```

---

### Task 9: Join page preview

**Files:**
- Create: `src/app/online/preview/previewLayout.ts`, `src/app/online/preview/previewShapes.ts`, `src/app/online/preview/sceneSummary.ts`, `online-client/preview.mts`
- Modify: `online-client/index.html`, `online-client/main.mts`, `online-client/style.css`
- Test: `tests/unit/online/scenePreview.test.ts`

**Interfaces:**
- Consumes: Task 1 (`PlayerScene`, `PlayerGrid`, `PlayerFogOp`, `PlayerDrawing`, `PlayerText`, `PlayerWidget`, `PlayerInitiative`, `ScenePoint`, `sortedByOrder`), Task 6 (`PlayerSessionOptions.onScene`). Existing, all import-free or pure: `tokenDiameterInCells` (`pixi/token-renderer/tokenSizing.ts`), `createHexLayout`, `axialToPixel`, `pixelToAxial`, `hexVertices`, `isHexGridType` (`grid/hexGeometry.ts`), `formatTimerTime(totalSeconds: number): string` (`utils/timerWidget.ts`).
- Produces:
  - `previewLayout.ts`: `interface PreviewRect { x: number; y: number; width: number; height: number }`, `interface PreviewTransform { scale: number; offsetX: number; offsetY: number }` (screen = world × scale + offset), `PREVIEW_PADDING = 16`, `tokenDiameter(size: number, cellSize: number): number`, `sceneWorldBounds(scene: PlayerScene): PreviewRect | null`, `fitTransform(world: PreviewRect, viewport: { width: number; height: number }, padding?: number): PreviewTransform`
  - `previewShapes.ts`: `MAX_GRID_LINES = 2000`, `MAX_GRID_HEXES = 5000`, `interface GridLines { segments: Array<[ScenePoint, ScenePoint]>; hexes: ScenePoint[][]; color: string; alpha: number; width: number; dash: number[] }`, `gridLines(grid: PlayerGrid, area: PreviewRect): GridLines | null`, `type FogShape`, `fogShapes(fog: Readonly<Record<string, PlayerFogOp>>): FogShape[]`, `interface InkStroke { points: ScenePoint[]; color: string; width: number; alpha: number; dot: boolean }`, `inkStrokes(drawings: Readonly<Record<string, PlayerDrawing>>): InkStroke[]`, `interface TextLabel { x; y; text; size; color; alpha; align }`, `textLabels(texts: Readonly<Record<string, PlayerText>>): TextLabel[]`, `interface TokenMarker { x: number; y: number; radius: number; color: string; label: string | null; hp: number | null }`, `tokenMarkers(scene: PlayerScene): TokenMarker[]`, `initials(name: string): string`
  - `sceneSummary.ts`: `widgetLines(widgets: readonly PlayerWidget[]): string[]`, `initiativeLines(initiative: PlayerInitiative | null): string[]`
  - `online-client/preview.mts`: `class ScenePreview { constructor(canvas: HTMLCanvasElement); show(scene: PlayerScene | null): void }`

Behaviour (spec "Join page preview"): a canvas under the player list, sized to the window. It fits the map, or without a map size the tokens' footprints plus one cell, or ten cells of grid; it draws the map area, the grid (square lines or hex outlines, as dashes or dots per `lineType`, skipped when finer than 2 000 lines or 5 000 hexes), drawings (eraser strokes skipped, icons as dots), texts, each token as a circle sized to its footprint in its ring colour with its initials when names are sent and an HP bar when HP is sent, then fog on an offscreen canvas (replayed in order, erase as `destination-out`, painted opaque) over everything. It redraws at most once per animation frame. Widgets and initiative are listed as text beside it. The page sets `window.atlasScene` for the manual developer-tools check (plan decision 13). All drawing decisions are in the tested pure modules; `preview.mts` only issues canvas calls.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/online/scenePreview.test.ts
import { describe, expect, it } from 'vitest';
import { fitTransform, sceneWorldBounds } from '../../../src/app/online/preview/previewLayout';
import { fogShapes, gridLines, initials, inkStrokes, textLabels, tokenMarkers } from '../../../src/app/online/preview/previewShapes';
import { initiativeLines, widgetLines } from '../../../src/app/online/preview/sceneSummary';
import type { PlayerGrid } from '../../../src/app/online/scene/sceneTypes';
import { fogRect, playerScene, playerToken } from './sceneFixtures';

const square: PlayerGrid = {
  type: 'square', size: 100, offsetX: 0, offsetY: 0, color: null, opacity: 0.5,
  lineType: 'dashed', lineWidth: 2, hexNumbers: null, hexNumberOpacity: null,
};

describe('preview layout', () => {
  it('fits the map into the canvas with padding, centred', () => {
    expect(fitTransform({ x: 0, y: 0, width: 1000, height: 500 }, { width: 532, height: 282 }))
      .toEqual({ scale: 0.5, offsetX: 16, offsetY: 16 });
    const tall = fitTransform({ x: 0, y: 0, width: 100, height: 400 }, { width: 532, height: 432 });
    expect(tall.scale).toBe(1);
    expect(tall.offsetX).toBe(216);
  });

  it('shows the map, else the tokens, else ten cells of grid', () => {
    expect(sceneWorldBounds(playerScene())).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
    const noMap = { asset: null, width: 0, height: 0, cellSize: 70 };
    expect(sceneWorldBounds(playerScene({ map: noMap }))).toEqual({ x: -5, y: -5, width: 210, height: 210 });
    expect(sceneWorldBounds(playerScene({ map: noMap, tokens: {} }))).toEqual({ x: 0, y: 0, width: 700, height: 700 });
    expect(sceneWorldBounds(playerScene({ map: noMap, tokens: {}, grid: null }))).toBeNull();
  });
});

describe('preview shapes', () => {
  it('draws square grid lines across the area', () => {
    const lines = gridLines(square, { x: 0, y: 0, width: 300, height: 200 });
    expect(lines?.segments).toHaveLength(7);
    expect(lines).toMatchObject({ hexes: [], color: '#808080', alpha: 0.5, width: 2, dash: [6, 4] });
    expect(gridLines({ ...square, size: 1 }, { x: 0, y: 0, width: 2000, height: 2000 })).toBeNull();
  });

  it('draws hex outlines for hex grids', () => {
    const lines = gridLines({ ...square, type: 'hex-vertical', size: 60, lineType: 'solid' }, { x: 0, y: 0, width: 300, height: 300 });
    expect(lines?.segments).toEqual([]);
    expect(lines?.hexes.length).toBeGreaterThan(10);
    expect(lines?.hexes.every((hex) => hex.length === 6)).toBe(true);
    expect(lines?.dash).toEqual([]);
  });

  it('replays fog in order as strokes, polygons and rectangles', () => {
    const shapes = fogShapes({
      b: { type: 'brush', erase: false, order: 2, radius: 10, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
      c: { type: 'lasso', erase: true, order: 2, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }] },
      a: fogRect(1),
    });
    expect(shapes.map((shape) => shape.kind)).toEqual(['rect', 'stroke', 'polygon']);
    expect(shapes[1]).toMatchObject({ width: 20, erase: false });
    expect(shapes[2]).toMatchObject({ erase: true });
  });

  it('draws ink in order, icons as dots, and skips eraser strokes', () => {
    const strokes = inkStrokes({
      late: { type: 'pen', order: 5, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: '#ff0000', width: 3, opacity: 0.5, icon: null },
      early: { type: 'icon', order: 1, points: [{ x: 9, y: 9 }], color: '#00ff00', width: 40, opacity: 1, icon: 'skull' },
      rubber: { type: 'eraser', order: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: '#000000', width: 3, opacity: 1, icon: null },
    });
    expect(strokes.map((stroke) => stroke.color)).toEqual(['#00ff00', '#ff0000']);
    expect(strokes[0]?.dot).toBe(true);
    expect(strokes[1]).toMatchObject({ dot: false, alpha: 0.5, width: 3 });
  });

  it('labels texts at their scaled size', () => {
    expect(textLabels(playerScene().texts)).toEqual([
      { x: 50, y: 50, text: 'Tavern', size: 24, color: '#000000', alpha: 1, align: 'center' },
    ]);
  });

  it('marks tokens by layer with their footprint, colour, initials and HP', () => {
    const scene = playerScene({
      tokens: {
        top: playerToken({ layer: 2, name: 'Anna Bell', hp: { current: 5, max: 10 }, ring: '#ff0000' }),
        bottom: playerToken({ layer: 0, ring: null, size: 2 }),
      },
    });
    expect(tokenMarkers(scene)).toEqual([
      { x: 100, y: 100, radius: 94.5, color: '#9aa0a6', label: null, hp: null },
      { x: 100, y: 100, radius: 31.5, color: '#ff0000', label: 'AB', hp: 0.5 },
    ]);
    expect(initials('Grimgar')).toBe('GR');
    expect(initials('   ')).toBe('');
  });
});

describe('scene summary', () => {
  it('lists widgets with their values', () => {
    expect(widgetLines([
      { id: 'a', type: 'counter', label: 'Torches', icon: 'flame', value: 3 },
      { id: 'b', type: 'timer', label: 'Torch', icon: 'hourglass', value: 125 },
      { id: 'c', type: 'clock', label: '', icon: 'clock', value: 2 },
    ])).toEqual(['Torches: 3', 'Torch: 02:05', 'clock: 2']);
  });

  it('lists initiative with the round, the active turn, names and HP', () => {
    const lines = initiativeLines({
      round: 2,
      active: true,
      entries: [
        { id: 'e1', tokenId: 't1', initiative: 18, name: 'Anna', hp: { current: 5, max: 10 }, isActive: true },
        { id: 'e2', tokenId: 't2', initiative: 12, name: null, hp: null, isActive: false },
      ],
    });
    expect(lines).toEqual(['Round 2', '▶ 18 · Anna · 5/10 HP', '12 · Unnamed']);
    expect(initiativeLines({ round: 0, active: false, entries: [] })).toEqual([]);
    expect(initiativeLines(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/online/scenePreview.test.ts`
Expected: FAIL with `Failed to resolve import "../../../src/app/online/preview/previewLayout"`.

- [ ] **Step 3: Write the layout**

```ts
// src/app/online/preview/previewLayout.ts
/**
 * Where the join page's preview draws the scene. Shared with the web player
 * page, so it imports nothing from Obsidian.
 */
import { tokenDiameterInCells } from '../../pixi/token-renderer/tokenSizing';
import type { PlayerScene } from '../scene/sceneTypes';

export interface PreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Screen position = world position × scale + offset. */
export interface PreviewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export const PREVIEW_PADDING = 16;
/** A grid without a map or tokens shows this many cells each way. */
const EMPTY_GRID_CELLS = 10;

/** A token's footprint in world pixels: its cells (at least one) times the cell size. */
export function tokenDiameter(size: number, cellSize: number): number {
  return Math.max(1, tokenDiameterInCells(size)) * cellSize;
}

/** The world area to show: the map; without a map size the tokens plus a cell around them; else ten cells of grid. */
export function sceneWorldBounds(scene: PlayerScene): PreviewRect | null {
  const { map } = scene;
  if (map.width > 0 && map.height > 0) return { x: 0, y: 0, width: map.width, height: map.height };
  const cell = map.cellSize;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const token of Object.values(scene.tokens)) {
    const radius = tokenDiameter(token.size, cell) / 2;
    left = Math.min(left, token.x - radius);
    top = Math.min(top, token.y - radius);
    right = Math.max(right, token.x + radius);
    bottom = Math.max(bottom, token.y + radius);
  }
  if (left <= right) return { x: left - cell, y: top - cell, width: right - left + 2 * cell, height: bottom - top + 2 * cell };
  if (scene.grid) {
    return { x: scene.grid.offsetX, y: scene.grid.offsetY, width: cell * EMPTY_GRID_CELLS, height: cell * EMPTY_GRID_CELLS };
  }
  return null;
}

/** Scales `world` to fit the viewport inside the padding, centred. */
export function fitTransform(
  world: PreviewRect,
  viewport: { width: number; height: number },
  padding: number = PREVIEW_PADDING,
): PreviewTransform {
  const availableWidth = Math.max(1, viewport.width - 2 * padding);
  const availableHeight = Math.max(1, viewport.height - 2 * padding);
  const scale = Math.min(availableWidth / Math.max(1, world.width), availableHeight / Math.max(1, world.height));
  return {
    scale,
    offsetX: (viewport.width - world.width * scale) / 2 - world.x * scale,
    offsetY: (viewport.height - world.height * scale) / 2 - world.y * scale,
  };
}
```

- [ ] **Step 4: Write the shapes**

```ts
// src/app/online/preview/previewShapes.ts
/**
 * What the join page's preview draws, as plain shapes in world coordinates.
 * Shared with the web player page; the canvas layer (`online-client/preview.mts`)
 * only turns these into canvas calls.
 */
import { axialToPixel, createHexLayout, hexVertices, isHexGridType, pixelToAxial } from '../../grid/hexGeometry';
import {
  sortedByOrder, type PlayerDrawing, type PlayerFogOp, type PlayerGrid, type PlayerScene, type PlayerText,
  type PlayerTextAlign, type ScenePoint,
} from '../scene/sceneTypes';
import { tokenDiameter, type PreviewRect } from './previewLayout';

/** Beyond this many lines or hexes the grid is too fine to be worth drawing. */
export const MAX_GRID_LINES = 2000;
export const MAX_GRID_HEXES = 5000;
const DEFAULT_GRID_COLOR = '#808080';
const DEFAULT_TOKEN_COLOR = '#9aa0a6';
/** Token circles are drawn a little inside their footprint, like the token art. */
const TOKEN_FILL = 0.9;

export interface GridLines {
  segments: Array<[ScenePoint, ScenePoint]>;
  hexes: ScenePoint[][];
  color: string;
  alpha: number;
  width: number;
  /** Dash pattern in screen pixels; empty for solid lines. */
  dash: number[];
}

export type FogShape =
  | { kind: 'stroke'; erase: boolean; points: ScenePoint[]; width: number }
  | { kind: 'polygon'; erase: boolean; points: ScenePoint[] }
  | { kind: 'rect'; erase: boolean; x: number; y: number; width: number; height: number };

export interface InkStroke {
  points: ScenePoint[];
  color: string;
  width: number;
  alpha: number;
  /** Icons and single points are drawn as a dot of the stroke's width. */
  dot: boolean;
}

export interface TextLabel {
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
  alpha: number;
  align: PlayerTextAlign;
}

export interface TokenMarker {
  x: number;
  y: number;
  radius: number;
  color: string;
  label: string | null;
  /** Remaining HP from 0 to 1; null when HP is not shown. */
  hp: number | null;
}

function dashFor(lineType: PlayerGrid['lineType']): number[] {
  if (lineType === 'dashed') return [6, 4];
  if (lineType === 'dotted') return [1, 3];
  return [];
}

export function gridLines(grid: PlayerGrid, area: PreviewRect): GridLines | null {
  const style = { color: grid.color ?? DEFAULT_GRID_COLOR, alpha: grid.opacity, width: grid.lineWidth, dash: dashFor(grid.lineType) };
  if (isHexGridType(grid.type)) {
    const hexes = hexOutlines(grid, area);
    return hexes ? { segments: [], hexes, ...style } : null;
  }
  const segments = squareLines(grid, area);
  return segments ? { segments, hexes: [], ...style } : null;
}

function squareLines(grid: PlayerGrid, area: PreviewRect): Array<[ScenePoint, ScenePoint]> | null {
  if (Math.floor(area.width / grid.size) + Math.floor(area.height / grid.size) + 2 > MAX_GRID_LINES) return null;
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  const first = (start: number, offset: number): number => offset + Math.ceil((start - offset) / grid.size) * grid.size;
  const segments: Array<[ScenePoint, ScenePoint]> = [];
  for (let x = first(area.x, grid.offsetX); x <= right; x += grid.size) segments.push([{ x, y: area.y }, { x, y: bottom }]);
  for (let y = first(area.y, grid.offsetY); y <= bottom; y += grid.size) segments.push([{ x: area.x, y }, { x: right, y }]);
  return segments;
}

function hexOutlines(grid: PlayerGrid, area: PreviewRect): ScenePoint[][] | null {
  if (grid.type === 'square') return null;
  const layout = createHexLayout(grid.type, grid.size, grid.offsetX, grid.offsetY);
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  const corners = [
    { x: area.x, y: area.y }, { x: right, y: area.y }, { x: area.x, y: bottom }, { x: right, y: bottom },
  ].map((point) => pixelToAxial(layout, point));
  const qMin = Math.min(...corners.map((hex) => hex.q)) - 1;
  const qMax = Math.max(...corners.map((hex) => hex.q)) + 1;
  const rMin = Math.min(...corners.map((hex) => hex.r)) - 1;
  const rMax = Math.max(...corners.map((hex) => hex.r)) + 1;
  if ((qMax - qMin + 1) * (rMax - rMin + 1) > MAX_GRID_HEXES * 4) return null;
  const reach = grid.size;
  const hexes: ScenePoint[][] = [];
  for (let q = qMin; q <= qMax; q++) {
    for (let r = rMin; r <= rMax; r++) {
      const center = axialToPixel(layout, { q, r });
      if (center.x < area.x - reach || center.x > right + reach || center.y < area.y - reach || center.y > bottom + reach) continue;
      hexes.push(hexVertices(layout, center));
      if (hexes.length > MAX_GRID_HEXES) return null;
    }
  }
  return hexes;
}

/** Fog operations in replay order; brushes become round strokes twice their radius wide. */
export function fogShapes(fog: Readonly<Record<string, PlayerFogOp>>): FogShape[] {
  return sortedByOrder(fog, (op) => op.order).map(([, op]): FogShape => {
    if (op.type === 'brush') return { kind: 'stroke', erase: op.erase, points: op.points, width: op.radius * 2 };
    if (op.type === 'lasso') return { kind: 'polygon', erase: op.erase, points: op.points };
    return { kind: 'rect', erase: op.erase, x: op.x, y: op.y, width: op.width, height: op.height };
  });
}

export function inkStrokes(drawings: Readonly<Record<string, PlayerDrawing>>): InkStroke[] {
  return sortedByOrder(drawings, (drawing) => drawing.order)
    .filter(([, drawing]) => drawing.type !== 'eraser')
    .map(([, drawing]) => ({
      points: drawing.points,
      color: drawing.color,
      width: drawing.width,
      alpha: drawing.opacity,
      dot: drawing.type === 'icon' || drawing.points.length === 1,
    }));
}

export function textLabels(texts: Readonly<Record<string, PlayerText>>): TextLabel[] {
  return Object.values(texts).map((text) => ({
    x: text.x, y: text.y, text: text.text, size: text.fontSize * text.scale, color: text.color, alpha: text.opacity, align: text.align,
  }));
}

/** One circle per token, lowest layer first. */
export function tokenMarkers(scene: PlayerScene): TokenMarker[] {
  return Object.values(scene.tokens)
    .sort((a, b) => a.layer - b.layer)
    .map((token) => ({
      x: token.x,
      y: token.y,
      radius: (tokenDiameter(token.size, scene.map.cellSize) / 2) * TOKEN_FILL,
      color: token.ring ?? DEFAULT_TOKEN_COLOR,
      label: token.name ? initials(token.name) : null,
      hp: token.hp && token.hp.max > 0 ? Math.min(1, Math.max(0, token.hp.current / token.hp.max)) : null,
    }));
}

/** Two letters for a token: the first letters of its first two words, or the first two of a single word. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word.length > 0);
  const [first, second] = words;
  if (!first) return '';
  if (!second) return Array.from(first).slice(0, 2).join('').toUpperCase();
  return `${Array.from(first)[0] ?? ''}${Array.from(second)[0] ?? ''}`.toUpperCase();
}
```

- [ ] **Step 5: Write the summary lines**

```ts
// src/app/online/preview/sceneSummary.ts
/** Widgets and initiative as the lines the join page lists beside its preview. */
import { formatTimerTime } from '../../utils/timerWidget';
import type { PlayerInitiative, PlayerWidget } from '../scene/sceneTypes';

export function widgetLines(widgets: readonly PlayerWidget[]): string[] {
  return widgets.map((widget) => {
    const value = widget.type === 'timer' ? formatTimerTime(widget.value) : String(widget.value);
    return `${widget.label || widget.type}: ${value}`;
  });
}

export function initiativeLines(initiative: PlayerInitiative | null): string[] {
  if (!initiative || initiative.entries.length === 0) return [];
  const lines = initiative.active ? [`Round ${initiative.round}`] : [];
  for (const entry of initiative.entries) {
    const turn = entry.isActive ? '▶ ' : '';
    const hp = entry.hp ? ` · ${entry.hp.current}/${entry.hp.max} HP` : '';
    lines.push(`${turn}${entry.initiative} · ${entry.name ?? 'Unnamed'}${hp}`);
  }
  return lines;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/unit/online/scenePreview.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 7: Write the canvas layer**

```ts
// online-client/preview.mts
/** Draws the scene preview on a 2D canvas: a thin layer over the tested shape builders. */
import { fitTransform, sceneWorldBounds } from '../src/app/online/preview/previewLayout';
import {
  fogShapes, gridLines, inkStrokes, textLabels, tokenMarkers, type FogShape, type GridLines,
} from '../src/app/online/preview/previewShapes';
import type { PlayerScene, ScenePoint } from '../src/app/online/scene/sceneTypes';

const MAP_COLOR = '#d9d4c7';
const FOG_COLOR = '#111318';
const LABEL_COLOR = '#1f2328';
const HP_BACK = 'rgba(0, 0, 0, 0.5)';
const HP_FILL = '#43a047';

export class ScenePreview {
  private scene: PlayerScene | null = null;
  private frame: number | null = null;
  private readonly fog = document.createElement('canvas');

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('resize', () => this.request());
  }

  show(scene: PlayerScene | null): void {
    this.scene = scene;
    this.request();
  }

  /** At most one redraw per animation frame, however many changes arrive. */
  private request(): void {
    if (this.frame !== null) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  private draw(): void {
    const ratio = window.devicePixelRatio || 1;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.canvas.width = Math.max(1, Math.round(width * ratio));
    this.canvas.height = Math.max(1, Math.round(height * ratio));
    const context = this.canvas.getContext('2d');
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const scene = this.scene;
    const world = scene ? sceneWorldBounds(scene) : null;
    if (!scene || !world) return;
    const view = fitTransform(world, { width, height });
    const toWorld = (target: CanvasRenderingContext2D): void => {
      target.setTransform(ratio * view.scale, 0, 0, ratio * view.scale, ratio * view.offsetX, ratio * view.offsetY);
    };
    const pixel = 1 / view.scale;
    toWorld(context);
    context.fillStyle = MAP_COLOR;
    context.fillRect(world.x, world.y, world.width, world.height);
    if (scene.grid) drawGrid(context, gridLines(scene.grid, world), pixel);
    drawInk(context, scene);
    drawLabels(context, scene);
    drawTokens(context, scene, pixel);
    drawFog(context, this.fog, fogShapes(scene.fog), toWorld);
  }
}

function tracePath(context: CanvasRenderingContext2D, points: readonly ScenePoint[], closed: boolean): void {
  const [first, ...rest] = points;
  if (!first) return;
  context.moveTo(first.x, first.y);
  for (const point of rest) context.lineTo(point.x, point.y);
  if (closed) context.closePath();
}

function dot(context: CanvasRenderingContext2D, point: ScenePoint | undefined, radius: number): void {
  if (!point) return;
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
}

function drawGrid(context: CanvasRenderingContext2D, lines: GridLines | null, pixel: number): void {
  if (!lines) return;
  context.save();
  context.strokeStyle = lines.color;
  context.globalAlpha = lines.alpha;
  context.lineWidth = Math.max(lines.width, pixel);
  context.setLineDash(lines.dash.map((length) => length * pixel));
  context.beginPath();
  for (const [a, b] of lines.segments) {
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
  }
  for (const hex of lines.hexes) tracePath(context, hex, true);
  context.stroke();
  context.restore();
}

function drawInk(context: CanvasRenderingContext2D, scene: PlayerScene): void {
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of inkStrokes(scene.drawings)) {
    context.globalAlpha = stroke.alpha;
    context.fillStyle = stroke.color;
    context.strokeStyle = stroke.color;
    if (stroke.dot) {
      dot(context, stroke.points[0], stroke.width / 2);
      continue;
    }
    context.lineWidth = stroke.width;
    context.beginPath();
    tracePath(context, stroke.points, false);
    context.stroke();
  }
  context.restore();
}

function drawLabels(context: CanvasRenderingContext2D, scene: PlayerScene): void {
  context.save();
  context.textBaseline = 'middle';
  for (const label of textLabels(scene.texts)) {
    context.globalAlpha = label.alpha;
    context.fillStyle = label.color;
    context.textAlign = label.align;
    context.font = `${label.size}px system-ui, sans-serif`;
    const lines = label.text.split('\n');
    const lineHeight = label.size * 1.25;
    lines.forEach((line, index) => {
      context.fillText(line, label.x, label.y + (index - (lines.length - 1) / 2) * lineHeight);
    });
  }
  context.restore();
}

function drawTokens(context: CanvasRenderingContext2D, scene: PlayerScene, pixel: number): void {
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const marker of tokenMarkers(scene)) {
    context.fillStyle = marker.color;
    context.strokeStyle = LABEL_COLOR;
    context.lineWidth = 2 * pixel;
    context.beginPath();
    context.arc(marker.x, marker.y, marker.radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    if (marker.label) {
      context.fillStyle = LABEL_COLOR;
      context.font = `600 ${marker.radius * 0.8}px system-ui, sans-serif`;
      context.fillText(marker.label, marker.x, marker.y);
    }
    if (marker.hp !== null) {
      const barWidth = marker.radius * 2;
      const barHeight = marker.radius * 0.25;
      const top = marker.y + marker.radius * 1.15;
      context.fillStyle = HP_BACK;
      context.fillRect(marker.x - marker.radius, top, barWidth, barHeight);
      context.fillStyle = HP_FILL;
      context.fillRect(marker.x - marker.radius, top, barWidth * marker.hp, barHeight);
    }
  }
  context.restore();
}

/** Fog on its own canvas, erased with `destination-out` like the GM's compositor, then laid over the scene opaque. */
function drawFog(
  target: CanvasRenderingContext2D,
  fogCanvas: HTMLCanvasElement,
  shapes: FogShape[],
  toWorld: (context: CanvasRenderingContext2D) => void,
): void {
  if (shapes.length === 0) return;
  fogCanvas.width = target.canvas.width;
  fogCanvas.height = target.canvas.height;
  const fog = fogCanvas.getContext('2d');
  if (!fog) return;
  toWorld(fog);
  fog.fillStyle = FOG_COLOR;
  fog.strokeStyle = FOG_COLOR;
  fog.lineCap = 'round';
  fog.lineJoin = 'round';
  for (const shape of shapes) {
    fog.globalCompositeOperation = shape.erase ? 'destination-out' : 'source-over';
    if (shape.kind === 'rect') {
      fog.fillRect(shape.x, shape.y, shape.width, shape.height);
    } else if (shape.kind === 'polygon') {
      fog.beginPath();
      tracePath(fog, shape.points, true);
      fog.fill();
    } else if (shape.points.length === 1) {
      dot(fog, shape.points[0], shape.width / 2);
    } else {
      fog.lineWidth = shape.width;
      fog.beginPath();
      tracePath(fog, shape.points, false);
      fog.stroke();
    }
  }
  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.drawImage(fogCanvas, 0, 0);
  target.restore();
}
```

- [ ] **Step 8: Add the preview to the page**

In `online-client/index.html`, insert after `</main>` and before `<footer>`:

```html
  <section id="scene" class="scene" hidden aria-label="Scene">
    <canvas id="preview" aria-label="Scene preview"></canvas>
    <aside class="scene-info">
      <ul id="widgets" aria-label="Widgets" hidden></ul>
      <ol id="initiative" aria-label="Initiative" hidden></ol>
    </aside>
  </section>
```

Append to `online-client/style.css`:

```css
.scene { width: min(1200px, 100%); display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: 16px; }
#preview { display: block; width: 100%; height: min(70vh, 720px); background: var(--card); border: 1px solid var(--border); border-radius: 16px; }
.scene-info { display: grid; gap: 12px; align-content: start; }
.scene-info ul, .scene-info ol { margin: 0; padding: 12px; list-style-position: inside; background: var(--card); border: 1px solid var(--border); border-radius: 12px; }
@media (max-width: 720px) { .scene { grid-template-columns: 1fr; } #preview { height: 60vh; } }
```

In `online-client/main.mts`:

Add to the imports:

```ts
import { initiativeLines, widgetLines } from '../src/app/online/preview/sceneSummary';
import type { PlayerScene } from '../src/app/online/scene/sceneTypes';
import { ScenePreview } from './preview.mts';
```

Add after `const playerList = …;`:

```ts
const sceneSection = document.getElementById('scene') as HTMLElement;
const widgetList = document.getElementById('widgets') as HTMLUListElement;
const initiativeList = document.getElementById('initiative') as HTMLOListElement;
const preview = new ScenePreview(document.getElementById('preview') as HTMLCanvasElement);
let sessionState: PlayerSessionState | null = null;
let scene: PlayerScene | null = null;
```

Replace the `admitted:` line of `render`'s status table with:

```ts
    admitted: scene
      ? `Connected to ${state.title ?? 'the table'}.`
      : `Connected to ${state.title ?? 'the table'}. Waiting for the GM to show a scene.`,
```

Add as the first line of `render(state)`:

```ts
  sessionState = state;
```

and as its last line:

```ts
  renderScene();
```

Add after `render`:

```ts
function fillList(list: HTMLElement, lines: string[]): void {
  list.hidden = lines.length === 0;
  list.replaceChildren(...lines.map((line) => {
    const item = document.createElement('li');
    item.textContent = line;
    return item;
  }));
}

/** The preview and the widget and initiative lists, shown only while admitted with a scene. */
function renderScene(): void {
  const shown = sessionState?.status === 'admitted' ? scene : null;
  sceneSection.hidden = shown === null;
  preview.show(shown);
  fillList(widgetList, shown ? widgetLines(shown.widgets) : []);
  fillList(initiativeList, shown ? initiativeLines(shown.initiative) : []);
  // Read-only, for checking in the developer tools what this page received.
  (window as unknown as { atlasScene: PlayerScene | null }).atlasScene = scene;
}
```

In the `new PlayerSession({ … })` options, after `onChange: render,` add:

```ts
      onScene: (next) => {
        scene = next;
        if (sessionState) render(sessionState);
      },
```

The `./preview.mts` import is resolved by Vite (`vite.online.config.mts`, root `online-client`) and allowed by `allowImportingTsExtensions` in `tsconfig.json`.

- [ ] **Step 9: Type-check and build the page**

Run: `npx tsc --noEmit && npm run build:online`
Expected: `tsc` exits 0; Vite writes `dist-online/index.html` and its assets and exits 0.

- [ ] **Step 10: Lint the shared preview code**

Run: `npx eslint src/app/online/preview --max-warnings 0`
Expected: exits 0 with no findings. (`online-client/` and `*.mts` are outside ESLint by `eslint.config.mjs`; `tsc` checks them.)

- [ ] **Step 11: Commit**

```bash
git add src/app/online/preview online-client/preview.mts online-client/index.html online-client/main.mts online-client/style.css tests/unit/online/scenePreview.test.ts
git commit -m "feat(online): live scene preview on the join page"
```

---

### Task 10: Documentation, full checks and the end-to-end test

**Files:**
- Modify: `README.md` ("Online play (preview)" section), `PRIVACY.md` ("Online play" section), `changelog/Unreleased.md`

**Interfaces:**
- Consumes: everything above. Produces no code.

- [ ] **Step 1: Update the README**

In `README.md`, replace the paragraph under `## Online play (preview)` (the one starting "Host a session from Atlas") with:

```markdown
Host a session from Atlas and your players join from a browser: run **Online session…**, share the link, and approve each player who joins. Nothing is sent before you start a session. Run **Present to players** (also in a map's **More options** menu) to show the current scene to everyone in the session without opening the player window; **Send current map to player view** presents it too. Players who join later get it when you let them in, and **Stop presenting** hides it again. Run **Stop online session** to end the session.

Players get what the player window shows and nothing more: no hidden tokens, pins, notes or statblocks, nothing completely under fog of war, and grid, HP, stress, names, widgets and initiative as your player view settings say. The join page shows a simple live preview for now (the grid, fog, and a marker per token); map and token images come in a later version, and file paths are never sent.
```

- [ ] **Step 2: Update the privacy notes**

In `PRIVACY.md`, append to the paragraph under `## Online play` that starts "While an online session you started runs":

```markdown
 The players you let in receive the scene you present: what your player window shows, filtered on your computer before it is sent, with file paths replaced by random ids.
```

(The leading space joins it to the end of that paragraph.)

- [ ] **Step 3: Add the release notes**

In `changelog/Unreleased.md`, under `**Online Play (preview)**`, add after the existing bullet:

```markdown
- Show online players the scene: run **Present to players** or pick it in a map's **More options** menu. Players see what your player window shows, including fog of war, and follow token moves, fog, widgets and initiative as you change them. **Stop presenting** hides the scene again.
- The join page shows a live preview of the presented scene: the grid, fog and a marker for each token, with widgets and initiative listed beside it.
```

- [ ] **Step 4: Run every check**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run build:ci && npm run build:online`
Expected: each exits 0. `npm run lint` reports no warnings; Vitest reports every test file passing (the existing suite plus `sceneProtocol`, `fogCoverage`, `projectParts`, `projectForPlayers`, `sceneDiff`, `playerSceneMirror`, `playerSessionScene`, `sceneBroadcaster`, `scenePreview`, `presentedScene`, `presentToPlayers`); `build:ci` writes `dist/main.js`; `build:online` writes `dist-online/`.

- [ ] **Step 5: Check the release notes build**

Run: `npm run changelog:check`
Expected: exits 0 (the generated files only change at release time; `Unreleased.md` is read as pending notes).

- [ ] **Step 6: Commit**

```bash
git add README.md PRIVACY.md changelog/Unreleased.md
git commit -m "docs(online): presenting scenes to online players"
```

- [ ] **Step 7: Manual end-to-end test (the user runs it)**

Build and load the plugin (`npm run build`, then reload Atlas in Obsidian). Run the join page locally with `npx vite -c vite.online.config.mts --host` and set **Settings → Online play → Player page address** to the address it prints (the published Pages site is built from `main` and does not have this branch yet).

1. Open a scene with a grid, a few tokens (one hidden, one completely under fog, one half under fog), some fog, a text, a drawing, a player-visible widget and the initiative tracker open.
2. Add about 100 freehand strokes to the scene (so its drawings alone exceed 256 KB). Run **Online session…**, open the join link in a browser (or a phone on the same network), enter a name, and allow the player. The page says it is connected and waiting for a scene.
3. Run **Present to players**. Within a moment the page shows the preview: the grid, the fog (opaque), a marker for each visible token (the half-fogged one included, the hidden and fully fogged ones absent), the text and all the drawings, and the widget and initiative lines beside it. The local player window did not open. The scene tab shows the "presented" marker.
4. In the browser's developer tools console, run `Object.keys(atlasScene.tokens)` and `JSON.stringify(atlasScene).includes('.png')`: the hidden and the fully fogged token's ids are missing, and the second gives `false` (no file paths).
5. Drag a token: the marker follows within about a tenth of a second. Paint and erase fog: the preview follows. Hide a token (context menu): its marker disappears. Step the widget and advance the initiative turn: the lines update.
6. In the command palette's player view settings, turn on HP bars and names: the markers get initials and HP bars. Turn off the grid: the grid disappears.
7. Switch the Atlas view to another scene tab and edit it: the page keeps showing the presented scene unchanged. Switch back: it shows the presented scene again, current.
8. Open the join link in a second tab: the first tab says you joined from another tab; the second shows the same scene. Reload the page: it reconnects without asking the GM again and shows the scene.
9. Present a different scene tab: the preview switches to it. Run **Stop presenting**: the page says it is waiting for a scene again.
10. Run **Send current map to player view**: the local player window opens as before, and the page shows that scene too. Close the local window: the page keeps the scene.
11. Run **Stop online session**: the page says the session ended.

---

## Self-review

Checked against the spec after writing:

- **Spec coverage.** Projection table: `map` (Task 4, size from the renderer, decision 1), `grid` (Task 4), `tokens` with every `PlayerToken` rule (Task 4), `fog` (Task 3), `texts` and `drawings` with fog dropping and simplification (Tasks 2 and 3), `widgets` and `initiative` (Task 3). Never-sent list and unknown fields: Task 4 test. Fog coverage (brush, lasso, rectangle, erase, order, offsets, partial vs complete, no grid or map): Task 2. Asset ids: Task 3. Presenting (`PresentedScene`, presented/held/cleared, local window follows, new command and view-actions item, "Stop presenting", clear on view close and on scene deletion): Task 7. Sync (snapshots on admitted/presented/resume, 50 ms deltas, per-record diff, empty diff, clear, one projection for all, settings changes): Tasks 5 and 8. Messages and validation both sides, `seq`, resync on gap or early patch, fog and drawing parts ≤ 256 KB (controller ruling), oversized patch → snapshot, oversized remaining snapshot → `scene-clear` plus one GM notice: Tasks 1, 6 and 8. Tab bar marker follows `PresentedScene`: Task 7. Player side mirror and `PlayerSession` routing: Task 6. Join page preview (fit, grid square and hex, fog offscreen, texts, drawings, token circles with initials and HP bars, one redraw per frame, widgets and initiative as text): Task 9. Edge cases: view closes or scene deleted → cleared (Task 7); map loading → no snapshot, no deltas (Tasks 7 and 8); drags follow the store's rate (Task 8 batching); join with nothing presented → admitted, `scene-clear` (Task 8); settings change → diff (Task 8); invalid messages → resync once per second (Task 6); fog without grid or map (Task 2 works in world pixels). Security: field-by-field projection and the never-sent test (Task 4), random asset ids (Task 3), GM accepts only `scene-resync` (Task 8). Deferred from piece 1: every `onAdmitted` sends a snapshot and `GmSession.ts` is untouched (Task 8). Docs and manual test: Task 10.
- **Deviations from the spec's wire shape**, reported for review: `map` also carries `cellSize` (decision 2); drawings leave the snapshot for `scene-drawings` parts, both part messages carry `records`, and the snapshot has `drawingParts` (decision 9, controller ruling; the spec's message table was updated to match).
- **Placeholder scan.** No "TBD", "similar to Task N" or unspecified validation; each code step shows the code, each run step the command and expected result.
- **Type consistency.** `PlayerScene` and parts, `ScenePatchBody`, `SCENE_LIMITS`, `sortedByOrder` (Task 1) are used under the same names in Tasks 2–9; `FogCoverage.EMPTY` / `fromOperations` / `isCovered` (Task 2) in Tasks 3, 4 and 8; `ProjectionMemo` / `createProjectionMemo` (Task 3) in Tasks 4 and 8; `PlayerViewRules` / `pickPlayerViewRules` / `samePlayerViewRules` (Task 3) in Task 8; `projectForPlayers(state, context)` with `ProjectionContext` (Task 4) in Task 8; `diffScenes` / `applyPatch` (Task 5) in Tasks 6 and 8; `PlayerSceneMirror`, `RESYNC_MIN_INTERVAL_MS`, `PlayerSession.scene`, `onScene` (Task 6) in Tasks 8 and 9; `PresentedScene`, `presentedScene`, `PresentedSceneInfo`, `PresentedSceneListener`, `whenMapLoaded` (Task 7) in Task 8; `PlayerSceneBody` (without `fog` and `drawings`), `fogParts` / `drawingParts` and the `records` field of `scene-fog` / `scene-drawings` (Task 1) in Tasks 4, 6 and 8; `presentedTabIdIn` / `usePresentedTabId` (Task 7) only there; `SceneOutgoing`, `snapshotMessages`, `patchMessage`, `splitParts`, `SCENE_TOO_LARGE_NOTICE`, the `notify` option (Task 8) only there and in `OnlineSessionService`.
- **Review Focus.** Each of the six lines has its named test in its owning task (Tasks 4, 6 and 8); the user's other examples are covered in Tasks 4, 6 and 8.
