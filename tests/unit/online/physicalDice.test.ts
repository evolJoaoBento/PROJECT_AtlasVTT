import { describe, expect, it } from 'vitest';
import { DICE_MODE_KEY, loadDiceMode, PhysicalThrow, saveDiceMode } from '../../../src/app/online/page/physicalDice';
import { decodeControl, encodeControl } from '../../../src/app/online/protocol';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
  } as Storage;
}
const throwing = (): never => { throw new Error('SecurityError'); };

describe('the join page dice mode', () => {
  it('remembers Physical, and is RNG otherwise', () => {
    const storage = memoryStorage();
    expect(loadDiceMode(() => storage)).toBe('rng');
    saveDiceMode('physical', () => storage);
    expect(storage.getItem(DICE_MODE_KEY)).toBe('physical');
    expect(loadDiceMode(() => storage)).toBe('physical');
    expect(loadDiceMode(() => memoryStorage({ [DICE_MODE_KEY]: 'loaded' }))).toBe('rng');
  });

  it('works without storage, as in a private window', () => {
    expect(loadDiceMode(throwing)).toBe('rng');
    expect(() => saveDiceMode('physical', throwing)).not.toThrow();
    const broken = { getItem: throwing, setItem: throwing } as unknown as Storage;
    expect(loadDiceMode(() => broken)).toBe('rng');
    expect(() => saveDiceMode('rng', () => broken)).not.toThrow();
  });
});

describe('a physical throw', () => {
  it('puts out the picked dice in tray order, a d100 as its tens die and a d10', () => {
    const roll = new PhysicalThrow({ d20: 1, d100: 1, d6: 2 }, 0);
    expect(roll.dice).toEqual(['d20', 'd100', 'd6', 'd6']);
    expect(roll.tableDice).toEqual(['d20', 'd100', 'd10', 'd6', 'd6']);
  });

  it('keeps each die’s latest reading by its place, and is done once every die has one', () => {
    const roll = new PhysicalThrow({ d20: 1, d6: 2 }, 2);
    expect(roll.progressText()).toBe('Drag a die to throw it, or throw them all');
    expect(roll.take([{ index: 1, value: 3 }])).toBe(false);
    expect(roll.progressText()).toBe('1 of 3 dice read. Throw the rest');
    expect(roll.result()).toBeNull();
    expect(roll.take([{ index: 1, value: 5 }, { index: 7, value: 9 }])).toBe(false);
    expect(roll.take([{ index: 0, value: 20 }, { index: 2, value: 1 }])).toBe(true);
    expect(roll.result()).toEqual([{ type: 'd20', value: 20 }, { type: 'd6', value: 5 }, { type: 'd6', value: 1 }]);
  });

  it('reads a button throw by order when the table gives no places', () => {
    const roll = new PhysicalThrow({ d4: 2 }, 0);
    expect(roll.take([{ value: 4 }, { value: 1 }])).toBe(true);
    expect(roll.result()).toEqual([{ type: 'd4', value: 4 }, { type: 'd4', value: 1 }]);
  });

  it('reads a d10 zero as 10, and percentile dice as tens plus ones with 00 and 0 as 100', () => {
    const roll = new PhysicalThrow({ d10: 1, d100: 2 }, 0);
    roll.take([{ value: 0 }, { value: 40 }, { value: 7 }, { value: 0 }, { value: 0 }]);
    expect(roll.result()).toEqual([{ type: 'd10', value: 10 }, { type: 'd100', value: 47 }, { type: 'd100', value: 100 }]);
  });

  it('makes a dice-physical message the GM accepts', () => {
    const roll = new PhysicalThrow({ d12: 1, d8: 1 }, -4);
    roll.take([{ value: 12 }, { value: 1 }]);
    const message = { v: 1, type: 'dice-physical', dice: roll.result()!, modifier: roll.modifier } as const;
    expect(decodeControl(encodeControl(message))).toEqual({ kind: 'message', message });
  });

  it('starts again after a reset', () => {
    const roll = new PhysicalThrow({ d6: 1 }, 0);
    roll.take([{ value: 6 }]);
    roll.reset();
    expect(roll.isDone()).toBe(false);
    expect(roll.result()).toBeNull();
  });
});
