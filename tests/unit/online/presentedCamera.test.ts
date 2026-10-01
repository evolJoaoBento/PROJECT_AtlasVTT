import { describe, expect, it } from 'vitest';
import { viewCamera, watchViewCamera } from '../../../src/app/services/presentedCamera';
import { PresentedScene, type PresentedView } from '../../../src/app/services/PresentedScene';
import { FakeViewport, viewWithViewport } from './cameraFixtures';

describe('presented camera', () => {
  it("reads the centre and visible world size of the view's viewport", () => {
    expect(viewCamera(viewWithViewport(new FakeViewport()).view)).toEqual({ centerX: 500, centerY: 400, width: 800, height: 600 });
  });

  it('has no camera without a renderer, a viewport, a live viewport or a size', () => {
    expect(viewCamera(viewWithViewport(null).view)).toBeNull();
    const destroyed = new FakeViewport();
    destroyed.destroyed = true;
    expect(viewCamera(viewWithViewport(destroyed).view)).toBeNull();
    const empty = new FakeViewport();
    empty.worldScreenWidth = 0;
    expect(viewCamera(viewWithViewport(empty).view)).toBeNull();
    expect(viewCamera({ ...viewWithViewport(null).view, renderer: null } as PresentedView)).toBeNull();
  });

  it('calls back after every viewport frame until unwatched', () => {
    const viewport = new FakeViewport();
    const calls: number[] = [];
    const stop = watchViewCamera(viewWithViewport(viewport).view, () => calls.push(1));
    viewport.frame();
    viewport.frame();
    stop();
    viewport.frame();
    expect(calls).toHaveLength(2);
    expect(viewport.listenerCount).toBe(0);
  });

  it("gives the presented scene its view's camera", () => {
    const viewport = new FakeViewport();
    const { view, tavern } = viewWithViewport(viewport);
    const presented = new PresentedScene();
    presented.present(view, tavern);
    viewport.moveTo(10, 20);
    expect(presented.current()?.camera()).toEqual({ centerX: 10, centerY: 20, width: 800, height: 600 });
  });
});
