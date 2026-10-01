/**
 * Draws the presented scene on a `ViewSurface`: one layer per Atlas layer, in Atlas's
 * order (`SCENE_LAYER_ORDER`). It draws at most once per animation frame and only after
 * something changed (scene, camera, images, size), keeps drawing while the camera
 * glides, and draws nothing while the page is hidden. Frames and visibility are injected,
 * so tests drive it. Shared with the web page.
 */
import { SCENE_LAYER_ORDER, type SceneLayer } from '../../pixi/sceneLayerOrder';
import { sceneWorldBounds } from '../preview/previewLayout';
import type { PlayerScene } from '../scene/sceneTypes';
import { visibleArea, type ScreenSize } from './camera';
import type { CameraController } from './CameraController';
import type { ImageLookup, LayerFrame, PlayerLayer } from './layers/layerTypes';
import type { ViewSurface } from './ViewSurface';

/** Outside the map Atlas's canvas is black. */
export const VIEW_BACKGROUND = '#000000';
/** Phones draw at most two device pixels per CSS pixel: sharper costs more than it shows. */
export const PHONE_PIXEL_RATIO_CAP = 2;
/** World area drawn beyond the screen's edges, in CSS pixels, so shapes crossing the edge are drawn whole. */
const VISIBLE_MARGIN = 64;

/** The ratio to draw at: the device's, capped on phones (a coarse primary pointer). */
export function pixelRatioFor(deviceRatio: number, coarsePointer: boolean): number {
  const ratio = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  return coarsePointer ? Math.min(PHONE_PIXEL_RATIO_CAP, ratio) : ratio;
}

export interface PlayerViewRendererOptions {
  surface: ViewSurface;
  camera: CameraController;
  images: ImageLookup;
  /** One per Atlas layer (`createSceneLayers()` on the page); a new Atlas layer fails the build until it has one. */
  layers: Record<SceneLayer, PlayerLayer>;
  requestFrame(draw: () => void): number;
  cancelFrame(handle: number): void;
  isHidden(): boolean;
}

export class PlayerViewRenderer {
  private scene: PlayerScene | null = null;
  private screen: ScreenSize = { width: 0, height: 0 };
  private ratio = 1;
  private frame: number | null = null;

  constructor(private readonly options: PlayerViewRendererOptions) {}

  setScene(scene: PlayerScene | null): void {
    this.scene = scene;
    this.request();
  }

  /** The canvas's CSS size and the pixel ratio to draw at. */
  setSize(screen: ScreenSize, ratio: number): void {
    this.screen = { width: screen.width, height: screen.height };
    this.ratio = ratio;
    this.request();
  }

  /** The camera moved or images arrived or went: draw again. */
  invalidate(): void {
    this.request();
  }

  /** The page was shown or hidden; once shown, what changed meanwhile is drawn. */
  visibilityChanged(): void {
    this.request();
  }

  dispose(): void {
    if (this.frame !== null) this.options.cancelFrame(this.frame);
    this.frame = null;
    for (const name of SCENE_LAYER_ORDER) this.options.layers[name].dispose?.();
  }

  /** Draws one frame now. */
  draw(): void {
    const { surface, camera, layers } = this.options;
    const width = Math.max(1, Math.round(this.screen.width * this.ratio));
    const height = Math.max(1, Math.round(this.screen.height * this.ratio));
    surface.begin(width, height, VIEW_BACKGROUND);
    const scene = this.scene;
    if (!scene || this.screen.width <= 0 || this.screen.height <= 0) return;
    const view = camera.current();
    const scale = view.zoom * this.ratio;
    surface.setCamera(scale, width / 2 - view.centerX * scale, height / 2 - view.centerY * scale);
    const frame: LayerFrame = {
      scene,
      images: this.options.images,
      visible: visibleArea(view, { width: this.screen.width + 2 * VISIBLE_MARGIN, height: this.screen.height + 2 * VISIBLE_MARGIN }),
      zoom: view.zoom,
      pixel: 1 / scale,
      bounds: sceneWorldBounds(scene),
    };
    for (const name of SCENE_LAYER_ORDER) layers[name].draw(surface, frame);
  }

  private request(): void {
    if (this.frame !== null || this.options.isHidden()) return;
    this.frame = this.options.requestFrame(() => {
      this.frame = null;
      this.draw();
      // A glide moves the camera every frame until it arrives.
      if (this.options.camera.isMoving()) this.request();
    });
  }
}
