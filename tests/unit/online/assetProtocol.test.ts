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
