/**
 * Where the join page's preview draws the scene. Shared with the web player
 * page, so it imports nothing from Obsidian.
 */
import { tokenDiameterInCells } from '../../pixi/token-renderer/tokenSizing';
import type { PlayerScene } from '../scene/sceneTypes';

export interface PreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Screen position = world position × scale + offset. */
export interface PreviewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export const PREVIEW_PADDING = 16;
/** A grid without a map or tokens shows this many cells each way. */
const EMPTY_GRID_CELLS = 10;

/** A token's footprint in world pixels: its cells (at least one) times the cell size. */
export function tokenDiameter(size: number, cellSize: number): number {
  return Math.max(1, tokenDiameterInCells(size)) * cellSize;
}

/** The world area to show: the map; without a map size the tokens plus a cell around them; else ten cells of grid. */
export function sceneWorldBounds(scene: PlayerScene): PreviewRect | null {
  const { map } = scene;
  if (map.width > 0 && map.height > 0) return { x: 0, y: 0, width: map.width, height: map.height };
  const cell = map.cellSize;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const token of Object.values(scene.tokens)) {
    const radius = tokenDiameter(token.size, cell) / 2;
    left = Math.min(left, token.x - radius);
    top = Math.min(top, token.y - radius);
    right = Math.max(right, token.x + radius);
    bottom = Math.max(bottom, token.y + radius);
  }
  if (left <= right) return { x: left - cell, y: top - cell, width: right - left + 2 * cell, height: bottom - top + 2 * cell };
  if (scene.grid) {
    return { x: scene.grid.offsetX, y: scene.grid.offsetY, width: cell * EMPTY_GRID_CELLS, height: cell * EMPTY_GRID_CELLS };
  }
  return null;
}

/** Scales `world` to fit the viewport inside the padding, centred. */
export function fitTransform(
  world: PreviewRect,
  viewport: { width: number; height: number },
  padding: number = PREVIEW_PADDING,
): PreviewTransform {
  const availableWidth = Math.max(1, viewport.width - 2 * padding);
  const availableHeight = Math.max(1, viewport.height - 2 * padding);
  const scale = Math.min(availableWidth / Math.max(1, world.width), availableHeight / Math.max(1, world.height));
  return {
    scale,
    offsetX: (viewport.width - world.width * scale) / 2 - world.x * scale,
    offsetY: (viewport.height - world.height * scale) / 2 - world.y * scale,
  };
}
