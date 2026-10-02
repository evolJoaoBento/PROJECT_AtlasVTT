/**
 * The player tools' messages: dice rolls, the shared dice log and lasers. Their types, limits
 * and checks, shared with the web player page, so this file imports only shared modules.
 */
import { isDieType, type DiceRollResult, type DiceSelection } from '../../tools/diceRolling';
import { SCENE_RANGES, type ScenePoint } from '../scene/sceneTypes';
import { isSceneId } from '../scene/sceneValidation';

export const DICE_LIMITS = {
  /** Dice in one player roll. */
  dicePerRoll: 20,
  /** A player roll's modifier lies within ±1000. */
  modifier: 1000,
  rollsPerSecond: 2,
  /** Entries a player gets on admission. */
  logEntries: 50,
  /** Dice listed in one entry; a larger GM roll lists its first 100, and its total still counts them all. */
  entryDice: 100,
  nameLength: 80,
  formulaLength: 200,
} as const;

/** `maxGapMs`: the longest gap a point's `dt` may state (a laser held still is kept alive, not timed). */
export const LASER_LIMITS = { points: 64, perSecond: 30, maxGapMs: 2000 } as const;

/** The name of a roll that is neither an online player's nor that of a visible token on the live presented scene. */
export const GM_ROLLER_NAME = 'GM';

/** One roll in the shared dice log. */
export interface DiceLogEntry {
  id: string;
  /** An online player's name ("GM (player)" for one called GM), a visible token's on the live presented scene, or "GM". */
  name: string;
  formula: string;
  dice: Array<{ die: string; value: number }>;
  modifier: number;
  total: number;
  /** When it was rolled: milliseconds since 1970 on the GM's clock. */
  at: number;
  /** Thrown with physical dice on the roller's own device, which read the faces; absent for rolls the GM's side made. */
  physical?: boolean;
}

/** Someone's laser as a player receives it: new points of it, and whether it was let go. */
export interface PlayerLaser {
  from: string;
  sceneId: string;
  points: ScenePoint[];
  lifted: boolean;
  /** Milliseconds from each point to the one before it in the stroke (0 for its first), when the sender timed them. */
  dt?: number[];
  /** The laser's colour, `#rrggbb`: the sender's pick, or the one the GM gave it. */
  color?: string;
}

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isText = (value: unknown, min: number, max: number): value is string =>
  typeof value === 'string' && value.length >= min && value.length <= max;
/** `d` and 1 to 9999 sides. */
const DIE = /^d([1-9]\d{0,3})$/;

/** 1 to 20 dice of the tray's kinds, each count a whole number. */
export function isDiceSelection(value: unknown): value is DiceSelection {
  if (!isFields(value)) return false;
  let total = 0;
  for (const [die, count] of Object.entries(value)) {
    if (!isDieType(die) || !Number.isSafeInteger(count) || (count as number) < 0) return false;
    total += count as number;
  }
  return total >= 1 && total <= DICE_LIMITS.dicePerRoll;
}

export function isDiceModifier(value: unknown): value is number {
  return Number.isSafeInteger(value) && Math.abs(value as number) <= DICE_LIMITS.modifier;
}

function isLoggedDie(value: unknown): value is { die: string; value: number } {
  if (!isFields(value) || typeof value.die !== 'string') return false;
  const sides = DIE.exec(value.die)?.[1];
  return sides !== undefined && Number.isSafeInteger(value.value) && (value.value as number) >= 1 && (value.value as number) <= Number(sides);
}

export function isDiceLogEntry(value: unknown): value is DiceLogEntry {
  return isFields(value) && isSceneId(value.id) && isText(value.name, 1, DICE_LIMITS.nameLength)
    && isText(value.formula, 0, DICE_LIMITS.formulaLength)
    && Array.isArray(value.dice) && value.dice.length <= DICE_LIMITS.entryDice && value.dice.every((die) => isLoggedDie(die))
    && isFiniteNumber(value.modifier) && isFiniteNumber(value.total) && isFiniteNumber(value.at)
    && (value.physical === undefined || typeof value.physical === 'boolean');
}

export function isDiceLogEntries(value: unknown): value is DiceLogEntry[] {
  return Array.isArray(value) && value.length <= DICE_LIMITS.logEntries && value.every((entry) => isDiceLogEntry(entry));
}

/** At most 64 points, each within the scene's coordinate range. */
export function isLaserPoints(value: unknown): value is ScenePoint[] {
  const [min, max] = SCENE_RANGES.coordinate;
  const inRange = (number: unknown): boolean => isFiniteNumber(number) && number >= min && number <= max;
  return Array.isArray(value) && value.length <= LASER_LIMITS.points
    && value.every((point) => isFields(point) && inRange(point.x) && inRange(point.y));
}

/** Absent, or one gap in milliseconds (0 to `LASER_LIMITS.maxGapMs`) per point. */
export function isLaserTimes(value: unknown, points: readonly unknown[]): value is number[] | undefined {
  if (value === undefined) return true;
  return Array.isArray(value) && value.length === points.length
    && value.every((gap) => isFiniteNumber(gap) && gap >= 0 && gap <= LASER_LIMITS.maxGapMs);
}

const LASER_COLOR = /^#[0-9a-f]{6}$/i;

/** A `#rrggbb` colour. */
export function isLaserColor(value: unknown): value is string {
  return typeof value === 'string' && LASER_COLOR.test(value);
}

/** A roll as the dice log shows it, under `name`, clipped to the limits; null when players would refuse it anyway. */
export function diceLogEntry(result: DiceRollResult, name: string): DiceLogEntry | null {
  const dice = result.rolls.map(({ die, value }) => ({ die, value })).filter((die) => isLoggedDie(die)).slice(0, DICE_LIMITS.entryDice);
  const entry: DiceLogEntry = {
    id: result.id,
    name: name.slice(0, DICE_LIMITS.nameLength),
    formula: result.formula.slice(0, DICE_LIMITS.formulaLength),
    dice,
    modifier: result.modifiers,
    total: result.total,
    at: result.timestamp,
    ...(result.playerDevice ? { physical: true } : {}),
  };
  return isDiceLogEntry(entry) ? entry : null;
}
