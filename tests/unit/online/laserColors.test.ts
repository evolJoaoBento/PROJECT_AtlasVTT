import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageToolbar } from '../../../online-client/toolbar.mts';
import { LASER_COLOR_KEY, loadLaserColor, saveLaserColor } from '../../../src/app/online/page/laserColorStore';
import { isControlPinned, LASER_COLOR_HINT, laserSwatches, type ToolbarState } from '../../../src/app/online/page/playerToolbar';
import { decodeControl, encodeControl } from '../../../src/app/online/protocol';
import { swatchLaserColor } from '../../../src/app/online/tools/laserColors';
import { TokenMoves } from '../../../src/app/online/view/TokenMoves';
import { PlayerTools } from '../../../src/app/online/view/tools/PlayerTools';
import { LASER_COLOR_SWATCHES } from '../../../src/app/tools/laserPointerSettings';
import { playerScene } from './sceneFixtures';
import { toolsWorld } from './toolsFixtures';

const SWATCHES = LASER_COLOR_SWATCHES.map((swatch) => swatch.value);
const laser = (overrides: object = {}): object => ({ v: 1, type: 'laser', sceneId: 'scene-1', points: [{ x: 1, y: 2 }], lifted: false, ...overrides });
const valid = (message: object): boolean => decodeControl(JSON.stringify(message)).kind === 'message';

describe('the color of a laser message', () => {
  it('is absent or a #rrggbb color, never anything else', () => {
    expect(valid(laser())).toBe(true);
    expect(valid(laser({ color: '#00A9ff' }))).toBe(true);
    for (const color of ['red', '#fff', '#12345g', '#1234567', '', 5, null, {}, [], 'x'.repeat(5000)]) expect(valid(laser({ color }))).toBe(false);
    const proto = '{"v":1,"type":"laser","sceneId":"s","points":[],"lifted":true,"color":{"__proto__":{}}}';
    expect(decodeControl(proto).kind).toBe('invalid');
  });

  it('is a swatch only when a player names it', () => {
    expect(swatchLaserColor('#FF0059')).toBe('#ff0059');
    expect(swatchLaserColor('#123456')).toBeNull();
    expect(swatchLaserColor('constructor')).toBeNull();
    expect(swatchLaserColor(undefined)).toBeNull();
  });
});

describe('LaserRelay colors', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("forwards a player's swatch to the players and the GM's view, and falls back to their place for anything else", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    const send = (color?: string): void => a.sendRaw(encodeControl({
      v: 1, type: 'laser', sceneId: w.sceneId(), points: [{ x: 1, y: 1 }], lifted: false, ...(color ? { color } : {}),
    }));
    send('#00A9FF');
    expect(w.lasersOf(b).at(-1)?.color).toBe('#00a9ff');
    expect(w.shown.at(-1)?.color).toBe('#00a9ff');
    send('#123456');
    expect(w.lasersOf(b).at(-1)?.color).toBe(SWATCHES[1]);
    send();
    expect(w.shown.at(-1)?.color).toBe(SWATCHES[1]);
    w.finish();
  });

  it("keeps a stroke's color when the player leaves mid-stroke", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    a.session.sendLaser([{ x: 1, y: 1 }], false, undefined, SWATCHES[4]);
    w.lasers.playersChanged(w.gm.getPlayers().filter((player) => player.playerId !== a.playerId));
    expect(w.lasersOf(b).at(-1)).toMatchObject({ lifted: true, color: SWATCHES[4] });
    w.finish();
  });

  it("colors the GM's laser with Atlas's setting, and a changed setting applies to the next message", async () => {
    let color = '#12ab9f';
    const w = toolsWorld({}, () => color);
    w.present();
    const a = await w.join('A');
    w.hub.emitLocal({ kind: 'point', x: 1, y: 2 });
    expect(w.lasersOf(a).at(-1)).toMatchObject({ from: 'gm', color: '#12ab9f' });
    w.hub.emitLocal({ kind: 'lift' });
    await vi.advanceTimersByTimeAsync(100);
    color = '#FF00FF';
    w.hub.emitLocal({ kind: 'point', x: 3, y: 4 });
    await vi.advanceTimersByTimeAsync(100);
    expect(w.lasersOf(a).at(-1)).toMatchObject({ from: 'gm', color: '#FF00FF' });
    w.finish();
  });

  it("falls back to the GM's first swatch when the setting is not a color", async () => {
    const w = toolsWorld({}, () => 'nope');
    w.present();
    const a = await w.join('A');
    w.hub.emitLocal({ kind: 'point', x: 1, y: 2 });
    expect(w.lasersOf(a).at(-1)?.color).toBe(SWATCHES[0]);
    w.finish();
  });
});

describe('the join page laser color', () => {
  const identity = (point: { x: number; y: number }): { x: number; y: number } => ({ x: point.x, y: point.y });
  let clock = 0;
  function setup(laserColor?: string | null) {
    const sent: Array<string | undefined> = [];
    const moves = new TokenMoves({ toWorld: identity, send: () => true, onChange: () => {} });
    const tools = new PlayerTools({
      moves, toWorld: identity, zoom: () => 1, now: () => clock,
      sendLaser: (_points, _lifted, _dt, color) => { sent.push(color); return true; },
      onChange: () => {},
      ...(laserColor !== undefined ? { laserColor } : {}),
    });
    const scene = playerScene({});
    moves.setScene(scene);
    moves.setConnected(true);
    tools.setScene(scene);
    tools.setPlayers(['other', 'me'], 'me');
    tools.setConnected(true);
    return { tools, sent };
  }

  it('follows the join order until a swatch is picked, which also chooses the laser and ignores other colors', () => {
    const { tools } = setup();
    expect(tools.laserColor).toBe(SWATCHES[2]);
    expect(tools.selectLaserColor('#123456')).toBe(false);
    expect(tools.tool).toBe('move');
    expect(tools.selectLaserColor(SWATCHES[5]!)).toBe(true);
    expect(tools.tool).toBe('laser');
    expect(tools.laserColor).toBe(SWATCHES[5]);
  });

  it('draws and sends the own laser in the remembered or picked color, and a message color wins for others', () => {
    const { tools, sent } = setup(SWATCHES[3]);
    expect(tools.laserColor).toBe(SWATCHES[3]);
    tools.select('laser');
    tools.grab({ x: 5, y: 5 }, 'mouse');
    tools.move({ x: 50, y: 5 });
    expect(tools.overlay().lasers[0]?.color).toBe(SWATCHES[3]);
    expect(sent.at(-1)).toBe(SWATCHES[3]);
    tools.selectLaserColor(SWATCHES[6]!);
    tools.grab({ x: 5, y: 5 }, 'mouse');
    tools.move({ x: 90, y: 5 });
    expect(tools.overlay().lasers[0]?.color).toBe(SWATCHES[6]);
    tools.receiveLaser({ from: 'other', sceneId: 'scene-1', points: [{ x: 1, y: 1 }], lifted: false, color: '#abcdef' });
    clock = 500;
    expect(tools.overlay().lasers.find((frame) => frame.from === 'other')?.color).toBe('#abcdef');
  });

  it('remembers the pick in localStorage, and works without it', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    expect(LASER_COLOR_KEY).toBe('atlas-online:laser-color');
    saveLaserColor('#00A9FF', () => storage);
    expect(store.get('atlas-online:laser-color')).toBe('#00a9ff');
    expect(loadLaserColor(() => storage)).toBe('#00a9ff');
    saveLaserColor('#123456', () => storage);
    expect(loadLaserColor(() => storage)).toBe('#00a9ff');
    store.set(LASER_COLOR_KEY, 'junk');
    expect(loadLaserColor(() => storage)).toBeNull();
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadLaserColor(() => broken)).toBeNull();
    expect(() => saveLaserColor(SWATCHES[0]!, () => broken)).not.toThrow();
  });
});

describe('the laser flyout', () => {
  const toolbars: PageToolbar[] = [];
  afterEach(() => { toolbars.splice(0).forEach((toolbar) => toolbar.dispose()); });

  function setup() {
    document.body.innerHTML = '<section><nav id="toolbar"></nav></section>';
    const root = document.getElementById('toolbar')!;
    const picks: string[] = [];
    const toolbar = new PageToolbar({
      root, onTool: () => {}, onShape: () => {}, onDice: () => {}, onLaserColor: (color) => picks.push(color),
      measure: (element) => (element.dataset.control === 'measure' || element.dataset.control === 'laser' ? 56 : 36),
      layout: () => ({ available: 1000, chrome: 19, gap: 8, overflowButtonWidth: 36 }),
    });
    toolbars.push(toolbar);
    const chevron = root.querySelector<HTMLButtonElement>('[aria-label="Laser color options"]')!;
    const flyout = root.querySelector<HTMLElement>('[data-control="laser"] .toolbar-menu')!;
    const swatches = (): HTMLButtonElement[] => [...flyout.querySelectorAll<HTMLButtonElement>('.swatch')];
    return { root, toolbar, picks, chevron, flyout, swatches };
  }

  it('lists the swatches with their labels, the selected one marked, and the hint', () => {
    expect(laserSwatches('#00A9FF').filter((swatch) => swatch.selected).map((swatch) => swatch.label)).toEqual(['Sky blue']);
    const { toolbar, chevron, flyout, swatches } = setup();
    toolbar.update({ laserColor: '#3d6bff' });
    expect(flyout.hidden).toBe(true);
    chevron.click();
    expect(flyout.hidden).toBe(false);
    expect(chevron.getAttribute('aria-expanded')).toBe('true');
    expect(swatches().map((swatch) => swatch.getAttribute('aria-label'))).toEqual(LASER_COLOR_SWATCHES.map((swatch) => swatch.label));
    expect(swatches().map((swatch) => swatch.getAttribute('aria-checked'))).toEqual(SWATCHES.map((value) => String(value === '#3d6bff')));
    expect(swatches()[0]!.style.getPropertyValue('--swatch')).toBe(SWATCHES[0]);
    expect(flyout.textContent).toContain(LASER_COLOR_HINT);
    expect(flyout.querySelector('[title]')).toBeNull();
  });

  it('hands a pick to the page and closes; opening one flyout closes the other, and Escape closes it', () => {
    const { root, picks, chevron, flyout, swatches } = setup();
    chevron.click();
    swatches()[4]!.click();
    expect(picks).toEqual([SWATCHES[4]]);
    expect(flyout.hidden).toBe(true);
    chevron.click();
    root.querySelector<HTMLButtonElement>('[aria-label="Measure options"]')!.click();
    expect(flyout.hidden).toBe(true);
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
    chevron.click();
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(flyout.hidden).toBe(true);
  });

  it('keeps Laser in the bar while its flyout is open', () => {
    const state: ToolbarState = { tool: 'move', shape: 'line', diceOpen: false, measureMenuOpen: false, laserMenuOpen: true, laserColor: '' };
    expect(isControlPinned('laser', state)).toBe(true);
    expect(isControlPinned('laser', { ...state, laserMenuOpen: false })).toBe(false);
  });
});
