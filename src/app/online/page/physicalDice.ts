/**
 * Physical dice on the join page: the tray's RNG / Physical choice, kept in the browser, and one
 * throw on the player's own 3D dice table, from the picked dice to the `dice-physical` dice it
 * sends. The table's dice are Atlas's (`physicalDiceValues.ts`): a d100 is its tens die and a
 * d10. Shared with the web page; the DOM is `online-client/physicalDiceOverlay.mts`.
 */
import { planTableDice, readPlannedDice, type TableDicePlan } from '../../physical-dice/physicalDiceValues';
import { isDieType, type DiceSelection, type DieType } from '../../tools/diceRolling';
import { dieSides, type PhysicalDie } from '../tools/physicalRolls';

export type PageDiceMode = 'rng' | 'physical';
export const DICE_MODE_KEY = 'atlas-online:dice-mode';
export const DICE_MODE_LABEL = 'Dice mode';
/** In tray order, as Atlas's dice tray lists them. */
export const DICE_MODES: ReadonlyArray<{ value: PageDiceMode; label: string }> = [
  { value: 'rng', label: 'RNG' },
  { value: 'physical', label: 'Physical' },
];

export const THROW_LABEL = 'Throw';
export const CANCEL_THROW_LABEL = 'Cancel roll';
export const LOADING_DICE_TEXT = 'Loading the 3D dice…';
export const NO_3D_DICE_TEXT = 'The 3D dice could not start on this device. Close this and roll with RNG.';
export const NOT_SENT_TEXT = 'The roll could not be sent. Throw again once you are connected.';
export const ROLLED_TEXT = 'Rolled';

/** The page passes `() => localStorage`: reaching for it can throw, so it is read inside the guard. */
type Reader = () => Pick<Storage, 'getItem'>;
type Writer = () => Pick<Storage, 'setItem'>;

/** The remembered mode; RNG when there is none or storage is unavailable. */
export function loadDiceMode(storage: Reader): PageDiceMode {
  try {
    return storage().getItem(DICE_MODE_KEY) === 'physical' ? 'physical' : 'rng';
  } catch {
    return 'rng';
  }
}

export function saveDiceMode(mode: PageDiceMode, storage: Writer): void {
  try {
    storage().setItem(DICE_MODE_KEY, mode);
  } catch {
    // The choice still applies to this visit.
  }
}

/** What the table reports for a settled die: its place on the table and the face it shows. */
export interface TableReading {
  index?: number;
  value: number;
}

export function rerollCaughtLabel(caught: number): string {
  return `Reroll ${caught} caught`;
}

/**
 * One throw of the picked dice. The player can throw them one at a time, so each table die's
 * latest reading is kept by its place on the table; the throw is done once every die has one.
 */
export class PhysicalThrow {
  /** The picked dice, in the order the tray lists them. */
  readonly dice: readonly DieType[];
  readonly plan: TableDicePlan;
  private readings: Array<number | null>;

  constructor(selection: DiceSelection, readonly modifier: number) {
    const dice: DieType[] = [];
    for (const [die, count] of Object.entries(selection)) {
      if (isDieType(die) && Number.isSafeInteger(count)) for (let i = 0; i < (count ?? 0); i++) dice.push(die);
    }
    this.dice = dice;
    this.plan = planTableDice(dice.map(dieSides));
    this.readings = this.plan.types.map(() => null);
  }

  /** The table dice to put out, in order: `['d20', 'd100', 'd10']`. */
  get tableDice(): readonly string[] {
    return this.plan.types;
  }

  /** Files the dice that just settled under their places; true once every die has a reading. */
  take(rolled: readonly TableReading[]): boolean {
    rolled.forEach((die, i) => {
      const index = die.index ?? i;
      if (index >= 0 && index < this.readings.length && Number.isSafeInteger(die.value)) this.readings[index] = die.value;
    });
    return this.isDone();
  }

  isDone(): boolean {
    return this.readings.length > 0 && this.readings.every((value) => value !== null);
  }

  /** Forgets every reading, for a throw that has to be made again. */
  reset(): void {
    this.readings = this.readings.map(() => null);
  }

  progressText(): string {
    const read = this.readings.filter((value) => value !== null).length;
    return read === 0 ? 'Drag a die to throw it, or throw them all' : `${read} of ${this.readings.length} dice read. Throw the rest`;
  }

  /** The dice to send, as a player calls them; null until every die has a reading. */
  result(): PhysicalDie[] | null {
    if (!this.isDone()) return null;
    const faces = this.readings.map((value) => value ?? 0);
    const values = readPlannedDice(this.dice.map(dieSides), this.plan, faces, () => 0);
    return this.dice.map((type, i) => ({ type, value: values[i] ?? 0 }));
  }
}
