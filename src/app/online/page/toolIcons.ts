/**
 * Atlas's own icons for the join page: the Lucide icons of Atlas's toolbar (lucide-react 0.503),
 * and the dice of its dice tray (`DiceIcons.tsx`), as SVG markup. The page shows them as CSS mask
 * images, so they take the colour of their button. This is static markup only: nothing from the
 * network ever goes into an SVG. `tests/unit/online/toolIcons.test.tsx` checks them against
 * Atlas's components.
 */
import type { DieType } from '../../tools/diceRolling';

export type ToolIconName = 'hand' | 'ruler' | 'circle' | 'triangle' | 'flashlight' | 'dices' | 'ellipsis' | 'chevron-down' | 'x';

/** Each Lucide icon's children. */
export const TOOL_ICON_MARKUP: Record<ToolIconName, string> = {
  hand: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/>'
    + '<path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/>'
    + '<path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  ruler: '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/>'
    + '<path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>',
  circle: '<circle cx="12" cy="12" r="10"/>',
  triangle: '<path d="M13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>',
  flashlight: '<path d="M18 6c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V2h12z"/>'
    + '<line x1="6" x2="18" y1="6" y2="6"/><line x1="12" x2="12" y1="12" y2="12"/>',
  dices: '<rect width="12" height="12" x="2" y="10" rx="2" ry="2"/>'
    + '<path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"/>'
    + '<path d="M6 18h.01"/><path d="M10 14h.01"/><path d="M15 6h.01"/><path d="M18 9h.01"/>',
  ellipsis: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

const OUTLINE = 'stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"';
const GUIDE = 'stroke="currentColor" stroke-width="1" opacity="0.5"';
const D10_BODY = 'M12 2L18 6v4l-6 10-6-10V6l6-4Z';

/** Each dice tray icon's children, as `DiceIcons.tsx` renders them. */
export const DICE_ICON_MARKUP: Record<DieType, string> = {
  d4: `<path d="M12 2L3 20h18L12 2Z" ${OUTLINE}/><path d="M12 2v18" ${GUIDE}/>`,
  d6: '<rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>'
    + '<circle cx="12" cy="12" r="2" fill="currentColor"/>',
  d8: `<path d="M12 2L20 8v8l-8 6-8-6V8l8-6Z" ${OUTLINE}/><path d="M12 2v20" ${GUIDE}/><path d="M4 8l8 6 8-6" ${GUIDE}/>`,
  d10: `<path d="${D10_BODY}" ${OUTLINE}/><path d="M6 6l6 14 6-14" ${GUIDE}/>`,
  d12: `<path d="M12 2L19 7v10l-7 5-7-5V7l7-5Z" ${OUTLINE}/><polygon points="12,2 19,7 15,12 12,10 9,12 5,7" ${GUIDE} fill="none"/>`,
  d20: `<path d="M12 2L21 8.5L17 19H7L3 8.5L12 2Z" ${OUTLINE}/><path d="M12 2v17" ${GUIDE}/><path d="M3 8.5L12 19L21 8.5" ${GUIDE}/>`,
  d100: `<path d="${D10_BODY}" ${OUTLINE}/>`
    + '<text x="12" y="13" text-anchor="middle" font-size="6" fill="currentColor" font-weight="bold">%</text>',
};

const LUCIDE_ROOT = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
  + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const DICE_ROOT = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"';

function maskUrl(root: string, children: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg ${root}>${children}</svg>`)}")`;
}

/** The icon as a CSS `url()` for a mask image. */
export function toolIconUrl(name: ToolIconName): string {
  return maskUrl(LUCIDE_ROOT, TOOL_ICON_MARKUP[name]);
}

export function dieIconUrl(die: DieType): string {
  return maskUrl(DICE_ROOT, DICE_ICON_MARKUP[die]);
}
