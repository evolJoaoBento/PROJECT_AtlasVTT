// online-client/physicalDiceOverlay.mts
/**
 * The 3D dice overlay on the join page, like Atlas's physical dice table: it covers the window
 * with the picked dice, the player drags a die to throw it or presses Throw, and once every die
 * has a reading the roll is sent. Only this player sees the dice tumble. Closing it (its close
 * button or Escape) cancels the roll. The 3D table loads on the first throw (`physicalDiceStage.mts`,
 * a dynamic import), so the page's first download stays small. The throw's rules live in
 * `PhysicalThrow` (`src/app/online/page/physicalDice.ts`).
 */
import {
  CANCEL_THROW_LABEL, LOADING_DICE_TEXT, NO_3D_DICE_TEXT, NOT_SENT_TEXT, PhysicalThrow, ROLLED_TEXT, rerollCaughtLabel, THROW_LABEL,
  type TableReading,
} from '../src/app/online/page/physicalDice';
import { toolIconUrl } from '../src/app/online/page/toolIcons';
import type { PhysicalDie } from '../src/app/online/tools/physicalRolls';
import type { DiceSelection } from '../src/app/tools/diceRolling';
import { iconElement } from './icons.mts';

/** The 3D dice table the overlay throws on. */
export interface DiceStage {
  /** Puts these table dice out, replacing any. */
  show(types: readonly string[]): void;
  /** Throws every die; resolves once they settle. */
  throwAll(): Promise<void>;
  /** The dice that settled since the last call, once. */
  takeLastRoll(): TableReading[] | null;
  caughtCount(): number;
  rerollCaught(): void;
  rollInProgress(): boolean;
  /** Called when a die thrown by dragging settles. */
  onSettled(listener: () => void): void;
  /** Takes the dice off and stops drawing. */
  clear(): void;
}

export interface PhysicalDiceOverlayOptions {
  root: HTMLElement;
  /** Sends the roll to the GM; false when it could not go. */
  send(dice: PhysicalDie[], modifier: number): boolean;
  /** Builds the 3D table in `host`; tests pass their own. */
  loadStage?: (host: HTMLElement) => Promise<DiceStage>;
}

/** Settled dice stay on the table a moment after the roll is sent, as on Atlas's table. */
const SETTLED_DICE_LINGER_MS = 1500;
const CAUGHT_POLL_MS = 300;

const loadDefaultStage = async (host: HTMLElement): Promise<DiceStage> => (await import('./physicalDiceStage.mts')).createDiceStage(host);

function button(className: string, label: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  return element;
}

export class PhysicalDiceOverlay {
  private readonly stageHost: HTMLElement;
  private readonly label: HTMLElement;
  private readonly status: HTMLElement;
  private readonly rerollButton: HTMLButtonElement;
  private readonly throwButton: HTMLButtonElement;
  private stage: Promise<DiceStage> | null = null;
  private current: PhysicalThrow | null = null;
  private pollTimer: number | null = null;
  private lingerTimer: number | null = null;
  private readonly listeners = new AbortController();

  constructor(private readonly options: PhysicalDiceOverlayOptions) {
    this.stageHost = document.createElement('div');
    this.stageHost.className = 'physical-dice-stage';
    const text = document.createElement('div');
    text.className = 'physical-dice-text';
    this.label = document.createElement('span');
    this.label.className = 'physical-dice-formula';
    this.status = document.createElement('span');
    this.status.className = 'physical-dice-status';
    this.status.setAttribute('role', 'status');
    text.append(this.label, this.status);
    this.rerollButton = button('secondary physical-dice-reroll', rerollCaughtLabel(0));
    this.rerollButton.hidden = true;
    this.rerollButton.addEventListener('click', () => void this.stage?.then((stage) => stage.rerollCaught()));
    this.throwButton = button('physical-dice-throw', THROW_LABEL);
    this.throwButton.addEventListener('click', () => void this.throwAll());
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'tool-button physical-dice-cancel';
    cancel.setAttribute('aria-label', CANCEL_THROW_LABEL);
    cancel.append(iconElement(toolIconUrl('x')));
    cancel.addEventListener('click', () => this.close());
    const bar = document.createElement('div');
    bar.className = 'physical-dice-bar';
    bar.append(text, this.rerollButton, this.throwButton, cancel);
    options.root.replaceChildren(this.stageHost, bar);
    options.root.hidden = true;
    // An open overlay takes Escape first: closing it, and so cancelling the roll, is all Escape does then.
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.isOpen) return;
      event.stopImmediatePropagation();
      this.close();
    }, { capture: true, signal: this.listeners.signal });
  }

  get isOpen(): boolean {
    return !this.options.root.hidden;
  }

  /** Opens the table with the picked dice; `text` is the tray's formula, "2d6 + 3". */
  async open(selection: DiceSelection, modifier: number, text: string): Promise<void> {
    this.close();
    const roll = new PhysicalThrow(selection, modifier);
    if (roll.tableDice.length === 0) return;
    this.current = roll;
    this.options.root.hidden = false;
    this.label.textContent = text;
    this.status.textContent = LOADING_DICE_TEXT;
    this.throwButton.disabled = true;
    let stage: DiceStage;
    try {
      stage = await this.loadStage();
      // Closed, or opened again, while the table loaded.
      if (this.current !== roll) return;
      stage.show(roll.tableDice);
    } catch (error) {
      console.error('[Atlas online] the 3D dice could not start:', error);
      this.stage = null;
      if (this.current === roll) this.status.textContent = NO_3D_DICE_TEXT;
      return;
    }
    this.throwButton.disabled = false;
    this.status.textContent = roll.progressText();
    this.startPolling(stage);
  }

  /** Cancels the roll in progress, if any, and hides the table. */
  close(): void {
    this.current = null;
    this.stopPolling();
    if (this.lingerTimer !== null) window.clearTimeout(this.lingerTimer);
    this.lingerTimer = null;
    this.options.root.hidden = true;
    void this.stage?.then((stage) => stage.clear(), () => undefined);
  }

  /** Cancels any roll and stops listening; the table itself stays for the page's lifetime. */
  dispose(): void {
    this.close();
    this.listeners.abort();
  }

  private loadStage(): Promise<DiceStage> {
    if (!this.stage) {
      const load = this.options.loadStage ?? loadDefaultStage;
      this.stage = load(this.stageHost).then((stage) => {
        stage.onSettled(() => this.takeReadings(stage));
        return stage;
      });
    }
    return this.stage;
  }

  private async throwAll(): Promise<void> {
    const stage = await this.stage;
    if (!stage || !this.current || stage.rollInProgress()) return;
    this.throwButton.disabled = true;
    try {
      await stage.throwAll();
      this.takeReadings(stage);
    } catch (error) {
      console.error('[Atlas online] the dice could not be thrown:', error);
    } finally {
      if (this.current) this.throwButton.disabled = false;
    }
  }

  /** Files the dice that just settled; sends the roll once every die has a reading. */
  private takeReadings(stage: DiceStage): void {
    const rolled = stage.takeLastRoll();
    const roll = this.current;
    if (!rolled || !roll || this.lingerTimer !== null) return;
    if (!roll.take(rolled)) {
      this.status.textContent = roll.progressText();
      return;
    }
    const dice = roll.result();
    if (!dice || !this.options.send(dice, roll.modifier)) {
      roll.reset();
      this.status.textContent = NOT_SENT_TEXT;
      return;
    }
    this.stopPolling();
    this.throwButton.disabled = true;
    this.status.textContent = ROLLED_TEXT;
    this.lingerTimer = window.setTimeout(() => {
      this.lingerTimer = null;
      if (this.current === roll) this.close();
    }, SETTLED_DICE_LINGER_MS);
  }

  /** A die caught on another can be thrown again, as on Atlas's table. */
  private startPolling(stage: DiceStage): void {
    this.stopPolling();
    this.pollTimer = window.setInterval(() => {
      const caught = stage.caughtCount();
      this.rerollButton.hidden = caught === 0;
      if (caught > 0) this.rerollButton.textContent = rerollCaughtLabel(caught);
    }, CAUGHT_POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.rerollButton.hidden = true;
  }
}
