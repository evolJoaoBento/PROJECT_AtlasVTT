# Online play, piece 3: map and token images for players

Date: 2026-09-30. Status: design, awaiting review. Builds on piece 1
(`2026-09-29-online-sessions-design.md`) and piece 2
(`2026-09-30-online-scene-sync-design.md`), both merged to the fork's `main`.

## Context

Piece 2 sends players the presented scene, filtered on the GM's machine, with
every image replaced by an opaque asset id. The join page's preview draws
markers because no image ever leaves the GM. Piece 1 already opens a second
data channel per player, `assets`, which nothing uses yet.

This piece sends the map and token images of the presented scene to players
over that channel, and the join page's preview draws them. The GM does nothing
extra: images go out when players need them. Players see their images appear,
with a progress bar while they download.

## Goals

- Players receive the map background and token images of the scene presented
  to them, as the original files, and the preview draws them.
- The GM serves only images of the scene players currently have; any other
  request is refused.
- A player who has an image does not download it again: within a session
  always, across sessions when they keep images on their device.
- A progress bar shows what is still downloading.
- Nothing floods the GM's memory or upload, or delays scene updates.
- It works over any connection the session works over, including a TURN relay.

## Non-goals (this piece)

- The real player map view (piece 4); images are drawn in the preview only.
- Statblock art, handouts, loot, pin icons (built into the page), audio.
- Resized or recompressed copies: players get the original files.
- A GM view of players' download progress.
- A dedicated domain for the join page.

## Decisions

| Question | Decision |
| --- | --- |
| What players receive | The original image files. On typical home connections a map reaches five players in about ten seconds; a progress bar covers the wait. |
| Asset ids | The SHA-256 of the file's bytes (content fingerprints), replacing piece 2's random per-session ids. |
| Keeping images | A player switch, **Keep images on this device** (on by default): on, images are kept in the browser across sessions; off, only for the visit. |
| Delivery | Players request the images they lack; the GM sends only images in the current scene. |
| GM progress | None; players tell the GM (sessions usually run over a call). |

## Asset ids: content fingerprints

`AssetRegistry` becomes a content registry:

- `idFor(path)` returns the image's fingerprint (unpadded base64url SHA-256,
  43 characters) when it is known, else `null`, and starts computing it: read
  the file from the vault, hash it with `crypto.subtle.digest`, record its size
  and type.
- Results are cached by path, modification time and size, so an unchanged file
  is hashed once per session; a changed file gets a new fingerprint.
- When a fingerprint becomes known, the registry notifies the broadcaster,
  which schedules its usual 50 ms tick; the next patch carries the id. Until
  then the token or map is sent without an image, and players draw a marker.
  Presenting never waits for hashing.
- Files over 64 MB, files that cannot be read, and types other than WebP, PNG,
  JPEG, GIF, AVIF and SVG get no id. The GM sees one notice per session for a
  file over the limit: "This image is too large to send to online players."
- The registry also maps each fingerprint back to its path, size and type, so
  the server can find the file. Paths never leave the GM's machine.

A fingerprint reveals no file or folder names. It lets a player tell that two
scenes use the same image, which is accepted. Fingerprints are only sent for
images in the projection, as today's ids are.

## Protocol (assets channel, protocol v1)

Text messages are JSON with `v: 1` and a `type`, validated on both sides and
limited like control messages. Image data travels as binary frames.

| Type | Direction | Fields |
| --- | --- | --- |
| `asset-request` | player → GM | `ids` (1–64 fingerprints) |
| `asset-start` | GM → player | `id`, `handle` (a small integer for this transfer), `size`, `mime` |
| binary chunk | GM → player | 4-byte big-endian `handle`, then up to 64 KB of the file |
| `asset-end` | GM → player | `handle` |
| `asset-denied` | GM → player | `id` |
| `asset-cancel` | player → GM | `ids` (no longer needed) |

`PeerLink` gains what the server needs for pacing: the number of bytes still
buffered on a channel and a callback when it drains below a threshold
(`bufferedAmount` and `bufferedamountlow` in WebRTC; `MemoryTransport`
simulates both). `GmSession` and `PlayerSession` pass assets-channel messages
to their handlers alongside control messages, without growing past their
current size (the asset code lives in its own modules).

## GM side: `AssetServer`

A `GmSession` handler, like `SceneBroadcaster`, created with it by
`OnlineSessionService`:

- It accepts `asset-request` only from admitted players, and at most 256
  pending fingerprints per player; more are refused with `asset-denied`.
- A fingerprint is served only when it appears in the projection players
  currently have (`SceneBroadcaster.currentProjection()`: the map's `asset` and
  every token's `image`). Anything else is `asset-denied`.
- Each player has a queue, served one image at a time: the map first, then
  tokens in request order. Chunks are sent while the channel's buffer is under
  1 MB, and sending resumes when it drains, so scene updates on the control
  channel are never starved.
- A file is read from the vault once and shared by every player whose queue
  holds it; the bytes are released when no queue needs them.
- When a fingerprint leaves the projection (token deleted, scene changed,
  presenting stopped) it is removed from every queue, and a transfer in flight
  stops with `asset-denied`. `asset-cancel` does the same for one player.
- A file that became unreadable, or no longer matches its fingerprint when
  read, is `asset-denied` (and its cached fingerprint forgotten).
- A player who leaves, is kicked or is replaced by a new tab loses their queue.

## Player side

### `AssetLoader`

Shared with the web page, no Obsidian imports:

- When the scene changes, it collects every fingerprint the scene uses, loads
  the ones it has from the cache, and requests the rest (batches of 64).
- It assembles chunks by handle, only for a transfer it was told about, and
  never beyond the announced size (at most 64 MB), with at most 16 transfers
  open at once. A finished image is checked against its fingerprint; a
  mismatch is discarded and requested once more.
- It cancels fingerprints the scene no longer uses.
- On a dropped connection, partial images are discarded; after reconnecting it
  requests what it still lacks.
- A denied image, or one that does not decode, is not requested again until it
  leaves the scene and comes back.
- It exposes images as decoded bitmaps for the preview and a progress figure:
  bytes received and total for the current scene's outstanding images.

### `AssetCache`

- With **Keep images on this device** on, finished images are stored in
  IndexedDB by fingerprint, with their size, type and the time they were last
  shown. The store is capped at 500 MB; the least recently shown go first.
- Off, images are kept in memory only, and switching it off deletes the stored
  images.
- The switch and a **Clear saved images** button, showing the space used, sit
  under the preview. The switch is remembered in the browser.
- When storage is unavailable (private windows, blocked storage, quota), the
  cache works in memory and the switch shows "Can't save on this device".

### Preview

- The map image is drawn under the grid and fog, at the map's size.
- Each token is drawn as its image clipped to its circle, with the ring,
  initials and HP bar on top, as now.
- A missing or loading image shows the current marker until it is ready;
  nothing waits for anything else.
- Fog is drawn last, as now.
- A thin bar above the preview reads "Loading images… 3.2 of 5.1 MB" while
  images for the current scene are outstanding, and disappears when none are.

## Errors and edge cases

- **An image changes on disk during the session:** new fingerprint, new id in
  the next patch, players download the new version.
- **Hashing is slow for a large file:** the scene is sent without that image
  and gains it when the fingerprint is ready.
- **A player requests before their scene arrived, or for an image of another
  scene:** denied.
- **A hostile GM or connection:** the player never assembles more than the
  announced size, more than 16 transfers or more than 64 MB per image, and
  never shows bytes that do not match their fingerprint.
- **A hostile player:** request limits per player, only fingerprints of the
  current projection, one transfer at a time per player.
- **Storage full:** the least recently shown images are dropped; if writing
  still fails, the image stays in memory.

## Security and privacy

- Paths never leave the GM's machine; fingerprints reveal only whether two
  images are the same file.
- The GM serves only images of the presented scene as players currently have
  it; hidden tokens' images are never requestable, as they are not in the
  projection.
- SVG files are only drawn as images (`createImageBitmap` or `<img>`), never
  inserted into the page, so they cannot run scripts.
- Stored images live in the join page's browser storage. Every GitHub Pages
  site under the same account shares that storage, so the join page should
  stay the only one there or move to its own domain later (noted in PRIVACY).

## Testing

- **Registry:** fingerprints match SHA-256, caching by path, modification time
  and size, changed files get new ids, the size and type limits, the notice.
- **Server:** only projected fingerprints served, request limits, one transfer
  at a time per player with the map first, pacing on the buffer, shared reads,
  cancellation when an image leaves the projection, players leaving.
- **Loader and cache:** assembly by handle, size and transfer limits,
  fingerprint check and single retry, cancel, reconnect, memory and IndexedDB
  caches (fake IndexedDB in tests), eviction, clearing, storage unavailable.
- **End to end over `MemoryTransport`:** a player ends with the GM's bytes; a
  returning player with a kept cache requests nothing; a disconnect in the
  middle recovers; an image leaving the scene cancels its transfer.
- **Manual:** present a scene with a map and tokens; the progress bar runs and
  images appear; reload the player page (nothing downloads again); switch
  keeping off and reload (everything downloads); try a phone on mobile data.
