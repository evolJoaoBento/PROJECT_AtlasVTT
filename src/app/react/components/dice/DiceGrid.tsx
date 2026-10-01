import React from 'react';
import { diceIcons } from '../DiceIcons';
import { cn } from '../../../../utils/cn';
import { LabelTooltip } from '../../../packages/components/primitives/tooltip';
import { DICE_TYPES } from '../../../tools/diceRolling';

interface DiceSelection {
  [die: string]: number;
}

interface DiceGridProps {
  selection: DiceSelection;
  onAdd: (die: string, event: React.MouseEvent) => void;
  onRemove: (die: string, event: React.MouseEvent) => void;
}

export function DiceGrid({ selection, onAdd, onRemove }: DiceGridProps): React.ReactElement {
  return (
    <div className="atlas-dice-grid">
      {DICE_TYPES.map(die => {
        const DiceIcon = diceIcons[die];
        const count = selection[die] ?? 0;
        const isSelected = count > 0;

        return (
          <div key={die} className="atlas-dice-cell">
            <LabelTooltip label={`${die.toUpperCase()} \u2022 Left: add \u2022 Right: remove`}>
              <button
                className={cn('atlas-dice-btn', isSelected && 'atlas-dice-btn--selected')}
                onClick={(e) => onAdd(die, e)}
                onContextMenu={(e) => onRemove(die, e)}
              >
                <DiceIcon size={18} />
                {isSelected && (
                  <span key={count} className="atlas-dice-badge">
                    {count}
                  </span>
                )}
              </button>
            </LabelTooltip>
            <span className="atlas-dice-label">{die}</span>
          </div>
        );
      })}
    </div>
  );
}
