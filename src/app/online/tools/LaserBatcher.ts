/**
 * Sends a laser while it is drawn: new points in batches, at most one message every 50 ms (20 a
 * second), each with at most the newest 64 points, and the lift in order after the stroke's last
 * points. A laser held still sends an empty batch every 500 ms, so receivers do not let it go.
 * Shared by the GM's laser (`LaserRelay`) and the join page's (`LaserTool`).
 */
import type { ScenePoint } from '../scene/sceneTypes';
import { LASER_LIMITS } from './toolMessages';

export const LASER_INTERVAL_MS = 1000 / LASER_LIMITS.perSecond;
export const LASER_KEEPALIVE_MS = 500;

interface Batch {
  points: ScenePoint[];
  lifted: boolean;
}

export class LaserBatcher {
  /** Waiting to be sent, oldest first; only the last one still takes points. */
  private readonly batches: Batch[] = [];
  private cooldown: number | null = null;
  private keepAlive: number | null = null;
  private drawing = false;

  constructor(private readonly output: (points: ScenePoint[], lifted: boolean) => void) {}

  get isDrawing(): boolean {
    return this.drawing;
  }

  /** The laser reached `point`; the first point after a lift starts a new stroke. */
  point(point: ScenePoint): void {
    this.drawing = true;
    let batch = this.batches[this.batches.length - 1];
    if (!batch || batch.lifted) {
      batch = { points: [], lifted: false };
      this.batches.push(batch);
    }
    batch.points.push({ x: point.x, y: point.y });
    if (batch.points.length > LASER_LIMITS.points) batch.points.splice(0, batch.points.length - LASER_LIMITS.points);
    this.flushSoon();
  }

  /** The laser was let go or interrupted; nothing happens without a stroke. */
  lift(): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.clearKeepAlive();
    const batch = this.batches[this.batches.length - 1];
    if (batch && !batch.lifted) batch.lifted = true;
    else this.batches.push({ points: [], lifted: true });
    this.flushSoon();
  }

  dispose(): void {
    if (this.cooldown !== null) window.clearTimeout(this.cooldown);
    this.cooldown = null;
    this.clearKeepAlive();
    this.batches.length = 0;
    this.drawing = false;
  }

  private flushSoon(): void {
    if (this.cooldown === null) this.flush();
  }

  private flush(): void {
    const batch = this.batches.shift();
    if (batch) this.send(batch.points, batch.lifted);
  }

  private send(points: ScenePoint[], lifted: boolean): void {
    this.output(points, lifted);
    this.cooldown = window.setTimeout(() => {
      this.cooldown = null;
      this.flush();
    }, LASER_INTERVAL_MS);
    this.clearKeepAlive();
    if (!this.drawing) return;
    this.keepAlive = window.setTimeout(() => {
      this.keepAlive = null;
      if (this.drawing && this.cooldown === null && this.batches.length === 0) this.send([], false);
    }, LASER_KEEPALIVE_MS);
  }

  private clearKeepAlive(): void {
    if (this.keepAlive !== null) window.clearTimeout(this.keepAlive);
    this.keepAlive = null;
  }
}
