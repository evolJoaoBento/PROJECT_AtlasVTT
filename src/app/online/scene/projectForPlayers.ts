/**
 * The only place that decides what leaves the GM's machine: the presented
 * scene as online players may see it, exactly what the local player window
 * shows and nothing more. Every sent object is built field by field from the
 * GM's records, never spread, so anything this code does not name, including
 * fields a later Atlas adds, is left out.
 */
import { DEFAULT_HEX_NUMBER_OPACITY, isHexNumberFormat } from '../../grid/hexNumbering';
import { tokenHp, tokenStress } from '../../pixi/token-renderer/tokenResources';
import type { GridState } from '../../services/MapPersistence';
import type { ViewAtlasState } from '../../storeFactory';
import type { Character, TokenEntity } from '../../types';
import type { AssetRegistry } from './AssetRegistry';
import { finiteOr, finiteOrNull, hpOrNull, oneOf, positiveOr, resourceOrNull, textOr, textOrNull, unitOr } from './coerce';
import type { FogCoverage } from './FogCoverage';
import { DEFAULT_GRID_SIZE, tokenBounds } from './objectBounds';
import type { PlayerViewRules } from './playerViewRules';
import { projectInitiative, projectWidgets } from './projectPanels';
import { projectDrawings, projectFog, projectRecord, projectTexts, type ProjectionMemo } from './projectRecords';
import {
  PLAYER_GRID_LINES, PLAYER_GRID_TYPES, SCENE_LIMITS, SCENE_RANGES,
  type MapSize, type PlayerCondition, type PlayerGrid, type PlayerMap, type PlayerScene, type PlayerToken,
} from './sceneTypes';

export type ProjectedState = Pick<
  ViewAtlasState,
  'background' | 'grid' | 'objects' | 'widgetSettings' | 'widgetValues' | 'initiative' | 'initiativeTrackerOpen'
>;

export interface ProjectionContext {
  sceneId: string;
  rules: PlayerViewRules;
  /** Rebuilt by the caller only when the fog operations change. */
  coverage: FogCoverage;
  assets: AssetRegistry;
  mapSize: MapSize;
  memo: ProjectionMemo;
}

const DEFAULT_RING = '#ffffff';
const DEFAULT_GRID_OPACITY = 0.7;

export function projectForPlayers(state: ProjectedState, context: ProjectionContext): PlayerScene {
  const objects = state.objects;
  // Raw (finite, positive) size for local coverage checks; the wire gets the clamped value.
  const cellSize = positiveOr(state.grid?.size, DEFAULT_GRID_SIZE);
  const tokens = projectRecord(objects?.tokens, (token) => projectToken(token, context, cellSize));
  return {
    sceneId: context.sceneId,
    map: projectMap(state.background, cellSize, context),
    grid: projectGrid(state.grid, context.rules),
    tokens,
    fog: projectFog(objects?.fog, context.memo),
    texts: projectTexts(objects?.texts, context.coverage),
    drawings: projectDrawings(objects?.drawings, context.coverage, context.memo),
    widgets: projectWidgets(state, context.rules),
    initiative: projectInitiative(state, new Set(Object.keys(tokens)), context.rules),
  };
}

function projectMap(background: string | null, cellSize: number, context: ProjectionContext): PlayerMap {
  return {
    asset: context.assets.idFor(background),
    width: finiteOr(context.mapSize.width, 0, SCENE_RANGES.mapSize),
    height: finiteOr(context.mapSize.height, 0, SCENE_RANGES.mapSize),
    cellSize: positiveOr(cellSize, DEFAULT_GRID_SIZE, SCENE_RANGES.cellSize),
  };
}

function projectGrid(grid: GridState | null, rules: PlayerViewRules): PlayerGrid | null {
  if (!rules.showGrid || !grid || grid.enabled === false || grid.visible === false) return null;
  const hexNumbers = isHexNumberFormat(grid.hexNumbers) ? grid.hexNumbers : null;
  return {
    type: oneOf(PLAYER_GRID_TYPES, grid.type, 'square'),
    size: positiveOr(grid.size, DEFAULT_GRID_SIZE, SCENE_RANGES.gridSize),
    offsetX: finiteOr(grid.offsetX, 0, SCENE_RANGES.coordinate),
    offsetY: finiteOr(grid.offsetY, 0, SCENE_RANGES.coordinate),
    color: textOrNull(grid.color),
    opacity: unitOr(grid.opacity, DEFAULT_GRID_OPACITY),
    lineType: oneOf(PLAYER_GRID_LINES, grid.lineType, 'solid'),
    lineWidth: positiveOr(grid.lineWidth, 1, SCENE_RANGES.stroke),
    hexNumbers,
    hexNumberOpacity: hexNumbers ? unitOr(grid.hexNumberOpacity, DEFAULT_HEX_NUMBER_OPACITY) : null,
  };
}

function projectToken(token: TokenEntity, context: ProjectionContext, cellSize: number): PlayerToken | null {
  // Any truthy value hides, as in the local window (`playerSafeFrame`, `PlayerInitiativePanel`).
  if (token.isHidden) return null;
  const x = finiteOrNull(token.x);
  const y = finiteOrNull(token.y);
  if (x === null || y === null) return null;
  const size = positiveOr(token.size, 1);
  // Coverage sees what the GM draws (raw values); the wire gets clamped values.
  if (context.coverage.isCovered(tokenBounds({ x, y, size }, cellSize))) return null;
  const character = token.kind === 'character' ? token : null;
  const { rules } = context;
  return {
    x: finiteOr(x, 0, SCENE_RANGES.coordinate),
    y: finiteOr(y, 0, SCENE_RANGES.coordinate),
    size: finiteOr(size, 1, SCENE_RANGES.tokenSize),
    rotation: finiteOr(token.rotation, 0),
    layer: finiteOr(token.layer, 0),
    image: context.assets.idFor(token.imagePath),
    ring: token.showRing === false ? null : textOr(token.ringColor, DEFAULT_RING),
    conditions: character ? projectConditions(token) : [],
    name: character && rules.showTokenNameplates ? displayName(character) : null,
    hp: character && rules.showTokenHP ? hpOrNull(tokenHp(character)) : null,
    stress: character && rules.showTokenStress ? resourceOrNull(tokenStress(character)) : null,
  };
}

/** The nameplate text `TokenUIRenderer` shows: the name, the statblock's name, or a placeholder for a statblock. */
function displayName(token: Character): string | null {
  return textOrNull(token.name) ?? (token.statblockPath ? textOrNull(token.statblockName) ?? 'Unknown Creature' : null);
}

function projectConditions(token: TokenEntity): PlayerCondition[] {
  const ids: unknown[] = Array.isArray(token.conditions) ? token.conditions : [];
  const values: Record<string, unknown> = typeof token.conditionValues === 'object' && token.conditionValues !== null
    ? token.conditionValues
    : {};
  return ids
    .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= SCENE_LIMITS.idLength)
    .slice(0, SCENE_LIMITS.conditions)
    .map((id) => ({ id, value: Object.hasOwn(values, id) ? finiteOrNull(values[id]) : null }));
}
