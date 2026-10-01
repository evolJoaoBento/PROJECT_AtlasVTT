# Online play polish B: player tools on the join page

Date: 2026-10-01. Status: design, awaiting review. Builds on pieces 1–5 and
polish A.

## Context

Players see the presented scene and move their own tokens (pieces 4–5). This
piece gives them Atlas's table tools on the web page: the drag ruler with the
GM's measurement settings, dice rolls that everyone sees in a shared dice log,
a private measure tool, and a laser pointer everyone sees.

## Goals

- A player dragging their token sees Atlas's drag ruler (path, waypoints,
  distance) using the GM's measurement settings.
- Players roll dice from a dice tray; the GM's side rolls them and every roll
  (GM's and players') reaches the GM's dice log and every player's dice log.
- Players measure privately with Atlas's measure shapes.
- Lasers from the GM and players are shown to everyone, drawn like Atlas's.
- The tools look and behave like Atlas's, on desktop and phones.

## Non-goals

- Shared measurements (each person's measurements stay on their screen).
- Private or GM-only rolls (Atlas's dice log has none).
- Physical dice on the web page.
- Pins, pings, walls and vision.

## Decisions

| Question | Decision |
| --- | --- |
| Dice visibility | Everyone sees every roll, GM's included. |
| Who rolls | The GM's side, so a roll cannot be faked. |
| Measurements | Private to whoever measures, GM included. |
| Laser | Shown to everyone, GM's and players'. |

## Data and messages

### Measurement settings

- The player projection gains `measurement`: units per cell, unit label and
  diagonal rule, from the same `MeasurementSettings` the drag ruler uses,
  recorded as sent in the coverage tables and validated on the player side.

### Dice

- Player → GM: `{ v: 1, type: 'dice-roll', dice: Record<'d4'|'d6'|'d8'|'d10'|'d12'|'d20'|'d100', number>, modifier }`
  (at most 20 dice in total; modifier an integer from −1000 to 1000).
- The GM's side rolls with Atlas's dice code and adds an entry to its dice log
  (roller name, formula, each die, total).
- GM → players: `dice-log` messages carrying entries: the latest 50 on
  admission, then each new entry (GM rolls, including physical dice, and player
  rolls).
- At most 2 rolls per second per player; invalid or excess rolls are ignored.

### Laser

- Player → GM: `{ v: 1, type: 'laser', sceneId, points: ScenePoint[], lifted }`
  (at most 64 points, at most 20 per second).
- The GM's side relays each to every other admitted player as
  `{ v: 1, type: 'laser', from, sceneId, points, lifted }` and shows it in the
  GM's view; the GM's own laser is sent the same way. Lasers for another scene
  are ignored; nothing is stored.
- Each person's laser has a colour from a fixed palette, by player order.

### Measure and drag ruler

- Local to the player's page; nothing is sent.

## Player page

### Toolbar

- A bottom toolbar styled like Atlas's main toolbar (button, icon, corner and
  inset rules, tooltips) with **Move** (default: pan and drag own tokens),
  **Measure** (line, cone, circle in a flyout), **Laser** and **Dice**.
- Tools that do not fit move into **More**, as Atlas's toolbar fits.
- Icons are Atlas's own, drawn as images.

### Dice tray and dice log

- The dice tray uses Atlas's dice tray look and dice icons: click a die to add,
  right-click or long-press to remove, a modifier, **Roll**.
- The dice log is a side panel (a sheet on phones) with the latest rolls:
  name, formula, each die and total, newest first. A new roll shows briefly as
  a toast while the log is closed.
- All text through `textContent`.

### Gestures

- Measure: drag from start to point; gone on release.
- Laser: hold and move; it fades after release.
- Two fingers always pinch and pan the map.
- Escape, or tapping the active tool again, returns to Move.
- Drag ruler waypoints: Atlas's waypoint key on desktop; holding still for
  half a second mid-drag on phones.

## Maintainability

- Measure shapes, the laser fade, the drag ruler maths and dice formulas move
  into renderer-free shared modules used by Atlas's renderers and the page.
- `docs/online-play-features.md` gains a "player tools" section.

## Testing

- GM: dice validation, rolling, log entries and replay on admission; laser
  relay limits and colours; measurement settings in the projection.
- Player: toolbar fit; tool switching and gestures; drag ruler waypoints;
  measure shapes; laser drawing and fade; dice tray and log.
- Shared modules: Atlas draws exactly as before.
- End to end over `MemoryTransport`: a player's roll reaches the GM's log and
  every player; a player's laser reaches others; a measurement is never sent.
- Manual: desktop and phone — roll dice, measure each shape, laser with two
  players, drag a token with waypoints.
