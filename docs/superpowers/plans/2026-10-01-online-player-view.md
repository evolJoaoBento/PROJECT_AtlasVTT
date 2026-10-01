# Online Player Map View (Online Play, Piece 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the join page's small preview with a full-window map view of the presented scene (map, grid, drawings, texts, tokens with their bars, nameplates and condition badges, fog) that follows the GM's working view by default and that players can pan and zoom on desktop and phones. Every Atlas map object and field gets a recorded online-play decision. The GM tab-switch issue is reproduced with new diagnostics and fixed.

**Architecture:**
- **GM side.** `CameraSender` is a second `GmSession` handler beside `SceneBroadcaster`, which stays at its 300 lines. It reads the presented view's pixi-viewport on every `frame-end`, through a PIXI-free `CameraViewport` interface on `PresentedSceneInfo`. It sends `scene-camera` at most every 100 ms and only when the camera changed. While the scene is held it sends nothing. On resume, on admission and on a resync it sends the last camera once.
- **Player side.**
  - `PlayerSession` keeps the latest camera, whatever its scene.
  - `CameraController` (pure, injected clock) follows the GM or breaks away.
  - `ViewInput` (pure) turns pointer, wheel and double-click input into camera moves.
  - `PlayerViewRenderer` draws one layer per Atlas layer, in the order of the shared `SCENE_LAYER_ORDER`, through the `ViewSurface` drawing interface. The 2D canvas implements it on the page, and tests use a recording implementation.
  - `online-client/` keeps only DOM glue.
- **Keeping pace.** `coverage.ts` holds coverage tables typed as records over Atlas's own types, and a compiler-API test proves that a new field fails the build. The token bar and nameplate layout, the condition badge arc and the text box sizing move out of their PIXI renderers into shared modules, which Atlas and the player view both use.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), PIXI v8 and pixi-viewport 6.0.3 (Atlas side only, unchanged behaviour), Canvas 2D (join page), PeerJS/WebRTC (unchanged), Vitest 4 with jsdom 26 (no canvas, no `PointerEvent`, no `ResizeObserver`, no `matchMedia`), the TypeScript compiler API (coverage guard test), Vite (join page build).

**Spec:** `docs/superpowers/specs/2026-10-01-online-player-view-design.md`. It builds on `2026-09-30-online-scene-sync-design.md` and `2026-09-30-online-asset-streaming-design.md`, whose plans are in `docs/superpowers/plans/`.

## Global Constraints

- **The `scene-camera` message.** It travels on the control channel, protocol version `1`: `{ v: 1, type: 'scene-camera', sceneId, centerX, centerY, width, height }`.
  - Values are in world units: the visible world area's centre and size.
  - It carries no `seq`, because it is the latest camera, not part of the scene.
  - Both sides validate it. All numbers are finite. `centerX` and `centerY` lie within `SCENE_RANGES.coordinate` (`[-10_000_000, 10_000_000]`). `width` and `height` are positive and within the same range. `sceneId` passes `isSceneId`.
  - A camera for another `sceneId` is never applied to the shown scene.
  - An invalid `scene-camera` is skipped and never triggers a `scene-resync`.
- **When the GM sends the camera.** It is read from the presented view's map viewport (centre, visible world width and height). It is sent at most every 100 ms (`CAMERA_INTERVAL_MS = 100`), only when it changed, and always including the trailing position after a continuous move. Nothing is sent while the scene is held. On resume, and with every snapshot to a player (admission, resync), the current camera is sent once.
- **Player camera.**
  - A camera is a centre and a zoom (screen pixels per world unit).
  - **Following** is the default. On a GM camera the view glides there in 150 ms (`GLIDE_MS = 150`), with the same centre and a zoom that fits the GM's visible area to the player's screen.
  - Any player pan, zoom or pinch **breaks away**, and **Follow GM** and **Fit map** then appear.
  - Without a GM camera the view fits the map, or, without a map size, the scene's content.
  - Zoom is limited from 1/20 of the fitted zoom to 8× it. Panning keeps part of the map on screen.
  - A new scene (new `sceneId`) returns a player to following.
  - On a resize or rotation the camera keeps its centre, and a following player refits.
- **Input.**
  - Desktop: the wheel zooms around the cursor, a drag pans, a double-click zooms in.
  - Phone: a one-finger drag pans, a pinch zooms around the fingers, a double-tap zooms in.
  - The canvas has `touch-action: none`.
  - A gesture that starts on a button or panel does not move the map.
- **Drawing.**
  - Layers stack in Atlas's player-view order, taken from `SCENE_LAYER_ORDER` in `src/app/pixi/sceneLayerOrder.ts`: map, grid, tokens, texts, drawings, fog. See ruling 1.
  - Each layer draws only what is on screen.
  - Fog is rendered into a cached image of the map area, at most 4096 px on its long side (`FOG_CACHE_MAX_SIDE = 4096`). It is redrawn only when the fog changes, and drawn last and opaque.
  - The view redraws at most once per animation frame, and only when the camera, scene, images or size changed.
  - It draws at the device pixel ratio, capped at 2 on phones (`PHONE_PIXEL_RATIO_CAP = 2`). Nothing is drawn while the page is hidden.
- **Layout.**
  - The map fills the window.
  - The top bar holds the session name, the connection status, the image loading bar and a menu button.
  - The menu opens a side panel (a bottom sheet at 720 px wide or less). It holds the player list, the widgets, the initiative, the **Keep images on this device** switch and the **Clear saved images** button.
  - **Follow GM** and **Fit map** float in the bottom right corner while a player has broken away.
  - The name form and the waiting, refused and ended states keep their full-screen messages.
  - Touch targets are at least 44 px. The page has safe-area padding and works in portrait and landscape.
- **Copy.** Use these texts exactly, in sentence case except the product names:
  - The **Follow GM** and **Fit map** buttons.
  - The **Menu** button and the **Close menu** button.
  - The **Log online play events** setting, described as "For troubleshooting: writes what Atlas sends to online players, and every change of the presented scene, to the developer console."
  - "Reconnecting…" and "Connected" in the top bar.
  - Network text reaches the page only through `textContent` and the canvas only through `fillText` / `strokeText`. Colours reach the canvas only through `fillStyle` / `strokeStyle`.
- **Diagnostics.** The developer setting **Log online play events** (`OnlineSettings.logEvents`, default `false`) is read on every event, so switching it works mid-session.
  - The GM's console gets every presented-scene event, every tab change of the presented view and every message sent to players, through `console.debug('[Atlas online]', name, details)`.
  - Each `scene-clear`, `presented`, `held` and `cleared` entry carries its caller's stack.
- **Coverage tables.** `OBJECT_COVERAGE`, `TOKEN_FIELD_COVERAGE`, `TEXT_FIELD_COVERAGE`, `DRAWING_FIELD_COVERAGE`, `FOG_FIELD_COVERAGE`, `GRID_FIELD_COVERAGE` and `SCENE_FIELD_COVERAGE` are records over Atlas's types. A new Atlas field or object kind fails `tsc` until it is recorded.
- **Shared modules.** These are shared with the web page, so they import nothing from `obsidian`, PIXI, PeerJS or React:
  - Everything under `src/app/online/view/` and `src/app/online/page/`.
  - `src/app/online/scene/sceneCamera.ts` and `src/app/online/onlineLog.ts`.
  - `src/app/pixi/sceneLayerOrder.ts`, `src/app/pixi/textBoxLayout.ts`, `src/app/pixi/token-renderer/tokenUiLayout.ts` and `src/app/pixi/token-renderer/conditionBadgeLayout.ts`.
  - `src/app/services/presentedCamera.ts` imports only types.
- **No DOM in `src/`.** The shared modules in `src/` never touch the DOM. `src/` is linted with Obsidian's rules, including `obsidianmd/prefer-create-el`, which warns on `document.createElement`, and lint runs with `--max-warnings 0`. The web page has no Obsidian helpers. DOM glue lives in `online-client/*.mts`, where it is type-checked by `tsc` (the root `tsconfig.json` includes it) and tested under jsdom where it pays.
- **File sizes.** `SceneBroadcaster.ts` stays at its 300 lines and is not modified. Every new file stays under 300 lines. `PlayerSession.ts` grows by about 12 lines (to about 212). The existing oversize files `TokenUIRenderer.ts` and `PixiRendererOrchestrator.ts` only lose code or swap literals for shared constants.
- **Atlas behaviour.** It does not change. The existing token, condition, text and grid tests (`tokenResourceBars`, `conditionBadges`, `tokenUIRenderer.playerSettings`, `tokenNameplatePreference`, `tokenSizing`, `tokenUIScale` and the grid tests) must pass unchanged.
- **Code style (CLAUDE.md, CONTRIBUTING.md, ESLint).**
  - Explicit return types, and files under about 300 lines.
  - `window.setTimeout` / `window.clearTimeout` / `window.requestAnimationFrame` in `src` (`obsidianmd/prefer-window-timers`).
  - Sentence-case UI text, no inline `eslint-disable` (`noInlineConfig`), no `@ts-expect-error` (`ban-ts-comment`), no `title` attributes.
  - PIXI v8 only in Atlas code, and none in shared modules.
  - Player-facing changes go in `changelog/Unreleased.md` (CRLF line endings, keep them).
- **Tests.** They live in `tests/unit/online/` (online code) and `tests/unit/` (shared Atlas layout). Fake timers are used wherever timing matters. The camera controller, input and renderer take an injected clock and frame scheduler, never jsdom's.

## Review Focus

- **The GM pans continuously, for longer than 100 ms.** Players expect to end up exactly where the GM stopped, not one throttle step short. Test in Task 2: `sends at most every 100 ms, and the final position after a continuous pan`.
- **A click, or a tap with a few pixels of finger jitter.** A player expects it not to break away from following the GM. Test in Task 3: `moves nothing on a click, or a tap that jitters less than the slop`.
- **A pinch where one finger lifts first.** A player expects the remaining finger to keep panning from where it is, without a jump. Test in Task 3: `keeps panning with the remaining finger after a pinch`.
- **A GM camera that arrives before its scene's snapshot completes, or belongs to another scene.** Players expect the view to use it once that scene is shown, and never on another scene. Test in Task 3: `uses a GM camera that arrived before its scene, and ignores one for another scene`.
- **The canvas has no size yet** (laid out after the first scene, or the page loads in a background tab). A player expects a finite camera that refits once the canvas has a size, never `NaN` or `Infinity`. Test in Task 3: `stays finite while the canvas has no size, and refits once it has one`.

The spec's other likely failures have tests too:
- the trailing camera, a resume sending exactly one camera, and a presentation made while the map loads sending its camera after the load (Task 2);
- a resize while following versus after breaking away (Task 3);
- the fog cache not rebuilt on pan or zoom, and a gesture that starts on a button (Task 4);
- the cause found for the tab-switch issue (Task 5).

## Rulings on spec ambiguities

Each task repeats the rulings it needs.

1. **Layer order.**
   - **Ambiguity.** The spec lists "map, grid, drawings, texts, tokens, fog" and says the order is "taken from the same list `playerSafeFrame.ts` uses". `playerSafeFrame.ts` has no such list, and Atlas actually stacks map, grid, tokens, texts, drawings, fog: the map at child index 0, the grid just above it, tokens at `zIndex` 0, texts at 500, drawings at 900 ("Above tokens/text, below fog"), fog at 1000.
   - **Ruling.** Follow the spec's stated intent ("in the order Atlas's player view draws them … so the two cannot drift"). `src/app/pixi/sceneLayerOrder.ts` holds `SCENE_LAYER_ORDER` and `SCENE_LAYER_Z`. The orchestrator's and `TokenRenderer`'s `zIndex` literals read from it, and the player view iterates it.
2. **Which camera.** `ViewAtlasState.camera` is never written: `setCamera` has no callers. So the GM camera is read from the presented view's pixi-viewport (`center`, `worldScreenWidth`, `worldScreenHeight`) on every `frame-end`, which pixi-viewport emits each tick. That covers gestures, programmatic moves and resizes alike.
3. **Hold versus "camera with every snapshot".**
   - The sender keeps the last camera it sent. During a hold, an admission or resync gets that stored camera with the held snapshot.
   - The viewport is never read while the scene is held, because it then shows another map.
   - Clearing the scene forgets the stored camera.
4. **Order of camera and snapshot.**
   - `SceneBroadcaster.onProjection` fires inside `setSent`, before the snapshot messages go out. An admission's or resync's camera may therefore reach a player before the snapshot is complete.
   - The player keeps the latest camera whatever its `sceneId` (`PlayerSession.camera`), and the view applies it once its scene matches.
   - The sender still sends the camera after the broadcaster's snapshot wherever the order is in its hands: on presenting and resuming (its `presented` listener runs after the broadcaster's), and on admission (its handler is registered after the broadcaster's).
5. **Throttle.** The first change is sent at once and starts a 100 ms cooldown. Changes during the cooldown are sent once at its end, which gives the trailing edge. Cameras are rounded to hundredths of a world unit, and "changed" compares the rounded values.
6. **Condition badges.** The wire carries only condition ids and values, not names, colours or icons. Badges are drawn as neutral discs (`#5b5f6a`) on Atlas's badge arc, with the value in a pip when the token stores one, and a "+n" badge for overflow. Sending the definitions is a controller item; this piece makes no protocol change for it.
7. **"Capped at 2 on phones".** A phone is a coarse primary pointer (`matchMedia('(pointer: coarse)')`). `pixelRatioFor(deviceRatio, coarsePointer)` is pure and tested.
8. **Map icons.** Icon stamps are drawn as their Lucide glyph through `Path2D`, built from Atlas's own `MAP_ICON_SVG` markup by `mapIconPaths.ts`. Nothing from the network is ever put into SVG text. An unknown icon name draws nothing, as in Atlas.
9. **Coverage semantics.**
   - **sent** means the field changes what players receive, either the value itself or what it decides, as `isHidden` does.
   - **GM only** means it never changes what players receive. **not yet** behaves like GM only today.
   - The field tests check exactly that by projecting a scene before and after changing each field.
   - `GRID_FIELD_COVERAGE` is added beyond the spec's list, because grid fields are where Atlas adds settings most often (for example `hexNumbers`).
10. **Text layout parity.** Atlas draws a text centred on its position and ignores `width` and `height`. A background is the measured box grown by `padding || 8` and filled at `opacity || 1`, and the glyphs stay opaque. The player view does the same. Line spacing is 1.2 font sizes (`TEXT_LINE_SPACING`), since PIXI measures the font itself.
11. **Token sizes.** Sizes use `computeTokenPixelSize` (Atlas's sprite size), not the preview's 0.9 factor. The ring is centred at `getTokenRingCenterRadius` with the grid stroke width. Bars, nameplate and badges use `restingTokenUIScale(cellSize)`. The nameplate uses Atlas's dark-theme colours, because the page has no Obsidian theme.
12. **Fog area.** With a map size it is the map rectangle. Without one it is the extent of the fog shapes, so the cache depends only on the fog and never on token moves. Fog beyond the map edge is not drawn, because the canvas around the map is black like Atlas's.
13. **Instance badges and ring size.** `tokenSettings` (instance badges, ring size) is not projected, so `instanceNumber` is recorded as "not yet" and rings use scale 1.
14. **Diagnostics.**
    - The GM-side log decorates the `SceneSession` that the broadcaster and the camera sender use (`loggedSession`), so `SceneBroadcaster.ts` is not touched.
    - The page-side log (Task 5) is switched on with `localStorage.setItem('atlas-online:log', 'on')` and uses the same `createOnlineLog`.

## Items for the controller to decide

- **Condition definitions.** Should a later piece send condition names, colours and icons so badges match Atlas (ruling 6)?
- **`tokenSettings`.** Should a later piece project `showInstanceBadges` and `tokenRingSize` (ruling 13)?
- **The tab-switch fix (Task 5).** The cause is only known after the user reproduces with the log. Task 5 gives the fixes and regression tests for the two likely causes. If the log shows another cause, the implementer stops and reports.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/app/online/coverage.ts` | Coverage tables over Atlas's types. |
| `src/app/pixi/sceneLayerOrder.ts` | `SCENE_LAYER_ORDER`, `SCENE_LAYER_Z`: Atlas's layer stack, shared. |
| `src/app/pixi/token-renderer/tokenUiLayout.ts` | Resource bar and nameplate geometry and colours, shared. |
| `src/app/pixi/token-renderer/conditionBadgeLayout.ts` | Condition badge arc, slots and badge geometry, shared. |
| `src/app/pixi/textBoxLayout.ts` | Text background, font weight/style, rotation and scale, shared. |
| `src/app/grid/hexNumbering.ts` (modify) | `MIN_HEX_NUMBER_SCREEN_SIZE` moves here from `hexNumberLabels.ts`. |
| `src/app/pixi/TokenUIRenderer.ts`, `ConditionBadgeRing.ts`, `ConditionBadge.ts`, `TextRenderer.ts`, `PixiRendererOrchestrator.ts`, `TokenRenderer.ts`, `src/app/grid/hexNumberLabels.ts` (modify) | Use the shared layout modules; no behaviour change. |
| `src/app/online/scene/sceneCamera.ts` | `SceneCamera`, `CAMERA_INTERVAL_MS`, rounding and comparison. |
| `src/app/online/scene/sceneValidation.ts`, `src/app/online/protocol.ts` (modify) | The `scene-camera` message and its validation. |
| `src/app/services/presentedCamera.ts` | `CameraViewport`, `ViewCamera`, reading and watching a view's viewport. |
| `src/app/services/PresentedScene.ts` (modify) | `PresentedSceneInfo.camera()` / `watchCamera()`. |
| `src/app/online/scene/CameraSender.ts` | GM side: sends `scene-camera`. |
| `src/app/online/PlayerSession.ts` (modify) | Keeps and reports the latest camera. |
| `src/app/online/onlineLog.ts` | Diagnostics: `createOnlineLog`, `loggedSession`, `logPresentedScene`. |
| `src/app/online/onlineSettings.ts`, `src/app/settings/onlineSettingsSection.ts`, `src/app/online/OnlineSessionService.ts` (modify) | The setting, and wiring the camera sender and the log. |
| `src/app/online/view/camera.ts` | Camera maths: fit, limits, zoom around a point, pan, glide, rectangles. |
| `src/app/online/view/CameraController.ts` | Following, breaking away, glide, resize, scene changes. |
| `src/app/online/view/ViewInput.ts` | Wheel, drag, double-click, touch pan, pinch, double-tap → camera moves. |
| `src/app/online/view/ViewSurface.ts` | The drawing interface. |
| `src/app/online/view/layers/layerTypes.ts` | `LayerFrame`, `PlayerLayer`, `ImageLookup`. |
| `src/app/online/view/PlayerViewRenderer.ts` | Frame scheduling, pixel ratio, layer stacking. |
| `src/app/online/view/mapIconPaths.ts` | Atlas's map icons as SVG path data. |
| `src/app/online/view/layers/mapLayer.ts`, `gridLayer.ts`, `tokensLayer.ts`, `tokenUiDrawing.ts`, `textsLayer.ts`, `drawingsLayer.ts`, `fogLayer.ts`, `sceneLayers.ts` | One player layer per Atlas layer. |
| `src/app/online/page/pageScreen.ts` | Which screen the join page shows, and its texts. |
| `src/app/online/preview/sceneSummary.ts` (modify) | `playerLines`. |
| `src/app/online/preview/previewShapes.ts`, `previewLayout.ts` (modify) | Drop what only the old preview used. |
| `online-client/canvasSurface.mts` | `ViewSurface` on a 2D canvas. |
| `online-client/mapView.mts` | Binds the canvas, input, buttons, resize and visibility. |
| `online-client/menu.mts` | The menu panel. |
| `online-client/main.mts`, `index.html`, `style.css` (rewrite), `preview.mts` (delete) | The page. |
| `docs/online-play-features.md` | "Adding a map feature to online play". |
| `README.md`, `PRIVACY.md`, `changelog/Unreleased.md` (modify) | Player-facing documentation. |

Tests:
- **New:** `tests/unit/sharedLayout.test.ts`, and in `tests/unit/online/`: `coverage.test.ts`, `coverageGuard.test.ts`, `sceneCamera.test.ts`, `presentedCamera.test.ts`, `cameraFixtures.ts`, `cameraSender.test.ts`, `onlineLog.test.ts`, `cameraController.test.ts`, `viewInput.test.ts`, `recordingSurface.ts`, `playerViewRenderer.test.ts`, `viewLayers.test.ts`, `tokensLayer.test.ts`, `fogLayer.test.ts`, `mapIconPaths.test.ts`, `pageScreen.test.ts`, `mapView.test.ts`, `canvasSurface.test.ts`.
- **Modified:** `playerSessionScene.test.ts`, `onlineSettings.test.ts`, `onlineSessionService.test.ts`, `scenePreview.test.ts`.

Task order: 1 → 2 → 3 → 4 → 5. Task 2 is independent of Task 1. Task 3 needs Task 1 (`SCENE_LAYER_ORDER`) and Task 2 (`SceneCamera`). Task 4 needs Tasks 1–3. Task 5 needs Task 2 (the log) and Task 4 (the page).

---
### Task 1: Coverage tables, the type-level guard, and shared layout modules

The coverage tables record an online-play decision for every Atlas map object and field. The guard test proves that a missing decision fails `tsc`, and the field tests check every entry against the projection. The geometry Atlas's renderers and the player view both need moves into PIXI-free modules, and Atlas's renderers use them with no behaviour change.

**Files:**
- Create: `src/app/online/coverage.ts`
- Create: `src/app/pixi/sceneLayerOrder.ts`
- Create: `src/app/pixi/token-renderer/tokenUiLayout.ts`
- Create: `src/app/pixi/token-renderer/conditionBadgeLayout.ts`
- Create: `src/app/pixi/textBoxLayout.ts`
- Modify: `src/app/grid/hexNumbering.ts` (add `MIN_HEX_NUMBER_SCREEN_SIZE`), `src/app/grid/hexNumberLabels.ts:2, 13-14, 95`
- Modify: `src/app/pixi/TokenUIRenderer.ts:1-37, 153-163, 387-486, 504-540, 846-853`
- Modify: `src/app/pixi/token-renderer/ConditionBadge.ts:15-25`, `src/app/pixi/token-renderer/ConditionBadgeRing.ts:5-22, 76-124`
- Modify: `src/app/pixi/TextRenderer.ts:122-236`
- Modify: `src/app/PixiRendererOrchestrator.ts:398, 469, 484, 619`, `src/app/pixi/TokenRenderer.ts:232`
- Test: `tests/unit/online/coverage.test.ts`, `tests/unit/online/coverageGuard.test.ts`, `tests/unit/sharedLayout.test.ts`

**Interfaces:**
- Consumes: Atlas's existing types and helpers. These are `Character`, `TokenEntity`, `TextElement`, `DrawingStroke` (`src/app/types.ts`); `FogOperation` (`types/fogTypes.ts`); `GridState` (`services/MapPersistence.ts`); `ViewAtlasState` (`storeFactory.ts`); `ProjectedState`, `projectForPlayers` (`online/scene/projectForPlayers.ts`); `projectFog`, `projectTexts`, `projectDrawings`, `createProjectionMemo` (`online/scene/projectRecords.ts`); and `barDimensions` (`styles/designTokens.ts`).
- Produces:
  - `coverage.ts`:
    - `type Coverage = { status: 'sent' } | { status: 'gm-only'; reason: string } | { status: 'not-yet'; piece: string }`
    - `type CoverageTable<K extends PropertyKey> = Readonly<Record<K, Coverage>>` and `type KeysOfUnion<T>`
    - `OBJECT_COVERAGE: CoverageTable<keyof ViewAtlasState['objects']>`
    - `TOKEN_FIELD_COVERAGE: CoverageTable<keyof TokenEntity | keyof Character>`
    - `TEXT_FIELD_COVERAGE: CoverageTable<keyof TextElement>`
    - `DRAWING_FIELD_COVERAGE: CoverageTable<keyof DrawingStroke>`
    - `FOG_FIELD_COVERAGE: CoverageTable<KeysOfUnion<FogOperation>>`
    - `GRID_FIELD_COVERAGE: CoverageTable<keyof GridState>`
    - `SCENE_FIELD_COVERAGE: CoverageTable<keyof ProjectedState>`
  - `sceneLayerOrder.ts`: `SCENE_LAYER_ORDER = ['map', 'grid', 'tokens', 'texts', 'drawings', 'fog'] as const`, `type SceneLayer`, `SCENE_LAYER_Z = { tokens: 0, texts: 500, drawings: 900, fog: 1000 }`.
  - `tokenUiLayout.ts`:
    - Types: `interface UiRect { x; y; width; height }`.
    - Constants: `FIRST_BAR_GAP = 2`, `BAR_BORDER = 0.75`, `BAR_TICKS = 10`, `BAR_STYLE`, `NAMEPLATE`, `NAMEPLATE_STYLE`.
    - Functions: `tokenBarRects(hasHp, hasStress): { hp: UiRect | null; stress: UiRect | null }`, `barInnerRect(bar): UiRect`, `barFillRect(inner): UiRect`, `barTickXs(inner): number[]`, `nameplateRect(textWidth): UiRect & { textY: number }`.
  - `conditionBadgeLayout.ts`: `CONDITION_BADGE` (radius 6, bezel, pip, overflow colour), `badgeSlots(ringRadius, scale): number`, `fitBadges<T>(items, ringRadius, scale): { shown: T[]; overflow: number }`, `badgePositions(count, ringRadius, scale): Array<{ x: number; y: number }>`.
  - `textBoxLayout.ts`: `DEFAULT_TEXT_PADDING = 8`, `TEXT_LINE_SPACING = 1.2`, `TextBoxSource`, `TextBounds`, `TextBackground`, `textBackground(text, bounds): TextBackground | null`, `textFontWeight(text): 'bold' | 'normal'`, `textFontStyle(text): 'italic' | 'normal'`, `textRotation(rotation): number` (radians), `textScale(scale): number`.
  - `hexNumbering.ts`: `MIN_HEX_NUMBER_SCREEN_SIZE = 7`.

- [ ] **Step 1: Write the failing coverage field tests**

Create `tests/unit/online/coverage.test.ts`. Each entry is checked against the projection. For every field, the test changes the field and projects the scene again: a `sent` field must change the projection, and a `gm-only` or `not-yet` field must not. Every variant table is typed over the same keys as its coverage table, so the test also lists every field.

```ts
import { describe, expect, it } from 'vitest';
import {
  DRAWING_FIELD_COVERAGE, FOG_FIELD_COVERAGE, GRID_FIELD_COVERAGE, OBJECT_COVERAGE, SCENE_FIELD_COVERAGE, TEXT_FIELD_COVERAGE,
  TOKEN_FIELD_COVERAGE, type CoverageTable, type KeysOfUnion,
} from '../../../src/app/online/coverage';
import { projectForPlayers, type ProjectedState } from '../../../src/app/online/scene/projectForPlayers';
import { createProjectionMemo, projectDrawings, projectFog, projectTexts } from '../../../src/app/online/scene/projectRecords';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import type { GridState } from '../../../src/app/services/MapPersistence';
import type { ViewAtlasState } from '../../../src/app/storeFactory';
import type { Character, DrawingStroke, TextElement } from '../../../src/app/types';
import type { FogBrushStroke, FogOperation, FogRectangleFill } from '../../../src/app/types/fogTypes';
import { createDefaultInitiativeState, type InitiativeEntry } from '../../../src/app/types/initiativeTypes';
import type { AnyWidget } from '../../../src/app/types/widgetTypes';
import { coverageOfFog, fakeAssetIds } from './sceneFixtures';

type Variants<K extends PropertyKey, T> = Record<K, (base: T) => T>;

/** A `sent` field changes the projection; a `gm-only` or `not-yet` field never does. */
function expectCoverage<K extends string, T>(table: CoverageTable<K>, variants: Variants<K, T>, base: T, project: (value: T) => unknown): void {
  expect(Object.keys(variants).sort()).toEqual(Object.keys(table).sort());
  const before = project(base);
  for (const key of Object.keys(table) as K[]) {
    const after = project(variants[key](base));
    if (table[key].status === 'sent') expect(after, `${key} is marked sent`).not.toEqual(before);
    else expect(after, `${key} is marked ${table[key].status}`).toEqual(before);
  }
}

const RULES: PlayerViewRules = {
  showGrid: true, showTokenHP: true, showTokenStress: true, showTokenNameplates: true, showWidgets: true, showInitiative: true,
};
// One id per path for the whole file, so a changed image path always gets a different id.
const assets = fakeAssetIds();
const project = (state: ProjectedState): unknown => projectForPlayers(state, {
  sceneId: 'scene-1', rules: RULES, coverage: coverageOfFog({}), assets, mapSize: { width: 1000, height: 800 }, memo: createProjectionMemo(),
});

const TOKEN: Character = {
  id: 'hero', kind: 'character', x: 140, y: 140, imagePath: 'art/hero.png', name: '', size: 1, rotation: 0, layer: 0,
  showRing: true, ringColor: '#ff0000', conditions: ['frightened'], conditionValues: { frightened: 2 }, isHidden: false,
  hp: { current: 7, max: 10 }, stress: 2, maxStress: 6, maxHpOverridden: false, maxStressOverridden: false,
  hope: { current: 1, max: 6 }, difficulty: '3', notePath: 'notes/hero.md', statblockPath: 'statblocks/hero.md', statblockName: 'Hero',
  playerLinked: false, playerId: 'p1', playerCharacterId: 'c1', statblockResources: { focus: { current: 1, max: 3 } },
  tags: ['party'], hasVision: true, showNameplate: false, visionInnerRadius: 100, visionOuterRadius: 200, instanceNumber: 1,
};
const TEXT: TextElement = {
  id: 'tx', kind: 'text', x: 50, y: 50, text: 'Tavern', fontSize: 24, fontFamily: 'serif', color: '#000000',
  backgroundColor: '#ffffff', padding: 4, borderRadius: 2, opacity: 0.8, width: 120, height: 40, align: 'left',
  bold: false, italic: false, rotation: 0, scale: 1,
};
const DRAWING: DrawingStroke = {
  id: 'd1', kind: 'drawing', timestamp: 2, type: 'icon', points: [{ x: 10, y: 10 }], color: '#ff0000', width: 70, opacity: 1, icon: 'flame',
};
const GRID: GridState = {
  enabled: true, visible: true, type: 'hex-vertical', size: 70, offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.5,
  lineType: 'solid', lineWidth: 1, hexNumbers: 'column-row', hexNumberOpacity: 0.8, snapToGrid: true, scale: 1, mapScale: 1,
  unitType: 'feet', unitDistance: 5, measurementType: 'units', autoDetect: false,
};
const COUNTER = { id: 'w1', type: 'counter', label: 'Torches', icon: 'flame', visible: true, visibleToPlayers: true, value: 1, order: 0 } as AnyWidget;
const ENTRY: InitiativeEntry = {
  id: 'e1', tokenId: 'hero', name: 'Hero', initiative: 15, initiativeModifier: 1, hp: { current: 7, max: 10 },
  stress: { current: 2, max: 6 }, imagePath: 'art/hero.png', statblockPath: 'statblocks/hero.md',
  isActive: true, isDefeated: false, isNPC: false, order: 0,
};

function sceneState(overrides: Partial<ProjectedState> = {}): ProjectedState {
  return {
    background: 'maps/tavern.png',
    grid: GRID,
    objects: { tokens: { hero: TOKEN }, fog: {}, pins: {}, texts: { tx: TEXT }, drawings: { d1: DRAWING }, walls: {}, lights: {}, audios: {} },
    widgetSettings: { widgets: { w1: COUNTER }, globalVisible: true, position: 'top', scale: 1 },
    widgetValues: { w1: 3 },
    initiative: { ...createDefaultInitiativeState(), isActive: true, round: 2, entries: [ENTRY] },
    initiativeTrackerOpen: true,
    ...overrides,
  };
}

const withToken = (token: Character): ProjectedState => {
  const base = sceneState();
  return { ...base, objects: { ...base.objects, tokens: { [token.id]: token } } };
};

describe('coverage of map objects', () => {
  type Objects = ViewAtlasState['objects'];
  const add = (kind: keyof Objects, record: unknown) => (state: ProjectedState): ProjectedState => ({
    ...state, objects: { ...state.objects, [kind]: { ...state.objects[kind], extra: record } },
  });
  it('sends every kind marked sent and nothing of the others', () => {
    const variants: Variants<keyof Objects, ProjectedState> = {
      tokens: add('tokens', { ...TOKEN, id: 'extra', x: 400 }),
      fog: add('fog', { id: 'extra', kind: 'fog', type: 'rectangle', timestamp: 9, isErasing: false, x: 0, y: 0, width: 5, height: 5 }),
      texts: add('texts', { ...TEXT, id: 'extra' }),
      drawings: add('drawings', { ...DRAWING, id: 'extra' }),
      pins: add('pins', { id: 'extra', kind: 'pin', x: 1, y: 1, notePath: 'notes/secret.md' }),
      walls: add('walls', { id: 'extra' }),
      lights: add('lights', { id: 'extra' }),
      audios: add('audios', { id: 'extra' }),
    };
    expectCoverage(OBJECT_COVERAGE, variants, sceneState(), project);
  });
});

describe('coverage of token fields', () => {
  it('sends every field marked sent and nothing of the others', () => {
    const set = (patch: Partial<Character>) => (token: Character): Character => ({ ...token, ...patch });
    const variants: Variants<keyof Character, Character> = {
      id: set({ id: 'hero-2' }), kind: (token) => ({ ...token, kind: 'token' }) as unknown as Character,
      x: set({ x: 300 }), y: set({ y: 300 }), imagePath: set({ imagePath: 'art/other.png' }), size: set({ size: 2 }),
      rotation: set({ rotation: 45 }), layer: set({ layer: 3 }), showRing: set({ showRing: false }), ringColor: set({ ringColor: '#00ff00' }),
      conditions: set({ conditions: ['prone'] }), conditionValues: set({ conditionValues: { frightened: 3 } }),
      isHidden: set({ isHidden: true }), name: set({ name: 'Bob' }),
      statblockPath: ({ statblockPath: _path, ...token }) => token, statblockName: set({ statblockName: 'Orc' }),
      hp: set({ hp: { current: 3, max: 10 } }), stress: set({ stress: 4 }), maxStress: set({ maxStress: 8 }),
      showNameplate: set({ showNameplate: true }), tags: set({ tags: ['secret'] }), notePath: set({ notePath: 'notes/other.md' }),
      difficulty: set({ difficulty: '5' }), hope: set({ hope: { current: 2, max: 6 } }),
      statblockResources: set({ statblockResources: { focus: { current: 2, max: 3 } } }),
      maxHpOverridden: set({ maxHpOverridden: true }), maxStressOverridden: set({ maxStressOverridden: true }),
      playerLinked: set({ playerLinked: true }), playerId: set({ playerId: 'p2' }), playerCharacterId: set({ playerCharacterId: 'c2' }),
      hasVision: set({ hasVision: false }), visionInnerRadius: set({ visionInnerRadius: 150 }), visionOuterRadius: set({ visionOuterRadius: 250 }),
      instanceNumber: set({ instanceNumber: 2 }),
    };
    expectCoverage(TOKEN_FIELD_COVERAGE, variants, TOKEN, (token) => project(withToken(token)));
  });
});

describe('coverage of text, drawing and fog fields', () => {
  it('sends every text field marked sent', () => {
    const set = (patch: Partial<TextElement>) => (text: TextElement): TextElement => ({ ...text, ...patch });
    const variants: Variants<keyof TextElement, TextElement> = {
      id: set({ id: 'tx-2' }), kind: (text) => ({ ...text, kind: 'other' }) as unknown as TextElement,
      x: set({ x: 60 }), y: set({ y: 60 }), rotation: set({ rotation: 30 }), text: set({ text: 'Inn' }), fontSize: set({ fontSize: 30 }),
      fontFamily: set({ fontFamily: 'sans-serif' }), color: set({ color: '#ff0000' }), backgroundColor: set({ backgroundColor: '#000000' }),
      padding: set({ padding: 6 }), borderRadius: set({ borderRadius: 4 }), opacity: set({ opacity: 0.5 }), width: set({ width: 200 }),
      height: set({ height: 60 }), align: set({ align: 'right' }), bold: set({ bold: true }), italic: set({ italic: true }), scale: set({ scale: 2 }),
    };
    expectCoverage(TEXT_FIELD_COVERAGE, variants, TEXT, (text) => projectTexts({ [text.id]: text }, coverageOfFog({})));
  });

  it('sends every drawing field marked sent', () => {
    const set = (patch: Partial<DrawingStroke>) => (drawing: DrawingStroke): DrawingStroke => ({ ...drawing, ...patch });
    const variants: Variants<keyof DrawingStroke, DrawingStroke> = {
      id: set({ id: 'd2' }), kind: (drawing) => ({ ...drawing, kind: 'other' }) as unknown as DrawingStroke,
      color: set({ color: '#00ff00' }), opacity: set({ opacity: 0.5 }), width: set({ width: 80 }), timestamp: set({ timestamp: 3 }),
      type: set({ type: 'pen' }), points: set({ points: [{ x: 20, y: 20 }] }), icon: set({ icon: 'skull' }),
    };
    expectCoverage(DRAWING_FIELD_COVERAGE, variants, DRAWING, (drawing) =>
      projectDrawings({ [drawing.id]: drawing }, coverageOfFog({}), createProjectionMemo()));
  });

  it('sends every fog field marked sent', () => {
    interface FogPair { brush: FogBrushStroke; rect: FogRectangleFill }
    const base: FogPair = {
      brush: {
        id: 'b', kind: 'fog', type: 'brush', timestamp: 1, isErasing: false, brushRadius: 20,
        points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }], offsetX: 0, offsetY: 0,
      },
      rect: { id: 'r', kind: 'fog', type: 'rectangle', timestamp: 2, isErasing: false, x: 100, y: 100, width: 50, height: 50, offsetX: 0, offsetY: 0 },
    };
    const brush = (patch: object) => (pair: FogPair): FogPair => ({ ...pair, brush: { ...pair.brush, ...patch } as FogBrushStroke });
    const rect = (patch: Partial<FogRectangleFill>) => (pair: FogPair): FogPair => ({ ...pair, rect: { ...pair.rect, ...patch } });
    const variants: Variants<KeysOfUnion<FogOperation>, FogPair> = {
      id: brush({ id: 'b2' }), kind: brush({ kind: 'other' }), timestamp: brush({ timestamp: 5 }), type: brush({ type: 'lasso' }),
      isErasing: brush({ isErasing: true }), offsetX: brush({ offsetX: 5 }), offsetY: brush({ offsetY: 5 }),
      points: brush({ points: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }] }), brushRadius: brush({ brushRadius: 30 }),
      x: rect({ x: 110 }), y: rect({ y: 110 }), width: rect({ width: 60 }), height: rect({ height: 60 }),
    };
    expectCoverage(FOG_FIELD_COVERAGE, variants, base, (pair) =>
      projectFog({ [pair.brush.id]: pair.brush, [pair.rect.id]: pair.rect }, createProjectionMemo()));
  });
});

describe('coverage of grid and scene fields', () => {
  it('sends every grid field marked sent', () => {
    const set = (patch: Partial<GridState>) => (grid: GridState): GridState => ({ ...grid, ...patch });
    const variants: Variants<keyof GridState, GridState> = {
      enabled: set({ enabled: false }), visible: set({ visible: false }), type: set({ type: 'square' }), size: set({ size: 80 }),
      offsetX: set({ offsetX: 5 }), offsetY: set({ offsetY: 5 }), color: set({ color: '#ff0000' }), opacity: set({ opacity: 0.3 }),
      lineType: set({ lineType: 'dashed' }), lineWidth: set({ lineWidth: 3 }), hexNumbers: set({ hexNumbers: 'sequential' }),
      hexNumberOpacity: set({ hexNumberOpacity: 0.2 }), snapToGrid: set({ snapToGrid: false }), scale: set({ scale: 2 }),
      mapScale: set({ mapScale: 2 }), unitType: set({ unitType: 'meters' }), unitDistance: set({ unitDistance: 10 }),
      measurementType: set({ measurementType: 'abstract' }), autoDetect: set({ autoDetect: true }),
    };
    expectCoverage(GRID_FIELD_COVERAGE, variants, GRID, (grid) => project(sceneState({ grid })));
  });

  it('sends every store field the projection reads', () => {
    const variants: Variants<keyof ProjectedState, ProjectedState> = {
      background: (state) => ({ ...state, background: 'maps/other.png' }),
      grid: (state) => ({ ...state, grid: { ...GRID, size: 80 } }),
      objects: (state) => ({ ...state, objects: { ...state.objects, tokens: {} } }),
      widgetSettings: (state) => ({ ...state, widgetSettings: { ...state.widgetSettings, globalVisible: false } }),
      widgetValues: (state) => ({ ...state, widgetValues: { w1: 7 } }),
      initiative: (state) => ({ ...state, initiative: { ...state.initiative, round: 3 } }),
      initiativeTrackerOpen: (state) => ({ ...state, initiativeTrackerOpen: false }),
    };
    expectCoverage(SCENE_FIELD_COVERAGE, variants, sceneState(), project);
  });
});
```

- [ ] **Step 2: Write the failing type-level guard test**

Create `tests/unit/online/coverageGuard.test.ts`. It compiles a probe file that exists only in memory, so no file with a deliberate type error is ever on disk, where `tsc -p tests` would trip over it. Two parts of the probe must fail: a table typed over a text with a new field, and one over the objects with a new kind. The probe also holds a complete table, which must compile. That control catches a bad import path, which would also produce errors and let the test pass for the wrong reason.

```ts
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const PROBE = path.resolve(ROOT, 'tests/unit/online/__coverage_probe__.ts');
const PROBE_SOURCE = [
  "import { OBJECT_COVERAGE, TEXT_FIELD_COVERAGE, type Coverage } from '../../../src/app/online/coverage';",
  "import type { ViewAtlasState } from '../../../src/app/storeFactory';",
  "import type { TextElement } from '../../../src/app/types';",
  'export const complete: Record<keyof TextElement, Coverage> = TEXT_FIELD_COVERAGE;',
  'type GlowingText = TextElement & { glow: string };',
  'export const newField: Record<keyof GlowingText, Coverage> = TEXT_FIELD_COVERAGE;',
  "type MoreObjects = ViewAtlasState['objects'] & { portals: Record<string, unknown> };",
  'export const newKind: Record<keyof MoreObjects, Coverage> = OBJECT_COVERAGE;',
].join('\n');

interface Finding { line: number; code: number; message: string }

/** Type-checks the probe with the repository's compiler options; returns the probe's own diagnostics. */
function probeDiagnostics(): Finding[] {
  const config = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
  const host = ts.createCompilerHost(options, true);
  const isProbe = (fileName: string): boolean => path.resolve(fileName) === PROBE;
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (fileName) => isProbe(fileName) || fileExists(fileName);
  host.readFile = (fileName) => (isProbe(fileName) ? PROBE_SOURCE : readFile(fileName));
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => (isProbe(fileName)
    ? ts.createSourceFile(fileName, PROBE_SOURCE, languageVersion, true)
    : getSourceFile(fileName, languageVersion, onError, shouldCreate));
  const program = ts.createProgram([PROBE], { ...options, noEmit: true }, host);
  const file = program.getSourceFile(PROBE);
  if (!file) throw new Error('probe not compiled');
  return ts.getPreEmitDiagnostics(program, file).map((diagnostic) => ({
    line: file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line,
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }));
}

describe('coverage tables', () => {
  it('fail to compile until a new Atlas field or object kind is recorded', () => {
    const findings = probeDiagnostics();
    // Line 3 (the complete table) compiles; lines 5 and 7 each miss exactly the new key.
    expect(findings.map(({ line, code }) => ({ line, code }))).toEqual([{ line: 5, code: 2741 }, { line: 7, code: 2741 }]);
    expect(findings[0]?.message).toContain("'glow'");
    expect(findings[1]?.message).toContain("'portals'");
  }, 120_000);
});
```

- [ ] **Step 3: Write the failing shared layout tests**

Create `tests/unit/sharedLayout.test.ts`. Its values are the ones Atlas's renderers hard-code today, so moving them out of the renderers changes nothing.

```ts
import { describe, expect, it } from 'vitest';
import { MIN_HEX_NUMBER_SCREEN_SIZE } from '../../src/app/grid/hexNumbering';
import { SCENE_LAYER_ORDER, SCENE_LAYER_Z } from '../../src/app/pixi/sceneLayerOrder';
import { DEFAULT_TEXT_PADDING, textBackground, textFontStyle, textFontWeight, textRotation, textScale } from '../../src/app/pixi/textBoxLayout';
import { badgePositions, badgeSlots, CONDITION_BADGE, fitBadges } from '../../src/app/pixi/token-renderer/conditionBadgeLayout';
import { getTokenRingCenterRadius } from '../../src/app/pixi/token-renderer/tokenRingMetrics';
import { computeTokenPixelSize, computeTokenStrokeWidth, restingTokenUIScale } from '../../src/app/pixi/token-renderer/tokenSizing';
import { barFillRect, barInnerRect, barTickXs, nameplateRect, tokenBarRects } from '../../src/app/pixi/token-renderer/tokenUiLayout';

describe('scene layer order', () => {
  it('stacks map and grid at the bottom, then the zIndex layers in ascending order', () => {
    expect(SCENE_LAYER_ORDER).toEqual(['map', 'grid', 'tokens', 'texts', 'drawings', 'fog']);
    const zLayers = SCENE_LAYER_ORDER.filter((layer): layer is keyof typeof SCENE_LAYER_Z => layer in SCENE_LAYER_Z);
    expect(zLayers).toEqual(['tokens', 'texts', 'drawings', 'fog']);
    const z = zLayers.map((layer) => SCENE_LAYER_Z[layer]);
    expect(z).toEqual([...z].sort((a, b) => a - b));
  });
});

describe('token UI layout', () => {
  it('stacks the HP bar, then the stress bar, below the token', () => {
    expect(tokenBarRects(true, false)).toEqual({ hp: { x: -32, y: 2, width: 64, height: 10 }, stress: null });
    expect(tokenBarRects(true, true).stress).toEqual({ x: -32, y: 14, width: 64, height: 10 });
    expect(tokenBarRects(false, true).stress).toEqual({ x: -32, y: 2, width: 64, height: 10 });
  });

  it('insets the dark inside by half the border and the fill by one unit', () => {
    const inner = barInnerRect({ x: -32, y: 2, width: 64, height: 10 });
    expect(inner).toEqual({ x: -31.625, y: 2.375, width: 63.25, height: 9.25 });
    expect(barFillRect(inner)).toEqual({ x: -30.625, y: 3.375, width: 61.25, height: 7.25 });
    expect(barTickXs(inner)).toHaveLength(9);
    expect(barTickXs(inner)[0]).toBeCloseTo(-31.625 + 6.325);
  });

  it('sizes the nameplate to its text, at least 40 units wide, its bottom on the token edge', () => {
    expect(nameplateRect(48)).toEqual({ x: -20, y: -14, width: 40, height: 14, textY: -7 });
    expect(nameplateRect(300).width).toBeCloseTo(300 * 0.333 + 12);
  });
});

describe('condition badge layout', () => {
  const ringRadius = getTokenRingCenterRadius(computeTokenPixelSize(70, 1), computeTokenStrokeWidth(70), 1);
  const scale = restingTokenUIScale(70);

  it('fits three badges on a medium token, the last slot counting the rest', () => {
    expect(badgeSlots(ringRadius, scale)).toBe(3);
    expect(fitBadges(['a', 'b', 'c'], ringRadius, scale)).toEqual({ shown: ['a', 'b', 'c'], overflow: 0 });
    expect(fitBadges(['a', 'b', 'c', 'd', 'e'], ringRadius, scale)).toEqual({ shown: ['a', 'b'], overflow: 3 });
  });

  it('fans badges out around the upper left, the first nearest the top', () => {
    const [first, second] = badgePositions(2, ringRadius, scale);
    expect(Math.hypot(first!.x, first!.y)).toBeCloseTo(ringRadius);
    expect(first!.x).toBeLessThan(0);
    expect(first!.y).toBeLessThan(second!.y);
    expect(CONDITION_BADGE.radius).toBe(6);
  });
});

describe('text box layout', () => {
  it('grows a background by its padding, 8 when unset, at the text opacity', () => {
    const bounds = { x: -36, y: -14, width: 72, height: 28 };
    expect(textBackground({ backgroundColor: null }, bounds)).toBeNull();
    expect(textBackground({ backgroundColor: '#ffffff', padding: 0 }, bounds)).toEqual({
      x: -36 - DEFAULT_TEXT_PADDING, y: -22, width: 88, height: 44, color: '#ffffff', radius: 0, alpha: 1,
    });
    expect(textBackground({ backgroundColor: '#000000', padding: 4, borderRadius: 3, opacity: 0.5 }, bounds))
      .toMatchObject({ x: -40, width: 80, radius: 3, alpha: 0.5 });
  });

  it('reads weight, style, rotation and scale like the renderer', () => {
    expect([textFontWeight({ bold: true }), textFontWeight({})]).toEqual(['bold', 'normal']);
    expect([textFontStyle({ italic: true }), textFontStyle({ italic: null })]).toEqual(['italic', 'normal']);
    expect(textRotation(90)).toBeCloseTo(Math.PI / 2);
    expect([textRotation(undefined), textScale(0), textScale(2)]).toEqual([0, 1, 2]);
  });
});

describe('hex numbers', () => {
  it('hide below 7 CSS pixels on screen', () => {
    expect(MIN_HEX_NUMBER_SCREEN_SIZE).toBe(7);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/online/coverage.test.ts tests/unit/online/coverageGuard.test.ts tests/unit/sharedLayout.test.ts`
Expected: FAIL. `coverage.test.ts` and `sharedLayout.test.ts` cannot resolve `src/app/online/coverage`, `src/app/pixi/sceneLayerOrder` and the other new modules. In `coverageGuard.test.ts`, the probe's import of `coverage` fails, so the findings are `TS2307` errors and the expectation fails.

- [ ] **Step 5: Write `coverage.ts`**

Create `src/app/online/coverage.ts`:

```ts
/**
 * What online players receive of every Atlas map object and field. The tables are
 * records over Atlas's own types, so a new object kind or field fails the build
 * until it is recorded here (see `docs/online-play-features.md`).
 *
 * - `sent`: changes what players receive: the value itself, or what it decides
 *   (a hidden token never reaches players).
 * - `gm-only`: never changes what players receive; `reason` says why.
 * - `not-yet`: not sent yet; `piece` names the work expected to add it.
 *
 * `tests/unit/online/coverage.test.ts` checks every entry against the projection.
 */
import type { GridState } from '../services/MapPersistence';
import type { ViewAtlasState } from '../storeFactory';
import type { Character, DrawingStroke, TextElement, TokenEntity } from '../types';
import type { FogOperation } from '../types/fogTypes';
import type { ProjectedState } from './scene/projectForPlayers';

export type Coverage =
  | { readonly status: 'sent' }
  | { readonly status: 'gm-only'; readonly reason: string }
  | { readonly status: 'not-yet'; readonly piece: string };

export type CoverageTable<K extends PropertyKey> = Readonly<Record<K, Coverage>>;

/** Every key of every member of a union; `keyof` of a union keeps only the shared ones. */
export type KeysOfUnion<T> = T extends unknown ? keyof T : never;

const SENT: Coverage = { status: 'sent' };
const gmOnly = (reason: string): Coverage => ({ status: 'gm-only', reason });
const notYet = (piece: string): Coverage => ({ status: 'not-yet', piece });

const KIND = gmOnly('the record kind; players get each kind in its own list');
const WALLS_AND_LIGHTING = notYet('walls and lighting (behind WALLS_AND_LIGHTING_ENABLED)');
const MEASURING = notYet('measuring (a later piece)');
const BARS_ONLY = gmOnly('the player window shows only the HP and stress bars');
const LOCAL_PLAYER_LINK = gmOnly('links the token to a local player character, not to an online player');

export const OBJECT_COVERAGE: CoverageTable<keyof ViewAtlasState['objects']> = {
  tokens: SENT,
  fog: SENT,
  texts: SENT,
  drawings: SENT,
  pins: gmOnly('note pins link GM notes; the player window hides them'),
  walls: WALLS_AND_LIGHTING,
  lights: WALLS_AND_LIGHTING,
  audios: notYet('ambient audio (behind AMBIENT_AUDIO_ENABLED)'),
};

export const TOKEN_FIELD_COVERAGE: CoverageTable<keyof TokenEntity | keyof Character> = {
  id: SENT,
  kind: SENT,
  x: SENT,
  y: SENT,
  imagePath: SENT,
  size: SENT,
  rotation: SENT,
  layer: SENT,
  showRing: SENT,
  ringColor: SENT,
  conditions: SENT,
  conditionValues: SENT,
  isHidden: SENT,
  name: SENT,
  statblockPath: SENT,
  statblockName: SENT,
  hp: SENT,
  stress: SENT,
  maxStress: SENT,
  showNameplate: gmOnly('players see nameplates by the Show nameplates player view setting, as in the player window'),
  tags: gmOnly('tags organise the GM\'s tokens'),
  notePath: gmOnly('note links stay on the GM\'s machine'),
  difficulty: gmOnly('the statblock rating is shown to the GM only'),
  hope: BARS_ONLY,
  statblockResources: BARS_ONLY,
  maxHpOverridden: gmOnly('records that the GM set the maximum; the maximum itself is sent with the HP'),
  maxStressOverridden: gmOnly('records that the GM set the maximum; the maximum itself is sent with the stress'),
  playerLinked: LOCAL_PLAYER_LINK,
  playerId: LOCAL_PLAYER_LINK,
  playerCharacterId: LOCAL_PLAYER_LINK,
  hasVision: WALLS_AND_LIGHTING,
  visionInnerRadius: WALLS_AND_LIGHTING,
  visionOuterRadius: WALLS_AND_LIGHTING,
  instanceNumber: notYet('instance badges, with the scene\'s Show instance badges setting (a later piece)'),
};

export const TEXT_FIELD_COVERAGE: CoverageTable<keyof TextElement> = {
  id: SENT,
  kind: KIND,
  x: SENT,
  y: SENT,
  text: SENT,
  fontSize: SENT,
  fontFamily: SENT,
  color: SENT,
  backgroundColor: SENT,
  padding: SENT,
  borderRadius: SENT,
  opacity: SENT,
  width: SENT,
  height: SENT,
  align: SENT,
  bold: SENT,
  italic: SENT,
  rotation: SENT,
  scale: SENT,
};

export const DRAWING_FIELD_COVERAGE: CoverageTable<keyof DrawingStroke> = {
  id: SENT,
  kind: KIND,
  timestamp: SENT,
  type: SENT,
  points: SENT,
  color: SENT,
  width: SENT,
  opacity: SENT,
  icon: SENT,
};

export const FOG_FIELD_COVERAGE: CoverageTable<KeysOfUnion<FogOperation>> = {
  id: SENT,
  kind: KIND,
  timestamp: SENT,
  type: SENT,
  isErasing: SENT,
  offsetX: SENT,
  offsetY: SENT,
  points: SENT,
  brushRadius: SENT,
  x: SENT,
  y: SENT,
  width: SENT,
  height: SENT,
};

export const GRID_FIELD_COVERAGE: CoverageTable<keyof GridState> = {
  enabled: SENT,
  visible: SENT,
  type: SENT,
  size: SENT,
  offsetX: SENT,
  offsetY: SENT,
  color: SENT,
  opacity: SENT,
  lineType: SENT,
  lineWidth: SENT,
  hexNumbers: SENT,
  hexNumberOpacity: SENT,
  snapToGrid: gmOnly('how the GM\'s tokens move'),
  scale: gmOnly('used while aligning the grid to the map'),
  mapScale: gmOnly('used while aligning the grid to the map'),
  autoDetect: gmOnly('a one-time request to align the grid on the first load'),
  unitType: MEASURING,
  unitDistance: MEASURING,
  measurementType: MEASURING,
};

/** The store fields the projection reads (`sliceOf` in `sceneSources.ts` watches the same ones). */
export const SCENE_FIELD_COVERAGE: CoverageTable<keyof ProjectedState> = {
  background: SENT,
  grid: SENT,
  objects: SENT,
  widgetSettings: SENT,
  widgetValues: SENT,
  initiative: SENT,
  initiativeTrackerOpen: SENT,
};
```

- [ ] **Step 6: Write the shared layout modules**

Create `src/app/pixi/sceneLayerOrder.ts`:

```ts
/**
 * The order Atlas stacks a scene's layers in, bottom first. The map and the grid sit
 * at the bottom by child index (the map at 0, the grid just above it); the others by
 * `zIndex`. Shared with the online player view, which stacks its layers by the same
 * list, so the two cannot drift. No PIXI imports.
 */
export const SCENE_LAYER_ORDER = ['map', 'grid', 'tokens', 'texts', 'drawings', 'fog'] as const;
export type SceneLayer = typeof SCENE_LAYER_ORDER[number];

/** `zIndex` in the viewport of the layers placed by it. */
export const SCENE_LAYER_Z = {
  tokens: 0,
  texts: 500,
  /** Above tokens and texts, below fog so hidden areas stay hidden. */
  drawings: 900,
  fog: 1000,
} as const satisfies Partial<Record<SceneLayer, number>>;
```

Create `src/app/pixi/token-renderer/tokenUiLayout.ts`:

```ts
/**
 * Where a token's resource bars and nameplate sit, in UI units from the token's
 * bottom edge (the anchor `TokenUIRenderer` scales by the token UI scale), and
 * their colours. Shared by `TokenUIRenderer` and the online player view; no PIXI imports.
 */
import { barDimensions } from '../../styles/designTokens';

export interface UiRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Gap between the token's edge and the first bar. */
export const FIRST_BAR_GAP = 2;
/** The bars' thin outer stroke; their dark inside starts at its inner edge. */
export const BAR_BORDER = 0.75;
/** Tick marks every tenth of a bar. */
export const BAR_TICKS = 10;

export const BAR_STYLE = {
  border: 0x888888,
  inside: 0x1a1a1a,
  tick: 0x333333,
  tickAlpha: 0.5,
  tickWidth: 0.5,
  /** Darkens the HP bar of a token at 0 HP or less. */
  defeatedAlpha: 0.4,
} as const;

export const NAMEPLATE = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial',
  /** The text is set at this size and scaled by `textScale`, so it stays crisp when zoomed. */
  fontSize: 24,
  fontWeight: '600',
  textScale: 0.333,
  textAlpha: 0.85,
  padding: 6,
  minWidth: 40,
  height: 14,
} as const;

export const NAMEPLATE_STYLE = {
  dark: { fill: 0x2a2a2a, border: 0xffffff, borderAlpha: 0.4 },
  light: { fill: 0xe3e3e3, border: 0x000000, borderAlpha: 0.3 },
  borderWidth: 0.5,
  text: 0xffffff,
} as const;

export interface TokenBarsLayout {
  hp: UiRect | null;
  stress: UiRect | null;
}

/** The HP bar first, then the stress bar, each `barDimensions.token` sized and centred under the token. */
export function tokenBarRects(hasHp: boolean, hasStress: boolean): TokenBarsLayout {
  const { width, height, gap } = barDimensions.token;
  let top = FIRST_BAR_GAP;
  const next = (): UiRect => {
    const rect = { x: -width / 2, y: top, width, height };
    top += height + gap;
    return rect;
  };
  const hp = hasHp ? next() : null;
  const stress = hasStress ? next() : null;
  return { hp, stress };
}

/** A bar's dark inside, which starts at the inner edge of its border. */
export function barInnerRect(bar: UiRect): UiRect {
  const inset = BAR_BORDER / 2;
  return { x: bar.x + inset, y: bar.y + inset, width: bar.width - inset * 2, height: bar.height - inset * 2 };
}

/** A bar's fill sits 1 unit inside its dark background, so it looks contained. */
export function barFillRect(inner: UiRect): UiRect {
  const inset = 1;
  return { x: inner.x + inset, y: inner.y + inset, width: inner.width - inset * 2, height: inner.height - inset * 2 };
}

/** The x of each tick mark inside a bar. */
export function barTickXs(inner: UiRect): number[] {
  const spacing = inner.width / BAR_TICKS;
  return Array.from({ length: BAR_TICKS - 1 }, (_, index) => inner.x + spacing * (index + 1));
}

/**
 * The nameplate's badge for a name `textWidth` wide at `NAMEPLATE.fontSize`, centred,
 * its bottom edge on the token's bottom edge; `textY` is where the text's middle goes.
 */
export function nameplateRect(textWidth: number): UiRect & { textY: number } {
  const width = Math.max(textWidth * NAMEPLATE.textScale + NAMEPLATE.padding * 2, NAMEPLATE.minWidth);
  const textY = -NAMEPLATE.height / 2;
  return { x: -width / 2, y: textY - NAMEPLATE.height / 2, width, height: NAMEPLATE.height, textY };
}
```

Create `src/app/pixi/token-renderer/conditionBadgeLayout.ts`:

```ts
/**
 * Where condition badges sit on a token's ring, and their size. Shared by
 * `ConditionBadge`, `ConditionBadgeRing` and the online player view; no PIXI imports.
 */
export const CONDITION_BADGE = {
  /** Badge radius in UI units (a medium token is 62 wide). */
  radius: 6,
  /** Dark rim that separates the badge from any token art or map behind it. */
  bezelWidth: 1,
  bezelColor: 0x111114,
  /** Value pip radius as a share of the badge radius, and where its centre sits. */
  pipShare: 0.6,
  pipOffset: 0.72,
  pipColor: 0x1c1c22,
  /** The "+3" badge that counts the conditions that do not fit. */
  overflowColor: 0x3a3a42,
} as const;

/** The badges fan out around the token's upper left, clear of the instance number at the upper right. */
const ARC_CENTRE = -0.75 * Math.PI;
/** The quarter between the rotate handle at the top and the resize handle on the left. */
const ARC_SPAN = Math.PI / 2;
/** Badge diameter including its bezel, in UI units. */
const BADGE_DIAMETER = (CONDITION_BADGE.radius + CONDITION_BADGE.bezelWidth) * 2;
/** Distance between the centres of neighbouring badges, in UI units. */
const BADGE_PITCH = BADGE_DIAMETER + 1.5;
const MAX_SLOTS = 6;

function stepAngle(ringRadius: number, scale: number): number {
  return ringRadius > 0 ? (BADGE_PITCH * scale) / ringRadius : ARC_SPAN;
}

/**
 * How many badges fit between the handles on a ring `ringRadius` world units from the
 * token centre, with badges `scale` world units per UI unit; on medium tokens that is three.
 */
export function badgeSlots(ringRadius: number, scale: number): number {
  const step = stepAngle(ringRadius, scale);
  const badgeAngle = step * (BADGE_DIAMETER / BADGE_PITCH);
  return Math.max(1, Math.min(MAX_SLOTS, Math.floor((ARC_SPAN - badgeAngle) / step) + 1));
}

/** The items shown as badges; when more than fit, all but the last slot, which counts the rest (`overflow`). */
export function fitBadges<T>(items: readonly T[], ringRadius: number, scale: number): { shown: T[]; overflow: number } {
  const slots = badgeSlots(ringRadius, scale);
  if (items.length <= slots) return { shown: [...items], overflow: 0 };
  const shown = items.slice(0, slots - 1);
  return { shown, overflow: items.length - shown.length };
}

/** Badge centres relative to the token centre: the first nearest the top, the rest following down the token's left. */
export function badgePositions(count: number, ringRadius: number, scale: number): Array<{ x: number; y: number }> {
  const step = stepAngle(ringRadius, scale);
  const middle = (count - 1) / 2;
  return Array.from({ length: count }, (_, index) => {
    const angle = ARC_CENTRE + (middle - index) * step;
    return { x: Math.cos(angle) * ringRadius, y: Math.sin(angle) * ringRadius };
  });
}
```

Create `src/app/pixi/textBoxLayout.ts`:

```ts
/**
 * How Atlas lays out a map text, shared by `TextRenderer` and the online player view;
 * no PIXI imports. A text is centred on its position. A background, when set, is the
 * text's measured box grown by its padding (8 when unset or 0) and filled at the text's
 * opacity; the glyphs themselves stay opaque. Atlas sizes the box to the text: `width`
 * and `height` are not used for drawing.
 */
export const DEFAULT_TEXT_PADDING = 8;
/** Line spacing in font sizes for the player view; PIXI measures the font, which comes close to this for common fonts. */
export const TEXT_LINE_SPACING = 1.2;

export interface TextBoxSource {
  backgroundColor?: string | null | undefined;
  padding?: number | null | undefined;
  borderRadius?: number | null | undefined;
  opacity?: number | null | undefined;
}

/** The text's measured box around its centre. */
export interface TextBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextBackground extends TextBounds {
  color: string;
  /** 0 for square corners. */
  radius: number;
  alpha: number;
}

export function textBackground(text: TextBoxSource, bounds: TextBounds): TextBackground | null {
  if (!text.backgroundColor) return null;
  const padding = text.padding || DEFAULT_TEXT_PADDING;
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
    color: text.backgroundColor,
    radius: text.borderRadius || 0,
    alpha: text.opacity || 1,
  };
}

export function textFontWeight(text: { bold?: boolean | null | undefined }): 'bold' | 'normal' {
  return text.bold ? 'bold' : 'normal';
}

export function textFontStyle(text: { italic?: boolean | null | undefined }): 'italic' | 'normal' {
  return text.italic ? 'italic' : 'normal';
}

/** The text's rotation in radians; stored in degrees. */
export function textRotation(rotation: number | null | undefined): number {
  return rotation ? (rotation * Math.PI) / 180 : 0;
}

export function textScale(scale: number | null | undefined): number {
  return scale || 1;
}
```

In `src/app/grid/hexNumbering.ts`, add after `DEFAULT_HEX_NUMBER_OPACITY` (line 21):

```ts
/** Numbers smaller than this on screen (CSS pixels) are unreadable noise, so they hide until zoomed in. */
export const MIN_HEX_NUMBER_SCREEN_SIZE = 7;
```

In `src/app/grid/hexNumberLabels.ts`, delete lines 13–14 (the comment and `const MIN_SCREEN_FONT_SIZE = 7;`). Change line 2 to `import { hexNumberAnchor, hexNumberFontSize, MIN_HEX_NUMBER_SCREEN_SIZE } from './hexNumbering';`. In `isReadable` (line 95), replace `MIN_SCREEN_FONT_SIZE` with `MIN_HEX_NUMBER_SCREEN_SIZE`.

- [ ] **Step 7: Run the new tests to verify they pass**

Run: `npx vitest run tests/unit/online/coverage.test.ts tests/unit/online/coverageGuard.test.ts tests/unit/sharedLayout.test.ts`
Expected: PASS. The guard test takes 5–20 s while it builds the program.

- [ ] **Step 8: Make Atlas's renderers use the shared modules**

In `src/app/pixi/token-renderer/ConditionBadge.ts`, add `import { CONDITION_BADGE } from './conditionBadgeLayout';` after the existing imports. Then replace lines 15–25 (from `export const CONDITION_BADGE_RADIUS = 6;` through `const PIP_COLOR = 0x1c1c22;`) with:

```ts
/** Radius of a badge on the token's ring, in UI units (a medium token is 62 wide). */
export const CONDITION_BADGE_RADIUS = CONDITION_BADGE.radius;
/** Dark rim that separates the badge from any token art or map behind it. */
const BEZEL_WIDTH = CONDITION_BADGE.bezelWidth;
const BEZEL_COLOR = CONDITION_BADGE.bezelColor;
/** Glyph edge length as a share of the badge's diameter. */
const GLYPH_SHARE = 0.62;
const DARK_GLYPH_COLOR = 0x16161a;
/** Value pip radius as a share of the badge radius, and where its centre sits. */
const PIP_SHARE = CONDITION_BADGE.pipShare;
const PIP_OFFSET = CONDITION_BADGE.pipOffset;
const PIP_COLOR = CONDITION_BADGE.pipColor;
```

In `src/app/pixi/token-renderer/ConditionBadgeRing.ts`, make four changes:
1. Replace line 5 with `import { createConditionBadge, type ConditionBadgeSpec } from './ConditionBadge';`, and add `import { badgePositions, CONDITION_BADGE, fitBadges } from './conditionBadgeLayout';`.
2. Delete the constants `ARC_CENTRE`, `ARC_SPAN`, `BADGE_DIAMETER`, `BADGE_PITCH`, `MAX_SLOTS` and `OVERFLOW_COLOR` (lines 13–22), and keep `ENTRANCE_SCALE`.
3. Replace `fitToArc` and `layout` with:

   ```ts
     /** As many badges as fit between the handles; on medium tokens that is three. */
     private fitToArc(conditions: ActiveCondition[]): ConditionBadgeSpecWithId[] {
       const { shown, overflow } = fitBadges(conditions, this.ringRadius, this.scale);
       if (overflow === 0) return shown;
       return [...shown, { id: 'overflow', color: CONDITION_BADGE.overflowColor, glyph: { kind: 'text', text: `+${overflow}` } }];
     }
   ```

   ```ts
     /** First condition nearest the top, the rest following down the token's left. */
     private layout(): void {
       const positions = badgePositions(this.badges.length, this.ringRadius, this.scale);
       const progress = this.entrance.value;
       this.badges.forEach(({ view }, index) => {
         const position = positions[index];
         if (position) view.position.set(position.x, position.y);
         const isEntering = this.entering.has(view);
         view.alpha = isEntering ? progress : 1;
         view.scale.set(this.scale * (isEntering ? ENTRANCE_SCALE + (1 - ENTRANCE_SCALE) * progress : 1));
       });
     }
   ```

4. Delete the `stepAngle` method, which nothing uses any more.

In `src/app/pixi/TokenUIRenderer.ts`, make five changes:

1. **Imports.** Delete `insetFillRect` (lines 33–37). Add:

   ```ts
   import {
     BAR_BORDER, BAR_STYLE, barFillRect, barInnerRect, barTickXs, NAMEPLATE, NAMEPLATE_STYLE, nameplateRect, tokenBarRects,
     type UiRect,
   } from './token-renderer/tokenUiLayout';
   ```

2. **The nameplate text** (lines 153–163). Replace the `nameText` construction and its scale with:

   ```ts
       this.nameText = new Text({
         text: '',
         style: new TextStyle({
           fontFamily: NAMEPLATE.fontFamily,
           fontSize: NAMEPLATE.fontSize, // Base font size for 70px token
           fill: NAMEPLATE_STYLE.text,
           fontWeight: NAMEPLATE.fontWeight,
           // No stroke for cleaner look in the badge.
         })
       });
       this.nameText.scale.set(NAMEPLATE.textScale);
   ```

3. **The bars** (lines 387–486). Replace everything from `// Use design tokens for consistent sizing` through `this.stressText.position.set(0, currentY + barHeight/2);` and its closing `}` with:

   ```ts
       // Bars below the token, laid out in UI units by the layout the online player view shares
       const bars = tokenBarRects(hpValue !== null, stressResource !== null);

       if (hpValue && bars.hp) {
         const hpPercentage = Math.max(0, Math.min(100, (hpValue.current / hpValue.max) * 100));
         this.drawBarFrame(this.hpBar, bars.hp);
         this.hpFill.set(hpPercentage / 100, barFillRect(barInnerRect(bars.hp)), this.canAnimateValues());
         this.hpText.setValue(hpValue);
         this.hpText.position.set(0, bars.hp.y + bars.hp.height / 2);
         // Defeated overlay - just darken the HP bar, no X icon
         if (hpValue.current <= 0) {
           this.defeatedOverlay.roundRect(bars.hp.x, bars.hp.y, bars.hp.width, bars.hp.height, barDimensions.token.radius)
             .fill({ color: 0x000000, alpha: BAR_STYLE.defeatedAlpha });
         }
       }

       if (stressResource && bars.stress) {
         const stressPercentage = Math.max(0, Math.min(100, (stressResource.current / stressResource.max) * 100));
         this.drawBarFrame(this.stressBar, bars.stress);
         this.stressFill.set(stressPercentage / 100, barFillRect(barInnerRect(bars.stress)), this.canAnimateValues());
         this.stressText.setValue({ current: stressResource.current, max: stressResource.max });
         this.stressText.position.set(0, bars.stress.y + bars.stress.height / 2);
       }
   ```

4. **The nameplate badge** (lines 504–540). Inside `if (showNameplate && displayName) {`, replace the body with:

   ```ts
         const isDarkMode = document.body.classList.contains('theme-dark');
         const plate = isDarkMode ? NAMEPLATE_STYLE.dark : NAMEPLATE_STYLE.light;
         this.nameText.text = displayName;
         this.nameText.alpha = NAMEPLATE.textAlpha;
         // The badge's bottom edge sits on the token's bottom edge
         const badge = nameplateRect(this.nameText.getLocalBounds().width);
         this.nameBadge.clear();
         this.nameBadge.roundRect(badge.x, badge.y, badge.width, badge.height, badge.height / 2)
           .fill({ color: plate.fill, alpha: 1 }); // Fully opaque background
         // Add border — softened so it doesn't overpower the nameplate
         this.nameBadge.roundRect(badge.x, badge.y, badge.width, badge.height, badge.height / 2)
           .stroke({ width: NAMEPLATE_STYLE.borderWidth, color: plate.border, alpha: plate.borderAlpha });
         this.nameText.anchor.set(0.5, 0.5);
         this.nameText.position.set(0, badge.textY);
         this.nameText.scale.set(NAMEPLATE.textScale);
   ```

5. **The name editing badge** (lines 846–853). In `updateNameBadgeAndCursor`, replace the five lines from `const scaledTextScale = 0.333;` through `const badgeHeight = 14;` with the two lines below, and keep the rest of the function unchanged:

   ```ts
         const scaledTextScale = NAMEPLATE.textScale;
         const { width: badgeWidth, height: badgeHeight } = nameplateRect(textBounds.width);
   ```

Then add this method after `canAnimateValues()`:

```ts
  /** A bar's thin grey outline, its dark inside and a tick mark every tenth. */
  private drawBarFrame(graphics: Graphics, bar: UiRect): void {
    graphics.roundRect(bar.x, bar.y, bar.width, bar.height, bar.height / 2)
      .stroke({ width: BAR_BORDER, color: BAR_STYLE.border, alpha: 1 });
    const inner = barInnerRect(bar);
    graphics.roundRect(inner.x, inner.y, inner.width, inner.height, inner.height / 2)
      .fill({ color: BAR_STYLE.inside, alpha: 1 });
    for (const tickX of barTickXs(inner)) {
      graphics.moveTo(tickX, inner.y + 1);
      graphics.lineTo(tickX, inner.y + inner.height - 1);
      graphics.stroke({ width: BAR_STYLE.tickWidth, color: BAR_STYLE.tick, alpha: BAR_STYLE.tickAlpha });
    }
  }
```

Then check with `grep -n "insetFillRect\|currentY\|baseGap\|const padding = 6" src/app/pixi/TokenUIRenderer.ts`, which must print nothing. If `BarFillRect` is no longer referenced, remove it from the `AnimatedBarFill` import.

In `src/app/pixi/TextRenderer.ts`, first add `import { textBackground, textFontStyle, textFontWeight, textRotation, textScale } from './textBoxLayout';`. Then make three changes:

1. **The two text styles** (in `createText` and `updateText`). Use:

   ```ts
         fontWeight: textFontWeight(textElement),
         fontStyle: textFontStyle(textElement),
   ```

2. **The transforms.** In `createText`, replace the `if (textElement.rotation) …` and `if (textElement.scale) …` blocks, and in `updateText` its two transform lines, with:

   ```ts
       container.rotation = textRotation(textElement.rotation);
       container.scale.set(textScale(textElement.scale));
   ```

3. **The background.** Replace the body of `drawTextBackground` with:

   ```ts
       background.clear();
       const box = textBackground(textElement, text.getLocalBounds());
       if (!box) return;
       if (box.radius) background.roundRect(box.x, box.y, box.width, box.height, box.radius);
       else background.rect(box.x, box.y, box.width, box.height);
       background.fill({ color: parseInt(box.color.replace('#', ''), 16), alpha: box.alpha });
   ```

In `src/app/PixiRendererOrchestrator.ts`, add `import { SCENE_LAYER_Z } from './pixi/sceneLayerOrder';` with the other `./pixi/` imports, then replace these literals:
- `fogContainer.zIndex = 1000;` → `fogContainer.zIndex = SCENE_LAYER_Z.fog;`
- `drawingContainer.zIndex = 900;` → `drawingContainer.zIndex = SCENE_LAYER_Z.drawings;`
- both `textContainer.zIndex = 500;` → `textContainer.zIndex = SCENE_LAYER_Z.texts;`

In `src/app/pixi/TokenRenderer.ts`, add `import { SCENE_LAYER_Z } from './sceneLayerOrder';` and replace line 232, `this.tokenContainer.zIndex = 0;`, with `this.tokenContainer.zIndex = SCENE_LAYER_Z.tokens;`.

- [ ] **Step 9: Run Atlas's renderer tests and the new tests**

Run: `npx vitest run tests/unit/tokenResourceBars.test.ts tests/unit/conditionBadges.test.ts tests/unit/tokenUIRenderer.playerSettings.test.ts tests/unit/tokenNameplatePreference.test.ts tests/unit/tokenSizing.test.ts tests/unit/tokenUIScale.test.ts tests/unit/sharedLayout.test.ts tests/unit/online/coverage.test.ts tests/unit/online/coverageGuard.test.ts`
Expected: PASS, with no change to any existing test file.

Run: `npx vitest run tests/unit`
Expected: PASS. This covers the grid and text tests that touch `hexNumberLabels` and `TextRenderer`.

- [ ] **Step 10: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/online/coverage.ts src/app/pixi/sceneLayerOrder.ts src/app/pixi/textBoxLayout.ts src/app/pixi/token-renderer src/app/pixi/TokenUIRenderer.ts src/app/pixi/TextRenderer.ts src/app/pixi/TokenRenderer.ts src/app/PixiRendererOrchestrator.ts src/app/grid --max-warnings 0 --suppressions-location eslint.suppressions.json`
Expected: both exit 0.

- [ ] **Step 11: Commit**

```bash
git add src/app/online/coverage.ts src/app/pixi/sceneLayerOrder.ts src/app/pixi/textBoxLayout.ts src/app/pixi/token-renderer/tokenUiLayout.ts src/app/pixi/token-renderer/conditionBadgeLayout.ts src/app/pixi/token-renderer/ConditionBadge.ts src/app/pixi/token-renderer/ConditionBadgeRing.ts src/app/pixi/TokenUIRenderer.ts src/app/pixi/TextRenderer.ts src/app/pixi/TokenRenderer.ts src/app/PixiRendererOrchestrator.ts src/app/grid/hexNumbering.ts src/app/grid/hexNumberLabels.ts tests/unit/sharedLayout.test.ts tests/unit/online/coverage.test.ts tests/unit/online/coverageGuard.test.ts
git commit -m "refactor(online): coverage tables and shared token, text and layer layout"
```

---

### Task 2: The GM camera (`scene-camera`) and the diagnostics setting

The GM side sends the presented view's camera, and the player side keeps it. A developer setting logs every presented-scene event and every message sent to players.

Rulings used here:
- **2.** Read the viewport on `frame-end`, never the store camera.
- **3.** Hold: keep the last camera, and never read the viewport while the scene is held.
- **4.** Order: the player keeps the latest camera whatever its scene.
- **5.** Throttle with a trailing edge, and round cameras to 0.01.
- **14.** The log decorates the `SceneSession`.

**Files:**
- Create: `src/app/online/scene/sceneCamera.ts`
- Modify: `src/app/online/scene/sceneValidation.ts` (add `isSceneCamera`), `src/app/online/protocol.ts:5-8, 26-27, 47-62`
- Create: `src/app/services/presentedCamera.ts`
- Modify: `src/app/services/PresentedScene.ts:1-30, 99`
- Create: `src/app/online/scene/CameraSender.ts`
- Modify: `src/app/online/PlayerSession.ts:6-9, 37-47, 51-75, 108-145`
- Create: `src/app/online/onlineLog.ts`
- Modify: `src/app/online/onlineSettings.ts`, `src/app/settings/onlineSettingsSection.ts`, `src/app/online/OnlineSessionService.ts`
- Test: `tests/unit/online/sceneCamera.test.ts`, `tests/unit/online/cameraFixtures.ts`, `tests/unit/online/presentedCamera.test.ts`, `tests/unit/online/cameraSender.test.ts`, `tests/unit/online/onlineLog.test.ts`, `tests/unit/online/playerSessionScene.test.ts`, `tests/unit/online/onlineSettings.test.ts`, `tests/unit/online/onlineSessionService.test.ts`

**Interfaces:**
- Consumes:
  - `SceneSession`, `PresentedSceneSource` (`scene/sceneSources.ts`)
  - `SceneBroadcaster.currentProjection()` / `onProjection(listener)`
  - `SessionHandler`, `SessionPlayer` (`GmSession.ts`)
  - `isSceneId` and the private `isCoordinate` (`scene/sceneValidation.ts`)
  - `SCENE_RANGES.coordinate`, and `PresentedScene` / `PresentedView`
- Produces:
  - `sceneCamera.ts`: `interface SceneCamera { sceneId: string; centerX: number; centerY: number; width: number; height: number }`, `CAMERA_INTERVAL_MS = 100`, `roundedCamera(camera): SceneCamera`, `sameCamera(a, b): boolean`, `cameraOfMessage(message: SceneCamera): SceneCamera`.
  - `sceneValidation.ts`: `isSceneCamera(message: Record<string, unknown>): boolean`.
  - `protocol.ts`: `ControlMessage` gains `{ v: 1; type: 'scene-camera' } & SceneCamera`. An invalid one decodes as `{ kind: 'invalid', reason: 'bad-scene-camera' }`.
  - `presentedCamera.ts`: `interface CameraViewport` (structural pixi-viewport), `interface ViewCamera { centerX; centerY; width; height }`, `viewCamera(view: PresentedView): ViewCamera | null`, `watchViewCamera(view, listener): () => void`.
  - `PresentedScene.ts`: `PresentedSceneInfo.camera(): ViewCamera | null`, `PresentedSceneInfo.watchCamera(listener: () => void): () => void`. `PresentedView.renderer` gains the optional `getViewportInstance?(): CameraViewport | null`.
  - `CameraSender.ts`: `interface CameraProjection { currentProjection(); onProjection(listener) }`, `interface CameraSenderOptions { session: SceneSession; presented: PresentedSceneSource; projection: CameraProjection }`, `class CameraSender implements SessionHandler { start(); stop(); onAdmitted(player); onMessage(player, message) }`.
  - `PlayerSession.ts`: `PlayerSessionOptions.onCamera?(camera: SceneCamera): void`, `get camera(): SceneCamera | null`.
  - `onlineLog.ts`:
    - Types: `type LogDetails = Record<string, string | number | boolean | null>`, `type LogWriter`, `interface OnlineLog { isEnabled(): boolean; event(name, details?): void }`.
    - Functions: `createOnlineLog(isEnabled, write?): OnlineLog`, `callerStack(): string`, `loggedSession(session: SceneSession, log): SceneSession`, `logPresentedScene(presented: PresentedSceneSource, log): () => void`.
  - `onlineSettings.ts`: `OnlineSettings.logEvents: boolean` (default `false`).
  - Test fixtures (`cameraFixtures.ts`): `class FakeViewport implements CameraViewport { center; worldScreenWidth; worldScreenHeight; destroyed; frame(); moveTo(x, y); listenerCount }`, `emptySceneState(isMapLoading?)`, `viewWithViewport(viewport, state?)` returning `{ view, store, tabs, tavern, dungeon }`.

- [ ] **Step 1: Write the failing message tests**

Create `tests/unit/online/sceneCamera.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { cameraOfMessage, roundedCamera, sameCamera, type SceneCamera } from '../../../src/app/online/scene/sceneCamera';

const camera = (overrides: Partial<SceneCamera> = {}): SceneCamera => ({
  sceneId: 'scene-1', centerX: 500, centerY: 400, width: 800, height: 600, ...overrides,
});
const raw = (overrides: Record<string, unknown> = {}): string => JSON.stringify({ v: 1, type: 'scene-camera', ...camera(), ...overrides });

describe('scene-camera messages', () => {
  it('round-trips a camera', () => {
    const message: ControlMessage = { v: 1, type: 'scene-camera', ...camera() };
    expect(decodeControl(encodeControl(message))).toEqual({ kind: 'message', message });
  });

  it('accepts negative centres and the edges of the coordinate range', () => {
    for (const fields of [{ centerX: -10_000_000 }, { centerY: 10_000_000 }, { width: 10_000_000, height: 0.01 }]) {
      expect(decodeControl(raw(fields)).kind).toBe('message');
    }
  });

  it('refuses a camera out of range, without a positive size, or with a bad scene id', () => {
    const bad = [
      { width: 0 }, { height: -5 }, { width: 10_000_001 }, { centerX: 1e8 }, { centerY: 'x' }, { centerX: null },
      { sceneId: '' }, { sceneId: '__proto__' }, { sceneId: 5 }, { height: undefined },
    ];
    for (const fields of bad) expect(decodeControl(raw(fields)), JSON.stringify(fields)).toEqual({ kind: 'invalid', reason: 'bad-scene-camera' });
  });

  it('keeps only the camera fields of a message', () => {
    expect(cameraOfMessage({ ...camera(), extra: 'x' } as SceneCamera)).toEqual(camera());
  });

  it('rounds to hundredths of a world unit and compares by value', () => {
    const rounded = roundedCamera(camera({ centerX: 500.123, centerY: 399.996, width: 800.006, height: 0.001 }));
    expect(rounded).toEqual(camera({ centerX: 500.12, centerY: 400, width: 800.01, height: 0.01 }));
    expect(sameCamera(rounded, { ...rounded })).toBe(true);
    expect(sameCamera(rounded, { ...rounded, sceneId: 'scene-2' })).toBe(false);
    expect(sameCamera(null, null)).toBe(true);
    expect(sameCamera(rounded, null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/online/sceneCamera.test.ts`
Expected: FAIL. The import of `src/app/online/scene/sceneCamera` cannot be resolved.

- [ ] **Step 3: Add the message**

Create `src/app/online/scene/sceneCamera.ts`:

```ts
/**
 * The GM's working view of the presented scene, as players receive it in
 * `scene-camera`: the visible world area's centre and size, in world units. It
 * carries no `seq`: it is the latest camera, not part of the scene. Shared with
 * the web player page, so this file imports nothing.
 */
export interface SceneCamera {
  sceneId: string;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

/** The GM camera is sent at most this often. */
export const CAMERA_INTERVAL_MS = 100;

const MIN_EXTENT = 0.01;
const hundredths = (value: number): number => Math.round(value * 100) / 100;

/** Rounded to hundredths of a world unit: finer moves are invisible and would only cost messages. */
export function roundedCamera(camera: SceneCamera): SceneCamera {
  return {
    sceneId: camera.sceneId,
    centerX: hundredths(camera.centerX),
    centerY: hundredths(camera.centerY),
    width: Math.max(MIN_EXTENT, hundredths(camera.width)),
    height: Math.max(MIN_EXTENT, hundredths(camera.height)),
  };
}

export function sameCamera(a: SceneCamera | null, b: SceneCamera | null): boolean {
  if (a === null || b === null) return a === b;
  return a.sceneId === b.sceneId && a.centerX === b.centerX && a.centerY === b.centerY
    && a.width === b.width && a.height === b.height;
}

/** The camera of a validated message, its named fields only: network data may carry more. */
export function cameraOfMessage(message: SceneCamera): SceneCamera {
  return {
    sceneId: message.sceneId, centerX: message.centerX, centerY: message.centerY, width: message.width, height: message.height,
  };
}
```

In `src/app/online/scene/sceneValidation.ts`, add after `isSceneCount`:

```ts
/** A `scene-camera`: a centre within the coordinate range and a positive size within it. */
export function isSceneCamera(message: Fields): boolean {
  const isExtent = (value: unknown): boolean => isCoordinate(value) && value > 0;
  return isSceneId(message.sceneId) && isCoordinate(message.centerX) && isCoordinate(message.centerY)
    && isExtent(message.width) && isExtent(message.height);
}
```

In `src/app/online/protocol.ts`, make three changes:
1. Add `import type { SceneCamera } from './scene/sceneCamera';` and add `isSceneCamera` to the `./scene/sceneValidation` import.
2. Add this union member after `| { v: 1; type: 'scene-resync'; seq: number }`, moving the `;` that ends the union to it:

   ```ts
     | ({ v: 1; type: 'scene-camera' } & SceneCamera);
   ```

3. Add this validator after `'scene-resync': …`:

   ```ts
     'scene-camera': (m) => isSceneCamera(m),
   ```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run tests/unit/online/sceneCamera.test.ts tests/unit/online/protocol.test.ts tests/unit/online/sceneProtocol.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing camera source and sender tests**

Create `tests/unit/online/cameraFixtures.ts`:

```ts
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { CameraViewport } from '../../../src/app/services/presentedCamera';
import type { PresentedView } from '../../../src/app/services/PresentedScene';
import type { ViewAtlasState } from '../../../src/app/storeFactory';
import { createTabMetaStore } from '../../../src/app/stores/tabMetaStore';
import { createDefaultInitiativeState } from '../../../src/app/types/initiativeTypes';

/** Just enough of pixi-viewport's `Viewport` for the GM camera. */
export class FakeViewport implements CameraViewport {
  center = { x: 500, y: 400 };
  worldScreenWidth = 800;
  worldScreenHeight = 600;
  destroyed = false;
  private readonly listeners = new Set<() => void>();

  on(_event: 'frame-end', listener: () => void): this {
    this.listeners.add(listener);
    return this;
  }

  off(_event: 'frame-end', listener: () => void): this {
    this.listeners.delete(listener);
    return this;
  }

  /** One rendered frame: pixi-viewport emits `frame-end` on every tick. */
  frame(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** Pans to (x, y), then renders a frame. */
  moveTo(x: number, y: number): void {
    this.center = { x, y };
    this.frame();
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

export type CameraSceneState = Pick<ViewAtlasState,
  'background' | 'grid' | 'objects' | 'widgetSettings' | 'widgetValues' | 'initiative' | 'initiativeTrackerOpen' | 'isMapLoading'
>;

export function emptySceneState(isMapLoading = false): CameraSceneState {
  return {
    background: 'maps/tavern.png',
    grid: { enabled: true, visible: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5 },
    objects: { tokens: {}, fog: {}, pins: {}, texts: {}, drawings: {}, walls: {}, lights: {}, audios: {} },
    widgetSettings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 },
    widgetValues: {},
    initiative: createDefaultInitiativeState(),
    initiativeTrackerOpen: false,
    isMapLoading,
  };
}

/** A view with two scene tabs (Tavern active) whose renderer has `viewport`. */
export function viewWithViewport(viewport: FakeViewport | null, state: CameraSceneState = emptySceneState()): {
  view: PresentedView; store: StoreApi<CameraSceneState>; tabs: ReturnType<typeof createTabMetaStore>; tavern: string; dungeon: string;
} {
  const tabs = createTabMetaStore();
  const store = createStore<CameraSceneState>(() => state);
  const tavern = tabs.getState().addTab('maps/tavern.atlasmap', 'Tavern');
  const dungeon = tabs.getState().addTab('maps/dungeon.atlasmap', 'Dungeon');
  tabs.getState().setActiveTab(tavern);
  const view = {
    tabMetaStore: tabs,
    atlasStore: store as unknown as StoreApi<ViewAtlasState>,
    register: () => {},
    renderer: { getBackgroundSprite: () => ({ width: 2000, height: 1500, destroyed: false }), getViewportInstance: () => viewport },
  } as unknown as PresentedView;
  return { view, store, tabs, tavern, dungeon };
}
```

Create `tests/unit/online/presentedCamera.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { viewCamera, watchViewCamera } from '../../../src/app/services/presentedCamera';
import { PresentedScene, type PresentedView } from '../../../src/app/services/PresentedScene';
import { FakeViewport, viewWithViewport } from './cameraFixtures';

describe('presented camera', () => {
  it("reads the centre and visible world size of the view's viewport", () => {
    expect(viewCamera(viewWithViewport(new FakeViewport()).view)).toEqual({ centerX: 500, centerY: 400, width: 800, height: 600 });
  });

  it('has no camera without a renderer, a viewport, a live viewport or a size', () => {
    expect(viewCamera(viewWithViewport(null).view)).toBeNull();
    const destroyed = new FakeViewport();
    destroyed.destroyed = true;
    expect(viewCamera(viewWithViewport(destroyed).view)).toBeNull();
    const empty = new FakeViewport();
    empty.worldScreenWidth = 0;
    expect(viewCamera(viewWithViewport(empty).view)).toBeNull();
    expect(viewCamera({ ...viewWithViewport(null).view, renderer: null } as PresentedView)).toBeNull();
  });

  it('calls back after every viewport frame until unwatched', () => {
    const viewport = new FakeViewport();
    const calls: number[] = [];
    const stop = watchViewCamera(viewWithViewport(viewport).view, () => calls.push(1));
    viewport.frame();
    viewport.frame();
    stop();
    viewport.frame();
    expect(calls).toHaveLength(2);
    expect(viewport.listenerCount).toBe(0);
  });

  it("gives the presented scene its view's camera", () => {
    const viewport = new FakeViewport();
    const { view, tavern } = viewWithViewport(viewport);
    const presented = new PresentedScene();
    presented.present(view, tavern);
    viewport.moveTo(10, 20);
    expect(presented.current()?.camera()).toEqual({ centerX: 10, centerY: 20, width: 800, height: 600 });
  });
});
```

Create `tests/unit/online/cameraSender.test.ts`. It runs end to end over `MemoryTransport`: a real `GmSession`, `SceneBroadcaster`, `CameraSender` and `PresentedScene`, and real `PlayerSession`s whose received control messages are logged with their time.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession } from '../../../src/app/online/PlayerSession';
import { decodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { AssetRegistry } from '../../../src/app/online/scene/AssetRegistry';
import { CameraSender } from '../../../src/app/online/scene/CameraSender';
import { CAMERA_INTERVAL_MS, type SceneCamera } from '../../../src/app/online/scene/sceneCamera';
import { SceneBroadcaster } from '../../../src/app/online/scene/SceneBroadcaster';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';
import type { ClientTransport, PeerLink } from '../../../src/app/online/transport/types';
import { PresentedScene } from '../../../src/app/services/PresentedScene';
import { memoryImageFiles, nodeHash } from './assetFixtures';
import { emptySceneState, FakeViewport, viewWithViewport, type CameraSceneState } from './cameraFixtures';

interface Received { message: ControlMessage; at: number }
type TimedCamera = SceneCamera & { at: number };

function world(state: CameraSceneState = emptySceneState()) {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const gm = new GmSession(network.host('gm'), {
    title: 'Vault', onJoinRequest: (p) => requests.push(p), onRequestClosed: () => {}, onPlayersChanged: () => {},
  });
  gm.start();
  const rules: PlayerViewRules = {
    showGrid: true, showTokenHP: false, showTokenStress: false, showTokenNameplates: false, showWidgets: true, showInitiative: true,
  };
  const settings = { getLocalPlayerViewSettings: (): PlayerViewRules => rules, onChange: (): (() => void) => () => {} };
  const presented = new PresentedScene();
  const assets = new AssetRegistry({ files: memoryImageFiles().source, notify: () => {}, hash: nodeHash });
  const broadcaster = new SceneBroadcaster({ session: gm, presented, settings, assets, notify: () => {} });
  const sender = new CameraSender({ session: gm, presented, projection: broadcaster });
  broadcaster.start();
  sender.start();
  const viewport = new FakeViewport();
  const scene = viewWithViewport(viewport, state);
  const received = new Map<string, Received[]>();

  const join = async (key: string): Promise<PlayerSession> => {
    const before = requests.length;
    const inner = network.client();
    const log: Received[] = [];
    received.set(key, log);
    const transport: ClientTransport = {
      connect: async (hostId: string): Promise<PeerLink> => {
        const link = await inner.connect(hostId);
        link.onMessage((channel, data) => {
          const decoded = channel === 'control' ? decodeControl(data) : null;
          if (decoded?.kind === 'message') log.push({ message: decoded.message, at: Date.now() });
        });
        return link;
      },
    };
    const player = new PlayerSession({ hostId: 'gm', name: key, playerKey: key, clientVersion: '1', transport, onChange: () => {} });
    player.start();
    await vi.advanceTimersByTimeAsync(0);
    if (requests.length > before) gm.allow(requests.at(-1)!.playerId);
    await vi.advanceTimersByTimeAsync(0);
    return player;
  };
  /** The scene messages a player received, by type, in order. */
  const sceneTypes = (key: string): string[] =>
    (received.get(key) ?? []).map(({ message }) => message.type).filter((type) => type.startsWith('scene-'));
  const cameras = (key: string): TimedCamera[] => (received.get(key) ?? []).flatMap(({ message, at }) => (message.type === 'scene-camera'
    ? [{ sceneId: message.sceneId, centerX: message.centerX, centerY: message.centerY, width: message.width, height: message.height, at }]
    : []));
  const sceneId = (): string | null => broadcaster.currentProjection()?.sceneId ?? null;
  return { gm, presented, sender, viewport, ...scene, join, sceneTypes, cameras, sceneId };
}

const untimed = ({ at: _at, ...camera }: TimedCamera): SceneCamera => camera;

describe('CameraSender', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends the GM camera after the snapshot when a scene is presented', async () => {
    const w = world();
    const anna = await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.sceneTypes('anna')).toEqual(['scene-clear', 'scene-snapshot', 'scene-camera']);
    expect(anna.camera).toEqual({ sceneId: w.sceneId(), centerX: 500, centerY: 400, width: 800, height: 600 });
  });

  it('sends nothing while the view does not move', async () => {
    const w = world();
    await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    for (let frame = 0; frame < 5; frame++) {
      w.viewport.frame();
      await vi.advanceTimersByTimeAsync(16);
    }
    expect(w.cameras('anna')).toHaveLength(1);
  });

  it('sends at most every 100 ms, and the final position after a continuous pan', async () => {
    const w = world();
    await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    for (let step = 1; step <= 10; step++) {
      w.viewport.moveTo(500 + step * 10, 400);
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    const pan = w.cameras('anna').slice(1);
    expect(pan.length).toBeGreaterThanOrEqual(2);
    expect(pan.length).toBeLessThanOrEqual(3);
    expect(pan.at(-1)?.centerX).toBe(600);
    const gaps = pan.slice(1).map((camera, index) => camera.at - pan[index]!.at);
    expect(gaps.every((gap) => gap >= CAMERA_INTERVAL_MS)).toBe(true);
  });

  it('sends nothing while the GM browses another tab, and the camera once on return', async () => {
    const w = world();
    await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    w.tabs.getState().setActiveTab(w.dungeon);
    await vi.advanceTimersByTimeAsync(0);
    w.viewport.moveTo(9000, 9000);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS * 3);
    expect(w.cameras('anna')).toHaveLength(1);
    // Back on the presented tab, Atlas restores that tab's view before players see it again.
    w.viewport.center = { x: 520, y: 410 };
    const before = w.sceneTypes('anna').length;
    w.tabs.getState().setActiveTab(w.tavern);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.sceneTypes('anna').slice(before)).toEqual(['scene-snapshot', 'scene-camera']);
    expect(w.cameras('anna').at(-1)).toMatchObject({ centerX: 520, centerY: 410 });
  });

  it('sends the camera of a presentation made while the map loads once it has loaded', async () => {
    const w = world(emptySceneState(true));
    await w.join('anna');
    w.presented.present(w.view, w.tavern);
    w.viewport.moveTo(600, 400);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    expect(w.sceneTypes('anna')).toEqual(['scene-clear']);
    w.store.setState({ isMapLoading: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(w.sceneTypes('anna')).toEqual(['scene-clear', 'scene-snapshot', 'scene-camera']);
    expect(w.cameras('anna')[0]).toMatchObject({ sceneId: w.sceneId(), centerX: 600 });
  });

  it('sends the camera with the snapshot of a player who joins, also while the scene is held', async () => {
    const w = world();
    await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    const bea = await w.join('bea');
    expect(w.sceneTypes('bea')).toEqual(['scene-snapshot', 'scene-camera']);
    expect(bea.camera).toEqual(untimed(w.cameras('anna').at(-1)!));
    w.tabs.getState().setActiveTab(w.dungeon);
    await vi.advanceTimersByTimeAsync(0);
    w.viewport.moveTo(9000, 9000);
    const cleo = await w.join('cleo');
    expect(w.sceneTypes('cleo')).toEqual(['scene-snapshot', 'scene-camera']);
    expect(cleo.camera).toEqual(bea.camera);
  });

  it('sends the camera again to a player who asks for a snapshot', async () => {
    const w = world();
    await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    w.sender.onMessage(w.gm.getPlayers()[0]!, { v: 1, type: 'scene-resync', seq: 0 });
    expect(w.cameras('anna')).toHaveLength(2);
  });

  it("sends no camera once presenting stops, and the new scene's after presenting again", async () => {
    const w = world();
    await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    const first = w.sceneId();
    w.presented.clear();
    w.viewport.moveTo(700, 400);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    expect(w.cameras('anna')).toHaveLength(1);
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(0);
    const cameras = w.cameras('anna');
    expect(cameras).toHaveLength(2);
    expect(cameras[1]?.sceneId).not.toBe(first);
    expect(cameras[1]?.sceneId).toBe(w.sceneId());
  });

  it('stops watching the view when stopped', () => {
    const w = world();
    w.presented.present(w.view, w.tavern);
    expect(w.viewport.listenerCount).toBe(1);
    w.sender.stop();
    expect(w.viewport.listenerCount).toBe(0);
  });
});
```

In `tests/unit/online/playerSessionScene.test.ts`, add these two tests inside `describe('PlayerSession scenes', …)`:

```ts
  it('keeps the GM camera, whatever its scene', async () => {
    const { gm, player, playerId } = await admittedPlayer();
    gm.send(playerId, { v: 1, type: 'scene-camera', sceneId: 'later', centerX: 1, centerY: 2, width: 3, height: 4 });
    expect(player.camera).toEqual({ sceneId: 'later', centerX: 1, centerY: 2, width: 3, height: 4 });
  });

  it('skips an invalid camera without asking for a snapshot', async () => {
    const { gm, player, playerId, fromPlayer } = await admittedPlayer();
    gm.send(playerId, { v: 1, type: 'scene-camera', sceneId: 's', centerX: 0, centerY: 0, width: 0, height: 4 });
    expect(player.camera).toBeNull();
    expect(fromPlayer).toEqual([]);
  });
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run tests/unit/online/presentedCamera.test.ts tests/unit/online/cameraSender.test.ts tests/unit/online/playerSessionScene.test.ts`
Expected: FAIL. `presentedCamera` and `CameraSender` cannot be resolved, and `player.camera` is `undefined`.

- [ ] **Step 7: Read the presented view's camera**

Create `src/app/services/presentedCamera.ts`:

```ts
/**
 * The GM's working view of a presented scene: the centre and visible world size of the
 * view's map viewport. pixi-viewport emits `frame-end` on every tick, so watching it
 * sees gestures, programmatic moves and resizes alike (`ViewAtlasState.camera` is never
 * written, so it cannot be used). No PIXI imports: the viewport is described by what is read.
 */
import type { PresentedView } from './PresentedScene';

/** What the camera needs of pixi-viewport's `Viewport`. */
export interface CameraViewport {
  readonly center: { readonly x: number; readonly y: number };
  readonly worldScreenWidth: number;
  readonly worldScreenHeight: number;
  readonly destroyed: boolean;
  on(event: 'frame-end', listener: () => void): unknown;
  off(event: 'frame-end', listener: () => void): unknown;
}

/** The visible world area: its centre and size in world units. */
export interface ViewCamera {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

function liveViewport(view: PresentedView): CameraViewport | null {
  const viewport = view.renderer?.getViewportInstance?.() ?? null;
  return viewport && !viewport.destroyed ? viewport : null;
}

/** The view's camera now; null without a live viewport or while it has no size. */
export function viewCamera(view: PresentedView): ViewCamera | null {
  const viewport = liveViewport(view);
  if (!viewport) return null;
  const width = viewport.worldScreenWidth;
  const height = viewport.worldScreenHeight;
  if (!(width > 0) || !(height > 0)) return null;
  return { centerX: viewport.center.x, centerY: viewport.center.y, width, height };
}

/** Calls `listener` after every frame of the view's viewport; a no-op without one. */
export function watchViewCamera(view: PresentedView, listener: () => void): () => void {
  const viewport = liveViewport(view);
  if (!viewport) return () => {};
  viewport.on('frame-end', listener);
  return () => {
    if (!viewport.destroyed) viewport.off('frame-end', listener);
  };
}
```

In `src/app/services/PresentedScene.ts`, make three changes:

1. **The import.** Add:

   ```ts
   import { viewCamera, watchViewCamera, type CameraViewport, type ViewCamera } from './presentedCamera';
   ```

2. **The types.** In `PresentedView`, replace the `renderer` line with:

   ```ts
     readonly renderer?: { getBackgroundSprite(): BackgroundSprite | null; getViewportInstance?(): CameraViewport | null } | null;
   ```

   In `PresentedSceneInfo`, add after `mapSize(): MapSize;`:

   ```ts
     /** The GM's working view of the scene now: the viewport's centre and visible world size; null without one. */
     camera(): ViewCamera | null;
     /** Calls `listener` after every frame of the view's viewport; returns the unsubscribe. */
     watchCamera(listener: () => void): () => void;
   ```

3. **`present`.** Replace line 99 (`const scene: PresentedSceneInfo = { … };`) with:

   ```ts
       const scene: PresentedSceneInfo = {
         view, tabId, store: view.atlasStore,
         mapSize: () => loadedMapSize(view),
         camera: () => viewCamera(view),
         watchCamera: (listener) => watchViewCamera(view, listener),
       };
   ```

`AtlasView.renderer` returns `PixiRendererOrchestrator | null`. Its `getViewportInstance(): Viewport | null` satisfies `CameraViewport` structurally: a scratch `tsc` of `const c: CameraViewport = viewport` and of `const r: PresentedView['renderer'] = orchestrator` compiled without errors while this plan was written.

- [ ] **Step 8: Send the camera**

Create `src/app/online/scene/CameraSender.ts`:

```ts
/**
 * Sends the GM's working view of the presented scene to admitted players as
 * `scene-camera`. While the scene is live it is sent at most every 100 ms and only
 * when it changed, the last change always included. Nothing is sent while the
 * scene is held, since the view then shows another map. The last camera sent goes
 * once more to everyone when the scene is presented or resumed, and to a player who
 * gets a snapshot (admission, resync), also while held. A second `GmSession`
 * handler beside `SceneBroadcaster`, registered after it, so its messages follow the
 * broadcaster's snapshots.
 */
import type { PresentedSceneInfo } from '../../services/PresentedScene';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { CAMERA_INTERVAL_MS, roundedCamera, sameCamera, type SceneCamera } from './sceneCamera';
import type { PresentedSceneSource, SceneSession } from './sceneSources';
import type { PlayerScene } from './sceneTypes';

/** What the sender needs of the broadcaster: the scene players have, and when that changes. */
export interface CameraProjection {
  currentProjection(): PlayerScene | null;
  onProjection(listener: (scene: PlayerScene | null) => void): () => void;
}

export interface CameraSenderOptions {
  session: SceneSession;
  presented: PresentedSceneSource;
  projection: CameraProjection;
}

export class CameraSender implements SessionHandler {
  private readonly stops: Array<() => void> = [];
  /** The live (not held) presentation whose view is followed. */
  private live: PresentedSceneInfo | null = null;
  private stopWatching: (() => void) | null = null;
  /** Players are about to see the scene (presented, resumed, back after a clear): the camera follows its projection. */
  private announce = false;
  /** The last camera sent; kept while the scene is held, forgotten when it is cleared. */
  private sent: SceneCamera | null = null;
  private cooldown: number | null = null;
  /** The view moved during the cooldown: send once it is over. */
  private dirty = false;

  constructor(private readonly options: CameraSenderOptions) {}

  start(): void {
    const { session, presented, projection } = this.options;
    this.stops.push(
      session.use(this),
      presented.subscribe({
        presented: (scene) => this.follow(scene),
        held: () => this.unfollow(),
        cleared: () => {
          this.unfollow();
          this.sent = null;
        },
      }),
      projection.onProjection((scene) => this.projected(scene)),
    );
    const current = presented.current();
    if (current && !presented.isHeld()) this.follow(current);
  }

  stop(): void {
    this.unfollow();
    this.stops.splice(0).forEach((stop) => stop());
  }

  /** Runs after the broadcaster's snapshot to this player, since the broadcaster was registered first. */
  onAdmitted(player: SessionPlayer): void {
    this.resend(player.playerId);
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type === 'scene-resync') this.resend(player.playerId);
  }

  private follow(scene: PresentedSceneInfo): void {
    this.unfollow();
    this.live = scene;
    this.announce = true;
    this.stopWatching = scene.watchCamera(() => this.viewMoved());
    // The broadcaster projected already, unless the map is still loading: then its snapshot after loading announces.
    if (!scene.store.getState().isMapLoading) this.projected(this.options.projection.currentProjection());
  }

  private unfollow(): void {
    this.stopWatching?.();
    this.stopWatching = null;
    this.live = null;
    this.announce = false;
    this.dirty = false;
    this.cancelCooldown();
  }

  private projected(scene: PlayerScene | null): void {
    if (!scene) {
      // Players got a clear: the camera goes again with the next scene.
      this.announce = this.live !== null;
      return;
    }
    const live = this.live;
    if (!live || !this.announce) return;
    this.announce = false;
    // The broadcaster tells its listeners just before it sends the snapshot: send right after it.
    void Promise.resolve().then(() => {
      if (this.live === live) this.send(true);
    });
  }

  /** Called on every frame of the view: send now, or once the interval is over. */
  private viewMoved(): void {
    if (this.cooldown !== null) {
      this.dirty = true;
      return;
    }
    this.send(false);
  }

  private send(force: boolean): void {
    const camera = this.currentCamera();
    if (!camera || (!force && sameCamera(camera, this.sent))) return;
    this.sent = camera;
    for (const player of this.options.session.getPlayers()) {
      if (player.status === 'admitted') this.options.session.send(player.playerId, { v: 1, type: 'scene-camera', ...camera });
    }
    this.cancelCooldown();
    this.cooldown = window.setTimeout(() => {
      this.cooldown = null;
      if (!this.dirty) return;
      this.dirty = false;
      this.send(false);
    }, CAMERA_INTERVAL_MS);
  }

  private cancelCooldown(): void {
    if (this.cooldown !== null) window.clearTimeout(this.cooldown);
    this.cooldown = null;
  }

  /** The view's camera for the scene players have; null while held, before the scene is projected, or without a viewport. */
  private currentCamera(): SceneCamera | null {
    const scene = this.options.projection.currentProjection();
    if (!this.live || this.announce || !scene) return null;
    const view = this.live.camera();
    return view ? roundedCamera({ sceneId: scene.sceneId, ...view }) : null;
  }

  /** The last camera, to a player who just got a snapshot of the same scene. */
  private resend(playerId: string): void {
    const scene = this.options.projection.currentProjection();
    const camera = this.sent;
    if (!scene || !camera || camera.sceneId !== scene.sceneId) return;
    this.options.session.send(playerId, { v: 1, type: 'scene-camera', ...camera });
  }
}
```

- [ ] **Step 9: Keep the camera on the player side**

In `src/app/online/PlayerSession.ts`, make five changes:

1. **The import.** Add:

   ```ts
   import { cameraOfMessage, type SceneCamera } from './scene/sceneCamera';
   ```

2. **The option.** In `PlayerSessionOptions`, add after `onScene?`:

   ```ts
     /** The GM's latest camera, whatever its scene: the map view uses it once that scene is shown. */
     onCamera?(camera: SceneCamera): void;
   ```

3. **The field and getter.** In the class, add after `private assetLink: PeerLink | null = null;`:

   ```ts
     private lastCamera: SceneCamera | null = null;
   ```

   Add after the `scene` getter:

   ```ts
     /** The GM's latest camera; null before the first. */
     get camera(): SceneCamera | null {
       return this.lastCamera;
     }
   ```

4. **Invalid cameras.** In `receive`, replace the `bad-scene-` line with:

   ```ts
       // A bad camera is only skipped: it is not scene data, so it asks for no snapshot.
       if (decoded.kind === 'invalid' && decoded.reason.startsWith('bad-scene-') && decoded.reason !== 'bad-scene-camera') this.mirror.invalid();
   ```

5. **The new message.** In the `switch`, add before `default:`:

   ```ts
         case 'scene-camera':
           this.lastCamera = cameraOfMessage(message);
           this.options.onCamera?.(this.lastCamera);
           break;
   ```

`joinSession.ts` needs no change: `JoinSessionOptions` omits only `assets` and `onScene`, so `onCamera` passes through.

- [ ] **Step 10: Run the camera tests to verify they pass**

Run: `npx vitest run tests/unit/online/presentedCamera.test.ts tests/unit/online/cameraSender.test.ts tests/unit/online/playerSessionScene.test.ts tests/unit/online/sceneBroadcaster.test.ts tests/unit/online/sceneSyncEndToEnd.test.ts`
Expected: PASS.

- [ ] **Step 11: Write the failing diagnostics tests**

Create `tests/unit/online/onlineLog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createOnlineLog, loggedSession, logPresentedScene } from '../../../src/app/online/onlineLog';
import type { ControlMessage } from '../../../src/app/online/protocol';
import { PresentedScene } from '../../../src/app/services/PresentedScene';
import { viewWithViewport } from './cameraFixtures';

function recorder(enabled: () => boolean = () => true) {
  const lines: unknown[][] = [];
  return { lines, log: createOnlineLog(enabled, (...parts) => { lines.push(parts); }) };
}

describe('online log', () => {
  it('writes nothing while the setting is off, and reads the setting on every event', () => {
    let on = false;
    const { lines, log } = recorder(() => on);
    log.event('a');
    on = true;
    log.event('b', { n: 1 });
    on = false;
    log.event('c');
    expect(lines).toEqual([['[Atlas online]', 'b', { n: 1 }]]);
  });

  it('logs every message sent to players, with the caller of a scene-clear', () => {
    const { lines, log } = recorder();
    const sent: Array<[string, ControlMessage]> = [];
    const session = loggedSession({
      use: () => () => {}, getPlayers: () => [], send: (playerId, message) => { sent.push([playerId, message]); },
    }, log);
    session.send('p1', { v: 1, type: 'scene-clear', seq: 4 });
    session.send('p1', { v: 1, type: 'scene-camera', sceneId: 's', centerX: 1, centerY: 2, width: 3, height: 4 });
    expect(sent).toHaveLength(2);
    expect(lines[0]).toEqual(['[Atlas online]', 'send scene-clear', { playerId: 'p1', seq: 4, stack: expect.any(String) }]);
    expect(lines[1]).toEqual(['[Atlas online]', 'send scene-camera', { playerId: 'p1', sceneId: 's', centerX: 1, centerY: 2, width: 3, height: 4 }]);
  });

  it("logs the presented scene's events and its view's tab changes", () => {
    const { lines, log } = recorder();
    const presented = new PresentedScene();
    const stop = logPresentedScene(presented, log);
    const { view, tabs, tavern, dungeon } = viewWithViewport(null);
    presented.present(view, tavern);
    tabs.getState().setActiveTab(dungeon);
    tabs.getState().removeTab(tavern);
    expect(lines.map((line) => line[1])).toEqual(['presented', 'held', 'tabs changed', 'cleared']);
    expect(lines[0]?.[2]).toMatchObject({ presentation: 1, tab: tavern, resumed: false, stack: expect.any(String) });
    expect(lines[2]?.[2]).toMatchObject({ presentation: 1, activeTab: dungeon, presentedTabExists: true, tabs: 2 });
    expect(lines[3]?.[2]).toMatchObject({ presentation: 1, tab: tavern, stack: expect.any(String) });
    stop();
    presented.present(view, dungeon);
    expect(lines).toHaveLength(4);
  });
});
```

In `tests/unit/online/onlineSettings.test.ts`, make two changes:
1. In the test `keeps valid stored fields and drops invalid relays`, add `logEvents: false,` to the expected object, after `playerPageUrl: 'https://p.example/',`.
2. Add this test:

   ```ts
     it('logs online play events only when the stored switch is exactly true', () => {
       expect(DEFAULT_ONLINE_SETTINGS.logEvents).toBe(false);
       expect(resolveOnlineSettings({ logEvents: true }).logEvents).toBe(true);
       expect(resolveOnlineSettings({ logEvents: 'yes' }).logEvents).toBe(false);
     });
   ```

In `tests/unit/online/onlineSessionService.test.ts`, add `import { FakeViewport, viewWithViewport } from './cameraFixtures';` and this test inside `describe('OnlineSessionService', …)`:

```ts
  it("sends the GM's camera of the presented scene to the players it admits, and stops watching on stop", async () => {
    const presented = new PresentedScene();
    const viewport = new FakeViewport();
    const { view, tavern } = viewWithViewport(viewport);
    presented.present(view, tavern);
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
    expect(received.filter((type) => type.startsWith('scene-'))).toEqual(['scene-snapshot', 'scene-camera']);
    svc.stop();
    expect(viewport.listenerCount).toBe(0);
  });
```

- [ ] **Step 12: Run them to verify they fail**

Run: `npx vitest run tests/unit/online/onlineLog.test.ts tests/unit/online/onlineSettings.test.ts tests/unit/online/onlineSessionService.test.ts`
Expected: FAIL. `onlineLog` cannot be resolved, `logEvents` is missing, and no `scene-camera` is received.

- [ ] **Step 13: Write the log, the setting and the wiring**

Create `src/app/online/onlineLog.ts`:

```ts
/**
 * Diagnostics for online play, behind Settings → Online play → Log online play events
 * (on the join page: `localStorage['atlas-online:log'] = 'on'`). Writes with
 * `console.debug`, which the developer console shows under "Verbose". The switch is
 * read on every event, so it works mid-session. Shared with the web page: no Obsidian imports.
 */
import type { PresentedSceneInfo } from '../services/PresentedScene';
import type { ControlMessage } from './protocol';
import type { PresentedSceneSource, SceneSession } from './scene/sceneSources';

export type LogDetails = Record<string, string | number | boolean | null>;
export type LogWriter = (...parts: unknown[]) => void;

export interface OnlineLog {
  isEnabled(): boolean;
  event(name: string, details?: LogDetails): void;
}

export function createOnlineLog(isEnabled: () => boolean, write: LogWriter = (...parts) => console.debug(...parts)): OnlineLog {
  return {
    isEnabled,
    event: (name, details = {}) => {
      if (isEnabled()) write('[Atlas online]', name, details);
    },
  };
}

/** Where the current call came from: a few frames of the stack, for events whose cause is the question. */
export function callerStack(): string {
  return (new Error().stack ?? '').split('\n').slice(2, 10).map((line) => line.trim()).join(' | ');
}

/** What a sent message is about, without its scene data. */
function sendDetails(playerId: string, message: ControlMessage): LogDetails {
  const details: LogDetails = { playerId };
  if ('seq' in message) details.seq = message.seq;
  switch (message.type) {
    case 'scene-snapshot':
      return {
        ...details, sceneId: message.scene.sceneId, tokens: Object.keys(message.scene.tokens).length,
        fogParts: message.fogParts, drawingParts: message.drawingParts,
      };
    case 'scene-camera':
      return {
        ...details, sceneId: message.sceneId, centerX: message.centerX, centerY: message.centerY, width: message.width, height: message.height,
      };
    case 'scene-clear':
      return { ...details, stack: callerStack() };
    default:
      return details;
  }
}

/** The session the broadcaster and the camera sender send through, logging every message. */
export function loggedSession(session: SceneSession, log: OnlineLog): SceneSession {
  return {
    use: (handler) => session.use(handler),
    getPlayers: () => session.getPlayers(),
    send: (playerId, message) => {
      if (log.isEnabled()) log.event(`send ${message.type}`, sendDetails(playerId, message));
      session.send(playerId, message);
    },
  };
}

/**
 * Logs every presented-scene event with the caller's stack and a number per presentation
 * (a new number for the same tab means `present` ran again), and, while a scene is
 * presented, its view's tab changes and map loading.
 */
export function logPresentedScene(presented: PresentedSceneSource, log: OnlineLog): () => void {
  const ids = new WeakMap<PresentedSceneInfo, number>();
  let nextId = 0;
  const idOf = (scene: PresentedSceneInfo): number => {
    let id = ids.get(scene);
    if (id === undefined) {
      id = ++nextId;
      ids.set(scene, id);
    }
    return id;
  };
  const describe = (scene: PresentedSceneInfo): LogDetails => ({
    presentation: idOf(scene), tab: scene.tabId, activeTab: scene.view.tabMetaStore.getState().activeTabId,
    loading: scene.store.getState().isMapLoading, held: presented.isHeld(),
  });
  const when = (write: () => void): void => {
    if (log.isEnabled()) write();
  };

  let watched: PresentedSceneInfo | null = null;
  let stopWatching: (() => void) | null = null;
  const watch = (scene: PresentedSceneInfo | null): void => {
    if (scene === watched) return;
    stopWatching?.();
    stopWatching = null;
    watched = scene;
    if (!scene) return;
    const stopTabs = scene.view.tabMetaStore.subscribe((state) => when(() => log.event('tabs changed', {
      presentation: idOf(scene), presentedTab: scene.tabId, activeTab: state.activeTabId,
      presentedTabExists: state.tabs.some((tab) => tab.id === scene.tabId), tabs: state.tabs.length,
    })));
    let loading = scene.store.getState().isMapLoading;
    const stopStore = scene.store.subscribe((state) => {
      if (state.isMapLoading === loading) return;
      loading = state.isMapLoading;
      when(() => log.event('map loading', { presentation: idOf(scene), loading }));
    });
    stopWatching = () => {
      stopTabs();
      stopStore();
    };
  };

  const stop = presented.subscribe({
    presented: (scene, resumed) => {
      when(() => log.event('presented', { ...describe(scene), resumed, stack: callerStack() }));
      watch(scene);
    },
    held: (scene) => {
      when(() => log.event('held', { ...describe(scene), stack: callerStack() }));
      watch(scene);
    },
    cleared: (previous) => {
      when(() => log.event('cleared', { presentation: idOf(previous), tab: previous.tabId, stack: callerStack() }));
      watch(null);
    },
    viewClosed: () => when(() => log.event('view closed')),
  });
  watch(presented.current());
  return () => {
    stop();
    watch(null);
  };
}
```

In `src/app/online/onlineSettings.ts`, make three changes:

1. In `OnlineSettings`, add after `playerPageUrl: string;`:

   ```ts
     /** Developer diagnostics: log presented-scene events and messages to players to the console. */
     logEvents: boolean;
   ```

2. In `DEFAULT_ONLINE_SETTINGS`, add `logEvents: false,`.

3. In `resolveOnlineSettings`, add after the `playerPageUrl` line:

   ```ts
       logEvents: source.logEvents === true,
   ```

In `src/app/settings/onlineSettingsSection.ts`, add this row at the end of `rows`:

```ts
      {
        name: 'Log online play events',
        desc: 'For troubleshooting: writes what Atlas sends to online players, and every change of the presented scene, to the developer console.',
        aliases: ['debug', 'diagnostics', 'console', 'online'],
        render: (setting) => {
          setting.addToggle((toggle) => toggle
            .setValue(settings.getOnlineSettings().logEvents)
            .onChange((logEvents) => settings.setOnlineSettings({ logEvents })));
        },
      },
```

In `src/app/online/OnlineSessionService.ts`, make five changes:

1. **Imports.** Add:

   ```ts
   import { createOnlineLog, loggedSession, logPresentedScene } from './onlineLog';
   import { CameraSender } from './scene/CameraSender';
   ```

2. **Fields.** Add after `private assetServer: AssetServer | null = null;`:

   ```ts
     private cameraSender: CameraSender | null = null;
     private stopLog: (() => void) | null = null;
   ```

3. **The log.** In `host`, insert before `const session = new GmSession(host, {`:

   ```ts
       // Diagnostics (Settings → Online play → Log online play events), read on every event.
       const log = createOnlineLog(() => this.settings.getOnlineSettings().logEvents);
   ```

4. **The broadcaster and the camera sender.** Replace the `const broadcaster = new SceneBroadcaster({ … });` statement with:

   ```ts
       // The broadcaster and the camera sender send through the log, so diagnostics see every scene message.
       const scenes = loggedSession(session, log);
       const broadcaster = new SceneBroadcaster({
         session: scenes, presented: this.presented, settings: this.settings, assets: registry, notify,
       });
       // The GM's view of the presented scene, which players follow by default; registered after the broadcaster.
       const cameraSender = new CameraSender({ session: scenes, presented: this.presented, projection: broadcaster });
       this.cameraSender = cameraSender;
   ```

   Replace the body of the `try` around `broadcaster.start();` with:

   ```ts
         this.stopLog = logPresentedScene(this.presented, log);
         broadcaster.start();
         cameraSender.start();
         assetServer.start();
   ```

5. **Teardown.** In `teardown`, add after `this.assetServer = null;`:

   ```ts
       this.cameraSender?.stop();
       this.cameraSender = null;
       this.stopLog?.();
       this.stopLog = null;
   ```

- [ ] **Step 14: Run the online tests**

Run: `npx vitest run tests/unit/online`
Expected: PASS.

- [ ] **Step 15: Type-check, lint, sizes**

Run: `npx tsc --noEmit && npx eslint src/app/online src/app/services/PresentedScene.ts src/app/services/presentedCamera.ts src/app/settings/onlineSettingsSection.ts --max-warnings 0 --suppressions-location eslint.suppressions.json && wc -l src/app/online/PlayerSession.ts src/app/online/OnlineSessionService.ts src/app/online/scene/CameraSender.ts src/app/online/onlineLog.ts src/app/online/scene/SceneBroadcaster.ts src/app/services/PresentedScene.ts`
Expected: `tsc` and ESLint exit 0. `SceneBroadcaster.ts` is still 300 lines, and every other file listed is under 300.

- [ ] **Step 16: Commit**

```bash
git add src/app/online/scene/sceneCamera.ts src/app/online/scene/sceneValidation.ts src/app/online/protocol.ts src/app/services/presentedCamera.ts src/app/services/PresentedScene.ts src/app/online/scene/CameraSender.ts src/app/online/PlayerSession.ts src/app/online/onlineLog.ts src/app/online/onlineSettings.ts src/app/settings/onlineSettingsSection.ts src/app/online/OnlineSessionService.ts tests/unit/online/sceneCamera.test.ts tests/unit/online/cameraFixtures.ts tests/unit/online/presentedCamera.test.ts tests/unit/online/cameraSender.test.ts tests/unit/online/onlineLog.test.ts tests/unit/online/playerSessionScene.test.ts tests/unit/online/onlineSettings.test.ts tests/unit/online/onlineSessionService.test.ts
git commit -m "feat(online): send the GM's view of the presented scene, and log online play events"
```

---

### Task 3: The player view core: camera, input, drawing interface and renderer

These are pure, tested modules that the join page later binds to the DOM:
- the camera maths and the controller that follows the GM or breaks away;
- the input mapping;
- the `ViewSurface` drawing interface, with its recording implementation for tests;
- the renderer that stacks one layer per Atlas layer and schedules frames.

Rulings used here:
- **1.** Layer order: `SCENE_LAYER_ORDER`.
- **4.** The player keeps the latest camera, and the view applies it once the scene matches.
- **7.** The phone pixel-ratio cap.

**Files:**
- Create: `src/app/online/view/camera.ts`
- Create: `src/app/online/view/CameraController.ts`
- Create: `src/app/online/view/ViewInput.ts`
- Create: `src/app/online/view/ViewSurface.ts`
- Create: `src/app/online/view/layers/layerTypes.ts`
- Create: `src/app/online/view/PlayerViewRenderer.ts`
- Test: `tests/unit/online/cameraController.test.ts`, `tests/unit/online/viewInput.test.ts`, `tests/unit/online/recordingSurface.ts`, `tests/unit/online/playerViewRenderer.test.ts`

**Interfaces:**
- Consumes:
  - `SceneCamera` (Task 2, `scene/sceneCamera.ts`) and `SCENE_LAYER_ORDER`, `SceneLayer` (Task 1, `pixi/sceneLayerOrder.ts`)
  - `sceneWorldBounds(scene): PreviewRect | null` and `PreviewRect` (`preview/previewLayout.ts`)
  - `DecodedImage` (`assets/AssetLoader.ts`), and `PlayerScene`, `ScenePoint` (`scene/sceneTypes.ts`)
- Produces:
  - `camera.ts`:
    - Types: `WorldRect` (= `PreviewRect`), `Camera { centerX; centerY; zoom }`, `ScreenSize { width; height }`, `ScreenPoint { x; y }`, `WorldView { centerX; centerY; width; height }`, `CameraLimits { minZoom; maxZoom; bounds }`.
    - Constants: `FIT_PADDING = 16`, `MIN_ZOOM_SHARE = 1 / 20`, `MAX_ZOOM_SHARE = 8`, `GLIDE_MS = 150`, `DEFAULT_CAMERA`.
    - Functions: `fitZoom(area, screen, padding?)`, `fitCamera(area, screen)`, `cameraForView(view, screen)`, `cameraLimits(map, screen)`, `clampCamera(camera, limits | null)`, `screenToWorld(camera, screen, point)`, `zoomAround(camera, screen, point, factor, limits)`, `panBy(camera, dx, dy, limits)`, `visibleArea(camera, screen)`, `interpolateCamera(from, to, t)`, `sameRect(a, b)`, `intersects(a, b)`, `intersection(a, b)`.
  - `CameraController.ts`: `interface CameraControllerOptions { now(): number; onChange(): void }` and the class `CameraController`, with methods `current(): Camera`, `isMoving(): boolean`, `isFollowing(): boolean`, `setScreen(screen)`, `setScene(scene | null)`, `setGmCamera(camera | null)`, `pan(dx, dy)`, `zoomAt(point, factor)`, `followGm()` and `fitMap()`.
  - `ViewInput.ts`:
    - Types: `interface CameraMoves { pan(dx, dy); zoomAt(point, factor) }`, `type PointerKind = 'mouse' | 'touch' | 'pen'`, `interface PointerInput { id; x; y; kind; button; time }`.
    - Constants: `WHEEL_ZOOM_PER_PIXEL = 0.0015`, `DOUBLE_ZOOM = 2`, `DOUBLE_TAP_MS = 300`, `DOUBLE_TAP_DISTANCE = 24`, `TAP_SLOP = 6`.
    - The class `ViewInput`, with methods `down(input)`, `move(input)`, `up(input)`, `cancel(id)`, `wheel(point, deltaY, deltaMode)` and `doubleClick(point)`.
  - `ViewSurface.ts`: `ShapeStyle`, `TextStyle`, `SurfaceImage`, `ImageClip`, `interface ViewSurface` and `interface LayerSurface extends ViewSurface { width; height; release() }`. `ViewSurface` has the methods `begin`, `setCamera`, `push`, `pop`, `rect`, `roundRect`, `circle`, `paths`, `image`, `text`, `measureText`, `icon`, `createLayer` and `drawLayer`.
  - `layers/layerTypes.ts`: `type ImageLookup = (id: string | null) => DecodedImage | null`, `interface LayerFrame { scene; images; visible; zoom; pixel; bounds }`, `interface PlayerLayer { draw(surface, frame); dispose?() }`.
  - `PlayerViewRenderer.ts`: `VIEW_BACKGROUND = '#000000'`, `PHONE_PIXEL_RATIO_CAP = 2`, `pixelRatioFor(deviceRatio, coarsePointer): number`, `interface PlayerViewRendererOptions { surface; camera; images; layers: Record<SceneLayer, PlayerLayer>; requestFrame; cancelFrame; isHidden }`, and the class `PlayerViewRenderer`, with methods `setScene(scene)`, `setSize(screen, ratio)`, `invalidate()`, `visibilityChanged()`, `draw()` and `dispose()`.
  - Test fixtures (`recordingSurface.ts`): `RecordingSurface` (`calls`, `layers`, `ops(op)`, `clear()`), `RecordingLayer` (`released`), `SurfaceCall`, `fakeFrames()` (`request`, `cancel`, `run`, `pending`), `decodedImage(width, height)` and `frame(scene, overrides?)`.

- [ ] **Step 1: Write the failing camera controller tests**

Create `tests/unit/online/cameraController.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SceneCamera } from '../../../src/app/online/scene/sceneCamera';
import { DEFAULT_CAMERA, GLIDE_MS, screenToWorld } from '../../../src/app/online/view/camera';
import { CameraController } from '../../../src/app/online/view/CameraController';
import { playerScene, playerToken } from './sceneFixtures';

function setup() {
  let time = 0;
  let changes = 0;
  const controller = new CameraController({ now: () => time, onChange: () => { changes++; } });
  return { controller, advance: (ms: number): void => { time += ms; }, changes: (): number => changes };
}

/** The 1000 × 800 map of `playerScene` fits at zoom 1 inside the 16 px padding. */
const SCREEN = { width: 1032, height: 832 };
const PHONE = { width: 800, height: 600 };
const gm = (overrides: Partial<SceneCamera> = {}): SceneCamera => ({
  sceneId: 'scene-1', centerX: 200, centerY: 300, width: 400, height: 300, ...overrides,
});

describe('CameraController', () => {
  it('fits the map while there is no GM camera', () => {
    const { controller } = setup();
    controller.setScreen(SCREEN);
    controller.setScene(playerScene());
    expect(controller.current()).toEqual({ centerX: 500, centerY: 400, zoom: 1 });
    expect(controller.isFollowing()).toBe(true);
  });

  it("fits the scene's content when the map has no size", () => {
    const { controller } = setup();
    controller.setScreen(SCREEN);
    controller.setScene(playerScene({ map: { asset: null, width: 0, height: 0, cellSize: 70 }, tokens: { t1: playerToken({ x: 100, y: 100 }) } }));
    const camera = controller.current();
    expect([camera.centerX, camera.centerY]).toEqual([100, 100]);
    expect(camera.zoom).toBeCloseTo(800 / 210);
  });

  it("glides to the GM's camera in 150 ms, fitting the GM's visible area to the screen", () => {
    const { controller, advance } = setup();
    controller.setScreen(PHONE);
    controller.setScene(playerScene());
    const fitted = controller.current();
    controller.setGmCamera(gm());
    expect(controller.current()).toEqual(fitted);
    advance(GLIDE_MS / 2);
    const halfway = controller.current();
    expect(halfway.centerX).toBeLessThan(fitted.centerX);
    expect(halfway.centerX).toBeGreaterThan(200);
    expect(controller.isMoving()).toBe(true);
    advance(GLIDE_MS / 2);
    expect(controller.current()).toEqual({ centerX: 200, centerY: 300, zoom: 2 });
    expect(controller.isMoving()).toBe(false);
  });

  it('keeps the zoom between 1/20 and 8 times the fitted zoom, and the centre on the map', () => {
    const { controller } = setup();
    controller.setScreen(SCREEN);
    controller.setScene(playerScene());
    controller.zoomAt({ x: 516, y: 416 }, 100);
    expect(controller.current().zoom).toBe(8);
    controller.zoomAt({ x: 516, y: 416 }, 1e-6);
    expect(controller.current().zoom).toBeCloseTo(0.05);
    controller.pan(-1e6, 1e6);
    expect([controller.current().centerX, controller.current().centerY]).toEqual([1000, 0]);
  });

  it('breaks away on a pan or zoom, and follows again on Follow GM', () => {
    const { controller, advance, changes } = setup();
    controller.setScreen(PHONE);
    controller.setScene(playerScene());
    controller.setGmCamera(gm());
    advance(GLIDE_MS);
    const before = changes();
    controller.pan(10, 0);
    expect(controller.isFollowing()).toBe(false);
    expect(controller.current().centerX).toBeCloseTo(200 - 10 / 2);
    expect(changes()).toBe(before + 1);
    controller.setGmCamera(gm({ centerX: 400 }));
    expect(controller.current().centerX).toBeCloseTo(195);
    controller.followGm();
    expect(controller.isFollowing()).toBe(true);
    advance(GLIDE_MS);
    expect(controller.current()).toEqual({ centerX: 400, centerY: 300, zoom: 2 });
  });

  it('returns to following on a new scene', () => {
    const { controller } = setup();
    controller.setScreen(SCREEN);
    controller.setScene(playerScene());
    controller.pan(50, 50);
    controller.setScene(playerScene({ sceneId: 'scene-2' }));
    expect(controller.isFollowing()).toBe(true);
    expect(controller.current()).toEqual({ centerX: 500, centerY: 400, zoom: 1 });
  });

  it('uses a GM camera that arrived before its scene, and ignores one for another scene', () => {
    const { controller } = setup();
    controller.setScreen(PHONE);
    controller.setGmCamera(gm({ sceneId: 'scene-2' }));
    controller.setScene(playerScene());
    expect(controller.current().centerX).toBe(500);
    controller.setScene(playerScene({ sceneId: 'scene-2' }));
    expect(controller.current()).toEqual({ centerX: 200, centerY: 300, zoom: 2 });
    controller.setGmCamera(gm({ sceneId: 'scene-1', centerX: 900 }));
    expect(controller.current()).toEqual({ centerX: 200, centerY: 300, zoom: 2 });
  });

  it('refits on resize while following, and keeps the centre after breaking away', () => {
    const { controller } = setup();
    controller.setScreen(SCREEN);
    controller.setScene(playerScene());
    controller.setScreen({ width: 532, height: 432 });
    expect(controller.current()).toEqual({ centerX: 500, centerY: 400, zoom: 0.5 });
    controller.pan(50, 0);
    controller.setScreen(SCREEN);
    expect(controller.current()).toEqual({ centerX: 400, centerY: 400, zoom: 0.5 });
  });

  it('stays finite while the canvas has no size, and refits once it has one', () => {
    const { controller } = setup();
    controller.setScreen({ width: 0, height: 0 });
    controller.setScene(playerScene());
    controller.setGmCamera(gm());
    const camera = controller.current();
    expect([camera.centerX, camera.centerY, camera.zoom].every(Number.isFinite)).toBe(true);
    expect(camera.zoom).toBeGreaterThan(0);
    controller.setScreen(PHONE);
    expect(controller.current()).toEqual({ centerX: 200, centerY: 300, zoom: 2 });
  });

  it('resets when the scene is cleared', () => {
    const { controller } = setup();
    controller.setScreen(SCREEN);
    controller.setScene(playerScene());
    controller.pan(50, 0);
    controller.setScene(null);
    expect(controller.current()).toEqual(DEFAULT_CAMERA);
    expect(controller.isFollowing()).toBe(true);
  });

  it('shows the whole map on Fit map, staying broken away', () => {
    const { controller, advance } = setup();
    controller.setScreen(SCREEN);
    controller.setScene(playerScene());
    controller.setGmCamera(gm());
    advance(GLIDE_MS);
    controller.fitMap();
    expect(controller.isFollowing()).toBe(false);
    advance(GLIDE_MS);
    expect(controller.current()).toEqual({ centerX: 500, centerY: 400, zoom: 1 });
  });

  it('zooms around the cursor', () => {
    const { controller } = setup();
    controller.setScreen(SCREEN);
    controller.setScene(playerScene());
    const point = { x: 300, y: 200 };
    const before = screenToWorld(controller.current(), SCREEN, point);
    controller.zoomAt(point, 2);
    const after = screenToWorld(controller.current(), SCREEN, point);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});
```

- [ ] **Step 2: Write the failing input tests**

Create `tests/unit/online/viewInput.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ScreenPoint } from '../../../src/app/online/view/camera';
import { DOUBLE_ZOOM, ViewInput, WHEEL_ZOOM_PER_PIXEL, type PointerInput } from '../../../src/app/online/view/ViewInput';

type Move = { pan: [number, number] } | { zoom: [ScreenPoint, number] };

function setup(): { input: ViewInput; moves: Move[] } {
  const moves: Move[] = [];
  const input = new ViewInput({
    pan: (dx, dy) => { moves.push({ pan: [dx, dy] }); },
    zoomAt: (point, factor) => { moves.push({ zoom: [point, factor] }); },
  });
  return { input, moves };
}

const mouse = (x: number, y: number, button = 0): PointerInput => ({ id: 1, x, y, kind: 'mouse', button, time: 0 });
const touch = (id: number, x: number, y: number, time = 0): PointerInput => ({ id, x, y, kind: 'touch', button: 0, time });

describe('ViewInput', () => {
  it('zooms around the cursor on the wheel, by pixels, lines or pages', () => {
    const { input, moves } = setup();
    input.wheel({ x: 100, y: 50 }, 100, 0);
    input.wheel({ x: 100, y: 50 }, 3, 1);
    input.wheel({ x: 100, y: 50 }, 0, 0);
    expect(moves).toEqual([
      { zoom: [{ x: 100, y: 50 }, Math.exp(-100 * WHEEL_ZOOM_PER_PIXEL)] },
      { zoom: [{ x: 100, y: 50 }, Math.exp(-48 * WHEEL_ZOOM_PER_PIXEL)] },
    ]);
  });

  it('pans with a drag once it moves past the slop, the whole way from where it started', () => {
    const { input, moves } = setup();
    input.down(mouse(0, 0));
    input.move(mouse(3, 0));
    input.move(mouse(10, 0));
    input.move(mouse(15, 5));
    input.up(mouse(15, 5));
    input.move(mouse(40, 40));
    expect(moves).toEqual([{ pan: [10, 0] }, { pan: [5, 5] }]);
  });

  it('moves nothing on a click, or a tap that jitters less than the slop', () => {
    const { input, moves } = setup();
    input.down(mouse(100, 100));
    input.up(mouse(100, 100));
    input.down(touch(2, 100, 100));
    input.move(touch(2, 104, 101));
    input.up(touch(2, 104, 101));
    expect(moves).toEqual([]);
  });

  it('zooms in on a double-click, but not on the double-click a touch double-tap may also fire', () => {
    const { input, moves } = setup();
    input.down(mouse(10, 10));
    input.up(mouse(10, 10));
    input.doubleClick({ x: 10, y: 10 });
    input.down(touch(2, 10, 10));
    input.up(touch(2, 10, 10));
    input.doubleClick({ x: 10, y: 10 });
    expect(moves).toEqual([{ zoom: [{ x: 10, y: 10 }, DOUBLE_ZOOM] }]);
  });

  it('zooms in on a double-tap, only when quick and close', () => {
    const { input, moves } = setup();
    for (const [x, y, time] of [[50, 50, 0], [60, 55, 200], [60, 55, 1000], [60, 55, 1400], [300, 300, 1500]] as const) {
      input.down(touch(2, x, y, time));
      input.up(touch(2, x, y, time));
    }
    expect(moves).toEqual([{ zoom: [{ x: 60, y: 55 }, DOUBLE_ZOOM] }]);
  });

  it('pinches around the fingers and pans with them', () => {
    const { input, moves } = setup();
    input.down(touch(1, 100, 100));
    input.down(touch(2, 200, 100));
    input.move(touch(2, 300, 100));
    expect(moves).toEqual([{ pan: [50, 0] }, { zoom: [{ x: 200, y: 100 }, 2] }]);
  });

  it('keeps panning with the remaining finger after a pinch', () => {
    const { input, moves } = setup();
    input.down(touch(1, 100, 100));
    input.down(touch(2, 200, 100));
    input.move(touch(2, 300, 100));
    moves.length = 0;
    input.up(touch(1, 100, 100));
    input.move(touch(2, 310, 100));
    input.move(touch(2, 312, 104));
    input.up(touch(2, 312, 104));
    expect(moves).toEqual([{ pan: [10, 0] }, { pan: [2, 4] }]);
  });

  it('ignores other mouse buttons and a third finger, and a cancelled press is no tap', () => {
    const { input, moves } = setup();
    input.down(mouse(0, 0, 2));
    input.move(mouse(50, 0, 2));
    input.down(touch(1, 0, 0));
    input.down(touch(2, 100, 0));
    input.down(touch(3, 50, 50));
    input.move(touch(3, 90, 90));
    input.cancel(1);
    input.cancel(2);
    input.down(touch(4, 10, 10, 0));
    input.cancel(4);
    input.down(touch(5, 10, 10, 100));
    input.up(touch(5, 10, 10, 100));
    expect(moves).toEqual([]);
  });
});
```

- [ ] **Step 3: Write the recording surface and the failing renderer tests**

Create `tests/unit/online/recordingSurface.ts`:

```ts
import type { DecodedImage } from '../../../src/app/online/assets/AssetLoader';
import { sceneWorldBounds } from '../../../src/app/online/preview/previewLayout';
import type { PlayerScene, ScenePoint } from '../../../src/app/online/scene/sceneTypes';
import type { LayerFrame } from '../../../src/app/online/view/layers/layerTypes';
import type { ImageClip, LayerSurface, ShapeStyle, SurfaceImage, TextStyle, ViewSurface } from '../../../src/app/online/view/ViewSurface';

export type SurfaceCall =
  | { op: 'begin'; width: number; height: number; background: string | null }
  | { op: 'camera'; scale: number; offsetX: number; offsetY: number }
  | { op: 'push'; x: number; y: number; rotation: number; scale: number }
  | { op: 'pop' }
  | { op: 'rect'; x: number; y: number; width: number; height: number; style: ShapeStyle }
  | { op: 'roundRect'; x: number; y: number; width: number; height: number; radius: number; style: ShapeStyle }
  | { op: 'circle'; x: number; y: number; radius: number; style: ShapeStyle }
  | { op: 'paths'; paths: ScenePoint[][]; closed: boolean; style: ShapeStyle }
  | { op: 'image'; image: SurfaceImage; x: number; y: number; width: number; height: number; clip: ImageClip | null }
  | { op: 'text'; text: string; x: number; y: number; style: TextStyle }
  | { op: 'icon'; name: string; x: number; y: number; size: number; color: string; alpha: number }
  | { op: 'drawLayer'; layer: number; x: number; y: number; width: number; height: number };

export type CallOf<K extends SurfaceCall['op']> = Extract<SurfaceCall, { op: K }>;

/** Records every drawing call. Text measures half its font size per character. */
export class RecordingSurface implements ViewSurface {
  readonly calls: SurfaceCall[] = [];
  readonly layers: RecordingLayer[] = [];

  constructor(readonly id = 0) {}

  begin(width: number, height: number, background: string | null): void { this.calls.push({ op: 'begin', width, height, background }); }
  setCamera(scale: number, offsetX: number, offsetY: number): void { this.calls.push({ op: 'camera', scale, offsetX, offsetY }); }
  push(x: number, y: number, rotation: number, scale: number): void { this.calls.push({ op: 'push', x, y, rotation, scale }); }
  pop(): void { this.calls.push({ op: 'pop' }); }
  rect(x: number, y: number, width: number, height: number, style: ShapeStyle): void {
    this.calls.push({ op: 'rect', x, y, width, height, style });
  }
  roundRect(x: number, y: number, width: number, height: number, radius: number, style: ShapeStyle): void {
    this.calls.push({ op: 'roundRect', x, y, width, height, radius, style });
  }
  circle(x: number, y: number, radius: number, style: ShapeStyle): void { this.calls.push({ op: 'circle', x, y, radius, style }); }
  paths(paths: ReadonlyArray<readonly ScenePoint[]>, closed: boolean, style: ShapeStyle): void {
    this.calls.push({ op: 'paths', paths: paths.map((path) => [...path]), closed, style });
  }
  image(image: SurfaceImage, x: number, y: number, width: number, height: number, clip: ImageClip | null): void {
    this.calls.push({ op: 'image', image, x, y, width, height, clip });
  }
  text(text: string, x: number, y: number, style: TextStyle): void { this.calls.push({ op: 'text', text, x, y, style }); }
  measureText(text: string, font: string): number {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
    return text.length * size * 0.5;
  }
  icon(name: string, x: number, y: number, size: number, color: string, alpha: number): void {
    this.calls.push({ op: 'icon', name, x, y, size, color, alpha });
  }
  createLayer(width: number, height: number): LayerSurface {
    const layer = new RecordingLayer(this.layers.length + 1, width, height);
    this.layers.push(layer);
    return layer;
  }
  drawLayer(layer: LayerSurface, x: number, y: number, width: number, height: number): void {
    this.calls.push({ op: 'drawLayer', layer: layer instanceof RecordingLayer ? layer.id : -1, x, y, width, height });
  }

  /** The calls of one kind, in order. */
  ops<K extends SurfaceCall['op']>(op: K): Array<CallOf<K>> {
    return this.calls.filter((call): call is CallOf<K> => call.op === op);
  }

  clear(): void {
    this.calls.length = 0;
  }
}

export class RecordingLayer extends RecordingSurface implements LayerSurface {
  released = false;

  constructor(id: number, readonly width: number, readonly height: number) {
    super(id);
  }

  release(): void {
    this.released = true;
  }
}

/** Animation frames the test runs by hand. */
export function fakeFrames(): { request(draw: () => void): number; cancel(handle: number): void; run(): void; readonly pending: number } {
  const queue = new Map<number, () => void>();
  let next = 1;
  return {
    request: (draw) => {
      const handle = next++;
      queue.set(handle, draw);
      return handle;
    },
    cancel: (handle) => { queue.delete(handle); },
    run: () => {
      const due = [...queue.values()];
      queue.clear();
      due.forEach((draw) => draw());
    },
    get pending() { return queue.size; },
  };
}

export function decodedImage(width: number, height: number): DecodedImage {
  return { image: { width, height } as unknown as ImageBitmap, width, height, release: () => {} };
}

/** One frame for a layer: the whole 1000 × 800 map of `playerScene` visible at zoom 1, no images loaded. */
export function frame(scene: PlayerScene, overrides: Partial<LayerFrame> = {}): LayerFrame {
  return {
    scene, images: () => null, visible: { x: -100, y: -100, width: 1200, height: 1000 }, zoom: 1, pixel: 1,
    bounds: sceneWorldBounds(scene), ...overrides,
  };
}
```

Create `tests/unit/online/playerViewRenderer.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { SCENE_LAYER_ORDER, type SceneLayer } from '../../../src/app/pixi/sceneLayerOrder';
import { GLIDE_MS } from '../../../src/app/online/view/camera';
import { CameraController } from '../../../src/app/online/view/CameraController';
import type { PlayerLayer } from '../../../src/app/online/view/layers/layerTypes';
import { pixelRatioFor, PlayerViewRenderer, VIEW_BACKGROUND } from '../../../src/app/online/view/PlayerViewRenderer';
import { fakeFrames, RecordingSurface } from './recordingSurface';
import { playerScene } from './sceneFixtures';

function setup(options: { hidden?: boolean } = {}) {
  let time = 0;
  let hidden = options.hidden ?? false;
  const frames = fakeFrames();
  const surface = new RecordingSurface();
  const drawn: string[] = [];
  const disposed: string[] = [];
  const layers = Object.fromEntries(SCENE_LAYER_ORDER.map((name): [SceneLayer, PlayerLayer] => [name, {
    draw: () => { drawn.push(name); },
    dispose: () => { disposed.push(name); },
  }])) as Record<SceneLayer, PlayerLayer>;
  const camera = new CameraController({ now: () => time, onChange: () => renderer.invalidate() });
  const renderer = new PlayerViewRenderer({
    surface, camera, images: () => null, layers, requestFrame: frames.request, cancelFrame: (handle) => frames.cancel(handle),
    isHidden: () => hidden,
  });
  const show = (screen = { width: 800, height: 600 }, ratio = 1): void => {
    const scene = playerScene();
    camera.setScreen(screen);
    renderer.setSize(screen, ratio);
    camera.setScene(scene);
    renderer.setScene(scene);
  };
  return {
    surface, camera, renderer, frames, drawn, disposed, show,
    advance: (ms: number): void => { time += ms; },
    setHidden: (value: boolean): void => { hidden = value; },
  };
}

describe('PlayerViewRenderer', () => {
  it("draws the layers in Atlas's order, once per frame however many changes arrive", () => {
    const t = setup();
    t.show();
    t.renderer.invalidate();
    expect(t.frames.pending).toBe(1);
    t.frames.run();
    expect(t.drawn).toEqual([...SCENE_LAYER_ORDER]);
    expect(t.surface.ops('begin')).toHaveLength(1);
    expect(t.frames.pending).toBe(0);
  });

  it('draws nothing more until something changes', () => {
    const t = setup();
    t.show();
    t.frames.run();
    t.frames.run();
    expect(t.surface.ops('begin')).toHaveLength(1);
  });

  it('draws nothing while the page is hidden, and catches up once it is visible', () => {
    const t = setup({ hidden: true });
    t.show();
    expect(t.frames.pending).toBe(0);
    t.setHidden(false);
    t.renderer.visibilityChanged();
    t.frames.run();
    expect(t.drawn).toEqual([...SCENE_LAYER_ORDER]);
  });

  it('keeps drawing frames while the camera glides, then stops', () => {
    const t = setup();
    t.show();
    t.frames.run();
    t.camera.setGmCamera({ sceneId: 'scene-1', centerX: 200, centerY: 200, width: 400, height: 300 });
    t.frames.run();
    expect(t.frames.pending).toBe(1);
    t.advance(GLIDE_MS);
    t.frames.run();
    expect(t.frames.pending).toBe(0);
  });

  it('maps world to device pixels at the pixel ratio, centred on the camera', () => {
    const t = setup();
    t.show({ width: 800, height: 600 }, 2);
    t.frames.run();
    const zoom = Math.min(768 / 1000, 568 / 800);
    expect(t.surface.ops('begin')[0]).toEqual({ op: 'begin', width: 1600, height: 1200, background: VIEW_BACKGROUND });
    const camera = t.surface.ops('camera')[0]!;
    expect(camera.scale).toBeCloseTo(zoom * 2);
    expect(camera.offsetX).toBeCloseTo(800 - 500 * zoom * 2);
    expect(camera.offsetY).toBeCloseTo(600 - 400 * zoom * 2);
  });

  it('clears to black and draws no layer without a scene', () => {
    const t = setup();
    t.renderer.setSize({ width: 100, height: 100 }, 1);
    t.renderer.setScene(null);
    t.frames.run();
    expect(t.surface.calls).toEqual([{ op: 'begin', width: 100, height: 100, background: VIEW_BACKGROUND }]);
    expect(t.drawn).toEqual([]);
  });

  it('cancels its frame and frees its layers when disposed', () => {
    const t = setup();
    t.show();
    const cancel = vi.spyOn(t.frames, 'cancel');
    t.renderer.dispose();
    expect(cancel).toHaveBeenCalled();
    expect(t.disposed).toEqual([...SCENE_LAYER_ORDER]);
  });

  it('caps the pixel ratio at 2 on phones', () => {
    expect(pixelRatioFor(3, true)).toBe(2);
    expect(pixelRatioFor(1.5, true)).toBe(1.5);
    expect(pixelRatioFor(3, false)).toBe(3);
    expect(pixelRatioFor(Number.NaN, false)).toBe(1);
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npx vitest run tests/unit/online/cameraController.test.ts tests/unit/online/viewInput.test.ts tests/unit/online/playerViewRenderer.test.ts`
Expected: FAIL. `src/app/online/view/camera`, `CameraController`, `ViewInput` and `PlayerViewRenderer` cannot be resolved.

- [ ] **Step 5: Write the camera maths and the controller**

Create `src/app/online/view/camera.ts`:

```ts
/**
 * The player's camera: a centre in world units and a zoom in screen (CSS) pixels per
 * world unit, with the maths to fit areas, zoom around a point and keep the map in
 * view. Pure; shared with the web page.
 */
import type { PreviewRect } from '../preview/previewLayout';

export type WorldRect = PreviewRect;

export interface Camera {
  centerX: number;
  centerY: number;
  zoom: number;
}

export interface ScreenSize {
  width: number;
  height: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** A world area by its centre and size, as the GM camera describes it. */
export interface WorldView {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export interface CameraLimits {
  minZoom: number;
  maxZoom: number;
  /** The centre stays inside this area, so part of the map is always on screen. */
  bounds: WorldRect;
}

/** Space left around the map when it is fitted to the screen, in CSS pixels. */
export const FIT_PADDING = 16;
/** Zoom limits around the map's fitted zoom: out to 1/20 of it, in to 8 times it. */
export const MIN_ZOOM_SHARE = 1 / 20;
export const MAX_ZOOM_SHARE = 8;
/** How long the view takes to glide to the GM's camera. */
export const GLIDE_MS = 150;
/** The camera before anything is known: the world origin in the middle, 1:1. */
export const DEFAULT_CAMERA: Camera = { centerX: 0, centerY: 0, zoom: 1 };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** A canvas not laid out yet measures 0 × 0: the maths treats it as one pixel each way. */
function usable(screen: ScreenSize): ScreenSize {
  return { width: Math.max(1, screen.width), height: Math.max(1, screen.height) };
}

/** The zoom that shows all of `area` on the screen, inset by `padding` CSS pixels. */
export function fitZoom(area: { width: number; height: number }, screen: ScreenSize, padding: number = FIT_PADDING): number {
  const { width, height } = usable(screen);
  const availableWidth = Math.max(1, width - 2 * padding);
  const availableHeight = Math.max(1, height - 2 * padding);
  return Math.min(availableWidth / Math.max(1e-6, area.width), availableHeight / Math.max(1e-6, area.height));
}

/** All of `area`, centred. */
export function fitCamera(area: WorldRect, screen: ScreenSize): Camera {
  return { centerX: area.x + area.width / 2, centerY: area.y + area.height / 2, zoom: fitZoom(area, screen) };
}

/** The GM's visible area: same centre, as large as fits this screen. */
export function cameraForView(view: WorldView, screen: ScreenSize): Camera {
  return { centerX: view.centerX, centerY: view.centerY, zoom: fitZoom(view, screen, 0) };
}

export function cameraLimits(map: WorldRect, screen: ScreenSize): CameraLimits {
  const fitted = fitZoom(map, screen);
  return { minZoom: fitted * MIN_ZOOM_SHARE, maxZoom: fitted * MAX_ZOOM_SHARE, bounds: map };
}

/** The zoom within the limits and the centre inside the map; without limits only a finite, positive zoom. */
export function clampCamera(camera: Camera, limits: CameraLimits | null): Camera {
  const zoom = Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
  if (!limits) return { centerX: camera.centerX, centerY: camera.centerY, zoom };
  const { bounds } = limits;
  return {
    centerX: clamp(camera.centerX, bounds.x, bounds.x + bounds.width),
    centerY: clamp(camera.centerY, bounds.y, bounds.y + bounds.height),
    zoom: clamp(zoom, limits.minZoom, limits.maxZoom),
  };
}

export function screenToWorld(camera: Camera, screen: ScreenSize, point: ScreenPoint): ScreenPoint {
  return {
    x: camera.centerX + (point.x - screen.width / 2) / camera.zoom,
    y: camera.centerY + (point.y - screen.height / 2) / camera.zoom,
  };
}

/** Zooms by `factor`, keeping the world point under `point` where it is on screen, unless a limit stops it. */
export function zoomAround(camera: Camera, screen: ScreenSize, point: ScreenPoint, factor: number, limits: CameraLimits | null): Camera {
  const anchor = screenToWorld(camera, screen, point);
  const zoom = clampCamera({ ...camera, zoom: camera.zoom * factor }, limits).zoom;
  return clampCamera({
    centerX: anchor.x - (point.x - screen.width / 2) / zoom,
    centerY: anchor.y - (point.y - screen.height / 2) / zoom,
    zoom,
  }, limits);
}

/** Moves the map by `dx`, `dy` screen pixels: the world follows the finger. */
export function panBy(camera: Camera, dx: number, dy: number, limits: CameraLimits | null): Camera {
  return clampCamera({ centerX: camera.centerX - dx / camera.zoom, centerY: camera.centerY - dy / camera.zoom, zoom: camera.zoom }, limits);
}

/** The world area on a screen of this size. */
export function visibleArea(camera: Camera, screen: ScreenSize): WorldRect {
  const width = screen.width / camera.zoom;
  const height = screen.height / camera.zoom;
  return { x: camera.centerX - width / 2, y: camera.centerY - height / 2, width, height };
}

/** Part way from `from` to `to` (`t` from 0 to 1), easing out; the zoom moves evenly in scale. */
export function interpolateCamera(from: Camera, to: Camera, t: number): Camera {
  const eased = 1 - (1 - clamp(t, 0, 1)) ** 3;
  return {
    centerX: from.centerX + (to.centerX - from.centerX) * eased,
    centerY: from.centerY + (to.centerY - from.centerY) * eased,
    zoom: from.zoom * (to.zoom / from.zoom) ** eased,
  };
}

export function sameRect(a: WorldRect | null, b: WorldRect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function intersects(a: WorldRect, b: WorldRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function intersection(a: WorldRect, b: WorldRect): WorldRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}
```

Create `src/app/online/view/CameraController.ts`:

```ts
/**
 * Where the player looks. By default it follows the GM: each GM camera of the shown
 * scene glides the view there in `GLIDE_MS`. A pan or zoom by the player breaks away
 * until `followGm`. Without a GM camera it fits the map (or, without a map size, the
 * scene's content). The GM's latest camera is kept whatever its scene and used once
 * that scene is shown. Time is injected, so tests drive it. Shared with the web page.
 */
import { sceneWorldBounds } from '../preview/previewLayout';
import type { SceneCamera } from '../scene/sceneCamera';
import type { PlayerScene } from '../scene/sceneTypes';
import {
  cameraForView, cameraLimits, clampCamera, DEFAULT_CAMERA, fitCamera, GLIDE_MS, interpolateCamera, panBy, sameRect, zoomAround,
  type Camera, type CameraLimits, type ScreenPoint, type ScreenSize, type WorldRect,
} from './camera';

export interface CameraControllerOptions {
  now(): number;
  /** The camera, or whether it follows, changed: draw again. */
  onChange(): void;
}

interface Glide {
  from: Camera;
  to: Camera;
  start: number;
}

export class CameraController {
  private screen: ScreenSize = { width: 0, height: 0 };
  private sceneId: string | null = null;
  private bounds: WorldRect | null = null;
  private gm: SceneCamera | null = null;
  private following = true;
  private camera: Camera = DEFAULT_CAMERA;
  private glide: Glide | null = null;

  constructor(private readonly options: CameraControllerOptions) {}

  /** The camera to draw with now, mid-glide included. */
  current(): Camera {
    const glide = this.glide;
    if (!glide) return this.camera;
    const t = (this.options.now() - glide.start) / GLIDE_MS;
    if (t < 1) return interpolateCamera(glide.from, glide.to, t);
    this.glide = null;
    this.camera = glide.to;
    return this.camera;
  }

  /** Whether a glide is under way, so the view keeps drawing frames. */
  isMoving(): boolean {
    return this.glide !== null && this.options.now() - this.glide.start < GLIDE_MS;
  }

  isFollowing(): boolean {
    return this.following;
  }

  /** The canvas's size in CSS pixels. A following view refits; one that broke away keeps its centre. */
  setScreen(screen: ScreenSize): void {
    if (screen.width === this.screen.width && screen.height === this.screen.height) return;
    this.screen = { width: screen.width, height: screen.height };
    this.jump(this.following ? this.target() : clampCamera(this.current(), this.limits()));
  }

  /** The shown scene. A new scene (new `sceneId`) returns to following; none resets the camera. */
  setScene(scene: PlayerScene | null): void {
    const sceneId = scene?.sceneId ?? null;
    const bounds = scene ? sceneWorldBounds(scene) : null;
    if (sceneId !== this.sceneId) {
      this.sceneId = sceneId;
      this.bounds = bounds;
      this.following = true;
      this.jump(scene ? this.target() : DEFAULT_CAMERA);
      return;
    }
    if (sameRect(bounds, this.bounds)) return;
    this.bounds = bounds;
    // Without a map size the content decides the bounds, and it moves with the tokens.
    if (this.following) this.glideTo(this.target());
    else this.jump(clampCamera(this.current(), this.limits()));
  }

  /** The GM's latest camera, whatever its scene: it is used once its scene is shown. */
  setGmCamera(camera: SceneCamera | null): void {
    this.gm = camera;
    if (this.following && this.sceneId !== null && camera?.sceneId === this.sceneId) this.glideTo(this.target());
  }

  pan(dx: number, dy: number): void {
    this.breakAway(panBy(this.current(), dx, dy, this.limits()));
  }

  zoomAt(point: ScreenPoint, factor: number): void {
    this.breakAway(zoomAround(this.current(), this.screen, point, factor, this.limits()));
  }

  /** Back to following: glide to the GM's camera, or fit the map without one. */
  followGm(): void {
    this.following = true;
    this.glideTo(this.target());
  }

  /** Shows the whole map; the player stays broken away. */
  fitMap(): void {
    this.following = false;
    this.glideTo(this.fitted());
  }

  private target(): Camera {
    const gm = this.gm;
    if (gm && gm.sceneId === this.sceneId) return clampCamera(cameraForView(gm, this.screen), this.limits());
    return this.fitted();
  }

  private fitted(): Camera {
    return this.bounds ? fitCamera(this.bounds, this.screen) : DEFAULT_CAMERA;
  }

  private limits(): CameraLimits | null {
    return this.bounds ? cameraLimits(this.bounds, this.screen) : null;
  }

  private breakAway(camera: Camera): void {
    this.following = false;
    this.jump(camera);
  }

  private jump(camera: Camera): void {
    this.glide = null;
    this.camera = camera;
    this.options.onChange();
  }

  private glideTo(to: Camera): void {
    this.glide = { from: this.current(), to, start: this.options.now() };
    this.options.onChange();
  }
}
```

- [ ] **Step 6: Write the input mapping**

Create `src/app/online/view/ViewInput.ts`:

```ts
/**
 * Turns input on the map into camera moves: the wheel zooms around the cursor, a
 * drag pans, a double-click or double-tap zooms in, and two fingers pan and pinch
 * around their midpoint. Points are CSS pixels from the canvas's top left. Pure: the
 * page passes plain numbers from its DOM events, so tests drive it the same way.
 */
import type { ScreenPoint } from './camera';

export interface CameraMoves {
  pan(dx: number, dy: number): void;
  zoomAt(point: ScreenPoint, factor: number): void;
}

export type PointerKind = 'mouse' | 'touch' | 'pen';

export interface PointerInput {
  id: number;
  x: number;
  y: number;
  kind: PointerKind;
  /** The pressed button; 0 is the main one. */
  button: number;
  /** In milliseconds, on any clock. */
  time: number;
}

/** Wheel zoom per pixel scrolled: about 1.16× per 100 px notch. */
export const WHEEL_ZOOM_PER_PIXEL = 0.0015;
const LINE_PIXELS = 16;
const PAGE_PIXELS = 800;
/** Double-click and double-tap zoom. */
export const DOUBLE_ZOOM = 2;
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_DISTANCE = 24;
/** A press that moves less than this is a click or tap, and moves nothing. */
export const TAP_SLOP = 6;

const distance = (a: ScreenPoint, b: ScreenPoint): number => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: ScreenPoint, b: ScreenPoint): ScreenPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export class ViewInput {
  private readonly pointers = new Map<number, ScreenPoint>();
  /** Where the gesture's first pointer went down, until it moves past the slop. */
  private start: ScreenPoint | null = null;
  private dragging = false;
  private lastTap: { point: ScreenPoint; time: number } | null = null;
  private lastKind: PointerKind = 'mouse';

  constructor(private readonly camera: CameraMoves) {}

  down(input: PointerInput): void {
    this.lastKind = input.kind;
    if (input.kind === 'mouse' && input.button !== 0) return;
    if (this.pointers.size >= 2) return;
    const point = { x: input.x, y: input.y };
    this.pointers.set(input.id, point);
    if (this.pointers.size === 1) {
      this.start = point;
      this.dragging = false;
    } else {
      // A second finger makes the gesture a pinch, never a tap.
      this.start = null;
      this.dragging = true;
    }
  }

  move(input: PointerInput): void {
    const previous = this.pointers.get(input.id);
    if (!previous) return;
    const point = { x: input.x, y: input.y };
    if (this.pointers.size === 2) {
      this.pinch(input.id, previous, point);
      return;
    }
    if (this.dragging) {
      this.camera.pan(point.x - previous.x, point.y - previous.y);
    } else {
      const start = this.start;
      if (!start || distance(start, point) < TAP_SLOP) return;
      this.dragging = true;
      this.camera.pan(point.x - start.x, point.y - start.y);
    }
    this.pointers.set(input.id, point);
  }

  up(input: PointerInput): void {
    if (!this.pointers.delete(input.id)) return;
    // One finger left a pinch: it pans on from where it is.
    if (this.pointers.size > 0) return;
    if (!this.dragging && input.kind === 'touch') this.tap({ x: input.x, y: input.y }, input.time);
    this.start = null;
    this.dragging = false;
  }

  cancel(id: number): void {
    this.pointers.delete(id);
    if (this.pointers.size > 0) return;
    this.start = null;
    this.dragging = false;
  }

  /** `deltaMode` as in `WheelEvent`: 0 pixels, 1 lines, 2 pages. */
  wheel(point: ScreenPoint, deltaY: number, deltaMode: number): void {
    const pixels = deltaMode === 1 ? deltaY * LINE_PIXELS : deltaMode === 2 ? deltaY * PAGE_PIXELS : deltaY;
    if (pixels !== 0) this.camera.zoomAt(point, Math.exp(-pixels * WHEEL_ZOOM_PER_PIXEL));
  }

  /** The browser's double-click; a touch double-tap is recognised from its taps instead, so it zooms once. */
  doubleClick(point: ScreenPoint): void {
    if (this.lastKind === 'touch') return;
    this.camera.zoomAt(point, DOUBLE_ZOOM);
  }

  private pinch(id: number, previous: ScreenPoint, point: ScreenPoint): void {
    const other = [...this.pointers].find(([key]) => key !== id)?.[1];
    this.pointers.set(id, point);
    if (!other) return;
    const before = midpoint(previous, other);
    const after = midpoint(point, other);
    this.camera.pan(after.x - before.x, after.y - before.y);
    const spread = distance(previous, other);
    if (spread > 0) this.camera.zoomAt(after, distance(point, other) / spread);
  }

  private tap(point: ScreenPoint, time: number): void {
    const last = this.lastTap;
    if (last && time - last.time <= DOUBLE_TAP_MS && distance(last.point, point) <= DOUBLE_TAP_DISTANCE) {
      this.lastTap = null;
      this.camera.zoomAt(point, DOUBLE_ZOOM);
      return;
    }
    this.lastTap = { point, time };
  }
}
```

- [ ] **Step 7: Write the drawing interface, the layer types and the renderer**

Create `src/app/online/view/ViewSurface.ts`:

```ts
/**
 * What the player view's layers draw through. A 2D canvas implements it on the join
 * page (`online-client/canvasSurface.mts`), tests record the calls, and a PIXI renderer
 * could implement it later. Coordinates are world units after `setCamera`, or the local
 * frame after `push`. Colours and text come from the network: implementations hand
 * them only to the drawing API (`fillStyle`, `strokeStyle`, `fillText`), which ignores
 * invalid values and never interprets markup. Shared with the web page.
 */
import type { ScenePoint } from '../scene/sceneTypes';

export interface ShapeStyle {
  fill?: string;
  stroke?: string;
  /** Stroke width in the current frame's units; 1 when unset. */
  lineWidth?: number;
  /** From 0 to 1; 1 when unset. */
  alpha?: number;
  /** Dash pattern in the current frame's units; solid when unset. */
  dash?: readonly number[];
  /** Round caps and joins (ink, fog brushes); butt caps and mitred joins otherwise. */
  round?: boolean;
  /** Cuts the shape out of what was drawn before (fog erasing). */
  erase?: boolean;
}

export interface TextStyle {
  /** A CSS font shorthand, such as `bold 24px serif`. */
  font: string;
  color: string;
  /** Where the point is horizontally; the text is always centred vertically on it. */
  align: 'left' | 'center' | 'right';
  alpha?: number;
}

/** A decoded image (`DecodedImage.image`): an `ImageBitmap` or a loaded `<img>`. */
export type SurfaceImage = ImageBitmap | HTMLImageElement;

/** A circle an image is clipped to, in the current frame. */
export interface ImageClip {
  x: number;
  y: number;
  radius: number;
}

export interface ViewSurface {
  /** Starts a frame of `width × height` device pixels, filled with `background` (null: transparent). */
  begin(width: number, height: number, background: string | null): void;
  /** World to device pixels for the calls that follow: device = world × scale + offset. Drops local frames. */
  setCamera(scale: number, offsetX: number, offsetY: number): void;
  /** A local frame with its origin at (x, y) of the current one, rotated by `rotation` radians and scaled. */
  push(x: number, y: number, rotation: number, scale: number): void;
  pop(): void;
  rect(x: number, y: number, width: number, height: number, style: ShapeStyle): void;
  roundRect(x: number, y: number, width: number, height: number, radius: number, style: ShapeStyle): void;
  circle(x: number, y: number, radius: number, style: ShapeStyle): void;
  /** Several open or closed paths stroked or filled as one shape: grid lines, hexes, ink. */
  paths(paths: ReadonlyArray<readonly ScenePoint[]>, closed: boolean, style: ShapeStyle): void;
  /** `image` stretched over the rectangle, clipped to `clip` when given. */
  image(image: SurfaceImage, x: number, y: number, width: number, height: number, clip: ImageClip | null): void;
  text(text: string, x: number, y: number, style: TextStyle): void;
  /** The width of `text` in `font`, in the font's own pixels (the camera does not apply). */
  measureText(text: string, font: string): number;
  /** One of Atlas's map icons, `size` wide and centred on (x, y); an unknown name draws nothing. */
  icon(name: string, x: number, y: number, size: number, color: string, alpha: number): void;
  /** An offscreen surface for caching a layer; null when none can be made. */
  createLayer(width: number, height: number): LayerSurface | null;
  /** Draws a cached layer stretched over the rectangle. */
  drawLayer(layer: LayerSurface, x: number, y: number, width: number, height: number): void;
}

export interface LayerSurface extends ViewSurface {
  readonly width: number;
  readonly height: number;
  /** Frees its pixels; it is never drawn again. */
  release(): void;
}
```

Create `src/app/online/view/layers/layerTypes.ts`:

```ts
/** What every layer of the player view gets for one frame. Shared with the web page. */
import type { DecodedImage } from '../../assets/AssetLoader';
import type { PlayerScene } from '../../scene/sceneTypes';
import type { WorldRect } from '../camera';
import type { ViewSurface } from '../ViewSurface';

/**
 * The loaded image for an asset id, or null while it is missing. Looked up at draw time,
 * never kept: images are released when they leave the scene.
 */
export type ImageLookup = (id: string | null) => DecodedImage | null;

export interface LayerFrame {
  scene: PlayerScene;
  images: ImageLookup;
  /** The world area on screen, with a margin; layers skip what lies outside it. */
  visible: WorldRect;
  /** Screen (CSS) pixels per world unit. */
  zoom: number;
  /** World units per device pixel: the thinnest line that shows. */
  pixel: number;
  /** The map's area, or without a map size the scene's content; null for an empty scene. */
  bounds: WorldRect | null;
}

export interface PlayerLayer {
  draw(surface: ViewSurface, frame: LayerFrame): void;
  /** Frees what the layer caches (the fog image). */
  dispose?(): void;
}
```

Create `src/app/online/view/PlayerViewRenderer.ts`:

```ts
/**
 * Draws the presented scene on a `ViewSurface`: one layer per Atlas layer, in Atlas's
 * order (`SCENE_LAYER_ORDER`). It draws at most once per animation frame and only after
 * something changed (scene, camera, images, size), keeps drawing while the camera
 * glides, and draws nothing while the page is hidden. Frames and visibility are injected,
 * so tests drive it. Shared with the web page.
 */
import { SCENE_LAYER_ORDER, type SceneLayer } from '../../pixi/sceneLayerOrder';
import { sceneWorldBounds } from '../preview/previewLayout';
import type { PlayerScene } from '../scene/sceneTypes';
import { visibleArea, type ScreenSize } from './camera';
import type { CameraController } from './CameraController';
import type { ImageLookup, LayerFrame, PlayerLayer } from './layers/layerTypes';
import type { ViewSurface } from './ViewSurface';

/** Outside the map Atlas's canvas is black. */
export const VIEW_BACKGROUND = '#000000';
/** Phones draw at most two device pixels per CSS pixel: sharper costs more than it shows. */
export const PHONE_PIXEL_RATIO_CAP = 2;
/** World area drawn beyond the screen's edges, in CSS pixels, so shapes crossing the edge are drawn whole. */
const VISIBLE_MARGIN = 64;

/** The ratio to draw at: the device's, capped on phones (a coarse primary pointer). */
export function pixelRatioFor(deviceRatio: number, coarsePointer: boolean): number {
  const ratio = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  return coarsePointer ? Math.min(PHONE_PIXEL_RATIO_CAP, ratio) : ratio;
}

export interface PlayerViewRendererOptions {
  surface: ViewSurface;
  camera: CameraController;
  images: ImageLookup;
  /** One per Atlas layer (`createSceneLayers()` on the page); a new Atlas layer fails the build until it has one. */
  layers: Record<SceneLayer, PlayerLayer>;
  requestFrame(draw: () => void): number;
  cancelFrame(handle: number): void;
  isHidden(): boolean;
}

export class PlayerViewRenderer {
  private scene: PlayerScene | null = null;
  private screen: ScreenSize = { width: 0, height: 0 };
  private ratio = 1;
  private frame: number | null = null;

  constructor(private readonly options: PlayerViewRendererOptions) {}

  setScene(scene: PlayerScene | null): void {
    this.scene = scene;
    this.request();
  }

  /** The canvas's CSS size and the pixel ratio to draw at. */
  setSize(screen: ScreenSize, ratio: number): void {
    this.screen = { width: screen.width, height: screen.height };
    this.ratio = ratio;
    this.request();
  }

  /** The camera moved or images arrived or went: draw again. */
  invalidate(): void {
    this.request();
  }

  /** The page was shown or hidden; once shown, what changed meanwhile is drawn. */
  visibilityChanged(): void {
    this.request();
  }

  dispose(): void {
    if (this.frame !== null) this.options.cancelFrame(this.frame);
    this.frame = null;
    for (const name of SCENE_LAYER_ORDER) this.options.layers[name].dispose?.();
  }

  /** Draws one frame now. */
  draw(): void {
    const { surface, camera, layers } = this.options;
    const width = Math.max(1, Math.round(this.screen.width * this.ratio));
    const height = Math.max(1, Math.round(this.screen.height * this.ratio));
    surface.begin(width, height, VIEW_BACKGROUND);
    const scene = this.scene;
    if (!scene || this.screen.width <= 0 || this.screen.height <= 0) return;
    const view = camera.current();
    const scale = view.zoom * this.ratio;
    surface.setCamera(scale, width / 2 - view.centerX * scale, height / 2 - view.centerY * scale);
    const frame: LayerFrame = {
      scene,
      images: this.options.images,
      visible: visibleArea(view, { width: this.screen.width + 2 * VISIBLE_MARGIN, height: this.screen.height + 2 * VISIBLE_MARGIN }),
      zoom: view.zoom,
      pixel: 1 / scale,
      bounds: sceneWorldBounds(scene),
    };
    for (const name of SCENE_LAYER_ORDER) layers[name].draw(surface, frame);
  }

  private request(): void {
    if (this.frame !== null || this.options.isHidden()) return;
    this.frame = this.options.requestFrame(() => {
      this.frame = null;
      this.draw();
      // A glide moves the camera every frame until it arrives.
      if (this.options.camera.isMoving()) this.request();
    });
  }
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/online/cameraController.test.ts tests/unit/online/viewInput.test.ts tests/unit/online/playerViewRenderer.test.ts`
Expected: PASS.

- [ ] **Step 9: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/online/view --max-warnings 0 --suppressions-location eslint.suppressions.json`
Expected: both exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/app/online/view tests/unit/online/cameraController.test.ts tests/unit/online/viewInput.test.ts tests/unit/online/recordingSurface.ts tests/unit/online/playerViewRenderer.test.ts
git commit -m "feat(online): player camera, input and view renderer"
```

---

### Task 4: The layers and the join page

This task adds one player layer per Atlas layer, drawn through `ViewSurface`. It then replaces the preview in the join page with the full-window map:
- a top bar;
- a menu that is a side panel, or a bottom sheet on narrow screens;
- floating **Follow GM** and **Fit map** buttons.

The page's DOM glue lives in small `online-client/*.mts` modules (type-checked by `tsc`, tested under jsdom where it pays), and all logic stays in shared modules.

Rulings used here:
- **1.** Layer order.
- **6.** Neutral condition badges.
- **7.** The phone pixel-ratio cap.
- **8.** Map icons through `Path2D`.
- **10.** Text layout parity.
- **11.** Token sizes, ring and resting UI size.
- **12.** The fog area.

**Files:**
- Create: `src/app/online/view/mapIconPaths.ts`
- Create: `src/app/online/view/layers/mapLayer.ts`, `gridLayer.ts`, `drawingsLayer.ts`, `textsLayer.ts`, `tokensLayer.ts`, `tokenUiDrawing.ts`, `fogLayer.ts`, `sceneLayers.ts`
- Create: `src/app/online/page/pageScreen.ts`
- Modify: `src/app/online/preview/sceneSummary.ts` (add `playerLines`)
- Modify: `src/app/online/preview/previewShapes.ts` (remove `InkStroke`, `TextLabel`, `TokenMarker`, `inkStrokes`, `textLabels`, `tokenMarkers`, `initials`, `DEFAULT_TOKEN_COLOR`, `TOKEN_FILL`), `src/app/online/preview/previewLayout.ts` (remove `PreviewTransform`, `PREVIEW_PADDING`, `fitTransform`)
- Create: `online-client/canvasSurface.mts`, `online-client/mapView.mts`, `online-client/menu.mts`
- Rewrite: `online-client/main.mts`, `online-client/index.html`, `online-client/style.css`
- Delete: `online-client/preview.mts`
- Test: `tests/unit/online/viewLayers.test.ts`, `tests/unit/online/tokensLayer.test.ts`, `tests/unit/online/fogLayer.test.ts`, `tests/unit/online/mapIconPaths.test.ts`, `tests/unit/online/pageScreen.test.ts`, `tests/unit/online/canvasSurface.test.ts`, `tests/unit/online/mapView.test.ts`, `tests/unit/online/scenePreview.test.ts` (modify)

**Interfaces:**
- Consumes:
  - **Task 1:** `SCENE_LAYER_ORDER`, `SceneLayer`; `tokenBarRects`, `barInnerRect`, `barFillRect`, `barTickXs`, `nameplateRect`, `BAR_BORDER`, `BAR_STYLE`, `NAMEPLATE`, `NAMEPLATE_STYLE`, `UiRect`; `CONDITION_BADGE`, `fitBadges`, `badgePositions`; `TEXT_LINE_SPACING`, `textBackground`, `textFontWeight`, `textFontStyle`, `textRotation`, `textScale`; `MIN_HEX_NUMBER_SCREEN_SIZE`.
  - **Task 2:** `SceneCamera`, `PlayerSessionOptions.onCamera`.
  - **Task 3:** `CameraController`, `ViewInput`, `PointerInput`, `PointerKind`, `PlayerViewRenderer`, `pixelRatioFor`, `ViewSurface`, `LayerSurface`, `ShapeStyle`, `TextStyle`, `SurfaceImage`, `ImageClip`, `LayerFrame`, `PlayerLayer`, `ImageLookup`, `intersects`, `intersection`, `WorldRect`, `ScreenPoint`, and the test fixtures `RecordingSurface`, `RecordingLayer`, `fakeFrames`, `decodedImage`.
  - **Existing:** `gridLines`, `fogShapes`, `FogShape` (`preview/previewShapes.ts`); `sceneWorldBounds` (`preview/previewLayout.ts`); `numberHexes`, `hexNumberAnchor`, `hexNumberFontSize`, `DEFAULT_HEX_NUMBER_OPACITY` (`grid/hexNumbering.ts`); `createHexLayout`, `isHexGridType` (`grid/hexGeometry.ts`); `computeTokenPixelSize`, `computeTokenStrokeWidth`, `restingTokenUIScale`; `getTokenRingCenterRadius`; `colors`, `getHealthColor`, `barDimensions` (`styles/designTokens.ts`); `FOG_COLOR` (`pixi/fog/fogRenderUtils.ts`); `MAP_ICON_SVG` (`pixi/mapIcons.ts`); `drawingBounds` (`scene/objectBounds.ts`); `AssetCache`, `AssetLoader`, `AssetsPanel`, `decodeImage`, `createJoinSession`.
- Produces:
  - `mapIconPaths.ts`: `interface IconPath { d: string; fill: boolean }`, `MAP_ICON_BOX = 24`, `mapIconPaths(name): IconPath[] | null`.
  - `layers/mapLayer.ts`: `MAP_PLACEHOLDER = '#26282c'`, `createMapLayer(): PlayerLayer`.
  - `layers/gridLayer.ts`: `MAX_NUMBERED_HEXES = 100_000`, `createGridLayer(): PlayerLayer`.
  - `layers/drawingsLayer.ts`: `createDrawingsLayer(): PlayerLayer`.
  - `layers/textsLayer.ts`: `textFont(text: PlayerText): string`, `createTextsLayer(): PlayerLayer`.
  - `layers/tokensLayer.ts`: `TOKEN_MARKER_COLOR = '#9aa0a6'`, `createTokensLayer(): PlayerLayer`.
  - `layers/tokenUiDrawing.ts`: `NEUTRAL_BADGE_COLOR = '#5b5f6a'`, `NAMEPLATE_FONT`, `cssColor(color: number): string`, `interface TokenUiGeometry { size; cellSize; ringRadius }`, `drawTokenUi(surface, token, geometry): void`.
  - `layers/fogLayer.ts`: `FOG_CACHE_MAX_SIDE = 4096`, `fogArea(scene, shapes): WorldRect | null`, and the class `FogLayer implements PlayerLayer` with `draw`, `dispose` and `rebuilds`.
  - `layers/sceneLayers.ts`: `createSceneLayers(): Record<SceneLayer, PlayerLayer>`.
  - `page/pageScreen.ts`: `type PageScreen = { kind: 'form' } | { kind: 'message'; text } | { kind: 'table'; title; connection }`, `pageScreen(state: PlayerSessionState | null, hasScene: boolean): PageScreen`, `INCOMPLETE_LINK_TEXT`, `NAME_PROBLEM_TEXT`, `NO_CANVAS_TEXT`.
  - `preview/sceneSummary.ts`: `playerLines(players: readonly PresencePlayer[]): string[]`.
  - `online-client/canvasSurface.mts`: `createCanvasSurface(canvas): ViewSurface | null`.
  - `online-client/mapView.mts`: `interface MapViewOptions { canvas; surface; images; viewButtons; followButton; fitButton; frames?; isHidden? }`, and the class `MapView` with methods `setScene(scene)`, `setGmCamera(camera)`, `refresh()` and `measure()`.
  - `online-client/menu.mts`: the class `Menu(button, panel, close)` with `setOpen(open)`.

- [ ] **Step 1: Write the failing layer tests**

Create `tests/unit/online/viewLayers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { gridLines } from '../../../src/app/online/preview/previewShapes';
import type { PlayerGrid } from '../../../src/app/online/scene/sceneTypes';
import { createDrawingsLayer } from '../../../src/app/online/view/layers/drawingsLayer';
import { createGridLayer } from '../../../src/app/online/view/layers/gridLayer';
import { createMapLayer, MAP_PLACEHOLDER } from '../../../src/app/online/view/layers/mapLayer';
import { createTextsLayer } from '../../../src/app/online/view/layers/textsLayer';
import { decodedImage, frame, RecordingSurface } from './recordingSurface';
import { playerScene } from './sceneFixtures';

const text = playerScene().texts.x1!;

describe('map layer', () => {
  it('draws the map image at the map size once it has loaded, a placeholder before', () => {
    const surface = new RecordingSurface();
    const layer = createMapLayer();
    layer.draw(surface, frame(playerScene()));
    expect(surface.calls).toEqual([{ op: 'rect', x: 0, y: 0, width: 1000, height: 800, style: { fill: MAP_PLACEHOLDER } }]);
    surface.clear();
    const art = decodedImage(500, 400);
    layer.draw(surface, frame(playerScene(), { images: (id) => (id === 'map-asset' ? art : null) }));
    expect(surface.calls).toEqual([{ op: 'image', image: art.image, x: 0, y: 0, width: 1000, height: 800, clip: null }]);
  });

  it('draws nothing off screen or without a map size', () => {
    const surface = new RecordingSurface();
    const layer = createMapLayer();
    layer.draw(surface, frame(playerScene(), { visible: { x: 2000, y: 0, width: 100, height: 100 } }));
    layer.draw(surface, frame(playerScene({ map: { asset: 'map-asset', width: 0, height: 0, cellSize: 70 } })));
    expect(surface.calls).toEqual([]);
  });
});

describe('grid layer', () => {
  const grid = playerScene().grid!;

  it('draws square lines over the visible part of the map only', () => {
    const surface = new RecordingSurface();
    const visible = { x: 500, y: -100, width: 1000, height: 300 };
    createGridLayer().draw(surface, frame(playerScene(), { visible }));
    const lines = gridLines(grid, { x: 500, y: 0, width: 500, height: 200 });
    expect(surface.calls).toEqual([{
      op: 'paths', paths: lines!.segments, closed: false, style: { stroke: '#808080', alpha: 0.5, lineWidth: 1, dash: [] },
    }]);
  });

  it('dashes in screen pixels and never draws thinner than a device pixel', () => {
    const surface = new RecordingSurface();
    const dashed: PlayerGrid = { ...grid, lineType: 'dashed', lineWidth: 0.1 };
    createGridLayer().draw(surface, frame(playerScene({ grid: dashed }), { zoom: 2, pixel: 0.25 }));
    expect(surface.ops('paths')[0]?.style).toMatchObject({ dash: [3, 2], lineWidth: 0.25 });
  });

  it('numbers hexes when the GM shows them and they are large enough to read', () => {
    const hexes: PlayerGrid = { ...grid, type: 'hex-vertical', hexNumbers: 'column-row', hexNumberOpacity: 0.8 };
    const surface = new RecordingSurface();
    const layer = createGridLayer();
    layer.draw(surface, frame(playerScene({ grid: hexes })));
    const labels = surface.ops('text');
    expect(labels.length).toBeGreaterThan(10);
    expect(labels[0]?.style).toMatchObject({ align: 'center', alpha: 0.8 });
    expect(labels.every((label) => /^\d{4}$/.test(label.text))).toBe(true);
    surface.clear();
    layer.draw(surface, frame(playerScene({ grid: hexes }), { zoom: 0.5 }));
    expect(surface.ops('text')).toEqual([]);
  });

  it('draws no grid when the GM hides it', () => {
    const surface = new RecordingSurface();
    createGridLayer().draw(surface, frame(playerScene({ grid: null })));
    expect(surface.calls).toEqual([]);
  });
});

describe('drawings layer', () => {
  it('draws ink in its order, icon stamps as icons and single points as dots, skipping erasers and what is off screen', () => {
    const surface = new RecordingSurface();
    const scene = playerScene({
      drawings: {
        b: { type: 'pen', order: 2, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: '#ff0000', width: 4, opacity: 1, icon: null },
        a: { type: 'icon', order: 1, points: [{ x: 50, y: 50 }], color: '#00ff00', width: 70, opacity: 0.5, icon: 'flame' },
        c: { type: 'pen', order: 3, points: [{ x: 20, y: 20 }], color: '#0000ff', width: 6, opacity: 1, icon: null },
        d: { type: 'eraser', order: 4, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: '#000000', width: 10, opacity: 1, icon: null },
        e: { type: 'line', order: 5, points: [{ x: 5000, y: 5000 }, { x: 5100, y: 5000 }], color: '#000000', width: 2, opacity: 1, icon: null },
      },
    });
    createDrawingsLayer().draw(surface, frame(scene));
    expect(surface.calls).toEqual([
      { op: 'icon', name: 'flame', x: 50, y: 50, size: 70, color: '#00ff00', alpha: 0.5 },
      { op: 'paths', paths: [[{ x: 0, y: 0 }, { x: 10, y: 10 }]], closed: false, style: { stroke: '#ff0000', lineWidth: 4, alpha: 1, round: true } },
      { op: 'circle', x: 20, y: 20, radius: 3, style: { fill: '#0000ff', alpha: 1 } },
    ]);
  });
});

describe('texts layer', () => {
  it('draws a text centred on its position, its background grown by the padding at the text opacity', () => {
    const surface = new RecordingSurface();
    const scene = playerScene({ texts: { x1: { ...text, backgroundColor: '#ffffff', padding: 0, opacity: 0.5 } } });
    createTextsLayer().draw(surface, frame(scene));
    expect(surface.calls).toEqual([
      { op: 'push', x: 50, y: 50, rotation: 0, scale: 1 },
      {
        op: 'rect', x: -44, y: expect.closeTo(-22.4), width: 88, height: expect.closeTo(44.8),
        style: { fill: '#ffffff', alpha: 0.5 },
      },
      { op: 'text', text: 'Tavern', x: 0, y: expect.closeTo(0), style: { font: '24px serif', color: '#000000', align: 'center' } },
      { op: 'pop' },
    ]);
  });

  it('rotates, scales and aligns its lines like Atlas, in its bold and italic font', () => {
    const surface = new RecordingSurface();
    const scene = playerScene({ texts: { x1: { ...text, text: 'A\nBB', align: 'left', rotation: 90, scale: 2, bold: true, italic: true } } });
    createTextsLayer().draw(surface, frame(scene));
    expect(surface.ops('push')[0]).toEqual({ op: 'push', x: 50, y: 50, rotation: expect.closeTo(Math.PI / 2), scale: 2 });
    expect(surface.ops('text').map(({ text: line, x, y, style }) => [line, x, y, style.font])).toEqual([
      ['A', -12, expect.closeTo(-14.4), 'italic bold 24px serif'],
      ['BB', -12, expect.closeTo(14.4), 'italic bold 24px serif'],
    ]);
  });

  it('skips texts off screen', () => {
    const surface = new RecordingSurface();
    createTextsLayer().draw(surface, frame(playerScene({ texts: { x1: { ...text, x: 5000 } } })));
    expect(surface.calls).toEqual([]);
  });
});
```

Create `tests/unit/online/tokensLayer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTokensLayer, TOKEN_MARKER_COLOR } from '../../../src/app/online/view/layers/tokensLayer';
import { NEUTRAL_BADGE_COLOR } from '../../../src/app/online/view/layers/tokenUiDrawing';
import type { PlayerToken } from '../../../src/app/online/scene/sceneTypes';
import { decodedImage, frame, RecordingSurface } from './recordingSurface';
import { playerScene, playerToken } from './sceneFixtures';

const art = decodedImage(200, 100);
const images = (id: string | null): typeof art | null => (id === 'asset-1' ? art : null);

function draw(tokens: Record<string, PlayerToken>, withImages = false): RecordingSurface {
  const surface = new RecordingSurface();
  createTokensLayer().draw(surface, frame(playerScene({ tokens }), withImages ? { images } : {}));
  return surface;
}

describe('tokens layer', () => {
  it('clips the art to its circle, cover-fit, and draws the ring on the grid stroke', () => {
    expect(draw({ t1: playerToken() }, true).calls).toEqual([
      { op: 'push', x: 100, y: 100, rotation: 0, scale: 1 },
      { op: 'image', image: art.image, x: -62, y: -31, width: 124, height: 62, clip: { x: 0, y: 0, radius: 31 } },
      { op: 'circle', x: 0, y: 0, radius: 33, style: { stroke: '#ffffff', lineWidth: 4 } },
      { op: 'pop' },
    ]);
  });

  it('draws a marker until the art has loaded, turned by the rotation, without a ring when it is off', () => {
    expect(draw({ t1: playerToken({ rotation: 90, ring: null }) }).calls).toEqual([
      { op: 'push', x: 100, y: 100, rotation: expect.closeTo(Math.PI / 2), scale: 1 },
      { op: 'circle', x: 0, y: 0, radius: 31, style: { fill: TOKEN_MARKER_COLOR } },
      { op: 'pop' },
    ]);
  });

  it('draws the nameplate and the HP and stress bars below the token at the resting UI size', () => {
    const surface = draw({ t1: playerToken({ name: 'Hero', hp: { current: 7, max: 10 }, stress: { current: 2, max: 6 } }) });
    expect(surface.ops('push')[1]).toEqual({ op: 'push', x: 100, y: 131, rotation: 0, scale: 1 });
    const fills = surface.ops('roundRect').flatMap(({ style }) => (style.fill ? [style.fill] : []));
    expect(fills).toEqual(['#2a2a2a', '#1a1a1a', '#22c55e', '#1a1a1a', '#a855f7']);
    const hpFill = surface.ops('roundRect').find(({ style }) => style.fill === '#22c55e')!;
    expect(hpFill).toMatchObject({ x: -30.625, y: 3.375, height: 7.25 });
    expect(hpFill.width).toBeCloseTo(61.25 * 0.7);
    expect(surface.ops('roundRect').find(({ style }) => style.fill === '#2a2a2a')).toMatchObject({ x: -20, y: -14, width: 40, height: 14 });
    expect(surface.ops('text')).toEqual([{ op: 'text', text: 'Hero', x: 0, y: 0, style: expect.objectContaining({ align: 'center', alpha: 0.85 }) }]);
  });

  it('darkens the HP bar of a token at 0 HP and leaves it empty', () => {
    const surface = draw({ t1: playerToken({ hp: { current: 0, max: 10 } }) });
    const fills = surface.ops('roundRect').map(({ style }) => style);
    expect(fills).toContainEqual({ fill: '#000000', alpha: 0.4 });
    expect(fills.some((style) => style.fill === '#ef4444')).toBe(false);
  });

  it('draws neutral condition badges on the ring with the value in a pip, the last slot counting the rest', () => {
    const conditions = ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({ id, value: index === 1 ? 2 : null }));
    const surface = draw({ t1: playerToken({ conditions }) });
    expect(surface.ops('circle').filter(({ style }) => style.fill === NEUTRAL_BADGE_COLOR)).toHaveLength(2);
    expect(surface.ops('text').map(({ text }) => text)).toEqual(['2', '+3']);
    const badges = surface.ops('push').slice(1);
    expect(badges).toHaveLength(3);
    expect(badges.every(({ x, y }) => Math.hypot(x - 100, y - 100) > 32 && Math.hypot(x - 100, y - 100) < 34)).toBe(true);
  });

  it('draws tokens lowest layer first and skips those off screen', () => {
    const surface = draw({
      a: playerToken({ x: 100, layer: 2 }), b: playerToken({ x: 200, layer: 1 }), c: playerToken({ x: 9000, layer: 0 }),
    });
    expect(surface.ops('push').map(({ x }) => x)).toEqual([200, 100]);
  });

  it('never draws a token smaller than a pixel, even under half a cell', () => {
    const [marker] = draw({ t1: playerToken({ size: 0.5 }) }).ops('circle');
    expect(marker?.radius).toBe(0.5);
  });
});
```

Create `tests/unit/online/fogLayer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FOG_COLOR } from '../../../src/app/pixi/fog/fogRenderUtils';
import type { PlayerFogOp, PlayerMap } from '../../../src/app/online/scene/sceneTypes';
import { CameraController } from '../../../src/app/online/view/CameraController';
import { FOG_CACHE_MAX_SIDE, FogLayer } from '../../../src/app/online/view/layers/fogLayer';
import { createSceneLayers } from '../../../src/app/online/view/layers/sceneLayers';
import { PlayerViewRenderer } from '../../../src/app/online/view/PlayerViewRenderer';
import { fakeFrames, frame, RecordingSurface } from './recordingSurface';
import { fogRect, playerScene } from './sceneFixtures';

const MAP: PlayerMap = { asset: null, width: 1000, height: 800, cellSize: 70 };
const fogScene = (fog: Record<string, PlayerFogOp>, map: PlayerMap = MAP) => playerScene({ fog, map });

describe('fog layer', () => {
  it('renders the fog once into an image of the map area and draws it opaque', () => {
    const surface = new RecordingSurface();
    new FogLayer().draw(surface, frame(fogScene({ f1: fogRect(1), f2: fogRect(2, { erase: true, x: 10, y: 10, width: 20, height: 20 }) })));
    const [image] = surface.layers;
    expect([image?.width, image?.height]).toEqual([1000, 800]);
    expect(image?.calls).toEqual([
      { op: 'begin', width: 1000, height: 800, background: null },
      { op: 'camera', scale: 1, offsetX: 0, offsetY: 0 },
      { op: 'rect', x: 0, y: 0, width: 100, height: 100, style: { erase: false, round: true, fill: FOG_COLOR } },
      { op: 'rect', x: 10, y: 10, width: 20, height: 20, style: { erase: true, round: true, fill: FOG_COLOR } },
    ]);
    expect(surface.calls).toEqual([{ op: 'drawLayer', layer: 1, x: 0, y: 0, width: 1000, height: 800 }]);
  });

  it('keeps the image at most 4096 px on its long side', () => {
    const surface = new RecordingSurface();
    new FogLayer().draw(surface, frame(fogScene({ f1: fogRect(1) }, { ...MAP, width: 10_000, height: 5_000 })));
    const [image] = surface.layers;
    expect([image?.width, image?.height]).toEqual([FOG_CACHE_MAX_SIDE, 2048]);
    expect(image?.ops('camera')[0]?.scale).toBeCloseTo(FOG_CACHE_MAX_SIDE / 10_000);
  });

  it('rebuilds the image only when the fog changes, never on a pan or zoom', () => {
    const surface = new RecordingSurface();
    const layer = new FogLayer();
    const scene = fogScene({ f1: fogRect(1) });
    layer.draw(surface, frame(scene));
    layer.draw(surface, frame(scene, { visible: { x: 300, y: 300, width: 200, height: 100 }, zoom: 4 }));
    layer.draw(surface, frame(scene, { zoom: 0.1 }));
    expect(layer.rebuilds).toBe(1);
    layer.draw(surface, frame(fogScene({ ...scene.fog, f2: fogRect(2) })));
    expect(layer.rebuilds).toBe(2);
    expect(surface.layers[0]?.released).toBe(true);
    expect(surface.ops('drawLayer').map(({ layer: id }) => id)).toEqual([1, 1, 1, 2]);
  });

  it('draws brushes, lassos and dots, over the fog itself when the map has no size', () => {
    const surface = new RecordingSurface();
    const fog: Record<string, PlayerFogOp> = {
      b: { type: 'brush', erase: false, order: 1, radius: 10, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      l: { type: 'lasso', erase: false, order: 2, points: [{ x: 200, y: 0 }, { x: 300, y: 0 }, { x: 250, y: 100 }] },
      d: { type: 'brush', erase: true, order: 3, radius: 5, points: [{ x: 50, y: 50 }] },
    };
    new FogLayer().draw(surface, frame(fogScene(fog, { ...MAP, width: 0, height: 0 })));
    expect(surface.ops('drawLayer')[0]).toEqual({ op: 'drawLayer', layer: 1, x: -10, y: -10, width: 310, height: 110 });
    expect(surface.layers[0]?.calls.slice(2)).toEqual([
      { op: 'paths', paths: [[{ x: 0, y: 0 }, { x: 100, y: 0 }]], closed: false, style: { erase: false, round: true, stroke: FOG_COLOR, lineWidth: 20 } },
      { op: 'paths', paths: [[{ x: 200, y: 0 }, { x: 300, y: 0 }, { x: 250, y: 100 }]], closed: true, style: { erase: false, round: true, fill: FOG_COLOR } },
      { op: 'circle', x: 50, y: 50, radius: 5, style: { erase: true, round: true, fill: FOG_COLOR } },
    ]);
  });

  it('draws nothing without fog, and frees the image when disposed', () => {
    const surface = new RecordingSurface();
    const layer = new FogLayer();
    layer.draw(surface, frame(fogScene({})));
    expect(surface.calls).toEqual([]);
    layer.draw(surface, frame(fogScene({ f1: fogRect(1) })));
    layer.dispose();
    expect(surface.layers[0]?.released).toBe(true);
  });

  it('is the last thing the player view draws', () => {
    const surface = new RecordingSurface();
    const frames = fakeFrames();
    const camera = new CameraController({ now: () => 0, onChange: () => {} });
    const renderer = new PlayerViewRenderer({
      surface, camera, images: () => null, layers: createSceneLayers(),
      requestFrame: frames.request, cancelFrame: frames.cancel, isHidden: () => false,
    });
    const scene = playerScene();
    camera.setScreen({ width: 800, height: 600 });
    camera.setScene(scene);
    renderer.setSize({ width: 800, height: 600 }, 1);
    renderer.setScene(scene);
    frames.run();
    expect(surface.calls.at(-1)?.op).toBe('drawLayer');
    expect(surface.ops('text').map(({ text }) => text)).toContain('Tavern');
  });
});
```

Create `tests/unit/online/mapIconPaths.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MAP_ICON_SVG } from '../../../src/app/pixi/mapIcons';
import { mapIconPaths } from '../../../src/app/online/view/mapIconPaths';

describe('map icon paths', () => {
  it('turns every Atlas map icon into path data', () => {
    for (const name of Object.keys(MAP_ICON_SVG)) {
      const paths = mapIconPaths(name);
      expect(paths?.length, name).toBeGreaterThan(0);
      for (const { d } of paths ?? []) expect(d, name).not.toMatch(/NaN|undefined/);
    }
  });

  it('reads rounded rectangles, lines, polylines and filled circles', () => {
    expect(mapIconPaths('lock')?.[0]).toEqual({
      d: 'M 5 11 h 14 a 2 2 0 0 1 2 2 v 7 a 2 2 0 0 1 -2 2 h -14 a 2 2 0 0 1 -2 -2 v -7 a 2 2 0 0 1 2 -2 Z', fill: false,
    });
    const swords = mapIconPaths('swords')?.map(({ d }) => d);
    expect(swords).toContain('M 14.5 17.5 L 3 6 L 3 3 L 6 3 L 17.5 14.5');
    expect(swords).toContain('M 13 19 L 19 13');
    expect(mapIconPaths('key-round')?.[1]).toEqual({ d: 'M 16 7.5 a 0.5 0.5 0 1 0 1 0 a 0.5 0.5 0 1 0 -1 0 Z', fill: true });
  });

  it('knows no other names', () => {
    for (const name of ['nope', '__proto__', 'constructor', 'toString']) expect(mapIconPaths(name), name).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/online/viewLayers.test.ts tests/unit/online/tokensLayer.test.ts tests/unit/online/fogLayer.test.ts tests/unit/online/mapIconPaths.test.ts`
Expected: FAIL. The layer modules and `mapIconPaths` cannot be resolved.

- [ ] **Step 3: Write the icon paths and the layers**

Create `src/app/online/view/mapIconPaths.ts`:

```ts
/**
 * Atlas's map icons (`MAP_ICON_SVG`, Lucide markup on a 24 × 24 grid) as SVG path data,
 * so the player view draws them with `Path2D`. Only Atlas's own markup is read; nothing
 * from the network is ever put into SVG. Shared with the web page.
 */
import { MAP_ICON_SVG } from '../../pixi/mapIcons';

export interface IconPath {
  d: string;
  /** Filled as well as stroked (`fill="currentColor"`). */
  fill: boolean;
}

/** The icons' coordinate box. */
export const MAP_ICON_BOX = 24;

const ELEMENT = /<(path|circle|rect|line|polyline)\b([^>]*?)\/?>/g;
const ATTRIBUTE = /([a-zA-Z-]+)="([^"]*)"/g;

function attributesOf(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const [, key = '', value = ''] of source.matchAll(ATTRIBUTE)) attributes.set(key, value);
  return attributes;
}

function pathData(tag: string, attributes: Map<string, string>): string | null {
  const n = (key: string): number => Number(attributes.get(key) ?? 0);
  switch (tag) {
    case 'path':
      return attributes.get('d') ?? null;
    case 'circle': {
      const [cx, cy, r] = [n('cx'), n('cy'), n('r')];
      return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
    }
    case 'rect': {
      const [x, y, width, height] = [n('x'), n('y'), n('width'), n('height')];
      const r = Math.min(n('rx') || n('ry'), width / 2, height / 2);
      if (r <= 0) return `M ${x} ${y} h ${width} v ${height} h ${-width} Z`;
      const w = width - 2 * r;
      const h = height - 2 * r;
      return `M ${x + r} ${y} h ${w} a ${r} ${r} 0 0 1 ${r} ${r} v ${h} a ${r} ${r} 0 0 1 ${-r} ${r} `
        + `h ${-w} a ${r} ${r} 0 0 1 ${-r} ${-r} v ${-h} a ${r} ${r} 0 0 1 ${r} ${-r} Z`;
    }
    case 'line':
      return `M ${n('x1')} ${n('y1')} L ${n('x2')} ${n('y2')}`;
    case 'polyline': {
      const values = (attributes.get('points') ?? '').trim().split(/[\s,]+/).map(Number);
      const pairs: string[] = [];
      for (let index = 0; index + 1 < values.length; index += 2) {
        const x = values[index];
        const y = values[index + 1];
        if (x !== undefined && y !== undefined) pairs.push(`${x} ${y}`);
      }
      return pairs.length > 0 ? `M ${pairs.join(' L ')}` : null;
    }
    default:
      return null;
  }
}

const cache = new Map<string, IconPath[]>();

/** The icon's paths in its 24 × 24 box; null for a name Atlas does not know. */
export function mapIconPaths(name: string): IconPath[] | null {
  if (!Object.hasOwn(MAP_ICON_SVG, name)) return null;
  const cached = cache.get(name);
  if (cached) return cached;
  const paths: IconPath[] = [];
  for (const [, tag = '', source = ''] of (MAP_ICON_SVG[name] ?? '').matchAll(ELEMENT)) {
    const attributes = attributesOf(source);
    const d = pathData(tag, attributes);
    if (d) paths.push({ d, fill: attributes.get('fill') === 'currentColor' });
  }
  cache.set(name, paths);
  return paths;
}
```

Create `src/app/online/view/layers/mapLayer.ts`:

```ts
/** Atlas's background: the map image at the map's size, a placeholder until it has loaded. */
import { intersects } from '../camera';
import type { PlayerLayer } from './layerTypes';

/** Shown where the map image goes until it has loaded. */
export const MAP_PLACEHOLDER = '#26282c';

export function createMapLayer(): PlayerLayer {
  return {
    draw(surface, frame): void {
      const { map } = frame.scene;
      if (!(map.width > 0) || !(map.height > 0)) return;
      if (!intersects({ x: 0, y: 0, width: map.width, height: map.height }, frame.visible)) return;
      const art = frame.images(map.asset);
      if (art) surface.image(art.image, 0, 0, map.width, map.height, null);
      else surface.rect(0, 0, map.width, map.height, { fill: MAP_PLACEHOLDER });
    },
  };
}
```

Create `src/app/online/view/layers/gridLayer.ts`:

```ts
/**
 * Atlas's grid: square lines or hex outlines over the visible part of the map (Atlas
 * clips its grid to the map), dashed or dotted by line type, and hex numbers when the
 * GM shows them and they are large enough to read.
 */
import { createHexLayout, isHexGridType } from '../../../grid/hexGeometry';
import {
  DEFAULT_HEX_NUMBER_OPACITY, hexNumberAnchor, hexNumberFontSize, MIN_HEX_NUMBER_SCREEN_SIZE, numberHexes, type NumberedHex,
} from '../../../grid/hexNumbering';
import { gridLines } from '../../preview/previewShapes';
import type { PlayerGrid, PlayerMap } from '../../scene/sceneTypes';
import { intersection, type WorldRect } from '../camera';
import type { TextStyle, ViewSurface } from '../ViewSurface';
import type { LayerFrame, PlayerLayer } from './layerTypes';

const DEFAULT_NUMBER_COLOR = '#ffffff';
/** Beyond this many hexes on the map, numbering them costs more than they are worth. */
export const MAX_NUMBERED_HEXES = 100_000;

interface Numbered {
  grid: PlayerGrid;
  width: number;
  height: number;
  hexes: NumberedHex[];
}

export function createGridLayer(): PlayerLayer {
  // Numbering every hex of the map runs once per grid and map size, not per frame.
  let numbered: Numbered | null = null;
  const numbersOf = (grid: PlayerGrid, map: PlayerMap): NumberedHex[] => {
    if (numbered === null || numbered.grid !== grid || numbered.width !== map.width || numbered.height !== map.height) {
      numbered = { grid, width: map.width, height: map.height, hexes: hexNumbersOf(grid, map) };
    }
    return numbered.hexes;
  };
  return {
    draw(surface, frame): void {
      const { grid, map } = frame.scene;
      if (!grid) return;
      const area = map.width > 0 && map.height > 0
        ? intersection(frame.visible, { x: 0, y: 0, width: map.width, height: map.height })
        : frame.visible;
      if (!area) return;
      drawLines(surface, frame, grid, area);
      drawHexNumbers(surface, frame, grid, numbersOf(grid, map));
    },
  };
}

function drawLines(surface: ViewSurface, frame: LayerFrame, grid: PlayerGrid, area: WorldRect): void {
  const lines = gridLines(grid, area);
  if (!lines) return;
  const style = {
    stroke: lines.color,
    alpha: lines.alpha,
    lineWidth: Math.max(lines.width, frame.pixel),
    // The dash pattern is in screen pixels, so dashes keep their look at any zoom.
    dash: lines.dash.map((length) => length / frame.zoom),
  };
  if (lines.segments.length > 0) surface.paths(lines.segments, false, style);
  if (lines.hexes.length > 0) surface.paths(lines.hexes, true, style);
}

function hexNumbersOf(grid: PlayerGrid, map: PlayerMap): NumberedHex[] {
  if (!grid.hexNumbers || !isHexGridType(grid.type) || !(map.width > 0) || !(map.height > 0)) return [];
  if ((map.width * map.height) / (grid.size * grid.size * 0.866) > MAX_NUMBERED_HEXES) return [];
  const layout = createHexLayout(grid.type, grid.size, grid.offsetX, grid.offsetY);
  return numberHexes(layout, { x: 0, y: 0, width: map.width, height: map.height }, grid.hexNumbers);
}

function drawHexNumbers(surface: ViewSurface, frame: LayerFrame, grid: PlayerGrid, hexes: readonly NumberedHex[]): void {
  if (hexes.length === 0 || !isHexGridType(grid.type)) return;
  const layout = createHexLayout(grid.type, grid.size, grid.offsetX, grid.offsetY);
  const size = hexNumberFontSize(layout);
  if (size * frame.zoom < MIN_HEX_NUMBER_SCREEN_SIZE) return;
  const style: TextStyle = {
    font: `bold ${size}px Arial, sans-serif`,
    color: grid.color ?? DEFAULT_NUMBER_COLOR,
    align: 'center',
    alpha: grid.hexNumberOpacity ?? DEFAULT_HEX_NUMBER_OPACITY,
  };
  const { visible } = frame;
  for (const hex of hexes) {
    const at = hexNumberAnchor(layout, hex.center);
    if (at.x < visible.x || at.x > visible.x + visible.width || at.y < visible.y || at.y > visible.y + visible.height) continue;
    surface.text(hex.label, at.x, at.y, style);
  }
}
```

Create `src/app/online/view/layers/drawingsLayer.ts`:

```ts
/**
 * Atlas's drawings: ink in its order and icon stamps, as `DrawingRenderer` draws them.
 * Eraser records are skipped: Atlas's eraser splits or deletes strokes in the store.
 */
import { drawingBounds } from '../../scene/objectBounds';
import { sortedByOrder, type PlayerDrawing } from '../../scene/sceneTypes';
import { intersects } from '../camera';
import type { PlayerLayer } from './layerTypes';

export function createDrawingsLayer(): PlayerLayer {
  // Sorted once per change of the drawings, not on every frame.
  let sorted: { drawings: Readonly<Record<string, PlayerDrawing>>; list: PlayerDrawing[] } | null = null;
  const inOrder = (drawings: Readonly<Record<string, PlayerDrawing>>): PlayerDrawing[] => {
    if (sorted === null || sorted.drawings !== drawings) {
      sorted = { drawings, list: sortedByOrder(drawings, (drawing) => drawing.order).map(([, drawing]) => drawing) };
    }
    return sorted.list;
  };
  return {
    draw(surface, frame): void {
      for (const drawing of inOrder(frame.scene.drawings)) {
        const [first] = drawing.points;
        if (!first || drawing.type === 'eraser' || !intersects(drawingBounds(drawing), frame.visible)) continue;
        if (drawing.type === 'icon') {
          if (drawing.icon !== null) surface.icon(drawing.icon, first.x, first.y, drawing.width, drawing.color, drawing.opacity);
        } else if (drawing.points.length === 1) {
          surface.circle(first.x, first.y, drawing.width / 2, { fill: drawing.color, alpha: drawing.opacity });
        } else {
          surface.paths([drawing.points], false, { stroke: drawing.color, lineWidth: drawing.width, alpha: drawing.opacity, round: true });
        }
      }
    },
  };
}
```

Create `src/app/online/view/layers/textsLayer.ts`:

```ts
/**
 * Atlas's map texts, as `TextRenderer` draws them: centred on their position, rotated
 * and scaled, with an optional background grown by its padding (`textBoxLayout`). Text
 * reaches the surface only through `text`, never as markup.
 */
import {
  TEXT_LINE_SPACING, textBackground, textFontStyle, textFontWeight, textRotation, textScale,
} from '../../../pixi/textBoxLayout';
import type { PlayerText } from '../../scene/sceneTypes';
import { intersects } from '../camera';
import type { ViewSurface } from '../ViewSurface';
import type { PlayerLayer } from './layerTypes';

/** Measured line widths are kept between frames; the store is emptied when it grows past this. */
const MAX_MEASURED = 5000;

/** The CSS font of a text, built from the same fields PIXI uses. */
export function textFont(text: PlayerText): string {
  const style = textFontStyle(text) === 'italic' ? 'italic ' : '';
  const weight = textFontWeight(text) === 'bold' ? 'bold ' : '';
  return `${style}${weight}${text.fontSize}px ${text.fontFamily}`;
}

export function createTextsLayer(): PlayerLayer {
  const widths = new Map<string, number>();
  const measure = (surface: ViewSurface, line: string, font: string): number => {
    const key = `${font}\n${line}`;
    let width = widths.get(key);
    if (width === undefined) {
      if (widths.size >= MAX_MEASURED) widths.clear();
      width = surface.measureText(line, font);
      widths.set(key, width);
    }
    return width;
  };
  return {
    draw(surface, frame): void {
      for (const text of Object.values(frame.scene.texts)) {
        const font = textFont(text);
        const lines = text.text.split('\n');
        const width = lines.reduce((widest, line) => Math.max(widest, measure(surface, line, font)), 0);
        const lineHeight = text.fontSize * TEXT_LINE_SPACING;
        const height = lines.length * lineHeight;
        const box = { x: -width / 2, y: -height / 2, width, height };
        const background = textBackground(text, box);
        const outer = background ?? box;
        const scale = textScale(text.scale);
        // Half the diagonal holds the box at any rotation.
        const reach = (Math.hypot(outer.width, outer.height) / 2) * scale;
        if (!intersects({ x: text.x - reach, y: text.y - reach, width: reach * 2, height: reach * 2 }, frame.visible)) continue;
        surface.push(text.x, text.y, textRotation(text.rotation), scale);
        if (background) {
          const style = { fill: background.color, alpha: background.alpha };
          if (background.radius) surface.roundRect(background.x, background.y, background.width, background.height, background.radius, style);
          else surface.rect(background.x, background.y, background.width, background.height, style);
        }
        const x = text.align === 'left' ? box.x : text.align === 'right' ? box.x + box.width : 0;
        lines.forEach((line, index) => {
          surface.text(line, x, box.y + lineHeight * (index + 0.5), { font, color: text.color, align: text.align });
        });
        surface.pop();
      }
    },
  };
}
```

Create `src/app/online/view/layers/tokenUiDrawing.ts`:

```ts
/**
 * A token's resource bars, nameplate and condition badges, laid out by the modules
 * Atlas's `TokenUIRenderer` and `ConditionBadgeRing` use, at Atlas's resting token UI
 * size. Players receive condition ids and values only, so badges are neutral discs
 * with the value in a pip.
 */
import { badgePositions, CONDITION_BADGE, fitBadges } from '../../../pixi/token-renderer/conditionBadgeLayout';
import { restingTokenUIScale } from '../../../pixi/token-renderer/tokenSizing';
import {
  BAR_BORDER, BAR_STYLE, barFillRect, barInnerRect, barTickXs, NAMEPLATE, NAMEPLATE_STYLE, nameplateRect, tokenBarRects,
  type UiRect,
} from '../../../pixi/token-renderer/tokenUiLayout';
import { barDimensions, colors, getHealthColor } from '../../../styles/designTokens';
import type { PlayerCondition, PlayerResource, PlayerToken } from '../../scene/sceneTypes';
import type { ViewSurface } from '../ViewSurface';

/** Condition badges without their definitions: one neutral colour for all. */
export const NEUTRAL_BADGE_COLOR = '#5b5f6a';
export const NAMEPLATE_FONT = `${NAMEPLATE.fontWeight} ${NAMEPLATE.fontSize}px ${NAMEPLATE.fontFamily}`;
const BADGE_TEXT = '#ffffff';

/** 0xRRGGBB as a CSS colour. */
export function cssColor(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

export interface TokenUiGeometry {
  /** The token's sprite size in world units. */
  size: number;
  cellSize: number;
  /** The centre of the ring band, from the token's centre. */
  ringRadius: number;
}

export function drawTokenUi(surface: ViewSurface, token: PlayerToken, geometry: TokenUiGeometry): void {
  const scale = restingTokenUIScale(geometry.cellSize);
  if (token.hp || token.stress || token.name) {
    // Anchored on the token's bottom edge, in UI units, like Atlas's `belowToken` container.
    surface.push(token.x, token.y + geometry.size / 2, 0, scale);
    if (token.name) drawNameplate(surface, token.name);
    drawBars(surface, token.hp, token.stress);
    surface.pop();
  }
  if (token.conditions.length > 0) drawBadges(surface, token, geometry.ringRadius, scale);
}

const share = (resource: PlayerResource): number =>
  (resource.max > 0 ? Math.max(0, Math.min(1, resource.current / resource.max)) : 0);

function drawBars(surface: ViewSurface, hp: PlayerResource | null, stress: PlayerResource | null): void {
  const bars = tokenBarRects(hp !== null, stress !== null);
  if (hp && bars.hp) {
    const filled = share(hp);
    drawBar(surface, bars.hp, filled, cssColor(getHealthColor(filled * 100)));
    if (hp.current <= 0) {
      surface.roundRect(bars.hp.x, bars.hp.y, bars.hp.width, bars.hp.height, barDimensions.token.radius,
        { fill: '#000000', alpha: BAR_STYLE.defeatedAlpha });
    }
  }
  if (stress && bars.stress) drawBar(surface, bars.stress, share(stress), cssColor(colors.stress.fill));
}

function drawBar(surface: ViewSurface, bar: UiRect, filled: number, color: string): void {
  surface.roundRect(bar.x, bar.y, bar.width, bar.height, bar.height / 2, { stroke: cssColor(BAR_STYLE.border), lineWidth: BAR_BORDER });
  const inner = barInnerRect(bar);
  surface.roundRect(inner.x, inner.y, inner.width, inner.height, inner.height / 2, { fill: cssColor(BAR_STYLE.inside) });
  const ticks = barTickXs(inner).map((x) => [{ x, y: inner.y + 1 }, { x, y: inner.y + inner.height - 1 }]);
  surface.paths(ticks, false, { stroke: cssColor(BAR_STYLE.tick), lineWidth: BAR_STYLE.tickWidth, alpha: BAR_STYLE.tickAlpha });
  const fill = barFillRect(inner);
  if (filled > 0) surface.roundRect(fill.x, fill.y, fill.width * filled, fill.height, fill.height / 2, { fill: color });
}

/** Nameplate widths by name, measured once, since the font never changes; emptied when it grows past this. */
const MAX_MEASURED_NAMES = 2000;
const nameWidths = new Map<string, number>();

function nameWidth(surface: ViewSurface, name: string): number {
  let width = nameWidths.get(name);
  if (width === undefined) {
    if (nameWidths.size >= MAX_MEASURED_NAMES) nameWidths.clear();
    width = surface.measureText(name, NAMEPLATE_FONT);
    nameWidths.set(name, width);
  }
  return width;
}

function drawNameplate(surface: ViewSurface, name: string): void {
  const badge = nameplateRect(nameWidth(surface, name));
  const plate = NAMEPLATE_STYLE.dark;
  surface.roundRect(badge.x, badge.y, badge.width, badge.height, badge.height / 2, { fill: cssColor(plate.fill) });
  surface.roundRect(badge.x, badge.y, badge.width, badge.height, badge.height / 2,
    { stroke: cssColor(plate.border), lineWidth: NAMEPLATE_STYLE.borderWidth, alpha: plate.borderAlpha });
  surface.push(0, badge.textY, 0, NAMEPLATE.textScale);
  surface.text(name, 0, 0, { font: NAMEPLATE_FONT, color: cssColor(NAMEPLATE_STYLE.text), align: 'center', alpha: NAMEPLATE.textAlpha });
  surface.pop();
}

function drawBadges(surface: ViewSurface, token: PlayerToken, ringRadius: number, scale: number): void {
  const { shown, overflow } = fitBadges(token.conditions, ringRadius, scale);
  const badges: Array<PlayerCondition | null> = overflow > 0 ? [...shown, null] : shown;
  const positions = badgePositions(badges.length, ringRadius, scale);
  badges.forEach((condition, index) => {
    const at = positions[index];
    if (!at) return;
    surface.push(token.x + at.x, token.y + at.y, 0, scale);
    if (condition) drawBadge(surface, NEUTRAL_BADGE_COLOR, null, condition.value);
    else drawBadge(surface, cssColor(CONDITION_BADGE.overflowColor), `+${overflow}`, null);
    surface.pop();
  });
}

function drawBadge(surface: ViewSurface, color: string, label: string | null, value: number | null): void {
  const { radius, bezelWidth, bezelColor, pipShare, pipOffset, pipColor } = CONDITION_BADGE;
  surface.circle(0, 0, radius + bezelWidth, { fill: cssColor(bezelColor) });
  surface.circle(0, 0, radius, { fill: color });
  if (label !== null) surface.text(label, 0, 0, { font: `bold ${radius}px system-ui, sans-serif`, color: BADGE_TEXT, align: 'center' });
  if (value === null) return;
  const pip = radius * pipShare;
  const at = radius * pipOffset;
  surface.circle(at, at, pip + bezelWidth * 0.75, { fill: cssColor(bezelColor) });
  surface.circle(at, at, pip, { fill: cssColor(pipColor) });
  surface.text(String(value), at, at, { font: `bold ${pip * 1.4}px system-ui, sans-serif`, color: BADGE_TEXT, align: 'center' });
}
```

Create `src/app/online/view/layers/tokensLayer.ts`:

```ts
/**
 * Atlas's tokens as the player window shows them, lowest layer first: the art clipped
 * to its circle (a marker until it has loaded) and turned by the token's rotation, the
 * ring when the token has one, then its bars, nameplate and condition badges.
 */
import { getTokenRingCenterRadius } from '../../../pixi/token-renderer/tokenRingMetrics';
import { computeTokenPixelSize, computeTokenStrokeWidth } from '../../../pixi/token-renderer/tokenSizing';
import type { PlayerToken } from '../../scene/sceneTypes';
import { intersects } from '../camera';
import type { ViewSurface } from '../ViewSurface';
import type { LayerFrame, PlayerLayer } from './layerTypes';
import { drawTokenUi } from './tokenUiDrawing';

/** The stand-in drawn until a token's art has loaded. */
export const TOKEN_MARKER_COLOR = '#9aa0a6';

export function createTokensLayer(): PlayerLayer {
  // Sorted once per change of the tokens, not on every frame.
  let sorted: { tokens: Readonly<Record<string, PlayerToken>>; list: PlayerToken[] } | null = null;
  const byLayer = (tokens: Readonly<Record<string, PlayerToken>>): PlayerToken[] => {
    if (sorted === null || sorted.tokens !== tokens) sorted = { tokens, list: Object.values(tokens).sort((a, b) => a.layer - b.layer) };
    return sorted.list;
  };
  return {
    draw(surface, frame): void {
      const cellSize = frame.scene.map.cellSize;
      const stroke = computeTokenStrokeWidth(cellSize);
      for (const token of byLayer(frame.scene.tokens)) {
        // Never 0 or negative: Atlas's formula gives nothing at half a cell or less.
        const size = Math.max(1, computeTokenPixelSize(cellSize, token.size));
        // The art, its ring, and the bars and badges around it.
        const reach = size / 2 + stroke + cellSize;
        if (!intersects({ x: token.x - reach, y: token.y - reach, width: reach * 2, height: reach * 2 }, frame.visible)) continue;
        const ringRadius = getTokenRingCenterRadius(size, stroke, 1);
        drawArt(surface, frame, token, size, stroke, ringRadius);
        drawTokenUi(surface, token, { size, cellSize, ringRadius });
      }
    },
  };
}

function drawArt(surface: ViewSurface, frame: LayerFrame, token: PlayerToken, size: number, stroke: number, ringRadius: number): void {
  const radius = size / 2;
  const art = frame.images(token.image);
  surface.push(token.x, token.y, (token.rotation * Math.PI) / 180, 1);
  if (art) {
    // Cover-fit: the art fills the circle and keeps its proportions.
    const scale = Math.max(size / art.width, size / art.height);
    const width = art.width * scale;
    const height = art.height * scale;
    surface.image(art.image, -width / 2, -height / 2, width, height, { x: 0, y: 0, radius });
  } else {
    surface.circle(0, 0, radius, { fill: TOKEN_MARKER_COLOR });
  }
  if (token.ring !== null) surface.circle(0, 0, ringRadius, { stroke: token.ring, lineWidth: stroke });
  surface.pop();
}
```

Create `src/app/online/view/layers/fogLayer.ts`:

```ts
/**
 * Atlas's fog, drawn last and opaque. The fog is rendered once into a cached image of
 * the map area (at most 4096 px on its long side) and redrawn only when the fog
 * changes, so panning and zooming over thousands of strokes stays cheap. Erasing cuts
 * out of the image like Atlas's compositor (`destination-out`).
 */
import { FOG_COLOR } from '../../../pixi/fog/fogRenderUtils';
import { fogShapes, type FogShape } from '../../preview/previewShapes';
import type { PlayerFogOp, PlayerScene } from '../../scene/sceneTypes';
import { intersects, type WorldRect } from '../camera';
import type { LayerSurface, ViewSurface } from '../ViewSurface';
import type { LayerFrame, PlayerLayer } from './layerTypes';

/** The fog image's long side, in pixels, at most. */
export const FOG_CACHE_MAX_SIDE = 4096;

interface FogCache {
  fog: Readonly<Record<string, PlayerFogOp>>;
  mapWidth: number;
  mapHeight: number;
  area: WorldRect | null;
  layer: LayerSurface | null;
}

/** The fog image's world area: the map, or without a map size the extent of the fog itself. */
export function fogArea(scene: PlayerScene, shapes: readonly FogShape[]): WorldRect | null {
  if (scene.map.width > 0 && scene.map.height > 0) return { x: 0, y: 0, width: scene.map.width, height: scene.map.height };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const add = (x: number, y: number, pad: number): void => {
    left = Math.min(left, x - pad);
    top = Math.min(top, y - pad);
    right = Math.max(right, x + pad);
    bottom = Math.max(bottom, y + pad);
  };
  for (const shape of shapes) {
    if (shape.kind === 'rect') {
      add(shape.x, shape.y, 0);
      add(shape.x + shape.width, shape.y + shape.height, 0);
    } else {
      const pad = shape.kind === 'stroke' ? shape.width / 2 : 0;
      for (const point of shape.points) add(point.x, point.y, pad);
    }
  }
  return left < right && top < bottom ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

export class FogLayer implements PlayerLayer {
  private cache: FogCache | null = null;
  /** How many times the fog image was painted; tests read it. */
  rebuilds = 0;

  draw(surface: ViewSurface, frame: LayerFrame): void {
    const { fog, map } = frame.scene;
    const cache = this.cache;
    if (!cache || cache.fog !== fog || cache.mapWidth !== map.width || cache.mapHeight !== map.height) this.rebuild(surface, frame.scene);
    const area = this.cache?.area ?? null;
    const layer = this.cache?.layer ?? null;
    if (area && layer && intersects(area, frame.visible)) surface.drawLayer(layer, area.x, area.y, area.width, area.height);
  }

  dispose(): void {
    this.cache?.layer?.release();
    this.cache = null;
  }

  private rebuild(surface: ViewSurface, scene: PlayerScene): void {
    this.dispose();
    const shapes = fogShapes(scene.fog);
    const area = shapes.length > 0 ? fogArea(scene, shapes) : null;
    const layer = area ? this.paint(surface, shapes, area) : null;
    this.cache = { fog: scene.fog, mapWidth: scene.map.width, mapHeight: scene.map.height, area, layer };
  }

  private paint(surface: ViewSurface, shapes: readonly FogShape[], area: WorldRect): LayerSurface | null {
    const scale = Math.min(1, FOG_CACHE_MAX_SIDE / Math.max(area.width, area.height));
    const width = Math.max(1, Math.round(area.width * scale));
    const height = Math.max(1, Math.round(area.height * scale));
    const layer = surface.createLayer(width, height);
    if (!layer) return null;
    this.rebuilds++;
    layer.begin(width, height, null);
    layer.setCamera(scale, 0 - area.x * scale, 0 - area.y * scale);
    for (const shape of shapes) paintShape(layer, shape);
    return layer;
  }
}

function paintShape(surface: ViewSurface, shape: FogShape): void {
  const base = { erase: shape.erase, round: true };
  if (shape.kind === 'rect') {
    surface.rect(shape.x, shape.y, shape.width, shape.height, { ...base, fill: FOG_COLOR });
    return;
  }
  if (shape.kind === 'polygon') {
    surface.paths([shape.points], true, { ...base, fill: FOG_COLOR });
    return;
  }
  const [only] = shape.points;
  if (shape.points.length === 1 && only) surface.circle(only.x, only.y, shape.width / 2, { ...base, fill: FOG_COLOR });
  else surface.paths([shape.points], false, { ...base, stroke: FOG_COLOR, lineWidth: shape.width });
}
```

Create `src/app/online/view/layers/sceneLayers.ts`:

```ts
/**
 * The player view's layers, one per Atlas layer in `SCENE_LAYER_ORDER`: a layer added
 * to Atlas's list fails the build here until the player view has one.
 */
import type { SceneLayer } from '../../../pixi/sceneLayerOrder';
import { createDrawingsLayer } from './drawingsLayer';
import { FogLayer } from './fogLayer';
import { createGridLayer } from './gridLayer';
import type { PlayerLayer } from './layerTypes';
import { createMapLayer } from './mapLayer';
import { createTextsLayer } from './textsLayer';
import { createTokensLayer } from './tokensLayer';

export function createSceneLayers(): Record<SceneLayer, PlayerLayer> {
  return {
    map: createMapLayer(),
    grid: createGridLayer(),
    tokens: createTokensLayer(),
    texts: createTextsLayer(),
    drawings: createDrawingsLayer(),
    fog: new FogLayer(),
  };
}
```

- [ ] **Step 4: Run the layer tests to verify they pass**

Run: `npx vitest run tests/unit/online/viewLayers.test.ts tests/unit/online/tokensLayer.test.ts tests/unit/online/fogLayer.test.ts tests/unit/online/mapIconPaths.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing page tests**

Create `tests/unit/online/pageScreen.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PlayerSessionState } from '../../../src/app/online/PlayerSession';
import { pageScreen } from '../../../src/app/online/page/pageScreen';

const state = (overrides: Partial<PlayerSessionState>): PlayerSessionState => ({
  status: 'connecting', playerId: null, title: null, players: [], reason: null, ...overrides,
});
const UNREACHABLE = "Couldn't connect. Check the link, or your GM may need to add a relay server in Atlas settings.";

describe('join page screens', () => {
  it('shows the name form before joining', () => {
    expect(pageScreen(null, false)).toEqual({ kind: 'form' });
  });

  it('shows full-screen messages while connecting, waiting, refused or ended', () => {
    expect(pageScreen(state({ status: 'connecting' }), false)).toEqual({ kind: 'message', text: 'Connecting…' });
    expect(pageScreen(state({ status: 'waiting' }), false)).toEqual({ kind: 'message', text: 'Waiting for the GM to let you in…' });
    expect(pageScreen(state({ status: 'admitted', title: 'Vault' }), false))
      .toEqual({ kind: 'message', text: 'Connected to Vault. Waiting for the GM to show a scene.' });
    expect(pageScreen(state({ status: 'denied', reason: 'kicked' }), true)).toEqual({ kind: 'message', text: 'The GM removed you from the session.' });
    expect(pageScreen(state({ status: 'lost', reason: 'ended' }), true)).toEqual({ kind: 'message', text: 'The session ended.' });
    expect(pageScreen(state({ status: 'lost', reason: 'something-new' }), false)).toEqual({ kind: 'message', text: UNREACHABLE });
  });

  it('shows the table with a scene, also while reconnecting', () => {
    expect(pageScreen(state({ status: 'admitted', title: 'Vault' }), true)).toEqual({ kind: 'table', title: 'Vault', connection: 'Connected' });
    expect(pageScreen(state({ status: 'connecting', title: 'Vault' }), true)).toEqual({ kind: 'table', title: 'Vault', connection: 'Reconnecting…' });
    expect(pageScreen(state({ status: 'admitted' }), true)).toMatchObject({ kind: 'table', title: 'the table' });
  });
});
```

In `tests/unit/online/scenePreview.test.ts`, add `playerLines` to the `sceneSummary` import and this test inside `describe('scene summary', …)`:

```ts
  it('lists the players, marking the away ones', () => {
    expect(playerLines([
      { playerId: 'a', name: 'Anna', connected: true },
      { playerId: 'b', name: 'Bob', connected: false },
    ])).toEqual(['Anna', 'Bob (away)']);
  });
```

Create `tests/unit/online/canvasSurface.test.ts`. jsdom has no canvas, so the test hands the surface a context that records what is called and set.

```ts
import { describe, expect, it } from 'vitest';
import { createCanvasSurface } from '../../../online-client/canvasSurface.mts';

function fakeCanvas(): { canvas: HTMLCanvasElement; calls: string[] } {
  const calls: string[] = [];
  const fields: Record<string, unknown> = {};
  const context = new Proxy(fields, {
    get: (target, key: string) => (key in target ? target[key] : (...args: unknown[]): unknown => {
      calls.push(`${key}(${args.map((arg) => (typeof arg === 'number' || typeof arg === 'string' ? arg : typeof arg)).join(',')})`);
      return key === 'measureText' ? { width: 42 } : undefined;
    }),
    set: (target, key: string, value: unknown) => {
      target[key] = value;
      calls.push(`${key}=${String(value)}`);
      return true;
    },
  });
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

describe('canvas surface', () => {
  it('sizes the canvas and fills the background', () => {
    const { canvas, calls } = fakeCanvas();
    createCanvasSurface(canvas)!.begin(200, 100, '#000000');
    expect([canvas.width, canvas.height]).toEqual([200, 100]);
    expect(calls).toEqual(expect.arrayContaining(['fillStyle=#000000', 'fillRect(0,0,200,100)']));
  });

  it('erases with destination-out, and strokes ink with round caps', () => {
    const { canvas, calls } = fakeCanvas();
    const surface = createCanvasSurface(canvas)!;
    surface.circle(1, 2, 3, { fill: '#000000', erase: true });
    expect(calls).toEqual(expect.arrayContaining(['globalCompositeOperation=destination-out', `arc(1,2,3,0,${Math.PI * 2})`, 'fill()']));
    calls.length = 0;
    surface.paths([[{ x: 0, y: 0 }, { x: 5, y: 5 }]], false, { stroke: '#ff0000', lineWidth: 4, round: true });
    expect(calls).toEqual(expect.arrayContaining(['lineCap=round', 'moveTo(0,0)', 'lineTo(5,5)', 'lineWidth=4', 'stroke()']));
  });

  it('clips art to its circle, and never draws a negative radius', () => {
    const { canvas, calls } = fakeCanvas();
    const surface = createCanvasSurface(canvas)!;
    surface.image({} as ImageBitmap, -5, -5, 10, 10, { x: 0, y: 0, radius: 5 });
    expect(calls.indexOf('clip()')).toBeLessThan(calls.indexOf('drawImage(object,-5,-5,10,10)'));
    surface.circle(0, 0, -3, { fill: '#000000' });
    expect(calls).toContain(`arc(0,0,0,0,${Math.PI * 2})`);
  });

  it('draws text only through fillText, centred vertically, and measures it in its font', () => {
    const { canvas, calls } = fakeCanvas();
    const surface = createCanvasSurface(canvas)!;
    surface.text('<b>x</b>', 1, 2, { font: '12px serif', color: '#ffffff', align: 'center' });
    expect(calls).toEqual(expect.arrayContaining(['textBaseline=middle', 'fillText(<b>x</b>,1,2)']));
    expect(surface.measureText('abc', '12px serif')).toBe(42);
  });

  it('draws nothing for an icon Atlas does not know', () => {
    const { canvas, calls } = fakeCanvas();
    createCanvasSurface(canvas)!.icon('nope', 0, 0, 10, '#ffffff', 1);
    expect(calls).toEqual([]);
  });
});
```

Create `tests/unit/online/mapView.test.ts`. jsdom has no `PointerEvent`, so the test dispatches `MouseEvent`s named like pointer events, carrying `pointerId` and `pointerType`.

```ts
import { describe, expect, it } from 'vitest';
import { MapView } from '../../../online-client/mapView.mts';
import { fakeFrames, RecordingSurface } from './recordingSurface';
import { playerScene } from './sceneFixtures';

function pointer(target: EventTarget, type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
  target.dispatchEvent(event);
}

function setup() {
  document.body.innerHTML = [
    '<section><canvas id="map"></canvas>',
    '<div id="view-buttons" hidden><button id="follow-gm" type="button">Follow GM</button>',
    '<button id="fit-map" type="button">Fit map</button></div>',
    '<button id="menu-button" type="button">Menu</button></section>',
  ].join('');
  const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const canvas = element<HTMLCanvasElement>('map');
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const frames = fakeFrames();
  const surface = new RecordingSurface();
  const view = new MapView({
    canvas, surface, images: () => null, frames, isHidden: () => false,
    viewButtons: element('view-buttons'), followButton: element('follow-gm'), fitButton: element('fit-map'),
  });
  return { view, canvas, surface, frames, buttons: element('view-buttons'), follow: element<HTMLButtonElement>('follow-gm'), menu: element('menu-button') };
}

describe('MapView', () => {
  it('breaks away on a drag on the map, and Follow GM brings it back', () => {
    const t = setup();
    t.view.setScene(playerScene());
    expect(t.buttons.hidden).toBe(true);
    pointer(t.canvas, 'pointerdown', 100, 100);
    pointer(t.canvas, 'pointermove', 160, 100);
    pointer(t.canvas, 'pointerup', 160, 100);
    expect(t.buttons.hidden).toBe(false);
    t.follow.click();
    expect(t.buttons.hidden).toBe(true);
  });

  it('does not move the map for a gesture that starts on a button', () => {
    const t = setup();
    t.view.setScene(playerScene());
    pointer(t.menu, 'pointerdown', 100, 100);
    pointer(t.menu, 'pointermove', 300, 100);
    pointer(t.canvas, 'pointermove', 320, 100);
    pointer(t.canvas, 'pointerup', 320, 100);
    expect(t.buttons.hidden).toBe(true);
  });

  it('draws the scene in the next frame at the canvas size', () => {
    const t = setup();
    t.view.setScene(playerScene());
    t.frames.run();
    expect(t.surface.ops('begin')[0]).toMatchObject({ width: 800, height: 600 });
    expect(t.surface.ops('drawLayer')).toHaveLength(1);
  });

  it('hides Follow GM and Fit map when no scene is shown', () => {
    const t = setup();
    t.view.setScene(playerScene());
    pointer(t.canvas, 'pointerdown', 100, 100);
    pointer(t.canvas, 'pointermove', 160, 100);
    t.view.setScene(null);
    expect(t.buttons.hidden).toBe(true);
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run tests/unit/online/pageScreen.test.ts tests/unit/online/scenePreview.test.ts tests/unit/online/canvasSurface.test.ts tests/unit/online/mapView.test.ts`
Expected: FAIL. `pageScreen`, `playerLines`, `canvasSurface.mts` and `mapView.mts` do not exist.

- [ ] **Step 7: Write the page modules**

Create `src/app/online/page/pageScreen.ts`:

```ts
/**
 * What the join page shows for the session: the name form, a full-screen message
 * (connecting, waiting to be let in or for a scene, refused, ended), or the table with
 * the map. A player who was in keeps the map while reconnecting. Pure; the page shows
 * the texts through `textContent`. Shared with the web page.
 */
import type { PlayerSessionState } from '../PlayerSession';

export type PageScreen =
  | { kind: 'form' }
  | { kind: 'message'; text: string }
  | { kind: 'table'; title: string; connection: string };

export const INCOMPLETE_LINK_TEXT = 'This link is incomplete. Ask your GM for the join link again.';
export const NAME_PROBLEM_TEXT = 'Enter a name of up to 40 characters.';
export const NO_CANVAS_TEXT = "This browser can't draw the map. Try another browser.";

const DENIED_TEXT = 'The GM did not let you in.';
const UNREACHABLE_TEXT = "Couldn't connect. Check the link, or your GM may need to add a relay server in Atlas settings.";
const REASONS: Record<string, string> = {
  denied: DENIED_TEXT,
  kicked: 'The GM removed you from the session.',
  full: 'The session is full.',
  version: 'This page is out of date for your GM\'s Atlas. Ask them for a new link.',
  ended: 'The session ended.',
  replaced: 'You joined from another tab.',
  unreachable: UNREACHABLE_TEXT,
  'connection-lost': 'Lost the connection to your GM. Reload the page to try again.',
};
const DEFAULT_TITLE = 'the table';

export function pageScreen(state: PlayerSessionState | null, hasScene: boolean): PageScreen {
  if (!state) return { kind: 'form' };
  const title = state.title ?? DEFAULT_TITLE;
  switch (state.status) {
    case 'denied':
      return { kind: 'message', text: REASONS[state.reason ?? 'denied'] ?? DENIED_TEXT };
    case 'lost':
      return { kind: 'message', text: REASONS[state.reason ?? 'unreachable'] ?? UNREACHABLE_TEXT };
    case 'waiting':
      return { kind: 'message', text: 'Waiting for the GM to let you in…' };
    case 'connecting':
      return hasScene ? { kind: 'table', title, connection: 'Reconnecting…' } : { kind: 'message', text: 'Connecting…' };
    case 'admitted':
      return hasScene
        ? { kind: 'table', title, connection: 'Connected' }
        : { kind: 'message', text: `Connected to ${title}. Waiting for the GM to show a scene.` };
  }
}
```

In `src/app/online/preview/sceneSummary.ts`, add `import type { PresencePlayer } from '../protocol';` and:

```ts
/** The players in the session, the away ones marked. */
export function playerLines(players: readonly PresencePlayer[]): string[] {
  return players.map((player) => (player.connected ? player.name : `${player.name} (away)`));
}
```

Create `online-client/canvasSurface.mts`:

```ts
// online-client/canvasSurface.mts
/**
 * The player view's drawing interface (`ViewSurface`) on a 2D canvas. Colours and
 * text come from the network: they only reach `fillStyle`, `strokeStyle` and
 * `fillText`, which ignore invalid values and never interpret markup. Map icons are
 * drawn from Atlas's own markup through `Path2D`.
 */
import type { ScenePoint } from '../src/app/online/scene/sceneTypes';
import { MAP_ICON_BOX, mapIconPaths } from '../src/app/online/view/mapIconPaths';
import type { ImageClip, LayerSurface, ShapeStyle, SurfaceImage, TextStyle, ViewSurface } from '../src/app/online/view/ViewSurface';

interface IconShape {
  path: Path2D;
  fill: boolean;
}

/** Only Atlas's own icons are cached, so names from the network cannot grow it. */
const icons = new Map<string, IconShape[]>();

function iconShapes(name: string): IconShape[] | null {
  const paths = mapIconPaths(name);
  if (!paths) return null;
  let shapes = icons.get(name);
  if (!shapes) {
    shapes = paths.map(({ d, fill }) => ({ path: new Path2D(d), fill }));
    icons.set(name, shapes);
  }
  return shapes;
}

function trace(context: CanvasRenderingContext2D, points: readonly ScenePoint[], closed: boolean): void {
  const [first, ...rest] = points;
  if (!first) return;
  context.moveTo(first.x, first.y);
  for (const point of rest) context.lineTo(point.x, point.y);
  if (closed) context.closePath();
}

class CanvasSurface implements ViewSurface {
  private depth = 0;

  constructor(readonly canvas: HTMLCanvasElement, protected readonly context: CanvasRenderingContext2D) {}

  begin(width: number, height: number, background: string | null): void {
    // Assigning a size clears and reallocates the canvas, so only when it changed.
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.unwind();
    const context = this.context;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, width, height);
    if (background !== null) {
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
    }
  }

  setCamera(scale: number, offsetX: number, offsetY: number): void {
    this.unwind();
    this.context.setTransform(scale, 0, 0, scale, offsetX, offsetY);
  }

  push(x: number, y: number, rotation: number, scale: number): void {
    const context = this.context;
    context.save();
    this.depth++;
    context.translate(x, y);
    if (rotation !== 0) context.rotate(rotation);
    if (scale !== 1) context.scale(scale, scale);
  }

  pop(): void {
    if (this.depth === 0) return;
    this.depth--;
    this.context.restore();
  }

  rect(x: number, y: number, width: number, height: number, style: ShapeStyle): void {
    this.shape(style, () => this.context.rect(x, y, width, height));
  }

  roundRect(x: number, y: number, width: number, height: number, radius: number, style: ShapeStyle): void {
    this.shape(style, () => this.context.roundRect(x, y, width, height, Math.max(0, Math.min(radius, width / 2, height / 2))));
  }

  circle(x: number, y: number, radius: number, style: ShapeStyle): void {
    this.shape(style, () => this.context.arc(x, y, Math.max(0, radius), 0, Math.PI * 2));
  }

  paths(paths: ReadonlyArray<readonly ScenePoint[]>, closed: boolean, style: ShapeStyle): void {
    this.shape(style, () => {
      for (const points of paths) trace(this.context, points, closed);
    });
  }

  image(image: SurfaceImage, x: number, y: number, width: number, height: number, clip: ImageClip | null): void {
    const context = this.context;
    context.save();
    if (clip) {
      context.beginPath();
      context.arc(clip.x, clip.y, Math.max(0, clip.radius), 0, Math.PI * 2);
      context.clip();
    }
    context.drawImage(image, x, y, width, height);
    context.restore();
  }

  text(text: string, x: number, y: number, style: TextStyle): void {
    const context = this.context;
    context.save();
    context.font = style.font;
    context.textAlign = style.align;
    context.textBaseline = 'middle';
    context.globalAlpha = style.alpha ?? 1;
    context.fillStyle = style.color;
    context.fillText(text, x, y);
    context.restore();
  }

  measureText(text: string, font: string): number {
    const context = this.context;
    context.save();
    context.font = font;
    const { width } = context.measureText(text);
    context.restore();
    return width;
  }

  icon(name: string, x: number, y: number, size: number, color: string, alpha: number): void {
    const shapes = iconShapes(name);
    if (!shapes) return;
    const context = this.context;
    context.save();
    context.translate(x - size / 2, y - size / 2);
    context.scale(size / MAP_ICON_BOX, size / MAP_ICON_BOX);
    context.globalAlpha = alpha;
    context.strokeStyle = color;
    context.fillStyle = color;
    // Lucide's stroke: 2 units wide, with round caps and joins.
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const { path, fill } of shapes) {
      if (fill) context.fill(path);
      context.stroke(path);
    }
    context.restore();
  }

  createLayer(width: number, height: number): LayerSurface | null {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    return context ? new CanvasLayer(canvas, context) : null;
  }

  drawLayer(layer: LayerSurface, x: number, y: number, width: number, height: number): void {
    if (layer instanceof CanvasLayer) this.context.drawImage(layer.canvas, x, y, width, height);
  }

  private unwind(): void {
    while (this.depth > 0) this.pop();
  }

  private shape(style: ShapeStyle, outline: () => void): void {
    const context = this.context;
    context.save();
    context.beginPath();
    outline();
    context.globalAlpha = style.alpha ?? 1;
    context.globalCompositeOperation = style.erase ? 'destination-out' : 'source-over';
    context.lineCap = style.round ? 'round' : 'butt';
    context.lineJoin = style.round ? 'round' : 'miter';
    context.setLineDash(style.dash ? [...style.dash] : []);
    if (style.fill !== undefined) {
      context.fillStyle = style.fill;
      context.fill();
    }
    if (style.stroke !== undefined) {
      context.strokeStyle = style.stroke;
      context.lineWidth = style.lineWidth ?? 1;
      context.stroke();
    }
    context.restore();
  }
}

class CanvasLayer extends CanvasSurface implements LayerSurface {
  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  release(): void {
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

export function createCanvasSurface(canvas: HTMLCanvasElement): ViewSurface | null {
  const context = canvas.getContext('2d');
  return context ? new CanvasSurface(canvas, context) : null;
}
```

Create `online-client/mapView.mts`:

```ts
// online-client/mapView.mts
/**
 * The map on the join page. It binds the canvas, its input, the Follow GM and Fit map
 * buttons, resizing and page visibility to the tested shared modules
 * (`CameraController`, `ViewInput`, `PlayerViewRenderer`). Only the canvas takes map
 * input, so a gesture that starts on the top bar, the menu or a button never moves the map.
 */
import type { SceneCamera } from '../src/app/online/scene/sceneCamera';
import type { PlayerScene } from '../src/app/online/scene/sceneTypes';
import type { ScreenPoint } from '../src/app/online/view/camera';
import { CameraController } from '../src/app/online/view/CameraController';
import type { ImageLookup } from '../src/app/online/view/layers/layerTypes';
import { createSceneLayers } from '../src/app/online/view/layers/sceneLayers';
import { pixelRatioFor, PlayerViewRenderer } from '../src/app/online/view/PlayerViewRenderer';
import { ViewInput, type PointerInput, type PointerKind } from '../src/app/online/view/ViewInput';
import type { ViewSurface } from '../src/app/online/view/ViewSurface';

export interface MapViewOptions {
  canvas: HTMLCanvasElement;
  surface: ViewSurface;
  images: ImageLookup;
  /** Holds Follow GM and Fit map, shown while the player has broken away. */
  viewButtons: HTMLElement;
  followButton: HTMLButtonElement;
  fitButton: HTMLButtonElement;
  /** Tests pass their own; the page uses the browser's animation frames and visibility. */
  frames?: { request(draw: () => void): number; cancel(handle: number): void };
  isHidden?: () => boolean;
}

function pointerKind(type: string): PointerKind {
  return type === 'touch' || type === 'pen' ? type : 'mouse';
}

export class MapView {
  private readonly camera: CameraController;
  private readonly renderer: PlayerViewRenderer;
  private readonly input: ViewInput;
  private hasScene = false;

  constructor(private readonly options: MapViewOptions) {
    const frames = options.frames ?? {
      request: (draw: () => void): number => window.requestAnimationFrame(() => draw()),
      cancel: (handle: number): void => window.cancelAnimationFrame(handle),
    };
    this.camera = new CameraController({ now: () => performance.now(), onChange: () => this.cameraChanged() });
    this.renderer = new PlayerViewRenderer({
      surface: options.surface,
      camera: this.camera,
      images: options.images,
      layers: createSceneLayers(),
      requestFrame: (draw) => frames.request(draw),
      cancelFrame: (handle) => frames.cancel(handle),
      isHidden: options.isHidden ?? ((): boolean => document.hidden),
    });
    this.input = new ViewInput(this.camera);
    this.bind();
    this.measure();
  }

  /** The scene to show; null shows nothing and resets the camera. */
  setScene(scene: PlayerScene | null): void {
    this.hasScene = scene !== null;
    this.camera.setScene(scene);
    this.renderer.setScene(scene);
    this.updateButtons();
  }

  setGmCamera(camera: SceneCamera | null): void {
    this.camera.setGmCamera(camera);
  }

  /** Images arrived or went. */
  refresh(): void {
    this.renderer.invalidate();
  }

  /** Reads the canvas's size again, e.g. once the table is shown. */
  measure(): void {
    const { clientWidth: width, clientHeight: height } = this.options.canvas;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.camera.setScreen({ width, height });
    this.renderer.setSize({ width, height }, pixelRatioFor(window.devicePixelRatio, coarse));
  }

  private cameraChanged(): void {
    this.renderer.invalidate();
    this.updateButtons();
  }

  private updateButtons(): void {
    this.options.viewButtons.hidden = !this.hasScene || this.camera.isFollowing();
  }

  private bind(): void {
    const { canvas, followButton, fitButton } = this.options;
    const point = (event: MouseEvent): ScreenPoint => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const pointer = (event: PointerEvent): PointerInput => ({
      id: event.pointerId, ...point(event), kind: pointerKind(event.pointerType), button: event.button, time: event.timeStamp,
    });
    canvas.addEventListener('pointerdown', (event) => {
      try {
        // Moves keep coming to the canvas when the finger leaves it.
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // The pointer is already gone, or the environment has no pointer capture.
      }
      this.input.down(pointer(event));
    });
    canvas.addEventListener('pointermove', (event) => this.input.move(pointer(event)));
    canvas.addEventListener('pointerup', (event) => this.input.up(pointer(event)));
    canvas.addEventListener('pointercancel', (event) => this.input.cancel(event.pointerId));
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.input.wheel(point(event), event.deltaY, event.deltaMode);
    }, { passive: false });
    canvas.addEventListener('dblclick', (event) => {
      event.preventDefault();
      this.input.doubleClick(point(event));
    });
    followButton.addEventListener('click', () => this.camera.followGm());
    fitButton.addEventListener('click', () => this.camera.fitMap());
    document.addEventListener('visibilitychange', () => this.renderer.visibilityChanged());
    if (typeof ResizeObserver === 'undefined') window.addEventListener('resize', () => this.measure());
    else new ResizeObserver(() => this.measure()).observe(canvas);
  }
}
```

Create `online-client/menu.mts`:

```ts
// online-client/menu.mts
/**
 * The menu: a side panel, or a bottom sheet on narrow screens (`style.css`), opened by
 * the menu button and closed by its close button or Escape.
 */
export class Menu {
  constructor(private readonly button: HTMLButtonElement, private readonly panel: HTMLElement, close: HTMLButtonElement) {
    button.addEventListener('click', () => this.setOpen(panel.hidden));
    close.addEventListener('click', () => this.close());
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });
  }

  setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
  }

  private close(): void {
    this.setOpen(false);
    this.button.focus();
  }
}
```

- [ ] **Step 8: Run the page tests to verify they pass**

Run: `npx vitest run tests/unit/online/pageScreen.test.ts tests/unit/online/scenePreview.test.ts tests/unit/online/canvasSurface.test.ts tests/unit/online/mapView.test.ts`
Expected: PASS.

- [ ] **Step 9: Replace the preview with the map view on the page**

Replace `online-client/index.html` with:

```html
<!-- online-client/index.html -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Atlas VTT · Join</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <div id="screen" class="screen">
    <main class="card">
      <h1>Join the table</h1>
      <form id="join" hidden>
        <label for="name">Your name</label>
        <input id="name" maxlength="40" autocomplete="nickname" required>
        <button type="submit">Join</button>
      </form>
      <p id="status" role="status"></p>
    </main>
    <footer class="links">
      Atlas VTT online play · <a href="https://github.com/evolJoaoBento/atlas-vtt" target="_blank" rel="noopener">Source code (AGPL-3.0)</a>
      · <a href="https://github.com/evolJoaoBento/atlas-vtt/blob/main/THIRD_PARTY_NOTICES.md" target="_blank" rel="noopener">Licences</a>
    </footer>
  </div>
  <section id="table" class="table" hidden aria-label="Scene">
    <canvas id="map" role="img" aria-label="Map"></canvas>
    <header class="top-bar">
      <span id="session-name" class="session-name"></span>
      <span id="connection" class="connection" role="status"></span>
      <div id="image-progress" class="image-progress" hidden>
        <progress id="image-progress-bar" aria-label="Loading images"></progress>
        <span id="image-progress-text" role="status"></span>
      </div>
      <button id="menu-button" class="icon-button" type="button" aria-label="Menu" aria-expanded="false" aria-controls="menu">☰</button>
    </header>
    <div id="view-buttons" class="view-buttons" hidden>
      <button id="follow-gm" type="button">Follow GM</button>
      <button id="fit-map" class="secondary" type="button">Fit map</button>
    </div>
    <aside id="menu" class="menu" hidden aria-label="Menu">
      <div class="menu-header">
        <h2>Players</h2>
        <button id="menu-close" class="icon-button" type="button" aria-label="Close menu">×</button>
      </div>
      <ul id="players" aria-label="Players"></ul>
      <ul id="widgets" aria-label="Widgets" hidden></ul>
      <ol id="initiative" aria-label="Initiative" hidden></ol>
      <div class="image-settings">
        <label class="keep-images">
          <input id="keep-images" type="checkbox" role="switch" checked>
          <span id="keep-images-label">Keep images on this device</span>
        </label>
        <button id="clear-images" class="secondary" type="button" disabled>Clear saved images</button>
      </div>
      <footer class="links">
        Atlas VTT online play · <a href="https://github.com/evolJoaoBento/atlas-vtt" target="_blank" rel="noopener">Source code (AGPL-3.0)</a>
        · <a href="https://github.com/evolJoaoBento/atlas-vtt/blob/main/THIRD_PARTY_NOTICES.md" target="_blank" rel="noopener">Licences</a>
      </footer>
    </aside>
  </section>
  <script type="module" src="./main.mts"></script>
</body>
</html>
```

Replace `online-client/style.css` with:

```css
/* online-client/style.css */
:root {
  color-scheme: light dark;
  --bg: #f6f6f7; --card: #fff; --text: #1f2328; --muted: #5a6068; --accent: #7c5cff; --border: #d8dbe0;
  --bar: rgba(255, 255, 255, 0.92); --gap: 8px; --target: 44px;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #161719; --card: #202124; --text: #e8e8ea; --muted: #a0a4ab; --border: #33363b; --bar: rgba(32, 33, 36, 0.92); }
}
* { box-sizing: border-box; }
/* The display rules below would otherwise override the hidden attribute. */
[hidden] { display: none !important; }
html, body { height: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, sans-serif; }

/* Full-screen messages: the name form, waiting, refused and ended. */
.screen {
  min-height: 100%; display: grid; place-items: center; align-content: center; gap: 16px;
  padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
}
.card { width: min(420px, 100%); padding: 24px; background: var(--card); border: 1px solid var(--border); border-radius: 16px; display: grid; gap: 12px; }
h1 { margin: 0; font-size: 20px; }
h2 { margin: 0; font-size: 16px; }
form { display: grid; gap: 8px; }
input { min-height: var(--target); padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: inherit; font: inherit; }
button { min-height: var(--target); padding: 10px 16px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
button.secondary { background: var(--card); color: var(--text); border: 1px solid var(--border); font-weight: 500; }
button:disabled { opacity: 0.5; cursor: default; }
#status { margin: 0; color: var(--muted); }
.links { color: var(--muted); font-size: 13px; }
.links a { color: inherit; }

/* The table: the map fills the window, everything else floats over it. */
.table { position: fixed; inset: 0; overflow: hidden; background: #000; }
#map { position: absolute; inset: 0; display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; }
#map:active { cursor: grabbing; }
.top-bar {
  position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: var(--gap);
  padding: max(var(--gap), env(safe-area-inset-top)) max(var(--gap), env(safe-area-inset-right)) var(--gap) max(var(--gap), env(safe-area-inset-left));
  background: var(--bar); border-bottom: 1px solid var(--border);
}
.session-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.connection { color: var(--muted); font-size: 13px; white-space: nowrap; }
.image-progress { flex: 1; min-width: 80px; display: grid; gap: 4px; color: var(--muted); font-size: 13px; }
.image-progress progress { width: 100%; height: 6px; accent-color: var(--accent); }
.icon-button {
  width: var(--target); height: var(--target); padding: 0; margin-left: auto; display: grid; place-items: center;
  background: transparent; color: var(--text); border: 1px solid var(--border); font-size: 20px; font-weight: 500;
}
.view-buttons {
  position: absolute; right: max(12px, env(safe-area-inset-right)); bottom: max(12px, env(safe-area-inset-bottom));
  display: flex; gap: var(--gap);
}

/* The menu: a side panel, a bottom sheet on narrow screens. */
.menu {
  position: absolute; top: 0; right: 0; bottom: 0; width: min(320px, 100%); overflow-y: auto;
  display: grid; align-content: start; gap: 12px;
  padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) 12px;
  background: var(--card); border-left: 1px solid var(--border);
}
.menu-header { display: flex; align-items: center; gap: 12px; }
.menu ul, .menu ol { margin: 0; padding: 12px; list-style-position: inside; border: 1px solid var(--border); border-radius: 12px; }
.image-settings { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; color: var(--muted); font-size: 14px; }
.keep-images { display: flex; align-items: center; gap: 8px; min-height: var(--target); }
.keep-images input { width: 22px; height: 22px; min-height: 0; padding: 0; accent-color: var(--accent); }
@media (max-width: 720px) {
  .menu {
    top: auto; left: 0; width: auto; max-height: 70%; border-left: 0; border-top: 1px solid var(--border); border-radius: 16px 16px 0 0;
    padding-left: max(12px, env(safe-area-inset-left));
  }
}
```

Replace `online-client/main.mts` with:

```ts
// online-client/main.mts
/**
 * The join page: the name form, the session, image loading and the map. The logic lives
 * in tested shared modules under `src/app/online/`; this file finds the page's elements
 * and connects them.
 */
import { AssetCache } from '../src/app/online/assets/AssetCache';
import { AssetLoader } from '../src/app/online/assets/AssetLoader';
import { openIndexedDbImageStore } from '../src/app/online/assets/indexedDbImageStore';
import { randomId } from '../src/app/online/ids';
import { parseJoinFragment } from '../src/app/online/joinLink';
import { INCOMPLETE_LINK_TEXT, NAME_PROBLEM_TEXT, NO_CANVAS_TEXT, pageScreen, type PageScreen } from '../src/app/online/page/pageScreen';
import type { PlayerSessionState } from '../src/app/online/PlayerSession';
import { createJoinSession } from '../src/app/online/preview/joinSession';
import { initiativeLines, playerLines, widgetLines } from '../src/app/online/preview/sceneSummary';
import { normalizePlayerName } from '../src/app/online/protocol';
import type { PlayerScene } from '../src/app/online/scene/sceneTypes';
import { createPeerClient } from '../src/app/online/transport/PeerTransport';
import { AssetsPanel, rememberedKeep } from './assetsPanel.mts';
import { createCanvasSurface } from './canvasSurface.mts';
import { decodeImage } from './imageDecoder.mts';
import { MapView } from './mapView.mts';
import { Menu } from './menu.mts';

const VERSION = '0.1.0';

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const screen = element<HTMLElement>('screen');
const form = element<HTMLFormElement>('join');
const nameInput = element<HTMLInputElement>('name');
const status = element<HTMLParagraphElement>('status');
const table = element<HTMLElement>('table');
const sessionName = element<HTMLElement>('session-name');
const connection = element<HTMLElement>('connection');
const playerList = element<HTMLUListElement>('players');
const widgetList = element<HTMLUListElement>('widgets');
const initiativeList = element<HTMLOListElement>('initiative');
const canvas = element<HTMLCanvasElement>('map');

const cache = new AssetCache({ keep: rememberedKeep(), openStore: openIndexedDbImageStore });
const panel = new AssetsPanel(cache);
new Menu(element<HTMLButtonElement>('menu-button'), element<HTMLElement>('menu'), element<HTMLButtonElement>('menu-close'));
const surface = createCanvasSurface(canvas);
// The lookup runs at draw time, in a later animation frame, so `loader` below is already set;
// it asks the loader every time, so a released image is never drawn.
const map = surface
  ? new MapView({
    canvas, surface, images: (id) => loader.image(id),
    viewButtons: element('view-buttons'), followButton: element('follow-gm'), fitButton: element('fit-map'),
  })
  : null;
let assetsFrame: number | null = null;
const loader = new AssetLoader({
  cache,
  decode: decodeImage,
  // Chunks arrive many times a second: the bar and the map update at most once per frame.
  onChange: () => {
    if (assetsFrame !== null) return;
    assetsFrame = window.requestAnimationFrame(() => {
      assetsFrame = null;
      panel.showProgress(loader.progress());
      map?.refresh();
    });
  },
});
let sessionState: PlayerSessionState | null = null;
let scene: PlayerScene | null = null;
let started = false;

/** localStorage can throw in private windows; the page still works without it. */
function stored(key: string, fallback: () => string): string {
  try {
    const value = localStorage.getItem(key) ?? fallback();
    localStorage.setItem(key, value);
    return value;
  } catch {
    return fallback();
  }
}

const listContent = new WeakMap<HTMLElement, string>();

/** Rebuilds a list only when its lines changed; scene patches arrive many times a second. */
function fillList(list: HTMLElement, lines: string[]): void {
  list.hidden = lines.length === 0;
  const joined = JSON.stringify(lines);
  if (listContent.get(list) === joined) return;
  listContent.set(list, joined);
  list.replaceChildren(...lines.map((line) => {
    const item = document.createElement('li');
    item.textContent = line;
    return item;
  }));
}

function show(view: PageScreen): void {
  screen.hidden = view.kind === 'table';
  table.hidden = view.kind !== 'table';
  form.hidden = view.kind !== 'form' || started;
  if (view.kind === 'message') status.textContent = view.text;
  if (view.kind === 'table') {
    sessionName.textContent = view.title;
    connection.textContent = view.connection;
    // The canvas has its size only once the table is shown.
    map?.measure();
  }
}

function render(state: PlayerSessionState): void {
  sessionState = state;
  if (state.status === 'denied' || state.status === 'lost') {
    // The session is over for good: free the decoded images and hide the loading bar.
    loader.dispose();
    panel.showProgress(loader.progress());
  }
  fillList(playerList, playerLines(state.players));
  renderScene();
}

/** The map, and the widget and initiative lists, shown only on the table screen. */
function renderScene(): void {
  const view = pageScreen(sessionState, scene !== null);
  show(view);
  const shown = view.kind === 'table' ? scene : null;
  map?.setScene(shown);
  fillList(widgetList, shown ? widgetLines(shown.widgets) : []);
  fillList(initiativeList, shown ? initiativeLines(shown.initiative) : []);
  // Read-only, for checking in the developer tools what this page received.
  (window as unknown as { atlasScene: PlayerScene | null }).atlasScene = shown;
}

const target = parseJoinFragment(location.hash);
if (!target) {
  status.textContent = INCOMPLETE_LINK_TEXT;
} else if (!map) {
  status.textContent = NO_CANVAS_TEXT;
} else {
  form.hidden = false;
  nameInput.value = stored('atlas-online:name', () => '');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (started) return;
    const name = normalizePlayerName(nameInput.value);
    if (!name) {
      status.textContent = NAME_PROBLEM_TEXT;
      return;
    }
    try { localStorage.setItem('atlas-online:name', name); } catch { /* private window */ }
    started = true;
    form.hidden = true;
    createJoinSession({
      loader,
      hostId: target.hostId,
      name,
      // One key per GM session, so different GMs cannot recognise or pose as the same player.
      playerKey: stored(`atlas-online:player-key:${target.hostId}`, () => randomId()),
      clientVersion: VERSION,
      transport: createPeerClient(target.server),
      onChange: render,
      onScene: (next) => {
        scene = next;
        renderScene();
      },
      onCamera: (camera) => map.setGmCamera(camera),
    }).start();
  });
}
```

Delete the old preview with `git rm online-client/preview.mts`.

Remove what only the old preview used:
- **`src/app/online/preview/previewShapes.ts`.** Delete the constants `DEFAULT_TOKEN_COLOR` and `TOKEN_FILL`, the interfaces `InkStroke`, `TextLabel` and `TokenMarker`, and the functions `inkStrokes`, `textLabels`, `tokenMarkers` and `initials`. Replace the two imports from `../scene/sceneTypes` and `./previewLayout` with:

  ```ts
  import { sortedByOrder, type PlayerFogOp, type PlayerGrid, type ScenePoint } from '../scene/sceneTypes';
  import type { PreviewRect } from './previewLayout';
  ```

  Then change its header comment to read "What the join page's map view takes from the preview: grid lines and fog shapes, in world coordinates."
- **`src/app/online/preview/previewLayout.ts`.** Delete `PreviewTransform`, `PREVIEW_PADDING` and `fitTransform`. `camera.ts` has `fitCamera` and `FIT_PADDING`.
- **`tests/unit/online/scenePreview.test.ts`.** Delete these tests: `fits the map into the canvas with padding, centred`, `fits a zero-size world without dividing by zero`, `draws ink in order, icons as dots, and skips eraser strokes`, `labels texts at their scaled size`, and `marks tokens by layer with their footprint, colour, initials and HP`. Change the imports to:

  ```ts
  import { sceneWorldBounds } from '../../../src/app/online/preview/previewLayout';
  import { MAX_GRID_HEXES, fogShapes, gridLines } from '../../../src/app/online/preview/previewShapes';
  import { initiativeLines, playerLines, widgetLines } from '../../../src/app/online/preview/sceneSummary';
  ```

Run `grep -rn "fitTransform\|tokenMarkers\|textLabels\|inkStrokes\|initials\|ScenePreview\|preview.mts" src online-client tests`. Expected: nothing.

- [ ] **Step 10: Run every online test, type-check, lint and build the page**

Run: `npx vitest run tests/unit/online tests/unit/sharedLayout.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit && npx eslint src/app/online src/app/pixi/sceneLayerOrder.ts --max-warnings 0 --suppressions-location eslint.suppressions.json && npm run build:online`
Expected: each exits 0. `build:online` writes `dist-online/` without warnings about missing modules.

Run: `wc -l src/app/online/view/*.ts src/app/online/view/layers/*.ts src/app/online/page/*.ts online-client/*.mts`
Expected: every file under 300 lines.

- [ ] **Step 11: Commit**

```bash
git add src/app/online/view src/app/online/page src/app/online/preview online-client tests/unit/online
git commit -m "feat(online): the player map view on the join page"
```

---

### Task 5: The tab-switch issue, documentation, full checks and the manual test

The known issue from piece 2: when the GM switches the presented view to another scene tab, players see "Waiting for the GM…" instead of the held scene. An integration test of the switch did not reproduce it, so the cause is unknown. This task:
1. completes the diagnostics on both ends;
2. has the user reproduce the issue in Obsidian with the log on;
3. finds the cause in the log;
4. fixes it, with a regression test of that cause;
5. then documents the piece and runs every check.

Steps 2 and 6 need the user, because only Obsidian with the plugin loaded reproduces the issue. The implementer asks the controller to have the user run them and paste the logs.

**Files:**
- Modify: `online-client/main.mts` (page log), `src/app/online/OnlineSessionService.ts` (players log)
- Modify, depending on the cause found: `src/app/services/PresentedScene.ts`
- Test: `tests/unit/online/onlineSessionService.test.ts`; depending on the cause found, `tests/unit/presentedScene.test.ts` and `tests/unit/online/sceneBroadcaster.test.ts`
- Create: `docs/online-play-features.md`
- Modify: `README.md`, `PRIVACY.md`, `changelog/Unreleased.md`

**Interfaces:**
- Consumes: `createOnlineLog`, `loggedSession`, `logPresentedScene` (Task 2), `OnlineSettings.logEvents`, and the page wiring (Task 4).
- Produces: no new interfaces. The page reads `localStorage['atlas-online:log'] === 'on'` to log.

- [ ] **Step 1: Log both ends of the session**

In `tests/unit/online/onlineSessionService.test.ts`, add this test:

```ts
  it('logs players and scene messages to the console while Log online play events is on', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const logging = {
      getOnlineSettings: () => ({ ...DEFAULT_ONLINE_SETTINGS, logEvents: true }),
      getLocalPlayerViewSettings: () => ({
        showGrid: true, showTokenHP: false, showTokenStress: false, showTokenNameplates: false, showWidgets: true, showInitiative: true,
      }),
      onChange: () => () => {},
    } as never;
    const network = new MemoryNetwork();
    const host = network.host('gm-id');
    const notices: Array<(allow: boolean) => void> = [];
    const svc = new OnlineSessionService(app, logging, {
      createHost: async () => host, presented: new PresentedScene(),
      showRequest: (_player, answer) => { notices.push(answer); return { hide: () => {} }; },
    });
    await svc.start();
    const link = await network.client().connect('gm-id');
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Anna', playerKey: 'k', client: { kind: 'web', version: '1' } }));
    notices[0]!(true);
    const events = debug.mock.calls.map((call) => call[1]);
    expect(events).toContain('players');
    expect(events).toContain('send scene-clear');
    svc.stop();
    debug.mockRestore();
  });
```

Run: `npx vitest run tests/unit/online/onlineSessionService.test.ts`
Expected: FAIL. The `players` event is missing.

In `src/app/online/OnlineSessionService.ts`, replace the `onPlayersChanged` option of the `GmSession` with:

```ts
      onPlayersChanged: (players) => {
        log.event('players', { players: players.map((player) => `${player.name}: ${player.status}`).join(', ') });
        onlineSessionStore.setState({ players, error: null });
      },
```

In `online-client/main.mts`, add `import { createOnlineLog } from '../src/app/online/onlineLog';` and, after `let started = false;`:

```ts
/** Diagnostics: run `localStorage.setItem('atlas-online:log', 'on')` in this page's console, then reload. */
const log = createOnlineLog(() => {
  try {
    return localStorage.getItem('atlas-online:log') === 'on';
  } catch {
    return false;
  }
});
```

Then add three log lines:
1. At the start of `render`:

   ```ts
     log.event('status', { status: state.status, reason: state.reason, players: state.players.length });
   ```

2. At the start of the `onScene` callback:

   ```ts
           log.event('scene', { sceneId: next?.sceneId ?? null, tokens: next ? Object.keys(next.tokens).length : 0 });
   ```

3. In `onCamera`, using a block body:

   ```ts
         onCamera: (camera) => {
           log.event('camera', { sceneId: camera.sceneId, centerX: camera.centerX, centerY: camera.centerY });
           map.setGmCamera(camera);
         },
   ```

Run: `npx vitest run tests/unit/online/onlineSessionService.test.ts && npx tsc --noEmit`
Expected: PASS, and `tsc` exits 0.

Commit:

```bash
git add src/app/online/OnlineSessionService.ts online-client/main.mts tests/unit/online/onlineSessionService.test.ts
git commit -m "feat(online): log players on the GM side and the session on the join page"
```

- [ ] **Step 2: Reproduce the switch in Obsidian with the log on (the user)**

1. Run `npm run build` and reload Atlas in Obsidian. Start the join page locally with `npx vite -c vite.online.config.mts --host`, and set **Settings → Online play → Player page** to the address it prints.
2. Switch on **Settings → Online play → Log online play events**.
3. Open the developer console: Ctrl+Shift+I, or Cmd+Option+I on macOS. Set its level filter to include **Verbose**, and type `[Atlas online]` in its filter field.
4. Open one map view with two scene tabs, Tavern and Dungeon, each with a map image and a few tokens. Run **Online session…** and copy the join link.
5. Open the join link in a desktop browser. In that page's console, run `localStorage.setItem('atlas-online:log', 'on')`, then reload. Filter its console by `[Atlas online]` at the Verbose level too. Enter a name, and allow the player in Atlas.
6. With Tavern active, run **Present to players**. Wait until the player's map shows Tavern.
7. Click the Dungeon tab and wait 5 seconds. Note what the player page shows. Then click the Tavern tab, wait 5 seconds, and note it again.
8. Repeat step 7 three times, and then once each:
   - with the local player window open (**Send current map to player view** instead of **Present to players**);
   - with a large map (more than 10 MB).
9. Save both consoles (right-click in the console → **Save as…**) as `logs/online-tab-switch-gm.log` and `logs/online-tab-switch-player.log`. Git ignores `*.log`. Give both files, and what the page showed at each step, to the controller.

- [ ] **Step 3: Find the cause in the log**

In the GM log, find the first `send scene-clear` that follows the first `held` of the switch. Its `stack` names the code path. In the player log, find where `scene` becomes `{ sceneId: null }` or `status` leaves `admitted`. Match the evidence to the first cause it fits:

| Cause | What the log shows | Fix (Step 5) |
| --- | --- | --- |
| **A. The tab list is rebuilt without the presented tab for a moment.** `PresentedScene.tabsChanged` sees the tab missing and clears. | `tabs changed { presentedTabExists: false }` right before `cleared`, then `send scene-clear` with a stack through `clearScene`. A later `tabs changed` lists the tab again. | Fix A |
| **B. `present` runs again for the presented tab while another tab is active**, so a new presentation starts held and `holdScene` clears players. | `held { presentation: 2 }` after `presented { presentation: 1 }` for the same `tab`. The `held` stack goes through `present` (from `presentTabInPlayerWindow`, `restorePlayerWindow` or `presentViewToPlayers`). Then `send scene-clear` with a stack through `holdScene`. | Fix B |
| **C. The scene is too large, or has too much fog,** once it is projected again on return. | `send scene-clear` with a stack through `sendSnapshot` or `clearForTruncatedFog`, and the GM sees "This scene is too large…" or "…too much fog…". | Not this bug: the size limits work as designed. Report it to the controller. |
| **D. The player's connection drops during the switch** (for example, a long load on the GM's side starves the heartbeat). | GM: `players { … : gone }` or a reconnect; player: `status connecting`, then `admitted`. No `send scene-clear`. | Stop and report to the controller with the logs: a transport fix needs its own plan. |
| **E. The page loses the scene by itself.** | GM sends no `scene-clear` and its `send scene-snapshot` lines look normal, but the player log shows `scene { sceneId: null }`. | Stop and report to the controller with the logs. |

If the log fits none of these, stop and report to the controller with the logs. Do not guess a fix.

- [ ] **Step 4: Write the regression test for the cause found**

**Cause A.** In `tests/unit/presentedScene.test.ts`, add this test. It replays the store calls in the order the log shows; if the log shows the tab missing through a different action (for example `removeTab` then `addTab`), use those calls instead of `setTabs`.

```ts
  it('keeps the presentation when the tab list is rebuilt without the presented tab for a moment', async () => {
    const scene = new PresentedScene();
    const events = record(scene);
    const { view, tabs, tavern, dungeon } = fakeView();
    scene.present(view, tavern);
    tabs.getState().setActiveTab(dungeon);
    const all = tabs.getState().tabs;
    tabs.getState().setTabs(all.filter((tab) => tab.id !== tavern), dungeon);
    tabs.getState().setTabs(all, dungeon);
    await flush();
    expect(events).toEqual([`presented:${tavern}`, `held:${tavern}`]);
    expect(scene.current()?.tabId).toBe(tavern);
  });
```

Then, in the existing test `clears when the presented tab is closed`, make it `async` and add `await flush();` before its `expect`.

**Cause B.** In `tests/unit/presentedScene.test.ts`, add:

```ts
  it('keeps the held presentation when the presented tab is presented again from another tab', () => {
    const scene = new PresentedScene();
    const events = record(scene);
    const { view, tabs, tavern, dungeon } = fakeView();
    scene.present(view, tavern);
    const presentation = scene.current();
    tabs.getState().setActiveTab(dungeon);
    scene.present(view, tavern);
    expect(events).toEqual([`presented:${tavern}`, `held:${tavern}`]);
    expect(scene.current()).toBe(presentation);
  });
```

Then, in the existing test `replaces the presented scene and registers each view once`, change the expected events to `[`presented:${first.tavern}`, `presented:${second.tavern}`]`: presenting the presented tab again is no longer a new presentation.

In `tests/unit/online/sceneBroadcaster.test.ts`, add this test inside the top-level `describe`:

```ts
  it('keeps players on the held scene when the presented tab is presented again, and sends a fresh snapshot on return', async () => {
    const h = setup();
    const { view, tabs, tavern, dungeon } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    tabs.getState().setActiveTab(dungeon);
    h.presented.present(view, tavern);
    tabs.getState().setActiveTab(tavern);
    await vi.advanceTimersByTimeAsync(0);
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-snapshot']);
  });
```

Run the new tests: `npx vitest run tests/unit/presentedScene.test.ts tests/unit/online/sceneBroadcaster.test.ts`
Expected: FAIL in the new test(s) of the cause found.

- [ ] **Step 5: Fix the cause found**

**Fix A.** In `src/app/services/PresentedScene.ts`, in `tabsChanged`, replace the `if (!tabExists) { this.clear(); return; }` block with:

```ts
    if (!tabExists) {
      // A tab list being rebuilt can miss the tab for a moment: clear only if it is still gone a task later.
      window.setTimeout(() => {
        if (this.scene !== scene) return;
        if (!scene.view.tabMetaStore.getState().tabs.some((tab) => tab.id === scene.tabId)) this.clear();
      }, 0);
      return;
    }
```

**Fix B.** In `src/app/services/PresentedScene.ts`, in `present`, insert after `if (view.isClosed) return;`:

```ts
    const current = this.scene;
    // Presenting the presented tab again keeps the presentation, so players keep their scene.
    if (current?.view === view && current.tabId === tabId) {
      const { activeTabId, tabs } = view.tabMetaStore.getState();
      this.tabsChanged(current, activeTabId, tabs.some((tab) => tab.id === tabId));
      return;
    }
```

Run: `npx vitest run`
Expected: PASS.
- **After fix A**, tests that close the presented tab and expect an immediate clear now see it one task later. These are `tests/unit/online/onlineLog.test.ts` (`logs the presented scene's events…`), and any test in `sceneBroadcaster.test.ts`, `sceneSyncEndToEnd.test.ts`, `playerWindowPresenter.test.ts` or `presentToPlayers.test.ts` that calls `removeTab` on the presented tab. In each, add `await vi.advanceTimersByTimeAsync(0)` under fake timers, or `await flush()` under real timers, before the expectation. In `onlineLog.test.ts`, make the test `async`, use `vi.useFakeTimers()` / `vi.useRealTimers()` around it, and advance before reading `lines`. Change nothing else.
- **After fix B**, only the test changed in Step 4 is affected: when this plan was written, no other test presented the presented tab twice without `clear()` in between. The `playerWindowPresenter.test.ts` re-target tests clear first. If another test fails, check whether it expects a new presentation for the same tab. If it does and the behaviour matters to players (for example the local window re-targeting), stop and report to the controller rather than weaken the test.

- [ ] **Step 6: Confirm the fix in Obsidian (the user)**

Repeat Step 2's switches 6–8 with the log on. Expected:
- The player page keeps showing the presented scene while the GM is on the Dungeon tab.
- On return to Tavern, the GM log shows `presented { resumed: true }`, then `send scene-snapshot` and `send scene-camera`. The player log shows the same `sceneId` again and a `camera`.
- No `send scene-clear` appears during the switches.

- [ ] **Step 7: Commit the fix**

```bash
git add src/app/services/PresentedScene.ts tests/unit
git commit -m "fix(online): players keep the held scene while the GM browses another tab"
```

Use this message body. Name the cause found (A or B) and the log line that showed it:

```
The GM's log showed <the log line>: <one sentence on the cause>. Players now keep the held
scene and get a fresh snapshot and the GM's camera when the presented tab is back.
```

- [ ] **Step 8: Write the guide**

Create `docs/online-play-features.md`:

```markdown
# Adding a map feature to online play

Online players see the presented scene through a projection on the GM's side and a layer on the join page. Every Atlas map object and field must be decided on for online play, in the same places every time. When you add a field to `TokenEntity`, a new kind of map object, a grid setting or a new layer, work through this list.

## 1. Record the decision

`src/app/online/coverage.ts` has a table per Atlas type: map objects, token fields, text fields, drawing fields, fog fields, grid fields, and the store fields the projection reads. The tables are typed over Atlas's own types, so a new field or object kind fails `npx tsc --noEmit` until it has an entry:

- `sent`: players receive it, or what it decides (`isHidden` keeps a token from them).
- `gm-only` with a reason: it never changes what players receive.
- `not-yet` with the piece expected to add it.

Then add a variant for the field in `tests/unit/online/coverage.test.ts`. It changes the field and checks that the projection changes for `sent` and stays the same otherwise.

## 2. Project it on the GM's side

`src/app/online/scene/projectForPlayers.ts` (map, grid, tokens), `projectRecords.ts` (fog, texts, drawings) and `projectPanels.ts` (widgets, initiative) build every sent object field by field, never by spreading a GM record. Read values through `coerce.ts` and clamp numbers into `SCENE_RANGES`, so the output always validates. Follow the player view settings (`playerViewRules.ts`) and the fog (`FogCoverage`) as the local player window does. If the projection reads a new store field, add it to `sliceOf` in `sceneSources.ts`.

## 3. Wire type and validation

Add the field to `src/app/online/scene/sceneTypes.ts` as `T | null`, never optional: JSON drops `undefined`. Validate it in `sceneValidation.ts`. Players running an older page ignore fields they do not know, so a new field needs no new protocol version. A changed meaning does.

## 4. Draw it on the player's side

Each Atlas layer has a player layer in `src/app/online/view/layers/`, drawn through `ViewSurface` (never the canvas directly), in the order of `SCENE_LAYER_ORDER` (`src/app/pixi/sceneLayerOrder.ts`):

- Draw only what is on screen (`frame.visible`).
- Hand network text and colours only to the surface's `text`, `fill` and `stroke`.
- Cache expensive drawings the way the fog layer does.

A new Atlas layer goes into `SCENE_LAYER_ORDER` (and `SCENE_LAYER_Z` when it is placed by `zIndex`). `createSceneLayers` then fails to compile until the player view has a layer for it.

## 5. Share the geometry

Layout that Atlas and the player view both need lives in modules without PIXI or Obsidian imports, which both renderers use:

- `grid/hexGeometry.ts` and `grid/hexNumbering.ts`
- `pixi/token-renderer/tokenSizing.ts`, `tokenUiLayout.ts` (bars, nameplate) and `conditionBadgeLayout.ts`
- `pixi/textBoxLayout.ts`
- `pixi/mapIcons.ts`

Change the shared module, never a copy in one renderer.

## 6. Tests

- The coverage variant (step 1).
- The projection, in `tests/unit/online/projectForPlayers.test.ts` or `projectParts.test.ts`.
- The validation, in `sceneProtocol.test.ts`.
- What the layer draws, on `RecordingSurface` (`tests/unit/online/recordingSurface.ts`).
- An end-to-end test over `MemoryTransport` (`sceneSyncEndToEnd.test.ts`) when messages change.

## 7. Tell players and the GM

Update `README.md` and `changelog/Unreleased.md`. Update `PRIVACY.md` too when players learn something new about the GM's scene or view.
```

- [ ] **Step 9: Update the README, the privacy notes and the release notes**

These three files use CRLF line endings; keep them.

In `README.md`, under `## Online play (preview)`, replace the sentence "The join page shows a live preview with the map and token images." with:

```markdown
The join page shows the scene full-window, on desktop and phones, with the map and token images. Players follow your view of the scene in Atlas by default: they see the part of the map you look at, can drag, scroll or pinch to look around on their own, and come back with **Follow GM**.
```

In `PRIVACY.md`, under `## Online play`, add after the sentence ending "tokens, texts and drawings under fog are still never sent.":

```markdown
While a scene is presented and you look at it in Atlas, players also receive where your view of it is (its centre and how much of the map it shows), so their view can follow yours; nothing about your view is sent while you look at another scene.
```

In `changelog/Unreleased.md`, under `**Online Play (preview)**`, make two changes:

1. Replace the bullet "The join page shows a live preview of the presented scene: the grid, fog and a marker for each token, with widgets and initiative listed beside it." with:

   ```markdown
   - The join page shows the presented scene full-window, on desktop and phones: the map, grid, fog, texts, drawings and icons, and tokens with their rings, names, HP and stress bars and conditions. Players follow your view of the scene by default; they can drag, scroll or pinch to look around on their own, and come back with **Follow GM** or see the whole map with **Fit map**. Widgets, initiative and the players are in the page's menu.
   ```

2. Add after the last bullet:

   ```markdown
   - Switching to another scene tab no longer sends online players to "Waiting for the GM…": they keep the presented scene and catch up when you come back.
   - **Log online play events** (Settings → Online play) writes what Atlas sends to online players, and every change of the presented scene, to the developer console, for troubleshooting.
   ```

Only add the tab-switch bullet if Step 5 fixed the cause. If the cause was reported to the controller instead, leave that bullet out.

- [ ] **Step 10: Run every check**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run build:ci && npm run build:online && npm run changelog:check`
Expected: each exits 0.
- `npm run lint` reports no warnings.
- Vitest reports every test file passing. That is the existing suite plus `sharedLayout`, `coverage`, `coverageGuard`, `sceneCamera`, `presentedCamera`, `cameraSender`, `onlineLog`, `cameraController`, `viewInput`, `playerViewRenderer`, `viewLayers`, `tokensLayer`, `fogLayer`, `mapIconPaths`, `pageScreen`, `canvasSurface` and `mapView`.
- `build:ci` writes `dist/main.js`, and `build:online` writes `dist-online/`.

Run: `wc -l src/app/online/scene/SceneBroadcaster.ts src/app/online/PlayerSession.ts src/app/online/OnlineSessionService.ts src/app/services/PresentedScene.ts src/app/online/view/*.ts src/app/online/view/layers/*.ts online-client/*.mts`
Expected: `SceneBroadcaster.ts` is 300 lines, and every other file is under 300.

- [ ] **Step 11: Commit the documentation**

```bash
git add docs/online-play-features.md README.md PRIVACY.md changelog/Unreleased.md
git commit -m "docs(online): the player map view, and the guide to adding a map feature"
```

- [ ] **Step 12: Manual end-to-end test (the user)**

Build and load the plugin (`npm run build`, then reload Atlas in Obsidian). Run the join page locally (`npx vite -c vite.online.config.mts --host`) and point **Settings → Online play → Player page** at it.

1. **Desktop, following.** Present a scene with a map image, a square grid, a few tokens (one with HP and stress shown and a name, one with two conditions, one valued), a text with a background, an ink stroke, an icon stamp and some fog. Join from a desktop browser. Expected:
   - The map fills the window. The top bar shows the session name, "Connected" and the menu button.
   - The scene matches the player window: grid, art in circles with rings, bars and nameplate under the token, neutral condition badges with the number, text, ink, the icon and opaque fog.
   - Pan and zoom in Atlas: the page glides to follow within a moment, showing about the area Atlas shows.
2. **Breaking away.** Drag the map, then scroll, then double-click. Expected:
   - Each moves the view, and **Follow GM** and **Fit map** appear at the bottom right.
   - **Fit map** shows the whole map.
   - **Follow GM** glides back to the GM's view, and the buttons disappear.
   - A plain click on the map does not break away.
3. **Menu.** Open the menu. Expected: the players, the widgets and the initiative are listed, with **Keep images on this device** and **Clear saved images**. Escape or **Close menu** closes it. Dragging on the open menu does not move the map.
4. **Resize.** Resize the window while following: the view refits. Break away, then resize: the centre stays where it was.
5. **Phone.** Open the link on a phone in portrait and landscape. Expected:
   - One-finger drag pans, pinch zooms around the fingers, and double-tap zooms in. The page itself never zooms or scrolls.
   - The menu is a bottom sheet, and buttons are comfortably large.
   - Nothing sits under the notch or the home indicator.
6. **Large scene.** Present a map over 10 MB with about 200 tokens and lots of fog (paint and erase for a minute). Expected: panning and zooming on desktop and phone stay smooth, and fog changes from the GM appear within a moment.
7. **Tab switch.** Switch the GM's view to another scene tab and back, several times. Expected: players keep the presented scene meanwhile and follow the GM again on return.
8. **Scenes.** Present another scene: the page shows it, following the GM. Run **Stop presenting**: the page shows "Connected to … Waiting for the GM to show a scene." Present again: the map returns.
9. **Hidden tab.** Hide the player's browser tab for a minute while the GM moves tokens, then show it. Expected: the page shows the current scene at once.
10. **End.** Run **Stop online session**: the page says the session ended, full-screen.

---

## Self-review

Checked against the spec after writing:

- **Spec coverage.**
  - **Coverage tables** (objects, token/text/drawing/fog fields, the scene fields, plus grid fields per ruling 9), the type-level guard with a compiler test, and the sent and GM-only field tests: Task 1.
  - **One projection and one layer per feature**, with the layer order from the shared list: Task 1 (`SCENE_LAYER_ORDER`) and Task 4 (`createSceneLayers`).
  - **Shared calculations** (token sizing, bar and nameplate layout, condition badge layout, text box sizing, hex geometry and numbering, map icons): Tasks 1 and 4.
  - **The guide:** Task 5.
  - **GM camera**, all of it:
    - `scene-camera` with no `seq`, read from the viewport;
    - ≤ 100 ms, only on change, with the trailing edge;
    - not while held, and once on resume and with snapshots;
    - validation, and another scene ignored.
    These are Task 2, with the end-to-end test over `MemoryTransport` in `cameraSender.test.ts`.
  - **Player camera** (follow, glide 150 ms, break away, Follow GM, Fit map, fit without a GM camera, zoom limits 1/20–8×, panning bounds, new scene follows, resize, scene cleared): Task 3.
  - **Input** (wheel, drag, double-click, touch pan, pinch, double-tap): Task 3. `touch-action: none`, and gestures starting on buttons: Task 4.
  - **Drawing:**
    - layers in Atlas's order, each drawing only what is on screen;
    - grid lines, dashes, hex numbers;
    - tokens with art, marker, ring, nameplate, bars and badges;
    - fog cache at most 4096 px, rebuilt only on change, last and opaque.
    These are Task 4. Frame scheduling, the pixel ratio with the phone cap, and nothing while hidden: Task 3. `ViewSurface` with the canvas and recording implementations: Tasks 3 and 4.
  - **Layout** (full-window map, top bar, menu side panel or bottom sheet, floating buttons, full-screen messages, 44 px targets, safe areas, portrait and landscape): Task 4.
  - **The tab-switch issue** (diagnostics setting, reproduction, cause, fix, regression test): Tasks 2 and 5.
  - **Errors and edge cases:**
    - images missing → markers and the placeholder (Task 4);
    - resize (Task 3);
    - out-of-range or other-scene camera (Tasks 2 and 3);
    - gesture on a button (Task 4);
    - hidden page (Task 3);
    - scene cleared → waiting message and camera reset (Tasks 3 and 4).
  - **Testing list:** every item has a named test in its task. The manual test is Task 5, Step 12.
- **Deviations reported for review.**
  - The layer order follows Atlas, not the spec's list (ruling 1).
  - Condition badges are neutral (ruling 6).
  - `GRID_FIELD_COVERAGE` is added (ruling 9).
  - The tab-switch fix is conditional on the cause the log shows (Task 5, Step 3), with code given for the two causes the code reading makes likely.
- **Placeholder scan.** No "TBD" or "similar to Task N". The only open code is the cause-dependent fix, and both candidate fixes are written out with their tests.
- **Type consistency.**
  - **Task 1 names** are used in Task 4 under the same names: `SCENE_LAYER_ORDER`, `SceneLayer`, `tokenBarRects`, `barInnerRect`, `barFillRect`, `barTickXs`, `nameplateRect`, `BAR_BORDER`, `BAR_STYLE`, `NAMEPLATE`, `NAMEPLATE_STYLE`, `UiRect`, `CONDITION_BADGE`, `fitBadges`, `badgePositions`, `textBackground`, `textFontWeight`, `textFontStyle`, `textRotation`, `textScale`, `TEXT_LINE_SPACING`, `MIN_HEX_NUMBER_SCREEN_SIZE`.
  - **Task 2 names** are used in Tasks 3–5: `SceneCamera`, `CAMERA_INTERVAL_MS`, `roundedCamera`, `sameCamera`, `cameraOfMessage`, `isSceneCamera`, `CameraViewport`, `ViewCamera`, `viewCamera`, `watchViewCamera`, `PresentedSceneInfo.camera` / `watchCamera`, `CameraSender`, `CameraProjection`, `PlayerSession.camera` / `onCamera`, `createOnlineLog`, `loggedSession`, `logPresentedScene`, `OnlineSettings.logEvents`, `FakeViewport`, `viewWithViewport`, `emptySceneState`.
  - **Task 3 names** are used in Task 4: `Camera`, `WorldRect`, `ScreenSize`, `ScreenPoint`, `GLIDE_MS`, `DEFAULT_CAMERA`, `intersects`, `intersection`, `sameRect`, `CameraController` and its methods, `ViewInput`, `PointerInput`, `PointerKind`, `ViewSurface`, `LayerSurface`, `ShapeStyle`, `TextStyle`, `SurfaceImage`, `ImageClip`, `LayerFrame`, `PlayerLayer`, `ImageLookup`, `PlayerViewRenderer`, `pixelRatioFor`, `VIEW_BACKGROUND`, `RecordingSurface`, `RecordingLayer`, `fakeFrames`, `decodedImage`, `frame`.
- **Review Focus.** Each of the five lines has its named test:
  - Task 2: `sends at most every 100 ms, and the final position after a continuous pan`.
  - Task 3: `moves nothing on a click, or a tap that jitters less than the slop`, `keeps panning with the remaining finger after a pinch`, `uses a GM camera that arrived before its scene, and ignores one for another scene`, and `stays finite while the canvas has no size, and refits once it has one`.
