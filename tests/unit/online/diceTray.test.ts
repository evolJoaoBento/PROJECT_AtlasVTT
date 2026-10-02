import { describe, expect, it } from 'vitest';
import { DiceTray, dieHint } from '../../../src/app/online/page/diceTray';

describe('the join page dice tray', () => {
  it("writes the picked dice and modifier as Atlas's tray does", () => {
    const tray = new DiceTray();
    expect(tray.text()).toBe('Select dice to roll');
    expect(tray.canRoll()).toBe(false);
    tray.add('d20');
    tray.add('d6');
    tray.add('d6');
    expect(tray.text()).toBe('d20 + 2d6');
    expect(tray.selection).toEqual({ d20: 1, d6: 2 });
    expect(tray.setModifier('3')).toBe(3);
    expect(tray.text()).toBe('d20 + 2d6 + 3');
    tray.setModifier('-4');
    expect(tray.text()).toBe('d20 + 2d6 - 4');
    expect(tray.canRoll()).toBe(true);
  });

  it('keeps the modifier a whole number within 1000', () => {
    const tray = new DiceTray();
    expect(tray.setModifier('5000')).toBe(1000);
    expect(tray.setModifier('-5000')).toBe(-1000);
    expect(tray.setModifier('2.7')).toBe(2);
    expect(tray.setModifier('abc')).toBe(0);
    expect(tray.setModifier('')).toBe(0);
  });

  it('removes one die at a time and forgets a die at zero', () => {
    const tray = new DiceTray();
    tray.add('d6');
    tray.add('d6');
    tray.add('d8');
    expect(tray.remove('d6')).toBe(true);
    expect(tray.count('d6')).toBe(1);
    tray.remove('d6');
    expect(tray.selection).toEqual({ d8: 1 });
    expect(tray.remove('d4')).toBe(false);
  });

  it('takes at most 20 dice, as the GM accepts', () => {
    const tray = new DiceTray();
    for (let i = 0; i < 20; i++) expect(tray.add(i % 2 ? 'd6' : 'd8')).toBe(true);
    expect(tray.isFull()).toBe(true);
    expect(tray.add('d20')).toBe(false);
    expect(tray.total()).toBe(20);
    tray.clear();
    expect([tray.total(), tray.modifier, tray.text()]).toEqual([0, 0, 'Select dice to roll']);
  });

  it("hints each die like Atlas's tray", () => {
    expect(dieHint('d20')).toBe('D20 • Left: add • Right: remove');
  });
});
