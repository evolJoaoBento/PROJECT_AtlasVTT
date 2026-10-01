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
