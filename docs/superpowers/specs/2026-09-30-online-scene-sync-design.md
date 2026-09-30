# Online play, piece 2: what players see, synced

Date: 2026-09-30. Status: design, awaiting review. Builds on piece 1
(`docs/superpowers/specs/2026-09-29-online-sessions-design.md`), merged to the
fork's `main`.

## Context

Piece 1 lets players join a GM's online session. Nothing about the game is
sent yet: the join page says "Waiting for the GM to show a scene". This piece
sends the presented scene to every admitted player, filtered to what players
may see, and keeps it current. A simple live preview on the join page shows it
working; the real map view is piece 4, and map and token images stream in
piece 3.

The local player window hides secrets at draw time: it copies the GM's canvas
with GM-only layers switched off. Remote players get data, not pixels, so this
piece filters the data itself.

## Goals

- When the GM presents a scene, every admitted player receives it; players who
  join later receive it on admission.
- What players receive is exactly what the local player window would show,
  and nothing more: no hidden tokens, no pins, no notes or statblocks, nothing
  completely under fog, and HP, stress, nameplates, grid, widgets, initiative
  and dice following the existing player view settings.
- Changes reach players within about 100 ms (token moves, fog strokes, widget
  values, initiative), at a bounded rate.
- A player who misses a message, reconnects, or opens a second tab ends up with
  the same scene as everyone else.
- The join page draws a live preview: the grid, fog, and a marker per visible
  token, moving as the GM moves things.

## Non-goals (this piece)

- Map and token images (piece 3): the projection carries asset ids, the preview
  draws no images.
- The real player map view, player-controlled camera (piece 4).
- Player actions (piece 5).
- Walls, lights and dynamic vision: they are behind
  `WALLS_AND_LIGHTING_ENABLED = false`; the projection sends none of them
  while the flag is off. Supporting them is future work.
- Audio emitters, loot handouts and dice roll toasts (a later addition).
- A map-view indicator for the online session (the status bar is hidden
  during Atlas views; noted for a later piece).

## Decisions

| Question | Decision |
| --- | --- |
| Sync model | GM-authoritative filtered projection; full snapshot on join, present and resume; per-record deltas after. |
| Rate | Changes are batched and sent at most every 50 ms. |
| Secrecy under fog | The GM computes fog coverage and does not send tokens, texts or drawings that are completely covered. |
| What is presented | One presented scene for the local window and online players. A new "Present to players" action presents without opening the local window. |
| Player view settings | Online players follow the existing `localPlayerView` settings (grid, HP, stress, nameplates, widgets, initiative). |
| Images | Vault paths become opaque asset ids, random per session and stable within it. |
| Preview | A 2D canvas on the join page: grid, fog, token markers. |

## What players may see: the projection

`projectForPlayers(scene, context) → PlayerScene` is a pure function. It is
the only place that decides what leaves the GM's machine, and it is written
so that anything it does not know about is left out: it copies named fields
into new objects and never spreads GM records.

`context` carries the player view settings, the fog coverage, and the asset
id registry.

`PlayerScene` (the wire shape):

| Field | Contents | Rule |
| --- | --- | --- |
| `sceneId` | Random per presentation | A new presentation or scene gets a new id. |
| `map` | `{ asset: string \| null, width, height }` | The background as an asset id, and its size in world pixels (from the loaded background; 0 × 0 without one). |
| `grid` | `type, size, offsetX, offsetY, color, opacity, lineType, lineWidth, hexNumbers, hexNumberOpacity` | Omitted (null) when `showGrid` is off or the grid is not visible. |
| `tokens` | `Record<id, PlayerToken>` | See below. |
| `fog` | `Record<id, PlayerFogOp>` | Every fog operation, its points simplified to 1 world pixel. |
| `texts` | `Record<id, PlayerText>` | Dropped when completely under fog. |
| `drawings` | `Record<id, PlayerDrawing>` | Points simplified to 1 world pixel; dropped when completely under fog. |
| `widgets` | `PlayerWidget[]` | Only when `showWidgets` and the scene's widgets are globally visible: each widget that is on in the scene and `visibleToPlayers`, with its label, icon id, type and current value. |
| `initiative` | `{ round, active, entries }` or null | Only when `showInitiative` and the tracker is open. Entries of hidden or fogged tokens are dropped; name only with `showTokenNameplates`, HP only with `showTokenHP`; no stress, no statblock. |

`PlayerToken`: `x, y, size, rotation, layer, image (asset id or null), ring
(colour or null), conditions (ids with values), name (only with
showTokenNameplates, character tokens), hp (only with showTokenHP, character
tokens with a max > 0), stress (only with showTokenStress)`.

Never sent: hidden tokens (`isHidden`), pins and hex links, notes and statblock
paths, `dmNotePath`, pinned note previews, loot state, the dice log, walls,
lights and audio, vision radii, tags, player-character links, and anything
completely under fog.

### Fog coverage

Fog is stored as operations (brush strokes, lassos, rectangles; paint or
erase) replayed in order. `FogCoverage` rasterises them on the GM side into a
coarse bitmap (one cell per 8 world pixels) with a small pure rasteriser:
brush strokes as round-capped segments, lassos as polygons, rectangles, erase
clearing cells. `isCovered(bounds)` is true when every cell under the bounds is
fogged. A token's bounds are its footprint (`size` × grid size); a text's are
its measured box (estimated from font size and length); a drawing's are the
bounds of its points plus its width. Coverage is rebuilt only when the fog
operations change.

Coverage is conservative: an object is sent unless it is completely covered,
so a token peeking out from the fog's edge is sent, as it is visible in the
local window too.

### Asset ids

`AssetRegistry` (per online session) maps each vault path to a random id the
first time it appears in a projection and returns the same id afterwards. Piece
3 serves images by these ids; piece 2 only assigns them. Paths never leave the
GM's machine.

## Presenting

Today, presenting a scene opens the local player window. This piece extracts
"which scene is presented" into `PresentedScene`, one per vault:

- It knows the presented tab, the Atlas view and store that hold it, and
  whether the scene is held (the GM switched that view to another tab) or live.
- It emits `presented(store)`, `held()` and `cleared()`.
- `PlayerWindowService` and the online broadcaster both follow it. Existing
  commands keep their behaviour (presenting also opens the local window).
- A new command and view-actions item, **Present to players**, presents the
  active scene without opening the local window. "Stop presenting" clears it.
- The scene tab bar's "presented" marker follows `PresentedScene`, so a scene
  presented only to online players shows it too.

While held, players keep the last scene they received (as the local window
keeps its last frame). When the presented tab comes back and its map has
finished loading, players get a fresh snapshot.

## Sync

`SceneBroadcaster` is a `GmSession` handler (`session.use`):

- **Snapshot:** on `onAdmitted` (which also fires when a new tab replaces an old
  one), on `presented`, and on resume, it sends the current projection to the
  player or players concerned.
- **Deltas:** it subscribes to the presented store and to the player view
  settings (`SettingsService.onChange`). On a change it waits for
  the next 50 ms tick, projects again, and diffs against the last projection it
  sent: per record (`tokens`, `fog`, `texts`, `drawings`) upserts and removals
  by id, compared by value; the other fields replaced when they differ. An
  empty diff sends nothing.
- **Clear:** on `cleared`, it sends `scene-clear`; players show "Waiting for the
  GM to show a scene" again.
- Everyone admitted gets the same messages; there is one projection per scene,
  not per player.

Messages (control channel, protocol v1, validated on both sides):

| Type | Direction | Fields |
| --- | --- | --- |
| `scene-snapshot` | GM → player | `seq`, `scene` (a `PlayerScene` without `fog` and `drawings`), `fogParts` and `drawingParts` (how many `scene-fog` and `scene-drawings` messages follow) |
| `scene-fog` | GM → player | `seq`, `part`, `records` (a batch of fog operations) |
| `scene-drawings` | GM → player | `seq`, `part`, `records` (a batch of drawings) |
| `scene-patch` | GM → all | `seq`, `set` (changed top-level fields), `upsert` and `remove` per record type |
| `scene-clear` | GM → all | `seq` |
| `scene-resync` | player → GM | `seq` (the last it applied) |

`seq` increases by one per message to a player. A player that sees a gap, or a
patch before a snapshot, discards it and sends `scene-resync`; the GM answers
that player with a snapshot. A snapshot's fog and drawings are split into `scene-fog` and `scene-drawings`
parts so no message exceeds the 256 KB limit; the player applies the snapshot
only once all its parts have arrived (a missing or out-of-order part triggers a
`scene-resync`). A patch that would exceed the limit is replaced by a snapshot.
If the snapshot without fog and drawings still exceeds it, players get
`scene-clear` and the GM sees a notice once: "This scene is too large to send
to online players."

## Player side

`PlayerSceneMirror` (shared with the web page, no Obsidian imports) applies
snapshots, fog parts, patches and clears, and exposes the current scene and an
`onChange` callback. `PlayerSession` hands scene messages to it.

## Join page preview

A canvas under the player list, sized to the window:

- It fits the map (or, without a map size, the bounds of the grid and tokens).
- It draws the grid (square and hex, reusing `grid/hexGeometry.ts`), fog
  (replaying the operations onto an offscreen canvas, painted opaque), texts,
  drawings, and each token as a circle sized to its footprint in its ring
  colour, with its initials or name when names are shown, and an HP bar when
  HP is shown.
- It redraws on each change, at most once per animation frame.
- Widgets and initiative are listed as text beside it.

## Errors and edge cases

- **The presented view closes, or its scene is deleted:** `cleared`.
- **The map is still loading:** no snapshot until it has finished; writes made
  by loading are not sent as deltas.
- **Drags:** tokens move in the store at most every 50 ms already; deltas follow
  that rate.
- **A player joins while nothing is presented:** admitted as today, no scene.
- **Settings change** (e.g. the GM turns HP on): the projection changes, and the
  diff sends it.
- **Invalid scene messages on the player side:** ignored and followed by a
  `scene-resync`, at most once per second.
- **Fog without a grid or map:** coverage still works in world pixels.

## Security and privacy

- `projectForPlayers` builds every sent object field by field; tests assert
  that no GM-only field (a fixed list of every field above) ever appears in a
  projection, for scenes that set all of them.
- Asset ids are random, so they reveal no file or folder names.
- Players cannot send scene data; the GM only accepts `scene-resync` from them.

## Testing

- **Projection:** one test per rule in the table, including settings on and off,
  hidden and fogged tokens, texts and drawings, widgets, initiative, and the
  never-sent list.
- **Fog coverage:** brush, lasso, rectangle, erase order, partial vs complete
  cover, offsets.
- **Diff:** upserts, removals, unchanged scenes produce nothing, top-level
  fields.
- **Broadcaster and mirror over `MemoryTransport`:** snapshot on admission,
  deltas after, clear, resync after a gap, fog split into parts, a second tab,
  held and resumed scenes; the mirror ends equal to the GM's projection.
- **PresentedScene:** present, hold on tab switch, resume after loading, clear on
  view close, "Present to players" without the local window.
- **Manual:** the GM presents a scene, a player's preview shows the grid, fog and
  tokens; moving a token, painting fog, hiding a token and toggling HP all show
  up within a moment, and a token under fog is absent from the page's data
  (checked in the browser's developer tools).

## Deferred from piece 1, handled here

- `onAdmitted` fires again when a newer tab replaces an older one: the
  broadcaster treats every `onAdmitted` as "send a full snapshot".
- `GmSession.ts` is about 306 lines: the broadcaster lives in its own module and
  plugs in through `session.use`, so `GmSession` does not grow.
