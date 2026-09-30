// src/app/online/scene/AssetRegistry.ts
import { randomId } from '../ids';

/**
 * Vault paths as opaque asset ids, per online session: random, so they reveal
 * no file or folder names, and stable within the session so players can cache
 * images by id (piece 3 serves them). Paths never leave the GM's machine.
 */
export class AssetRegistry {
  private readonly ids = new Map<string, string>();

  idFor(path: string | null | undefined): string | null {
    if (typeof path !== 'string' || path.length === 0) return null;
    let id = this.ids.get(path);
    if (!id) {
      id = randomId();
      this.ids.set(path, id);
    }
    return id;
  }
}
