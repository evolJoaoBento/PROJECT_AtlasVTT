/**
 * Atlas's grid: square lines or hex outlines over the visible part of the map (Atlas
 * clips its grid to the map), dashed or dotted by line type, and hex numbers when the
 * GM shows them and they are large enough to read.
 */
import { createHexLayout, isHexGridType } from '../../../grid/hexGeometry';
import {
  DEFAULT_HEX_NUMBER_OPACITY, hexNumberAnchor, hexNumberFontSize, MIN_HEX_NUMBER_SCREEN_SIZE, numberHexes, type NumberedHex,
} from '../../../grid/hexNumbering';
import { gridLines, type GridLimits } from '../../preview/previewShapes';
import type { PlayerGrid, PlayerMap } from '../../scene/sceneTypes';
import { intersection, type WorldRect } from '../camera';
import type { TextStyle, ViewSurface } from '../ViewSurface';
import type { LayerFrame, PlayerLayer } from './layerTypes';

const DEFAULT_NUMBER_COLOR = '#ffffff';
/** Beyond this many hexes on the map, numbering them costs more than they are worth. */
export const MAX_NUMBERED_HEXES = 100_000;
/** The view only builds what is on screen, so its caps are far above the preview's. */
const VIEW_LIMITS: GridLimits = { lines: 100_000, hexes: MAX_NUMBERED_HEXES };

interface Numbered {
  grid: PlayerGrid;
  width: number;
  height: number;
  hexes: NumberedHex[];
}

export function createGridLayer(): PlayerLayer {
  // Numbering every hex of the map runs once per grid and map size, not per frame.
  let numbered: Numbered | null = null;
  const numbersOf = (grid: PlayerGrid, map: PlayerMap): NumberedHex[] => {
    if (numbered === null || numbered.grid !== grid || numbered.width !== map.width || numbered.height !== map.height) {
      numbered = { grid, width: map.width, height: map.height, hexes: hexNumbersOf(grid, map) };
    }
    return numbered.hexes;
  };
  return {
    draw(surface, frame): void {
      const { grid, map } = frame.scene;
      if (!grid) return;
      const area = map.width > 0 && map.height > 0
        ? intersection(frame.visible, { x: 0, y: 0, width: map.width, height: map.height })
        : frame.visible;
      if (!area) return;
      drawLines(surface, frame, grid, area);
      drawHexNumbers(surface, frame, grid, numbersOf(grid, map));
    },
  };
}

function drawLines(surface: ViewSurface, frame: LayerFrame, grid: PlayerGrid, area: WorldRect): void {
  const lines = gridLines(grid, area, VIEW_LIMITS);
  if (!lines) return;
  const style = {
    stroke: lines.color,
    alpha: lines.alpha,
    lineWidth: Math.max(lines.width, frame.pixel),
    // The dash pattern is in screen pixels, so dashes keep their look at any zoom.
    dash: lines.dash.map((length) => length / frame.zoom),
  };
  if (lines.segments.length > 0) surface.paths(lines.segments, false, style);
  if (lines.hexes.length > 0) surface.paths(lines.hexes, true, style);
}

function hexNumbersOf(grid: PlayerGrid, map: PlayerMap): NumberedHex[] {
  if (!grid.hexNumbers || !isHexGridType(grid.type) || !(map.width > 0) || !(map.height > 0)) return [];
  if ((map.width * map.height) / (grid.size * grid.size * 0.866) > MAX_NUMBERED_HEXES) return [];
  const layout = createHexLayout(grid.type, grid.size, grid.offsetX, grid.offsetY);
  return numberHexes(layout, { x: 0, y: 0, width: map.width, height: map.height }, grid.hexNumbers);
}

function drawHexNumbers(surface: ViewSurface, frame: LayerFrame, grid: PlayerGrid, hexes: readonly NumberedHex[]): void {
  if (hexes.length === 0 || !isHexGridType(grid.type)) return;
  const layout = createHexLayout(grid.type, grid.size, grid.offsetX, grid.offsetY);
  const size = hexNumberFontSize(layout);
  if (size * frame.zoom < MIN_HEX_NUMBER_SCREEN_SIZE) return;
  const style: TextStyle = {
    font: `bold ${size}px Arial, sans-serif`,
    color: grid.color ?? DEFAULT_NUMBER_COLOR,
    align: 'center',
    alpha: grid.hexNumberOpacity ?? DEFAULT_HEX_NUMBER_OPACITY,
  };
  const { visible } = frame;
  for (const hex of hexes) {
    const at = hexNumberAnchor(layout, hex.center);
    if (at.x < visible.x || at.x > visible.x + visible.width || at.y < visible.y || at.y > visible.y + visible.height) continue;
    surface.text(hex.label, at.x, at.y, style);
  }
}
