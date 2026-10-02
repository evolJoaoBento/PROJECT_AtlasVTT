// online-client/diceLogView.mts
/**
 * The dice log on the join page: a side panel, and a bottom sheet on narrow screens. It opens
 * from the top bar's Dice log button or a tap on the toast, and closes with its close button or
 * Escape. It shows every roll's name, formula, dice and total, newest first, as text only. The
 * log's rules live in `PlayerDiceLog` (`src/app/online/page/diceLogModel.ts`).
 */
import { dieExtreme, PlayerDiceLog } from '../src/app/online/page/diceLogModel';
import { toolIconUrl } from '../src/app/online/page/toolIcons';
import type { DiceLogEntry } from '../src/app/online/tools/toolMessages';
import { iconElement } from './icons.mts';

export interface DiceLogViewOptions {
  panel: HTMLElement;
  list: HTMLElement;
  empty: HTMLElement;
  closeButton: HTMLButtonElement;
  toggleButton: HTMLButtonElement;
  toast: HTMLButtonElement;
}

function text(className: string, content: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = content;
  return element;
}

function entryElement(entry: DiceLogEntry, tag: 'li' | 'div'): HTMLElement {
  const item = document.createElement(tag);
  item.className = 'dice-entry';
  const summary = document.createElement('div');
  summary.className = 'dice-entry-summary';
  summary.append(text('dice-entry-formula', entry.formula), text('dice-entry-eq', '='), text('dice-entry-total', String(entry.total)));
  const dice = document.createElement('div');
  dice.className = 'dice-entry-dice';
  for (const die of entry.dice) {
    const badge = text('die-badge', `${die.die}: ${die.value}`);
    const extreme = dieExtreme(die);
    if (extreme) badge.classList.add(`is-${extreme}`);
    dice.append(badge);
  }
  item.append(text('dice-entry-name', entry.name), summary, dice);
  return item;
}

export class DiceLogView {
  readonly log: PlayerDiceLog;
  private shown: readonly DiceLogEntry[] | null = null;
  private readonly listeners = new AbortController();

  constructor(private readonly options: DiceLogViewOptions) {
    this.log = new PlayerDiceLog({ onChange: () => this.render() });
    const { signal } = this.listeners;
    options.toggleButton.replaceChildren(iconElement(toolIconUrl('dices')));
    options.toggleButton.addEventListener('click', () => this.setOpen(!this.log.isOpen), { signal });
    options.closeButton.addEventListener('click', () => this.close(), { signal });
    options.toast.addEventListener('click', () => this.setOpen(true), { signal });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.log.isOpen) this.close();
    }, { signal });
    this.render();
  }

  receive(entries: readonly DiceLogEntry[], replay: boolean): void {
    this.log.receive(entries, replay);
  }

  setOpen(open: boolean): void {
    this.options.panel.hidden = !open;
    this.options.toggleButton.setAttribute('aria-expanded', String(open));
    this.log.setOpen(open);
    if (open) this.options.closeButton.focus();
  }

  dispose(): void {
    this.listeners.abort();
    this.log.dispose();
  }

  private close(): void {
    this.setOpen(false);
    this.options.toggleButton.focus();
  }

  private render(): void {
    const { list, empty, toast } = this.options;
    const entries = this.log.entries;
    if (entries !== this.shown) {
      this.shown = entries;
      list.replaceChildren(...entries.map((entry) => entryElement(entry, 'li')));
    }
    empty.hidden = entries.length > 0;
    const latest = this.log.toast;
    toast.hidden = latest === null;
    toast.replaceChildren(...(latest ? [entryElement(latest, 'div')] : []));
  }
}
