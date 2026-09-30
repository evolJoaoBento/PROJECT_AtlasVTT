import { describe, expect, it } from 'vitest';
import type { DrawingStroke, TextElement } from '../../../src/app/types';
import type { FogOperation } from '../../../src/app/types/fogTypes';
import type { AnyWidget } from '../../../src/app/types/widgetTypes';
import type { InitiativeEntry } from '../../../src/app/types/initiativeTypes';
import { createDefaultInitiativeState } from '../../../src/app/types/initiativeTypes';
import { AssetRegistry } from '../../../src/app/online/scene/AssetRegistry';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import { drawingBounds, textBounds, tokenBounds } from '../../../src/app/online/scene/objectBounds';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { pickPlayerViewRules, samePlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { createProjectionMemo, projectDrawings, projectFog, projectFogOp, projectTexts } from '../../../src/app/online/scene/projectRecords';
import { isDrawingRecords, isFogRecords, isPlayerSceneBody } from '../../../src/app/online/scene/sceneValidation';
import { projectInitiative, projectWidgets } from '../../../src/app/online/scene/projectPanels';

const ALL_ON: PlayerViewRules = {
  showGrid: true, showTokenHP: true, showTokenStress: true, showTokenNameplates: true, showWidgets: true, showInitiative: true,
};
const ALL_OFF: PlayerViewRules = {
  showGrid: false, showTokenHP: false, showTokenStress: false, showTokenNameplates: false, showWidgets: false, showInitiative: false,
};

const fogBlock = (x: number, y: number, width: number, height: number): FogCoverage => FogCoverage.fromOperations({
  f: { id: 'f', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x, y, width, height },
});

function text(overrides: Partial<TextElement> = {}): TextElement {
  return { id: 'x', kind: 'text', x: 500, y: 500, text: 'Hello', fontSize: 20, fontFamily: 'serif', color: '#111111', ...overrides };
}
function stroke(overrides: Partial<DrawingStroke> = {}): DrawingStroke {
  return {
    id: 'd', kind: 'drawing', timestamp: 3, type: 'pen', color: '#ff0000', width: 4, opacity: 1,
    points: [{ x: 500, y: 500 }, { x: 510, y: 500 }, { x: 520, y: 500 }], ...overrides,
  };
}
function widget(overrides: Partial<AnyWidget> & { id: string }): AnyWidget {
  return { type: 'counter', label: 'Torches', icon: 'flame', visible: true, visibleToPlayers: true, value: 1, order: 0, ...overrides } as AnyWidget;
}
function entry(overrides: Partial<InitiativeEntry> & { id: string; tokenId: string }): InitiativeEntry {
  return {
    name: 'Goblin', initiative: 12, initiativeModifier: 1, hp: { current: 5, max: 7 }, stress: { current: 1, max: 6 },
    imagePath: 'atlas-vtt/assets/goblin.png', statblockPath: 'Bestiary/Goblin.md',
    isActive: false, isDefeated: false, isNPC: true, order: 0, ...overrides,
  };
}

describe('AssetRegistry', () => {
  it('gives each vault path one random id for the session', () => {
    const assets = new AssetRegistry();
    const id = assets.idFor('atlas-vtt/assets/secret-lair.png');
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(assets.idFor('atlas-vtt/assets/secret-lair.png')).toBe(id);
    expect(assets.idFor('atlas-vtt/assets/other.png')).not.toBe(id);
    expect(new AssetRegistry().idFor('atlas-vtt/assets/secret-lair.png')).not.toBe(id);
    expect(assets.idFor(null)).toBeNull();
    expect(assets.idFor('')).toBeNull();
  });
});

describe('object bounds', () => {
  it('measures token footprints, estimated text boxes and drawings', () => {
    expect(tokenBounds({ x: 100, y: 100, size: 1 }, 70)).toEqual({ x: 65, y: 65, width: 70, height: 70 });
    expect(tokenBounds({ x: 0, y: 0, size: 2 }, 70)).toEqual({ x: -105, y: -105, width: 210, height: 210 });
    expect(textBounds(text({ x: 0, y: 0, padding: 5 }))).toEqual({ x: -35, y: -17.5, width: 70, height: 35 });
    const rotated = textBounds(text({ x: 0, y: 0, rotation: 45 }));
    expect(rotated.width).toBeCloseTo(Math.hypot(60, 25));
    expect(drawingBounds({ points: [{ x: 10, y: 10 }, { x: 30, y: 20 }], width: 4 })).toEqual({ x: 6, y: 6, width: 28, height: 18 });
  });
});

describe('player view rules', () => {
  it('keeps the six settings the projection follows', () => {
    const settings = { ...ALL_ON, showToolbar: true, showDiceRolls: true } as PlayerViewRules;
    expect(pickPlayerViewRules(settings)).toEqual(ALL_ON);
    expect(samePlayerViewRules(ALL_ON, { ...ALL_ON })).toBe(true);
    expect(samePlayerViewRules(ALL_ON, { ...ALL_ON, showTokenHP: false })).toBe(false);
  });
});

describe('fog projection', () => {
  it('bakes offsets in, simplifies points and keeps erase and order', () => {
    const op: FogOperation = {
      id: 'b', kind: 'fog', type: 'brush', timestamp: 7, isErasing: true, brushRadius: 25, offsetX: 10, offsetY: -5,
      points: Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 })),
    };
    expect(projectFogOp(op)).toEqual({ type: 'brush', erase: true, order: 7, radius: 25, points: [{ x: 10, y: -5 }, { x: 59, y: -5 }] });
    const rect: FogOperation = { id: 'r', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: 0, y: 0, width: 5, height: 5, offsetX: 3 };
    expect(projectFogOp(rect)).toEqual({ type: 'rectangle', erase: false, order: 1, x: 3, y: 0, width: 5, height: 5 });
  });

  it('drops operations it cannot send and reuses projections of unchanged records', () => {
    const lasso: FogOperation = { id: 'l', kind: 'fog', type: 'lasso', timestamp: 1, isErasing: false, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
    const broken: FogOperation = { id: 'r', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: Number.NaN, y: 0, width: 5, height: 5 };
    expect(projectFogOp(lasso)).toBeNull();
    expect(projectFogOp(broken)).toBeNull();
    const kept: FogOperation = { id: 'k', kind: 'fog', type: 'rectangle', timestamp: 2, isErasing: false, x: 0, y: 0, width: 5, height: 5 };
    const memo = createProjectionMemo();
    const first = projectFog({ l: lasso, k: kept }, memo);
    expect(Object.keys(first)).toEqual(['k']);
    expect(projectFog({ l: lasso, k: kept }, memo).k).toBe(first.k);
  });
});

describe('text and drawing projection', () => {
  it('drops texts completely under fog and keeps those peeking out', () => {
    const coverage = fogBlock(0, 0, 1000, 1000);
    const texts = projectTexts({ hidden: text(), peeking: text({ x: 990 }) }, coverage);
    expect(Object.keys(texts)).toEqual(['peeking']);
  });

  it('fills in values older map files lack', () => {
    const messy = { ...text(), fontSize: undefined, align: 'justify', opacity: '0.5', text: 42 } as unknown as TextElement;
    expect(projectTexts({ messy }, FogCoverage.EMPTY).messy).toMatchObject({ fontSize: 16, align: 'center', opacity: 0.5, text: '' });
  });

  it('simplifies drawings and drops those completely under fog', () => {
    const memo = createProjectionMemo();
    const clear = projectDrawings({ d: stroke() }, FogCoverage.EMPTY, memo);
    expect(clear.d).toEqual({ type: 'pen', order: 3, points: [{ x: 500, y: 500 }, { x: 520, y: 500 }], color: '#ff0000', width: 4, opacity: 1, icon: null });
    expect(projectDrawings({ d: stroke() }, fogBlock(0, 0, 1000, 1000), memo)).toEqual({});
    const icon = projectDrawings({ i: stroke({ type: 'icon', icon: 'skull', points: [{ x: 5, y: 5 }] }) }, FogCoverage.EMPTY, memo);
    expect(icon.i?.icon).toBe('skull');
  });
});

describe('widget projection', () => {
  const settings = {
    widgets: {
      torches: widget({ id: 'torches', order: 2 }),
      clock: widget({ id: 'clock', type: 'clock', label: 'Doom', segments: 6, order: 1 } as Partial<AnyWidget> & { id: string }),
      timer: widget({ id: 'timer', type: 'timer', label: 'Torch', value: 300, duration: 3600, direction: 'down', order: 3 } as Partial<AnyWidget> & { id: string }),
      secret: widget({ id: 'secret', label: 'Ambush', visibleToPlayers: false }),
      off: widget({ id: 'off', label: 'Off here' }),
    },
    offWidgets: ['off'],
    globalVisible: true,
    position: 'top' as const,
    scale: 1,
  };

  it('lists the visible widgets in order with their current values', () => {
    const widgets = projectWidgets({ widgetSettings: settings, widgetValues: { torches: 4, clock: 2 } }, ALL_ON);
    expect(widgets).toEqual([
      { id: 'clock', type: 'clock', label: 'Doom', icon: 'flame', value: 2 },
      { id: 'torches', type: 'counter', label: 'Torches', icon: 'flame', value: 4 },
      { id: 'timer', type: 'timer', label: 'Torch', icon: 'flame', value: 300 },
    ]);
  });

  it('sends none when widgets are hidden from players', () => {
    expect(projectWidgets({ widgetSettings: settings, widgetValues: {} }, ALL_OFF)).toEqual([]);
    expect(projectWidgets({ widgetSettings: { ...settings, globalVisible: false }, widgetValues: {} }, ALL_ON)).toEqual([]);
  });
});

describe('initiative projection', () => {
  const initiative = {
    ...createDefaultInitiativeState(),
    isActive: true,
    round: 3,
    entries: [
      entry({ id: 'e2', tokenId: 'orc', name: 'Orc', order: 1, isActive: true }),
      entry({ id: 'e1', tokenId: 'goblin', order: 0 }),
      entry({ id: 'e3', tokenId: 'hidden-lich', name: 'Lich', order: 2 }),
    ],
  };
  const visible = new Set(['goblin', 'orc']);

  it('lists entries of visible tokens with names and HP as the settings allow', () => {
    const projected = projectInitiative({ initiative, initiativeTrackerOpen: true }, visible, ALL_ON);
    expect(projected).toEqual({
      round: 3, active: true,
      entries: [
        { id: 'e1', tokenId: 'goblin', initiative: 12, name: 'Goblin', hp: { current: 5, max: 7 }, isActive: false },
        { id: 'e2', tokenId: 'orc', initiative: 12, name: 'Orc', hp: { current: 5, max: 7 }, isActive: true },
      ],
    });
    expect(JSON.stringify(projected)).not.toMatch(/stress|statblock|imagePath|Lich/);
    const plain = projectInitiative({ initiative, initiativeTrackerOpen: true }, visible, { ...ALL_ON, showTokenNameplates: false, showTokenHP: false });
    expect(plain?.entries[0]).toMatchObject({ name: null, hp: null });
  });

  it('sends no tracker when it is closed or hidden, and no turn outside combat', () => {
    expect(projectInitiative({ initiative, initiativeTrackerOpen: false }, visible, ALL_ON)).toBeNull();
    expect(projectInitiative({ initiative, initiativeTrackerOpen: true }, visible, ALL_OFF)).toBeNull();
    const idle = projectInitiative({ initiative: { ...initiative, isActive: false }, initiativeTrackerOpen: true }, visible, ALL_ON);
    expect(idle?.entries.every((line) => !line.isActive)).toBe(true);
  });
});

describe('wire ranges', () => {
  it('projects out-of-range values to ones the player validator accepts', () => {
    const wild = text({ x: 1e12, y: -1e12, fontSize: 5000, width: 1e9, height: 1e9, padding: 1e9, borderRadius: 1e9, scale: 1e6 });
    const texts = projectTexts({ wild }, FogCoverage.EMPTY);
    const drawings = projectDrawings(
      { d: stroke({ width: 1e9, points: [{ x: 1e12, y: 0 }, { x: 5, y: -1e12 }] }) }, FogCoverage.EMPTY, createProjectionMemo(),
    );
    const big: FogOperation = { id: 'r', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: 1e12, y: 0, width: 1e9 * 1e9, height: 5, offsetX: 1e12 };
    const brush: FogOperation = {
      id: 'b', kind: 'brush', type: 'brush', timestamp: 2, isErasing: false, brushRadius: 1e9, points: [{ x: 1e12, y: 0 }],
    } as unknown as FogOperation;
    const fog = projectFog({ r: big, b: brush }, createProjectionMemo());
    expect(Object.keys(fog)).toEqual(['r', 'b']);
    expect(isPlayerSceneBody({
      sceneId: 's', map: { asset: null, width: 10, height: 10, cellSize: 70 }, grid: null, widgets: [], initiative: null, tokens: {}, texts,
    })).toBe(true);
    expect(isDrawingRecords(drawings)).toBe(true);
    expect(isFogRecords(fog)).toBe(true);
  });
});
