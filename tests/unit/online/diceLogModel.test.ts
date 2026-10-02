import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DICE_TOAST_MS, dieExtreme, PlayerDiceLog } from '../../../src/app/online/page/diceLogModel';
import type { DiceLogEntry } from '../../../src/app/online/tools/toolMessages';

const entry = (id: string): DiceLogEntry => ({ id, name: 'Anna', formula: 'd20', dice: [{ die: 'd20', value: 20 }], modifier: 0, total: 20, at: 0 });

describe('the join page dice log', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('replaces the log on a replay, without a toast', () => {
    const log = new PlayerDiceLog({ onChange: () => {} });
    log.receive([entry('b'), entry('a')], true);
    expect(log.entries.map(({ id }) => id)).toEqual(['b', 'a']);
    expect(log.toast).toBeNull();
    // A reconnect replays what the page already has: the same rolls, once each.
    log.receive([entry('c'), entry('b'), entry('a')], true);
    expect(log.entries.map(({ id }) => id)).toEqual(['c', 'b', 'a']);
    expect(log.toast).toBeNull();
  });

  it('adds a new roll on top and toasts it for 7 s while the log is closed', () => {
    let changes = 0;
    const log = new PlayerDiceLog({ onChange: () => { changes++; } });
    log.receive([], true);
    log.receive([entry('a')], false);
    expect(log.entries[0]?.id).toBe('a');
    expect(log.toast?.id).toBe('a');
    vi.advanceTimersByTime(DICE_TOAST_MS);
    expect(log.toast).toBeNull();
    expect(changes).toBe(3);
  });

  it('toasts nothing while the log is open, and never lists a roll twice', () => {
    const log = new PlayerDiceLog({ onChange: () => {} });
    log.setOpen(true);
    log.receive([entry('a')], false);
    expect(log.toast).toBeNull();
    log.receive([entry('a')], false);
    expect(log.entries).toHaveLength(1);
  });

  it('keeps the newest 50', () => {
    const log = new PlayerDiceLog({ onChange: () => {} });
    for (let i = 0; i < 60; i++) log.receive([entry(`r${i}`)], false);
    expect(log.entries).toHaveLength(50);
    expect(log.entries[0]?.id).toBe('r59');
  });

  it("marks a die's highest and lowest faces, as Atlas's log does", () => {
    expect(dieExtreme({ die: 'd20', value: 20 })).toBe('max');
    expect(dieExtreme({ die: 'd20', value: 1 })).toBe('min');
    expect(dieExtreme({ die: 'd6', value: 3 })).toBeNull();
  });
});
