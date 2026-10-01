import { describe, expect, it } from 'vitest';
import type { ScreenPoint } from '../../../src/app/online/view/camera';
import { DOUBLE_ZOOM, ViewInput, WHEEL_ZOOM_PER_PIXEL, type PointerInput } from '../../../src/app/online/view/ViewInput';

type Move = { pan: [number, number] } | { zoom: [ScreenPoint, number] };

function setup(): { input: ViewInput; moves: Move[] } {
  const moves: Move[] = [];
  const input = new ViewInput({
    pan: (dx, dy) => { moves.push({ pan: [dx, dy] }); },
    zoomAt: (point, factor) => { moves.push({ zoom: [point, factor] }); },
  });
  return { input, moves };
}

const mouse = (x: number, y: number, button = 0): PointerInput => ({ id: 1, x, y, kind: 'mouse', button, time: 0 });
const touch = (id: number, x: number, y: number, time = 0): PointerInput => ({ id, x, y, kind: 'touch', button: 0, time });

describe('ViewInput', () => {
  it('zooms around the cursor on the wheel, by pixels, lines or pages', () => {
    const { input, moves } = setup();
    input.wheel({ x: 100, y: 50 }, 100, 0);
    input.wheel({ x: 100, y: 50 }, 3, 1);
    input.wheel({ x: 100, y: 50 }, 0, 0);
    expect(moves).toEqual([
      { zoom: [{ x: 100, y: 50 }, Math.exp(-100 * WHEEL_ZOOM_PER_PIXEL)] },
      { zoom: [{ x: 100, y: 50 }, Math.exp(-48 * WHEEL_ZOOM_PER_PIXEL)] },
    ]);
  });

  it('pans with a drag once it moves past the slop, the whole way from where it started', () => {
    const { input, moves } = setup();
    input.down(mouse(0, 0));
    input.move(mouse(3, 0));
    input.move(mouse(10, 0));
    input.move(mouse(15, 5));
    input.up(mouse(15, 5));
    input.move(mouse(40, 40));
    expect(moves).toEqual([{ pan: [10, 0] }, { pan: [5, 5] }]);
  });

  it('moves nothing on a click, or a tap that jitters less than the slop', () => {
    const { input, moves } = setup();
    input.down(mouse(100, 100));
    input.up(mouse(100, 100));
    input.down(touch(2, 100, 100));
    input.move(touch(2, 104, 101));
    input.up(touch(2, 104, 101));
    expect(moves).toEqual([]);
  });

  it('zooms in on a double-click, but not on the double-click a touch double-tap may also fire', () => {
    const { input, moves } = setup();
    input.down(mouse(10, 10));
    input.up(mouse(10, 10));
    input.doubleClick({ x: 10, y: 10 });
    input.down(touch(2, 10, 10));
    input.up(touch(2, 10, 10));
    input.doubleClick({ x: 10, y: 10 });
    expect(moves).toEqual([{ zoom: [{ x: 10, y: 10 }, DOUBLE_ZOOM] }]);
  });

  it('zooms in on a double-tap, only when quick and close', () => {
    const { input, moves } = setup();
    for (const [x, y, time] of [[50, 50, 0], [60, 55, 200], [60, 55, 1000], [60, 55, 1400], [300, 300, 1500]] as const) {
      input.down(touch(2, x, y, time));
      input.up(touch(2, x, y, time));
    }
    expect(moves).toEqual([{ zoom: [{ x: 60, y: 55 }, DOUBLE_ZOOM] }]);
  });

  it('pinches around the fingers and pans with them', () => {
    const { input, moves } = setup();
    input.down(touch(1, 100, 100));
    input.down(touch(2, 200, 100));
    input.move(touch(2, 300, 100));
    expect(moves).toEqual([{ pan: [50, 0] }, { zoom: [{ x: 200, y: 100 }, 2] }]);
  });

  it('keeps panning with the remaining finger after a pinch', () => {
    const { input, moves } = setup();
    input.down(touch(1, 100, 100));
    input.down(touch(2, 200, 100));
    input.move(touch(2, 300, 100));
    moves.length = 0;
    input.up(touch(1, 100, 100));
    input.move(touch(2, 310, 100));
    input.move(touch(2, 312, 104));
    input.up(touch(2, 312, 104));
    expect(moves).toEqual([{ pan: [10, 0] }, { pan: [2, 4] }]);
  });

  it('ignores other mouse buttons and a third finger, and a cancelled press is no tap', () => {
    const { input, moves } = setup();
    input.down(mouse(0, 0, 2));
    input.move(mouse(50, 0, 2));
    input.down(touch(1, 0, 0));
    input.down(touch(2, 100, 0));
    input.down(touch(3, 50, 50));
    input.move(touch(3, 90, 90));
    input.cancel(1);
    input.cancel(2);
    input.down(touch(4, 10, 10, 0));
    input.cancel(4);
    input.down(touch(5, 10, 10, 100));
    input.up(touch(5, 10, 10, 100));
    expect(moves).toEqual([]);
  });
});
