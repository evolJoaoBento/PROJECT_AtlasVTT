/**
 * Turns input on the map into camera moves: the wheel zooms around the cursor, a
 * drag pans, a double-click or double-tap zooms in, and two fingers pan and pinch
 * around their midpoint. Points are CSS pixels from the canvas's top left. Pure: the
 * page passes plain numbers from its DOM events, so tests drive it the same way.
 */
import type { ScreenPoint } from './camera';

export interface CameraMoves {
  pan(dx: number, dy: number): void;
  zoomAt(point: ScreenPoint, factor: number): void;
}

export type PointerKind = 'mouse' | 'touch' | 'pen';

export interface PointerInput {
  id: number;
  x: number;
  y: number;
  kind: PointerKind;
  /** The pressed button; 0 is the main one. */
  button: number;
  /** In milliseconds, on any clock. */
  time: number;
}

/** Wheel zoom per pixel scrolled: about 1.16× per 100 px notch. */
export const WHEEL_ZOOM_PER_PIXEL = 0.0015;
const LINE_PIXELS = 16;
const PAGE_PIXELS = 800;
/** Double-click and double-tap zoom. */
export const DOUBLE_ZOOM = 2;
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_DISTANCE = 24;
/** A press that moves less than this is a click or tap, and moves nothing. */
export const TAP_SLOP = 6;

const distance = (a: ScreenPoint, b: ScreenPoint): number => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: ScreenPoint, b: ScreenPoint): ScreenPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export class ViewInput {
  private readonly pointers = new Map<number, ScreenPoint>();
  /** Where the gesture's first pointer went down, until it moves past the slop. */
  private start: ScreenPoint | null = null;
  private dragging = false;
  private lastTap: { point: ScreenPoint; time: number } | null = null;
  private lastKind: PointerKind = 'mouse';

  constructor(private readonly camera: CameraMoves) {}

  down(input: PointerInput): void {
    this.lastKind = input.kind;
    if (input.kind === 'mouse' && input.button !== 0) return;
    if (this.pointers.size >= 2) return;
    const point = { x: input.x, y: input.y };
    this.pointers.set(input.id, point);
    if (this.pointers.size === 1) {
      this.start = point;
      this.dragging = false;
    } else {
      // A second finger makes the gesture a pinch, never a tap.
      this.start = null;
      this.dragging = true;
      this.lastTap = null;
    }
  }

  move(input: PointerInput): void {
    const previous = this.pointers.get(input.id);
    if (!previous) return;
    const point = { x: input.x, y: input.y };
    if (this.pointers.size === 2) {
      this.pinch(input.id, previous, point);
      return;
    }
    if (this.dragging) {
      this.camera.pan(point.x - previous.x, point.y - previous.y);
    } else {
      const start = this.start;
      if (!start || distance(start, point) < TAP_SLOP) return;
      this.dragging = true;
      this.lastTap = null;
      this.camera.pan(point.x - start.x, point.y - start.y);
    }
    this.pointers.set(input.id, point);
  }

  up(input: PointerInput): void {
    if (!this.pointers.delete(input.id)) return;
    // One finger left a pinch: it pans on from where it is.
    if (this.pointers.size > 0) return;
    if (!this.dragging && input.kind === 'touch') this.tap({ x: input.x, y: input.y }, input.time);
    this.start = null;
    this.dragging = false;
  }

  cancel(id: number): void {
    this.pointers.delete(id);
    if (this.pointers.size > 0) return;
    this.start = null;
    this.dragging = false;
  }

  /** `deltaMode` as in `WheelEvent`: 0 pixels, 1 lines, 2 pages. */
  wheel(point: ScreenPoint, deltaY: number, deltaMode: number): void {
    const pixels = deltaMode === 1 ? deltaY * LINE_PIXELS : deltaMode === 2 ? deltaY * PAGE_PIXELS : deltaY;
    if (Number.isFinite(pixels) && pixels !== 0) this.camera.zoomAt(point, Math.exp(-pixels * WHEEL_ZOOM_PER_PIXEL));
  }

  /** The browser's double-click; a touch double-tap is recognised from its taps instead, so it zooms once. */
  doubleClick(point: ScreenPoint): void {
    if (this.lastKind === 'touch') return;
    this.camera.zoomAt(point, DOUBLE_ZOOM);
  }

  private pinch(id: number, previous: ScreenPoint, point: ScreenPoint): void {
    const other = [...this.pointers].find(([key]) => key !== id)?.[1];
    this.pointers.set(id, point);
    if (!other) return;
    const before = midpoint(previous, other);
    const after = midpoint(point, other);
    this.camera.pan(after.x - before.x, after.y - before.y);
    const spread = distance(previous, other);
    const factor = distance(point, other) / spread;
    if (spread > 0 && Number.isFinite(factor)) this.camera.zoomAt(after, factor);
  }

  private tap(point: ScreenPoint, time: number): void {
    const last = this.lastTap;
    if (last && time - last.time <= DOUBLE_TAP_MS && distance(last.point, point) <= DOUBLE_TAP_DISTANCE) {
      this.lastTap = null;
      this.camera.zoomAt(point, DOUBLE_ZOOM);
      return;
    }
    this.lastTap = { point, time };
  }
}
