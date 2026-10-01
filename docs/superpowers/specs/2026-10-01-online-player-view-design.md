# Online play, piece 4: the player map view

Date: 2026-10-01. Status: design, awaiting review. Builds on pieces 1–3
(`2026-09-29-online-sessions-design.md`, `2026-09-30-online-scene-sync-design.md`,
`2026-09-30-online-asset-streaming-design.md`), all merged to the fork's `main`.

## Context

Players join from the web page and receive the presented scene (piece 2) and
its map and token images (piece 3). The page draws a small preview. This piece
replaces it with a real map view: the window-filling scene with images, grid,
fog, texts, drawings and token details, that players can pan and zoom and that
follows the GM's view by default.

It also sets up how online play keeps pace with Atlas: every map feature Atlas
gains must be decided on for online play, and each one is mirrored by a
projection on the GM side and a layer on the player side.

## Goals

- The join page shows the presented scene full-window, as close to Atlas's
  player view as the data allows, on desktop and phones.
- Players follow the GM's working view by default; a player who pans or zooms
  breaks away and can return with **Follow GM**.
- Panning and zooming stay smooth with a large map, a few hundred tokens and
  thousands of fog strokes, on phones too.
- A new Atlas map object or field cannot reach players, or be silently left
  out, without a recorded decision.
- The "Waiting for the GM…" on a GM tab switch (known issue from piece 2) is
  reproduced and fixed.

## Non-goals (this piece)

- Players moving tokens (piece 5); any player input to the GM.
- Walls, lights and vision; pins; measuring, pings and the laser pointer; dice
  on the web page; audio.
- A PIXI renderer (the drawing interface leaves room for one later).

## Decisions

| Question | Decision |
| --- | --- |
| Who controls the view | Both: players follow the GM by default, break away by panning or zooming, and rejoin with **Follow GM**. |
| Which GM camera | The GM's working view of the presented scene in Atlas, live. Players learn where the GM looks. |
| Drawing | A 2D canvas, behind a small drawing interface that a PIXI renderer could later implement. |
| Keeping pace with Atlas | Coverage tables tied to Atlas's types, one projection and one player layer per Atlas feature, shared geometry and layout code, and a guide. |

## Keeping pace with Atlas

### Coverage tables

`src/app/online/coverage.ts` records, for every kind of map object and every
field of the objects players receive, whether it is **sent**, **GM only** (with
a reason) or **not yet** (with the piece expected to add it):

- `OBJECT_COVERAGE: Record<keyof ViewAtlasState['objects'], Coverage>` —
  tokens, fog, texts, drawings: sent; pins: GM only; walls, lights, audios:
  not yet (behind `WALLS_AND_LIGHTING_ENABLED`) or GM only.
- `TOKEN_FIELD_COVERAGE: Record<keyof TokenEntity | keyof Character, Coverage>`,
  and the same for `TextElement`, `DrawingStroke` and `FogOperation`.
- `SCENE_FIELD_COVERAGE` for the store fields the projection reads (background,
  grid, widget settings and values, initiative).

Because the tables are typed as records over Atlas's own types, adding an
object kind or a field to Atlas makes the build fail until the table records a
decision. A test checks that every field marked GM only never appears in a
projection of a scene that sets it, and that every field marked sent does.

### One projection and one layer per feature

Each Atlas feature that players see has, in the same places every time:

- a projection on the GM side (`src/app/online/scene/project*.ts`, as today),
- its wire type and validation (`sceneTypes.ts`, `sceneValidation.ts`),
- a player layer (`src/app/online/view/layers/<feature>Layer.ts`).

The player view stacks its layers in the order Atlas's player view draws them,
taken from the same list `playerSafeFrame.ts` uses, so the two cannot drift.

### Shared calculations

Geometry and layout that both Atlas and the player view need live in shared
modules without PIXI or Obsidian imports: hex geometry and numbering (already
shared), token sizing (`tokenSizing.ts`, shared), condition labels, and the
token resource bar and nameplate layout and text box sizing, which this piece
moves out of their PIXI renderers into shared modules that the renderers then
use.

### Guide

`docs/online-play-features.md`: "Adding a map feature to online play", the
checklist: coverage entry, projection, wire type, validation, layer, tests.

## GM camera

- While a scene is presented and live (not held), the broadcaster sends the GM's
  working view of it as `scene-camera` on the control channel:
  `{ v: 1, type: 'scene-camera', sceneId, centerX, centerY, width, height }`,
  in world units (the visible world area's centre and size). It carries no
  `seq`: it is the latest camera, not part of the scene.
- It is read from the presented view's map viewport (centre, visible world
  width and height) and sent at most every 100 ms, only when it changed.
- Nothing is sent while the scene is held; on resume, and on every snapshot to
  a player, the current camera is sent once.
- Validation: finite numbers, `width` and `height` positive and within
  `SCENE_RANGES.coordinate`; a camera for another `sceneId` is ignored.

## Player view

### Camera

- A camera is a centre and a zoom (screen pixels per world unit).
- **Following** (the default): on a GM camera, the view glides there in about
  150 ms: same centre, zoom fitting the GM's visible area to the player's
  screen.
- **Breaking away:** any player pan, zoom or pinch stops following; **Follow
  GM** and **Fit map** appear.
- Without a GM camera, the view fits the map (or, without a map size, the
  scene's content, as the preview does today).
- Zoom is limited from 1/20 of the fitted zoom to 8× it; panning keeps part of
  the map on screen.
- A new scene (new `sceneId`) returns a player to following.

### Input

- Desktop: wheel zooms around the cursor, drag pans, double-click zooms in.
- Phone: one-finger drag pans, pinch zooms around the fingers, double-tap zooms
  in. The canvas uses `touch-action: none`, so the page never zooms or scrolls
  under the map.

### Drawing

- Layers, in Atlas's player-view order: map, grid, drawings, texts, tokens,
  fog. Each draws only what is on screen.
- **Grid:** square lines or hex outlines over the visible area, dashed or
  dotted by line type, with hex numbers when the GM shows them.
- **Tokens:** art clipped to its circle (marker until loaded), ring when on,
  nameplate, HP and stress bars and condition badges as the projection sends
  them, sized with Atlas's resting token UI size.
- **Fog:** rendered once into a cached image of the map area at most 4096 px
  on its long side, redrawn only when the fog changes, drawn last and opaque.
- Redraws at most once per animation frame, only when the camera, scene,
  images or size changed, at the device pixel ratio (capped at 2 on phones);
  nothing is drawn while the page is hidden.
- Layers draw through a drawing interface (`ViewSurface`) with a 2D canvas
  implementation; tests use a recording implementation.

### Layout

- The map fills the window.
- A top bar: session name, connection status, the image loading bar, and a
  menu button.
- The menu opens a side panel (a bottom sheet on narrow screens) with the
  player list, widgets and initiative, and the **Keep images on this device**
  switch and **Clear saved images** button.
- **Follow GM** and **Fit map** float in a bottom corner while a player has
  broken away.
- The name form, waiting, refused and ended states keep their full-screen
  messages.
- Touch targets of at least 44 px, safe-area padding, portrait and landscape.

## The tab-switch issue

Switching the GM's view to another scene tab shows players "Waiting for the
GM…" instead of keeping the held scene; an integration test of the switch did
not reproduce it. This piece:

1. adds diagnostics behind a developer setting ("Log online play events"): the
   GM's console logs every presented-scene event and broadcaster send;
2. reproduces the switch in Obsidian, finds the cause, and fixes it so players
   keep the held scene and get a fresh snapshot (and camera) on return;
3. adds a test of the real cause.

## Errors and edge cases

- Images missing or loading: markers, as now.
- Window resized or rotated: the camera keeps its centre; a following player
  refits.
- A GM camera out of range or for another scene: ignored.
- A gesture starting on a button or panel does not move the map.
- Hidden page: no drawing until visible.
- A scene cleared: the view shows the waiting message; the camera resets.

## Testing

- Coverage tables: the type-level guard (a deliberate missing entry fails
  `tsc`, checked by a test fixture), and the GM-only and sent field tests.
- Camera: fit, limits, follow, break away, glide, refit on resize.
- Input: wheel, drag, double-click, touch pan, pinch, double-tap mapped to
  camera changes.
- Layers: what each layer draws for a scene, on the recording surface; fog
  cache rebuilt only when fog changes.
- `scene-camera`: validation; sent at most every 100 ms, only on change, not
  while held, once on resume and with snapshots (end to end over
  `MemoryTransport`).
- Tab switch: the regression test for the cause found.
- Manual: desktop and phone, follow and break away, a scene with a large map,
  many tokens and lots of fog stays smooth, the tab switch.
