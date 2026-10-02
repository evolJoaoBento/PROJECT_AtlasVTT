// online-client/diceTrayView.mts
/**
 * The dice tray on the join page, like Atlas's: its dice with their icons and counts, the
 * formula, a modifier, Clear selection and Roll. A click adds a die; a right-click or a
 * long-press removes one. The tray's rules live in `DiceTray` (`src/app/online/page/diceTray.ts`).
 */
import {
  CLEAR_SELECTION_LABEL, DiceTray, dieHint, LONG_PRESS_MS, MODIFIER_LABEL, ROLL_LABEL,
} from '../src/app/online/page/diceTray';
import { dieIconUrl, toolIconUrl } from '../src/app/online/page/toolIcons';
import { DICE_TYPES, type DiceSelection, type DieType } from '../src/app/tools/diceRolling';
import { iconElement } from './icons.mts';

export interface DiceTrayViewOptions {
  root: HTMLElement;
  /** Sends the roll to the GM; false when it could not go. */
  roll(dice: DiceSelection, modifier: number): boolean;
  /** The tray rolled and wants to close. */
  onClose(): void;
}

/** After a removal by long-press or right-click, the click or contextmenu the browser adds is ignored for this long. */
const AFTER_REMOVAL_MS = 800;

export class DiceTrayView {
  readonly tray = new DiceTray();
  private readonly dice = new Map<DieType, { button: HTMLButtonElement; badge: HTMLElement }>();
  private readonly formula: HTMLElement;
  private readonly modifier: HTMLInputElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly rollButton: HTMLButtonElement;
  private pressTimer: number | null = null;
  private ignoreUntil = 0;

  constructor(private readonly options: DiceTrayViewOptions) {
    const grid = document.createElement('div');
    grid.className = 'dice-grid';
    for (const die of DICE_TYPES) grid.append(this.cell(die));
    this.formula = document.createElement('span');
    this.formula.className = 'dice-formula';
    this.modifier = document.createElement('input');
    this.modifier.type = 'number';
    this.modifier.inputMode = 'numeric';
    this.modifier.step = '1';
    this.modifier.min = '-1000';
    this.modifier.max = '1000';
    this.modifier.placeholder = '+0';
    this.modifier.className = 'dice-modifier';
    this.modifier.setAttribute('aria-label', MODIFIER_LABEL);
    this.modifier.addEventListener('input', () => {
      this.tray.setModifier(this.modifier.value);
      this.render();
    });
    this.clearButton = document.createElement('button');
    this.clearButton.type = 'button';
    this.clearButton.className = 'tool-button dice-clear';
    this.clearButton.setAttribute('aria-label', CLEAR_SELECTION_LABEL);
    this.clearButton.dataset.label = CLEAR_SELECTION_LABEL;
    this.clearButton.append(iconElement(toolIconUrl('x')));
    this.clearButton.addEventListener('click', () => this.empty());
    this.rollButton = document.createElement('button');
    this.rollButton.type = 'button';
    this.rollButton.className = 'dice-roll';
    const rollText = document.createElement('span');
    rollText.textContent = ROLL_LABEL;
    this.rollButton.append(iconElement(toolIconUrl('dices')), rollText);
    this.rollButton.addEventListener('click', () => this.roll());
    const bar = document.createElement('div');
    bar.className = 'dice-formula-bar';
    bar.append(this.formula, this.modifier, this.clearButton, this.rollButton);
    options.root.replaceChildren(grid, bar);
    this.render();
  }

  get isOpen(): boolean {
    return !this.options.root.hidden;
  }

  /** Opens or closes the tray; like Atlas's, it opens empty. */
  setOpen(open: boolean): void {
    this.options.root.hidden = !open;
    if (!open) this.empty();
  }

  private cell(die: DieType): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dice-button';
    button.dataset.die = die;
    button.dataset.label = dieHint(die);
    button.setAttribute('aria-label', dieHint(die));
    const badge = document.createElement('span');
    badge.className = 'dice-badge';
    badge.hidden = true;
    button.append(iconElement(dieIconUrl(die)), badge);
    button.addEventListener('click', () => {
      if (Date.now() < this.ignoreUntil) return;
      this.tray.add(die);
      this.render();
    });
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (Date.now() < this.ignoreUntil) return;
      this.cancelPress();
      this.removeOne(die);
    });
    button.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      this.cancelPress();
      this.pressTimer = window.setTimeout(() => {
        this.pressTimer = null;
        this.removeOne(die);
      }, LONG_PRESS_MS);
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) button.addEventListener(type, () => this.cancelPress());
    const label = document.createElement('span');
    label.className = 'dice-label';
    label.textContent = die;
    const cell = document.createElement('div');
    cell.className = 'dice-cell';
    cell.append(button, label);
    this.dice.set(die, { button, badge });
    return cell;
  }

  private removeOne(die: DieType): void {
    this.ignoreUntil = Date.now() + AFTER_REMOVAL_MS;
    this.tray.remove(die);
    this.render();
  }

  private cancelPress(): void {
    if (this.pressTimer !== null) window.clearTimeout(this.pressTimer);
    this.pressTimer = null;
  }

  private roll(): void {
    if (!this.tray.canRoll() || !this.options.roll(this.tray.selection, this.tray.modifier)) return;
    this.empty();
    this.options.onClose();
  }

  private empty(): void {
    this.cancelPress();
    this.tray.clear();
    this.modifier.value = '';
    this.render();
  }

  private render(): void {
    const full = this.tray.isFull();
    for (const [die, { button, badge }] of this.dice) {
      const count = this.tray.count(die);
      button.classList.toggle('is-selected', count > 0);
      button.setAttribute('aria-disabled', String(full));
      badge.hidden = count === 0;
      badge.textContent = String(count);
    }
    this.formula.textContent = this.tray.text();
    this.clearButton.disabled = !this.tray.canRoll() && this.tray.modifier === 0;
    this.rollButton.disabled = !this.tray.canRoll();
  }
}
