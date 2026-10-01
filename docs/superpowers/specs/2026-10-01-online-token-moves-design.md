# Online play, piece 5: players move their own tokens

Date: 2026-10-01. Status: design, awaiting review. Builds on pieces 1–4, all
merged to the fork's `main` (8fac5e3).

## Context

Players see the presented scene in the web map view (piece 4) but cannot act on
it. This piece lets a player drag the tokens the GM assigned to them. The GM's
side checks every move and applies it to the GM's scene; everyone sees the
result through the normal scene updates.

## Goals

- The GM assigns character tokens to connected players for the current session;
  a player may control several tokens, and a token several players.
- A player drags a controlled token on desktop or phone; the move is applied
  only when they let go.
- The GM's side accepts only valid moves from a token's controllers, applies
  Atlas's grid snapping, and records one undo step per move.
- Nothing about hidden tokens or other scenes can be learned or changed by
  trying.

## Non-goals (this piece)

- Remembering assignments across sessions. (Revisit with the Obsidian player
  client, piece 6, where players bring their own characters and sheets.)
- Rotating, resizing, HP, conditions or any token field other than position.
- Movement limits (speed, distance), walls or collision.
- GM approval of each move.
- Edge auto-scroll while dragging.

## Decisions

| Question | Decision |
| --- | --- |
| Which tokens | Tokens the GM assigns, several per player, several players per token. |
| Remembered | This session only; nothing stored in token data. |
| Approval | Moves go straight through; the GM's side checks them. |
| When applied | Only when the player lets go: one message per drop. |
| Fog | Tokens may be dropped into fog; they then disappear for players until revealed. |

## GM side

### Assigning

- While an online session runs, a character token's context menu has
  **Controlled by**, a submenu listing every admitted player as a checkbox.
- Assignments live in the running session (`TokenControl`: token id → player
  ids), never in token data, and end with the session.
- A player who reconnects in the same session keeps their tokens (the session
  recognises them by their player key); a removed (kicked) player loses theirs.
- A token deleted from the scene loses its assignments.

### Control lists

- Each admitted player is sent their own list as
  `{ v: 1, type: 'token-control', tokenIds: string[] }` (at most 256 ids) on
  admission, on every change of their assignments, and with every snapshot.
- The shared scene projection does not change: control is per player and
  travels separately.

### Moves

- A player sends `{ v: 1, type: 'token-move', sceneId, tokenId, x, y }` once
  per drop.
- The GM's side applies it only when all hold:
  - the sender is admitted and controls `tokenId`;
  - `sceneId` is the scene players currently have, and the token is in its
    projection (so not hidden and not entirely under fog at the time);
  - `x` and `y` are finite; they are clamped to the map area (or to the scene
    content's bounds without a map size).
- It then snaps the position with Atlas's own drop snapping (as when the GM
  drops a token) and writes it to the presented store with one history step
  (`runHistoryTransaction`), so it is one undo for the GM.
- A move that fails a check is answered with
  `{ v: 1, type: 'token-move-refused', tokenId }`.
- More than 10 moves per second from one player are ignored.
- When the GM and a player move the same token at once, the last write wins.

## Player side

### Showing what is theirs

- Controlled tokens get a highlight ring on that player's view; on desktop the
  cursor is a grab hand over them.

### Dragging

- Desktop: pressing on a controlled token drags it; pressing elsewhere pans;
  the wheel zooms.
- Phone: one finger on a controlled token drags it; one finger elsewhere pans;
  two fingers always pinch and pan, even when one starts on a token.
- While dragging, only the player's own view shows the token following the
  pointer (a preview); nothing is sent until release.
- On release one `token-move` is sent. A cancelled drag (pointer cancel, Escape,
  connection lost, the token leaving the scene, a new scene, losing control)
  sends nothing.
- Dragging does not stop following the GM's view.

### After the drop

- The token stays at the drop spot until the scene update arrives, then shows
  where the GM's scene put it (snapped). A refused move returns it to its
  scene position and shows "Move not allowed." for a few seconds.
- Without any update within 2 seconds, the preview is dropped and the token
  shows its scene position.

## Errors and edge cases

- A move for a token that left the projection (hidden, fogged over, deleted)
  between drag and drop: refused.
- A player removed during a drag: the drop is ignored.
- Reconnect: the control list is sent again with the snapshot.
- A token controlled by two players dropped by both: both apply in arrival
  order.

## Security

- Only position changes, only for controlled tokens in the current projection.
- Refusals carry only the token id the player sent; they reveal nothing about
  hidden tokens.
- Players still cannot send scene data; the GM accepts only `scene-resync` and
  `token-move` from them.

## Testing

- GM: assignment changes and control lists; every move check (not admitted,
  not controlled, wrong scene, hidden, fogged, non-finite, clamping, snapping,
  rate limit); one undo step per move; kick removes control; deleted tokens
  lose assignments.
- Player: hit-testing controlled tokens; drag versus pan versus pinch; cancel
  paths; preview, confirmation, refusal and timeout.
- End to end over `MemoryTransport`: a player's drop reaches the GM's store and
  comes back to every player as a patch; unassigned and hidden tokens are
  refused.
- Manual: assign two tokens to a player, drag both on desktop and phone, try an
  unassigned one, drag into fog, undo in Atlas.
