# Online Asset Streaming (Online Play, Piece 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send the map and token images of the presented scene to online players over the `assets` data channel, as the original files identified by their SHA-256, keep them on the player's device, and draw them in the join page's preview with a progress bar.

**Architecture:** `AssetRegistry` becomes a content registry: it hashes vault images in the background (one at a time) and gives the projection their fingerprints once known, which makes `SceneBroadcaster` project again. `AssetServer`, a second `GmSession` handler, serves over each admitted player's assets channel only the fingerprints in `SceneBroadcaster.currentProjection()`, one image at a time per player, map first, in 64 KB binary chunks paced on the channel's buffer (`PeerLink.bufferedAmount` / `onDrain`, simulated by `MemoryLink`). On the player side `AssetLoader` (shared with the web page) follows the scene, loads what `AssetCache` has (IndexedDB when keeping is on, memory otherwise), requests the rest, assembles chunks with `TransferAssembler`, verifies every image against its fingerprint and decodes it for the preview.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Web Crypto (`crypto.subtle.digest`), WebRTC data channels through PeerJS, IndexedDB, Obsidian API (`vault.readBinary`, `TFile.stat`), Vitest (jsdom, no canvas, no IndexedDB), Vite (join page build).

**Spec:** `docs/superpowers/specs/2026-09-30-online-asset-streaming-design.md` (builds on `docs/superpowers/specs/2026-09-30-online-scene-sync-design.md`, implemented by `docs/superpowers/plans/2026-09-30-online-scene-sync.md`).

## Global Constraints

- Assets channel, protocol version `1` (`PROTOCOL_VERSION`). Text messages are JSON `{ v: 1, type, ...fields }`: `asset-request` (player → GM, `ids`: 1–64 fingerprints), `asset-start` (GM → player, `id`, `handle`, `size`, `mime`), `asset-end` (GM → player, `handle`), `asset-denied` (GM → player, `id`), `asset-cancel` (player → GM, `ids`: 1–64 fingerprints). Validated on both sides; unknown types are ignored. A text message is at most 16 KB (`ASSET_LIMITS.messageBytes = 16 * 1024`; the longest valid one is about 3.2 KB).
- Binary chunk: a 4-byte big-endian `handle` (1 to `0xffff_ffff`), then 1 to 65 536 file bytes (`ASSET_LIMITS.chunkBytes = 64 * 1024`).
- Asset ids are fingerprints: the unpadded base64url SHA-256 of the file's bytes, 43 characters, `/^[A-Za-z0-9_-]{43}$/` (`isAssetId`). They replace piece 2's random ids. Paths never leave the GM's machine.
- Images served: files of at most 64 MB (`ASSET_LIMITS.fileBytes = 64 * 1024 * 1024`) whose extension is `webp`, `png`, `jpg`, `jpeg`, `gif`, `avif` or `svg` (any case). Files over the limit get no id and the GM sees one Notice per session: "This image is too large to send to online players." Unreadable files and other types get no id, silently.
- Fingerprints are cached by path, modification time and size: an unchanged file is hashed once per session, a changed one gets a new fingerprint. `idFor` never waits; presenting never waits for hashing.
- One MB is 1024 × 1024 bytes everywhere, including the progress text.
- GM: requests only from admitted players; only fingerprints in `SceneBroadcaster.currentProjection()` (`map.asset` and every token's `image`) are served, anything else is `asset-denied`; at most 256 fingerprints queued or in flight per player (`ASSET_LIMITS.pendingPerPlayer = 256`), more are `asset-denied`; one transfer at a time per player, the map first, then tokens in request order; chunks are sent while the channel buffers less than 1 MB (`ASSET_LIMITS.highWaterBytes = 1024 * 1024`) and sending resumes when it drains to 256 KB (`ASSET_LIMITS.lowWaterBytes = 256 * 1024`).
- Player: assembles only transfers announced by `asset-start` for a fingerprint it requested, never beyond the announced size nor 64 MB, at most 16 open at once (`ASSET_LIMITS.openTransfers = 16`); every image (from the GM or the cache) is checked against its fingerprint before it is shown; a mismatch is requested once more; denied or undecodable images are not requested again until they leave the scene and come back; at most 256 requests outstanding, at most 64 ids per message.
- Player cache: 500 MB (`ASSET_LIMITS.cacheBytes = 500 * 1024 * 1024`), least recently shown dropped first.
- Join page text, exactly: switch **Keep images on this device** (on by default, remembered in `localStorage` under `atlas-online:keep-images`), button **Clear saved images** with the space used ("Clear saved images (12.3 MB)"), the switch label "Can't save on this device" when storage is unavailable, and the bar "Loading images… 3.2 of 5.1 MB" (one decimal; "Loading images…" before any size is known). Text only through `textContent`.
- SVG files are only drawn as images (`createImageBitmap`, or an `<img>` for SVG), never inserted into the page.
- Shared with the web page, so no imports from `obsidian`, PIXI, PeerJS or React: `src/app/online/assets/assetIds.ts`, `assetProtocol.ts`, `TransferAssembler.ts`, `AssetCache.ts`, `AssetLoader.ts`, `indexedDbImageStore.ts`, `src/app/online/preview/assetStatus.ts`, `src/app/online/PlayerSession.ts`. `src/app/online/scene/AssetRegistry.ts` imports nothing from Obsidian either; the vault is reached only through `src/app/online/assets/vaultImageFiles.ts`.
- Never test binary data with `instanceof ArrayBuffer`: buffers from Web Crypto, workers and the test environment come from another realm. Use `isArrayBuffer` / `binaryOf` (`assetIds.ts` / `assetProtocol.ts`).
- Tests driven by fake timers pass `nodeHash` (`tests/unit/online/assetFixtures.ts`) as the hasher: Web Crypto resolves on Node's thread pool, outside fake timers' control. One real-timer registry test checks the default `crypto.subtle` path against `node:crypto`.
- File sizes: `GmSession.ts` stays at or under its current 317 lines (its types move to `gmSessionTypes.ts`), `SceneBroadcaster.ts` at or under 300, `PeerTransport.ts` (352 today) is split so every file stays under 300. `GmSession` and `PlayerSession` only pass assets-channel data through; the asset code lives in `src/app/online/assets/`.
- Wire fields are `T | null`, never optional. Every block of code compiles under `strict`, `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.
- Code style (CLAUDE.md, CONTRIBUTING.md, ESLint): explicit return types; files under about 300 lines; `window.setTimeout` / `window.clearTimeout` / `window.requestAnimationFrame` in `src` (`obsidianmd/prefer-window-timers`); sentence-case UI text; no inline `eslint-disable` (`noInlineConfig`); no `title` attributes; player-facing changes in `changelog/Unreleased.md`.
- Tests live in `tests/unit/online/` (Vitest, jsdom: no canvas, no IndexedDB, no `createImageBitmap`). The join page's canvas drawing, image decoding and IndexedDB adapter are thin layers over tested code.

## Review Focus

- **Many tokens share one image, or the map image is also a token's.** Players expect one download, drawn everywhere it appears. Test in Task 8 (`asks for an image once however many tokens show it`).
- **The GM edits an image file during the session.** Players still holding the old fingerprint must end up with the new version, never a mix or a stuck marker: the stale read is denied, the fingerprint forgotten, and the next patch carries the new id. Test in Task 9 (`an image edited during the session reaches players as its new version`).
- **Scene patches keep arriving while a large image waits on a full buffer.** Token moves must not queue behind image bytes. Test in Task 9 (`recovers from a disconnect in the middle of a transfer, and scene updates keep flowing`).
- **The connection drops in the middle of a transfer.** Partial images are discarded, chunks of the old link never mix with the new link's transfers, and only missing images are requested again. Test in Task 8 (`drops partial images on a disconnect and asks for what it lacks after reconnecting`) and Task 9 (same test as above).
- **An image that does not decode** (corrupt file, mislabeled type). The marker stays and the player does not request it in a loop as patches keep arriving. Test in Task 8 (`does not ask again for an image that does not decode`).

The spec's other likely failures have tests too: requests for images outside the projection (Task 6), a player flooding requests (Task 6), a hostile GM overflowing a transfer or announcing too much (Tasks 7 and 8), storage full or unavailable (Task 7), a returning player with a kept cache (Task 9).

## Decisions made while planning

The spec leaves these open; each task repeats the one it needs.

1. **Image type by extension.** `mimeForPath` maps `webp`, `png`, `jpg`/`jpeg`, `gif`, `avif`, `svg` (case-insensitive) to their MIME types; no magic-byte sniffing. A mislabeled file fails to decode on the player's side and is not requested again (spec: "one that does not decode").
2. **Hashing one file at a time.** The registry keeps a queue and reads and hashes one file at a time, so hashing holds at most one file (≤ 64 MB) in memory.
3. **`AssetRegistry.onChange`** fires when a fingerprint becomes known and when one is forgotten; the broadcaster schedules its 50 ms tick on either, so a forgotten id disappears from (or changes in) the next patch.
4. **Serving re-reads and verifies.** `AssetRegistry.read(id)` reads the file again and checks its SHA-256; unreadable or changed → `null`, and the fingerprint is forgotten (spec: "no longer matches its fingerprint when read").
5. **Asset text messages are limited to 16 KB**, a tighter limit than control messages' 256 KB, since the longest valid one is about 3.2 KB.
6. **Low water 256 KB**: the drain callback (`bufferedamountlow`) fires at 256 KB; sending resumes then, up to 1 MB again.
7. **When an image leaves the projection** only a transfer in flight gets `asset-denied`; queued fingerprints are dropped silently, and `asset-cancel` gets no reply. Denials are keyed by id and travel on a different channel than scene patches, so every extra denial could arrive after the image came back and block it (spec wording followed literally).
8. **Queues end with the channel.** `AssetServer` drops a player's queue when their assets channel closes (leaving, kick, drop, or a newer tab replacing the older, whose link `GmSession` closes first) and on `onGone`; it does not react to `onAdmitted`, which `GmSession` calls after sending `admitted`, so a fast player's first request can already be queued.
9. **Outstanding requests.** The player keeps at most 256 requests outstanding (the GM's limit) and requests more as images finish, so scenes with more than 256 images still load. Requests go in messages of up to 64 ids, the map first.
10. **Cached images are verified too.** The join page's storage is shared with every page under the same github.io account, so a stored image is hashed before it is shown; a mismatch is requested from the GM.
11. **A broken transfer** (more bytes than announced, fewer at the end, a fingerprint mismatch, or a start the assembler refuses) is cancelled with `asset-cancel` and requested once more; a second failure refuses the image until it leaves the scene.
12. **Progress.** `outstanding` counts images waiting or requested; `receivedBytes` and `totalBytes` add the bytes of images finished since the bar was last empty to the partial transfers and their announced sizes. The bar shows "Loading images…" until a size is known.
13. **Cache tiers.** Keeping on and storage available: images are stored in IndexedDB only. Otherwise they are kept in memory for the visit, under the same 500 MB cap. A failed write drops the least recently shown stored images to free the image's size and retries once; if it still fails, the image stays in memory and the cache reports `available: false` ("Can't save on this device"). **Clear saved images** empties IndexedDB; switching keeping off deletes the stored images. Images of the visit that were stored, not in memory, download again if they leave the scene and come back after keeping was switched off. Undecodable images are never cached.
14. **IndexedDB adapter untested in Vitest.** jsdom has no IndexedDB and `fake-indexeddb` is not a devDependency; the cache logic is tested against an in-memory `ImageStore`, and `indexedDbImageStore.ts` (a thin adapter) is covered by the manual test (reload keeps images; private window shows "Can't save on this device").
15. **Held scenes.** A fingerprint that becomes known while the presented scene is held (the GM browses another tab) reaches players when it resumes, since a held scene is never projected again.
16. **Changed files** get their new fingerprint at the next projection (any scene change, or a stale read that forgets the old one); the registry does not subscribe to vault events.
17. **Preview drawing.** The map image is drawn at `(0, 0)` with the map's width and height (skipped while the size is 0 × 0), after the map colour and before the grid; token art is drawn cover-fit and clipped to the token's circle, then the ring in the marker colour, the initials and the HP bar; fog last.
18. **File sizes.** `GmSession.ts` moves `SESSION_LIMITS` and its types into `gmSessionTypes.ts` (re-exported, so imports stay) and ends at about 302 lines. `PlayerSession.ts` grows by about 20 lines (170 → about 190) for the assets hook: the spec's "without growing past their current size" is read as "the asset code lives in its own modules"; the file stays far under the 300-line rule. `PeerTransport.ts` moves its link class into `peerLink.ts`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/app/online/transport/types.ts` (modify) | `PeerLink.bufferedAmount` / `onDrain`; `ChannelPort`. |
| `src/app/online/transport/peerLink.ts` | `PeerJsLink` (moved from `PeerTransport.ts`), its inbox and flush, and pacing on the data channel. |
| `src/app/online/transport/PeerTransport.ts` (modify) | Host and client; uses `peerLink.ts`. |
| `src/app/online/transport/MemoryTransport.ts` (modify) | `MemoryLink` exported, with `hold` / `flush` / `release` to simulate buffering. |
| `src/app/online/transport/channelPort.ts` | One channel of a link as a `ChannelPort`. |
| `src/app/online/ids.ts` (modify) | `base64Url`, shared by `randomId` and fingerprints. |
| `src/app/online/assets/assetIds.ts` | `ASSET_LIMITS`, MIME types, `isAssetId`, `mimeForPath`, `sha256Id`, `sceneAssetIds`, `isArrayBuffer`. Shared. |
| `src/app/online/assets/assetProtocol.ts` | Asset messages and binary chunks: encode, decode, validate. Shared. |
| `src/app/online/scene/AssetRegistry.ts` (rewrite) | Content registry: fingerprints, cache by path/mtime/size, reverse map, verified reads, notice. |
| `src/app/online/assets/vaultImageFiles.ts` | The vault's images for the registry (Obsidian). |
| `src/app/online/scene/projectForPlayers.ts` (modify) | `ProjectionContext.assets` is an `AssetIds`. |
| `src/app/online/scene/sceneSources.ts` (modify) | `assets` option; broadcaster constants and `LiveScene` moved here. |
| `src/app/online/scene/SceneBroadcaster.ts` (modify) | Uses the registry, re-projects on `onChange`, `onProjection`. |
| `src/app/online/gmSessionTypes.ts` | `SESSION_LIMITS`, `SessionPlayer`, `SessionHandler` (with `onAssetData`), options. |
| `src/app/online/GmSession.ts` (modify) | Routes assets-channel data to handlers; `assetChannel(playerId)`. |
| `src/app/online/PlayerSession.ts` (modify) | `PlayerAssetHandler`: passes assets-channel data and link changes to the loader. |
| `src/app/online/assets/SharedReads.ts` | File bytes shared by every queue holding a fingerprint. |
| `src/app/online/assets/AssetServer.ts` | GM side: queues, limits, pacing, projection following. |
| `src/app/online/assets/TransferAssembler.ts` | Player side: chunks by handle, within limits. Shared. |
| `src/app/online/assets/AssetCache.ts` | Player side: stored and in-memory images, LRU, clear, availability. Shared. |
| `src/app/online/assets/indexedDbImageStore.ts` | `ImageStore` on IndexedDB. Shared (browser only). |
| `src/app/online/assets/AssetLoader.ts` | Player side: wanted images, requests, verify, decode, progress. Shared. |
| `src/app/online/OnlineSessionService.ts` (modify) | Creates the registry and the asset server with the session. |
| `src/app/online/preview/previewShapes.ts` (modify) | Token markers carry their image id. |
| `src/app/online/preview/assetStatus.ts` | Progress, switch and button texts. Shared. |
| `online-client/imageDecoder.mts` | Decodes images for the preview (`createImageBitmap`, `<img>` for SVG). |
| `online-client/assetsPanel.mts` | Loading bar, keep switch, clear button. |
| `online-client/preview.mts`, `main.mts`, `index.html`, `style.css` (modify) | Draw images; wire loader, cache and panel. |
| `README.md`, `PRIVACY.md`, `changelog/Unreleased.md` (modify) | Player-facing documentation. |

Tests: `tests/unit/online/assetFixtures.ts` (new shared fixtures), `assetProtocol.test.ts`, `assetRegistry.test.ts`, `assetServer.test.ts`, `transferAssembler.test.ts`, `assetCache.test.ts`, `assetLoader.test.ts`, `assetStreamingEndToEnd.test.ts`, `assetStatus.test.ts`, `playerSessionAssets.test.ts` (new); `memoryTransport.test.ts`, `peerTransport.test.ts`, `gmSession.test.ts`, `sceneBroadcaster.test.ts`, `sceneSyncEndToEnd.test.ts`, `projectForPlayers.test.ts`, `onlineSessionService.test.ts`, `scenePreview.test.ts`, `sceneFixtures.ts` (modify).

Task order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11. Task 6 needs 1–5; Task 7 needs 2; Task 8 needs 4 and 7; Task 9 needs 3, 5, 6 and 8; Task 10 needs 7 and 8.

---

### Task 1: Pacing on links: buffered bytes and drain callbacks

**Files:**
- Modify: `src/app/online/transport/types.ts` (the `PeerLink` interface)
- Create: `src/app/online/transport/peerLink.ts`
- Modify: `src/app/online/transport/PeerTransport.ts:1-143` (the link class moves out)
- Modify: `src/app/online/transport/MemoryTransport.ts:15-35` (the `MemoryLink` class)
- Test: `tests/unit/online/peerTransport.test.ts`, `tests/unit/online/memoryTransport.test.ts`

**Interfaces:**
- Consumes: existing `Channel`, `PeerLink`, `Unsubscribe` (`transport/types.ts`); PeerJS `DataConnection` (type only).
- Produces:
  - `PeerLink.bufferedAmount(channel: Channel): number` — bytes sent on `channel` that have not left this side; 0 once closed.
  - `PeerLink.onDrain(channel: Channel, threshold: number, cb: () => void): Unsubscribe` — `cb` each time `channel`'s buffer drains to `threshold` bytes or less (WebRTC `bufferedamountlow`); the last call sets the channel's threshold.
  - `peerLink.ts`: `class PeerJsLink implements PeerLink`, `class Inbox`, `listen(connection, channel, inbox): void`, `FLUSH_POLL_MS = 50`, `FLUSH_GRACE_MS = 100`, `FLUSH_CAP_MS = 1500` (re-exported from `PeerTransport.ts`).
  - `MemoryTransport.ts`: `export class MemoryLink implements PeerLink` with test controls `hold(channel: Channel): void`, `flush(channel: Channel, bytes?: number): void`, `release(channel: Channel): void`. A string counts `length` bytes, an `ArrayBuffer` `byteLength`. Unheld channels deliver at once and buffer nothing, as before.

PeerJS only queues messages itself when the data channel buffers more than 8 MB, which a sender pacing at 1 MB never reaches, so the data channel's `bufferedAmount` and `bufferedamountlow` event are the whole story.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/online/peerTransport.test.ts`, replace the `FakeConnection` class's `dataChannel` line (line 18, `dataChannel: { bufferedAmount: number } | null = { bufferedAmount: 0 };`) with a fake data channel, adding the class above `FakeConnection`:

```ts
/** Just enough of RTCDataChannel for flushing and pacing. */
class FakeDataChannel {
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  private readonly lowListeners = new Set<() => void>();
  addEventListener(_type: 'bufferedamountlow', cb: () => void): void { this.lowListeners.add(cb); }
  removeEventListener(_type: 'bufferedamountlow', cb: () => void): void { this.lowListeners.delete(cb); }
  /** Drains to `amount`; like a browser, fires `bufferedamountlow` when it falls to the threshold from above. */
  drainTo(amount: number): void {
    const above = this.bufferedAmount > this.bufferedAmountLowThreshold;
    this.bufferedAmount = amount;
    if (above && amount <= this.bufferedAmountLowThreshold) [...this.lowListeners].forEach((cb) => cb());
  }
}
```

```ts
  dataChannel: FakeDataChannel | null = new FakeDataChannel();
```

Then append at the end of the file:

```ts
describe('PeerTransport pacing', () => {
  async function openedClient(): Promise<{ control: FakeConnection; assets: FakeConnection; link: Awaited<ReturnType<ReturnType<typeof createPeerClient>['connect']>> }> {
    const pending = createPeerClient({ iceServers: [] }).connect('gm-id');
    const peer = peers[0]!;
    peer.emit('open', 'me');
    const [control, assets] = peer.connections as [FakeConnection, FakeConnection];
    control.emit('open');
    assets.emit('open');
    return { control, assets, link: await pending };
  }

  it('reports the bytes waiting on each channel and calls back when one drains', async () => {
    const { control, assets, link } = await openedClient();
    assets.dataChannel!.bufferedAmount = 2_000_000;
    control.dataChannel!.bufferedAmount = 5;
    expect(link.bufferedAmount('assets')).toBe(2_000_000);
    expect(link.bufferedAmount('control')).toBe(5);

    let drained = 0;
    const stop = link.onDrain('assets', 256 * 1024, () => drained++);
    expect(assets.dataChannel!.bufferedAmountLowThreshold).toBe(256 * 1024);
    assets.dataChannel!.drainTo(300_000);
    expect(drained).toBe(0);
    assets.dataChannel!.drainTo(100_000);
    expect(drained).toBe(1);

    stop();
    assets.dataChannel!.bufferedAmount = 2_000_000;
    assets.dataChannel!.drainTo(0);
    expect(drained).toBe(1);
  });

  it('reports nothing buffered and no drains once closed', async () => {
    vi.useFakeTimers();
    const { assets, link } = await openedClient();
    let drained = 0;
    link.onDrain('assets', 10, () => drained++);
    assets.dataChannel!.bufferedAmount = 50;
    link.close();
    expect(link.bufferedAmount('assets')).toBe(0);
    assets.dataChannel!.drainTo(0);
    expect(drained).toBe(0);
  });

  it('does without a data channel that has no events', async () => {
    const { assets, link } = await openedClient();
    (assets as unknown as { dataChannel: unknown }).dataChannel = { bufferedAmount: 7 };
    expect(link.bufferedAmount('assets')).toBe(7);
    expect(() => link.onDrain('assets', 1, () => {})()).not.toThrow();
  });
});
```

In `tests/unit/online/memoryTransport.test.ts`, change the imports and append two tests inside `describe('MemoryTransport', …)`:

```ts
import { MemoryLink, MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';
```

```ts
  it('holds a channel, counts what waits and signals the drain', async () => {
    const network = new MemoryNetwork();
    const host = network.host('gm');
    const hostLinks: MemoryLink[] = [];
    host.onConnection((link) => hostLinks.push(link as MemoryLink));
    const client = await network.client().connect('gm');
    const received: Array<[string, unknown]> = [];
    client.onMessage((channel, data) => received.push([channel, data]));
    const gmEnd = hostLinks[0]!;
    let drains = 0;
    gmEnd.onDrain('assets', 10, () => drains++);

    gmEnd.hold('assets');
    gmEnd.send('assets', new ArrayBuffer(8));
    gmEnd.send('assets', 'abcdef');
    gmEnd.send('control', 'now');
    expect(received).toEqual([['control', 'now']]);
    expect(gmEnd.bufferedAmount('assets')).toBe(14);
    expect(gmEnd.bufferedAmount('control')).toBe(0);

    gmEnd.flush('assets', 1);
    expect(received).toHaveLength(2);
    expect(gmEnd.bufferedAmount('assets')).toBe(6);
    expect(drains).toBe(1);

    gmEnd.release('assets');
    expect(received.at(-1)).toEqual(['assets', 'abcdef']);
    expect(drains).toBe(1); // it was under the threshold already
    gmEnd.send('assets', 'x');
    expect(received.at(-1)).toEqual(['assets', 'x']);
  });

  it('drops what waits when the link closes', async () => {
    const network = new MemoryNetwork();
    const host = network.host('gm');
    const hostLinks: MemoryLink[] = [];
    host.onConnection((link) => hostLinks.push(link as MemoryLink));
    const client = await network.client().connect('gm');
    const received: unknown[] = [];
    client.onMessage((_channel, data) => received.push(data));
    const gmEnd = hostLinks[0]!;
    gmEnd.hold('assets');
    gmEnd.send('assets', 'waiting');
    gmEnd.close();
    expect(gmEnd.bufferedAmount('assets')).toBe(0);
    gmEnd.flush('assets');
    expect(received).toEqual([]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/online/peerTransport.test.ts tests/unit/online/memoryTransport.test.ts`
Expected: FAIL — `link.bufferedAmount is not a function`, `MemoryLink` is not exported (`hostLinks[0]!.onDrain is not a function`).

- [ ] **Step 3: Add pacing to the link interface**

In `src/app/online/transport/types.ts`, replace the `PeerLink` interface with:

```ts
/** One player's connection, both channels. */
export interface PeerLink {
  readonly remoteId: string;
  /** Sending on a closed link does nothing. */
  send(channel: Channel, data: string | ArrayBuffer): void;
  /** Bytes sent on `channel` that have not left this side yet; 0 once closed. */
  bufferedAmount(channel: Channel): number;
  /**
   * Calls `cb` each time `channel`'s buffer drains to `threshold` bytes or less
   * (WebRTC's `bufferedamountlow`). One threshold per channel: the last call sets it.
   */
  onDrain(channel: Channel, threshold: number, cb: () => void): Unsubscribe;
  onMessage(cb: (channel: Channel, data: unknown) => void): Unsubscribe;
  /** Called once, when either end closes. */
  onClose(cb: () => void): Unsubscribe;
  close(): void;
}
```

- [ ] **Step 4: Move the PeerJS link into its own module, with pacing**

Create `src/app/online/transport/peerLink.ts` (the code moved from `PeerTransport.ts` is unchanged apart from `export`; `bufferedAmount`, `onDrain` and `dataChannelOf` are new):

```ts
/**
 * A player's two PeerJS data connections as one `PeerLink`: an inbox that
 * replays messages which beat the first subscriber, a flush before the
 * connections close, and pacing on each data channel's buffer.
 */
import type { DataConnection } from 'peerjs';
import type { Channel, PeerLink, Unsubscribe } from './types';

/** Messages kept for a link nobody listens to yet. */
const MAX_BUFFERED_MESSAGES = 64;
/** How often a closing link checks whether what it sent has left. */
export const FLUSH_POLL_MS = 50;
/** Extra wait after the send buffers are empty, for the last bytes on the wire. */
export const FLUSH_GRACE_MS = 100;
/** Longest a closing link (or host) waits before tearing the connection down anyway. */
export const FLUSH_CAP_MS = 1500;

/**
 * Collects what arrives on a link's connections from the moment they exist, so a
 * message that beats the first subscriber (a join on the first-open half) is replayed.
 */
export class Inbox {
  private queue: Array<[Channel, unknown]> = [];
  private readonly listeners = new Set<(channel: Channel, data: unknown) => void>();

  push(channel: Channel, data: unknown): void {
    if (this.listeners.size === 0) {
      if (this.queue.length < MAX_BUFFERED_MESSAGES) this.queue.push([channel, data]);
      return;
    }
    [...this.listeners].forEach((cb) => cb(channel, data));
  }

  subscribe(cb: (channel: Channel, data: unknown) => void): Unsubscribe {
    const early = this.queue;
    this.queue = [];
    this.listeners.add(cb);
    early.forEach(([channel, data]) => cb(channel, data));
    return () => { this.listeners.delete(cb); };
  }
}

export function listen(connection: DataConnection, channel: Channel, inbox: Inbox): void {
  connection.on('data', (data: unknown) => inbox.push(channel, data));
}

/** The data channel under a connection; null before it opened or after it closed. */
function dataChannelOf(connection: DataConnection): RTCDataChannel | null {
  return (connection.dataChannel as RTCDataChannel | null | undefined) ?? null;
}

/** Nothing queued in PeerJS or the data channel: what was sent has left this side. */
function drained(connection: DataConnection): boolean {
  if (!connection.open) return true;
  const queued = (connection as { bufferSize?: number }).bufferSize ?? 0;
  return queued === 0 && (dataChannelOf(connection)?.bufferedAmount ?? 0) === 0;
}

/**
 * Closes connections once what was sent on them has left, bounded by FLUSH_CAP_MS.
 * PeerJS closes the RTCPeerConnection in the same tick as close(), which would drop
 * a message sent just before (a refusal, a bye). Never closes in the calling tick.
 */
function closeAfterFlush(connections: DataConnection[]): Promise<void> {
  return new Promise((resolve) => {
    let waited = 0;
    const finish = (): void => {
      connections.forEach((connection) => connection.close());
      resolve();
    };
    const check = (): void => {
      if (waited >= FLUSH_CAP_MS) { finish(); return; }
      if (connections.every(drained)) {
        window.setTimeout(finish, Math.min(FLUSH_GRACE_MS, FLUSH_CAP_MS - waited));
        return;
      }
      waited += FLUSH_POLL_MS;
      window.setTimeout(check, FLUSH_POLL_MS);
    };
    window.setTimeout(check, 0);
  });
}

/**
 * A player's two data connections as one link. Closing it is immediate for the
 * sessions (no more sends or messages, close listeners fire), while the
 * connections themselves close once what was sent has been flushed.
 */
export class PeerJsLink implements PeerLink {
  private closed = false;
  private readonly closeListeners = new Set<() => void>();

  constructor(
    readonly remoteId: string,
    private readonly channels: Record<Channel, DataConnection>,
    private readonly inbox: Inbox,
    /** Told once the link closes: null when its connections closed already, else when they will have. */
    private readonly onClosed: (released: Promise<void> | null) => void,
  ) {
    // The other end went away: nothing to flush, tear down now.
    for (const connection of Object.values(channels)) {
      connection.on('close', () => this.shut(false));
      connection.on('error', () => this.shut(false));
    }
  }

  send(channel: Channel, data: string | ArrayBuffer): void {
    if (!this.closed) void this.channels[channel].send(data);
  }

  bufferedAmount(channel: Channel): number {
    if (this.closed) return 0;
    return dataChannelOf(this.channels[channel])?.bufferedAmount ?? 0;
  }

  onDrain(channel: Channel, threshold: number, cb: () => void): Unsubscribe {
    const dataChannel = dataChannelOf(this.channels[channel]);
    if (!dataChannel || typeof dataChannel.addEventListener !== 'function') return () => {};
    dataChannel.bufferedAmountLowThreshold = threshold;
    const listener = (): void => { if (!this.closed) cb(); };
    dataChannel.addEventListener('bufferedamountlow', listener);
    return () => dataChannel.removeEventListener('bufferedamountlow', listener);
  }

  onMessage(cb: (channel: Channel, data: unknown) => void): Unsubscribe {
    return this.inbox.subscribe((channel, data) => { if (!this.closed) cb(channel, data); });
  }

  onClose(cb: () => void): Unsubscribe {
    this.closeListeners.add(cb);
    return () => this.closeListeners.delete(cb);
  }

  close(): void {
    this.shut(true);
  }

  private shut(flush: boolean): void {
    if (this.closed) return;
    this.closed = true;
    const connections = Object.values(this.channels);
    let released: Promise<void> | null = null;
    if (flush) released = closeAfterFlush(connections);
    else connections.forEach((connection) => connection.close());
    this.closeListeners.forEach((cb) => cb());
    this.closeListeners.clear();
    this.onClosed(released);
  }
}
```

In `src/app/online/transport/PeerTransport.ts`, replace lines 1–143 (everything above `/**\n * Hosts a session under a fresh id.`) with the following; lines 145 to the end stay as they are:

```ts
import { Peer, type DataConnection } from 'peerjs';
import { randomId } from '../ids';
import { FLUSH_CAP_MS, Inbox, listen, PeerJsLink } from './peerLink';
import { asError, peerHostId, peerOptions, TransportFailure, type PeerServerOptions } from './peerOptions';
import type { Channel, ClientTransport, HostTransport, PeerLink, TransportError } from './types';

export type { PeerServerOptions };
export { FLUSH_CAP_MS, FLUSH_GRACE_MS, FLUSH_POLL_MS } from './peerLink';

export const LINK_OPEN_TIMEOUT_MS = 15_000;
/** Pending (unpaired) links a host tolerates at once. */
const MAX_PENDING_LINKS = 32;
/** Delays before re-registering with a signaling server that dropped us; the last repeats. */
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15_000];

/**
 * Tears a connection down, opened or not: PeerJS closes the RTCPeerConnection either
 * way, and one that never opened will not open later (it just emits no 'close').
 */
function refuse(connection: DataConnection): void {
  connection.close();
}

```

- [ ] **Step 5: Let `MemoryLink` simulate a slow channel**

In `src/app/online/transport/MemoryTransport.ts`, replace the `MemoryLink` class (from `/** One end of an in-memory link; `peer` is the other end. */` to its closing brace) with:

```ts
function sizeOf(data: string | ArrayBuffer): number {
  return typeof data === 'string' ? data.length : data.byteLength;
}

/**
 * One end of an in-memory link; `peer` is the other end. Delivery is immediate,
 * except on a channel a test holds: what is sent there waits, counts as
 * buffered, and leaves on `flush`, which signals drains as WebRTC does.
 */
export class MemoryLink implements PeerLink {
  peer!: MemoryLink;
  private closed = false;
  private readonly messages = listeners<[Channel, unknown]>();
  private readonly closes = listeners<[]>();
  private readonly held = new Set<Channel>();
  private readonly waiting: Record<Channel, Array<string | ArrayBuffer>> = { control: [], assets: [] };
  private readonly drains: Record<Channel, { threshold: number; callbacks: Set<() => void> }> = {
    control: { threshold: 0, callbacks: new Set() },
    assets: { threshold: 0, callbacks: new Set() },
  };

  constructor(readonly remoteId: string) {}

  send(channel: Channel, data: string | ArrayBuffer): void {
    if (this.closed) return;
    if (this.held.has(channel)) {
      this.waiting[channel].push(data);
      return;
    }
    this.peer.messages.emit(channel, data);
  }

  bufferedAmount(channel: Channel): number {
    return this.waiting[channel].reduce((total, data) => total + sizeOf(data), 0);
  }

  onDrain(channel: Channel, threshold: number, cb: () => void): Unsubscribe {
    const drain = this.drains[channel];
    drain.threshold = threshold;
    drain.callbacks.add(cb);
    return () => { drain.callbacks.delete(cb); };
  }

  onMessage(cb: (channel: Channel, data: unknown) => void): Unsubscribe { return this.messages.add(cb); }
  onClose(cb: () => void): Unsubscribe { return this.closes.add(cb); }

  /** Test control: what is sent on `channel` from now on waits until flushed. */
  hold(channel: Channel): void {
    this.held.add(channel);
  }

  /** Test control: delivers waiting messages until at least `bytes` left (all by default), then signals a drain. */
  flush(channel: Channel, bytes = Infinity): void {
    const before = this.bufferedAmount(channel);
    const queue = this.waiting[channel];
    let sent = 0;
    while (queue.length > 0 && sent < bytes && !this.closed) {
      const data = queue.shift()!;
      sent += sizeOf(data);
      this.peer.messages.emit(channel, data);
    }
    const drain = this.drains[channel];
    const after = this.bufferedAmount(channel);
    if (!this.closed && before > drain.threshold && after <= drain.threshold) [...drain.callbacks].forEach((cb) => cb());
  }

  /** Test control: stops holding `channel` after delivering what waits. */
  release(channel: Channel): void {
    this.held.delete(channel);
    this.flush(channel);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.waiting.control = [];
    this.waiting.assets = [];
    this.peer.close();
    this.closes.emit();
    this.messages.clear();
    this.closes.clear();
  }
}
```

(`flush` uses a non-null assertion on `queue.shift()` inside a `queue.length > 0` loop; `noUncheckedIndexedAccess` cannot see that.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/online/peerTransport.test.ts tests/unit/online/memoryTransport.test.ts`
Expected: PASS, including every existing flush test.

- [ ] **Step 7: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/online/transport --max-warnings 0`
Expected: both exit 0. `wc -l src/app/online/transport/*.ts` shows every file under 300 lines (`PeerTransport.ts` about 230, `peerLink.ts` about 160).

- [ ] **Step 8: Commit**

```bash
git add src/app/online/transport tests/unit/online/peerTransport.test.ts tests/unit/online/memoryTransport.test.ts
git commit -m "feat(online): buffered amount and drain callbacks on links"
```

---

### Task 2: Fingerprints, limits and the asset-channel protocol

**Files:**
- Modify: `src/app/online/ids.ts`
- Create: `src/app/online/assets/assetIds.ts`, `src/app/online/assets/assetProtocol.ts`
- Modify: `tests/unit/online/sceneFixtures.ts` (two helpers)
- Test: `tests/unit/online/assetProtocol.test.ts`

**Interfaces:**
- Consumes: `PROTOCOL_VERSION` (`protocol.ts`), `PlayerScene` (`scene/sceneTypes.ts`, type only).
- Produces:
  - `ids.ts`: `base64Url(bytes: Uint8Array): string` (unpadded base64url); `randomId` unchanged in behaviour.
  - `assetIds.ts`: `ASSET_LIMITS` (`fileBytes`, `chunkBytes`, `idsPerMessage`, `pendingPerPlayer`, `openTransfers`, `highWaterBytes`, `lowWaterBytes`, `messageBytes`, `cacheBytes`, values in Global Constraints), `ASSET_MIMES`, `type AssetMime`, `type Hasher = (bytes: ArrayBuffer) => Promise<string>`, `isAssetId(value: unknown): value is string`, `isAssetMime(value: unknown): value is AssetMime`, `mimeForPath(path: string): AssetMime | null`, `sha256Id(bytes: ArrayBuffer): Promise<string>`, `sceneAssetIds(scene: PlayerScene | null): string[]` (map first, then tokens in record order, each once, fingerprints only), `isArrayBuffer(value: unknown): value is ArrayBuffer`.
  - `assetProtocol.ts`: `type AssetMessage` (the five messages), `interface AssetChunk { handle: number; bytes: Uint8Array }`, `type DecodedAsset = { kind: 'message'; message: AssetMessage } | { kind: 'chunk'; chunk: AssetChunk } | { kind: 'ignored' } | { kind: 'invalid'; reason: string }`, `MAX_HANDLE = 0xffff_ffff`, `encodeAsset(message: AssetMessage): string`, `encodeChunk(handle: number, bytes: Uint8Array): ArrayBuffer`, `binaryOf(value: unknown): Uint8Array | null`, `decodeAsset(raw: unknown): DecodedAsset`.
  - `sceneFixtures.ts`: `fingerprint(n: number): string` (a valid, made-up fingerprint), `sceneWithImages(mapAsset: string | null, tokenImages: ReadonlyArray<string | null>): PlayerScene` (tokens `t0`, `t1`, …).

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/online/sceneFixtures.ts`:

```ts
/** A valid fingerprint made up from a number, for tests that need many different ones. */
export function fingerprint(n: number): string {
  return String(n).padStart(43, 'A');
}

/** A scene whose map and tokens (`t0`, `t1`, …) show these images; null for none. */
export function sceneWithImages(mapAsset: string | null, tokenImages: ReadonlyArray<string | null>): PlayerScene {
  return playerScene({
    map: { asset: mapAsset, width: 1000, height: 800, cellSize: 70 },
    tokens: Object.fromEntries(tokenImages.map((image, index) => [`t${index}`, playerToken({ image })])),
  });
}
```

Create `tests/unit/online/assetProtocol.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ASSET_LIMITS, isArrayBuffer, isAssetId, isAssetMime, mimeForPath, sceneAssetIds, sha256Id,
} from '../../../src/app/online/assets/assetIds';
import { binaryOf, decodeAsset, encodeAsset, encodeChunk, type AssetMessage } from '../../../src/app/online/assets/assetProtocol';
import { base64Url, randomId } from '../../../src/app/online/ids';
import { fingerprint, sceneWithImages } from './sceneFixtures';

const A = fingerprint(1);
const B = fingerprint(2);

describe('fingerprints', () => {
  it('are unpadded base64url SHA-256 of the bytes', async () => {
    const abc = new TextEncoder().encode('abc');
    expect(await sha256Id(abc.slice().buffer)).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
    const bytes = new Uint8Array([0, 255, 7, 42, 9]);
    expect(await sha256Id(bytes.slice().buffer)).toBe(createHash('sha256').update(bytes).digest('base64url'));
    expect(base64Url(new Uint8Array([251, 255]))).toBe('-_8');
    expect(randomId()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('recognises fingerprints and nothing else', () => {
    expect(isAssetId(A)).toBe(true);
    expect(isAssetId('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0')).toBe(true);
    expect(isAssetId(A.slice(1))).toBe(false);
    expect(isAssetId(`${A}A`)).toBe(false);
    expect(isAssetId(`${A.slice(1)}+`)).toBe(false);
    expect(isAssetId('asset-1')).toBe(false);
    expect(isAssetId(7)).toBe(false);
  });

  it('knows image types by extension, in any case', () => {
    expect(mimeForPath('maps/Cave.PNG')).toBe('image/png');
    expect(mimeForPath('a.jpg')).toBe('image/jpeg');
    expect(mimeForPath('a.JPEG')).toBe('image/jpeg');
    expect(mimeForPath('a.webp')).toBe('image/webp');
    expect(mimeForPath('a.gif')).toBe('image/gif');
    expect(mimeForPath('a.avif')).toBe('image/avif');
    expect(mimeForPath('art/icon.svg')).toBe('image/svg+xml');
    expect(mimeForPath('notes/a.md')).toBeNull();
    expect(mimeForPath('folder.png/file')).toBeNull();
    expect(mimeForPath('a.constructor')).toBeNull();
    expect(mimeForPath('png')).toBeNull();
    expect(isAssetMime('image/png')).toBe(true);
    expect(isAssetMime('text/html')).toBe(false);
  });

  it('lists the images a scene shows: the map first, each once, fingerprints only', () => {
    expect(sceneAssetIds(sceneWithImages(A, [B, A, null, 'asset-1', B]))).toEqual([A, B]);
    expect(sceneAssetIds(sceneWithImages(null, [B]))).toEqual([B]);
    expect(sceneAssetIds(null)).toEqual([]);
  });

  it('tells ArrayBuffers from anything else, whatever realm they come from', async () => {
    expect(isArrayBuffer(new ArrayBuffer(1))).toBe(true);
    expect(isArrayBuffer(await crypto.subtle.digest('SHA-256', new ArrayBuffer(1)))).toBe(true);
    expect(isArrayBuffer(new Uint8Array(1))).toBe(false);
    expect(isArrayBuffer('bytes')).toBe(false);
  });
});

describe('asset messages', () => {
  it('round-trips every message type', () => {
    const messages: AssetMessage[] = [
      { v: 1, type: 'asset-request', ids: [A, B] },
      { v: 1, type: 'asset-start', id: A, handle: 1, size: 1234, mime: 'image/webp' },
      { v: 1, type: 'asset-end', handle: 0xffff_ffff },
      { v: 1, type: 'asset-denied', id: B },
      { v: 1, type: 'asset-cancel', ids: [A] },
    ];
    for (const message of messages) expect(decodeAsset(encodeAsset(message))).toEqual({ kind: 'message', message });
  });

  it('refuses messages outside the limits', () => {
    const tooMany = Array.from({ length: ASSET_LIMITS.idsPerMessage + 1 }, (_, i) => fingerprint(i));
    const invalid = (raw: unknown): void => { expect(decodeAsset(raw).kind, JSON.stringify(raw)).toBe('invalid'); };
    invalid(JSON.stringify({ v: 1, type: 'asset-request', ids: tooMany }));
    invalid(JSON.stringify({ v: 1, type: 'asset-request', ids: [] }));
    invalid(JSON.stringify({ v: 1, type: 'asset-request', ids: ['maps/cave.png'] }));
    invalid(JSON.stringify({ v: 1, type: 'asset-start', id: A, handle: 1, size: ASSET_LIMITS.fileBytes + 1, mime: 'image/png' }));
    invalid(JSON.stringify({ v: 1, type: 'asset-start', id: A, handle: 1, size: 10, mime: 'text/html' }));
    invalid(JSON.stringify({ v: 1, type: 'asset-start', id: A, handle: 0, size: 10, mime: 'image/png' }));
    invalid(JSON.stringify({ v: 1, type: 'asset-start', id: A, handle: 1.5, size: 10, mime: 'image/png' }));
    invalid(JSON.stringify({ v: 1, type: 'asset-end', handle: 0x1_0000_0000 }));
    invalid(JSON.stringify({ v: 2, type: 'asset-denied', id: A }));
    invalid(`{"v":1,"type":"asset-denied","id":"${A}","pad":"${'x'.repeat(ASSET_LIMITS.messageBytes)}"}`);
    invalid('not json');
    invalid(42);
    expect(decodeAsset(JSON.stringify({ v: 1, type: 'asset-future', id: A }))).toEqual({ kind: 'ignored' });
  });

  it('frames chunks with a big-endian handle and at most 64 KB', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const frame = encodeChunk(0x0102_0304, bytes);
    expect([...new Uint8Array(frame)]).toEqual([1, 2, 3, 4, 1, 2, 3]);
    const decoded = decodeAsset(frame);
    expect(decoded.kind).toBe('chunk');
    if (decoded.kind !== 'chunk') return;
    expect(decoded.chunk.handle).toBe(0x0102_0304);
    expect([...decoded.chunk.bytes]).toEqual([1, 2, 3]);

    expect(decodeAsset(encodeChunk(1, new Uint8Array(ASSET_LIMITS.chunkBytes))).kind).toBe('chunk');
    expect(decodeAsset(encodeChunk(1, new Uint8Array(ASSET_LIMITS.chunkBytes + 1))).kind).toBe('invalid');
    expect(decodeAsset(encodeChunk(1, new Uint8Array(0))).kind).toBe('invalid');
    expect(decodeAsset(encodeChunk(0, bytes)).kind).toBe('invalid');
    // A view into a larger buffer is read from its own offset.
    const padded = new Uint8Array(10);
    padded.set(new Uint8Array(encodeChunk(9, bytes)), 3);
    const fromView = decodeAsset(padded.subarray(3));
    expect(fromView).toMatchObject({ kind: 'chunk', chunk: { handle: 9 } });
    if (fromView.kind === 'chunk') expect([...fromView.chunk.bytes]).toEqual([1, 2, 3]);
    expect(binaryOf('text')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/online/assetProtocol.test.ts`
Expected: FAIL — cannot resolve `src/app/online/assets/assetIds` (and `base64Url` is not exported).

- [ ] **Step 3: Share base64url in `ids.ts`**

Replace `src/app/online/ids.ts` with:

```ts
/** Bytes as base64url without padding. */
export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A random id of `bytes` bytes (16 = 128 bits), base64url without padding. */
export function randomId(bytes = 16): string {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return base64Url(data);
}
```

- [ ] **Step 4: Write the fingerprints and limits**

Create `src/app/online/assets/assetIds.ts`:

```ts
/**
 * Image fingerprints and the limits of image transfers. Shared with the web
 * player page, so this file imports only the id helpers and the scene wire types.
 */
import { base64Url } from '../ids';
import type { PlayerScene } from '../scene/sceneTypes';

const MB = 1024 * 1024;

export const ASSET_LIMITS = {
  /** Largest image the GM sends and a player assembles. */
  fileBytes: 64 * MB,
  /** File bytes in one binary chunk, after its 4-byte handle. */
  chunkBytes: 64 * 1024,
  /** Fingerprints in one `asset-request` or `asset-cancel`. */
  idsPerMessage: 64,
  /** Fingerprints the GM keeps queued or in flight for one player; more are denied. */
  pendingPerPlayer: 256,
  /** Transfers a player assembles at once. */
  openTransfers: 16,
  /** The GM sends chunks while a player's assets channel buffers less than this… */
  highWaterBytes: 1 * MB,
  /** …and resumes when it drained to this. */
  lowWaterBytes: 256 * 1024,
  /** Longest asset text message; the longest valid one is about 3.2 KB. */
  messageBytes: 16 * 1024,
  /** What a player keeps, on their device or in memory. */
  cacheBytes: 500 * MB,
} as const;

export const ASSET_MIMES = ['image/webp', 'image/png', 'image/jpeg', 'image/gif', 'image/avif', 'image/svg+xml'] as const;
export type AssetMime = typeof ASSET_MIMES[number];

/** SHA-256 of some bytes as an asset id. */
export type Hasher = (bytes: ArrayBuffer) => Promise<string>;

const MIME_BY_EXTENSION: Readonly<Record<string, AssetMime>> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

/** A fingerprint: unpadded base64url SHA-256, 43 characters. */
const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isAssetId(value: unknown): value is string {
  return typeof value === 'string' && ASSET_ID_PATTERN.test(value);
}

export function isAssetMime(value: unknown): value is AssetMime {
  return typeof value === 'string' && (ASSET_MIMES as readonly string[]).includes(value);
}

/** The image type a vault path stands for, by its extension; null for anything else. */
export function mimeForPath(path: string): AssetMime | null {
  const dot = path.lastIndexOf('.');
  if (dot < 0 || dot < path.lastIndexOf('/')) return null;
  const extension = path.slice(dot + 1).toLowerCase();
  return Object.hasOwn(MIME_BY_EXTENSION, extension) ? MIME_BY_EXTENSION[extension] ?? null : null;
}

/** The fingerprint of `bytes`, with Web Crypto (Obsidian and every browser have it). */
export async function sha256Id(bytes: ArrayBuffer): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

/** The fingerprints a scene shows: the map's first, then the tokens' in record order, each once. */
export function sceneAssetIds(scene: PlayerScene | null): string[] {
  if (!scene) return [];
  const ids = new Set<string>();
  if (isAssetId(scene.map.asset)) ids.add(scene.map.asset);
  for (const token of Object.values(scene.tokens)) if (isAssetId(token.image)) ids.add(token.image);
  return [...ids];
}

/**
 * Whether `value` is an ArrayBuffer. Never `instanceof`: buffers from another
 * realm (Web Crypto, a worker, the test environment) fail that check.
 */
export function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}
```

- [ ] **Step 5: Write the protocol**

Create `src/app/online/assets/assetProtocol.ts`:

```ts
/**
 * The assets channel's wire format (protocol v1): JSON text messages and binary
 * chunks, each a 4-byte big-endian transfer handle and up to 64 KB of a file.
 * Shared with the web player page, so this file imports nothing from Obsidian.
 */
import { PROTOCOL_VERSION } from '../protocol';
import { ASSET_LIMITS, isArrayBuffer, isAssetId, isAssetMime, type AssetMime } from './assetIds';

export type AssetMessage =
  | { v: 1; type: 'asset-request'; ids: string[] }
  | { v: 1; type: 'asset-start'; id: string; handle: number; size: number; mime: AssetMime }
  | { v: 1; type: 'asset-end'; handle: number }
  | { v: 1; type: 'asset-denied'; id: string }
  | { v: 1; type: 'asset-cancel'; ids: string[] };

/** A binary chunk: its transfer, and its bytes (a view into the received frame). */
export interface AssetChunk {
  handle: number;
  bytes: Uint8Array;
}

export type DecodedAsset =
  | { kind: 'message'; message: AssetMessage }
  | { kind: 'chunk'; chunk: AssetChunk }
  | { kind: 'ignored' }
  | { kind: 'invalid'; reason: string };

export const MAX_HANDLE = 0xffff_ffff;
const HANDLE_BYTES = 4;

type Fields = Record<string, unknown>;

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isHandle(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_HANDLE;
}
function isSize(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= ASSET_LIMITS.fileBytes;
}
function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= ASSET_LIMITS.idsPerMessage && value.every(isAssetId);
}

const VALIDATORS: Record<AssetMessage['type'], (m: Fields) => boolean> = {
  'asset-request': (m) => isIdList(m.ids),
  'asset-start': (m) => isAssetId(m.id) && isHandle(m.handle) && isSize(m.size) && isAssetMime(m.mime),
  'asset-end': (m) => isHandle(m.handle),
  'asset-denied': (m) => isAssetId(m.id),
  'asset-cancel': (m) => isIdList(m.ids),
};

export function encodeAsset(message: AssetMessage): string {
  return JSON.stringify(message);
}

export function encodeChunk(handle: number, bytes: Uint8Array): ArrayBuffer {
  const frame = new Uint8Array(HANDLE_BYTES + bytes.byteLength);
  new DataView(frame.buffer).setUint32(0, handle, false);
  frame.set(bytes, HANDLE_BYTES);
  return frame.buffer;
}

/** The bytes of a binary frame (an ArrayBuffer or a view of one); null for anything else. */
export function binaryOf(value: unknown): Uint8Array | null {
  if (isArrayBuffer(value)) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

export function decodeAsset(raw: unknown): DecodedAsset {
  if (typeof raw === 'string') return decodeText(raw);
  const bytes = binaryOf(raw);
  if (!bytes) return { kind: 'invalid', reason: 'not-text-or-binary' };
  if (bytes.byteLength <= HANDLE_BYTES || bytes.byteLength > HANDLE_BYTES + ASSET_LIMITS.chunkBytes) {
    return { kind: 'invalid', reason: 'bad-chunk-size' };
  }
  const handle = new DataView(bytes.buffer, bytes.byteOffset, HANDLE_BYTES).getUint32(0, false);
  if (!isHandle(handle)) return { kind: 'invalid', reason: 'bad-chunk-handle' };
  return { kind: 'chunk', chunk: { handle, bytes: bytes.subarray(HANDLE_BYTES) } };
}

function decodeText(raw: string): DecodedAsset {
  if (raw.length > ASSET_LIMITS.messageBytes) return { kind: 'invalid', reason: 'too-large' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', reason: 'not-json' };
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string') return { kind: 'invalid', reason: 'no-type' };
  if (parsed.v !== PROTOCOL_VERSION) return { kind: 'invalid', reason: 'version' };
  const type = parsed.type as AssetMessage['type'];
  if (!Object.hasOwn(VALIDATORS, type)) return { kind: 'ignored' };
  return VALIDATORS[type](parsed)
    ? { kind: 'message', message: parsed as unknown as AssetMessage }
    : { kind: 'invalid', reason: `bad-${type}` };
}
```

(A valid message is ASCII, so its `length` is its size in bytes; a longer string is refused before parsing.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/unit/online/assetProtocol.test.ts tests/unit/online/protocol.test.ts`
Expected: PASS.

- [ ] **Step 7: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/online/ids.ts src/app/online/assets --max-warnings 0`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/app/online/ids.ts src/app/online/assets tests/unit/online/assetProtocol.test.ts tests/unit/online/sceneFixtures.ts
git commit -m "feat(online): image fingerprints and the asset channel protocol"
```

---

### Task 3: The content registry, and the broadcaster projecting its fingerprints

**Files:**
- Rewrite: `src/app/online/scene/AssetRegistry.ts`
- Create: `src/app/online/assets/vaultImageFiles.ts`
- Modify: `src/app/online/scene/projectForPlayers.ts:13,35` (the `assets` type)
- Modify: `src/app/online/scene/sceneSources.ts` (`SceneBroadcasterOptions.assets`)
- Modify: `src/app/online/scene/SceneBroadcaster.ts:83,115,139-148,325` (use the option, re-project on `onChange`)
- Modify: `src/app/online/OnlineSessionService.ts` (create the registry per session)
- Create: `tests/unit/online/assetFixtures.ts`
- Modify: `tests/unit/online/sceneFixtures.ts`, `tests/unit/online/projectForPlayers.test.ts:7,39,104`, `tests/unit/online/projectParts.test.ts:7,48-61` (the random-id registry test goes), `tests/unit/online/sceneBroadcaster.test.ts` (`setup`), `tests/unit/online/sceneSyncEndToEnd.test.ts` (`world`), `tests/unit/online/onlineSessionService.test.ts:12`
- Test: `tests/unit/online/assetRegistry.test.ts`, `tests/unit/online/sceneBroadcaster.test.ts`

**Interfaces:**
- Consumes: Task 2 (`ASSET_LIMITS`, `mimeForPath`, `sha256Id`, `type AssetMime`, `type Hasher`); Obsidian `App.vault.getAbstractFileByPath`, `vault.readBinary(file: TFile): Promise<ArrayBuffer>`, `TFile.stat: { mtime: number; size: number }`, `normalizePath`.
- Produces:
  - `AssetRegistry.ts`: `IMAGE_TOO_LARGE_NOTICE = 'This image is too large to send to online players.'`, `interface ImageFileStat { size: number; mtime: number }`, `interface ImageFiles { stat(path: string): ImageFileStat | null; read(path: string): Promise<ArrayBuffer> }`, `interface AssetInfo { path: string; size: number; mime: AssetMime }`, `interface AssetFile { bytes: ArrayBuffer; mime: AssetMime }`, `interface AssetIds { idFor(path: string | null | undefined): string | null }`, `interface AssetRegistryOptions { files: ImageFiles; notify(message: string): void; hash?: Hasher }`, `class AssetRegistry implements AssetIds { idFor(path): string | null; info(id: string): AssetInfo | null; read(id: string): Promise<AssetFile | null>; onChange(listener: () => void): () => void; dispose(): void }`.
  - `vaultImageFiles(app: App): ImageFiles`.
  - `SceneBroadcasterOptions.assets: AssetRegistry` (required). `ProjectionContext.assets: AssetIds`.
  - `OnlineSessionService` `Deps.images?: ImageFiles` (the vault's images unless a test passes its own).
  - Test fixtures (`assetFixtures.ts`): `nodeHash(bytes: ArrayBuffer): Promise<string>`, `fingerprintOf(bytes: Uint8Array | string): string`, `interface MemoryImageFiles { source: ImageFiles; set(path, content, mtime?): void; remove(path): void; reads: string[]; fail(path): void }`, `memoryImageFiles(initial?: Record<string, Uint8Array | string>): MemoryImageFiles`, `imageBytes(size: number, seed?: number): Uint8Array`, `settle(): Promise<void>`; (`sceneFixtures.ts`) `fakeAssetIds(): AssetIds`.

Rules (spec, "Asset ids: content fingerprints"; plan decisions 1–4): fingerprints are cached by path, modification time and size; one file is read and hashed at a time; files over 64 MB (by `stat`, or by the bytes read) get no id and the GM one notice per session; unreadable files and other types get none, and an unreadable file is not read again until its time or size changes; `read(id)` re-reads and verifies; `onChange` fires when an id becomes known or is forgotten.

- [ ] **Step 1: Write the test fixtures**

Create `tests/unit/online/assetFixtures.ts`:

```ts
import { createHash } from 'node:crypto';
import type { ImageFiles } from '../../../src/app/online/scene/AssetRegistry';

/** SHA-256 as an asset id, resolved at once: Web Crypto finishes outside fake timers' control. */
export function nodeHash(bytes: ArrayBuffer): Promise<string> {
  return Promise.resolve(createHash('sha256').update(new Uint8Array(bytes)).digest('base64url'));
}

/** The fingerprint the GM gives these bytes, computed independently. */
export function fingerprintOf(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('base64url');
}

export interface MemoryImageFiles {
  source: ImageFiles;
  set(path: string, content: Uint8Array | string, mtime?: number): void;
  remove(path: string): void;
  /** Paths read, in order. */
  reads: string[];
  /** Makes reads of `path` fail from now on. */
  fail(path: string): void;
}

/** Vault images in memory; strings are stored as their UTF-8 bytes. */
export function memoryImageFiles(initial: Record<string, Uint8Array | string> = {}): MemoryImageFiles {
  const files = new Map<string, { bytes: Uint8Array; mtime: number }>();
  const failing = new Set<string>();
  const reads: string[] = [];
  const set = (path: string, content: Uint8Array | string, mtime = 1): void => {
    files.set(path, { bytes: typeof content === 'string' ? new TextEncoder().encode(content) : content, mtime });
  };
  for (const [path, content] of Object.entries(initial)) set(path, content);
  return {
    source: {
      stat: (path) => {
        const file = files.get(path);
        return file ? { size: file.bytes.byteLength, mtime: file.mtime } : null;
      },
      read: async (path) => {
        reads.push(path);
        const file = files.get(path);
        if (!file || failing.has(path)) throw new Error(`Cannot read ${path}`);
        return file.bytes.slice().buffer;
      },
    },
    set,
    remove: (path) => { files.delete(path); },
    reads,
    fail: (path) => { failing.add(path); },
  };
}

/** `size` bytes of noise; a different `seed` gives a different file. */
export function imageBytes(size: number, seed = 1): Uint8Array {
  const bytes = new Uint8Array(size);
  let value = seed;
  for (let index = 0; index < size; index++) {
    value = (Math.imul(value, 1103515245) + 12345) >>> 0;
    bytes[index] = value >>> 24;
  }
  return bytes;
}

/** Waits until every pending promise chain settled (real timers only). */
export function settle(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}
```

Add to `tests/unit/online/sceneFixtures.ts` (with `import type { AssetIds } from '../../../src/app/online/scene/AssetRegistry';` at the top):

```ts
/** Asset ids as the projection sees them, without hashing: one stable id per path, `asset-1` first. */
export function fakeAssetIds(): AssetIds {
  const ids = new Map<string, string>();
  return {
    idFor: (path) => {
      if (typeof path !== 'string' || path.length === 0) return null;
      if (!ids.has(path)) ids.set(path, `asset-${ids.size + 1}`);
      return ids.get(path) ?? null;
    },
  };
}
```

In `tests/unit/online/projectForPlayers.test.ts`, replace the `AssetRegistry` import (line 7) with `import { fakeAssetIds } from './sceneFixtures';`, `assets: new AssetRegistry()` in `context()` (line 39) with `assets: fakeAssetIds()`, and `const assets = new AssetRegistry();` (line 104) with `const assets = fakeAssetIds();`.

In `tests/unit/online/projectParts.test.ts`, delete the `AssetRegistry` import (line 7) and the whole `describe('AssetRegistry', …)` block (lines 48–61, "gives each vault path one random id for the session"): ids are no longer random per session, and `assetRegistry.test.ts` (Step 2) tests the content registry instead. After Step 6, check nothing else in `tests/` builds a registry or a broadcaster the old way: `grep -rn "new AssetRegistry()" tests/` prints nothing, and every line `grep -rn "new SceneBroadcaster(" tests/` prints passes `assets`.

- [ ] **Step 2: Write the failing registry test**

Create `tests/unit/online/assetRegistry.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { ASSET_LIMITS } from '../../../src/app/online/assets/assetIds';
import { vaultImageFiles } from '../../../src/app/online/assets/vaultImageFiles';
import { AssetRegistry, IMAGE_TOO_LARGE_NOTICE, type ImageFiles } from '../../../src/app/online/scene/AssetRegistry';
import { fingerprintOf, memoryImageFiles, nodeHash, settle } from './assetFixtures';

function registry(files: ImageFiles, withNodeHash = true): { assets: AssetRegistry; notices: string[]; changes: () => number } {
  const notices: string[] = [];
  let changes = 0;
  const assets = new AssetRegistry({ files, notify: (message) => notices.push(message), ...(withNodeHash ? { hash: nodeHash } : {}) });
  assets.onChange(() => { changes++; });
  return { assets, notices, changes: () => changes };
}

const bytesOf = (text: string): ArrayBuffer => new TextEncoder().encode(text).slice().buffer;

describe('AssetRegistry', () => {
  it('gives an image its SHA-256 once hashed, with Web Crypto by default', async () => {
    const files = memoryImageFiles({ 'maps/cave.png': 'cave bytes' });
    const { assets, changes } = registry(files.source, false);
    expect(assets.idFor('maps/cave.png')).toBeNull();
    await vi.waitFor(() => expect(assets.idFor('maps/cave.png')).toBe(fingerprintOf('cave bytes')));
    expect(changes()).toBe(1);
    expect(assets.info(fingerprintOf('cave bytes'))).toEqual({ path: 'maps/cave.png', size: 10, mime: 'image/png' });
  });

  it('hashes an unchanged file once and a changed one again', async () => {
    const files = memoryImageFiles({ 'a.png': 'first' });
    const { assets } = registry(files.source);
    assets.idFor('a.png');
    assets.idFor('a.png');
    await settle();
    expect(assets.idFor('a.png')).toBe(fingerprintOf('first'));
    expect(files.reads).toEqual(['a.png']);

    files.set('a.png', 'second', 2);
    expect(assets.idFor('a.png')).toBeNull();
    await settle();
    expect(assets.idFor('a.png')).toBe(fingerprintOf('second'));
    expect(files.reads).toEqual(['a.png', 'a.png']);
  });

  it('gives two files with the same bytes one fingerprint', async () => {
    const files = memoryImageFiles({ 'a.png': 'same', 'copy/b.webp': 'same' });
    const { assets } = registry(files.source);
    assets.idFor('a.png');
    assets.idFor('copy/b.webp');
    await settle();
    expect(assets.idFor('a.png')).toBe(fingerprintOf('same'));
    expect(assets.idFor('copy/b.webp')).toBe(fingerprintOf('same'));
  });

  it('gives no id to other types, missing files and unreadable ones, and does not retry an unchanged unreadable file', async () => {
    const files = memoryImageFiles({ 'notes/a.md': 'text', 'bad.png': 'x' });
    files.fail('bad.png');
    const { assets, changes } = registry(files.source);
    expect(assets.idFor('notes/a.md')).toBeNull();
    expect(assets.idFor('missing.png')).toBeNull();
    expect(assets.idFor('bad.png')).toBeNull();
    expect(assets.idFor(null)).toBeNull();
    expect(assets.idFor('')).toBeNull();
    await settle();
    expect(assets.idFor('bad.png')).toBeNull();
    await settle();
    expect(files.reads).toEqual(['bad.png']);
    expect(changes()).toBe(0);
  });

  it('refuses images over 64 MB with one notice per session', async () => {
    const read = vi.fn(async (): Promise<ArrayBuffer> => new ArrayBuffer(0));
    const big: ImageFiles = { stat: () => ({ size: ASSET_LIMITS.fileBytes + 1, mtime: 1 }), read };
    const { assets, notices } = registry(big);
    expect(assets.idFor('huge.png')).toBeNull();
    expect(assets.idFor('other-huge.jpg')).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(notices).toEqual([IMAGE_TOO_LARGE_NOTICE]);

    // A file that grew past the limit after its size was read is caught when it is read.
    const grown: ImageFiles = { stat: () => ({ size: 10, mtime: 1 }), read: async () => new ArrayBuffer(ASSET_LIMITS.fileBytes + 1) };
    const second = registry(grown);
    second.assets.idFor('grown.png');
    await settle();
    expect(second.assets.idFor('grown.png')).toBeNull();
    expect(second.notices).toEqual([IMAGE_TOO_LARGE_NOTICE]);
  });

  it('reads a file again for serving, and forgets its fingerprint when it changed or became unreadable', async () => {
    const files = memoryImageFiles({ 'a.png': 'abc', 'b.png': 'bbb' });
    const { assets, changes } = registry(files.source);
    assets.idFor('a.png');
    assets.idFor('b.png');
    await settle();
    const a = fingerprintOf('abc');
    const b = fingerprintOf('bbb');
    const served = await assets.read(a);
    expect(new TextDecoder().decode(served?.bytes)).toBe('abc');
    expect(served?.mime).toBe('image/png');

    // A sync tool rewrote the file keeping its time and size: only the bytes tell.
    files.set('a.png', 'abd', 1);
    expect(await assets.read(a)).toBeNull();
    expect(assets.info(a)).toBeNull();
    expect(changes()).toBe(3);
    expect(assets.idFor('a.png')).toBeNull();
    await settle();
    expect(assets.idFor('a.png')).toBe(fingerprintOf('abd'));

    files.fail('b.png');
    expect(await assets.read(b)).toBeNull();
    expect(assets.info(b)).toBeNull();
    expect(await assets.read(fingerprintOf('never seen'))).toBeNull();
  });

  it('hashes one file at a time and drops a result that finished after the file changed', async () => {
    const reads: string[] = [];
    const pending: Array<(bytes: ArrayBuffer) => void> = [];
    const stats = new Map([['a.png', { size: 1, mtime: 1 }], ['b.png', { size: 1, mtime: 1 }]]);
    const files: ImageFiles = {
      stat: (path) => stats.get(path) ?? null,
      read: (path) => new Promise((resolve) => { reads.push(path); pending.push(resolve); }),
    };
    const { assets } = registry(files);
    assets.idFor('a.png');
    assets.idFor('b.png');
    await settle();
    expect(reads).toEqual(['a.png']); // b waits for a

    stats.set('a.png', { size: 1, mtime: 2 }); // a changes while it is read
    assets.idFor('a.png');
    pending[0]!(bytesOf('old'));
    await settle();
    expect(assets.idFor('a.png')).toBeNull();
    expect(reads).toEqual(['a.png', 'b.png']);
    pending[1]!(bytesOf('b'));
    await settle();
    expect(reads).toEqual(['a.png', 'b.png', 'a.png']);
    pending[2]!(bytesOf('new'));
    await settle();
    expect(assets.idFor('a.png')).toBe(fingerprintOf('new'));
    expect(assets.idFor('b.png')).toBe(fingerprintOf('b'));
  });

  it('stops hashing and notifying once disposed', async () => {
    const files = memoryImageFiles({ 'a.png': 'a' });
    const { assets, changes } = registry(files.source);
    assets.idFor('a.png');
    assets.dispose();
    await settle();
    expect(changes()).toBe(0);
    expect(assets.idFor('a.png')).toBeNull();
  });
});

describe('vaultImageFiles', () => {
  it('reads vault images through Obsidian', async () => {
    const file = new TFile('maps/cave.png');
    file.stat = { ctime: 0, mtime: 5, size: 3 };
    const app = {
      vault: {
        getAbstractFileByPath: (path: string) => (path === 'maps/cave.png' ? file : null),
        readBinary: async (target: TFile) => (target === file ? new Uint8Array([1, 2, 3]).buffer : new ArrayBuffer(0)),
      },
    } as unknown as App;
    const files = vaultImageFiles(app);
    expect(files.stat('maps/cave.png')).toEqual({ size: 3, mtime: 5 });
    expect(files.stat('maps/other.png')).toBeNull();
    expect([...new Uint8Array(await files.read('maps/cave.png'))]).toEqual([1, 2, 3]);
    await expect(files.read('maps/other.png')).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/online/assetRegistry.test.ts`
Expected: FAIL — `IMAGE_TOO_LARGE_NOTICE` is not exported, `vaultImageFiles` cannot be resolved, `new AssetRegistry({...}).idFor` returns random ids.

- [ ] **Step 4: Write the registry**

Replace `src/app/online/scene/AssetRegistry.ts` with:

```ts
/**
 * Vault images as content fingerprints, per online session: the SHA-256 of
 * each file's bytes, so players can keep images across sessions and learn no
 * file or folder name. `idFor` never waits: an image whose fingerprint is not
 * known yet gets none and is queued for hashing, one file at a time, and
 * `onChange` tells the broadcaster to project again. Paths never leave the
 * GM's machine. Imports nothing from Obsidian: the vault is an `ImageFiles`.
 */
import { ASSET_LIMITS, mimeForPath, sha256Id, type AssetMime, type Hasher } from '../assets/assetIds';

export const IMAGE_TOO_LARGE_NOTICE = 'This image is too large to send to online players.';

export interface ImageFileStat {
  size: number;
  mtime: number;
}

/** How the registry reaches the vault: `vaultImageFiles` in the plugin, a map in tests. */
export interface ImageFiles {
  /** Synchronous; null when there is no such file. */
  stat(path: string): ImageFileStat | null;
  read(path: string): Promise<ArrayBuffer>;
}

/** Where a fingerprint's file is. */
export interface AssetInfo {
  path: string;
  size: number;
  mime: AssetMime;
}

/** A file to serve: its bytes and type. */
export interface AssetFile {
  bytes: ArrayBuffer;
  mime: AssetMime;
}

/** What the projection needs: a fingerprint for a path, or null. */
export interface AssetIds {
  idFor(path: string | null | undefined): string | null;
}

export interface AssetRegistryOptions {
  files: ImageFiles;
  /** Tells the GM something; `OnlineSessionService` shows an Obsidian notice. */
  notify(message: string): void;
  /** SHA-256 as an asset id; tests driven by fake timers pass one that resolves at once. */
  hash?: Hasher;
}

interface PathEntry {
  mtime: number;
  size: number;
  mime: AssetMime;
  /** Null while hashing, and for files that get no id (too large, unreadable). */
  id: string | null;
}

export class AssetRegistry implements AssetIds {
  private readonly paths = new Map<string, PathEntry>();
  private readonly infos = new Map<string, AssetInfo>();
  /** Paths waiting to be hashed, in order; a set, so a path waits once. */
  private readonly queue = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly hash: Hasher;
  private hashing = false;
  private disposed = false;
  private tooLargeNoticeShown = false;

  constructor(private readonly options: AssetRegistryOptions) {
    this.hash = options.hash ?? sha256Id;
  }

  idFor(path: string | null | undefined): string | null {
    if (this.disposed || typeof path !== 'string' || path.length === 0) return null;
    const mime = mimeForPath(path);
    const stat = mime ? this.options.files.stat(path) : null;
    if (!mime || !stat) return null;
    const known = this.paths.get(path);
    if (known && known.mtime === stat.mtime && known.size === stat.size) return known.id;
    this.paths.set(path, { mtime: stat.mtime, size: stat.size, mime, id: null });
    if (stat.size > ASSET_LIMITS.fileBytes) this.tooLarge();
    else this.enqueue(path);
    return null;
  }

  /** Where a fingerprint's file is; null for one this session does not know. */
  info(id: string): AssetInfo | null {
    return this.infos.get(id) ?? null;
  }

  /**
   * The file behind `id`, read again and checked against it. Null when it cannot
   * be read or no longer matches; the fingerprint is then forgotten, so the next
   * projection hashes the file again.
   */
  async read(id: string): Promise<AssetFile | null> {
    const info = this.infos.get(id);
    if (!info) return null;
    try {
      const bytes = await this.options.files.read(info.path);
      if (bytes.byteLength <= ASSET_LIMITS.fileBytes && await this.hash(bytes) === id) return { bytes, mime: info.mime };
    } catch {
      // Unreadable: forgotten below, like a changed file.
    }
    this.forget(id);
    return null;
  }

  /** Called when a fingerprint becomes known or is forgotten. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose(): void {
    this.disposed = true;
    this.queue.clear();
    this.listeners.clear();
  }

  private forget(id: string): void {
    let forgot = this.infos.delete(id);
    for (const [path, entry] of this.paths) {
      if (entry.id !== id) continue;
      this.paths.delete(path);
      forgot = true;
    }
    if (forgot) this.emit();
  }

  private enqueue(path: string): void {
    this.queue.add(path);
    if (!this.hashing) void this.hashQueued();
  }

  private async hashQueued(): Promise<void> {
    this.hashing = true;
    try {
      for (let path = this.next(); path !== null && !this.disposed; path = this.next()) await this.hashFile(path);
    } finally {
      this.hashing = false;
    }
  }

  private next(): string | null {
    const first = this.queue.values().next();
    if (first.done) return null;
    this.queue.delete(first.value);
    return first.value;
  }

  private async hashFile(path: string): Promise<void> {
    const entry = this.paths.get(path);
    if (!entry) return;
    let id: string | null = null;
    let size = 0;
    try {
      const bytes = await this.options.files.read(path);
      size = bytes.byteLength;
      if (size > ASSET_LIMITS.fileBytes) this.tooLarge();
      else id = await this.hash(bytes);
    } catch {
      id = null;
    }
    // The file changed while it was read: its newer entry is queued already.
    if (this.disposed || this.paths.get(path) !== entry || id === null) return;
    entry.id = id;
    this.infos.set(id, { path, size, mime: entry.mime });
    this.emit();
  }

  private tooLarge(): void {
    if (this.tooLargeNoticeShown) return;
    this.tooLargeNoticeShown = true;
    this.options.notify(IMAGE_TOO_LARGE_NOTICE);
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
```

Create `src/app/online/assets/vaultImageFiles.ts`:

```ts
/** The vault's images for the asset registry: sizes and times from Obsidian's file index, bytes with `readBinary`. */
import { normalizePath, TFile, type App } from 'obsidian';
import type { ImageFiles, ImageFileStat } from '../scene/AssetRegistry';

export function vaultImageFiles(app: App): ImageFiles {
  const fileAt = (path: string): TFile | null => {
    const file = app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? file : null;
  };
  return {
    stat: (path: string): ImageFileStat | null => {
      const file = fileAt(path);
      return file ? { size: file.stat.size, mtime: file.stat.mtime } : null;
    },
    read: async (path: string): Promise<ArrayBuffer> => {
      const file = fileAt(path);
      if (!file) throw new Error('The image is no longer in the vault');
      return app.vault.readBinary(file);
    },
  };
}
```

- [ ] **Step 5: Run the registry test to verify it passes**

Run: `npx vitest run tests/unit/online/assetRegistry.test.ts tests/unit/online/projectForPlayers.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing broadcaster test**

In `tests/unit/online/sceneBroadcaster.test.ts`:

1. Add imports:

```ts
import { AssetRegistry } from '../../../src/app/online/scene/AssetRegistry';
import { fingerprintOf, memoryImageFiles, nodeHash, type MemoryImageFiles } from './assetFixtures';
```

2. Add `files: MemoryImageFiles;` to the `Harness` interface.

3. In `setup`, change the signature to `function setup(options: { start?: boolean; images?: Record<string, string | Uint8Array> } = {}): Harness {`, and replace the line `const broadcaster = new SceneBroadcaster({ session: gm, presented, settings, notify: (message) => notices.push(message) });` with:

```ts
  const files = memoryImageFiles(options.images ?? {});
  const assets = new AssetRegistry({ files: files.source, notify: (message) => notices.push(message), hash: nodeHash });
  const broadcaster = new SceneBroadcaster({ session: gm, presented, settings, assets, notify: (message) => notices.push(message) });
```

   and `return { network, gm, requests, presented, broadcaster, notices, setRules };` with `return { network, gm, requests, presented, broadcaster, notices, setRules, files };`.

4. Append inside `describe('SceneBroadcaster', …)`:

```ts
  it('adds an image to the scene once its fingerprint is known', async () => {
    const h = setup({ images: { 'maps/tavern.png': 'map bytes', 'art/hero.png': 'hero bytes' } });
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    // Presenting never waits for hashing: the first snapshot has no images.
    expect(h.broadcaster.currentProjection()?.map.asset).toBeNull();
    expect(h.broadcaster.currentProjection()?.tokens.hero?.image).toBeNull();
    const player = await join(h);
    await tick();
    expect(player.scene?.map.asset).toBe(fingerprintOf('map bytes'));
    expect(player.scene?.tokens.hero?.image).toBe(fingerprintOf('hero bytes'));
    expect(player.scene).toEqual(h.broadcaster.currentProjection());
    expect(JSON.stringify(player.scene)).not.toContain('art/');
  });
```

In `tests/unit/online/sceneSyncEndToEnd.test.ts`, add the imports

```ts
import { AssetRegistry } from '../../../src/app/online/scene/AssetRegistry';
import { memoryImageFiles, nodeHash } from './assetFixtures';
```

and in `world()` replace `const broadcaster = new SceneBroadcaster({ session: gm, presented, settings, notify: (message) => notices.push(message) });` with:

```ts
  const assets = new AssetRegistry({ files: memoryImageFiles().source, notify: (message) => notices.push(message), hash: nodeHash });
  const broadcaster = new SceneBroadcaster({ session: gm, presented, settings, assets, notify: (message) => notices.push(message) });
```

In `tests/unit/online/onlineSessionService.test.ts`, give the fake vault a file index (line 12), since the service now reads the vault's images:

```ts
const app = { vault: { getName: () => 'My Vault', getAbstractFileByPath: () => null } } as never;
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run tests/unit/online/sceneBroadcaster.test.ts`
Expected: FAIL — the new test's `map.asset` stays null (the broadcaster still builds its own registry and ignores the `assets` option).

- [ ] **Step 8: Use the registry in the broadcaster and the service**

In `src/app/online/scene/sceneSources.ts`, add `import type { AssetRegistry } from './AssetRegistry';` and the option to `SceneBroadcasterOptions`:

```ts
export interface SceneBroadcasterOptions {
  session: SceneSession;
  presented: PresentedSceneSource;
  settings: PlayerViewSettingsSource;
  /** The session's content registry: fingerprints for the projection, and when to project again. */
  assets: AssetRegistry;
  /** Tells the GM something; `OnlineSessionService` shows an Obsidian notice. */
  notify(message: string): void;
}
```

In `src/app/online/scene/projectForPlayers.ts`, replace `import type { AssetRegistry } from './AssetRegistry';` with `import type { AssetIds } from './AssetRegistry';` and `assets: AssetRegistry;` in `ProjectionContext` with `assets: AssetIds;`.

In `src/app/online/scene/SceneBroadcaster.ts`:

1. Delete `import { AssetRegistry } from './AssetRegistry';` and the field `private readonly assets = new AssetRegistry();`.
2. Replace `start()` with:

```ts
  start(): void {
    const { session, presented, settings, assets } = this.options;
    this.stops.push(
      session.use(this),
      presented.subscribe({
        presented: (scene, resumed) => this.showScene(scene, resumed),
        held: (scene) => this.holdScene(scene),
        cleared: () => this.clearScene(),
      }),
      settings.onChange(() => this.settingsChanged()),
      // A fingerprint became known or was forgotten: the next tick carries the change.
      assets.onChange(() => { if (this.live && !this.live.loading) this.scheduleTick(); }),
    );
    const current = presented.current();
    if (current && !presented.isHeld()) this.showScene(current, false);
  }
```

3. In `project()`, replace `assets: this.assets,` with `assets: this.options.assets,`.

In `src/app/online/OnlineSessionService.ts`:

1. Add imports:

```ts
import { vaultImageFiles } from './assets/vaultImageFiles';
import { AssetRegistry, type ImageFiles } from './scene/AssetRegistry';
```

2. Add to `Deps`:

```ts
  /** The vault's images; tests pass their own. */
  images?: ImageFiles;
```

3. Add the fields `private registry: AssetRegistry | null = null;` and `private readonly images: ImageFiles;`, and in the constructor, after `this.presented = …`, `this.images = deps.images ?? vaultImageFiles(app);`.

4. In `host()`, replace the broadcaster construction (`const broadcaster = new SceneBroadcaster({ … });`) with:

```ts
    const notify = (message: string): Notice => new Notice(message);
    // One registry per session: fingerprints are cached for the session, the size notice shows once.
    const registry = new AssetRegistry({ files: this.images, notify });
    this.registry = registry;
    const broadcaster = new SceneBroadcaster({
      session, presented: this.presented, settings: this.settings, assets: registry, notify,
    });
```

5. In `teardown()`, after `this.broadcaster = null;`, add:

```ts
    this.registry?.dispose();
    this.registry = null;
```

- [ ] **Step 9: Run the online tests to verify they pass**

Run: `npx vitest run tests/unit/online`
Expected: PASS (every existing test too: without image files the registry gives no ids, as the piece 2 tests expect nothing of them).

- [ ] **Step 10: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/online --max-warnings 0`
Expected: both exit 0. `wc -l src/app/online/scene/SceneBroadcaster.ts` prints at most 300.

- [ ] **Step 11: Commit**

```bash
git add src/app/online tests/unit/online
git commit -m "feat(online): content fingerprints for map and token images"
```

---

### Task 4: The assets channel through the sessions

**Files:**
- Create: `src/app/online/gmSessionTypes.ts`, `src/app/online/transport/channelPort.ts`
- Modify: `src/app/online/transport/types.ts` (`ChannelPort`)
- Modify: `src/app/online/GmSession.ts:1-37,119-122,141-153` (types move out; routing; `assetChannel`)
- Modify: `src/app/online/PlayerSession.ts` (`PlayerAssetHandler`)
- Test: `tests/unit/online/gmSession.test.ts`, `tests/unit/online/playerSessionAssets.test.ts`

**Interfaces:**
- Consumes: Task 1 (`PeerLink.bufferedAmount`, `PeerLink.onDrain`, `MemoryNetwork`).
- Produces:
  - `transport/types.ts`: `interface ChannelPort { send(data: string | ArrayBuffer): void; bufferedAmount(): number; onDrain(threshold: number, cb: () => void): Unsubscribe; onClose(cb: () => void): Unsubscribe }`.
  - `transport/channelPort.ts`: `channelPort(link: PeerLink, channel: Channel): ChannelPort`.
  - `gmSessionTypes.ts`: `SESSION_LIMITS`, `PlayerStatus`, `SessionPlayer`, `SessionHandler` (gains `onAssetData?(player: SessionPlayer, data: unknown): void` — anything an admitted player sends on the assets channel, undecoded), `GmSessionOptions`. All re-exported from `GmSession.ts`, so existing imports keep working.
  - `GmSession.assetChannel(playerId: string): ChannelPort | null` — the admitted player's assets channel on their current link; null for anyone else.
  - `PlayerSession.ts`: `interface PlayerAssetHandler { connected(send: (data: string) => void): void; receive(data: unknown): void; disconnected(): void }` and `PlayerSessionOptions.assets?: PlayerAssetHandler`. `connected` is called when `admitted` arrives on a link, with a `send` bound to that link's assets channel; `receive` gets that link's assets-channel data while it is current; `disconnected` when that link closes, the session finishes or stops.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('GmSession', …)` in `tests/unit/online/gmSession.test.ts`:

```ts
  it('passes admitted players\' asset data to handlers and gives out their assets channel', async () => {
    const { network, session, requests } = setup();
    const received: Array<[string, unknown]> = [];
    session.use({ onAssetData: (who, data) => received.push([who.name, data]) });
    const anna = await player(network);
    const atAnna: unknown[] = [];
    anna.link.onMessage((channel, data) => { if (channel === 'assets') atAnna.push(data); });

    anna.link.send('control', join('Anna', 'key-a'));
    anna.link.send('assets', 'too early');
    expect(received).toEqual([]);
    const playerId = requests[0]!.playerId;
    expect(session.assetChannel(playerId)).toBeNull();

    session.allow(playerId);
    anna.link.send('assets', 'hello');
    expect(received).toEqual([['Anna', 'hello']]);
    const port = session.assetChannel(playerId)!;
    port.send('image');
    expect(atAnna).toEqual(['image']);
    expect(port.bufferedAmount()).toBe(0);
    let closed = 0;
    port.onClose(() => closed++);

    session.kick(playerId);
    expect(closed).toBe(1);
    expect(session.assetChannel(playerId)).toBeNull();
  });
```

Create `tests/unit/online/playerSessionAssets.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerSession, RECONNECT_DELAYS_MS } from '../../../src/app/online/PlayerSession';
import { encodeControl } from '../../../src/app/online/protocol';
import { MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';
import type { PeerLink } from '../../../src/app/online/transport/types';

const admitted = encodeControl({ v: 1, type: 'admitted', playerId: 'p1', session: { title: 'Table' } });

describe('PlayerSession assets channel', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('passes the assets channel to its handler only while admitted, and reports every drop', async () => {
    const network = new MemoryNetwork();
    const host = network.host('gm');
    const gmEnds: PeerLink[] = [];
    host.onConnection((link) => gmEnds.push(link));
    const events: string[] = [];
    const sends: Array<(data: string) => void> = [];
    const player = new PlayerSession({
      hostId: 'gm', name: 'A', playerKey: 'k', clientVersion: '1', transport: network.client(), onChange: () => {},
      assets: {
        connected: (send) => { sends.push(send); events.push('connected'); },
        receive: (data) => events.push(`data:${String(data)}`),
        disconnected: () => events.push('disconnected'),
      },
    });
    player.start();
    await vi.advanceTimersByTimeAsync(0);
    const gm = gmEnds[0]!;
    const atGm: Array<[string, unknown]> = [];
    gm.onMessage((channel, data) => atGm.push([channel, data]));

    gm.send('assets', 'before admission');
    expect(events).toEqual([]);
    gm.send('control', admitted);
    expect(events).toEqual(['connected']);
    gm.send('assets', 'chunk');
    sends[0]!('request');
    expect(events).toEqual(['connected', 'data:chunk']);
    expect(atGm).toContainEqual(['assets', 'request']);

    gm.close();
    expect(events).toEqual(['connected', 'data:chunk', 'disconnected']);
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    const again = gmEnds[1]!;
    again.send('control', admitted);
    expect(events.at(-1)).toBe('connected');
    // The old link's `send` goes nowhere; the new one reaches the GM.
    const atGmAgain: unknown[] = [];
    again.onMessage((channel, data) => { if (channel === 'assets') atGmAgain.push(data); });
    sends[0]!('stale');
    sends[1]!('fresh');
    expect(atGmAgain).toEqual(['fresh']);

    player.stop();
    expect(events.at(-1)).toBe('disconnected');
    expect(events.filter((event) => event === 'disconnected')).toHaveLength(2);
  });

  it('works without an assets handler', async () => {
    const network = new MemoryNetwork();
    const host = network.host('gm');
    const gmEnds: PeerLink[] = [];
    host.onConnection((link) => gmEnds.push(link));
    const player = new PlayerSession({ hostId: 'gm', name: 'A', playerKey: 'k', clientVersion: '1', transport: network.client(), onChange: () => {} });
    player.start();
    await vi.advanceTimersByTimeAsync(0);
    gmEnds[0]!.send('control', admitted);
    expect(() => gmEnds[0]!.send('assets', 'chunk')).not.toThrow();
    player.stop();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/online/gmSession.test.ts tests/unit/online/playerSessionAssets.test.ts`
Expected: FAIL — `session.assetChannel is not a function`; the player's handler never hears `connected`.

- [ ] **Step 3: Add `ChannelPort`**

Append to `src/app/online/transport/types.ts`:

```ts
/** One channel of a link, for code that must reach nothing else of it (the image server). */
export interface ChannelPort {
  send(data: string | ArrayBuffer): void;
  bufferedAmount(): number;
  onDrain(threshold: number, cb: () => void): Unsubscribe;
  /** The link closed: this port is dead. */
  onClose(cb: () => void): Unsubscribe;
}
```

Create `src/app/online/transport/channelPort.ts`:

```ts
import type { Channel, ChannelPort, PeerLink } from './types';

/** One channel of `link` as a `ChannelPort`. */
export function channelPort(link: PeerLink, channel: Channel): ChannelPort {
  return {
    send: (data: string | ArrayBuffer): void => link.send(channel, data),
    bufferedAmount: (): number => link.bufferedAmount(channel),
    onDrain: (threshold: number, cb: () => void): (() => void) => link.onDrain(channel, threshold, cb),
    onClose: (cb: () => void): (() => void) => link.onClose(cb),
  };
}
```

- [ ] **Step 4: Move the session's types out and route the assets channel**

Create `src/app/online/gmSessionTypes.ts` (moved from `GmSession.ts` lines 6–37; `onAssetData` is new):

```ts
/** The GM session's limits, and what its handlers and its owner see. */
import type { ControlMessage } from './protocol';

export const SESSION_LIMITS = {
  joinTimeoutMs: 10_000,
  requestTimeoutMs: 120_000,
  pingIntervalMs: 5_000,
  pingTimeoutMs: 15_000,
  maxPlayers: 12,
  maxPendingRequests: 12,
  maxInvalidMessages: 3,
} as const;

export type PlayerStatus = 'pending' | 'admitted' | 'gone';

export interface SessionPlayer {
  playerId: string;
  name: string;
  status: PlayerStatus;
}

export interface SessionHandler {
  onAdmitted?(player: SessionPlayer): void;
  onMessage?(player: SessionPlayer, message: ControlMessage): void;
  /** Anything an admitted player sends on the assets channel, undecoded. */
  onAssetData?(player: SessionPlayer, data: unknown): void;
  onGone?(player: SessionPlayer): void;
}

export interface GmSessionOptions {
  title: string;
  /** A new player is waiting; answer with `allow` or `deny`. */
  onJoinRequest(player: SessionPlayer): void;
  /** A request is no longer open: answered, expired, withdrawn or the session stopped. */
  onRequestClosed(playerId: string): void;
  onPlayersChanged(players: SessionPlayer[]): void;
}
```

In `src/app/online/GmSession.ts`:

1. Replace lines 1–37 (the imports down to the end of `GmSessionOptions`) with:

```ts
// src/app/online/GmSession.ts
import { SESSION_LIMITS, type GmSessionOptions, type PlayerStatus, type SessionHandler, type SessionPlayer } from './gmSessionTypes';
import { randomId } from './ids';
import { decodeControl, encodeControl, normalizePlayerName, type ControlMessage, type DenyReason, type PresencePlayer } from './protocol';
import { channelPort } from './transport/channelPort';
import type { ChannelPort, HostTransport, PeerLink, Unsubscribe } from './transport/types';

export { SESSION_LIMITS } from './gmSessionTypes';
export type { GmSessionOptions, PlayerStatus, SessionHandler, SessionPlayer } from './gmSessionTypes';
```

2. After the `send(playerId, message)` method, add:

```ts
  /** An admitted player's assets channel on their current link, for the image server; null for anyone else. */
  assetChannel(playerId: string): ChannelPort | null {
    const entry = this.entries.get(playerId);
    return entry?.player.status === 'admitted' && entry.link ? channelPort(entry.link, 'assets') : null;
  }
```

3. In `accept`, replace the line `link.onMessage((channel, data) => { if (channel === 'control') this.receive(link, state, data); }),` with:

```ts
      link.onMessage((channel, data) => { if (channel === 'control') this.receive(link, state, data); else this.receiveAsset(link, state, data); }),
```

4. After the `receive` method, add:

```ts
  /** Assets-channel data counts only from an admitted player's current link; handlers decode it. */
  private receiveAsset(link: PeerLink, state: LinkState, data: unknown): void {
    const entry = state.entry;
    if (!entry || entry.link !== link || entry.player.status !== 'admitted') return;
    for (const handler of this.handlers) handler.onAssetData?.({ ...entry.player }, data);
  }
```

- [ ] **Step 5: Pass the assets channel through `PlayerSession`**

In `src/app/online/PlayerSession.ts`:

1. After the `RECONNECT_GIVE_UP_MS` line, add:

```ts
/** The image loader's view of the session: the session only passes assets-channel data through. */
export interface PlayerAssetHandler {
  /** Admitted on a link: `send` reaches the GM's assets channel on that link until `disconnected`. */
  connected(send: (data: string) => void): void;
  receive(data: unknown): void;
  disconnected(): void;
}
```

2. Add to `PlayerSessionOptions`, after `onScene`:

```ts
  /** Gets the assets channel while admitted (the join page's image loader). */
  assets?: PlayerAssetHandler;
```

3. Add the field `private assetLink: PeerLink | null = null;` after `private retryTimer: number | null = null;`.

4. In `connect()`, replace the two subscription lines

```ts
    link.onMessage((channel, data) => { if (channel === 'control') this.receive(link, data); });
    link.onClose(() => { if (this.link === link) { this.link = null; this.dropped(); } });
```

with:

```ts
    link.onMessage((channel, data) => {
      if (channel === 'control') this.receive(link, data);
      else if (this.assetLink === link && !this.finished) this.options.assets?.receive(data);
    });
    link.onClose(() => {
      if (this.assetLink === link) this.leaveAssets();
      if (this.link === link) { this.link = null; this.dropped(); }
    });
```

5. In `receive`, replace the `case 'admitted':` block with:

```ts
      case 'admitted':
        this.wasAdmitted = true;
        this.attempt = 0;
        this.update({ status: 'admitted', playerId: message.playerId, title: message.session.title, reason: null });
        this.assetLink = link;
        this.options.assets?.connected((data) => link.send('assets', data));
        break;
```

6. In `stop()` and in `finish()`, add `this.leaveAssets();` right after `this.mirror.dispose();`.

7. Add, before `update`:

```ts
  private leaveAssets(): void {
    if (!this.assetLink) return;
    this.assetLink = null;
    this.options.assets?.disconnected();
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/online`
Expected: PASS, including the existing `gmSession`, `playerSession` and `playerSessionScene` tests.

- [ ] **Step 7: Type-check, lint and check sizes**

Run: `npx tsc --noEmit && npx eslint src/app/online --max-warnings 0 && wc -l src/app/online/GmSession.ts src/app/online/PlayerSession.ts`
Expected: both checks exit 0; `GmSession.ts` at most 317 lines (about 302), `PlayerSession.ts` about 190.

- [ ] **Step 8: Commit**

```bash
git add src/app/online tests/unit/online/gmSession.test.ts tests/unit/online/playerSessionAssets.test.ts
git commit -m "feat(online): pass the assets channel through GM and player sessions"
```

---

### Task 5: Projection listeners on the broadcaster

**Files:**
- Modify: `src/app/online/scene/sceneSources.ts` (receives the broadcaster's constants and `LiveScene`)
- Modify: `src/app/online/scene/SceneBroadcaster.ts` (`onProjection`; every change of `lastSent` goes through `setSent`)
- Test: `tests/unit/online/sceneBroadcaster.test.ts`

**Interfaces:**
- Consumes: Task 3 (`SceneBroadcasterOptions.assets`).
- Produces: `SceneBroadcaster.onProjection(listener: (scene: PlayerScene | null) => void): () => void` — called with the new projection each time what players have changes (snapshot, patch, clear, hold of a new presentation, truncated fog), before the messages go out; `null` when players have no scene. `SCENE_TICK_MS`, `SCENE_TOO_LARGE_NOTICE`, `FOG_TRUNCATED_NOTICE` stay importable from `SceneBroadcaster.ts` (re-exported from `sceneSources.ts`).

The asset server (Task 6) follows the projection through this listener: it serves only the fingerprints players currently have and stops transfers of images that left. Moving the constants and `LiveScene` out keeps `SceneBroadcaster.ts` at or under 300 lines.

- [ ] **Step 1: Write the failing test**

Append inside `describe('SceneBroadcaster', …)` in `tests/unit/online/sceneBroadcaster.test.ts`:

```ts
  it('tells projection listeners each change of what players have', async () => {
    const h = setup();
    const seen: Array<string[] | null> = [];
    const stop = h.broadcaster.onProjection((scene) => seen.push(scene ? Object.keys(scene.tokens) : null));
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    expect(seen).toEqual([['hero']]);

    store.setState((state) => ({ objects: { ...state.objects, tokens: { ...state.objects.tokens, orc: character('orc', 300) } } }));
    await tick();
    expect(seen).toEqual([['hero'], ['hero', 'orc']]);
    await tick(); // nothing changed: no call
    expect(seen).toHaveLength(2);

    h.presented.clear();
    expect(seen).toEqual([['hero'], ['hero', 'orc'], null]);
    stop();
    h.presented.present(view, tavern);
    expect(seen).toHaveLength(3);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/online/sceneBroadcaster.test.ts -t "projection listeners"`
Expected: FAIL — `h.broadcaster.onProjection is not a function`.

- [ ] **Step 3: Move the constants and `LiveScene` into `sceneSources.ts`**

Append to `src/app/online/scene/sceneSources.ts` (it already imports `PresentedSceneInfo` and defines `Slice`):

```ts
/** Changes are batched and sent at most this often. */
export const SCENE_TICK_MS = 50;

export const SCENE_TOO_LARGE_NOTICE = 'This scene is too large to send to online players.';
export const FOG_TRUNCATED_NOTICE = 'This scene has too much fog to show to online players.';

/** The presented scene while it is shown (not held). */
export interface LiveScene {
  readonly scene: PresentedSceneInfo;
  readonly sceneId: string;
  loading: boolean;
  slice: Slice | null;
  readonly unsubscribe: () => void;
}
```

In `src/app/online/scene/SceneBroadcaster.ts`:

1. Replace the `sceneSources` import with:

```ts
import {
  FOG_TRUNCATED_NOTICE, FogCoverageCache, SCENE_TICK_MS, SCENE_TOO_LARGE_NOTICE, sameSlice, sliceOf,
  type LiveScene, type SceneBroadcasterOptions,
} from './sceneSources';
```

2. Replace everything from `/** Changes are batched and sent at most this often. */` down to the end of the `LiveScene` interface (the three constants and the interface) with:

```ts
export { FOG_TRUNCATED_NOTICE, SCENE_TICK_MS, SCENE_TOO_LARGE_NOTICE } from './sceneSources';
```

- [ ] **Step 4: Route every change of what players have through `setSent`**

In `src/app/online/scene/SceneBroadcaster.ts`:

1. Add the field `private readonly projectionListeners = new Set<(scene: PlayerScene | null) => void>();` after `private readonly stops: Array<() => void> = [];`.

2. After `currentProjection()`, add:

```ts
  /** Tells `listener` each time the scene players have changes; the asset server serves only its images. */
  onProjection(listener: (scene: PlayerScene | null) => void): () => void {
    this.projectionListeners.add(listener);
    return () => { this.projectionListeners.delete(listener); };
  }
```

3. Replace `holdScene` and `clearScene` with:

```ts
  /** A presentation that starts held is a new one: players must not see the old scene as its start. */
  private holdScene(scene: PresentedSceneInfo): void {
    this.detach();
    if (this.shown === scene) return;
    const hadScene = this.shown !== null;
    this.forgetScene();
    if (hadScene) this.clearPlayers();
  }
```

```ts
  private clearScene(): void {
    this.detach();
    this.forgetScene();
    this.clearPlayers();
  }

  private forgetScene(): void {
    this.shown = null;
    this.sceneId = null;
    this.snapshot = null;
    this.setSent(null);
  }

  /** Every change of what players have goes through here, so projection listeners see each one. */
  private setSent(scene: PlayerScene | null): void {
    this.lastSent = scene;
    for (const listener of [...this.projectionListeners]) listener(scene);
  }
```

4. In `tick()`, replace `this.lastSent = next;` with `this.setSent(next);`. In `broadcastSnapshot()`, replace `this.lastSent = this.project(live);` with `this.setSent(this.project(live));`. In `clearForTruncatedFog()`, replace `this.lastSent = null;` with `this.setSent(null);`. No other line assigns `this.lastSent` (check with `grep -n "this.lastSent =" src/app/online/scene/SceneBroadcaster.ts`: no output).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/online`
Expected: PASS.

- [ ] **Step 6: Type-check, lint and check the size**

Run: `npx tsc --noEmit && npx eslint src/app/online/scene --max-warnings 0 && wc -l src/app/online/scene/SceneBroadcaster.ts`
Expected: both checks exit 0; at most 300 lines.

- [ ] **Step 7: Commit**

```bash
git add src/app/online/scene tests/unit/online/sceneBroadcaster.test.ts
git commit -m "feat(online): projection listeners on the scene broadcaster"
```

---

### Task 6: `AssetServer`: serving the projection's images

**Files:**
- Create: `src/app/online/assets/SharedReads.ts`, `src/app/online/assets/AssetServer.ts`
- Test: `tests/unit/online/assetServer.test.ts`

**Interfaces:**
- Consumes: Task 2 (`ASSET_LIMITS`, `sceneAssetIds`, `decodeAsset`, `encodeAsset`, `encodeChunk`, `MAX_HANDLE`), Task 3 (`AssetFile`, `AssetRegistry.read`), Task 4 (`SessionHandler.onAssetData`, `GmSession.assetChannel`, `ChannelPort`), Task 5 (`SceneBroadcaster.currentProjection()`, `onProjection`).
- Produces:
  - `SharedReads.ts`: `class SharedReads { constructor(read: (id: string) => Promise<AssetFile | null>); hold(id: string): void; release(id: string): void; file(id: string): Promise<AssetFile | null>; clear(): void }`.
  - `AssetServer.ts`: `interface AssetServerOptions { session: { use(handler: SessionHandler): () => void; assetChannel(playerId: string): ChannelPort | null }; projection: { currentProjection(): PlayerScene | null; onProjection(listener: (scene: PlayerScene | null) => void): () => void }; files: { read(id: string): Promise<AssetFile | null> } }`, `class AssetServer implements SessionHandler { start(): void; stop(): void; onGone(player): void; onAssetData(player, data): void }`. `GmSession`, `SceneBroadcaster` and `AssetRegistry` fit those option types as they are.

Rules (spec, "GM side: AssetServer"; plan decisions 7 and 8): requests only from players with an assets channel (admitted); only fingerprints of the current projection are queued, others are `asset-denied`; at most 256 queued or in flight per player, more `asset-denied`; duplicates of a queued or in-flight fingerprint are ignored; one transfer per player at a time, the map first, then request order; `asset-start` when the file has been read, then chunks of 64 KB while `bufferedAmount()` is under 1 MB, resuming on the drain callback at 256 KB, then `asset-end`; an unreadable or changed file is `asset-denied`; a fingerprint that leaves the projection is dropped from every queue, and a transfer in flight of it stops with `asset-denied`; `asset-cancel` drops fingerprints for that player without a reply; a closed channel or `onGone` drops the player's queue. File bytes are read once while any queue holds them.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/online/assetServer.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { SessionHandler, SessionPlayer } from '../../../src/app/online/GmSession';
import { ASSET_LIMITS } from '../../../src/app/online/assets/assetIds';
import { decodeAsset, encodeAsset, encodeChunk, type AssetChunk, type AssetMessage } from '../../../src/app/online/assets/assetProtocol';
import { AssetServer } from '../../../src/app/online/assets/AssetServer';
import type { AssetFile } from '../../../src/app/online/scene/AssetRegistry';
import type { PlayerScene } from '../../../src/app/online/scene/sceneTypes';
import type { ChannelPort } from '../../../src/app/online/transport/types';
import { imageBytes, settle } from './assetFixtures';
import { fingerprint as fp, sceneWithImages } from './sceneFixtures';

const MB = 1024 * 1024;

/** A player's assets channel; when `paced`, chunk bytes stay buffered until `drain`. */
class FakePort implements ChannelPort {
  readonly sent: Array<string | ArrayBuffer> = [];
  paced = false;
  buffered = 0;
  threshold = -1;
  private readonly drains = new Set<() => void>();
  private readonly closes = new Set<() => void>();

  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
    if (this.paced && typeof data !== 'string') this.buffered += data.byteLength;
  }
  bufferedAmount(): number { return this.buffered; }
  onDrain(threshold: number, cb: () => void): () => void {
    this.threshold = threshold;
    this.drains.add(cb);
    return () => { this.drains.delete(cb); };
  }
  onClose(cb: () => void): () => void {
    this.closes.add(cb);
    return () => { this.closes.delete(cb); };
  }
  drain(): void {
    this.buffered = 0;
    [...this.drains].forEach((cb) => cb());
  }
  close(): void { [...this.closes].forEach((cb) => cb()); }

  messages(): AssetMessage[] {
    return this.sent.flatMap((data) => { const decoded = decodeAsset(data); return decoded.kind === 'message' ? [decoded.message] : []; });
  }
  chunks(handle?: number): AssetChunk[] {
    return this.sent.flatMap((data) => {
      const decoded = decodeAsset(data);
      return decoded.kind === 'chunk' && (handle === undefined || decoded.chunk.handle === handle) ? [decoded.chunk] : [];
    });
  }
  /** Message types, with the fingerprint for starts and denials. */
  types(): string[] {
    return this.messages().map((message) => (message.type === 'asset-start' || message.type === 'asset-denied' ? `${message.type}:${message.id}` : message.type));
  }
  /** The bytes this player got for `id`, joined from its chunks. */
  bytesOf(id: string): Uint8Array {
    const start = this.messages().find((message) => message.type === 'asset-start' && message.id === id);
    if (!start || start.type !== 'asset-start') return new Uint8Array(0);
    const parts = this.chunks(start.handle);
    const joined = new Uint8Array(parts.reduce((total, chunk) => total + chunk.bytes.byteLength, 0));
    let offset = 0;
    for (const chunk of parts) { joined.set(chunk.bytes, offset); offset += chunk.bytes.byteLength; }
    return joined;
  }
}

const who = (playerId: string): SessionPlayer => ({ playerId, name: playerId, status: 'admitted' });

function setup(scene: PlayerScene | null, files: Record<string, Uint8Array> = {}) {
  const ports = new Map<string, FakePort>();
  const handlers: SessionHandler[] = [];
  const session = {
    use: (handler: SessionHandler): (() => void) => { handlers.push(handler); return () => { handlers.splice(handlers.indexOf(handler), 1); }; },
    assetChannel: (playerId: string): ChannelPort | null => ports.get(playerId) ?? null,
  };
  let current = scene;
  const listeners = new Set<(next: PlayerScene | null) => void>();
  const projection = {
    currentProjection: (): PlayerScene | null => current,
    onProjection: (listener: (next: PlayerScene | null) => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const read = vi.fn(async (id: string): Promise<AssetFile | null> => {
    const bytes = files[id];
    return bytes ? { bytes: bytes.slice().buffer, mime: 'image/png' } : null;
  });
  const server = new AssetServer({ session, projection, files: { read } });
  server.start();
  const send = (playerId: string, data: unknown): void => handlers.forEach((handler) => handler.onAssetData?.(who(playerId), data));
  return {
    server, read, handlers,
    player: (playerId: string): FakePort => { const port = new FakePort(); ports.set(playerId, port); return port; },
    request: (playerId: string, ids: string[]): void => send(playerId, encodeAsset({ v: 1, type: 'asset-request', ids })),
    cancel: (playerId: string, ids: string[]): void => send(playerId, encodeAsset({ v: 1, type: 'asset-cancel', ids })),
    send,
    show: (next: PlayerScene | null): void => { current = next; listeners.forEach((listener) => listener(next)); },
  };
}

describe('AssetServer', () => {
  it('serves only images of the scene players have', async () => {
    const h = setup(null, { [fp(1)]: imageBytes(100), [fp(2)]: imageBytes(200, 2) });
    const anna = h.player('anna');
    h.request('anna', [fp(1)]);
    expect(anna.types()).toEqual([`asset-denied:${fp(1)}`]); // nothing is presented yet

    h.show(sceneWithImages(fp(1), [fp(2)]));
    h.request('anna', [fp(2), fp(3)]);
    await settle();
    expect(anna.types()).toEqual([`asset-denied:${fp(1)}`, `asset-denied:${fp(3)}`, `asset-start:${fp(2)}`, 'asset-end']);
    expect(anna.messages()).toContainEqual({ v: 1, type: 'asset-start', id: fp(2), handle: 1, size: 200, mime: 'image/png' });
    expect(anna.bytesOf(fp(2))).toEqual(imageBytes(200, 2));
    expect(h.read).toHaveBeenCalledTimes(1);
  });

  it('sends one image at a time per player, the map first, in chunks of 64 KB', async () => {
    const files = { [fp(1)]: imageBytes(150_000, 1), [fp(2)]: imageBytes(10, 2), [fp(3)]: imageBytes(10, 3) };
    const h = setup(sceneWithImages(fp(1), [fp(2), fp(3)]), files);
    const anna = h.player('anna');
    h.request('anna', [fp(2), fp(1), fp(3)]);
    expect(h.read.mock.calls).toEqual([[fp(1)]]); // only the first image is read yet
    await settle();
    expect(anna.types()).toEqual([
      `asset-start:${fp(1)}`, 'asset-end', `asset-start:${fp(2)}`, 'asset-end', `asset-start:${fp(3)}`, 'asset-end',
    ]);
    expect(anna.chunks(1).map((chunk) => chunk.bytes.byteLength)).toEqual([65_536, 65_536, 18_928]);
    expect(anna.bytesOf(fp(1))).toEqual(files[fp(1)]);
    expect(anna.bytesOf(fp(3))).toEqual(files[fp(3)]);
  });

  it('pauses on a full buffer and resumes when it drains', async () => {
    const big = imageBytes(3 * MB);
    const h = setup(sceneWithImages(fp(1), [fp(2)]), { [fp(1)]: big, [fp(2)]: imageBytes(10, 2) });
    const anna = h.player('anna');
    anna.paced = true;
    h.request('anna', [fp(1), fp(2)]);
    await settle();
    expect(anna.threshold).toBe(ASSET_LIMITS.lowWaterBytes);
    expect(anna.chunks()).toHaveLength(16); // 1 MB
    expect(anna.types()).toEqual([`asset-start:${fp(1)}`]);

    anna.drain();
    expect(anna.chunks()).toHaveLength(32);
    anna.drain();
    expect(anna.chunks()).toHaveLength(48);
    expect(anna.types()).toEqual([`asset-start:${fp(1)}`, 'asset-end']);
    await settle();
    // The next image waits for the buffer too.
    expect(anna.types()).toEqual([`asset-start:${fp(1)}`, 'asset-end', `asset-start:${fp(2)}`]);
    anna.drain();
    expect(anna.types().at(-1)).toBe('asset-end');
    expect(anna.bytesOf(fp(1))).toEqual(big);
  });

  it('reads a file once for every player who needs it, and lets it go after', async () => {
    const h = setup(sceneWithImages(fp(1), []), { [fp(1)]: imageBytes(1000) });
    const anna = h.player('anna');
    const ben = h.player('ben');
    h.request('anna', [fp(1)]);
    h.request('ben', [fp(1)]);
    await settle();
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(anna.bytesOf(fp(1))).toEqual(imageBytes(1000));
    expect(ben.bytesOf(fp(1))).toEqual(imageBytes(1000));

    h.request('anna', [fp(1)]); // asked again later: nobody held it, so it is read again
    await settle();
    expect(h.read).toHaveBeenCalledTimes(2);
  });

  it('queues at most 256 images per player and ignores duplicates', () => {
    const ids = Array.from({ length: 300 }, (_, index) => fp(index + 1));
    const h = setup(sceneWithImages(null, ids), Object.fromEntries(ids.map((id, index) => [id, imageBytes(10, index + 1)])));
    const anna = h.player('anna');
    anna.paced = true;
    anna.buffered = ASSET_LIMITS.highWaterBytes; // nothing leaves: everything stays queued
    for (let start = 0; start < ids.length; start += ASSET_LIMITS.idsPerMessage) h.request('anna', ids.slice(start, start + ASSET_LIMITS.idsPerMessage));
    h.request('anna', [ids[0]!, ids[1]!]);
    const denied = anna.messages().flatMap((message) => (message.type === 'asset-denied' ? [message.id] : []));
    expect(denied).toEqual(ids.slice(256));
  });

  it('stops an image that leaves the scene, and drops queued ones silently', async () => {
    const h = setup(sceneWithImages(fp(1), [fp(2), fp(3)]), {
      [fp(1)]: imageBytes(3 * MB), [fp(2)]: imageBytes(10, 2), [fp(3)]: imageBytes(10, 3),
    });
    const anna = h.player('anna');
    anna.paced = true;
    h.request('anna', [fp(1), fp(2), fp(3)]);
    await settle();
    expect(anna.chunks(1)).toHaveLength(16);

    h.show(sceneWithImages(null, [fp(3)])); // the map and the first token are gone
    expect(anna.types()).toEqual([`asset-start:${fp(1)}`, `asset-denied:${fp(1)}`]);
    anna.drain();
    await settle();
    expect(anna.chunks(1)).toHaveLength(16); // nothing more of the map
    expect(anna.types()).toEqual([`asset-start:${fp(1)}`, `asset-denied:${fp(1)}`, `asset-start:${fp(3)}`, 'asset-end']);

    h.show(null); // presenting stopped
    h.request('anna', [fp(3)]);
    expect(anna.types().at(-1)).toBe(`asset-denied:${fp(3)}`);
  });

  it('cancels one player\'s images on request, without a reply and without touching others', async () => {
    const big = imageBytes(3 * MB);
    const h = setup(sceneWithImages(fp(1), [fp(2)]), { [fp(1)]: big, [fp(2)]: imageBytes(10, 2) });
    const anna = h.player('anna');
    const ben = h.player('ben');
    anna.paced = true;
    h.request('anna', [fp(1), fp(2)]);
    h.request('ben', [fp(1)]);
    await settle();
    h.cancel('anna', [fp(1)]);
    expect(anna.types()).toEqual([`asset-start:${fp(1)}`]);
    anna.drain();
    await settle();
    expect(anna.chunks(1)).toHaveLength(16);
    expect(anna.types()).toEqual([`asset-start:${fp(1)}`, `asset-start:${fp(2)}`, 'asset-end']);
    expect(ben.bytesOf(fp(1))).toEqual(big);
  });

  it('denies an image whose file became unreadable or changed, and goes on', async () => {
    const h = setup(sceneWithImages(fp(1), [fp(2)]), { [fp(1)]: imageBytes(10) });
    const anna = h.player('anna');
    h.request('anna', [fp(2), fp(1)]);
    await settle();
    expect(anna.types()).toEqual([`asset-start:${fp(1)}`, 'asset-end', `asset-denied:${fp(2)}`]);
  });

  it('drops a player\'s queue when their channel closes, and serves only players with a channel', async () => {
    const h = setup(sceneWithImages(fp(1), []), { [fp(1)]: imageBytes(3 * MB) });
    const anna = h.player('anna');
    anna.paced = true;
    h.request('anna', [fp(1)]);
    await settle();
    anna.close();
    anna.drain();
    expect(anna.chunks()).toHaveLength(16);

    h.request('stranger', [fp(1)]); // not admitted: no assets channel
    await settle();
    expect(h.read).toHaveBeenCalledTimes(1);

    const annaAgain = h.player('anna'); // a new tab or a reconnect starts from an empty queue
    h.request('anna', [fp(1)]);
    await settle();
    expect(annaAgain.types()).toEqual([`asset-start:${fp(1)}`, 'asset-end']);

    const benPort = h.player('ben');
    benPort.paced = true;
    h.request('ben', [fp(1)]);
    await settle();
    h.server.onGone(who('ben'));
    benPort.drain();
    expect(benPort.chunks()).toHaveLength(16);
  });

  it('ignores anything but requests and cancels', async () => {
    const h = setup(sceneWithImages(fp(1), []), { [fp(1)]: imageBytes(10) });
    const anna = h.player('anna');
    h.send('anna', encodeChunk(1, new Uint8Array(4)));
    h.send('anna', 'junk');
    h.send('anna', encodeAsset({ v: 1, type: 'asset-start', id: fp(1), handle: 1, size: 10, mime: 'image/png' }));
    h.send('anna', encodeAsset({ v: 1, type: 'asset-denied', id: fp(1) }));
    await settle();
    expect(anna.sent).toEqual([]);
    expect(h.read).not.toHaveBeenCalled();
  });

  it('stops serving when stopped', async () => {
    const h = setup(sceneWithImages(fp(1), []), { [fp(1)]: imageBytes(3 * MB) });
    const anna = h.player('anna');
    anna.paced = true;
    h.request('anna', [fp(1)]);
    await settle();
    h.server.stop();
    expect(h.handlers).toEqual([]);
    anna.drain();
    expect(anna.chunks()).toHaveLength(16);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/online/assetServer.test.ts`
Expected: FAIL — cannot resolve `src/app/online/assets/AssetServer`.

- [ ] **Step 3: Write the shared reads**

Create `src/app/online/assets/SharedReads.ts`:

```ts
/**
 * File bytes shared by every player queue that holds a fingerprint: read once,
 * when the first queue gets to it, and let go when no queue holds it any more.
 */
import type { AssetFile } from '../scene/AssetRegistry';

interface Shared {
  holders: number;
  file: Promise<AssetFile | null> | null;
}

export class SharedReads {
  private readonly entries = new Map<string, Shared>();

  constructor(private readonly read: (id: string) => Promise<AssetFile | null>) {}

  hold(id: string): void {
    const entry = this.entries.get(id);
    if (entry) entry.holders++;
    else this.entries.set(id, { holders: 1, file: null });
  }

  release(id: string): void {
    const entry = this.entries.get(id);
    if (entry && --entry.holders <= 0) this.entries.delete(id);
  }

  /** The file behind a held fingerprint, read on first use; null when it is not held or cannot be served. */
  file(id: string): Promise<AssetFile | null> {
    const entry = this.entries.get(id);
    if (!entry) return Promise.resolve(null);
    entry.file ??= this.read(id);
    return entry.file;
  }

  clear(): void {
    this.entries.clear();
  }
}
```

- [ ] **Step 4: Write the server**

Create `src/app/online/assets/AssetServer.ts`:

```ts
/**
 * Serves the images of the scene players have over each player's assets
 * channel. A `GmSession` handler, like `SceneBroadcaster`: requests come only
 * from admitted players, only fingerprints of the current projection are
 * served, one image at a time per player (map first), in chunks paced on the
 * channel's buffer so scene updates on the control channel are never starved.
 */
import type { SessionHandler, SessionPlayer } from '../gmSessionTypes';
import type { AssetFile } from '../scene/AssetRegistry';
import type { PlayerScene } from '../scene/sceneTypes';
import type { ChannelPort } from '../transport/types';
import { ASSET_LIMITS, sceneAssetIds } from './assetIds';
import { decodeAsset, encodeAsset, encodeChunk, MAX_HANDLE } from './assetProtocol';
import { SharedReads } from './SharedReads';

export interface AssetServerOptions {
  session: {
    use(handler: SessionHandler): () => void;
    assetChannel(playerId: string): ChannelPort | null;
  };
  /** The scene players have (the broadcaster). */
  projection: {
    currentProjection(): PlayerScene | null;
    onProjection(listener: (scene: PlayerScene | null) => void): () => void;
  };
  /** Verified file reads (the registry): null when a file cannot be served. */
  files: { read(id: string): Promise<AssetFile | null> };
}

interface Transfer {
  id: string;
  handle: number;
  /** Null while the file is read. */
  file: AssetFile | null;
  offset: number;
}

interface PlayerQueue {
  port: ChannelPort;
  pending: string[];
  current: Transfer | null;
  nextHandle: number;
  /** Set while sending, so a request that arrives meanwhile only queues… */
  pumping: boolean;
  /** …and sets this, so the sending goes round once more. */
  again: boolean;
  stops: Array<() => void>;
}

export class AssetServer implements SessionHandler {
  private readonly queues = new Map<string, PlayerQueue>();
  private readonly reads: SharedReads;
  private readonly stops: Array<() => void> = [];
  private allowed = new Set<string>();
  private mapId: string | null = null;

  constructor(private readonly options: AssetServerOptions) {
    this.reads = new SharedReads((id) => options.files.read(id));
  }

  start(): void {
    const { session, projection } = this.options;
    this.projectionChanged(projection.currentProjection());
    this.stops.push(session.use(this), projection.onProjection((scene) => this.projectionChanged(scene)));
  }

  stop(): void {
    this.stops.splice(0).forEach((stop) => stop());
    for (const playerId of [...this.queues.keys()]) this.drop(playerId);
    this.reads.clear();
  }

  onGone(player: SessionPlayer): void {
    this.drop(player.playerId);
  }

  onAssetData(player: SessionPlayer, data: unknown): void {
    const decoded = decodeAsset(data);
    if (decoded.kind !== 'message') return;
    const { message } = decoded;
    if (message.type === 'asset-request') this.request(player.playerId, message.ids);
    else if (message.type === 'asset-cancel') this.cancel(player.playerId, message.ids);
  }

  private request(playerId: string, ids: readonly string[]): void {
    const queue = this.queueOf(playerId);
    if (!queue) return;
    for (const id of ids) {
      if (queue.current?.id === id || queue.pending.includes(id)) continue;
      const full = queue.pending.length + (queue.current ? 1 : 0) >= ASSET_LIMITS.pendingPerPlayer;
      if (full || !this.allowed.has(id)) {
        queue.port.send(encodeAsset({ v: 1, type: 'asset-denied', id }));
        continue;
      }
      this.reads.hold(id);
      if (id === this.mapId) queue.pending.unshift(id);
      else queue.pending.push(id);
    }
    this.pump(playerId, queue);
  }

  private cancel(playerId: string, ids: readonly string[]): void {
    const queue = this.queues.get(playerId);
    if (!queue) return;
    this.remove(queue, new Set(ids), false);
    this.pump(playerId, queue);
  }

  private projectionChanged(scene: PlayerScene | null): void {
    this.allowed = new Set(sceneAssetIds(scene));
    this.mapId = scene?.map.asset ?? null;
    for (const [playerId, queue] of [...this.queues]) {
      const held = queue.current ? [queue.current.id, ...queue.pending] : queue.pending;
      const gone = new Set(held.filter((id) => !this.allowed.has(id)));
      if (gone.size === 0) continue;
      this.remove(queue, gone, true);
      this.pump(playerId, queue);
    }
  }

  /** Takes `ids` out of a queue; a transfer in flight stops, with `asset-denied` when it left the scene. */
  private remove(queue: PlayerQueue, ids: ReadonlySet<string>, deny: boolean): void {
    queue.pending = queue.pending.filter((id) => {
      if (!ids.has(id)) return true;
      this.reads.release(id);
      return false;
    });
    const current = queue.current;
    if (!current || !ids.has(current.id)) return;
    this.finish(queue, current);
    if (deny) queue.port.send(encodeAsset({ v: 1, type: 'asset-denied', id: current.id }));
  }

  private queueOf(playerId: string): PlayerQueue | null {
    const existing = this.queues.get(playerId);
    if (existing) return existing;
    const port = this.options.session.assetChannel(playerId);
    if (!port) return null;
    const queue: PlayerQueue = { port, pending: [], current: null, nextHandle: 1, pumping: false, again: false, stops: [] };
    queue.stops.push(
      port.onClose(() => { if (this.queues.get(playerId) === queue) this.drop(playerId); }),
      port.onDrain(ASSET_LIMITS.lowWaterBytes, () => this.pump(playerId, queue)),
    );
    this.queues.set(playerId, queue);
    return queue;
  }

  private drop(playerId: string): void {
    const queue = this.queues.get(playerId);
    if (!queue) return;
    this.queues.delete(playerId);
    queue.stops.forEach((stop) => stop());
    for (const id of queue.pending) this.reads.release(id);
    if (queue.current) this.reads.release(queue.current.id);
    queue.pending = [];
    queue.current = null;
  }

  /** Sends what the channel takes now; runs again when a read finishes or the buffer drains. */
  private pump(playerId: string, queue: PlayerQueue): void {
    if (this.queues.get(playerId) !== queue) return;
    if (queue.pumping) {
      // A synchronous reply (a cancel and a new request) arrived while sending: go round once more.
      queue.again = true;
      return;
    }
    queue.pumping = true;
    try {
      do {
        queue.again = false;
        let more = true;
        while (more) more = this.sendSome(playerId, queue);
      } while (queue.again && this.queues.get(playerId) === queue);
    } finally {
      queue.pumping = false;
    }
  }

  /** One step: start the next image, or send chunks of the current one. True when the next image can start now. */
  private sendSome(playerId: string, queue: PlayerQueue): boolean {
    const transfer = queue.current;
    if (!transfer) {
      const id = queue.pending.shift();
      if (id === undefined) return false;
      const next: Transfer = { id, handle: queue.nextHandle, file: null, offset: 0 };
      queue.nextHandle = queue.nextHandle >= MAX_HANDLE ? 1 : queue.nextHandle + 1;
      queue.current = next;
      void this.reads.file(id).then((file) => this.fileRead(playerId, queue, next, file));
      return false;
    }
    if (!transfer.file) return false;
    const bytes = new Uint8Array(transfer.file.bytes);
    while (transfer.offset < bytes.byteLength && queue.port.bufferedAmount() < ASSET_LIMITS.highWaterBytes) {
      const end = Math.min(transfer.offset + ASSET_LIMITS.chunkBytes, bytes.byteLength);
      queue.port.send(encodeChunk(transfer.handle, bytes.subarray(transfer.offset, end)));
      transfer.offset = end;
      if (queue.current !== transfer) return false; // cancelled while sending
    }
    if (transfer.offset < bytes.byteLength) return false; // waits for the drain
    queue.port.send(encodeAsset({ v: 1, type: 'asset-end', handle: transfer.handle }));
    this.finish(queue, transfer);
    return true;
  }

  private fileRead(playerId: string, queue: PlayerQueue, transfer: Transfer, file: AssetFile | null): void {
    if (queue.current !== transfer || this.queues.get(playerId) !== queue) return;
    if (!file) {
      this.finish(queue, transfer);
      queue.port.send(encodeAsset({ v: 1, type: 'asset-denied', id: transfer.id }));
    } else {
      transfer.file = file;
      queue.port.send(encodeAsset({
        v: 1, type: 'asset-start', id: transfer.id, handle: transfer.handle, size: file.bytes.byteLength, mime: file.mime,
      }));
    }
    this.pump(playerId, queue);
  }

  private finish(queue: PlayerQueue, transfer: Transfer): void {
    if (queue.current === transfer) queue.current = null;
    this.reads.release(transfer.id);
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/online/assetServer.test.ts`
Expected: PASS.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/online/assets --max-warnings 0`
Expected: both exit 0. `AssetServer.ts` is about 210 lines.

- [ ] **Step 7: Commit**

```bash
git add src/app/online/assets tests/unit/online/assetServer.test.ts
git commit -m "feat(online): serve the presented scene's images to players"
```

---

### Task 7: Player-side assembly and the image cache

**Files:**
- Create: `src/app/online/assets/TransferAssembler.ts`, `src/app/online/assets/AssetCache.ts`, `src/app/online/assets/indexedDbImageStore.ts`
- Modify: `tests/unit/online/assetFixtures.ts` (an in-memory `ImageStore`)
- Test: `tests/unit/online/transferAssembler.test.ts`, `tests/unit/online/assetCache.test.ts`

**Interfaces:**
- Consumes: Task 2 (`ASSET_LIMITS`, `isArrayBuffer`, `isAssetId`, `isAssetMime`, `type AssetMime`, `type AssetChunk`).
- Produces:
  - `TransferAssembler.ts`: `type ChunkResult = { kind: 'added'; id: string } | { kind: 'overflow'; id: string } | { kind: 'ignored' }`, `interface EndedTransfer { id: string; mime: AssetMime; bytes: ArrayBuffer | null }`, `class TransferAssembler { start(id: string, handle: number, size: number, mime: AssetMime): boolean; chunk(chunk: AssetChunk): ChunkResult; end(handle: number): EndedTransfer | null; drop(id: string): void; isOpen(id: string): boolean; received(id: string): number; clear(): void }`.
  - `AssetCache.ts`: `interface StoredImage { id: string; mime: AssetMime; bytes: ArrayBuffer }`, `interface StoredEntry { id: string; size: number; shownAt: number }`, `interface ImageStore { get(id): Promise<StoredImage | null>; put(image: StoredImage, shownAt: number): Promise<void>; touch(id: string, shownAt: number): Promise<void>; delete(ids: readonly string[]): Promise<void>; entries(): Promise<StoredEntry[]>; clear(): Promise<void> }`, `interface AssetCacheState { keep: boolean; available: boolean; usedBytes: number }`, `interface AssetCacheOptions { keep: boolean; openStore(): Promise<ImageStore | null>; now?: () => number; limitBytes?: number }`, `class AssetCache { get state(): AssetCacheState; onChange(listener: (state: AssetCacheState) => void): () => void; get(id: string): Promise<StoredImage | null>; put(image: StoredImage): Promise<void>; setKeep(keep: boolean): Promise<void>; clearSaved(): Promise<void> }`.
  - `indexedDbImageStore.ts`: `openIndexedDbImageStore(): Promise<ImageStore | null>`.
  - Test fixture: `class MemoryStore implements ImageStore` with `images: Map<string, { image: StoredImage; shownAt: number }>` and `quota: number` (a put over it throws, like a full disk).

Rules (spec, "AssetLoader" assembly limits and "AssetCache"; plan decisions 13 and 14): a transfer opens only when its handle and image are not open already, fewer than 16 are open and the size is at most 64 MB; a chunk that would pass the announced size discards the transfer; an end with fewer bytes than announced gives no bytes; chunks of unknown handles are ignored. The cache stores in `ImageStore` only with keeping on and storage available, else in memory, both capped at 500 MB and emptied least-recently-shown first; a failed write evicts to make room and retries once, then keeps the image in memory and reports `available: false`; stored records that are not images are ignored.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/online/assetFixtures.ts` (with `import type { ImageStore, StoredEntry, StoredImage } from '../../../src/app/online/assets/AssetCache';` at the top):

```ts
/** Browser storage in memory; a write over `quota` bytes fails like a full disk. */
export class MemoryStore implements ImageStore {
  readonly images = new Map<string, { image: StoredImage; shownAt: number }>();
  quota = Infinity;

  private used(): number {
    let total = 0;
    for (const { image } of this.images.values()) total += image.bytes.byteLength;
    return total;
  }
  async get(id: string): Promise<StoredImage | null> { return this.images.get(id)?.image ?? null; }
  async put(image: StoredImage, shownAt: number): Promise<void> {
    const replaced = this.images.get(image.id)?.image.bytes.byteLength ?? 0;
    if (this.used() - replaced + image.bytes.byteLength > this.quota) throw new Error('QuotaExceededError');
    this.images.set(image.id, { image, shownAt });
  }
  async touch(id: string, shownAt: number): Promise<void> {
    const entry = this.images.get(id);
    if (entry) entry.shownAt = shownAt;
  }
  async delete(ids: readonly string[]): Promise<void> { for (const id of ids) this.images.delete(id); }
  async entries(): Promise<StoredEntry[]> {
    return [...this.images.values()].map(({ image, shownAt }) => ({ id: image.id, size: image.bytes.byteLength, shownAt }));
  }
  async clear(): Promise<void> { this.images.clear(); }
}
```

Create `tests/unit/online/transferAssembler.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ASSET_LIMITS } from '../../../src/app/online/assets/assetIds';
import type { AssetChunk } from '../../../src/app/online/assets/assetProtocol';
import { TransferAssembler } from '../../../src/app/online/assets/TransferAssembler';
import { fingerprint as fp } from './sceneFixtures';

const A = fp(1);
const B = fp(2);
const chunk = (handle: number, bytes: number[]): AssetChunk => ({ handle, bytes: new Uint8Array(bytes) });

describe('TransferAssembler', () => {
  it('assembles a transfer from its chunks', () => {
    const assembler = new TransferAssembler();
    expect(assembler.start(A, 7, 5, 'image/png')).toBe(true);
    expect(assembler.chunk(chunk(7, [1, 2, 3]))).toEqual({ kind: 'added', id: A });
    expect(assembler.received(A)).toBe(3);
    assembler.chunk(chunk(7, [4, 5]));
    const ended = assembler.end(7);
    expect(ended?.id).toBe(A);
    expect(ended?.mime).toBe('image/png');
    expect([...new Uint8Array(ended?.bytes ?? new ArrayBuffer(0))]).toEqual([1, 2, 3, 4, 5]);
    expect(assembler.isOpen(A)).toBe(false);
    expect(assembler.end(7)).toBeNull();
  });

  it('never goes past the announced size, and reports a short transfer', () => {
    const assembler = new TransferAssembler();
    assembler.start(A, 1, 4, 'image/png');
    assembler.chunk(chunk(1, [1, 2, 3]));
    expect(assembler.chunk(chunk(1, [4, 5]))).toEqual({ kind: 'overflow', id: A });
    expect(assembler.isOpen(A)).toBe(false);
    expect(assembler.chunk(chunk(1, [6]))).toEqual({ kind: 'ignored' });

    assembler.start(B, 2, 4, 'image/gif');
    assembler.chunk(chunk(2, [1]));
    expect(assembler.end(2)).toEqual({ id: B, mime: 'image/gif', bytes: null });
  });

  it('ignores chunks and ends of transfers it was not told about', () => {
    const assembler = new TransferAssembler();
    expect(assembler.chunk(chunk(9, [1]))).toEqual({ kind: 'ignored' });
    expect(assembler.end(9)).toBeNull();
    expect(assembler.received(A)).toBe(0);
  });

  it('opens at most 16 transfers, one per handle and image, of at most 64 MB', () => {
    const assembler = new TransferAssembler();
    for (let index = 1; index <= ASSET_LIMITS.openTransfers; index++) expect(assembler.start(fp(index), index, 1, 'image/png')).toBe(true);
    expect(assembler.start(fp(99), 99, 1, 'image/png')).toBe(false);
    assembler.clear();
    expect(assembler.start(A, 1, ASSET_LIMITS.fileBytes + 1, 'image/png')).toBe(false);
    expect(assembler.start(A, 1, ASSET_LIMITS.fileBytes, 'image/png')).toBe(true);
    expect(assembler.start(B, 1, 1, 'image/png')).toBe(false); // handle in use
    expect(assembler.start(A, 2, 1, 'image/png')).toBe(false); // image already coming
    assembler.drop(A);
    expect(assembler.start(A, 2, 1, 'image/png')).toBe(true);
  });
});
```

Create `tests/unit/online/assetCache.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AssetCache, type AssetCacheState, type StoredImage } from '../../../src/app/online/assets/AssetCache';
import { MemoryStore } from './assetFixtures';
import { fingerprint as fp } from './sceneFixtures';

const image = (n: number, size: number): StoredImage => ({ id: fp(n), mime: 'image/png', bytes: new ArrayBuffer(size) });

function clock(): () => number {
  let now = 0;
  return () => ++now;
}

describe('AssetCache', () => {
  it('keeps images on the device across visits', async () => {
    const store = new MemoryStore();
    const first = new AssetCache({ keep: true, openStore: async () => store, now: clock() });
    await first.put(image(1, 100));
    expect(first.state).toEqual({ keep: true, available: true, usedBytes: 100 });

    const second = new AssetCache({ keep: true, openStore: async () => store, now: clock() });
    expect(await second.get(fp(1))).toMatchObject({ id: fp(1), mime: 'image/png' });
    expect(second.state.usedBytes).toBe(100);
    expect(await second.get(fp(2))).toBeNull();
  });

  it('keeps images in memory only with keeping off, and switching it off deletes what was stored', async () => {
    const store = new MemoryStore();
    const cache = new AssetCache({ keep: true, openStore: async () => store, now: clock() });
    await cache.put(image(1, 100));
    await cache.setKeep(false);
    expect(store.images.size).toBe(0);
    expect(cache.state).toEqual({ keep: false, available: true, usedBytes: 0 });

    await cache.put(image(2, 50));
    expect(store.images.size).toBe(0);
    expect(await cache.get(fp(2))).not.toBeNull();
    const nextVisit = new AssetCache({ keep: false, openStore: async () => store });
    expect(await nextVisit.get(fp(2))).toBeNull();
  });

  it('drops the least recently shown images beyond its limit', async () => {
    const store = new MemoryStore();
    const cache = new AssetCache({ keep: true, openStore: async () => store, now: clock(), limitBytes: 100 });
    await cache.put(image(1, 40));
    await cache.put(image(2, 40));
    await cache.get(fp(1)); // shown again: now the most recent
    await cache.put(image(3, 40));
    expect([...store.images.keys()].sort()).toEqual([fp(1), fp(3)].sort());
    expect(cache.state.usedBytes).toBe(80);

    const inMemory = new AssetCache({ keep: false, openStore: async () => store, now: clock(), limitBytes: 100 });
    await inMemory.put(image(4, 60));
    await inMemory.put(image(5, 60));
    expect(await inMemory.get(fp(4))).toBeNull();
    expect(await inMemory.get(fp(5))).not.toBeNull();
  });

  it('makes room when storage is full, and keeps an image that still does not fit in memory', async () => {
    const store = new MemoryStore();
    store.quota = 100;
    const cache = new AssetCache({ keep: true, openStore: async () => store, now: clock() });
    await cache.put(image(1, 60));
    await cache.put(image(2, 60)); // over the quota: image 1 goes, then it fits
    expect([...store.images.keys()]).toEqual([fp(2)]);

    store.quota = 10;
    await cache.put(image(3, 60)); // never fits: kept for this visit only
    expect(store.images.has(fp(3))).toBe(false);
    expect(await cache.get(fp(3))).not.toBeNull();
    expect(cache.state.available).toBe(false);
  });

  it('works in memory when storage is unavailable', async () => {
    for (const openStore of [async (): Promise<null> => null, async (): Promise<never> => { throw new Error('blocked'); }]) {
      const cache = new AssetCache({ keep: true, openStore });
      await cache.put(image(1, 10));
      expect(await cache.get(fp(1))).not.toBeNull();
      expect(cache.state).toEqual({ keep: true, available: false, usedBytes: 0 });
    }
  });

  it('clears saved images and tells listeners the space used', async () => {
    const store = new MemoryStore();
    const cache = new AssetCache({ keep: true, openStore: async () => store, now: clock() });
    const states: AssetCacheState[] = [];
    cache.onChange((state) => states.push(state));
    await cache.put(image(1, 100));
    await cache.clearSaved();
    expect(store.images.size).toBe(0);
    expect(states.map((state) => state.usedBytes)).toEqual([100, 0]);
  });

  it('ignores stored records that are not images', async () => {
    const store = new MemoryStore();
    store.images.set(fp(1), { image: { id: fp(1), mime: 'text/html', bytes: new ArrayBuffer(1) } as unknown as StoredImage, shownAt: 1 });
    store.images.set(fp(2), { image: { id: fp(2), mime: 'image/png', bytes: 'not bytes' } as unknown as StoredImage, shownAt: 1 });
    const cache = new AssetCache({ keep: true, openStore: async () => store });
    expect(await cache.get(fp(1))).toBeNull();
    expect(await cache.get(fp(2))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/online/transferAssembler.test.ts tests/unit/online/assetCache.test.ts`
Expected: FAIL — cannot resolve `TransferAssembler` and `AssetCache`.

- [ ] **Step 3: Write the assembler**

Create `src/app/online/assets/TransferAssembler.ts`:

```ts
/**
 * Assembles images from the GM's chunks. Only transfers announced with
 * `asset-start` are assembled, never beyond their announced size (at most
 * 64 MB), and at most 16 at once, so a hostile GM or connection cannot make a
 * player hold more. Shared with the web player page.
 */
import { ASSET_LIMITS, type AssetMime } from './assetIds';
import type { AssetChunk } from './assetProtocol';

interface OpenTransfer {
  id: string;
  mime: AssetMime;
  size: number;
  received: number;
  parts: Uint8Array[];
}

export type ChunkResult = { kind: 'added'; id: string } | { kind: 'overflow'; id: string } | { kind: 'ignored' };

/** A closed transfer: its bytes, or null when fewer arrived than announced. */
export interface EndedTransfer {
  id: string;
  mime: AssetMime;
  bytes: ArrayBuffer | null;
}

export class TransferAssembler {
  private readonly open = new Map<number, OpenTransfer>();

  /** Opens a transfer; false (nothing opened) for a handle or image already open, too many open, or a size over the limit. */
  start(id: string, handle: number, size: number, mime: AssetMime): boolean {
    if (this.open.has(handle) || this.isOpen(id)) return false;
    if (this.open.size >= ASSET_LIMITS.openTransfers || size > ASSET_LIMITS.fileBytes) return false;
    this.open.set(handle, { id, mime, size, received: 0, parts: [] });
    return true;
  }

  /** Adds a chunk to its transfer; one that would pass the announced size is discarded (`overflow`). */
  chunk(chunk: AssetChunk): ChunkResult {
    const transfer = this.open.get(chunk.handle);
    if (!transfer) return { kind: 'ignored' };
    if (transfer.received + chunk.bytes.byteLength > transfer.size) {
      this.open.delete(chunk.handle);
      return { kind: 'overflow', id: transfer.id };
    }
    transfer.parts.push(chunk.bytes.slice());
    transfer.received += chunk.bytes.byteLength;
    return { kind: 'added', id: transfer.id };
  }

  /** Closes a transfer; null for a handle that is not open. */
  end(handle: number): EndedTransfer | null {
    const transfer = this.open.get(handle);
    if (!transfer) return null;
    this.open.delete(handle);
    if (transfer.received !== transfer.size) return { id: transfer.id, mime: transfer.mime, bytes: null };
    const bytes = new Uint8Array(transfer.size);
    let offset = 0;
    for (const part of transfer.parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    return { id: transfer.id, mime: transfer.mime, bytes: bytes.buffer };
  }

  /** Discards the transfer of `id`, if one is open. */
  drop(id: string): void {
    for (const [handle, transfer] of this.open) if (transfer.id === id) this.open.delete(handle);
  }

  isOpen(id: string): boolean {
    for (const transfer of this.open.values()) if (transfer.id === id) return true;
    return false;
  }

  /** Bytes received so far for `id`; 0 when no transfer of it is open. */
  received(id: string): number {
    for (const transfer of this.open.values()) if (transfer.id === id) return transfer.received;
    return 0;
  }

  clear(): void {
    this.open.clear();
  }
}
```

- [ ] **Step 4: Write the cache**

Create `src/app/online/assets/AssetCache.ts`:

```ts
/**
 * The images a player keeps. With keeping on and storage available, finished
 * images are stored in the browser (`ImageStore`: IndexedDB on the join page)
 * up to 500 MB, the least recently shown dropped first; otherwise, and when
 * storing keeps failing, they are kept in memory for the visit under the same
 * cap. Shared with the web player page.
 */
import { ASSET_LIMITS, isArrayBuffer, isAssetId, isAssetMime, type AssetMime } from './assetIds';

export interface StoredImage {
  id: string;
  mime: AssetMime;
  bytes: ArrayBuffer;
}

export interface StoredEntry {
  id: string;
  size: number;
  /** When the image was last shown; the smallest goes first. */
  shownAt: number;
}

/** Persistent image storage: `openIndexedDbImageStore` on the join page, a map in tests. Any call may reject. */
export interface ImageStore {
  get(id: string): Promise<StoredImage | null>;
  put(image: StoredImage, shownAt: number): Promise<void>;
  touch(id: string, shownAt: number): Promise<void>;
  delete(ids: readonly string[]): Promise<void>;
  entries(): Promise<StoredEntry[]>;
  clear(): Promise<void>;
}

export interface AssetCacheState {
  keep: boolean;
  /** False when the browser cannot store images: private window, blocked storage, full disk. */
  available: boolean;
  /** Bytes of images stored on this device. */
  usedBytes: number;
}

export interface AssetCacheOptions {
  keep: boolean;
  /** Null when there is no storage; may reject. */
  openStore(): Promise<ImageStore | null>;
  now?: () => number;
  limitBytes?: number;
}

interface Remembered {
  image: StoredImage;
  shownAt: number;
}

function isStoredEntry(value: unknown): value is StoredEntry {
  const entry = value as Partial<StoredEntry> | null;
  return typeof entry === 'object' && entry !== null && isAssetId(entry.id)
    && Number.isFinite(entry.size) && Number.isFinite(entry.shownAt);
}

export class AssetCache {
  private store: ImageStore | null = null;
  /** What the store holds, without the bytes. */
  private readonly entries = new Map<string, StoredEntry>();
  private readonly memory = new Map<string, Remembered>();
  private memoryBytes = 0;
  private current: AssetCacheState;
  private readonly listeners = new Set<(state: AssetCacheState) => void>();
  private readonly now: () => number;
  private readonly limit: number;
  private readonly ready: Promise<void>;

  constructor(private readonly options: AssetCacheOptions) {
    this.now = options.now ?? Date.now;
    this.limit = options.limitBytes ?? ASSET_LIMITS.cacheBytes;
    this.current = { keep: options.keep, available: true, usedBytes: 0 };
    this.ready = this.open();
  }

  get state(): AssetCacheState {
    return this.current;
  }

  onChange(listener: (state: AssetCacheState) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** An image this device has, from memory or storage; it counts as shown now. */
  async get(id: string): Promise<StoredImage | null> {
    await this.ready;
    const now = this.now();
    const remembered = this.memory.get(id);
    if (remembered) {
      remembered.shownAt = now;
      return remembered.image;
    }
    const entry = this.entries.get(id);
    const store = this.store;
    if (!entry || !store) return null;
    let image: StoredImage | null;
    try {
      image = await store.get(id);
    } catch {
      return null;
    }
    if (!image || image.id !== id || !isArrayBuffer(image.bytes) || !isAssetMime(image.mime)) return null;
    entry.shownAt = now;
    void store.touch(id, now).catch(() => undefined);
    return image;
  }

  /** Keeps a finished image: stored when keeping is on and storage works, otherwise in memory. */
  async put(image: StoredImage): Promise<void> {
    await this.ready;
    const now = this.now();
    const store = this.store;
    if (this.current.keep && this.current.available && store && await this.storeImage(store, image, now)) return;
    this.remember(image, now);
  }

  /** Switching keeping off deletes the stored images; images of this visit in memory stay. */
  async setKeep(keep: boolean): Promise<void> {
    await this.ready;
    if (keep === this.current.keep) return;
    this.update({ keep });
    if (!keep) await this.clearStore();
  }

  /** "Clear saved images": empties the storage; images of this visit in memory stay. */
  async clearSaved(): Promise<void> {
    await this.ready;
    await this.clearStore();
  }

  private async open(): Promise<void> {
    try {
      const store = await this.options.openStore();
      if (store) {
        for (const entry of await store.entries()) if (isStoredEntry(entry)) this.entries.set(entry.id, entry);
        this.store = store;
      }
    } catch {
      this.store = null;
      this.entries.clear();
    }
    if (!this.store) {
      this.update({ available: false });
      return;
    }
    // Keeping was switched off in a visit that could not delete what was stored.
    if (!this.current.keep && this.entries.size > 0) await this.clearStore();
    this.update({ usedBytes: this.storedBytes() });
  }

  private async storeImage(store: ImageStore, image: StoredImage, now: number): Promise<boolean> {
    const size = image.bytes.byteLength;
    if (size > this.limit) return false;
    if (this.entries.has(image.id)) return true;
    await this.evict(store, this.limit - size);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await store.put(image, now);
        this.entries.set(image.id, { id: image.id, size, shownAt: now });
        this.update({ usedBytes: this.storedBytes() });
        return true;
      } catch {
        // Full: drop the least recently shown to make room for this image, then try once more.
        if (attempt === 0) await this.evict(store, this.storedBytes() - size);
      }
    }
    this.update({ available: false, usedBytes: this.storedBytes() });
    return false;
  }

  /** Drops the least recently shown stored images until at most `target` bytes are stored. */
  private async evict(store: ImageStore, target: number): Promise<void> {
    let used = this.storedBytes();
    if (used <= target) return;
    const drop: string[] = [];
    for (const entry of [...this.entries.values()].sort((a, b) => a.shownAt - b.shownAt)) {
      if (used <= target) break;
      drop.push(entry.id);
      used -= entry.size;
    }
    try {
      await store.delete(drop);
    } catch {
      return;
    }
    for (const id of drop) this.entries.delete(id);
  }

  private remember(image: StoredImage, now: number): void {
    const size = image.bytes.byteLength;
    if (size > this.limit || this.memory.has(image.id)) return;
    for (const [id, held] of [...this.memory].sort(([, a], [, b]) => a.shownAt - b.shownAt)) {
      if (this.memoryBytes + size <= this.limit) break;
      this.memory.delete(id);
      this.memoryBytes -= held.image.bytes.byteLength;
    }
    this.memory.set(image.id, { image, shownAt: now });
    this.memoryBytes += size;
  }

  private async clearStore(): Promise<void> {
    if (!this.store) return;
    try {
      await this.store.clear();
      this.entries.clear();
    } catch {
      // Left as it was: the space shown stays true.
    }
    this.update({ usedBytes: this.storedBytes() });
  }

  private storedBytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.size;
    return total;
  }

  private update(partial: Partial<AssetCacheState>): void {
    const next: AssetCacheState = { ...this.current, ...partial };
    const same = next.keep === this.current.keep && next.available === this.current.available && next.usedBytes === this.current.usedBytes;
    if (same) return;
    this.current = next;
    for (const listener of [...this.listeners]) listener(next);
  }
}
```

- [ ] **Step 5: Write the IndexedDB store**

Create `src/app/online/assets/indexedDbImageStore.ts` (browser only; jsdom has no IndexedDB, so the manual test in Task 11 covers it, plan decision 14):

```ts
/**
 * `ImageStore` on IndexedDB for the join page: image bytes and their metadata
 * in separate object stores, so listing what is kept never loads the images.
 * `AssetCache` validates what it reads back.
 */
import type { ImageStore, StoredEntry, StoredImage } from './AssetCache';

const DB_NAME = 'atlas-online-images';
const DB_VERSION = 1;
const IMAGES = 'images';
const ENTRIES = 'entries';

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = (): void => resolve();
    transaction.onerror = (): void => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = (): void => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = (): void => {
    const db = request.result;
    if (!db.objectStoreNames.contains(IMAGES)) db.createObjectStore(IMAGES, { keyPath: 'id' });
    if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: 'id' });
  };
  return done(request);
}

/** Null when the browser has no IndexedDB or refuses to open it (some private windows, blocked storage). */
export async function openIndexedDbImageStore(): Promise<ImageStore | null> {
  if (typeof indexedDB === 'undefined') return null;
  let db: IDBDatabase;
  try {
    db = await openDatabase();
  } catch {
    return null;
  }
  const write = async (work: (images: IDBObjectStore, entries: IDBObjectStore) => void): Promise<void> => {
    const transaction = db.transaction([IMAGES, ENTRIES], 'readwrite');
    const complete = finished(transaction);
    work(transaction.objectStore(IMAGES), transaction.objectStore(ENTRIES));
    await complete;
  };
  return {
    get: async (id: string): Promise<StoredImage | null> => {
      const value: unknown = await done(db.transaction(IMAGES, 'readonly').objectStore(IMAGES).get(id));
      return (value as StoredImage | undefined) ?? null;
    },
    put: (image: StoredImage, shownAt: number): Promise<void> => write((images, entries) => {
      images.put({ id: image.id, mime: image.mime, bytes: image.bytes });
      entries.put({ id: image.id, size: image.bytes.byteLength, shownAt });
    }),
    touch: (id: string, shownAt: number): Promise<void> => write((_images, entries) => {
      const request = entries.get(id);
      request.onsuccess = (): void => {
        const entry = request.result as StoredEntry | undefined;
        if (entry) entries.put({ ...entry, shownAt });
      };
    }),
    delete: (ids: readonly string[]): Promise<void> => write((images, entries) => {
      for (const id of ids) {
        images.delete(id);
        entries.delete(id);
      }
    }),
    entries: async (): Promise<StoredEntry[]> => {
      const values: unknown = await done(db.transaction(ENTRIES, 'readonly').objectStore(ENTRIES).getAll());
      return Array.isArray(values) ? (values as StoredEntry[]) : [];
    },
    clear: (): Promise<void> => write((images, entries) => {
      images.clear();
      entries.clear();
    }),
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/online/transferAssembler.test.ts tests/unit/online/assetCache.test.ts`
Expected: PASS.

- [ ] **Step 7: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/online/assets --max-warnings 0`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/app/online/assets tests/unit/online/assetFixtures.ts tests/unit/online/transferAssembler.test.ts tests/unit/online/assetCache.test.ts
git commit -m "feat(online): assemble images on the player side and keep them on the device"
```

---

### Task 8: `AssetLoader`: the player's images

**Files:**
- Create: `src/app/online/assets/AssetLoader.ts`
- Test: `tests/unit/online/assetLoader.test.ts`

**Interfaces:**
- Consumes: Task 2 (`ASSET_LIMITS`, `sceneAssetIds`, `sha256Id`, `type AssetMime`, `type Hasher`, `decodeAsset`, `encodeAsset`, `type AssetChunk`, `type AssetMessage`), Task 4 (`PlayerAssetHandler`), Task 7 (`TransferAssembler`, `AssetCache` `get` / `put`, `StoredImage`).
- Produces (`AssetLoader.ts`):
  - `interface DecodedImage { image: ImageBitmap | HTMLImageElement; width: number; height: number; release(): void }`
  - `type ImageDecoder = (bytes: ArrayBuffer, mime: AssetMime) => Promise<DecodedImage | null>`
  - `interface AssetProgress { outstanding: number; receivedBytes: number; totalBytes: number }`
  - `interface AssetLoaderOptions { cache: Pick<AssetCache, 'get' | 'put'>; decode: ImageDecoder; hash?: Hasher; onChange(): void }`
  - `class AssetLoader implements PlayerAssetHandler { setScene(scene: PlayerScene | null): void; image(id: string | null): DecodedImage | null; progress(): AssetProgress; connected(send: (data: string) => void): void; receive(data: unknown): void; disconnected(): void; dispose(): void }`

Rules (spec, "AssetLoader"; plan decisions 9–12): on a scene change, every fingerprint the scene uses is wanted; new ones are looked up in the cache together, and the misses requested together (≤ 64 per message, the map first, ≤ 256 outstanding, more as images finish); images the scene no longer uses are released, and those still requested are cancelled; chunks are assembled only for starts of requested fingerprints; every image, from the GM or the cache, is hashed before it is decoded; a broken transfer is cancelled and requested once more, then refused; denied and undecodable images are refused until they leave the scene and come back; images from the GM are put in the cache once they decode; a dropped connection discards partial images, and after the next `connected` the loader requests what it still lacks.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/online/assetLoader.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { StoredImage } from '../../../src/app/online/assets/AssetCache';
import { ASSET_LIMITS, type AssetMime } from '../../../src/app/online/assets/assetIds';
import { AssetLoader, type DecodedImage } from '../../../src/app/online/assets/AssetLoader';
import { decodeAsset, encodeAsset, encodeChunk, type AssetMessage } from '../../../src/app/online/assets/assetProtocol';
import { fingerprintOf, imageBytes, nodeHash, settle } from './assetFixtures';
import { sceneWithImages } from './sceneFixtures';

/** The GM end of the assets channel, driven by hand. */
class FakeGm {
  readonly sent: AssetMessage[] = [];
  constructor(private readonly loader: AssetLoader) {}
  connect(): void {
    this.loader.connected((data) => {
      const decoded = decodeAsset(data);
      if (decoded.kind === 'message') this.sent.push(decoded.message);
    });
  }
  requested(): string[] { return this.sent.flatMap((message) => (message.type === 'asset-request' ? message.ids : [])); }
  cancelled(): string[] { return this.sent.flatMap((message) => (message.type === 'asset-cancel' ? message.ids : [])); }
  start(id: string, handle: number, size: number, mime: AssetMime = 'image/png'): void {
    this.loader.receive(encodeAsset({ v: 1, type: 'asset-start', id, handle, size, mime }));
  }
  chunks(handle: number, bytes: Uint8Array, from = 0, to = bytes.byteLength): void {
    for (let offset = from; offset < to; offset += ASSET_LIMITS.chunkBytes) {
      this.loader.receive(encodeChunk(handle, bytes.subarray(offset, Math.min(offset + ASSET_LIMITS.chunkBytes, to))));
    }
  }
  end(handle: number): void { this.loader.receive(encodeAsset({ v: 1, type: 'asset-end', handle })); }
  serve(id: string, handle: number, bytes: Uint8Array): void {
    this.start(id, handle, bytes.byteLength);
    this.chunks(handle, bytes);
    this.end(handle);
  }
  deny(id: string): void { this.loader.receive(encodeAsset({ v: 1, type: 'asset-denied', id })); }
}

function setup(stored: Uint8Array[] = [], undecodable: string[] = []) {
  const cache = new Map<string, StoredImage>(stored.map((bytes) => {
    const id = fingerprintOf(bytes);
    return [id, { id, mime: 'image/png', bytes: bytes.slice().buffer }];
  }));
  const cacheApi = {
    get: vi.fn(async (id: string): Promise<StoredImage | null> => cache.get(id) ?? null),
    put: vi.fn(async (image: StoredImage): Promise<void> => { cache.set(image.id, image); }),
  };
  const released: string[] = [];
  const decode = vi.fn(async (bytes: ArrayBuffer): Promise<DecodedImage | null> => {
    const id = fingerprintOf(new Uint8Array(bytes));
    if (undecodable.includes(id)) return null;
    return { image: { id } as unknown as ImageBitmap, width: 10, height: 10, release: () => released.push(id) };
  });
  let changes = 0;
  const loader = new AssetLoader({ cache: cacheApi, decode, hash: nodeHash, onChange: () => { changes++; } });
  return { loader, gm: new FakeGm(loader), cache, cacheApi, decode, released, changes: () => changes };
}

describe('AssetLoader', () => {
  it('loads images this device has and requests the rest together, the map first', async () => {
    const map = imageBytes(500, 1);
    const kept = imageBytes(300, 2);
    const tokens = Array.from({ length: 70 }, (_, index) => imageBytes(20, 10 + index));
    const h = setup([kept]);
    h.gm.connect();
    h.loader.setScene(sceneWithImages(fingerprintOf(map), [fingerprintOf(kept), ...tokens.map((bytes) => fingerprintOf(bytes))]));
    await settle();
    const requests = h.gm.sent.filter((message) => message.type === 'asset-request');
    expect(requests.map((message) => (message.type === 'asset-request' ? message.ids.length : 0))).toEqual([64, 7]);
    expect(h.gm.requested()[0]).toBe(fingerprintOf(map));
    expect(h.gm.requested()).not.toContain(fingerprintOf(kept));
    expect(h.loader.image(fingerprintOf(kept))?.image).toEqual({ id: fingerprintOf(kept) });
    expect(h.cacheApi.put).not.toHaveBeenCalled(); // it came from the cache
  });

  it('asks for an image once however many tokens show it', async () => {
    const art = imageBytes(100);
    const id = fingerprintOf(art);
    const h = setup();
    h.gm.connect();
    h.loader.setScene(sceneWithImages(id, [id, id, id]));
    await settle();
    expect(h.gm.requested()).toEqual([id]);
    h.gm.serve(id, 1, art);
    await settle();
    expect(h.loader.image(id)).not.toBeNull();
    expect(h.decode).toHaveBeenCalledTimes(1);
  });

  it('requests nothing before it is connected, and everything it lacks once connected', async () => {
    const art = imageBytes(100);
    const h = setup();
    h.loader.setScene(sceneWithImages(null, [fingerprintOf(art)]));
    await settle();
    h.gm.connect();
    expect(h.gm.requested()).toEqual([fingerprintOf(art)]);
  });

  it('keeps at most 256 images outstanding and asks for more as they arrive', async () => {
    const arts = Array.from({ length: 300 }, (_, index) => imageBytes(8, index + 1));
    const h = setup();
    h.gm.connect();
    h.loader.setScene(sceneWithImages(null, arts.map((bytes) => fingerprintOf(bytes))));
    await settle();
    expect(h.gm.requested()).toHaveLength(ASSET_LIMITS.pendingPerPlayer);
    h.gm.serve(fingerprintOf(arts[0]!), 1, arts[0]!);
    expect(h.gm.requested()).toHaveLength(ASSET_LIMITS.pendingPerPlayer + 1);
  });

  it('assembles an image from its chunks, checks it, keeps it and reports progress', async () => {
    const map = imageBytes(150_000);
    const id = fingerprintOf(map);
    const h = setup();
    h.gm.connect();
    h.loader.setScene(sceneWithImages(id, []));
    await settle();
    expect(h.loader.progress()).toEqual({ outstanding: 1, receivedBytes: 0, totalBytes: 0 });
    h.gm.start(id, 7, map.byteLength);
    h.gm.chunks(7, map, 0, 65_536);
    expect(h.loader.progress()).toEqual({ outstanding: 1, receivedBytes: 65_536, totalBytes: 150_000 });
    h.gm.chunks(7, map, 65_536);
    h.gm.end(7);
    await settle();
    expect(h.loader.progress()).toEqual({ outstanding: 0, receivedBytes: 0, totalBytes: 0 });
    expect(h.loader.image(id)?.image).toEqual({ id });
    expect(new Uint8Array(h.cache.get(id)?.bytes ?? new ArrayBuffer(0))).toEqual(map);
    expect(h.changes()).toBeGreaterThan(2);
  });

  it('never assembles more than announced, and asks once more after a broken transfer', async () => {
    const art = imageBytes(1000);
    const id = fingerprintOf(art);
    const h = setup();
    h.gm.connect();
    h.loader.setScene(sceneWithImages(null, [id]));
    await settle();
    h.gm.start(id, 1, 500); // announces less than it sends
    h.gm.chunks(1, art);
    expect(h.gm.cancelled()).toEqual([id]);
    expect(h.gm.requested()).toEqual([id, id]);

    h.gm.serve(id, 2, imageBytes(1000, 99)); // other bytes: they fail the fingerprint
    await settle();
    expect(h.loader.image(id)).toBeNull();
    expect(h.gm.requested()).toEqual([id, id]); // refused now: not asked again
    expect(h.loader.progress().outstanding).toBe(0);
    expect(h.cacheApi.put).not.toHaveBeenCalled();
  });

  it('ignores starts it did not ask for and chunks of transfers it was not told about', async () => {
    const other = imageBytes(5, 5);
    const h = setup();
    h.gm.connect();
    h.gm.serve(fingerprintOf(other), 3, other); // never requested
    h.gm.chunks(99, imageBytes(10)); // unknown handle
    await settle();
    expect(h.loader.image(fingerprintOf(other))).toBeNull();
    expect(h.decode).not.toHaveBeenCalled();
  });

  it('cancels images the scene stops using, and asks again for a denied one only after it left and came back', async () => {
    const a = fingerprintOf(imageBytes(10, 1));
    const b = fingerprintOf(imageBytes(10, 2));
    const h = setup();
    h.gm.connect();
    h.loader.setScene(sceneWithImages(a, [b]));
    await settle();
    expect(h.gm.requested()).toEqual([a, b]);
    h.gm.deny(b);
    h.loader.setScene(sceneWithImages(a, [b])); // still there: not asked again
    await settle();
    expect(h.gm.requested()).toEqual([a, b]);

    h.loader.setScene(sceneWithImages(null, [b])); // the map leaves while requested
    expect(h.gm.cancelled()).toEqual([a]);
    h.loader.setScene(sceneWithImages(null, [])); // b leaves: it was refused, nothing to cancel
    expect(h.gm.cancelled()).toEqual([a]);
    h.loader.setScene(sceneWithImages(null, [b])); // and comes back
    await settle();
    expect(h.gm.requested()).toEqual([a, b, b]);
  });

  it('does not ask again for an image that does not decode', async () => {
    const art = imageBytes(100);
    const id = fingerprintOf(art);
    const h = setup([], [id]);
    h.gm.connect();
    h.loader.setScene(sceneWithImages(null, [id]));
    await settle();
    h.gm.serve(id, 1, art);
    await settle();
    expect(h.loader.image(id)).toBeNull();
    for (let patch = 0; patch < 3; patch++) h.loader.setScene(sceneWithImages(null, [id]));
    await settle();
    expect(h.gm.requested()).toEqual([id]);
    expect(h.loader.progress().outstanding).toBe(0);
    expect(h.cacheApi.put).not.toHaveBeenCalled();
  });

  it('drops partial images on a disconnect and asks for what it lacks after reconnecting', async () => {
    const map = imageBytes(200_000, 1);
    const token = imageBytes(100, 2);
    const mapId = fingerprintOf(map);
    const tokenId = fingerprintOf(token);
    const h = setup();
    h.gm.connect();
    h.loader.setScene(sceneWithImages(mapId, [tokenId]));
    await settle();
    h.gm.serve(tokenId, 2, token);
    await settle();
    h.gm.start(mapId, 1, map.byteLength);
    h.gm.chunks(1, map, 0, 65_536);

    h.loader.disconnected();
    expect(h.loader.progress()).toEqual({ outstanding: 1, receivedBytes: 0, totalBytes: 0 });
    const before = h.gm.sent.length;
    h.gm.connect(); // a new link: the GM starts over
    expect(h.gm.sent.slice(before)).toEqual([{ v: 1, type: 'asset-request', ids: [mapId] }]);
    h.gm.chunks(1, map, 65_536); // late chunks of the old transfer are ignored
    h.gm.end(1);
    h.gm.serve(mapId, 1, map); // the new link numbers its transfers from 1 again
    await settle();
    expect(new Uint8Array(h.cache.get(mapId)?.bytes ?? new ArrayBuffer(0))).toEqual(map);
    expect(h.loader.image(tokenId)).not.toBeNull();
  });

  it('checks cached images too, and asks the GM for one that does not match', async () => {
    const art = imageBytes(100);
    const id = fingerprintOf(art);
    const h = setup();
    h.cache.set(id, { id, mime: 'image/png', bytes: imageBytes(100, 7).slice().buffer }); // tampered with
    h.gm.connect();
    h.loader.setScene(sceneWithImages(null, [id]));
    await settle();
    expect(h.gm.requested()).toEqual([id]);
    expect(h.decode).not.toHaveBeenCalled();
  });

  it('releases images the scene no longer shows, and everything when disposed', async () => {
    const a = imageBytes(10, 1);
    const b = imageBytes(10, 2);
    const h = setup([a, b]);
    h.loader.setScene(sceneWithImages(fingerprintOf(a), [fingerprintOf(b)]));
    await settle();
    h.loader.setScene(sceneWithImages(null, [fingerprintOf(b)]));
    expect(h.released).toEqual([fingerprintOf(a)]);
    expect(h.loader.image(fingerprintOf(a))).toBeNull();
    h.loader.dispose();
    expect(h.released).toEqual([fingerprintOf(a), fingerprintOf(b)]);
    expect(h.loader.image(fingerprintOf(b))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/online/assetLoader.test.ts`
Expected: FAIL — cannot resolve `src/app/online/assets/AssetLoader`.

- [ ] **Step 3: Write the loader**

Create `src/app/online/assets/AssetLoader.ts`:

```ts
/**
 * The player's side of image delivery, shared with the web player page (no
 * Obsidian imports). It follows the scene: images this device has come from
 * the cache, the rest are requested from the GM (at most 256 outstanding, 64
 * per message) and assembled from chunks. Every image is checked against its
 * fingerprint before it is decoded and shown; images the scene stops using
 * are cancelled and released.
 */
import type { PlayerAssetHandler } from '../PlayerSession';
import type { PlayerScene } from '../scene/sceneTypes';
import type { AssetCache } from './AssetCache';
import { ASSET_LIMITS, sceneAssetIds, sha256Id, type AssetMime, type Hasher } from './assetIds';
import { decodeAsset, encodeAsset, type AssetChunk, type AssetMessage } from './assetProtocol';
import { TransferAssembler } from './TransferAssembler';

export interface DecodedImage {
  image: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  release(): void;
}

export type ImageDecoder = (bytes: ArrayBuffer, mime: AssetMime) => Promise<DecodedImage | null>;

/** What the loading bar shows: images still coming for this scene, and their bytes. */
export interface AssetProgress {
  outstanding: number;
  receivedBytes: number;
  totalBytes: number;
}

export interface AssetLoaderOptions {
  cache: Pick<AssetCache, 'get' | 'put'>;
  decode: ImageDecoder;
  /** SHA-256 as an asset id; tests driven by fake timers pass one that resolves at once. */
  hash?: Hasher;
  /** Images or progress changed: redraw. */
  onChange(): void;
}

/** `refused`: denied, broken twice or undecodable; not asked for again while it stays in the scene. */
type Phase = 'checking' | 'waiting' | 'requested' | 'loading' | 'ready' | 'refused';

interface Wanted {
  phase: Phase;
  retried: boolean;
  /** Announced by `asset-start`; null until then. */
  size: number | null;
  image: DecodedImage | null;
}

type Outcome = 'shown' | 'mismatch' | 'undecodable' | 'gone';

export class AssetLoader implements PlayerAssetHandler {
  private readonly wanted = new Map<string, Wanted>();
  private readonly assembler = new TransferAssembler();
  private readonly hash: Hasher;
  private send: ((data: string) => void) | null = null;
  /** Bytes of images finished since the loading bar was last empty. */
  private doneBytes = 0;
  private disposed = false;

  constructor(private readonly options: AssetLoaderOptions) {
    this.hash = options.hash ?? sha256Id;
  }

  /** The decoded image for a fingerprint, once it is ready. */
  image(id: string | null): DecodedImage | null {
    return id === null ? null : this.wanted.get(id)?.image ?? null;
  }

  progress(): AssetProgress {
    let outstanding = 0;
    let receivedBytes = this.doneBytes;
    let totalBytes = this.doneBytes;
    for (const [id, wanted] of this.wanted) {
      if (wanted.phase !== 'waiting' && wanted.phase !== 'requested') continue;
      outstanding++;
      receivedBytes += this.assembler.received(id);
      totalBytes += wanted.size ?? 0;
    }
    return outstanding === 0 ? { outstanding: 0, receivedBytes: 0, totalBytes: 0 } : { outstanding, receivedBytes, totalBytes };
  }

  setScene(scene: PlayerScene | null): void {
    if (this.disposed) return;
    const ids = sceneAssetIds(scene);
    const keep = new Set(ids);
    const cancelled: string[] = [];
    for (const [id, wanted] of [...this.wanted]) {
      if (keep.has(id)) continue;
      this.wanted.delete(id);
      this.assembler.drop(id);
      wanted.image?.release();
      if (wanted.phase === 'requested') cancelled.push(id);
    }
    this.sendIds('asset-cancel', cancelled);
    const added = ids.filter((id) => !this.wanted.has(id));
    if (added.length > 0) void this.lookUp(added);
    this.changed();
  }

  connected(send: (data: string) => void): void {
    this.send = send;
    this.restart();
    this.requestMissing();
    this.changed();
  }

  disconnected(): void {
    this.send = null;
    this.restart();
    this.changed();
  }

  receive(data: unknown): void {
    if (this.disposed || !this.send) return;
    const decoded = decodeAsset(data);
    if (decoded.kind === 'chunk') this.chunk(decoded.chunk);
    else if (decoded.kind === 'message') this.message(decoded.message);
  }

  dispose(): void {
    this.disposed = true;
    this.send = null;
    for (const wanted of this.wanted.values()) wanted.image?.release();
    this.wanted.clear();
    this.assembler.clear();
  }

  /** New images: from the cache when this device has them, the others requested together. */
  private async lookUp(ids: readonly string[]): Promise<void> {
    const entries = ids.map((id): [string, Wanted] => [id, { phase: 'checking', retried: false, size: null, image: null }]);
    for (const [id, wanted] of entries) this.wanted.set(id, wanted);
    const cached = await Promise.all(entries.map(([id]) => this.options.cache.get(id).catch(() => null)));
    entries.forEach(([id, wanted], index) => {
      const image = cached[index];
      if (!this.isCurrent(id, wanted)) return;
      if (!image) {
        wanted.phase = 'waiting';
        return;
      }
      void this.accept(id, wanted, image.bytes, image.mime, false).then((outcome) => {
        if (outcome === 'undecodable') this.refuse(id, wanted);
        else if (outcome === 'mismatch') this.retry(id, wanted);
      });
    });
    this.requestMissing();
    this.changed();
  }

  /** Checks bytes against their fingerprint, then decodes them; the GM's images are kept once they decode. */
  private async accept(id: string, wanted: Wanted, bytes: ArrayBuffer, mime: AssetMime, fromGm: boolean): Promise<Outcome> {
    wanted.phase = 'loading';
    const matches = await this.hash(bytes).then((hash) => hash === id, () => false);
    if (!this.isCurrent(id, wanted)) return 'gone';
    if (!matches) return 'mismatch';
    const decoded = await this.options.decode(bytes, mime).catch(() => null);
    if (!this.isCurrent(id, wanted)) {
      decoded?.release();
      return 'gone';
    }
    if (!decoded) return 'undecodable';
    wanted.image = decoded;
    wanted.phase = 'ready';
    if (fromGm) void this.options.cache.put({ id, mime, bytes }).catch(() => undefined);
    this.changed();
    return 'shown';
  }

  private message(message: AssetMessage): void {
    if (message.type === 'asset-start') this.started(message.id, message.handle, message.size, message.mime);
    else if (message.type === 'asset-end') this.ended(message.handle);
    else if (message.type === 'asset-denied') this.denied(message.id);
  }

  private started(id: string, handle: number, size: number, mime: AssetMime): void {
    const wanted = this.wanted.get(id);
    if (!wanted || wanted.phase !== 'requested') return;
    if (!this.assembler.start(id, handle, size, mime)) {
      this.failed(id, wanted);
      return;
    }
    wanted.size = size;
    this.changed();
  }

  private chunk(chunk: AssetChunk): void {
    const result = this.assembler.chunk(chunk);
    if (result.kind === 'overflow') {
      const wanted = this.wanted.get(result.id);
      if (wanted) this.failed(result.id, wanted);
    } else if (result.kind === 'added') {
      this.changed();
    }
  }

  private ended(handle: number): void {
    const ended = this.assembler.end(handle);
    const wanted = ended ? this.wanted.get(ended.id) : undefined;
    if (!ended || !wanted || wanted.phase !== 'requested') return;
    const { id, mime, bytes } = ended;
    if (!bytes) {
      this.failed(id, wanted);
      return;
    }
    this.doneBytes += bytes.byteLength;
    void this.accept(id, wanted, bytes, mime, true).then((outcome) => {
      if (outcome === 'mismatch') this.failed(id, wanted);
      else if (outcome === 'undecodable') this.refuse(id, wanted);
    });
    // `accept` moved it out of `requested`: a slot is free.
    this.requestMissing();
    this.changed();
  }

  private denied(id: string): void {
    const wanted = this.wanted.get(id);
    if (wanted?.phase === 'requested') this.refuse(id, wanted);
  }

  /** A transfer that broke its announcement or its fingerprint: cancelled, then asked for once more. */
  private failed(id: string, wanted: Wanted): void {
    if (!this.isCurrent(id, wanted)) return;
    this.assembler.drop(id);
    if (wanted.retried) {
      this.refuse(id, wanted);
      return;
    }
    // The GM may still be sending the broken transfer.
    this.sendIds('asset-cancel', [id]);
    this.retry(id, wanted);
  }

  private retry(id: string, wanted: Wanted): void {
    if (!this.isCurrent(id, wanted)) return;
    wanted.retried = true;
    wanted.phase = 'waiting';
    wanted.size = null;
    this.requestMissing();
    this.changed();
  }

  private refuse(id: string, wanted: Wanted): void {
    if (!this.isCurrent(id, wanted)) return;
    this.assembler.drop(id);
    wanted.phase = 'refused';
    wanted.size = null;
    this.requestMissing();
    this.changed();
  }

  /** A new link, or none: transfers of the old one are gone, and what was requested must be asked for again. */
  private restart(): void {
    this.assembler.clear();
    for (const wanted of this.wanted.values()) {
      if (wanted.phase !== 'requested') continue;
      wanted.phase = 'waiting';
      wanted.size = null;
    }
  }

  private requestMissing(): void {
    if (!this.send || this.disposed) return;
    let outstanding = 0;
    const waiting: Array<[string, Wanted]> = [];
    for (const entry of this.wanted) {
      if (entry[1].phase === 'requested') outstanding++;
      else if (entry[1].phase === 'waiting') waiting.push(entry);
    }
    const batch = waiting.slice(0, Math.max(0, ASSET_LIMITS.pendingPerPlayer - outstanding));
    for (const [, wanted] of batch) wanted.phase = 'requested';
    this.sendIds('asset-request', batch.map(([id]) => id));
  }

  private sendIds(type: 'asset-request' | 'asset-cancel', ids: readonly string[]): void {
    const send = this.send;
    if (!send) return;
    for (let start = 0; start < ids.length; start += ASSET_LIMITS.idsPerMessage) {
      send(encodeAsset({ v: 1, type, ids: ids.slice(start, start + ASSET_LIMITS.idsPerMessage) }));
    }
  }

  private isCurrent(id: string, wanted: Wanted): boolean {
    return !this.disposed && this.wanted.get(id) === wanted;
  }

  private changed(): void {
    if (this.progress().outstanding === 0) this.doneBytes = 0;
    this.options.onChange();
  }
}
```

(A cached image that fails its fingerprint goes through `retry`, which sets `retried`: the GM's copy then gets no second chance, which is the one retry the spec allows per image.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/online/assetLoader.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check, lint and check the size**

Run: `npx tsc --noEmit && npx eslint src/app/online/assets --max-warnings 0 && wc -l src/app/online/assets/AssetLoader.ts`
Expected: both checks exit 0; under 300 lines (about 290).

- [ ] **Step 6: Commit**

```bash
git add src/app/online/assets/AssetLoader.ts tests/unit/online/assetLoader.test.ts
git commit -m "feat(online): load, verify and decode images on the player side"
```

---

### Task 9: Starting the asset server with the session, and the end-to-end test

**Files:**
- Modify: `src/app/online/OnlineSessionService.ts` (create, start and stop the `AssetServer`)
- Modify: `tests/unit/online/onlineSessionService.test.ts` (`service()` helper, one test)
- Test: `tests/unit/online/assetStreamingEndToEnd.test.ts`

**Interfaces:**
- Consumes: Task 3 (`AssetRegistry`, `ImageFiles`, `Deps.images`), Task 5 (`SceneBroadcaster.onProjection`), Task 6 (`AssetServer`), Task 7 (`AssetCache`, `MemoryStore`), Task 8 (`AssetLoader`, `DecodedImage`), Task 4 (`PlayerSessionOptions.assets`), Task 1 (`MemoryLink.hold` / `flush` / `release`).
- Produces: `OnlineSessionService` runs one `AssetServer` per hosted session, started after the broadcaster and stopped before it.

- [ ] **Step 1: Write the failing service test**

In `tests/unit/online/onlineSessionService.test.ts`, add the imports

```ts
import { decodeAsset, encodeAsset } from '../../../src/app/online/assets/assetProtocol';
import type { ImageFiles } from '../../../src/app/online/scene/AssetRegistry';
import { fingerprintOf } from './assetFixtures';
```

change the `service` helper's signature and dependencies to

```ts
function service(network = new MemoryNetwork(), presented = new PresentedScene(), images?: ImageFiles) {
  const host = network.host('gm-id');
  const notices: Array<{ name: string; answer: (allow: boolean) => void; hidden: boolean }> = [];
  const svc = new OnlineSessionService(app, settings, {
    createHost: async () => host,
    presented,
    ...(images ? { images } : {}),
    showRequest: (player, answer) => {
      const notice = { name: player.name, answer, hidden: false };
      notices.push(notice);
      return { hide: () => { notice.hidden = true; } };
    },
  });
  return { svc, notices, network, host };
}
```

and append inside `describe('OnlineSessionService', …)`:

```ts
  it('serves the presented scene\'s images to the players it admitted', async () => {
    const map = new TextEncoder().encode('map image bytes');
    const images: ImageFiles = {
      stat: (path) => (path === 'maps/cave.png' ? { size: map.byteLength, mtime: 1 } : null),
      read: async () => map.slice().buffer,
    };
    const presented = new PresentedScene();
    const tabs = createTabMetaStore();
    const tabId = tabs.getState().addTab('maps/cave.atlasmap', 'Cave');
    const store = createStore(() => ({
      background: 'maps/cave.png', grid: null, isMapLoading: false, widgetValues: {}, initiativeTrackerOpen: false,
      initiative: createDefaultInitiativeState(),
      widgetSettings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 },
      objects: { tokens: {}, fog: {}, pins: {}, texts: {}, drawings: {}, walls: {}, lights: {}, audios: {} },
    }));
    presented.present({ tabMetaStore: tabs, atlasStore: store, register: () => {} } as never, tabId);
    const { svc, notices, network } = service(new MemoryNetwork(), presented, images);
    await svc.start();
    const link = await network.client().connect('gm-id');
    let mapAsset: string | null = null;
    const assetKinds: string[] = [];
    link.onMessage((channel, data) => {
      if (channel === 'assets') {
        const decoded = decodeAsset(data);
        assetKinds.push(decoded.kind === 'message' ? decoded.message.type : decoded.kind);
        return;
      }
      const decoded = decodeControl(data);
      if (decoded.kind !== 'message') return;
      if (decoded.message.type === 'scene-snapshot') mapAsset = decoded.message.scene.map.asset;
      if (decoded.message.type === 'scene-patch' && decoded.message.set.map) mapAsset = decoded.message.set.map.asset;
    });
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Anna', playerKey: 'k', client: { kind: 'web', version: '1' } }));
    notices[0]!.answer(true);

    const id = fingerprintOf(map);
    await vi.waitFor(() => expect(mapAsset).toBe(id));
    link.send('assets', encodeAsset({ v: 1, type: 'asset-request', ids: [id] }));
    await vi.waitFor(() => expect(assetKinds).toEqual(['asset-start', 'chunk', 'asset-end']));
    svc.stop();
    presented.clear();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/online/onlineSessionService.test.ts`
Expected: FAIL — the new test times out waiting for `asset-start` (nothing answers on the assets channel).

- [ ] **Step 3: Start the asset server with the session**

In `src/app/online/OnlineSessionService.ts`:

1. Add `import { AssetServer } from './assets/AssetServer';` and the field `private assetServer: AssetServer | null = null;`.

2. In `host()`, after the `SceneBroadcaster` is constructed and before `this.broadcaster = broadcaster;`, add:

```ts
    // Serves the images of the scene players have, over each player's assets channel.
    const assetServer = new AssetServer({ session, projection: broadcaster, files: registry });
    this.assetServer = assetServer;
```

   and in the `try` block, after `broadcaster.start();`, add `assetServer.start();`.

3. In `teardown()`, before `this.broadcaster?.stop();`, add:

```ts
    this.assetServer?.stop();
    this.assetServer = null;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/unit/online/onlineSessionService.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the end-to-end test**

Create `tests/unit/online/assetStreamingEndToEnd.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { AssetCache, type ImageStore } from '../../../src/app/online/assets/AssetCache';
import { ASSET_LIMITS } from '../../../src/app/online/assets/assetIds';
import { AssetLoader, type DecodedImage } from '../../../src/app/online/assets/AssetLoader';
import { decodeAsset, type AssetMessage } from '../../../src/app/online/assets/assetProtocol';
import { AssetServer } from '../../../src/app/online/assets/AssetServer';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession } from '../../../src/app/online/PlayerSession';
import { AssetRegistry } from '../../../src/app/online/scene/AssetRegistry';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { SCENE_TICK_MS, SceneBroadcaster } from '../../../src/app/online/scene/SceneBroadcaster';
import { MemoryNetwork, type MemoryLink } from '../../../src/app/online/transport/MemoryTransport';
import type { ClientTransport, PeerLink } from '../../../src/app/online/transport/types';
import { PresentedScene, type PresentedView } from '../../../src/app/services/PresentedScene';
import type { ViewAtlasState } from '../../../src/app/storeFactory';
import { createTabMetaStore } from '../../../src/app/stores/tabMetaStore';
import { createDefaultInitiativeState } from '../../../src/app/types/initiativeTypes';
import { fingerprintOf, imageBytes, memoryImageFiles, MemoryStore, nodeHash, type MemoryImageFiles } from './assetFixtures';

type SceneState = Pick<ViewAtlasState,
  'background' | 'grid' | 'objects' | 'widgetSettings' | 'widgetValues' | 'initiative' | 'initiativeTrackerOpen' | 'isMapLoading'
>;
type Objects = SceneState['objects'];

const MB = 1024 * 1024;
const RULES: PlayerViewRules = {
  showGrid: true, showTokenHP: false, showTokenStress: false, showTokenNameplates: false, showWidgets: true, showInitiative: true,
};
const MAP = imageBytes(300_000, 1);
const HERO = imageBytes(1000, 2);
const GOBLIN = imageBytes(1000, 3);
/** Two tokens share the hero's art; the goblin is completely under fog. */
const TAVERN = {
  hero: { x: 140, y: 140, imagePath: 'art/hero.png' },
  twin: { x: 300, y: 140, imagePath: 'art/hero.png' },
  goblin: { x: 1050, y: 1050, imagePath: 'art/goblin.png' },
};

function objects(tokens: Record<string, { x: number; y: number; imagePath: string }>): Objects {
  const records = Object.fromEntries(Object.entries(tokens).map(([id, token]) => [id, { id, kind: 'token', ...token }]));
  return {
    tokens: records as unknown as Objects['tokens'],
    fog: { f1: { id: 'f1', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: 900, y: 900, width: 400, height: 400 } },
    pins: {}, texts: {}, drawings: {}, walls: {}, lights: {}, audios: {},
  } as Objects;
}

function sceneState(background: string, sceneObjects: Objects): SceneState {
  return {
    background,
    grid: { enabled: true, visible: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5 },
    objects: sceneObjects,
    widgetSettings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 },
    widgetValues: {},
    initiative: createDefaultInitiativeState(),
    initiativeTrackerOpen: false,
    isMapLoading: false,
  };
}

function patchToken(store: StoreApi<SceneState>, id: string, patch: object): void {
  store.setState((state) => ({ objects: { ...state.objects, tokens: { ...state.objects.tokens, [id]: { ...state.objects.tokens[id]!, ...patch } } } }));
}

/** Decoding without a canvas: the "image" holds the bytes, so tests compare them with the GM's file. */
async function decode(bytes: ArrayBuffer): Promise<DecodedImage> {
  return { image: { bytes: new Uint8Array(bytes) } as unknown as ImageBitmap, width: 1, height: 1, release: () => {} };
}

function shown(loader: AssetLoader, id: string | null | undefined): Uint8Array | null {
  const image = id ? loader.image(id)?.image : undefined;
  return image ? (image as unknown as { bytes: Uint8Array }).bytes : null;
}

interface Player {
  session: PlayerSession;
  loader: AssetLoader;
  cache: AssetCache;
}

/** A real GM session, broadcaster, registry and asset server, and players with loaders, over an in-memory network. */
function world(files: MemoryImageFiles, tokens = objects(TAVERN)) {
  const network = new MemoryNetwork();
  const host = network.host('gm');
  const gmEnds: MemoryLink[] = [];
  host.onConnection((link) => gmEnds.push(link as MemoryLink));
  const requests: SessionPlayer[] = [];
  const gm = new GmSession(host, {
    title: 'Vault', onJoinRequest: (player) => requests.push(player), onRequestClosed: () => {}, onPlayersChanged: () => {},
  });
  gm.start();
  const settings = { getLocalPlayerViewSettings: (): PlayerViewRules => RULES, onChange: (): (() => void) => () => {} };
  const notices: string[] = [];
  const registry = new AssetRegistry({ files: files.source, notify: (message) => notices.push(message), hash: nodeHash });
  const presented = new PresentedScene();
  const broadcaster = new SceneBroadcaster({ session: gm, presented, settings, assets: registry, notify: (message) => notices.push(message) });
  const server = new AssetServer({ session: gm, projection: broadcaster, files: registry });
  broadcaster.start();
  server.start();

  const tabs = createTabMetaStore();
  const store = createStore<SceneState>(() => sceneState('maps/tavern.png', tokens));
  const tavern = tabs.getState().addTab('maps/tavern.atlasmap', 'Tavern');
  tabs.getState().setActiveTab(tavern);
  const view = {
    tabMetaStore: tabs,
    atlasStore: store as unknown as StoreApi<ViewAtlasState>,
    register: () => {},
    renderer: { getBackgroundSprite: () => ({ width: 2000, height: 1500, destroyed: false }) },
  } as unknown as PresentedView;

  /** Every asset text message, either way, and every binary byte that reached a player. */
  const assetText: string[] = [];
  let binaryBytes = 0;
  const players: Player[] = [];
  const join = async (playerKey: string, device: ImageStore = new MemoryStore()): Promise<Player> => {
    const before = requests.length;
    const cache = new AssetCache({ keep: true, openStore: async () => device });
    const loader = new AssetLoader({ cache, decode, hash: nodeHash, onChange: () => {} });
    const inner = network.client();
    const transport: ClientTransport = {
      connect: async (hostId: string): Promise<PeerLink> => {
        const link = await inner.connect(hostId);
        const send = link.send.bind(link);
        link.send = (channel, data): void => {
          if (channel === 'assets' && typeof data === 'string') assetText.push(data);
          send(channel, data);
        };
        link.onMessage((channel, data) => {
          if (channel !== 'assets') return;
          if (typeof data === 'string') assetText.push(data);
          else binaryBytes += (data as ArrayBuffer).byteLength;
        });
        return link;
      },
    };
    const session = new PlayerSession({
      hostId: 'gm', name: playerKey, playerKey, clientVersion: '1', transport, onChange: () => {},
      assets: loader, onScene: (scene) => loader.setScene(scene),
    });
    session.start();
    await vi.advanceTimersByTimeAsync(0);
    if (requests.length > before) gm.allow(requests.at(-1)!.playerId);
    const player = { session, loader, cache };
    players.push(player);
    return player;
  };
  const messages = (): AssetMessage[] => assetText.flatMap((text) => {
    const decoded = decodeAsset(text);
    return decoded.kind === 'message' ? [decoded.message] : [];
  });
  return {
    presented, store, view, tavern, gmEnds, join, messages, assetText,
    binaryBytes: (): number => binaryBytes,
    requested: (): string[] => messages().flatMap((message) => (message.type === 'asset-request' ? message.ids : [])),
    started: (): string[] => messages().flatMap((message) => (message.type === 'asset-start' ? [message.id] : [])),
    /** Lets hashing, the 50 ms ticks, reads, transfers and decoding all happen. */
    run: async (): Promise<void> => { for (let round = 0; round < 4; round++) await vi.advanceTimersByTimeAsync(SCENE_TICK_MS + 5); },
    finish(): void {
      players.forEach((player) => player.session.stop());
      server.stop();
      broadcaster.stop();
      registry.dispose();
      gm.stop();
    },
  };
}

describe('asset streaming end to end', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('gives a player the GM\'s bytes, one transfer per image, and never a path', async () => {
    const files = memoryImageFiles({ 'maps/tavern.png': MAP, 'art/hero.png': HERO, 'art/goblin.png': GOBLIN });
    const w = world(files);
    const anna = await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await w.run();
    const scene = anna.session.scene!;
    expect(scene.map.asset).toBe(fingerprintOf(MAP));
    expect(scene.tokens.twin?.image).toBe(scene.tokens.hero?.image);
    expect(shown(anna.loader, scene.map.asset)).toEqual(MAP);
    expect(shown(anna.loader, scene.tokens.hero?.image)).toEqual(HERO);
    expect(w.started()).toEqual([fingerprintOf(MAP), fingerprintOf(HERO)]);
    expect(files.reads).not.toContain('art/goblin.png'); // under fog: never projected, never read
    expect(anna.loader.progress().outstanding).toBe(0);
    expect(w.assetText.join('\n')).not.toMatch(/art\/|maps\/|\.png/);
    w.finish();
  });

  it('lets a returning player with kept images request nothing', async () => {
    const w = world(memoryImageFiles({ 'maps/tavern.png': MAP, 'art/hero.png': HERO }));
    const device = new MemoryStore();
    const first = await w.join('anna', device);
    w.presented.present(w.view, w.tavern);
    await w.run();
    expect(first.cache.state.usedBytes).toBe(MAP.byteLength + HERO.byteLength);
    first.session.stop();

    const requestedBefore = w.requested().length;
    const again = await w.join('anna', device); // the same browser, a new visit
    await w.run();
    expect(w.requested()).toHaveLength(requestedBefore);
    expect(shown(again.loader, fingerprintOf(MAP))).toEqual(MAP);
    expect(shown(again.loader, fingerprintOf(HERO))).toEqual(HERO);
    w.finish();
  });

  it('recovers from a disconnect in the middle of a transfer, and scene updates keep flowing', async () => {
    const bigMap = imageBytes(3 * MB, 4);
    const w = world(memoryImageFiles({ 'maps/tavern.png': bigMap, 'art/hero.png': HERO }));
    const anna = await w.join('anna');
    const gmEnd = w.gmEnds.at(-1)!;
    gmEnd.hold('assets');
    w.presented.present(w.view, w.tavern);
    await w.run();
    expect(gmEnd.bufferedAmount('assets')).toBeGreaterThanOrEqual(ASSET_LIMITS.highWaterBytes);

    // Token moves are not held up behind the image.
    patchToken(w.store, 'hero', { x: 320 });
    await w.run();
    expect(anna.session.scene?.tokens.hero?.x).toBe(320);

    gmEnd.flush('assets', 512 * 1024); // part of the map arrives
    expect(anna.loader.progress().receivedBytes).toBeGreaterThan(0);
    expect(anna.loader.progress().totalBytes).toBe(3 * MB);

    (anna.session as unknown as { link: PeerLink }).link.close();
    expect(anna.loader.progress().receivedBytes).toBe(0);
    await vi.advanceTimersByTimeAsync(1000); // the player reconnects on its own
    await w.run();
    expect(shown(anna.loader, fingerprintOf(bigMap))).toEqual(bigMap);
    expect(shown(anna.loader, fingerprintOf(HERO))).toEqual(HERO);
    expect(anna.loader.progress().outstanding).toBe(0);
    w.finish();
  });

  it('stops the transfer of an image that leaves the scene', async () => {
    const mapBytes = imageBytes(1000, 6);
    const dragon = imageBytes(3 * MB, 5);
    const w = world(
      memoryImageFiles({ 'maps/tavern.png': mapBytes, 'art/dragon.png': dragon }),
      objects({ dragon: { x: 140, y: 140, imagePath: 'art/dragon.png' } }),
    );
    const anna = await w.join('anna');
    const gmEnd = w.gmEnds.at(-1)!;
    gmEnd.hold('assets');
    w.presented.present(w.view, w.tavern);
    await w.run();
    gmEnd.flush('assets', 600 * 1024); // the small map and part of the dragon arrive
    await w.run();
    expect(shown(anna.loader, fingerprintOf(mapBytes))).toEqual(mapBytes);
    expect(anna.loader.progress().receivedBytes).toBeGreaterThan(0);

    w.store.setState((state) => ({ objects: { ...state.objects, tokens: {} } })); // the GM deletes the dragon
    await w.run();
    gmEnd.release('assets');
    await w.run();
    expect(w.binaryBytes()).toBeLessThan(1.5 * MB);
    const denied = w.messages().flatMap((message) => (message.type === 'asset-denied' ? [message.id] : []));
    expect(denied).toEqual([fingerprintOf(dragon)]);
    expect(anna.loader.progress()).toEqual({ outstanding: 0, receivedBytes: 0, totalBytes: 0 });
    expect(gmEnd.bufferedAmount('assets')).toBe(0);
    w.finish();
  });

  it('an image edited during the session reaches players as its new version', async () => {
    const files = memoryImageFiles({ 'maps/tavern.png': MAP, 'art/hero.png': HERO });
    const w = world(files);
    const anna = await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await w.run();
    const oldId = fingerprintOf(HERO);
    expect(shown(anna.loader, oldId)).toEqual(HERO);

    const edited = imageBytes(1000, 9);
    files.set('art/hero.png', edited, 2); // the GM repainted the hero
    const ben = await w.join('ben'); // asks for the image as it was: the GM finds it changed
    await w.run();
    const newId = fingerprintOf(edited);
    expect(anna.session.scene?.tokens.hero?.image).toBe(newId);
    expect(shown(anna.loader, newId)).toEqual(edited);
    expect(shown(ben.loader, newId)).toEqual(edited);
    expect(shown(anna.loader, oldId)).toBeNull();
    expect(w.messages()).toContainEqual({ v: 1, type: 'asset-denied', id: oldId });
    w.finish();
  });
});
```

- [ ] **Step 6: Run the end-to-end test**

Run: `npx vitest run tests/unit/online/assetStreamingEndToEnd.test.ts`
Expected: PASS. (Every piece exists already; a failure here is a bug in Tasks 1–8, found by `superpowers:systematic-debugging`, fixed in the task's module and noted in the commit.)

- [ ] **Step 7: Run every online test, type-check and lint**

Run: `npx vitest run tests/unit/online && npx tsc --noEmit && npx eslint src/app/online --max-warnings 0`
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/app/online/OnlineSessionService.ts tests/unit/online/onlineSessionService.test.ts tests/unit/online/assetStreamingEndToEnd.test.ts
git commit -m "feat(online): serve images with the hosted session; end-to-end test"
```

---

### Task 10: Join page: images in the preview, the loading bar and the keep switch

**Files:**
- Modify: `src/app/online/preview/previewShapes.ts:55-63,147-158` (`TokenMarker.image`)
- Create: `src/app/online/preview/assetStatus.ts`
- Create: `online-client/imageDecoder.mts`, `online-client/assetsPanel.mts`
- Modify: `online-client/preview.mts`, `online-client/main.mts`, `online-client/index.html`, `online-client/style.css`
- Test: `tests/unit/online/assetStatus.test.ts`, `tests/unit/online/scenePreview.test.ts:94-97`

**Interfaces:**
- Consumes: Task 7 (`AssetCache`, `AssetCacheState`, `openIndexedDbImageStore`), Task 8 (`AssetLoader`, `DecodedImage`, `AssetProgress`), Task 4 (`PlayerSessionOptions.assets`), Task 2 (`AssetMime`).
- Produces:
  - `TokenMarker.image: string | null` (the token's asset id).
  - `assetStatus.ts`: `progressText(progress: AssetProgress): string | null`, `keepImagesText(state: AssetCacheState): string`, `clearImagesText(usedBytes: number): string`.
  - `online-client/imageDecoder.mts`: `decodeImage(bytes: ArrayBuffer, mime: AssetMime): Promise<DecodedImage | null>`.
  - `online-client/assetsPanel.mts`: `rememberedKeep(): boolean`, `class AssetsPanel { constructor(cache: AssetCache); showProgress(progress: AssetProgress): void }`.
  - `online-client/preview.mts`: `type ImageLookup = (id: string | null) => DecodedImage | null`, `new ScenePreview(canvas, images: ImageLookup)`, `refresh(): void`.

Rules (spec, "Preview" and "AssetCache"; plan decision 17): the map image is drawn at `(0, 0)` with the map's size, after the map colour and before grid, ink, labels, tokens and fog; token art is drawn cover-fit and clipped to the circle, then the ring in the marker colour, initials and HP bar; a missing image draws today's marker; fog last. The bar shows while images are outstanding. The switch is on by default and remembered in `localStorage` (`atlas-online:keep-images`, `on`/`off`, wrapped in try/catch); switching it off deletes the stored images; the clear button shows the space used and is disabled at 0; with storage unavailable the switch is disabled and reads "Can't save on this device". All text through `textContent`; images are only drawn (`drawImage`), never inserted as markup.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/online/assetStatus.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clearImagesText, keepImagesText, progressText } from '../../../src/app/online/preview/assetStatus';

const MB = 1024 * 1024;

describe('asset status texts', () => {
  it('shows the loading bar only while images are outstanding, in MB with one decimal', () => {
    expect(progressText({ outstanding: 0, receivedBytes: 0, totalBytes: 0 })).toBeNull();
    expect(progressText({ outstanding: 2, receivedBytes: 0, totalBytes: 0 })).toBe('Loading images…');
    expect(progressText({ outstanding: 2, receivedBytes: 3.2 * MB, totalBytes: 5.1 * MB })).toBe('Loading images… 3.2 of 5.1 MB');
    expect(progressText({ outstanding: 1, receivedBytes: 1000, totalBytes: 150_000 })).toBe('Loading images… 0.0 of 0.1 MB');
  });

  it('names the switch and the clear button', () => {
    expect(keepImagesText({ keep: true, available: true, usedBytes: 0 })).toBe('Keep images on this device');
    expect(keepImagesText({ keep: false, available: true, usedBytes: 0 })).toBe('Keep images on this device');
    expect(keepImagesText({ keep: true, available: false, usedBytes: 0 })).toBe("Can't save on this device");
    expect(clearImagesText(0)).toBe('Clear saved images');
    expect(clearImagesText(12.34 * MB)).toBe('Clear saved images (12.3 MB)');
  });
});
```

In `tests/unit/online/scenePreview.test.ts`, the token markers now carry their image (the fixture's tokens show `asset-1`); replace the expectation at lines 94–97 with:

```ts
    expect(tokenMarkers(scene)).toEqual([
      { x: 100, y: 100, radius: 94.5, color: '#9aa0a6', label: null, hp: null, image: 'asset-1' },
      { x: 100, y: 100, radius: 31.5, color: '#ff0000', label: 'AB', hp: 0.5, image: 'asset-1' },
    ]);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/online/assetStatus.test.ts tests/unit/online/scenePreview.test.ts`
Expected: FAIL — `assetStatus` cannot be resolved; the markers have no `image`.

- [ ] **Step 3: Give markers their image and write the texts**

In `src/app/online/preview/previewShapes.ts`, add to `TokenMarker` after `hp`:

```ts
  /** The token's image as an asset id; the preview draws it once it is loaded. */
  image: string | null;
```

and in `tokenMarkers`, add `image: token.image,` after the `hp:` line of the mapped object.

Create `src/app/online/preview/assetStatus.ts`:

```ts
/**
 * The join page's image texts. Shared with the web player page, so it imports
 * only types. One MB is 1024 × 1024 bytes, shown with one decimal.
 */
import type { AssetCacheState } from '../assets/AssetCache';
import type { AssetProgress } from '../assets/AssetLoader';

const MB = 1024 * 1024;

function megabytes(bytes: number): string {
  return (bytes / MB).toFixed(1);
}

/** The loading bar's text; null when nothing is outstanding, and the bar hides. */
export function progressText(progress: AssetProgress): string | null {
  if (progress.outstanding === 0) return null;
  if (progress.totalBytes === 0) return 'Loading images…';
  return `Loading images… ${megabytes(progress.receivedBytes)} of ${megabytes(progress.totalBytes)} MB`;
}

/** The switch's label: what it does, or why it cannot. */
export function keepImagesText(state: AssetCacheState): string {
  return state.available ? 'Keep images on this device' : "Can't save on this device";
}

/** The clear button, with the space the kept images use. */
export function clearImagesText(usedBytes: number): string {
  return usedBytes > 0 ? `Clear saved images (${megabytes(usedBytes)} MB)` : 'Clear saved images';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/online/assetStatus.test.ts tests/unit/online/scenePreview.test.ts`
Expected: PASS.

- [ ] **Step 5: Decode images for the page**

Create `online-client/imageDecoder.mts`:

```ts
// online-client/imageDecoder.mts
/**
 * Turns image bytes into something the preview can draw. SVG goes through an
 * `<img>` (not every browser decodes SVG in `createImageBitmap`), which never
 * runs its scripts; the page never inserts an image's markup.
 */
import type { AssetMime } from '../src/app/online/assets/assetIds';
import type { DecodedImage } from '../src/app/online/assets/AssetLoader';

async function viaImageElement(blob: Blob): Promise<DecodedImage | null> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
  return { image, width: image.naturalWidth || 1, height: image.naturalHeight || 1, release: () => URL.revokeObjectURL(url) };
}

export async function decodeImage(bytes: ArrayBuffer, mime: AssetMime): Promise<DecodedImage | null> {
  const blob = new Blob([bytes], { type: mime });
  if (mime === 'image/svg+xml' || typeof createImageBitmap !== 'function') return viaImageElement(blob);
  try {
    const bitmap = await createImageBitmap(blob);
    return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Write the image controls**

Create `online-client/assetsPanel.mts`:

```ts
// online-client/assetsPanel.mts
/**
 * The join page's image controls: the loading bar above the preview, and the
 * "Keep images on this device" switch and "Clear saved images" button under
 * it. Text goes through `textContent` only.
 */
import type { AssetCache, AssetCacheState } from '../src/app/online/assets/AssetCache';
import type { AssetProgress } from '../src/app/online/assets/AssetLoader';
import { clearImagesText, keepImagesText, progressText } from '../src/app/online/preview/assetStatus';

const KEEP_KEY = 'atlas-online:keep-images';

/** The remembered switch: on unless the player turned it off. localStorage can throw in private windows. */
export function rememberedKeep(): boolean {
  try {
    return localStorage.getItem(KEEP_KEY) !== 'off';
  } catch {
    return true;
  }
}

function rememberKeep(keep: boolean): void {
  try {
    localStorage.setItem(KEEP_KEY, keep ? 'on' : 'off');
  } catch {
    // Private window: the switch still works for this visit.
  }
}

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export class AssetsPanel {
  private readonly progress = element<HTMLElement>('image-progress');
  private readonly bar = element<HTMLProgressElement>('image-progress-bar');
  private readonly progressLabel = element<HTMLElement>('image-progress-text');
  private readonly keep = element<HTMLInputElement>('keep-images');
  private readonly keepLabel = element<HTMLElement>('keep-images-label');
  private readonly clear = element<HTMLButtonElement>('clear-images');

  constructor(cache: AssetCache) {
    this.keep.addEventListener('change', () => {
      rememberKeep(this.keep.checked);
      void cache.setKeep(this.keep.checked);
    });
    this.clear.addEventListener('click', () => { void cache.clearSaved(); });
    cache.onChange((state) => this.showCache(state));
    this.showCache(cache.state);
  }

  showProgress(progress: AssetProgress): void {
    const text = progressText(progress);
    this.progress.hidden = text === null;
    this.progressLabel.textContent = text ?? '';
    if (progress.totalBytes > 0) {
      this.bar.max = progress.totalBytes;
      this.bar.value = Math.min(progress.receivedBytes, progress.totalBytes);
    } else {
      this.bar.removeAttribute('value'); // no size yet: an indeterminate bar
    }
  }

  private showCache(state: AssetCacheState): void {
    this.keep.disabled = !state.available;
    this.keep.checked = state.available && state.keep;
    this.keepLabel.textContent = keepImagesText(state);
    this.clear.textContent = clearImagesText(state.usedBytes);
    this.clear.disabled = state.usedBytes === 0;
  }
}
```

- [ ] **Step 7: Draw the images in the preview**

In `online-client/preview.mts`:

1. Add the import and the lookup type after the existing imports:

```ts
import type { DecodedImage } from '../src/app/online/assets/AssetLoader';

/** The loaded image for an asset id, or null while it is missing. */
export type ImageLookup = (id: string | null) => DecodedImage | null;
```

2. Replace the constructor and add `refresh` after `show`:

```ts
  constructor(private readonly canvas: HTMLCanvasElement, private readonly images: ImageLookup) {
    if (typeof ResizeObserver === 'undefined') window.addEventListener('resize', () => this.request());
    else new ResizeObserver(() => this.request()).observe(canvas);
  }
```

```ts
  /** Images arrived or went: draw again. */
  refresh(): void {
    this.request();
  }
```

3. In `draw()`, replace the lines from `context.fillRect(world.x, world.y, world.width, world.height);` to `drawTokens(context, scene, pixel);` with:

```ts
    context.fillRect(world.x, world.y, world.width, world.height);
    drawMapImage(context, scene, this.images(scene.map.asset));
    if (scene.grid) drawGrid(context, gridLines(scene.grid, world), pixel);
    drawInk(context, scene);
    drawLabels(context, scene);
    drawTokens(context, scene, pixel, this.images);
```

4. Replace `drawTokens` with the following three functions:

```ts
/** The map image at the map's size, under the grid and fog; nothing until it is loaded or while the size is unknown. */
function drawMapImage(context: CanvasRenderingContext2D, scene: PlayerScene, art: DecodedImage | null): void {
  if (!art || scene.map.width <= 0 || scene.map.height <= 0) return;
  context.drawImage(art.image, 0, 0, scene.map.width, scene.map.height);
}

/** Fills a square with an image, cropped so it keeps its proportions. */
function drawCover(context: CanvasRenderingContext2D, art: DecodedImage, left: number, top: number, size: number): void {
  const scale = Math.max(size / art.width, size / art.height);
  const width = art.width * scale;
  const height = art.height * scale;
  context.drawImage(art.image, left + (size - width) / 2, top + (size - height) / 2, width, height);
}

function drawTokens(context: CanvasRenderingContext2D, scene: PlayerScene, pixel: number, images: ImageLookup): void {
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const marker of tokenMarkers(scene)) {
    const art = images(marker.image);
    context.beginPath();
    context.arc(marker.x, marker.y, marker.radius, 0, Math.PI * 2);
    if (art) {
      // The art clipped to the token's circle (the path survives `restore`), then its ring.
      context.save();
      context.clip();
      drawCover(context, art, marker.x - marker.radius, marker.y - marker.radius, marker.radius * 2);
      context.restore();
      context.strokeStyle = marker.color;
      context.lineWidth = 3 * pixel;
    } else {
      context.fillStyle = marker.color;
      context.fill();
      context.strokeStyle = LABEL_COLOR;
      context.lineWidth = 2 * pixel;
    }
    context.stroke();
    if (marker.label) {
      context.fillStyle = LABEL_COLOR;
      context.font = `600 ${marker.radius * 0.8}px system-ui, sans-serif`;
      context.fillText(marker.label, marker.x, marker.y);
    }
    if (marker.hp !== null) {
      const barWidth = marker.radius * 2;
      const barHeight = marker.radius * 0.25;
      const top = marker.y + marker.radius * 1.15;
      context.fillStyle = HP_BACK;
      context.fillRect(marker.x - marker.radius, top, barWidth, barHeight);
      context.fillStyle = HP_FILL;
      context.fillRect(marker.x - marker.radius, top, barWidth * marker.hp, barHeight);
    }
  }
  context.restore();
}
```

- [ ] **Step 8: Wire the loader, cache and panel into the page**

Replace `online-client/main.mts` with:

```ts
// online-client/main.mts
import { AssetCache } from '../src/app/online/assets/AssetCache';
import { AssetLoader } from '../src/app/online/assets/AssetLoader';
import { openIndexedDbImageStore } from '../src/app/online/assets/indexedDbImageStore';
import { PlayerSession, type PlayerSessionState } from '../src/app/online/PlayerSession';
import { createPeerClient } from '../src/app/online/transport/PeerTransport';
import { parseJoinFragment } from '../src/app/online/joinLink';
import { normalizePlayerName } from '../src/app/online/protocol';
import { randomId } from '../src/app/online/ids';
import { initiativeLines, widgetLines } from '../src/app/online/preview/sceneSummary';
import type { PlayerScene } from '../src/app/online/scene/sceneTypes';
import { AssetsPanel, rememberedKeep } from './assetsPanel.mts';
import { decodeImage } from './imageDecoder.mts';
import { ScenePreview } from './preview.mts';

const VERSION = '0.1.0';
const form = document.getElementById('join') as HTMLFormElement;
const nameInput = document.getElementById('name') as HTMLInputElement;
const status = document.getElementById('status') as HTMLParagraphElement;
const playerList = document.getElementById('players') as HTMLUListElement;
const sceneSection = document.getElementById('scene') as HTMLElement;
const widgetList = document.getElementById('widgets') as HTMLUListElement;
const initiativeList = document.getElementById('initiative') as HTMLOListElement;
const cache = new AssetCache({ keep: rememberedKeep(), openStore: openIndexedDbImageStore });
const panel = new AssetsPanel(cache);
const preview = new ScenePreview(document.getElementById('preview') as HTMLCanvasElement, (id) => loader.image(id));
let assetsFrame: number | null = null;
const loader = new AssetLoader({
  cache,
  decode: decodeImage,
  // Chunks arrive many times a second: the bar and the preview update at most once per frame.
  onChange: () => {
    if (assetsFrame !== null) return;
    assetsFrame = window.requestAnimationFrame(() => {
      assetsFrame = null;
      panel.showProgress(loader.progress());
      preview.refresh();
    });
  },
});
let sessionState: PlayerSessionState | null = null;
let scene: PlayerScene | null = null;

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

const REASONS: Record<string, string> = {
  denied: 'The GM did not let you in.',
  kicked: 'The GM removed you from the session.',
  full: 'The session is full.',
  version: 'This page is out of date for your GM\'s Atlas. Ask them for a new link.',
  ended: 'The session ended.',
  replaced: 'You joined from another tab.',
  unreachable: 'Couldn\'t connect. Check the link, or your GM may need to add a relay server in Atlas settings.',
  'connection-lost': 'Lost the connection to your GM. Reload the page to try again.',
};

function render(state: PlayerSessionState): void {
  sessionState = state;
  const text: Record<PlayerSessionState['status'], string> = {
    connecting: 'Connecting…',
    waiting: 'Waiting for the GM to let you in…',
    admitted: scene
      ? `Connected to ${state.title ?? 'the table'}.`
      : `Connected to ${state.title ?? 'the table'}. Waiting for the GM to show a scene.`,
    denied: REASONS[state.reason ?? 'denied'] ?? REASONS.denied!,
    lost: REASONS[state.reason ?? 'unreachable'] ?? REASONS.unreachable!,
  };
  status.textContent = text[state.status];
  playerList.hidden = state.status !== 'admitted';
  playerList.replaceChildren(...state.players.map((player) => {
    const item = document.createElement('li');
    item.textContent = player.connected ? player.name : `${player.name} (away)`;
    return item;
  }));
  renderScene();
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

/** The preview and the widget and initiative lists, shown only while admitted with a scene. */
function renderScene(): void {
  const shown = sessionState?.status === 'admitted' ? scene : null;
  sceneSection.hidden = shown === null;
  preview.show(shown);
  fillList(widgetList, shown ? widgetLines(shown.widgets) : []);
  fillList(initiativeList, shown ? initiativeLines(shown.initiative) : []);
  // Read-only, for checking in the developer tools what this page received.
  (window as unknown as { atlasScene: PlayerScene | null }).atlasScene = shown;
}

const target = parseJoinFragment(location.hash);
if (!target) {
  status.textContent = 'This link is incomplete. Ask your GM for the join link again.';
} else {
  form.hidden = false;
  nameInput.value = stored('atlas-online:name', () => '');
  let started = false;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (started) return;
    const name = normalizePlayerName(nameInput.value);
    if (!name) {
      status.textContent = 'Enter a name of up to 40 characters.';
      return;
    }
    try { localStorage.setItem('atlas-online:name', name); } catch { /* private window */ }
    started = true;
    form.hidden = true;
    new PlayerSession({
      hostId: target.hostId,
      name,
      // One key per GM session, so different GMs cannot recognise or pose as the same player.
      playerKey: stored(`atlas-online:player-key:${target.hostId}`, () => randomId()),
      clientVersion: VERSION,
      transport: createPeerClient(target.server),
      onChange: render,
      onScene: (next) => {
        scene = next;
        loader.setScene(next);
        if (sessionState) render(sessionState);
      },
      assets: loader,
    }).start();
  });
}
```

(The preview's image lookup refers to `loader`, declared just below it; the lookup only runs when the preview draws, in a later animation frame.)

In `online-client/index.html`, replace the `<section id="scene" …>` element with:

```html
  <section id="scene" class="scene" hidden aria-label="Scene">
    <div class="scene-main">
      <div id="image-progress" class="image-progress" hidden>
        <progress id="image-progress-bar" aria-label="Loading images"></progress>
        <span id="image-progress-text" role="status"></span>
      </div>
      <canvas id="preview" role="img" aria-label="Scene preview"></canvas>
      <div class="image-settings">
        <label class="keep-images">
          <input id="keep-images" type="checkbox" role="switch" checked>
          <span id="keep-images-label">Keep images on this device</span>
        </label>
        <button id="clear-images" class="secondary" type="button" disabled>Clear saved images</button>
      </div>
    </div>
    <aside class="scene-info">
      <ul id="widgets" aria-label="Widgets" hidden></ul>
      <ol id="initiative" aria-label="Initiative" hidden></ol>
    </aside>
  </section>
```

Append to `online-client/style.css`:

```css
.scene-main { display: grid; gap: 12px; align-content: start; min-width: 0; }
.image-progress { display: grid; gap: 4px; color: var(--muted); font-size: 13px; }
.image-progress progress { width: 100%; height: 6px; accent-color: var(--accent); }
.image-settings { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; color: var(--muted); font-size: 14px; }
.keep-images { display: flex; align-items: center; gap: 8px; }
.keep-images input { width: 18px; height: 18px; padding: 0; accent-color: var(--accent); }
button.secondary { background: transparent; color: var(--text); border: 1px solid var(--border); font-weight: 500; }
button:disabled { opacity: 0.5; cursor: default; }
```

- [ ] **Step 9: Type-check and build the page**

Run: `npx tsc --noEmit && npm run build:online`
Expected: both exit 0 (`tsconfig.json` includes `online-client/**/*.mts`); `dist-online/` holds the page.

- [ ] **Step 10: Look at the page**

Run: `npx vite -c vite.online.config.mts` and open the printed address. Expected: the page loads with no errors in the browser console (it says the link is incomplete). The preview, bar and switch appear once admitted to a real session; Task 11's manual test covers them. Stop the server with Ctrl+C.

- [ ] **Step 11: Commit**

```bash
git add src/app/online/preview online-client tests/unit/online/assetStatus.test.ts tests/unit/online/scenePreview.test.ts
git commit -m "feat(online): join page draws map and token images, with a loading bar and a keep switch"
```

---

### Task 11: Documentation, full checks and the manual test

**Files:**
- Modify: `README.md` ("Online play (preview)" section), `PRIVACY.md` ("Online play" section), `changelog/Unreleased.md`

**Interfaces:**
- Consumes: everything above. Produces no code.

- [ ] **Step 1: Update the README**

In `README.md`, under `## Online play (preview)`, replace the sentence "The join page shows a simple live preview for now (the grid, fog, and a marker per token); map and token images come in a later version, and file paths are never sent." with:

```markdown
The join page shows a live preview with the map and token images. Players download the images of the scene you present when they need them, with a progress bar, straight from your Atlas; only images of the scene they see can be downloaded, and file paths are never sent. Their browser keeps the images for next time unless they switch off **Keep images on this device** on the join page.
```

- [ ] **Step 2: Update the privacy notes**

In `PRIVACY.md`, under `## Online play`, replace the sentence "The players you let in receive the scene you present: what your player window shows, filtered on your computer before it is sent, with file paths replaced by random ids." with:

```markdown
The players you let in receive the scene you present: what your player window shows, filtered on your computer before it is sent, with file paths replaced by fingerprints of the files' contents, which only tell whether two images are the same file. They also receive the map and token images of that scene, as the original files, and no other file from your vault.
```

and add this paragraph after the one about the join page's address (the paragraph starting "Players open the join page from"):

```markdown
With **Keep images on this device** on (the default), the join page keeps the images it received in the player's browser storage for later sessions, up to 500 MB, until the player switches it off or chooses **Clear saved images**; with it off, images are kept only while the page is open. Browsers give every site under `evoljoaobento.github.io` the same storage, so the join page should stay the only site published there, or move to its own address.
```

- [ ] **Step 3: Add the release notes**

In `changelog/Unreleased.md`, under `**Online Play (preview)**`, add after the last bullet (the file uses CRLF line endings; keep them):

```markdown
- Online players now see the map and token images of the scene you present. Images download from your Atlas when players need them, with a progress bar on the join page, and players keep them for next time unless they switch off **Keep images on this device**. Images over 64 MB are not sent.
```

- [ ] **Step 4: Run every check**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run build:ci && npm run build:online`
Expected: each exits 0. `npm run lint` reports no warnings; Vitest reports every test file passing (the existing suite plus `assetProtocol`, `assetRegistry`, `assetServer`, `transferAssembler`, `assetCache`, `assetLoader`, `assetStreamingEndToEnd`, `assetStatus`, `playerSessionAssets`); `build:ci` writes `dist/main.js`; `build:online` writes `dist-online/`.

- [ ] **Step 5: Check the release notes build**

Run: `npm run changelog:check`
Expected: exits 0.

- [ ] **Step 6: Check the file sizes**

Run: `wc -l src/app/online/GmSession.ts src/app/online/PlayerSession.ts src/app/online/scene/SceneBroadcaster.ts src/app/online/transport/*.ts src/app/online/assets/*.ts online-client/*.mts`
Expected: `GmSession.ts` ≤ 317, every other file ≤ 300.

- [ ] **Step 7: Commit**

```bash
git add README.md PRIVACY.md changelog/Unreleased.md
git commit -m "docs(online): map and token images for online players"
```

- [ ] **Step 8: Manual end-to-end test (the user runs it)**

Build and load the plugin (`npm run build`, then reload Atlas in Obsidian). Run the join page locally with `npx vite -c vite.online.config.mts --host` and set **Settings → Online play → Player page address** to the address it prints (the published Pages site is built from `main` and does not have this branch yet).

1. Open a scene with a map image of several MB, a few tokens with art (two sharing the same art, one SVG token, one hidden, one completely under fog), and some fog.
2. Run **Online session…**, open the join link in a desktop browser, enter a name and allow the player. Run **Present to players**. The preview first shows markers; within a moment a thin bar above it reads "Loading images… x of y MB", and the map image appears under the grid and fog, then the token art inside the circles, with rings, initials and HP bars on top. The bar disappears when everything arrived. The hidden and the fully fogged token's art never appears, and the two tokens sharing art show the same image.
3. In the developer tools' Network or Application panel, check IndexedDB `atlas-online-images`: it holds the map and each distinct token image once. The button under the preview reads "Clear saved images (n MB)".
4. Reload the player page and join again: the images appear without the bar (nothing downloads again).
5. Switch **Keep images on this device** off: the button's space drops to nothing. Reload and join: everything downloads again, with the bar. Switch it back on.
6. Drag a token and paint fog while a large map is still loading (use the browser's network throttling, "Slow 4G"): the token and fog follow at once; the image keeps loading.
7. While the map is loading, reload the player page: after reconnecting, the images load and show correctly.
8. Delete a token whose art has not finished loading: its download stops (the bar's total drops). Present another scene: the first scene's images stop downloading and the new scene's load.
9. In Atlas, replace a token's art file with another image of the same name (edit it in an image editor and save): the players' preview shows the new art after the next change in the scene.
10. Open the join link in a private window: the switch is disabled and reads "Can't save on this device"; the images still load and show.
11. Present a scene whose map is over 64 MB: the GM sees "This image is too large to send to online players." once; players see the grid and markers without that map.
12. Try a phone on mobile data (with a relay server set if needed): the images arrive, and the scene stays responsive while they do.
13. Run **Stop online session**: the page says the session ended.

---

## Self-review

Checked against the spec after writing:

- **Spec coverage.** Asset ids as content fingerprints (SHA-256, 43 characters, cached by path/mtime/size, changed file → new id, `onChange` → 50 ms tick, presenting never waits, 64 MB / type limits, one notice per session, reverse map, paths stay on the GM): Tasks 2 and 3. Protocol (five message types, binary chunks with a 4-byte big-endian handle and ≤ 64 KB, validated both sides, size limits): Task 2. `PeerLink` pacing (`bufferedAmount`, drain callback; `MemoryTransport` simulates): Task 1. Sessions pass assets-channel data without the asset code (`onAssetData`, `assetChannel`, `PlayerAssetHandler`): Task 4. `AssetServer` (admitted only, 256 pending, projection only, per-player queue one at a time map first, 1 MB pacing with drain resume, shared reads released, removal when an image leaves the projection with `asset-denied` in flight, `asset-cancel`, unreadable or mismatched files denied and forgotten, queues dropped when players leave, are kicked or replaced): Tasks 5 and 6. `AssetLoader` (scene fingerprints, cache first, batches of 64, assembly by handle within announced size / 64 MB / 16 open, fingerprint check and one retry, cancel, reconnect, denied or undecodable not requested until they leave and return, decoded images and progress): Tasks 7 and 8. `AssetCache` (IndexedDB with keeping on, memory otherwise, 500 MB LRU by last shown, switching off deletes, clear with space used, remembered switch, unavailable storage → memory and "Can't save on this device", full storage → evict then memory): Tasks 7 and 10. Preview (map under grid and fog at the map's size, token art clipped to circles with ring, initials and HP on top, markers while missing, fog last, the bar's text): Task 10. Errors and edge cases: changed file (Tasks 3, 9), slow hashing (Task 3), request before the scene or for another scene (Task 6), hostile GM (Tasks 7, 8), hostile player (Task 6), storage full (Task 7). Security: paths never sent (Tasks 3, 9), hidden tokens never requestable (Tasks 6, 9), SVG only drawn as images (Task 10), shared storage origin noted in PRIVACY (Task 11). Testing list: registry (Task 3), server (Task 6), loader and cache (Tasks 7, 8; IndexedDB itself manual, plan decision 14), end to end over `MemoryTransport` with the four named flows plus the edited-file flow (Task 9), manual (Task 11).
- **Deviations reported for review:** the IndexedDB adapter has no Vitest test (decision 14; the spec lists "fake IndexedDB in tests"); `PlayerSession.ts` grows by about 20 lines (decision 18); `onChange` also fires on a forgotten fingerprint (decision 3); queued fingerprints leaving the projection are dropped without `asset-denied` (decision 7).
- **Placeholder scan.** No "TBD", "similar to Task N" or unspecified handling; each code step shows the code, each run step the command and the expected result.
- **Type consistency.** `ASSET_LIMITS`, `AssetMime`, `Hasher`, `isAssetId`, `sceneAssetIds`, `isArrayBuffer` (Task 2) are used under those names in Tasks 3 and 6–10; `AssetMessage`, `AssetChunk`, `decodeAsset`, `encodeAsset`, `encodeChunk`, `MAX_HANDLE` (Task 2) in Tasks 6, 8 and 9; `ImageFiles`, `AssetFile`, `AssetIds`, `AssetRegistry.read` / `onChange` / `dispose`, `IMAGE_TOO_LARGE_NOTICE` (Task 3) in Tasks 5, 6 and 9; `ChannelPort`, `channelPort`, `GmSession.assetChannel`, `SessionHandler.onAssetData`, `PlayerAssetHandler`, `PlayerSessionOptions.assets` (Task 4) in Tasks 6, 8, 9 and 10; `SceneBroadcaster.onProjection` (Task 5) in Tasks 6 and 9; `AssetServer` and its option shape (Task 6) in Task 9; `TransferAssembler`, `AssetCache`, `ImageStore`, `StoredImage`, `AssetCacheState`, `openIndexedDbImageStore`, `MemoryStore` (Task 7) in Tasks 8–10; `AssetLoader`, `DecodedImage`, `AssetProgress` (Task 8) in Tasks 9 and 10; `MemoryLink.hold` / `flush` / `release` (Task 1) in Task 9; test fixtures `nodeHash`, `fingerprintOf`, `memoryImageFiles`, `imageBytes`, `settle` (Task 3), `fingerprint`, `sceneWithImages` (Task 2) and `fakeAssetIds` (Task 3) in later tasks under the same names.
- **Review Focus.** Each of the five lines has its named test in its owning task (Tasks 8 and 9).
