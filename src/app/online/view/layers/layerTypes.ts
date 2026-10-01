/** What every layer of the player view gets for one frame. Shared with the web page. */
import type { DecodedImage } from '../../assets/AssetLoader';
import type { PlayerScene } from '../../scene/sceneTypes';
import type { WorldRect } from '../camera';
import type { ViewSurface } from '../ViewSurface';

/**
 * The loaded image for an asset id, or null while it is missing. Looked up at draw time,
 * never kept: images are released when they leave the scene.
 */
export type ImageLookup = (id: string | null) => DecodedImage | null;

export interface LayerFrame {
  scene: PlayerScene;
  images: ImageLookup;
  /** The world area on screen, with a margin; layers skip what lies outside it. */
  visible: WorldRect;
  /** Screen (CSS) pixels per world unit. */
  zoom: number;
  /** World units per device pixel: the thinnest line that shows. */
  pixel: number;
  /** The map's area, or without a map size the scene's content; null for an empty scene. */
  bounds: WorldRect | null;
}

export interface PlayerLayer {
  draw(surface: ViewSurface, frame: LayerFrame): void;
  /** Frees what the layer caches (the fog image). */
  dispose?(): void;
}
