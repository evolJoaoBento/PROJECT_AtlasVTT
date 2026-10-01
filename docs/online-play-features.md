# Adding a map feature to online play

Online players see the presented scene through a projection on the GM's side and a layer on the join page. Every Atlas map object and field must be decided on for online play, in the same places every time. When you add a field to `TokenEntity`, a new kind of map object, a grid setting or a new layer, work through this list.

## 1. Record the decision

`src/app/online/coverage.ts` has a table per Atlas type: map objects, token fields, text fields, drawing fields, fog fields, grid fields, and the store fields the projection reads. The tables are typed over Atlas's own types, so a new field or object kind fails `npx tsc --noEmit` until it has an entry:

- `sent`: players receive it, or what it decides (`isHidden` keeps a token from them).
- `gm-only` with a reason: it never changes what players receive.
- `not-yet` with the piece expected to add it.

Then add a variant for the field in `tests/unit/online/coverage.test.ts`. It changes the field and checks that the projection changes for `sent` and stays the same otherwise.

## 2. Project it on the GM's side

`src/app/online/scene/projectForPlayers.ts` (map, grid, tokens), `projectRecords.ts` (fog, texts, drawings) and `projectPanels.ts` (widgets, initiative) build every sent object field by field, never by spreading a GM record. Read values through `coerce.ts` and clamp numbers into `SCENE_RANGES`, so the output always validates. Follow the player view settings (`playerViewRules.ts`) and the fog (`FogCoverage`) as the local player window does. If the projection reads a new store field, add it to `sliceOf` in `sceneSources.ts`, to `ProjectedState` in `projectForPlayers.ts` (a hand-written `Pick` of the store state), and to `SCENE_FIELD_COVERAGE` in `coverage.ts`.

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
