# Online Token Moves (Online Play, Piece 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The GM assigns character tokens to connected players for the running session. Each player drags their own tokens on the join page, on desktop or phone. The GM's side checks every drop, snaps it as Atlas's drag does, and applies it as one undo step. Everyone sees the result through the normal scene updates.

**Architecture:**
- **GM side** (`src/app/online/control/`, new). Four parts sit behind one `TokenControlHost` that `OnlineSessionService` starts after the broadcaster and the camera sender:
  - `TokenControl` holds the session's assignments (token id → player ids). They are never stored in token data.
  - `ControlLists` is a `GmSession` handler. It sends each player their own `token-control` list on admission, on a resync and on every change.
  - `TokenMoveHandler` is a `GmSession` handler. It checks each `token-move` against `TokenControl` and against the broadcaster's `currentProjection()`, clamps it, snaps it with `snapDroppedToken` (exported from `clipboard/mapObjectPlacement.ts`) and writes it with `runHistoryTransaction` + `setTokenPositions`. A move that fails a check gets `token-move-refused`; more than 10 moves a second from one player are ignored.
  - `watchDeletedTokens` drops the assignments of tokens deleted from the presented scene.
  - `GmSession` hands handlers only `scene-resync` and `token-move` from players (`PLAYER_MESSAGE_TYPES`). `SceneBroadcaster.ts` and `CameraSender.ts` are not touched.
  - The token context menu gets **Controlled by** from `src/app/online/ui/controlledByMenu.ts`, which reads the session's `TokenControl` through `onlineSessionStore`. That keeps PeerJS and the service out of the token renderer's import graph.
- **Player side** (shared modules under `src/app/online/`):
  - `PlayerSession` keeps the control list, reports refusals and sends one `token-move` per drop.
  - `TokenMoves` (pure, `window` timers) holds the drag, the previews waiting for the GM's answer, and the "Move not allowed." notice. It hit-tests through `tokenHit.ts`.
  - `ViewInput` arbitrates between dragging a token, panning and pinching, through an optional `TokenGrab`.
  - The tokens layer draws a highlight ring and the preview positions from a `TokenOverlay` on `LayerFrame`.
  - `online-client/mapView.mts` and `main.mts` only bind the DOM: the cursor classes, Escape, the notice element and the session's callbacks.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), zustand 5 vanilla stores with zundo history (`src/app/stores/history.ts`), PeerJS/WebRTC (unchanged), Canvas 2D (join page), Vitest 4 with jsdom 26 (no `PointerEvent`: tests dispatch `MouseEvent`s with `pointerId`/`pointerType` defined, as `mapView.test.ts` already does), Vite (join page build).

**Spec:** `docs/superpowers/specs/2026-10-01-online-token-moves-design.md` (binding). It builds on pieces 1 to 4, whose plans are in `docs/superpowers/plans/` (latest: `2026-10-01-online-player-view.md`).

## Global Constraints

- **Messages.** All three travel on the control channel, protocol version `1`, and are validated on both sides:
  - `{ v: 1, type: 'token-control', tokenIds: string[] }`, at most 256 ids (`MAX_CONTROLLED_TOKENS = 256`). Each id passes `isSceneId`.
  - `{ v: 1, type: 'token-move', sceneId, tokenId, x, y }`, sent once per drop.
  - `{ v: 1, type: 'token-move-refused', tokenId }`. It carries only the token id the player sent.
- **What the GM accepts from players.** Only `scene-resync` and `token-move` (besides the session's own `join`, `ping`, `pong` and `bye`). Players still cannot send scene data.
- **Assignments.**
  - They live in the running session (`TokenControl`: token id → player ids) and never in token data. They end with the session.
  - A player may control several tokens, and a token may have several controllers.
  - A reconnecting player keeps their tokens: the session recognises them by their player key, so their `playerId` stays the same. A removed (kicked) player loses theirs.
  - A token deleted from the scene loses its assignments.
- **Control lists.**
  - Each admitted player gets their own list on admission, on every change of their assignments, and with every snapshot they get (admission, resync).
  - The shared scene projection does not change.
- **Move checks.** The GM's side applies a move only when all of these hold:
  - The sender is admitted and controls `tokenId`.
  - `sceneId` is the scene players currently have (`currentProjection().sceneId`).
  - The token is in that projection, so it is not hidden and not entirely under fog at the time.
  - `x` and `y` are finite.
  - The position is clamped to the map area, or without a map size to the scene content's bounds.
  - It is snapped with Atlas's drop snapping and written to the presented store in one history step (`runHistoryTransaction`): one undo for the GM.
  - A failed check is answered with `token-move-refused`. More than 10 moves per second from one player are ignored (`MOVES_PER_SECOND = 10`).
  - When the GM and a player, or two players, move the same token, the last write wins, in arrival order.
- **Player view.**
  - Controlled tokens get a highlight ring. On desktop the cursor is a grab hand over them.
  - Desktop: pressing on a controlled token drags it, pressing elsewhere pans, and the wheel zooms.
  - Phone: one finger on a controlled token drags it, and one finger elsewhere pans. Two fingers always pinch and pan, even when one started on a token.
  - While dragging, only the player's own view shows the token under the pointer (a preview), and nothing is sent until release.
  - On release exactly one `token-move` is sent.
  - A cancelled drag sends nothing. That covers pointer cancel, Escape, a lost connection, the token leaving the scene, a new scene and losing control.
  - Dragging does not stop following the GM's view.
  - After the drop the token stays at the drop spot until the scene update arrives, then shows the GM's (snapped) position.
  - A refused move returns the token to its scene position and shows "Move not allowed." for a few seconds (`REFUSED_NOTICE_MS = 3000`).
  - Without any update within 2 seconds (`CONFIRM_TIMEOUT_MS = 2000`), the preview is dropped and the token shows its scene position.
- **Copy.** Use exactly **Controlled by** (submenu label), **No players connected** (the disabled item when nobody is admitted) and "Move not allowed." (the player notice), all in sentence case.
- **Non-goals.** Do not add any of these:
  - remembering assignments across sessions;
  - rotating, resizing, HP, conditions or any token field other than position;
  - movement limits, walls or collision;
  - GM approval of each move;
  - edge auto-scroll while dragging.
- **Shared modules.** Everything under `src/app/online/view/`, plus `src/app/online/PlayerSession.ts` and `src/app/online/protocol.ts`, imports nothing from `obsidian`, PIXI, PeerJS or React. `tokenHit.ts` may import `pixi/token-renderer/tokenSizing.ts`, which is PIXI-free and already shared with `tokensLayer.ts`. The GM-only modules under `src/app/online/control/` may import Atlas code (stores, clipboard placement) but not `obsidian`.
- **No DOM in `src/`.** DOM glue lives in `online-client/*.mts`. It is type-checked by `tsc` (the root `tsconfig.json` includes `online-client/**/*.mts`), not linted (`eslint.config.mjs` ignores `online-client/`), and tested in `tests/unit/online/mapView.test.ts`. Keep logic in `src/` modules.
- **File sizes.**
  - `SceneBroadcaster.ts` (300 lines) and `CameraSender.ts` are not modified.
  - `GmSession.ts` stays at 302 lines: the change swaps one line and one import line.
  - `InteractionController.ts` (850 lines) gains only an import and three lines.
  - Every new file stays under 300 lines. `PlayerSession.ts` grows to about 245 lines and `OnlineSessionService.ts` to about 190.
- **Code style (CLAUDE.md, CONTRIBUTING.md, ESLint).**
  - Explicit return types.
  - `window.setTimeout` / `window.clearTimeout` in `src` (`obsidianmd/prefer-window-timers`).
  - Sentence-case UI text.
  - No inline `eslint-disable`, no `@ts-expect-error`, no `title` attributes.
  - Bulk store edits through store actions (`setTokenPositions`), never a raw Immer draft.
  - Network ids are looked up with `Object.hasOwn`, never `in` or a bare index.
- **Changelog.** Player- and GM-facing changes go in `changelog/Unreleased.md`, which has CRLF line endings: keep them. Then regenerate `src/app/changelog/releases.json` (`npm run changelog:generate`).
- **Tests.**
  - They live in `tests/unit/online/`. Fake timers are used wherever timing matters.
  - Stores that must record undo steps are built with zundo `temporal` plus `createHistoryOptions` (`tests/unit/online/tokenMoveFixtures.ts`). `runHistoryTransaction` silently runs untracked on a store without history, so a plain `createStore` would pass for the wrong reason.

## Review Focus

- **The GM switches the presented view to another tab while a player drags.** The scene is then held: players keep the old scene and `currentProjection()` keeps its `sceneId`, but the view's store now holds another map. A reasonable GM expects the drop to be refused and nothing written into the other map. Test in Task 1: `refuses a move while the scene is held, and writes nothing into the map the view shows now`.
- **A modified page sends a coordinate JSON parses to `Infinity` (`"x":1e400`).** The GM expects a refusal, and the player's connection to stay open: no invalid-message strikes. Test in Task 1: `refuses a coordinate too large for a number and keeps the connection`.
- **The GM shows another scene or loads another map while assignments exist.** The GM expects the assignments to survive the hold, the load and a later presentation. Only a token deleted from the live scene loses them. Test in Task 1: `keeps assignments while the scene is held, another map loads or presenting stops`.
- **On a phone a second finger lands while the first drags a token.** The player expects a pinch: the drag is cancelled, nothing is sent, and the finger left after the pinch pans, never resuming the drag. Test in Task 2: `turns a second finger into a pinch that cancels the token drag, and the finger left pans`.
- **The GM's snapping puts a dropped token back on the cell it came from**, so no scene update for it arrives. The player expects the preview to go after 2 seconds and the token to show its scene position, with no stuck ghost. Test in Task 2: `drops the preview after two seconds without an update, as when the GM put the token back where it was`.

The spec's other likely failures have tests too:
- not admitted, not controlled, wrong scene, hidden, fogged, left the projection between drag and drop, clamping with and without a map size, square, hex, off and switched-off-grid snapping, the rate limit, one undo step, two players on one token, kick versus reconnect, and deleted tokens (Task 1);
- every cancel path, refusal, confirmation, hit-testing, the cursor, Escape and the notice (Task 2).

## Rulings on spec ambiguities

Each task repeats the rulings it needs.

1. **Held scene.** While the presented scene is held (`presented.isHeld()`) or its map is loading, every move is refused, because the view's store holds another map. The projection's `sceneId` alone is not enough.
2. **Non-finite coordinates.** The `token-move` validator requires `typeof x === 'number'` and `typeof y === 'number'`, not finiteness. JSON cannot carry `NaN`, but `1e400` parses to `Infinity`. The handler checks finiteness and refuses. Otherwise a bad coordinate would decode as `invalid`, count a strike, and close the link after three.
3. **Snapping.** `snapDroppedToken(grid, point)` (new export in `src/app/clipboard/mapObjectPlacement.ts`) mirrors the GM's drag (`InteractionController`):
   - It snaps to the cell centre while `grid.snapToGrid ?? true`, including on a grid that is switched off (`enabled: false`). The drag snaps there too: `InteractionController` checks only `snapToGrid`, and `GridSystem.snapToCellCenter` has no `enabled` check.
   - Without grid state it does not snap.
   - It uses the formation geometry paste already uses (`formationGridFromOptions`, `worldToCell`, `cellToWorld`). That is the same maths as `GridSystem.snapToCellCenter`, square and hex, without PIXI.
4. **Clamp, then snap.** The bounds are `sceneWorldBounds(projection)` (`preview/previewLayout.ts`): the map rectangle, or without a map size the content of the projection plus one cell around it, which is what the player's camera uses. The clamped point is then snapped.
5. **When control lists go out.**
   - They go on admission (which includes a reconnect and a replacing tab), on each `scene-resync`, and when the player's assignments change.
   - An admission always sends a list, even an empty one.
   - Broadcast snapshots of a new or resumed presentation send no list, because the list is not bound to a scene. Players keep it across scenes.
6. **What a list holds.** It holds the player's assigned token ids, including tokens currently hidden, fogged or in another scene. These are random ids, never names or positions. Moves are still checked against the projection. See controller item 1.
7. **Who the submenu lists.**
   - It lists only players whose status is `admitted`, in session order, as checkboxes (`checked`, `keepOpen: true`). A player who is gone (reconnecting) keeps their tokens and reappears in the list once back.
   - With nobody admitted it shows one disabled **No players connected** item.
   - It is added only in the GM's view (`!this.isPlayerView`), only for `kind === 'character'` tokens, and only while hosting. It appears on any scene's tokens, not just the presented one's, because ids stay valid when that scene is presented later.
   - It is live: `children` is a function and `subscribe` covers both `TokenControl` changes and `onlineSessionStore`.
8. **What "deleted" means.** A token is deleted when it was in the presented scene's live, loaded store and is gone from it while the same map stays loaded. A hold, a map load, another presentation and clearing remove nothing. A deletion made in a scene while it is not presented is not seen. That is harmless, since a deleted id never comes back except through undo, which then brings its assignment back too.
9. **Kicks.** `GmSession.kick` reaches no handler (`release()` detaches the link first). The service's `onPlayersChanged` calls `TokenControlHost.playersChanged(players)`, which keeps only the players the session still knows: pending, admitted and gone. This follows `PlayerChannels.admitted()`. No new `SessionHandler` hook is added.
10. **Other player messages.** `GmSession` passes only `PLAYER_MESSAGE_TYPES` (`scene-resync`, `token-move`) to handlers. Anything else from an admitted player is dropped silently, with no strike and no log, so `GmSession.ts` does not grow.
11. **Rate limit.** A sliding one-second window per player counts the moves let through, and at most 10 are let through. Ignored moves get no answer (the player's preview times out). A refused move counts as let through.
12. **"The update arrived".** The player's `applyPatch` keeps the record of every token a patch does not touch. So the answer to a drop is the token's record changing, or the token leaving the scene. Any patch of that token counts, and a snapshot (resync) replaces every record, so it clears every preview.
13. **"A few seconds".** The refusal notice shows for 3 seconds (`REFUSED_NOTICE_MS`). A second refusal restarts the timer.
14. **Cursor.** Piece 4 shows a grab hand over the whole map. Now:
    - the map shows the default arrow;
    - controlled tokens show `grab` (`#map.can-grab`);
    - a dragged token or map shows `grabbing` (`#map.is-grabbing`, `#map:active`).
15. **Taps on a token.** A press on a controlled token that does not move past `TAP_SLOP` (6 px) sends nothing (`cancel`), and it still counts toward a double-tap zoom. A right-button press never grabs.
16. **Highlight ring.** It is drawn after the token's own ring and before its bars and badges: radius `ringRadius + 1.5 × stroke`, width `stroke` (Atlas's grid stroke), colour `#facc15` (`CONTROLLED_RING_COLOR`). It shows whether or not the player is connected.
17. **256 tokens.** `TokenControl.set` ignores an assignment that would give a player more than `MAX_CONTROLLED_TOKENS`, so every list validates.
18. **Not admitted.** `GmSession` delivers nothing from a pending connection or a closed (kicked) link, so such a move gets no answer at all. A player removed during a drag never reaches the handler, and the drop is ignored.
19. **Undo while the GM is mid-gesture.** `runHistoryTransaction` nests into a transaction that is already open. A player's move that arrives while the GM drags a token, sweeps the eraser or works a live config panel therefore joins that gesture's undo step. Otherwise every move is its own step. No code handles this; see controller item 5.

## Items for the controller to decide

1. **Hidden tokens in control lists (ruling 6).** Should a list carry only the assigned tokens currently in the projection? That would mean re-sending a list on every projection change that adds or removes an assigned token.
2. **Snapping on a switched-off grid (ruling 3).** It mirrors the drag. Paste does not snap there. Keep the drag's behaviour?
3. **Cursor change (ruling 14).** The map no longer shows a grab hand everywhere. Acceptable, or keep `grab` for panning and use another cue over tokens?
4. **Submenu scope (ruling 7).** Should it appear on tokens of scenes that are not presented, and should gone players be listed (with a marker) so the GM can see who keeps a token?
5. **Moves during a GM gesture (ruling 19).** Such a move shares the gesture's undo step. Accept that, or defer moves that arrive while a history transaction is open until it ends?

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/app/online/protocol.ts` (modify) | The three new message types and their validators, `MAX_CONTROLLED_TOKENS`, `PLAYER_MESSAGE_TYPES`. |
| `src/app/online/GmSession.ts` (modify, 2 lines) | Hands handlers only `PLAYER_MESSAGE_TYPES` from players. |
| `src/app/clipboard/mapObjectPlacement.ts` (modify) | Exports `snapDroppedToken`, the drag's snapping without PIXI. |
| `src/app/online/control/TokenControl.ts` (create) | The session's assignments: token id → player ids, change listeners. |
| `src/app/online/control/ControlLists.ts` (create) | `GmSession` handler: each player's `token-control` list on admission, resync and change. |
| `src/app/online/control/TokenMoveHandler.ts` (create) | `GmSession` handler: checks, clamp, snap, one undo step, refusal, `MoveRateLimit`. |
| `src/app/online/control/deletedTokens.ts` (create) | `watchDeletedTokens`: drops assignments of tokens deleted from the live presented scene. |
| `src/app/online/control/TokenControlHost.ts` (create) | Owns the four parts above for one session; `playersChanged` for kicks. |
| `src/app/online/onlineSessionStore.ts` (modify) | `tokenControl: TokenControl \| null` for the GM's UI. |
| `src/app/online/OnlineSessionService.ts` (modify) | Creates, starts and stops the `TokenControlHost`; publishes its `TokenControl`. |
| `src/app/online/ui/controlledByMenu.ts` (create) | The **Controlled by** submenu. |
| `src/app/pixi/token-renderer/InteractionController.ts` (modify, 4 lines) | Adds the submenu to character tokens in the GM's view. |
| `src/app/online/PlayerSession.ts` (modify) | Keeps the control list, reports refusals, `sendTokenMove`. |
| `src/app/online/view/tokenHit.ts` (create) | `controlledTokenAt`: topmost controlled token under a world point, as drawn. |
| `src/app/online/view/TokenMoves.ts` (create) | Drag, previews, confirmation, timeout, refusal notice; implements `TokenGrab`. |
| `src/app/online/view/ViewInput.ts` (modify) | Token drag versus pan versus pinch through an optional `TokenGrab`. |
| `src/app/online/view/CameraController.ts` (modify) | `toWorld(point)`. |
| `src/app/online/view/layers/layerTypes.ts` (modify) | `TokenOverlay`, `NO_TOKEN_OVERLAY`, `LayerFrame.overlay`. |
| `src/app/online/view/layers/tokensLayer.ts` (modify) | Highlight ring, preview positions. |
| `src/app/online/view/PlayerViewRenderer.ts` (modify) | `setOverlay`, passes it in each frame. |
| `online-client/mapView.mts` (modify) | Binds `TokenMoves`: cursor classes, Escape, the notice element. |
| `online-client/main.mts`, `index.html`, `style.css` (modify) | Session callbacks to the map view, the notice element, cursor rules. |
| `tests/unit/online/tokenMoveFixtures.ts` (create) | A GM world with real session, broadcaster and `TokenControlHost`, and a scene store with undo history. |
| `tests/unit/online/*.test.ts` | See each task. |
| `README.md`, `PRIVACY.md`, `changelog/Unreleased.md`, `src/app/changelog/releases.json`, `docs/online-play-features.md` (modify) | Task 3. |

---
### Task 1: Protocol and the GM's side (assignments, control lists, checked moves, Controlled by)

**Files:**
- Modify: `src/app/online/protocol.ts` (the `ControlMessage` union, `VALIDATORS`, two constants)
- Modify: `src/app/online/GmSession.ts:4` (import) and `:150` (`else for (const handler …)` in `receive`)
- Modify: `src/app/clipboard/mapObjectPlacement.ts` (append `snapDroppedToken`)
- Create: `src/app/online/control/TokenControl.ts`, `ControlLists.ts`, `TokenMoveHandler.ts`, `deletedTokens.ts`, `TokenControlHost.ts`
- Modify: `src/app/online/onlineSessionStore.ts`, `src/app/online/OnlineSessionService.ts`
- Create: `src/app/online/ui/controlledByMenu.ts`
- Modify: `src/app/pixi/token-renderer/InteractionController.ts` (import block, after the Hide/Show entry in `showContextMenu`)
- Test: `tests/unit/online/protocol.test.ts`, `gmSession.test.ts`, `onlineSessionService.test.ts` (add); `tests/unit/online/tokenMoveFixtures.ts`, `tokenControl.test.ts`, `controlLists.test.ts`, `tokenMoveHandler.test.ts`, `controlledByMenu.test.ts`, `tokenMovesEndToEnd.test.ts` (create)

**Interfaces:**
- Consumes (existing):
  - `SceneSession`, `PresentedSceneSource` (`scene/sceneSources.ts`)
  - `CameraProjection` (`scene/CameraSender.ts`): `currentProjection(): PlayerScene | null`
  - `sceneWorldBounds(scene): PreviewRect | null` (`preview/previewLayout.ts`)
  - `runHistoryTransaction(store, fn)` (`stores/history.ts`)
  - `ViewAtlasState['setTokenPositions']`
  - `formationGridFromOptions`, `worldToCell`, `cellToWorld` (`encounters/encounterFormation.ts`)
  - `ContextMenuEntry` (re-exported by `react/root/ContextMenuContext.tsx`, the file consumers import it from)
- Produces (Task 2 and later rely on these exact names):
  - `protocol.ts`: `MAX_CONTROLLED_TOKENS = 256`, `PLAYER_MESSAGE_TYPES: ReadonlySet<ControlMessage['type']>`, and three new `ControlMessage` members:
    - `{ v: 1; type: 'token-control'; tokenIds: string[] }`
    - `{ v: 1; type: 'token-move'; sceneId: string; tokenId: string; x: number; y: number }`
    - `{ v: 1; type: 'token-move-refused'; tokenId: string }`
  - `snapDroppedToken(grid: GridState | null, point: Point): Point`
  - `class TokenControl`: `controls(playerId, tokenId): boolean`, `tokensOf(playerId): string[]`, `assignedTokens(): string[]`, `set(tokenId, playerId, controlled: boolean): void`, `dropTokens(tokenIds: readonly string[]): void`, `retainPlayers(known: ReadonlySet<string>): void`, `onChange(listener: (playerIds: readonly string[]) => void): () => void`
  - `class ControlLists implements SessionHandler`: `new ControlLists({ session, control })`, `start()`, `stop()`
  - `class TokenMoveHandler implements SessionHandler`: `new TokenMoveHandler({ session, presented, projection, control })`, `start()`, `stop()`; `MOVES_PER_SECOND = 10`; `class MoveRateLimit { allow(playerId, now): boolean; forget(playerId): void }`
  - `watchDeletedTokens(presented: PresentedSceneSource, control: TokenControl): () => void`
  - `class TokenControlHost`: `new TokenControlHost({ session, presented, projection })`, `readonly control: TokenControl`, `start()`, `stop()`, `playersChanged(players: readonly SessionPlayer[]): void`
  - `OnlineSessionState.tokenControl: TokenControl | null`
  - `controlledBySubmenu(tokenId: string): ContextMenuEntry | null`, `CONTROLLED_BY_LABEL = 'Controlled by'`, `NO_PLAYERS_LABEL = 'No players connected'`
  - Test fixture `tests/unit/online/tokenMoveFixtures.ts`: `moveWorld(options?)`, `moveSceneStore(state?)`, `partyState(tokens?)`, `partyTokens()`, types `MovePlayer`, `MoveWorld`, `MoveSceneState`

Rulings this task implements: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17, 18 and 19 (see the top of the plan).

#### 1a. Protocol

- [ ] **Step 1: Write the failing protocol tests**

In `tests/unit/online/protocol.test.ts`, change the import line to:

```ts
import {
  decodeControl, encodeControl, normalizePlayerName, MAX_CONTROL_MESSAGE_BYTES, MAX_CONTROLLED_TOKENS, PLAYER_MESSAGE_TYPES,
} from '../../../src/app/online/protocol';
```

and add these tests inside `describe('online protocol', …)`:

```ts
  it('round-trips the token control, move and refusal messages', () => {
    const messages = [
      { v: 1, type: 'token-control', tokenIds: ['hero', 'ally'] },
      { v: 1, type: 'token-control', tokenIds: [] },
      { v: 1, type: 'token-move', sceneId: 's1', tokenId: 'hero', x: 12.5, y: -3 },
      { v: 1, type: 'token-move-refused', tokenId: 'hero' },
    ] as const;
    for (const message of messages) {
      expect(decodeControl(encodeControl(message))).toEqual({ kind: 'message', message });
    }
  });

  it('refuses malformed token messages', () => {
    const tooMany = Array.from({ length: MAX_CONTROLLED_TOKENS + 1 }, (_, index) => `t${index}`);
    const bad = [
      { v: 1, type: 'token-control', tokenIds: tooMany },
      { v: 1, type: 'token-control', tokenIds: ['__proto__'] },
      { v: 1, type: 'token-control', tokenIds: 'hero' },
      { v: 1, type: 'token-move', sceneId: 's1', tokenId: 'hero', x: '1', y: 0 },
      { v: 1, type: 'token-move', sceneId: 's1', tokenId: 'hero', x: null, y: 0 },
      { v: 1, type: 'token-move', tokenId: 'hero', x: 1, y: 0 },
      { v: 1, type: 'token-move', sceneId: 's1', tokenId: '', x: 1, y: 0 },
      { v: 1, type: 'token-move-refused', tokenId: 'x'.repeat(129) },
    ];
    for (const message of bad) {
      expect(decodeControl(JSON.stringify(message)), JSON.stringify(message).slice(0, 80)).toEqual({
        kind: 'invalid', reason: `bad-${message.type}`,
      });
    }
  });

  it('decodes a move whose coordinate JSON reads as Infinity, so the GM refuses it instead of counting it invalid', () => {
    expect(decodeControl('{"v":1,"type":"token-move","sceneId":"s1","tokenId":"hero","x":1e400,"y":0}')).toEqual({
      kind: 'message', message: { v: 1, type: 'token-move', sceneId: 's1', tokenId: 'hero', x: Infinity, y: 0 },
    });
  });

  it('names what players may send: a resync and a token move', () => {
    expect([...PLAYER_MESSAGE_TYPES].sort()).toEqual(['scene-resync', 'token-move']);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/online/protocol.test.ts`
Expected: FAIL. `MAX_CONTROLLED_TOKENS` and `PLAYER_MESSAGE_TYPES` are not exported, and the token messages decode as `{ kind: 'ignored' }`.

- [ ] **Step 3: Add the messages to `src/app/online/protocol.ts`**

Change the scene validation import to include `isSceneId`:

```ts
import {
  isDrawingRecords, isFogRecords, isLastSeq, isPlayerSceneBody, isSceneCamera, isSceneCount, isSceneId, isScenePatchBody, isSceneSeq,
} from './scene/sceneValidation';
```

Below `export const MAX_PLAYER_NAME_LENGTH = 40;` add:

```ts
/** The most tokens one player may control, and so the longest `token-control` list. */
export const MAX_CONTROLLED_TOKENS = 256;
```

Append the three members to the `ControlMessage` union, after the `scene-camera` member (replace `| ({ v: 1; type: 'scene-camera' } & SceneCamera);` with):

```ts
  | ({ v: 1; type: 'scene-camera' } & SceneCamera)
  /** GM to one player: the tokens that player may move, for this session. */
  | { v: 1; type: 'token-control'; tokenIds: string[] }
  /** Player to GM, once per drop: where the player let go of one of their tokens, in world units. */
  | { v: 1; type: 'token-move'; sceneId: string; tokenId: string; x: number; y: number }
  /** GM to the player who sent the move: it failed a check, so the token stays where the scene has it. */
  | { v: 1; type: 'token-move-refused'; tokenId: string };

/** What an admitted player may send besides `ping`, `pong` and `bye`; the GM drops every other type from a player. */
export const PLAYER_MESSAGE_TYPES: ReadonlySet<ControlMessage['type']> = new Set<ControlMessage['type']>(['scene-resync', 'token-move']);
```

Add three entries at the end of `VALIDATORS`, after `'scene-camera': (m) => isSceneCamera(m),`:

```ts
  'token-control': (m) => Array.isArray(m.tokenIds) && m.tokenIds.length <= MAX_CONTROLLED_TOKENS
    && m.tokenIds.every((id) => isSceneId(id)),
  // Any number: one JSON reads as Infinity (`1e400`) is the GM's check to refuse, not a broken message.
  'token-move': (m) => isSceneId(m.sceneId) && isSceneId(m.tokenId) && typeof m.x === 'number' && typeof m.y === 'number',
  'token-move-refused': (m) => isSceneId(m.tokenId),
```

- [ ] **Step 4: Run the protocol tests**

Run: `npx vitest run tests/unit/online/protocol.test.ts tests/unit/online/sceneProtocol.test.ts`
Expected: PASS.

#### 1b. The GM accepts only what players may send

- [ ] **Step 5: Write the failing GmSession test**

Add to `tests/unit/online/gmSession.test.ts`, inside `describe('GmSession', …)`:

```ts
  it('hands handlers only what players may send: scene-resync and token-move', async () => {
    const { network, session, requests } = setup();
    const seen: string[] = [];
    session.use({ onMessage: (_p, m) => seen.push(m.type) });
    const anna = await player(network);
    anna.link.send('control', join('Anna', 'key-a'));
    session.allow(requests[0]!.playerId);
    const sent: ControlMessage[] = [
      { v: 1, type: 'scene-clear', seq: 1 },
      { v: 1, type: 'token-control', tokenIds: ['hero'] },
      { v: 1, type: 'token-move-refused', tokenId: 'hero' },
      { v: 1, type: 'presence', players: [] },
      { v: 1, type: 'scene-resync', seq: 0 },
      { v: 1, type: 'token-move', sceneId: 's1', tokenId: 'hero', x: 1, y: 2 },
    ];
    for (const message of sent) anna.link.send('control', encodeControl(message));
    expect(seen).toEqual(['scene-resync', 'token-move']);
    // Dropped, not invalid: no strikes, the connection stays.
    expect(anna.closed()).toBe(false);
  });
```

- [ ] **Step 6: Run it to see it fail**

Run: `npx vitest run tests/unit/online/gmSession.test.ts -t "only what players may send"`
Expected: FAIL. `seen` holds all six types.

- [ ] **Step 7: Filter in `GmSession.receive`**

In `src/app/online/GmSession.ts` change line 4 to:

```ts
import { decodeControl, encodeControl, normalizePlayerName, PLAYER_MESSAGE_TYPES, type ControlMessage, type DenyReason, type PresencePlayer } from './protocol';
```

and replace, in `receive`,

```ts
    else for (const handler of this.handlers) handler.onMessage?.({ ...entry.player }, message);
```

with

```ts
    else if (PLAYER_MESSAGE_TYPES.has(message.type)) for (const handler of this.handlers) handler.onMessage?.({ ...entry.player }, message);
```

The file stays at 302 lines.

- [ ] **Step 8: Run the session and scene tests**

Run: `npx vitest run tests/unit/online/gmSession.test.ts tests/unit/online/sceneBroadcaster.test.ts tests/unit/online/cameraSender.test.ts`
Expected: PASS. `sceneBroadcaster.test.ts`'s `ignores scene data sent by players` passes unchanged.

#### 1c. Assignments: `TokenControl`

- [ ] **Step 9: Write the failing `TokenControl` tests**

Create `tests/unit/online/tokenControl.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TokenControl } from '../../../src/app/online/control/TokenControl';
import { MAX_CONTROLLED_TOKENS } from '../../../src/app/online/protocol';

function watched(): { control: TokenControl; changes: string[][] } {
  const control = new TokenControl();
  const changes: string[][] = [];
  control.onChange((playerIds) => changes.push([...playerIds]));
  return { control, changes };
}

describe('TokenControl', () => {
  it('gives a player several tokens and a token several players, telling who changed', () => {
    const { control, changes } = watched();
    control.set('hero', 'p1', true);
    control.set('ally', 'p1', true);
    control.set('hero', 'p2', true);
    expect(control.tokensOf('p1')).toEqual(['hero', 'ally']);
    expect(control.tokensOf('p2')).toEqual(['hero']);
    expect(control.controls('p2', 'hero')).toBe(true);
    expect(control.controls('p2', 'ally')).toBe(false);
    expect(control.assignedTokens()).toEqual(['hero', 'ally']);
    expect(changes).toEqual([['p1'], ['p1'], ['p2']]);
  });

  it('takes a token away, and ignores an assignment that changes nothing', () => {
    const { control, changes } = watched();
    control.set('hero', 'p1', true);
    control.set('hero', 'p1', true);
    control.set('ally', 'p1', false);
    control.set('hero', 'p1', false);
    expect(control.tokensOf('p1')).toEqual([]);
    expect(control.assignedTokens()).toEqual([]);
    expect(changes).toEqual([['p1'], ['p1']]);
  });

  it('gives no player more tokens than one control list carries', () => {
    const { control } = watched();
    for (let index = 0; index <= MAX_CONTROLLED_TOKENS; index++) control.set(`t${index}`, 'p1', true);
    expect(control.tokensOf('p1')).toHaveLength(MAX_CONTROLLED_TOKENS);
    expect(control.controls('p1', `t${MAX_CONTROLLED_TOKENS}`)).toBe(false);
  });

  it('drops deleted tokens and tells each of their players once', () => {
    const { control, changes } = watched();
    control.set('hero', 'p1', true);
    control.set('hero', 'p2', true);
    control.set('ally', 'p1', true);
    changes.length = 0;
    control.dropTokens(['hero', 'ally', 'unknown']);
    expect(control.assignedTokens()).toEqual([]);
    expect(changes).toEqual([['p1', 'p2']]);
    control.dropTokens(['hero']);
    expect(changes).toHaveLength(1);
  });

  it('forgets players the session no longer knows, and keeps the rest', () => {
    const { control, changes } = watched();
    control.set('hero', 'p1', true);
    control.set('hero', 'p2', true);
    control.set('ally', 'p2', true);
    changes.length = 0;
    control.retainPlayers(new Set(['p1']));
    expect(control.tokensOf('p1')).toEqual(['hero']);
    expect(control.tokensOf('p2')).toEqual([]);
    expect(control.assignedTokens()).toEqual(['hero']);
    expect(changes).toEqual([['p2']]);
    control.retainPlayers(new Set(['p1']));
    expect(changes).toHaveLength(1);
  });

  it('stops telling a listener that unsubscribed', () => {
    const control = new TokenControl();
    const changes: string[][] = [];
    const stop = control.onChange((playerIds) => changes.push([...playerIds]));
    stop();
    control.set('hero', 'p1', true);
    expect(changes).toEqual([]);
  });
});
```

- [ ] **Step 10: Run them to see them fail**

Run: `npx vitest run tests/unit/online/tokenControl.test.ts`
Expected: FAIL. `src/app/online/control/TokenControl` cannot be resolved.

- [ ] **Step 11: Create `src/app/online/control/TokenControl.ts`**

```ts
/**
 * Which players control which tokens, for the running online session only: kept here,
 * never in token data, and gone when the session ends. A token may have several
 * controllers and a player several tokens, at most `MAX_CONTROLLED_TOKENS`, the most
 * one `token-control` list carries. Listeners hear which players' lists changed.
 */
import { MAX_CONTROLLED_TOKENS } from '../protocol';

export type ControlListener = (playerIds: readonly string[]) => void;

export class TokenControl {
  /** Token id → its controllers; a token with none has no entry. Insertion order is assignment order. */
  private readonly byToken = new Map<string, Set<string>>();
  private readonly listeners = new Set<ControlListener>();

  controls(playerId: string, tokenId: string): boolean {
    return this.byToken.get(tokenId)?.has(playerId) ?? false;
  }

  /** The player's tokens, in the order they were first assigned. */
  tokensOf(playerId: string): string[] {
    const tokenIds: string[] = [];
    for (const [tokenId, players] of this.byToken) if (players.has(playerId)) tokenIds.push(tokenId);
    return tokenIds;
  }

  /** Every token someone controls. */
  assignedTokens(): string[] {
    return [...this.byToken.keys()];
  }

  /** Gives `tokenId` to the player or takes it away; a player who has the most tokens gets no more. */
  set(tokenId: string, playerId: string, controlled: boolean): void {
    if (this.controls(playerId, tokenId) === controlled) return;
    if (controlled) {
      if (this.tokensOf(playerId).length >= MAX_CONTROLLED_TOKENS) return;
      const players = this.byToken.get(tokenId) ?? new Set<string>();
      players.add(playerId);
      this.byToken.set(tokenId, players);
    } else {
      const players = this.byToken.get(tokenId);
      players?.delete(playerId);
      if (players?.size === 0) this.byToken.delete(tokenId);
    }
    this.emit([playerId]);
  }

  /** Tokens deleted from the scene lose their controllers. */
  dropTokens(tokenIds: readonly string[]): void {
    const affected = new Set<string>();
    for (const tokenId of tokenIds) {
      const players = this.byToken.get(tokenId);
      if (!players) continue;
      players.forEach((playerId) => affected.add(playerId));
      this.byToken.delete(tokenId);
    }
    if (affected.size > 0) this.emit([...affected]);
  }

  /** Forgets every player not in `known`: a removed (kicked) player loses their tokens; one who is only gone keeps them. */
  retainPlayers(known: ReadonlySet<string>): void {
    const affected = new Set<string>();
    for (const [tokenId, players] of this.byToken) {
      for (const playerId of players) {
        if (known.has(playerId)) continue;
        players.delete(playerId);
        affected.add(playerId);
      }
      if (players.size === 0) this.byToken.delete(tokenId);
    }
    if (affected.size > 0) this.emit([...affected]);
  }

  onChange(listener: ControlListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(playerIds: readonly string[]): void {
    for (const listener of [...this.listeners]) listener(playerIds);
  }
}
```

- [ ] **Step 12: Run the tests**

Run: `npx vitest run tests/unit/online/tokenControl.test.ts`
Expected: PASS.

#### 1d. Drop snapping without PIXI

- [ ] **Step 13: Export `snapDroppedToken` from `src/app/clipboard/mapObjectPlacement.ts`**

It is tested through the move handler (Step 22), against `GridSystem`'s own hex maths. Append to the file:

```ts
/**
 * Where a token dropped at `point` lands, as the GM's drag puts it (`InteractionController`): on its
 * cell's centre while snapping is on (the default), also on a grid that is switched off, since the
 * drag snaps to it too. Without grid state nothing snaps. Online players' moves land through here.
 */
export function snapDroppedToken(grid: GridState | null, point: Point): Point {
  if (!grid || !(grid.snapToGrid ?? true)) return point;
  const geometry = formationGridFromOptions({ ...grid, enabled: true });
  return geometry ? snapToCellCenter(geometry, point) : point;
}
```

#### 1e. The GM test world

- [ ] **Step 14: Create `tests/unit/online/tokenMoveFixtures.ts`**

```ts
/**
 * A GM with the real session, scene broadcaster and token control over an in-memory
 * network, and a scene store like Atlas's view store for what moves touch:
 * `setTokenPositions` and zundo undo history. `runHistoryTransaction` runs untracked
 * on a store without history, so a plain store would hide a missing undo step.
 */
import { vi } from 'vitest';
import { temporal } from 'zundo';
import { immer } from 'zustand/middleware/immer';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { TokenControlHost } from '../../../src/app/online/control/TokenControlHost';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession, type PlayerSessionOptions } from '../../../src/app/online/PlayerSession';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { AssetRegistry } from '../../../src/app/online/scene/AssetRegistry';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { SCENE_TICK_MS, SceneBroadcaster } from '../../../src/app/online/scene/SceneBroadcaster';
import { MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';
import type { ClientTransport, PeerLink } from '../../../src/app/online/transport/types';
import { PresentedScene, type PresentedView } from '../../../src/app/services/PresentedScene';
import type { ViewAtlasState } from '../../../src/app/storeFactory';
import { createHistoryOptions, getHistoryStore, type HistoryState } from '../../../src/app/stores/history';
import { createTabMetaStore } from '../../../src/app/stores/tabMetaStore';
import { memoryImageFiles, nodeHash } from './assetFixtures';
import { emptySceneState, type CameraSceneState } from './cameraFixtures';

export type MoveSceneState = CameraSceneState & Pick<ViewAtlasState, 'setTokenPositions'>;
type Tokens = CameraSceneState['objects']['tokens'];

/** hero and ally in the open, orc hidden, goblin under the fog rectangle from (900, 900) to (1300, 1300). */
export function partyTokens(): Tokens {
  return {
    hero: { id: 'hero', kind: 'character', x: 140, y: 140, imagePath: 'art/hero.png', name: 'Hero' },
    ally: { id: 'ally', kind: 'character', x: 280, y: 140, imagePath: 'art/ally.png', name: 'Ally' },
    orc: { id: 'orc', kind: 'character', x: 420, y: 140, imagePath: 'art/orc.png', name: 'Orc', isHidden: true },
    goblin: { id: 'goblin', kind: 'character', x: 1050, y: 1050, imagePath: 'art/goblin.png', name: 'Goblin' },
  } as unknown as Tokens;
}

/** A square 70 px grid with snapping on (the default), the party, and one fog rectangle. */
export function partyState(tokens: Tokens = partyTokens()): CameraSceneState {
  const state = emptySceneState();
  return {
    ...state,
    objects: {
      ...state.objects,
      tokens,
      fog: {
        f1: { id: 'f1', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: 900, y: 900, width: 400, height: 400 },
      } as unknown as CameraSceneState['objects']['fog'],
    },
  };
}

export function moveSceneStore(state: CameraSceneState = partyState()): { store: StoreApi<MoveSceneState>; history: () => HistoryState } {
  const store: StoreApi<MoveSceneState> = createStore<MoveSceneState>()(temporal(immer((set) => ({
    ...state,
    setTokenPositions: (positions: Array<{ id: string; x: number; y: number }>) => set((draft: MoveSceneState) => {
      for (const { id, x, y } of positions) {
        const token = draft.objects.tokens[id];
        if (token) {
          token.x = x;
          token.y = y;
        }
      }
    }),
  })), createHistoryOptions(() => store.getState())));
  return { store, history: () => getHistoryStore(store)!.getState() };
}

export interface MovePlayer {
  key: string;
  playerId: string;
  session: PlayerSession;
  /** Every control message the GM sent this player, on every link, decoded. */
  received: ControlMessage[];
  /** Sends text on the player's current link, as a modified page could. */
  sendRaw(text: string): void;
  /** A `token-move` on the player's current link, for the scene players have unless `sceneId` is given. */
  move(tokenId: string, x: number, y: number, sceneId?: string): void;
  refusals(): string[];
  controlLists(): string[][];
}

export function moveWorld(options: { state?: CameraSceneState; mapSize?: { width: number; height: number } } = {}) {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  let host: TokenControlHost | null = null;
  const gm = new GmSession(network.host('gm'), {
    title: 'Vault', onJoinRequest: (player) => requests.push(player), onRequestClosed: () => {},
    // As `OnlineSessionService` does: a removed player loses their tokens.
    onPlayersChanged: (players) => host?.playersChanged(players),
  });
  gm.start();
  const rules: PlayerViewRules = {
    showGrid: true, showTokenHP: false, showTokenStress: false, showTokenNameplates: false, showWidgets: true, showInitiative: true,
  };
  const settings = { getLocalPlayerViewSettings: (): PlayerViewRules => rules, onChange: (): (() => void) => () => {} };
  const presented = new PresentedScene();
  const assets = new AssetRegistry({ files: memoryImageFiles().source, notify: () => {}, hash: nodeHash });
  const broadcaster = new SceneBroadcaster({ session: gm, presented, settings, assets, notify: () => {} });
  broadcaster.start();
  const controlHost = new TokenControlHost({ session: gm, presented, projection: broadcaster });
  host = controlHost;
  controlHost.start();

  const { store, history } = moveSceneStore(options.state);
  const tabs = createTabMetaStore();
  const tavern = tabs.getState().addTab('maps/tavern.atlasmap', 'Tavern');
  const dungeon = tabs.getState().addTab('maps/dungeon.atlasmap', 'Dungeon');
  tabs.getState().setActiveTab(tavern);
  const mapSize = options.mapSize ?? { width: 2000, height: 1500 };
  const view = {
    tabMetaStore: tabs,
    atlasStore: store as unknown as StoreApi<ViewAtlasState>,
    register: () => {},
    renderer: { getBackgroundSprite: () => (mapSize.width > 0 ? { ...mapSize, destroyed: false } : null) },
  } as unknown as PresentedView;
  const players: MovePlayer[] = [];

  const join = async (key: string, extra: Partial<PlayerSessionOptions> = {}): Promise<MovePlayer> => {
    const before = requests.length;
    const inner = network.client();
    const received: ControlMessage[] = [];
    let link: PeerLink | null = null;
    const transport: ClientTransport = {
      connect: async (hostId: string): Promise<PeerLink> => {
        const next = await inner.connect(hostId);
        link = next;
        next.onMessage((channel, data) => {
          const decoded = channel === 'control' ? decodeControl(data) : null;
          if (decoded?.kind === 'message') received.push(decoded.message);
        });
        return next;
      },
    };
    const session = new PlayerSession({
      hostId: 'gm', name: key, playerKey: key, clientVersion: '1', transport, onChange: () => {}, ...extra,
    });
    session.start();
    await vi.advanceTimersByTimeAsync(0);
    if (requests.length > before) gm.allow(requests.at(-1)!.playerId);
    await vi.advanceTimersByTimeAsync(0);
    const player: MovePlayer = {
      key, playerId: session.state.playerId!, session, received,
      sendRaw: (text) => { link?.send('control', text); },
      move: (tokenId, x, y, sceneId = broadcaster.currentProjection()?.sceneId ?? 'none') => {
        link?.send('control', encodeControl({ v: 1, type: 'token-move', sceneId, tokenId, x, y }));
      },
      refusals: () => received.flatMap((message) => (message.type === 'token-move-refused' ? [message.tokenId] : [])),
      controlLists: () => received.flatMap((message) => (message.type === 'token-control' ? [message.tokenIds] : [])),
    };
    players.push(player);
    return player;
  };

  return {
    network, gm, broadcaster, host: controlHost, control: controlHost.control, presented, store, history,
    tabs, tavern, dungeon, view, join,
    present: (): void => presented.present(view, tavern),
    token: (id: string) => store.getState().objects.tokens[id],
    tick: (): Promise<void> => vi.advanceTimersByTimeAsync(SCENE_TICK_MS + 5),
    finish(): void {
      players.forEach((player) => player.session.stop());
      controlHost.stop();
      broadcaster.stop();
      gm.stop();
    },
  };
}

export type MoveWorld = ReturnType<typeof moveWorld>;
```

#### 1f. Control lists and deleted tokens

- [ ] **Step 15: Write the failing control list tests**

Create `tests/unit/online/controlLists.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeControl } from '../../../src/app/online/protocol';
import type { PeerLink } from '../../../src/app/online/transport/types';
import { moveWorld } from './tokenMoveFixtures';

describe('control lists', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends each player their own list when their assignments change, and nobody else', async () => {
    const w = moveWorld();
    const a = await w.join('A');
    const b = await w.join('B');
    w.control.set('hero', a.playerId, true);
    w.control.set('ally', a.playerId, true);
    w.control.set('hero', a.playerId, false);
    expect(a.controlLists()).toEqual([[], ['hero'], ['hero', 'ally'], ['ally']]);
    expect(b.controlLists()).toEqual([[]]);
    w.finish();
  });

  it('sends the list on admission, again with every resync, and after a reconnect with the same key', async () => {
    const w = moveWorld();
    w.present();
    const a = await w.join('A');
    expect(a.controlLists()).toEqual([[]]);
    w.control.set('hero', a.playerId, true);
    a.sendRaw(encodeControl({ v: 1, type: 'scene-resync', seq: 0 }));
    expect(a.controlLists()).toEqual([[], ['hero'], ['hero']]);
    // The list follows the snapshot it goes with.
    const types = a.received.map((message) => message.type);
    expect(types.lastIndexOf('token-control')).toBeGreaterThan(types.lastIndexOf('scene-snapshot'));

    (a.session as unknown as { link: PeerLink }).link.close();
    await vi.advanceTimersByTimeAsync(3000);
    expect(a.session.state.status).toBe('admitted');
    expect(a.session.state.playerId).toBe(a.playerId);
    expect(a.controlLists().at(-1)).toEqual(['hero']);
    w.finish();
  });

  it('a removed player loses their tokens; one who is only gone keeps them', async () => {
    const w = moveWorld();
    const a = await w.join('A');
    const b = await w.join('B');
    w.control.set('hero', a.playerId, true);
    w.control.set('hero', b.playerId, true);
    (b.session as unknown as { link: PeerLink }).link.close();
    expect(w.gm.getPlayers().find((player) => player.playerId === b.playerId)?.status).toBe('gone');
    w.gm.kick(a.playerId);
    expect(w.control.tokensOf(a.playerId)).toEqual([]);
    expect(w.control.tokensOf(b.playerId)).toEqual(['hero']);
    w.finish();
  });

  it('drops the assignments of a token deleted from the presented scene, and tells its players', async () => {
    const w = moveWorld();
    w.present();
    const a = await w.join('A');
    w.control.set('hero', a.playerId, true);
    w.control.set('ally', a.playerId, true);
    w.store.setState((state) => { delete state.objects.tokens.hero; });
    expect(w.control.tokensOf(a.playerId)).toEqual(['ally']);
    expect(a.controlLists().at(-1)).toEqual(['ally']);
    // Other edits of the scene change nothing.
    w.store.getState().setTokenPositions([{ id: 'ally', x: 350, y: 140 }]);
    expect(w.control.tokensOf(a.playerId)).toEqual(['ally']);
    w.finish();
  });

  it('keeps assignments while the scene is held, another map loads or presenting stops', async () => {
    const w = moveWorld();
    w.present();
    const a = await w.join('A');
    w.control.set('hero', a.playerId, true);
    // The GM opens the dungeon tab: the scene is held, and the dungeon map loads into the same store.
    w.tabs.getState().setActiveTab(w.dungeon);
    w.store.setState({ isMapLoading: true });
    w.store.setState((state) => { state.objects.tokens = {}; state.isMapLoading = false; });
    expect(w.control.tokensOf(a.playerId)).toEqual(['hero']);
    w.presented.clear();
    w.store.setState((state) => { state.objects.tokens = {}; });
    expect(w.control.tokensOf(a.playerId)).toEqual(['hero']);
    // A map loading in the presented view is a load, not a deletion.
    w.tabs.getState().setActiveTab(w.tavern);
    w.store.setState((state) => { state.objects.tokens = partyTokensOnly(); });
    w.present();
    w.store.setState({ isMapLoading: true });
    w.store.setState((state) => { state.objects.tokens = {}; });
    w.store.setState({ isMapLoading: false });
    expect(w.control.tokensOf(a.playerId)).toEqual(['hero']);
    w.finish();
  });
});

/** hero alone, as a map file would load it. */
function partyTokensOnly(): never {
  return { hero: { id: 'hero', kind: 'character', x: 140, y: 140, name: 'Hero' } } as never;
}
```

- [ ] **Step 16: Run them to see them fail**

Run: `npx vitest run tests/unit/online/controlLists.test.ts`
Expected: FAIL. `src/app/online/control/TokenControlHost` cannot be resolved.

- [ ] **Step 17: Create `src/app/online/control/ControlLists.ts`**

```ts
/**
 * Sends each admitted player the tokens they control (`token-control`): on admission
 * (a reconnect and a replacing tab included), with every resync they ask for, and
 * whenever their assignments change. A `GmSession` handler registered after the
 * broadcaster and the camera sender, so the list follows the snapshot it goes with.
 * Control is per player and never part of the shared projection.
 */
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import type { SceneSession } from '../scene/sceneSources';
import type { TokenControl } from './TokenControl';

export interface ControlListsOptions {
  session: SceneSession;
  control: TokenControl;
}

export class ControlLists implements SessionHandler {
  private readonly stops: Array<() => void> = [];

  constructor(private readonly options: ControlListsOptions) {}

  start(): void {
    this.stops.push(
      this.options.session.use(this),
      this.options.control.onChange((playerIds) => playerIds.forEach((playerId) => this.send(playerId))),
    );
  }

  stop(): void {
    this.stops.splice(0).forEach((stop) => stop());
  }

  onAdmitted(player: SessionPlayer): void {
    this.send(player.playerId);
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type === 'scene-resync') this.send(player.playerId);
  }

  /** The session sends to admitted players only, so a gone or removed player gets nothing. */
  private send(playerId: string): void {
    this.options.session.send(playerId, { v: 1, type: 'token-control', tokenIds: this.options.control.tokensOf(playerId) });
  }
}
```

- [ ] **Step 18: Create `src/app/online/control/deletedTokens.ts`**

```ts
/**
 * Drops the assignments of tokens deleted from the presented scene. A token is deleted
 * when it was in the live store and is gone from it while the same map stays loaded:
 * holding the scene, loading a map, presenting another scene or clearing removes
 * nothing, so assignments come back with their scene.
 */
import type { PresentedSceneInfo } from '../../services/PresentedScene';
import type { ViewAtlasState } from '../../storeFactory';
import type { PresentedSceneSource } from '../scene/sceneSources';
import type { TokenControl } from './TokenControl';

type Tokens = ViewAtlasState['objects']['tokens'];

/** The loaded map's tokens; null while a map loads, when the store holds no scene of its own. */
function loadedTokens(state: ViewAtlasState): Tokens | null {
  return state.isMapLoading ? null : state.objects.tokens;
}

export function watchDeletedTokens(presented: PresentedSceneSource, control: TokenControl): () => void {
  let stopStore: (() => void) | null = null;
  const detach = (): void => {
    stopStore?.();
    stopStore = null;
  };
  const attach = (scene: PresentedSceneInfo): void => {
    detach();
    let previous = loadedTokens(scene.store.getState());
    stopStore = scene.store.subscribe((state) => {
      const tokens = loadedTokens(state);
      if (tokens === previous) return;
      const before = previous;
      previous = tokens;
      if (!tokens || !before) return;
      const gone = control.assignedTokens().filter((id) => Object.hasOwn(before, id) && !Object.hasOwn(tokens, id));
      if (gone.length > 0) control.dropTokens(gone);
    });
  };
  const stopListening = presented.subscribe({
    presented: (scene) => attach(scene),
    held: () => detach(),
    cleared: () => detach(),
  });
  const current = presented.current();
  if (current && !presented.isHeld()) attach(current);
  return () => {
    stopListening();
    detach();
  };
}
```

- [ ] **Step 19: Create `src/app/online/control/TokenControlHost.ts`**

```ts
/**
 * Everything one online session needs to let players move their own tokens: the
 * assignments (`TokenControl`), each player's list (`ControlLists`), the moves
 * (`TokenMoveHandler`) and dropping tokens deleted from the presented scene. Started
 * after the broadcaster and the camera sender, so its messages follow theirs.
 */
import type { SessionPlayer } from '../GmSession';
import type { CameraProjection } from '../scene/CameraSender';
import type { PresentedSceneSource, SceneSession } from '../scene/sceneSources';
import { ControlLists } from './ControlLists';
import { watchDeletedTokens } from './deletedTokens';
import { TokenControl } from './TokenControl';
import { TokenMoveHandler } from './TokenMoveHandler';

export interface TokenControlHostOptions {
  session: SceneSession;
  presented: PresentedSceneSource;
  /** The scene players have; moves are checked against it. */
  projection: Pick<CameraProjection, 'currentProjection'>;
}

export class TokenControlHost {
  readonly control = new TokenControl();
  private readonly lists: ControlLists;
  private readonly moves: TokenMoveHandler;
  private stopWatching: (() => void) | null = null;

  constructor(private readonly options: TokenControlHostOptions) {
    this.lists = new ControlLists({ session: options.session, control: this.control });
    this.moves = new TokenMoveHandler({ ...options, control: this.control });
  }

  start(): void {
    if (this.stopWatching) return;
    this.lists.start();
    this.moves.start();
    this.stopWatching = watchDeletedTokens(this.options.presented, this.control);
  }

  stop(): void {
    this.stopWatching?.();
    this.stopWatching = null;
    this.lists.stop();
    this.moves.stop();
  }

  /** The session's players changed: a removed (kicked) player loses their tokens; one who is only gone keeps them. */
  playersChanged(players: readonly SessionPlayer[]): void {
    this.control.retainPlayers(new Set(players.map((player) => player.playerId)));
  }
}
```

It imports `TokenMoveHandler`, created in Step 21. Write Step 21's file before running the tests.

#### 1g. Checked moves

- [ ] **Step 20: Write the failing move handler tests**

Create `tests/unit/online/tokenMoveHandler.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOVES_PER_SECOND } from '../../../src/app/online/control/TokenMoveHandler';
import { createHexLayout, nearestHexCenter } from '../../../src/app/grid/hexGeometry';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { moveWorld, partyState, type MoveWorld } from './tokenMoveFixtures';

async function withHero(w: MoveWorld) {
  w.present();
  const a = await w.join('A');
  w.control.set('hero', a.playerId, true);
  return a;
}

describe('token moves on the GM side', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("applies a controller's move snapped to the cell centre as one undo step, and players see it", async () => {
    const w = moveWorld();
    const a = await withHero(w);
    a.move('hero', 300, 150);
    expect(w.token('hero')).toMatchObject({ x: 315, y: 175 });
    expect(w.history().pastStates).toHaveLength(1);
    expect(a.refusals()).toEqual([]);
    await w.tick();
    expect(a.session.scene?.tokens.hero).toMatchObject({ x: 315, y: 175 });
    w.history().undo();
    expect(w.token('hero')).toMatchObject({ x: 140, y: 140 });
    w.finish();
  });

  it('refuses a move of a token the player does not control', async () => {
    const w = moveWorld();
    const a = await withHero(w);
    a.move('ally', 300, 150);
    expect(a.refusals()).toEqual(['ally']);
    expect(w.token('ally')).toMatchObject({ x: 280, y: 140 });
    expect(w.history().pastStates).toHaveLength(0);
    w.finish();
  });

  it('refuses a move for another scene, of a hidden token, of a fogged token, and of one players never saw', async () => {
    const w = moveWorld();
    const a = await withHero(w);
    for (const id of ['orc', 'goblin', 'unknown']) w.control.set(id, a.playerId, true);
    a.move('hero', 300, 150, 'an-older-scene');
    a.move('orc', 300, 150);
    a.move('goblin', 300, 150);
    a.move('unknown', 300, 150);
    expect(a.refusals()).toEqual(['hero', 'orc', 'goblin', 'unknown']);
    expect(w.history().pastStates).toHaveLength(0);
    w.finish();
  });

  it('refuses a token that left the projection between the drag and the drop', async () => {
    const w = moveWorld();
    const a = await withHero(w);
    w.store.setState((state) => { state.objects.tokens.hero!.isHidden = true; });
    await w.tick();
    a.move('hero', 300, 150);
    expect(a.refusals()).toEqual(['hero']);
    expect(w.token('hero')).toMatchObject({ x: 140, y: 140 });
    w.finish();
  });

  it('refuses a move while the scene is held, and writes nothing into the map the view shows now', async () => {
    const w = moveWorld();
    const a = await withHero(w);
    const sceneId = w.broadcaster.currentProjection()!.sceneId;
    w.tabs.getState().setActiveTab(w.dungeon);
    expect(w.presented.isHeld()).toBe(true);
    expect(w.broadcaster.currentProjection()?.sceneId).toBe(sceneId);
    a.move('hero', 300, 150, sceneId);
    expect(a.refusals()).toEqual(['hero']);
    expect(w.token('hero')).toMatchObject({ x: 140, y: 140 });
    expect(w.history().pastStates).toHaveLength(0);
    w.finish();
  });

  it('refuses a move while the presented map is loading', async () => {
    const w = moveWorld();
    const a = await withHero(w);
    w.store.setState({ isMapLoading: true });
    a.move('hero', 300, 150);
    expect(a.refusals()).toEqual(['hero']);
    w.finish();
  });

  it('refuses a coordinate too large for a number and keeps the connection', async () => {
    const w = moveWorld();
    const a = await withHero(w);
    const sceneId = w.broadcaster.currentProjection()!.sceneId;
    for (let attempt = 0; attempt < 3; attempt++) {
      a.sendRaw(`{"v":1,"type":"token-move","sceneId":"${sceneId}","tokenId":"hero","x":1e400,"y":0}`);
    }
    expect(a.refusals()).toEqual(['hero', 'hero', 'hero']);
    expect(a.session.state.status).toBe('admitted');
    a.move('hero', 300, 150);
    expect(w.token('hero')).toMatchObject({ x: 315, y: 175 });
    w.finish();
  });

  it('clamps to the map area before snapping', async () => {
    const w = moveWorld();
    const a = await withHero(w);
    a.move('hero', 5000, -300);
    expect(w.token('hero')).toMatchObject({ x: 1995, y: 35 });
    w.finish();
  });

  it("clamps to the scene's content without a map size", async () => {
    const w = moveWorld({ mapSize: { width: 0, height: 0 } });
    const a = await withHero(w);
    // hero (140, 140) and ally (280, 140) are what players see: 105..315 × 105..175, one cell around it.
    a.move('hero', 5000, 5000);
    expect(w.token('hero')).toMatchObject({ x: 385, y: 245 });
    w.finish();
  });

  it("snaps as the GM's drag does: hex cells, nothing with snapping off, and a switched-off grid still snaps", async () => {
    const hex = partyState();
    hex.grid = { ...hex.grid!, type: 'hex-vertical' };
    const w1 = moveWorld({ state: hex });
    (await withHero(w1)).move('hero', 300, 150);
    expect(w1.token('hero')).toMatchObject(nearestHexCenter(createHexLayout('hex-vertical', 70, 0, 0), { x: 300, y: 150 }));
    w1.finish();

    const free = partyState();
    free.grid = { ...free.grid!, snapToGrid: false };
    const w2 = moveWorld({ state: free });
    (await withHero(w2)).move('hero', 300.5, 150.25);
    expect(w2.token('hero')).toMatchObject({ x: 300.5, y: 150.25 });
    w2.finish();

    const off = partyState();
    off.grid = { ...off.grid!, enabled: false };
    const w3 = moveWorld({ state: off });
    (await withHero(w3)).move('hero', 300, 150);
    expect(w3.token('hero')).toMatchObject({ x: 315, y: 175 });
    w3.finish();
  });

  it(`ignores more than ${MOVES_PER_SECOND} moves a second from one player, without answering them`, async () => {
    const w = moveWorld();
    const a = await withHero(w);
    for (let cell = 1; cell <= 12; cell++) a.move('hero', cell * 70 + 35, 140);
    expect(w.history().pastStates).toHaveLength(MOVES_PER_SECOND);
    expect(w.token('hero')).toMatchObject({ x: 735, y: 175 });
    expect(a.refusals()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    a.move('hero', 105, 140);
    expect(w.token('hero')).toMatchObject({ x: 105, y: 175 });
    expect(w.history().pastStates).toHaveLength(MOVES_PER_SECOND + 1);
    w.finish();
  });

  it('applies both drops of a token two players control, in arrival order', async () => {
    const w = moveWorld();
    const a = await withHero(w);
    const b = await w.join('B');
    w.control.set('hero', b.playerId, true);
    a.move('hero', 300, 150);
    b.move('hero', 500, 150);
    expect(w.token('hero')).toMatchObject({ x: 525, y: 175 });
    expect(w.history().pastStates).toHaveLength(2);
    w.finish();
  });

  it('never answers a connection that is not admitted', async () => {
    const w = moveWorld();
    await withHero(w);
    const link = await w.network.client().connect('gm');
    const received: ControlMessage[] = [];
    link.onMessage((_channel, data) => {
      const decoded = decodeControl(data);
      if (decoded.kind === 'message') received.push(decoded.message);
    });
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Eve', playerKey: 'eve', client: { kind: 'web', version: '1' } }));
    const sceneId = w.broadcaster.currentProjection()!.sceneId;
    link.send('control', encodeControl({ v: 1, type: 'token-move', sceneId, tokenId: 'hero', x: 300, y: 150 }));
    expect(w.token('hero')).toMatchObject({ x: 140, y: 140 });
    expect(received.filter((message) => message.type === 'token-move-refused')).toEqual([]);
    w.finish();
  });
});
```

- [ ] **Step 21: Create `src/app/online/control/TokenMoveHandler.ts`**

```ts
/**
 * Applies the drops players send (`token-move`) to the presented scene. A move goes
 * through only when the sender controls the token, it is for the scene players have,
 * that scene is live (not held, not loading: a held view's store shows another map),
 * the token is in the projection (not hidden, not under fog) and the coordinates are
 * finite. The position is clamped to the map (or the scene's content without a map
 * size), snapped as the GM's drag snaps, and written in one undo step. A move that
 * fails a check gets `token-move-refused`; more than `MOVES_PER_SECOND` from one player
 * in a second are ignored. A `GmSession` handler; `GmSession` delivers only admitted
 * players' messages.
 */
import { snapDroppedToken } from '../../clipboard/mapObjectPlacement';
import { runHistoryTransaction } from '../../stores/history';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import { sceneWorldBounds, type PreviewRect } from '../preview/previewLayout';
import type { ControlMessage } from '../protocol';
import type { CameraProjection } from '../scene/CameraSender';
import type { PresentedSceneSource, SceneSession } from '../scene/sceneSources';
import type { ScenePoint } from '../scene/sceneTypes';
import type { TokenControl } from './TokenControl';

export const MOVES_PER_SECOND = 10;
const RATE_WINDOW_MS = 1000;

type TokenMove = Extract<ControlMessage, { type: 'token-move' }>;

export interface TokenMoveHandlerOptions {
  session: SceneSession;
  presented: PresentedSceneSource;
  /** The scene players have: moves are checked against it. */
  projection: Pick<CameraProjection, 'currentProjection'>;
  control: TokenControl;
}

/** At most `MOVES_PER_SECOND` moves per player in any one-second window; refused ones count. */
export class MoveRateLimit {
  private readonly recent = new Map<string, number[]>();

  allow(playerId: string, now: number): boolean {
    const times = (this.recent.get(playerId) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
    const allowed = times.length < MOVES_PER_SECOND;
    if (allowed) times.push(now);
    this.recent.set(playerId, times);
    return allowed;
  }

  forget(playerId: string): void {
    this.recent.delete(playerId);
  }
}

export class TokenMoveHandler implements SessionHandler {
  private readonly limit = new MoveRateLimit();
  private stopSession: (() => void) | null = null;

  constructor(private readonly options: TokenMoveHandlerOptions) {}

  start(): void {
    if (!this.stopSession) this.stopSession = this.options.session.use(this);
  }

  stop(): void {
    this.stopSession?.();
    this.stopSession = null;
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type !== 'token-move' || !this.limit.allow(player.playerId, Date.now())) return;
    if (this.apply(player.playerId, message)) return;
    // Only the id the player sent: a refusal says nothing about why, or about other tokens.
    this.options.session.send(player.playerId, { v: 1, type: 'token-move-refused', tokenId: message.tokenId });
  }

  onGone(player: SessionPlayer): void {
    this.limit.forget(player.playerId);
  }

  /** Whether the move passed every check and was written. */
  private apply(playerId: string, move: TokenMove): boolean {
    const { control, presented, projection } = this.options;
    if (!control.controls(playerId, move.tokenId)) return false;
    const scene = projection.currentProjection();
    const live = presented.current();
    if (!scene || scene.sceneId !== move.sceneId || !live || presented.isHeld()) return false;
    const state = live.store.getState();
    if (state.isMapLoading || !Object.hasOwn(scene.tokens, move.tokenId) || !Object.hasOwn(state.objects.tokens, move.tokenId)) return false;
    if (!Number.isFinite(move.x) || !Number.isFinite(move.y)) return false;
    const { x, y } = snapDroppedToken(state.grid, clampTo({ x: move.x, y: move.y }, sceneWorldBounds(scene)));
    runHistoryTransaction(live.store, () => live.store.getState().setTokenPositions([{ id: move.tokenId, x, y }]));
    return true;
  }
}

function clampTo(point: ScenePoint, bounds: PreviewRect | null): ScenePoint {
  if (!bounds) return point;
  return {
    x: Math.min(bounds.x + bounds.width, Math.max(bounds.x, point.x)),
    y: Math.min(bounds.y + bounds.height, Math.max(bounds.y, point.y)),
  };
}
```

- [ ] **Step 22: Run the GM-side tests**

Run: `npx vitest run tests/unit/online/controlLists.test.ts tests/unit/online/tokenMoveHandler.test.ts tests/unit/online/tokenControl.test.ts`
Expected: PASS.

If `keeps assignments while the scene is held, another map loads or presenting stops` fails on its last expectation, check two things in `watchDeletedTokens`:
- `previous` becomes `null` while `isMapLoading` is true;
- a store change from `null` to tokens drops nothing.

Do not weaken the test.

#### 1h. End to end over `MemoryTransport`

- [ ] **Step 23: Write the end-to-end test**

Create `tests/unit/online/tokenMovesEndToEnd.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveWorld } from './tokenMoveFixtures';

describe('token moves end to end', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("brings a player's drop to the GM's store and back to every player as a patch; others are refused", async () => {
    const w = moveWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    w.control.set('hero', a.playerId, true);
    w.control.set('orc', a.playerId, true);

    a.move('hero', 300, 150);
    await w.tick();
    for (const player of [a, b]) {
      expect(player.session.scene).toEqual(w.broadcaster.currentProjection());
      expect(player.session.scene?.tokens.hero).toMatchObject({ x: 315, y: 175 });
    }
    expect(b.received.filter((message) => message.type === 'scene-patch').length).toBeGreaterThan(0);

    // Unassigned, hidden, and a token another player controls.
    a.move('ally', 300, 150);
    a.move('orc', 300, 150);
    b.move('hero', 600, 150);
    expect(a.refusals()).toEqual(['ally', 'orc']);
    expect(b.refusals()).toEqual(['hero']);
    expect(w.token('hero')).toMatchObject({ x: 315, y: 175 });
    // Nothing about the hidden orc reached anyone but its id, which A sent itself.
    expect(JSON.stringify(b.received)).not.toContain('"orc"');
    w.finish();
  });
});
```

- [ ] **Step 24: Run it**

Run: `npx vitest run tests/unit/online/tokenMovesEndToEnd.test.ts`
Expected: PASS.

#### 1i. Wiring and the Controlled by submenu

- [ ] **Step 25: Write the failing submenu and service tests**

Create `tests/unit/online/controlledByMenu.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { TokenControl } from '../../../src/app/online/control/TokenControl';
import type { SessionPlayer } from '../../../src/app/online/GmSession';
import { onlineSessionStore, resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import { CONTROLLED_BY_LABEL, controlledBySubmenu, NO_PLAYERS_LABEL } from '../../../src/app/online/ui/controlledByMenu';
import type { ContextMenuEntry } from '../../../src/app/react/root/ContextMenuContext';

type Item = Extract<ContextMenuEntry, { type: 'item' }>;

function items(entry: ContextMenuEntry | null): Item[] {
  if (entry?.type !== 'submenu') throw new Error('expected a submenu');
  const children = typeof entry.children === 'function' ? entry.children() : entry.children;
  return children as Item[];
}

const players: SessionPlayer[] = [
  { playerId: 'p1', name: 'Anna', status: 'admitted' },
  { playerId: 'p2', name: 'Bob', status: 'admitted' },
  { playerId: 'p3', name: 'Cy', status: 'pending' },
  { playerId: 'p4', name: 'Dan', status: 'gone' },
];

function hosting(list: SessionPlayer[] = players): TokenControl {
  const control = new TokenControl();
  onlineSessionStore.setState({ status: 'hosting', tokenControl: control, players: list });
  return control;
}

describe('Controlled by', () => {
  afterEach(() => { resetOnlineSessionStore(); });

  it('is not offered while no session runs', () => {
    expect(controlledBySubmenu('hero')).toBeNull();
  });

  it('lists every admitted player as a checkbox that gives or takes the token', () => {
    const control = hosting();
    const entry = controlledBySubmenu('hero');
    expect(entry).toMatchObject({ type: 'submenu', label: CONTROLLED_BY_LABEL });
    expect(items(entry).map(({ label, checked, keepOpen }) => ({ label, checked, keepOpen }))).toEqual([
      { label: 'Anna', checked: false, keepOpen: true },
      { label: 'Bob', checked: false, keepOpen: true },
    ]);
    items(entry)[1]!.onClick();
    expect(control.tokensOf('p2')).toEqual(['hero']);
    expect(items(entry)[1]!.checked).toBe(true);
    items(entry)[1]!.onClick();
    expect(control.tokensOf('p2')).toEqual([]);
  });

  it('says no players are connected while nobody is admitted', () => {
    hosting(players.slice(2));
    expect(items(controlledBySubmenu('hero')).map(({ label, disabled }) => ({ label, disabled }))).toEqual([
      { label: NO_PLAYERS_LABEL, disabled: true },
    ]);
  });

  it('tells an open submenu about assignment and player changes until it closes', () => {
    const control = hosting();
    const entry = controlledBySubmenu('hero');
    if (entry?.type !== 'submenu' || !entry.subscribe) throw new Error('expected a live submenu');
    let changes = 0;
    const stop = entry.subscribe(() => { changes++; });
    control.set('hero', 'p1', true);
    onlineSessionStore.setState({ players: players.slice(0, 1) });
    expect(changes).toBe(2);
    stop();
    control.set('hero', 'p1', false);
    expect(changes).toBe(2);
  });
});
```

Add to `tests/unit/online/onlineSessionService.test.ts`. First extend the imports:
- add `ControlMessage` to the import from `protocol`: `import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';`
- add `import { moveSceneStore } from './tokenMoveFixtures';`

Then add this test inside `describe('OnlineSessionService', …)`:

```ts
  it('lets admitted players move the tokens the GM assigns, until they are removed or the session stops', async () => {
    const presented = new PresentedScene();
    const { store } = moveSceneStore();
    const tabs = createTabMetaStore();
    const tavern = tabs.getState().addTab('maps/tavern.atlasmap', 'Tavern');
    tabs.getState().setActiveTab(tavern);
    presented.present({
      tabMetaStore: tabs, atlasStore: store, register: () => {},
      renderer: { getBackgroundSprite: () => ({ width: 2000, height: 1500, destroyed: false }) },
    } as never, tavern);
    const { svc, notices, network } = service(new MemoryNetwork(), presented);
    await svc.start();
    const link = await network.client().connect('gm-id');
    const received: ControlMessage[] = [];
    link.onMessage((_channel, data) => {
      const decoded = decodeControl(data);
      if (decoded.kind === 'message') received.push(decoded.message);
    });
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Anna', playerKey: 'k', client: { kind: 'web', version: '1' } }));
    notices[0]!.answer(true);
    const { players, tokenControl } = onlineSessionStore.getState();
    const playerId = players[0]!.playerId;
    tokenControl!.set('hero', playerId, true);
    expect(received.filter((message) => message.type === 'token-control').at(-1)).toEqual({ v: 1, type: 'token-control', tokenIds: ['hero'] });
    const snapshot = received.find((message) => message.type === 'scene-snapshot') as Extract<ControlMessage, { type: 'scene-snapshot' }>;
    link.send('control', encodeControl({ v: 1, type: 'token-move', sceneId: snapshot.scene.sceneId, tokenId: 'hero', x: 300, y: 150 }));
    expect(store.getState().objects.tokens.hero).toMatchObject({ x: 315, y: 175 });
    svc.kick(playerId);
    expect(tokenControl!.tokensOf(playerId)).toEqual([]);
    svc.stop();
    expect(onlineSessionStore.getState().tokenControl).toBeNull();
  });
```

- [ ] **Step 26: Run them to see them fail**

Run: `npx vitest run tests/unit/online/controlledByMenu.test.ts tests/unit/online/onlineSessionService.test.ts`
Expected: FAIL. `controlledByMenu` cannot be resolved, and `tokenControl` is `undefined` in the service test.

- [ ] **Step 27: Publish `tokenControl` in `src/app/online/onlineSessionStore.ts`**

Replace the file with:

```ts
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { TokenControl } from './control/TokenControl';
import type { SessionPlayer } from './GmSession';

export interface OnlineSessionState {
  status: 'idle' | 'starting' | 'hosting' | 'error';
  peerId: string | null;
  joinUrl: string | null;
  players: SessionPlayer[];
  error: string | null;
  /** Who may move which token while hosting; null otherwise. The token menu reads it. */
  tokenControl: TokenControl | null;
}

const INITIAL_STATE: OnlineSessionState = { status: 'idle', peerId: null, joinUrl: null, players: [], error: null, tokenControl: null };

/** The online session as the GM's UI sees it, written by `OnlineSessionService`. */
export const onlineSessionStore: StoreApi<OnlineSessionState> = createStore<OnlineSessionState>(() => INITIAL_STATE);

export function resetOnlineSessionStore(): void {
  onlineSessionStore.setState(INITIAL_STATE);
}
```

- [ ] **Step 28: Wire the host into `src/app/online/OnlineSessionService.ts`**

1. Add the import after `import { CameraSender } from './scene/CameraSender';`:

```ts
import { TokenControlHost } from './control/TokenControlHost';
```

2. Add the field after `private cameraSender: CameraSender | null = null;`:

```ts
  private tokenControlHost: TokenControlHost | null = null;
```

3. In `host()`, make the `onPlayersChanged` option read:

```ts
      onPlayersChanged: (players) => {
        log.event('players', { players: players.map((player) => `${player.name}: ${player.status}`).join(', ') });
        // A kick reaches no handler: the host keeps only the players the session still knows.
        this.tokenControlHost?.playersChanged(players);
        onlineSessionStore.setState({ players, error: null });
      },
```

4. After `this.cameraSender = cameraSender;` add:

```ts
    // Players move the tokens the GM assigns them; registered last, so control lists follow snapshots and cameras.
    const tokenControlHost = new TokenControlHost({ session: scenes, presented: this.presented, projection: broadcaster });
    this.tokenControlHost = tokenControlHost;
```

5. In the `try` block, after `assetServer.start();` add `tokenControlHost.start();`.

6. Make the final `setState` read:

```ts
    onlineSessionStore.setState({
      status: 'hosting', peerId: host.id, joinUrl, error: linkWorks ? null : RELAY_TOO_LONG, tokenControl: tokenControlHost.control,
    });
```

7. In `teardown()`, before `this.cameraSender?.stop();` add:

```ts
    this.tokenControlHost?.stop();
    this.tokenControlHost = null;
```

- [ ] **Step 29: Create `src/app/online/ui/controlledByMenu.ts`**

```ts
/**
 * "Controlled by" in a character token's context menu while an online session runs:
 * every admitted player as a checkbox. Assignments live in the session's
 * `TokenControl`, never in token data. Read through `onlineSessionStore`, so the token
 * renderer does not import the session service (and PeerJS with it).
 */
import type { ContextMenuEntry } from '../../react/root/ContextMenuContext';
import type { TokenControl } from '../control/TokenControl';
import type { SessionPlayer } from '../GmSession';
import { onlineSessionStore } from '../onlineSessionStore';

export const CONTROLLED_BY_LABEL = 'Controlled by';
export const NO_PLAYERS_LABEL = 'No players connected';

/** The submenu for `tokenId`; null while no session is hosted. */
export function controlledBySubmenu(tokenId: string): ContextMenuEntry | null {
  const { status, tokenControl } = onlineSessionStore.getState();
  if (status !== 'hosting' || !tokenControl) return null;
  return {
    type: 'submenu',
    label: CONTROLLED_BY_LABEL,
    icon: 'users',
    children: () => playerEntries(onlineSessionStore.getState().tokenControl, onlineSessionStore.getState().players, tokenId),
    // An open submenu follows assignments made elsewhere and players joining or leaving.
    subscribe: (onChange) => {
      const stopControl = tokenControl.onChange(() => onChange());
      const stopStore = onlineSessionStore.subscribe(() => onChange());
      return () => {
        stopControl();
        stopStore();
      };
    },
  };
}

function playerEntries(control: TokenControl | null, players: readonly SessionPlayer[], tokenId: string): ContextMenuEntry[] {
  const admitted = control ? players.filter((player) => player.status === 'admitted') : [];
  if (!control || admitted.length === 0) {
    return [{ type: 'item', label: NO_PLAYERS_LABEL, disabled: true, onClick: () => undefined }];
  }
  return admitted.map((player): ContextMenuEntry => ({
    type: 'item',
    label: player.name,
    checked: control.controls(player.playerId, tokenId),
    keepOpen: true,
    onClick: () => control.set(tokenId, player.playerId, !control.controls(player.playerId, tokenId)),
  }));
}
```

- [ ] **Step 30: Add the submenu to character tokens in `src/app/pixi/token-renderer/InteractionController.ts`**

After `import { conditionsSubmenu } from '../../react/components/context-menu/conditionsMenu';` add:

```ts
import { controlledBySubmenu } from '../../online/ui/controlledByMenu';
```

In `showContextMenu`, directly after the Hide/Show `entries.push({ … });` block (the one whose `onClick` calls `updateTokens(hideTargets.map(…))`), add:

```ts

    // Which online players may move this token, while a session runs (DM only)
    const controlledBy = !this.isPlayerView && character ? controlledBySubmenu(token.id) : null;
    if (controlledBy) entries.push(controlledBy);
```

- [ ] **Step 31: Run the online tests, the type check and lint**

Run: `npx vitest run tests/unit/online && npx tsc --noEmit && npx eslint src/app/online src/app/clipboard/mapObjectPlacement.ts src/app/pixi/token-renderer/InteractionController.ts --max-warnings 0 --suppressions-location eslint.suppressions.json`
Expected: PASS, and both commands exit 0.

- [ ] **Step 32: Check file sizes**

Run: `wc -l src/app/online/GmSession.ts src/app/online/OnlineSessionService.ts src/app/online/protocol.ts src/app/online/control/*.ts src/app/online/ui/controlledByMenu.ts src/app/online/scene/SceneBroadcaster.ts`
Expected:
- `GmSession.ts` is 302 lines and `SceneBroadcaster.ts` is 300, both unchanged by this task.
- `OnlineSessionService.ts` is under 200 lines.
- Every file under `control/` is under 150 lines.

- [ ] **Step 33: Commit**

```bash
git add src/app/online/protocol.ts src/app/online/GmSession.ts src/app/clipboard/mapObjectPlacement.ts src/app/online/control src/app/online/onlineSessionStore.ts src/app/online/OnlineSessionService.ts src/app/online/ui/controlledByMenu.ts src/app/pixi/token-renderer/InteractionController.ts tests/unit/online/protocol.test.ts tests/unit/online/gmSession.test.ts tests/unit/online/onlineSessionService.test.ts tests/unit/online/tokenMoveFixtures.ts tests/unit/online/tokenControl.test.ts tests/unit/online/controlLists.test.ts tests/unit/online/tokenMoveHandler.test.ts tests/unit/online/controlledByMenu.test.ts tests/unit/online/tokenMovesEndToEnd.test.ts
git commit -m "feat(online): the GM assigns tokens to players and applies their checked moves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q6CPZpZ7Wn79w7u8cBLtRr"
```

---
### Task 2: The player's side (control list, dragging, previews, the join page)

**Files:**
- Modify: `src/app/online/PlayerSession.ts` (options, a field, `controlledTokens`, `sendTokenMove`, two `receive` cases, `finish`)
- Create: `src/app/online/view/tokenHit.ts`, `src/app/online/view/TokenMoves.ts`
- Modify (whole file given): `src/app/online/view/ViewInput.ts`, `src/app/online/view/layers/layerTypes.ts`, `src/app/online/view/layers/tokensLayer.ts`
- Modify: `src/app/online/view/CameraController.ts` (`toWorld`), `src/app/online/view/PlayerViewRenderer.ts` (`setOverlay`)
- Modify (whole file given): `online-client/mapView.mts`
- Modify: `online-client/main.mts`, `online-client/index.html`, `online-client/style.css`
- Test: `tests/unit/online/playerSessionMoves.test.ts`, `tokenHit.test.ts`, `tokenMoves.test.ts` (create); `viewInput.test.ts`, `tokensLayer.test.ts`, `playerViewRenderer.test.ts`, `cameraController.test.ts`, `mapView.test.ts`, `recordingSurface.ts` (modify)

**Interfaces:**
- Consumes from Task 1:
  - the `token-control`, `token-move` and `token-move-refused` members of `ControlMessage` (`protocol.ts`);
  - the test fixture `moveWorld()` from `tests/unit/online/tokenMoveFixtures.ts`, whose `join(key, extra)` passes `extra` into `PlayerSessionOptions`, plus `MovePlayer.session`, `MoveWorld.control`, `.present()`, `.token(id)`, `.gm`, `.finish()`.
- Consumes (existing):
  - `computeTokenPixelSize(cellSize, size)` (`pixi/token-renderer/tokenSizing.ts`)
  - `screenToWorld(camera, screen, point)` (`view/camera.ts`)
  - `TAP_SLOP = 6` (`view/ViewInput.ts`)
  - `applyPatch`, which keeps the records of untouched tokens.
- Produces:
  - `PlayerSessionOptions.onControl?(tokenIds: readonly string[]): void` and `.onMoveRefused?(tokenId: string): void`
  - `PlayerSession.controlledTokens: readonly string[]`
  - `PlayerSession.sendTokenMove(tokenId: string, x: number, y: number): boolean`
  - `controlledTokenAt(scene, controlled: ReadonlySet<string>, positions: ReadonlyMap<string, ScenePoint>, point: ScenePoint): string | null`
  - `interface TokenGrab { grab(point): boolean; move(point): void; drop(point): void; cancel(): void }` and `new ViewInput(camera, tokens?: TokenGrab | null)`
  - `class TokenMoves implements TokenGrab`: `new TokenMoves({ toWorld, send, onChange })`, `setScene`, `setControlled`, `setConnected`, `refused`, `canGrab`, `isDragging`, `notice`, `overlay`, `dispose`
  - Constants `CONFIRM_TIMEOUT_MS = 2000`, `REFUSED_NOTICE_MS = 3000`, `MOVE_REFUSED_TEXT = 'Move not allowed.'`
  - `interface TokenOverlay { controlled: ReadonlySet<string>; positions: ReadonlyMap<string, ScenePoint> }`, `NO_TOKEN_OVERLAY`, `LayerFrame.overlay`
  - `CONTROLLED_RING_COLOR = '#facc15'`
  - `CameraController.toWorld(point: ScreenPoint): ScreenPoint`
  - `PlayerViewRenderer.setOverlay(overlay: TokenOverlay): void`
  - `MapViewOptions.sendMove(tokenId, x, y): boolean`, `MapViewOptions.notice: HTMLElement`, and `MapView.setControlled(tokenIds)`, `.setConnected(connected)`, `.moveRefused(tokenId)`

Rulings this task implements: 12, 13, 14, 15 and 16 (see the top of the plan).

#### 2a. The session keeps the list and sends drops

- [ ] **Step 1: Write the failing session tests**

Create `tests/unit/online/playerSessionMoves.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PeerLink } from '../../../src/app/online/transport/types';
import { moveWorld } from './tokenMoveFixtures';

describe('PlayerSession token moves', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('hears its control list and refusals, and sends one drop for the scene it has', async () => {
    const w = moveWorld();
    w.present();
    const lists: string[][] = [];
    const refused: string[] = [];
    const a = await w.join('A', { onControl: (ids) => lists.push([...ids]), onMoveRefused: (id) => refused.push(id) });
    // The empty list on admission changes nothing, so it tells nobody.
    expect(lists).toEqual([]);
    w.control.set('hero', a.playerId, true);
    expect(lists).toEqual([['hero']]);
    expect(a.session.controlledTokens).toEqual(['hero']);
    expect(a.session.sendTokenMove('hero', 300, 150)).toBe(true);
    expect(w.token('hero')).toMatchObject({ x: 315, y: 175 });
    expect(a.session.sendTokenMove('ally', 300, 150)).toBe(true);
    expect(refused).toEqual(['ally']);
    w.finish();
  });

  it('sends nothing before a scene or while reconnecting, gets its list again after, and forgets it when removed', async () => {
    const w = moveWorld();
    const lists: string[][] = [];
    const a = await w.join('A', { onControl: (ids) => lists.push([...ids]) });
    w.control.set('hero', a.playerId, true);
    expect(a.session.sendTokenMove('hero', 300, 150)).toBe(false);
    w.present();
    (a.session as unknown as { link: PeerLink }).link.close();
    expect(a.session.state.status).toBe('connecting');
    expect(a.session.sendTokenMove('hero', 300, 150)).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(a.session.state.status).toBe('admitted');
    expect(lists.at(-1)).toEqual(['hero']);
    expect(a.session.sendTokenMove('hero', 300, 150)).toBe(true);
    w.gm.kick(a.playerId);
    expect(a.session.state.status).toBe('denied');
    expect(lists.at(-1)).toEqual([]);
    expect(a.session.controlledTokens).toEqual([]);
    expect(a.session.sendTokenMove('hero', 300, 150)).toBe(false);
    w.finish();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/online/playerSessionMoves.test.ts`
Expected: FAIL. `sendTokenMove` is not a function, and `lists` stays empty.

- [ ] **Step 3: Extend `src/app/online/PlayerSession.ts`**

1. In `PlayerSessionOptions`, after the `onCamera?` member, add:

```ts
  /** The tokens this player may move: the GM's latest `token-control` list; empty once the session is over. */
  onControl?(tokenIds: readonly string[]): void;
  /** The GM refused this player's move of the token. */
  onMoveRefused?(tokenId: string): void;
```

2. After `private lastCamera: SceneCamera | null = null;` add:

```ts
  private controlled: readonly string[] = [];
```

3. After the `get camera()` getter add:

```ts
  /** The tokens this player may move, from the GM's latest list. */
  get controlledTokens(): readonly string[] {
    return this.controlled;
  }

  /**
   * Sends one drop of a token for the scene this player has. False when it cannot go
   * (not admitted, no link, no scene), so the drag sends nothing. The GM checks it.
   */
  sendTokenMove(tokenId: string, x: number, y: number): boolean {
    const scene = this.mirror.scene;
    if (this.finished || this.state.status !== 'admitted' || !this.link || !scene) return false;
    this.link.send('control', encodeControl({ v: 1, type: 'token-move', sceneId: scene.sceneId, tokenId, x, y }));
    return true;
  }
```

4. In `receive`, before `default:`, add:

```ts
      case 'token-control':
        this.setControlled(message.tokenIds);
        break;
      case 'token-move-refused':
        this.options.onMoveRefused?.(message.tokenId);
        break;
```

5. In `finish`, after `this.leaveAssets();` add `this.setControlled([]);`.

6. After `leaveAssets()` add:

```ts
  /** Keeps the GM's list; an empty list after an empty one tells nobody. */
  private setControlled(tokenIds: readonly string[]): void {
    if (tokenIds.length === 0 && this.controlled.length === 0) return;
    this.controlled = tokenIds;
    this.options.onControl?.(tokenIds);
  }
```

- [ ] **Step 4: Run the session tests**

Run: `npx vitest run tests/unit/online/playerSessionMoves.test.ts tests/unit/online/playerSession.test.ts tests/unit/online/playerSessionScene.test.ts tests/unit/online/joinSession.test.ts`
Expected: PASS.

#### 2b. Hit-testing and the move state

- [ ] **Step 5: Write the failing hit-test and `TokenMoves` tests**

Create `tests/unit/online/tokenHit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { controlledTokenAt } from '../../../src/app/online/view/tokenHit';
import { playerScene, playerToken } from './sceneFixtures';

// On the 70 px cells of `playerScene` a size-1 token's art is 62 px wide: radius 31.
const scene = playerScene({
  tokens: {
    low: playerToken({ x: 100, y: 100, layer: 0 }),
    high: playerToken({ x: 120, y: 100, layer: 1 }),
    other: playerToken({ x: 300, y: 100 }),
  },
});
const both = new Set(['low', 'high']);
const unmoved = new Map<string, { x: number; y: number }>();

describe('controlledTokenAt', () => {
  it('finds a controlled token inside the circle its art is drawn in', () => {
    expect(controlledTokenAt(scene, both, unmoved, { x: 70, y: 100 })).toBe('low');
    expect(controlledTokenAt(scene, both, unmoved, { x: 68, y: 100 })).toBeNull();
  });

  it('takes the topmost of overlapping tokens, as the tokens layer draws them', () => {
    expect(controlledTokenAt(scene, both, unmoved, { x: 110, y: 100 })).toBe('high');
  });

  it('ignores tokens the player does not control, and ids the scene does not have', () => {
    expect(controlledTokenAt(scene, both, unmoved, { x: 300, y: 100 })).toBeNull();
    expect(controlledTokenAt(scene, new Set(['ghost', '__proto__']), unmoved, { x: 100, y: 100 })).toBeNull();
  });

  it('hits a dragged or waiting token where it is shown', () => {
    const moved = new Map([['low', { x: 500, y: 500 }]]);
    expect(controlledTokenAt(scene, new Set(['low']), moved, { x: 500, y: 520 })).toBe('low');
    expect(controlledTokenAt(scene, new Set(['low']), moved, { x: 100, y: 100 })).toBeNull();
  });
});
```

Create `tests/unit/online/tokenMoves.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerScene } from '../../../src/app/online/scene/sceneTypes';
import { CONFIRM_TIMEOUT_MS, MOVE_REFUSED_TEXT, REFUSED_NOTICE_MS, TokenMoves } from '../../../src/app/online/view/TokenMoves';
import { playerScene, playerToken } from './sceneFixtures';

const scene = playerScene({ tokens: { t1: playerToken(), t2: playerToken({ x: 300 }) } });

/** The scene with t1's record replaced, as the GM's patch replaces it. */
function withT1(base: PlayerScene, x: number, y: number): PlayerScene {
  return { ...base, tokens: { ...base.tokens, t1: playerToken({ x, y }) } };
}

function setup() {
  const sent: Array<[string, number, number]> = [];
  let accept = true;
  let changes = 0;
  // Screen and world coincide here: the camera is tested on its own.
  const moves = new TokenMoves({
    toWorld: (point) => ({ x: point.x, y: point.y }),
    send: (tokenId, x, y) => {
      sent.push([tokenId, x, y]);
      return accept;
    },
    onChange: () => { changes++; },
  });
  moves.setScene(scene);
  moves.setControlled(['t1']);
  moves.setConnected(true);
  return { moves, sent, refuseSending: (): void => { accept = false; }, changes: (): number => changes };
}

const positions = (moves: TokenMoves): Record<string, { x: number; y: number }> => Object.fromEntries(moves.overlay().positions);

/** Grabs t1 (at 100, 100) 10 px left of and 5 px above its centre, and drags it 100 px right. */
function dragT1(moves: TokenMoves): void {
  expect(moves.grab({ x: 90, y: 95 })).toBe(true);
  moves.move({ x: 190, y: 95 });
}

describe('TokenMoves', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('grabs only controlled tokens, and nothing while disconnected', () => {
    const { moves } = setup();
    expect(moves.canGrab({ x: 300, y: 100 })).toBe(false);
    expect(moves.grab({ x: 300, y: 100 })).toBe(false);
    expect(moves.canGrab({ x: 100, y: 100 })).toBe(true);
    moves.setConnected(false);
    expect(moves.grab({ x: 100, y: 100 })).toBe(false);
  });

  it('shows the token under the pointer where it was grabbed, sends nothing until release, then one move', () => {
    const { moves, sent, changes } = setup();
    const before = changes();
    dragT1(moves);
    expect(changes()).toBeGreaterThan(before);
    expect(moves.isDragging()).toBe(true);
    expect(positions(moves)).toEqual({ t1: { x: 200, y: 100 } });
    moves.move({ x: 240, y: 145 });
    expect(sent).toEqual([]);
    moves.drop({ x: 240, y: 145 });
    expect(sent).toEqual([['t1', 250, 150]]);
    expect(moves.isDragging()).toBe(false);
    expect(positions(moves)).toEqual({ t1: { x: 250, y: 150 } });
    expect(moves.overlay().controlled).toEqual(new Set(['t1']));
  });

  it("keeps the token at the drop spot until the scene brings the GM's position", () => {
    const { moves } = setup();
    dragT1(moves);
    moves.drop({ x: 190, y: 95 });
    // Another change of the scene is not the answer.
    moves.setScene({ ...scene, widgets: [] });
    expect(positions(moves)).toEqual({ t1: { x: 200, y: 100 } });
    moves.setScene(withT1(scene, 205, 105));
    expect(positions(moves)).toEqual({});
  });

  it('drops the preview after two seconds without an update, as when the GM put the token back where it was', () => {
    const { moves } = setup();
    dragT1(moves);
    moves.drop({ x: 190, y: 95 });
    vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS - 1);
    expect(positions(moves)).toEqual({ t1: { x: 200, y: 100 } });
    vi.advanceTimersByTime(1);
    expect(positions(moves)).toEqual({});
  });

  it('puts a refused token back and says so for a few seconds', () => {
    const { moves } = setup();
    dragT1(moves);
    moves.drop({ x: 190, y: 95 });
    moves.refused('t1');
    expect(positions(moves)).toEqual({});
    expect(moves.notice()).toBe(MOVE_REFUSED_TEXT);
    vi.advanceTimersByTime(REFUSED_NOTICE_MS - 1);
    expect(moves.notice()).toBe(MOVE_REFUSED_TEXT);
    vi.advanceTimersByTime(1);
    expect(moves.notice()).toBeNull();
  });

  it('sends nothing for a cancelled drag', () => {
    const cancels: Array<[string, (moves: TokenMoves) => void]> = [
      ['Escape or pointer cancel', (moves) => moves.cancel()],
      ['connection lost', (moves) => moves.setConnected(false)],
      ['the token left the scene', (moves) => moves.setScene({ ...scene, tokens: { t2: scene.tokens.t2! } })],
      ['a new scene', (moves) => moves.setScene({ ...scene, sceneId: 'scene-2' })],
      ['control lost', (moves) => moves.setControlled([])],
    ];
    for (const [label, cancel] of cancels) {
      const { moves, sent } = setup();
      dragT1(moves);
      cancel(moves);
      expect(moves.isDragging(), label).toBe(false);
      moves.drop({ x: 240, y: 145 });
      expect(sent, label).toEqual([]);
      expect(moves.overlay().positions.size, label).toBe(0);
    }
  });

  it('shows no preview for a drop that could not be sent', () => {
    const { moves, sent, refuseSending } = setup();
    refuseSending();
    dragT1(moves);
    moves.drop({ x: 190, y: 95 });
    expect(sent).toHaveLength(1);
    expect(positions(moves)).toEqual({});
  });

  it('grabs a waiting token where it is shown, and drops every preview with a new scene', () => {
    const { moves } = setup();
    dragT1(moves);
    moves.drop({ x: 190, y: 95 });
    expect(moves.canGrab({ x: 100, y: 100 })).toBe(false);
    expect(moves.grab({ x: 200, y: 100 })).toBe(true);
    moves.cancel();
    moves.setScene({ ...scene, sceneId: 'scene-2' });
    expect(positions(moves)).toEqual({});
  });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `npx vitest run tests/unit/online/tokenHit.test.ts tests/unit/online/tokenMoves.test.ts`
Expected: FAIL. `view/tokenHit` and `view/TokenMoves` cannot be resolved.

- [ ] **Step 7: Create `src/app/online/view/tokenHit.ts`**

```ts
/**
 * Which of the player's tokens is under a world point, as the tokens layer draws them:
 * the art's circle, at the position shown (a drag or drop preview included), the one
 * drawn last (highest layer, then latest in the scene) on top. Shared with the web page.
 */
import { computeTokenPixelSize } from '../../pixi/token-renderer/tokenSizing';
import type { PlayerScene, ScenePoint } from '../scene/sceneTypes';

export function controlledTokenAt(
  scene: PlayerScene,
  controlled: ReadonlySet<string>,
  positions: ReadonlyMap<string, ScenePoint>,
  point: ScenePoint,
): string | null {
  const cellSize = scene.map.cellSize;
  let top: { id: string; layer: number } | null = null;
  for (const [id, token] of Object.entries(scene.tokens)) {
    if (!controlled.has(id)) continue;
    const at = positions.get(id) ?? token;
    // The same size the layer draws, never below a pixel.
    const radius = Math.max(1, computeTokenPixelSize(cellSize, token.size)) / 2;
    if (Math.hypot(point.x - at.x, point.y - at.y) > radius) continue;
    if (!top || token.layer >= top.layer) top = { id, layer: token.layer };
  }
  return top?.id ?? null;
}
```

- [ ] **Step 8: Add `TokenOverlay` to `src/app/online/view/layers/layerTypes.ts`**

Replace the file with:

```ts
/** What every layer of the player view gets for one frame. Shared with the web page. */
import type { DecodedImage } from '../../assets/AssetLoader';
import type { PlayerScene, ScenePoint } from '../../scene/sceneTypes';
import type { WorldRect } from '../camera';
import type { ViewSurface } from '../ViewSurface';

/**
 * The loaded image for an asset id, or null while it is missing. Looked up at draw time,
 * never kept: images are released when they leave the scene.
 */
export type ImageLookup = (id: string | null) => DecodedImage | null;

/** What this player's own token moves change in the tokens layer; only their view has it. */
export interface TokenOverlay {
  /** The tokens this player controls: drawn with a highlight ring. */
  controlled: ReadonlySet<string>;
  /** Where tokens being dragged, or waiting for the GM's answer, are drawn instead of their scene position. */
  positions: ReadonlyMap<string, ScenePoint>;
}

export const NO_TOKEN_OVERLAY: TokenOverlay = { controlled: new Set(), positions: new Map() };

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
  overlay: TokenOverlay;
}

export interface PlayerLayer {
  draw(surface: ViewSurface, frame: LayerFrame): void;
  /** Frees what the layer caches (the fog image). */
  dispose?(): void;
}
```

In `tests/unit/online/recordingSurface.ts`, change the `LayerFrame` import to

```ts
import { NO_TOKEN_OVERLAY, type LayerFrame } from '../../../src/app/online/view/layers/layerTypes';
```

and the `frame` helper's object to

```ts
  return {
    scene, images: () => null, visible: { x: -100, y: -100, width: 1200, height: 1000 }, zoom: 1, pixel: 1,
    bounds: sceneWorldBounds(scene), overlay: NO_TOKEN_OVERLAY, ...overrides,
  };
```

- [ ] **Step 9: Create `src/app/online/view/TokenMoves.ts`**

```ts
/**
 * The player's side of moving their own tokens: which tokens they control, the drag of
 * one, and what the view shows until the GM answers. While dragging, only this view
 * shows the token under the pointer (a preview); one `token-move` goes out on release.
 * The dropped token stays where it was dropped until the scene brings an update of it
 * (the GM's snapped position), a refusal arrives (it goes back, and "Move not allowed."
 * shows for `REFUSED_NOTICE_MS`) or `CONFIRM_TIMEOUT_MS` passes. A drag is cancelled,
 * sending nothing, by a new scene, the token leaving the scene, losing control of it or
 * the connection, and by `cancel` (Escape, pointer cancel, a second finger). Shared with
 * the web page.
 */
import type { PlayerScene, PlayerToken, ScenePoint } from '../scene/sceneTypes';
import type { ScreenPoint } from './camera';
import type { TokenOverlay } from './layers/layerTypes';
import { controlledTokenAt } from './tokenHit';
import type { TokenGrab } from './ViewInput';

export const CONFIRM_TIMEOUT_MS = 2000;
export const REFUSED_NOTICE_MS = 3000;
export const MOVE_REFUSED_TEXT = 'Move not allowed.';

export interface TokenMovesOptions {
  /** A canvas point (CSS pixels from its top left) in world units, with the camera of now. */
  toWorld(point: ScreenPoint): ScenePoint;
  /** Sends one drop; false when it could not be sent. */
  send(tokenId: string, x: number, y: number): boolean;
  /** What the view shows changed: the overlay, the cursor or the notice. */
  onChange(): void;
}

interface Held {
  tokenId: string;
  /** From the pointer's world point to the token's centre, so the token does not jump to the pointer. */
  offset: ScenePoint;
  /** Where it is dragged to; null until the pointer moved past the slop. */
  position: ScenePoint | null;
}

interface Pending {
  position: ScenePoint;
  /** The token's record at the drop: a different record is the GM's answer. */
  token: PlayerToken;
  timer: number;
}

function tokenOf(scene: PlayerScene, tokenId: string): PlayerToken | null {
  return Object.hasOwn(scene.tokens, tokenId) ? scene.tokens[tokenId] ?? null : null;
}

export class TokenMoves implements TokenGrab {
  private scene: PlayerScene | null = null;
  private controlled: ReadonlySet<string> = new Set();
  private connected = false;
  private held: Held | null = null;
  private readonly pending = new Map<string, Pending>();
  private noticeText: string | null = null;
  private noticeTimer: number | null = null;

  constructor(private readonly options: TokenMovesOptions) {}

  /** A new scene (another `sceneId`) or none cancels the drag and drops every preview. */
  setScene(scene: PlayerScene | null): void {
    const previousId = this.scene?.sceneId ?? null;
    this.scene = scene;
    if (!scene || scene.sceneId !== previousId) {
      this.held = null;
      this.clearPending();
      this.options.onChange();
      return;
    }
    if (this.held && !tokenOf(scene, this.held.tokenId)) this.held = null;
    // Any update of a dropped token is the GM's answer: it now shows where the GM's scene put it.
    for (const [tokenId, entry] of this.pending) if (tokenOf(scene, tokenId) !== entry.token) this.settle(tokenId);
    this.options.onChange();
  }

  setControlled(tokenIds: readonly string[]): void {
    this.controlled = new Set(tokenIds);
    if (this.held && !this.controlled.has(this.held.tokenId)) this.held = null;
    this.options.onChange();
  }

  /** Only an admitted player drags: a lost connection cancels the drag. */
  setConnected(connected: boolean): void {
    if (connected === this.connected) return;
    this.connected = connected;
    if (!connected) this.held = null;
    this.options.onChange();
  }

  /** The GM refused a move: the token shows its scene position, and the notice shows. */
  refused(tokenId: string): void {
    this.settle(tokenId);
    this.noticeText = MOVE_REFUSED_TEXT;
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => {
      this.noticeTimer = null;
      this.noticeText = null;
      this.options.onChange();
    }, REFUSED_NOTICE_MS);
    this.options.onChange();
  }

  /** Whether a press at `point` would drag a token: the grab cursor. */
  canGrab(point: ScreenPoint): boolean {
    return this.tokenAt(point) !== null;
  }

  grab(point: ScreenPoint): boolean {
    const tokenId = this.tokenAt(point);
    const shown = tokenId === null ? null : this.shownPosition(tokenId);
    if (tokenId === null || !shown) return false;
    const world = this.options.toWorld(point);
    this.held = { tokenId, offset: { x: shown.x - world.x, y: shown.y - world.y }, position: null };
    this.options.onChange();
    return true;
  }

  move(point: ScreenPoint): void {
    const held = this.held;
    if (!held) return;
    const world = this.options.toWorld(point);
    held.position = { x: world.x + held.offset.x, y: world.y + held.offset.y };
    this.options.onChange();
  }

  drop(point: ScreenPoint): void {
    const held = this.held;
    if (!held) return;
    this.move(point);
    this.held = null;
    const { tokenId, position } = held;
    const token = this.scene ? tokenOf(this.scene, tokenId) : null;
    if (token && position && this.options.send(tokenId, position.x, position.y)) {
      this.settle(tokenId);
      const timer = window.setTimeout(() => {
        this.settle(tokenId);
        this.options.onChange();
      }, CONFIRM_TIMEOUT_MS);
      this.pending.set(tokenId, { position, token, timer });
    }
    this.options.onChange();
  }

  cancel(): void {
    if (!this.held) return;
    this.held = null;
    this.options.onChange();
  }

  isDragging(): boolean {
    return this.held !== null;
  }

  notice(): string | null {
    return this.noticeText;
  }

  overlay(): TokenOverlay {
    const positions = new Map<string, ScenePoint>();
    for (const [tokenId, entry] of this.pending) positions.set(tokenId, entry.position);
    if (this.held?.position) positions.set(this.held.tokenId, this.held.position);
    return { controlled: this.controlled, positions };
  }

  dispose(): void {
    this.held = null;
    this.clearPending();
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
  }

  private tokenAt(point: ScreenPoint): string | null {
    if (!this.connected || !this.scene) return null;
    return controlledTokenAt(this.scene, this.controlled, this.overlay().positions, this.options.toWorld(point));
  }

  private shownPosition(tokenId: string): ScenePoint | null {
    const pending = this.pending.get(tokenId);
    if (pending) return pending.position;
    const token = this.scene ? tokenOf(this.scene, tokenId) : null;
    return token ? { x: token.x, y: token.y } : null;
  }

  private settle(tokenId: string): void {
    const entry = this.pending.get(tokenId);
    if (!entry) return;
    window.clearTimeout(entry.timer);
    this.pending.delete(tokenId);
  }

  private clearPending(): void {
    for (const tokenId of [...this.pending.keys()]) this.settle(tokenId);
  }
}
```

`TokenGrab` comes from `ViewInput.ts` in Step 12. Write that file before running these tests.

#### 2c. Drag versus pan versus pinch

- [ ] **Step 10: Write the failing input tests**

Add to `tests/unit/online/viewInput.test.ts`. Keep the existing tests: `new ViewInput(camera)` without a token hook behaves as before. Change the import line to

```ts
import { DOUBLE_ZOOM, ViewInput, WHEEL_ZOOM_PER_PIXEL, type PointerInput, type TokenGrab } from '../../../src/app/online/view/ViewInput';
```

and add below `const touch = …`:

```ts
/** The player's token covers everything left of x = 50; `grabs` records what the hook heard. */
function tokenSetup(): { input: ViewInput; moves: Move[]; grabs: string[] } {
  const moves: Move[] = [];
  const grabs: string[] = [];
  const tokens: TokenGrab = {
    grab: (point) => {
      if (point.x >= 50) return false;
      grabs.push(`grab ${point.x},${point.y}`);
      return true;
    },
    move: (point) => { grabs.push(`move ${point.x},${point.y}`); },
    drop: (point) => { grabs.push(`drop ${point.x},${point.y}`); },
    cancel: () => { grabs.push('cancel'); },
  };
  const input = new ViewInput({
    pan: (dx, dy) => { moves.push({ pan: [dx, dy] }); },
    zoomAt: (point, factor) => { moves.push({ zoom: [point, factor] }); },
  }, tokens);
  return { input, moves, grabs };
}
```

and these tests inside `describe('ViewInput', …)`:

```ts
  it('drags a token pressed on instead of panning, once past the slop, and drops it on release', () => {
    const { input, moves, grabs } = tokenSetup();
    input.down(mouse(10, 10));
    input.move(mouse(13, 10));
    input.move(mouse(30, 10));
    input.move(mouse(40, 20));
    input.up(mouse(40, 20));
    expect(grabs).toEqual(['grab 10,10', 'move 30,10', 'move 40,20', 'drop 40,20']);
    expect(moves).toEqual([]);
  });

  it("pans when the press misses the player's tokens", () => {
    const { input, moves, grabs } = tokenSetup();
    input.down(mouse(100, 100));
    input.move(mouse(120, 100));
    input.up(mouse(120, 100));
    expect(grabs).toEqual([]);
    expect(moves).toEqual([{ pan: [20, 0] }]);
  });

  it('cancels a press on a token that stays within the slop, and never grabs with another button', () => {
    const { input, grabs } = tokenSetup();
    input.down(mouse(10, 10));
    input.move(mouse(12, 10));
    input.up(mouse(12, 10));
    input.down(mouse(10, 10, 2));
    input.up(mouse(10, 10, 2));
    expect(grabs).toEqual(['grab 10,10', 'cancel']);
  });

  it('turns a second finger into a pinch that cancels the token drag, and the finger left pans', () => {
    const { input, moves, grabs } = tokenSetup();
    input.down(touch(1, 10, 10));
    input.move(touch(1, 30, 10));
    input.down(touch(2, 100, 10));
    input.move(touch(2, 120, 10));
    input.up(touch(2, 120, 10));
    input.move(touch(1, 40, 10));
    input.up(touch(1, 40, 10));
    expect(grabs).toEqual(['grab 10,10', 'move 30,10', 'cancel']);
    expect(moves.filter((move) => 'pan' in move)).toEqual([{ pan: [10, 0] }, { pan: [10, 0] }]);
    expect(moves.some((move) => 'zoom' in move)).toBe(true);
  });

  it('cancels the token drag when the browser cancels the pointer', () => {
    const { input, grabs } = tokenSetup();
    input.down(touch(1, 10, 10));
    input.move(touch(1, 30, 10));
    input.cancel(1);
    input.up(touch(1, 30, 10));
    expect(grabs).toEqual(['grab 10,10', 'move 30,10', 'cancel']);
  });

  it('still counts a tap on a token toward a double-tap zoom', () => {
    const { input, moves, grabs } = tokenSetup();
    input.down(touch(1, 10, 10, 0));
    input.up(touch(1, 10, 10, 0));
    input.down(touch(1, 12, 10, 100));
    input.up(touch(1, 12, 10, 100));
    expect(grabs).toEqual(['grab 10,10', 'cancel', 'grab 12,10', 'cancel']);
    expect(moves).toEqual([{ zoom: [{ x: 12, y: 10 }, DOUBLE_ZOOM] }]);
  });
```

- [ ] **Step 11: Run them to see them fail**

Run: `npx vitest run tests/unit/online/viewInput.test.ts`
Expected: FAIL. The new tests pan instead of calling the hook, because the second constructor argument is ignored.

- [ ] **Step 12: Replace `src/app/online/view/ViewInput.ts`**

```ts
/**
 * Turns input on the map into camera moves and token drags: the wheel zooms around the
 * cursor, a drag pans, a double-click or double-tap zooms in, and two fingers pan and
 * pinch around their midpoint. A press on one of the player's tokens (`TokenGrab`)
 * drags it instead of panning; a second finger always makes the gesture a pinch and
 * cancels the drag. Points are CSS pixels from the canvas's top left. Pure: the page
 * passes plain numbers from its DOM events, so tests drive it the same way.
 */
import type { ScreenPoint } from './camera';

export interface CameraMoves {
  pan(dx: number, dy: number): void;
  zoomAt(point: ScreenPoint, factor: number): void;
}

/** A press on one of the player's tokens drags it (`TokenMoves`). */
export interface TokenGrab {
  /** Starts dragging the token under `point`; false when there is none, and the press pans. */
  grab(point: ScreenPoint): boolean;
  /** The pointer moved past the slop, and on with every move after. */
  move(point: ScreenPoint): void;
  /** Released after moving: the move is sent. */
  drop(point: ScreenPoint): void;
  /** Released without moving, cancelled by the browser, or a second finger came down: nothing is sent. */
  cancel(): void;
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
  /** The gesture's first pointer pressed on one of the player's tokens and drags it. */
  private holdingToken = false;
  private lastTap: { point: ScreenPoint; time: number } | null = null;
  private lastKind: PointerKind = 'mouse';

  constructor(private readonly camera: CameraMoves, private readonly tokens: TokenGrab | null = null) {}

  down(input: PointerInput): void {
    this.lastKind = input.kind;
    if (input.kind === 'mouse' && input.button !== 0) return;
    if (this.pointers.size >= 2) return;
    const point = { x: input.x, y: input.y };
    this.pointers.set(input.id, point);
    if (this.pointers.size === 1) {
      this.start = point;
      this.dragging = false;
      this.holdingToken = this.tokens?.grab(point) ?? false;
    } else {
      // A second finger makes the gesture a pinch, never a tap or a token drag.
      this.releaseToken();
      this.start = null;
      this.dragging = true;
      this.lastTap = null;
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
    if (!this.dragging) {
      const start = this.start;
      if (!start || distance(start, point) < TAP_SLOP) return;
      this.dragging = true;
      this.lastTap = null;
      if (this.holdingToken) this.tokens?.move(point);
      else this.camera.pan(point.x - start.x, point.y - start.y);
    } else if (this.holdingToken) {
      this.tokens?.move(point);
    } else {
      this.camera.pan(point.x - previous.x, point.y - previous.y);
    }
    this.pointers.set(input.id, point);
  }

  up(input: PointerInput): void {
    if (!this.pointers.delete(input.id)) return;
    // One finger left a pinch: it pans on from where it is.
    if (this.pointers.size > 0) return;
    if (this.holdingToken) {
      this.holdingToken = false;
      if (this.dragging) this.tokens?.drop({ x: input.x, y: input.y });
      else this.tokens?.cancel();
    }
    if (!this.dragging && input.kind === 'touch') this.tap({ x: input.x, y: input.y }, input.time);
    this.start = null;
    this.dragging = false;
  }

  cancel(id: number): void {
    if (!this.pointers.delete(id)) return;
    this.releaseToken();
    if (this.pointers.size > 0) return;
    this.start = null;
    this.dragging = false;
  }

  /** `deltaMode` as in `WheelEvent`: 0 pixels, 1 lines, 2 pages. */
  wheel(point: ScreenPoint, deltaY: number, deltaMode: number): void {
    const pixels = deltaMode === 1 ? deltaY * LINE_PIXELS : deltaMode === 2 ? deltaY * PAGE_PIXELS : deltaY;
    if (Number.isFinite(pixels) && pixels !== 0) this.camera.zoomAt(point, Math.exp(-pixels * WHEEL_ZOOM_PER_PIXEL));
  }

  /** The browser's double-click; a touch double-tap is recognised from its taps instead, so it zooms once. */
  doubleClick(point: ScreenPoint): void {
    if (this.lastKind === 'touch') return;
    this.camera.zoomAt(point, DOUBLE_ZOOM);
  }

  private releaseToken(): void {
    if (!this.holdingToken) return;
    this.holdingToken = false;
    this.tokens?.cancel();
  }

  private pinch(id: number, previous: ScreenPoint, point: ScreenPoint): void {
    const other = [...this.pointers].find(([key]) => key !== id)?.[1];
    this.pointers.set(id, point);
    if (!other) return;
    const before = midpoint(previous, other);
    const after = midpoint(point, other);
    this.camera.pan(after.x - before.x, after.y - before.y);
    const spread = distance(previous, other);
    const factor = distance(point, other) / spread;
    if (spread > 0 && Number.isFinite(factor)) this.camera.zoomAt(after, factor);
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

- [ ] **Step 13: Run the input, hit-test and move tests**

Run: `npx vitest run tests/unit/online/viewInput.test.ts tests/unit/online/tokenHit.test.ts tests/unit/online/tokenMoves.test.ts`
Expected: PASS, the existing `ViewInput` tests included.

#### 2d. Drawing the ring and the previews

- [ ] **Step 14: Write the failing drawing and camera tests**

Add to `tests/unit/online/tokensLayer.test.ts`. Change the first import to `import { CONTROLLED_RING_COLOR, createTokensLayer, TOKEN_MARKER_COLOR } from '../../../src/app/online/view/layers/tokensLayer';` and add:

```ts
  it('rings the tokens this player controls, outside their own ring', () => {
    const surface = new RecordingSurface();
    createTokensLayer().draw(surface, frame(playerScene({ tokens: { t1: playerToken(), t2: playerToken({ x: 300 }) } }), {
      overlay: { controlled: new Set(['t1']), positions: new Map() },
    }));
    expect(surface.ops('circle').filter(({ style }) => style.stroke === CONTROLLED_RING_COLOR)).toEqual([
      { op: 'circle', x: 100, y: 100, radius: 39, style: { stroke: CONTROLLED_RING_COLOR, lineWidth: 4 } },
    ]);
  });

  it('draws a dragged or waiting token, with its nameplate, where the player put it', () => {
    const surface = new RecordingSurface();
    createTokensLayer().draw(surface, frame(playerScene({ tokens: { t1: playerToken({ name: 'Hero' }) } }), {
      overlay: { controlled: new Set(['t1']), positions: new Map([['t1', { x: 400, y: 300 }]]) },
    }));
    expect(surface.ops('push')[0]).toMatchObject({ x: 400, y: 300 });
    expect(surface.ops('push').map(({ x }) => x)).not.toContain(100);
  });
```

Add to `tests/unit/online/cameraController.test.ts`, inside `describe('CameraController', …)`:

```ts
  it('turns canvas points into world points with the camera of now', () => {
    const { controller } = setup();
    controller.setScreen(SCREEN);
    controller.setScene(playerScene());
    expect(controller.toWorld({ x: 516, y: 416 })).toEqual({ x: 500, y: 400 });
    expect(controller.toWorld({ x: 16, y: 16 })).toEqual({ x: 0, y: 0 });
  });
```

In `tests/unit/online/playerViewRenderer.test.ts`:
- Import the overlay: `import { NO_TOKEN_OVERLAY, type PlayerLayer, type TokenOverlay } from '../../../src/app/online/view/layers/layerTypes';`, replacing the `PlayerLayer` type import.
- In `setup`, add `const overlays: TokenOverlay[] = [];` after `const disposed: string[] = [];`.
- Make the layer's draw read:

```ts
    draw: (target, frame) => {
      if (name === options.throwing) {
        target.push(1, 1, 0, 1);
        throw new Error('layer failed');
      }
      drawn.push(name);
      if (name === 'tokens') overlays.push(frame.overlay);
    },
```

- Add `overlays` to the object `setup` returns.
- Add the test:

```ts
  it('hands the token overlay to the layers, and draws again when it changes', () => {
    const t = setup();
    t.show();
    t.frames.run();
    expect(t.overlays.at(-1)).toBe(NO_TOKEN_OVERLAY);
    const overlay: TokenOverlay = { controlled: new Set(['t1']), positions: new Map() };
    t.renderer.setOverlay(overlay);
    expect(t.frames.pending).toBe(1);
    t.frames.run();
    expect(t.overlays.at(-1)).toBe(overlay);
  });
```

- [ ] **Step 15: Run them to see them fail**

Run: `npx vitest run tests/unit/online/tokensLayer.test.ts tests/unit/online/cameraController.test.ts tests/unit/online/playerViewRenderer.test.ts`
Expected: FAIL. `CONTROLLED_RING_COLOR` is undefined, `toWorld` and `setOverlay` are not functions, and the overlay seen is `undefined`.

- [ ] **Step 16: Replace `src/app/online/view/layers/tokensLayer.ts`**

```ts
/**
 * Atlas's tokens as the player window shows them, lowest layer first: the art clipped
 * to its circle (a marker until it has loaded) and turned by the token's rotation, the
 * ring when the token has one, then its bars, nameplate and condition badges. On this
 * player's view only (`frame.overlay`), the tokens they control get a highlight ring, and
 * a token they drag or just dropped is drawn where they put it.
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
/** The ring around the tokens this player controls. */
export const CONTROLLED_RING_COLOR = '#facc15';

export function createTokensLayer(): PlayerLayer {
  // Sorted once per change of the tokens, not on every frame; ids kept for the overlay.
  let sorted: { tokens: Readonly<Record<string, PlayerToken>>; list: Array<[string, PlayerToken]> } | null = null;
  const byLayer = (tokens: Readonly<Record<string, PlayerToken>>): Array<[string, PlayerToken]> => {
    if (sorted === null || sorted.tokens !== tokens) sorted = { tokens, list: Object.entries(tokens).sort(([, a], [, b]) => a.layer - b.layer) };
    return sorted.list;
  };
  return {
    draw(surface, frame): void {
      const cellSize = frame.scene.map.cellSize;
      const stroke = computeTokenStrokeWidth(cellSize);
      const { controlled, positions } = frame.overlay;
      for (const [id, inScene] of byLayer(frame.scene.tokens)) {
        const at = positions.get(id);
        const token = at ? { ...inScene, x: at.x, y: at.y } : inScene;
        // Never 0 or negative: Atlas's formula gives nothing at half a cell or less.
        const size = Math.max(1, computeTokenPixelSize(cellSize, token.size));
        // The art, its rings, and the bars and badges around it.
        const reach = size / 2 + stroke + cellSize;
        if (!intersects({ x: token.x - reach, y: token.y - reach, width: reach * 2, height: reach * 2 }, frame.visible)) continue;
        const ringRadius = getTokenRingCenterRadius(size, stroke, 1);
        drawArt(surface, frame, token, size, stroke, ringRadius);
        if (controlled.has(id)) {
          surface.circle(token.x, token.y, ringRadius + stroke * 1.5, { stroke: CONTROLLED_RING_COLOR, lineWidth: stroke });
        }
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

- [ ] **Step 17: Add `toWorld` to `src/app/online/view/CameraController.ts`**

Add `screenToWorld` to the import from `./camera`:

```ts
import {
  cameraForView, cameraLimits, clampCamera, DEFAULT_CAMERA, fitCamera, GLIDE_MS, interpolateCamera, panBy, sameRect, screenToWorld, zoomAround,
  type Camera, type CameraLimits, type ScreenPoint, type ScreenSize, type WorldRect,
} from './camera';
```

and, after `isFollowing()`, add:

```ts
  /** The world point under `point` (CSS pixels from the canvas's top left), with the camera of now. */
  toWorld(point: ScreenPoint): ScreenPoint {
    return screenToWorld(this.current(), this.screen, point);
  }
```

- [ ] **Step 18: Add `setOverlay` to `src/app/online/view/PlayerViewRenderer.ts`**

Replace `import type { ImageLookup, LayerFrame, PlayerLayer } from './layers/layerTypes';` with

```ts
import { NO_TOKEN_OVERLAY, type ImageLookup, type LayerFrame, type PlayerLayer, type TokenOverlay } from './layers/layerTypes';
```

After `private bounds: WorldRect | null = null;` add `private overlay: TokenOverlay = NO_TOKEN_OVERLAY;`. After `setScene` add:

```ts
  /** This player's token moves: the ring on their tokens and where dragged ones are drawn. */
  setOverlay(overlay: TokenOverlay): void {
    this.overlay = overlay;
    this.request();
  }
```

In `draw()`, add `overlay: this.overlay,` to the `frame` object after `bounds: this.bounds,`.

- [ ] **Step 19: Run the view tests**

Run: `npx vitest run tests/unit/online/tokensLayer.test.ts tests/unit/online/cameraController.test.ts tests/unit/online/playerViewRenderer.test.ts tests/unit/online/viewLayers.test.ts tests/unit/online/fogLayer.test.ts`
Expected: PASS.

#### 2e. The join page

- [ ] **Step 20: Write the failing page tests**

In `tests/unit/online/mapView.test.ts`:
- Add `import { MOVE_REFUSED_TEXT, REFUSED_NOTICE_MS } from '../../../src/app/online/view/TokenMoves';`.
- Replace `setup()` with:

```ts
function setup() {
  document.body.innerHTML = [
    '<section><canvas id="map"></canvas>',
    '<div id="view-buttons" hidden><button id="follow-gm" type="button">Follow GM</button>',
    '<button id="fit-map" type="button">Fit map</button></div>',
    '<p id="move-notice" hidden></p>',
    '<button id="menu-button" type="button">Menu</button></section>',
  ].join('');
  const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const canvas = element<HTMLCanvasElement>('map');
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const frames = fakeFrames();
  const surface = new RecordingSurface();
  const sent: Array<[string, number, number]> = [];
  const view = new MapView({
    canvas, surface, images: () => null, frames, isHidden: () => false,
    viewButtons: element('view-buttons'), followButton: element('follow-gm'), fitButton: element('fit-map'),
    sendMove: (tokenId, x, y) => {
      sent.push([tokenId, x, y]);
      return true;
    },
    notice: element('move-notice'),
  });
  return {
    view, canvas, surface, frames, sent, notice: element('move-notice'),
    buttons: element('view-buttons'), follow: element<HTMLButtonElement>('follow-gm'), menu: element('menu-button'),
  };
}

/**
 * `playerScene`'s 1000 × 800 map fits the 800 × 600 canvas at zoom 0.71 around (500, 400),
 * so t1, at world (100, 100), is at canvas (116, 87).
 */
function withToken(t: ReturnType<typeof setup>): void {
  t.view.setScene(playerScene());
  t.view.setConnected(true);
  t.view.setControlled(['t1']);
}
```

- Add the tests:

```ts
  it('drags a controlled token with the mouse and sends one move on release, still following the GM', () => {
    const t = setup();
    withToken(t);
    pointer(t.canvas, 'pointerdown', 116, 87);
    pointer(t.canvas, 'pointermove', 166, 87);
    pointer(t.canvas, 'pointermove', 216, 87);
    expect(t.sent).toEqual([]);
    pointer(t.canvas, 'pointerup', 216, 87);
    expect(t.sent).toHaveLength(1);
    const [tokenId, x, y] = t.sent[0]!;
    expect(tokenId).toBe('t1');
    expect(x).toBeCloseTo(100 + 100 / 0.71);
    expect(y).toBeCloseTo(100);
    expect(t.buttons.hidden).toBe(true);
  });

  it('shows a grab hand over a controlled token, and grabbing while it is held', () => {
    const t = setup();
    withToken(t);
    pointer(t.canvas, 'pointermove', 116, 87);
    expect(t.canvas.classList.contains('can-grab')).toBe(true);
    pointer(t.canvas, 'pointermove', 600, 500);
    expect(t.canvas.classList.contains('can-grab')).toBe(false);
    pointer(t.canvas, 'pointermove', 116, 87);
    pointer(t.canvas, 'pointerdown', 116, 87);
    expect(t.canvas.classList.contains('is-grabbing')).toBe(true);
    expect(t.canvas.classList.contains('can-grab')).toBe(false);
    pointer(t.canvas, 'pointerup', 116, 87);
    expect(t.canvas.classList.contains('is-grabbing')).toBe(false);
  });

  it('cancels a drag on Escape and sends nothing', () => {
    const t = setup();
    withToken(t);
    pointer(t.canvas, 'pointerdown', 116, 87);
    pointer(t.canvas, 'pointermove', 216, 87);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    pointer(t.canvas, 'pointerup', 216, 87);
    expect(t.sent).toEqual([]);
  });

  it('shows "Move not allowed." for a few seconds after a refusal', () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      withToken(t);
      t.view.moveRefused('t1');
      expect(t.notice.hidden).toBe(false);
      expect(t.notice.textContent).toBe(MOVE_REFUSED_TEXT);
      vi.advanceTimersByTime(REFUSED_NOTICE_MS);
      expect(t.notice.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
```

- [ ] **Step 21: Run them to see them fail**

Run: `npx vitest run tests/unit/online/mapView.test.ts`
Expected: FAIL. `setConnected` is not a function.

- [ ] **Step 22: Replace `online-client/mapView.mts`**

```ts
// online-client/mapView.mts
/**
 * The map on the join page. It binds the canvas, its input, the Follow GM and Fit map
 * buttons, resizing, page visibility and the player's token moves (cursor, Escape, the
 * "Move not allowed." notice) to the tested shared modules (`CameraController`,
 * `ViewInput`, `PlayerViewRenderer`, `TokenMoves`). Only the canvas takes map input, so a
 * gesture that starts on the top bar, the menu or a button never moves the map.
 */
import type { SceneCamera } from '../src/app/online/scene/sceneCamera';
import type { PlayerScene } from '../src/app/online/scene/sceneTypes';
import type { ScreenPoint } from '../src/app/online/view/camera';
import { CameraController } from '../src/app/online/view/CameraController';
import type { ImageLookup } from '../src/app/online/view/layers/layerTypes';
import { createSceneLayers } from '../src/app/online/view/layers/sceneLayers';
import { pixelRatioFor, PlayerViewRenderer } from '../src/app/online/view/PlayerViewRenderer';
import { TokenMoves } from '../src/app/online/view/TokenMoves';
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
  /** Sends one drop of a controlled token; false when it could not be sent. */
  sendMove(tokenId: string, x: number, y: number): boolean;
  /** Shows "Move not allowed." after a refused move. */
  notice: HTMLElement;
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
  private readonly moves: TokenMoves;
  private readonly input: ViewInput;
  private hasScene = false;
  /** Where the mouse is over the canvas, for the grab cursor; null when it is elsewhere. */
  private hover: ScreenPoint | null = null;
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
      requestFrame: (draw) => frames.request(draw),
      cancelFrame: (handle) => frames.cancel(handle),
      isHidden: options.isHidden ?? ((): boolean => document.hidden),
    });
    this.moves = new TokenMoves({
      toWorld: (point) => this.camera.toWorld(point),
      send: (tokenId, x, y) => options.sendMove(tokenId, x, y),
      onChange: () => this.movesChanged(),
    });
    this.input = new ViewInput(this.camera, this.moves);
    this.bind();
    this.measure();
  }

  /** The scene to show; null shows nothing and resets the camera. */
  setScene(scene: PlayerScene | null): void {
    this.hasScene = scene !== null;
    this.camera.setScene(scene);
    this.renderer.setScene(scene);
    this.moves.setScene(scene);
    this.updateButtons();
  }

  setGmCamera(camera: SceneCamera | null): void {
    this.camera.setGmCamera(camera);
  }

  /** The tokens this player controls, from the GM's latest list. */
  setControlled(tokenIds: readonly string[]): void {
    this.moves.setControlled(tokenIds);
  }

  /** Whether the player is admitted: only then can tokens be dragged. */
  setConnected(connected: boolean): void {
    this.moves.setConnected(connected);
  }

  /** The GM refused a move of this token. */
  moveRefused(tokenId: string): void {
    this.moves.refused(tokenId);
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

  /** A grab hand over the player's tokens; grabbing while one is held. */
  private updateCursor(): void {
    const { canvas } = this.options;
    const holding = this.moves.isDragging();
    canvas.classList.toggle('is-grabbing', holding);
    canvas.classList.toggle('can-grab', !holding && this.hover !== null && this.moves.canGrab(this.hover));
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
    // Escape drops a token being dragged where it was; the menu closes on Escape on its own.
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.moves.cancel();
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

- [ ] **Step 23: Wire the page in `online-client/main.mts`, `index.html` and `style.css`**

`online-client/main.mts`:

1. Change `import type { PlayerSessionState } from '../src/app/online/PlayerSession';` to

```ts
import type { PlayerSession, PlayerSessionState } from '../src/app/online/PlayerSession';
```

2. After `const surface = createCanvasSurface(canvas);` add:

```ts
/** Set once the player joins; until then a drop has nowhere to go. */
let session: PlayerSession | null = null;
```

3. In the `new MapView({ … })` options, after the `viewButtons: …, followButton: …, fitButton: …,` line, add:

```ts
    sendMove: (tokenId, x, y) => session?.sendTokenMove(tokenId, x, y) ?? false,
    notice: element('move-notice'),
```

4. In `render`, after `sessionState = state;`, add:

```ts
  // Only an admitted player drags tokens: reconnecting or ended cancels a drag.
  map?.setConnected(state.status === 'admitted');
```

5. Replace `    createJoinSession({` with `    session = createJoinSession({`. Then replace the end of that call:

```ts
      onCamera: (camera) => {
        log.event('camera', { sceneId: camera.sceneId, centerX: camera.centerX, centerY: camera.centerY });
        map.setGmCamera(camera);
      },
    }).start();
```

with

```ts
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
    });
    session.start();
```

`online-client/index.html`: after the closing `</div>` of `<div id="view-buttons" …>`, add:

```html
    <p id="move-notice" class="move-notice" role="status" hidden></p>
```

`online-client/style.css`: replace

```css
#map { grid-row: 2; display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; }
#map:active { cursor: grabbing; }
```

with

```css
#map { grid-row: 2; grid-column: 1; display: block; width: 100%; height: 100%; touch-action: none; cursor: default; }
/* A grab hand over the player's own tokens; grabbing while a token or the map is dragged. */
#map.can-grab { cursor: grab; }
#map:active, #map.is-grabbing { cursor: grabbing; }
/* "Move not allowed.": over the top of the map, never taking input. */
.move-notice {
  grid-row: 2; grid-column: 1; align-self: start; justify-self: center; z-index: 1; margin: 12px 0 0;
  padding: var(--gap); background: var(--bar); color: var(--text); border: 1px solid var(--border); border-radius: 8px; pointer-events: none;
}
```

- [ ] **Step 24: Run the page tests, the type check, lint and the page build**

Run: `npx vitest run tests/unit/online && npx tsc --noEmit && npx eslint src/app/online --max-warnings 0 --suppressions-location eslint.suppressions.json && npm run build:online`
Expected: PASS, and every command exits 0. `build:online` writes `dist-online/` with no warnings about missing modules.

- [ ] **Step 25: Check file sizes**

Run: `wc -l src/app/online/PlayerSession.ts src/app/online/view/*.ts src/app/online/view/layers/*.ts online-client/*.mts`
Expected: every file under 300 lines (`PlayerSession.ts` about 245, `mapView.mts` about 225).

- [ ] **Step 26: Commit**

```bash
git add src/app/online/PlayerSession.ts src/app/online/view online-client/mapView.mts online-client/main.mts online-client/index.html online-client/style.css tests/unit/online/playerSessionMoves.test.ts tests/unit/online/tokenHit.test.ts tests/unit/online/tokenMoves.test.ts tests/unit/online/viewInput.test.ts tests/unit/online/tokensLayer.test.ts tests/unit/online/playerViewRenderer.test.ts tests/unit/online/cameraController.test.ts tests/unit/online/mapView.test.ts tests/unit/online/recordingSurface.ts
git commit -m "feat(online): players drag their own tokens on the join page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q6CPZpZ7Wn79w7u8cBLtRr"
```

---
### Task 3: Docs, full checks and the manual test

**Files:**
- Modify: `README.md` (section "Online play (preview)"), `PRIVACY.md` (section "Online play"), `changelog/Unreleased.md`, `src/app/changelog/releases.json` (generated), `docs/online-play-features.md`

**Interfaces:**
- Consumes the behaviour and copy of Tasks 1 and 2: **Controlled by**, "Move not allowed.", one undo step, snapping, and the `PLAYER_MESSAGE_TYPES` / handler pattern.
- Produces no code.

- [ ] **Step 1: README**

In `README.md`, insert a paragraph after the paragraph that starts "Players get what the player window shows" and before the list item "- Connections are direct between your Atlas and each player":

```markdown
While a session runs, right-click a character token and pick players under **Controlled by** to let them move it. They drag it on the join page, on desktop or phone, and Atlas puts it where they let go, snapped to the grid as your own drag snaps, as one step you can undo. Players can move only the tokens you gave them, and only while they can see them; a refused move goes back, and the player sees "Move not allowed.". Assignments last until the session ends and are never saved in your tokens.
```

- [ ] **Step 2: PRIVACY**

In `PRIVACY.md`, under "## Online play", insert a paragraph after the one that starts "The join link you share carries your signaling and relay settings":

```markdown
Players can move the tokens you assign to them under **Controlled by**. For each move, their page sends Atlas only the token and the spot where they let go, and Atlas checks every move before applying it to your scene; players cannot send anything else that changes it. Each player receives the ids of their own tokens, and nothing else about them. Assignments are kept only while the session runs.
```

- [ ] **Step 3: Changelog**

`changelog/Unreleased.md` has CRLF line endings: keep them. In the **Online Play (preview)** list, insert a bullet before the one that starts "- **Log online play events**":

```markdown
- Let online players move their own tokens: right-click a character token and pick them under **Controlled by**. They drag it on the join page, on desktop or phone, and Atlas places it where they let go, snapped to the grid, as one step you can undo. Players can only move tokens you gave them and can see.
```

Run: `file changelog/Unreleased.md && npm run changelog:generate && npm run changelog:check`
Expected: `file` still reports "with CRLF line terminators". The generator rewrites `src/app/changelog/releases.json`, and the check exits 0.

- [ ] **Step 4: The online play guide**

In `docs/online-play-features.md`, append this section after "## 7. Tell players and the GM":

```markdown
## 8. When players act on the scene

Players change the GM's scene only through messages the GM checks. Token moves (`src/app/online/control/`) are the pattern:

- Add the message to `src/app/online/protocol.ts` with its validator, and its type to `PLAYER_MESSAGE_TYPES`. `GmSession` hands handlers nothing else from players.
- Handle it in its own `GmSession` handler, started by `TokenControlHost` or beside it, never in `SceneBroadcaster`.
- Check the message against what players have (`currentProjection()`).
- Refuse while the presented scene is held or its map is loading, because the view's store then holds another map.
- Look ids up with `Object.hasOwn`.
- Rate-limit per player.
- Write through a store action inside `runHistoryTransaction`, so each player action is one undo step for the GM.
- Answer a refusal with only what the player sent, so refusals reveal nothing.
- Validate numbers as numbers and check finiteness in the handler, because `1e400` reads as `Infinity`. A bad value then gets a refusal, not an invalid-message strike.
- Test it end to end over `MemoryTransport` with the history-backed store in `tests/unit/online/tokenMoveFixtures.ts`. A store without history passes undo tests for the wrong reason.
```

- [ ] **Step 5: Full checks**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run build:ci && npm run build:online && npm run changelog:check`
Expected: each exits 0.

Run: `wc -l src/app/online/GmSession.ts src/app/online/scene/SceneBroadcaster.ts src/app/online/scene/CameraSender.ts src/app/online/PlayerSession.ts src/app/online/OnlineSessionService.ts src/app/online/control/*.ts src/app/online/view/*.ts src/app/online/view/layers/*.ts online-client/*.mts`
Expected:
- `GmSession.ts` is 302 lines, `SceneBroadcaster.ts` 300 and `CameraSender.ts` 159, all as before this piece.
- Every other file is under 300 lines.

Run: `git diff --stat main -- src/app/online/scene/SceneBroadcaster.ts src/app/online/scene/CameraSender.ts`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add README.md PRIVACY.md changelog/Unreleased.md src/app/changelog/releases.json docs/online-play-features.md
git commit -m "docs(online): players move their own tokens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q6CPZpZ7Wn79w7u8cBLtRr"
```

- [ ] **Step 7: Manual test (by the user; the controller hands over these steps)**

Build and reload: run `npm run build` (it copies the plugin to the vault), then `npm run obsidian:reload`. Players use the page at the address in **Settings → Online play**. To test this piece's unpublished page, serve `dist-online/` after `npm run build:online` and set that address there.

1. Run **Online session…**, open the join link in a desktop browser and on a phone, and let both players in. Present a scene with a square grid and fog over part of the map.
2. Right-click a character token. **Controlled by** lists both players. Tick player A for two tokens (keep the submenu open while ticking). On A's page both tokens get a yellow ring, and on desktop the cursor is a grab hand over them and the arrow elsewhere.
3. **Desktop.** Drag one of A's tokens:
   - it follows the pointer while the GM's Atlas and the other player see nothing move;
   - on release it lands snapped to a cell on both pages and in Atlas;
   - pressing elsewhere pans, and the wheel zooms;
   - with the GM's view moving (Follow GM on), dragging still works and the view keeps following.
4. **Phone.** Drag the other token with one finger. Then start a drag on a token, put a second finger down and pinch: the map zooms, the token does not move, and lifting one finger pans.
5. **Refusals.**
   - Drag an unassigned token: nothing grabs it, and the map pans.
   - Untick A in **Controlled by** while A drags: the drag ends, the token goes back, and nothing is sent.
   - Hide an assigned token in Atlas while A drags it: it disappears for A, the drag ends, and Atlas does not move it.
6. **Fog.** Drag an assigned token into the fog. It disappears on both pages and stays in Atlas under the fog. Erase the fog and it is back, still A's.
7. **Undo.** In Atlas, press undo once: the last player move goes back as one step, and the players see it go back.
8. **Escape and timeout.**
   - Start a desktop drag and press Escape: the token goes back and nothing is sent.
   - Drag a token and drop it on its own cell: it settles on its cell within two seconds.
9. **Reconnect and removal.**
   - Turn the phone's network off and on: the player reconnects and the rings come back.
   - Remove player A in the online session window: A's page shows the removal, and A's tokens lose A in **Controlled by** for the rest of the session.
10. **Deletion and scene switch.**
    - Delete one assigned token: it leaves **Controlled by**.
    - Switch the GM's view to another scene tab and back: the remaining assignment is still ticked.

---

## Spec coverage

| Spec requirement | Task |
| --- | --- |
| Controlled by submenu, admitted players as checkboxes, while a session runs | 1 (1i) |
| Session-only assignments, reconnect keeps, kick removes, deleted tokens drop | 1 (1c, 1f) |
| `token-control` (≤ 256 ids) on admission, change, snapshot; projection unchanged | 1 (1a, 1f) |
| `token-move` checks: admitted, controls, scene, in projection, finite, clamp, snap, one undo step | 1 (1g) |
| `token-move-refused` with only the sent id; 10/s limit; last write wins | 1 (1g, 1h) |
| GM accepts only `scene-resync` and `token-move` | 1 (1b) |
| Highlight ring, grab cursor | 2 (2d, 2e) |
| Desktop and phone drag versus pan versus pinch | 2 (2c) |
| Preview while dragging, one message on release, every cancel path | 2 (2b, 2c, 2e) |
| Drop stays until the update, refusal with "Move not allowed.", 2 s timeout | 2 (2b, 2e) |
| Following continues while dragging | 2 (2e test, manual step 3) |
| End to end over `MemoryTransport` | 1 (1h), 2 (2a) |
| Manual test | 3 (Step 7) |
| README, PRIVACY, changelog | 3 |
