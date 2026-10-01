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
