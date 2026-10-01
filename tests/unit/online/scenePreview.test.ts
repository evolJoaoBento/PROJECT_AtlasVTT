import { describe, expect, it } from 'vitest';
import { fitTransform, sceneWorldBounds } from '../../../src/app/online/preview/previewLayout';
import { MAX_GRID_HEXES, fogShapes, gridLines, initials, inkStrokes, textLabels, tokenMarkers } from '../../../src/app/online/preview/previewShapes';
import { initiativeLines, widgetLines } from '../../../src/app/online/preview/sceneSummary';
import type { PlayerGrid } from '../../../src/app/online/scene/sceneTypes';
import { fogRect, playerScene, playerToken } from './sceneFixtures';

const square: PlayerGrid = {
  type: 'square', size: 100, offsetX: 0, offsetY: 0, color: null, opacity: 0.5,
  lineType: 'dashed', lineWidth: 2, hexNumbers: null, hexNumberOpacity: null,
};

describe('preview layout', () => {
  it('fits the map into the canvas with padding, centred', () => {
    expect(fitTransform({ x: 0, y: 0, width: 1000, height: 500 }, { width: 532, height: 282 }))
      .toEqual({ scale: 0.5, offsetX: 16, offsetY: 16 });
    const tall = fitTransform({ x: 0, y: 0, width: 100, height: 400 }, { width: 532, height: 432 });
    expect(tall.scale).toBe(1);
    expect(tall.offsetX).toBe(216);
  });

  it('fits a zero-size world without dividing by zero', () => {
    const fit = fitTransform({ x: 0, y: 0, width: 0, height: 0 }, { width: 100, height: 100 });
    expect(Number.isFinite(fit.scale)).toBe(true);
    expect(Number.isFinite(fit.offsetX)).toBe(true);
  });

  it('shows the map, else the tokens, else ten cells of grid', () => {
    expect(sceneWorldBounds(playerScene())).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
    const noMap = { asset: null, width: 0, height: 0, cellSize: 70 };
    expect(sceneWorldBounds(playerScene({ map: noMap }))).toEqual({ x: -5, y: -5, width: 210, height: 210 });
    expect(sceneWorldBounds(playerScene({ map: noMap, tokens: {} }))).toEqual({ x: 0, y: 0, width: 700, height: 700 });
    expect(sceneWorldBounds(playerScene({ map: noMap, tokens: {}, grid: null }))).toBeNull();
  });
});

describe('preview shapes', () => {
  it('draws square grid lines across the area', () => {
    const lines = gridLines(square, { x: 0, y: 0, width: 300, height: 200 });
    expect(lines?.segments).toHaveLength(7);
    expect(lines).toMatchObject({ hexes: [], color: '#808080', alpha: 0.5, width: 2, dash: [6, 4] });
    expect(gridLines({ ...square, size: 1 }, { x: 0, y: 0, width: 2000, height: 2000 })).toBeNull();
  });

  it('skips hex grids over the cap', () => {
    const hex: PlayerGrid = { ...square, type: 'hex-vertical', size: 1, lineType: 'solid' };
    expect(gridLines(hex, { x: 0, y: 0, width: 5000, height: 5000 })).toBeNull();
    expect(MAX_GRID_HEXES).toBe(5000);
  });

  it('draws hex outlines for hex grids', () => {
    const lines = gridLines({ ...square, type: 'hex-vertical', size: 60, lineType: 'solid' }, { x: 0, y: 0, width: 300, height: 300 });
    expect(lines?.segments).toEqual([]);
    expect(lines?.hexes.length).toBeGreaterThan(10);
    expect(lines?.hexes.every((hex) => hex.length === 6)).toBe(true);
    expect(lines?.dash).toEqual([]);
  });

  it('replays fog in order as strokes, polygons and rectangles', () => {
    const shapes = fogShapes({
      b: { type: 'brush', erase: false, order: 2, radius: 10, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
      c: { type: 'lasso', erase: true, order: 2, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }] },
      a: fogRect(1),
    });
    expect(shapes.map((shape) => shape.kind)).toEqual(['rect', 'stroke', 'polygon']);
    expect(shapes[1]).toMatchObject({ width: 20, erase: false });
    expect(shapes[2]).toMatchObject({ erase: true });
  });

  it('draws ink in order, icons as dots, and skips eraser strokes', () => {
    const strokes = inkStrokes({
      late: { type: 'pen', order: 5, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: '#ff0000', width: 3, opacity: 0.5, icon: null },
      early: { type: 'icon', order: 1, points: [{ x: 9, y: 9 }], color: '#00ff00', width: 40, opacity: 1, icon: 'skull' },
      rubber: { type: 'eraser', order: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: '#000000', width: 3, opacity: 1, icon: null },
    });
    expect(strokes.map((stroke) => stroke.color)).toEqual(['#00ff00', '#ff0000']);
    expect(strokes[0]?.dot).toBe(true);
    expect(strokes[1]).toMatchObject({ dot: false, alpha: 0.5, width: 3 });
  });

  it('labels texts at their scaled size', () => {
    expect(textLabels(playerScene().texts)).toEqual([
      { x: 50, y: 50, text: 'Tavern', size: 24, color: '#000000', alpha: 1, align: 'center' },
    ]);
  });

  it('marks tokens by layer with their footprint, colour, initials and HP', () => {
    const scene = playerScene({
      tokens: {
        top: playerToken({ layer: 2, name: 'Anna Bell', hp: { current: 5, max: 10 }, ring: '#ff0000' }),
        bottom: playerToken({ layer: 0, ring: null, size: 2 }),
      },
    });
    expect(tokenMarkers(scene)).toEqual([
      { x: 100, y: 100, radius: 94.5, color: '#9aa0a6', ring: null, label: null, hp: null, image: 'asset-1' },
      { x: 100, y: 100, radius: 31.5, color: '#ff0000', ring: '#ff0000', label: 'AB', hp: 0.5, image: 'asset-1' },
    ]);
    const zeroMax = playerScene({ tokens: { a: playerToken({ hp: { current: 0, max: 0 } }) } });
    expect(tokenMarkers(zeroMax)[0]?.hp).toBeNull();
    expect(initials('Grimgar')).toBe('GR');
    expect(initials('   ')).toBe('');
  });
});

describe('scene summary', () => {
  it('lists widgets with their values', () => {
    expect(widgetLines([
      { id: 'a', type: 'counter', label: 'Torches', icon: 'flame', value: 3 },
      { id: 'b', type: 'timer', label: 'Torch', icon: 'hourglass', value: 125 },
      { id: 'c', type: 'clock', label: '', icon: 'clock', value: 2 },
    ])).toEqual(['Torches: 3', 'Torch: 02:05', 'clock: 2']);
  });

  it('lists initiative with the round, the active turn, names and HP', () => {
    const lines = initiativeLines({
      round: 2,
      active: true,
      entries: [
        { id: 'e1', tokenId: 't1', initiative: 18, name: 'Anna', hp: { current: 5, max: 10 }, isActive: true },
        { id: 'e2', tokenId: 't2', initiative: 12, name: null, hp: null, isActive: false },
      ],
    });
    expect(lines).toEqual(['Round 2', '▶ 18 · Anna · 5/10 HP', '12 · Unnamed']);
    expect(initiativeLines({ round: 0, active: false, entries: [] })).toEqual([]);
    expect(initiativeLines(null)).toEqual([]);
  });
});
