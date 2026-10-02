/**
 * Atlas's dice: the dice its tray offers, the formula a selection makes, rolling a formula, and
 * what players may see of a roll. Shared with the online GM side and the join page, so it
 * imports nothing.
 */

/** The dice of Atlas's dice tray, in tray order. */
export const DICE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'] as const;
export type DieType = typeof DICE_TYPES[number];

/** How many of each die are picked; a die left out counts 0. */
export type DiceSelection = Partial<Record<DieType, number>>;

/** Every roll reaches Atlas's dice log, toasts and sounds as this document event. */
export const DICE_ROLLED_EVENT = 'atlas-dice-rolled';

export interface DiceRollResult {
  id: string;
  timestamp: number;
  formula: string;
  rolls: Array<{
    die: string; // e.g., "d20", "d6"
    value: number;
    max: number;
  }>;
  modifiers: number;
  total: number;
  player?: string;
  /** Who rolled it when it was not the GM: an online player's name. */
  rolledBy?: string;
  source?: {
    type: 'toolbar' | 'statblock';
    /** Let the roll follow its token's or statblock's current artwork. */
    tokenId?: string;
    statblockPath?: string;
    tokenName?: string;
    tokenImagePath?: string;
    abilityName?: string;
  };
}

export function isDieType(value: unknown): value is DieType {
  return typeof value === 'string' && (DICE_TYPES as readonly string[]).includes(value);
}

/** The picked dice in the order they were picked, e.g. `['2d6', 'd20']`; dice with no count are left out. */
export function diceTerms(selection: Readonly<Partial<Record<string, number>>>): string[] {
  return Object.entries(selection).flatMap(([die, count]) => (
    isDieType(die) && count !== undefined && count > 0 ? [count > 1 ? `${count}${die}` : die] : []
  ));
}

/** The formula Atlas rolls for a selection and a modifier, e.g. "2d6+d20-1"; empty without dice. */
export function diceFormula(selection: Readonly<Partial<Record<string, number>>>, modifier = 0): string {
  const dice = diceTerms(selection).join('+');
  if (!dice || modifier === 0) return dice;
  return `${dice}${modifier > 0 ? '+' : '-'}${Math.abs(modifier)}`;
}

/**
 * One term of a formula: dice with an optional sign and count ("+3d8", "d20"), or a signed flat
 * modifier ("- 2"). Reading both in one pass keeps the count of a later die from also counting
 * as a modifier.
 */
const TERM = /([+-])?\s*(\d+)?d(\d+)|([+-])\s*(\d+)/gi;

/**
 * Rolls `formula` with `random` for the dice. Dice add up whatever their sign, as Atlas has
 * always rolled them. The id stays random however the dice are rolled, so rolls made in the
 * same millisecond never share one.
 */
export function rollFormula(formula: string, random: () => number = Math.random, now: number = Date.now()): DiceRollResult {
  const rolls: DiceRollResult['rolls'] = [];
  let modifiers = 0;
  for (const [, , count, sides, sign, flat] of formula.matchAll(TERM)) {
    if (sides !== undefined) {
      const max = parseInt(sides, 10);
      const times = parseInt(count ?? '1', 10);
      for (let i = 0; i < times; i++) rolls.push({ die: `d${max}`, value: Math.floor(random() * max) + 1, max });
    } else if (flat !== undefined) {
      modifiers += sign === '-' ? -parseInt(flat, 10) : parseInt(flat, 10);
    }
  }
  const total = rolls.reduce((sum, roll) => sum + roll.value, 0) + modifiers;
  return {
    id: `roll_${now}_${Math.random().toString(36).slice(2, 11)}`,
    timestamp: now,
    formula,
    rolls,
    modifiers,
    total,
    player: 'Player',
  };
}

/** A roll for a token hidden from players keeps its ability and result, not the token's name or portrait. */
export function withoutHiddenToken(result: DiceRollResult, isTokenHidden: (tokenId: string) => boolean): DiceRollResult {
  const source = result.source;
  const tokenId = source?.tokenId;
  if (!source || !tokenId || !isTokenHidden(tokenId)) return result;
  const { type, abilityName } = source;
  return { ...result, source: abilityName ? { type, abilityName } : { type } };
}

/** The dice log as a map file keeps it: online players' rolls stay in the live session's log only. */
export function persistableDiceLog(log: readonly DiceRollResult[]): DiceRollResult[] {
  return log.filter((entry) => !entry.rolledBy);
}

/** The name a roll shows: the online player who rolled it, or a statblock roll's token; null for the GM's own. */
export function rollerName(result: DiceRollResult): string | null {
  if (result.rolledBy) return result.rolledBy;
  const source = result.source;
  return source?.type === 'statblock' && source.tokenName ? source.tokenName : null;
}
