/**
 * Physical dice from the join page: a player throws Atlas's 3D dice on their own device, which
 * reads the faces and sends them as `dice-physical`. This checks what a player sent is possible
 * and builds the roll Atlas logs from it, its formula and total worked out here, never taken from
 * the player. Shared with the web player page, so this file imports only shared modules.
 */
import {
  buildRollResult, diceFormula, isDieType, parseDiceFormula, type DiceRollResult, type DiceSelection, type DieType,
} from '../../tools/diceRolling';
import { DICE_LIMITS } from './toolMessages';

/** One die of a physical roll: its type and the number it came up on, as a player calls it (a d10's 0 is 10, a d100 1 to 100). */
export interface PhysicalDie {
  type: DieType;
  value: number;
}

/** A die type's sides: a d100 has 100. */
export function dieSides(type: DieType): number {
  return Number(type.slice(1));
}

function isPhysicalDie(value: unknown): value is PhysicalDie {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!Object.hasOwn(value, 'type') || !Object.hasOwn(value, 'value')) return false;
  const { type, value: face } = value as Record<string, unknown>;
  return isDieType(type) && Number.isSafeInteger(face) && (face as number) >= 1 && (face as number) <= dieSides(type);
}

/** 1 to 20 dice of the tray's kinds, each on a face it has. */
export function isPhysicalDice(value: unknown): value is PhysicalDie[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= DICE_LIMITS.dicePerRoll && value.every((die) => isPhysicalDie(die));
}

/**
 * The roll a physical throw makes: its dice grouped by type in the order each type first comes,
 * as the tray's formula lists them ("2d6+d20+3"), each value matched to its die.
 */
export function physicalRollResult(dice: readonly PhysicalDie[], modifier: number, now: number = Date.now()): DiceRollResult {
  const byType = new Map<DieType, number[]>();
  for (const die of dice) byType.set(die.type, [...(byType.get(die.type) ?? []), die.value]);
  const selection: DiceSelection = {};
  for (const [type, values] of byType) selection[type] = values.length;
  const formula = diceFormula(selection, modifier);
  const values = [...byType.values()].flat();
  return buildRollResult(formula, parseDiceFormula(formula), values, now);
}
