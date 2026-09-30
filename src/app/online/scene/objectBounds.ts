// src/app/online/scene/objectBounds.ts
/** World-space bounds of scene objects, to test them against the fog coverage. */
import { tokenDiameterInCells } from '../../pixi/token-renderer/tokenSizing';
import type { TextElement } from '../../types';
import { finiteOr, positiveOr, positiveOrNull, textOr } from './coerce';
import type { WorldBounds } from './FogCoverage';
import type { PlayerDrawing } from './sceneTypes';

export const DEFAULT_GRID_SIZE = 70;
export const DEFAULT_FONT_SIZE = 16;
/** Average glyph width and line height in font sizes: the GM side estimates text boxes, it does not measure them. */
export const TEXT_CHAR_WIDTH = 0.6;
export const TEXT_LINE_HEIGHT = 1.25;

/** A token's footprint: its cells (at least one) times the grid size, centred on the token. */
export function tokenBounds(token: { x: number; y: number; size: number }, gridSize: number): WorldBounds {
  const side = Math.max(1, tokenDiameterInCells(token.size)) * gridSize;
  return { x: token.x - side / 2, y: token.y - side / 2, width: side, height: side };
}

/**
 * A text's estimated box, centred on its position like `TextRenderer` draws it.
 * A rotated text gets a square of the box's diagonal, which holds it at any angle.
 */
export function textBounds(text: TextElement): WorldBounds {
  const fontSize = positiveOr(text.fontSize, DEFAULT_FONT_SIZE);
  const padding = Math.max(0, finiteOr(text.padding, 0));
  const scale = positiveOr(text.scale, 1);
  const lines = textOr(text.text, '').split('\n');
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 1);
  const width = ((positiveOrNull(text.width) ?? longest * fontSize * TEXT_CHAR_WIDTH) + 2 * padding) * scale;
  const height = ((positiveOrNull(text.height) ?? lines.length * fontSize * TEXT_LINE_HEIGHT) + 2 * padding) * scale;
  const rotated = finiteOr(text.rotation, 0) % 360 !== 0;
  const boxWidth = rotated ? Math.hypot(width, height) : width;
  const boxHeight = rotated ? boxWidth : height;
  const x = finiteOr(text.x, 0);
  const y = finiteOr(text.y, 0);
  return { x: x - boxWidth / 2, y: y - boxHeight / 2, width: boxWidth, height: boxHeight };
}

/** The bounds of a drawing's points, grown by its full width on every side. */
export function drawingBounds(drawing: Pick<PlayerDrawing, 'points' | 'width'>): WorldBounds {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const point of drawing.points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  const pad = drawing.width;
  return { x: left - pad, y: top - pad, width: right - left + 2 * pad, height: bottom - top + 2 * pad };
}
