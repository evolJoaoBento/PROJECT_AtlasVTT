/**
 * What online players receive of the presented scene. Shared with the web
 * player page, so this file imports nothing. Every field is `T | null`, never
 * optional: JSON drops `undefined`, and both sides compare by value.
 */
export interface ScenePoint {
  x: number;
  y: number;
}

export interface MapSize {
  width: number;
  height: number;
}

export interface PlayerMap {
  /** The background as an asset id; null without one. */
  asset: string | null;
  /** The loaded background's size in world pixels; 0 × 0 without one. */
  width: number;
  height: number;
  /** Grid cell size in world pixels, sent even when the grid is hidden so tokens keep their size. */
  cellSize: number;
}

export const PLAYER_GRID_TYPES = ['square', 'hex-horizontal', 'hex-vertical'] as const;
export type PlayerGridType = typeof PLAYER_GRID_TYPES[number];
export const PLAYER_GRID_LINES = ['solid', 'dashed', 'dotted'] as const;
export type PlayerGridLine = typeof PLAYER_GRID_LINES[number];
export const PLAYER_HEX_NUMBERS = ['column-row', 'sequential'] as const;
export type PlayerHexNumbers = typeof PLAYER_HEX_NUMBERS[number];

export interface PlayerGrid {
  type: PlayerGridType;
  size: number;
  offsetX: number;
  offsetY: number;
  color: string | null;
  opacity: number;
  lineType: PlayerGridLine;
  lineWidth: number;
  hexNumbers: PlayerHexNumbers | null;
  hexNumberOpacity: number | null;
}

export interface PlayerResource {
  current: number;
  max: number;
}

export interface PlayerCondition {
  id: string;
  /** The number of a valued condition; null when the token stores none. */
  value: number | null;
}

export interface PlayerToken {
  x: number;
  y: number;
  /** Size in cells, as `BaseToken.size`. */
  size: number;
  rotation: number;
  layer: number;
  image: string | null;
  /** Ring colour; null when the token shows no ring. */
  ring: string | null;
  conditions: PlayerCondition[];
  name: string | null;
  hp: PlayerResource | null;
  stress: PlayerResource | null;
}

/** A fog operation with its drag offset applied and its points simplified. */
export type PlayerFogOp =
  | { type: 'brush'; erase: boolean; order: number; radius: number; points: ScenePoint[] }
  | { type: 'lasso'; erase: boolean; order: number; points: ScenePoint[] }
  | { type: 'rectangle'; erase: boolean; order: number; x: number; y: number; width: number; height: number };

export const PLAYER_TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export type PlayerTextAlign = typeof PLAYER_TEXT_ALIGNS[number];

export interface PlayerText {
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  backgroundColor: string | null;
  padding: number;
  borderRadius: number;
  opacity: number;
  width: number | null;
  height: number | null;
  align: PlayerTextAlign;
  bold: boolean;
  italic: boolean;
  rotation: number;
  scale: number;
}

export const PLAYER_DRAWING_TYPES = ['pen', 'eraser', 'line', 'rectangle', 'circle', 'icon'] as const;
export type PlayerDrawingType = typeof PLAYER_DRAWING_TYPES[number];

export interface PlayerDrawing {
  type: PlayerDrawingType;
  order: number;
  points: ScenePoint[];
  color: string;
  width: number;
  opacity: number;
  icon: string | null;
}

export const PLAYER_WIDGET_TYPES = ['counter', 'clock', 'timer'] as const;
export type PlayerWidgetType = typeof PLAYER_WIDGET_TYPES[number];

export interface PlayerWidget {
  id: string;
  type: PlayerWidgetType;
  label: string;
  icon: string;
  /** Counters and clocks: the count; timers: the remaining seconds. */
  value: number;
}

export interface PlayerInitiativeEntry {
  id: string;
  tokenId: string;
  initiative: number;
  name: string | null;
  hp: PlayerResource | null;
  isActive: boolean;
}

export interface PlayerInitiative {
  round: number;
  /** Whether combat is running. */
  active: boolean;
  entries: PlayerInitiativeEntry[];
}

export interface PlayerScene {
  /** Random per presentation: a new presentation or scene gets a new id. */
  sceneId: string;
  map: PlayerMap;
  grid: PlayerGrid | null;
  tokens: Record<string, PlayerToken>;
  fog: Record<string, PlayerFogOp>;
  texts: Record<string, PlayerText>;
  drawings: Record<string, PlayerDrawing>;
  widgets: PlayerWidget[];
  initiative: PlayerInitiative | null;
}

/** A snapshot's scene: everything but the fog and the drawings, which follow in parts. */
export type PlayerSceneBody = Omit<PlayerScene, 'fog' | 'drawings'>;

/** Fields diffed per record, by id. */
export const SCENE_RECORD_KEYS = ['tokens', 'fog', 'texts', 'drawings'] as const;
export type SceneRecordKey = typeof SCENE_RECORD_KEYS[number];
/** Fields replaced as a whole when they differ. */
export const SCENE_FIELD_KEYS = ['map', 'grid', 'widgets', 'initiative'] as const;
export type SceneFieldKey = typeof SCENE_FIELD_KEYS[number];

export interface ScenePatchBody {
  set: Partial<Pick<PlayerScene, SceneFieldKey>>;
  upsert: Partial<Pick<PlayerScene, SceneRecordKey>>;
  remove: Partial<Record<SceneRecordKey, string[]>>;
}

/** Bounds both sides hold scene data to; the projection clips to them so its output always validates. */
export const SCENE_LIMITS = {
  idLength: 128,
  stringLength: 512,
  textLength: 10_000,
  /** Keeps one fog operation well under a fog part's budget. */
  points: 5_000,
  records: 10_000,
  conditions: 64,
  widgets: 64,
  initiativeEntries: 200,
} as const;

/** Records in replay order: by `orderOf`, then by id, so both sides agree on ties. */
export function sortedByOrder<T>(records: Readonly<Record<string, T>>, orderOf: (record: T) => number): Array<[string, T]> {
  return Object.entries(records).sort(([idA, a], [idB, b]) => {
    const byOrder = orderOf(a) - orderOf(b);
    if (byOrder !== 0) return byOrder;
    return idA < idB ? -1 : idA > idB ? 1 : 0;
  });
}

type Range = readonly [min: number, max: number];

/** Inclusive numeric bounds both sides hold scene values to, so no value can stall a renderer. */
export const SCENE_RANGES = {
  gridSize: [1, 10_000],
  cellSize: [1, 10_000],
  mapSize: [0, 200_000],
  coordinate: [-10_000_000, 10_000_000],
  stroke: [0, 10_000],
  fontSize: [1, 1_000],
  textScale: [0.01, 100],
  tokenSize: [0.05, 100],
  textBox: [0, 200_000],
  opacity: [0, 1],
} as const satisfies Record<string, Range>;
