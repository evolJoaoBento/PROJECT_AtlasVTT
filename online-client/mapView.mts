// online-client/mapView.mts
/**
 * The map on the join page. It binds the canvas and its input, the Follow GM and Fit map
 * buttons, resizing and page visibility. It also binds the player's token moves (cursor, Escape,
 * the "Move not allowed." notice) and tools: Move, Measure, Laser, and the drag ruler's
 * waypoint key. The decisions live in the tested shared modules: `CameraController`,
 * `ViewInput`, `PlayerViewRenderer`, `TokenMoves` and `PlayerTools`. Only the canvas takes map
 * input, so a gesture that starts on the top bar, the menu, the toolbar or a button never moves
 * the map.
 */
import type { SceneCamera } from '../src/app/online/scene/sceneCamera';
import type { PlayerScene, ScenePoint } from '../src/app/online/scene/sceneTypes';
import type { PlayerLaser } from '../src/app/online/tools/toolMessages';
import type { ScreenPoint } from '../src/app/online/view/camera';
import { CameraController } from '../src/app/online/view/CameraController';
import type { ImageLookup } from '../src/app/online/view/layers/layerTypes';
import { createSceneLayers } from '../src/app/online/view/layers/sceneLayers';
import { pixelRatioFor, PlayerViewRenderer } from '../src/app/online/view/PlayerViewRenderer';
import { TokenMoves } from '../src/app/online/view/TokenMoves';
import type { MeasureChoice } from '../src/app/online/view/tools/MeasureTool';
import { PlayerTools, type PlayerTool } from '../src/app/online/view/tools/PlayerTools';
import { createToolsLayer } from '../src/app/online/view/tools/toolsLayer';
import { ViewInput, type PointerInput, type PointerKind } from '../src/app/online/view/ViewInput';
import type { ViewSurface } from '../src/app/online/view/ViewSurface';
import { WAYPOINT_KEY } from '../src/app/pixi/token-renderer/dragRulerPath';

export interface MapViewOptions {
  canvas: HTMLCanvasElement;
  surface: ViewSurface;
  images: ImageLookup;
  /** Holds Follow GM and Fit map, shown while the player has broken away. */
  viewButtons: HTMLElement;
  followButton: HTMLButtonElement;
  fitButton: HTMLButtonElement;
  /** Sends one drop of a controlled token; false when it could not be sent. */
  sendMove(tokenId: string, x: number, y: number): boolean;
  /** Sends new points of the player's laser; false when they could not be sent. */
  sendLaser(points: ScenePoint[], lifted: boolean): boolean;
  /** Shows "Move not allowed." after a refused move. */
  notice: HTMLElement;
  /** The tool or measure shape changed, also by Escape: the toolbar follows. */
  onToolsChange?(): void;
  /** Tests pass their own; the page uses the browser's animation frames, visibility and clock. */
  frames?: { request(draw: () => void): number; cancel(handle: number): void };
  isHidden?: () => boolean;
  now?: () => number;
}

function pointerKind(type: string): PointerKind {
  return type === 'touch' || type === 'pen' ? type : 'mouse';
}

export class MapView {
  private readonly camera: CameraController;
  private readonly renderer: PlayerViewRenderer;
  private readonly moves: TokenMoves;
  private readonly tools: PlayerTools;
  private readonly input: ViewInput;
  private hasScene = false;
  /** Where the mouse is over the canvas, for the grab cursor; null when it is elsewhere. */
  private hover: ScreenPoint | null = null;
  /** What the toolbar was last told. */
  private shownTool: { tool: PlayerTool; shape: MeasureChoice } = { tool: 'move', shape: 'line' };
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
      // Read at draw time, once the tools exist.
      overlays: [createToolsLayer({ overlay: () => this.tools.overlay(), isAnimating: () => this.tools.isAnimating() })],
      requestFrame: (draw) => frames.request(draw),
      cancelFrame: (handle) => frames.cancel(handle),
      isHidden: options.isHidden ?? ((): boolean => document.hidden),
    });
    this.moves = new TokenMoves({
      toWorld: (point) => this.camera.toWorld(point),
      send: (tokenId, x, y) => options.sendMove(tokenId, x, y),
      onChange: () => this.movesChanged(),
    });
    this.tools = new PlayerTools({
      moves: this.moves,
      toWorld: (point) => this.camera.toWorld(point),
      zoom: () => this.camera.current().zoom,
      now: options.now ?? ((): number => performance.now()),
      sendLaser: (points, lifted) => options.sendLaser(points, lifted),
      onChange: () => this.toolsChanged(),
    });
    this.input = new ViewInput(this.camera, this.tools);
    options.canvas.dataset.tool = this.shownTool.tool;
    this.bind();
    this.measure();
  }

  /** The scene to show; null shows nothing and resets the camera. */
  setScene(scene: PlayerScene | null): void {
    this.hasScene = scene !== null;
    this.camera.setScene(scene);
    this.renderer.setScene(scene);
    this.moves.setScene(scene);
    this.tools.setScene(scene);
    this.updateButtons();
  }

  setGmCamera(camera: SceneCamera | null): void {
    this.camera.setGmCamera(camera);
  }

  /** The tokens this player controls, from the GM's latest list. */
  setControlled(tokenIds: readonly string[]): void {
    this.moves.setControlled(tokenIds);
  }

  /** Whether the player is admitted: only then can tokens be dragged and tools send. */
  setConnected(connected: boolean): void {
    this.moves.setConnected(connected);
    this.tools.setConnected(connected);
  }

  /** The GM refused a move of this token. */
  moveRefused(tokenId: string): void {
    this.moves.refused(tokenId);
  }

  /** Chooses a tool; the active one again returns to Move. */
  selectTool(tool: PlayerTool): void {
    this.tools.select(tool);
  }

  selectShape(shape: MeasureChoice): void {
    this.tools.selectShape(shape);
  }

  toolState(): { tool: PlayerTool; shape: MeasureChoice } {
    return { tool: this.tools.tool, shape: this.tools.shape };
  }

  /** The session's players in order and this player's id: whose laser has which colour. */
  setPlayers(order: readonly string[], self: string | null): void {
    this.tools.setPlayers(order, self);
  }

  receiveLaser(laser: PlayerLaser): void {
    this.tools.receiveLaser(laser);
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
    this.tools.dispose();
    this.moves.dispose();
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

  private movesChanged(): void {
    this.renderer.setOverlay(this.moves.overlay());
    const notice = this.moves.notice();
    this.options.notice.textContent = notice ?? '';
    this.options.notice.hidden = notice === null;
    this.updateCursor();
  }

  /** Draws again; the toolbar hears only of a new tool or shape, never of every move. */
  private toolsChanged(): void {
    this.renderer.invalidate();
    const { tool, shape } = this.tools;
    if (tool === this.shownTool.tool && shape === this.shownTool.shape) return;
    this.shownTool = { tool, shape };
    this.options.canvas.dataset.tool = tool;
    this.updateCursor();
    this.options.onToolsChange?.();
  }

  /** A grab hand over the player's tokens with Move; grabbing while one is held. */
  private updateCursor(): void {
    const { canvas } = this.options;
    const holding = this.moves.isDragging();
    canvas.classList.toggle('is-grabbing', holding);
    const canGrab = !holding && this.tools.tool === 'move' && this.hover !== null && this.moves.canGrab(this.hover);
    canvas.classList.toggle('can-grab', canGrab);
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
      // The map takes the keyboard from a toolbar button, so Space mid-drag cannot press it.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused !== document.body) focused.blur();
      try {
        // Moves keep coming to the canvas when the finger leaves it.
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // The pointer is already gone, or the environment has no pointer capture.
      }
      this.input.down(pointer(event));
    }, { signal });
    canvas.addEventListener('pointermove', (event) => {
      const input = pointer(event);
      this.input.move(input);
      if (input.kind !== 'mouse') return;
      this.hover = { x: input.x, y: input.y };
      this.updateCursor();
    }, { signal });
    canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.updateCursor();
    }, { signal });
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
    // Escape ends a drag or a measurement and returns to Move; the menu and panels close on Escape on their own.
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.tools.escape();
      // Atlas's waypoint key: it must not also scroll the page or press a focused button.
      if (event.key === WAYPOINT_KEY && this.tools.isDragging()) {
        event.preventDefault();
        if (!event.repeat) this.tools.addWaypoint();
      }
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
