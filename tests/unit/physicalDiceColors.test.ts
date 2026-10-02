import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { DiceTool } from '../../src/app/tools/DiceTool';
import type { PhysicalDiceTable } from '../../src/app/physical-dice/PhysicalDiceTable';
import type { SettingsService } from '../../src/app/services/SettingsService';

const RED = '#d64545';
const BLUE = '#3b82f6';

/** A dice tool in physical mode whose table reads every die as `face`. */
function physicalTool(face: number) {
  const roll = vi.fn(async (types: string[]) => types.map(() => face));
  const table = {
    roll,
    getDiceColors: () => [{ id: 'r', name: 'Red', color: RED }, { id: 'b', name: '', color: BLUE }],
    destroy: () => {},
  } as unknown as PhysicalDiceTable;
  const settings = { getDiceMode: () => 'physical' } as unknown as SettingsService;
  const tool = new DiceTool(new EventEmitter(), settings);
  tool.attachPhysicalTable(table);
  return { tool, roll };
}

describe('physical dice colours', () => {
  it('throws each die in its colour and names it in the result', async () => {
    const { tool, roll } = physicalTool(7);
    const result = await tool.requestRoll('2d20+d6', undefined, [RED, BLUE, null]);

    expect(roll).toHaveBeenCalledWith(['d20', 'd20', 'd6'], '2d20+d6', [RED, BLUE, null]);
    expect(result?.rolls.map((r) => [r.die, r.color, r.colorName])).toEqual([
      ['d20', RED, 'Red'],
      ['d20', BLUE, BLUE],
      ['d6', undefined, undefined],
    ]);
  });

  it('gives a percentile die\'s tens die and d10 the same colour', async () => {
    const { tool, roll } = physicalTool(0);
    const result = await tool.requestRoll('d100', undefined, [RED]);

    expect(roll).toHaveBeenCalledWith(['d100', 'd10'], 'd100', [RED, RED]);
    expect(result?.rolls[0]).toMatchObject({ die: 'd100', value: 100, color: RED, colorName: 'Red' });
  });

  it('throws in the pack colour when no colours are given', async () => {
    const { tool, roll } = physicalTool(4);
    await tool.requestRoll('d8+2');
    expect(roll).toHaveBeenCalledWith(['d8'], 'd8+2', [null]);
  });
});
