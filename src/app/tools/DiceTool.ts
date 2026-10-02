import { EventEmitter } from 'events';
import type { DiceMode, SettingsService } from '../services/SettingsService';
import type { DiceColor } from '../types/collectionSettingsTypes';
import type { PhysicalDiceTable } from '../physical-dice/PhysicalDiceTable';
import { planTableDice, readPlannedDice } from '../physical-dice/physicalDiceValues';
import {
  buildRollResult, DICE_ROLLED_EVENT, DICE_TYPES, parseDiceFormula, rollFormula, rollRandomDie, type DiceRollResult,
} from './diceRolling';

export type { DiceRollResult } from './diceRolling';

export interface DiceToolState {
  isTrayOpen: boolean;
  rollHistory: DiceRollResult[];
  activeFormula: string;
  quickDice: string[]; // Quick access dice buttons
}

export class DiceTool {
  public state: DiceToolState;
  private eventBus: EventEmitter;
  private physicalTable: PhysicalDiceTable | null = null;

  constructor(eventBus: EventEmitter, private readonly settings?: SettingsService) {
    this.eventBus = eventBus;
    this.state = {
      isTrayOpen: false,
      rollHistory: [],
      activeFormula: '',
      quickDice: [...DICE_TYPES],
    };
  }

  public toggleTray(): void {
    this.state.isTrayOpen = !this.state.isTrayOpen;
    this.eventBus.emit('dice-tray-toggled', this.state.isTrayOpen);
  }

  /** Rolls with Atlas' random numbers, whatever the dice mode. */
  public rollDice(formula: string, source?: DiceRollResult['source']): DiceRollResult {
    return this.publish(rollFormula(formula), source);
  }

  /**
   * Rolls the way the game master chose: with random numbers, or on the physical
   * dice table, where the roll waits for the dice to be thrown. Resolves with
   * null when a physical roll is cancelled.
   */
  public async requestRoll(
    formula: string,
    source?: DiceRollResult['source'],
    /** One colour per die of the formula, in formula order; null wears the pack's. */
    dieColors?: ReadonlyArray<string | null>,
  ): Promise<DiceRollResult | null> {
    const table = this.physicalTable;
    if (this.getMode() !== 'physical' || !table) return this.rollDice(formula, source);

    const parsed = parseDiceFormula(formula);
    const plan = planTableDice(parsed.sides);
    if (plan.types.length === 0) return this.rollDice(formula, source);
    // A percentile die's tens die and d10 share its colour.
    const colors = plan.perDie.flatMap((dice, i) => (dice ?? []).map(() => dieColors?.[i] ?? null));

    const faces = await table.roll(plan.types, formula, colors);
    if (!faces) return null;

    // Dice the table has no model for (a d3, a d7) still get random numbers.
    const values = readPlannedDice(parsed.sides, plan, faces, (sides) => rollRandomDie(sides));
    const result = buildRollResult(formula, parsed, values);
    const names = new Map(table.getDiceColors().map((entry) => [entry.color, entry.name || entry.color]));
    result.rolls.forEach((roll, i) => {
      const color = plan.perDie[i] ? dieColors?.[i] : null;
      if (!color) return;
      roll.color = color;
      roll.colorName = names.get(color) ?? color;
    });
    return this.publish(result, source);
  }

  /** The colours dice can be added in, from the open map's collection. */
  public getDiceColors(): DiceColor[] {
    return this.physicalTable?.getDiceColors() ?? [];
  }

  public getMode(): DiceMode {
    return this.settings?.getDiceMode() ?? 'rng';
  }

  public setMode(mode: DiceMode): void {
    this.settings?.setDiceMode(mode);
  }

  /** Physical dice are only thrown on a game master's map, which provides the table. */
  public attachPhysicalTable(table: PhysicalDiceTable): void {
    this.physicalTable?.destroy();
    this.physicalTable = table;
  }

  public hasPhysicalTable(): boolean {
    return this.physicalTable !== null;
  }

  public destroy(): void {
    this.physicalTable?.destroy();
    this.physicalTable = null;
  }

  private publish(result: DiceRollResult, source?: DiceRollResult['source']): DiceRollResult {
    if (source) {
      result.source = source;
    }

    // Add to history
    this.state.rollHistory.unshift(result);

    // Keep only last 50 rolls
    if (this.state.rollHistory.length > 50) {
      this.state.rollHistory = this.state.rollHistory.slice(0, 50);
    }

    document.dispatchEvent(new CustomEvent(DICE_ROLLED_EVENT, { detail: result }));

    return result;
  }

  public clearHistory(): void {
    this.state.rollHistory = [];
    this.eventBus.emit('dice-history-cleared');
    document.dispatchEvent(new CustomEvent('atlas-dice-history-cleared'));
  }

  public setActiveFormula(formula: string): void {
    this.state.activeFormula = formula;
  }

  public getQuickDice(): string[] {
    return this.state.quickDice;
  }

  public addQuickDie(die: string): void {
    if (!this.state.quickDice.includes(die)) {
      this.state.quickDice.push(die);
    }
  }

  public removeQuickDie(die: string): void {
    this.state.quickDice = this.state.quickDice.filter(d => d !== die);
  }

  // Get current state
  public getState(): DiceToolState {
    return { ...this.state };
  }
}
