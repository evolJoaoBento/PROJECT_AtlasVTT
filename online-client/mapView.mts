// online-client/mapView.mts
/**
 * The map on the join page. It binds the canvas, its input, the Follow GM and Fit map
 * buttons, resizing and page visibility to the tested shared modules
 * (`CameraController`, `ViewInput`, `PlayerViewRenderer`). Only the canvas takes map
 * input, so a gesture that starts on the top bar, the menu or a button never moves the map.
 */
import type { SceneCamera } from '../src/app/online/scene/sceneCamera';
import type { PlayerScene } from '../src/app/online/scene/sceneTypes';
import type { ScreenPoint } from '../src/app/online/view/camera';
import { CameraController } from '../src/app/online/view/CameraController';
import type { ImageLookup } from '../src/app/online/view/layers/layerTypes';
import { createSceneLayers } from '../src/app/online/view/layers/sceneLayers';
import { pixelRatioFor, PlayerViewRenderer } from '../src/app/online/view/PlayerViewRenderer';
import { ViewInput, type PointerInput, type PointerKind } from '../src/app/online/view/ViewInput';
import type { ViewSurface } from '../src/app/online/view/ViewSurface';

export interface MapViewOptions {
  canvas: HTMLCanvasElement;
  surface: ViewSurface;
  images: ImageLookup;
  /** Holds Follow GM and Fit map, shown while the player has broken away. */
  viewButtons: HTMLElement;
  followButton: HTMLButtonElement;
  fitButton: HTMLButtonElement;
  /** Tests pass their own; the page uses the browser's animation frames and visibility. */
  frames?: { request(draw: () => void): number; cancel(handle: number): void };
  isHidden?: () => boolean;
}

function pointerKind(type: string): PointerKind {
  return type === 'touch' || type === 'pen' ? type : 'mouse';
}

export class MapView {
  private readonly camera: CameraController;
  private readonly renderer: PlayerViewRenderer;
  private readonly input: ViewInput;
  private hasScene = false;
  private readonly listeners = new AbortController();
  private resizeObserver: ResizeObserver | null = null;
  private watchedRatio: number | null = null;
  private unwatchRatio: (() => void) | null = null;

  constructor(private readonly options: MapViewOptions) {
    const frames = options.frames ?? {
      request: (draw: () => void): number => window.requestAnimationFrame(() => draw()),
      cancel: (handle: number): void => window.cancelAnimationFrame(handle),
    };
    this.camera = new CameraController({ now: () => performance.now(), onChange: () => this.cameraChanged() });
    this.renderer = new PlayerViewRenderer({
      surface: options.surface,
      camera: this.camera,
      images: options.images,
      layers: createSceneLayers(),
      requestFrame: (draw) => frames.request(draw),
      cancelFrame: (handle) => frames.cancel(handle),
      isHidden: options.isHidden ?? ((): boolean => document.hidden),
    });
    this.input = new ViewInput(this.camera);
    this.bind();
    this.measure();
  }

  /** The scene to show; null shows nothing and resets the camera. */
  setScene(scene: PlayerScene | null): void {
    this.hasScene = scene !== null;
    this.camera.setScene(scene);
    this.renderer.setScene(scene);
    this.updateButtons();
  }

  setGmCamera(camera: SceneCamera | null): void {
    this.camera.setGmCamera(camera);
  }

  /** Images arrived or went. */
  refresh(): void {
    this.renderer.invalidate();
  }

  /** The session is over: stops drawing and frees the fog image. The page does not use the view again. */
  dispose(): void {
    this.listeners.abort();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.unwatchPixelRatio();
    this.renderer.dispose();
  }

  /** Reads the canvas's size again, e.g. once the table is shown. */
  measure(): void {
    const { clientWidth: width, clientHeight: height } = this.options.canvas;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.camera.setScreen({ width, height });
    this.renderer.setSize({ width, height }, pixelRatioFor(window.devicePixelRatio, coarse));
    this.watchPixelRatio();
  }

  /** The ratio changes without a resize when the window moves to another screen or the page is zoomed. */
  private watchPixelRatio(): void {
    if (this.listeners.signal.aborted || typeof window.matchMedia !== 'function') return;
    // measure() runs on every resize: arm a listener only when the ratio changed, and drop the old one.
    if (this.watchedRatio === window.devicePixelRatio) return;
    this.unwatchPixelRatio();
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onChange = (): void => {
      // The listener fired once and is gone: measure() arms the next one.
      this.unwatchPixelRatio();
      this.measure();
    };
    query.addEventListener('change', onChange, { once: true });
    this.watchedRatio = window.devicePixelRatio;
    this.unwatchRatio = () => query.removeEventListener('change', onChange);
  }

  private unwatchPixelRatio(): void {
    this.unwatchRatio?.();
    this.unwatchRatio = null;
    this.watchedRatio = null;
  }

  private cameraChanged(): void {
    this.renderer.invalidate();
    this.updateButtons();
  }

  private updateButtons(): void {
    this.options.viewButtons.hidden = !this.hasScene || this.camera.isFollowing();
  }

  private bind(): void {
    const { canvas, followButton, fitButton } = this.options;
    const { signal } = this.listeners;
    const point = (event: MouseEvent): ScreenPoint => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const pointer = (event: PointerEvent): PointerInput => ({
      id: event.pointerId, ...point(event), kind: pointerKind(event.pointerType), button: event.button, time: event.timeStamp,
    });
    canvas.addEventListener('pointerdown', (event) => {
      try {
        // Moves keep coming to the canvas when the finger leaves it.
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // The pointer is already gone, or the environment has no pointer capture.
      }
      this.input.down(pointer(event));
    }, { signal });
    canvas.addEventListener('pointermove', (event) => this.input.move(pointer(event)), { signal });
    canvas.addEventListener('pointerup', (event) => this.input.up(pointer(event)), { signal });
    canvas.addEventListener('pointercancel', (event) => this.input.cancel(event.pointerId), { signal });
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.input.wheel(point(event), event.deltaY, event.deltaMode);
    }, { passive: false, signal });
    canvas.addEventListener('dblclick', (event) => {
      event.preventDefault();
      this.input.doubleClick(point(event));
    }, { signal });
    followButton.addEventListener('click', () => this.camera.followGm(), { signal });
    fitButton.addEventListener('click', () => this.camera.fitMap(), { signal });
    document.addEventListener('visibilitychange', () => this.renderer.visibilityChanged(), { signal });
    if (typeof ResizeObserver === 'undefined') window.addEventListener('resize', () => this.measure(), { signal });
    else {
      this.resizeObserver = new ResizeObserver(() => this.measure());
      this.resizeObserver.observe(canvas);
    }
  }
}
