// online-client/preview.mts
/**
 * Draws the scene preview on a 2D canvas: a thin layer over the tested shape builders.
 * Everything drawn comes from the network, so text goes only through `fillText` and
 * colours only to `fillStyle` / `strokeStyle` (canvas ignores invalid values).
 */
import { fitTransform, sceneWorldBounds } from '../src/app/online/preview/previewLayout';
import {
  fogShapes, gridLines, inkStrokes, textLabels, tokenMarkers, type FogShape, type GridLines,
} from '../src/app/online/preview/previewShapes';
import type { PlayerScene, ScenePoint } from '../src/app/online/scene/sceneTypes';

const MAP_COLOR = '#d9d4c7';
const FOG_COLOR = '#111318';
const LABEL_COLOR = '#1f2328';
const HP_BACK = 'rgba(0, 0, 0, 0.5)';
const HP_FILL = '#43a047';

export class ScenePreview {
  private scene: PlayerScene | null = null;
  private frame: number | null = null;
  private readonly fog = document.createElement('canvas');

  constructor(private readonly canvas: HTMLCanvasElement) {
    if (typeof ResizeObserver === 'undefined') window.addEventListener('resize', () => this.request());
    else new ResizeObserver(() => this.request()).observe(canvas);
  }

  show(scene: PlayerScene | null): void {
    this.scene = scene;
    this.request();
  }

  /** At most one redraw per animation frame, however many changes arrive. */
  private request(): void {
    if (this.frame !== null) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  private draw(): void {
    const ratio = window.devicePixelRatio || 1;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    // Assigning a size clears and reallocates the canvas, so only do it when it changed.
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    const context = this.canvas.getContext('2d');
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const scene = this.scene;
    const world = scene ? sceneWorldBounds(scene) : null;
    if (!scene || !world) return;
    const view = fitTransform(world, { width, height });
    const toWorld = (target: CanvasRenderingContext2D): void => {
      target.setTransform(ratio * view.scale, 0, 0, ratio * view.scale, ratio * view.offsetX, ratio * view.offsetY);
    };
    const pixel = 1 / view.scale;
    toWorld(context);
    context.fillStyle = MAP_COLOR;
    context.fillRect(world.x, world.y, world.width, world.height);
    if (scene.grid) drawGrid(context, gridLines(scene.grid, world), pixel);
    drawInk(context, scene);
    drawLabels(context, scene);
    drawTokens(context, scene, pixel);
    drawFog(context, this.fog, fogShapes(scene.fog), toWorld);
  }
}

function tracePath(context: CanvasRenderingContext2D, points: readonly ScenePoint[], closed: boolean): void {
  const [first, ...rest] = points;
  if (!first) return;
  context.moveTo(first.x, first.y);
  for (const point of rest) context.lineTo(point.x, point.y);
  if (closed) context.closePath();
}

function dot(context: CanvasRenderingContext2D, point: ScenePoint | undefined, radius: number): void {
  if (!point) return;
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
}

function drawGrid(context: CanvasRenderingContext2D, lines: GridLines | null, pixel: number): void {
  if (!lines) return;
  context.save();
  context.strokeStyle = lines.color;
  context.globalAlpha = lines.alpha;
  context.lineWidth = Math.max(lines.width, pixel);
  context.setLineDash(lines.dash.map((length) => length * pixel));
  context.beginPath();
  for (const [a, b] of lines.segments) {
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
  }
  for (const hex of lines.hexes) tracePath(context, hex, true);
  context.stroke();
  context.restore();
}

function drawInk(context: CanvasRenderingContext2D, scene: PlayerScene): void {
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of inkStrokes(scene.drawings)) {
    context.globalAlpha = stroke.alpha;
    context.fillStyle = stroke.color;
    context.strokeStyle = stroke.color;
    if (stroke.dot) {
      dot(context, stroke.points[0], stroke.width / 2);
      continue;
    }
    context.lineWidth = stroke.width;
    context.beginPath();
    tracePath(context, stroke.points, false);
    context.stroke();
  }
  context.restore();
}

function drawLabels(context: CanvasRenderingContext2D, scene: PlayerScene): void {
  context.save();
  context.textBaseline = 'middle';
  for (const label of textLabels(scene.texts)) {
    context.globalAlpha = label.alpha;
    context.fillStyle = label.color;
    context.textAlign = label.align;
    context.font = `${label.size}px system-ui, sans-serif`;
    const lines = label.text.split('\n');
    const lineHeight = label.size * 1.25;
    lines.forEach((line, index) => {
      context.fillText(line, label.x, label.y + (index - (lines.length - 1) / 2) * lineHeight);
    });
  }
  context.restore();
}

function drawTokens(context: CanvasRenderingContext2D, scene: PlayerScene, pixel: number): void {
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const marker of tokenMarkers(scene)) {
    context.fillStyle = marker.color;
    context.strokeStyle = LABEL_COLOR;
    context.lineWidth = 2 * pixel;
    context.beginPath();
    context.arc(marker.x, marker.y, marker.radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    if (marker.label) {
      context.fillStyle = LABEL_COLOR;
      context.font = `600 ${marker.radius * 0.8}px system-ui, sans-serif`;
      context.fillText(marker.label, marker.x, marker.y);
    }
    if (marker.hp !== null) {
      const barWidth = marker.radius * 2;
      const barHeight = marker.radius * 0.25;
      const top = marker.y + marker.radius * 1.15;
      context.fillStyle = HP_BACK;
      context.fillRect(marker.x - marker.radius, top, barWidth, barHeight);
      context.fillStyle = HP_FILL;
      context.fillRect(marker.x - marker.radius, top, barWidth * marker.hp, barHeight);
    }
  }
  context.restore();
}

/** Fog on its own canvas, erased with `destination-out` like the GM's compositor, then laid over the scene opaque. */
function drawFog(
  target: CanvasRenderingContext2D,
  fogCanvas: HTMLCanvasElement,
  shapes: FogShape[],
  toWorld: (context: CanvasRenderingContext2D) => void,
): void {
  if (shapes.length === 0) return;
  if (fogCanvas.width !== target.canvas.width) fogCanvas.width = target.canvas.width;
  if (fogCanvas.height !== target.canvas.height) fogCanvas.height = target.canvas.height;
  const fog = fogCanvas.getContext('2d');
  if (!fog) return;
  fog.setTransform(1, 0, 0, 1, 0, 0);
  fog.globalCompositeOperation = 'source-over';
  fog.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
  toWorld(fog);
  fog.fillStyle = FOG_COLOR;
  fog.strokeStyle = FOG_COLOR;
  fog.lineCap = 'round';
  fog.lineJoin = 'round';
  for (const shape of shapes) {
    fog.globalCompositeOperation = shape.erase ? 'destination-out' : 'source-over';
    if (shape.kind === 'rect') {
      fog.fillRect(shape.x, shape.y, shape.width, shape.height);
    } else if (shape.kind === 'polygon') {
      fog.beginPath();
      tracePath(fog, shape.points, true);
      fog.fill();
    } else if (shape.points.length === 1) {
      dot(fog, shape.points[0], shape.width / 2);
    } else {
      fog.lineWidth = shape.width;
      fog.beginPath();
      tracePath(fog, shape.points, false);
      fog.stroke();
    }
  }
  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.drawImage(fogCanvas, 0, 0);
  target.restore();
}
