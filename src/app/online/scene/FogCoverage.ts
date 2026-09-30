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
import { CLEAR, FOGGED, fillBrush, fillLasso, fillRect, type CellGrid } from './fogRaster';
import { sortedByOrder } from './sceneTypes';
import { finitePoints } from './simplifyPoints';

export const FOG_CELL_SIZE = 8;
/** Beyond this many cells the cell size doubles, so a huge fogged area stays cheap. */
export const MAX_FOG_CELLS = 4_000_000;

export interface WorldBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

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

  private get grid(): CellGrid {
    return { cells: this.cells, cols: this.cols, rows: this.rows, originX: this.originX, originY: this.originY, cellSize: this.cellSize };
  }

  private apply(op: FogOperation): void {
    const dx = finiteOr(op.offsetX, 0);
    const dy = finiteOr(op.offsetY, 0);
    const value = op.isErasing ? CLEAR : FOGGED;
    if (op.type === 'rectangle') {
      fillRect(this.grid, finiteOr(op.x, Number.NaN) + dx, finiteOr(op.y, Number.NaN) + dy,
        finiteOr(op.width, Number.NaN), finiteOr(op.height, Number.NaN), value);
    } else if (op.type === 'brush') {
      fillBrush(this.grid, finitePoints(op.points, dx, dy), finiteOr(op.brushRadius, 0), value);
    } else if (op.type === 'lasso') {
      fillLasso(this.grid, finitePoints(op.points, dx, dy), value);
    }
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
