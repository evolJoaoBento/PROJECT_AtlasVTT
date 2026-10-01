import { describe, expect, it } from 'vitest';
import { LASER_STALE_MS, RemoteLasers } from '../../src/app/pixi/laser/remoteLasers';
import { LASER_FADE_TIME } from '../../src/app/tools/laserPointerSettings';

const ORANGE = '#ff9f2e';

describe('RemoteLasers', () => {
  it("holds the newest point at full strength until the laser is let go, then fades like Atlas's trail", () => {
    const lasers = new RemoteLasers();
    lasers.receive('p1', ORANGE, [{ x: 0, y: 0 }, { x: 10, y: 0 }], false, 0);
    const [frame] = lasers.frame(LASER_FADE_TIME / 2);
    expect(frame).toMatchObject({ from: 'p1', color: ORANGE, head: { x: 10, y: 0 } });
    expect(frame!.trail.map((point) => point.life)).toEqual([0.5, 0.5, 1]);
    lasers.receive('p1', ORANGE, [], true, LASER_FADE_TIME / 2);
    expect(lasers.frame(LASER_FADE_TIME / 2)[0]!.head).toBeNull();
    expect(lasers.frame(LASER_FADE_TIME)).toEqual([]);
    expect(lasers.isActive).toBe(false);
  });

  it('lets a laser go that heard nothing for a second', () => {
    const lasers = new RemoteLasers();
    lasers.receive('p1', ORANGE, [{ x: 0, y: 0 }], false, 0);
    expect(lasers.frame(LASER_STALE_MS)[0]!.head).toEqual({ x: 0, y: 0 });
    expect(lasers.frame(LASER_STALE_MS + 1)).toEqual([]);
  });

  it('keeps a laser held still alive on empty batches', () => {
    const lasers = new RemoteLasers();
    lasers.receive('p1', ORANGE, [{ x: 0, y: 0 }], false, 0);
    lasers.receive('p1', ORANGE, [], false, 900);
    expect(lasers.frame(1500)[0]!.head).toEqual({ x: 0, y: 0 });
  });

  it('ignores a lift or a keepalive from a laser it never saw', () => {
    const lasers = new RemoteLasers();
    lasers.receive('p2', ORANGE, [], true, 0);
    lasers.receive('p3', ORANGE, [], false, 0);
    expect(lasers.isActive).toBe(false);
  });
});
