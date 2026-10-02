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

  it('keeps the tray open and says so when the roll was not sent', () => {
    const t = setup(false);
    t.die('d20').click();
    t.root.querySelector<HTMLButtonElement>('.dice-roll')!.click();
    expect(t.closed()).toBe(0);
    expect(t.view.isOpen).toBe(true);
    expect(t.text()).toBe('d20');
    expect(t.root.querySelector('.dice-note')?.textContent).toBe('Wait a moment before rolling again.');
    t.die('d20').click();
    expect(t.root.querySelector('.dice-note')?.textContent).toBe('');
  });

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

describe('the join page dice tray mode', () => {
  function physicalSetup(mode: 'rng' | 'physical' = 'rng', sends = true) {
    document.body.innerHTML = '<div id="dice-tray" hidden></div>';
    const root = document.getElementById('dice-tray')!;
    const rolls: DiceSelection[] = [];
    const thrown: Array<{ dice: DiceSelection; modifier: number; text: string }> = [];
    const modes: string[] = [];
    let closed = 0;
    const view = new DiceTrayView({
      root,
      roll: (dice) => { rolls.push(dice); return true; },
      throwPhysical: (dice, modifier, text) => { thrown.push({ dice, modifier, text }); return sends; },
      mode,
      onModeChange: (next) => modes.push(next),
      onClose: () => { closed++; },
    });
    view.setOpen(true);
    const option = (label: string): HTMLButtonElement => [...root.querySelectorAll<HTMLButtonElement>('.dice-mode-option')].find((button) => button.textContent === label)!;
    const die = (name: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`[data-die="${name}"]`)!;
    const rollButton = (): HTMLButtonElement => root.querySelector<HTMLButtonElement>('.dice-roll')!;
    return { root, view, rolls, thrown, modes, closed: () => closed, option, die, rollButton };
  }

  it('offers RNG and Physical, as Atlas does, opening in the remembered mode', () => {
    const t = physicalSetup('physical');
    expect([...t.root.querySelectorAll('.dice-mode-option')].map((button) => button.textContent)).toEqual(['RNG', 'Physical']);
    expect(t.option('Physical').getAttribute('aria-checked')).toBe('true');
    expect(t.option('RNG').getAttribute('aria-checked')).toBe('false');
    expect(t.view.mode).toBe('physical');
  });

  it('remembers a switch and rolls the way it shows', () => {
    const t = physicalSetup();
    t.die('d20').click();
    t.rollButton().click();
    expect(t.rolls).toEqual([{ d20: 1 }]);
    t.view.setOpen(true);
    t.option('Physical').click();
    expect(t.modes).toEqual(['physical']);
    expect(t.option('Physical').classList.contains('is-active')).toBe(true);
    t.die('d6').click();
    t.die('d6').click();
    const modifier = t.root.querySelector<HTMLInputElement>('.dice-modifier')!;
    modifier.value = '3';
    modifier.dispatchEvent(new Event('input'));
    t.rollButton().click();
    expect(t.thrown).toEqual([{ dice: { d6: 2 }, modifier: 3, text: '2d6 + 3' }]);
    expect(t.rolls).toHaveLength(1);
    expect(t.closed()).toBe(2);
  });

  it('keeps the dice picked when the physical roll cannot start', () => {
    const t = physicalSetup('physical', false);
    t.die('d8').click();
    t.rollButton().click();
    expect(t.view.tray.selection).toEqual({ d8: 1 });
    expect(t.root.querySelector('.dice-note')?.textContent).not.toBe('');
    expect(t.closed()).toBe(0);
  });

  it('has no mode switch without physical dice', () => {
    const { root, view } = setup();
    expect(root.querySelector('.dice-mode')).toBeNull();
    expect(view.mode).toBe('rng');
  });
});
