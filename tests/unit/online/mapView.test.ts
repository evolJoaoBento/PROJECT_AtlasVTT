import { describe, expect, it } from 'vitest';
import { MapView } from '../../../online-client/mapView.mts';
import { fakeFrames, RecordingSurface } from './recordingSurface';
import { playerScene } from './sceneFixtures';

function pointer(target: EventTarget, type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
  target.dispatchEvent(event);
}

function setup() {
  document.body.innerHTML = [
    '<section><canvas id="map"></canvas>',
    '<div id="view-buttons" hidden><button id="follow-gm" type="button">Follow GM</button>',
    '<button id="fit-map" type="button">Fit map</button></div>',
    '<button id="menu-button" type="button">Menu</button></section>',
  ].join('');
  const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const canvas = element<HTMLCanvasElement>('map');
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const frames = fakeFrames();
  const surface = new RecordingSurface();
  const view = new MapView({
    canvas, surface, images: () => null, frames, isHidden: () => false,
    viewButtons: element('view-buttons'), followButton: element('follow-gm'), fitButton: element('fit-map'),
  });
  return { view, canvas, surface, frames, buttons: element('view-buttons'), follow: element<HTMLButtonElement>('follow-gm'), menu: element('menu-button') };
}

describe('MapView', () => {
  it('breaks away on a drag on the map, and Follow GM brings it back', () => {
    const t = setup();
    t.view.setScene(playerScene());
    expect(t.buttons.hidden).toBe(true);
    pointer(t.canvas, 'pointerdown', 100, 100);
    pointer(t.canvas, 'pointermove', 160, 100);
    pointer(t.canvas, 'pointerup', 160, 100);
    expect(t.buttons.hidden).toBe(false);
    t.follow.click();
    expect(t.buttons.hidden).toBe(true);
  });

  it('does not move the map for a gesture that starts on a button', () => {
    const t = setup();
    t.view.setScene(playerScene());
    pointer(t.menu, 'pointerdown', 100, 100);
    pointer(t.menu, 'pointermove', 300, 100);
    pointer(t.canvas, 'pointermove', 320, 100);
    pointer(t.canvas, 'pointerup', 320, 100);
    expect(t.buttons.hidden).toBe(true);
  });

  it('draws the scene in the next frame at the canvas size', () => {
    const t = setup();
    t.view.setScene(playerScene());
    t.frames.run();
    expect(t.surface.ops('begin')[0]).toMatchObject({ width: 800, height: 600 });
    expect(t.surface.ops('drawLayer')).toHaveLength(1);
  });

  it('hides Follow GM and Fit map when no scene is shown', () => {
    const t = setup();
    t.view.setScene(playerScene());
    pointer(t.canvas, 'pointerdown', 100, 100);
    pointer(t.canvas, 'pointermove', 160, 100);
    t.view.setScene(null);
    expect(t.buttons.hidden).toBe(true);
  });
  it('stops listening once disposed', () => {
    const t = setup();
    t.view.setScene(playerScene());
    t.view.dispose();
    pointer(t.canvas, 'pointerdown', 100, 100);
    pointer(t.canvas, 'pointermove', 160, 100);
    expect(t.buttons.hidden).toBe(true);
  });
});
