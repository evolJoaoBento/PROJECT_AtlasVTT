/**
 * The player's laser: hold and move to point, shown to everyone; it fades after release like
 * Atlas's. Points are spaced like Atlas's trail, sent in batches (`LaserBatcher`), and echoed on
 * this page at once. Shared with the web page.
 */
import type { ScenePoint } from '../../scene/sceneTypes';
import { LaserBatcher } from '../../tools/LaserBatcher';

export interface LaserToolOptions {
  send(points: ScenePoint[], lifted: boolean): void;
  /** Shows the laser on this page: new points, or the lift. */
  echo(points: ScenePoint[], lifted: boolean): void;
}

export class LaserTool {
  private readonly batcher: LaserBatcher;
  private last: ScenePoint | null = null;
  private drawing = false;

  constructor(private readonly options: LaserToolOptions) {
    this.batcher = new LaserBatcher((points, lifted) => options.send(points, lifted));
  }

  begin(world: ScenePoint): void {
    this.drawing = true;
    this.last = null;
    this.add(world, 0);
  }

  /** `minGap`: the closest two points may be, in world units (`laserPointSpacing`). */
  move(world: ScenePoint, minGap: number): void {
    if (this.drawing) this.add(world, minGap);
  }

  lift(): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.last = null;
    this.batcher.lift();
    this.options.echo([], true);
  }

  dispose(): void {
    this.batcher.dispose();
  }

  private add(point: ScenePoint, minGap: number): void {
    if (this.last && Math.hypot(point.x - this.last.x, point.y - this.last.y) < minGap) return;
    this.last = { x: point.x, y: point.y };
    this.batcher.point(this.last);
    this.options.echo([this.last], false);
  }
}
