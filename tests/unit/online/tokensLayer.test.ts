import { describe, expect, it } from 'vitest';
import { createTokensLayer, TOKEN_MARKER_COLOR } from '../../../src/app/online/view/layers/tokensLayer';
import { NEUTRAL_BADGE_COLOR } from '../../../src/app/online/view/layers/tokenUiDrawing';
import type { PlayerToken } from '../../../src/app/online/scene/sceneTypes';
import { decodedImage, frame, RecordingSurface } from './recordingSurface';
import { playerScene, playerToken } from './sceneFixtures';

const art = decodedImage(200, 100);
const images = (id: string | null): typeof art | null => (id === 'asset-1' ? art : null);

function draw(tokens: Record<string, PlayerToken>, withImages = false): RecordingSurface {
  const surface = new RecordingSurface();
  createTokensLayer().draw(surface, frame(playerScene({ tokens }), withImages ? { images } : {}));
  return surface;
}

describe('tokens layer', () => {
  it('clips the art to its circle, cover-fit, and draws the ring on the grid stroke', () => {
    expect(draw({ t1: playerToken() }, true).calls).toEqual([
      { op: 'push', x: 100, y: 100, rotation: 0, scale: 1 },
      { op: 'image', image: art.image, x: -62, y: -31, width: 124, height: 62, clip: { x: 0, y: 0, radius: 31 } },
      { op: 'circle', x: 0, y: 0, radius: 33, style: { stroke: '#ffffff', lineWidth: 4 } },
      { op: 'pop' },
    ]);
  });

  it('draws a marker until the art has loaded, turned by the rotation, without a ring when it is off', () => {
    expect(draw({ t1: playerToken({ rotation: 90, ring: null }) }).calls).toEqual([
      { op: 'push', x: 100, y: 100, rotation: expect.closeTo(Math.PI / 2), scale: 1 },
      { op: 'circle', x: 0, y: 0, radius: 31, style: { fill: TOKEN_MARKER_COLOR } },
      { op: 'pop' },
    ]);
  });

  it('draws the nameplate and the HP and stress bars below the token at the resting UI size', () => {
    const surface = draw({ t1: playerToken({ name: 'Hero', hp: { current: 7, max: 10 }, stress: { current: 2, max: 6 } }) });
    expect(surface.ops('push')[1]).toEqual({ op: 'push', x: 100, y: 131, rotation: 0, scale: 1 });
    const fills = surface.ops('roundRect').flatMap(({ style }) => (style.fill ? [style.fill] : []));
    expect(fills).toEqual(['#2a2a2a', '#1a1a1a', '#22c55e', '#1a1a1a', '#a855f7']);
    const hpFill = surface.ops('roundRect').find(({ style }) => style.fill === '#22c55e')!;
    expect(hpFill).toMatchObject({ x: -30.625, y: 3.375, height: 7.25 });
    expect(hpFill.width).toBeCloseTo(61.25 * 0.7);
    expect(surface.ops('roundRect').find(({ style }) => style.fill === '#2a2a2a')).toMatchObject({ x: -20, y: -14, width: 40, height: 14 });
    expect(surface.ops('text')).toEqual([{ op: 'text', text: 'Hero', x: 0, y: 0, style: expect.objectContaining({ align: 'center', alpha: 0.85 }) }]);
  });

  it('darkens the HP bar of a token at 0 HP and leaves it empty', () => {
    const surface = draw({ t1: playerToken({ hp: { current: 0, max: 10 } }) });
    const fills = surface.ops('roundRect').map(({ style }) => style);
    expect(fills).toContainEqual({ fill: '#000000', alpha: 0.4 });
    expect(fills.some((style) => style.fill === '#ef4444')).toBe(false);
  });

  it('draws neutral condition badges on the ring with the value in a pip, the last slot counting the rest', () => {
    const conditions = ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({ id, value: index === 1 ? 2 : null }));
    const surface = draw({ t1: playerToken({ conditions }) });
    expect(surface.ops('circle').filter(({ style }) => style.fill === NEUTRAL_BADGE_COLOR)).toHaveLength(2);
    expect(surface.ops('text').map(({ text }) => text)).toEqual(['2', '+3']);
    const badges = surface.ops('push').slice(1);
    expect(badges).toHaveLength(3);
    expect(badges.every(({ x, y }) => Math.hypot(x - 100, y - 100) > 32 && Math.hypot(x - 100, y - 100) < 34)).toBe(true);
  });

  it('draws tokens lowest layer first and skips those off screen', () => {
    const surface = draw({
      a: playerToken({ x: 100, layer: 2 }), b: playerToken({ x: 200, layer: 1 }), c: playerToken({ x: 9000, layer: 0 }),
    });
    expect(surface.ops('push').map(({ x }) => x)).toEqual([200, 100]);
  });

  it('never draws a token smaller than a pixel, even under half a cell', () => {
    const [marker] = draw({ t1: playerToken({ size: 0.5 }) }).ops('circle');
    expect(marker?.radius).toBe(0.5);
  });
});
