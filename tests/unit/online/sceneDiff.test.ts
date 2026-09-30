import { describe, expect, it } from 'vitest';
import { applyPatch, diffScenes, sameValue } from '../../../src/app/online/scene/sceneDiff';
import type { ScenePatchBody } from '../../../src/app/online/scene/sceneTypes';
import { fogRect, playerScene, playerToken } from './sceneFixtures';

describe('sameValue', () => {
  it('compares JSON values deeply', () => {
    expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameValue([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(sameValue(null, {})).toBe(false);
  });
});

describe('diffScenes', () => {
  it('finds nothing between equal scenes, even rebuilt ones', () => {
    expect(diffScenes(playerScene(), playerScene())).toBeNull();
  });

  it('upserts a moved token and nothing else', () => {
    const next = playerScene({ tokens: { t1: playerToken({ x: 300 }) } });
    expect(diffScenes(playerScene(), next)).toEqual({ set: {}, upsert: { tokens: { t1: playerToken({ x: 300 }) } }, remove: {} });
  });

  it('removes and adds records by id', () => {
    const next = playerScene({ fog: { f2: fogRect(2, { erase: true }) }, drawings: {} });
    expect(diffScenes(playerScene(), next)).toEqual({
      set: {},
      upsert: { fog: { f2: fogRect(2, { erase: true }) } },
      remove: { fog: ['f1'], drawings: ['d1'] },
    });
  });

  it('replaces top-level fields that differ', () => {
    const next = playerScene({ grid: null, widgets: [{ id: 'w1', type: 'counter', label: 'Torches', icon: 'flame', value: 4 }] });
    expect(diffScenes(playerScene(), next)).toEqual({
      set: { grid: null, widgets: [{ id: 'w1', type: 'counter', label: 'Torches', icon: 'flame', value: 4 }] },
      upsert: {},
      remove: {},
    });
  });
});

describe('applyPatch', () => {
  it('turns the previous scene into the next one', () => {
    const previous = playerScene();
    const next = playerScene({
      map: { asset: null, width: 0, height: 0, cellSize: 50 },
      tokens: { t1: playerToken({ hp: { current: 3, max: 9 } }), t2: playerToken({ x: 7 }) },
      texts: {},
      initiative: null,
    });
    const patch = diffScenes(previous, next);
    expect(patch).not.toBeNull();
    expect(applyPatch(previous, patch!)).toEqual(next);
  });

  it('leaves its input untouched and ignores fields it does not know', () => {
    const previous = playerScene();
    const before = JSON.parse(JSON.stringify(previous)) as typeof previous;
    const patch = {
      set: { lighting: 'dim' },
      upsert: { walls: { w: {} }, tokens: { t9: playerToken() } },
      remove: { tokens: ['t1'] },
    } as unknown as ScenePatchBody;
    const next = applyPatch(previous, patch);
    expect(previous).toEqual(before);
    expect(Object.keys(next.tokens)).toEqual(['t9']);
    expect(next).not.toHaveProperty('lighting');
    expect(next).not.toHaveProperty('walls');
  });

  it('is prototype-safe: __proto__ as id does not pollute or crash', () => {
    const previous = playerScene({ tokens: {} });
    const patch: ScenePatchBody = {
      set: {},
      upsert: { tokens: { __proto__: playerToken() as unknown as Record<string, unknown> } },
      remove: { tokens: ['__proto__'] },
    };
    const next = applyPatch(previous, patch);
    // Verify no prototype pollution
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // Verify the token was upserted then removed (removed wins)
    expect(Object.keys(next.tokens)).toEqual([]);
    // Verify round-trip: apply nothing should equal itself
    const unchanged = applyPatch(next, { set: {}, upsert: {}, remove: {} });
    expect(JSON.parse(JSON.stringify(unchanged))).toEqual(JSON.parse(JSON.stringify(next)));
  });
});
