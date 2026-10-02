# Online play: physical dice on the join page

Date: 2026-10-02. Status: design, approved by the user's decisions below.
Builds on the player tools (polish B) and the merged 3D physical dice.

## What

Players on the join page can throw Atlas's 3D physical dice in their own
browser: the same engine (`src/app/physical-dice/engine/DiceEngine.ts`), the
same white default pack with black numbers and the same physics. The dice
tumble on the player's screen only; nobody else sees the animation. The
player's device reads the settled faces and sends the result, which joins the
shared dice log marked as rolled on the player's device.

- The page's dice tray gains a Physical / RNG toggle, like Atlas's dice tray.
  The choice is remembered in `localStorage` (`atlas-online:dice-mode`), read
  and written in `try/catch`.
- In Physical mode, Roll opens a full-window 3D dice overlay with the picked
  dice. The player drags a die to throw it, or presses Throw for all of them;
  a caught die can be rerolled. Once every die has a reading, the result is
  sent. Closing the overlay (its close button or Escape) cancels: nothing is
  sent.
- RNG mode is unchanged: the GM's side rolls.
- The engine, three.js, cannon-es and the pack's textures load lazily (a
  dynamic import) the first time Physical mode throws, so the page's initial
  bundle stays small. The default pack (`dice/Texture-Pack-Default`) is bundled
  with the page as Vite assets; there is no vault access.
- Dice colours are not offered on the page: they belong to a GM collection's
  settings, which the page does not have. The player's dice are the pack's
  white.

## Wire format

A new player message, kept apart from `dice-roll` because it means something
else (the player rolled, rather than "please roll for me"):

```
Player → GM: { v: 1, type: 'dice-physical', dice: [{ type: 'd20', value: 17 }, …], modifier: 2 }
```

- `dice`: 1 to 20 entries in the order the player picked them; `type` is one of
  d4, d6, d8, d10, d12, d20, d100; `value` is the die's number as a player
  calls it: 1 to its sides (a d10 showing 0 is 10; a d100 is its tens die plus
  a d10, 1 to 100, as `readTableDice` reads them).
- `modifier`: an integer within ±1000, as for `dice-roll`.
- No formula, total or name crosses the wire. The GM builds the formula from
  the dice (grouped by type in first-appearance order, as the tray does),
  reorders the values to match, and adds them up itself.

`dice-log` entries gain an optional `physical: true`: the roll was thrown on
the roller's own device, which read the faces. Atlas's own physical rolls are
not marked (the GM's device is the authority).

## Validation

Both sides validate with the existing prototype-safe helpers (`Object.hasOwn`
for message types, `isDieType` before reading a die's sides, no indexing of an
object by a player's string):

- `protocol.ts`: `dice-physical` is 1–20 records, each with a die type and a
  safe-integer value within 1..sides, and a valid modifier; anything else is
  `invalid` and dropped. It is added to `PLAYER_MESSAGE_TYPES`.
- `DiceHost`: one rate limit (2 per second per player) covers `dice-roll` and
  `dice-physical` together. The roller is the session's name for the player.
  The result reaches Atlas's dice log, toasts and sounds through the dice feed
  with `rolledBy` and `playerDevice: true`.
- `isDiceLogEntry` accepts `physical` only when absent or a boolean, so a
  player page refuses anything else from the GM.

## Display

- Atlas's dice log entry and toast show "On their device" beside the player's
  name for a `playerDevice` roll.
- The join page's dice log and toast show the same label for a `physical`
  entry, set with `textContent`.

## Trust note

A physical roll is decided by the player's device, not the GM's. The GM's side
checks that the dice and values are possible, but it cannot tell a real throw
from a made-up result: someone who edits the page can send any possible
values. That is why such rolls are marked for everyone. A GM who needs rolls
that cannot be faked asks players to use RNG, which the GM's side rolls.

## Code layout

- `src/app/physical-dice/physicalDiceValues.ts`: the plan of table dice for a
  formula and the values read from their faces, shared by Atlas's `DiceTool`
  and the page.
- `src/app/online/tools/physicalRolls.ts`: the message check and the roll
  result the GM builds from it (pure, tested).
- `src/app/online/page/physicalDice.ts`: the page's dice mode store and the
  overlay's readings (pure, tested).
- `online-client/physicalDiceOverlay.mts`: the overlay DOM, which imports
  `physicalDiceStage.mts` lazily; that module builds the engine with the
  bundled pack.

## Testing

- Validation of `dice-physical` and `physical` log entries.
- GM handling: result built from the dice, regrouped and summed, named from
  the session, marked, rate-limited with `dice-roll`.
- Page model: mode store, readings, result to message.
- End to end over `MemoryTransport`: a physical roll reaches the GM's log and
  other players marked physical; impossible faces are dropped.
- Manual: throwing on desktop and on a phone.
