/**
 * Atlas's tokens as the player window shows them, lowest layer first: the art clipped
 * to its circle (a marker until it has loaded) and turned by the token's rotation, the
 * ring when the token has one, then its bars, nameplate and condition badges.
 */
import { getTokenRingCenterRadius } from '../../../pixi/token-renderer/tokenRingMetrics';
import { computeTokenPixelSize, computeTokenStrokeWidth } from '../../../pixi/token-renderer/tokenSizing';
import type { PlayerToken } from '../../scene/sceneTypes';
import { intersects } from '../camera';
import type { ViewSurface } from '../ViewSurface';
import type { LayerFrame, PlayerLayer } from './layerTypes';
import { drawTokenUi } from './tokenUiDrawing';

/** The stand-in drawn until a token's art has loaded. */
export const TOKEN_MARKER_COLOR = '#9aa0a6';

export function createTokensLayer(): PlayerLayer {
  // Sorted once per change of the tokens, not on every frame.
  let sorted: { tokens: Readonly<Record<string, PlayerToken>>; list: PlayerToken[] } | null = null;
  const byLayer = (tokens: Readonly<Record<string, PlayerToken>>): PlayerToken[] => {
    if (sorted === null || sorted.tokens !== tokens) sorted = { tokens, list: Object.values(tokens).sort((a, b) => a.layer - b.layer) };
    return sorted.list;
  };
  return {
    draw(surface, frame): void {
      const cellSize = frame.scene.map.cellSize;
      const stroke = computeTokenStrokeWidth(cellSize);
      for (const token of byLayer(frame.scene.tokens)) {
        // Never 0 or negative: Atlas's formula gives nothing at half a cell or less.
        const size = Math.max(1, computeTokenPixelSize(cellSize, token.size));
        // The art, its ring, and the bars and badges around it.
        const reach = size / 2 + stroke + cellSize;
        if (!intersects({ x: token.x - reach, y: token.y - reach, width: reach * 2, height: reach * 2 }, frame.visible)) continue;
        const ringRadius = getTokenRingCenterRadius(size, stroke, 1);
        drawArt(surface, frame, token, size, stroke, ringRadius);
        drawTokenUi(surface, token, { size, cellSize, ringRadius });
      }
    },
  };
}

function drawArt(surface: ViewSurface, frame: LayerFrame, token: PlayerToken, size: number, stroke: number, ringRadius: number): void {
  const radius = size / 2;
  const art = frame.images(token.image);
  surface.push(token.x, token.y, (token.rotation * Math.PI) / 180, 1);
  if (art) {
    // Cover-fit: the art fills the circle and keeps its proportions.
    const scale = Math.max(size / art.width, size / art.height);
    const width = art.width * scale;
    const height = art.height * scale;
    surface.image(art.image, -width / 2, -height / 2, width, height, { x: 0, y: 0, radius });
  } else {
    surface.circle(0, 0, radius, { fill: TOKEN_MARKER_COLOR });
  }
  if (token.ring !== null) surface.circle(0, 0, ringRadius, { stroke: token.ring, lineWidth: stroke });
  surface.pop();
}
