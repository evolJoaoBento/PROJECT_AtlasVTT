// tests/unit/online/sceneProtocol.test.ts
import { describe, expect, it } from 'vitest';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { SCENE_LIMITS, sortedByOrder } from '../../../src/app/online/scene/sceneTypes';
import { fogRect, playerScene, playerToken, sceneBody } from './sceneFixtures';

const decodeRaw = (value: unknown): ReturnType<typeof decodeControl> => decodeControl(JSON.stringify(value));

describe('scene messages', () => {
  it('round-trips every scene message type', () => {
    const scene = playerScene();
    const messages: ControlMessage[] = [
      { v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 1, drawingParts: 1 },
      { v: 1, type: 'scene-fog', seq: 2, part: 0, records: scene.fog },
      { v: 1, type: 'scene-drawings', seq: 3, part: 0, records: scene.drawings },
      {
        v: 1, type: 'scene-patch', seq: 3,
        set: { grid: null, widgets: [] },
        upsert: { tokens: { t2: playerToken({ x: 5 }) }, fog: { f2: fogRect(2, { erase: true }) } },
        remove: { texts: ['x1'] },
      },
      { v: 1, type: 'scene-clear', seq: 4 },
      { v: 1, type: 'scene-resync', seq: 0 },
    ];
    for (const message of messages) {
      expect(decodeControl(encodeControl(message))).toEqual({ kind: 'message', message });
    }
  });

  it('accepts every fog operation shape and rejects broken ones', () => {
    const records = {
      brush: { type: 'brush', erase: false, order: 1, radius: 20, points: [{ x: 0, y: 0 }] },
      lasso: { type: 'lasso', erase: true, order: 2, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }] },
      rect: fogRect(3),
    };
    expect(decodeRaw({ v: 1, type: 'scene-fog', seq: 1, part: 0, records }).kind).toBe('message');
    const broken = [
      { type: 'brush', erase: false, order: 1, radius: 20, points: [] },
      { type: 'brush', erase: false, order: 1, radius: 0, points: [{ x: 0, y: 0 }] },
      { type: 'lasso', erase: false, order: 1, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
      { type: 'rectangle', erase: false, order: 1, x: 0, y: 0, width: 'wide', height: 5 },
      { type: 'circle', erase: false, order: 1 },
    ];
    for (const op of broken) {
      expect(decodeRaw({ v: 1, type: 'scene-fog', seq: 1, part: 0, records: { a: op } }))
        .toEqual({ kind: 'invalid', reason: 'bad-scene-fog' });
    }
  });

  it('checks drawing parts like fog parts', () => {
    const drawings = playerScene().drawings;
    expect(decodeRaw({ v: 1, type: 'scene-drawings', seq: 1, part: 0, records: drawings }).kind).toBe('message');
    const bad = { d: { type: 'pen', order: 1, points: [], color: '#000000', width: 1, opacity: 1, icon: null } };
    expect(decodeRaw({ v: 1, type: 'scene-drawings', seq: 1, part: 0, records: bad }))
      .toEqual({ kind: 'invalid', reason: 'bad-scene-drawings' });
  });

  it('rejects a snapshot with a malformed record or a missing field', () => {
    const body = sceneBody(playerScene());
    const badToken = { ...body, tokens: { t1: { ...playerToken(), hp: { current: 'lots', max: 10 } } } };
    expect(decodeRaw({ v: 1, type: 'scene-snapshot', seq: 1, scene: badToken, fogParts: 0, drawingParts: 0 }))
      .toEqual({ kind: 'invalid', reason: 'bad-scene-snapshot' });
    expect(decodeRaw({ v: 1, type: 'scene-snapshot', seq: 1, scene: body, fogParts: 0 }).kind).toBe('invalid');
    const { grid: _grid, ...withoutGrid } = body;
    expect(decodeRaw({ v: 1, type: 'scene-snapshot', seq: 1, scene: withoutGrid, fogParts: 0, drawingParts: 0 }).kind).toBe('invalid');
  });

  it('refuses record ids that assignment would treat specially', () => {
    const raw = `{"v":1,"type":"scene-fog","seq":1,"part":0,"records":{"__proto__":${JSON.stringify(fogRect(1))}}}`;
    expect(decodeControl(raw)).toEqual({ kind: 'invalid', reason: 'bad-scene-fog' });
    const patch = { v: 1, type: 'scene-patch', seq: 2, set: {}, upsert: {}, remove: { tokens: ['constructor'] } };
    expect(decodeRaw(patch)).toEqual({ kind: 'invalid', reason: 'bad-scene-patch' });
  });

  it('bounds sequence numbers and sizes', () => {
    expect(decodeRaw({ v: 1, type: 'scene-clear', seq: 0 }).kind).toBe('invalid');
    expect(decodeRaw({ v: 1, type: 'scene-clear', seq: 1.5 }).kind).toBe('invalid');
    expect(decodeRaw({ v: 1, type: 'scene-resync', seq: -1 }).kind).toBe('invalid');
    const points = Array.from({ length: SCENE_LIMITS.points + 1 }, (_, i) => ({ x: i, y: 0 }));
    const op = { type: 'brush', erase: false, order: 1, radius: 5, points };
    expect(decodeRaw({ v: 1, type: 'scene-fog', seq: 1, part: 0, records: { a: op } }).kind).toBe('invalid');
  });

  it('checks only the patch fields it knows, so newer GMs can add fields', () => {
    const patch = { v: 1, type: 'scene-patch', seq: 2, set: { lighting: { any: 'thing' } }, upsert: { walls: {} }, remove: {} };
    expect(decodeRaw(patch).kind).toBe('message');
    const badUpsert = { v: 1, type: 'scene-patch', seq: 2, set: {}, upsert: { tokens: { t1: { x: 1 } } }, remove: {} };
    expect(decodeRaw(badUpsert)).toEqual({ kind: 'invalid', reason: 'bad-scene-patch' });
    const badSet = { v: 1, type: 'scene-patch', seq: 2, set: { map: { asset: null } }, upsert: {}, remove: {} };
    expect(decodeRaw(badSet)).toEqual({ kind: 'invalid', reason: 'bad-scene-patch' });
  });

  it('orders fog and drawings by order, then by id', () => {
    const records = { b: { order: 1 }, a: { order: 1 }, c: { order: 0 } };
    expect(sortedByOrder(records, (record) => record.order).map(([id]) => id)).toEqual(['c', 'a', 'b']);
  });
});
