import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhysicalDiceOverlay, type DiceStage } from '../../../online-client/physicalDiceOverlay.mts';
import type { TableReading } from '../../../src/app/online/page/physicalDice';
import type { PhysicalDie } from '../../../src/app/online/tools/physicalRolls';

/** A table without WebGL: it records what it was asked, and settles the dice a test says. */
function fakeStage() {
  let settled: (() => void) | null = null;
  let pending: TableReading[] | null = null;
  const stage = {
    shown: [] as string[][],
    cleared: 0,
    caught: 0,
    nextThrow: [] as TableReading[],
    show: (types: readonly string[]) => { stage.shown.push([...types]); },
    throwAll: async () => { pending = stage.nextThrow; },
    takeLastRoll: () => { const taken = pending; pending = null; return taken; },
    caughtCount: () => stage.caught,
    rerollCaught: vi.fn(),
    rollInProgress: () => false,
    onSettled: (listener: () => void) => { settled = listener; },
    clear: () => { stage.cleared++; },
    /** A die thrown by dragging settles. */
    drop: (reading: TableReading) => { pending = [reading]; settled?.(); },
  };
  return stage satisfies DiceStage;
}

const overlays: PhysicalDiceOverlay[] = [];

function setup(options: { sends?: boolean; load?: () => Promise<DiceStage> } = {}) {
  document.body.innerHTML = '<div id="physical-dice" hidden></div>';
  const root = document.getElementById('physical-dice')!;
  const stage = fakeStage();
  const sent: Array<{ dice: PhysicalDie[]; modifier: number }> = [];
  const loads = vi.fn(options.load ?? (async () => stage));
  const overlay = new PhysicalDiceOverlay({
    root,
    send: (dice, modifier) => { sent.push({ dice, modifier }); return options.sends ?? true; },
    loadStage: loads,
  });
  overlays.push(overlay);
  const status = (): string => root.querySelector('.physical-dice-status')?.textContent ?? '';
  const throwButton = (): HTMLButtonElement => root.querySelector<HTMLButtonElement>('.physical-dice-throw')!;
  return { root, stage, sent, loads, overlay, status, throwButton };
}

describe('the physical dice overlay', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers();
    // Overlays listen on the document: one left open would take the next test's Escape.
    for (const overlay of overlays.splice(0)) overlay.dispose();
  });

  it('loads the table once, puts the dice out and sends the roll once every die is read', async () => {
    const w = setup();
    await w.overlay.open({ d20: 1, d6: 1 }, 3, 'd20 + d6 + 3');
    expect(w.root.hidden).toBe(false);
    expect(w.root.querySelector('.physical-dice-formula')?.textContent).toBe('d20 + d6 + 3');
    expect(w.stage.shown).toEqual([['d20', 'd6']]);
    expect(w.status()).toBe('Drag a die to throw it, or throw them all');
    w.stage.drop({ index: 1, value: 4 });
    expect(w.status()).toBe('1 of 2 dice read. Throw the rest');
    expect(w.sent).toEqual([]);
    w.stage.nextThrow = [{ index: 0, value: 17 }, { index: 1, value: 2 }];
    w.throwButton().click();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.sent).toEqual([{ dice: [{ type: 'd20', value: 17 }, { type: 'd6', value: 2 }], modifier: 3 }]);
    expect(w.status()).toBe('Rolled');
    // The settled dice stay a moment, then the table closes.
    await vi.advanceTimersByTimeAsync(1500);
    expect(w.root.hidden).toBe(true);
    await w.overlay.open({ d4: 1 }, 0, 'd4');
    expect(w.loads).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when closed before every die is read, by its close button or Escape', async () => {
    const w = setup();
    await w.overlay.open({ d6: 2 }, 0, '2d6');
    w.stage.drop({ index: 0, value: 6 });
    w.root.querySelector<HTMLButtonElement>('.physical-dice-cancel')!.click();
    expect(w.root.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.stage.cleared).toBeGreaterThan(0);
    w.stage.drop({ index: 1, value: 6 });
    expect(w.sent).toEqual([]);
    await w.overlay.open({ d6: 1 }, 0, 'd6');
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(escape);
    expect(w.root.hidden).toBe(true);
    w.stage.drop({ index: 0, value: 6 });
    expect(w.sent).toEqual([]);
  });

  it('keeps the table open to throw again when the roll could not be sent', async () => {
    const w = setup({ sends: false });
    await w.overlay.open({ d8: 1 }, 0, 'd8');
    w.stage.drop({ index: 0, value: 8 });
    expect(w.sent).toHaveLength(1);
    expect(w.root.hidden).toBe(false);
    expect(w.status()).toBe('The roll could not be sent. Throw again once you are connected.');
  });

  it('asks for a new throw instead of sending a die it could not read', async () => {
    const w = setup();
    await w.overlay.open({ d6: 1 }, 0, 'd6');
    w.stage.drop({ index: 0, value: 0 });
    expect(w.sent).toEqual([]);
    expect(w.root.hidden).toBe(false);
    expect(w.status()).toBe('A die could not be read. Throw again.');
    w.stage.drop({ index: 0, value: 5 });
    expect(w.sent).toEqual([{ dice: [{ type: 'd6', value: 5 }], modifier: 0 }]);
  });

  it('says so when the 3D dice cannot start, and tries again next time', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = setup({ load: async () => { throw new Error('WebGL is not available'); } });
    await w.overlay.open({ d20: 1 }, 0, 'd20');
    expect(w.status()).toBe('The 3D dice could not start on this device. Close this and roll with RNG.');
    expect(w.throwButton().disabled).toBe(true);
    await w.overlay.open({ d20: 1 }, 0, 'd20');
    expect(w.loads).toHaveBeenCalledTimes(2);
  });

  it('offers to reroll caught dice while some are caught', async () => {
    const w = setup();
    await w.overlay.open({ d6: 2 }, 0, '2d6');
    const reroll = w.root.querySelector<HTMLButtonElement>('.physical-dice-reroll')!;
    expect(reroll.hidden).toBe(true);
    w.stage.caught = 2;
    await vi.advanceTimersByTimeAsync(300);
    expect(reroll.hidden).toBe(false);
    expect(reroll.textContent).toBe('Reroll 2 caught');
    reroll.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.stage.rerollCaught).toHaveBeenCalled();
  });
});
