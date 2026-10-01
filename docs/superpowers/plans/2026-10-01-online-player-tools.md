# Online Player Tools (Online Play, Polish B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give online players Atlas's table tools on the join page: the drag ruler with the GM's measurement settings, dice rolls that the GM's side rolls and everyone sees in a shared dice log, a private measure tool (line, circle, cone), and a laser pointer everyone sees, GM's included.

**Architecture:**
- **Shared modules first (Task 1).** The maths both sides need moves out of Atlas's PIXI and React code into modules with no PIXI, Obsidian, React or DOM imports, and Atlas uses them with no change in what it draws:
  - dice formulas and rolling (`tools/diceRolling.ts`);
  - measure shapes and label geometry (`pixi/measureGeometry.ts`);
  - drag ruler waypoints (`pixi/token-renderer/dragRulerPath.ts`);
  - cell snapping (`grid/gridDistance.ts`);
  - laser trail fading and point spacing (`pixi/laser/laserTrail.ts`, `laserBeamGeometry.ts`).
  - The player projection also gains `measurement`, the GM's `MeasurementSettings`, recorded in the coverage tables.
- **GM side (Task 2).** Two new `GmSession` handlers, started beside `TokenControlHost`:
  - `DiceHost` rolls players' `dice-roll` messages with Atlas's dice code. It hands each result to Atlas's dice log through the `atlas-dice-rolled` event, the path every Atlas roll takes, so the GM's log, toast and sound show it under the player's name. It relays every roll that event carries, the GM's and players', as `dice-log`, and replays the latest 50 on admission.
  - `LaserRelay` relays players' `laser` messages to the other players and into the GM's view. It also sends the GM's own laser, read from the presented view through a `LaserHub`. A PIXI `RemoteLaserRenderer` in each Atlas view draws the lasers the relay shows there.
  - `PlayerSession` sends rolls and lasers and reports logs and lasers.
- **Player page (Task 3).**
  - `PlayerTools` (pure) takes the presses `ViewInput` hands to tokens. With Move it drags tokens with the drag ruler; with Measure or Laser each one-finger press belongs to the tool.
  - A tools overlay draws measurements, the ruler and lasers through `ViewSurface`.
  - Pure page models run the toolbar fit (Atlas's own `overflowingToolbarItems`), the dice tray and the dice log.
  - `online-client/*.mts` only builds and binds DOM.
- **Docs and checks (Task 4).**

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), PIXI v8 (Atlas side only), React 19 (Atlas's dice log only), Canvas 2D through `ViewSurface` (join page), PeerJS/WebRTC (unchanged), Vitest 4 with jsdom 26 (no canvas, no `PointerEvent`, no `ResizeObserver`, no `matchMedia`), Vite (join page build, `npm run build:online` into `dist-online/`).

**Spec:** `docs/superpowers/specs/2026-10-01-online-player-tools-design.md`. It builds on the player view and token moves pieces (`2026-10-01-online-player-view-design.md`, `2026-10-01-online-token-moves-design.md`), whose plans are in `docs/superpowers/plans/`. Polish A (`docs/superpowers/plans/2026-10-01-online-gm-polish.md`) is already built on this branch (up to `76bde23`). It touched none of this plan's code files.

## Global Constraints

- **The `dice-roll` message (player to GM, control channel, protocol version 1).**
  - Shape: `{ v: 1, type: 'dice-roll', dice: Record<'d4'|'d6'|'d8'|'d10'|'d12'|'d20'|'d100', number>, modifier }`. A die left out counts 0.
  - The dice total 1 to 20 (`DICE_LIMITS.dicePerRoll = 20`), and every count is a whole number of at least 0.
  - `modifier` is a whole number from −1000 to 1000 (`DICE_LIMITS.modifier = 1000`).
- **Rolling.**
  - The GM's side rolls with Atlas's dice code (`rollFormula(diceFormula(dice, modifier))`).
  - It adds an entry to its own dice log with the roller name, formula, each die and total, by dispatching `atlas-dice-rolled` with `rolledBy: <player name>`.
  - At most 2 rolls per player per second (`DICE_LIMITS.rollsPerSecond = 2`, any 1000 ms window). Excess rolls are ignored. A malformed roll is an invalid message, as every malformed message is.
- **The `dice-log` message (GM to players).**
  - Shape: `{ v: 1, type: 'dice-log', entries: DiceLogEntry[], replay: boolean }`, entries newest first.
  - Each entry is `{ id, name, formula, dice: { die, value }[], modifier, total, at }`.
  - On every admission the player gets the latest 50 (`DICE_LIMITS.logEntries = 50`) with `replay: true`, even when there are none. Each new roll then follows with `replay: false`, GM rolls and player rolls alike.
  - Entry limits: name 1–80 characters, formula ≤ 200 characters, ≤ 100 dice listed.
  - A die is `d<1–9999 sides>` with a whole-number value from 1 to its sides.
- **The `laser` message.**
  - Player to GM: `{ v: 1, type: 'laser', sceneId, points: ScenePoint[], lifted }`.
  - GM to players: `{ v: 1, type: 'laser', from, sceneId, points, lifted }`.
  - Limits: at most 64 points (`LASER_LIMITS.points = 64`) and at most 20 messages per player per second (`LASER_LIMITS.perSecond = 20`). Points lie within `SCENE_RANGES.coordinate`.
  - The GM relays each laser to every *other* admitted player, with `from` set to the sender's session id; any `from` a player sends is ignored. The relayed laser is shown in the GM's view while the scene is live.
  - The GM's own laser goes out the same way, with `from: 'gm'` (`GM_LASER_ID`), only while the presented scene is live.
  - Lasers for another `sceneId` than the one players have are ignored. Nothing is stored.
- **Laser timing.**
  - Senders batch points, at most one message every 50 ms (`LASER_INTERVAL_MS`), keeping the newest 64.
  - A held laser sends an empty batch every 500 ms (`LASER_KEEPALIVE_MS`).
  - A receiver lets a laser go after 1000 ms without a message (`LASER_STALE_MS`).
  - A player who leaves mid-stroke is let go everywhere.
- **Laser colours.**
  - Every laser takes a colour from `LASER_COLOR_SWATCHES`, in its order.
  - The GM is index 0. Each player is their index in the session's order of non-pending players (join order, as `presence` lists them) plus 1, modulo 8.
  - On players' screens every laser is drawn at the default size 16 (`DEFAULT_LASER_POINTER_SETTINGS.size`).
  - In the GM's view, the GM's own laser keeps the GM's laser settings.
- **Measurement settings.**
  - The projection gains `measurement: { mode, unitType, unitDistance, diagonalRule, rangeBands }`, which is Atlas's `MeasurementSettings`. It comes from the collection's grid defaults, or else from the map's grid (`resolveMeasurementSettings`).
  - Limits: at most 32 range bands (`SCENE_LIMITS.rangeBands`); `unitDistance` within `[0, 1_000_000]` and `maxSquares` within `[1, 1_000_000]`.
  - The field is recorded as sent in `MEASUREMENT_FIELD_COVERAGE` and `GRID_FIELD_COVERAGE`, and validated on the player side.
- **Measure and drag ruler.** Both are local to the player's page. Nothing about them is sent.
- **Toolbar.**
  - A bottom toolbar styled like Atlas's main toolbar, with these controls:
    - **Move**: the default. It pans the map and drags the player's own tokens.
    - **Measure**: a split button whose flyout offers **Line**, **Circle/Sphere** and **Cone**.
    - **Laser**.
    - **Dice**: toggles the dice tray.
  - Priorities: Move 100, Measure 90, Laser 80, Dice 75.
  - Controls that do not fit go into **More tools**, fitted by Atlas's `overflowingToolbarItems` (unchanged). The active tool, and a control whose menu or tray is open, never move into More tools.
  - Icons are Atlas's own Lucide and dice-tray glyphs, drawn as CSS mask images.
- **Gestures.**
  - Measure: drag from start to point; the measurement is gone on release.
  - Laser: hold and move; the trail fades after release over Atlas's `LASER_FADE_TIME` (800 ms).
  - Two fingers always pinch and pan the map.
  - **Escape**, or choosing the active tool again, returns to Move.
  - Drag ruler waypoints:
    - Desktop: Atlas's waypoint key, Space (`WAYPOINT_KEY = ' '`).
    - Phones: holding still mid-drag for 500 ms (`WAYPOINT_HOLD_MS`) adds one, where still means within `TAP_SLOP` (6 px).
  - No other hotkeys.
- **Dice tray and dice log.**
  - The tray uses Atlas's dice tray look and dice icons:
    - a click adds a die;
    - a right-click, or a long-press of 500 ms, removes one;
    - it has a **Modifier** field and **Roll**.
  - The dice log is a side panel 360 px wide, and a bottom sheet at 720 px wide or less. It shows the name, formula, each die and the total, newest first.
  - While the log is closed, a new roll shows as a toast for 7000 ms (`DICE_TOAST_MS`, Atlas's toast time).
  - All network text reaches the page through `textContent`, and the canvas only through `fillText`.
- **Copy.**
  - Use these texts exactly: "Move", "Measure", "Measure options", "Line", "Circle/Sphere", "Cone", "Laser", "Dice", "More tools", "Dice log", "Close dice log", "Roll", "Clear selection", "Modifier", "Select dice to roll", "No rolls yet", "GM".
  - The die hint is Atlas's: "D20 • Left: add • Right: remove".
- **Shared modules.** These are shared with the web page, so they import nothing from `obsidian`, PIXI, PeerJS, React or the DOM:
  - Everything new under `src/app/online/tools/`, `src/app/online/view/tools/` and `src/app/online/page/`.
  - `src/app/tools/diceRolling.ts`, `src/app/pixi/measureGeometry.ts`, `src/app/pixi/token-renderer/dragRulerPath.ts`, `src/app/pixi/laser/laserTrail.ts`, `src/app/pixi/laser/remoteLasers.ts`, `src/app/pixi/laser/LaserHub.ts` and `src/app/online/rateLimit.ts`.
  - The existing `src/app/pixi/laser/laserBeamGeometry.ts`, `src/app/grid/gridDistance.ts`, `src/app/grid/measurementFormat.ts`, `src/app/tools/laserPointerSettings.ts` and `src/app/packages/components/toolbar/toolbarFit.ts` stay that way.
- **No DOM in `src/`.**
  - The shared modules never touch the DOM.
  - Lint is `--max-warnings 0` with Obsidian's rules (`obsidianmd/prefer-create-el`, `obsidianmd/prefer-window-timers`).
  - DOM glue lives in `online-client/*.mts`. It is type-checked by `tsc` and tested under jsdom, except `main.mts`, which is neither linted nor tested; Task 4 checks its wiring in `dist-online/`.
- **File sizes.**
  - `SceneBroadcaster.ts` stays at exactly 300 lines: Task 1 changes one line in place and adds no line.
  - `GmSession.ts` (302 lines) is not modified.
  - Every new file stays under 300 lines.
  - The oversize `PixiRendererOrchestrator.ts`, `MeasureRenderer.ts` and `LaserPointerRenderer.ts` only lose code or gain the few wiring lines named in their steps.
- **Atlas behaviour.**
  - It does not change, except for the dice modifier fix (ruling 1).
  - These existing tests must pass unchanged: `tests/unit/dragRuler.test.ts` (Space through `activeWindow`), `dragRulerView.test.ts` (imports `pathMidpoint` from `utils/measureDrawing`), `canvasLaserBeam.test.ts` (imports `beamWidth` from `laser/LaserBeam`), `laserPointerRenderer.viewportMoved.test.ts` (calls `trackPointer`, `handleViewportMoved`, `addTrailPoint` and `redraw` by name), `laserBeamGeometry.test.ts`, `laserPointerSettings.test.ts`, `playerWindowDiceRolls.test.tsx`, `measurementFormat.test.ts`, `gridDistance.test.ts`, `grid.test.ts`, `src/app/tools/__tests__/diceCrit.test.ts` and `tokenMoveHandler.test.ts` (imports `MoveRateLimit`).
  - Keep those names and add the re-exports the steps name.
- **Polish A boundary.**
  - Do not touch polish A's files: `MainToolbar.tsx`, `toolbarFit.ts`, `CommandPalette.tsx`, `SceneTabBar.tsx`, `UIRoot.tsx`, or anything under `src/app/react/components/online/` or `src/app/online/ui/`.
  - Polish A added lines to `README.md` and `changelog/Unreleased.md`. Add beside them and change none of theirs.
- **Code style (CLAUDE.md, CONTRIBUTING.md, ESLint).**
  - Explicit return types.
  - `window.setTimeout` / `window.clearTimeout` in `src`.
  - Sentence-case UI text.
  - No inline `eslint-disable`, no `@ts-expect-error`, no `title` attributes; the page's tooltips come from `data-label` in CSS.
  - PIXI v8 only in Atlas code.
  - Player-facing changes go in `changelog/Unreleased.md`, which uses CRLF line endings; keep them.
- **Tests.**
  - They live in `tests/unit/online/` (online and page code) and `tests/unit/` (shared Atlas modules).
  - Use fake timers wherever timing matters.
  - Page modules take an injected clock and frame scheduler.

## Review Focus

- **A player reconnects, or rejoins in a new tab.** They expect their dice log to show each roll once and no toast for old rolls. Tests: Task 2 `replays the latest rolls to a rejoining player`; Task 3 `replaces the log on a replay, without a toast`.
- **A laser stroke is interrupted** by a second finger, a browser `pointercancel`, a tool switch, Escape, a lost connection, or the player leaving. Everyone expects that laser to fade, not to hang at its last point. Tests: Task 3 `lets the laser go when the stroke is interrupted`; Task 2 `lets a leaving player's laser go for everyone`.
- **A mixed selection with several dice of a kind, such as 2d6 + 3d8 + 1.** Players expect the total of those dice plus 1. Atlas's old parser read the `+3` of `3d8` as a modifier. Tests: Task 1 `reads a count before a second die as dice, not as a modifier`; Task 2 `rolls a player's mixed roll on the GM's side`.
- **The GM rolls from the statblock of a token hidden from players.** Players expect to see the roll as "GM", never the hidden token's name. Test in Task 2: `names a roll for a hidden token GM`.
- **One key press or one hold means one action.** Holding still on a phone adds one waypoint. A long-press on a die removes one die, even though the browser also sends `contextmenu`. Space during a drag adds a waypoint and never presses a focused toolbar button. Tests: Task 3 `adds one waypoint per hold`, `removes one die per long-press, even with the browser's contextmenu`, `adds a waypoint on Space during a drag, and presses no focused button`.

The spec's other likely failures have tests too:
- Task 2: the 2-per-second roll limit; the 20-per-second laser limit; a laser for another scene; a spoofed `from: 'gm'`; the GM's laser while the scene is held; the measurement field in snapshots and patches.
- Task 3: snapping that matches the GM's drop (Task 1 tests the snap itself); measuring with the grid hidden from players; the toolbar fit keeping the active tool.

## Rulings on spec ambiguities

Each task repeats the rulings it needs.

1. **Dice modifiers.**
   - Atlas's `DiceTool` reads modifiers with `/([+-]\s*\d+)/`. That also matches the count of a later die: `2d6+3d8` rolls five dice *and* adds 3. Atlas's own tray writes formulas like that.
   - **Ruling.** The shared `rollFormula` reads each term once, so `2d6+3d8` rolls five dice and adds nothing. Atlas's `DiceTool` uses it, so the fix reaches Atlas too.
   - Dice with a minus sign (`-1d4`) still add, as before.
   - Every other formula rolls exactly as before. A controller item covers this.
2. **Roller names.**
   - A player's roll carries `rolledBy`, the player's session name.
   - A GM roll is named by Atlas's own rule (`rollerName`):
     - the statblock token's name, unless the token is hidden on the presented scene (`withoutHiddenToken`, extracted from `PlayerDiceToasts`);
     - otherwise "GM".
   - Atlas's dice log entry and toast show the `rolledBy` name where they show a statblock token's name.
3. **Replay.**
   - `dice-log` carries `replay`. On every admission, reconnects and new tabs included, the GM sends the latest 50 with `replay: true`, even when that list is empty. The page replaces its log and toasts nothing.
   - Live rolls carry `replay: false`, and the page adds them by id, so a repeated entry is never shown twice.
4. **What the 50 are.**
   - The GM keeps the latest 50 rolls seen while hosting, newest first.
   - The list is not seeded from the presented scene's stored `diceLog`, which holds 20 per map and belongs to one map.
   - Atlas's "Clear history" does not clear players' logs. A controller item covers both points.
5. **Physical dice.**
   - Atlas has no physical-dice integration today; a search for one found nothing.
   - Every roll that reaches Atlas's dice log does so through `atlas-dice-rolled`. The relay listens there, so a physical-dice integration that dispatches it reaches players with no change.
6. **Laser messages.**
   - Each message carries the points added since the last one, not the whole trail. `lifted` comes in order after the stroke's last points.
   - A player's laser is relayed to players whenever its `sceneId` is the one players have, also while the scene is held, since players keep seeing the held scene.
   - It is drawn in the GM's view only while the scene is live, because a held view shows another map.
   - The GM's own laser is read only while the presented scene is live. Holding or clearing it lets the GM's laser go.
7. **Laser look on players' screens.**
   - The page draws Atlas's Canvas-renderer beam (`CanvasLaserBeam`): the body in the person's colour and a white-hot filament, without the glow, at the default size.
   - The GM's view draws players' lasers with the same `LaserBeam` or `CanvasLaserBeam` as the GM's own.
   - Each laser fades like Atlas's, and the newest point stays at full strength until the laser is let go.
8. **Measurement on the wire.**
   - The projection sends all of `MeasurementSettings` (mode, unit type, units per cell, diagonal rule, range bands). That way the page labels distances with Atlas's own `formatDistance`. The spec's "unit label" is the unit type, which `formatDistance` turns into its label ("ft", "m", …).
   - Online play is unreleased (`changelog/Unreleased.md`), so no GM without the field exists, and the field is required.
   - A change to the collection's grid defaults reaches players with the next scene change or snapshot, because `sliceOf` does not watch collection settings. A controller item covers this.
9. **Snapping on the page.**
   - Measure points and the drag ruler snap to the cell centre when the scene has a grid for players. They use `cellCenterAt`, which `GridSystem.snapToCellCenter` now also uses, so the ruler lands where the GM's drop does.
   - When the grid is hidden from players, the page measures with a square grid of `map.cellSize` and does not snap, since the grid's offset is not sent.
10. **Toolbar details.**
    - Labels follow the spec (Move, Measure, Laser, Dice). The shape names follow Atlas's flyout (Line, Circle/Sphere, Cone).
    - The laser has no priority of its own in Atlas, where it sits in the Move group. Here it gets 80, between Measure and Dice.
    - The dice log opens from a **Dice log** button in the top bar, beside **Menu**, and from a tap on the toast. It is not a toolbar tool.
    - The spec names only Escape and the waypoint key, so Atlas's Enter hotkey for the log is not added.
11. **Drawing order.**
    - The tools draw over the whole scene, fog included, in this order: measurement, drag ruler, lasers. Atlas puts its measurement and its laser (z-index 2000) above the scene too.
    - On the page, the ruler's path is drawn over the dragged token. As in Atlas, the end point has no marker.
    - The player's own laser shows at once, without waiting for the GM.
12. **Colours on the page.**
    - The page has no Obsidian theme. Measurements use the page's accent (`#7c5cff`, `--accent` in `style.css`) where Atlas uses the GM's Obsidian accent.
    - The label pill uses Atlas's dark-theme colours, as the nameplates do (piece 4, ruling 11).
13. **Long-press.**
    - On touch, a hold of 500 ms removes one die.
    - A `contextmenu` or `click` within 800 ms after a long-press removal, or after a `contextmenu` removal, is ignored. Android sends `contextmenu` on long-press, and one hold must remove exactly one die.

## Items for the controller to decide

- **The dice modifier fix (ruling 1).** It changes Atlas's results for formulas like `2d6+3d8`: they no longer add the second die's count. Keep the fix, or keep Atlas's old reading and fix only the online rolls?
- **The dice log list (ruling 4).**
  - Should the 50 be seeded from the presented scene's stored log?
  - Should Atlas's "Clear history" clear players' logs too?
- **Collection measurement changes (ruling 8).** Should a later piece push them to players at once, for example by watching the collection settings?
- **Physical dice (ruling 5).** No integration exists. If one is planned, it only has to dispatch `atlas-dice-rolled`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/app/tools/diceRolling.ts` | `DICE_TYPES`, `DiceSelection`, `DiceRollResult` (moved), `diceTerms`, `diceFormula`, `rollFormula`, `withoutHiddenToken`, `rollerName`, `DICE_ROLLED_EVENT`. |
| `src/app/tools/DiceTool.ts`, `react/components/dice/DiceGrid.tsx`, `DiceFormulaBar.tsx`, `DiceDropdownMenu.tsx`, `PlayerDiceToasts.tsx` (modify) | Use the shared dice module. |
| `src/app/pixi/measureGeometry.ts` | Measure strokes, points, areas, cone, arc, label anchor, label box and colours, `pathMidpoint` (moved). |
| `src/app/pixi/utils/measureDrawing.ts`, `src/app/pixi/MeasureRenderer.ts` (modify) | Draw from `measureGeometry.ts`. |
| `src/app/pixi/token-renderer/dragRulerPath.ts` | Waypoints and landing of a drag ruler, `WAYPOINT_KEY`. |
| `src/app/pixi/token-renderer/DragRuler.ts` (modify) | Uses `DragRulerPath`. |
| `src/app/grid/gridDistance.ts`, `src/app/grid/GridSystem.ts` (modify) | `cellCenterAt`, shared by `GridSystem.snapToCellCenter` and the page. |
| `src/app/pixi/laser/laserBeamGeometry.ts`, `LaserBeam.ts`, `CanvasLaserBeam.ts` (modify) | `beamWidth`, `beamSmoothingSpacing`, `laserPointSpacing` and the filament constants move to the geometry module. |
| `src/app/pixi/laser/laserTrail.ts` | `LaserTrail`: timed points, fading, capped. |
| `src/app/pixi/LaserPointerRenderer.ts` (modify) | Uses `LaserTrail` and `laserPointSpacing`; in Task 2 it also emits the GM's laser to its `LaserHub`. |
| `src/app/online/scene/sceneTypes.ts`, `sceneValidation.ts`, `projectForPlayers.ts`, `sceneSources.ts`, `SceneBroadcaster.ts`, `PlayerSceneMirror.ts`, `src/app/online/coverage.ts`, `src/app/services/mapMeasurementSettings.ts` (modify) | `measurement` in the projection. |
| `src/app/online/rateLimit.ts` | `RateLimit` per player; `MoveRateLimit` extends it. |
| `src/app/online/tools/toolMessages.ts` | Dice and laser wire types, limits, validators, `diceLogEntry`. |
| `src/app/online/protocol.ts` (modify) | `dice-roll`, `dice-log`, `laser`; `PLAYER_MESSAGE_TYPES`. |
| `src/app/online/tools/diceFeed.ts` | `DiceFeed`: Atlas's `atlas-dice-rolled` event. |
| `src/app/online/tools/DiceHost.ts` | GM: rolls players' dice, relays and replays the dice log. |
| `src/app/online/tools/laserColors.ts` | `GM_LASER_ID`, `laserColor`. |
| `src/app/online/tools/LaserBatcher.ts` | Batches laser points (50 ms, 64 points, keepalive). |
| `src/app/online/tools/LaserRelay.ts` | GM: relays lasers and sends the GM's own. |
| `src/app/pixi/laser/remoteLasers.ts` | `RemoteLasers`: other people's fading trails. |
| `src/app/pixi/laser/LaserHub.ts` | A view's lasers for online play: local events out, remote lasers in. |
| `src/app/pixi/laser/RemoteLaserRenderer.ts` | PIXI: players' lasers in the GM's view. |
| `src/app/PixiRendererOrchestrator.ts`, `src/app/services/PresentedScene.ts` (modify) | The hub and the remote laser renderer per view; `PresentedSceneInfo.laser()`. |
| `src/app/online/PlayerSession.ts` (modify) | `sendDiceRoll`, `sendLaser`, `onDiceLog`, `onLaser`. |
| `src/app/online/OnlineSessionService.ts` (modify) | Collection grid defaults (Task 1); starts `DiceHost` and `LaserRelay` (Task 2). |
| `src/app/react/components/dice-log/DiceRollEntry.tsx`, `dice/DiceToast.tsx` (modify) | Show the online player's name. |
| `src/app/online/view/ViewInput.ts`, `TokenMoves.ts`, `PlayerViewRenderer.ts`, `layers/layerTypes.ts` (modify) | Pointer kind on grab; the dragged token's origin; overlay layers. |
| `src/app/online/view/tools/toolGrid.ts`, `MeasureTool.ts`, `DragRulerTool.ts`, `LaserTool.ts`, `PlayerTools.ts`, `toolsLayer.ts` | The page's tools and what they draw. |
| `src/app/online/page/toolIcons.ts`, `playerToolbar.ts`, `diceTray.ts`, `diceLogModel.ts` | Page models: icons, toolbar fit, dice tray, dice log. |
| `online-client/icons.mts`, `toolbar.mts`, `diceTrayView.mts`, `diceLogView.mts` | DOM for the toolbar, dice tray and dice log. |
| `online-client/mapView.mts`, `main.mts`, `index.html`, `style.css` (modify) | Wiring and layout. |
| `docs/online-play-features.md`, `README.md`, `PRIVACY.md`, `changelog/Unreleased.md` (modify) | Documentation. |

Tests:
- **New:**
  - In `tests/unit/`: `diceRolling.test.ts`, `playerToolsShared.test.ts`, `remoteLasers.test.ts`, `remoteLaserRenderer.test.ts`, `laserPointerRenderer.hub.test.ts`, `diceRollerName.test.tsx`.
  - In `tests/unit/online/`: `toolMessages.test.ts`, `diceHost.test.ts`, `laserBatcher.test.ts`, `laserRelay.test.ts`, `toolsFixtures.ts`, `playerToolsEndToEnd.test.ts`, `playerTools.test.ts`, `dragRulerTool.test.ts`, `toolsLayer.test.ts`, `toolIcons.test.ts`, `playerToolbar.test.ts`, `diceTray.test.ts`, `diceLogModel.test.ts`, `pageToolbar.test.ts`, `diceTrayView.test.ts`, `diceLogView.test.ts`, `playerToolsPage.test.ts`.
- **Modified:** `coverage.test.ts`, `projectForPlayers.test.ts`, `sceneProtocol.test.ts`, `projectParts.test.ts`, `sceneFixtures.ts`, `onlineSessionService.test.ts`, `playerViewRenderer.test.ts`, `mapView.test.ts`, `tokenMovesPage.test.ts`.

Task order: 1 → 2 → 3 → 4. Task 2 needs Task 1's dice and laser modules. Task 3 needs Task 1's geometry and measurement, and Task 2's messages, `PlayerSession`, `LaserBatcher`, `RemoteLasers` and `laserColor`. Task 4 needs all three.

---
### Task 1: Shared dice, measure, ruler and laser modules, and the measurement in the projection

The maths the join page needs moves out of Atlas's PIXI and React code into modules without PIXI, Obsidian, React or DOM imports, and Atlas uses them. Atlas draws exactly as before; the one change in behaviour is the dice modifier fix (ruling 1). The projection gains `measurement`, recorded in the coverage tables and validated on the player side.

Rulings this task needs: 1 (dice modifiers), 2 (`withoutHiddenToken` and `rollerName`), 8 (measurement on the wire), 9 (`cellCenterAt`).

**Files:**
- Create: `src/app/tools/diceRolling.ts`
- Modify: `src/app/tools/DiceTool.ts` (whole file), `src/app/react/components/dice/DiceGrid.tsx:1-16`, `src/app/react/components/dice/DiceFormulaBar.tsx:15-20`, `src/app/react/components/dice/DiceDropdownMenu.tsx:50-60`, `src/app/react/components/dice/PlayerDiceToasts.tsx:24-30`
- Create: `src/app/pixi/measureGeometry.ts`
- Modify: `src/app/pixi/utils/measureDrawing.ts` (whole file), `src/app/pixi/MeasureRenderer.ts` (imports, `measureShape`, `updateMeasurement`, `drawCone`, `labelAnchor`, `createPersistentMeasurement`, `drawCircleOnGraphics`, `drawConeOnGraphics`)
- Create: `src/app/pixi/token-renderer/dragRulerPath.ts`
- Modify: `src/app/pixi/token-renderer/DragRuler.ts` (whole file)
- Modify: `src/app/grid/gridDistance.ts` (add `cellCenterAt`), `src/app/grid/GridSystem.ts:7, 417-430`
- Modify: `src/app/pixi/laser/laserBeamGeometry.ts` (add the beam width functions), `src/app/pixi/laser/LaserBeam.ts:4-37`, `src/app/pixi/laser/CanvasLaserBeam.ts:1-7`
- Create: `src/app/pixi/laser/laserTrail.ts`
- Modify: `src/app/pixi/LaserPointerRenderer.ts:1-30, 41, 248-265, 269-297, 310-322`
- Modify: `src/app/online/scene/sceneTypes.ts`, `sceneValidation.ts`, `projectForPlayers.ts`, `sceneSources.ts`, `SceneBroadcaster.ts:22, 257`, `PlayerSceneMirror.ts:131-132`, `src/app/online/coverage.ts`, `src/app/services/mapMeasurementSettings.ts`, `src/app/online/OnlineSessionService.ts` (constructor and broadcaster options)
- Test: `tests/unit/diceRolling.test.ts`, `tests/unit/playerToolsShared.test.ts`, `tests/unit/online/coverage.test.ts`, `tests/unit/online/projectForPlayers.test.ts`, `tests/unit/online/sceneProtocol.test.ts`, `tests/unit/online/onlineSessionService.test.ts`; fixtures `tests/unit/online/sceneFixtures.ts`, `tests/unit/online/projectParts.test.ts:194`

**Interfaces:**
- Consumes:
  - `resolveMeasurementSettings`, `formatDistance` and `MeasurementSettings` (`grid/measurementFormat.ts`).
  - `pathLengthInCells` and `GridGeometry` (`grid/gridDistance.ts`); `createHexLayout`, `isHexGridType` and `nearestHexCenter` (`grid/hexGeometry.ts`).
  - `CollectionGridDefaults` (`types/collectionSettingsTypes.ts`); `LASER_FADE_TIME` (`tools/laserPointerSettings.ts`).
- Produces:
  - `diceRolling.ts`:
    - Values and types: `DICE_TYPES`, `type DieType`, `type DiceSelection = Partial<Record<DieType, number>>`, `isDieType(value): value is DieType`, `interface DiceRollResult` (moved from `DiceTool.ts`, which re-exports it, plus `rolledBy?: string`), `DICE_ROLLED_EVENT = 'atlas-dice-rolled'`.
    - Formulas: `diceTerms(selection): string[]`, `diceFormula(selection, modifier = 0): string`, `rollFormula(formula, random = Math.random, now = Date.now()): DiceRollResult`.
    - What players see: `withoutHiddenToken(result, isTokenHidden: (tokenId: string) => boolean): DiceRollResult`, `rollerName(result): string | null`.
  - `measureGeometry.ts`:
    - Types: `type MeasureShape = 'line' | 'cone' | 'circle' | 'sphere'`, `LabelBox`, `ConeGeometry`.
    - Style constants: `MEASURE_SHADOW`, `MEASURE_PATH_STROKES`, `MEASURE_POINT`, `MEASURE_AREA`, `CONE_ANGLE`, `MEASURE_LABEL_FONT_SIZE`, `MEASURE_LABEL_COLORS`.
    - Functions: `pathMidpoint(points)`, `measureLabelFontSize(scale)`, `measureLabelAnchor(start, end, scale)`, `measureLabelBox(textWidth, textHeight, center, scale): LabelBox`, `coneGeometry(start, end): ConeGeometry`, `arcPoints(center, radius, startAngle, endAngle, segments): Point[]`.
  - `dragRulerPath.ts`: `WAYPOINT_KEY = ' '`, `samePoint(a, b)`, `class DragRulerPath { constructor(snap); active; begin(origin); update(position); addWaypoint(): boolean; points(): Point[] | null; end() }`, `dragRulerLabel(grid, points, settings): string`.
  - `gridDistance.ts`: `cellCenterAt(grid: GridGeometry, point: Point): Point`.
  - `laserBeamGeometry.ts` gains `interface BeamWidth`, `beamWidth(size, zoom)`, `beamSmoothingSpacing(halfWidth, zoom)`, `laserPointSpacing(size, zoom)`, `FILAMENT_SHARE = 0.25` and `FILAMENT_COLOR = 0xffffff`. `LaserBeam.ts` re-exports `beamWidth`, `beamSmoothingSpacing` and `BeamWidth`.
  - `laserTrail.ts`: `class LaserTrail { length; last(); add(x, y, now); prune(now); beamPoints(now): BeamPoint[]; clear() }`.
  - `sceneTypes.ts`:
    - Constants: `PLAYER_MEASUREMENT_MODES`, `PLAYER_UNIT_TYPES`, `PLAYER_DIAGONAL_RULES`; `SCENE_LIMITS.rangeBands = 32`; `SCENE_RANGES.unitDistance = [0, 1_000_000]` and `SCENE_RANGES.rangeBand = [1, 1_000_000]`.
    - Types: `PlayerRangeBand { name; maxSquares }`, `PlayerMeasurement { mode; unitType; unitDistance; diagonalRule; rangeBands }`.
    - `PlayerScene.measurement: PlayerMeasurement`, and `'measurement'` in `SCENE_FIELD_KEYS`.
  - `ProjectionContext.collectionGrid?: CollectionGridDefaults | null`; `SceneBroadcasterOptions.collectionGrid?: (mapPath: string | null) => CollectionGridDefaults | null`; `sceneContext(scene, options)` in `sceneSources.ts`.
  - `coverage.ts`: `MEASUREMENT_FIELD_COVERAGE: CoverageTable<keyof CollectionGridDefaults>`.
  - `mapMeasurementSettings.ts`: `collectionGridDefaultsFor(assetService, mapPath): CollectionGridDefaults | null`.
  - `OnlineSessionService` deps: `collectionGrid?: (mapPath: string | null) => CollectionGridDefaults | null`.

- [ ] **Step 1: Write the failing dice tests**

Create `tests/unit/diceRolling.test.ts`:

```ts
import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import {
  DICE_TYPES, diceFormula, diceTerms, rollerName, rollFormula, withoutHiddenToken, type DiceRollResult,
} from '../../src/app/tools/diceRolling';
import { DiceTool } from '../../src/app/tools/DiceTool';

/** Returns `values` in turn, over and over, as `Math.random` would. */
function sequence(...values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length]!;
}

describe('dice formulas', () => {
  it('lists the dice of the tray in tray order', () => {
    expect(DICE_TYPES).toEqual(['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']);
  });

  it('writes a selection in the order it was picked, as the dice tray does', () => {
    expect(diceTerms({ d20: 1, d6: 2 })).toEqual(['d20', '2d6']);
    expect(diceTerms({ d4: 0, d8: 1 })).toEqual(['d8']);
    expect(diceFormula({ d6: 2, d20: 1 })).toBe('2d6+d20');
    expect(diceFormula({ d8: 3 }, 4)).toBe('3d8+4');
    expect(diceFormula({ d8: 3 }, -2)).toBe('3d8-2');
    expect(diceFormula({}, 5)).toBe('');
  });
});

describe('rollFormula', () => {
  it('rolls each die and adds the modifier', () => {
    // floor(0.5 × 20) + 1 = 11.
    const result = rollFormula('1d20+5', sequence(0.5), 1000);
    expect(result.rolls).toEqual([{ die: 'd20', value: 11, max: 20 }]);
    expect(result).toMatchObject({ formula: '1d20+5', modifiers: 5, total: 16, timestamp: 1000 });
  });

  it('reads a count before a second die as dice, not as a modifier', () => {
    const result = rollFormula('2d6+3d8+1', sequence(0), 0);
    expect(result.rolls.map((roll) => roll.die)).toEqual(['d6', 'd6', 'd8', 'd8', 'd8']);
    expect(result.modifiers).toBe(1);
    expect(result.total).toBe(6);
  });

  it('reads spaced and negative modifiers, and dice without a count', () => {
    const result = rollFormula('d20 + 2 - 5', sequence(0), 0);
    expect(result.rolls).toEqual([{ die: 'd20', value: 1, max: 20 }]);
    expect(result.modifiers).toBe(-3);
    expect(result.total).toBe(-2);
  });

  it('is what DiceTool rolls', () => {
    const tool = new DiceTool(new EventEmitter());
    const result = tool.rollDice('2d6+3d8');
    expect(result.rolls).toHaveLength(5);
    expect(result.modifiers).toBe(0);
    expect(tool.getQuickDice()).toEqual([...DICE_TYPES]);
  });
});

describe('what players see of a roll', () => {
  const statblock: DiceRollResult = {
    id: 'r', timestamp: 0, formula: 'd20', rolls: [], modifiers: 0, total: 1,
    source: { type: 'statblock', tokenId: 'gob', tokenName: 'Goblin', abilityName: 'Scimitar' },
  };

  it('drops the token of a roll for a hidden token, and keeps the ability', () => {
    expect(withoutHiddenToken(statblock, () => true).source).toEqual({ type: 'statblock', abilityName: 'Scimitar' });
    expect(withoutHiddenToken(statblock, () => false)).toBe(statblock);
  });

  it('names the online player, else the statblock token, else nobody', () => {
    expect(rollerName({ ...statblock, rolledBy: 'Anna' })).toBe('Anna');
    expect(rollerName(statblock)).toBe('Goblin');
    expect(rollerName(withoutHiddenToken(statblock, () => true))).toBeNull();
    expect(rollerName({ ...statblock, source: { type: 'toolbar' } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the dice tests to verify they fail**

Run: `npx vitest run tests/unit/diceRolling.test.ts`
Expected: FAIL with "Failed to resolve import ../../src/app/tools/diceRolling".

- [ ] **Step 3: Create the shared dice module**

Create `src/app/tools/diceRolling.ts`:

```ts
/**
 * Atlas's dice: the dice its tray offers, the formula a selection makes, rolling a formula, and
 * what players may see of a roll. Shared with the online GM side and the join page, so it
 * imports nothing.
 */

/** The dice of Atlas's dice tray, in tray order. */
export const DICE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'] as const;
export type DieType = typeof DICE_TYPES[number];

/** How many of each die are picked; a die left out counts 0. */
export type DiceSelection = Partial<Record<DieType, number>>;

/** Every roll reaches Atlas's dice log, toasts and sounds as this document event. */
export const DICE_ROLLED_EVENT = 'atlas-dice-rolled';

export interface DiceRollResult {
  id: string;
  timestamp: number;
  formula: string;
  rolls: Array<{
    die: string; // e.g., "d20", "d6"
    value: number;
    max: number;
  }>;
  modifiers: number;
  total: number;
  player?: string;
  /** Who rolled it when it was not the GM: an online player's name. */
  rolledBy?: string;
  source?: {
    type: 'toolbar' | 'statblock';
    /** Let the roll follow its token's or statblock's current artwork. */
    tokenId?: string;
    statblockPath?: string;
    tokenName?: string;
    tokenImagePath?: string;
    abilityName?: string;
  };
}

export function isDieType(value: unknown): value is DieType {
  return typeof value === 'string' && (DICE_TYPES as readonly string[]).includes(value);
}

/** The picked dice in the order they were picked, e.g. `['2d6', 'd20']`; dice with no count are left out. */
export function diceTerms(selection: Readonly<Partial<Record<string, number>>>): string[] {
  return Object.entries(selection).flatMap(([die, count]) => (
    isDieType(die) && count !== undefined && count > 0 ? [count > 1 ? `${count}${die}` : die] : []
  ));
}

/** The formula Atlas rolls for a selection and a modifier, e.g. "2d6+d20-1"; empty without dice. */
export function diceFormula(selection: Readonly<Partial<Record<string, number>>>, modifier = 0): string {
  const dice = diceTerms(selection).join('+');
  if (!dice || modifier === 0) return dice;
  return `${dice}${modifier > 0 ? '+' : '-'}${Math.abs(modifier)}`;
}

/**
 * One term of a formula: dice with an optional sign and count ("+3d8", "d20"), or a signed flat
 * modifier ("- 2"). Reading both in one pass keeps the count of a later die from also counting
 * as a modifier.
 */
const TERM = /([+-])?\s*(\d+)?d(\d+)|([+-])\s*(\d+)/gi;

/**
 * Rolls `formula` with `random` for the dice. Dice add up whatever their sign, as Atlas has
 * always rolled them. The id stays random however the dice are rolled, so rolls made in the
 * same millisecond never share one.
 */
export function rollFormula(formula: string, random: () => number = Math.random, now: number = Date.now()): DiceRollResult {
  const rolls: DiceRollResult['rolls'] = [];
  let modifiers = 0;
  for (const [, , count, sides, sign, flat] of formula.matchAll(TERM)) {
    if (sides !== undefined) {
      const max = parseInt(sides, 10);
      const times = parseInt(count ?? '1', 10);
      for (let i = 0; i < times; i++) rolls.push({ die: `d${max}`, value: Math.floor(random() * max) + 1, max });
    } else if (flat !== undefined) {
      modifiers += sign === '-' ? -parseInt(flat, 10) : parseInt(flat, 10);
    }
  }
  const total = rolls.reduce((sum, roll) => sum + roll.value, 0) + modifiers;
  return {
    id: `roll_${now}_${Math.random().toString(36).slice(2, 11)}`,
    timestamp: now,
    formula,
    rolls,
    modifiers,
    total,
    player: 'Player',
  };
}

/** A roll for a token hidden from players keeps its ability and result, not the token's name or portrait. */
export function withoutHiddenToken(result: DiceRollResult, isTokenHidden: (tokenId: string) => boolean): DiceRollResult {
  const source = result.source;
  const tokenId = source?.tokenId;
  if (!source || !tokenId || !isTokenHidden(tokenId)) return result;
  const { type, abilityName } = source;
  return { ...result, source: abilityName ? { type, abilityName } : { type } };
}

/** The name a roll shows: the online player who rolled it, or a statblock roll's token; null for the GM's own. */
export function rollerName(result: DiceRollResult): string | null {
  if (result.rolledBy) return result.rolledBy;
  const source = result.source;
  return source?.type === 'statblock' && source.tokenName ? source.tokenName : null;
}
```

Replace `src/app/tools/DiceTool.ts` with:

```ts
import { EventEmitter } from 'events';
import { DICE_ROLLED_EVENT, DICE_TYPES, rollFormula, type DiceRollResult } from './diceRolling';

export type { DiceRollResult } from './diceRolling';

export interface DiceToolState {
  isTrayOpen: boolean;
  rollHistory: DiceRollResult[];
  activeFormula: string;
  quickDice: string[]; // Quick access dice buttons
}

export class DiceTool {
  public state: DiceToolState;
  private eventBus: EventEmitter;

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.state = {
      isTrayOpen: false,
      rollHistory: [],
      activeFormula: '',
      quickDice: [...DICE_TYPES],
    };
  }

  public toggleTray(): void {
    this.state.isTrayOpen = !this.state.isTrayOpen;
    this.eventBus.emit('dice-tray-toggled', this.state.isTrayOpen);
  }

  public rollDice(formula: string, source?: DiceRollResult['source']): DiceRollResult {
    const result = rollFormula(formula);
    if (source) {
      result.source = source;
    }

    // Add to history
    this.state.rollHistory.unshift(result);

    // Keep only last 50 rolls
    if (this.state.rollHistory.length > 50) {
      this.state.rollHistory = this.state.rollHistory.slice(0, 50);
    }

    document.dispatchEvent(new CustomEvent(DICE_ROLLED_EVENT, { detail: result }));

    return result;
  }

  public clearHistory(): void {
    this.state.rollHistory = [];
    this.eventBus.emit('dice-history-cleared');
    document.dispatchEvent(new CustomEvent('atlas-dice-history-cleared'));
  }

  public setActiveFormula(formula: string): void {
    this.state.activeFormula = formula;
  }

  public getQuickDice(): string[] {
    return this.state.quickDice;
  }

  public addQuickDie(die: string): void {
    if (!this.state.quickDice.includes(die)) {
      this.state.quickDice.push(die);
    }
  }

  public removeQuickDie(die: string): void {
    this.state.quickDice = this.state.quickDice.filter(d => d !== die);
  }

  // Get current state
  public getState(): DiceToolState {
    return { ...this.state };
  }
}
```

In `src/app/react/components/dice/DiceGrid.tsx`, replace the imports and the dice list:

```tsx
import React from 'react';
import { diceIcons } from '../DiceIcons';
import { cn } from '../../../../utils/cn';
import { LabelTooltip } from '../../../packages/components/primitives/tooltip';
import { DICE_TYPES } from '../../../tools/diceRolling';
```

Delete the line `const AVAILABLE_DICE: DiceType[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];` and change `{AVAILABLE_DICE.map(die => {` to `{DICE_TYPES.map(die => {`.

In `src/app/react/components/dice/DiceFormulaBar.tsx`, add `import { diceTerms } from '../../../tools/diceRolling';` after the `LabelTooltip` import, and replace `buildFormula` with:

```tsx
function buildFormula(selection: DiceSelection): string {
  return diceTerms(selection).join(' + ');
}
```

In `src/app/react/components/dice/DiceDropdownMenu.tsx`, add `import { diceFormula } from '../../../tools/diceRolling';` after the `DiceTool` import, and replace `handleRoll` with:

```tsx
  const handleRoll = useCallback((): void => {
    const formula = diceFormula(selection);
    if (!formula) return;

    diceTool.rollDice(formula);
    onToggle();
  }, [selection, diceTool, onToggle]);
```

In `src/app/react/components/dice/PlayerDiceToasts.tsx`, add `import { withoutHiddenToken } from '../../../tools/diceRolling';` after the `DiceRollResult` import, and replace `forPlayers` with:

```tsx
  const forPlayers = useCallback((result: DiceRollResult): DiceRollResult => withoutHiddenToken(
    result, (tokenId) => Boolean(store.getState().objects?.tokens?.[tokenId]?.isHidden),
  ), [store]);
```

- [ ] **Step 4: Run the dice tests and Atlas's dice tests**

Run: `npx vitest run tests/unit/diceRolling.test.ts tests/unit/playerWindowDiceRolls.test.tsx src/app/tools/__tests__/diceCrit.test.ts tests/unit/statblockDiceLinks.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for the shared geometry, ruler, snapping and laser trail**

Create `tests/unit/playerToolsShared.test.ts`:

```ts
import type { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { snapDroppedToken } from '../../src/app/clipboard/mapObjectPlacement';
import { cellCenterAt } from '../../src/app/grid/gridDistance';
import type { MeasurementSettings } from '../../src/app/grid/measurementFormat';
import { axialToPixel, createHexLayout, hexCircumradius } from '../../src/app/grid/hexGeometry';
import * as laserBeam from '../../src/app/pixi/laser/LaserBeam';
import { beamWidth, laserPointSpacing } from '../../src/app/pixi/laser/laserBeamGeometry';
import { LaserTrail } from '../../src/app/pixi/laser/laserTrail';
import {
  arcPoints, CONE_ANGLE, coneGeometry, measureLabelAnchor, measureLabelBox, measureLabelFontSize, pathMidpoint,
} from '../../src/app/pixi/measureGeometry';
import { DragRulerPath, dragRulerLabel, samePoint, WAYPOINT_KEY } from '../../src/app/pixi/token-renderer/dragRulerPath';
import { drawMeasurePath, drawMeasurePoint, pathMidpoint as drawingMidpoint } from '../../src/app/pixi/utils/measureDrawing';
import { LASER_FADE_TIME } from '../../src/app/tools/laserPointerSettings';

/** Records the Graphics calls the measure drawing makes. */
function recordingGraphics(): { graphics: Graphics; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const graphics: Record<string, (...args: unknown[]) => unknown> = {};
  for (const name of ['moveTo', 'lineTo', 'stroke', 'circle', 'fill']) {
    graphics[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
      return graphics;
    };
  }
  return { graphics: graphics as unknown as Graphics, calls };
}

describe('measure geometry', () => {
  it('keeps the drawing module exporting the same midpoint', () => {
    expect(drawingMidpoint).toBe(pathMidpoint);
  });

  it('draws the path as shadow, body and core, and points as halo, disc and ring', () => {
    const { graphics, calls } = recordingGraphics();
    drawMeasurePath(graphics, 0x123456, [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect(calls.filter(([name]) => name === 'stroke')).toEqual([
      ['stroke', { width: 6, color: 0x000000, alpha: 0.3 }],
      ['stroke', { width: 4, color: 0x123456, alpha: 0.8 }],
      ['stroke', { width: 2, color: 0x123456, alpha: 1 }],
    ]);
    calls.length = 0;
    drawMeasurePoint(graphics, 0x123456, { x: 5, y: 5 });
    expect(calls).toEqual([
      ['circle', 5, 5, 11], ['fill', { color: 0x000000, alpha: 0.3 }],
      ['circle', 5, 5, 8], ['fill', { color: 0x123456, alpha: 0.9 }],
      ['circle', 5, 5, 7], ['stroke', { width: 2, color: 0x123456, alpha: 1 }],
    ]);
  });

  it("opens the cone 90 degrees around the measured direction", () => {
    const cone = coneGeometry({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(cone.radius).toBe(100);
    expect(cone.endAngle - cone.startAngle).toBeCloseTo(CONE_ANGLE);
    expect(cone.left.x).toBeCloseTo(70.71);
    expect(cone.left.y).toBeCloseTo(-70.71);
    expect(cone.right.y).toBeCloseTo(70.71);
    const arc = arcPoints({ x: 0, y: 0 }, 100, cone.startAngle, cone.endAngle, 4);
    expect(arc).toHaveLength(5);
    expect(arc[0]!.x).toBeCloseTo(cone.left.x);
    expect(arc[2]).toEqual({ x: 100, y: expect.closeTo(0) });
  });

  it('lifts the label a constant screen distance and sizes its pill for the zoom', () => {
    expect(measureLabelAnchor({ x: 0, y: 0 }, { x: 100, y: 100 }, 2)).toEqual({ x: 50, y: 35 });
    expect(measureLabelFontSize(1)).toBe(16);
    expect(measureLabelFontSize(0.1)).toBe(32);
    expect(measureLabelBox(40, 10, { x: 100, y: 100 }, 1)).toEqual({ x: 72, y: 90, width: 56, height: 20, radius: 10, strokeWidth: 0.5 });
  });
});

describe('DragRulerPath', () => {
  const snap = (point: { x: number; y: number }): { x: number; y: number } => ({
    x: Math.floor(point.x / 70) * 70 + 35, y: Math.floor(point.y / 70) * 70 + 35,
  });
  const feet: MeasurementSettings = { mode: 'metric', unitType: 'feet', unitDistance: 5, diagonalRule: 'equidistant', rangeBands: [] };

  it('is empty until the token leaves its start, then runs through each waypoint once', () => {
    const path = new DragRulerPath(snap);
    path.begin({ x: 40, y: 40 });
    path.update({ x: 50, y: 50 });
    expect(path.points()).toBeNull();
    path.update({ x: 180, y: 40 });
    expect(path.points()).toEqual([{ x: 35, y: 35 }, { x: 175, y: 35 }]);
    expect(path.addWaypoint()).toBe(true);
    expect(path.addWaypoint()).toBe(false);
    path.update({ x: 180, y: 180 });
    expect(path.points()).toEqual([{ x: 35, y: 35 }, { x: 175, y: 35 }, { x: 175, y: 175 }]);
    path.end();
    expect(path.active).toBe(false);
  });

  it("labels the path with the measurement settings and uses Atlas's key", () => {
    const grid = { type: 'square' as const, size: 70, offsetX: 0, offsetY: 0 };
    expect(dragRulerLabel(grid, [{ x: 35, y: 35 }, { x: 175, y: 35 }, { x: 175, y: 175 }], feet)).toBe('20ft');
    expect(WAYPOINT_KEY).toBe(' ');
    expect(samePoint({ x: 1, y: 1 }, { x: 1.4, y: 0.6 })).toBe(true);
  });
});

describe('cellCenterAt', () => {
  it('lands where a token dropped by a player lands, on square and hex grids', () => {
    const square = { enabled: true, visible: true, type: 'square' as const, size: 70, offsetX: 5, offsetY: 9, snapToGrid: true };
    for (const point of [{ x: 123, y: 99 }, { x: -40, y: 3 }, { x: 700, y: 701 }]) {
      expect(cellCenterAt(square, point)).toEqual(snapDroppedToken(square as never, point));
    }
    for (const type of ['hex-vertical', 'hex-horizontal'] as const) {
      const grid = { enabled: true, visible: true, type, size: 70, offsetX: 10, offsetY: 20, snapToGrid: true };
      const center = axialToPixel(createHexLayout(type, 70, 10, 20), { q: 3, r: -2 });
      const near = { x: center.x + hexCircumradius(70) * 0.4, y: center.y - hexCircumradius(70) * 0.3 };
      const snapped = cellCenterAt(grid, near);
      const dropped = snapDroppedToken(grid as never, near);
      expect(snapped.x).toBeCloseTo(dropped.x);
      expect(snapped.y).toBeCloseTo(dropped.y);
      expect(snapped.x).toBeCloseTo(center.x);
    }
  });
});

describe('the laser trail and beam width', () => {
  it('keeps the beam width functions LaserBeam exported', () => {
    expect(laserBeam.beamWidth).toBe(beamWidth);
  });

  it("spaces points like Atlas's laser: three screen pixels, or more for a wide beam", () => {
    expect(laserPointSpacing(8, 1)).toBe(3);
    expect(laserPointSpacing(16, 2)).toBeCloseTo((beamWidth(16, 2).halfWidth) * 0.15);
  });

  it('fades every point over the fade time and drops it then', () => {
    const trail = new LaserTrail();
    trail.add(0, 0, 0);
    trail.add(10, 0, LASER_FADE_TIME / 2);
    expect(trail.beamPoints(LASER_FADE_TIME / 2)).toEqual([{ x: 0, y: 0, life: 0.5 }, { x: 10, y: 0, life: 1 }]);
    trail.prune(LASER_FADE_TIME);
    expect(trail.length).toBe(1);
    expect(trail.last()).toEqual({ x: 10, y: 0, timestamp: LASER_FADE_TIME / 2 });
    trail.prune(LASER_FADE_TIME * 2);
    expect(trail.length).toBe(0);
  });

  it('keeps at most the last hundred points', () => {
    const trail = new LaserTrail();
    for (let i = 0; i < 150; i++) trail.add(i, 0, 0);
    expect(trail.length).toBe(100);
    expect(trail.beamPoints(0)[0]!.x).toBe(50);
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run tests/unit/playerToolsShared.test.ts`
Expected: FAIL with "Failed to resolve import ../../src/app/pixi/measureGeometry" (and the other new modules).

- [ ] **Step 7: Create the measure geometry and draw Atlas's measurements from it**

Create `src/app/pixi/measureGeometry.ts`:

```ts
/**
 * Geometry and style of Atlas's measurements, shared by the measure tool, the token drag ruler
 * and the join page: the path's strokes, the point markers, circle and cone areas, and the
 * distance label's place, size and colours. No PIXI: Atlas draws these with Graphics
 * (`utils/measureDrawing.ts`, `MeasureRenderer.ts`), the page through `ViewSurface`. Lengths are
 * world units unless they say screen pixels.
 */
import type { Point } from '../grid/hexGeometry';

export type MeasureShape = 'line' | 'cone' | 'circle' | 'sphere';

/** Black, for the soft shadows under paths and points. */
export const MEASURE_SHADOW = 0x000000;

/** A path is stroked three times: a soft shadow, the accent body and a bright core. */
export const MEASURE_PATH_STROKES: ReadonlyArray<{ width: number; alpha: number; shadow: boolean }> = [
  { width: 6, alpha: 0.3, shadow: true },
  { width: 4, alpha: 0.8, shadow: false },
  { width: 2, alpha: 1, shadow: false },
];

/** A point marker: a shadow halo, an accent disc and a ring just inside it. */
export const MEASURE_POINT = { radius: 8, halo: 3, haloAlpha: 0.3, fillAlpha: 0.9, ringInset: 1, ringWidth: 2 } as const;

/** Circle and cone areas: a faint fill and an outline; circles add a thin highlight just inside. */
export const MEASURE_AREA = { fillAlpha: 0.1, strokeWidth: 3, strokeAlpha: 0.8, highlightWidth: 1.5, highlightInset: 1 } as const;

/** The cone's opening: 90 degrees, 45 on each side. */
export const CONE_ANGLE = Math.PI / 2;

export const MEASURE_LABEL_FONT_SIZE = 16;
/** How far the measure tool's label sits above the middle of the measurement, in screen pixels. */
const LABEL_LIFT = 30;

/** The label's pill per theme: its fill, then its hairline outline. */
export const MEASURE_LABEL_COLORS = {
  fillAlpha: 0.95,
  dark: { fill: 0x2a2a2a, stroke: 0xffffff, strokeAlpha: 0.4 },
  light: { fill: 0xe3e3e3, stroke: 0x000000, strokeAlpha: 0.3 },
} as const;

/** The point halfway along the path's length, where its distance label goes. */
export function pathMidpoint(points: readonly Point[]): Point | null {
  const segments = points.slice(1).map((end, i) => {
    const start = points[i]!;
    return { start, end, length: Math.hypot(end.x - start.x, end.y - start.y) };
  });
  let remaining = segments.reduce((sum, segment) => sum + segment.length, 0) / 2;
  for (const { start, end, length } of segments) {
    if (length > 0 && remaining <= length) {
      const t = remaining / length;
      return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
    }
    remaining -= length;
  }
  return points[0] ?? null;
}

/** Font size in world units that keeps the label readable at any zoom. */
export function measureLabelFontSize(viewportScale: number): number {
  return Math.max(12, Math.min(32, MEASURE_LABEL_FONT_SIZE / viewportScale));
}

/** Where the measure tool's label goes: the middle of the measurement, lifted a constant screen distance. */
export function measureLabelAnchor(start: Point, end: Point, viewportScale: number): Point {
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - LABEL_LIFT / viewportScale };
}

export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  strokeWidth: number;
}

/** The pill behind a label of `textWidth` × `textHeight` world units centred on `center`. */
export function measureLabelBox(textWidth: number, textHeight: number, center: Point, viewportScale: number): LabelBox {
  const scaleFactor = 1 / viewportScale;
  const padding = 8 * scaleFactor;
  const width = textWidth + padding * 2;
  const height = Math.max(20 * scaleFactor, textHeight + 4 * scaleFactor);
  return { x: center.x - width / 2, y: center.y - height / 2, width, height, radius: height / 2, strokeWidth: 0.5 * scaleFactor };
}

export interface ConeGeometry {
  radius: number;
  /** The arc runs from `startAngle` to `endAngle`, in radians. */
  startAngle: number;
  endAngle: number;
  /** The ends of the cone's two straight edges. */
  left: Point;
  right: Point;
}

/** A cone from `start` towards `end`. */
export function coneGeometry(start: Point, end: Point): ConeGeometry {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const radius = Math.sqrt(dx * dx + dy * dy);
  const baseAngle = Math.atan2(dy, dx);
  const startAngle = baseAngle - CONE_ANGLE / 2;
  const endAngle = baseAngle + CONE_ANGLE / 2;
  const at = (angle: number): Point => ({ x: start.x + radius * Math.cos(angle), y: start.y + radius * Math.sin(angle) });
  return { radius, startAngle, endAngle, left: at(startAngle), right: at(endAngle) };
}

/** `segments + 1` points along an arc, for surfaces that draw arcs as polylines. */
export function arcPoints(center: Point, radius: number, startAngle: number, endAngle: number, segments: number): Point[] {
  const steps = Math.max(1, Math.round(segments));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = startAngle + ((endAngle - startAngle) * i) / steps;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
}
```

Replace `src/app/pixi/utils/measureDrawing.ts` with:

```ts
/**
 * Drawing shared by the measure tool and the token drag ruler: the accent path, its point
 * markers and the distance label on a pill, with Graphics. The geometry and style come from
 * `measureGeometry.ts`, which the join page draws from too.
 */

import { Text, type Graphics } from 'pixi.js';
import type { Point } from '../../grid/hexGeometry';
import {
  MEASURE_LABEL_COLORS, MEASURE_LABEL_FONT_SIZE, MEASURE_PATH_STROKES, MEASURE_POINT, MEASURE_SHADOW, measureLabelBox,
} from '../measureGeometry';

export { measureLabelFontSize, pathMidpoint } from '../measureGeometry';

/** A polyline with a soft shadow, an accent body and a bright core. */
export function drawMeasurePath(graphics: Graphics, color: number, points: readonly Point[]): void {
  const [first, ...rest] = points;
  if (!first || rest.length === 0) return;
  for (const stroke of MEASURE_PATH_STROKES) {
    graphics.moveTo(first.x, first.y);
    for (const point of rest) graphics.lineTo(point.x, point.y);
    graphics.stroke({ width: stroke.width, color: stroke.shadow ? MEASURE_SHADOW : color, alpha: stroke.alpha });
  }
}

/** Accent dot marking where a measurement starts, turns or ends. */
export function drawMeasurePoint(graphics: Graphics, color: number, point: Point): void {
  const { radius, halo, haloAlpha, fillAlpha, ringInset, ringWidth } = MEASURE_POINT;
  graphics.circle(point.x, point.y, radius + halo).fill({ color: MEASURE_SHADOW, alpha: haloAlpha });
  graphics.circle(point.x, point.y, radius).fill({ color, alpha: fillAlpha });
  graphics.circle(point.x, point.y, radius - ringInset).stroke({ width: ringWidth, color, alpha: 1 });
}

export function createMeasureLabelText(): Text {
  const text = new Text({ text: '', style: { fontSize: MEASURE_LABEL_FONT_SIZE, fill: 0xffffff, fontWeight: 'normal' } });
  text.eventMode = 'none';
  text.anchor.set(0.5);
  return text;
}

/** Centres `text` on `center` and draws its theme-coloured pill into `pill`. */
export function drawMeasureLabel(pill: Graphics, text: Text, center: Point, viewportScale: number): void {
  text.position.set(center.x, center.y);
  const bounds = text.getLocalBounds();
  const box = measureLabelBox(bounds.width * text.scale.x, bounds.height * text.scale.y, center, viewportScale);
  const theme = document.body.classList.contains('theme-dark') ? MEASURE_LABEL_COLORS.dark : MEASURE_LABEL_COLORS.light;
  pill.clear();
  pill.roundRect(box.x, box.y, box.width, box.height, box.radius)
    .fill({ color: theme.fill, alpha: MEASURE_LABEL_COLORS.fillAlpha })
    .stroke({ width: box.strokeWidth, color: theme.stroke, alpha: theme.strokeAlpha });
}
```

In `src/app/pixi/MeasureRenderer.ts`:

1. After the `measureDrawing` import, add:

```ts
import { coneGeometry, MEASURE_AREA, measureLabelAnchor, type MeasureShape } from './measureGeometry';
```

2. Change `private measureShape: 'line' | 'cone' | 'circle' | 'sphere' = 'line';` to `private measureShape: MeasureShape = 'line';`. Change `private _measureShapeChangedHandler?: (shape: 'line' | 'cone' | 'circle' | 'sphere') => void;` to `private _measureShapeChangedHandler?: (shape: MeasureShape) => void;`. Change the assignment `this._measureShapeChangedHandler = (shape: 'line' | 'cone' | 'circle' | 'sphere') => {` to `this._measureShapeChangedHandler = (shape: MeasureShape) => {`.

3. In `updateMeasurement`, change `this.drawCone(accentHex, distance, dx, dy);` to `this.drawCone(accentHex);`, and replace `drawCone` with:

```ts
  private drawCone(color: number): void {
    if (!this.startPoint || !this.endPoint) return;
    this.drawConeOnGraphics(this.measureGraphics, color, this.startPoint, this.endPoint);
  }
```

4. Replace the body of `labelAnchor` with `return measureLabelAnchor(start, end, this.viewport.scale.x);` and keep its doc comment.

5. In `createPersistentMeasurement`, change `this.drawConeOnGraphics(persistGraphics, accentHex, distance, dx, dy, this.startPoint);` to `this.drawConeOnGraphics(persistGraphics, accentHex, this.startPoint, this.endPoint);`.

6. Replace `drawCircleOnGraphics` and `drawConeOnGraphics` with:

```ts
  private drawCircleOnGraphics(graphics: Graphics, color: number, radius: number, center: { x: number; y: number }): void {
    graphics.circle(center.x, center.y, radius);
    graphics.fill({ color, alpha: MEASURE_AREA.fillAlpha });
    graphics.circle(center.x, center.y, radius);
    graphics.stroke({ width: MEASURE_AREA.strokeWidth, color, alpha: MEASURE_AREA.strokeAlpha });
    // Inner stroke for highlight
    graphics.circle(center.x, center.y, radius - MEASURE_AREA.highlightInset);
    graphics.stroke({ width: MEASURE_AREA.highlightWidth, color, alpha: 1 });
  }

  private drawConeOnGraphics(graphics: Graphics, color: number, start: { x: number; y: number }, end: { x: number; y: number }): void {
    const { radius, startAngle, endAngle, left, right } = coneGeometry(start, end);
    const outline = { width: MEASURE_AREA.strokeWidth, color, alpha: MEASURE_AREA.strokeAlpha };

    graphics.moveTo(start.x, start.y);
    graphics.lineTo(left.x, left.y);
    graphics.arc(start.x, start.y, radius, startAngle, endAngle, false);
    graphics.lineTo(start.x, start.y);
    graphics.fill({ color, alpha: MEASURE_AREA.fillAlpha });

    graphics.moveTo(start.x, start.y);
    graphics.lineTo(left.x, left.y);
    graphics.stroke(outline);

    graphics.moveTo(start.x, start.y);
    graphics.lineTo(right.x, right.y);
    graphics.stroke(outline);

    graphics.arc(start.x, start.y, radius, startAngle, endAngle, false);
    graphics.stroke(outline);
  }
```

The values are those the renderer had inline: fill alpha 0.1, outline 3 at 0.8, highlight 1.5 at 1 one unit inside, cone 90°.

- [ ] **Step 8: Create the drag ruler path and use it in Atlas's drag ruler**

Create `src/app/pixi/token-renderer/dragRulerPath.ts`:

```ts
/**
 * The path of Atlas's token drag ruler: the snapped start, every waypoint, and the cell the
 * token would land in. A waypoint never repeats the last point, and the path is empty while the
 * token has not left its start. Shared by Atlas's `DragRuler` and the join page.
 */

import { pathLengthInCells, type GridGeometry } from '../../grid/gridDistance';
import type { Point } from '../../grid/hexGeometry';
import { formatDistance, type MeasurementSettings } from '../../grid/measurementFormat';

/** Atlas's key for adding a waypoint while dragging a token. */
export const WAYPOINT_KEY = ' ';

export function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
}

export class DragRulerPath {
  /** The snapped start followed by every waypoint. */
  private waypoints: Point[] = [];
  private landing: Point | null = null;

  constructor(private readonly snap: (point: Point) => Point) {}

  get active(): boolean {
    return this.waypoints.length > 0;
  }

  begin(origin: Point): void {
    this.waypoints = [this.snap(origin)];
    this.landing = null;
  }

  /** Moves the end to the cell a token at `position` would snap to. */
  update(position: Point): void {
    if (this.active) this.landing = this.snap(position);
  }

  /** Adds a waypoint at the landing cell; false when there is none or it repeats the last point. */
  addWaypoint(): boolean {
    const last = this.waypoints[this.waypoints.length - 1];
    if (!this.landing || (last && samePoint(last, this.landing))) return false;
    this.waypoints.push(this.landing);
    return true;
  }

  /** The start, the waypoints and the landing cell; null until the path leaves its start. */
  points(): Point[] | null {
    const landing = this.landing;
    if (!landing) return null;
    const points = [...this.waypoints, landing];
    return points.every((point) => samePoint(point, landing)) ? null : points;
  }

  end(): void {
    this.waypoints = [];
    this.landing = null;
  }
}

/** The ruler's label: the path's length in the measurement's units or range bands. */
export function dragRulerLabel(grid: GridGeometry, points: readonly Point[], settings: MeasurementSettings): string {
  return formatDistance(pathLengthInCells(grid, points, settings.diagonalRule), settings);
}
```

Replace `src/app/pixi/token-renderer/DragRuler.ts` with:

```ts
/**
 * Token drag ruler: while a token is dragged, measures the path from where it
 * started to the cell it would land in and labels the distance at the path's middle.
 * Space adds a waypoint at the current landing cell; the distance adds up
 * across waypoints. The token still drops where the pointer is released.
 */

import type { StoreApi } from 'zustand';
import type { GridSystem } from '../../grid/GridSystem';
import type { Point } from '../../grid/hexGeometry';
import type { MeasurementSettings } from '../../grid/measurementFormat';
import type { ViewAtlasState } from '../../storeFactory';
import type { LayerVisibility } from '../playerSafeFrame';
import { DragRulerPath, dragRulerLabel, WAYPOINT_KEY } from './dragRulerPath';
import type { DragRulerView } from './DragRulerView';

export class DragRuler {
  private tokenId: string | null = null;
  private readonly path = new DragRulerPath((point) => this.snap(point));
  private keyWindow: Window | null = null;

  constructor(
    private readonly view: DragRulerView,
    private readonly gridSystem: GridSystem,
    private readonly store: Pick<StoreApi<ViewAtlasState>, 'getState'>,
    private readonly settingsProvider: () => MeasurementSettings,
  ) {}

  /** Starts measuring a drag of `tokenId`, which started at `origin`. */
  begin(tokenId: string, origin: Point): void {
    this.end();
    this.tokenId = tokenId;
    this.path.begin(origin);
    this.keyWindow = activeWindow;
    this.keyWindow.addEventListener('keydown', this.onKeyDown, true);
  }

  /** Moves the ruler's end to the cell a token at `position` would snap to. */
  update(position: Point): void {
    if (!this.tokenId) return;
    this.path.update(position);
    this.redraw();
  }

  end(): void {
    this.keyWindow?.removeEventListener('keydown', this.onKeyDown, true);
    this.keyWindow = null;
    this.tokenId = null;
    this.path.end();
    this.view.clear();
  }

  /** Players never see the ruler of a token hidden from them. */
  getPlayerViewLayers(): LayerVisibility[] {
    const token = this.tokenId ? this.store.getState().objects.tokens[this.tokenId] : undefined;
    return token?.isHidden ? this.view.layers.map(layer => ({ layer, visible: false })) : [];
  }

  destroy(): void {
    this.end();
    this.view.destroy();
  }

  /** Captures Space before the map hotkeys, which would open the command palette mid-drag. */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== WAYPOINT_KEY) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat && this.path.addWaypoint()) this.redraw();
  };

  private redraw(): void {
    const points = this.path.points();
    if (!points) {
      this.view.clear();
      return;
    }
    this.view.draw(points, dragRulerLabel(this.gridSystem.getOptions(), points, this.settingsProvider()));
  }

  private snap(point: Point): Point {
    const snapToGrid = this.store.getState().grid?.snapToGrid ?? true;
    return snapToGrid ? this.gridSystem.snapToCellCenter(point.x, point.y) : { x: point.x, y: point.y };
  }
}
```

- [ ] **Step 9: Share the cell snapping**

In `src/app/grid/gridDistance.ts`, change the hex import to `import { axialDistance, createHexLayout, isHexGridType, nearestHexCenter, pixelToAxial, type Point } from './hexGeometry';` and add at the end:

```ts
/** The centre of the cell holding `point`: the nearest hex centre, or the square's centre. */
export function cellCenterAt(grid: GridGeometry, point: Point): Point {
  const offsetX = grid.offsetX ?? 0;
  const offsetY = grid.offsetY ?? 0;
  if (isHexGridType(grid.type)) return nearestHexCenter(createHexLayout(grid.type, grid.size, offsetX, offsetY), point);
  return {
    x: Math.floor((point.x - offsetX) / grid.size) * grid.size + offsetX + grid.size / 2,
    y: Math.floor((point.y - offsetY) / grid.size) * grid.size + offsetY + grid.size / 2,
  };
}
```

In `src/app/grid/GridSystem.ts`, change line 7 to `import { createHexLayout, hexCellExtent, isHexGridType } from './hexGeometry';`, add `import { cellCenterAt } from './gridDistance';` after it, and replace the body of `snapToCellCenter` (lines 417–430) with:

```ts
  public snapToCellCenter(x: number, y: number): { x: number; y: number } {
    return cellCenterAt(this.options, { x, y });
  }
```

`createHexLayout` and `isHexGridType` stay imported: `getHexLayout` still uses them.

- [ ] **Step 10: Share the beam width, the point spacing and the laser trail**

In `src/app/pixi/laser/laserBeamGeometry.ts`, add after the `DOT_SCALE` constant:

```ts
/** Longest straight step of the smoothed beam, in screen pixels. */
const SMOOTHING_SPACING = 3;
/**
 * Wide beams take longer steps: every capsule is a square as wide as the glow, so fine
 * steps would shade the same pixels many times over, and the curve stays round anyway.
 */
const SMOOTHING_SPACING_PER_WIDTH = 0.25;

/** Radius of the beam's solid body per unit of the size setting, in screen pixels. */
const BODY_PER_SIZE = 0.35;
/** The glow around the body grows with the size only up to GLOW_MAX, so wide beams stay crisp instead of hazy. */
const GLOW_PER_SIZE = 1.15;
const GLOW_MAX = 40;

/** Closest two trail points may be, in screen pixels; closer samples are mostly hand jitter. */
const MIN_POINT_SPACING = 3;
/** Wide beams keep points further apart: detail finer than the beam is invisible and costly. */
const MIN_POINT_SPACING_PER_WIDTH = 0.15;

/** The hot filament's share of the body, as in the shader, for beams drawn as strokes. */
export const FILAMENT_SHARE = 0.25;
export const FILAMENT_COLOR = 0xffffff;

export interface BeamWidth {
  /** Half the beam's width including its glow, in world units. */
  halfWidth: number;
  /** Share of that half width the solid body takes. */
  bodyShare: number;
}

/** Longest straight step of the smoothed beam in world units, so the curve stays round at any zoom. */
export function beamSmoothingSpacing(halfWidth: number, zoom: number): number {
  return Math.max(SMOOTHING_SPACING / zoom, halfWidth * SMOOTHING_SPACING_PER_WIDTH);
}

/** How wide the beam is for the size setting, which is in screen pixels at any zoom. */
export function beamWidth(size: number, zoom: number): BeamWidth {
  const body = size * BODY_PER_SIZE;
  const radius = body + Math.min(GLOW_MAX, size * GLOW_PER_SIZE);
  return { halfWidth: radius / zoom, bodyShare: body / radius };
}

/** The closest two trail points may be, in world units, for a laser of `size` at `zoom`. */
export function laserPointSpacing(size: number, zoom: number): number {
  const { halfWidth } = beamWidth(size, zoom);
  return Math.max(MIN_POINT_SPACING / zoom, halfWidth * MIN_POINT_SPACING_PER_WIDTH);
}
```

In `src/app/pixi/laser/LaserBeam.ts`, delete lines 4–37: the constants `SMOOTHING_SPACING` through `GLOW_MAX`, `interface BeamWidth`, `beamSmoothingSpacing` and `beamWidth`. Replace its two imports from `./laserBeamGeometry` and `./laserBeamShader` (lines 2–3) with:

```ts
import { beamSmoothingSpacing, createLaserBeamBuffers, smoothBeam, writeLaserBeam, type BeamPoint, type BeamWidth } from './laserBeamGeometry';
import { createLaserBeamShader, type LaserBeamShader } from './laserBeamShader';

export { beamSmoothingSpacing, beamWidth, type BeamWidth } from './laserBeamGeometry';
```

In `src/app/pixi/laser/CanvasLaserBeam.ts`, replace lines 1–7 (the imports and the two filament constants) with:

```ts
import { Graphics } from 'pixi.js';
import { beamRadius, beamSmoothingSpacing, DOT_SCALE, FILAMENT_COLOR, FILAMENT_SHARE, smoothBeam, type BeamPoint } from './laserBeamGeometry';
import type { LaserBeamFrame, LaserBeamView } from './LaserBeam';
```

Create `src/app/pixi/laser/laserTrail.ts`:

```ts
/**
 * The laser's trail: points with the time they were added, each fading out over
 * `LASER_FADE_TIME`, at most `MAX_TRAIL_SAMPLES` of them. Atlas's laser and the lasers of online
 * players (`remoteLasers.ts`) keep their trails here. PIXI-free, shared with the join page.
 */
import { LASER_FADE_TIME } from '../../tools/laserPointerSettings';
import { MAX_TRAIL_SAMPLES, type BeamPoint } from './laserBeamGeometry';

export interface TrailPoint {
  x: number;
  y: number;
  timestamp: number;
}

export class LaserTrail {
  private points: TrailPoint[] = [];

  get length(): number {
    return this.points.length;
  }

  last(): TrailPoint | undefined {
    return this.points[this.points.length - 1];
  }

  add(x: number, y: number, now: number): void {
    this.points.push({ x, y, timestamp: now });
    if (this.points.length > MAX_TRAIL_SAMPLES) this.points.splice(0, this.points.length - MAX_TRAIL_SAMPLES);
  }

  /** Drops the points that have faded out. */
  prune(now: number): void {
    this.points = this.points.filter((point) => now - point.timestamp < LASER_FADE_TIME);
  }

  /** The trail from oldest to newest, each point with the share of its life left. */
  beamPoints(now: number): BeamPoint[] {
    return this.points.map((point) => ({ x: point.x, y: point.y, life: 1 - (now - point.timestamp) / LASER_FADE_TIME }));
  }

  clear(): void {
    this.points = [];
  }
}
```

In `src/app/pixi/LaserPointerRenderer.ts`:

1. Replace the imports of lines 7–8 with:

```ts
import { beamWidth, laserPointSpacing, type BeamPoint } from './laser/laserBeamGeometry';
import { LaserBeam, type LaserBeamView } from './laser/LaserBeam';
import { LaserTrail } from './laser/laserTrail';
```

2. Delete `interface TrailPoint` and the constants `MIN_POINT_SPACING` and `MIN_POINT_SPACING_PER_WIDTH` with their comments; they moved into the geometry module.

3. Replace the field `private trailPoints: TrailPoint[] = [];` with `private readonly trail = new LaserTrail();`.

4. Replace `addTrailPoint` with:

```ts
  private addTrailPoint(x: number, y: number): void {
    // Enforce a minimum gap to avoid dense, jittery clusters at slow speeds
    const last = this.trail.last();
    if (last && Math.hypot(x - last.x, y - last.y) < laserPointSpacing(this.readSettings().size, this.viewport.scale.x || 1)) return;
    this.trail.add(x, y, Date.now());
  }
```

5. Replace `tick` with:

```ts
  private tick(): void {
    const now = Date.now();
    const hadTrail = this.trail.length > 0;
    this.trail.prune(now);

    if (hadTrail || this.needsRedraw) {
      this.needsRedraw = false;
      this.drawBeam(now);
    }
    if (this.trail.length === 0 && !this.needsRedraw) {
      this.stopTicker();
    }
  }
```

6. In `drawBeam`, replace the `trail` computation with `const trail: BeamPoint[] = this.trail.beamPoints(now);`.

7. In `destroy`, replace `this.trailPoints = [];` with `this.trail.clear();`.

8. The renderer no longer reads `LASER_FADE_TIME`: change its import from `../tools/laserPointerSettings` to `import type { LaserPointerSettings } from '../tools/laserPointerSettings';`, or lint reports the unused name.

- [ ] **Step 11: Run the shared tests and Atlas's existing ones**

Run: `npx vitest run tests/unit/playerToolsShared.test.ts tests/unit/dragRuler.test.ts tests/unit/dragRulerView.test.ts tests/unit/canvasLaserBeam.test.ts tests/unit/laserBeamGeometry.test.ts tests/unit/laserBeam.programCache.test.ts tests/unit/laserPointerRenderer.viewportMoved.test.ts tests/unit/laserPointerSettings.test.ts tests/unit/grid.test.ts tests/unit/gridDistance.test.ts tests/unit/measurementFormat.test.ts`
Expected: PASS, with the existing tests unchanged.

- [ ] **Step 12: Write the failing measurement tests**

In `tests/unit/online/sceneFixtures.ts`, add to the object `playerScene` returns, after `initiative`:

```ts
    measurement: { mode: 'metric', unitType: 'feet', unitDistance: 5, diagonalRule: 'equidistant', rangeBands: [] },
```

In `tests/unit/online/projectParts.test.ts` line 194, add `measurement: { mode: 'metric', unitType: 'feet', unitDistance: 5, diagonalRule: 'equidistant', rangeBands: [] },` inside the literal passed to `isPlayerSceneBody`, after `initiative: null,`.

In `tests/unit/online/coverage.test.ts`:
- Add `MEASUREMENT_FIELD_COVERAGE` to the import from `coverage`.
- Add `import type { CollectionGridDefaults } from '../../../src/app/types/collectionSettingsTypes';`.
- Append:

```ts
describe('coverage of the measurement', () => {
  it("sends every grid default of the map's collection", () => {
    const base: CollectionGridDefaults = {
      unitType: 'feet', unitDistance: 5, measurementMode: 'abstract',
      abstractRangeBands: [{ name: 'Close', maxSquares: 1 }], diagonalRule: 'equidistant',
    };
    const set = (patch: Partial<CollectionGridDefaults>) => (defaults: CollectionGridDefaults): CollectionGridDefaults => ({ ...defaults, ...patch });
    const variants: Variants<keyof CollectionGridDefaults, CollectionGridDefaults> = {
      unitType: set({ unitType: 'meters' }), unitDistance: set({ unitDistance: 10 }), measurementMode: set({ measurementMode: 'metric' }),
      abstractRangeBands: set({ abstractRangeBands: [{ name: 'Far', maxSquares: 6 }] }), diagonalRule: set({ diagonalRule: 'alternating' }),
    };
    expectCoverage(MEASUREMENT_FIELD_COVERAGE, variants, base, (collectionGrid) => projectForPlayers(sceneState(), {
      sceneId: 'scene-1', rules: RULES, coverage: coverageOfFog({}), assets, mapSize: { width: 1000, height: 800 },
      memo: createProjectionMemo(), collectionGrid,
    }).measurement);
  });
});
```

The existing grid test already varies `unitType`, `unitDistance` and `measurementType`. Once they are marked sent (Step 13), it checks that each one changes the projection.

In `tests/unit/online/projectForPlayers.test.ts`, add inside `describe('projectForPlayers', …)`:

```ts
  it("sends the measurement of the map's collection, or else of its grid", () => {
    const grid = { ...gmState().grid!, unitType: 'meters' as const, unitDistance: 1.5, measurementType: 'units' as const };
    expect(projectForPlayers(gmState({ grid }), context()).measurement).toEqual({
      mode: 'metric', unitType: 'meters', unitDistance: 1.5, diagonalRule: 'equidistant', rangeBands: [],
    });
    const collectionGrid = {
      unitType: 'feet' as const, unitDistance: 5, measurementMode: 'abstract' as const, diagonalRule: 'alternating' as const,
      abstractRangeBands: [{ name: 'Close', maxSquares: 1 }, { name: 'x'.repeat(300), maxSquares: Number.NaN }],
    };
    expect(projectForPlayers(gmState({ grid }), context({ collectionGrid })).measurement).toEqual({
      mode: 'abstract', unitType: 'feet', unitDistance: 5, diagonalRule: 'alternating',
      rangeBands: [{ name: 'Close', maxSquares: 1 }, { name: 'x'.repeat(128), maxSquares: 1 }],
    });
  });
```

In `tests/unit/online/sceneProtocol.test.ts`, add `import { diffScenes } from '../../../src/app/online/scene/sceneDiff';` with the other imports, and add inside `describe('scene value bounds', …)`:

```ts
  it('checks the measurement settings, which every snapshot carries', () => {
    const withMeasurement = (overrides: object): unknown => ({ ...body, measurement: { ...body.measurement, ...overrides } });
    expect(valid(snapshot(withMeasurement({ unitDistance: 1_000_000 })))).toBe(true);
    expect(valid(snapshot(withMeasurement({ unitDistance: -1 })))).toBe(false);
    expect(valid(snapshot(withMeasurement({ unitType: 'furlongs' })))).toBe(false);
    expect(valid(snapshot(withMeasurement({ diagonalRule: 'taxicab' })))).toBe(false);
    expect(valid(snapshot(withMeasurement({ rangeBands: [{ name: 'Near', maxSquares: 0 }] })))).toBe(false);
    expect(valid(snapshot(withMeasurement({ rangeBands: Array.from({ length: 33 }, () => ({ name: 'Near', maxSquares: 1 })) })))).toBe(false);
    const { measurement: _measurement, ...withoutMeasurement } = body;
    expect(valid(snapshot(withoutMeasurement))).toBe(false);
  });

  it('patches a changed measurement as a whole', () => {
    const previous = playerScene();
    const next = playerScene({ measurement: { ...previous.measurement, unitDistance: 10 } });
    expect(diffScenes(previous, next)?.set).toEqual({ measurement: next.measurement });
  });
```

In `tests/unit/online/onlineSessionService.test.ts`, add `emptySceneState` to the import from `./cameraFixtures`, and add inside `describe('OnlineSessionService', …)`:

```ts
  it("sends the measurement of the presented map's collection", async () => {
    const presented = new PresentedScene();
    const { view, tavern } = viewWithViewport(null, { ...emptySceneState(), mapPath: 'maps/tavern.atlasmap' } as never);
    presented.present(view, tavern);
    const network = new MemoryNetwork();
    const host = network.host('gm-id');
    const answers: Array<(allow: boolean) => void> = [];
    const asked: Array<string | null> = [];
    const svc = new OnlineSessionService(app, settings, {
      createHost: async () => host,
      presented,
      showRequest: (_player, answer) => { answers.push(answer); return { hide: () => {} }; },
      collectionGrid: (mapPath) => {
        asked.push(mapPath);
        return { unitType: 'meters', unitDistance: 1.5, measurementMode: 'metric', diagonalRule: 'euclidean' };
      },
    });
    await svc.start();
    const link = await network.client().connect('gm-id');
    const received: ControlMessage[] = [];
    link.onMessage((_channel, data) => {
      const decoded = decodeControl(data);
      if (decoded.kind === 'message') received.push(decoded.message);
    });
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Anna', playerKey: 'k', client: { kind: 'web', version: '1' } }));
    answers[0]!(true);
    const snapshot = received.find((message) => message.type === 'scene-snapshot') as Extract<ControlMessage, { type: 'scene-snapshot' }>;
    expect(snapshot.scene.measurement).toEqual({ mode: 'metric', unitType: 'meters', unitDistance: 1.5, diagonalRule: 'euclidean', rangeBands: [] });
    expect(asked).toContain('maps/tavern.atlasmap');
    svc.stop();
  });
```

- [ ] **Step 13: Run them to verify they fail**

Run: `npx vitest run tests/unit/online/coverage.test.ts tests/unit/online/projectForPlayers.test.ts tests/unit/online/sceneProtocol.test.ts tests/unit/online/onlineSessionService.test.ts`
Expected: FAIL: `MEASUREMENT_FIELD_COVERAGE` and `measurement` are undefined, the grid fields `unitType`, `unitDistance` and `measurementType` are marked not-yet but now change nothing either, and the service test finds no `measurement` in the snapshot.

- [ ] **Step 14: Add the measurement to the wire format, the validation and the projection**

In `src/app/online/scene/sceneTypes.ts`:

1. Add before `export interface PlayerScene`:

```ts
export const PLAYER_MEASUREMENT_MODES = ['metric', 'abstract'] as const;
export const PLAYER_UNIT_TYPES = ['feet', 'yards', 'meters', 'units', 'custom'] as const;
export const PLAYER_DIAGONAL_RULES = ['equidistant', 'alternating', 'euclidean'] as const;

export interface PlayerRangeBand {
  name: string;
  /** The band covers distances up to this many squares. */
  maxSquares: number;
}

/** The GM's measurement settings (Atlas's `MeasurementSettings`), so the page labels distances as Atlas does. */
export interface PlayerMeasurement {
  mode: typeof PLAYER_MEASUREMENT_MODES[number];
  unitType: typeof PLAYER_UNIT_TYPES[number];
  /** Units per cell. */
  unitDistance: number;
  diagonalRule: typeof PLAYER_DIAGONAL_RULES[number];
  rangeBands: PlayerRangeBand[];
}
```

2. Add `measurement: PlayerMeasurement;` as the last field of `PlayerScene`.
3. Change `SCENE_FIELD_KEYS` to `['map', 'grid', 'widgets', 'initiative', 'measurement'] as const`.
4. Add `rangeBands: 32,` to `SCENE_LIMITS`, after `initiativeEntries`.
5. Add `unitDistance: [0, 1_000_000],` and `rangeBand: [1, 1_000_000],` to `SCENE_RANGES`, after `opacity`.

In `src/app/online/scene/sceneValidation.ts`:

1. Add `PLAYER_DIAGONAL_RULES, PLAYER_MEASUREMENT_MODES, PLAYER_UNIT_TYPES,` to the import from `./sceneTypes`.
2. Add before `const FIELD_CHECKS`:

```ts
function isRangeBand(value: unknown): boolean {
  return isFields(value) && isText(value.name, SCENE_LIMITS.idLength) && inRange(SCENE_RANGES.rangeBand)(value.maxSquares);
}
function isPlayerMeasurement(value: unknown): boolean {
  return isFields(value) && oneOf(PLAYER_MEASUREMENT_MODES)(value.mode) && oneOf(PLAYER_UNIT_TYPES)(value.unitType)
    && inRange(SCENE_RANGES.unitDistance)(value.unitDistance) && oneOf(PLAYER_DIAGONAL_RULES)(value.diagonalRule)
    && Array.isArray(value.rangeBands) && value.rangeBands.length <= SCENE_LIMITS.rangeBands
    && value.rangeBands.every((band) => isRangeBand(band));
}
```

3. Add `measurement: isPlayerMeasurement,` to `FIELD_CHECKS`.

In `src/app/online/scene/projectForPlayers.ts`:

1. Add the imports:

```ts
import { resolveMeasurementSettings } from '../../grid/measurementFormat';
import type { CollectionGridDefaults } from '../../types/collectionSettingsTypes';
```

and add `PLAYER_DIAGONAL_RULES, PLAYER_MEASUREMENT_MODES, PLAYER_UNIT_TYPES,` and `type PlayerMeasurement,` to the import from `./sceneTypes`.

2. Add to `ProjectionContext`:

```ts
  /** The grid defaults of the map's collection, which decide the measurement; without them the map's grid does. */
  collectionGrid?: CollectionGridDefaults | null;
```

3. Add `measurement: projectMeasurement(context.collectionGrid ?? null, state.grid),` as the last field of the object `projectForPlayers` returns.

4. Add after `projectGrid`:

```ts
/** The settings Atlas's ruler and measure tool use for this map, field by field. */
function projectMeasurement(collection: CollectionGridDefaults | null, grid: GridState | null): PlayerMeasurement {
  const settings = resolveMeasurementSettings(collection ?? undefined, grid);
  const bands: unknown[] = Array.isArray(settings.rangeBands) ? [...settings.rangeBands] : [];
  return {
    mode: oneOf(PLAYER_MEASUREMENT_MODES, settings.mode, 'metric'),
    unitType: oneOf(PLAYER_UNIT_TYPES, settings.unitType, 'feet'),
    unitDistance: finiteOr(settings.unitDistance, 5, SCENE_RANGES.unitDistance),
    diagonalRule: oneOf(PLAYER_DIAGONAL_RULES, settings.diagonalRule, 'equidistant'),
    rangeBands: bands.slice(0, SCENE_LIMITS.rangeBands).map((band) => {
      const { name, maxSquares } = (typeof band === 'object' && band !== null ? band : {}) as { name?: unknown; maxSquares?: unknown };
      return { name: textOr(name, '', SCENE_LIMITS.idLength), maxSquares: finiteOr(maxSquares, 1, SCENE_RANGES.rangeBand) };
    }),
  };
}
```

In `src/app/online/scene/sceneSources.ts`:

1. Add the imports:

```ts
import type { CollectionGridDefaults } from '../../types/collectionSettingsTypes';
import type { ProjectionContext } from './projectForPlayers';
```

2. Add to `SceneBroadcasterOptions`:

```ts
  /** The grid defaults of the collection holding the map at `mapPath`; tests leave it out. */
  collectionGrid?: (mapPath: string | null) => CollectionGridDefaults | null;
```

3. Add at the end of the file:

```ts
/** What the projection needs of the presented scene besides its store's slice. */
export function sceneContext(
  scene: PresentedSceneInfo,
  options: Pick<SceneBroadcasterOptions, 'collectionGrid'>,
): Pick<ProjectionContext, 'mapSize' | 'collectionGrid'> {
  return { mapSize: scene.mapSize(), collectionGrid: options.collectionGrid?.(scene.store.getState().mapPath ?? null) ?? null };
}
```

In `src/app/online/scene/SceneBroadcaster.ts`, change the second line of the import from `./sceneSources` (line 22) to:

```ts
  FOG_TRUNCATED_NOTICE, FogCoverageCache, SCENE_TICK_MS, SCENE_TOO_LARGE_NOTICE, sameSlice, sceneContext, sliceOf,
```

and change line 257, `      mapSize: live.scene.mapSize(),`, to:

```ts
      ...sceneContext(live.scene, this.options),
```

The file stays at 300 lines; check with `wc -l src/app/online/scene/SceneBroadcaster.ts`.

In `src/app/online/scene/PlayerSceneMirror.ts`, change line 132 to:

```ts
      widgets: body.widgets, initiative: body.initiative, measurement: body.measurement,
```

In `src/app/online/coverage.ts`:

1. Add `import type { CollectionGridDefaults } from '../types/collectionSettingsTypes';`.
2. Delete the `MEASURING` constant.
3. In `GRID_FIELD_COVERAGE`, change `unitType`, `unitDistance` and `measurementType` to `SENT`. Add above them the comment `// Without a collection, these decide the measurement players get.`
4. Append:

```ts
/** The collection's measurement settings, which decide how the page labels distances (ruler, measure tool). */
export const MEASUREMENT_FIELD_COVERAGE: CoverageTable<keyof CollectionGridDefaults> = {
  unitType: SENT,
  unitDistance: SENT,
  measurementMode: SENT,
  abstractRangeBands: SENT,
  diagonalRule: SENT,
};
```

Replace `src/app/services/mapMeasurementSettings.ts` with:

```ts
import { resolveMeasurementSettings, type MeasurementSettings } from '../grid/measurementFormat';
import type { ViewAtlasState } from '../storeFactory';
import type { CollectionGridDefaults } from '../types/collectionSettingsTypes';
import type { AssetService } from './AssetService';

/** The grid defaults of the collection holding the map at `mapPath`; null for a map outside a collection. */
export function collectionGridDefaultsFor(assetService: AssetService, mapPath: string | null): CollectionGridDefaults | null {
  const collectionId = mapPath ? assetService.getCollectionForMap(mapPath) : null;
  return (collectionId ? assetService.getCollectionSettings(collectionId).gridDefaults : undefined) ?? null;
}

/** Measurement settings for the map in `state`, read from its collection when it has one. */
export function mapMeasurementSettings(
  assetService: AssetService,
  state: Pick<ViewAtlasState, 'mapPath' | 'grid'>,
): MeasurementSettings {
  return resolveMeasurementSettings(collectionGridDefaultsFor(assetService, state.mapPath) ?? undefined, state.grid);
}
```

In `src/app/online/OnlineSessionService.ts`:

1. Add the imports:

```ts
import { AssetService } from '../services/AssetService';
import { collectionGridDefaultsFor } from '../services/mapMeasurementSettings';
import type { CollectionGridDefaults } from '../types/collectionSettingsTypes';
```

2. Add to `Deps`:

```ts
  /** The grid defaults of a map's collection; Atlas's asset index unless a test passes its own. */
  collectionGrid?: (mapPath: string | null) => CollectionGridDefaults | null;
```

3. Add the field `private readonly collectionGrid: (mapPath: string | null) => CollectionGridDefaults | null;`.

4. In the constructor, after `this.images = …`, add:

```ts
    this.collectionGrid = deps.collectionGrid
      ?? ((mapPath) => (mapPath ? collectionGridDefaultsFor(AssetService.getInstance(app), mapPath) : null));
```

5. Pass `collectionGrid: this.collectionGrid` in the `SceneBroadcaster` options:

```ts
    const broadcaster = new SceneBroadcaster({
      session: scenes, presented: this.presented, settings: this.settings, assets: registry, notify, collectionGrid: this.collectionGrid,
    });
```

- [ ] **Step 15: Run the measurement tests and the whole online suite**

Run: `npx vitest run tests/unit/online/`
Expected: PASS. `sceneSyncEndToEnd.test.ts` compares each player's scene with the GM's projection, so it also proves that `PlayerSceneMirror` keeps `measurement`.

If another test builds a `PlayerScene` or snapshot body by hand and now fails for the missing field, add `measurement: { mode: 'metric', unitType: 'feet', unitDistance: 5, diagonalRule: 'equidistant', rangeBands: [] }` to that literal. Find such literals with `grep -rn "initiative: null" tests/unit/online`.

- [ ] **Step 16: Type-check, lint and run the full suite**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: no type errors, no lint warnings, all tests pass.

- [ ] **Step 17: Commit**

```bash
git add src/app/tools/diceRolling.ts src/app/tools/DiceTool.ts src/app/react/components/dice/DiceGrid.tsx \
  src/app/react/components/dice/DiceFormulaBar.tsx src/app/react/components/dice/DiceDropdownMenu.tsx \
  src/app/react/components/dice/PlayerDiceToasts.tsx src/app/pixi/measureGeometry.ts src/app/pixi/utils/measureDrawing.ts \
  src/app/pixi/MeasureRenderer.ts src/app/pixi/token-renderer/dragRulerPath.ts src/app/pixi/token-renderer/DragRuler.ts \
  src/app/grid/gridDistance.ts src/app/grid/GridSystem.ts src/app/pixi/laser/laserBeamGeometry.ts src/app/pixi/laser/LaserBeam.ts \
  src/app/pixi/laser/CanvasLaserBeam.ts src/app/pixi/laser/laserTrail.ts src/app/pixi/LaserPointerRenderer.ts \
  src/app/online/scene/sceneTypes.ts src/app/online/scene/sceneValidation.ts src/app/online/scene/projectForPlayers.ts \
  src/app/online/scene/sceneSources.ts src/app/online/scene/SceneBroadcaster.ts src/app/online/scene/PlayerSceneMirror.ts \
  src/app/online/coverage.ts src/app/services/mapMeasurementSettings.ts src/app/online/OnlineSessionService.ts \
  tests/unit/diceRolling.test.ts tests/unit/playerToolsShared.test.ts tests/unit/online/coverage.test.ts \
  tests/unit/online/projectForPlayers.test.ts tests/unit/online/sceneProtocol.test.ts tests/unit/online/onlineSessionService.test.ts \
  tests/unit/online/sceneFixtures.ts tests/unit/online/projectParts.test.ts
git commit -m "refactor(online): share dice, measure, ruler and laser maths; send measurement settings"
```

If Step 15 needed fixture edits in other test files, add those files too.

---
### Task 2: The GM side: dice rolls, the shared dice log, and lasers both ways

Players' rolls are rolled on the GM's side and reach Atlas's dice log under the player's name. Every roll Atlas's dice log gets goes to every player, and a player gets the latest 50 on admission. Players' lasers reach the other players and the GM's view, and the GM's own laser reaches every player. `PlayerSession` gains the sending and receiving ends, so this task's end-to-end tests run over `MemoryTransport`.

Rulings this task needs: 2 (roller names), 3 (replay), 4 (what the 50 are), 5 (physical dice), 6 (laser messages), 7 (laser look), 8 (`from` is the session's id).

**Files:**
- Create: `src/app/online/rateLimit.ts`
- Modify: `src/app/online/control/TokenMoveHandler.ts:22-52`
- Create: `src/app/online/tools/toolMessages.ts`
- Modify: `src/app/online/protocol.ts` (imports, `ControlMessage`, `PLAYER_MESSAGE_TYPES`, `VALIDATORS`)
- Create: `src/app/online/tools/laserColors.ts`, `src/app/online/tools/LaserBatcher.ts`
- Create: `src/app/pixi/laser/remoteLasers.ts`, `src/app/pixi/laser/LaserHub.ts`, `src/app/pixi/laser/RemoteLaserRenderer.ts`
- Modify: `src/app/pixi/LaserPointerRenderer.ts` (constructor, `addTrailPoint`, the four places that stop pointing), `src/app/PixiRendererOrchestrator.ts:63-64, 453-462, 771-775, 1423-1424`, `src/app/services/PresentedScene.ts:14-34, 104-109`
- Create: `src/app/online/tools/diceFeed.ts`, `src/app/online/tools/DiceHost.ts`, `src/app/online/tools/LaserRelay.ts`
- Modify: `src/app/online/PlayerSession.ts` (imports, options, two send methods, two `receive` cases)
- Modify: `src/app/online/OnlineSessionService.ts` (deps, fields, `onPlayersChanged`, `host`, `teardown`)
- Modify: `src/app/react/components/dice-log/DiceRollEntry.tsx:40-80`, `src/app/react/components/dice/DiceToast.tsx:20-65`
- Test: `tests/unit/online/protocol.test.ts:109-111` (the test that lists what players may send), `tests/unit/online/toolMessages.test.ts`, `tests/unit/online/laserBatcher.test.ts`, `tests/unit/remoteLasers.test.ts`, `tests/unit/remoteLaserRenderer.test.ts`, `tests/unit/laserPointerRenderer.hub.test.ts`, `tests/unit/online/toolsFixtures.ts`, `tests/unit/online/diceHost.test.ts`, `tests/unit/online/laserRelay.test.ts`, `tests/unit/online/playerToolsEndToEnd.test.ts`, `tests/unit/diceRollerName.test.tsx`, `tests/unit/online/onlineSessionService.test.ts`

**Interfaces:**
- Consumes (Task 1):
  - Dice: `DICE_TYPES`, `isDieType`, `DiceSelection`, `DiceRollResult` (with `rolledBy`), `DICE_ROLLED_EVENT`, `diceFormula`, `rollFormula`, `withoutHiddenToken`, `rollerName`.
  - Laser: `LaserTrail`, `beamWidth`, `BeamPoint`.
  - Existing: `LASER_COLOR_SWATCHES` and `DEFAULT_LASER_POINTER_SETTINGS` (`tools/laserPointerSettings.ts`); `SessionHandler` and `SessionPlayer` (`GmSession`); `SceneSession` and `PresentedSceneSource` (`scene/sceneSources.ts`); `CameraProjection` (`scene/CameraSender.ts`).
- Produces:
  - `rateLimit.ts`: `class RateLimit { constructor(perWindow, windowMs = 1000); allow(playerId, now): boolean; retain(known) }`.
  - `toolMessages.ts`:
    - Constants: `DICE_LIMITS`, `LASER_LIMITS`, `GM_ROLLER_NAME = 'GM'`.
    - Types: `interface DiceLogEntry { id; name; formula; dice: Array<{ die: string; value: number }>; modifier; total; at }`, `interface PlayerLaser { from; sceneId; points: ScenePoint[]; lifted }`.
    - Validators: `isDiceSelection`, `isDiceModifier`, `isDiceLogEntry`, `isDiceLogEntries`, `isLaserPoints`.
    - `diceLogEntry(result, name): DiceLogEntry | null`.
  - `protocol.ts`, added to `ControlMessage`:
    - `{ v: 1; type: 'dice-roll'; dice: DiceSelection; modifier: number }`
    - `{ v: 1; type: 'dice-log'; entries: DiceLogEntry[]; replay: boolean }`
    - `{ v: 1; type: 'laser'; sceneId: string; points: ScenePoint[]; lifted: boolean; from?: string }`
    - `PLAYER_MESSAGE_TYPES` also holds `'dice-roll'` and `'laser'`.
  - `laserColors.ts`: `GM_LASER_ID = 'gm'`, `LASER_PALETTE: readonly string[]`, `laserColor(from: string, order: readonly string[]): string`.
  - `LaserBatcher.ts`: `LASER_INTERVAL_MS = 50`, `LASER_KEEPALIVE_MS = 500`, `class LaserBatcher { constructor(output: (points: ScenePoint[], lifted: boolean) => void); isDrawing; point(point); lift(); dispose() }`.
  - `remoteLasers.ts`: `LASER_STALE_MS = 1000`, `interface RemoteLaserFrame { from; color; trail: BeamPoint[]; head: Point | null }`, `class RemoteLasers { receive(from, color, points, lifted, now); frame(now): RemoteLaserFrame[]; isActive; clear() }`.
  - `LaserHub.ts`: `type LocalLaserEvent = { kind: 'point'; x; y } | { kind: 'lift' }`, `interface RemoteLaser { from; color; points; lifted }`, `class LaserHub { onLocal(listener); emitLocal(event); onRemote(listener); showRemote(laser) }`.
  - `RemoteLaserRenderer.ts`: `class RemoteLaserRenderer { container; constructor({ ticker, zoom, createBeam, hub, now? }); destroy() }`.
  - `PresentedView.renderer.getLaserHub?(): LaserHub`; `PresentedSceneInfo.laser(): LaserHub | null`; `PixiRendererOrchestrator.getLaserHub(): LaserHub`.
  - `diceFeed.ts`: `interface DiceFeed { subscribe(listener): () => void; publish(result): void }`, `documentDiceFeed(doc = document): DiceFeed`.
  - `DiceHost.ts`: `class DiceHost implements SessionHandler { constructor({ session, presented, feed, random? }); start(); stop(); playersChanged(players) }`.
  - `LaserRelay.ts`: `class LaserRelay implements SessionHandler { constructor({ session, presented, projection }); start(); stop(); playersChanged(players) }`.
  - `PlayerSession`:
    - Options: `onDiceLog?(entries: readonly DiceLogEntry[], replay: boolean)`, `onLaser?(laser: PlayerLaser)`.
    - Methods: `sendDiceRoll(dice: DiceSelection, modifier: number): boolean`, `sendLaser(points: readonly ScenePoint[], lifted: boolean): boolean`.
  - `OnlineSessionService` deps: `diceFeed?: DiceFeed`.

- [ ] **Step 1: Write the failing message tests**

Create `tests/unit/online/toolMessages.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeControl, encodeControl, PLAYER_MESSAGE_TYPES, type ControlMessage } from '../../../src/app/online/protocol';
import { diceLogEntry, type DiceLogEntry } from '../../../src/app/online/tools/toolMessages';
import type { DiceRollResult } from '../../../src/app/tools/diceRolling';

const valid = (message: object): boolean => decodeControl(JSON.stringify(message)).kind === 'message';
const entry = (overrides: Partial<DiceLogEntry> = {}): DiceLogEntry => ({
  id: 'roll_1', name: 'Anna', formula: '2d6+1', dice: [{ die: 'd6', value: 4 }, { die: 'd6', value: 6 }], modifier: 1, total: 11, at: 5,
  ...overrides,
});
const laser = (overrides: object = {}): object => ({ v: 1, type: 'laser', sceneId: 'scene-1', points: [{ x: 1, y: 2 }], lifted: false, ...overrides });

describe('player tool messages', () => {
  it('round-trips a roll, a dice log and a laser either way', () => {
    const messages: ControlMessage[] = [
      { v: 1, type: 'dice-roll', dice: { d6: 2, d20: 1 }, modifier: -3 },
      { v: 1, type: 'dice-log', entries: [entry()], replay: true },
      { v: 1, type: 'laser', sceneId: 'scene-1', points: [{ x: 1, y: 2 }], lifted: true },
      { v: 1, type: 'laser', from: 'gm', sceneId: 'scene-1', points: [], lifted: false },
    ];
    for (const message of messages) expect(decodeControl(encodeControl(message))).toEqual({ kind: 'message', message });
  });

  it('holds a roll to 1 to 20 known dice and a whole modifier within 1000', () => {
    const roll = (dice: object, modifier: unknown = 0): boolean => valid({ v: 1, type: 'dice-roll', dice, modifier });
    expect(roll({ d20: 20 })).toBe(true);
    expect(roll({ d4: 10, d100: 10 }, 1000)).toBe(true);
    expect(roll({ d6: 1 }, -1000)).toBe(true);
    expect(roll({ d20: 21 })).toBe(false);
    expect(roll({ d6: 10, d8: 11 })).toBe(false);
    expect(roll({})).toBe(false);
    expect(roll({ d6: 0 })).toBe(false);
    expect(roll({ d3: 1 })).toBe(false);
    expect(roll({ d6: 1.5 })).toBe(false);
    expect(roll({ d6: -1, d8: 2 })).toBe(false);
    expect(roll({ d6: 1 }, 1001)).toBe(false);
    expect(roll({ d6: 1 }, 0.5)).toBe(false);
    expect(roll({ d6: 1 }, '2')).toBe(false);
    expect(decodeControl('{"v":1,"type":"dice-roll","dice":{"__proto__":1},"modifier":0}').kind).toBe('invalid');
  });

  it('holds dice log entries to their limits', () => {
    const log = (entries: unknown[], replay: unknown = false): boolean => valid({ v: 1, type: 'dice-log', entries, replay });
    expect(log([])).toBe(true);
    expect(log(Array.from({ length: 50 }, (_, i) => entry({ id: `r${i}` })))).toBe(true);
    expect(log(Array.from({ length: 51 }, (_, i) => entry({ id: `r${i}` })))).toBe(false);
    expect(log([entry()], 'yes')).toBe(false);
    expect(log([entry({ name: '' })])).toBe(false);
    expect(log([entry({ name: 'x'.repeat(81) })])).toBe(false);
    expect(log([entry({ formula: 'd6+'.repeat(70) })])).toBe(false);
    expect(log([entry({ dice: [{ die: 'd6', value: 7 }] })])).toBe(false);
    expect(log([entry({ dice: [{ die: 'd6', value: 0 }] })])).toBe(false);
    expect(log([entry({ dice: [{ die: 'x6', value: 1 }] })])).toBe(false);
    expect(log([entry({ dice: Array.from({ length: 101 }, () => ({ die: 'd6', value: 1 })) })])).toBe(false);
    expect(log([entry({ total: Number.POSITIVE_INFINITY })])).toBe(false);
    expect(log([entry({ id: '__proto__' })])).toBe(false);
  });

  it('holds a laser to 64 points in range, and checks the from of a relayed one', () => {
    expect(valid(laser({ points: Array.from({ length: 64 }, () => ({ x: 0, y: 0 })) }))).toBe(true);
    expect(valid(laser({ points: Array.from({ length: 65 }, () => ({ x: 0, y: 0 })) }))).toBe(false);
    expect(valid(laser({ points: [{ x: 10_000_001, y: 0 }] }))).toBe(false);
    expect(valid(laser({ points: [{ x: 'a', y: 0 }] }))).toBe(false);
    expect(valid(laser({ lifted: 'no' }))).toBe(false);
    expect(valid(laser({ sceneId: '' }))).toBe(false);
    expect(valid(laser({ from: '' }))).toBe(false);
    expect(valid(laser({ from: 'p1' }))).toBe(true);
  });

  it('lets admitted players send rolls and lasers, never dice logs', () => {
    expect(PLAYER_MESSAGE_TYPES.has('dice-roll')).toBe(true);
    expect(PLAYER_MESSAGE_TYPES.has('laser')).toBe(true);
    expect(PLAYER_MESSAGE_TYPES.has('dice-log')).toBe(false);
  });
});

describe('diceLogEntry', () => {
  const result: DiceRollResult = {
    id: 'roll_1', timestamp: 5, formula: '2d6+1', modifiers: 1, total: 11,
    rolls: [{ die: 'd6', value: 4, max: 6 }, { die: 'd6', value: 6, max: 6 }],
  };

  it('lists each die, the modifier and the total under the given name', () => {
    expect(diceLogEntry(result, 'Anna')).toEqual(entry());
  });

  it('clips what a large GM roll would make too long, and keeps its total', () => {
    const big = { ...result, formula: 'd6+'.repeat(100), rolls: Array.from({ length: 150 }, () => ({ die: 'd6', value: 3, max: 6 })), total: 450 };
    const logged = diceLogEntry(big, 'x'.repeat(90));
    expect(logged?.dice).toHaveLength(100);
    expect(logged?.formula).toHaveLength(200);
    expect(logged?.name).toHaveLength(80);
    expect(logged?.total).toBe(450);
  });

  it('makes no entry of a roll players would refuse', () => {
    expect(diceLogEntry({ ...result, total: Number.NaN }, 'Anna')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/online/toolMessages.test.ts`
Expected: FAIL with "Failed to resolve import ../../../src/app/online/tools/toolMessages".

- [ ] **Step 3: Add the rate limit, the tool messages and the protocol entries**

Create `src/app/online/rateLimit.ts`:

```ts
/**
 * At most `perWindow` messages per player in any window of `windowMs`; messages over the limit
 * do not count. The GM's handlers for player messages each keep one.
 */
export class RateLimit {
  private readonly recent = new Map<string, number[]>();

  constructor(private readonly perWindow: number, private readonly windowMs = 1000) {}

  allow(playerId: string, now: number): boolean {
    const times = (this.recent.get(playerId) ?? []).filter((time) => now - time < this.windowMs);
    const allowed = times.length < this.perWindow;
    if (allowed) times.push(now);
    this.recent.set(playerId, times);
    return allowed;
  }

  /** Forgets every player not in `known`; a player who is only gone keeps their window. */
  retain(known: ReadonlySet<string>): void {
    for (const playerId of [...this.recent.keys()]) if (!known.has(playerId)) this.recent.delete(playerId);
  }
}
```

In `src/app/online/control/TokenMoveHandler.ts`, add `import { RateLimit } from '../rateLimit';` with the imports, delete `const RATE_WINDOW_MS = 1000;`, and replace the `MoveRateLimit` class with:

```ts
/** At most `MOVES_PER_SECOND` moves per player in any one-second window; refused ones count. */
export class MoveRateLimit extends RateLimit {
  constructor() {
    super(MOVES_PER_SECOND);
  }
}
```

Create `src/app/online/tools/toolMessages.ts`:

```ts
/**
 * The player tools' messages: dice rolls, the shared dice log and lasers. Their types, limits
 * and checks, shared with the web player page, so this file imports only shared modules.
 */
import { isDieType, type DiceRollResult, type DiceSelection } from '../../tools/diceRolling';
import { SCENE_RANGES, type ScenePoint } from '../scene/sceneTypes';
import { isSceneId } from '../scene/sceneValidation';

export const DICE_LIMITS = {
  /** Dice in one player roll. */
  dicePerRoll: 20,
  /** A player roll's modifier lies within ±1000. */
  modifier: 1000,
  rollsPerSecond: 2,
  /** Entries a player gets on admission. */
  logEntries: 50,
  /** Dice listed in one entry; a larger GM roll lists its first 100, and its total still counts them all. */
  entryDice: 100,
  nameLength: 80,
  formulaLength: 200,
} as const;

export const LASER_LIMITS = { points: 64, perSecond: 20 } as const;

/** The name of a roll that is neither an online player's nor a visible statblock token's. */
export const GM_ROLLER_NAME = 'GM';

/** One roll in the shared dice log. */
export interface DiceLogEntry {
  id: string;
  /** An online player's name, a visible statblock token's, or "GM". */
  name: string;
  formula: string;
  dice: Array<{ die: string; value: number }>;
  modifier: number;
  total: number;
  /** When it was rolled: milliseconds since 1970 on the GM's clock. */
  at: number;
}

/** Someone's laser as a player receives it: new points of it, and whether it was let go. */
export interface PlayerLaser {
  from: string;
  sceneId: string;
  points: ScenePoint[];
  lifted: boolean;
}

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isText = (value: unknown, min: number, max: number): value is string =>
  typeof value === 'string' && value.length >= min && value.length <= max;
/** `d` and 1 to 9999 sides. */
const DIE = /^d([1-9]\d{0,3})$/;

/** 1 to 20 dice of the tray's kinds, each count a whole number. */
export function isDiceSelection(value: unknown): value is DiceSelection {
  if (!isFields(value)) return false;
  let total = 0;
  for (const [die, count] of Object.entries(value)) {
    if (!isDieType(die) || !Number.isSafeInteger(count) || (count as number) < 0) return false;
    total += count as number;
  }
  return total >= 1 && total <= DICE_LIMITS.dicePerRoll;
}

export function isDiceModifier(value: unknown): value is number {
  return Number.isSafeInteger(value) && Math.abs(value as number) <= DICE_LIMITS.modifier;
}

function isLoggedDie(value: unknown): value is { die: string; value: number } {
  if (!isFields(value) || typeof value.die !== 'string') return false;
  const sides = DIE.exec(value.die)?.[1];
  return sides !== undefined && Number.isSafeInteger(value.value) && (value.value as number) >= 1 && (value.value as number) <= Number(sides);
}

export function isDiceLogEntry(value: unknown): value is DiceLogEntry {
  return isFields(value) && isSceneId(value.id) && isText(value.name, 1, DICE_LIMITS.nameLength)
    && isText(value.formula, 0, DICE_LIMITS.formulaLength)
    && Array.isArray(value.dice) && value.dice.length <= DICE_LIMITS.entryDice && value.dice.every((die) => isLoggedDie(die))
    && isFiniteNumber(value.modifier) && isFiniteNumber(value.total) && isFiniteNumber(value.at);
}

export function isDiceLogEntries(value: unknown): value is DiceLogEntry[] {
  return Array.isArray(value) && value.length <= DICE_LIMITS.logEntries && value.every((entry) => isDiceLogEntry(entry));
}

/** At most 64 points, each within the scene's coordinate range. */
export function isLaserPoints(value: unknown): value is ScenePoint[] {
  const [min, max] = SCENE_RANGES.coordinate;
  const inRange = (number: unknown): boolean => isFiniteNumber(number) && number >= min && number <= max;
  return Array.isArray(value) && value.length <= LASER_LIMITS.points
    && value.every((point) => isFields(point) && inRange(point.x) && inRange(point.y));
}

/** A roll as the dice log shows it, under `name`, clipped to the limits; null when players would refuse it anyway. */
export function diceLogEntry(result: DiceRollResult, name: string): DiceLogEntry | null {
  const dice = result.rolls.map(({ die, value }) => ({ die, value })).filter((die) => isLoggedDie(die)).slice(0, DICE_LIMITS.entryDice);
  const entry: DiceLogEntry = {
    id: result.id,
    name: name.slice(0, DICE_LIMITS.nameLength),
    formula: result.formula.slice(0, DICE_LIMITS.formulaLength),
    dice,
    modifier: result.modifiers,
    total: result.total,
    at: result.timestamp,
  };
  return isDiceLogEntry(entry) ? entry : null;
}
```

In `src/app/online/protocol.ts`:

1. Add the imports:

```ts
import type { DiceSelection } from '../tools/diceRolling';
import { isDiceLogEntries, isDiceModifier, isDiceSelection, isLaserPoints, type DiceLogEntry } from './tools/toolMessages';
```

and add `ScenePoint` to the type import from `./scene/sceneTypes`.

2. Add to the end of `ControlMessage` (after `token-move-refused`):

```ts
  /** Player to GM: a roll from the dice tray, rolled on the GM's side. */
  | { v: 1; type: 'dice-roll'; dice: DiceSelection; modifier: number }
  /** GM to players: dice log entries, newest first; `replay` replaces a player's log (sent on every admission). */
  | { v: 1; type: 'dice-log'; entries: DiceLogEntry[]; replay: boolean }
  /**
   * New points of someone's laser, in world units. Players send it without `from`; the GM relays
   * it with `from`, the sender's session id (`gm` for the GM's own).
   */
  | { v: 1; type: 'laser'; sceneId: string; points: ScenePoint[]; lifted: boolean; from?: string };
```

(Move the `;` from the old last member to this new last member.)

3. Change `PLAYER_MESSAGE_TYPES` to:

```ts
export const PLAYER_MESSAGE_TYPES: ReadonlySet<ControlMessage['type']> = new Set<ControlMessage['type']>([
  'scene-resync', 'token-move', 'dice-roll', 'laser',
]);
```

4. Add to `VALIDATORS`:

```ts
  'dice-roll': (m) => isDiceSelection(m.dice) && isDiceModifier(m.modifier),
  'dice-log': (m) => isDiceLogEntries(m.entries) && typeof m.replay === 'boolean',
  laser: (m) => isSceneId(m.sceneId) && isLaserPoints(m.points) && typeof m.lifted === 'boolean'
    && (m.from === undefined || isSceneId(m.from)),
```

In `tests/unit/online/protocol.test.ts`, the test that lists what players may send now names four types. Replace it with:

```ts
  it('names what players may send: a resync, a token move, a dice roll and a laser', () => {
    expect([...PLAYER_MESSAGE_TYPES].sort()).toEqual(['dice-roll', 'laser', 'scene-resync', 'token-move']);
  });
```

- [ ] **Step 4: Run the message tests and the existing protocol tests**

Run: `npx vitest run tests/unit/online/toolMessages.test.ts tests/unit/online/protocol.test.ts tests/unit/online/tokenMoveHandler.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for batching, colours and remote lasers**

Create `tests/unit/online/laserBatcher.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScenePoint } from '../../../src/app/online/scene/sceneTypes';
import { LASER_INTERVAL_MS, LASER_KEEPALIVE_MS, LaserBatcher } from '../../../src/app/online/tools/LaserBatcher';
import { GM_LASER_ID, laserColor } from '../../../src/app/online/tools/laserColors';
import { LASER_COLOR_SWATCHES } from '../../../src/app/tools/laserPointerSettings';

interface Sent { points: ScenePoint[]; lifted: boolean; at: number }

function batcher(): { batcher: LaserBatcher; sent: Sent[] } {
  const sent: Sent[] = [];
  return { batcher: new LaserBatcher((points, lifted) => sent.push({ points, lifted, at: Date.now() })), sent };
}
const at = (x: number): ScenePoint => ({ x, y: 0 });

describe('LaserBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('sends the first point at once and the next ones together after the interval', () => {
    const { batcher: laser, sent } = batcher();
    laser.point(at(0));
    laser.point(at(1));
    laser.point(at(2));
    expect(sent).toEqual([{ points: [at(0)], lifted: false, at: 0 }]);
    vi.advanceTimersByTime(LASER_INTERVAL_MS);
    expect(sent[1]).toEqual({ points: [at(1), at(2)], lifted: false, at: 50 });
  });

  it('keeps the newest 64 points of a batch', () => {
    const { batcher: laser, sent } = batcher();
    for (let x = 0; x < 100; x++) laser.point(at(x));
    vi.advanceTimersByTime(LASER_INTERVAL_MS);
    expect(sent[1]!.points).toHaveLength(64);
    expect(sent[1]!.points[0]).toEqual(at(36));
  });

  it('sends the lift in order after the last points, and a new stroke after it', () => {
    const { batcher: laser, sent } = batcher();
    laser.point(at(0));
    laser.point(at(1));
    laser.lift();
    laser.point(at(2));
    vi.advanceTimersByTime(LASER_INTERVAL_MS * 2);
    expect(sent.map(({ points, lifted }) => ({ points, lifted }))).toEqual([
      { points: [at(0)], lifted: false }, { points: [at(1)], lifted: true }, { points: [at(2)], lifted: false },
    ]);
  });

  it('sends at most 20 messages a second however fast the points come', () => {
    const { batcher: laser, sent } = batcher();
    for (let time = 0; time < 1000; time += 5) {
      laser.point(at(time));
      vi.advanceTimersByTime(5);
    }
    expect(sent.filter((message) => message.at < 1000).length).toBeLessThanOrEqual(20);
  });

  it('keeps a laser held still alive every 500 ms, and stops once it is let go', () => {
    const { batcher: laser, sent } = batcher();
    laser.point(at(0));
    vi.advanceTimersByTime(LASER_KEEPALIVE_MS * 2);
    expect(sent.map(({ points, at: time }) => [points.length, time])).toEqual([[1, 0], [0, 500], [0, 1000]]);
    laser.lift();
    vi.advanceTimersByTime(LASER_KEEPALIVE_MS * 4);
    expect(sent.slice(3)).toEqual([{ points: [], lifted: true, at: 1050 }]);
  });

  it('sends no lift without a stroke, and nothing after dispose', () => {
    const { batcher: laser, sent } = batcher();
    laser.lift();
    expect(sent).toEqual([]);
    laser.point(at(0));
    laser.point(at(1));
    laser.dispose();
    vi.advanceTimersByTime(LASER_KEEPALIVE_MS * 2);
    expect(sent).toHaveLength(1);
  });
});

describe('laserColor', () => {
  it('gives the GM the first colour and each player the next by their place in the session', () => {
    const order = ['p1', 'p2'];
    expect(laserColor(GM_LASER_ID, order)).toBe(LASER_COLOR_SWATCHES[0].value);
    expect(laserColor('p1', order)).toBe(LASER_COLOR_SWATCHES[1].value);
    expect(laserColor('p2', order)).toBe(LASER_COLOR_SWATCHES[2].value);
    const twelve = Array.from({ length: 12 }, (_, i) => `p${i}`);
    expect(laserColor('p7', twelve)).toBe(LASER_COLOR_SWATCHES[0].value);
    expect(laserColor('stranger', order)).toBe(LASER_COLOR_SWATCHES[7].value);
  });
});
```

Create `tests/unit/remoteLasers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LASER_STALE_MS, RemoteLasers } from '../../src/app/pixi/laser/remoteLasers';
import { LASER_FADE_TIME } from '../../src/app/tools/laserPointerSettings';

const ORANGE = '#ff9f2e';

describe('RemoteLasers', () => {
  it("holds the newest point at full strength until the laser is let go, then fades like Atlas's trail", () => {
    const lasers = new RemoteLasers();
    lasers.receive('p1', ORANGE, [{ x: 0, y: 0 }, { x: 10, y: 0 }], false, 0);
    const [frame] = lasers.frame(LASER_FADE_TIME / 2);
    expect(frame).toMatchObject({ from: 'p1', color: ORANGE, head: { x: 10, y: 0 } });
    expect(frame!.trail.map((point) => point.life)).toEqual([0.5, 0.5, 1]);
    lasers.receive('p1', ORANGE, [], true, LASER_FADE_TIME / 2);
    expect(lasers.frame(LASER_FADE_TIME / 2)[0]!.head).toBeNull();
    expect(lasers.frame(LASER_FADE_TIME)).toEqual([]);
    expect(lasers.isActive).toBe(false);
  });

  it('lets a laser go that heard nothing for a second', () => {
    const lasers = new RemoteLasers();
    lasers.receive('p1', ORANGE, [{ x: 0, y: 0 }], false, 0);
    expect(lasers.frame(LASER_STALE_MS)[0]!.head).toEqual({ x: 0, y: 0 });
    expect(lasers.frame(LASER_STALE_MS + 1)).toEqual([]);
  });

  it('keeps a laser held still alive on empty batches', () => {
    const lasers = new RemoteLasers();
    lasers.receive('p1', ORANGE, [{ x: 0, y: 0 }], false, 0);
    lasers.receive('p1', ORANGE, [], false, 900);
    expect(lasers.frame(1500)[0]!.head).toEqual({ x: 0, y: 0 });
  });

  it('ignores a lift or a keepalive from a laser it never saw', () => {
    const lasers = new RemoteLasers();
    lasers.receive('p2', ORANGE, [], true, 0);
    lasers.receive('p3', ORANGE, [], false, 0);
    expect(lasers.isActive).toBe(false);
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run tests/unit/online/laserBatcher.test.ts tests/unit/remoteLasers.test.ts`
Expected: FAIL with unresolved imports of `LaserBatcher`, `laserColors` and `remoteLasers`.

- [ ] **Step 7: Create the batcher, the colours, the remote lasers and the hub**

Create `src/app/online/tools/LaserBatcher.ts`:

```ts
/**
 * Sends a laser while it is drawn: new points in batches, at most one message every 50 ms (20 a
 * second), each with at most the newest 64 points, and the lift in order after the stroke's last
 * points. A laser held still sends an empty batch every 500 ms, so receivers do not let it go.
 * Shared by the GM's laser (`LaserRelay`) and the join page's (`LaserTool`).
 */
import type { ScenePoint } from '../scene/sceneTypes';
import { LASER_LIMITS } from './toolMessages';

export const LASER_INTERVAL_MS = 1000 / LASER_LIMITS.perSecond;
export const LASER_KEEPALIVE_MS = 500;

interface Batch {
  points: ScenePoint[];
  lifted: boolean;
}

export class LaserBatcher {
  /** Waiting to be sent, oldest first; only the last one still takes points. */
  private readonly batches: Batch[] = [];
  private cooldown: number | null = null;
  private keepAlive: number | null = null;
  private drawing = false;

  constructor(private readonly output: (points: ScenePoint[], lifted: boolean) => void) {}

  get isDrawing(): boolean {
    return this.drawing;
  }

  /** The laser reached `point`; the first point after a lift starts a new stroke. */
  point(point: ScenePoint): void {
    this.drawing = true;
    let batch = this.batches[this.batches.length - 1];
    if (!batch || batch.lifted) {
      batch = { points: [], lifted: false };
      this.batches.push(batch);
    }
    batch.points.push({ x: point.x, y: point.y });
    if (batch.points.length > LASER_LIMITS.points) batch.points.splice(0, batch.points.length - LASER_LIMITS.points);
    this.flushSoon();
  }

  /** The laser was let go or interrupted; nothing happens without a stroke. */
  lift(): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.clearKeepAlive();
    const batch = this.batches[this.batches.length - 1];
    if (batch && !batch.lifted) batch.lifted = true;
    else this.batches.push({ points: [], lifted: true });
    this.flushSoon();
  }

  dispose(): void {
    if (this.cooldown !== null) window.clearTimeout(this.cooldown);
    this.cooldown = null;
    this.clearKeepAlive();
    this.batches.length = 0;
    this.drawing = false;
  }

  private flushSoon(): void {
    if (this.cooldown === null) this.flush();
  }

  private flush(): void {
    const batch = this.batches.shift();
    if (batch) this.send(batch.points, batch.lifted);
  }

  private send(points: ScenePoint[], lifted: boolean): void {
    this.output(points, lifted);
    this.cooldown = window.setTimeout(() => {
      this.cooldown = null;
      this.flush();
    }, LASER_INTERVAL_MS);
    this.clearKeepAlive();
    if (!this.drawing) return;
    this.keepAlive = window.setTimeout(() => {
      this.keepAlive = null;
      if (this.drawing && this.cooldown === null && this.batches.length === 0) this.send([], false);
    }, LASER_KEEPALIVE_MS);
  }

  private clearKeepAlive(): void {
    if (this.keepAlive !== null) window.clearTimeout(this.keepAlive);
    this.keepAlive = null;
  }
}
```

Create `src/app/online/tools/laserColors.ts`:

```ts
/**
 * Whose laser has which colour: Atlas's laser swatches in order, the GM's first, then each
 * player's by their place in the session (join order, as `presence` lists them). The GM and
 * every page compute the same colours from the same order. Shared with the web page.
 */
import { LASER_COLOR_SWATCHES } from '../../tools/laserPointerSettings';

/** The `from` of the GM's own laser. */
export const GM_LASER_ID = 'gm';

export const LASER_PALETTE: readonly string[] = LASER_COLOR_SWATCHES.map((swatch) => swatch.value);

/** `from`'s colour among `order`, the session's players; someone not in it gets the last colour. */
export function laserColor(from: string, order: readonly string[]): string {
  const place = from === GM_LASER_ID ? 0 : order.indexOf(from) + 1;
  const index = from === GM_LASER_ID || place > 0 ? place : LASER_PALETTE.length - 1;
  return LASER_PALETTE[index % LASER_PALETTE.length]!;
}
```

Create `src/app/pixi/laser/remoteLasers.ts`:

```ts
/**
 * Other people's lasers as messages bring them: each a trail that fades like Atlas's own, its
 * newest point held at full strength until the laser is let go. A laser that hears nothing for
 * a second is let go, so a lost lift never leaves one hanging. Shared by the GM's view
 * (`RemoteLaserRenderer`) and the join page.
 */
import type { BeamPoint } from './laserBeamGeometry';
import { LaserTrail } from './laserTrail';

export const LASER_STALE_MS = 1000;

interface Point {
  x: number;
  y: number;
}

export interface RemoteLaserFrame {
  from: string;
  color: string;
  /** Oldest to newest, the held point last at full strength. */
  trail: BeamPoint[];
  /** Where the laser is while it is held; null once let go. */
  head: Point | null;
}

interface Entry {
  color: string;
  trail: LaserTrail;
  lifted: boolean;
  lastAt: number;
  head: Point | null;
}

export class RemoteLasers {
  private readonly entries = new Map<string, Entry>();

  get isActive(): boolean {
    return this.entries.size > 0;
  }

  receive(from: string, color: string, points: ReadonlyArray<Point>, lifted: boolean, now: number): void {
    let entry = this.entries.get(from);
    if (!entry) {
      if (points.length === 0) return;
      entry = { color, trail: new LaserTrail(), lifted, lastAt: now, head: null };
      this.entries.set(from, entry);
    }
    for (const point of points) entry.trail.add(point.x, point.y, now);
    const last = points[points.length - 1];
    if (last) entry.head = { x: last.x, y: last.y };
    entry.color = color;
    entry.lifted = lifted;
    entry.lastAt = now;
  }

  /** What to draw now; lasers that faded out are forgotten. */
  frame(now: number): RemoteLaserFrame[] {
    const frames: RemoteLaserFrame[] = [];
    for (const [from, entry] of this.entries) {
      if (!entry.lifted && now - entry.lastAt > LASER_STALE_MS) entry.lifted = true;
      entry.trail.prune(now);
      if (entry.lifted && entry.trail.length === 0) {
        this.entries.delete(from);
        continue;
      }
      const head = entry.lifted ? null : entry.head;
      const trail = entry.trail.beamPoints(now);
      if (head) trail.push({ x: head.x, y: head.y, life: 1 });
      frames.push({ from, color: entry.color, trail, head });
    }
    return frames;
  }

  clear(): void {
    this.entries.clear();
  }
}
```

Create `src/app/pixi/laser/LaserHub.ts`:

```ts
/**
 * One Atlas view's lasers for online play: the GM's own as it is drawn (`LaserPointerRenderer`
 * emits, `LaserRelay` listens), and other people's to show (`LaserRelay` shows,
 * `RemoteLaserRenderer` draws). PIXI-free.
 */

/** The GM's laser reached a point (world units), or was let go. */
export type LocalLaserEvent = { kind: 'point'; x: number; y: number } | { kind: 'lift' };

/** New points of someone else's laser, in their colour. */
export interface RemoteLaser {
  from: string;
  color: string;
  points: ReadonlyArray<{ x: number; y: number }>;
  lifted: boolean;
}

export class LaserHub {
  private readonly local = new Set<(event: LocalLaserEvent) => void>();
  private readonly remote = new Set<(laser: RemoteLaser) => void>();

  onLocal(listener: (event: LocalLaserEvent) => void): () => void {
    this.local.add(listener);
    return () => { this.local.delete(listener); };
  }

  emitLocal(event: LocalLaserEvent): void {
    for (const listener of [...this.local]) listener(event);
  }

  onRemote(listener: (laser: RemoteLaser) => void): () => void {
    this.remote.add(listener);
    return () => { this.remote.delete(listener); };
  }

  showRemote(laser: RemoteLaser): void {
    for (const listener of [...this.remote]) listener(laser);
  }
}
```

- [ ] **Step 8: Run them to verify they pass**

Run: `npx vitest run tests/unit/online/laserBatcher.test.ts tests/unit/remoteLasers.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing tests for the lasers in the GM's view**

Create `tests/unit/laserPointerRenderer.hub.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { LaserHub, type LocalLaserEvent } from '../../src/app/pixi/laser/LaserHub';
import { LaserTrail } from '../../src/app/pixi/laser/laserTrail';
import { LaserPointerRenderer } from '../../src/app/pixi/LaserPointerRenderer';

const proto = LaserPointerRenderer.prototype as unknown as Record<string, (...args: unknown[]) => void>;

/** The fields the input handlers read, as `laserPointerRenderer.viewportMoved.test.ts` drives them. */
function harness(): { self: Record<string, unknown>; events: LocalLaserEvent[] } {
  const hub = new LaserHub();
  const events: LocalLaserEvent[] = [];
  hub.onLocal((event) => events.push(event));
  const self = {
    hub, trail: new LaserTrail(), viewport: { scale: { x: 1 } }, readSettings: () => ({ color: '#ff0059', size: 16 }),
    isToolActive: true, isPointing: true, isQuickMode: false, redraw: vi.fn(), liftLaser: proto.liftLaser,
  };
  return { self, events };
}

describe("LaserPointerRenderer and online play", () => {
  it("tells the view's hub each point of the GM's laser and when it is let go", () => {
    const { self, events } = harness();
    proto.addTrailPoint!.call(self, 10, 20);
    // Closer than the spacing: not a point of the trail, so not sent either.
    proto.addTrailPoint!.call(self, 11, 20);
    proto.handlePointerUp!.call(self, { button: 0, stopPropagation: () => {} });
    expect(events).toEqual([{ kind: 'point', x: 10, y: 20 }, { kind: 'lift' }]);
  });

  it('lets the laser go when the pointer is released outside the canvas', () => {
    const { self, events } = harness();
    proto.handlePointerUpOutside!.call(self);
    expect(events).toEqual([{ kind: 'lift' }]);
  });
});
```

Create `tests/unit/remoteLaserRenderer.test.ts`:

```ts
import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { LaserBeamFrame, LaserBeamView } from '../../src/app/pixi/laser/LaserBeam';
import { LaserHub } from '../../src/app/pixi/laser/LaserHub';
import { RemoteLaserRenderer } from '../../src/app/pixi/laser/RemoteLaserRenderer';
import { LASER_FADE_TIME } from '../../src/app/tools/laserPointerSettings';
import { manualTicker } from '../mocks/manualTicker';

class FakeBeam implements LaserBeamView {
  readonly view = new Container();
  readonly frames: LaserBeamFrame[] = [];
  destroyed = false;
  draw(frame: LaserBeamFrame): void { this.frames.push(frame); }
  destroy(): void { this.destroyed = true; }
}

describe('RemoteLaserRenderer', () => {
  it("draws each player's laser in its colour while it lasts, then frees its beam and stops ticking", () => {
    const { ticker, advance } = manualTicker();
    let now = 0;
    const beams: FakeBeam[] = [];
    const hub = new LaserHub();
    const renderer = new RemoteLaserRenderer({
      ticker, zoom: () => 2, hub, now: () => now,
      createBeam: () => {
        const beam = new FakeBeam();
        beams.push(beam);
        return beam;
      },
    });
    hub.showRemote({ from: 'p1', color: '#ff9f2e', points: [{ x: 5, y: 5 }], lifted: false });
    advance(16);
    expect(beams).toHaveLength(1);
    expect(renderer.container.children).toContain(beams[0]!.view);
    expect(beams[0]!.frames.at(-1)).toMatchObject({ color: '#ff9f2e', pointer: { x: 5, y: 5 }, dot: null, zoom: 2 });

    hub.showRemote({ from: 'p1', color: '#ff9f2e', points: [], lifted: true });
    now = LASER_FADE_TIME;
    advance(16);
    expect(beams[0]!.destroyed).toBe(true);
    expect(renderer.container.children).toHaveLength(0);
    expect(ticker.count).toBe(0);
    renderer.destroy();
  });
});
```

- [ ] **Step 10: Run them to verify they fail**

Run: `npx vitest run tests/unit/laserPointerRenderer.hub.test.ts tests/unit/remoteLaserRenderer.test.ts`
Expected: FAIL: the renderer never emits to a hub, and `RemoteLaserRenderer` does not exist.

- [ ] **Step 11: Emit the GM's laser, draw players' lasers in each view, and reach them from the presented scene**

In `src/app/pixi/LaserPointerRenderer.ts`:

1. Add `import type { LaserHub } from './laser/LaserHub';` with the imports.

2. Add the field `private readonly hub: LaserHub | null;` after `readSettings`. Add a sixth constructor parameter `hub: LaserHub | null = null`, documented in the constructor's parameter list as `// The view's lasers for online play: each point of the GM's laser, and its lift.`, and assign `this.hub = hub;` after `this.readSettings = readSettings;`.

3. Add after `endQuickMode`:

```ts
  /** The GM let the laser go: online players see it fade. */
  private liftLaser(): void {
    this.hub?.emitLocal({ kind: 'lift' });
  }
```

4. Call `this.liftLaser();` right after each of these four `this.isPointing = false;` statements:
   - the store subscription's branch for a tool that is no longer active;
   - `handlePointerUp`'s branch for button 0;
   - `handlePointerUpOutside`'s branch for `isPointing`;
   - `endQuickMode`.

5. In `addTrailPoint`, after `this.trail.add(x, y, Date.now());`, add `this.hub?.emitLocal({ kind: 'point', x, y });`.

Create `src/app/pixi/laser/RemoteLaserRenderer.ts`:

```ts
/**
 * Online players' lasers in an Atlas view, drawn like the GM's own (`LaserBeam`, or
 * `CanvasLaserBeam` without a GPU) at the default size, and fading the same way. `LaserRelay`
 * shows them through the view's `LaserHub`. The ticker runs only while a laser is on screen.
 */
import { Container, type Ticker } from 'pixi.js';
import { DEFAULT_LASER_POINTER_SETTINGS } from '../../tools/laserPointerSettings';
import { destroyTree } from '../utils/destroyTree';
import type { LaserBeamView } from './LaserBeam';
import { beamWidth } from './laserBeamGeometry';
import type { LaserHub } from './LaserHub';
import { RemoteLasers } from './remoteLasers';

export interface RemoteLaserRendererOptions {
  ticker: Pick<Ticker, 'add' | 'remove'>;
  /** The viewport's scale now. */
  zoom(): number;
  createBeam(): LaserBeamView;
  hub: LaserHub;
  /** Tests pass their own clock. */
  now?: () => number;
}

export class RemoteLaserRenderer {
  readonly container = new Container({ label: 'remote-lasers' });
  private readonly lasers = new RemoteLasers();
  private readonly beams = new Map<string, LaserBeamView>();
  private ticking = false;
  private readonly stopListening: () => void;

  constructor(private readonly options: RemoteLaserRendererOptions) {
    this.container.eventMode = 'none';
    this.stopListening = options.hub.onRemote((laser) => {
      this.lasers.receive(laser.from, laser.color, laser.points, laser.lifted, this.now());
      this.startTicking();
    });
  }

  destroy(): void {
    this.stopListening();
    this.stopTicking();
    for (const [from, beam] of [...this.beams]) this.dropBeam(from, beam);
    this.lasers.clear();
    destroyTree(this.container);
  }

  private readonly tick = (): void => {
    const zoom = this.options.zoom() || 1;
    const width = beamWidth(DEFAULT_LASER_POINTER_SETTINGS.size, zoom);
    const shown = new Set<string>();
    for (const frame of this.lasers.frame(this.now())) {
      shown.add(frame.from);
      this.beamOf(frame.from).draw({ trail: frame.trail, dot: null, pointer: frame.head, color: frame.color, width, zoom });
    }
    for (const [from, beam] of [...this.beams]) if (!shown.has(from)) this.dropBeam(from, beam);
    if (!this.lasers.isActive) this.stopTicking();
  };

  private beamOf(from: string): LaserBeamView {
    let beam = this.beams.get(from);
    if (!beam) {
      beam = this.options.createBeam();
      this.beams.set(from, beam);
      this.container.addChild(beam.view);
    }
    return beam;
  }

  /** The view goes with its container first, then what it leaves alive. */
  private dropBeam(from: string, beam: LaserBeamView): void {
    this.beams.delete(from);
    destroyTree(beam.view);
    beam.destroy();
  }

  private startTicking(): void {
    if (this.ticking) return;
    this.ticking = true;
    this.options.ticker.add(this.tick);
  }

  private stopTicking(): void {
    if (!this.ticking) return;
    this.ticking = false;
    this.options.ticker.remove(this.tick);
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
```

In `src/app/PixiRendererOrchestrator.ts`:

1. Add the imports beside the `LaserPointerRenderer` import (skip `usesCanvasRenderer` if the file already imports it):

```ts
import { CanvasLaserBeam } from "./pixi/laser/CanvasLaserBeam";
import { LaserBeam } from "./pixi/laser/LaserBeam";
import { LaserHub } from "./pixi/laser/LaserHub";
import { RemoteLaserRenderer } from "./pixi/laser/RemoteLaserRenderer";
import { usesCanvasRenderer } from "./pixi/utils/rendererType";
```

2. After the field `laserPointerRenderer`, add:

```ts
  /** This view's lasers for online play; one hub for the view's lifetime, so the presented scene keeps reaching it. */
  private readonly laserHub = new LaserHub();
  private remoteLaserRenderer?: RemoteLaserRenderer; // Online players' lasers
```

3. Pass `this.laserHub` as the last argument of `new LaserPointerRenderer(…)`. After `laserPointerContainer.zIndex = 2000;`, add:

```ts
    // Online players' lasers, above the map like the GM's own.
    this.remoteLaserRenderer?.destroy();
    this.remoteLaserRenderer = new RemoteLaserRenderer({
      ticker: this.app.ticker, zoom: () => viewport.scale.x, hub: this.laserHub,
      createBeam: () => (usesCanvasRenderer(this.app.renderer) ? new CanvasLaserBeam() : new LaserBeam()),
    });
    viewport.addChild(this.remoteLaserRenderer.container);
    this.remoteLaserRenderer.container.zIndex = 2000;
```

4. After `getBackgroundSprite()`, add `getLaserHub(): LaserHub { return this.laserHub; }`.

5. After `this.laserPointerRenderer?.destroy(); // Destroy LaserPointerRenderer`, add `this.remoteLaserRenderer?.destroy();`.

In `src/app/services/PresentedScene.ts`:

1. Add `import type { LaserHub } from '../pixi/laser/LaserHub';`.

2. Change the `renderer` member of `PresentedView` to:

```ts
  readonly renderer?: {
    getBackgroundSprite(): BackgroundSprite | null;
    getViewportInstance?(): CameraViewport | null;
    getLaserHub?(): LaserHub;
  } | null;
```

3. Add to `PresentedSceneInfo`:

```ts
  /** The view's lasers: the GM's own as drawn, and where online players' are shown; null without a renderer. */
  laser(): LaserHub | null;
```

4. In `present`, add `laser: () => view.renderer?.getLaserHub?.() ?? null,` to the scene object after `watchCamera`.

- [ ] **Step 12: Run them to verify they pass**

Run: `npx vitest run tests/unit/laserPointerRenderer.hub.test.ts tests/unit/remoteLaserRenderer.test.ts tests/unit/laserPointerRenderer.viewportMoved.test.ts tests/unit/pixiRendererOrchestrator.cleanup.test.ts tests/unit/presentedScene.test.ts`
Expected: PASS.

- [ ] **Step 13: Write the failing tests for the dice host, the laser relay and the player session**

Create `tests/unit/online/toolsFixtures.ts`:

```ts
/**
 * The token moves world (`tokenMoveFixtures.ts`) with the player tools' GM side: the dice host
 * on an in-memory dice feed, rolling every die in the middle, and the laser relay, with a laser
 * hub on the presented view as `PixiRendererOrchestrator` gives every view.
 */
import { LaserHub, type RemoteLaser } from '../../../src/app/pixi/laser/LaserHub';
import type { ControlMessage } from '../../../src/app/online/protocol';
import type { DiceFeed } from '../../../src/app/online/tools/diceFeed';
import { DiceHost } from '../../../src/app/online/tools/DiceHost';
import { LaserRelay } from '../../../src/app/online/tools/LaserRelay';
import type { DiceRollResult } from '../../../src/app/tools/diceRolling';
import { moveWorld, type MovePlayer } from './tokenMoveFixtures';

export type MemoryDiceFeed = DiceFeed & { readonly published: DiceRollResult[]; listening(): number };

/** Atlas's dice event without the document: what `publish` gets, every listener hears. */
export function memoryDiceFeed(): MemoryDiceFeed {
  const listeners = new Set<(result: DiceRollResult) => void>();
  const published: DiceRollResult[] = [];
  return {
    published,
    listening: () => listeners.size,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    publish: (result) => {
      published.push(result);
      for (const listener of [...listeners]) listener(result);
    },
  };
}

/** Rolls the middle of every die: a d4 rolls 3, a d6 4, a d8 5, a d20 11. */
export const MIDDLE_ROLL = (): number => 0.5;

type Laser = Extract<ControlMessage, { type: 'laser' }>;
type DiceLog = Extract<ControlMessage, { type: 'dice-log' }>;

export function toolsWorld() {
  const world = moveWorld();
  const feed = memoryDiceFeed();
  const hub = new LaserHub();
  const shown: RemoteLaser[] = [];
  hub.onRemote((laser) => shown.push(laser));
  Object.assign(world.view.renderer!, { getLaserHub: () => hub });
  const dice = new DiceHost({ session: world.gm, presented: world.presented, feed, random: MIDDLE_ROLL });
  const lasers = new LaserRelay({ session: world.gm, presented: world.presented, projection: world.broadcaster });
  dice.start();
  lasers.start();
  return {
    ...world, feed, hub, shown, dice, lasers,
    /** The dice logs the GM sent `player`, in order. */
    logs: (player: MovePlayer): DiceLog[] => player.received.filter((message): message is DiceLog => message.type === 'dice-log'),
    /** The lasers the GM sent `player`, in order. */
    lasersOf: (player: MovePlayer): Laser[] => player.received.filter((message): message is Laser => message.type === 'laser'),
    sceneId: (): string => world.broadcaster.currentProjection()?.sceneId ?? 'none',
    finish(): void {
      lasers.stop();
      dice.stop();
      world.finish();
    },
  };
}
```

Create `tests/unit/online/diceHost.test.ts`:

```ts
import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { documentDiceFeed } from '../../../src/app/online/tools/diceFeed';
import { DICE_LIMITS } from '../../../src/app/online/tools/toolMessages';
import { DiceTool } from '../../../src/app/tools/DiceTool';
import { rollFormula } from '../../../src/app/tools/diceRolling';
import { toolsWorld } from './toolsFixtures';

describe('DiceHost', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('replays the latest 50 rolls on admission, newest first, even when there are none', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    expect(w.logs(a)).toEqual([{ v: 1, type: 'dice-log', entries: [], replay: true }]);
    for (let i = 0; i < 55; i++) w.feed.publish(rollFormula(`${i + 1}d4`));
    expect(w.logs(a).filter((log) => !log.replay)).toHaveLength(55);
    const b = await w.join('B');
    const [replay] = w.logs(b);
    expect(replay?.replay).toBe(true);
    expect(replay?.entries).toHaveLength(DICE_LIMITS.logEntries);
    expect(replay?.entries[0]?.formula).toBe('55d4');
    expect(replay?.entries.at(-1)?.formula).toBe('6d4');
    w.finish();
  });

  it("rolls a player's roll with Atlas's dice code, named after them", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    expect(a.session.sendDiceRoll({ d20: 1 }, 2)).toBe(true);
    expect(w.feed.published).toHaveLength(1);
    expect(w.feed.published[0]).toMatchObject({ formula: 'd20+2', rolledBy: 'A', total: 13 });
    w.finish();
  });

  it('ignores more than two rolls a second from one player', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    for (let i = 0; i < 3; i++) a.session.sendDiceRoll({ d6: 1 }, 0);
    expect(w.feed.published).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    a.session.sendDiceRoll({ d6: 1 }, 0);
    expect(w.feed.published).toHaveLength(3);
    w.finish();
  });

  it('names a roll for a hidden token GM, and a roll for a visible one by its token', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    w.feed.publish({ ...rollFormula('d20'), source: { type: 'statblock', tokenId: 'orc', tokenName: 'Orc', abilityName: 'Axe' } });
    w.feed.publish({ ...rollFormula('d20'), source: { type: 'statblock', tokenId: 'hero', tokenName: 'Hero' } });
    w.feed.publish(rollFormula('d20'));
    expect(w.logs(a).slice(-3).map((log) => log.entries[0]?.name)).toEqual(['GM', 'Hero', 'GM']);
    expect(JSON.stringify(a.received)).not.toContain('Orc');
    w.finish();
  });

  it("hears every roll Atlas's dice tool dispatches, and dispatches player rolls the same way", () => {
    const feed = documentDiceFeed();
    const heard: string[] = [];
    const stop = feed.subscribe((result) => heard.push(result.formula));
    new DiceTool(new EventEmitter()).rollDice('d20');
    feed.publish({ ...rollFormula('d6'), rolledBy: 'Anna' });
    stop();
    new DiceTool(new EventEmitter()).rollDice('d8');
    expect(heard).toEqual(['d20', 'd6']);
  });
});
```

Create `tests/unit/online/laserRelay.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeControl } from '../../../src/app/online/protocol';
import type { PlayerLaser } from '../../../src/app/online/tools/toolMessages';
import { LASER_COLOR_SWATCHES } from '../../../src/app/tools/laserPointerSettings';
import { toolsWorld } from './toolsFixtures';

describe('LaserRelay', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("brings a player's laser to the other players and the GM's view, never back to its sender", async () => {
    const w = toolsWorld();
    w.present();
    const heard: PlayerLaser[] = [];
    const a = await w.join('A');
    const b = await w.join('B', { onLaser: (laser) => heard.push(laser) });
    expect(a.session.sendLaser([{ x: 10, y: 20 }], false)).toBe(true);
    expect(heard).toEqual([{ from: a.playerId, sceneId: w.sceneId(), points: [{ x: 10, y: 20 }], lifted: false }]);
    expect(w.lasersOf(a)).toEqual([]);
    expect(w.shown).toEqual([{ from: a.playerId, color: LASER_COLOR_SWATCHES[1].value, points: [{ x: 10, y: 20 }], lifted: false }]);
    w.finish();
  });

  it("sends the GM's own laser to every player while the scene is live, and lets it go when the scene is held", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    w.hub.emitLocal({ kind: 'point', x: 1, y: 2 });
    expect(w.lasersOf(a).at(-1)).toEqual({ v: 1, type: 'laser', from: 'gm', sceneId: w.sceneId(), points: [{ x: 1, y: 2 }], lifted: false });
    w.tabs.getState().setActiveTab(w.dungeon);
    await vi.advanceTimersByTimeAsync(100);
    expect(w.lasersOf(a).at(-1)).toMatchObject({ from: 'gm', points: [], lifted: true });
    const count = w.lasersOf(a).length;
    w.hub.emitLocal({ kind: 'point', x: 5, y: 5 });
    await vi.advanceTimersByTimeAsync(600);
    expect(w.lasersOf(a)).toHaveLength(count);
    w.finish();
  });

  it("relays a player's laser on the held scene to players, but shows none on the GM's other map", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    w.tabs.getState().setActiveTab(w.dungeon);
    a.session.sendLaser([{ x: 3, y: 4 }], false);
    expect(w.lasersOf(b).at(-1)).toMatchObject({ from: a.playerId, points: [{ x: 3, y: 4 }] });
    expect(w.shown).toEqual([]);
    w.finish();
  });

  it("ignores a laser for another scene and a player's claim to be the GM", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    a.sendRaw(encodeControl({ v: 1, type: 'laser', sceneId: 'elsewhere', points: [{ x: 1, y: 1 }], lifted: false }));
    a.sendRaw(encodeControl({ v: 1, type: 'laser', from: 'gm', sceneId: w.sceneId(), points: [{ x: 1, y: 1 }], lifted: false }));
    expect(w.lasersOf(b).map((laser) => laser.from)).toEqual([a.playerId]);
    w.finish();
  });

  it('ignores more than 20 lasers a second from one player', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    for (let i = 0; i < 25; i++) a.session.sendLaser([{ x: i, y: 0 }], false);
    expect(w.lasersOf(b)).toHaveLength(20);
    w.finish();
  });

  it("lets a leaving player's laser go for everyone", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    const c = await w.join('C');
    a.session.sendLaser([{ x: 1, y: 1 }], false);
    a.session.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.lasersOf(b).at(-1)).toEqual({ v: 1, type: 'laser', from: a.playerId, sceneId: w.sceneId(), points: [], lifted: true });
    expect(w.shown.at(-1)).toMatchObject({ from: a.playerId, lifted: true });
    // Removed by the GM mid-stroke: the session's player list no longer has them.
    c.session.sendLaser([{ x: 2, y: 2 }], false);
    w.lasers.playersChanged(w.gm.getPlayers().filter((player) => player.playerId !== c.playerId));
    expect(w.lasersOf(b).at(-1)).toMatchObject({ from: c.playerId, lifted: true });
    w.finish();
  });
});
```

Create `tests/unit/online/playerToolsEndToEnd.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiceLogEntry } from '../../../src/app/online/tools/toolMessages';
import { MIDDLE_ROLL, toolsWorld } from './toolsFixtures';
import { rollFormula } from '../../../src/app/tools/diceRolling';

describe('player tools end to end', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("rolls a player's mixed roll on the GM's side, into the GM's dice log and every player's", async () => {
    const w = toolsWorld();
    w.present();
    const logs: Array<{ entries: readonly DiceLogEntry[]; replay: boolean }> = [];
    const a = await w.join('A', { onDiceLog: (entries, replay) => logs.push({ entries, replay }) });
    const b = await w.join('B');
    expect(logs).toEqual([{ entries: [], replay: true }]);
    expect(a.session.sendDiceRoll({ d6: 2, d8: 3 }, 1)).toBe(true);
    // 2 × 4 + 3 × 5 + 1: the second die's count is not a modifier.
    expect(w.feed.published).toHaveLength(1);
    expect(w.feed.published[0]).toMatchObject({ formula: '2d6+3d8+1', rolledBy: 'A', modifiers: 1, total: 24 });
    const entry = { name: 'A', formula: '2d6+3d8+1', modifier: 1, total: 24 };
    expect(logs.at(-1)).toMatchObject({ replay: false, entries: [entry] });
    expect(w.logs(b).at(-1)).toMatchObject({ replay: false, entries: [entry] });
    expect(w.logs(b).at(-1)?.entries[0]?.dice).toEqual([
      { die: 'd6', value: 4 }, { die: 'd6', value: 4 }, { die: 'd8', value: 5 }, { die: 'd8', value: 5 }, { die: 'd8', value: 5 },
    ]);
    w.finish();
  });

  it('replays the latest rolls to a rejoining player, newest first', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    a.session.sendDiceRoll({ d20: 1 }, 0);
    vi.advanceTimersByTime(10);
    w.feed.publish(rollFormula('d4', MIDDLE_ROLL));
    // A new tab of the same player takes the link over and is admitted again.
    const again = await w.join('A');
    const replay = w.logs(again).find((log) => log.replay);
    expect(replay?.entries.map((logged) => [logged.name, logged.formula])).toEqual([['GM', 'd4'], ['A', 'd20']]);
    w.finish();
  });

  it('sends no laser without a scene, and nothing once the player is removed', async () => {
    const w = toolsWorld();
    const a = await w.join('A');
    expect(a.session.sendLaser([{ x: 1, y: 1 }], false)).toBe(false);
    w.gm.kick(a.playerId);
    expect(a.session.sendDiceRoll({ d6: 1 }, 0)).toBe(false);
    w.finish();
  });
});
```

The first `sendLaser` returns false because no scene is presented yet; after the kick the session is denied.

- [ ] **Step 14: Run them to verify they fail**

Run: `npx vitest run tests/unit/online/diceHost.test.ts tests/unit/online/laserRelay.test.ts tests/unit/online/playerToolsEndToEnd.test.ts`
Expected: FAIL with unresolved imports of `diceFeed`, `DiceHost` and `LaserRelay`.

- [ ] **Step 15: Create the dice feed, the dice host and the laser relay; send and hear them in `PlayerSession`**

Create `src/app/online/tools/diceFeed.ts`:

```ts
/**
 * Every roll Atlas's dice log gets: the `atlas-dice-rolled` document event, which the toolbar's
 * dice tray, statblock rolls and online rolls all dispatch, and which Atlas's dice log, toasts
 * and dice sounds listen to. A physical-dice integration that dispatches it is relayed too.
 */
import { DICE_ROLLED_EVENT, type DiceRollResult } from '../../tools/diceRolling';

export interface DiceFeed {
  subscribe(listener: (result: DiceRollResult) => void): () => void;
  /** Adds a roll to Atlas's dice log, toasts and sounds, as `DiceTool.rollDice` does. */
  publish(result: DiceRollResult): void;
}

export function documentDiceFeed(doc: Document = document): DiceFeed {
  return {
    subscribe: (listener) => {
      const handler = (event: Event): void => listener((event as CustomEvent<DiceRollResult>).detail);
      doc.addEventListener(DICE_ROLLED_EVENT, handler);
      return () => doc.removeEventListener(DICE_ROLLED_EVENT, handler);
    },
    publish: (result) => {
      doc.dispatchEvent(new CustomEvent(DICE_ROLLED_EVENT, { detail: result }));
    },
  };
}
```

Create `src/app/online/tools/DiceHost.ts`:

```ts
/**
 * Dice in an online session. A player's roll (`dice-roll`) is rolled here with Atlas's dice
 * code, so it cannot be faked, and joins Atlas's dice log, toasts and sounds through the dice
 * feed under the player's name. Every roll the dice log gets, the GM's and players', goes to
 * every admitted player as `dice-log`; each admission replays the latest 50, newest first.
 * More than 2 rolls a second from one player are ignored. A `GmSession` handler, started after
 * the token control host.
 */
import { diceFormula, rollerName, rollFormula, withoutHiddenToken, type DiceRollResult } from '../../tools/diceRolling';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { PresentedSceneSource, SceneSession } from '../scene/sceneSources';
import type { DiceFeed } from './diceFeed';
import { DICE_LIMITS, diceLogEntry, GM_ROLLER_NAME, type DiceLogEntry } from './toolMessages';

export interface DiceHostOptions {
  session: SceneSession;
  /** Tells which tokens are hidden from players, for roll names. */
  presented: PresentedSceneSource;
  feed: DiceFeed;
  /** Tests pass their own; `Math.random` otherwise. */
  random?: () => number;
}

export class DiceHost implements SessionHandler {
  private readonly limit = new RateLimit(DICE_LIMITS.rollsPerSecond);
  /** The latest rolls, newest first. */
  private readonly history: DiceLogEntry[] = [];
  private readonly stops: Array<() => void> = [];

  constructor(private readonly options: DiceHostOptions) {}

  start(): void {
    if (this.stops.length > 0) return;
    this.stops.push(this.options.session.use(this), this.options.feed.subscribe((result) => this.rolled(result)));
  }

  stop(): void {
    this.stops.splice(0).forEach((stop) => stop());
  }

  /** Every admission, a reconnect or a new tab included, replaces the player's log. */
  onAdmitted(player: SessionPlayer): void {
    this.options.session.send(player.playerId, { v: 1, type: 'dice-log', entries: [...this.history], replay: true });
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type !== 'dice-roll' || !this.limit.allow(player.playerId, Date.now())) return;
    const result = rollFormula(diceFormula(message.dice, message.modifier), this.options.random);
    this.options.feed.publish({ ...result, rolledBy: player.name });
  }

  /** Drops the windows of players who left the session: a reconnect must not reset one. */
  playersChanged(players: readonly SessionPlayer[]): void {
    this.limit.retain(new Set(players.map((player) => player.playerId)));
  }

  private rolled(result: DiceRollResult): void {
    const entry = diceLogEntry(result, this.nameOf(result));
    if (!entry) return;
    this.history.unshift(entry);
    if (this.history.length > DICE_LIMITS.logEntries) this.history.length = DICE_LIMITS.logEntries;
    const { session } = this.options;
    for (const player of session.getPlayers()) {
      if (player.status === 'admitted') session.send(player.playerId, { v: 1, type: 'dice-log', entries: [entry], replay: false });
    }
  }

  /** A roll for a token hidden on the presented scene is named "GM", as the player window hides it. */
  private nameOf(result: DiceRollResult): string {
    const store = this.options.presented.current()?.store;
    const isHidden = (tokenId: string): boolean => Boolean(store?.getState().objects?.tokens?.[tokenId]?.isHidden);
    return rollerName(withoutHiddenToken(result, isHidden)) ?? GM_ROLLER_NAME;
  }
}
```

Create `src/app/online/tools/LaserRelay.ts`:

```ts
/**
 * Lasers in an online session. A player's `laser` goes to every other admitted player with
 * `from`, the sender's session id (anything the player put there is ignored), and shows in the
 * GM's view while the presented scene is live. The GM's own laser in that view goes to every
 * player from `gm`, batched like the page's. Lasers for another scene than the one players have
 * are dropped, more than 20 a second from one player are ignored, and nothing is stored. A
 * player who leaves or is removed mid-stroke is let go everywhere. A `GmSession` handler.
 */
import type { PresentedSceneInfo } from '../../services/PresentedScene';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { CameraProjection } from '../scene/CameraSender';
import type { PresentedSceneSource, SceneSession } from '../scene/sceneSources';
import type { ScenePoint } from '../scene/sceneTypes';
import { LaserBatcher } from './LaserBatcher';
import { GM_LASER_ID, laserColor } from './laserColors';
import { LASER_LIMITS } from './toolMessages';

export interface LaserRelayOptions {
  session: SceneSession;
  presented: PresentedSceneSource;
  /** The scene players have: lasers for any other are dropped. */
  projection: Pick<CameraProjection, 'currentProjection'>;
}

export class LaserRelay implements SessionHandler {
  private readonly limit = new RateLimit(LASER_LIMITS.perSecond);
  private readonly batcher = new LaserBatcher((points, lifted) => this.relay(GM_LASER_ID, points, lifted, null));
  private readonly stops: Array<() => void> = [];
  /** The presented scene while it is live; the GM's laser is read from its view. */
  private live: PresentedSceneInfo | null = null;
  private stopLocal: (() => void) | null = null;
  /** Players with a stroke in progress, so leaving lets it go. */
  private readonly drawing = new Set<string>();

  constructor(private readonly options: LaserRelayOptions) {}

  start(): void {
    if (this.stops.length > 0) return;
    const { session, presented } = this.options;
    this.stops.push(
      session.use(this),
      presented.subscribe({
        presented: (scene) => this.attach(scene),
        held: () => this.detach(),
        cleared: () => this.detach(),
      }),
    );
    const current = presented.current();
    if (current && !presented.isHeld()) this.attach(current);
  }

  stop(): void {
    this.detach();
    this.batcher.dispose();
    this.stops.splice(0).forEach((stop) => stop());
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type !== 'laser' || !this.limit.allow(player.playerId, Date.now())) return;
    if (message.sceneId !== this.options.projection.currentProjection()?.sceneId) return;
    if (message.lifted) this.drawing.delete(player.playerId);
    else this.drawing.add(player.playerId);
    // Field by field: a page may add keys to its points.
    this.relay(player.playerId, message.points.map(({ x, y }) => ({ x, y })), message.lifted, player.playerId);
  }

  onGone(player: SessionPlayer): void {
    this.letGo(player.playerId);
  }

  /** The session's players changed: a removed player's laser goes, and so does their rate window. */
  playersChanged(players: readonly SessionPlayer[]): void {
    const known = new Set(players.map((player) => player.playerId));
    this.limit.retain(known);
    for (const playerId of [...this.drawing]) if (!known.has(playerId)) this.letGo(playerId);
  }

  private attach(scene: PresentedSceneInfo): void {
    this.detach();
    this.live = scene;
    this.stopLocal = scene.laser()?.onLocal((event) => {
      if (event.kind === 'point') this.batcher.point(event);
      else this.batcher.lift();
    }) ?? null;
  }

  /** The GM's laser was on the view that stops being shown: it is let go. */
  private detach(): void {
    this.batcher.lift();
    this.stopLocal?.();
    this.stopLocal = null;
    this.live = null;
  }

  private letGo(playerId: string): void {
    if (this.drawing.delete(playerId)) this.relay(playerId, [], true, playerId);
  }

  /** To every admitted player but the sender; a player's laser also into the GM's view while the scene is live. */
  private relay(from: string, points: ScenePoint[], lifted: boolean, sender: string | null): void {
    const scene = this.options.projection.currentProjection();
    if (!scene) return;
    const { session, presented } = this.options;
    const players = session.getPlayers();
    for (const player of players) {
      if (player.status !== 'admitted' || player.playerId === sender) continue;
      session.send(player.playerId, { v: 1, type: 'laser', from, sceneId: scene.sceneId, points, lifted });
    }
    if (sender === null || !this.live || presented.isHeld()) return;
    const order = players.filter((player) => player.status !== 'pending').map((player) => player.playerId);
    this.live.laser()?.showRemote({ from, color: laserColor(from, order), points, lifted });
  }
}
```

In `src/app/online/PlayerSession.ts`:

1. Add the imports:

```ts
import type { DiceSelection } from '../tools/diceRolling';
import type { DiceLogEntry, PlayerLaser } from './tools/toolMessages';
```

and change the scene types import to `import type { PlayerScene, ScenePoint } from './scene/sceneTypes';`.

2. Add to `PlayerSessionOptions`, after `onMoveRefused`:

```ts
  /** Dice log entries from the GM, newest first; `replay` replaces the log (sent on every admission). */
  onDiceLog?(entries: readonly DiceLogEntry[], replay: boolean): void;
  /** Someone else's laser: its new points, for the scene `sceneId`. */
  onLaser?(laser: PlayerLaser): void;
```

3. Add after `sendTokenMove`:

```ts
  /** Asks the GM to roll; false when it cannot go (not admitted, no link). */
  sendDiceRoll(dice: DiceSelection, modifier: number): boolean {
    if (this.finished || this.state.status !== 'admitted' || !this.link) return false;
    this.link.send('control', encodeControl({ v: 1, type: 'dice-roll', dice, modifier }));
    return true;
  }

  /** Sends new points of this player's laser for the scene they have; false when it cannot go. */
  sendLaser(points: readonly ScenePoint[], lifted: boolean): boolean {
    const scene = this.mirror.scene;
    if (this.finished || this.state.status !== 'admitted' || !this.link || !scene) return false;
    this.link.send('control', encodeControl({ v: 1, type: 'laser', sceneId: scene.sceneId, points: [...points], lifted }));
    return true;
  }
```

4. Add to the `switch` in `receive`, before `default`:

```ts
      case 'dice-log':
        this.options.onDiceLog?.(message.entries, message.replay);
        break;
      case 'laser':
        // Only the GM's relays carry `from`.
        if (message.from !== undefined) {
          this.options.onLaser?.({ from: message.from, sceneId: message.sceneId, points: message.points, lifted: message.lifted });
        }
        break;
```

- [ ] **Step 16: Run them to verify they pass**

Run: `npx vitest run tests/unit/online/diceHost.test.ts tests/unit/online/laserRelay.test.ts tests/unit/online/playerToolsEndToEnd.test.ts tests/unit/online/playerSession.test.ts tests/unit/online/playerSessionMoves.test.ts`
Expected: PASS.

- [ ] **Step 17: Write the failing test for the player's name in Atlas's dice log**

Create `tests/unit/diceRollerName.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { DiceToast } from '../../src/app/react/components/dice/DiceToast';
import { DiceRollEntry } from '../../src/app/react/components/dice-log/DiceRollEntry';
import { AtlasUIContext } from '../../src/app/react/root/AtlasUIContext';
import type { DiceRollResult } from '../../src/app/tools/diceRolling';
import { createInMemoryApp } from '../mocks/inMemoryVault';

const roll: DiceRollResult = {
  id: 'r', timestamp: Date.now(), formula: '2d6', modifiers: 0, total: 7, rolledBy: 'Anna',
  rolls: [{ die: 'd6', value: 3, max: 6 }, { die: 'd6', value: 4, max: 6 }],
};

function inAtlas(element: React.ReactElement): HTMLElement {
  const { app } = createInMemoryApp();
  return render(<AtlasUIContext.Provider value={{ app, view: null, pixiApp: null, renderer: null }}>{element}</AtlasUIContext.Provider>).container;
}

describe("an online player's roll in Atlas's dice log", () => {
  it('names the player in the log entry and the toast', () => {
    expect(inAtlas(<DiceRollEntry result={roll} onRepeat={() => {}} />).querySelector('.dice-log-entry__token-name')?.textContent).toBe('Anna');
    expect(inAtlas(<DiceToast result={roll} phase="visible" onDismiss={() => {}} />).querySelector('.atlas-dice-toast__name')?.textContent).toBe('Anna');
  });

  it("names nobody for the GM's own roll from the tray", () => {
    const { rolledBy: _rolledBy, ...gmRoll } = roll;
    expect(inAtlas(<DiceRollEntry result={gmRoll} onRepeat={() => {}} />).querySelector('.dice-log-entry__token-name')).toBeNull();
  });
});
```

Run: `npx vitest run tests/unit/diceRollerName.test.tsx`
Expected: FAIL: no name is shown for `rolledBy`.

- [ ] **Step 18: Show the roller's name in the log entry and the toast**

In `src/app/react/components/dice-log/DiceRollEntry.tsx`:
- Change the type import to `import { rollerName, type DiceRollResult } from '../../../tools/diceRolling';`.
- After `const hasSource = …`, add `const name = rollerName(result);`.
- Replace

```tsx
        {hasSource && (
          <span className="dice-log-entry__token-name">{sourceTokenName}</span>
        )}
```

with

```tsx
        {name && (
          <span className="dice-log-entry__token-name">{name}</span>
        )}
```

In `src/app/react/components/dice/DiceToast.tsx`:
- Change the type import to `import { rollerName, type DiceRollResult } from '../../../tools/diceRolling';`.
- After `const hasSource = …`, add `const name = rollerName(result);`.
- Replace `{hasSource && <span className="atlas-dice-toast__name">{sourceTokenName}</span>}` with `{name && <span className="atlas-dice-toast__name">{name}</span>}`.

A statblock roll still shows its token's name, since `rollerName` returns it. The avatar still shows only for statblock rolls.

Run: `npx vitest run tests/unit/diceRollerName.test.tsx tests/unit/playerWindowDiceRolls.test.tsx`
Expected: PASS.

- [ ] **Step 19: Start the dice host and the laser relay with the session**

In `tests/unit/online/onlineSessionService.test.ts`:
- Add the imports `import { memoryDiceFeed } from './toolsFixtures';` and `import { rollFormula } from '../../../src/app/tools/diceRolling';`.
- Add this test:

```ts
  it("rolls admitted players' dice and relays the dice log while hosting, and stops listening on stop", async () => {
    const presented = new PresentedScene();
    const { view, tavern } = viewWithViewport(null);
    presented.present(view, tavern);
    const feed = memoryDiceFeed();
    const network = new MemoryNetwork();
    const host = network.host('gm-id');
    const answers: Array<(allow: boolean) => void> = [];
    const svc = new OnlineSessionService(app, settings, {
      createHost: async () => host, presented, diceFeed: feed,
      showRequest: (_player, answer) => { answers.push(answer); return { hide: () => {} }; },
    });
    await svc.start();
    const link = await network.client().connect('gm-id');
    const received: ControlMessage[] = [];
    link.onMessage((_channel, data) => {
      const decoded = decodeControl(data);
      if (decoded.kind === 'message') received.push(decoded.message);
    });
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Anna', playerKey: 'k', client: { kind: 'web', version: '1' } }));
    answers[0]!(true);
    expect(received.filter((message) => message.type === 'dice-log')).toEqual([{ v: 1, type: 'dice-log', entries: [], replay: true }]);
    link.send('control', encodeControl({ v: 1, type: 'dice-roll', dice: { d20: 1 }, modifier: 2 }));
    expect(feed.published[0]).toMatchObject({ formula: 'd20+2', rolledBy: 'Anna' });
    expect(received.filter((message) => message.type === 'dice-log')).toHaveLength(2);
    svc.stop();
    expect(feed.listening()).toBe(0);
    feed.publish(rollFormula('d6'));
  });
```

Run: `npx vitest run tests/unit/online/onlineSessionService.test.ts`
Expected: FAIL: `diceFeed` is not a known dependency, and no `dice-log` is sent.

Then, in `src/app/online/OnlineSessionService.ts` (these edits only add to it):

1. Add the imports:

```ts
import { DiceHost } from './tools/DiceHost';
import { documentDiceFeed, type DiceFeed } from './tools/diceFeed';
import { LaserRelay } from './tools/LaserRelay';
```

2. Add to `Deps`:

```ts
  /** Atlas's dice rolls; the `atlas-dice-rolled` document event unless a test passes its own. */
  diceFeed?: DiceFeed;
```

3. Add the fields:

```ts
  private diceHost: DiceHost | null = null;
  private laserRelay: LaserRelay | null = null;
  private readonly diceFeed: DiceFeed;
```

and in the constructor `this.diceFeed = deps.diceFeed ?? documentDiceFeed();`.

4. In `onPlayersChanged`, after `this.tokenControlHost?.playersChanged(players);`, add:

```ts
        this.diceHost?.playersChanged(players);
        this.laserRelay?.playersChanged(players);
```

5. In `host`, after the `tokenControlHost` lines, add:

```ts
    // Players' dice and lasers; registered after the token control host.
    const diceHost = new DiceHost({ session: scenes, presented: this.presented, feed: this.diceFeed });
    this.diceHost = diceHost;
    const laserRelay = new LaserRelay({ session: scenes, presented: this.presented, projection: broadcaster });
    this.laserRelay = laserRelay;
```

and in the `try` block, after `tokenControlHost.start();`, add `diceHost.start();` and `laserRelay.start();`.

6. In `teardown`, after the `tokenControlHost` lines, add:

```ts
    this.laserRelay?.stop();
    this.laserRelay = null;
    this.diceHost?.stop();
    this.diceHost = null;
```

Run: `npx vitest run tests/unit/online/onlineSessionService.test.ts`
Expected: PASS.

- [ ] **Step 20: Type-check, lint and run the full suite**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: no type errors, no lint warnings, all tests pass.

- [ ] **Step 21: Commit**

```bash
git add src/app/online/rateLimit.ts src/app/online/control/TokenMoveHandler.ts src/app/online/tools/ src/app/online/protocol.ts \
  tests/unit/online/protocol.test.ts \
  src/app/pixi/laser/remoteLasers.ts src/app/pixi/laser/LaserHub.ts src/app/pixi/laser/RemoteLaserRenderer.ts \
  src/app/pixi/LaserPointerRenderer.ts src/app/PixiRendererOrchestrator.ts src/app/services/PresentedScene.ts \
  src/app/online/PlayerSession.ts src/app/online/OnlineSessionService.ts \
  src/app/react/components/dice-log/DiceRollEntry.tsx src/app/react/components/dice/DiceToast.tsx \
  tests/unit/online/toolMessages.test.ts tests/unit/online/laserBatcher.test.ts tests/unit/remoteLasers.test.ts \
  tests/unit/remoteLaserRenderer.test.ts tests/unit/laserPointerRenderer.hub.test.ts tests/unit/online/toolsFixtures.ts \
  tests/unit/online/diceHost.test.ts tests/unit/online/laserRelay.test.ts tests/unit/online/playerToolsEndToEnd.test.ts \
  tests/unit/diceRollerName.test.tsx tests/unit/online/onlineSessionService.test.ts
git commit -m "feat(online): roll players' dice, share the dice log and relay lasers"
```

---
### Task 3: The player page: toolbar, measure, laser, drag ruler, dice tray and dice log

The join page gains Atlas's tools. A bottom toolbar holds Move, Measure (with the shape flyout), Laser and Dice, and fits like Atlas's. There is a private measure tool, and a laser that everyone sees, drawn with the others' lasers. Dragging a token shows the drag ruler with waypoints. A dice tray rolls through the GM, and the dice log panel and toast show everyone's rolls.

All decisions live in tested shared modules: `PlayerTools`, the tools overlay, the toolbar fit, the dice tray and the dice log. `online-client/*.mts` builds DOM and binds events, and `main.mts` only wires.

Rulings this task needs: 3 (replay), 6 and 7 (lasers), 9 (snapping on the page), 10 (toolbar details), 11 (drawing order), 12 (colours), 13 (long-press).

**Files:**
- Modify: `src/app/online/view/ViewInput.ts:17-28, 81`, `src/app/online/view/TokenMoves.ts:37-44, 128-136` (and add `dragged`), `src/app/online/view/layers/layerTypes.ts` (add `OverlayLayer`), `src/app/online/view/PlayerViewRenderer.ts` (options, `draw`, `request`)
- Create: `src/app/online/view/tools/toolGrid.ts`, `MeasureTool.ts`, `DragRulerTool.ts`, `LaserTool.ts`, `PlayerTools.ts`, `toolsLayer.ts`
- Create: `src/app/online/page/toolIcons.ts`, `playerToolbar.ts`, `diceTray.ts`, `diceLogModel.ts`
- Create: `online-client/icons.mts`, `online-client/toolbar.mts`, `online-client/diceTrayView.mts`, `online-client/diceLogView.mts`
- Modify: `online-client/mapView.mts` (whole file), `online-client/main.mts` (whole file), `online-client/index.html` (the `#table` section), `online-client/style.css` (append)
- Test: `tests/unit/online/playerTools.test.ts`, `dragRulerTool.test.ts`, `toolsLayer.test.ts`, `playerViewRenderer.test.ts`, `toolIcons.test.tsx`, `playerToolbar.test.ts`, `diceTray.test.ts`, `diceLogModel.test.ts`, `pageToolbar.test.ts`, `diceTrayView.test.ts`, `diceLogView.test.ts`, `mapView.test.ts`, `tokenMovesPage.test.ts`, `playerToolsPage.test.ts`

**Interfaces:**
- Consumes:
  - Task 1:
    - Dice: `DICE_TYPES`, `diceTerms`, `DiceSelection`, `DieType`.
    - Measurement: `cellCenterAt`, `GridGeometry`, `DragRulerPath`, `dragRulerLabel`, `WAYPOINT_KEY`, `PlayerMeasurement` on `PlayerScene.measurement`.
    - Drawing: `MeasureShape`, `MEASURE_*`, `CONE_ANGLE`, `coneGeometry`, `arcPoints`, `measureLabelAnchor`, `measureLabelBox`, `measureLabelFontSize`, `pathMidpoint`.
    - Laser: `beamWidth`, `beamSmoothingSpacing`, `beamRadius`, `smoothBeam`, `laserPointSpacing`, `FILAMENT_SHARE`, `FILAMENT_COLOR`.
  - Task 2:
    - `PlayerSession.sendLaser`, `sendDiceRoll`, `onLaser`, `onDiceLog`; `PlayerLaser`, `DiceLogEntry`, `DICE_LIMITS`.
    - `LaserBatcher`, `LASER_INTERVAL_MS`, `RemoteLasers`, `RemoteLaserFrame`, `laserColor`.
  - Existing:
    - `overflowingToolbarItems` and `ToolbarFitLayout` (`packages/components/toolbar/toolbarFit.ts`, unchanged).
    - `TAP_SLOP` and `PointerKind` (`ViewInput.ts`); `cssColor` (`layers/tokenUiDrawing.ts`).
    - `DEFAULT_LASER_POINTER_SETTINGS`.
- Produces:
  - `ViewInput.ts`: `TokenGrab.grab(point: ScreenPoint, kind: PointerKind): boolean`.
  - `TokenMoves.dragged(): { tokenId: string; origin: ScenePoint; position: ScenePoint | null } | null`.
  - `layerTypes.ts`: `interface OverlayLayer extends PlayerLayer { animating(): boolean }`; `PlayerViewRendererOptions.overlays?: readonly OverlayLayer[]`.
  - Tools:
    - `toolGrid.ts`: `interface ToolGrid { geometry; snap(point); label(points) }`, `toolGridOf(scene): ToolGrid`.
    - `MeasureTool.ts`: `type MeasureChoice = 'line' | 'circle' | 'cone'`, `interface MeasureOverlay { shape; start; end; label }`, `class MeasureTool`.
    - `DragRulerTool.ts`: `WAYPOINT_HOLD_MS = 500`, `interface RulerOverlay { points; label }`, `class DragRulerTool { begin(origin, grid, kind); update(position, screen); addWaypoint(): boolean; end(); overlay() }`.
    - `LaserTool.ts`: `class LaserTool { begin(world); move(world, minGap); lift(); dispose() }`.
    - `PlayerTools.ts`:
      - `type PlayerTool = 'move' | 'measure' | 'laser'`, `interface ToolOverlay { measure; ruler; lasers: RemoteLaserFrame[] }`.
      - `class PlayerTools implements TokenGrab` with `tool`, `shape`, `select(tool)`, `selectShape(shape)`, `escape(): boolean`, `addWaypoint(): boolean`, `isDragging()`, `setScene(scene)`, `setPlayers(order, self)`, `setConnected(connected)`, `receiveLaser(laser)`, `overlay(): ToolOverlay`, `isAnimating()`, `dispose()`.
    - `toolsLayer.ts`: `MEASURE_ACCENT = '#7c5cff'`, `drawTools(surface, overlay, zoom)`, `createToolsLayer(tools): OverlayLayer`.
  - Page models:
    - `toolIcons.ts`: `type ToolIconName`, `TOOL_ICON_MARKUP`, `DICE_ICON_MARKUP`, `toolIconUrl(name)`, `dieIconUrl(die)`.
    - `playerToolbar.ts`:
      - Types: `type ToolbarControlId = PlayerTool | 'dice'`, `TOOLBAR_CONTROLS`, `MEASURE_SHAPE_OPTIONS`, `interface ToolbarState { tool; shape; diceOpen; measureMenuOpen }`.
      - Labels: `MORE_TOOLS_LABEL`, `MEASURE_OPTIONS_LABEL`.
      - Functions: `measureIcon(shape)`, `isControlActive(id, state)`, `isControlPinned(id, state)`, `hiddenControls(widths, state, layout): ReadonlySet<string>`.
    - `diceTray.ts`:
      - Constants: `LONG_PRESS_MS = 500`, `EMPTY_TRAY_TEXT`, `ROLL_LABEL`, `CLEAR_SELECTION_LABEL`, `MODIFIER_LABEL`.
      - `dieHint(die)`.
      - `class DiceTray { selection; modifier; count(die); total(); isFull(); add(die); remove(die); setModifier(text); canRoll(); text(); clear() }`.
    - `diceLogModel.ts`: `DICE_TOAST_MS = 7000`, `class PlayerDiceLog { entries; toast; isOpen; receive(entries, replay); setOpen(open); dispose() }`, `dieExtreme(die)`.
  - Page DOM:
    - `online-client/toolbar.mts`: `class PageToolbar { constructor({ root, onTool, onShape, onDice, measure?, layout? }); update(state); fit(); closeMenus(); dispose() }`.
    - `online-client/diceTrayView.mts`: `class DiceTrayView { tray; isOpen; setOpen(open) }`.
    - `online-client/diceLogView.mts`: `class DiceLogView { log; receive(entries, replay); setOpen(open); dispose() }`.
    - `online-client/mapView.mts`:
      - Options: `sendLaser`, `onToolsChange?`, `now?`.
      - Methods: `selectTool`, `selectShape`, `toolState()`, `setPlayers`, `receiveLaser`.

- [ ] **Step 1: Write the failing tests for the tools**

Create `tests/unit/online/playerTools.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScenePoint } from '../../../src/app/online/scene/sceneTypes';
import { LASER_INTERVAL_MS } from '../../../src/app/online/tools/LaserBatcher';
import { TokenMoves } from '../../../src/app/online/view/TokenMoves';
import { PlayerTools } from '../../../src/app/online/view/tools/PlayerTools';
import { ViewInput, type PointerInput } from '../../../src/app/online/view/ViewInput';
import { LASER_COLOR_SWATCHES, LASER_FADE_TIME } from '../../../src/app/tools/laserPointerSettings';
import { playerScene } from './sceneFixtures';

/** Screen and world are the same here; t1 sits at (100, 100) on a 70 px square grid. */
function setup(options: { grid?: boolean } = {}) {
  const sent: Array<{ points: ScenePoint[]; lifted: boolean }> = [];
  const moved: Array<[string, number, number]> = [];
  const pans: Array<[number, number]> = [];
  const identity = (point: ScenePoint): ScenePoint => ({ x: point.x, y: point.y });
  const moves = new TokenMoves({
    toWorld: identity,
    send: (tokenId, x, y) => {
      moved.push([tokenId, x, y]);
      return true;
    },
    onChange: () => {},
  });
  const tools = new PlayerTools({
    moves, toWorld: identity, zoom: () => 1, now: () => Date.now(),
    sendLaser: (points, lifted) => {
      sent.push({ points, lifted });
      return true;
    },
    onChange: () => {},
  });
  const scene = playerScene(options.grid === false ? { grid: null } : {});
  moves.setScene(scene);
  moves.setControlled(['t1']);
  moves.setConnected(true);
  tools.setScene(scene);
  tools.setPlayers(['other', 'me'], 'me');
  const input = new ViewInput({ pan: (dx, dy) => { pans.push([dx, dy]); }, zoomAt: () => {} }, tools);
  return { tools, moves, input, sent, moved, pans };
}
const touch = (id: number, x: number, y: number): PointerInput => ({ id, x, y, kind: 'touch', button: 0, time: 0 });

describe('PlayerTools', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('starts on Move; choosing a tool again, or Escape, returns to Move', () => {
    const { tools } = setup();
    expect(tools.tool).toBe('move');
    tools.select('measure');
    expect(tools.tool).toBe('measure');
    tools.select('measure');
    expect(tools.tool).toBe('move');
    tools.select('laser');
    expect(tools.escape()).toBe(true);
    expect(tools.tool).toBe('move');
    expect(tools.escape()).toBe(false);
    tools.selectShape('cone');
    expect([tools.tool, tools.shape]).toEqual(['measure', 'cone']);
  });

  it("measures between snapped cells in the GM's units, privately, and is gone on release", () => {
    const { tools, sent, moved } = setup();
    tools.select('measure');
    expect(tools.grab({ x: 100, y: 100 }, 'mouse')).toBe(true);
    tools.move({ x: 250, y: 100 });
    expect(tools.overlay().measure).toEqual({ shape: 'line', start: { x: 105, y: 105 }, end: { x: 245, y: 105 }, label: '10ft' });
    tools.drop({ x: 250, y: 100 });
    expect(tools.overlay().measure).toBeNull();
    expect(sent).toEqual([]);
    expect(moved).toEqual([]);
  });

  it('measures unsnapped on a square grid of the cell size when the grid is hidden from players', () => {
    const { tools } = setup({ grid: false });
    tools.selectShape('circle');
    tools.grab({ x: 100, y: 100 }, 'mouse');
    tools.move({ x: 240, y: 100 });
    expect(tools.overlay().measure).toEqual({ shape: 'circle', start: { x: 100, y: 100 }, end: { x: 240, y: 100 }, label: '10ft' });
  });

  it("sends the laser in batches, shows it here at once in this player's colour, and fades it after release", () => {
    const { tools, sent } = setup();
    tools.select('laser');
    tools.grab({ x: 10, y: 10 }, 'mouse');
    tools.move({ x: 50, y: 10 });
    expect(sent).toEqual([{ points: [{ x: 10, y: 10 }], lifted: false }]);
    expect(tools.overlay().lasers).toEqual([
      expect.objectContaining({ from: 'self', color: LASER_COLOR_SWATCHES[2].value, head: { x: 50, y: 10 } }),
    ]);
    tools.drop({ x: 50, y: 10 });
    vi.advanceTimersByTime(LASER_INTERVAL_MS);
    expect(sent.at(-1)).toEqual({ points: [{ x: 50, y: 10 }], lifted: true });
    expect(tools.isAnimating()).toBe(true);
    vi.advanceTimersByTime(LASER_FADE_TIME);
    expect(tools.overlay().lasers).toEqual([]);
    expect(tools.isAnimating()).toBe(false);
  });

  it('lets the laser go when the stroke is interrupted', () => {
    for (const interruption of ['second finger', 'pointercancel', 'tool switch', 'Escape', 'lost connection'] as const) {
      const { tools, input, sent } = setup();
      tools.select('laser');
      input.down(touch(1, 10, 10));
      input.move(touch(1, 60, 10));
      if (interruption === 'second finger') input.down(touch(2, 200, 200));
      if (interruption === 'pointercancel') input.cancel(1);
      if (interruption === 'tool switch') tools.select('measure');
      if (interruption === 'Escape') tools.escape();
      if (interruption === 'lost connection') tools.setConnected(false);
      vi.advanceTimersByTime(LASER_INTERVAL_MS * 2);
      expect(sent.at(-1)?.lifted, interruption).toBe(true);
      expect(tools.overlay().lasers[0]?.head, interruption).toBeNull();
    }
  });

  it("shows other people's lasers for this scene only, in their colours", () => {
    const { tools } = setup();
    tools.receiveLaser({ from: 'other', sceneId: 'scene-1', points: [{ x: 5, y: 5 }], lifted: false });
    tools.receiveLaser({ from: 'gm', sceneId: 'old-scene', points: [{ x: 9, y: 9 }], lifted: false });
    expect(tools.overlay().lasers).toEqual([expect.objectContaining({ from: 'other', color: LASER_COLOR_SWATCHES[1].value })]);
    tools.setScene(playerScene({ sceneId: 'scene-2' }));
    expect(tools.overlay().lasers).toEqual([]);
  });

  it("drags a token with Atlas's drag ruler and adds a waypoint on the waypoint key", () => {
    const { tools, moved } = setup();
    expect(tools.grab({ x: 100, y: 100 }, 'mouse')).toBe(true);
    expect(tools.isDragging()).toBe(true);
    tools.move({ x: 240, y: 100 });
    expect(tools.addWaypoint()).toBe(true);
    tools.move({ x: 240, y: 240 });
    expect(tools.overlay().ruler).toEqual({ points: [{ x: 105, y: 105 }, { x: 245, y: 105 }, { x: 245, y: 245 }], label: '20ft' });
    tools.drop({ x: 240, y: 240 });
    expect(tools.overlay().ruler).toBeNull();
    expect(moved).toEqual([['t1', 240, 240]]);
  });

  it("with Move, leaves a press off the player's tokens to pan the map", () => {
    const { tools } = setup();
    expect(tools.grab({ x: 600, y: 600 }, 'mouse')).toBe(false);
    expect(tools.addWaypoint()).toBe(false);
  });

  it('pinches and pans the map with two fingers whatever the tool, and drops the measurement', () => {
    const { tools, input, pans } = setup();
    tools.select('measure');
    input.down(touch(1, 100, 100));
    input.move(touch(1, 200, 100));
    expect(tools.overlay().measure).not.toBeNull();
    input.down(touch(2, 300, 300));
    input.move(touch(2, 320, 300));
    expect(tools.overlay().measure).toBeNull();
    expect(pans.length).toBeGreaterThan(0);
  });
});
```

Create `tests/unit/online/dragRulerTool.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DragRulerTool, WAYPOINT_HOLD_MS } from '../../../src/app/online/view/tools/DragRulerTool';
import { toolGridOf } from '../../../src/app/online/view/tools/toolGrid';
import { playerScene } from './sceneFixtures';

describe('DragRulerTool', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const grid = toolGridOf(playerScene());

  it('adds one waypoint per hold on a touch screen, however the finger jitters', () => {
    let changes = 0;
    const ruler = new DragRulerTool(() => { changes++; });
    ruler.begin({ x: 100, y: 100 }, grid, 'touch');
    ruler.update({ x: 240, y: 100 }, { x: 240, y: 100 });
    vi.advanceTimersByTime(WAYPOINT_HOLD_MS - 1);
    expect(ruler.overlay()?.points).toHaveLength(2);
    // Within the tap slop: still holding.
    ruler.update({ x: 243, y: 102 }, { x: 243, y: 102 });
    vi.advanceTimersByTime(1);
    expect(ruler.overlay()?.points).toEqual([{ x: 105, y: 105 }, { x: 245, y: 105 }, { x: 245, y: 105 }]);
    vi.advanceTimersByTime(WAYPOINT_HOLD_MS * 3);
    expect(ruler.overlay()?.points).toHaveLength(3);
    ruler.update({ x: 240, y: 240 }, { x: 240, y: 240 });
    vi.advanceTimersByTime(WAYPOINT_HOLD_MS);
    expect(ruler.overlay()).toEqual({ points: [{ x: 105, y: 105 }, { x: 245, y: 105 }, { x: 245, y: 245 }, { x: 245, y: 245 }], label: '20ft' });
    expect(changes).toBe(2);
  });

  it('never adds a waypoint by holding with a mouse; the key adds one instead', () => {
    const ruler = new DragRulerTool(() => {});
    ruler.begin({ x: 100, y: 100 }, grid, 'mouse');
    ruler.update({ x: 240, y: 100 }, { x: 240, y: 100 });
    vi.advanceTimersByTime(WAYPOINT_HOLD_MS * 4);
    expect(ruler.overlay()?.points).toHaveLength(2);
    expect(ruler.addWaypoint()).toBe(true);
    expect(ruler.overlay()?.points).toHaveLength(3);
  });

  it('stops holding and shows nothing once the drag ends', () => {
    let changes = 0;
    const ruler = new DragRulerTool(() => { changes++; });
    ruler.begin({ x: 100, y: 100 }, grid, 'touch');
    ruler.update({ x: 240, y: 100 }, { x: 240, y: 100 });
    ruler.end();
    vi.advanceTimersByTime(WAYPOINT_HOLD_MS * 2);
    expect(ruler.overlay()).toBeNull();
    expect(changes).toBe(0);
  });
});
```

Create `tests/unit/online/toolsLayer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { drawTools, MEASURE_ACCENT } from '../../../src/app/online/view/tools/toolsLayer';
import type { ToolOverlay } from '../../../src/app/online/view/tools/PlayerTools';
import { RecordingSurface } from './recordingSurface';

const NONE: ToolOverlay = { measure: null, ruler: null, lasers: [] };

describe('the tools overlay', () => {
  it('draws nothing while no tool is in use', () => {
    const surface = new RecordingSurface();
    drawTools(surface, NONE, 1);
    expect(surface.calls).toEqual([]);
  });

  it("draws a line measurement like Atlas: shadow, body and core, its points, and the label on a pill above", () => {
    const surface = new RecordingSurface();
    drawTools(surface, { ...NONE, measure: { shape: 'line', start: { x: 0, y: 0 }, end: { x: 140, y: 0 }, label: '10ft' } }, 1);
    expect(surface.ops('paths').map(({ style }) => [style.stroke, style.lineWidth, style.alpha])).toEqual([
      ['#000000', 6, 0.3], [MEASURE_ACCENT, 4, 0.8], [MEASURE_ACCENT, 2, 1],
    ]);
    expect(surface.ops('circle').map(({ radius }) => radius)).toEqual([11, 8, 7, 11, 8, 7]);
    expect(surface.ops('roundRect')).toHaveLength(2);
    expect(surface.ops('text')).toEqual([
      expect.objectContaining({ text: '10ft', x: 70, y: -30, style: expect.objectContaining({ font: '16px sans-serif', color: '#ffffff', align: 'center' }) }),
    ]);
  });

  it('draws circles and cones with a faint fill and an outline, and never a negative radius', () => {
    const surface = new RecordingSurface();
    drawTools(surface, { ...NONE, measure: { shape: 'circle', start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, label: '0ft' } }, 1);
    expect(surface.ops('circle').every(({ radius }) => radius >= 0)).toBe(true);
    surface.clear();
    drawTools(surface, { ...NONE, measure: { shape: 'cone', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, label: '5ft' } }, 1);
    const [fill, outline] = surface.ops('paths');
    expect(fill).toMatchObject({ closed: true, style: { fill: MEASURE_ACCENT, alpha: 0.1 } });
    expect(outline).toMatchObject({ closed: false, style: { stroke: MEASURE_ACCENT, lineWidth: 3, alpha: 0.8 } });
    expect(outline!.paths).toHaveLength(3);
  });

  it('draws the drag ruler through its waypoints, marking all but the end, labelled halfway', () => {
    const surface = new RecordingSurface();
    drawTools(surface, { ...NONE, ruler: { points: [{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 70 }], label: '10ft' } }, 1);
    expect(surface.ops('paths')[0]!.paths[0]).toHaveLength(3);
    expect(surface.ops('circle')).toHaveLength(6);
    expect(surface.ops('text')[0]).toMatchObject({ text: '10ft', x: 70, y: 0 });
  });

  it("draws a laser like Atlas's Canvas beam: the body in its colour and a white filament, round", () => {
    const surface = new RecordingSurface();
    const trail = [{ x: 0, y: 0, life: 1 }, { x: 50, y: 0, life: 1 }];
    drawTools(surface, { ...NONE, lasers: [{ from: 'p1', color: '#ff9f2e', trail, head: { x: 50, y: 0 } }] }, 1);
    const paths = surface.ops('paths');
    expect(paths.map(({ style }) => style.stroke)).toEqual(['#ff9f2e', '#ffffff']);
    expect(paths.every(({ style }) => style.round === true)).toBe(true);
    expect(paths[1]!.style.lineWidth).toBeCloseTo(paths[0]!.style.lineWidth! * 0.25);
  });
});
```

Add to `tests/unit/online/playerViewRenderer.test.ts`:

```ts
describe('PlayerViewRenderer overlays', () => {
  function overlaySetup(overlay: { draw(): void; animating(): boolean }) {
    const frames = fakeFrames();
    const drawn: string[] = [];
    const layers = Object.fromEntries(SCENE_LAYER_ORDER.map((name): [SceneLayer, PlayerLayer] => [name, {
      draw: () => { drawn.push(name); },
    }])) as Record<SceneLayer, PlayerLayer>;
    const camera = new CameraController({ now: () => 0, onChange: () => {} });
    const renderer = new PlayerViewRenderer({
      surface: new RecordingSurface(), camera, images: () => null, layers, overlays: [overlay],
      requestFrame: frames.request, cancelFrame: (handle) => frames.cancel(handle), isHidden: () => false,
    });
    const scene = playerScene();
    camera.setScreen({ width: 800, height: 600 });
    renderer.setSize({ width: 800, height: 600 }, 1);
    camera.setScene(scene);
    renderer.setScene(scene);
    return { frames, drawn };
  }

  it('draws the overlays over the fog, and keeps drawing while one animates', () => {
    let animating = true;
    const order: string[] = [];
    const t = overlaySetup({ draw: () => { order.push('tools'); }, animating: () => animating });
    t.frames.run();
    expect([...t.drawn, ...order]).toEqual([...SCENE_LAYER_ORDER, 'tools']);
    expect(t.frames.pending).toBe(1);
    animating = false;
    t.frames.run();
    expect(t.frames.pending).toBe(0);
  });

  it('still draws the scene when an overlay throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = overlaySetup({ draw: () => { throw new Error('overlay failed'); }, animating: () => false });
    t.frames.run();
    expect(t.drawn).toEqual([...SCENE_LAYER_ORDER]);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/online/playerTools.test.ts tests/unit/online/dragRulerTool.test.ts tests/unit/online/toolsLayer.test.ts tests/unit/online/playerViewRenderer.test.ts`
Expected: FAIL with unresolved imports of `view/tools/*`, and the renderer ignoring `overlays`.

- [ ] **Step 3: Pass the pointer kind, the dragged token's origin, and draw overlays**

In `src/app/online/view/ViewInput.ts`, replace the `TokenGrab` comment and its `grab` member with:

```ts
/**
 * A one-finger press the page's tools may take (`PlayerTools`): a drag of one of the player's
 * tokens, a measurement or the laser.
 */
export interface TokenGrab {
  /** Takes the press at `point`; false when the tool has no use for it, and the press pans. */
  grab(point: ScreenPoint, kind: PointerKind): boolean;
```

In `down`, change `this.holdingToken = this.tokens?.grab(point) ?? false;` to `this.holdingToken = this.tokens?.grab(point, input.kind) ?? false;`.

In `src/app/online/view/TokenMoves.ts`, add to `Held`:

```ts
  /** Where the token was when it was grabbed: the drag ruler starts there. */
  origin: ScenePoint;
```

In `grab`, change the assignment to `this.held = { tokenId, origin: { x: shown.x, y: shown.y }, offset: { x: shown.x - world.x, y: shown.y - world.y }, position: null };`. Add after `isDragging`:

```ts
  /** The token being dragged: where it was grabbed and where it is dragged to (null until it moved). */
  dragged(): { tokenId: string; origin: ScenePoint; position: ScenePoint | null } | null {
    const held = this.held;
    return held ? { tokenId: held.tokenId, origin: held.origin, position: held.position } : null;
  }
```

In `src/app/online/view/layers/layerTypes.ts`, append:

```ts
/** Drawn over the scene (the player's tools); while one animates (a fading laser) the view keeps drawing. */
export interface OverlayLayer extends PlayerLayer {
  animating(): boolean;
}
```

In `src/app/online/view/PlayerViewRenderer.ts`:

1. Add `type OverlayLayer` to the import from `./layers/layerTypes`.
2. Add to `PlayerViewRendererOptions`:

```ts
  /** Drawn over the scene and its fog, in order: the player's tools. */
  overlays?: readonly OverlayLayer[];
```

3. Add the field `private overlayFailed = false;`.
4. At the end of `draw`, after the layers' loop:

```ts
    // Above the fog, as Atlas draws its measurements and lasers.
    for (const overlay of this.options.overlays ?? []) {
      try {
        overlay.draw(surface, frame);
      } catch (error) {
        if (!this.overlayFailed) {
          this.overlayFailed = true;
          console.error('[Atlas online] a tool overlay failed to draw', error);
        }
      }
    }
```

5. In `request`, change `if (this.options.camera.isMoving()) this.request();` to `if (this.options.camera.isMoving() || this.animating()) this.request();`, and add:

```ts
  private animating(): boolean {
    return (this.options.overlays ?? []).some((overlay) => overlay.animating());
  }
```

- [ ] **Step 4: Create the tools**

Create `src/app/online/view/tools/toolGrid.ts`:

```ts
/**
 * The grid the player's measuring tools use. It is the grid players see, snapped to cell centres
 * like the GM's drop (`cellCenterAt`). Without one, it is a square grid of the map's cell size,
 * never snapped, since the grid's offset is not sent. Distances are labelled with the GM's
 * measurement settings, as Atlas's ruler labels them. Shared with the web page.
 */
import { cellCenterAt, type GridGeometry } from '../../../grid/gridDistance';
import { dragRulerLabel } from '../../../pixi/token-renderer/dragRulerPath';
import type { PlayerScene, ScenePoint } from '../../scene/sceneTypes';

export interface ToolGrid {
  geometry: GridGeometry;
  /** Where a measured point lands. */
  snap(point: ScenePoint): ScenePoint;
  /** The distance along `points`, e.g. "30ft" or a range band's name. */
  label(points: readonly ScenePoint[]): string;
}

export function toolGridOf(scene: PlayerScene): ToolGrid {
  const grid = scene.grid;
  const geometry: GridGeometry = grid
    ? { type: grid.type, size: grid.size, offsetX: grid.offsetX, offsetY: grid.offsetY }
    : { type: 'square', size: scene.map.cellSize, offsetX: 0, offsetY: 0 };
  return {
    geometry,
    snap: (point) => (grid ? cellCenterAt(geometry, point) : { x: point.x, y: point.y }),
    label: (points) => dragRulerLabel(geometry, points, scene.measurement),
  };
}
```

Create `src/app/online/view/tools/MeasureTool.ts`:

```ts
/**
 * The player's measure tool: drag from a start to a point to measure a line, a circle or a cone,
 * as Atlas's measure tool does. Private: nothing is sent, and the measurement is gone on release.
 */
import type { MeasureShape } from '../../../pixi/measureGeometry';
import type { ScenePoint } from '../../scene/sceneTypes';
import type { ToolGrid } from './toolGrid';

export type MeasureChoice = Extract<MeasureShape, 'line' | 'circle' | 'cone'>;

export interface MeasureOverlay {
  shape: MeasureChoice;
  start: ScenePoint;
  end: ScenePoint;
  label: string;
}

export class MeasureTool {
  private start: ScenePoint | null = null;
  private end: ScenePoint | null = null;

  begin(world: ScenePoint, grid: ToolGrid): void {
    this.start = grid.snap(world);
    this.end = this.start;
  }

  move(world: ScenePoint, grid: ToolGrid): void {
    if (this.start) this.end = grid.snap(world);
  }

  clear(): void {
    this.start = null;
    this.end = null;
  }

  overlay(shape: MeasureChoice, grid: ToolGrid): MeasureOverlay | null {
    if (!this.start || !this.end) return null;
    return { shape, start: this.start, end: this.end, label: grid.label([this.start, this.end]) };
  }
}
```

Create `src/app/online/view/tools/DragRulerTool.ts`:

```ts
/**
 * The drag ruler on the join page. While the player drags one of their tokens, it shows Atlas's
 * ruler from where the token started, through its waypoints, to the cell it would land in, with
 * the distance in the GM's units. Atlas's waypoint key (Space, bound by the page) adds a waypoint
 * on desktop. On a touch screen, holding still for half a second mid-drag adds one, one per hold.
 * Local: nothing is sent. Shared with the web page.
 */
import { DragRulerPath } from '../../../pixi/token-renderer/dragRulerPath';
import type { ScenePoint } from '../../scene/sceneTypes';
import type { ScreenPoint } from '../camera';
import { TAP_SLOP, type PointerKind } from '../ViewInput';
import type { ToolGrid } from './toolGrid';

export const WAYPOINT_HOLD_MS = 500;

export interface RulerOverlay {
  points: ScenePoint[];
  label: string;
}

export class DragRulerTool {
  private path: DragRulerPath | null = null;
  private grid: ToolGrid | null = null;
  private touch = false;
  /** Where the finger came to rest; moving past the tap slop from it starts a new hold. */
  private still: ScreenPoint | null = null;
  private holdTimer: number | null = null;

  /** `onChange`: a hold added a waypoint, so the ruler must be drawn again. */
  constructor(private readonly onChange: () => void) {}

  begin(origin: ScenePoint, grid: ToolGrid, kind: PointerKind): void {
    this.end();
    this.grid = grid;
    this.path = new DragRulerPath((point) => grid.snap(point));
    this.path.begin(origin);
    this.touch = kind === 'touch';
  }

  /** The dragged token is at `position`; `screen` is the finger, for the hold. */
  update(position: ScenePoint, screen: ScreenPoint): void {
    if (!this.path) return;
    this.path.update(position);
    if (!this.touch) return;
    if (this.still && Math.hypot(screen.x - this.still.x, screen.y - this.still.y) <= TAP_SLOP) return;
    this.still = { x: screen.x, y: screen.y };
    this.cancelHold();
    this.holdTimer = window.setTimeout(() => {
      this.holdTimer = null;
      this.addWaypoint();
    }, WAYPOINT_HOLD_MS);
  }

  /** A waypoint at the landing cell; false when it would repeat the last point. */
  addWaypoint(): boolean {
    const added = this.path?.addWaypoint() ?? false;
    if (added) this.onChange();
    return added;
  }

  end(): void {
    this.cancelHold();
    this.path?.end();
    this.path = null;
    this.grid = null;
    this.still = null;
  }

  overlay(): RulerOverlay | null {
    const points = this.path?.points();
    return points && this.grid ? { points, label: this.grid.label(points) } : null;
  }

  private cancelHold(): void {
    if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }
}
```

Create `src/app/online/view/tools/LaserTool.ts`:

```ts
/**
 * The player's laser: hold and move to point, shown to everyone; it fades after release like
 * Atlas's. Points are spaced like Atlas's trail, sent in batches (`LaserBatcher`), and echoed on
 * this page at once. Shared with the web page.
 */
import type { ScenePoint } from '../../scene/sceneTypes';
import { LaserBatcher } from '../../tools/LaserBatcher';

export interface LaserToolOptions {
  send(points: ScenePoint[], lifted: boolean): void;
  /** Shows the laser on this page: new points, or the lift. */
  echo(points: ScenePoint[], lifted: boolean): void;
}

export class LaserTool {
  private readonly batcher: LaserBatcher;
  private last: ScenePoint | null = null;
  private drawing = false;

  constructor(private readonly options: LaserToolOptions) {
    this.batcher = new LaserBatcher((points, lifted) => options.send(points, lifted));
  }

  begin(world: ScenePoint): void {
    this.drawing = true;
    this.last = null;
    this.add(world, 0);
  }

  /** `minGap`: the closest two points may be, in world units (`laserPointSpacing`). */
  move(world: ScenePoint, minGap: number): void {
    if (this.drawing) this.add(world, minGap);
  }

  lift(): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.last = null;
    this.batcher.lift();
    this.options.echo([], true);
  }

  dispose(): void {
    this.batcher.dispose();
  }

  private add(point: ScenePoint, minGap: number): void {
    if (this.last && Math.hypot(point.x - this.last.x, point.y - this.last.y) < minGap) return;
    this.last = { x: point.x, y: point.y };
    this.batcher.point(this.last);
    this.options.echo([this.last], false);
  }
}
```

Create `src/app/online/view/tools/PlayerTools.ts`:

```ts
/**
 * The join page's tools.
 * - Move: pans the map, and drags the player's own tokens with Atlas's drag ruler.
 * - Measure: a line, a circle or a cone.
 * - Laser: shown to everyone.
 * These are the presses `ViewInput` hands to tokens. With Move, a press on one of the player's
 * tokens drags it and any other press pans. With Measure or Laser, every one-finger press is the
 * tool's. Two fingers always pinch and pan the map, which ends the gesture. Escape, or choosing
 * the active tool again, returns to Move. Shared with the web page.
 */
import { laserPointSpacing } from '../../../pixi/laser/laserBeamGeometry';
import { RemoteLasers, type RemoteLaserFrame } from '../../../pixi/laser/remoteLasers';
import { DEFAULT_LASER_POINTER_SETTINGS } from '../../../tools/laserPointerSettings';
import type { PlayerScene, ScenePoint } from '../../scene/sceneTypes';
import { laserColor } from '../../tools/laserColors';
import type { PlayerLaser } from '../../tools/toolMessages';
import type { ScreenPoint } from '../camera';
import type { TokenMoves } from '../TokenMoves';
import type { PointerKind, TokenGrab } from '../ViewInput';
import { DragRulerTool, type RulerOverlay } from './DragRulerTool';
import { LaserTool } from './LaserTool';
import { MeasureTool, type MeasureChoice, type MeasureOverlay } from './MeasureTool';
import { toolGridOf, type ToolGrid } from './toolGrid';

export type PlayerTool = 'move' | 'measure' | 'laser';

/** What the tools draw this frame. */
export interface ToolOverlay {
  measure: MeasureOverlay | null;
  ruler: RulerOverlay | null;
  /** Everyone's lasers, this player's own included. */
  lasers: RemoteLaserFrame[];
}

export interface PlayerToolsOptions {
  moves: TokenMoves;
  /** A canvas point in world units, with the camera of now. */
  toWorld(point: ScreenPoint): ScenePoint;
  /** Screen pixels per world unit now, so laser points are spaced like Atlas's. */
  zoom(): number;
  now(): number;
  sendLaser(points: ScenePoint[], lifted: boolean): boolean;
  /** The tool, the shape, or what the tools draw changed. */
  onChange(): void;
}

/** This player's own laser, among the others'. */
const SELF = 'self';

export class PlayerTools implements TokenGrab {
  private current: PlayerTool = 'move';
  private shapeChoice: MeasureChoice = 'line';
  private scene: PlayerScene | null = null;
  private grid: ToolGrid | null = null;
  private order: readonly string[] = [];
  private self: string | null = null;
  private readonly measure = new MeasureTool();
  private readonly ruler: DragRulerTool;
  private readonly laser: LaserTool;
  private readonly lasers = new RemoteLasers();
  /** The tool whose press is in progress: it gets the moves and the release. */
  private pressed: PlayerTool | null = null;

  constructor(private readonly options: PlayerToolsOptions) {
    this.ruler = new DragRulerTool(() => options.onChange());
    this.laser = new LaserTool({
      send: (points, lifted) => { options.sendLaser(points, lifted); },
      echo: (points, lifted) => {
        this.lasers.receive(SELF, laserColor(this.self ?? SELF, this.order), points, lifted, options.now());
      },
    });
  }

  get tool(): PlayerTool {
    return this.current;
  }

  get shape(): MeasureChoice {
    return this.shapeChoice;
  }

  /** Chooses a tool; choosing the active one again returns to Move. Ends any gesture. */
  select(tool: PlayerTool): void {
    this.endGesture();
    this.current = tool === this.current ? 'move' : tool;
    this.options.onChange();
  }

  /** Chooses the measure shape, and the measure tool with it. */
  selectShape(shape: MeasureChoice): void {
    this.endGesture();
    this.shapeChoice = shape;
    this.current = 'measure';
    this.options.onChange();
  }

  /** Escape: ends the gesture (a dragged token goes back) and returns to Move; false when there was nothing to do. */
  escape(): boolean {
    if (!this.pressed && this.current === 'move') return false;
    this.endGesture();
    this.current = 'move';
    this.options.onChange();
    return true;
  }

  /** The waypoint key: a waypoint while a token is dragged. */
  addWaypoint(): boolean {
    return this.pressed === 'move' && this.ruler.addWaypoint();
  }

  isDragging(): boolean {
    return this.pressed === 'move' && this.options.moves.isDragging();
  }

  /** A new scene (another `sceneId`) ends the gesture and drops every laser. */
  setScene(scene: PlayerScene | null): void {
    const changed = scene?.sceneId !== this.scene?.sceneId;
    this.scene = scene;
    this.grid = scene ? toolGridOf(scene) : null;
    if (changed) {
      this.endGesture();
      this.lasers.clear();
    }
    this.options.onChange();
  }

  /** The session's players in order and this player's id: whose laser has which colour. */
  setPlayers(order: readonly string[], self: string | null): void {
    this.order = order;
    this.self = self;
  }

  /** Only an admitted player uses the tools: losing the connection ends the gesture and lets the laser go. */
  setConnected(connected: boolean): void {
    if (connected || !this.pressed) return;
    this.endGesture();
    this.options.onChange();
  }

  /** Someone else's laser; one for another scene is ignored. */
  receiveLaser(laser: PlayerLaser): void {
    if (!this.scene || laser.sceneId !== this.scene.sceneId) return;
    this.lasers.receive(laser.from, laserColor(laser.from, this.order), laser.points, laser.lifted, this.options.now());
    this.options.onChange();
  }

  grab(point: ScreenPoint, kind: PointerKind): boolean {
    const grid = this.grid;
    if (!grid) return false;
    if (this.current === 'move') {
      if (!this.options.moves.grab(point)) return false;
      const origin = this.options.moves.dragged()?.origin;
      if (origin) this.ruler.begin(origin, grid, kind);
    } else if (this.current === 'measure') {
      this.measure.begin(this.options.toWorld(point), grid);
    } else {
      this.laser.begin(this.options.toWorld(point));
    }
    this.pressed = this.current;
    this.options.onChange();
    return true;
  }

  move(point: ScreenPoint): void {
    const grid = this.grid;
    if (!this.pressed || !grid) return;
    if (this.pressed === 'move') {
      this.options.moves.move(point);
      const position = this.options.moves.dragged()?.position;
      if (position) this.ruler.update(position, point);
    } else if (this.pressed === 'measure') {
      this.measure.move(this.options.toWorld(point), grid);
    } else {
      this.laser.move(this.options.toWorld(point), laserPointSpacing(DEFAULT_LASER_POINTER_SETTINGS.size, this.options.zoom()));
    }
    this.options.onChange();
  }

  drop(point: ScreenPoint): void {
    if (this.pressed === 'move') this.options.moves.drop(point);
    this.finishGesture();
  }

  cancel(): void {
    this.endGesture();
    this.options.onChange();
  }

  overlay(): ToolOverlay {
    return {
      measure: this.grid ? this.measure.overlay(this.shapeChoice, this.grid) : null,
      ruler: this.pressed === 'move' ? this.ruler.overlay() : null,
      lasers: this.lasers.frame(this.options.now()),
    };
  }

  /** A laser is fading: the view keeps drawing. */
  isAnimating(): boolean {
    return this.lasers.isActive;
  }

  dispose(): void {
    this.endGesture();
    this.laser.dispose();
    this.lasers.clear();
  }

  /** Released: the measurement goes, the ruler goes, the laser is let go. */
  private finishGesture(): void {
    this.measure.clear();
    this.ruler.end();
    this.laser.lift();
    this.pressed = null;
    this.options.onChange();
  }

  /** Interrupted: as released, and a dragged token goes back instead of dropping. */
  private endGesture(): void {
    if (this.pressed === 'move') this.options.moves.cancel();
    this.measure.clear();
    this.ruler.end();
    this.laser.lift();
    this.pressed = null;
  }
}
```

Create `src/app/online/view/tools/toolsLayer.ts`:

```ts
/**
 * What the player's tools draw over the scene, above the fog as Atlas draws its measurements and
 * lasers: the measurement, the drag ruler, then everyone's lasers. Lines, points and labels
 * follow Atlas's measure drawing (`measureGeometry.ts`). Lasers follow its Canvas-renderer beam
 * (`CanvasLaserBeam`): the body in the person's colour and a white-hot filament, without the
 * glow, at the default size. Shared with the web page.
 */
import {
  beamRadius, beamSmoothingSpacing, beamWidth, FILAMENT_COLOR, FILAMENT_SHARE, smoothBeam, type BeamPoint,
} from '../../../pixi/laser/laserBeamGeometry';
import {
  arcPoints, CONE_ANGLE, coneGeometry, MEASURE_AREA, MEASURE_LABEL_COLORS, MEASURE_PATH_STROKES, MEASURE_POINT, MEASURE_SHADOW,
  measureLabelAnchor, measureLabelBox, measureLabelFontSize, pathMidpoint,
} from '../../../pixi/measureGeometry';
import { DEFAULT_LASER_POINTER_SETTINGS } from '../../../tools/laserPointerSettings';
import type { ScenePoint } from '../../scene/sceneTypes';
import type { OverlayLayer } from '../layers/layerTypes';
import { cssColor } from '../layers/tokenUiDrawing';
import type { ViewSurface } from '../ViewSurface';
import type { MeasureOverlay } from './MeasureTool';
import type { PlayerTools, ToolOverlay } from './PlayerTools';

/** The join page's accent (`--accent` in `style.css`), standing in for the GM's Obsidian accent. */
export const MEASURE_ACCENT = '#7c5cff';
const LABEL_FONT_FAMILY = 'sans-serif';
/** A label's height per unit of font size, about one line as PIXI measures it. */
const LABEL_LINE_HEIGHT = 1.2;
/** A cone's arc gets a segment per 8 screen pixels, from 8 to 64 of them. */
const ARC_PIXELS_PER_SEGMENT = 8;
const MIN_ARC_SEGMENTS = 8;
const MAX_ARC_SEGMENTS = 64;
const SHADOW = cssColor(MEASURE_SHADOW);
const FILAMENT = cssColor(FILAMENT_COLOR);
const LABEL_TEXT = '#ffffff';

export function createToolsLayer(tools: Pick<PlayerTools, 'overlay' | 'isAnimating'>): OverlayLayer {
  return {
    draw: (surface, frame) => drawTools(surface, tools.overlay(), frame.zoom),
    animating: () => tools.isAnimating(),
  };
}

/** `zoom`: screen pixels per world unit, as Atlas's viewport scale. */
export function drawTools(surface: ViewSurface, overlay: ToolOverlay, zoom: number): void {
  if (overlay.measure) drawMeasurement(surface, overlay.measure, zoom);
  const ruler = overlay.ruler;
  if (ruler) {
    drawPath(surface, ruler.points);
    // The dragged token covers the end; the start and waypoints stay marked.
    for (const point of ruler.points.slice(0, -1)) drawPoint(surface, point);
    const middle = pathMidpoint(ruler.points);
    if (middle) drawLabel(surface, ruler.label, middle, zoom);
  }
  for (const laser of overlay.lasers) drawLaser(surface, laser.trail, laser.color, zoom);
}

function drawMeasurement(surface: ViewSurface, measure: MeasureOverlay, zoom: number): void {
  const { start, end } = measure;
  if (measure.shape === 'line') {
    drawPath(surface, [start, end]);
    drawPoint(surface, end);
  } else if (measure.shape === 'circle') {
    drawCircle(surface, start, Math.hypot(end.x - start.x, end.y - start.y));
  } else {
    drawCone(surface, start, end, zoom);
  }
  drawPoint(surface, start);
  drawLabel(surface, measure.label, measureLabelAnchor(start, end, zoom), zoom);
}

function drawPath(surface: ViewSurface, points: readonly ScenePoint[]): void {
  if (points.length < 2) return;
  for (const stroke of MEASURE_PATH_STROKES) {
    surface.paths([points], false, { stroke: stroke.shadow ? SHADOW : MEASURE_ACCENT, lineWidth: stroke.width, alpha: stroke.alpha });
  }
}

function drawPoint(surface: ViewSurface, point: ScenePoint): void {
  const { radius, halo, haloAlpha, fillAlpha, ringInset, ringWidth } = MEASURE_POINT;
  surface.circle(point.x, point.y, radius + halo, { fill: SHADOW, alpha: haloAlpha });
  surface.circle(point.x, point.y, radius, { fill: MEASURE_ACCENT, alpha: fillAlpha });
  surface.circle(point.x, point.y, radius - ringInset, { stroke: MEASURE_ACCENT, lineWidth: ringWidth });
}

function drawCircle(surface: ViewSurface, center: ScenePoint, radius: number): void {
  const { fillAlpha, strokeWidth, strokeAlpha, highlightWidth, highlightInset } = MEASURE_AREA;
  surface.circle(center.x, center.y, radius, { fill: MEASURE_ACCENT, alpha: fillAlpha });
  surface.circle(center.x, center.y, radius, { stroke: MEASURE_ACCENT, lineWidth: strokeWidth, alpha: strokeAlpha });
  surface.circle(center.x, center.y, Math.max(0, radius - highlightInset), { stroke: MEASURE_ACCENT, lineWidth: highlightWidth });
}

function drawCone(surface: ViewSurface, start: ScenePoint, end: ScenePoint, zoom: number): void {
  const cone = coneGeometry(start, end);
  const pixels = cone.radius * zoom * CONE_ANGLE;
  const segments = Math.min(MAX_ARC_SEGMENTS, Math.max(MIN_ARC_SEGMENTS, Math.ceil(pixels / ARC_PIXELS_PER_SEGMENT)));
  const arc = arcPoints(start, cone.radius, cone.startAngle, cone.endAngle, segments);
  surface.paths([[start, ...arc]], true, { fill: MEASURE_ACCENT, alpha: MEASURE_AREA.fillAlpha });
  surface.paths([[start, cone.left], [start, cone.right], arc], false, {
    stroke: MEASURE_ACCENT, lineWidth: MEASURE_AREA.strokeWidth, alpha: MEASURE_AREA.strokeAlpha,
  });
}

/** The label on Atlas's dark-theme pill; the page has no Obsidian theme. */
function drawLabel(surface: ViewSurface, text: string, center: ScenePoint, zoom: number): void {
  const size = measureLabelFontSize(zoom);
  const font = `${size}px ${LABEL_FONT_FAMILY}`;
  const box = measureLabelBox(surface.measureText(text, font), size * LABEL_LINE_HEIGHT, center, zoom);
  const theme = MEASURE_LABEL_COLORS.dark;
  surface.roundRect(box.x, box.y, box.width, box.height, box.radius, { fill: cssColor(theme.fill), alpha: MEASURE_LABEL_COLORS.fillAlpha });
  surface.roundRect(box.x, box.y, box.width, box.height, box.radius, {
    stroke: cssColor(theme.stroke), alpha: theme.strokeAlpha, lineWidth: box.strokeWidth,
  });
  surface.text(text, center.x, center.y, { font, color: LABEL_TEXT, align: 'center' });
}

function drawLaser(surface: ViewSurface, trail: readonly BeamPoint[], color: string, zoom: number): void {
  const { halfWidth, bodyShare } = beamWidth(DEFAULT_LASER_POINTER_SETTINGS.size, zoom);
  const points = smoothBeam(trail, beamSmoothingSpacing(halfWidth, zoom));
  const body = (point: BeamPoint): number => beamRadius(point, halfWidth) * bodyShare;
  for (const share of [1, FILAMENT_SHARE]) {
    const stroke = share === 1 ? color : FILAMENT;
    // A laser held still is a single point: a round spot.
    const single = points.length === 1 ? points[0]! : null;
    if (single && body(single) > 0) surface.circle(single.x, single.y, body(single) * share, { fill: stroke });
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const radius = ((body(a) + body(b)) / 2) * share;
      if (radius > 0) surface.paths([[a, b]], false, { stroke, lineWidth: radius * 2, round: true });
    }
  }
}
```

- [ ] **Step 5: Run the tool tests to verify they pass**

Run: `npx vitest run tests/unit/online/playerTools.test.ts tests/unit/online/dragRulerTool.test.ts tests/unit/online/toolsLayer.test.ts tests/unit/online/playerViewRenderer.test.ts tests/unit/online/viewInput.test.ts tests/unit/online/tokenMoves.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing tests for the page models**

Create `tests/unit/online/toolIcons.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { ChevronDown, Circle, Dices, Ellipsis, Flashlight, Hand, Ruler, Triangle, X } from 'lucide-react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { DICE_ICON_MARKUP, dieIconUrl, TOOL_ICON_MARKUP, toolIconUrl, type ToolIconName } from '../../../src/app/online/page/toolIcons';
import { diceIcons } from '../../../src/app/react/components/DiceIcons';
import { DICE_TYPES } from '../../../src/app/tools/diceRolling';

type Shape = [tag: string, attributes: Record<string, string>, text: string];

function shapesOf(svg: Element | null): Shape[] {
  return [...(svg?.children ?? [])].map((child) => [
    child.tagName.toLowerCase(),
    Object.fromEntries([...child.attributes].map((attribute) => [attribute.name, attribute.value])),
    child.textContent ?? '',
  ]);
}
const rendered = (element: React.ReactElement): Shape[] => shapesOf(render(element).container.querySelector('svg'));
function parsed(markup: string): Shape[] {
  const host = document.createElement('div');
  host.innerHTML = `<svg>${markup}</svg>`;
  return shapesOf(host.querySelector('svg'));
}

describe('the join page icons', () => {
  it("are the Lucide icons of Atlas's toolbar", () => {
    const icons: Record<ToolIconName, React.ComponentType> = {
      hand: Hand, ruler: Ruler, circle: Circle, triangle: Triangle, flashlight: Flashlight, dices: Dices, ellipsis: Ellipsis,
      'chevron-down': ChevronDown, x: X,
    };
    for (const [name, Icon] of Object.entries(icons)) {
      expect(parsed(TOOL_ICON_MARKUP[name as ToolIconName]), name).toEqual(rendered(<Icon />));
    }
  });

  it("are the dice of Atlas's dice tray", () => {
    for (const die of DICE_TYPES) {
      const Icon = diceIcons[die];
      expect(parsed(DICE_ICON_MARKUP[die]), die).toEqual(rendered(<Icon />));
    }
  });

  it('become CSS mask images of a 24 px glyph', () => {
    expect(toolIconUrl('hand')).toMatch(/^url\("data:image\/svg\+xml,/);
    expect(decodeURIComponent(toolIconUrl('hand'))).toContain('stroke-linecap="round"');
    expect(decodeURIComponent(dieIconUrl('d20'))).toContain('viewBox="0 0 24 24"');
  });
});
```

Create `tests/unit/online/playerToolbar.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  hiddenControls, isControlActive, isControlPinned, measureIcon, TOOLBAR_CONTROLS, type ToolbarControlId, type ToolbarState,
} from '../../../src/app/online/page/playerToolbar';
import type { ToolbarFitLayout } from '../../../src/app/packages/components/toolbar/toolbarFit';

const layout = (available: number): ToolbarFitLayout => ({ available, chrome: 19, gap: 8, overflowButtonWidth: 36 });
// The measure group is a split button, wider than the others.
const widths = new Map<ToolbarControlId, number>(TOOLBAR_CONTROLS.map((control) => [control.id, control.id === 'measure' ? 56 : 36]));
const state = (overrides: Partial<ToolbarState> = {}): ToolbarState => ({ tool: 'move', shape: 'line', diceOpen: false, measureMenuOpen: false, ...overrides });

describe('the join page toolbar', () => {
  it("holds Move, Measure, Laser and Dice, ranked like Atlas's toolbar", () => {
    expect(TOOLBAR_CONTROLS.map(({ id, label, priority }) => [id, label, priority])).toEqual([
      ['move', 'Move', 100], ['measure', 'Measure', 90], ['laser', 'Laser', 80], ['dice', 'Dice', 75],
    ]);
  });

  it('hides nothing while everything fits', () => {
    // 19 + 36 + 56 + 36 + 36 + 3 × 8 = 207.
    expect(hiddenControls(widths, state(), layout(207)).size).toBe(0);
  });

  it('moves the lowest priorities into More tools first', () => {
    // 19 + More 36 + Move 44 + Measure 64 = 163; Laser would need 207.
    expect([...hiddenControls(widths, state(), layout(170))]).toEqual(['laser', 'dice']);
  });

  it('never moves the tool in use, or a control whose menu or tray is open', () => {
    expect([...hiddenControls(widths, state({ tool: 'laser', diceOpen: true }), layout(120))]).toEqual(['move', 'measure']);
    expect(isControlPinned('measure', state({ measureMenuOpen: true }))).toBe(true);
    expect(isControlActive('dice', state({ diceOpen: true }))).toBe(true);
    expect(isControlActive('move', state({ tool: 'measure' }))).toBe(false);
  });

  it('shows the measure shape in use on the Measure button, as Atlas does', () => {
    expect([measureIcon('line'), measureIcon('circle'), measureIcon('cone')]).toEqual(['ruler', 'circle', 'triangle']);
  });
});
```

Create `tests/unit/online/diceTray.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DiceTray, dieHint } from '../../../src/app/online/page/diceTray';

describe('the join page dice tray', () => {
  it("writes the picked dice and modifier as Atlas's tray does", () => {
    const tray = new DiceTray();
    expect(tray.text()).toBe('Select dice to roll');
    expect(tray.canRoll()).toBe(false);
    tray.add('d20');
    tray.add('d6');
    tray.add('d6');
    expect(tray.text()).toBe('d20 + 2d6');
    expect(tray.selection).toEqual({ d20: 1, d6: 2 });
    expect(tray.setModifier('3')).toBe(3);
    expect(tray.text()).toBe('d20 + 2d6 + 3');
    tray.setModifier('-4');
    expect(tray.text()).toBe('d20 + 2d6 - 4');
    expect(tray.canRoll()).toBe(true);
  });

  it('keeps the modifier a whole number within 1000', () => {
    const tray = new DiceTray();
    expect(tray.setModifier('5000')).toBe(1000);
    expect(tray.setModifier('-5000')).toBe(-1000);
    expect(tray.setModifier('2.7')).toBe(2);
    expect(tray.setModifier('abc')).toBe(0);
    expect(tray.setModifier('')).toBe(0);
  });

  it('removes one die at a time and forgets a die at zero', () => {
    const tray = new DiceTray();
    tray.add('d6');
    tray.add('d6');
    tray.add('d8');
    expect(tray.remove('d6')).toBe(true);
    expect(tray.count('d6')).toBe(1);
    tray.remove('d6');
    expect(tray.selection).toEqual({ d8: 1 });
    expect(tray.remove('d4')).toBe(false);
  });

  it('takes at most 20 dice, as the GM accepts', () => {
    const tray = new DiceTray();
    for (let i = 0; i < 20; i++) expect(tray.add(i % 2 ? 'd6' : 'd8')).toBe(true);
    expect(tray.isFull()).toBe(true);
    expect(tray.add('d20')).toBe(false);
    expect(tray.total()).toBe(20);
    tray.clear();
    expect([tray.total(), tray.modifier, tray.text()]).toEqual([0, 0, 'Select dice to roll']);
  });

  it("hints each die like Atlas's tray", () => {
    expect(dieHint('d20')).toBe('D20 • Left: add • Right: remove');
  });
});
```

Create `tests/unit/online/diceLogModel.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DICE_TOAST_MS, dieExtreme, PlayerDiceLog } from '../../../src/app/online/page/diceLogModel';
import type { DiceLogEntry } from '../../../src/app/online/tools/toolMessages';

const entry = (id: string): DiceLogEntry => ({ id, name: 'Anna', formula: 'd20', dice: [{ die: 'd20', value: 20 }], modifier: 0, total: 20, at: 0 });

describe('the join page dice log', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('replaces the log on a replay, without a toast', () => {
    const log = new PlayerDiceLog({ onChange: () => {} });
    log.receive([entry('b'), entry('a')], true);
    expect(log.entries.map(({ id }) => id)).toEqual(['b', 'a']);
    expect(log.toast).toBeNull();
    // A reconnect replays what the page already has: the same rolls, once each.
    log.receive([entry('c'), entry('b'), entry('a')], true);
    expect(log.entries.map(({ id }) => id)).toEqual(['c', 'b', 'a']);
    expect(log.toast).toBeNull();
  });

  it('adds a new roll on top and toasts it for 7 s while the log is closed', () => {
    let changes = 0;
    const log = new PlayerDiceLog({ onChange: () => { changes++; } });
    log.receive([], true);
    log.receive([entry('a')], false);
    expect(log.entries[0]?.id).toBe('a');
    expect(log.toast?.id).toBe('a');
    vi.advanceTimersByTime(DICE_TOAST_MS);
    expect(log.toast).toBeNull();
    expect(changes).toBe(3);
  });

  it('toasts nothing while the log is open, and never lists a roll twice', () => {
    const log = new PlayerDiceLog({ onChange: () => {} });
    log.setOpen(true);
    log.receive([entry('a')], false);
    expect(log.toast).toBeNull();
    log.receive([entry('a')], false);
    expect(log.entries).toHaveLength(1);
  });

  it('keeps the newest 50', () => {
    const log = new PlayerDiceLog({ onChange: () => {} });
    for (let i = 0; i < 60; i++) log.receive([entry(`r${i}`)], false);
    expect(log.entries).toHaveLength(50);
    expect(log.entries[0]?.id).toBe('r59');
  });

  it("marks a die's highest and lowest faces, as Atlas's log does", () => {
    expect(dieExtreme({ die: 'd20', value: 20 })).toBe('max');
    expect(dieExtreme({ die: 'd20', value: 1 })).toBe('min');
    expect(dieExtreme({ die: 'd6', value: 3 })).toBeNull();
  });
});
```

- [ ] **Step 7: Run them to verify they fail**

Run: `npx vitest run tests/unit/online/toolIcons.test.tsx tests/unit/online/playerToolbar.test.ts tests/unit/online/diceTray.test.ts tests/unit/online/diceLogModel.test.ts`
Expected: FAIL with unresolved imports under `src/app/online/page/`.

- [ ] **Step 8: Create the page models**

Create `src/app/online/page/toolIcons.ts`:

```ts
/**
 * Atlas's own icons for the join page: the Lucide icons of Atlas's toolbar (lucide-react 0.503),
 * and the dice of its dice tray (`DiceIcons.tsx`), as SVG markup. The page shows them as CSS mask
 * images, so they take the colour of their button. This is static markup only: nothing from the
 * network ever goes into an SVG. `tests/unit/online/toolIcons.test.tsx` checks them against
 * Atlas's components.
 */
import type { DieType } from '../../tools/diceRolling';

export type ToolIconName = 'hand' | 'ruler' | 'circle' | 'triangle' | 'flashlight' | 'dices' | 'ellipsis' | 'chevron-down' | 'x';

/** Each Lucide icon's children. */
export const TOOL_ICON_MARKUP: Record<ToolIconName, string> = {
  hand: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/>'
    + '<path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/>'
    + '<path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  ruler: '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/>'
    + '<path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>',
  circle: '<circle cx="12" cy="12" r="10"/>',
  triangle: '<path d="M13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>',
  flashlight: '<path d="M18 6c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V2h12z"/>'
    + '<line x1="6" x2="18" y1="6" y2="6"/><line x1="12" x2="12" y1="12" y2="12"/>',
  dices: '<rect width="12" height="12" x="2" y="10" rx="2" ry="2"/>'
    + '<path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"/>'
    + '<path d="M6 18h.01"/><path d="M10 14h.01"/><path d="M15 6h.01"/><path d="M18 9h.01"/>',
  ellipsis: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

const OUTLINE = 'stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"';
const GUIDE = 'stroke="currentColor" stroke-width="1" opacity="0.5"';
const D10_BODY = 'M12 2L18 6v4l-6 10-6-10V6l6-4Z';

/** Each dice tray icon's children, as `DiceIcons.tsx` renders them. */
export const DICE_ICON_MARKUP: Record<DieType, string> = {
  d4: `<path d="M12 2L3 20h18L12 2Z" ${OUTLINE}/><path d="M12 2v18" ${GUIDE}/>`,
  d6: '<rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>'
    + '<circle cx="12" cy="12" r="2" fill="currentColor"/>',
  d8: `<path d="M12 2L20 8v8l-8 6-8-6V8l8-6Z" ${OUTLINE}/><path d="M12 2v20" ${GUIDE}/><path d="M4 8l8 6 8-6" ${GUIDE}/>`,
  d10: `<path d="${D10_BODY}" ${OUTLINE}/><path d="M6 6l6 14 6-14" ${GUIDE}/>`,
  d12: `<path d="M12 2L19 7v10l-7 5-7-5V7l7-5Z" ${OUTLINE}/><polygon points="12,2 19,7 15,12 12,10 9,12 5,7" ${GUIDE} fill="none"/>`,
  d20: `<path d="M12 2L21 8.5L17 19H7L3 8.5L12 2Z" ${OUTLINE}/><path d="M12 2v17" ${GUIDE}/><path d="M3 8.5L12 19L21 8.5" ${GUIDE}/>`,
  d100: `<path d="${D10_BODY}" ${OUTLINE}/>`
    + '<text x="12" y="13" text-anchor="middle" font-size="6" fill="currentColor" font-weight="bold">%</text>',
};

const LUCIDE_ROOT = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
  + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const DICE_ROOT = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"';

function maskUrl(root: string, children: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg ${root}>${children}</svg>`)}")`;
}

/** The icon as a CSS `url()` for a mask image. */
export function toolIconUrl(name: ToolIconName): string {
  return maskUrl(LUCIDE_ROOT, TOOL_ICON_MARKUP[name]);
}

export function dieIconUrl(die: DieType): string {
  return maskUrl(DICE_ROOT, DICE_ICON_MARKUP[die]);
}
```

Create `src/app/online/page/playerToolbar.ts`:

```ts
/**
 * The join page's toolbar, like Atlas's main toolbar: Move, Measure (with the Line, Circle/Sphere
 * and Cone flyout), Laser and Dice. Controls that do not fit move into More tools by priority,
 * through Atlas's own fit (`overflowingToolbarItems`). The active tool, and a control whose menu
 * or tray hangs from it, never move. Shared with the web page; the DOM is
 * `online-client/toolbar.mts`.
 */
import { overflowingToolbarItems, type ToolbarFitLayout } from '../../packages/components/toolbar/toolbarFit';
import type { MeasureChoice } from '../view/tools/MeasureTool';
import type { PlayerTool } from '../view/tools/PlayerTools';
import type { ToolIconName } from './toolIcons';

export type ToolbarControlId = PlayerTool | 'dice';

export interface ToolbarControl {
  id: ToolbarControlId;
  label: string;
  icon: ToolIconName;
  /** Lower priorities move into More tools first. */
  priority: number;
}

export const MORE_TOOLS_LABEL = 'More tools';
export const MEASURE_OPTIONS_LABEL = 'Measure options';

/** Atlas's priorities (`MainToolbar.tsx`). The laser lives in Atlas's Move group, so it ranks between Measure and Dice. */
export const TOOLBAR_CONTROLS: readonly ToolbarControl[] = [
  { id: 'move', label: 'Move', icon: 'hand', priority: 100 },
  { id: 'measure', label: 'Measure', icon: 'ruler', priority: 90 },
  { id: 'laser', label: 'Laser', icon: 'flashlight', priority: 80 },
  { id: 'dice', label: 'Dice', icon: 'dices', priority: 75 },
];

/** Atlas's measure flyout. */
export const MEASURE_SHAPE_OPTIONS: ReadonlyArray<{ shape: MeasureChoice; label: string; icon: ToolIconName }> = [
  { shape: 'line', label: 'Line', icon: 'ruler' },
  { shape: 'circle', label: 'Circle/Sphere', icon: 'circle' },
  { shape: 'cone', label: 'Cone', icon: 'triangle' },
];

export interface ToolbarState {
  tool: PlayerTool;
  shape: MeasureChoice;
  diceOpen: boolean;
  measureMenuOpen: boolean;
}

/** The Measure button shows the shape in use, as Atlas's does. */
export function measureIcon(shape: MeasureChoice): ToolIconName {
  return MEASURE_SHAPE_OPTIONS.find((option) => option.shape === shape)?.icon ?? 'ruler';
}

export function isControlActive(id: ToolbarControlId, state: ToolbarState): boolean {
  return id === 'dice' ? state.diceOpen : state.tool === id;
}

/** The tool in use, and a control whose menu or tray hangs from it, stay in the bar. */
export function isControlPinned(id: ToolbarControlId, state: ToolbarState): boolean {
  return isControlActive(id, state) || (id === 'measure' && state.measureMenuOpen);
}

/** The controls that go into More tools; `widths` holds each control's last measured width. */
export function hiddenControls(
  widths: ReadonlyMap<ToolbarControlId, number>,
  state: ToolbarState,
  layout: ToolbarFitLayout,
): ReadonlySet<string> {
  return overflowingToolbarItems(TOOLBAR_CONTROLS.map((control) => ({
    id: control.id, width: widths.get(control.id), priority: control.priority, pinned: isControlPinned(control.id, state),
  })), layout);
}
```

Create `src/app/online/page/diceTray.ts`:

```ts
/**
 * The join page's dice tray, like Atlas's. A click adds a die, and a right-click or a long-press
 * removes one. There is a modifier, and Roll. It takes at most 20 dice and a whole-number
 * modifier within ±1000, as the GM accepts. Shared with the web page; the DOM is
 * `online-client/diceTrayView.mts`.
 */
import { DICE_TYPES, diceTerms, type DiceSelection, type DieType } from '../../tools/diceRolling';
import { DICE_LIMITS } from '../tools/toolMessages';

export const LONG_PRESS_MS = 500;
export const EMPTY_TRAY_TEXT = 'Select dice to roll';
export const ROLL_LABEL = 'Roll';
export const CLEAR_SELECTION_LABEL = 'Clear selection';
export const MODIFIER_LABEL = 'Modifier';

/** Atlas's hint for a die of its tray. */
export function dieHint(die: DieType): string {
  return `${die.toUpperCase()} • Left: add • Right: remove`;
}

export class DiceTray {
  private picked: DiceSelection = {};
  private bonus = 0;

  /** The picked dice, in the order they were first picked. */
  get selection(): DiceSelection {
    return { ...this.picked };
  }

  get modifier(): number {
    return this.bonus;
  }

  count(die: DieType): number {
    return this.picked[die] ?? 0;
  }

  total(): number {
    return DICE_TYPES.reduce((sum, die) => sum + this.count(die), 0);
  }

  isFull(): boolean {
    return this.total() >= DICE_LIMITS.dicePerRoll;
  }

  /** False when the tray is full. */
  add(die: DieType): boolean {
    if (this.isFull()) return false;
    this.picked = { ...this.picked, [die]: this.count(die) + 1 };
    return true;
  }

  /** False when no such die is picked. */
  remove(die: DieType): boolean {
    const count = this.count(die);
    if (count === 0) return false;
    const next = { ...this.picked };
    if (count > 1) next[die] = count - 1;
    else delete next[die];
    this.picked = next;
    return true;
  }

  /** The modifier as typed: a whole number, clamped to ±1000; anything else is 0. */
  setModifier(text: string): number {
    const value = Number.parseInt(text, 10);
    this.bonus = Number.isFinite(value) ? Math.max(-DICE_LIMITS.modifier, Math.min(DICE_LIMITS.modifier, value)) : 0;
    return this.bonus;
  }

  canRoll(): boolean {
    return this.total() > 0;
  }

  /** What the tray shows, like Atlas's: "2d6 + d20 + 3". */
  text(): string {
    const terms = diceTerms(this.picked);
    if (terms.length === 0) return EMPTY_TRAY_TEXT;
    const dice = terms.join(' + ');
    return this.bonus === 0 ? dice : `${dice} ${this.bonus > 0 ? '+' : '-'} ${Math.abs(this.bonus)}`;
  }

  clear(): void {
    this.picked = {};
    this.bonus = 0;
  }
}
```

Create `src/app/online/page/diceLogModel.ts`:

```ts
/**
 * The join page's dice log: everyone's rolls, newest first, at most 50. A replay (sent on every
 * admission) replaces the log and toasts nothing. A new roll is added once, by id, and shows as a
 * toast for 7 s while the log is closed. Shared with the web page; the DOM is
 * `online-client/diceLogView.mts`.
 */
import { DICE_LIMITS, type DiceLogEntry } from '../tools/toolMessages';

/** How long a roll's toast shows: Atlas's toast time. */
export const DICE_TOAST_MS = 7000;

export interface PlayerDiceLogOptions {
  onChange(): void;
}

export class PlayerDiceLog {
  private list: readonly DiceLogEntry[] = [];
  private latest: DiceLogEntry | null = null;
  private toastTimer: number | null = null;
  private open = false;

  constructor(private readonly options: PlayerDiceLogOptions) {}

  /** A new array on every change. */
  get entries(): readonly DiceLogEntry[] {
    return this.list;
  }

  /** The roll the toast shows; null while none does. */
  get toast(): DiceLogEntry | null {
    return this.latest;
  }

  get isOpen(): boolean {
    return this.open;
  }

  receive(entries: readonly DiceLogEntry[], replay: boolean): void {
    if (replay) {
      this.list = entries.slice(0, DICE_LIMITS.logEntries);
      this.options.onChange();
      return;
    }
    const known = new Set(this.list.map((entry) => entry.id));
    const fresh = entries.filter((entry) => !known.has(entry.id));
    const newest = fresh[0];
    if (!newest) return;
    this.list = [...fresh, ...this.list].slice(0, DICE_LIMITS.logEntries);
    if (!this.open) this.showToast(newest);
    this.options.onChange();
  }

  setOpen(open: boolean): void {
    this.open = open;
    if (open) this.hideToast();
    this.options.onChange();
  }

  dispose(): void {
    this.hideToast();
  }

  private showToast(entry: DiceLogEntry): void {
    this.hideToast();
    this.latest = entry;
    this.toastTimer = window.setTimeout(() => {
      this.toastTimer = null;
      this.latest = null;
      this.options.onChange();
    }, DICE_TOAST_MS);
  }

  private hideToast(): void {
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = null;
    this.latest = null;
  }
}

/** A die at its highest face is 'max' and at 1 'min', as Atlas's log marks them. */
export function dieExtreme(die: { die: string; value: number }): 'max' | 'min' | null {
  if (die.value === Number(die.die.slice(1))) return 'max';
  return die.value === 1 ? 'min' : null;
}
```

- [ ] **Step 9: Run them to verify they pass**

Run: `npx vitest run tests/unit/online/toolIcons.test.tsx tests/unit/online/playerToolbar.test.ts tests/unit/online/diceTray.test.ts tests/unit/online/diceLogModel.test.ts`
Expected: PASS.

- [ ] **Step 10: Write the failing tests for the page's DOM**

Create `tests/unit/online/pageToolbar.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PageToolbar } from '../../../online-client/toolbar.mts';
import { toolIconUrl } from '../../../src/app/online/page/toolIcons';

function setup(available = 1000) {
  document.body.innerHTML = '<section><nav id="toolbar"></nav></section>';
  const root = document.getElementById('toolbar')!;
  const calls: string[] = [];
  const toolbar = new PageToolbar({
    root,
    onTool: (tool) => calls.push(`tool ${tool}`),
    onShape: (shape) => calls.push(`shape ${shape}`),
    onDice: () => calls.push('dice'),
    measure: (element) => (element.dataset.control === 'measure' ? 56 : 36),
    layout: () => ({ available, chrome: 19, gap: 8, overflowButtonWidth: 36 }),
  });
  const button = (label: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  const entries = (selector: string): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>(`${selector} .menu-entry`)];
  return { root, toolbar, calls, button, entries };
}

describe('the join page toolbar', () => {
  it('shows Move, Measure, Laser and Dice with tooltips and icons, Move pressed, and no native tooltip', () => {
    const { root, button } = setup();
    for (const label of ['Move', 'Measure', 'Laser', 'Dice']) expect(button(label).dataset.label).toBe(label);
    expect(button('Move').getAttribute('aria-pressed')).toBe('true');
    expect(button('Laser').getAttribute('aria-pressed')).toBe('false');
    expect(button('Move').querySelector<HTMLElement>('.tool-icon')?.style.getPropertyValue('--icon')).toBe(toolIconUrl('hand'));
    expect(root.querySelector('[title]')).toBeNull();
  });

  it('hands clicks to the page and shows the state the page gives it', () => {
    const { toolbar, calls, button } = setup();
    button('Laser').click();
    button('Dice').click();
    expect(calls).toEqual(['tool laser', 'dice']);
    toolbar.update({ tool: 'laser', diceOpen: true });
    expect(button('Laser').getAttribute('aria-pressed')).toBe('true');
    expect(button('Move').getAttribute('aria-pressed')).toBe('false');
    expect(button('Dice').classList.contains('is-active')).toBe(true);
  });

  it('offers the measure shapes in a flyout and shows the shape in use', () => {
    const { toolbar, calls, button, entries } = setup();
    button('Measure options').click();
    expect(button('Measure options').getAttribute('aria-expanded')).toBe('true');
    const shapes = entries('[data-control="measure"]');
    expect(shapes.map((entry) => entry.textContent)).toEqual(['Line', 'Circle/Sphere', 'Cone']);
    shapes[2]!.click();
    expect(calls).toEqual(['shape cone']);
    expect(button('Measure options').getAttribute('aria-expanded')).toBe('false');
    toolbar.update({ tool: 'measure', shape: 'cone' });
    expect(button('Measure').querySelector<HTMLElement>('.tool-icon')?.style.getPropertyValue('--icon')).toBe(toolIconUrl('triangle'));
  });

  it('moves what does not fit into More tools, and keeps the tool in use in the bar', () => {
    const { root, toolbar, calls, button, entries } = setup(170);
    toolbar.fit();
    const shown = (control: string): boolean => !root.querySelector<HTMLElement>(`[data-control="${control}"]`)!.hidden;
    expect(['move', 'measure', 'laser', 'dice'].map(shown)).toEqual([true, true, false, false]);
    expect(button('More tools').closest<HTMLElement>('.toolbar-more')!.hidden).toBe(false);
    const more = entries('.toolbar-more').filter((entry) => !entry.hidden);
    expect(more.map((entry) => entry.textContent)).toEqual(['Laser', 'Dice']);
    button('More tools').click();
    more[1]!.click();
    expect(calls).toEqual(['dice']);
    toolbar.update({ tool: 'laser' });
    expect(shown('laser')).toBe(true);
  });

  it('closes an open menu on Escape before the rest of the page hears it', () => {
    const { root, button } = setup();
    const heard: string[] = [];
    document.addEventListener('keydown', () => heard.push('page'));
    button('Measure options').click();
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(button('Measure options').getAttribute('aria-expanded')).toBe('false');
    expect(heard).toEqual([]);
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(heard).toEqual(['page']);
  });
});
```

Create `tests/unit/online/diceTrayView.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiceTrayView } from '../../../online-client/diceTrayView.mts';
import { LONG_PRESS_MS } from '../../../src/app/online/page/diceTray';
import type { DiceSelection } from '../../../src/app/tools/diceRolling';

function setup(sends = true) {
  document.body.innerHTML = '<div id="dice-tray" hidden></div>';
  const root = document.getElementById('dice-tray')!;
  const rolls: Array<{ dice: DiceSelection; modifier: number }> = [];
  let closed = 0;
  const view = new DiceTrayView({
    root,
    roll: (dice, modifier) => {
      rolls.push({ dice, modifier });
      return sends;
    },
    onClose: () => { closed++; },
  });
  view.setOpen(true);
  const die = (name: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`[data-die="${name}"]`)!;
  const text = (): string => root.querySelector('.dice-formula')!.textContent ?? '';
  return { root, view, rolls, closed: () => closed, die, text };
}
function fire(target: EventTarget, type: string, pointerType = 'touch'): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: type === 'contextmenu' ? 2 : 0 });
  Object.defineProperties(event, { pointerType: { value: pointerType }, pointerId: { value: 1 } });
  target.dispatchEvent(event);
  return event;
}

describe('the join page dice tray', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("adds a die on a click and removes one on a right-click, showing Atlas's formula", () => {
    const t = setup();
    t.die('d6').click();
    t.die('d6').click();
    t.die('d20').click();
    expect(fire(t.die('d6'), 'contextmenu', 'mouse').defaultPrevented).toBe(true);
    expect(t.text()).toBe('d6 + d20');
    expect(t.die('d6').querySelector('.dice-badge')?.textContent).toBe('1');
    expect(t.die('d4').querySelector<HTMLElement>('.dice-badge')?.hidden).toBe(true);
  });

  it("removes one die per long-press, even with the browser's contextmenu", () => {
    const t = setup();
    for (let i = 0; i < 4; i++) t.die('d8').click();
    // The hold removes one; the contextmenu and click the browser may add are ignored.
    fire(t.die('d8'), 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fire(t.die('d8'), 'contextmenu');
    fire(t.die('d8'), 'pointerup');
    t.die('d8').click();
    expect(t.view.tray.count('d8')).toBe(3);
    vi.advanceTimersByTime(1000);
    // The browser's contextmenu comes first: it removes one, and the hold adds nothing.
    fire(t.die('d8'), 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS - 100);
    fire(t.die('d8'), 'contextmenu');
    vi.advanceTimersByTime(200);
    fire(t.die('d8'), 'pointerup');
    expect(t.view.tray.count('d8')).toBe(2);
  });

  it('rolls the dice with the modifier, then empties and asks to close; Roll needs dice', () => {
    const t = setup();
    const roll = t.root.querySelector<HTMLButtonElement>('.dice-roll')!;
    expect(roll.disabled).toBe(true);
    t.die('d20').click();
    const modifier = t.root.querySelector<HTMLInputElement>('[aria-label="Modifier"]')!;
    modifier.value = '3';
    modifier.dispatchEvent(new Event('input'));
    expect(t.text()).toBe('d20 + 3');
    roll.click();
    expect(t.rolls).toEqual([{ dice: { d20: 1 }, modifier: 3 }]);
    expect(t.view.tray.total()).toBe(0);
    expect(modifier.value).toBe('');
    expect(t.closed()).toBe(1);
  });

  it('keeps the dice when the roll could not be sent', () => {
    const t = setup(false);
    t.die('d20').click();
    t.root.querySelector<HTMLButtonElement>('.dice-roll')!.click();
    expect(t.view.tray.total()).toBe(1);
    expect(t.closed()).toBe(0);
  });

  it('takes no more dice at 20', () => {
    const t = setup();
    for (let i = 0; i < 25; i++) t.die('d6').click();
    expect(t.view.tray.total()).toBe(20);
    expect(t.die('d4').getAttribute('aria-disabled')).toBe('true');
  });
});
```

Create `tests/unit/online/diceLogView.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiceLogView } from '../../../online-client/diceLogView.mts';
import type { DiceLogEntry } from '../../../src/app/online/tools/toolMessages';

function setup() {
  document.body.innerHTML = [
    '<button id="dice-log-button" aria-expanded="false"></button>',
    '<aside id="dice-log" hidden><button id="dice-log-close"></button>',
    '<p id="dice-log-empty">No rolls yet</p><ol id="dice-log-list"></ol></aside>',
    '<button id="dice-toast" hidden></button>',
  ].join('');
  const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const view = new DiceLogView({
    panel: element('dice-log'), list: element('dice-log-list'), empty: element('dice-log-empty'),
    closeButton: element('dice-log-close'), toggleButton: element('dice-log-button'), toast: element('dice-toast'),
  });
  return { view, element };
}
const entry = (id: string, name = 'Anna'): DiceLogEntry => ({
  id, name, formula: '2d6+1', dice: [{ die: 'd6', value: 6 }, { die: 'd6', value: 1 }], modifier: 1, total: 8, at: 0,
});

describe('the join page dice log', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('lists rolls newest first as text, never as markup', () => {
    const { view, element } = setup();
    expect(element('dice-log-empty').hidden).toBe(false);
    view.receive([entry('b', '<img src=x onerror=alert(1)>'), entry('a')], true);
    const items = element('dice-log-list').querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0]?.querySelector('.dice-entry-name')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(element('dice-log-list').querySelector('img')).toBeNull();
    expect(items[1]?.querySelector('.dice-entry-total')?.textContent).toBe('8');
    expect([...items[1]!.querySelectorAll('.die-badge')].map((badge) => [badge.textContent, badge.className])).toEqual([
      ['d6: 6', 'die-badge is-max'], ['d6: 1', 'die-badge is-min'],
    ]);
    expect(element('dice-log-empty').hidden).toBe(true);
  });

  it('toasts a new roll while closed, and opens the log from the toast', () => {
    const { view, element } = setup();
    view.receive([], true);
    view.receive([entry('a')], false);
    expect(element('dice-toast').hidden).toBe(false);
    expect(element('dice-toast').textContent).toContain('Anna');
    element('dice-toast').click();
    expect(element('dice-log').hidden).toBe(false);
    expect(element('dice-toast').hidden).toBe(true);
    expect(element('dice-log-button').getAttribute('aria-expanded')).toBe('true');
  });

  it('opens from the Dice log button and closes with its close button or Escape', () => {
    const { element } = setup();
    element('dice-log-button').click();
    expect(element('dice-log').hidden).toBe(false);
    element('dice-log-close').click();
    expect(element('dice-log').hidden).toBe(true);
    element('dice-log-button').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(element('dice-log').hidden).toBe(true);
  });
});
```

In `tests/unit/online/mapView.test.ts`, add `sendLaser: () => true,` to the `MapView` options in `setup`, and add inside `describe('MapView', …)`:

```ts
  it('adds a waypoint on Space during a drag, and presses no focused button', () => {
    const t = setup();
    withToken(t);
    let pressed = 0;
    t.menu.addEventListener('click', () => { pressed++; });
    t.menu.focus();
    pointer(t.canvas, 'pointerdown', 116, 87);
    expect(document.activeElement).not.toBe(t.menu);
    pointer(t.canvas, 'pointermove', 216, 87);
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    document.body.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
    pointer(t.canvas, 'pointermove', 216, 187);
    t.frames.run();
    // (105, 105) → (245, 105) → (245, 245): four cells of 5 ft.
    expect(t.surface.ops('text').map((call) => call.text)).toContain('20ft');
    expect(pressed).toBe(0);
  });

  it('measures with the Measure tool without breaking away, and Escape returns to Move', () => {
    const t = setup();
    t.view.setScene(playerScene());
    t.view.selectTool('measure');
    expect(t.canvas.dataset.tool).toBe('measure');
    pointer(t.canvas, 'pointerdown', 116, 87);
    pointer(t.canvas, 'pointermove', 216, 87);
    t.frames.run();
    expect(t.surface.ops('text').map((call) => call.text)).toContain('10ft');
    expect(t.buttons.hidden).toBe(true);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(t.view.toolState().tool).toBe('move');
    expect(t.canvas.dataset.tool).toBe('move');
  });
```

In `tests/unit/online/tokenMovesPage.test.ts`, add `sendLaser: () => false,` to the `MapView` options.

Create `tests/unit/online/playerToolsPage.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapView } from '../../../online-client/mapView.mts';
import { fakeFrames, RecordingSurface } from './recordingSurface';
import { toolsWorld } from './toolsFixtures';
import type { MovePlayer } from './tokenMoveFixtures';

function pointer(target: EventTarget, type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
  target.dispatchEvent(event);
}

/** What `main.mts` does for the tools: a `MapView` whose laser goes through a real `PlayerSession` to the GM. */
async function page() {
  document.body.innerHTML = [
    '<section><canvas id="map"></canvas>',
    '<div id="view-buttons" hidden><button id="follow-gm" type="button">Follow GM</button>',
    '<button id="fit-map" type="button">Fit map</button></div>',
    '<p id="move-notice" hidden></p></section>',
  ].join('');
  const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const canvas = element<HTMLCanvasElement>('map');
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const w = toolsWorld();
  let player: MovePlayer | null = null;
  const view = new MapView({
    canvas, surface: new RecordingSurface(), images: () => null, frames: fakeFrames(), isHidden: () => false,
    viewButtons: element('view-buttons'), followButton: element('follow-gm'), fitButton: element('fit-map'),
    sendMove: (tokenId, x, y) => player?.session.sendTokenMove(tokenId, x, y) ?? false,
    sendLaser: (points, lifted) => player?.session.sendLaser(points, lifted) ?? false,
    notice: element('move-notice'),
  });
  w.present();
  const seen: string[] = [];
  player = await w.join('A', {
    onChange: (state) => {
      view.setConnected(state.status === 'admitted');
      view.setPlayers(state.players.map((entry) => entry.playerId), state.playerId);
    },
    onScene: (scene) => view.setScene(scene),
    onLaser: (laser) => view.receiveLaser(laser),
  });
  const other = await w.join('B');
  w.gm.use({ onMessage: (_player, message) => { seen.push(message.type); } });
  return { w, view, canvas, seen, player, other };
}

describe('the player tools on the join page', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('never sends a measurement, and sends the laser to the other players until it is let go', async () => {
    const { w, view, canvas, seen, player, other } = await page();
    view.selectTool('measure');
    pointer(canvas, 'pointerdown', 300, 300);
    pointer(canvas, 'pointermove', 400, 300);
    pointer(canvas, 'pointerup', 400, 300);
    expect(seen).toEqual([]);
    view.selectTool('laser');
    pointer(canvas, 'pointerdown', 300, 300);
    pointer(canvas, 'pointermove', 400, 300);
    pointer(canvas, 'pointerup', 400, 300);
    await vi.advanceTimersByTimeAsync(100);
    expect(new Set(seen)).toEqual(new Set(['laser']));
    const relayed = w.lasersOf(other);
    expect(relayed.every((laser) => laser.from === player.playerId)).toBe(true);
    expect(relayed.at(-1)?.lifted).toBe(true);
    w.finish();
  });
});
```

- [ ] **Step 11: Run them to verify they fail**

Run: `npx vitest run tests/unit/online/pageToolbar.test.ts tests/unit/online/diceTrayView.test.ts tests/unit/online/diceLogView.test.ts tests/unit/online/mapView.test.ts tests/unit/online/playerToolsPage.test.ts`
Expected: FAIL. The `.mts` modules do not exist yet, and `MapView` has no tools.

- [ ] **Step 12: Create the toolbar, dice tray and dice log DOM**

Create `online-client/icons.mts`:

```ts
// online-client/icons.mts
/** Atlas's icons on the join page, drawn as CSS mask images (`.tool-icon` in `style.css`) in the text colour. */
export function iconElement(url: string): HTMLSpanElement {
  const icon = document.createElement('span');
  icon.className = 'tool-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.style.setProperty('--icon', url);
  return icon;
}

/** Shows `url` in the icon inside `owner`, a button or menu entry. */
export function setIcon(owner: HTMLElement, url: string): void {
  owner.querySelector<HTMLElement>('.tool-icon')?.style.setProperty('--icon', url);
}
```

Create `online-client/toolbar.mts`:

```ts
// online-client/toolbar.mts
/**
 * The join page's toolbar, like Atlas's main toolbar: Move, Measure with its shape flyout, Laser
 * and Dice, and More tools for what does not fit (`playerToolbar.ts` decides which). It shows
 * the state the page gives it and hands clicks back; the tools themselves live in the map view.
 */
import {
  hiddenControls, isControlActive, MEASURE_OPTIONS_LABEL, MEASURE_SHAPE_OPTIONS, measureIcon, MORE_TOOLS_LABEL,
  TOOLBAR_CONTROLS, type ToolbarControlId, type ToolbarState,
} from '../src/app/online/page/playerToolbar';
import { toolIconUrl, type ToolIconName } from '../src/app/online/page/toolIcons';
import type { MeasureChoice } from '../src/app/online/view/tools/MeasureTool';
import type { PlayerTool } from '../src/app/online/view/tools/PlayerTools';
import type { ToolbarFitLayout } from '../src/app/packages/components/toolbar/toolbarFit';
import { iconElement, setIcon } from './icons.mts';

export interface PageToolbarOptions {
  root: HTMLElement;
  onTool(tool: PlayerTool): void;
  onShape(shape: MeasureChoice): void;
  onDice(): void;
  /** Tests pass their own; the page measures rendered widths and reads the bar's style. */
  measure?: (element: HTMLElement) => number;
  layout?: () => ToolbarFitLayout;
}

/** The page's side gutter, on each side of the bar. */
const GUTTER = 16;

interface Control {
  item: HTMLElement;
  button: HTMLButtonElement;
  /** Its entry in More tools, shown while the control is in there. */
  entry: HTMLButtonElement;
}

function toolButton(label: string, icon: ToolIconName): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tool-button';
  button.setAttribute('aria-label', label);
  // The tooltip in style.css reads it; a `title` would show the browser's own instead.
  button.dataset.label = label;
  button.append(iconElement(toolIconUrl(icon)));
  return button;
}

function menu(): HTMLElement {
  const element = document.createElement('div');
  element.className = 'toolbar-menu';
  element.setAttribute('role', 'menu');
  element.hidden = true;
  return element;
}

function menuEntry(label: string, icon: ToolIconName, onSelect: () => void): HTMLButtonElement {
  const entry = document.createElement('button');
  entry.type = 'button';
  entry.className = 'menu-entry';
  entry.setAttribute('role', 'menuitem');
  const text = document.createElement('span');
  text.textContent = label;
  entry.append(iconElement(toolIconUrl(icon)), text);
  entry.addEventListener('click', onSelect);
  return entry;
}

export class PageToolbar {
  private state: ToolbarState = { tool: 'move', shape: 'line', diceOpen: false, measureMenuOpen: false };
  private readonly controls = new Map<ToolbarControlId, Control>();
  private readonly widths = new Map<ToolbarControlId, number>();
  private readonly chevron: HTMLButtonElement;
  private readonly flyout: HTMLElement;
  private readonly more: HTMLElement;
  private readonly moreButton: HTMLButtonElement;
  private readonly moreMenu: HTMLElement;
  private moreWidth = 0;
  private readonly listeners = new AbortController();
  private resizeObserver: ResizeObserver | null = null;

  constructor(private readonly options: PageToolbarOptions) {
    const { root } = options;
    root.replaceChildren();
    this.moreMenu = menu();
    for (const control of TOOLBAR_CONTROLS) {
      const item = document.createElement('div');
      item.className = 'toolbar-item';
      item.dataset.control = control.id;
      const button = toolButton(control.label, control.icon);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => this.activate(control.id));
      item.append(button);
      root.append(item);
      const entry = menuEntry(control.label, control.icon, () => {
        this.closeMenus();
        this.activate(control.id);
      });
      this.moreMenu.append(entry);
      this.controls.set(control.id, { item, button, entry });
    }
    // Measure is a split button, as in Atlas: the tool, and a chevron that opens the shapes.
    const measure = this.controls.get('measure')!.item;
    measure.classList.add('tool-group');
    this.chevron = document.createElement('button');
    this.chevron.type = 'button';
    this.chevron.className = 'tool-chevron';
    this.chevron.setAttribute('aria-label', MEASURE_OPTIONS_LABEL);
    this.chevron.setAttribute('aria-haspopup', 'menu');
    this.chevron.setAttribute('aria-expanded', 'false');
    this.chevron.append(iconElement(toolIconUrl('chevron-down')));
    this.chevron.addEventListener('click', () => this.setMenus(!this.state.measureMenuOpen, false));
    this.flyout = menu();
    for (const option of MEASURE_SHAPE_OPTIONS) {
      this.flyout.append(menuEntry(option.label, option.icon, () => {
        this.closeMenus();
        options.onShape(option.shape);
      }));
    }
    measure.append(this.chevron, this.flyout);
    // More tools comes last and shows only while something is in it.
    this.more = document.createElement('div');
    this.more.className = 'toolbar-item toolbar-more';
    this.more.hidden = true;
    this.moreButton = toolButton(MORE_TOOLS_LABEL, 'ellipsis');
    this.moreButton.setAttribute('aria-haspopup', 'menu');
    this.moreButton.setAttribute('aria-expanded', 'false');
    this.moreButton.addEventListener('click', () => this.setMenus(false, this.moreMenu.hidden));
    this.more.append(this.moreButton, this.moreMenu);
    root.append(this.more);
    this.bind();
    this.render();
  }

  /** The page's tool, shape or tray changed. */
  update(state: Partial<Pick<ToolbarState, 'tool' | 'shape' | 'diceOpen'>>): void {
    this.state = { ...this.state, ...state };
    this.render();
  }

  /** Moves controls into More tools until the rest fit; run once the bar is shown and on every resize. */
  fit(): void {
    for (const [id, control] of this.controls) if (!control.item.hidden) this.widths.set(id, this.measureOf(control.item));
    if (!this.more.hidden) this.moreWidth = this.measureOf(this.more);
    const hidden = hiddenControls(this.widths, this.state, this.layout());
    for (const [id, control] of this.controls) {
      control.item.hidden = hidden.has(id);
      control.entry.hidden = !hidden.has(id);
    }
    this.more.hidden = hidden.size === 0;
    if (this.more.hidden && !this.moreMenu.hidden) this.setMenus(this.state.measureMenuOpen, false);
  }

  closeMenus(): void {
    this.setMenus(false, false);
  }

  dispose(): void {
    this.listeners.abort();
    this.resizeObserver?.disconnect();
  }

  private activate(id: ToolbarControlId): void {
    if (id === 'dice') this.options.onDice();
    else this.options.onTool(id);
  }

  private setMenus(measureOpen: boolean, moreOpen: boolean): void {
    this.state = { ...this.state, measureMenuOpen: measureOpen };
    this.flyout.hidden = !measureOpen;
    this.chevron.setAttribute('aria-expanded', String(measureOpen));
    this.moreMenu.hidden = !moreOpen;
    this.moreButton.setAttribute('aria-expanded', String(moreOpen));
    // An open flyout keeps Measure in the bar.
    this.fit();
  }

  private render(): void {
    for (const [id, control] of this.controls) {
      const active = isControlActive(id, this.state);
      control.button.setAttribute('aria-pressed', String(active));
      control.button.classList.toggle('is-active', active);
      control.entry.classList.toggle('is-active', active);
    }
    const measure = this.controls.get('measure')!;
    const icon = toolIconUrl(measureIcon(this.state.shape));
    setIcon(measure.button, icon);
    setIcon(measure.entry, icon);
    this.fit();
  }

  private bind(): void {
    const { signal } = this.listeners;
    const { root } = this.options;
    // An open menu takes Escape first: closing it is all Escape does then.
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || (this.flyout.hidden && this.moreMenu.hidden)) return;
      event.stopImmediatePropagation();
      this.closeMenus();
    }, { capture: true, signal });
    document.addEventListener('pointerdown', (event) => {
      if (event.target instanceof Node && root.contains(event.target)) return;
      if (!this.flyout.hidden || !this.moreMenu.hidden) this.closeMenus();
    }, { signal });
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', () => this.fit(), { signal });
      return;
    }
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(root.parentElement ?? root);
  }

  private measureOf(element: HTMLElement): number {
    return this.options.measure?.(element) ?? element.getBoundingClientRect().width;
  }

  private layout(): ToolbarFitLayout {
    if (this.options.layout) return this.options.layout();
    const { root } = this.options;
    const style = getComputedStyle(root);
    const px = (value: string): number => Number.parseFloat(value) || 0;
    return {
      available: (root.parentElement?.clientWidth ?? window.innerWidth) - 2 * GUTTER,
      chrome: px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth),
      gap: px(style.columnGap),
      overflowButtonWidth: this.moreWidth || this.measureOf(this.moreButton),
    };
  }
}
```

Create `online-client/diceTrayView.mts`:

```ts
// online-client/diceTrayView.mts
/**
 * The dice tray on the join page, like Atlas's: its dice with their icons and counts, the
 * formula, a modifier, Clear selection and Roll. A click adds a die; a right-click or a
 * long-press removes one. The tray's rules live in `DiceTray` (`src/app/online/page/diceTray.ts`).
 */
import {
  CLEAR_SELECTION_LABEL, DiceTray, dieHint, LONG_PRESS_MS, MODIFIER_LABEL, ROLL_LABEL,
} from '../src/app/online/page/diceTray';
import { dieIconUrl, toolIconUrl } from '../src/app/online/page/toolIcons';
import { DICE_TYPES, type DiceSelection, type DieType } from '../src/app/tools/diceRolling';
import { iconElement } from './icons.mts';

export interface DiceTrayViewOptions {
  root: HTMLElement;
  /** Sends the roll to the GM; false when it could not go. */
  roll(dice: DiceSelection, modifier: number): boolean;
  /** The tray rolled and wants to close. */
  onClose(): void;
}

/** After a removal by long-press or right-click, the click or contextmenu the browser adds is ignored for this long. */
const AFTER_REMOVAL_MS = 800;

export class DiceTrayView {
  readonly tray = new DiceTray();
  private readonly dice = new Map<DieType, { button: HTMLButtonElement; badge: HTMLElement }>();
  private readonly formula: HTMLElement;
  private readonly modifier: HTMLInputElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly rollButton: HTMLButtonElement;
  private pressTimer: number | null = null;
  private ignoreUntil = 0;

  constructor(private readonly options: DiceTrayViewOptions) {
    const grid = document.createElement('div');
    grid.className = 'dice-grid';
    for (const die of DICE_TYPES) grid.append(this.cell(die));
    this.formula = document.createElement('span');
    this.formula.className = 'dice-formula';
    this.modifier = document.createElement('input');
    this.modifier.type = 'number';
    this.modifier.inputMode = 'numeric';
    this.modifier.step = '1';
    this.modifier.min = '-1000';
    this.modifier.max = '1000';
    this.modifier.placeholder = '+0';
    this.modifier.className = 'dice-modifier';
    this.modifier.setAttribute('aria-label', MODIFIER_LABEL);
    this.modifier.addEventListener('input', () => {
      this.tray.setModifier(this.modifier.value);
      this.render();
    });
    this.clearButton = document.createElement('button');
    this.clearButton.type = 'button';
    this.clearButton.className = 'tool-button dice-clear';
    this.clearButton.setAttribute('aria-label', CLEAR_SELECTION_LABEL);
    this.clearButton.dataset.label = CLEAR_SELECTION_LABEL;
    this.clearButton.append(iconElement(toolIconUrl('x')));
    this.clearButton.addEventListener('click', () => this.empty());
    this.rollButton = document.createElement('button');
    this.rollButton.type = 'button';
    this.rollButton.className = 'dice-roll';
    const rollText = document.createElement('span');
    rollText.textContent = ROLL_LABEL;
    this.rollButton.append(iconElement(toolIconUrl('dices')), rollText);
    this.rollButton.addEventListener('click', () => this.roll());
    const bar = document.createElement('div');
    bar.className = 'dice-formula-bar';
    bar.append(this.formula, this.modifier, this.clearButton, this.rollButton);
    options.root.replaceChildren(grid, bar);
    this.render();
  }

  get isOpen(): boolean {
    return !this.options.root.hidden;
  }

  /** Opens or closes the tray; like Atlas's, it opens empty. */
  setOpen(open: boolean): void {
    this.options.root.hidden = !open;
    if (!open) this.empty();
  }

  private cell(die: DieType): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dice-button';
    button.dataset.die = die;
    button.dataset.label = dieHint(die);
    button.setAttribute('aria-label', dieHint(die));
    const badge = document.createElement('span');
    badge.className = 'dice-badge';
    badge.hidden = true;
    button.append(iconElement(dieIconUrl(die)), badge);
    button.addEventListener('click', () => {
      if (Date.now() < this.ignoreUntil) return;
      this.tray.add(die);
      this.render();
    });
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (Date.now() < this.ignoreUntil) return;
      this.cancelPress();
      this.removeOne(die);
    });
    button.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      this.cancelPress();
      this.pressTimer = window.setTimeout(() => {
        this.pressTimer = null;
        this.removeOne(die);
      }, LONG_PRESS_MS);
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) button.addEventListener(type, () => this.cancelPress());
    const label = document.createElement('span');
    label.className = 'dice-label';
    label.textContent = die;
    const cell = document.createElement('div');
    cell.className = 'dice-cell';
    cell.append(button, label);
    this.dice.set(die, { button, badge });
    return cell;
  }

  private removeOne(die: DieType): void {
    this.ignoreUntil = Date.now() + AFTER_REMOVAL_MS;
    this.tray.remove(die);
    this.render();
  }

  private cancelPress(): void {
    if (this.pressTimer !== null) window.clearTimeout(this.pressTimer);
    this.pressTimer = null;
  }

  private roll(): void {
    if (!this.tray.canRoll() || !this.options.roll(this.tray.selection, this.tray.modifier)) return;
    this.empty();
    this.options.onClose();
  }

  private empty(): void {
    this.cancelPress();
    this.tray.clear();
    this.modifier.value = '';
    this.render();
  }

  private render(): void {
    const full = this.tray.isFull();
    for (const [die, { button, badge }] of this.dice) {
      const count = this.tray.count(die);
      button.classList.toggle('is-selected', count > 0);
      button.setAttribute('aria-disabled', String(full));
      badge.hidden = count === 0;
      badge.textContent = String(count);
    }
    this.formula.textContent = this.tray.text();
    this.clearButton.disabled = !this.tray.canRoll() && this.tray.modifier === 0;
    this.rollButton.disabled = !this.tray.canRoll();
  }
}
```

Create `online-client/diceLogView.mts`:

```ts
// online-client/diceLogView.mts
/**
 * The dice log on the join page: a side panel, and a bottom sheet on narrow screens. It opens
 * from the top bar's Dice log button or a tap on the toast, and closes with its close button or
 * Escape. It shows every roll's name, formula, dice and total, newest first, as text only. The
 * log's rules live in `PlayerDiceLog` (`src/app/online/page/diceLogModel.ts`).
 */
import { dieExtreme, PlayerDiceLog } from '../src/app/online/page/diceLogModel';
import { toolIconUrl } from '../src/app/online/page/toolIcons';
import type { DiceLogEntry } from '../src/app/online/tools/toolMessages';
import { iconElement } from './icons.mts';

export interface DiceLogViewOptions {
  panel: HTMLElement;
  list: HTMLElement;
  empty: HTMLElement;
  closeButton: HTMLButtonElement;
  toggleButton: HTMLButtonElement;
  toast: HTMLButtonElement;
}

function text(className: string, content: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = content;
  return element;
}

function entryElement(entry: DiceLogEntry, tag: 'li' | 'div'): HTMLElement {
  const item = document.createElement(tag);
  item.className = 'dice-entry';
  const summary = document.createElement('div');
  summary.className = 'dice-entry-summary';
  summary.append(text('dice-entry-formula', entry.formula), text('dice-entry-eq', '='), text('dice-entry-total', String(entry.total)));
  const dice = document.createElement('div');
  dice.className = 'dice-entry-dice';
  for (const die of entry.dice) {
    const badge = text('die-badge', `${die.die}: ${die.value}`);
    const extreme = dieExtreme(die);
    if (extreme) badge.classList.add(`is-${extreme}`);
    dice.append(badge);
  }
  item.append(text('dice-entry-name', entry.name), summary, dice);
  return item;
}

export class DiceLogView {
  readonly log: PlayerDiceLog;
  private shown: readonly DiceLogEntry[] | null = null;
  private readonly listeners = new AbortController();

  constructor(private readonly options: DiceLogViewOptions) {
    this.log = new PlayerDiceLog({ onChange: () => this.render() });
    const { signal } = this.listeners;
    options.toggleButton.replaceChildren(iconElement(toolIconUrl('dices')));
    options.toggleButton.addEventListener('click', () => this.setOpen(!this.log.isOpen), { signal });
    options.closeButton.addEventListener('click', () => this.close(), { signal });
    options.toast.addEventListener('click', () => this.setOpen(true), { signal });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.log.isOpen) this.close();
    }, { signal });
    this.render();
  }

  receive(entries: readonly DiceLogEntry[], replay: boolean): void {
    this.log.receive(entries, replay);
  }

  setOpen(open: boolean): void {
    this.options.panel.hidden = !open;
    this.options.toggleButton.setAttribute('aria-expanded', String(open));
    this.log.setOpen(open);
    if (open) this.options.closeButton.focus();
  }

  dispose(): void {
    this.listeners.abort();
    this.log.dispose();
  }

  private close(): void {
    this.setOpen(false);
    this.options.toggleButton.focus();
  }

  private render(): void {
    const { list, empty, toast } = this.options;
    const entries = this.log.entries;
    if (entries !== this.shown) {
      this.shown = entries;
      list.replaceChildren(...entries.map((entry) => entryElement(entry, 'li')));
    }
    empty.hidden = entries.length > 0;
    const latest = this.log.toast;
    toast.hidden = latest === null;
    toast.replaceChildren(...(latest ? [entryElement(latest, 'div')] : []));
  }
}
```

- [ ] **Step 13: Bind the tools in the map view**

Replace `online-client/mapView.mts` with:

```ts
// online-client/mapView.mts
/**
 * The map on the join page. It binds the canvas and its input, the Follow GM and Fit map
 * buttons, resizing and page visibility. It also binds the player's token moves (cursor, Escape,
 * the "Move not allowed." notice) and tools: Move, Measure, Laser, and the drag ruler's
 * waypoint key. The decisions live in the tested shared modules: `CameraController`,
 * `ViewInput`, `PlayerViewRenderer`, `TokenMoves` and `PlayerTools`. Only the canvas takes map
 * input, so a gesture that starts on the top bar, the menu, the toolbar or a button never moves
 * the map.
 */
import type { SceneCamera } from '../src/app/online/scene/sceneCamera';
import type { PlayerScene, ScenePoint } from '../src/app/online/scene/sceneTypes';
import type { PlayerLaser } from '../src/app/online/tools/toolMessages';
import type { ScreenPoint } from '../src/app/online/view/camera';
import { CameraController } from '../src/app/online/view/CameraController';
import type { ImageLookup } from '../src/app/online/view/layers/layerTypes';
import { createSceneLayers } from '../src/app/online/view/layers/sceneLayers';
import { pixelRatioFor, PlayerViewRenderer } from '../src/app/online/view/PlayerViewRenderer';
import { TokenMoves } from '../src/app/online/view/TokenMoves';
import type { MeasureChoice } from '../src/app/online/view/tools/MeasureTool';
import { PlayerTools, type PlayerTool } from '../src/app/online/view/tools/PlayerTools';
import { createToolsLayer } from '../src/app/online/view/tools/toolsLayer';
import { ViewInput, type PointerInput, type PointerKind } from '../src/app/online/view/ViewInput';
import type { ViewSurface } from '../src/app/online/view/ViewSurface';
import { WAYPOINT_KEY } from '../src/app/pixi/token-renderer/dragRulerPath';

export interface MapViewOptions {
  canvas: HTMLCanvasElement;
  surface: ViewSurface;
  images: ImageLookup;
  /** Holds Follow GM and Fit map, shown while the player has broken away. */
  viewButtons: HTMLElement;
  followButton: HTMLButtonElement;
  fitButton: HTMLButtonElement;
  /** Sends one drop of a controlled token; false when it could not be sent. */
  sendMove(tokenId: string, x: number, y: number): boolean;
  /** Sends new points of the player's laser; false when they could not be sent. */
  sendLaser(points: ScenePoint[], lifted: boolean): boolean;
  /** Shows "Move not allowed." after a refused move. */
  notice: HTMLElement;
  /** The tool or measure shape changed, also by Escape: the toolbar follows. */
  onToolsChange?(): void;
  /** Tests pass their own; the page uses the browser's animation frames, visibility and clock. */
  frames?: { request(draw: () => void): number; cancel(handle: number): void };
  isHidden?: () => boolean;
  now?: () => number;
}

function pointerKind(type: string): PointerKind {
  return type === 'touch' || type === 'pen' ? type : 'mouse';
}

export class MapView {
  private readonly camera: CameraController;
  private readonly renderer: PlayerViewRenderer;
  private readonly moves: TokenMoves;
  private readonly tools: PlayerTools;
  private readonly input: ViewInput;
  private hasScene = false;
  /** Where the mouse is over the canvas, for the grab cursor; null when it is elsewhere. */
  private hover: ScreenPoint | null = null;
  /** What the toolbar was last told. */
  private shownTool: { tool: PlayerTool; shape: MeasureChoice } = { tool: 'move', shape: 'line' };
  private readonly listeners = new AbortController();
  private resizeObserver: ResizeObserver | null = null;
  private watchedRatio: number | null = null;
  private unwatchRatio: (() => void) | null = null;

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
      // Read at draw time, once the tools exist.
      overlays: [createToolsLayer({ overlay: () => this.tools.overlay(), isAnimating: () => this.tools.isAnimating() })],
      requestFrame: (draw) => frames.request(draw),
      cancelFrame: (handle) => frames.cancel(handle),
      isHidden: options.isHidden ?? ((): boolean => document.hidden),
    });
    this.moves = new TokenMoves({
      toWorld: (point) => this.camera.toWorld(point),
      send: (tokenId, x, y) => options.sendMove(tokenId, x, y),
      onChange: () => this.movesChanged(),
    });
    this.tools = new PlayerTools({
      moves: this.moves,
      toWorld: (point) => this.camera.toWorld(point),
      zoom: () => this.camera.current().zoom,
      now: options.now ?? ((): number => performance.now()),
      sendLaser: (points, lifted) => options.sendLaser(points, lifted),
      onChange: () => this.toolsChanged(),
    });
    this.input = new ViewInput(this.camera, this.tools);
    options.canvas.dataset.tool = this.shownTool.tool;
    this.bind();
    this.measure();
  }

  /** The scene to show; null shows nothing and resets the camera. */
  setScene(scene: PlayerScene | null): void {
    this.hasScene = scene !== null;
    this.camera.setScene(scene);
    this.renderer.setScene(scene);
    this.moves.setScene(scene);
    this.tools.setScene(scene);
    this.updateButtons();
  }

  setGmCamera(camera: SceneCamera | null): void {
    this.camera.setGmCamera(camera);
  }

  /** The tokens this player controls, from the GM's latest list. */
  setControlled(tokenIds: readonly string[]): void {
    this.moves.setControlled(tokenIds);
  }

  /** Whether the player is admitted: only then can tokens be dragged and tools send. */
  setConnected(connected: boolean): void {
    this.moves.setConnected(connected);
    this.tools.setConnected(connected);
  }

  /** The GM refused a move of this token. */
  moveRefused(tokenId: string): void {
    this.moves.refused(tokenId);
  }

  /** Chooses a tool; the active one again returns to Move. */
  selectTool(tool: PlayerTool): void {
    this.tools.select(tool);
  }

  selectShape(shape: MeasureChoice): void {
    this.tools.selectShape(shape);
  }

  toolState(): { tool: PlayerTool; shape: MeasureChoice } {
    return { tool: this.tools.tool, shape: this.tools.shape };
  }

  /** The session's players in order and this player's id: whose laser has which colour. */
  setPlayers(order: readonly string[], self: string | null): void {
    this.tools.setPlayers(order, self);
  }

  receiveLaser(laser: PlayerLaser): void {
    this.tools.receiveLaser(laser);
  }

  /** Images arrived or went. */
  refresh(): void {
    this.renderer.invalidate();
  }

  /** The session is over: stops drawing and frees the fog image. The page does not use the view again. */
  dispose(): void {
    this.listeners.abort();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.unwatchPixelRatio();
    this.tools.dispose();
    this.moves.dispose();
    this.renderer.dispose();
  }

  /** Reads the canvas's size again, e.g. once the table is shown. */
  measure(): void {
    const { clientWidth: width, clientHeight: height } = this.options.canvas;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.camera.setScreen({ width, height });
    this.renderer.setSize({ width, height }, pixelRatioFor(window.devicePixelRatio, coarse));
    this.watchPixelRatio();
  }

  /** The ratio changes without a resize when the window moves to another screen or the page is zoomed. */
  private watchPixelRatio(): void {
    if (this.listeners.signal.aborted || typeof window.matchMedia !== 'function') return;
    // measure() runs on every resize: arm a listener only when the ratio changed, and drop the old one.
    if (this.watchedRatio === window.devicePixelRatio) return;
    this.unwatchPixelRatio();
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onChange = (): void => {
      // The listener fired once and is gone: measure() arms the next one.
      this.unwatchPixelRatio();
      this.measure();
    };
    query.addEventListener('change', onChange, { once: true });
    this.watchedRatio = window.devicePixelRatio;
    this.unwatchRatio = () => query.removeEventListener('change', onChange);
  }

  private unwatchPixelRatio(): void {
    this.unwatchRatio?.();
    this.unwatchRatio = null;
    this.watchedRatio = null;
  }

  private cameraChanged(): void {
    this.renderer.invalidate();
    this.updateButtons();
  }

  private movesChanged(): void {
    this.renderer.setOverlay(this.moves.overlay());
    const notice = this.moves.notice();
    this.options.notice.textContent = notice ?? '';
    this.options.notice.hidden = notice === null;
    this.updateCursor();
  }

  /** Draws again; the toolbar hears only of a new tool or shape, never of every move. */
  private toolsChanged(): void {
    this.renderer.invalidate();
    const { tool, shape } = this.tools;
    if (tool === this.shownTool.tool && shape === this.shownTool.shape) return;
    this.shownTool = { tool, shape };
    this.options.canvas.dataset.tool = tool;
    this.updateCursor();
    this.options.onToolsChange?.();
  }

  /** A grab hand over the player's tokens with Move; grabbing while one is held. */
  private updateCursor(): void {
    const { canvas } = this.options;
    const holding = this.moves.isDragging();
    canvas.classList.toggle('is-grabbing', holding);
    const canGrab = !holding && this.tools.tool === 'move' && this.hover !== null && this.moves.canGrab(this.hover);
    canvas.classList.toggle('can-grab', canGrab);
  }

  private updateButtons(): void {
    this.options.viewButtons.hidden = !this.hasScene || this.camera.isFollowing();
  }

  private bind(): void {
    const { canvas, followButton, fitButton } = this.options;
    const { signal } = this.listeners;
    const point = (event: MouseEvent): ScreenPoint => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const pointer = (event: PointerEvent): PointerInput => ({
      id: event.pointerId, ...point(event), kind: pointerKind(event.pointerType), button: event.button, time: event.timeStamp,
    });
    canvas.addEventListener('pointerdown', (event) => {
      // The map takes the keyboard from a toolbar button, so Space mid-drag cannot press it.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused !== document.body) focused.blur();
      try {
        // Moves keep coming to the canvas when the finger leaves it.
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // The pointer is already gone, or the environment has no pointer capture.
      }
      this.input.down(pointer(event));
    }, { signal });
    canvas.addEventListener('pointermove', (event) => {
      const input = pointer(event);
      this.input.move(input);
      if (input.kind !== 'mouse') return;
      this.hover = { x: input.x, y: input.y };
      this.updateCursor();
    }, { signal });
    canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.updateCursor();
    }, { signal });
    canvas.addEventListener('pointerup', (event) => this.input.up(pointer(event)), { signal });
    canvas.addEventListener('pointercancel', (event) => this.input.cancel(event.pointerId), { signal });
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.input.wheel(point(event), event.deltaY, event.deltaMode);
    }, { passive: false, signal });
    canvas.addEventListener('dblclick', (event) => {
      event.preventDefault();
      this.input.doubleClick(point(event));
    }, { signal });
    // Escape ends a drag or a measurement and returns to Move; the menu and panels close on Escape on their own.
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.tools.escape();
      // Atlas's waypoint key: it must not also scroll the page or press a focused button.
      if (event.key === WAYPOINT_KEY && this.tools.isDragging()) {
        event.preventDefault();
        if (!event.repeat) this.tools.addWaypoint();
      }
    }, { signal });
    followButton.addEventListener('click', () => this.camera.followGm(), { signal });
    fitButton.addEventListener('click', () => this.camera.fitMap(), { signal });
    document.addEventListener('visibilitychange', () => this.renderer.visibilityChanged(), { signal });
    if (typeof ResizeObserver === 'undefined') window.addEventListener('resize', () => this.measure(), { signal });
    else {
      this.resizeObserver = new ResizeObserver(() => this.measure());
      this.resizeObserver.observe(canvas);
    }
  }
}
```

- [ ] **Step 14: Run the page tests to verify they pass**

Run: `npx vitest run tests/unit/online/pageToolbar.test.ts tests/unit/online/diceTrayView.test.ts tests/unit/online/diceLogView.test.ts tests/unit/online/mapView.test.ts tests/unit/online/tokenMovesPage.test.ts tests/unit/online/playerToolsPage.test.ts`
Expected: PASS, including the existing map view and token move page tests (Escape still cancels a drag).

- [ ] **Step 15: Wire the page and lay it out**

In `online-client/index.html`, replace the `<section id="table" …>…</section>` element with:

```html
  <section id="table" class="table" hidden aria-label="Scene">
    <canvas id="map" role="img" aria-label="Map"></canvas>
    <header class="top-bar">
      <span id="session-name" class="session-name"></span>
      <span id="connection" class="connection" role="status"></span>
      <div id="image-progress" class="image-progress" hidden>
        <progress id="image-progress-bar" aria-label="Loading images"></progress>
        <span id="image-progress-text" role="status"></span>
      </div>
      <button id="dice-log-button" class="icon-button" type="button" aria-label="Dice log" aria-expanded="false" aria-controls="dice-log"></button>
      <button id="menu-button" class="icon-button" type="button" aria-label="Menu" aria-expanded="false" aria-controls="menu">☰</button>
    </header>
    <div id="view-buttons" class="view-buttons" hidden>
      <button id="follow-gm" type="button">Follow GM</button>
      <button id="fit-map" class="secondary" type="button">Fit map</button>
    </div>
    <p id="move-notice" class="move-notice" role="status" hidden></p>
    <button id="dice-toast" class="dice-toast" type="button" aria-live="polite" hidden></button>
    <div id="dice-tray" class="dice-tray" role="group" aria-label="Dice tray" hidden></div>
    <nav id="toolbar" class="toolbar" aria-label="Tools"></nav>
    <aside id="dice-log" class="dice-log" hidden aria-label="Dice log">
      <div class="dice-log-header">
        <h2>Dice log</h2>
        <button id="dice-log-close" class="icon-button" type="button" aria-label="Close dice log">×</button>
      </div>
      <p id="dice-log-empty" class="dice-log-empty">No rolls yet</p>
      <ol id="dice-log-list" class="dice-log-list" aria-label="Rolls"></ol>
    </aside>
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
```

Replace `online-client/main.mts` with:

```ts
// online-client/main.mts
/**
 * The join page: the name form, the session, image loading, the map and the player's tools.
 * The logic lives in tested shared modules under `src/app/online/` and the tested views beside
 * this file; this file finds the page's elements and connects them.
 */
import { AssetCache } from '../src/app/online/assets/AssetCache';
import { AssetLoader } from '../src/app/online/assets/AssetLoader';
import { openIndexedDbImageStore } from '../src/app/online/assets/indexedDbImageStore';
import { randomId } from '../src/app/online/ids';
import { parseJoinFragment } from '../src/app/online/joinLink';
import { createOnlineLog } from '../src/app/online/onlineLog';
import { INCOMPLETE_LINK_TEXT, NAME_PROBLEM_TEXT, NO_CANVAS_TEXT, pageScreen, type PageScreen } from '../src/app/online/page/pageScreen';
import type { PlayerSession, PlayerSessionState } from '../src/app/online/PlayerSession';
import { createJoinSession } from '../src/app/online/preview/joinSession';
import { initiativeLines, playerLines, widgetLines } from '../src/app/online/preview/sceneSummary';
import { normalizePlayerName } from '../src/app/online/protocol';
import type { PlayerScene } from '../src/app/online/scene/sceneTypes';
import { createPeerClient } from '../src/app/online/transport/PeerTransport';
import { AssetsPanel, rememberedKeep } from './assetsPanel.mts';
import { createCanvasSurface } from './canvasSurface.mts';
import { DiceLogView } from './diceLogView.mts';
import { DiceTrayView } from './diceTrayView.mts';
import { decodeImage } from './imageDecoder.mts';
import { MapView } from './mapView.mts';
import { Menu } from './menu.mts';
import { PageToolbar } from './toolbar.mts';

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
/** Set once the player joins; until then a drop, a laser or a roll has nowhere to go. */
let session: PlayerSession | null = null;
// The lookup runs at draw time, in a later animation frame, so `loader` below is already set;
// it asks the loader every time, so a released image is never drawn.
const map = surface
  ? new MapView({
    canvas, surface, images: (id) => loader.image(id),
    viewButtons: element('view-buttons'), followButton: element('follow-gm'), fitButton: element('fit-map'),
    sendMove: (tokenId, x, y) => session?.sendTokenMove(tokenId, x, y) ?? false,
    sendLaser: (points, lifted) => session?.sendLaser(points, lifted) ?? false,
    notice: element('move-notice'),
    onToolsChange: () => syncToolbar(),
  })
  : null;
const diceTray = new DiceTrayView({
  root: element('dice-tray'),
  roll: (dice, modifier) => session?.sendDiceRoll(dice, modifier) ?? false,
  onClose: () => setDiceOpen(false),
});
const diceLog = new DiceLogView({
  panel: element('dice-log'), list: element('dice-log-list'), empty: element('dice-log-empty'),
  closeButton: element('dice-log-close'), toggleButton: element('dice-log-button'), toast: element('dice-toast'),
});
const toolbar = new PageToolbar({
  root: element('toolbar'),
  onTool: (tool) => map?.selectTool(tool),
  onShape: (shape) => map?.selectShape(shape),
  onDice: () => setDiceOpen(!diceTray.isOpen),
});
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

/** Diagnostics: run `localStorage.setItem('atlas-online:log', 'on')` in this page's console; the switch is read on every event, so no reload is needed. */
const log = createOnlineLog(() => {
  try {
    return localStorage.getItem('atlas-online:log') === 'on';
  } catch {
    return false;
  }
});
let tableShown = false;
let shownScene: PlayerScene | null = null;

/** The dice tray hangs from the toolbar's Dice button. */
function setDiceOpen(open: boolean): void {
  diceTray.setOpen(open);
  syncToolbar();
}

/** The toolbar shows the map's tool and shape, and whether the tray is open. */
function syncToolbar(): void {
  toolbar.update({ ...(map?.toolState() ?? {}), diceOpen: diceTray.isOpen });
}

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
    // The canvas and the toolbar have their sizes only once the table is shown; after that they follow resizes.
    if (!tableShown) {
      map?.measure();
      toolbar.fit();
    }
  }
  tableShown = view.kind === 'table';
}

function render(state: PlayerSessionState): void {
  log.event('status', { status: state.status, reason: state.reason, players: state.players.length });
  sessionState = state;
  // Only an admitted player drags tokens and uses the tools: reconnecting or ended cancels a gesture.
  map?.setConnected(state.status === 'admitted');
  // The session's order of players decides whose laser has which colour.
  map?.setPlayers(state.players.map((player) => player.playerId), state.playerId);
  let ended = false;
  if (state.status === 'denied' || state.status === 'lost') {
    // The session is over for good: free the decoded images and hide the loading bar.
    loader.dispose();
    panel.showProgress(loader.progress());
    setDiceOpen(false);
    ended = true;
  }
  fillList(playerList, playerLines(state.players));
  renderScene();
  // The scene is cleared from the view first; then it stops drawing and frees the fog image.
  if (ended) map?.dispose();
}

/** The map, and the widget and initiative lists, shown only on the table screen. */
function renderScene(): void {
  const view = pageScreen(sessionState, scene !== null);
  show(view);
  const shown = view.kind === 'table' ? scene : null;
  // Presence updates arrive often; the view only hears of a scene that changed.
  if (shown !== shownScene) {
    shownScene = shown;
    map?.setScene(shown);
  }
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
    session = createJoinSession({
      loader,
      hostId: target.hostId,
      name,
      // One key per GM session, so different GMs cannot recognise or pose as the same player.
      playerKey: stored(`atlas-online:player-key:${target.hostId}`, () => randomId()),
      clientVersion: VERSION,
      transport: createPeerClient(target.server),
      onChange: render,
      onScene: (next) => {
        log.event('scene', { sceneId: next?.sceneId ?? null, tokens: next ? Object.keys(next.tokens).length : 0 });
        scene = next;
        renderScene();
      },
      onCamera: (camera) => {
        log.event('camera', { sceneId: camera.sceneId, centerX: camera.centerX, centerY: camera.centerY });
        map.setGmCamera(camera);
      },
      onControl: (tokenIds) => {
        log.event('control', { tokens: tokenIds.length });
        map.setControlled(tokenIds);
      },
      onMoveRefused: (tokenId) => {
        log.event('move refused', { tokenId });
        map.moveRefused(tokenId);
      },
      onDiceLog: (entries, replay) => {
        log.event('dice log', { entries: entries.length, replay });
        diceLog.receive(entries, replay);
      },
      // Not logged: lasers arrive up to twenty times a second per person.
      onLaser: (laser) => map.receiveLaser(laser),
    });
    session.start();
  });
}
```

Append to `online-client/style.css`:

```css
/* The toolbar, dice tray, dice log and toast: Atlas's floating surfaces. They copy styles/_mixins.scss
   (atlas-elevated-surface, atlas-panel-radius($radius-2xl)): controls sit $spacing-s inside a 1.5 px border, and their
   outer corners run concentric with the surface's (24 − 1.5 − 8 = 14.5 px). */
:root {
  --panel-radius: 24px; --panel-border: 1.5px; --inset: 8px;
  --inset-radius: calc(var(--panel-radius) - var(--panel-border) - var(--inset));
  --tool-size: 36px; --hover: rgba(127, 127, 127, 0.16); --shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
  --toolbar-height: calc(var(--tool-size) + 2 * var(--inset) + 2 * var(--panel-border));
}
/* Atlas's 36 px controls grow to the page's 44 px touch targets on phones. */
@media (pointer: coarse) { :root { --tool-size: 44px; } }

.tool-icon {
  display: block; width: 18px; height: 18px; background-color: currentColor;
  -webkit-mask: var(--icon) center / contain no-repeat; mask: var(--icon) center / contain no-repeat;
}
#map[data-tool="measure"], #map[data-tool="laser"], #map[data-tool="measure"]:active, #map[data-tool="laser"]:active { cursor: crosshair; }

.toolbar {
  grid-row: 2; grid-column: 1; align-self: end; justify-self: center; position: relative; z-index: 1;
  display: flex; align-items: center; gap: var(--inset); padding: var(--inset); max-width: calc(100% - 32px);
  margin-bottom: max(12px, env(safe-area-inset-bottom));
  background: var(--card); border: var(--panel-border) solid var(--border); border-radius: var(--panel-radius); box-shadow: var(--shadow);
}
.toolbar-item { position: relative; display: flex; align-items: center; }
.tool-button, .tool-chevron, .menu-entry {
  min-height: 0; padding: 0; border: 0; background: transparent; color: var(--text); font-weight: 500;
}
.tool-button {
  position: relative; width: var(--tool-size); height: var(--tool-size); display: grid; place-items: center; border-radius: 8px;
  transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
.tool-button:hover, .tool-chevron:hover, .tool-button[aria-expanded="true"] { background: var(--hover); }
.tool-button:active:not(:disabled) { transform: scale(0.96); }
.tool-button.is-active, .tool-button.is-active:hover { background: var(--accent); color: #fff; }
.tool-button:focus-visible, .tool-chevron:focus-visible, .menu-entry:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
@media (prefers-reduced-motion: reduce) { .tool-button:active:not(:disabled) { transform: none; } }
/* The first and last controls shown have their outer corners concentric with the bar's. */
.toolbar > :nth-child(1 of :not([hidden])) > .tool-button {
  border-top-left-radius: var(--inset-radius); border-bottom-left-radius: var(--inset-radius);
}
.toolbar > :nth-last-child(1 of :not([hidden])) > .tool-button,
.toolbar > :nth-last-child(1 of :not([hidden])) > .tool-chevron {
  border-top-right-radius: var(--inset-radius); border-bottom-right-radius: var(--inset-radius);
}
/* Measure is a split button, as Atlas's tool group. */
.tool-group { background: var(--hover); border-radius: 8px; }
.tool-group > .tool-button { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.tool-chevron { width: 20px; height: var(--tool-size); display: grid; place-items: center; border-radius: 0 8px 8px 0; }
.tool-chevron .tool-icon { width: 12px; height: 12px; }

/* Tooltips from data-label; the browser's own (title) never show. */
@media (hover: hover) {
  .tool-button[data-label]:hover::after, .tool-button[data-label]:focus-visible::after,
  .dice-button[data-label]:hover::after, .dice-button[data-label]:focus-visible::after {
    content: attr(data-label); position: absolute; bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%); z-index: 3;
    padding: 8px; border-radius: 8px; background: var(--card); color: var(--text); border: var(--panel-border) solid var(--border);
    box-shadow: var(--shadow); font-size: 13px; font-weight: 500; line-height: 1; white-space: nowrap; pointer-events: none;
  }
}

/* Menus hang above their button, flush with its right edge; their rows are capsules 4 px inside the border. */
.toolbar-menu {
  position: absolute; bottom: calc(100% + 12px); right: 0; z-index: 3; min-width: 180px;
  display: grid; gap: 4px; padding: 4px; background: var(--card); border: var(--panel-border) solid var(--border);
  border-radius: calc(18px + 4px + var(--panel-border)); box-shadow: var(--shadow);
}
.menu-entry {
  display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px; border-radius: 18px; font-size: 14px; text-align: left;
}
.menu-entry:hover { background: var(--hover); }
.menu-entry.is-active { color: var(--accent); }

/* The dice tray floats above the toolbar, like Atlas's above its Dice button. */
.dice-tray {
  grid-row: 2; grid-column: 1; align-self: end; justify-self: center; z-index: 2;
  margin-bottom: calc(max(12px, env(safe-area-inset-bottom)) + var(--toolbar-height) + var(--inset));
  display: grid; gap: var(--inset); padding: var(--inset); max-width: calc(100% - 32px);
  background: var(--card); border: var(--panel-border) solid var(--border); border-radius: var(--panel-radius); box-shadow: var(--shadow);
}
.dice-grid { display: grid; grid-template-columns: repeat(7, 40px); gap: var(--inset); justify-content: center; }
@media (max-width: 420px) { .dice-grid { grid-template-columns: repeat(4, 40px); } }
.dice-cell { display: grid; justify-items: center; gap: 4px; }
.dice-button {
  position: relative; width: 40px; height: 40px; min-height: 0; padding: 0; display: grid; place-items: center;
  background: var(--hover); color: var(--muted); border: var(--panel-border) solid var(--border); border-radius: 8px;
}
.dice-button .tool-icon { width: 18px; height: 18px; }
.dice-button.is-selected { background: var(--accent); border-color: var(--accent); color: #fff; }
.dice-button[aria-disabled="true"]:not(.is-selected) { opacity: 0.5; }
.dice-grid > .dice-cell:first-child > .dice-button { border-top-left-radius: var(--inset-radius); }
.dice-grid > .dice-cell:last-child > .dice-button { border-top-right-radius: var(--inset-radius); }
.dice-badge {
  position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px;
  background: var(--text); color: var(--card); font-size: 11px; font-weight: 700; line-height: 18px; text-align: center;
}
.dice-label { color: var(--muted); font-size: 11px; }
.dice-formula-bar { display: flex; align-items: center; gap: var(--inset); }
.dice-formula { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 14px; }
.dice-modifier { width: 72px; min-height: var(--tool-size); padding: 4px 8px; }
.dice-roll { display: flex; align-items: center; gap: var(--inset); min-height: var(--tool-size); padding: 0 16px; border-bottom-right-radius: var(--inset-radius); }

/* The dice log: a side panel on the left, a bottom sheet on narrow screens, like the menu. */
.dice-log {
  position: absolute; top: 0; left: 0; bottom: 0; z-index: 2; width: min(360px, 100%); overflow-y: auto; touch-action: pan-y;
  display: grid; align-content: start; gap: var(--inset);
  padding: max(var(--inset), env(safe-area-inset-top)) var(--inset) max(var(--inset), env(safe-area-inset-bottom)) max(var(--inset), env(safe-area-inset-left));
  background: var(--card); border-right: 1px solid var(--border);
}
.dice-log-header { display: flex; align-items: center; gap: 12px; }
.dice-log-header h2 { flex: 1; color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; }
.dice-log-list { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--inset); }
.dice-log-empty { margin: 0; padding: 24px; color: var(--muted); text-align: center; }
.dice-entry { display: grid; gap: 4px; padding: 12px; border: 1px solid var(--border); border-radius: 12px; }
.dice-entry-name { font-size: 13px; font-weight: 600; }
.dice-entry-summary { display: flex; align-items: baseline; gap: var(--inset); }
.dice-entry-formula, .dice-entry-eq { color: var(--muted); font-size: 13px; }
.dice-entry-total { font-size: 22px; font-weight: 700; }
.dice-entry-dice { display: flex; flex-wrap: wrap; gap: 4px; }
.die-badge { padding: 2px 6px; border-radius: 6px; background: var(--hover); font-size: 12px; font-variant-numeric: tabular-nums; }
.die-badge.is-max { color: #2f9e44; }
.die-badge.is-min { color: #e03131; }

/* A new roll, at the top while the log is closed; a tap opens the log. */
.dice-toast {
  grid-row: 2; grid-column: 1; align-self: start; justify-self: center; z-index: 1; margin: 12px 0 0;
  min-height: 0; min-width: 200px; max-width: calc(100% - 32px); padding: var(--inset); text-align: left;
  background: var(--card); color: var(--text); font-weight: 400; border: var(--panel-border) solid var(--border);
  border-radius: 16px; box-shadow: var(--shadow);
}
.dice-toast .dice-entry { padding: 4px; border: 0; }

/* The Dice log button sits beside Menu. */
.icon-button + .icon-button { margin-left: 0; }
.icon-button .tool-icon { width: 20px; height: 20px; }

@media (max-width: 720px) {
  .dice-log {
    top: auto; right: 0; width: auto; max-height: 70%; border-right: 0; border-top: 1px solid var(--border); border-radius: 16px 16px 0 0;
    padding-right: max(var(--inset), env(safe-area-inset-right));
  }
  /* Follow GM and Fit map move above the toolbar. */
  .view-buttons { bottom: calc(max(12px, env(safe-area-inset-bottom)) + var(--toolbar-height) + var(--inset)); }
}
```

- [ ] **Step 16: Type-check, lint, run the full suite and build the page**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run build:online`
Expected: no type errors (the root `tsconfig.json` includes `online-client/**/*.mts`), no lint warnings, all tests pass, and the page builds into `dist-online/`.

Then check that `main.mts` wired everything. Vite minifies names but keeps string literals, so search the built page for the message types, element ids and copy:

```bash
for text in "dice-roll" "dice-log" "laser" "dice-log-button" "dice-tray" "dice-toast" "toolbar" "More tools" \
  "Measure options" "Circle/Sphere" "Select dice to roll" "Close dice log" "No rolls yet"; do
  grep -rqF -- "$text" dist-online && echo "ok: $text" || echo "MISSING: $text"
done
```

Expected: `ok:` for every text. A `MISSING:` line means a module or element is not wired: fix `main.mts` or `index.html` before committing.

- [ ] **Step 17: Commit**

```bash
git add src/app/online/view/ViewInput.ts src/app/online/view/TokenMoves.ts src/app/online/view/layers/layerTypes.ts \
  src/app/online/view/PlayerViewRenderer.ts src/app/online/view/tools/ src/app/online/page/toolIcons.ts \
  src/app/online/page/playerToolbar.ts src/app/online/page/diceTray.ts src/app/online/page/diceLogModel.ts \
  online-client/icons.mts online-client/toolbar.mts online-client/diceTrayView.mts online-client/diceLogView.mts \
  online-client/mapView.mts online-client/main.mts online-client/index.html online-client/style.css \
  tests/unit/online/playerTools.test.ts tests/unit/online/dragRulerTool.test.ts tests/unit/online/toolsLayer.test.ts \
  tests/unit/online/playerViewRenderer.test.ts tests/unit/online/toolIcons.test.tsx tests/unit/online/playerToolbar.test.ts \
  tests/unit/online/diceTray.test.ts tests/unit/online/diceLogModel.test.ts tests/unit/online/pageToolbar.test.ts \
  tests/unit/online/diceTrayView.test.ts tests/unit/online/diceLogView.test.ts tests/unit/online/mapView.test.ts \
  tests/unit/online/tokenMovesPage.test.ts tests/unit/online/playerToolsPage.test.ts
git commit -m "feat(online): player tools on the join page"
```

`dist-online/` is a build output: do not commit it.

---
### Task 4: Documentation, full checks and the manual test

The guide for adding features to online play gains a "Player tools" section, and its list of shared modules is brought up to date. The README, the privacy notes and the changelog describe the tools. Every check runs, and the user tests the tools on desktop and on a phone.

Steps 5 and 6 need the user: only Obsidian with the plugin loaded and a real browser on a phone run them. The implementer asks the controller to have the user run them and report.

**Files:**
- Modify: `docs/online-play-features.md` (section 5's list, a new section 9)
- Modify: `README.md` (the "Online play (preview)" section), `PRIVACY.md` (the "Online play" section), `changelog/Unreleased.md`

**Interfaces:**
- Consumes: everything Tasks 1–3 produce.
- Produces: no code.

- [ ] **Step 1: Update the guide**

In `docs/online-play-features.md`, replace the bullet list of section 5 ("Share the geometry") with:

```markdown
- `grid/hexGeometry.ts`, `grid/hexNumbering.ts` and `grid/gridDistance.ts` (path lengths, `cellCenterAt`)
- `grid/measurementFormat.ts` (distance labels)
- `pixi/token-renderer/tokenSizing.ts`, `tokenUiLayout.ts` (bars, nameplate), `conditionBadgeLayout.ts` and `dragRulerPath.ts`
- `pixi/textBoxLayout.ts`, `pixi/mapIcons.ts` and `pixi/measureGeometry.ts` (measure strokes, shapes and labels)
- `pixi/laser/laserBeamGeometry.ts`, `laserTrail.ts` and `remoteLasers.ts`
- `tools/diceRolling.ts` and `tools/laserPointerSettings.ts`
- `packages/components/toolbar/toolbarFit.ts`
```

Append this section at the end of the file:

````markdown
## 9. Player tools

The join page has Atlas's table tools: the drag ruler, the measure tool, the laser and the dice tray. Each one follows the same split as a map feature.

- **Shared geometry.** The maths both sides need lives in the shared modules of step 5, which Atlas's PIXI renderers use too. Change the shared module, never a copy on one side.
- **The gesture.** `PlayerTools` (`src/app/online/view/tools/`) takes the one-finger presses `ViewInput` hands it. Move drags the player's own tokens with the drag ruler. Measure and Laser take every one-finger press. Two fingers always pinch and pan the map, and end the gesture. A new tool needs:
  - a `PlayerTool` value and its gesture in `PlayerTools`;
  - what it draws in `toolsLayer.ts`, through `ViewSurface`, over the fog;
  - a control in `TOOLBAR_CONTROLS` (`src/app/online/page/playerToolbar.ts`) with a priority, a label and one of Atlas's icons in `toolIcons.ts` (the test checks each icon against Atlas's component).
  - The toolbar fit is Atlas's own `overflowingToolbarItems`, so the tool in use never moves into More tools.
- **What stays local.** Measurements and the drag ruler are never sent; `playerToolsPage.test.ts` checks that a measurement sends nothing. Keep a new tool local unless the spec says others see it.
- **What others see.** A tool others see sends a message from the player (step 8). The GM either applies it or relays it:
  - Relays, such as lasers (`LaserRelay`), go to every other admitted player with `from` set to the session's id for the sender. Never trust a `from` the player sent.
  - Relays drop a message for another scene than the one players have, and store nothing.
  - Senders batch with `LaserBatcher`, so a player's page stays under the GM's rate limit.
  - Receivers let a laser go after `LASER_STALE_MS`, and the GM lets a player's laser go when the player leaves.
- **Rolls.** Dice are rolled on the GM's side (`DiceHost`), never on the page, so a roll cannot be faked.
  - Every roll reaches Atlas's dice log, toasts and sounds through the `atlas-dice-rolled` event (`DiceFeed`). Anything that rolls in Atlas, the toolbar, statblocks or a future physical-dice integration, must dispatch it.
  - The relay names a roll with `rollerName` after `withoutHiddenToken`, so a roll for a token hidden from players is "GM".
- **Tests.**
  - The shared modules have their own tests (`tests/unit/playerToolsShared.test.ts`, `diceRolling.test.ts`, `remoteLasers.test.ts`), and Atlas's renderer tests must pass unchanged.
  - Gestures are tested on `PlayerTools` with `ViewInput`, drawings on `RecordingSurface`, and the page's DOM under jsdom (`pageToolbar.test.ts`, `diceTrayView.test.ts`, `diceLogView.test.ts`).
  - Messages are tested end to end over `MemoryTransport` with `tests/unit/online/toolsFixtures.ts`.
  - `online-client/main.mts` is neither linted nor tested. After `npm run build:online`, search `dist-online/` for the new message types, element ids and copy.
````

- [ ] **Step 2: Tell players and the GM**

Re-read `README.md` and `changelog/Unreleased.md` first: polish A added its lines to both. Add beside them; change none of theirs.

In `README.md`, add this paragraph after the paragraph on **Controlled by** in the "Online play (preview)" section:

```markdown
Players also have Atlas's table tools on the join page. They get a toolbar with **Move**, **Measure** (line, circle or cone, seen only by the player measuring), **Laser** and **Dice**. Dragging one of their tokens shows the drag ruler with your measurement units and diagonal rule; Space, or holding still for half a second on a phone, adds a waypoint. Everyone sees everyone's laser, yours included, each in its own colour. Players roll from a dice tray like Atlas's, and Atlas rolls their dice. Every roll, yours and theirs, shows in your dice log under the roller's name and in every player's **Dice log**.
```

In `PRIVACY.md`, add this paragraph to the "Online play" section, after the paragraph on token moves:

```markdown
While a session runs, players also receive every dice roll Atlas makes: the formula, each die and the total, and who rolled it. That is the player's name, or the statblock token's name unless that token is hidden on the presented scene, or "GM". While you point with the laser on the presented scene, players receive where it is. Players' measurements and drag rulers stay on their device. Their lasers and dice rolls go to you and to the other players in the session, and nothing of either is stored.
```

In `changelog/Unreleased.md`, add this bullet to the **Online Play (preview)** list, after the bullet on **Controlled by**:

```markdown
- Online players have Atlas's table tools on the join page: the drag ruler with your measurement settings, a measure tool only they see (line, circle/sphere, cone), a laser pointer everyone sees, yours included, and a dice tray. Atlas rolls their dice, and every roll, yours and theirs, shows in your dice log and every player's, with who rolled it.
```

Then add this section at the end of the file:

```markdown
## Fixed

- Rolling several kinds of dice at once, such as 2d6 + 3d8, no longer adds the second die's count to the total.
```

If the file already has a `## Fixed` section, add the bullet to it instead.

`changelog/Unreleased.md` uses CRLF line endings. Keep them: write the new lines with CRLF, then check with `file changelog/Unreleased.md`. Expected: "with CRLF line terminators" and no "LF" mixed in. `git diff changelog/Unreleased.md` must show only the added lines.

- [ ] **Step 3: Run every check**

Run:

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
npm run build:online
```

Expected: no type errors, no lint warnings, all tests pass, and both builds succeed.

Check the file sizes the constraints name:

```bash
wc -l src/app/online/scene/SceneBroadcaster.ts src/app/online/GmSession.ts src/app/online/PlayerSession.ts \
  online-client/mapView.mts online-client/main.mts src/app/online/view/tools/*.ts src/app/online/tools/*.ts \
  src/app/online/page/*.ts online-client/toolbar.mts online-client/diceTrayView.mts online-client/diceLogView.mts
```

Expected: `SceneBroadcaster.ts` 300, `GmSession.ts` 302, and every other file under 300.

Search the built page for the wiring, as in Task 3, Step 16:

```bash
for text in "dice-roll" "dice-log" "laser" "dice-log-button" "dice-tray" "dice-toast" "toolbar" "More tools" \
  "Measure options" "Circle/Sphere" "Select dice to roll" "Close dice log" "No rolls yet"; do
  grep -rqF -- "$text" dist-online && echo "ok: $text" || echo "MISSING: $text"
done
```

Expected: `ok:` for every text.

- [ ] **Step 4: Commit**

```bash
git add docs/online-play-features.md README.md PRIVACY.md changelog/Unreleased.md
git commit -m "docs(online): player tools"
```

- [ ] **Step 5: The manual test (the user runs it)**

Ask the controller to have the user run this with the plugin built (`npm run build`) and the page served from `dist-online/` (or published). Use two players: one in a desktop browser, one on a phone.

1. Start a session, present a scene with a grid and a token assigned to each player (**Controlled by**). Both players join.
2. **Toolbar.** Both see **Move**, **Measure**, **Laser** and **Dice** at the bottom, with Move pressed. On desktop, hovering a button shows its label. Narrow the desktop window until controls move into **More tools**; the tool in use stays in the bar.
3. **Drag ruler.**
   - Desktop: drag your token, press Space mid-drag, and move on. The ruler shows the path through the waypoint and the distance in the collection's units (for example "20ft").
   - Phone: drag your token, hold still for half a second mid-drag, and move on. One waypoint is added.
   - On release the token lands where the GM's drop puts it, at the ruler's end.
4. **Measure.**
   - On each device, pick **Line**, then **Circle/Sphere**, then **Cone** from the Measure flyout. Drag on the map: each shape shows with its distance, and is gone on release.
   - The other player and the GM see nothing of it.
   - Escape, or tapping Measure again, returns to Move.
5. **Laser.**
   - Pick **Laser** on both devices and draw. Each player sees the other's laser in another colour, fading after release.
   - The GM sees both lasers on the presented scene in Atlas.
   - The GM draws with Atlas's laser on the presented tab, and both players see it in the first colour (red).
   - The GM switches to another tab mid-stroke: the GM's laser fades for the players.
   - A player puts a second finger down mid-stroke: their laser fades for everyone.
6. **Dice.**
   - The desktop player opens **Dice**, adds 2 d6 and 3 d8 with clicks, removes one d8 with a right-click, types 1 in **Modifier**, and presses **Roll**.
   - The tray closes. A toast shows the roll on both devices, with the player's name, each die and the total (2 d6 + 2 d8 + 1).
   - The GM's dice log and toast show it under the player's name.
   - The phone player removes a die with a long-press: exactly one goes.
7. **Dice log.**
   - The GM rolls from the toolbar's dice tray, and from the statblock of a token hidden from players. Players see the first as "GM"; the second shows as "GM" too, without the token's name.
   - Open **Dice log** on both devices: the side panel on desktop and the bottom sheet on the phone list the rolls, newest first.
   - Reload the phone's page. After it rejoins, the log shows the same rolls once each, with no toast for them.
8. **Stop the session.** The players see the session end, and the toolbar, tray and log go with the table.

Expected: everything above holds. If anything does not, the implementer stops and reports what was seen, with the console output of both ends (**Log online play events** on the GM's side; `localStorage.setItem('atlas-online:log', 'on')` on the page).

- [ ] **Step 6: Record the result**

If the manual test passes, nothing more is committed. If it found a problem, fix it in the task that owns the code, with a regression test there, and run Step 3 again.

---

## Self-review

Checked against the spec after writing:

- **Spec coverage.**
  - **Goals:**
    - the drag ruler with the GM's measurement settings (Tasks 1 and 3);
    - dice rolled on the GM's side, in the GM's and every player's dice log (Tasks 1 and 2, the page in Task 3);
    - private measuring with Atlas's shapes (Task 3);
    - lasers for everyone, drawn like Atlas's (Tasks 2 and 3);
    - the look and behaviour of Atlas's tools on desktop and phones (Task 3, with the manual test in Task 4).
  - **Non-goals** are respected:
    - measurements are never sent (`playerToolsPage.test.ts`);
    - there are no private rolls and no physical dice on the page;
    - there are no pins, pings, walls or vision.
  - **Decisions:**
    - everyone sees every roll: Task 2's dice host relays the feed;
    - the GM's side rolls: `DiceHost` uses `rollFormula`;
    - measurements are private: Task 3;
    - lasers are shown to everyone: Task 2's relay and the GM's own laser.
  - **Measurement settings:** in the projection, both coverage tables, and validated (Task 1).
  - **Dice messages:**
    - the shape and limits (≤ 20 dice, modifier ±1000), the Atlas log entry with the roller name, the replay of 50 and the live entries, GM rolls included (Tasks 1 and 2);
    - 2 per second, with excess ignored (Task 2).
    - Physical dice: ruling 5.
  - **Laser messages:**
    - the shapes both ways, ≤ 64 points and ≤ 20 per second (Task 2);
    - relayed to the others and shown in the GM's view; the GM's own sent; another scene ignored; nothing stored (Task 2);
    - colours by player order (Task 2's `laserColor`, used on both sides).
  - **Player page:**
    - the toolbar with More (Task 3), and Atlas's icons drawn as images (Task 3's `toolIcons`, checked against Atlas's components);
    - the dice tray with its add and remove, modifier and Roll; the log panel and sheet, newest first; the toast; text through `textContent` (Task 3);
    - gestures: measure, laser hold and fade, two fingers, Escape and tapping the active tool again, the waypoint key and the 500 ms hold (Task 3).
  - **Maintainability:**
    - the shared modules (Task 1; the remote lasers and the batcher in Task 2);
    - the guide's "player tools" section (Task 4).
  - **Testing:**
    - GM: dice validation, rolling, log entries and replay; laser relay limits and colours; measurement in the projection (Tasks 1 and 2).
    - Player: toolbar fit; tools and gestures; ruler waypoints; measure shapes; laser drawing and fade; dice tray and log (Task 3).
    - Shared: Atlas draws as before (Task 1, with the existing tests unchanged).
    - End to end over `MemoryTransport` (Tasks 2 and 3).
    - Manual (Task 4).
- **Deviations reported for review.**
  - The dice modifier fix reaches Atlas's own rolls (ruling 1).
  - `dice-log` carries `replay`, which the spec does not name (ruling 3).
  - The dice log opens from a top-bar button, not a toolbar tool (ruling 10).
  - The measurement is all of `MeasurementSettings`, which covers the spec's "unit label" (ruling 8).
- **Placeholder scan.** No "TBD", "add appropriate" or "similar to Task N". Every code step has its code, and every test step has its test.
- **Type consistency.**
  - **Task 1 names**, used later under the same names:
    - dice: `DICE_TYPES`, `DieType`, `DiceSelection`, `isDieType`, `DiceRollResult.rolledBy`, `DICE_ROLLED_EVENT`, `diceTerms`, `diceFormula`, `rollFormula`, `withoutHiddenToken`, `rollerName`;
    - measuring: `MeasureShape`, `MEASURE_PATH_STROKES`, `MEASURE_POINT`, `MEASURE_AREA`, `MEASURE_SHADOW`, `MEASURE_LABEL_COLORS`, `CONE_ANGLE`, `coneGeometry`, `arcPoints`, `measureLabelAnchor`, `measureLabelBox`, `measureLabelFontSize`, `pathMidpoint`;
    - ruler and grid: `DragRulerPath`, `dragRulerLabel`, `WAYPOINT_KEY`, `cellCenterAt`;
    - laser: `beamWidth`, `beamSmoothingSpacing`, `laserPointSpacing`, `FILAMENT_SHARE`, `FILAMENT_COLOR`, `LaserTrail`;
    - projection: `PlayerMeasurement`, `collectionGrid`.
  - **Task 2 names**, used in Task 3:
    - messages: `DICE_LIMITS`, `LASER_LIMITS`, `DiceLogEntry`, `PlayerLaser`;
    - lasers: `LaserBatcher`, `LASER_INTERVAL_MS`, `RemoteLasers`, `RemoteLaserFrame`, `LASER_STALE_MS`, `laserColor`, `GM_LASER_ID`;
    - session: `PlayerSession.sendDiceRoll`, `sendLaser`, `onDiceLog`, `onLaser`.
  - **Task 3 names**, within the task:
    - `TokenGrab.grab(point, kind)`, `TokenMoves.dragged()`, `OverlayLayer`;
    - `ToolGrid`, `toolGridOf`, `MeasureChoice`, `MeasureOverlay`, `RulerOverlay`, `WAYPOINT_HOLD_MS`, `PlayerTool`, `ToolOverlay`, `PlayerTools` and its methods, `createToolsLayer`, `drawTools`, `MEASURE_ACCENT`;
    - page models: `ToolIconName`, `toolIconUrl`, `dieIconUrl`, `TOOLBAR_CONTROLS`, `ToolbarState`, `hiddenControls`, `DiceTray`, `dieHint`, `LONG_PRESS_MS`, `PlayerDiceLog`, `DICE_TOAST_MS`, `dieExtreme`;
    - page DOM: `PageToolbar`, `DiceTrayView`, `DiceLogView`, and the new `MapView` methods.
- **Review Focus.** Each of the five lines has its named test in its owning task:
  - Tasks 2 and 3: `replays the latest rolls to a rejoining player`, `replaces the log on a replay, without a toast`;
  - Tasks 3 and 2: `lets the laser go when the stroke is interrupted`, `lets a leaving player's laser go for everyone`;
  - Tasks 1 and 2: `reads a count before a second die as dice, not as a modifier`, `rolls a player's mixed roll on the GM's side`;
  - Task 2: `names a roll for a hidden token GM`;
  - Task 3: `adds one waypoint per hold`, `removes one die per long-press, even with the browser's contextmenu`, `adds a waypoint on Space during a drag, and presses no focused button`.
