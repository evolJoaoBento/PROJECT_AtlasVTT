// src/app/online/scene/FogCoverage.ts
/**
 * Where the fog of war lies, coarsely, to decide what players may receive.
 * Replays the fog operations like `FogCanvasCompositor` (in order, erase
 * clearing) onto one cell per 8 world pixels. It is conservative: paint fogs
 * only cells it covers whole and erase clears every cell it touches, so an
 * object counts as covered only when no part of it can show.
 */
import { calculateOperationBounds } from '../../pixi/fog/fogRenderUtils';
import type { FogOperation } from '../../types/fogTypes';
import { finiteOr } from './coerce';
import { sortedByOrder, type ScenePoint } from './sceneTypes';
import { distanceSqToSegment, finitePoints, simplifyPoints } from './simplifyPoints';

export const FOG_CELL_SIZE = 8;
/** Beyond this many cells the cell size doubles, so a huge fogged area stays cheap. */
export const MAX_FOG_CELLS = 4_000_000;

export interface WorldBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FOGGED = 1;
const CLEAR = 0;

export class FogCoverage {
  static readonly EMPTY: FogCoverage = new FogCoverage(new Uint8Array(0), 0, 0, 0, 0, FOG_CELL_SIZE);

  private constructor(
    private readonly cells: Uint8Array,
    private readonly cols: number,
    private readonly rows: number,
    private readonly originX: number,
    private readonly originY: number,
    readonly cellSize: number,
  ) {}

  static fromOperations(fog: Readonly<Record<string, FogOperation>>): FogCoverage {
    const ops = sortedByOrder(fog, (op) => finiteOr(op.timestamp, 0)).map(([, op]) => op);
    const bounds = paintedBounds(ops);
    if (!bounds) return FogCoverage.EMPTY;
    let cellSize = FOG_CELL_SIZE;
    while ((bounds.width / cellSize + 2) * (bounds.height / cellSize + 2) > MAX_FOG_CELLS) cellSize *= 2;
    const originX = Math.floor(bounds.x / cellSize) * cellSize;
    const originY = Math.floor(bounds.y / cellSize) * cellSize;
    const cols = Math.ceil((bounds.x + bounds.width - originX) / cellSize) + 1;
    const rows = Math.ceil((bounds.y + bounds.height - originY) / cellSize) + 1;
    const coverage = new FogCoverage(new Uint8Array(cols * rows), cols, rows, originX, originY, cellSize);
    for (const op of ops) coverage.apply(op);
    return coverage;
  }

  /** True when every cell under `bounds` is fogged; anything reaching outside the fogged area is not covered. */
  isCovered(bounds: WorldBounds): boolean {
    const right = bounds.x + Math.max(0, bounds.width);
    const bottom = bounds.y + Math.max(0, bounds.height);
    if (this.cells.length === 0 || ![bounds.x, bounds.y, right, bottom].every(Number.isFinite)) return false;
    const c0 = this.col(bounds.x);
    const r0 = this.row(bounds.y);
    const c1 = Math.max(c0, Math.ceil((right - this.originX) / this.cellSize) - 1);
    const r1 = Math.max(r0, Math.ceil((bottom - this.originY) / this.cellSize) - 1);
    if (c0 < 0 || r0 < 0 || c1 >= this.cols || r1 >= this.rows) return false;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        if (this.cells[row * this.cols + col] !== FOGGED) return false;
      }
    }
    return true;
  }

  private col(x: number): number {
    return Math.floor((x - this.originX) / this.cellSize);
  }

  private row(y: number): number {
    return Math.floor((y - this.originY) / this.cellSize);
  }

  private apply(op: FogOperation): void {
    const dx = finiteOr(op.offsetX, 0);
    const dy = finiteOr(op.offsetY, 0);
    const value = op.isErasing ? CLEAR : FOGGED;
    if (op.type === 'rectangle') {
      this.fillRect(finiteOr(op.x, Number.NaN) + dx, finiteOr(op.y, Number.NaN) + dy,
        finiteOr(op.width, Number.NaN), finiteOr(op.height, Number.NaN), value);
    } else if (op.type === 'brush') {
      this.fillBrush(finitePoints(op.points, dx, dy), finiteOr(op.brushRadius, 0), value);
    } else if (op.type === 'lasso') {
      this.fillLasso(finitePoints(op.points, dx, dy), value);
    }
  }

  private forCells(c0: number, c1: number, r0: number, r1: number, visit: (index: number, left: number, top: number) => void): void {
    const lastRow = Math.min(this.rows - 1, r1);
    const lastCol = Math.min(this.cols - 1, c1);
    for (let row = Math.max(0, r0); row <= lastRow; row++) {
      for (let col = Math.max(0, c0); col <= lastCol; col++) {
        visit(row * this.cols + col, this.originX + col * this.cellSize, this.originY + row * this.cellSize);
      }
    }
  }

  /** Paint fogs the cells the rectangle covers whole; erase clears every cell it overlaps. */
  private fillRect(x: number, y: number, width: number, height: number, value: number): void {
    const left = Math.min(x, x + width);
    const right = Math.max(x, x + width);
    const top = Math.min(y, y + height);
    const bottom = Math.max(y, y + height);
    if (![left, right, top, bottom].every(Number.isFinite)) return;
    const size = this.cellSize;
    const whole = value === FOGGED;
    const c0 = whole ? Math.ceil((left - this.originX) / size) : this.col(left);
    const c1 = whole ? Math.floor((right - this.originX) / size) - 1 : Math.ceil((right - this.originX) / size) - 1;
    const r0 = whole ? Math.ceil((top - this.originY) / size) : this.row(top);
    const r1 = whole ? Math.floor((bottom - this.originY) / size) - 1 : Math.ceil((bottom - this.originY) / size) - 1;
    this.forCells(c0, c1, r0, r1, (index) => { this.cells[index] = value; });
  }

  /**
   * Round-capped segments: paint fogs a cell whose four corners lie within the
   * radius of one segment; erase clears a cell whose centre lies within the
   * radius plus half a cell diagonal of any segment.
   */
  private fillBrush(rawPoints: ScenePoint[], brushRadius: number, value: number): void {
    if (!(brushRadius > 0)) return;
    // Simplifying moves the stroke by at most `tolerance`; paint gives that back and erase adds it, so the result stays conservative.
    // The tolerance grows with the radius, which keeps the segments (each scanning about its own reach) proportional to the area painted.
    const tolerance = brushRadius / 16;
    const points = simplifyPoints(rawPoints, tolerance);
    const first = points[0];
    if (!first) return;
    const size = this.cellSize;
    const slack = points.length < rawPoints.length ? tolerance : 0;
    const radius = value === FOGGED ? brushRadius - slack : brushRadius + slack;
    const radiusSq = radius * radius;
    const reach = radius + (size * Math.SQRT2) / 2;
    const reachSq = reach * reach;
    const segments: Array<[ScenePoint, ScenePoint]> = points.length === 1
      ? [[first, first]]
      : points.slice(1).map((point, index): [ScenePoint, ScenePoint] => [points[index]!, point]);
    for (const [a, b] of segments) {
      // A capsule is convex: when it holds the bitmap's corners it holds every cell, so a huge brush costs O(1) per segment.
      if (value === FOGGED ? this.capsuleHoldsBitmap(a, b, radiusSq, 0) : this.capsuleHoldsBitmap(a, b, reachSq, size / 2)) {
        this.cells.fill(value);
        return;
      }
      // Row by row, only the cells near the segment: a long diagonal stroke never scans its whole bounding box.
      const lastRow = Math.min(this.rows - 1, this.row(Math.max(a.y, b.y) + reach));
      for (let row = Math.max(0, this.row(Math.min(a.y, b.y) - reach)); row <= lastRow; row++) {
        const rowTop = this.originY + row * size;
        const span = segmentXSpan(a, b, rowTop - reach, rowTop + size + reach);
        if (!span) continue;
        this.forCells(this.col(span[0] - reach), this.col(span[1] + reach), row, row, (index, left, top) => {
          if (value === FOGGED) {
            if (cellInsideCapsule(left, top, size, a, b, radiusSq)) this.cells[index] = FOGGED;
          } else if (distanceSqToSegment({ x: left + size / 2, y: top + size / 2 }, a, b) <= reachSq) {
            this.cells[index] = CLEAR;
          }
        });
      }
    }
  }

  /** True when all four corners of the bitmap, inset by `inset`, lie within `radiusSq` of segment ab. */
  private capsuleHoldsBitmap(a: ScenePoint, b: ScenePoint, radiusSq: number, inset: number): boolean {
    const left = this.originX + inset;
    const top = this.originY + inset;
    const right = this.originX + this.cols * this.cellSize - inset;
    const bottom = this.originY + this.rows * this.cellSize - inset;
    return [[left, top], [right, top], [left, bottom], [right, bottom]]
      .every(([x, y]) => distanceSqToSegment({ x: x!, y: y! }, a, b) <= radiusSq);
  }

  /**
   * Cells whose centre lies inside the polygon (nonzero winding, as the canvas
   * fills it). Cells an edge crosses are never fogged by paint and always
   * cleared by erase.
   */
  private fillLasso(points: ScenePoint[], value: number): void {
    if (points.length < 3) return;
    const size = this.cellSize;
    const crossed = new Set<number>();
    let top = Infinity;
    let bottom = -Infinity;
    for (let index = 0; index < points.length; index++) {
      const a = points[index]!;
      const b = points[(index + 1) % points.length]!;
      top = Math.min(top, a.y);
      bottom = Math.max(bottom, a.y);
      // Only the part of the edge near the bitmap is walked, so far-away points cost nothing; winding below still sees the whole edge.
      const clipped = clipToRect(
        (a.x - this.originX) / size, (a.y - this.originY) / size,
        (b.x - this.originX) / size, (b.y - this.originY) / size,
        -1, -1, this.cols + 1, this.rows + 1,
      );
      if (!clipped) continue;
      traverseCells(clipped[0], clipped[1], clipped[2], clipped[3], (col, row) => {
        if (col >= 0 && row >= 0 && col < this.cols && row < this.rows) crossed.add(row * this.cols + col);
      });
    }
    const lastRow = Math.min(this.rows - 1, this.row(bottom));
    for (let row = Math.max(0, this.row(top)); row <= lastRow; row++) {
      const y = this.originY + (row + 0.5) * size;
      for (const [from, to] of insideSpans(points, y)) {
        const c0 = Math.max(0, Math.ceil((from - this.originX) / size - 0.5));
        const c1 = Math.min(this.cols - 1, Math.floor((to - this.originX) / size - 0.5));
        for (let col = c0; col <= c1; col++) {
          const index = row * this.cols + col;
          if (value === CLEAR || !crossed.has(index)) this.cells[index] = value;
        }
      }
    }
    if (value === CLEAR) for (const index of crossed) this.cells[index] = CLEAR;
  }
}

/** The x range of segment ab where its y lies within [low, high]; null when it never does. */
function segmentXSpan(a: ScenePoint, b: ScenePoint, low: number, high: number): [number, number] | null {
  if (a.y === b.y) return a.y >= low && a.y <= high ? [Math.min(a.x, b.x), Math.max(a.x, b.x)] : null;
  const tLow = (low - a.y) / (b.y - a.y);
  const tHigh = (high - a.y) / (b.y - a.y);
  const t0 = Math.max(0, Math.min(tLow, tHigh));
  const t1 = Math.min(1, Math.max(tLow, tHigh));
  if (t0 > t1) return null;
  const x0 = a.x + (b.x - a.x) * t0;
  const x1 = a.x + (b.x - a.x) * t1;
  return [Math.min(x0, x1), Math.max(x0, x1)];
}

function cellInsideCapsule(left: number, top: number, size: number, a: ScenePoint, b: ScenePoint, radiusSq: number): boolean {
  return distanceSqToSegment({ x: left, y: top }, a, b) <= radiusSq
    && distanceSqToSegment({ x: left + size, y: top }, a, b) <= radiusSq
    && distanceSqToSegment({ x: left, y: top + size }, a, b) <= radiusSq
    && distanceSqToSegment({ x: left + size, y: top + size }, a, b) <= radiusSq;
}

/** The x ranges of a horizontal line at `y` that lie inside the polygon, by nonzero winding. */
function insideSpans(points: readonly ScenePoint[], y: number): Array<[number, number]> {
  const crossings: Array<{ x: number; winding: number }> = [];
  for (let index = 0; index < points.length; index++) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    if ((a.y <= y) === (b.y <= y)) continue;
    crossings.push({ x: a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x), winding: b.y > a.y ? 1 : -1 });
  }
  crossings.sort((p, q) => p.x - q.x);
  const spans: Array<[number, number]> = [];
  let winding = 0;
  for (let index = 0; index < crossings.length - 1; index++) {
    winding += crossings[index]!.winding;
    if (winding !== 0) spans.push([crossings[index]!.x, crossings[index + 1]!.x]);
  }
  return spans;
}

/** Liang-Barsky: the part of segment (ax, ay)-(bx, by) inside the rectangle, or null when none is. */
function clipToRect(
  ax: number, ay: number, bx: number, by: number, minX: number, minY: number, maxX: number, maxY: number,
): [number, number, number, number] | null {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const sides: Array<[number, number]> = [[-dx, ax - minX], [dx, maxX - ax], [-dy, ay - minY], [dy, maxY - ay]];
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return null;
    }
  }
  return [ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1];
}

/** Every cell a segment passes through, in cell coordinates (Amanatides and Woo). */
function traverseCells(ax: number, ay: number, bx: number, by: number, visit: (col: number, row: number) => void): void {
  let col = Math.floor(ax);
  let row = Math.floor(ay);
  const dx = bx - ax;
  const dy = by - ay;
  const stepCol = dx > 0 ? 1 : -1;
  const stepRow = dy > 0 ? 1 : -1;
  const deltaCol = dx === 0 ? Infinity : Math.abs(1 / dx);
  const deltaRow = dy === 0 ? Infinity : Math.abs(1 / dy);
  let nextCol = dx === 0 ? Infinity : (dx > 0 ? col + 1 - ax : ax - col) * deltaCol;
  let nextRow = dy === 0 ? Infinity : (dy > 0 ? row + 1 - ay : ay - row) * deltaRow;
  visit(col, row);
  for (let steps = Math.abs(Math.floor(bx) - col) + Math.abs(Math.floor(by) - row); steps > 0; steps--) {
    if (nextCol < nextRow) {
      col += stepCol;
      nextCol += deltaCol;
    } else {
      row += stepRow;
      nextRow += deltaRow;
    }
    visit(col, row);
  }
}

/**
 * The area the painting operations reach; erasing outside it changes nothing.
 * One far painted outlier stretches it and coarsens the cells (conservative:
 * more objects are sent, never fewer).
 */
function paintedBounds(ops: readonly FogOperation[]): WorldBounds | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const op of ops) {
    if (op.isErasing) continue;
    const bounds = calculateOperationBounds(op);
    const xs = [bounds.x, bounds.x + bounds.width];
    const ys = [bounds.y, bounds.y + bounds.height];
    if (![...xs, ...ys].every(Number.isFinite)) continue;
    left = Math.min(left, ...xs);
    right = Math.max(right, ...xs);
    top = Math.min(top, ...ys);
    bottom = Math.max(bottom, ...ys);
  }
  return left < right && top < bottom ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}
