import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from 'src/utils/cn';
import { useKeepInView } from '../../../packages/components/primitives/useKeepInView';
import { DiceTool } from '../../../tools/DiceTool';
import { DiceGrid } from './DiceGrid';
import { DiceFormulaBar } from './DiceFormulaBar';
import { DiceToastContainer } from './DiceToastContainer';
import { SegmentedControl, type SegmentedOption } from '../../../packages/components/primitives/SegmentedControl';
import type { DiceMode } from '../../../services/SettingsService';
import type { DiceColor } from '../../../types/collectionSettingsTypes';

const DICE_MODES: readonly SegmentedOption<DiceMode>[] = [
  { value: 'rng', label: 'RNG' },
  { value: 'physical', label: 'Physical' },
];

interface DiceSelection {
  [die: string]: number;
}

/** A die added to the next roll, in the colour it was added in (null wears the pack's). */
interface DicePick {
  die: string;
  color: string | null;
}

export interface DiceDropdownMenuProps {
  diceTool: DiceTool;
  isOpen: boolean;
  onToggle: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

export function DiceDropdownMenu({ diceTool, isOpen, onToggle, triggerRef }: DiceDropdownMenuProps): React.ReactElement {
  const [picks, setPicks] = useState<DicePick[]>([]);
  const selection = useMemo<DiceSelection>(() => {
    const counts: DiceSelection = {};
    for (const pick of picks) counts[pick.die] = (counts[pick.die] ?? 0) + 1;
    return counts;
  }, [picks]);
  const [diceColors, setDiceColors] = useState<DiceColor[]>([]);
  /** The die whose colours are showing, and where its button's top centre is. */
  const [colorPicker, setColorPicker] = useState<{ die: string; x: number; y: number } | null>(null);

  const [position, setPosition] = useState({ top: 0, left: 0 });
  const portalRef = useRef<HTMLDivElement>(null);
  const keepInView = useKeepInView(portalRef, isOpen, 'top', `${position.left},${position.top}`);
  const [mode, setMode] = useState<DiceMode>(() => diceTool.getMode());

  const handleModeChange = useCallback((next: DiceMode): void => {
    diceTool.setMode(next);
    setMode(next);
  }, [diceTool]);

  // ── Dice add / remove ────────────────────────

  const addDie = useCallback((die: string, color: string | null): void => {
    setPicks((prev) => [...prev, { die, color }]);
  }, []);

  const removeDie = useCallback((die: string): void => {
    setPicks((prev) => {
      const index = prev.findLastIndex((pick) => pick.die === die);
      return index === -1 ? prev : prev.filter((_, i) => i !== index);
    });
  }, []);

  /** Click: a die in the pack's colour. */
  const handleAdd = useCallback((die: string, event: React.MouseEvent): void => {
    event.stopPropagation();
    event.preventDefault();
    addDie(die, null);
  }, [addDie]);

  /**
   * Right-click: with physical dice and colours set up, a column of the colours
   * over the die, each adding it in that colour; otherwise it removes a die.
   */
  const handleRemove = useCallback((die: string, event: React.MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (mode !== 'physical' || diceColors.length === 0) {
      removeDie(die);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setColorPicker({ die, x: rect.left + rect.width / 2, y: rect.top });
  }, [mode, diceColors, removeDie]);

  // ── Roll & clear ─────────────────────────────

  const handleRoll = useCallback((): void => {
    // Dice grouped by type, in the order first added; the colours follow the
    // formula's dice one for one.
    const parts: string[] = [];
    const colors: Array<string | null> = [];
    for (const die of new Set(picks.map((pick) => pick.die))) {
      const group = picks.filter((pick) => pick.die === die);
      parts.push(group.length > 1 ? `${group.length}${die}` : die);
      colors.push(...group.map((pick) => pick.color));
    }

    if (parts.length === 0) return;

    // Physical dice are thrown on the map, so the panel gets out of the way first.
    onToggle();
    void diceTool.requestRoll(parts.join('+'), undefined, mode === 'physical' ? colors : undefined);
  }, [picks, mode, diceTool, onToggle]);

  const handleClear = useCallback((): void => {
    setPicks([]);
  }, []);

  // ── Position & reset when opened ─────────────

  useEffect(() => {
    if (!isOpen) {
      setPicks([]);
      setColorPicker(null);
      return;
    }
    setMode(diceTool.getMode());
    const colors = diceTool.getDiceColors();
    setDiceColors(colors);
    if (triggerRef?.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({ top: rect.top - 16, left: rect.left + rect.width / 2 });
    }
  }, [isOpen, triggerRef, diceTool]);

  // ── Colour column: closes on a click elsewhere or Escape ──

  useEffect(() => {
    if (!colorPicker) return;
    const close = (event: Event): void => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event.target instanceof Element && event.target.closest('.atlas-dice-color-picker')) return;
      setColorPicker(null);
    };
    document.addEventListener('mousedown', close, true);
    document.addEventListener('keydown', close, true);
    return () => {
      document.removeEventListener('mousedown', close, true);
      document.removeEventListener('keydown', close, true);
    };
  }, [colorPicker]);

  // ── Click-outside ────────────────────────────

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent): void => {
      const target = event.target as HTMLElement;
      if (triggerRef?.current?.contains(target)) return;
      if (target.closest('.atlas-dice-portal')) return;
      // The colours a right-click shows over a die.
      if (target.closest('.atlas-dice-color-picker')) return;
      onToggle();
    };

    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onToggle, triggerRef]);

  return (
    <>
      {/* Dropdown panel */}
      {isOpen &&
        createPortal(
          <div
            ref={portalRef}
            className={cn('atlas-dice-portal atlas-vtt-plugin', keepInView.capped && 'atlas-keep-in-view--capped')}
            style={{ ...keepInView.style, top: `${position.top}px`, left: `${position.left}px` }}
          >
            <div className="atlas-dice-panel">
              {diceTool.hasPhysicalTable() && (
                <SegmentedControl
                  className="atlas-dice-mode"
                  value={mode}
                  options={DICE_MODES}
                  onChange={handleModeChange}
                  ariaLabel="Dice mode"
                />
              )}
              <DiceGrid selection={selection} onAdd={handleAdd} onRemove={handleRemove} />
              <DiceFormulaBar selection={selection} onClear={handleClear} onRoll={handleRoll} />
            </div>
          </div>,
          document.body,
        )}

      {isOpen && colorPicker &&
        createPortal(
          <div
            className="atlas-dice-color-picker atlas-vtt-plugin"
            role="group"
            aria-label={`Add a ${colorPicker.die} in a colour`}
            style={{ left: `${colorPicker.x}px`, top: `${colorPicker.y}px` }}
          >
            {diceColors.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="atlas-dice-color"
                aria-label={`${entry.name || entry.color} ${colorPicker.die}`}
                style={{ '--atlas-die-color': entry.color } as React.CSSProperties}
                onClick={() => addDie(colorPicker.die, entry.color)}
              />
            ))}
          </div>,
          document.body,
        )}

      {/* Global toast layer — listens for atlas-dice-rolled CustomEvent */}
      <DiceToastContainer />
    </>
  );
}
