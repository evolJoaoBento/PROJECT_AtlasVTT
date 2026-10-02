/**
 * Every roll Atlas's dice log gets: the `atlas-dice-rolled` document event, which the toolbar's
 * dice tray, statblock rolls and online rolls all dispatch, and which Atlas's dice log, toasts
 * and dice sounds listen to. A physical-dice integration that dispatches it is relayed too.
 */
import { DICE_ROLLED_EVENT, type DiceRollResult } from '../tools/diceRolling';

export interface DiceFeed {
  subscribe(listener: (result: DiceRollResult) => void): () => void;
  /** Adds a roll to Atlas's dice log, toasts and sounds, as `DiceTool.rollDice` does. */
  publish(result: DiceRollResult): void;
}

export function documentDiceFeed(doc: Document = document): DiceFeed {
  return {
    subscribe: (listener) => {
      const handler = (event: Event): void => listener((event as CustomEvent<DiceRollResult>).detail);
      doc.addEventListener(DICE_ROLLED_EVENT, handler);
      return () => doc.removeEventListener(DICE_ROLLED_EVENT, handler);
    },
    publish: (result) => {
      doc.dispatchEvent(new CustomEvent(DICE_ROLLED_EVENT, { detail: result }));
    },
  };
}
