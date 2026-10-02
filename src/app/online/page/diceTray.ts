/**
 * The join page's dice tray, like Atlas's. A click adds a die, and a right-click or a long-press
 * removes one. There is a modifier, and Roll. It takes at most 20 dice and a whole-number
 * modifier within ±1000, as the GM accepts. Shared with the web page; the DOM is
 * `online-client/diceTrayView.mts`.
 */
import { DICE_TYPES, diceTerms, type DiceSelection, type DieType } from '../../tools/diceRolling';
import { DICE_LIMITS } from '../tools/toolMessages';

export const LONG_PRESS_MS = 500;
export const EMPTY_TRAY_TEXT = 'Select dice to roll';
export const ROLL_LABEL = 'Roll';
export const CLEAR_SELECTION_LABEL = 'Clear selection';
export const MODIFIER_LABEL = 'Modifier';

/** Atlas's hint for a die of its tray. */
export function dieHint(die: DieType): string {
  return `${die.toUpperCase()} • Left: add • Right: remove`;
}

export class DiceTray {
  private picked: DiceSelection = {};
  private bonus = 0;

  /** The picked dice, in the order they were first picked. */
  get selection(): DiceSelection {
    return { ...this.picked };
  }

  get modifier(): number {
    return this.bonus;
  }

  count(die: DieType): number {
    return this.picked[die] ?? 0;
  }

  total(): number {
    return DICE_TYPES.reduce((sum, die) => sum + this.count(die), 0);
  }

  isFull(): boolean {
    return this.total() >= DICE_LIMITS.dicePerRoll;
  }

  /** False when the tray is full. */
  add(die: DieType): boolean {
    if (this.isFull()) return false;
    this.picked = { ...this.picked, [die]: this.count(die) + 1 };
    return true;
  }

  /** False when no such die is picked. */
  remove(die: DieType): boolean {
    const count = this.count(die);
    if (count === 0) return false;
    const next = { ...this.picked };
    if (count > 1) next[die] = count - 1;
    else delete next[die];
    this.picked = next;
    return true;
  }

  /** The modifier as typed: a whole number, clamped to ±1000; anything else is 0. */
  setModifier(text: string): number {
    const value = Number.parseInt(text, 10);
    this.bonus = Number.isFinite(value) ? Math.max(-DICE_LIMITS.modifier, Math.min(DICE_LIMITS.modifier, value)) : 0;
    return this.bonus;
  }

  canRoll(): boolean {
    return this.total() > 0;
  }

  /** What the tray shows, like Atlas's: "2d6 + d20 + 3". */
  text(): string {
    const terms = diceTerms(this.picked);
    if (terms.length === 0) return EMPTY_TRAY_TEXT;
    const dice = terms.join(' + ');
    return this.bonus === 0 ? dice : `${dice} ${this.bonus > 0 ? '+' : '-'} ${Math.abs(this.bonus)}`;
  }

  clear(): void {
    this.picked = {};
    this.bonus = 0;
  }
}
