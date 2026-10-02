import { describe, expect, it } from 'vitest';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { isPhysicalDice, physicalRollResult } from '../../../src/app/online/tools/physicalRolls';
import { diceLogEntry, isDiceLogEntry, type DiceLogEntry } from '../../../src/app/online/tools/toolMessages';
import { rollFormula } from '../../../src/app/tools/diceRolling';

const valid = (message: object): boolean => decodeControl(JSON.stringify(message)).kind === 'message';
const physical = (dice: unknown, modifier: unknown = 0): boolean => valid({ v: 1, type: 'dice-physical', dice, modifier });
const entry = (overrides: object = {}): DiceLogEntry => ({
  id: 'roll_1', name: 'Anna', formula: 'd20', dice: [{ die: 'd20', value: 4 }], modifier: 0, total: 4, at: 5, ...overrides,
} as DiceLogEntry);

describe('physical dice messages', () => {
  it('round-trips a physical roll', () => {
    const message: ControlMessage = { v: 1, type: 'dice-physical', dice: [{ type: 'd20', value: 17 }, { type: 'd100', value: 100 }], modifier: -2 };
    expect(decodeControl(encodeControl(message))).toEqual({ kind: 'message', message });
  });

  it("holds each die to its type's faces: 1 to its sides, a d10 to 10 and a d100 to 100", () => {
    expect(physical([{ type: 'd4', value: 4 }, { type: 'd10', value: 10 }, { type: 'd100', value: 1 }])).toBe(true);
    expect(physical([{ type: 'd100', value: 100 }, { type: 'd12', value: 12 }], 1000)).toBe(true);
    expect(physical([{ type: 'd6', value: 7 }])).toBe(false);
    expect(physical([{ type: 'd10', value: 0 }])).toBe(false);
    expect(physical([{ type: 'd100', value: 101 }])).toBe(false);
    expect(physical([{ type: 'd20', value: 2.5 }])).toBe(false);
    expect(physical([{ type: 'd20', value: '20' }])).toBe(false);
    expect(physical([{ type: 'd3', value: 1 }])).toBe(false);
    expect(physical([{ type: 'd20' }])).toBe(false);
    expect(physical(['d20'])).toBe(false);
    expect(physical({ d20: 1 })).toBe(false);
  });

  it('holds a physical roll to 1 to 20 dice and a whole modifier within 1000', () => {
    const d6 = (count: number): object[] => Array.from({ length: count }, () => ({ type: 'd6', value: 3 }));
    expect(physical(d6(20))).toBe(true);
    expect(physical(d6(21))).toBe(false);
    expect(physical([])).toBe(false);
    expect(physical(d6(1), 1001)).toBe(false);
    expect(physical(d6(1), 0.5)).toBe(false);
    expect(physical(d6(1), '1')).toBe(false);
  });

  it('refuses prototype keys and inherited fields without throwing', () => {
    const decode = (dice: string): string => decodeControl(`{"v":1,"type":"dice-physical","dice":${dice},"modifier":0}`).kind;
    expect(decode('[{"__proto__":{"type":"d6","value":3}}]')).toBe('invalid');
    expect(decode('[{"type":"constructor","value":1}]')).toBe('invalid');
    expect(decode('[{"type":"__proto__","value":1}]')).toBe('invalid');
    expect(isPhysicalDice([Object.create({ type: 'd6', value: 3 })])).toBe(false);
  });
});

describe('physical roll results', () => {
  it("groups the dice by type in the order they first come, matches the values and adds them up on the GM's side", () => {
    const result = physicalRollResult([{ type: 'd6', value: 2 }, { type: 'd20', value: 17 }, { type: 'd6', value: 5 }], 3, 1000);
    expect(result).toMatchObject({ formula: '2d6+d20+3', modifiers: 3, total: 27, timestamp: 1000 });
    expect(result.rolls).toEqual([
      { die: 'd6', value: 2, max: 6 }, { die: 'd6', value: 5, max: 6 }, { die: 'd20', value: 17, max: 20 },
    ]);
  });

  it('reads a percentile die as one d100 of up to 100', () => {
    const result = physicalRollResult([{ type: 'd100', value: 100 }], -1, 0);
    expect(result).toMatchObject({ formula: 'd100-1', total: 99 });
    expect(result.rolls).toEqual([{ die: 'd100', value: 100, max: 100 }]);
  });
});

describe('physical log entries', () => {
  it("marks a roll thrown on a player's device as physical, and nothing else", () => {
    const roll = rollFormula('d20');
    expect(diceLogEntry({ ...roll, rolledBy: 'Anna', playerDevice: true }, 'Anna')?.physical).toBe(true);
    expect(diceLogEntry({ ...roll, rolledBy: 'Anna' }, 'Anna')).not.toHaveProperty('physical');
  });

  it('accepts physical only as a boolean', () => {
    expect(isDiceLogEntry(entry({ physical: true }))).toBe(true);
    expect(isDiceLogEntry(entry({ physical: false }))).toBe(true);
    expect(isDiceLogEntry(entry())).toBe(true);
    expect(isDiceLogEntry(entry({ physical: 'yes' }))).toBe(false);
    expect(isDiceLogEntry(entry({ physical: 1 }))).toBe(false);
  });
});
