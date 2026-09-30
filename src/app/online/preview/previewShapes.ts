/**
 * What the join page's preview draws, as plain shapes in world coordinates.
 * Shared with the web player page; the canvas layer (`online-client/preview.mts`)
 * only turns these into canvas calls.
 */
import { axialToPixel, createHexLayout, hexVertices, isHexGridType, pixelToAxial } from '../../grid/hexGeometry';
import {
  sortedByOrder, type PlayerDrawing, type PlayerFogOp, type PlayerGrid, type PlayerScene, type PlayerText,
  type PlayerTextAlign, type ScenePoint,
} from '../scene/sceneTypes';
import { tokenDiameter, type PreviewRect } from './previewLayout';

/** Beyond this many lines or hexes the grid is too fine to be worth drawing. */
export const MAX_GRID_LINES = 2000;
export const MAX_GRID_HEXES = 5000;
const DEFAULT_GRID_COLOR = '#808080';
const DEFAULT_TOKEN_COLOR = '#9aa0a6';
/** Token circles are drawn a little inside their footprint, like the token art. */
const TOKEN_FILL = 0.9;

export interface GridLines {
  segments: Array<[ScenePoint, ScenePoint]>;
  hexes: ScenePoint[][];
  color: string;
  alpha: number;
  width: number;
  /** Dash pattern in screen pixels; empty for solid lines. */
  dash: number[];
}

export type FogShape =
  | { kind: 'stroke'; erase: boolean; points: ScenePoint[]; width: number }
  | { kind: 'polygon'; erase: boolean; points: ScenePoint[] }
  | { kind: 'rect'; erase: boolean; x: number; y: number; width: number; height: number };

export interface InkStroke {
  points: ScenePoint[];
  color: string;
  width: number;
  alpha: number;
  /** Icons and single points are drawn as a dot of the stroke's width. */
  dot: boolean;
}

export interface TextLabel {
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
  alpha: number;
  align: PlayerTextAlign;
}

export interface TokenMarker {
  x: number;
  y: number;
  radius: number;
  color: string;
  label: string | null;
  /** Remaining HP from 0 to 1; null when HP is not shown. */
  hp: number | null;
}

function dashFor(lineType: PlayerGrid['lineType']): number[] {
  if (lineType === 'dashed') return [6, 4];
  if (lineType === 'dotted') return [1, 3];
  return [];
}

export function gridLines(grid: PlayerGrid, area: PreviewRect): GridLines | null {
  const style = { color: grid.color ?? DEFAULT_GRID_COLOR, alpha: grid.opacity, width: grid.lineWidth, dash: dashFor(grid.lineType) };
  if (isHexGridType(grid.type)) {
    const hexes = hexOutlines(grid, area);
    return hexes ? { segments: [], hexes, ...style } : null;
  }
  const segments = squareLines(grid, area);
  return segments ? { segments, hexes: [], ...style } : null;
}

function squareLines(grid: PlayerGrid, area: PreviewRect): Array<[ScenePoint, ScenePoint]> | null {
  if (Math.floor(area.width / grid.size) + Math.floor(area.height / grid.size) + 2 > MAX_GRID_LINES) return null;
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  const first = (start: number, offset: number): number => offset + Math.ceil((start - offset) / grid.size) * grid.size;
  const segments: Array<[ScenePoint, ScenePoint]> = [];
  for (let x = first(area.x, grid.offsetX); x <= right; x += grid.size) segments.push([{ x, y: area.y }, { x, y: bottom }]);
  for (let y = first(area.y, grid.offsetY); y <= bottom; y += grid.size) segments.push([{ x: area.x, y }, { x: right, y }]);
  return segments;
}

function hexOutlines(grid: PlayerGrid, area: PreviewRect): ScenePoint[][] | null {
  if (grid.type === 'square') return null;
  const layout = createHexLayout(grid.type, grid.size, grid.offsetX, grid.offsetY);
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  const corners = [
    { x: area.x, y: area.y }, { x: right, y: area.y }, { x: area.x, y: bottom }, { x: right, y: bottom },
  ].map((point) => pixelToAxial(layout, point));
  const qMin = Math.min(...corners.map((hex) => hex.q)) - 1;
  const qMax = Math.max(...corners.map((hex) => hex.q)) + 1;
  const rMin = Math.min(...corners.map((hex) => hex.r)) - 1;
  const rMax = Math.max(...corners.map((hex) => hex.r)) + 1;
  if ((qMax - qMin + 1) * (rMax - rMin + 1) > MAX_GRID_HEXES * 4) return null;
  const reach = grid.size;
  const hexes: ScenePoint[][] = [];
  for (let q = qMin; q <= qMax; q++) {
    for (let r = rMin; r <= rMax; r++) {
      const center = axialToPixel(layout, { q, r });
      if (center.x < area.x - reach || center.x > right + reach || center.y < area.y - reach || center.y > bottom + reach) continue;
      hexes.push(hexVertices(layout, center));
      if (hexes.length > MAX_GRID_HEXES) return null;
    }
  }
  return hexes;
}

/** Fog operations in replay order; brushes become round strokes twice their radius wide. */
export function fogShapes(fog: Readonly<Record<string, PlayerFogOp>>): FogShape[] {
  return sortedByOrder(fog, (op) => op.order).map(([, op]): FogShape => {
    if (op.type === 'brush') return { kind: 'stroke', erase: op.erase, points: op.points, width: op.radius * 2 };
    if (op.type === 'lasso') return { kind: 'polygon', erase: op.erase, points: op.points };
    return { kind: 'rect', erase: op.erase, x: op.x, y: op.y, width: op.width, height: op.height };
  });
}

export function inkStrokes(drawings: Readonly<Record<string, PlayerDrawing>>): InkStroke[] {
  return sortedByOrder(drawings, (drawing) => drawing.order)
    .filter(([, drawing]) => drawing.type !== 'eraser')
    .map(([, drawing]) => ({
      points: drawing.points,
      color: drawing.color,
      width: drawing.width,
      alpha: drawing.opacity,
      dot: drawing.type === 'icon' || drawing.points.length === 1,
    }));
}

export function textLabels(texts: Readonly<Record<string, PlayerText>>): TextLabel[] {
  return Object.values(texts).map((text) => ({
    x: text.x, y: text.y, text: text.text, size: text.fontSize * text.scale, color: text.color, alpha: text.opacity, align: text.align,
  }));
}

/** One circle per token, lowest layer first. */
export function tokenMarkers(scene: PlayerScene): TokenMarker[] {
  return Object.values(scene.tokens)
    .sort((a, b) => a.layer - b.layer)
    .map((token) => ({
      x: token.x,
      y: token.y,
      radius: (tokenDiameter(token.size, scene.map.cellSize) / 2) * TOKEN_FILL,
      color: token.ring ?? DEFAULT_TOKEN_COLOR,
      label: token.name ? initials(token.name) : null,
      hp: token.hp && token.hp.max > 0 ? Math.min(1, Math.max(0, token.hp.current / token.hp.max)) : null,
    }));
}

/** Two letters for a token: the first letters of its first two words, or the first two of a single word. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word.length > 0);
  const [first, second] = words;
  if (!first) return '';
  if (!second) return Array.from(first).slice(0, 2).join('').toUpperCase();
  return `${Array.from(first)[0] ?? ''}${Array.from(second)[0] ?? ''}`.toUpperCase();
}
