// online-client/diceTrayView.mts
/**
 * The dice tray on the join page, like Atlas's: its dice with their icons and counts, the
 * formula, a modifier, Clear selection and Roll. A click adds a die; a right-click or a
 * long-press removes one. Like Atlas's, it switches between RNG (the GM's side rolls) and
 * Physical (the player throws 3D dice on their own screen). The tray's rules live in `DiceTray`
 * (`src/app/online/page/diceTray.ts`).
 */
import {
  CLEAR_SELECTION_LABEL, DiceTray, dieHint, LONG_PRESS_MS, MODIFIER_LABEL, ROLL_LABEL,
} from '../src/app/online/page/diceTray';
import { DICE_MODE_LABEL, DICE_MODES, type PageDiceMode } from '../src/app/online/page/physicalDice';
import { dieIconUrl, toolIconUrl } from '../src/app/online/page/toolIcons';
import { DICE_TYPES, type DiceSelection, type DieType } from '../src/app/tools/diceRolling';
import { iconElement } from './icons.mts';

export interface DiceTrayViewOptions {
  root: HTMLElement;
  /** Sends the roll to the GM; false when it could not go. */
  roll(dice: DiceSelection, modifier: number): boolean;
  /**
   * Opens the 3D dice with the picked dice; false when the roll could not go. Without it the tray
   * has no Physical mode. `text` is the tray's formula.
   */
  throwPhysical?(dice: DiceSelection, modifier: number, text: string): boolean;
  /** The mode the tray opens in, and where a change of it goes, to be remembered. */
  mode?: PageDiceMode;
  onModeChange?(mode: PageDiceMode): void;
  /** The tray rolled and wants to close. */
  onClose(): void;
}

/** After a removal by long-press or right-click, the click or contextmenu the browser adds is ignored for this long. */
const AFTER_REMOVAL_MS = 800;
const ROLL_WAIT_NOTE = 'Wait a moment before rolling again.';

export class DiceTrayView {
  readonly tray = new DiceTray();
  private readonly dice = new Map<DieType, { button: HTMLButtonElement; badge: HTMLElement }>();
  private readonly formula: HTMLElement;
  private readonly modifier: HTMLInputElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly rollButton: HTMLButtonElement;
  private readonly note: HTMLElement;
  private readonly modeButtons = new Map<PageDiceMode, HTMLButtonElement>();
  private pressTimer: number | null = null;
  private ignoreUntil = 0;
  private diceMode: PageDiceMode;

  constructor(private readonly options: DiceTrayViewOptions) {
    this.diceMode = options.throwPhysical ? options.mode ?? 'rng' : 'rng';
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
    this.note = document.createElement('p');
    this.note.className = 'dice-note';
    this.note.setAttribute('role', 'status');
    options.root.replaceChildren(...(options.throwPhysical ? [this.modeSwitch()] : []), grid, bar, this.note);
    this.render();
  }

  get mode(): PageDiceMode {
    return this.diceMode;
  }

  get isOpen(): boolean {
    return !this.options.root.hidden;
  }

  /** Opens or closes the tray; like Atlas's, it opens empty. */
  setOpen(open: boolean): void {
    this.options.root.hidden = !open;
    if (!open) this.empty();
  }

  /** RNG or Physical, as Atlas's tray offers them. */
  private modeSwitch(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'dice-mode';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', DICE_MODE_LABEL);
    for (const { value, label } of DICE_MODES) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'dice-mode-option';
      option.setAttribute('role', 'radio');
      option.textContent = label;
      option.addEventListener('click', () => this.setMode(value));
      this.modeButtons.set(value, option);
      group.append(option);
    }
    return group;
  }

  private setMode(mode: PageDiceMode): void {
    if (mode === this.diceMode) return;
    this.diceMode = mode;
    this.options.onModeChange?.(mode);
    this.render();
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
    if (!this.tray.canRoll()) return;
    const { throwPhysical } = this.options;
    const sent = this.diceMode === 'physical' && throwPhysical
      ? throwPhysical(this.tray.selection, this.tray.modifier, this.tray.text())
      : this.options.roll(this.tray.selection, this.tray.modifier);
    if (!sent) {
      // Not sent (too fast, or not connected): the dice stay selected so the player can roll again.
      this.note.textContent = ROLL_WAIT_NOTE;
      return;
    }
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
    this.note.textContent = '';
    const full = this.tray.isFull();
    for (const [die, { button, badge }] of this.dice) {
      const count = this.tray.count(die);
      button.classList.toggle('is-selected', count > 0);
      button.setAttribute('aria-disabled', String(full));
      badge.hidden = count === 0;
      badge.textContent = String(count);
    }
    for (const [mode, option] of this.modeButtons) {
      option.setAttribute('aria-checked', String(mode === this.diceMode));
      option.classList.toggle('is-active', mode === this.diceMode);
    }
    this.formula.textContent = this.tray.text();
    this.clearButton.disabled = !this.tray.canRoll() && this.tray.modifier === 0;
    this.rollButton.disabled = !this.tray.canRoll();
  }
}
