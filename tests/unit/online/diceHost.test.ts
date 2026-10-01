import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { documentDiceFeed } from '../../../src/app/online/tools/diceFeed';
import { DICE_LIMITS } from '../../../src/app/online/tools/toolMessages';
import { DiceTool } from '../../../src/app/tools/DiceTool';
import { rollFormula } from '../../../src/app/tools/diceRolling';
import { toolsWorld } from './toolsFixtures';

describe('DiceHost', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('replays the latest 50 rolls on admission, newest first, even when there are none', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    expect(w.logs(a)).toEqual([{ v: 1, type: 'dice-log', entries: [], replay: true }]);
    for (let i = 0; i < 55; i++) w.feed.publish(rollFormula(`${i + 1}d4`));
    expect(w.logs(a).filter((log) => !log.replay)).toHaveLength(55);
    const b = await w.join('B');
    const [replay] = w.logs(b);
    expect(replay?.replay).toBe(true);
    expect(replay?.entries).toHaveLength(DICE_LIMITS.logEntries);
    expect(replay?.entries[0]?.formula).toBe('55d4');
    expect(replay?.entries.at(-1)?.formula).toBe('6d4');
    w.finish();
  });

  it("rolls a player's roll with Atlas's dice code, named after them", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    expect(a.session.sendDiceRoll({ d20: 1 }, 2)).toBe(true);
    expect(w.feed.published).toHaveLength(1);
    expect(w.feed.published[0]).toMatchObject({ formula: 'd20+2', rolledBy: 'A', total: 13 });
    w.finish();
  });

  it('ignores more than two rolls a second from one player', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    for (let i = 0; i < 3; i++) a.session.sendDiceRoll({ d6: 1 }, 0);
    expect(w.feed.published).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    a.session.sendDiceRoll({ d6: 1 }, 0);
    expect(w.feed.published).toHaveLength(3);
    w.finish();
  });

  it('names a roll for a hidden token GM, and a roll for a visible one by its token', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    w.feed.publish({ ...rollFormula('d20'), source: { type: 'statblock', tokenId: 'orc', tokenName: 'Orc', abilityName: 'Axe' } });
    w.feed.publish({ ...rollFormula('d20'), source: { type: 'statblock', tokenId: 'hero', tokenName: 'Hero' } });
    w.feed.publish(rollFormula('d20'));
    expect(w.logs(a).slice(-3).map((log) => log.entries[0]?.name)).toEqual(['GM', 'Hero', 'GM']);
    expect(JSON.stringify(a.received)).not.toContain('Orc');
    w.finish();
  });

  it("hears every roll Atlas's dice tool dispatches, and dispatches player rolls the same way", () => {
    const feed = documentDiceFeed();
    const heard: string[] = [];
    const stop = feed.subscribe((result) => heard.push(result.formula));
    new DiceTool(new EventEmitter()).rollDice('d20');
    feed.publish({ ...rollFormula('d6'), rolledBy: 'Anna' });
    stop();
    new DiceTool(new EventEmitter()).rollDice('d8');
    expect(heard).toEqual(['d20', 'd6']);
  });
});
