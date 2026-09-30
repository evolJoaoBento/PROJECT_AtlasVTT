/**
 * Differences between two projections of one scene, and applying them.
 * Shared with the web player page, so this file imports only the wire types.
 */
import { SCENE_FIELD_KEYS, SCENE_RECORD_KEYS, type PlayerScene, type ScenePatchBody } from './sceneTypes';

type AnyRecord = Record<string, unknown>;

/** Deep equality of JSON values. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => sameValue(item, b[index]));
  }
  const left = a as AnyRecord;
  const right = b as AnyRecord;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}

function diffRecord(before: AnyRecord, after: AnyRecord): { upsert: AnyRecord; remove: string[] } {
  const upsert: AnyRecord = {};
  for (const id of Object.keys(after)) {
    if (!Object.hasOwn(before, id) || !sameValue(before[id], after[id])) upsert[id] = after[id];
  }
  const remove = Object.keys(before).filter((id) => !Object.hasOwn(after, id));
  return { upsert, remove };
}

/** What changed from `previous` to `next`, two projections of the same scene; null when nothing did. */
export function diffScenes(previous: PlayerScene, next: PlayerScene): ScenePatchBody | null {
  const patch: ScenePatchBody = { set: {}, upsert: {}, remove: {} };
  let changed = false;
  for (const key of SCENE_FIELD_KEYS) {
    if (sameValue(previous[key], next[key])) continue;
    (patch.set as AnyRecord)[key] = next[key];
    changed = true;
  }
  for (const key of SCENE_RECORD_KEYS) {
    const { upsert, remove } = diffRecord(previous[key], next[key]);
    if (Object.keys(upsert).length > 0) {
      (patch.upsert as AnyRecord)[key] = upsert;
      changed = true;
    }
    if (remove.length > 0) {
      patch.remove[key] = remove;
      changed = true;
    }
  }
  return changed ? patch : null;
}

/** `scene` with `patch` applied, as a new object. Fields the patch carries that this version does not know are ignored. */
export function applyPatch(scene: PlayerScene, patch: ScenePatchBody): PlayerScene {
  const next = { ...scene } as unknown as AnyRecord;
  for (const key of SCENE_FIELD_KEYS) {
    if (Object.hasOwn(patch.set, key)) next[key] = (patch.set as AnyRecord)[key];
  }
  for (const key of SCENE_RECORD_KEYS) {
    const upsert = Object.hasOwn(patch.upsert, key) ? (patch.upsert as AnyRecord)[key] as AnyRecord : null;
    const remove = Object.hasOwn(patch.remove, key) ? patch.remove[key] ?? [] : [];
    if (!upsert && remove.length === 0) continue;
    // Build a new record object safely to prevent prototype pollution.
    const record: AnyRecord = {};
    const currentRecord = next[key] as AnyRecord;
    for (const id of Object.keys(currentRecord)) {
      if (!remove.includes(id)) record[id] = currentRecord[id];
    }
    if (upsert) {
      for (const id of Object.keys(upsert)) record[id] = upsert[id];
    }
    next[key] = record;
  }
  return next as unknown as PlayerScene;
}
