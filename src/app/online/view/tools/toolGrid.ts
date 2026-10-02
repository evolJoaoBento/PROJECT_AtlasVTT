/**
 * The grid the player's measuring tools use. It is the grid players see, snapped to cell centres
 * like the GM's drop (`cellCenterAt`). Without one, it is a square grid of the map's cell size,
 * never snapped, since the grid's offset is not sent. Distances are labelled with the GM's
 * measurement settings, as Atlas's ruler labels them. Shared with the web page.
 */
import { cellCenterAt, type GridGeometry } from '../../../grid/gridDistance';
import { dragRulerLabel } from '../../../pixi/token-renderer/dragRulerPath';
import type { PlayerScene, ScenePoint } from '../../scene/sceneTypes';

export interface ToolGrid {
  geometry: GridGeometry;
  /** Where a measured point lands. */
  snap(point: ScenePoint): ScenePoint;
  /** The distance along `points`, e.g. "30ft" or a range band's name. */
  label(points: readonly ScenePoint[]): string;
}

export function toolGridOf(scene: PlayerScene): ToolGrid {
  const grid = scene.grid;
  const geometry: GridGeometry = grid
    ? { type: grid.type, size: grid.size, offsetX: grid.offsetX, offsetY: grid.offsetY }
    : { type: 'square', size: scene.map.cellSize, offsetX: 0, offsetY: 0 };
  return {
    geometry,
    snap: (point) => (grid ? cellCenterAt(geometry, point) : { x: point.x, y: point.y }),
    label: (points) => dragRulerLabel(geometry, points, scene.measurement),
  };
}
