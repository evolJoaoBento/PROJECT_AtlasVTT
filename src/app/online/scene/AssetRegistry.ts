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
