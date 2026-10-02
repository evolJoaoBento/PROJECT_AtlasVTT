import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiceTrayView } from '../../../online-client/diceTrayView.mts';
import { LONG_PRESS_MS } from '../../../src/app/online/page/diceTray';
import type { DiceSelection } from '../../../src/app/tools/diceRolling';

function setup(sends = true) {
  document.body.innerHTML = '<div id="dice-tray" hidden></div>';
  const root = document.getElementById('dice-tray')!;
  const rolls: Array<{ dice: DiceSelection; modifier: number }> = [];
  let closed = 0;
  const view = new DiceTrayView({
    root,
    roll: (dice, modifier) => {
      rolls.push({ dice, modifier });
      return sends;
    },
    onClose: () => { closed++; },
  });
  view.setOpen(true);
  const die = (name: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`[data-die="${name}"]`)!;
  const text = (): string => root.querySelector('.dice-formula')!.textContent ?? '';
  return { root, view, rolls, closed: () => closed, die, text };
}
function fire(target: EventTarget, type: string, pointerType = 'touch'): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: type === 'contextmenu' ? 2 : 0 });
  Object.defineProperties(event, { pointerType: { value: pointerType }, pointerId: { value: 1 } });
  target.dispatchEvent(event);
  return event;
}

describe('the join page dice tray', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("adds a die on a click and removes one on a right-click, showing Atlas's formula", () => {
    const t = setup();
    t.die('d6').click();
    t.die('d6').click();
    t.die('d20').click();
    expect(fire(t.die('d6'), 'contextmenu', 'mouse').defaultPrevented).toBe(true);
    expect(t.text()).toBe('d6 + d20');
    expect(t.die('d6').querySelector('.dice-badge')?.textContent).toBe('1');
    expect(t.die('d4').querySelector<HTMLElement>('.dice-badge')?.hidden).toBe(true);
  });

  it("removes one die per long-press, even with the browser's contextmenu", () => {
    const t = setup();
    for (let i = 0; i < 4; i++) t.die('d8').click();
    // The hold removes one; the contextmenu and click the browser may add are ignored.
    fire(t.die('d8'), 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fire(t.die('d8'), 'contextmenu');
    fire(t.die('d8'), 'pointerup');
    t.die('d8').click();
    expect(t.view.tray.count('d8')).toBe(3);
    vi.advanceTimersByTime(1000);
    // The browser's contextmenu comes first: it removes one, and the hold adds nothing.
    fire(t.die('d8'), 'pointerdown');
    vi.advanceTimersByTime(LONG_PRESS_MS - 100);
    fire(t.die('d8'), 'contextmenu');
    vi.advanceTimersByTime(200);
    fire(t.die('d8'), 'pointerup');
    expect(t.view.tray.count('d8')).toBe(2);
  });

  it('rolls the dice with the modifier, then empties and asks to close; Roll needs dice', () => {
    const t = setup();
    const roll = t.root.querySelector<HTMLButtonElement>('.dice-roll')!;
    expect(roll.disabled).toBe(true);
    t.die('d20').click();
    const modifier = t.root.querySelector<HTMLInputElement>('[aria-label="Modifier"]')!;
    modifier.value = '3';
    modifier.dispatchEvent(new Event('input'));
    expect(t.text()).toBe('d20 + 3');
    roll.click();
    expect(t.rolls).toEqual([{ dice: { d20: 1 }, modifier: 3 }]);
    expect(t.view.tray.total()).toBe(0);
    expect(modifier.value).toBe('');
    expect(t.closed()).toBe(1);
  });

  it('keeps the dice when the roll could not be sent', () => {
    const t = setup(false);
    t.die('d20').click();
    t.root.querySelector<HTMLButtonElement>('.dice-roll')!.click();
    expect(t.view.tray.total()).toBe(1);
    expect(t.closed()).toBe(0);
  });

  it('takes no more dice at 20', () => {
    const t = setup();
    for (let i = 0; i < 25; i++) t.die('d6').click();
    expect(t.view.tray.total()).toBe(20);
    expect(t.die('d4').getAttribute('aria-disabled')).toBe('true');
  });
});
